export type HostStatus = 'IDLE' | 'ACTIVE' | 'DND';
export type DoorPermission = 'OPEN' | 'KNOCK';
export type IdleActivity = 'COFFEE' | 'TYPING' | 'SLEEPING' | 'FISHING' | 'READING';

export type CosmeticCategory =
  | 'avatar_body'
  | 'avatar_head'
  | 'avatar_back'
  | 'companion_pet'
  | 'spawn_fx'
  | 'chat_skin'
  | 'throwable'
  | 'room_skin'
  | 'desk_drop'
  | 'furniture';

export type CosmeticRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
export type CurrencyType = 'COINS' | 'GEMS';

export interface CosmeticItem {
  id: string;
  name: string;
  category: CosmeticCategory;
  rarity: CosmeticRarity;
  currency: CurrencyType;
  price: number;
  inGachapon: boolean;
  isStarter?: boolean;
  realMoneyOnly?: boolean; // Se true, SÓ pode ser obtido comprando o pacote em R$ (Mercado Pago)
  packId?: string; // ID do pacote em R$ ao qual este item pertence
  description: string;
  icon: string;
  previewColor: string;
  meta?: {
    blipFreq?: number;
    blipWave?: OscillatorType;
    speedBoostSec?: number;
    bonusCoins?: number;
    widthPx?: number;
  };
}

export interface RealMoneyPackage {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  icon: string;
  badgeText?: string;
  priceBrl: number; // Valor em Reais (ex: 0.01, 5.00, 15.00, 30.00, 24.90)
  type: 'GEMS_PACK' | 'COINS_PACK' | 'EXCLUSIVE_BUNDLE';
  gemsAmount?: number; // Quantidade total de Pip Diamantes entregues
  bonusGems?: number; // Bônus já incluso em gemsAmount (para exibição)
  coinsAmount?: number; // Quantidade total de Moedas entregues
  bonusCoins?: number; // Bônus já incluso em coinsAmount (para exibição)
  grantedItemIds?: string[]; // Itens exclusivos desbloqueados pelo pacote (ex: Double D Pack)
  isTestItem?: boolean;
}

export type PaymentStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface PaymentTransactionRecord {
  id: string;
  mpPaymentId?: string;
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  packageId: string;
  packageName: string;
  amountBrl: number;
  status: PaymentStatus;
  gemsCredited?: number;
  coinsCredited?: number;
  itemsGranted?: string[];
  createdAt: number;
  approvedAt?: number;
}

export interface ShopPurchaseLogRecord {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  itemId: string;
  itemName: string;
  itemIcon: string;
  currency: 'COINS' | 'GEMS';
  price: number;
  source: 'SHOP' | 'GACHAPON';
  createdAt: number;
}

export interface PlacedFurnitureItem {
  instanceId: string;
  itemId: string;
  x: number; // Posição no eixo X (24..336)
  flipped?: boolean;
  colorVariant?: string;
}

export interface EquippedLoadout {
  avatar_body: string;
  avatar_body_variant?: string; // Cor / tom escolhido gratuitamente para o Humano Cozy (ex: "peach:indigo")
  avatar_head: string;
  avatar_back: string;
  companion_pet?: string; // ID do Pet equipado (apenas 1 por vez, ou '' para nenhum)
  companion_pet_variant?: string; // Raça / variação escolhida para o Pet equipado
  spawn_fx: string;
  chat_skin: string;
  throwable: string;
  room_skin: string;
  desk_drop: string;
}

export type FriendshipStatus = 'PENDING' | 'ACCEPTED';

export interface FriendshipEdge {
  userId: string;
  username: string;
  displayName: string;
  status: FriendshipStatus;
  direction: 'INCOMING' | 'OUTGOING' | 'MUTUAL';
}

export interface FriendProfileSummary {
  userId: string;
  username: string;
  displayName: string;
  avatarBody: string;
  isOnline?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  googleId?: string;
  email?: string;
  googleName?: string;
  picture?: string;
  isAdmin?: boolean; // Calculado EXCLUSIVAMENTE no servidor comparando o email Google verificado com ADMIN_EMAIL
  coins: number;
  gems: number;
  inventory: string[]; // Array of owned item_ids (verified server-side)
  equipped: EquippedLoadout;
  humanVariant?: string; // Personalização gratuita de cor do Humano Cozy (ex: "peach:indigo")
  fishVariant?: string; // Cor escolhida para o Peixinho Tropical (ex: "tropical_blue", "clown_orange", etc.)
  petVariants?: Record<string, string>; // Raça escolhida por petId (ex: { pet_cat: 'siames', pet_dog: 'husky' })
  placedFurniture: PlacedFurnitureItem[]; // Móveis posicionados no cenário do usuário
  friends: string[]; // Array of ACCEPTED friend user_ids
  pendingIncomingFriends?: string[];
  pendingOutgoingFriends?: string[];
  friendProfiles?: Record<string, FriendProfileSummary>; // Metadados dos amigos e convites pendentes (mesmo offline)
  hostStatus: HostStatus;
  workStatus?: string; // Frase curta de status de trabalho (ex.: "Editando vídeo", "Em reunião até 15h")
  doorPermission: DoorPermission;
  createdAt: number;
}

