import fs from 'node:fs';
import path from 'node:path';
import {
  COSMETIC_CATALOG,
  DEFAULT_EQUIPPED,
  GACHAPON_COST_COINS,
  STARTER_INVENTORY_IDS,
  getCosmeticById,
} from '../src/shared/catalog';
import {
  CosmeticItem,
  DeskDropInstance,
  DoorPermission,
  EquippedLoadout,
  HostStatus,
  IdleActivity,
  KnockRequest,
  OnlineDirectoryEntry,
  RoomPlayerState,
  RoomSnapshot,
  UserProfile,
} from '../src/shared/types';

interface PersistentDB {
  users: Record<string, UserProfile>;
  deskDropsByHost: Record<string, DeskDropInstance[]>;
}

export interface EphemeralRoomState {
  hostUserId: string;
  players: Map<string, RoomPlayerState>; // userId -> state in this room
  pendingKnocks: Map<string, KnockRequest>; // knockId -> request
}

interface TokenBucketState {
  tokens: number;
  lastRefill: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'server', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const BOT_USER_ID = 'usr_bot_pipoca';

export class PocketStore {
  private db: PersistentDB = {
    users: {},
    deskDropsByHost: {},
  };

  // Redis-like ephemeral state in memory
  public rooms = new Map<string, EphemeralRoomState>(); // hostUserId -> room
  public userCurrentRoom = new Map<string, string>(); // userId -> hostUserId of room they are currently in
  public onlineUsers = new Set<string>(); // Set of currently connected userIds

  // 6.1. Cache de sessão de cosméticos validados (Estilo Redis Session)
  public sessionCosmeticsCache = new Map<string, EquippedLoadout>();

  // 6.4. Rate Limiting por Socket (Token Bucket)
  private tokenBuckets = new Map<string, TokenBucketState>();

  constructor() {
    this.loadDB();
    this.ensureCompanionBot();
  }

