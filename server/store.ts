import fs from 'node:fs';
import path from 'node:path';
import { Collection, MongoClient } from 'mongodb';
import {
  COSMETIC_CATALOG,
  DEFAULT_EQUIPPED,
  GACHAPON_COST_COINS,
  PET_BREED_OPTIONS,
  STARTER_INVENTORY_IDS,
  getCosmeticById,
  getFishColorOption,
  getPetBreedOption,
  getRealMoneyPackageById,
  parseHumanVariant,
} from '../src/shared/catalog';
import {
  CosmeticItem,
  DeskDropInstance,
  DoorPermission,
  EquippedLoadout,
  FriendProfileSummary,
  HostStatus,
  IdleActivity,
  KnockRequest,
  OnlineDirectoryEntry,
  PaymentStatus,
  PaymentTransactionRecord,
  RoomPlayerState,
  RoomSnapshot,
  ShopPurchaseLogRecord,
  UserProfile,
} from '../src/shared/types';

interface PersistentDB {
  users: Record<string, UserProfile>;
  deskDropsByHost: Record<string, DeskDropInstance[]>;
  paymentTransactions: PaymentTransactionRecord[];
  shopPurchaseLogs: ShopPurchaseLogRecord[];
}

interface MongoStateDoc extends PersistentDB {
  _id: string;
  updatedAt: number;
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
const MONGO_DOC_ID = 'pocket_corner_db';

export const BOT_USER_ID = 'usr_bot_pipoca';

export class PocketStore {
  private db: PersistentDB = {
    users: {},
    deskDropsByHost: {},
    paymentTransactions: [],
    shopPurchaseLogs: [],
  };

  // MongoDB Atlas Cloud Persistence
  public isMongoConnected = false;
  public isMongoConnecting = false;
  public lastMongoError: string | null = null;
  private mongoClient: MongoClient | null = null;
  private mongoCollection: Collection<MongoStateDoc> | null = null;
  private mongoSaveTimer: NodeJS.Timeout | null = null;

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