export interface RoomPlayerState {
  userId: string;
  username: string;
  displayName: string;
  isHost: boolean;
  x: number;
  targetX: number;
  facing: 'left' | 'right';
  hostStatus: HostStatus;
  workStatus?: string;
  idleActivity: IdleActivity;
  equipped: EquippedLoadout; // Populated ONLY by the server from verified DB inventory
  spawnFx?: {
    fxId: string;
    startedAt: number;
  };
  chatBubble?: {
    id: string;
    text: string;
    skinId: string;
    expiresAt: number;
  };
  activeEmote?: {
    emote: string;
    expiresAt: number;
  };
  speedBoostUntil?: number;
  isBot?: boolean;
}

export interface DeskDropInstance {
  id: string;
  itemId: string;
  fromUserId: string;
  fromDisplayName: string;
  x: number;
  note?: string;
  createdAt: number;
}

export interface KnockRequest {
  id: string;
  visitorUserId: string;
  visitorUsername: string;
  visitorDisplayName: string;
  visitorEquipped: EquippedLoadout;
  targetHostId: string;
  expiresAt: number; // 30s timeout
}

export interface RoomSnapshot {
  roomId: string; // room:${hostUserId}
  hostUserId: string;
  hostUsername: string;
  hostDisplayName: string;
  hostStatus: HostStatus;
  hostWorkStatus?: string;
  hostAwayVisiting?: boolean; // True quando o dono da sala saiu para visitar outra pessoa ("Volto já")
  hostVisitingDisplayName?: string; // Nome de quem o dono da sala foi visitar
  doorPermission: DoorPermission;
  roomSkinId: string; // Verified from host's equipped.room_skin
  placedFurniture: PlacedFurnitureItem[]; // Móveis posicionados pelo Host
  players: RoomPlayerState[]; // Max 5 (1 Host + up to 4 Visitors)
  deskDrops: DeskDropInstance[];
  pendingKnocks: KnockRequest[];
  maxVisitors: number;
}

export interface OnlineDirectoryEntry {
  userId: string;
  username: string;
  displayName: string;
  hostStatus: HostStatus;
  workStatus?: string;
  doorPermission: DoorPermission;
  visitorCount: number;
  maxVisitors: number;
  currentRoomHostId: string;
  equipped: EquippedLoadout;
  isBot?: boolean;
}

// 5.2. Payload exato de Broadcast de chegada de visitante
export interface RoomUserJoinedPayload {
  userId: string;
  username: string;
  displayName: string;
  x: number;
  equippedCosmetics: {
    skin: string;
    spawnEffect: string;
    chatBubble: string;
    head: string;
    back: string;
    throwable: string;
    deskDrop: string;
  };
}

// ==========================================
// 5.1. Eventos Cliente -> Servidor (Inputs)
// ==========================================
export type InteractionActionType = 'POKE' | 'THROW_ITEM' | 'SYNC_EMOTE' | 'DESK_DROP' | 'ATTENTION';

export interface ClientToServerEvents {
  // 1. Solicitar visita a um amigo (ou voltar para a própria sala)
  'room:visit': (payload: { targetUserId: string; inviteBypass?: boolean }) => void;
  'room:leave_visit': () => void;

  // 6.5. Botão de Pânico ("Expulsar / Fechar Cortina") e Expulsar Visitante Individual
  'room:kick_all': () => void;
  'room:kick_visitor': (payload: { targetUserId: string }) => void;

  // Resposta do Host ao modo KNOCK
  'room:knock_respond': (payload: { knockId: string; accept: boolean }) => void;

  // Configurações da sala/estado do Host
  'host:set_status': (payload: { status: HostStatus; idleActivity?: IdleActivity }) => void;
  'host:set_work_status': (payload: { workStatus: string }) => void;
  'host:set_door': (payload: { doorPermission: DoorPermission }) => void;