  private loadDB(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<PersistentDB>;
        this.db.users = parsed.users || {};
        this.db.deskDropsByHost = parsed.deskDropsByHost || {};
      }
    } catch (err) {
      console.error('[PocketStore] Error loading db.json, starting fresh:', err);
    }
  }

  public saveDB(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PocketStore] Error saving db.json:', err);
    }
  }

  private ensureCompanionBot(): void {
    if (!this.db.users[BOT_USER_ID]) {
      this.db.users[BOT_USER_ID] = {
        id: BOT_USER_ID,
        username: 'pipoca_bot',
        displayName: 'Pipoca (Bot Amigo)',
        coins: 999,
        gems: 999,
        inventory: COSMETIC_CATALOG.map((c) => c.id),
        equipped: {
          avatar_body: 'body_pigeon',
          avatar_head: 'head_lofi_headphones',
          avatar_back: 'back_jetpack',
          spawn_fx: 'fx_parachute',
          chat_skin: 'chat_medieval',
          throwable: 'throw_gold_plane',
          room_skin: 'room_forest_campfire',
          desk_drop: 'drop_coffee',
        },
        placedFurniture: [
          { instanceId: 'furn_bot_1', itemId: 'furn_gamer_setup', x: 78 },
          { instanceId: 'furn_bot_2', itemId: 'furn_gamer_chair', x: 112 },
          { instanceId: 'furn_bot_3', itemId: 'furn_arcade_cabinet', x: 285 },
        ],
        friends: [],
        pendingIncomingFriends: [],
        pendingOutgoingFriends: [],
        hostStatus: 'IDLE',
        doorPermission: 'OPEN',
        createdAt: Date.now(),
      };
      this.saveDB();
    }
    this.onlineUsers.add(BOT_USER_ID);
    this.loadSessionCosmetics(BOT_USER_ID);
    this.ensureRoom(BOT_USER_ID);
  }

  public getOrCreateUser(usernameInput: string, displayNameInput?: string): UserProfile {
    const cleanUsername =
      usernameInput
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 20) || 'visitante';

    const existing = Object.values(this.db.users).find(
      (u) => u.username.toLowerCase() === cleanUsername
    );

    if (existing) {
      for (const starterId of STARTER_INVENTORY_IDS) {
        if (!existing.inventory.includes(starterId)) {
          existing.inventory.push(starterId);
        }
      }
      if (!existing.friends) existing.friends = [];
      if (!existing.pendingIncomingFriends) existing.pendingIncomingFriends = [];
      if (!existing.pendingOutgoingFriends) existing.pendingOutgoingFriends = [];
      if (!existing.placedFurniture) {
        existing.placedFurniture = [
          { instanceId: `furn_${Date.now()}_1`, itemId: 'furn_gamer_setup', x: 76 },
          { instanceId: `furn_${Date.now()}_2`, itemId: 'furn_gamer_chair', x: 110 },
          { instanceId: `furn_${Date.now()}_3`, itemId: 'furn_dining_table', x: 276 },
        ];
      }

      if (displayNameInput && displayNameInput.trim()) {
        existing.displayName = displayNameInput.trim().slice(0, 24);
      }
      if (!existing.friends.includes(BOT_USER_ID) && existing.id !== BOT_USER_ID) {
        existing.friends.push(BOT_USER_ID);
      }
      this.saveDB();
      this.loadSessionCosmetics(existing.id);
      return existing;
    }

    const id = `usr_${Math.random().toString(36).slice(2, 9)}`;
    const newUser: UserProfile = {
      id,
      username: cleanUsername,
      displayName: (displayNameInput?.trim() || cleanUsername).slice(0, 24),
      coins: 240,
      gems: 150,
      inventory: [...STARTER_INVENTORY_IDS],
      equipped: { ...DEFAULT_EQUIPPED },
      placedFurniture: [
        { instanceId: `furn_${Date.now()}_1`, itemId: 'furn_gamer_setup', x: 76 },
        { instanceId: `furn_${Date.now()}_2`, itemId: 'furn_gamer_chair', x: 110 },
        { instanceId: `furn_${Date.now()}_3`, itemId: 'furn_dining_table', x: 276 },
      ],
      friends: [BOT_USER_ID],
      pendingIncomingFriends: [],
      pendingOutgoingFriends: [],
      hostStatus: 'ACTIVE',
      doorPermission: 'OPEN',
      createdAt: Date.now(),
    };

    this.db.users[id] = newUser;
    this.db.deskDropsByHost[id] = [
      {
        id: `drop_welcome_${Date.now()}`,
        itemId: 'drop_coffee',
        fromUserId: BOT_USER_ID,
        fromDisplayName: 'Pipoca (Bot Amigo)',
        x: 230,
        note: 'Bem-vindo ao seu cantinho! Clique no café para ganhar velocidade! ☕',
        createdAt: Date.now(),
      },
    ];
    this.saveDB();
    this.loadSessionCosmetics(id);
    return newUser;
  }

  public getUserById(userId: string): UserProfile | undefined {
    return this.db.users[userId];
  }

  public findUserByUsernameOrId(query: string): UserProfile | undefined {
    const clean = query.trim().toLowerCase().replace(/^@/, '');
    return Object.values(this.db.users).find(
      (u) => u.id.toLowerCase() === clean || u.username.toLowerCase() === clean
    );
  }

  /**
   * 6.1. Autoridade Total do Servidor sobre Cosméticos:
   * Carrega do banco os itens equipados do usuário, valida posse e salva no cache de sessão.
   */
  public loadSessionCosmetics(userId: string): EquippedLoadout {
    const user = this.db.users[userId];
    if (!user) return { ...DEFAULT_EQUIPPED };

    const safeEquipped: EquippedLoadout = { ...DEFAULT_EQUIPPED };
    (Object.keys(DEFAULT_EQUIPPED) as Array<keyof EquippedLoadout>).forEach((slot) => {
      const candidateId = user.equipped[slot];
      if (candidateId && user.inventory.includes(candidateId)) {
        safeEquipped[slot] = candidateId;
      }
    });

    this.sessionCosmeticsCache.set(userId, safeEquipped);
    return safeEquipped;
  }

  public getVerifiedEquipped(userId: string): EquippedLoadout {
    const cached = this.sessionCosmeticsCache.get(userId);
    if (cached) return { ...cached };
    return this.loadSessionCosmetics(userId);
  }

  /**
   * 3.1. Princípio de Ouro: Server-Side Inventory Verification
   */
  public verifyOwnership(userId: string, itemId: string): boolean {
    const user = this.db.users[userId];
    if (!user) return false;
    return user.inventory.includes(itemId);
  }

  /**
   * 6.2. Validação de Grafo Social (Anti-Invasão):
   * Verifica se existe relação de amizade ACCEPTED entre visitor_id e host_id.
   */
  public areFriendsAccepted(visitorId: string, hostId: string): boolean {
    if (visitorId === hostId) return true;
    if (visitorId === BOT_USER_ID || hostId === BOT_USER_ID) return true;
    const visitor = this.db.users[visitorId];
    const host = this.db.users[hostId];
    if (!visitor || !host) return false;
    return visitor.friends.includes(hostId) && host.friends.includes(visitorId);
  }

  public requestOrAcceptFriendship(
    fromUserId: string,
    targetUserId: string,
    instantAccept = false
  ): { status: 'ACCEPTED' | 'PENDING' | 'ALREADY_FRIENDS' | 'ERROR'; message: string } {
    const fromUser = this.db.users[fromUserId];
    const targetUser = this.db.users[targetUserId];
    if (!fromUser || !targetUser || fromUserId === targetUserId) {
      return { status: 'ERROR', message: 'Usuário inválido.' };
    }

    if (!fromUser.friends) fromUser.friends = [];
    if (!targetUser.friends) targetUser.friends = [];
    if (!fromUser.pendingIncomingFriends) fromUser.pendingIncomingFriends = [];
    if (!fromUser.pendingOutgoingFriends) fromUser.pendingOutgoingFriends = [];
    if (!targetUser.pendingIncomingFriends) targetUser.pendingIncomingFriends = [];
    if (!targetUser.pendingOutgoingFriends) targetUser.pendingOutgoingFriends = [];

    if (this.areFriendsAccepted(fromUserId, targetUserId)) {
      return {
        status: 'ALREADY_FRIENDS',
        message: `Você e ${targetUser.displayName} já são amigos (ACCEPTED)!`,
      };
    }

    // If target already sent us a request OR instantAccept is true, promote to ACCEPTED!
    if (
      instantAccept ||
      fromUser.pendingIncomingFriends.includes(targetUserId) ||
      targetUser.pendingOutgoingFriends.includes(fromUserId)
    ) {
      if (!fromUser.friends.includes(targetUserId)) fromUser.friends.push(targetUserId);
      if (!targetUser.friends.includes(fromUserId)) targetUser.friends.push(fromUserId);

      fromUser.pendingIncomingFriends = fromUser.pendingIncomingFriends.filter(
        (id) => id !== targetUserId
      );
      fromUser.pendingOutgoingFriends = fromUser.pendingOutgoingFriends.filter(
        (id) => id !== targetUserId
      );
      targetUser.pendingIncomingFriends = targetUser.pendingIncomingFriends.filter(
        (id) => id !== fromUserId
      );
      targetUser.pendingOutgoingFriends = targetUser.pendingOutgoingFriends.filter(
        (id) => id !== fromUserId
      );

      this.saveDB();
      return {
        status: 'ACCEPTED',
        message: `🤝 Amizade ACCEPTED com ${targetUser.displayName}! Agora vocês podem visitar os cantinhos um do outro!`,
      };
    }

    // Otherwise create PENDING request
    if (!fromUser.pendingOutgoingFriends.includes(targetUserId)) {
      fromUser.pendingOutgoingFriends.push(targetUserId);
    }
    if (!targetUser.pendingIncomingFriends.includes(fromUserId)) {
      targetUser.pendingIncomingFriends.push(fromUserId);
    }
    this.saveDB();
    return {
      status: 'PENDING',
      message: `📨 Pedido de amizade enviado para ${targetUser.displayName} (aguardando ACCEPTED).`,
    };
  }

  public respondFriendship(
    userId: string,
    requesterId: string,
    accept: boolean
  ): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    const requester = this.db.users[requesterId];
    if (!user || !requester) return { ok: false, message: 'Usuário não encontrado.' };

    user.pendingIncomingFriends = (user.pendingIncomingFriends || []).filter(
      (id) => id !== requesterId
    );
    requester.pendingOutgoingFriends = (requester.pendingOutgoingFriends || []).filter(
      (id) => id !== userId
    );

    if (accept) {
      if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
      if (!requester.friends.includes(userId)) requester.friends.push(userId);
      this.saveDB();
      return {
        ok: true,
        message: `🤝 Você aceitou a amizade de ${requester.displayName} (ACCEPTED)!`,
      };
    }

    this.saveDB();
    return { ok: true, message: `Pedido de amizade de ${requester.displayName} recusado.` };
  }

  public equipItem(userId: string, itemId: string): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    const cosmetic = getCosmeticById(itemId);
    if (!cosmetic) return { ok: false, message: 'Item cosmético inexistente no catálogo.' };

    if (!this.verifyOwnership(userId, itemId)) {
      return {
        ok: false,
        message: 'Verificação de inventário falhou: você não possui este cosmético!',
      };
    }

    if (cosmetic.category === 'furniture') {
      return this.placeFurniture(userId, itemId);
    }

    user.equipped[cosmetic.category] = itemId;
    this.saveDB();
    const updatedLoadout = this.loadSessionCosmetics(userId);

    const currentRoomHostId = this.userCurrentRoom.get(userId);
    if (currentRoomHostId) {
      const room = this.rooms.get(currentRoomHostId);
      const playerState = room?.players.get(userId);
      if (playerState) {
        playerState.equipped = updatedLoadout;
      }
    }

    return { ok: true, message: `${cosmetic.icon} ${cosmetic.name} equipado com sucesso!` };
  }

  public buyItem(userId: string, itemId: string): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    const item = getCosmeticById(itemId);
    if (!item) return { ok: false, message: 'Item não encontrado.' };

    if (user.inventory.includes(itemId)) {
      return { ok: false, message: 'Você já possui este item no seu inventário!' };
    }

    if (item.currency === 'COINS') {
      if (user.coins < item.price) {
        return { ok: false, message: `Moedas Idle insuficientes! Precisa de ${item.price} 🪙.` };
      }
      user.coins -= item.price;
    } else {
      if (user.gems < item.price) {
        return { ok: false, message: `Gems insuficientes! Precisa de ${item.price} 💎.` };
      }
      user.gems -= item.price;
    }

    user.inventory.push(itemId);
    if (item.category === 'furniture') {
      this.placeFurniture(userId, itemId);
    } else {
      user.equipped[item.category] = itemId;
    }
    this.saveDB();
    const updatedLoadout = this.loadSessionCosmetics(userId);

    const currentRoomHostId = this.userCurrentRoom.get(userId);
    if (currentRoomHostId) {
      const room = this.rooms.get(currentRoomHostId);
      const playerState = room?.players.get(userId);
      if (playerState) {
        playerState.equipped = updatedLoadout;
      }
    }

    return {
      ok: true,
      message:
        item.category === 'furniture'
          ? `Comprou e adicionou ${item.icon} ${item.name} ao seu cantinho!`
          : `Comprou e equipou ${item.icon} ${item.name}!`,
    };
  }

  public placeFurniture(
    userId: string,
    itemId: string,
    x?: number
  ): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    const item = getCosmeticById(itemId);
    if (!item || item.category !== 'furniture') {
      return { ok: false, message: 'Móvel inválido.' };
    }

    if (!this.verifyOwnership(userId, itemId)) {
      return {
        ok: false,
        message: 'Verificação do servidor: você não possui este móvel no inventário!',
      };
    }

    if (!user.placedFurniture) user.placedFurniture = [];
    if (user.placedFurniture.length >= 8) {
      return {
        ok: false,
        message: 'Sua sala já tem 8 móveis! Remova algum antes de colocar outro.',
      };
    }

    const posX =
      typeof x === 'number' && Number.isFinite(x)
        ? Math.max(28, Math.min(332, Math.round(x)))
        : Math.floor(60 + Math.random() * 240);

    user.placedFurniture.push({
      instanceId: `furn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      itemId,
      x: posX,
      flipped: false,
    });
    this.saveDB();
    return {
      ok: true,
      message: `${item.icon} ${item.name} colocado na sala! Arraste-o com o mouse para escolher a posição!`,
    };
  }

  public moveFurniture(userId: string, instanceId: string, x: number): boolean {
    const user = this.db.users[userId];
    if (!user || !user.placedFurniture) return false;
    if (!Number.isFinite(x) || x < 0 || x > 360) return false;

    const target = user.placedFurniture.find((f) => f.instanceId === instanceId);
    if (!target) return false;

    target.x = Math.max(26, Math.min(334, Math.round(x)));
    this.saveDB();
    return true;
  }

  public flipFurniture(userId: string, instanceId: string): boolean {
    const user = this.db.users[userId];
    if (!user || !user.placedFurniture) return false;

    const target = user.placedFurniture.find((f) => f.instanceId === instanceId);
    if (!target) return false;

    target.flipped = !target.flipped;
    this.saveDB();
    return true;
  }

  public removeFurniture(userId: string, instanceId: string): boolean {
    const user = this.db.users[userId];
    if (!user || !user.placedFurniture) return false;

    const prevLen = user.placedFurniture.length;
    user.placedFurniture = user.placedFurniture.filter((f) => f.instanceId !== instanceId);
    if (user.placedFurniture.length !== prevLen) {
      this.saveDB();
      return true;
    }
    return false;
  }

  public rollGachapon(userId: string): {
    ok: boolean;
    message: string;
    item?: CosmeticItem;
    isDuplicate?: boolean;
    refundCoins?: number;
  } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    if (user.coins < GACHAPON_COST_COINS) {
      return {
        ok: false,
        message: `Você precisa de ${GACHAPON_COST_COINS} 🪙 Moedas Idle para girar o Gachapon!`,
      };
    }

    user.coins -= GACHAPON_COST_COINS;
    const pool = COSMETIC_CATALOG.filter((c) => c.inGachapon);
    const chosen = pool[Math.floor(Math.random() * pool.length)];

    let isDuplicate = false;
    let refundCoins = 0;

    if (user.inventory.includes(chosen.id)) {
      isDuplicate = true;
      refundCoins = Math.floor(GACHAPON_COST_COINS * 0.5);
      user.coins += refundCoins;
    } else {
      user.inventory.push(chosen.id);
    }

    this.saveDB();
    return {
      ok: true,
      message: isDuplicate
        ? `Tirou ${chosen.icon} ${chosen.name} (Repetido! +${refundCoins} 🪙 de reembolso)`
        : `🎉 GACHAPON! Você ganhou ${chosen.icon} ${chosen.name}!`,
      item: chosen,
      isDuplicate,
      refundCoins,
    };
  }

  /**
   * 6.4. Rate Limiting por Socket (Redis Token Bucket)
   */
  public consumeRateLimitToken(
    userId: string,
    action: string,
    maxTokens: number,
    refillIntervalMs: number
  ): { allowed: boolean; waitSec: number } {
    const key = `${userId}:${action}`;
    const now = Date.now();
    let bucket = this.tokenBuckets.get(key);

    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefill: now };
      this.tokenBuckets.set(key, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      if (elapsed >= refillIntervalMs) {
        const refilled = Math.floor(elapsed / refillIntervalMs);
        bucket.tokens = Math.min(maxTokens, bucket.tokens + refilled);
        bucket.lastRefill = now;
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, waitSec: 0 };
    }

    const waitMs = Math.max(0, refillIntervalMs - (now - bucket.lastRefill));
    return { allowed: false, waitSec: Math.ceil(waitMs / 1000) };
  }

  public ensureRoom(hostUserId: string): EphemeralRoomState {
    let room = this.rooms.get(hostUserId);
    const hostUser = this.db.users[hostUserId];
    if (!room) {
      room = {
        hostUserId,
        players: new Map(),
        pendingKnocks: new Map(),
      };
      this.rooms.set(hostUserId, room);
    }

    if (hostUser && !room.players.has(hostUserId)) {
      const activities: IdleActivity[] = ['COFFEE', 'TYPING', 'SLEEPING', 'FISHING'];
      room.players.set(hostUserId, {
        userId: hostUser.id,
        username: hostUser.username,
        displayName: hostUser.displayName,
        isHost: true,
        x: 110,
        targetX: 110,
        facing: 'right',
        hostStatus: hostUser.hostStatus,
        idleActivity: activities[Math.floor(Math.random() * activities.length)],
        equipped: this.getVerifiedEquipped(hostUser.id),
        isBot: hostUser.id === BOT_USER_ID,
      });
      this.userCurrentRoom.set(hostUserId, hostUserId);
    }

    return room;
  }

  public getDeskDrops(hostUserId: string): DeskDropInstance[] {
    if (!this.db.deskDropsByHost[hostUserId]) {
      this.db.deskDropsByHost[hostUserId] = [];
    }
    return this.db.deskDropsByHost[hostUserId];
  }

  public addDeskDrop(drop: DeskDropInstance, hostUserId: string): DeskDropInstance[] {
    const list = this.getDeskDrops(hostUserId);
    if (list.length >= 6) {
      list.shift();
    }
    list.push(drop);
    this.saveDB();
    return list;
  }

  public claimDeskDrop(
    hostUserId: string,
    dropId: string
  ): { ok: boolean; drop?: DeskDropInstance; item?: CosmeticItem } {
    const list = this.getDeskDrops(hostUserId);
    const idx = list.findIndex((d) => d.id === dropId);
    if (idx === -1) return { ok: false };

    const [drop] = list.splice(idx, 1);
    const item = getCosmeticById(drop.itemId);
    const hostUser = this.db.users[hostUserId];

    if (hostUser && item) {
      const bonus = item.meta?.bonusCoins ?? 10;
      hostUser.coins += bonus;

      const room = this.rooms.get(hostUserId);
      const hostPlayer = room?.players.get(hostUserId);
      if (hostPlayer && item.meta?.speedBoostSec) {
        hostPlayer.speedBoostUntil = Date.now() + item.meta.speedBoostSec * 1000;
      }
    }

    this.saveDB();
    return { ok: true, drop, item };
  }

  public buildRoomSnapshot(hostUserId: string): RoomSnapshot {
    const room = this.ensureRoom(hostUserId);
    const hostUser = this.db.users[hostUserId];
    const verifiedHostEquip = this.getVerifiedEquipped(hostUserId);

    const now = Date.now();
    for (const p of room.players.values()) {
      if (p.chatBubble && p.chatBubble.expiresAt <= now) {
        p.chatBubble = undefined;
      }
      if (p.activeEmote && p.activeEmote.expiresAt <= now) {
        p.activeEmote = undefined;
      }
    }
    for (const [kId, knock] of room.pendingKnocks.entries()) {
      if (knock.expiresAt <= now) {
        room.pendingKnocks.delete(kId);
      }
    }

    // Ensure starter furniture exists for already-loaded profiles in memory
    if (hostUser && !hostUser.placedFurniture) {
      for (const starterId of STARTER_INVENTORY_IDS) {
        if (!hostUser.inventory.includes(starterId)) {
          hostUser.inventory.push(starterId);
        }
      }
      hostUser.placedFurniture = [
        { instanceId: `furn_init_1`, itemId: 'furn_gamer_setup', x: 76 },
        { instanceId: `furn_init_2`, itemId: 'furn_gamer_chair', x: 110 },
        { instanceId: `furn_init_3`, itemId: 'furn_dining_table', x: 276 },
      ];
      this.saveDB();
    }

    return {
      roomId: `room:${hostUserId}`,
      hostUserId,
      hostUsername: hostUser?.username || 'host',
      hostDisplayName: hostUser?.displayName || 'Host',
      hostStatus: hostUser?.hostStatus || 'IDLE',
      doorPermission: hostUser?.doorPermission || 'OPEN',
      roomSkinId: verifiedHostEquip.room_skin,
      placedFurniture: hostUser?.placedFurniture || [],
      players: Array.from(room.players.values()),
      deskDrops: this.getDeskDrops(hostUserId),
      pendingKnocks: Array.from(room.pendingKnocks.values()),
      maxVisitors: 4,
    };
  }

  public buildOnlineDirectory(): OnlineDirectoryEntry[] {
    const entries: OnlineDirectoryEntry[] = [];
    for (const userId of this.onlineUsers) {
      const u = this.db.users[userId];
      if (!u) continue;
      const room = this.ensureRoom(userId);
      let visitorCount = 0;
      for (const pid of room.players.keys()) {
        if (pid !== userId) visitorCount++;
      }
      entries.push({
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        hostStatus: u.hostStatus,
        doorPermission: u.doorPermission,
        visitorCount,
        maxVisitors: 4,
        currentRoomHostId: this.userCurrentRoom.get(u.id) || u.id,
        equipped: this.getVerifiedEquipped(u.id),
        isBot: u.id === BOT_USER_ID,
      });
    }
    return entries;
  }
}