  /**
   * Conecta ao MongoDB Atlas (se MONGODB_URI estiver definido no .env)
   * e sincroniza os perfis de usuários, moedas, inventário, móveis e transações na nuvem.
   */
  public async initMongo(mongoUri?: string): Promise<boolean> {
    if (this.isMongoConnected) return true;
    if (this.isMongoConnecting) return false;

    const cleanUri = mongoUri?.trim();
    if (!cleanUri) {
      console.log(
        '📁 [PocketStore] MONGODB_URI vazio no .env — usando banco local (server/data/db.json).'
      );
      return false;
    }

    this.isMongoConnecting = true;
    try {
      this.mongoClient = new MongoClient(cleanUri, {
        serverSelectionTimeoutMS: 6000,
        connectTimeoutMS: 6000,
      });
      await this.mongoClient.connect();
      const database = this.mongoClient.db('pocket_corner');
      this.mongoCollection = database.collection<MongoStateDoc>('app_state');
      this.isMongoConnected = true;
      this.lastMongoError = null;

      const cloudDoc = await this.mongoCollection.findOne({ _id: MONGO_DOC_ID });
      if (cloudDoc) {
        this.db.users = { ...this.db.users, ...(cloudDoc.users || {}) };
        this.db.deskDropsByHost = {
          ...this.db.deskDropsByHost,
          ...(cloudDoc.deskDropsByHost || {}),
        };
        if (Array.isArray(cloudDoc.paymentTransactions)) {
          const txMap = new Map<string, PaymentTransactionRecord>();
          for (const tx of this.db.paymentTransactions) txMap.set(tx.id, tx);
          for (const tx of cloudDoc.paymentTransactions) txMap.set(tx.id, tx);
          this.db.paymentTransactions = Array.from(txMap.values()).sort(
            (a, b) => b.createdAt - a.createdAt
          );
        }
        if (Array.isArray(cloudDoc.shopPurchaseLogs)) {
          const logMap = new Map<string, ShopPurchaseLogRecord>();
          for (const lg of this.db.shopPurchaseLogs) logMap.set(lg.id, lg);
          for (const lg of cloudDoc.shopPurchaseLogs) logMap.set(lg.id, lg);
          this.db.shopPurchaseLogs = Array.from(logMap.values()).sort(
            (a, b) => b.createdAt - a.createdAt
          );
        }
        this.ensureCompanionBot();
        this.writeLocalFileSync();
        console.log(
          `☁️ [PocketStore] Conectado ao MongoDB Atlas! (${Object.keys(this.db.users).length} contas sincronizadas)`
        );
      } else {
        await this.flushToMongo();
        console.log('☁️ [PocketStore] Conectado ao MongoDB Atlas! Estado inicial criado na nuvem.');
      }
      return true;
    } catch (err) {
      this.isMongoConnected = false;
      this.mongoCollection = null;
      this.lastMongoError = (err as Error).message;
      console.error(
        '⚠️ [PocketStore] Falha ao conectar no MongoDB Atlas (verifique Network Access 0.0.0.0/0 no Atlas). Usando fallback local:',
        (err as Error).message
      );
      return false;
    } finally {
      this.isMongoConnecting = false;
    }
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
        this.db.paymentTransactions = Array.isArray(parsed.paymentTransactions)
          ? parsed.paymentTransactions
          : [];
        this.db.shopPurchaseLogs = Array.isArray(parsed.shopPurchaseLogs)
          ? parsed.shopPurchaseLogs
          : [];
      }
    } catch (err) {
      console.error('[PocketStore] Error loading db.json, starting fresh:', err);
    }
  }

  private writeLocalFileSync(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DB_FILE, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PocketStore] Error saving db.json:', err);
    }
  }

  private async flushToMongo(): Promise<void> {
    if (!this.mongoCollection) return;
    try {
      await this.mongoCollection.updateOne(
        { _id: MONGO_DOC_ID },
        {
          $set: {
            users: this.db.users,
            deskDropsByHost: this.db.deskDropsByHost,
            paymentTransactions: this.db.paymentTransactions,
            shopPurchaseLogs: this.db.shopPurchaseLogs,
            updatedAt: Date.now(),
          },
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('[PocketStore] Erro ao salvar no MongoDB Atlas:', (err as Error).message);
    }
  }

  public saveDB(): void {
    this.writeLocalFileSync();

    if (this.mongoCollection) {
      if (this.mongoSaveTimer) {
        clearTimeout(this.mongoSaveTimer);
      }
      this.mongoSaveTimer = setTimeout(() => {
        this.mongoSaveTimer = null;
        void this.flushToMongo();
      }, 200);
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

  private normalizeExistingUser(existing: UserProfile): UserProfile {
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
    } else {
      // Garante que cada móvel comprado tenha no máximo 1 unidade posicionada na sala
      const seenItems = new Set<string>();
      existing.placedFurniture = existing.placedFurniture.filter((f) => {
        if (seenItems.has(f.itemId)) return false;
        seenItems.add(f.itemId);
        return true;
      });
    }
    if (!existing.friends.includes(BOT_USER_ID) && existing.id !== BOT_USER_ID) {
      existing.friends.push(BOT_USER_ID);
    }
    return existing;
  }

  /**
   * Gera um ID único imutável baseado no nome inicial (ex: Rick, Rick2, Rick3...).
   * Uma vez criado, esse valor nunca pode ser alterado.
   */
  private generateImmutableUniqueHandle(rawName: string): string {
    const firstWord = (rawName || 'Player').trim().split(/\s+/)[0] || 'Player';
    const normalized = firstWord
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 16);

    const baseClean = normalized
      ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
      : 'Player';

    let candidate = baseClean;
    let counter = 1;
    while (
      Object.values(this.db.users).some(
        (u) => u.username.toLowerCase() === candidate.toLowerCase()
      )
    ) {
      counter++;
      candidate = `${baseClean}${counter}`;
    }
    return candidate;
  }

  /**
   * Busca ou cria conta única vinculada ao Google (1 conta por Google ID).
   * Na criação inicial, gera o @ID único imutável (ex: Rick, Rick2, Rick3)
   * e define o nome da conta Google como displayName inicial.
   */
  public getOrCreateGoogleUser(params: {
    googleId: string;
    email?: string;
    googleName: string;
    picture?: string;
  }): UserProfile {
    const cleanGoogleId = params.googleId.trim();
    const cleanEmail = params.email?.trim().toLowerCase();
    const cleanGoogleName = (params.googleName || 'Jogador').trim().slice(0, 40);

    const existing = Object.values(this.db.users).find(
      (u) =>
        u.googleId === cleanGoogleId ||
        (cleanEmail && u.email && u.email.toLowerCase() === cleanEmail)
    );

    if (existing) {
      this.normalizeExistingUser(existing);
      existing.googleId = cleanGoogleId;
      if (cleanEmail) existing.email = cleanEmail;
      existing.googleName = cleanGoogleName;
      if (params.picture) existing.picture = params.picture;

      // Se a conta antiga foi gerada com o prefixo de e-mail antes desta regra, converte uma única vez para o formato Nome/Nome2 e mantém fixo para sempre
      if (cleanEmail) {
        const oldEmailPrefix = cleanEmail
          .split('@')[0]
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '')
          .slice(0, 16);
        if (existing.username === oldEmailPrefix) {
          existing.username = this.generateImmutableUniqueHandle(cleanGoogleName);
        }
      }
      // IMPORTANTE: existing.username (@ID único) é imutável e NUNCA pode ser alterado pelo usuário!

      this.saveDB();
      this.loadSessionCosmetics(existing.id);
      return this.withComputedAdminFlag(existing);
    }

    const candidateUsername = this.generateImmutableUniqueHandle(cleanGoogleName);

    const id = `usr_g_${cleanGoogleId.slice(-10)}_${Math.random().toString(36).slice(2, 6)}`;
    const newUser: UserProfile = {
      id,
      username: candidateUsername,
      displayName: cleanGoogleName.slice(0, 24),
      googleId: cleanGoogleId,
      email: cleanEmail,
      googleName: cleanGoogleName,
      picture: params.picture,
      coins: 20,
      gems: 0,
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
    return this.withComputedAdminFlag(newUser);
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
      this.normalizeExistingUser(existing);
      if (displayNameInput && displayNameInput.trim() && !existing.googleId) {
        existing.displayName = displayNameInput.trim().slice(0, 24);
      }
      this.saveDB();
      this.loadSessionCosmetics(existing.id);
      return this.withComputedAdminFlag(existing);
    }

    const id = `usr_${Math.random().toString(36).slice(2, 9)}`;
    const newUser: UserProfile = {
      id,
      username: cleanUsername,
      displayName: (displayNameInput?.trim() || cleanUsername).slice(0, 24),
      coins: 20,
      gems: 0,
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
    return this.withComputedAdminFlag(newUser);
  }

  public updateUserNickname(userId: string, rawNickname: string): UserProfile | null {
    const user = this.db.users[userId];
    if (!user) return null;

    const cleanNickname = rawNickname
      .replace(/<[^>]*>?/gm, '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, 24);

    if (!cleanNickname) return null;

    user.displayName = cleanNickname;

    // Atualiza nas salas ativas em tempo real
    for (const room of this.rooms.values()) {
      const player = room.players.get(userId);
      if (player) {
        player.displayName = cleanNickname;
      }
    }

    this.saveDB();
    return this.withComputedAdminFlag(user);
  }

  /**
   * REGRA DE SEGURANÇA MÁXIMA:
   * A verificação de Administrador ocorre EXCLUSIVAMENTE no servidor comparando
   * o e-mail da conta Google autenticada no banco com process.env.ADMIN_EMAIL.
   * O frontend NUNCA tem autoridade para definir ou alterar isAdmin.
   */
  public isUserAdmin(userOrId: UserProfile | string | undefined | null): boolean {
    const rawEnv = (process.env.ADMIN_EMAIL || '')
      .replace(/['"]/g, '')
      .trim()
      .toLowerCase();
    if (!rawEnv) return false;

    const allowedEmails = rawEnv
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (allowedEmails.length === 0) return false;

    const u =
      typeof userOrId === 'string'
        ? this.db.users[userOrId]
        : userOrId
          ? this.db.users[userOrId.id] || userOrId
          : undefined;

    if (!u || !u.googleId || !u.email) return false;
    return allowedEmails.includes(u.email.trim().toLowerCase());
  }

  private buildFriendProfilesMap(user: UserProfile): Record<string, FriendProfileSummary> {
    const map: Record<string, FriendProfileSummary> = {};
    const isAdmin = this.isUserAdmin(user);
    const ids = new Set<string>(
      isAdmin
        ? Object.keys(this.db.users).filter((uid) => uid !== user.id)
        : [
            ...(user.friends || []),
            ...(user.pendingIncomingFriends || []),
            ...(user.pendingOutgoingFriends || []),
          ]
    );

    for (const id of ids) {
      const other = this.db.users[id];
      if (other) {
        map[id] = {
          userId: other.id,
          username: other.username,
          displayName: other.displayName,
          avatarBody: other.equipped?.avatar_body || 'body_human',
          isOnline: this.onlineUsers.has(other.id),
        };
      }
    }
    return map;
  }

  public withComputedAdminFlag(user: UserProfile): UserProfile {
    const isAdmin = this.isUserAdmin(user);
    if (isAdmin) {
      // Garante que o Administrador tenha todos os itens liberados por padrão para poder testar qualquer item
      let addedAny = false;
      for (const item of COSMETIC_CATALOG) {
        if (!user.inventory.includes(item.id)) {
          user.inventory.push(item.id);
          addedAny = true;
        }
      }
      if (addedAny) {
        this.saveDB();
      }
    }
    const friendProfiles = this.buildFriendProfilesMap(user);
    return {
      ...user,
      isAdmin,
      friendProfiles,
    };
  }

  public getUserById(userId: string): UserProfile | undefined {
    const u = this.db.users[userId];
    if (!u) return undefined;
    const isAdmin = this.isUserAdmin(u);
    u.isAdmin = isAdmin;
    if (isAdmin) {
      for (const item of COSMETIC_CATALOG) {
        if (!u.inventory.includes(item.id)) {
          u.inventory.push(item.id);
        }
      }
    }
    u.friendProfiles = this.buildFriendProfilesMap(u);
    return u;
  }

  public getUserByGoogleId(googleId: string): UserProfile | undefined {
    const clean = googleId.trim();
    return Object.values(this.db.users).find((u) => u.googleId === clean);
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

    const isAdmin = this.isUserAdmin(user);
    const safeEquipped: EquippedLoadout = { ...DEFAULT_EQUIPPED };
    (Object.keys(DEFAULT_EQUIPPED) as Array<keyof EquippedLoadout>).forEach((slot) => {
      const candidateId = user.equipped[slot];
      if (candidateId && (isAdmin || user.inventory.includes(candidateId))) {
        safeEquipped[slot] = candidateId;
      }
    });

    if (
      user.equipped.companion_pet &&
      (isAdmin || user.inventory.includes(user.equipped.companion_pet))
    ) {
      safeEquipped.companion_pet = user.equipped.companion_pet;
      safeEquipped.companion_pet_variant =
        user.petVariants?.[user.equipped.companion_pet] ||
        user.equipped.companion_pet_variant ||
        getPetBreedOption(user.equipped.companion_pet).id;
    } else {
      safeEquipped.companion_pet = '';
      safeEquipped.companion_pet_variant = '';
    }

    if (safeEquipped.avatar_body === 'body_fish') {
      safeEquipped.avatar_body_variant = getFishColorOption(
        user.fishVariant || user.equipped.avatar_body_variant
      ).id;
    } else {
      safeEquipped.avatar_body_variant = parseHumanVariant(
        user.humanVariant || user.equipped.avatar_body_variant
      ).variantId;
    }

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
   * (Se for o Administrador verificado no backend, permite testar qualquer item)
   */
  public verifyOwnership(userId: string, itemId: string): boolean {
    const user = this.db.users[userId];
    if (!user) return false;
    if (this.isUserAdmin(user)) return true;
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

  public cancelFriendshipRequest(
    userId: string,
    targetUserId: string
  ): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    const target = this.db.users[targetUserId];
    if (!user || !target) return { ok: false, message: 'Usuário não encontrado.' };

    user.pendingOutgoingFriends = (user.pendingOutgoingFriends || []).filter(
      (id) => id !== targetUserId
    );
    target.pendingIncomingFriends = (target.pendingIncomingFriends || []).filter(
      (id) => id !== userId
    );

    this.saveDB();
    return {
      ok: true,
      message: `Convite enviado para ${target.displayName} (@${target.username}) foi cancelado.`,
    };
  }

  public toggleFavoriteFriend(
    userId: string,
    friendUserId: string
  ): { ok: boolean; isFavorite: boolean; message: string } {
    const user = this.db.users[userId];
    const target = this.db.users[friendUserId];
    if (!user || !target || userId === friendUserId) {
      return { ok: false, isFavorite: false, message: 'Usuário não encontrado.' };
    }

    if (!user.favoriteFriends) user.favoriteFriends = [];
    const exists = user.favoriteFriends.includes(friendUserId);
    if (exists) {
      user.favoriteFriends = user.favoriteFriends.filter((id) => id !== friendUserId);
      this.saveDB();
      return {
        ok: true,
        isFavorite: false,
        message: `☆ ${target.displayName} removido dos Melhores Amigos.`,
      };
    } else {
      user.favoriteFriends.push(friendUserId);
      this.saveDB();
      return {
        ok: true,
        isFavorite: true,
        message: `⭐ ${target.displayName} fixado no topo como Melhor Amigo!`,
      };
    }
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

    if (cosmetic.category === 'companion_pet') {
      user.equipped.companion_pet = itemId;
      if (!user.petVariants) user.petVariants = {};
      const breedId = user.petVariants[itemId] || getPetBreedOption(itemId).id;
      user.petVariants[itemId] = breedId;
      user.equipped.companion_pet_variant = breedId;
    } else {
      user.equipped[cosmetic.category] = itemId;
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

    return { ok: true, message: `${cosmetic.icon} ${cosmetic.name} equipado com sucesso!` };
  }

  public unequipPet(userId: string): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    user.equipped.companion_pet = '';
    user.equipped.companion_pet_variant = '';
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

    return { ok: true, message: '🐾 Pet guardado na mochila para descansar!' };
  }

  public setPetVariant(
    userId: string,
    petId: string,
    variantId: string
  ): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    const cosmetic = getCosmeticById(petId);
    if (!cosmetic || cosmetic.category !== 'companion_pet') {
      return { ok: false, message: 'Pet inválido.' };
    }

    if (!this.verifyOwnership(userId, petId)) {
      return { ok: false, message: 'Compre este pet primeiro para escolher a raça!' };
    }

    const breeds = PET_BREED_OPTIONS[petId] || [];
    const chosenBreed = breeds.find((b) => b.id === variantId) || getPetBreedOption(petId);

    if (!user.petVariants) user.petVariants = {};
    user.petVariants[petId] = chosenBreed.id;

    // Também equipa o pet automaticamente com a raça escolhida
    user.equipped.companion_pet = petId;
    user.equipped.companion_pet_variant = chosenBreed.id;

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
      message: `${cosmetic.icon} Raça "${chosenBreed.name}" selecionada para ${cosmetic.name}!`,
    };
  }

  public setHumanVariant(
    userId: string,
    variantId: string
  ): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    const parsed = parseHumanVariant(variantId);
    user.humanVariant = parsed.variantId;
    user.equipped.avatar_body = 'body_human';
    user.equipped.avatar_body_variant = parsed.variantId;

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
      message: `🧑 Humano Cozy atualizado: Pele ${parsed.skin.name} • Roupa ${parsed.hoodie.name}!`,
    };
  }

  public setFishVariant(
    userId: string,
    variantId: string
  ): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    if (!this.verifyOwnership(userId, 'body_fish')) {
      return { ok: false, message: 'Adquira o Peixinho Tropical primeiro para escolher a cor!' };
    }

    const chosenFish = getFishColorOption(variantId);
    user.fishVariant = chosenFish.id;
    user.equipped.avatar_body = 'body_fish';
    user.equipped.avatar_body_variant = chosenFish.id;

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
      message: `🐠 Peixinho Tropical atualizado: Cor "${chosenFish.name}"!`,
    };
  }

  public buyItem(userId: string, itemId: string): { ok: boolean; message: string } {
    const user = this.db.users[userId];
    if (!user) return { ok: false, message: 'Usuário não encontrado.' };

    const item = getCosmeticById(itemId);
    if (!item) return { ok: false, message: 'Item não encontrado.' };

    if (user.inventory.includes(itemId)) {
      return { ok: false, message: 'Você já possui este item no seu inventário!' };
    }

    // BLOQUEIO ESTRITO NO SERVIDOR: itens exclusivos de pacotes em R$ (ex: Double D Pack) NUNCA podem ser comprados com moedas ou diamantes!
    if (item.realMoneyOnly) {
      return {
        ok: false,
        message:
          '👑 Este item é exclusivo do "Double D Pack" e só pode ser adquirido com dinheiro real na aba 💎 Pip Diamantes & VIP!',
      };
    }

    if (item.currency === 'COINS') {
      if (user.coins < item.price) {
        return { ok: false, message: `Moedas insuficientes! Precisa de ${item.price} 🪙.` };
      }
      user.coins -= item.price;
    } else {
      if (user.gems < item.price) {
        return {
          ok: false,
          message: `Pip Diamantes insuficientes! Precisa de ${item.price} 💎 (compre pacotes na aba 💎 Pip Diamantes).`,
        };
      }
      user.gems -= item.price;
    }

    user.inventory.push(itemId);
    if (item.category === 'furniture') {
      this.placeFurniture(userId, itemId);
    } else if (item.category === 'companion_pet') {
      user.equipped.companion_pet = itemId;
      if (!user.petVariants) user.petVariants = {};
      const breedId = user.petVariants[itemId] || getPetBreedOption(itemId).id;
      user.petVariants[itemId] = breedId;
      user.equipped.companion_pet_variant = breedId;
    } else {
      user.equipped[item.category] = itemId;
    }

    // Registra log de compra interna para auditoria no Painel do Administrador
    this.db.shopPurchaseLogs.unshift({
      id: `pur_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      itemId: item.id,
      itemName: item.name,
      itemIcon: item.icon,
      currency: item.currency,
      price: item.price,
      source: 'SHOP',
      createdAt: Date.now(),
    });
    if (this.db.shopPurchaseLogs.length > 500) {
      this.db.shopPurchaseLogs.length = 500;
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
    if (user.placedFurniture.some((f) => f.itemId === itemId)) {
      return {
        ok: false,
        message: `${item.icon} ${item.name} já está na sua sala! Você possui 1 unidade por móvel comprado.`,
      };
    }

    if (user.placedFurniture.length >= 10) {
      return {
        ok: false,
        message: 'Sua sala atingiu o limite de 10 móveis! Remova algum clicando com o botão direito.',
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
      colorVariant: 'default',
    });
    this.saveDB();
    return {
      ok: true,
      message: `${item.icon} ${item.name} colocado na sala! Arraste com o mouse ou clique com o botão direito para guardar.`,
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

  public setFurnitureColor(userId: string, instanceId: string, colorVariant: string): boolean {
    const user = this.db.users[userId];
    if (!user || !user.placedFurniture) return false;

    const target = user.placedFurniture.find((f) => f.instanceId === instanceId);
    if (!target) return false;

    target.colorVariant = String(colorVariant || 'default').slice(0, 20);
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
        message: `Você precisa de ${GACHAPON_COST_COINS} 🪙 Moedas para girar a Cápsula Surpresa!`,
      };
    }

    user.coins -= GACHAPON_COST_COINS;
    const pool = COSMETIC_CATALOG.filter((c) => c.inGachapon && !c.realMoneyOnly);
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

    this.db.shopPurchaseLogs.unshift({
      id: `pur_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      itemId: chosen.id,
      itemName: `${chosen.name}${isDuplicate ? ' (Repetido)' : ''}`,
      itemIcon: chosen.icon,
      currency: 'COINS',
      price: isDuplicate ? GACHAPON_COST_COINS - refundCoins : GACHAPON_COST_COINS,
      source: 'GACHAPON',
      createdAt: Date.now(),
    });
    if (this.db.shopPurchaseLogs.length > 500) {
      this.db.shopPurchaseLogs.length = 500;
    }

    this.saveDB();
    return {
      ok: true,
      message: isDuplicate
        ? `Tirou ${chosen.icon} ${chosen.name} (Repetido! +${refundCoins} 🪙 de reembolso)`
        : `🎉 CÁPSULA! Você ganhou ${chosen.icon} ${chosen.name}!`,
      item: chosen,
      isDuplicate,
      refundCoins,
    };
  }

  // ==========================================
  // TRANSAÇÕES DE DINHEIRO REAL (MERCADO PAGO) & PAINEL ADMIN
  // ==========================================
  public createPaymentTransaction(params: {
    userId: string;
    packageId: string;
    mpPaymentId?: string;
  }): PaymentTransactionRecord | null {
    const user = this.db.users[params.userId];
    const pkg = getRealMoneyPackageById(params.packageId);
    if (!user || !pkg) return null;

    const tx: PaymentTransactionRecord = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      mpPaymentId: params.mpPaymentId,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      packageId: pkg.id,
      packageName: pkg.name,
      amountBrl: pkg.priceBrl,
      status: 'PENDING',
      createdAt: Date.now(),
    };

    this.db.paymentTransactions.unshift(tx);
    if (this.db.paymentTransactions.length > 500) {
      this.db.paymentTransactions.length = 500;
    }
    this.saveDB();
    return tx;
  }

  public getPaymentTransactionById(txId: string): PaymentTransactionRecord | undefined {
    return this.db.paymentTransactions.find((t) => t.id === txId);
  }

  public findPaymentTransactionByMpId(mpPaymentId: string): PaymentTransactionRecord | undefined {
    return this.db.paymentTransactions.find((t) => t.mpPaymentId === String(mpPaymentId));
  }

  public setPaymentTransactionMpId(txId: string, mpPaymentId: string): void {
    const tx = this.getPaymentTransactionById(txId);
    if (tx) {
      tx.mpPaymentId = String(mpPaymentId);
      this.saveDB();
    }
  }

  public updatePaymentTransactionStatus(txId: string, status: PaymentStatus): void {
    const tx = this.getPaymentTransactionById(txId);
    if (tx && tx.status !== 'APPROVED') {
      tx.status = status;
      this.saveDB();
    }
  }

  /**
   * Credita de forma idempotente os Pip Diamantes ou o Double D Pack quando o pagamento
   * é confirmado pelo Mercado Pago.
   */
  public approvePaymentTransaction(
    txId: string,
    mpPaymentId?: string
  ): {
    ok: boolean;
    alreadyApproved?: boolean;
    tx?: PaymentTransactionRecord;
    user?: UserProfile;
    rewardSummary?: string;
  } {
    const tx = this.getPaymentTransactionById(txId);
    if (!tx) return { ok: false };

    if (mpPaymentId) {
      tx.mpPaymentId = String(mpPaymentId);
    }

    const user = this.db.users[tx.userId];
    if (!user) return { ok: false };

    if (tx.status === 'APPROVED') {
      return {
        ok: true,
        alreadyApproved: true,
        tx,
        user: this.withComputedAdminFlag(user),
      };
    }

    const pkg = getRealMoneyPackageById(tx.packageId);
    if (!pkg) return { ok: false };

    tx.status = 'APPROVED';
    tx.approvedAt = Date.now();

    let rewardSummary = '';

    if (pkg.type === 'GEMS_PACK' && pkg.gemsAmount) {
      user.gems = (user.gems || 0) + pkg.gemsAmount;
      tx.gemsCredited = pkg.gemsAmount;
      rewardSummary = `+${pkg.gemsAmount} Pip Diamantes 💎 creditados na sua conta!`;
    } else if (pkg.type === 'COINS_PACK' && pkg.coinsAmount) {
      user.coins = (user.coins || 0) + pkg.coinsAmount;
      tx.coinsCredited = pkg.coinsAmount;
      rewardSummary = `+${pkg.coinsAmount} Moedas 🪙 creditadas na sua conta!`;
    } else if (pkg.type === 'EXCLUSIVE_BUNDLE' && pkg.grantedItemIds) {
      const granted: string[] = [];
      for (const itemId of pkg.grantedItemIds) {
        if (!user.inventory.includes(itemId)) {
          user.inventory.push(itemId);
        }
        granted.push(itemId);

        const item = getCosmeticById(itemId);
        if (item) {
          if (item.category === 'furniture') {
            if (!user.placedFurniture) user.placedFurniture = [];
            if (!user.placedFurniture.some((f) => f.itemId === itemId)) {
              user.placedFurniture.push({
                instanceId: `furn_${Date.now()}_dj`,
                itemId,
                x: 196,
                flipped: false,
                colorVariant: 'default',
              });
            }
          } else {
            user.equipped[item.category] = itemId;
          }
        }
      }
      tx.itemsGranted = granted;
      const updatedLoadout = this.loadSessionCosmetics(user.id);
      const currentRoomHostId = this.userCurrentRoom.get(user.id);
      if (currentRoomHostId) {
        const room = this.rooms.get(currentRoomHostId);
        const playerState = room?.players.get(user.id);
        if (playerState) {
          playerState.equipped = updatedLoadout;
        }
      }
      rewardSummary =
        '👑 Double D Pack desbloqueado e equipado: Skin DJ Double D + Beco da Rapariga + Mesa de DJ!';
    }

    this.saveDB();
    return {
      ok: true,
      alreadyApproved: false,
      tx,
      user: this.withComputedAdminFlag(user),
      rewardSummary,
    };
  }

  /**
   * Cancela automaticamente transações PIX que ficaram como PENDING sem pagamento
   * após o tempo limite (padrão: 15 minutos).
   */
  public expireStalePendingTransactions(maxAgeMs = 15 * 60 * 1000): boolean {
    const txs = this.db.paymentTransactions || [];
    const now = Date.now();
    let changed = false;

    for (const t of txs) {
      if (t.status === 'PENDING' && now - (t.createdAt || 0) >= maxAgeMs) {
        t.status = 'CANCELLED';
        changed = true;
      }
    }

    if (changed) {
      this.saveDB();
    }
    return changed;
  }

  public getAdminDashboardData() {
    this.expireStalePendingTransactions();
    const txs = this.db.paymentTransactions || [];
    const logs = this.db.shopPurchaseLogs || [];

    let totalApprovedBrl = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    let totalGemsSold = 0;

    for (const t of txs) {
      if (t.status === 'APPROVED') {
        totalApprovedBrl += Number(t.amountBrl || 0);
        approvedCount++;
        totalGemsSold += Number(t.gemsCredited || 0);
      } else if (t.status === 'PENDING') {
        pendingCount++;
      }
    }

    return {
      summary: {
        totalApprovedBrl: Number(totalApprovedBrl.toFixed(2)),
        approvedCount,
        pendingCount,
        totalTransactions: txs.length,
        totalGemsSold,
        totalShopPurchases: logs.length,
        totalRegisteredUsers: Object.keys(this.db.users).length,
      },
      paymentTransactions: txs.slice(0, 200),
      shopPurchaseLogs: logs.slice(0, 200),
    };
  }

  public adminExecuteTestAction(
    adminUserId: string,
    action: 'UNLOCK_ALL' | 'ADD_COINS' | 'ADD_GEMS' | 'EQUIP_ITEM' | 'EQUIP_DOUBLE_D',
    itemId?: string
  ): { ok: boolean; message: string; user?: UserProfile } {
    const user = this.db.users[adminUserId];
    if (!user || !this.isUserAdmin(user)) {
      return { ok: false, message: '⛔ Acesso negado pelo servidor: apenas ADMIN_EMAIL autorizado.' };
    }

    if (action === 'UNLOCK_ALL') {
      for (const item of COSMETIC_CATALOG) {
        if (!user.inventory.includes(item.id)) {
          user.inventory.push(item.id);
        }
      }
      this.saveDB();
      return {
        ok: true,
        message: `🛡️ [Admin] Todos os ${COSMETIC_CATALOG.length} itens do catálogo (incluindo Double D Pack) foram liberados!`,
        user: this.withComputedAdminFlag(user),
      };
    }

    if (action === 'ADD_COINS') {
      user.coins = (user.coins || 0) + 1000;
      this.saveDB();
      return {
        ok: true,
        message: '🛡️ [Admin] +1.000 🪙 Moedas de teste adicionadas!',
        user: this.withComputedAdminFlag(user),
      };
    }

    if (action === 'ADD_GEMS') {
      user.gems = (user.gems || 0) + 500;
      this.saveDB();
      return {
        ok: true,
        message: '🛡️ [Admin] +500 💎 Pip Diamantes de teste adicionados!',
        user: this.withComputedAdminFlag(user),
      };
    }

    if (action === 'EQUIP_DOUBLE_D') {
      for (const id of ['body_dj_double_d', 'room_beco_rapariga', 'furn_dj_booth']) {
        if (!user.inventory.includes(id)) user.inventory.push(id);
      }
      user.equipped.avatar_body = 'body_dj_double_d';
      user.equipped.room_skin = 'room_beco_rapariga';
      if (!user.placedFurniture) user.placedFurniture = [];
      if (!user.placedFurniture.some((f) => f.itemId === 'furn_dj_booth')) {
        user.placedFurniture.push({
          instanceId: `furn_${Date.now()}_dj`,
          itemId: 'furn_dj_booth',
          x: 220,
          flipped: false,
          colorVariant: 'default',
        });
      }
      this.saveDB();
      const updatedLoadout = this.loadSessionCosmetics(user.id);
      const currentRoomHostId = this.userCurrentRoom.get(user.id);
      if (currentRoomHostId) {
        const room = this.rooms.get(currentRoomHostId);
        const playerState = room?.players.get(user.id);
        if (playerState) playerState.equipped = updatedLoadout;
      }
      return {
        ok: true,
        message: '💿 [Admin] Double D Pack (Skin DJ + Beco da Rapariga + Mesa de DJ) equipado para teste!',
        user: this.withComputedAdminFlag(user),
      };
    }

    if (action === 'EQUIP_ITEM' && itemId) {
      const item = getCosmeticById(itemId);
      if (!item) return { ok: false, message: 'Item não encontrado.' };
      if (!user.inventory.includes(item.id)) {
        user.inventory.push(item.id);
      }
      const res = this.equipItem(user.id, item.id);
      return {
        ok: res.ok,
        message: `🛡️ [Admin] ${res.message}`,
        user: this.withComputedAdminFlag(user),
      };
    }

    return { ok: false, message: 'Ação inválida.' };
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

    const currentHostRoom = this.userCurrentRoom.get(hostUserId);
    const isAwayVisiting = Boolean(currentHostRoom && currentHostRoom !== hostUserId);

    if (hostUser && !isAwayVisiting && !room.players.has(hostUserId)) {
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
        workStatus: hostUser.workStatus || '',
        idleActivity: activities[Math.floor(Math.random() * activities.length)],
        equipped: this.getVerifiedEquipped(hostUser.id),
        isBot: hostUser.id === BOT_USER_ID,
      });
      this.userCurrentRoom.set(hostUserId, hostUserId);
    } else if (isAwayVisiting && room.players.has(hostUserId)) {
      room.players.delete(hostUserId);
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
      const bonus = item.meta?.bonusCoins ?? 0;
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
    const currentHostRoom = this.userCurrentRoom.get(hostUserId);
    const hostAwayVisiting = Boolean(currentHostRoom && currentHostRoom !== hostUserId);
    const visitingTarget =
      hostAwayVisiting && currentHostRoom ? this.db.users[currentHostRoom] : undefined;

    const now = Date.now();
    for (const p of room.players.values()) {
      const uRef = this.db.users[p.userId];
      if (uRef) {
        p.workStatus = uRef.workStatus || '';
      }
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
      hostWorkStatus: hostUser?.workStatus || '',
      hostAwayVisiting,
      hostVisitingDisplayName: visitingTarget?.displayName,
      doorPermission: hostUser?.doorPermission || 'OPEN',
      roomSkinId: verifiedHostEquip.room_skin,
      placedFurniture: hostUser?.placedFurniture || [],
      players: hostAwayVisiting ? [] : Array.from(room.players.values()),
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
        workStatus: u.workStatus || '',
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