  // 2. Mover avatar no eixo X (Throttled: máx 10 envios/seg, 0 <= targetX <= 360)
  'player:move': (payload: { targetX: number }) => void;
  'player:jump': () => void;

  // 3. Enviar mensagem de balão (máx 80 chars, 1 msg / 2s, strip HTML)
  'player:chat': (payload: { text: string }) => void;

  // 4. Interagir / Jogar objeto em outro jogador na mesma sala (1 ação / 3s)
  'player:interact': (payload: {
    targetUserId: string;
    actionType: InteractionActionType;
    itemId?: string;
    emote?: string;
    note?: string;
    dropX?: number;
  }) => void;

  // Coletar presente de mesa (AFK Gift) no chão
  'desk_drop:claim': (payload: { dropId: string }) => void;

  // Mobiliar Cenário (Posicionar, Mover, Virar, Cor e Remover Móveis na Sala)
  'furniture:place': (payload: { itemId: string; x?: number }) => void;
  'furniture:move': (payload: { instanceId: string; x: number }) => void;
  'furniture:flip': (payload: { instanceId: string }) => void;
  'furniture:color': (payload: { instanceId: string; colorVariant: string }) => void;
  'furniture:remove': (payload: { instanceId: string }) => void;

  // Economia & Inventário (Server-Side Inventory Verification)
  'inventory:equip': (payload: { itemId: string }) => void;
  'avatar:set_human_variant': (payload: { variantId: string }) => void;
  'avatar:set_fish_variant': (payload: { variantId: string }) => void;
  'pet:set_variant': (payload: { petId: string; variantId: string }) => void;
  'pet:unequip': () => void;
  'shop:buy': (payload: { itemId: string }) => void;
  'shop:gachapon': () => void;
  'economy:claim_starter_pack': () => void;
  'economy:claim_focus_reward': (payload: { focusMinutes: number }) => void;

  // Perfil (Alterar Nickname na Sala mantendo vínculo com a conta Google)
  'profile:update_nickname': (payload: { displayName: string }) => void;

  // 6.2. Grafo Social de Amizade (PENDING -> ACCEPTED)
  'friends:add': (payload: { usernameOrId: string }) => void;
  'friends:respond': (payload: { requesterUserId: string; accept: boolean }) => void;
  'friends:cancel': (payload: { targetUserId: string }) => void;
  'bot:summon_visit': () => void;
}

export interface ServerToClientEvents {
  'auth:profile': (profile: UserProfile) => void;
  'room:state': (snapshot: RoomSnapshot) => void;
  'directory:online': (entries: OnlineDirectoryEntry[]) => void;
  'room:user_joined': (payload: RoomUserJoinedPayload) => void;
  'friends:invite_alert': (payload: {
    kind: 'INCOMING' | 'SENT' | 'ACCEPTED' | 'REJECTED';
    fromUserId: string;
    fromUsername: string;
    fromDisplayName: string;
    fromAvatarBody: string;
    targetUserId: string;
    targetUsername: string;
    targetDisplayName: string;
    targetAvatarBody: string;
    pendingIncomingCount: number;
    pendingOutgoingCount: number;
  }) => void;

  'room:player_moved': (payload: { userId: string; targetX: number; facing: 'left' | 'right' }) => void;
  'room:player_jumped': (payload: { userId: string }) => void;
  'room:chat_message': (payload: {
    userId: string;
    displayName: string;
    text: string;
    skinId: string;
    expiresAt: number;
  }) => void;
  'room:interaction_fx': (payload: {
    fromUserId: string;
    fromDisplayName: string;
    targetUserId: string;
    actionType: InteractionActionType;
    verifiedItemId?: string;
    emote?: string;
    fromX: number;
    toX: number;
  }) => void;
  'room:knock_alert': (knock: KnockRequest) => void;
  'room:knock_result': (payload: {
    targetHostId: string;
    hostDisplayName: string;
    accepted: boolean;
    reason?: string;
  }) => void;
  'room:desk_drop_claimed': (payload: {
    dropId: string;
    itemId: string;
    claimedByUserId: string;
    fromDisplayName?: string;
    speedBoostSec?: number;
    bonusCoins?: number;
    note?: string;
  }) => void;
  'shop:gachapon_result': (payload: {
    item: CosmeticItem;
    isDuplicate: boolean;
    refundCoins: number;
  }) => void;
  'system:toast': (payload: {
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
  }) => void;
}
