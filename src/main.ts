import './style.css';
import { io, Socket } from 'socket.io-client';
import {
  COSMETIC_CATALOG,
  FURNITURE_COLOR_PALETTE,
  GACHAPON_COST_COINS,
  REAL_MONEY_PACKAGES,
  getCosmeticById,
} from './shared/catalog';
import {
  ClientToServerEvents,
  CosmeticCategory,
  CosmeticItem,
  DoorPermission,
  HostStatus,
  IdleActivity,
  KnockRequest,
  OnlineDirectoryEntry,
  PaymentTransactionRecord,
  PlacedFurnitureItem,
  RealMoneyPackage,
  RoomSnapshot,
  ServerToClientEvents,
  ShopPurchaseLogRecord,
  UserProfile,
} from './shared/types';
import { soundEngine } from './audio/soundEngine';
import { getApiBaseUrl, windowBridge } from './bridge/windowBridge';
import {
  PixelCanvasRenderer,
  getFurnitureInteraction,
  getLocalDayTimeInfo,
} from './renderer/PixelCanvas';

type ActiveModal = 'NONE' | 'SHOP' | 'FRIENDS' | 'BACKPACK' | 'PROFILE' | 'ADMIN' | 'FURN_EDIT';
type ShopTab = 'APARENCIA' | 'CANTINHO' | 'OUTROS' | 'DIAMANTES';
type ShopSubTab =
  | 'PIP'
  | 'CABECA'
  | 'COSTAS'
  | 'MOVEIS'
  | 'CENARIO'
  | 'BRINQUEDOS'
  | 'EFEITOS'
  | 'CHAT'
  | 'PRESENTES'
  | 'GACHA'
  | 'PACOTES_VIP'
  | 'DIAMANTES_PACKS'
  | 'MOEDAS_PACKS';
type FriendsTab = 'ONLINE' | 'MY_ROOM' | 'REQUESTS';
type BackpackTab = 'AVATAR' | 'FURNITURE' | 'FX';
type AdminTab = 'TRANSACTIONS' | 'PURCHASES' | 'TEST_ITEMS';

interface AuthSession {
  mode: 'google' | 'local';
  googleId?: string;
  email?: string;
  googleName?: string;
  picture?: string;
  username: string;
  displayName: string;
  sessionToken?: string;
}

interface ActivePixCheckout {
  txId: string;
  mpPaymentId: string;
  packageName: string;
  amountBrl: number;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl?: string;
  checking?: boolean;
}

interface AdminDashboardState {
  loading: boolean;
  error?: string;
  adminEmail?: string;
  summary?: {
    totalApprovedBrl: number;
    approvedCount: number;
    pendingCount: number;
    totalTransactions: number;
    totalGemsSold: number;
    totalShopPurchases: number;
    totalRegisteredUsers: number;
  };
  paymentTransactions: PaymentTransactionRecord[];
  shopPurchaseLogs: ShopPurchaseLogRecord[];
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              shape?: 'rectangular' | 'pill';
              text?: 'signin_with' | 'signup_with' | 'continue_with';
              width?: number;
            }
          ) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

const AUTH_SESSION_KEY = 'pc_auth_session';

class PocketCornerApp {
  private socket!: Socket<ServerToClientEvents, ClientToServerEvents>;
  private renderer!: PixelCanvasRenderer;

  private profile: UserProfile | null = null;
  private room: RoomSnapshot | null = null;
  private directory: OnlineDirectoryEntry[] = [];

  private authSession: AuthSession | null = null;
  private googleClientId = (
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID || ''
  ).trim();
  private mongoConnected = false;
  private mercadoPagoConfigured = false;

  private activeModal: ActiveModal = 'NONE';
  private shopTab: ShopTab = 'APARENCIA';
  private shopSubTab: ShopSubTab = 'PIP';
  private friendsTab: FriendsTab = 'ONLINE';
  private backpackTab: BackpackTab = 'AVATAR';
  private adminTab: AdminTab = 'TRANSACTIONS';

  private activePixCheckout: ActivePixCheckout | null = null;
  private pixCreatingPackageId: string | null = null;
  private pixPollTimer: number | null = null;

  private adminDashboard: AdminDashboardState = {
    loading: false,
    paymentTransactions: [],
    shopPurchaseLogs: [],
  };

  private selectedTargetUserId: string | null = null;
  private editingFurnitureInstanceId: string | null = null;
  private manualActionSelected = false;
  private isInFurnitureOrWanderActivity = false;
  private lastManualInputAt = Date.now();
  private nextAutonomousWanderAt = Date.now() + 20_000;
  private wanderArrivalTimer: number | null = null;
  private autoIdleOnBlur = true;
  private previewAnimId = 0;
  private pendingVisitParam: string | null = null;

  // DOM references
  private topbarEl!: HTMLElement;
  private stageWidgetEl!: HTMLElement;
  private stagePlaceholderEl!: HTMLElement;
  private knockBannerContainerEl!: HTMLElement;
  private hoverTooltipEl!: HTMLElement;
  private floatingDockEl!: HTMLElement;
  private toastStackEl!: HTMLElement;
  private modalRootEl!: HTMLElement;
  private loginScreenRootEl!: HTMLElement;

  constructor() {
    this.initDOM();
    this.setupKeyboardAndFocusListeners();
    void this.bootstrapAuth();
  }

  private async bootstrapAuth() {
    const params = new URLSearchParams(window.location.search);
    const urlVisit = params.get('visit');
    if (urlVisit) {
      this.pendingVisitParam = urlVisit;
    }

    const saved = this.loadSavedSession();
    if (saved) {
      this.authSession = saved;
      this.hideLoginScreen();
      this.connectSocket();
    } else {
      // Exibe a tela de login IMEDIATAMENTE (0ms) sem esperar requisição de rede
      this.renderLoginScreen(!this.googleClientId);
    }

    // Busca configuração de OAuth e status do MongoDB do backend com timeout curto
    try {
      const baseUrl = getApiBaseUrl();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${baseUrl}/api/auth/config`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const cfg = (await res.json()) as {
          googleClientId?: string;
          mongoConnected?: boolean;
          mercadoPagoConfigured?: boolean;
        };
        if (cfg.googleClientId) {
          this.googleClientId = cfg.googleClientId.trim();
        }
        this.mongoConnected = Boolean(cfg.mongoConnected);
        this.mercadoPagoConfigured = Boolean(cfg.mercadoPagoConfigured);
      }
    } catch {
      // Ignora erro de rede inicial
    }

    if (!this.authSession) {
      this.renderLoginScreen(false);
    }
  }

  private loadSavedSession(): AuthSession | null {
    try {
      const raw = localStorage.getItem(AUTH_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<AuthSession>;
      if (parsed && parsed.mode === 'google' && parsed.googleId) {
        return {
          mode: 'google',
          googleId: parsed.googleId,
          email: parsed.email,
          googleName: parsed.googleName,
          picture: parsed.picture,
          username: parsed.username || 'jogador',
          displayName: parsed.displayName || parsed.googleName || parsed.username || 'Jogador',
          sessionToken: parsed.sessionToken,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authSession?.sessionToken) {
      headers.Authorization = `Bearer ${this.authSession.sessionToken}`;
    }
    if (this.profile?.id) {
      headers['x-user-id'] = this.profile.id;
    }
    if (this.profile?.googleId || this.authSession?.googleId) {
      headers['x-google-id'] = (this.profile?.googleId || this.authSession?.googleId || '').trim();
    }
    return headers;
  }

  private saveAuthSession(session: AuthSession) {
    this.authSession = session;
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
    localStorage.setItem('pc_username', session.username);
    localStorage.setItem('pc_displayName', session.displayName);
    sessionStorage.setItem('pc_username', session.username);
    sessionStorage.setItem('pc_displayName', session.displayName);
  }

  private logoutAccount() {
    this.authSession = null;
    this.profile = null;
    localStorage.removeItem(AUTH_SESSION_KEY);
    localStorage.removeItem('pc_username');
    localStorage.removeItem('pc_displayName');
    sessionStorage.removeItem('pc_username');
    sessionStorage.removeItem('pc_displayName');

    try {
      window.google?.accounts?.id?.disableAutoSelect();
    } catch {
      // Ignore
    }

    if (this.socket) {
      this.socket.disconnect();
    }
    this.closeModal();
    this.renderLoginScreen(false);
    this.showToast('info', '🚪 Você saiu da sua conta.');
  }

  private hideLoginScreen() {
    if (this.loginScreenRootEl) {
      this.loginScreenRootEl.innerHTML = '';
    }
  }

  private renderLoginScreen(isLoadingConfig = false) {
    const isSecretInsteadOfId = this.googleClientId.startsWith('GOCSPX-');
    const hasValidClientId = Boolean(this.googleClientId) && !isSecretInsteadOfId;

    this.loginScreenRootEl.innerHTML = `
      <div class="login-screen-overlay">
        <div class="login-card">
          <div class="login-logo-badge">🐾</div>
          <div>
            <div class="login-title">Pocket Corner</div>
            <div class="login-subtitle" style="margin-top: 6px;">
              Realize login com sua conta Google para entrar no seu cantinho.<br/>
              Seus personagens, moedas e móveis ficam salvos na sua conta.
            </div>
          </div>

          ${
            hasValidClientId
              ? `<div class="google-btn-container" id="google-btn-mount"></div>`
              : isLoadingConfig
                ? `<div class="google-btn-container" style="font-size: 0.78rem; color: var(--text-secondary);">
                    ⏳ Carregando login do Google...
                  </div>`
                : isSecretInsteadOfId
                  ? `<div class="login-env-notice">
                      ⚠️ <b>Atenção na variável de ambiente:</b><br/>
                      Você colou a <b>Chave Secreta</b> (que começa com <code>GOCSPX-...</code>) no lugar do <b>ID do Cliente</b>.<br/><br/>
                      Copie o <b>ID do cliente</b> (que começa com <code>614958022711-...</code> e termina com <code>.apps.googleusercontent.com</code>) e cole em <code>GOOGLE_CLIENT_ID</code> e <code>VITE_GOOGLE_CLIENT_ID</code>!
                    </div>`
                  : `<div class="login-env-notice">
                      🔑 <b>Google OAuth aguardando chave:</b><br/>
                      Configure a variável <code>GOOGLE_CLIENT_ID</code> no painel do servidor (Environment no Render ou arquivo <code>.env</code>) para ativar o botão do Google.
                    </div>`
          }
        </div>
      </div>
    `;

    if (hasValidClientId) {
      this.mountGoogleSignInButton();
    }
  }

  private mountGoogleSignInButton(attempt = 0) {
    const mountEl = document.getElementById('google-btn-mount');
    if (!mountEl) return;

    const gId = window.google?.accounts?.id;
    if (!gId) {
      if (attempt < 20) {
        setTimeout(() => this.mountGoogleSignInButton(attempt + 1), 250);
      } else {
        mountEl.innerHTML = `<div style="font-size:0.75rem; color: var(--text-secondary);">Não foi possível carregar o script do Google. Verifique sua conexão.</div>`;
      }
      return;
    }

    gId.initialize({
      client_id: this.googleClientId,
      callback: (resp) => {
        if (resp.credential) {
          void this.handleGoogleCredential(resp.credential);
        }
      },
    });

    gId.renderButton(mountEl, {
      theme: 'filled_blue',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: 300,
    });
  }

  private async handleGoogleCredential(credential: string) {
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        profile?: UserProfile;
        sessionToken?: string;
        error?: string;
      };
      if (!res.ok || !data.profile) {
        this.showToast('error', data.error || 'Falha ao autenticar com o Google.');
        return;
      }

      const p = data.profile;
      this.saveAuthSession({
        mode: 'google',
        googleId: p.googleId,
        email: p.email,
        googleName: p.googleName || p.displayName,
        picture: p.picture,
        username: p.username,
        displayName: p.displayName,
        sessionToken: data.sessionToken,
      });

      this.hideLoginScreen();
      this.connectSocket();
      this.showToast('success', `✨ Conectado como ${p.displayName}!`);
    } catch (err) {
      this.showToast('error', `Erro ao conectar com servidor: ${(err as Error).message}`);
    }
  }

  private initDOM() {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="minimal-shell">
        <!-- Barra Superior Discreta -->
        <header class="minimal-topbar" id="minimal-topbar"></header>

        <!-- Apenas a Tela do Cantinho -->
        <div class="stage-placeholder" id="stage-placeholder">
          <div class="pip-active-notice">
            <div style="font-size: 1.8rem;">📺</div>
            <div style="font-weight: 700; color: var(--text-primary);">
              Seu Cantinho está flutuando em modo Picture-in-Picture!
            </div>
            <button class="btn btn-primary" id="btn-restore-pip">
              Voltar para a tela principal
            </button>
          </div>

          <div class="pocket-stage-widget" id="pocket-stage-widget">
            <div class="canvas-viewport">
              <canvas id="pocket-canvas" width="360" height="180"></canvas>
              <div id="knock-banner-container"></div>
              <div class="canvas-hover-tooltip" id="canvas-hover-tooltip" style="display: none;"></div>
            </div>

            <!-- Barra minimalista integrada abaixo da tela -->
            <div class="stage-bar" id="stage-bar">
              <input
                type="text"
                id="chat-input"
                class="chat-input-minimal"
                maxlength="80"
                placeholder="💬 Escreva algo para falar... (Enter)"
              />
              <div class="quick-actions-group">
                <!-- Botão com Mini Menu Flutuante ao passar o mouse (Ações do Pip) -->
                <div class="action-hover-menu-wrap" id="action-hover-menu-wrap">
                  <button class="btn btn-icon" id="btn-quick-actions" title="Ações do Pip (Passe o mouse para escolher: Café, Pescar, Computador e mais)">
                    🎭
                  </button>
                  <div class="action-hover-dropdown" id="action-hover-dropdown">
                    <div class="action-hover-title">🎬 Ações do Pip</div>
                    <button class="action-hover-item" data-pip-action="COFFEE">
                      <span>☕</span>
                      <span>Andar com Café</span>
                    </button>
                    <button class="action-hover-item" data-pip-action="FISHING">
                      <span>🎣</span>
                      <span>Pescar</span>
                    </button>
                    <button class="action-hover-item" data-pip-action="TYPING">
                      <span>💻</span>
                      <span>Andar com Computador</span>
                    </button>
                    <button class="action-hover-item" data-pip-action="READING">
                      <span>📖</span>
                      <span>Andar com Livro</span>
                    </button>
                    <button class="action-hover-item" data-pip-action="SLEEPING">
                      <span>💤</span>
                      <span>Cochilar (Zzz)</span>
                    </button>
                    <div class="action-hover-divider"></div>
                    <button class="action-hover-item active" data-pip-action="ACTIVE">
                      <span>🚶</span>
                      <span>Livre (Sem Ação)</span>
                    </button>
                    <button class="action-hover-item" data-pip-action="DND">
                      <span>🔒</span>
                      <span>Não Perturbe (DND)</span>
                    </button>
                  </div>
                </div>
                <button class="btn btn-icon" id="btn-quick-poke" title="Cutucar amigo (Poke)">👆</button>
                <button class="btn btn-icon" id="btn-quick-throw" title="Jogar brinquedo">✈️</button>
                <button class="btn btn-icon" id="btn-quick-gift" title="Deixar presente no chão">☕</button>
                <button class="btn btn-icon" id="btn-quick-zoom" title="Alternar Zoom da câmera (ou use a roda do mouse no cenário)">🔍</button>
                <button class="btn btn-icon" id="btn-quick-video-pip" title="Destacar em Picture-in-Picture Sem Barra de Título">📺</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Dock Flutuante Minimalista: Apenas Loja, Amigos e Mochila -->
        <nav class="floating-dock" id="floating-dock"></nav>
      </div>

      <div class="toast-stack" id="toast-stack"></div>
      <div id="modal-root"></div>
      <div id="login-screen-root"></div>
    `;

    this.topbarEl = document.getElementById('minimal-topbar')!;
    this.stageWidgetEl = document.getElementById('pocket-stage-widget')!;
    this.stagePlaceholderEl = document.getElementById('stage-placeholder')!;
    this.knockBannerContainerEl = document.getElementById('knock-banner-container')!;
    this.hoverTooltipEl = document.getElementById('canvas-hover-tooltip')!;
    this.floatingDockEl = document.getElementById('floating-dock')!;
    this.toastStackEl = document.getElementById('toast-stack')!;
    this.modalRootEl = document.getElementById('modal-root')!;
    this.loginScreenRootEl = document.getElementById('login-screen-root')!;

    const canvas = document.getElementById('pocket-canvas') as HTMLCanvasElement;
    this.renderer = new PixelCanvasRenderer(canvas, {
      onMoveRequest: (targetX) => {
        this.recordManualInput();
        this.socket.emit('player:move', { targetX });
      },
      onJumpRequest: () => {
        this.recordManualInput();
        this.socket.emit('player:jump');
      },
      onSelectPlayer: (userId) => {
        this.selectedTargetUserId = userId;
      },
      onPokePlayer: (userId) => {
        this.recordManualInput();
        this.socket.emit('player:interact', {
          targetUserId: userId,
          actionType: 'POKE',
        });
      },
      onClaimDrop: (dropId) => {
        this.recordManualInput();
        this.socket.emit('desk_drop:claim', { dropId });
      },
      onKickVisitor: (userId) => {
        this.socket.emit('room:kick_visitor', { targetUserId: userId });
      },
      onMoveFurniture: (instanceId, x) => {
        this.recordManualInput();
        this.socket.emit('furniture:move', { instanceId, x });
      },
      onFlipFurniture: (instanceId) => {
        this.recordManualInput();
        this.socket.emit('furniture:flip', { instanceId });
      },
      onRemoveFurniture: (instanceId) => {
        this.recordManualInput();
        this.socket.emit('furniture:remove', { instanceId });
      },
      onEditFurniture: (instanceId) => {
        this.recordManualInput();
        this.editingFurnitureInstanceId = instanceId;
        this.openModal('FURN_EDIT');
      },
      onInteractFurniture: (furn) => {
        this.interactWithFurniture(furn);
      },
      onInteractWindow: () => {
        this.interactWithWindow();
      },
      onHoverStateChange: (label) => {
        if (label) {
          this.hoverTooltipEl.textContent = label;
          this.hoverTooltipEl.style.display = 'block';
        } else {
          this.hoverTooltipEl.style.display = 'none';
        }
      },
    });

    const chatInput = document.getElementById('chat-input') as HTMLInputElement;
    const sendChat = () => {
      const text = chatInput.value.trim().slice(0, 80);
      if (!text) return;
      this.recordManualInput();
      this.socket.emit('player:chat', { text });
      chatInput.value = '';
    };

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChat();
      }
    });

    document.querySelectorAll('[data-pip-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.recordManualInput();
        const act = (btn as HTMLElement).dataset.pipAction!;
        if (act === 'ACTIVE') {
          this.manualActionSelected = false;
          this.isInFurnitureOrWanderActivity = false;
          this.socket.emit('host:set_status', { status: 'ACTIVE' });
        } else if (act === 'DND') {
          this.manualActionSelected = false;
          this.isInFurnitureOrWanderActivity = false;
          this.socket.emit('host:set_status', { status: 'DND' });
        } else {
          this.manualActionSelected = true;
          this.isInFurnitureOrWanderActivity = false;
          this.socket.emit('host:set_status', {
            status: 'IDLE',
            idleActivity: act as IdleActivity,
          });
        }
      });
    });

    document.getElementById('btn-quick-poke')!.addEventListener('click', () => {
      this.socket.emit('player:interact', {
        targetUserId: this.getEffectiveTargetUserId(),
        actionType: 'POKE',
      });
    });

    document.getElementById('btn-quick-throw')!.addEventListener('click', () => {
      this.socket.emit('player:interact', {
        targetUserId: this.getEffectiveTargetUserId(),
        actionType: 'THROW_ITEM',
      });
    });

    document.getElementById('btn-quick-gift')!.addEventListener('click', () => {
      const hostId = this.room?.hostUserId || this.profile?.id || '';
      this.socket.emit('player:interact', {
        targetUserId: hostId,
        actionType: 'DESK_DROP',
      });
    });

    document.getElementById('btn-quick-zoom')!.addEventListener('click', () => {
      const nextZoom = this.renderer.cycleZoom();
      this.showToast('info', `🔍 Zoom da câmera: ${nextZoom}x`);
    });

    document.getElementById('btn-quick-video-pip')!.addEventListener('click', async () => {
      try {
        await windowBridge.toggleBorderlessVideoPiP(canvas);
      } catch (err) {
        this.showToast('warning', (err as Error).message);
      }
    });

    document.getElementById('btn-restore-pip')!.addEventListener('click', () => {
      windowBridge.togglePictureInPicture(this.stageWidgetEl, this.stagePlaceholderEl);
    });

    windowBridge.onModeChange(() => {
      this.renderTopbar();
    });

    this.renderFloatingDock();
  }

  private updateQuickActionsMenuState() {
    const me = this.room?.players.find((p) => p.userId === this.profile?.id);
    const status = me?.hostStatus || this.profile?.hostStatus || 'ACTIVE';
    const idleAct = me?.idleActivity || 'COFFEE';
    const currentKey = status === 'IDLE' ? idleAct : status;

    const iconMap: Record<string, string> = {
      COFFEE: '☕',
      FISHING: '🎣',
      TYPING: '💻',
      READING: '📖',
      SLEEPING: '💤',
      DND: '🔒',
      ACTIVE: '🎭',
    };

    const btnEl = document.getElementById('btn-quick-actions');
    if (btnEl) {
      btnEl.textContent = iconMap[currentKey] || '🎭';
    }

    document.querySelectorAll('[data-pip-action]').forEach((itemEl) => {
      const el = itemEl as HTMLElement;
      el.classList.toggle('active', el.dataset.pipAction === currentKey);
    });
  }

  private getEffectiveTargetUserId(): string {
    if (
      this.selectedTargetUserId &&
      this.room?.players.some((p) => p.userId === this.selectedTargetUserId)
    ) {
      return this.selectedTargetUserId;
    }
    const other = this.room?.players.find((p) => p.userId !== this.profile?.id);
    return other?.userId || this.profile?.id || '';
  }

  private connectSocket() {
    const session = this.authSession || {
      mode: 'local',
      username: 'visitante',
      displayName: 'Visitante',
    };

    if (this.socket) {
      this.socket.disconnect();
    }

    const baseUrl = getApiBaseUrl();
    const socketOpts = {
      auth: {
        googleId: session.googleId || '',
        email: session.email || '',
        googleName: session.googleName || '',
        picture: session.picture || '',
        username: session.username,
        displayName: session.displayName,
      },
    };
    this.socket = baseUrl ? io(baseUrl, socketOpts) : io(socketOpts);

    this.socket.on('auth:profile', (profile) => {
      const prev = this.profile;
      const structuralChange =
        !prev ||
        prev.isAdmin !== profile.isAdmin ||
        prev.displayName !== profile.displayName ||
        prev.username !== profile.username ||
        prev.hostStatus !== profile.hostStatus ||
        prev.doorPermission !== profile.doorPermission ||
        prev.inventory.length !== profile.inventory.length ||
        JSON.stringify(prev.equipped) !== JSON.stringify(profile.equipped) ||
        JSON.stringify(prev.placedFurniture) !== JSON.stringify(profile.placedFurniture) ||
        JSON.stringify(prev.friends) !== JSON.stringify(profile.friends) ||
        JSON.stringify(prev.pendingIncomingFriends) !==
          JSON.stringify(profile.pendingIncomingFriends);

      this.profile = profile;
      if (this.authSession) {
        this.saveAuthSession({
          ...this.authSession,
          googleId: profile.googleId || this.authSession.googleId,
          email: profile.email || this.authSession.email,
          googleName: profile.googleName || this.authSession.googleName,
          picture: profile.picture || this.authSession.picture,
          username: profile.username,
          displayName: profile.displayName,
        });
      }
      this.renderer.setIdentity(profile.id);
      this.renderTopbar();
      this.renderFloatingDock();
      this.updateQuickActionsMenuState();

      // Atualiza saldo na Loja sem piscar/recriar o popup quando for apenas tick passivo de moedas
      const shopCoinsEl = document.getElementById('shop-coins-pill');
      const shopGemsEl = document.getElementById('shop-gems-pill');
      if (shopCoinsEl) shopCoinsEl.textContent = `🪙 ${profile.coins} +`;
      if (shopGemsEl) shopGemsEl.textContent = `💎 ${profile.gems} +`;

      if (this.activeModal !== 'NONE' && structuralChange) {
        this.renderActiveModal();
      }

      if (this.pendingVisitParam) {
        const target = this.pendingVisitParam;
        this.pendingVisitParam = null;
        if (target.toLowerCase() !== profile.username.toLowerCase()) {
          setTimeout(() => {
            this.socket.emit('room:visit', { targetUserId: target, inviteBypass: true });
          }, 400);
        }
      }
    });

    this.socket.on('room:state', (snapshot) => {
      const prevFurnJson = JSON.stringify(this.room?.placedFurniture || []);
      const nextFurnJson = JSON.stringify(snapshot.placedFurniture || []);
      const prevPlayersLen = this.room?.players.length ?? -1;
      const nextPlayersLen = snapshot.players.length;

      this.room = snapshot;
      this.renderer.updateRoom(snapshot);
      this.renderTopbar();
      this.renderKnockBanner();
      this.renderFloatingDock();
      this.updateQuickActionsMenuState();

      if (this.activeModal === 'FRIENDS' && prevPlayersLen !== nextPlayersLen) {
        this.renderActiveModal();
      } else if (
        (this.activeModal === 'SHOP' || this.activeModal === 'BACKPACK') &&
        prevFurnJson !== nextFurnJson
      ) {
        this.renderActiveModal();
      }
    });

    this.socket.on('room:user_joined', (payload) => {
      soundEngine.playSpawn(payload.equippedCosmetics.spawnEffect);
      this.renderer.spawnBurst(
        payload.x,
        PixelCanvasRenderer.FLOOR_Y - 18,
        '#38bdf8',
        18
      );
    });

    this.socket.on('directory:online', (entries) => {
      this.directory = entries;
      this.renderFloatingDock();
      if (this.activeModal === 'FRIENDS') {
        this.renderActiveModal();
      }
    });

    this.socket.on('room:player_moved', ({ userId, targetX, facing }) => {
      this.renderer.onPlayerMoved(userId, targetX, facing);
    });

    this.socket.on('room:player_jumped', ({ userId }) => {
      this.renderer.triggerJump(userId);
    });

    this.socket.on('room:chat_message', ({ skinId, text }) => {
      soundEngine.playChatBlip(skinId, text.length);
    });

    this.socket.on('room:interaction_fx', (payload) => {
      this.renderer.triggerInteractionFx(payload);
    });

    this.socket.on('room:knock_alert', (knock) => {
      soundEngine.playDoorbell();
      this.showToast(
        'warning',
        `🔔 ${knock.visitorDisplayName} bateu na porta da sua sala!`
      );
      this.renderKnockBanner();
    });

    this.socket.on('room:knock_result', ({ hostDisplayName, accepted, reason }) => {
      if (accepted) {
        this.showToast('success', `🚪 ${hostDisplayName} abriu a porta!`);
      } else {
        this.showToast('warning', `🚪 ${hostDisplayName}: ${reason || 'Recusado'}`);
      }
    });

    this.socket.on('room:desk_drop_claimed', ({ itemId }) => {
      soundEngine.playClaimGift(itemId);
    });

    this.socket.on('shop:gachapon_result', ({ item, isDuplicate, refundCoins }) => {
      soundEngine.playGachapon();
      this.showToast(
        'success',
        isDuplicate
          ? `🎰 ${item.icon} ${item.name} (Repetido! +${refundCoins} 🪙)`
          : `🎰 Você ganhou ${item.icon} ${item.name} (${item.rarity})!`
      );
      if (this.activeModal !== 'NONE') {
        this.renderActiveModal();
      }
    });

    this.socket.on('system:toast', ({ type, message }) => {
      this.showToast(type, message);
    });
  }

  private recordManualInput() {
    this.lastManualInputAt = Date.now();
    this.nextAutonomousWanderAt =
      Date.now() + 20_000 + Math.floor(Math.random() * 12_000);
    if (this.wanderArrivalTimer) {
      window.clearTimeout(this.wanderArrivalTimer);
      this.wanderArrivalTimer = null;
    }
  }

  private interactWithFurniture(furn: PlacedFurnitureItem) {
    const inter = getFurnitureInteraction(furn.itemId);
    this.walkToPointOfInterest(furn.x, inter.activity, inter.thoughtBubble, true);
  }

  private interactWithWindow() {
    const dayInfo = getLocalDayTimeInfo();
    const skinId = this.room?.roomSkinId || 'room_cozy_desk';
    const winX = skinId === 'room_office' ? 75 : 66;
    this.walkToPointOfInterest(winX, 'COFFEE', dayInfo.windowThought, true);
  }

  private walkToPointOfInterest(
    targetX: number,
    activity: IdleActivity,
    thoughtBubble: string,
    isManualClick = false
  ) {
    if (!this.room || !this.profile) return;
    const me = this.room.players.find((p) => p.userId === this.profile?.id);
    if (!me) return;

    if (isManualClick) {
      this.lastManualInputAt = Date.now();
      this.nextAutonomousWanderAt =
        Date.now() + 24_000 + Math.floor(Math.random() * 14_000);
    }

    if (this.wanderArrivalTimer) {
      window.clearTimeout(this.wanderArrivalTimer);
      this.wanderArrivalTimer = null;
    }

    const clampedX = Math.max(26, Math.min(334, Math.round(targetX)));
    const dist = Math.abs(clampedX - me.x);
    if (dist >= 2) {
      me.facing = clampedX < me.x ? 'left' : 'right';
      me.targetX = clampedX;
      me.x = clampedX;
      this.socket.emit('player:move', { targetX: clampedX });
    }

    const travelMs = Math.min(2200, Math.max(240, Math.round(dist * 7.5)));
    this.wanderArrivalTimer = window.setTimeout(() => {
      this.wanderArrivalTimer = null;
      if (!this.profile || this.profile.hostStatus === 'DND') return;

      this.isInFurnitureOrWanderActivity = true;
      // Se o usuário clicou manualmente no móvel/janela OU não travou uma ação manual fixa, troca a ação do Pip automaticamente!
      if (isManualClick || !this.manualActionSelected) {
        if (isManualClick) {
          this.manualActionSelected = false;
        }
        this.socket.emit('host:set_status', {
          status: 'IDLE',
          idleActivity: activity,
        });
      }
      this.renderer.showAmbientThought(this.profile.id, thoughtBubble, 4800);
    }, travelMs);
  }

  private triggerAutonomousWanderIfIdle() {
    const now = Date.now();
    if (now < this.nextAutonomousWanderAt) return;
    if (now - this.lastManualInputAt < 18_000) return;

    // Agenda o próximo passeio autônomo entre 20s e 36s
    this.nextAutonomousWanderAt = now + 20_000 + Math.floor(Math.random() * 16_000);

    if (!this.room || !this.profile) return;
    if (this.profile.hostStatus === 'DND') return;
    if (this.activeModal === 'FURN_EDIT') return;

    const me = this.room.players.find((p) => p.userId === this.profile?.id);
    if (!me) return;

    interface CandidatePoi {
      x: number;
      activity: IdleActivity;
      thought: string;
      weight: number;
    }

    const candidates: CandidatePoi[] = [];
    const dayInfo = getLocalDayTimeInfo();
    const skinId = this.room.roomSkinId || 'room_cozy_desk';

    // 1. Móveis posicionados na sala atual (maior prioridade para o Pip usar a mobília!)
    if (this.room.placedFurniture && this.room.placedFurniture.length > 0) {
      for (const furn of this.room.placedFurniture) {
        const inter = getFurnitureInteraction(furn.itemId);
        candidates.push({
          x: furn.x,
          activity: inter.activity,
          thought: inter.thoughtBubble,
          weight: 4,
        });
      }
    }

    // 2. Pontos de interesse nativos do cenário (Janela com ciclo dia/noite, estante, planta, etc.)
    if (skinId === 'room_cozy_desk') {
      candidates.push(
        {
          x: 66,
          activity: 'COFFEE',
          thought: dayInfo.windowThought,
          weight: 3,
        },
        {
          x: 158,
          activity: 'COFFEE',
          thought: '🌿 Dando uma olhadinha na planta do quarto...',
          weight: 2,
        },
        {
          x: 280,
          activity: 'READING',
          thought: '📖 Folheando um livro na estante...',
          weight: 2,
        }
      );
    } else if (skinId === 'room_office') {
      candidates.push(
        {
          x: 75,
          activity: 'COFFEE',
          thought: dayInfo.windowThought,
          weight: 3,
        },
        {
          x: 245,
          activity: 'TYPING',
          thought: '📊 Revisando o quadro de metas...',
          weight: 2,
        },
        {
          x: 315,
          activity: 'COFFEE',
          thought: '💧 Pausa para beber água fresca!',
          weight: 2,
        }
      );
    } else if (skinId === 'room_forest_campfire') {
      candidates.push({
        x: 172,
        activity: 'COFFEE',
        thought: '🔥 Aquecendo perto da fogueira...',
        weight: 3,
      });
    } else if (skinId === 'room_underwater') {
      candidates.push({
        x: 190,
        activity: 'FISHING',
        thought: '🐠 Observando os peixes no recife...',
        weight: 3,
      });
    }

    // 3. Passeio livre (dar alguns passinhos pela sala para esticar as pernas)
    const strollDelta = (Math.random() > 0.5 ? 1 : -1) * (42 + Math.floor(Math.random() * 55));
    const strollX = Math.max(32, Math.min(328, me.x + strollDelta));
    candidates.push({
      x: strollX,
      activity: me.idleActivity || 'COFFEE',
      thought: '🐾 Dando uns passinhos pelo cantinho...',
      weight: 2,
    });

    // Filtra pontos muito próximos de onde o Pip já está parado
    const distantCandidates = candidates.filter((c) => Math.abs(c.x - me.x) >= 18);
    const pool = distantCandidates.length > 0 ? distantCandidates : candidates;

    const totalWeight = pool.reduce((acc, c) => acc + c.weight, 0);
    let pick = Math.random() * totalWeight;
    let chosen = pool[0];
    for (const c of pool) {
      pick -= c.weight;
      if (pick <= 0) {
        chosen = c;
        break;
      }
    }

    this.walkToPointOfInterest(chosen.x, chosen.activity, chosen.thought, false);
  }

  private setupKeyboardAndFocusListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal !== 'NONE') {
        this.closeModal();
        return;
      }
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      if (!this.room || !this.profile) return;

      const me = this.room.players.find((p) => p.userId === this.profile?.id);
      if (!me) return;

      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        this.recordManualInput();
        const nextX = Math.max(24, me.targetX - 28);
        me.targetX = nextX;
        me.facing = 'left';
        this.socket.emit('player:move', { targetX: nextX });
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        this.recordManualInput();
        const nextX = Math.min(336, me.targetX + 28);
        me.targetX = nextX;
        me.facing = 'right';
        this.socket.emit('player:move', { targetX: nextX });
      } else if (e.key === ' ' || e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') {
        e.preventDefault();
        this.recordManualInput();
        this.renderer.triggerJump(this.profile.id);
        this.socket.emit('player:jump');
      }
    });

    window.addEventListener('blur', () => {
      if (
        !this.autoIdleOnBlur ||
        !this.profile ||
        this.manualActionSelected ||
        this.isInFurnitureOrWanderActivity
      ) {
        return;
      }
      if (this.profile.hostStatus === 'ACTIVE') {
        this.socket.emit('host:set_status', { status: 'IDLE' });
      }
    });

    window.addEventListener('focus', () => {
      if (
        !this.autoIdleOnBlur ||
        !this.profile ||
        this.manualActionSelected ||
        this.isInFurnitureOrWanderActivity
      ) {
        return;
      }
      if (this.profile.hostStatus === 'IDLE') {
        this.socket.emit('host:set_status', { status: 'ACTIVE' });
      }
    });

    setInterval(() => {
      if (this.room && this.room.pendingKnocks.length > 0) {
        this.renderKnockBanner();
      }
      this.triggerAutonomousWanderIfIdle();
    }, 1000);
  }

  private renderTopbar() {
    if (!this.profile) return;
    const isMyRoom = !this.room || this.room.hostUserId === this.profile.id;
    const isVideoPiP = windowBridge.videoPipActive;
    const playersCount = this.room?.players.length || 1;

    this.topbarEl.innerHTML = `
      <div class="topbar-left">
        <button class="profile-chip" id="btn-open-profile" title="Alterar Nickname da Sala ou Ver Conta">
          <span class="status-dot ${this.profile.hostStatus}"></span>
          <span>${this.escapeHtml(this.profile.displayName)}</span>
          <span style="opacity: 0.6; font-size: 0.68rem; font-weight: 500;">@${this.escapeHtml(this.profile.username)}</span>
        </button>

        <span class="room-pill">
          ${
            isMyRoom
              ? `🏠 Meu Cantinho (${playersCount}/5)`
              : `🚀 Sala de ${this.escapeHtml(this.room?.hostDisplayName || '')} (${playersCount}/5)`
          }
        </span>

        ${
          !isMyRoom
            ? `<button class="btn btn-sm btn-primary" id="btn-top-home">Voltar</button>`
            : ''
        }
      </div>

      <div class="topbar-right">
        <button class="currency-pill coins" id="btn-top-buy-coins" style="cursor: pointer;" title="Moedas (+1 a cada 5 min online) — Clique para comprar Moedas via PIX">
          🪙 ${this.profile.coins} <span style="font-size:0.65rem; opacity:0.85;">+</span>
        </button>
        <button class="currency-pill gems" id="btn-top-buy-gems" style="cursor: pointer;" title="Pip Diamantes — Clique para recarregar ou ver o Double D Pack">
          💎 ${this.profile.gems} <span style="font-size:0.65rem; opacity:0.85;">+</span>
        </button>
        ${
          this.profile.isAdmin
            ? `<button class="btn btn-sm btn-gold" id="btn-top-admin" title="Painel do Administrador (Validado pelo Servidor)">
                🛡️ Admin
              </button>`
            : ''
        }
        <button class="btn btn-icon ${soundEngine.muted ? '' : 'active-toggle'}" id="btn-top-mute" title="Som">
          ${soundEngine.muted ? '🔇' : '🔊'}
        </button>
        <button class="btn btn-sm ${isVideoPiP ? 'active-toggle' : 'btn-primary'}" id="btn-top-pip" title="Destacar janelinha Picture-in-Picture sem barra de título">
          📺 ${isVideoPiP ? 'Sair PiP' : 'PiP Flutuante'}
        </button>
        <button class="btn btn-sm btn-danger" id="btn-top-logout" title="Sair da conta">
          Sair
        </button>
      </div>
    `;

    document.getElementById('btn-open-profile')?.addEventListener('click', () => {
      this.openModal('PROFILE');
    });

    document.getElementById('btn-top-buy-coins')?.addEventListener('click', () => {
      this.shopTab = 'DIAMANTES';
      this.shopSubTab = 'MOEDAS_PACKS';
      this.openModal('SHOP');
    });

    document.getElementById('btn-top-buy-gems')?.addEventListener('click', () => {
      this.shopTab = 'DIAMANTES';
      this.shopSubTab = 'DIAMANTES_PACKS';
      this.openModal('SHOP');
    });

    document.getElementById('btn-top-admin')?.addEventListener('click', () => {
      this.openModal('ADMIN');
    });

    document.getElementById('btn-top-home')?.addEventListener('click', () => {
      this.socket.emit('room:leave_visit');
    });

    document.getElementById('btn-top-mute')?.addEventListener('click', () => {
      soundEngine.muted = !soundEngine.muted;
      this.renderTopbar();
    });

    document.getElementById('btn-top-pip')?.addEventListener('click', async () => {
      try {
        const canvas = document.getElementById('pocket-canvas') as HTMLCanvasElement;
        await windowBridge.toggleBorderlessVideoPiP(canvas);
      } catch (err) {
        this.showToast('warning', (err as Error).message);
      }
    });

    document.getElementById('btn-top-logout')?.addEventListener('click', () => {
      this.logoutAccount();
    });
  }

  private renderFloatingDock() {
    const pendingFriends = this.profile?.pendingIncomingFriends?.length || 0;
    const visitorsInMyRoom =
      this.room && this.profile && this.room.hostUserId === this.profile.id
        ? this.room.players.filter((p) => p.userId !== this.profile?.id).length
        : 0;
    const badgeCount = pendingFriends + visitorsInMyRoom;

    this.floatingDockEl.innerHTML = `
      <button class="dock-btn ${this.activeModal === 'SHOP' ? 'active' : ''}" id="dock-btn-shop">
        <span>🛍️</span>
        <span>Loja</span>
      </button>

      <button class="dock-btn ${this.activeModal === 'FRIENDS' ? 'active' : ''}" id="dock-btn-friends">
        <span>👥</span>
        <span>Amigos</span>
        ${badgeCount > 0 ? `<span class="dock-badge">${badgeCount}</span>` : ''}
      </button>

      <button class="dock-btn ${this.activeModal === 'BACKPACK' ? 'active' : ''}" id="dock-btn-backpack">
        <span>🎒</span>
        <span>Mochila</span>
      </button>
    `;

    document.getElementById('dock-btn-shop')?.addEventListener('click', () => {
      this.toggleModal('SHOP');
    });
    document.getElementById('dock-btn-friends')?.addEventListener('click', () => {
      this.toggleModal('FRIENDS');
    });
    document.getElementById('dock-btn-backpack')?.addEventListener('click', () => {
      this.toggleModal('BACKPACK');
    });
  }

  private renderKnockBanner() {
    if (!this.room || !this.profile) return;
    const isMyRoom = this.room.hostUserId === this.profile.id;
    const knock: KnockRequest | undefined = this.room.pendingKnocks[0];

    if (!isMyRoom || !knock) {
      this.knockBannerContainerEl.innerHTML = '';
      return;
    }

    const secsLeft = Math.max(0, Math.ceil((knock.expiresAt - Date.now()) / 1000));
    this.knockBannerContainerEl.innerHTML = `
      <div class="knock-banner">
        <div>
          <div style="font-size: 0.76rem; font-weight: 700; color: var(--accent-gold);">
            🔔 ${this.escapeHtml(knock.visitorDisplayName)} bateu na porta!
          </div>
          <div style="font-size: 0.66rem; color: var(--text-secondary);">
            Expira em ${secsLeft}s
          </div>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-knock-accept">Aceitar</button>
        <button class="btn btn-sm btn-danger" id="btn-knock-reject">Recusar</button>
      </div>
    `;

    document.getElementById('btn-knock-accept')?.addEventListener('click', () => {
      this.socket.emit('room:knock_respond', { knockId: knock.id, accept: true });
    });

    document.getElementById('btn-knock-reject')?.addEventListener('click', () => {
      this.socket.emit('room:knock_respond', { knockId: knock.id, accept: false });
    });
  }

  // ==========================================
  // Gerenciamento de Popups Minimalistas com Abas
  // ==========================================
  private toggleModal(modal: ActiveModal) {
    if (this.activeModal === modal) {
      this.closeModal();
    } else {
      this.openModal(modal);
    }
  }

  private openModal(modal: ActiveModal) {
    this.activeModal = modal;
    this.renderFloatingDock();
    if (modal === 'ADMIN') {
      void this.fetchAdminDashboard();
    }
    this.renderActiveModal();
    if (modal === 'BACKPACK') {
      this.startPreviewLoop();
    } else {
      this.stopPreviewLoop();
    }
  }

  private closeModal() {
    this.activeModal = 'NONE';
    this.stopPreviewLoop();
    this.stopPixPoll();
    this.modalRootEl.innerHTML = '';
    this.renderFloatingDock();
  }

  private startPreviewLoop() {
    this.stopPreviewLoop();
    const tick = () => {
      if (this.activeModal !== 'BACKPACK') return;
      if (this.profile) {
        this.renderer.renderPreviewFrame(this.profile);
      }
      this.previewAnimId = requestAnimationFrame(tick);
    };
    this.previewAnimId = requestAnimationFrame(tick);
  }

  private stopPreviewLoop() {
    if (this.previewAnimId) {
      cancelAnimationFrame(this.previewAnimId);
      this.previewAnimId = 0;
    }
    this.renderer.attachPreviewCanvas(null);
  }

  private renderActiveModal() {
    if (!this.profile) return;
    if (this.activeModal === 'SHOP') {
      this.renderShopPopup();
    } else if (this.activeModal === 'FRIENDS') {
      this.renderFriendsPopup();
    } else if (this.activeModal === 'BACKPACK') {
      this.renderBackpackPopup();
    } else if (this.activeModal === 'PROFILE') {
      this.renderProfilePopup();
    } else if (this.activeModal === 'ADMIN') {
      this.renderAdminPopup();
    } else if (this.activeModal === 'FURN_EDIT') {
      this.renderFurnitureEditPopup();
    } else {
      this.modalRootEl.innerHTML = '';
    }
  }

  /**
   * Atualiza o conteúdo interno do popup sem recriar o .modal-backdrop,
   * eliminando 100% do efeito de "piscar/refresh" e preservando a rolagem.
   */
  private mountPopupWindow(innerHtml: string, maxWidth = '720px') {
    const prevBody = this.modalRootEl.querySelector('.popup-body') as HTMLElement | null;
    const prevScroll = prevBody ? prevBody.scrollTop : 0;

    let backdropEl = document.getElementById('modal-backdrop');
    let windowEl = this.modalRootEl.querySelector('.popup-window') as HTMLElement | null;

    if (!backdropEl || !windowEl) {
      this.modalRootEl.innerHTML = `
        <div class="modal-backdrop" id="modal-backdrop">
          <div class="popup-window" style="max-width: ${maxWidth};">
            ${innerHtml}
          </div>
        </div>
      `;
    } else {
      windowEl.style.maxWidth = maxWidth;
      windowEl.innerHTML = innerHtml;
    }

    const nextBody = this.modalRootEl.querySelector('.popup-body') as HTMLElement | null;
    if (nextBody && prevScroll > 0) {
      nextBody.scrollTop = prevScroll;
    }
  }

  // ------------------------------------------
  // 1. POPUP "🛍️ LOJA" (Separada por Aparência, Meu Cantinho, Outros e Pip Diamantes & VIP)
  // ------------------------------------------
  private renderShopPopup() {
    if (!this.profile) return;

    const subTabsByMain: Record<
      ShopTab,
      Array<{
        id: ShopSubTab;
        label: string;
        icon: string;
        category?: CosmeticCategory;
        description: string;
      }>
    > = {
      APARENCIA: [
        {
          id: 'PIP',
          icon: '🐾',
          label: 'Pip',
          category: 'avatar_body',
          description: 'Mude o seu personagem (raposa, pinguim, peixe, capivara, gato e mais)',
        },
        {
          id: 'CABECA',
          icon: '🎧',
          label: 'Cabeça',
          category: 'avatar_head',
          description: 'Chapéus, capacetes, fones lo-fi e coroas para o seu Pip',
        },
        {
          id: 'COSTAS',
          icon: '🎒',
          label: 'Costas',
          category: 'avatar_back',
          description: 'Asas, mochilas, capas e jetpacks equipados nas costas',
        },
      ],
      CANTINHO: [
        {
          id: 'MOVEIS',
          icon: '🛋️',
          label: 'Móveis',
          category: 'furniture',
          description: 'Sofás, tapetes, quadros, luminárias, estantes, aquários e setups (1 unidade de cada)',
        },
        {
          id: 'CENARIO',
          icon: '🖼️',
          label: 'Cenário',
          category: 'room_skin',
          description: 'Temas completos de ambiente: Floresta Densa, Escritório, Beco da Rapariga e mais',
        },
      ],
      OUTROS: [
        {
          id: 'BRINQUEDOS',
          icon: '✈️',
          label: 'Brinquedos',
          category: 'throwable',
          description: 'Itens divertidos para arremessar nos amigos dentro da sala',
        },
        {
          id: 'EFEITOS',
          icon: '⚡',
          label: 'Efeitos',
          category: 'spawn_fx',
          description: 'Animações especiais quando você entra no cantinho de alguém',
        },
        {
          id: 'CHAT',
          icon: '💬',
          label: 'Balões de Chat',
          category: 'chat_skin',
          description: 'Estilos visuais para as mensagens que aparecem em cima do seu Pip',
        },
        {
          id: 'PRESENTES',
          icon: '☕',
          label: 'Presentes',
          category: 'desk_drop',
          description: 'Cafés, bolos e mimos que você pode deixar no chão para seus amigos',
        },
        {
          id: 'GACHA',
          icon: '🎰',
          label: 'Cápsula Surpresa',
          description: 'Sorteie itens de Moedas Idle com desconto! (Itens de Diamante e Pacotes VIP são exclusivos)',
        },
      ],
      DIAMANTES: [
        {
          id: 'PACOTES_VIP',
          icon: '💿',
          label: 'Double D Pack (Exclusivo)',
          description: 'Pacote lendário exclusivo com Skin DJ Double D + Cenário Beco da Rapariga + Mesa de DJ!',
        },
        {
          id: 'DIAMANTES_PACKS',
          icon: '💎',
          label: 'Pip Diamantes (PIX)',
          description: 'Adquira Pip Diamantes instantaneamente via PIX para desbloquear itens especiais na loja!',
        },
        {
          id: 'MOEDAS_PACKS',
          icon: '🪙',
          label: 'Moedas (PIX)',
          description: 'Compre pacotes de Moedas via PIX para mobiliar e personalizar seu cantinho imediatamente!',
        },
      ],
    };

    const currentSubTabs = subTabsByMain[this.shopTab];
    if (!currentSubTabs.some((st) => st.id === this.shopSubTab)) {
      this.shopSubTab = currentSubTabs[0].id;
    }

    const activeSubMeta =
      currentSubTabs.find((st) => st.id === this.shopSubTab) || currentSubTabs[0];

    const items = activeSubMeta.category
      ? COSMETIC_CATALOG.filter((it) => it.category === activeSubMeta.category)
      : [];

    this.mountPopupWindow(`
      <div class="popup-header">
        <div class="popup-title">
          <span>🛍️</span>
          <span>Loja</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="currency-pill coins" id="shop-coins-pill" style="cursor: pointer;" title="Clique para comprar Moedas via PIX (+1 moeda a cada 5 min online)">🪙 ${this.profile.coins} +</button>
          <button class="currency-pill gems" id="shop-gems-pill" style="cursor: pointer;" title="Clique para comprar Pip Diamantes via PIX">💎 ${this.profile.gems} +</button>
          <button class="btn btn-sm btn-primary" id="btn-shop-goto-gems">💎 +Recargas / VIP</button>
          <button class="btn btn-icon" id="btn-close-modal">✕</button>
        </div>
      </div>

      <!-- Abas Principais: Aparência | Meu Cantinho | Outros | Recargas & VIP -->
      <div class="popup-tabs">
        <button class="popup-tab ${this.shopTab === 'APARENCIA' ? 'active' : ''}" data-shop-tab="APARENCIA">
          ✨ Aparência
        </button>
        <button class="popup-tab ${this.shopTab === 'CANTINHO' ? 'active' : ''}" data-shop-tab="CANTINHO">
          🏠 Meu Cantinho
        </button>
        <button class="popup-tab ${this.shopTab === 'OUTROS' ? 'active' : ''}" data-shop-tab="OUTROS">
          🎁 Outros
        </button>
        <button class="popup-tab ${this.shopTab === 'DIAMANTES' ? 'active' : ''}" data-shop-tab="DIAMANTES" style="color: var(--accent-gold);">
          💎 Recargas & VIP (PIX)
        </button>
      </div>

      <!-- Sub-abas da Categoria Selecionada -->
      <div class="popup-subtabs">
        ${currentSubTabs
          .map((sub) => {
            const count = sub.category
              ? COSMETIC_CATALOG.filter((it) => it.category === sub.category).length
              : 0;
            return `
              <button
                class="popup-subtab ${this.shopSubTab === sub.id ? 'active' : ''}"
                data-shop-subtab="${sub.id}"
              >
                <span>${sub.icon}</span>
                <span>${sub.label}</span>
                ${count > 0 ? `<span class="popup-subtab-count">${count}</span>` : ''}
              </button>
            `;
          })
          .join('')}
      </div>

      <div class="popup-body">
        <div class="shop-section-banner" title="${this.escapeHtml(activeSubMeta.description)}">
          <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">
            ${activeSubMeta.icon} ${activeSubMeta.label}
          </div>
          ${
            activeSubMeta.category
              ? `<span style="font-size: 0.7rem; color: var(--text-muted); white-space: nowrap;">
                  ${items.filter((i) => this.profile!.inventory.includes(i.id)).length}/${items.length} adquiridos
                </span>`
              : `<span style="font-size: 0.68rem; color: var(--accent-gold); white-space: nowrap;">
                  🪙 +1 Moeda / 5 min online
                </span>`
          }
        </div>

        ${
          this.shopTab === 'DIAMANTES'
            ? this.renderShopRealMoneySection()
            : this.shopSubTab === 'GACHA'
              ? `
                <div style="text-align: center; padding: 28px 16px; display: flex; flex-direction: column; align-items: center; gap: 14px;" title="Sorteie cosméticos de Moedas do catálogo! Itens repetidos devolvem metade do valor.">
                  <div style="font-size: 3rem;">🎰</div>
                  <div style="font-size: 1rem; font-weight: 700; color: var(--accent-gold);">
                    Máquina de Cápsulas Surpresa
                  </div>
                  <button class="btn btn-primary" id="btn-roll-gachapon" style="padding: 10px 24px; font-size: 0.88rem;">
                    Girar Cápsula (${GACHAPON_COST_COINS} 🪙)
                  </button>
                </div>
              `
              : `
                <div class="items-grid">
                  ${items.map((item) => this.renderCatalogItemCard(item)).join('')}
                </div>
              `
        }
      </div>
    `);

    this.bindCommonPopupEvents();

    document.getElementById('shop-coins-pill')?.addEventListener('click', () => {
      this.shopTab = 'DIAMANTES';
      this.shopSubTab = 'MOEDAS_PACKS';
      this.renderShopPopup();
    });

    document.getElementById('shop-gems-pill')?.addEventListener('click', () => {
      this.shopTab = 'DIAMANTES';
      this.shopSubTab = 'DIAMANTES_PACKS';
      this.renderShopPopup();
    });

    document.getElementById('btn-shop-goto-gems')?.addEventListener('click', () => {
      this.shopTab = 'DIAMANTES';
      this.shopSubTab = 'DIAMANTES_PACKS';
      this.renderShopPopup();
    });

    document.getElementById('btn-roll-gachapon')?.addEventListener('click', () => {
      this.socket.emit('shop:gachapon');
    });

    this.modalRootEl.querySelectorAll('[data-shop-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTab = (btn as HTMLElement).dataset.shopTab as ShopTab;
        if (this.shopTab !== nextTab) {
          this.shopTab = nextTab;
          this.shopSubTab = subTabsByMain[nextTab][0].id;
          const bodyEl = this.modalRootEl.querySelector('.popup-body') as HTMLElement | null;
          if (bodyEl) bodyEl.scrollTop = 0;
          this.renderShopPopup();
        }
      });
    });

    this.modalRootEl.querySelectorAll('[data-shop-subtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextSub = (btn as HTMLElement).dataset.shopSubtab as ShopSubTab;
        if (this.shopSubTab !== nextSub) {
          this.shopSubTab = nextSub;
          const bodyEl = this.modalRootEl.querySelector('.popup-body') as HTMLElement | null;
          if (bodyEl) bodyEl.scrollTop = 0;
          this.renderShopPopup();
        }
      });
    });

    this.bindItemActionButtons();
    this.bindRealMoneyEvents();
  }

  private formatBrl(val: number): string {
    return `R$ ${val.toFixed(2).replace('.', ',')}`;
  }

  private renderShopRealMoneySection(): string {
    if (!this.profile) return '';

    const doubleDPack = REAL_MONEY_PACKAGES.find((p) => p.id === 'pkg_double_d');
    const gemPackages = REAL_MONEY_PACKAGES.filter((p) => p.type === 'GEMS_PACK');
    const coinPackages = REAL_MONEY_PACKAGES.filter((p) => p.type === 'COINS_PACK');
    const ownsDoubleD =
      (doubleDPack?.grantedItemIds || []).every((id) => this.profile!.inventory.includes(id)) ||
      false;

    const pixCheckoutHtml = this.activePixCheckout
      ? `
        <div class="pix-checkout-box">
          <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
            <div style="font-size: 0.85rem; font-weight: 800; color: var(--accent-green);">
              💠 PIX — ${this.escapeHtml(this.activePixCheckout.packageName)} (${this.formatBrl(this.activePixCheckout.amountBrl)})
            </div>
            <button class="btn btn-sm btn-danger" id="btn-cancel-pix">Fechar PIX</button>
          </div>
          ${
            this.activePixCheckout.qrCodeBase64
              ? `<img class="pix-qr-img" src="data:image/png;base64,${this.activePixCheckout.qrCodeBase64}" alt="QR Code PIX" />`
              : ''
          }
          <div style="display: flex; gap: 8px; width: 100%;">
            <input
              type="text"
              readonly
              class="chat-input-minimal"
              style="flex: 1; background: rgba(0,0,0,0.35); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 10px; font-size: 0.7rem; color: var(--accent-cyan);"
              value="${this.escapeHtml(this.activePixCheckout.qrCode)}"
            />
            <button class="btn btn-sm btn-primary" id="btn-copy-pix-code">📋 Copiar PIX</button>
          </div>
          <div style="font-size: 0.72rem; color: var(--accent-gold); font-weight: 600;">
            ⏳ Aguardando confirmação automática...
          </div>
        </div>
      `
      : '';

    if (this.shopSubTab === 'PACOTES_VIP' && doubleDPack) {
      const doubleDPriceStr = this.formatBrl(doubleDPack.priceBrl);
      return `
        ${pixCheckoutHtml}
        <div class="double-d-hero" title="${this.escapeHtml(doubleDPack.description)}">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
            <div>
              <span class="rarity-badge rarity-LEGENDARY" style="font-size: 0.68rem; padding: 3px 8px; margin-left: 0;">
                ★ PACOTE LENDÁRIO EXCLUSIVO
              </span>
              <h3 style="margin: 6px 0 0; font-size: 1.18rem; color: #fde047;">
                💿 ${this.escapeHtml(doubleDPack.name)}
              </h3>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 1.25rem; font-weight: 800; color: var(--accent-gold);">
                ${doubleDPriceStr}
              </div>
            </div>
          </div>

          <div class="double-d-items-row">
            <div class="double-d-mini-card" title="Pip lendário sentado na pose clássica de barba, óculos escuros, camiseta rosé, relógio no pulso e fone na mão!">
              <div style="font-size: 1.4rem;">🎧</div>
              <div style="font-size: 0.78rem; font-weight: 700; color: #fde047;">Skin DJ Double D</div>
              <div class="hover-desc-tooltip">Pip lendário sentado na pose clássica de barba, óculos escuros, camiseta rosé, relógio no pulso e fone na mão!</div>
            </div>
            <div class="double-d-mini-card" title="Cenário urbano fiel em pixel art com grafite, muro em 2 tons, placa de rua, poste iluminado e calçada!">
              <div style="font-size: 1.4rem;">🛹</div>
              <div style="font-size: 0.78rem; font-weight: 700; color: #f472b6;">Beco da Rapariga</div>
              <div class="hover-desc-tooltip">Cenário urbano fiel em pixel art com grafite, muro em 2 tons, placa de rua, poste iluminado e calçada!</div>
            </div>
            <div class="double-d-mini-card" title="Móvel interativo com 2 pick-ups girando, caixas de som e painel frontal de LEDs pulsantes!">
              <div style="font-size: 1.4rem;">🎛️</div>
              <div style="font-size: 0.78rem; font-weight: 700; color: #38bdf8;">Mesa de DJ Double D</div>
              <div class="hover-desc-tooltip">Móvel interativo com 2 pick-ups girando, caixas de som e painel frontal de LEDs pulsantes!</div>
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; align-items: center; margin-top: 6px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); flex-wrap: wrap; gap: 10px;">
            ${
              ownsDoubleD
                ? `<div style="display: flex; gap: 8px; align-items: center;">
                    <span class="btn btn-sm active-toggle">✓ Adquirido</span>
                    <button class="btn btn-sm btn-gold" id="btn-equip-double-d-all">
                      ✨ Equipar Pack Completo
                    </button>
                  </div>`
                : `<button
                    class="btn btn-gold"
                    data-buy-real-pkg="${doubleDPack.id}"
                    style="padding: 9px 18px; font-size: 0.84rem;"
                    ${this.pixCreatingPackageId === doubleDPack.id ? 'disabled' : ''}
                  >
                    ${
                      this.pixCreatingPackageId === doubleDPack.id
                        ? 'Gerando PIX...'
                        : `Comprar via PIX (${doubleDPriceStr})`
                    }
                  </button>`
            }
          </div>
        </div>
      `;
    }

    if (this.shopSubTab === 'MOEDAS_PACKS') {
      return `
        ${pixCheckoutHtml}
        <div class="items-grid">
          ${coinPackages
            .map((pkg) => {
              const isLoading = this.pixCreatingPackageId === pkg.id;
              const coinsCount = pkg.coinsAmount || 0;
              const priceStr = this.formatBrl(pkg.priceBrl);
              const hoverText = `${pkg.name}${pkg.bonusCoins ? ` (+${pkg.bonusCoins} de bônus incluso)` : ''} — ${pkg.description}`;
              return `
                <div
                  class="item-card"
                  title="${this.escapeHtml(hoverText)}"
                  style="border-color: rgba(250, 204, 21, 0.35);"
                >
                  <div class="item-icon" style="font-size: 1.45rem;">🪙</div>
                  <div class="item-info">
                    <div class="item-name" style="font-size: 0.92rem; font-weight: 800; color: var(--accent-gold);">
                      ${coinsCount} 🪙
                    </div>
                  </div>
                  <div>
                    <button
                      class="btn btn-sm btn-gold"
                      data-buy-real-pkg="${pkg.id}"
                      ${isLoading ? 'disabled' : ''}
                    >
                      ${isLoading ? 'Gerando...' : priceStr}
                    </button>
                  </div>
                  <div class="hover-desc-tooltip">${this.escapeHtml(hoverText)}</div>
                </div>
              `;
            })
            .join('')}
        </div>
      `;
    }

    return `
      ${pixCheckoutHtml}
      <div class="items-grid">
        ${gemPackages
          .map((pkg) => {
            const isLoading = this.pixCreatingPackageId === pkg.id;
            const gemsCount = pkg.gemsAmount || 0;
            const priceStr = this.formatBrl(pkg.priceBrl);
            const hoverText = `${pkg.name}${pkg.bonusGems ? ` (+${pkg.bonusGems} de bônus incluso)` : ''} — ${pkg.description}`;
            return `
              <div
                class="item-card"
                title="${this.escapeHtml(hoverText)}"
                style="border-color: ${pkg.isTestItem ? 'rgba(56, 189, 248, 0.4)' : 'rgba(245, 158, 11, 0.35)'};"
              >
                <div class="item-icon" style="font-size: 1.45rem;">💎</div>
                <div class="item-info">
                  <div class="item-name" style="font-size: 0.92rem; font-weight: 800; color: var(--accent-purple);">
                    ${gemsCount} 💎
                  </div>
                </div>
                <div>
                  <button
                    class="btn btn-sm btn-gold"
                    data-buy-real-pkg="${pkg.id}"
                    ${isLoading ? 'disabled' : ''}
                  >
                    ${isLoading ? 'Gerando...' : priceStr}
                  </button>
                </div>
                <div class="hover-desc-tooltip">${this.escapeHtml(hoverText)}</div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  private bindRealMoneyEvents() {
    this.modalRootEl.querySelectorAll('[data-buy-real-pkg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const packageId = (btn as HTMLElement).dataset.buyRealPkg!;
        void this.startPixCheckout(packageId);
      });
    });

    this.modalRootEl.querySelectorAll('[data-open-double-d]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.shopTab = 'DIAMANTES';
        this.shopSubTab = 'PACOTES_VIP';
        this.renderShopPopup();
      });
    });

    document.getElementById('btn-equip-double-d-all')?.addEventListener('click', () => {
      this.socket.emit('inventory:equip', { itemId: 'body_dj_double_d' });
      this.socket.emit('inventory:equip', { itemId: 'room_beco_rapariga' });
      const alreadyPlaced = (this.profile?.placedFurniture || []).some(
        (f) => f.itemId === 'furn_dj_booth'
      );
      if (!alreadyPlaced) {
        this.socket.emit('furniture:place', { itemId: 'furn_dj_booth', x: 250 });
      }
      this.showToast('success', '💿 Skin DJ Double D + Beco da Rapariga + Mesa de DJ ativados!');
    });

    document.getElementById('btn-copy-pix-code')?.addEventListener('click', () => {
      if (!this.activePixCheckout?.qrCode) return;
      navigator.clipboard.writeText(this.activePixCheckout.qrCode).then(() => {
        this.showToast('success', '📋 Código PIX Copia e Cola copiado!');
      });
    });

    document.getElementById('btn-cancel-pix')?.addEventListener('click', () => {
      this.stopPixPoll();
      this.activePixCheckout = null;
      this.renderShopPopup();
    });
  }

  private async startPixCheckout(packageId: string) {
    if (!this.profile) return;
    this.pixCreatingPackageId = packageId;
    this.renderShopPopup();

    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/payments/create`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ packageId }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        txId?: string;
        mpPaymentId?: string;
        packageName?: string;
        amountBrl?: number;
        qrCode?: string;
        qrCodeBase64?: string;
        ticketUrl?: string;
        error?: string;
      };

      this.pixCreatingPackageId = null;

      if (!res.ok || !data.ok || !data.txId) {
        this.showToast('error', data.error || 'Não foi possível gerar o PIX.');
        this.renderShopPopup();
        return;
      }

      this.activePixCheckout = {
        txId: data.txId,
        mpPaymentId: data.mpPaymentId || '',
        packageName: data.packageName || packageId,
        amountBrl: data.amountBrl || 0,
        qrCode: data.qrCode || '',
        qrCodeBase64: data.qrCodeBase64 || '',
        ticketUrl: data.ticketUrl,
      };

      this.renderShopPopup();
      this.startPixPoll(data.txId);
    } catch (err) {
      this.pixCreatingPackageId = null;
      this.showToast('error', `Erro ao iniciar pagamento: ${(err as Error).message}`);
      this.renderShopPopup();
    }
  }

  private startPixPoll(txId: string) {
    this.stopPixPoll();
    this.pixPollTimer = window.setInterval(async () => {
      try {
        const baseUrl = getApiBaseUrl();
        const res = await fetch(`${baseUrl}/api/payments/check/${encodeURIComponent(txId)}`, {
          method: 'GET',
          headers: this.getAuthHeaders(),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          ok?: boolean;
          status?: string;
          approved?: boolean;
        };
        if (data.approved || data.status === 'APPROVED') {
          this.stopPixPoll();
          this.activePixCheckout = null;
          if (this.activeModal === 'SHOP') {
            this.renderShopPopup();
          }
        }
      } catch {
        // Ignora falhas temporárias de rede no polling
      }
    }, 4000);
  }

  private stopPixPoll() {
    if (this.pixPollTimer !== null) {
      clearInterval(this.pixPollTimer);
      this.pixPollTimer = null;
    }
  }

  // ------------------------------------------
  // 2. POPUP "👥 AMIGOS" (Com Abas: Salas Online • Minha Sala • Adicionar)
  // ------------------------------------------
  private renderFriendsPopup() {
    if (!this.profile) return;

    const otherOnline = this.directory.filter((d) => d.userId !== this.profile?.id);
    const pendingIn = this.profile.pendingIncomingFriends || [];
    const pendingOut = this.profile.pendingOutgoingFriends || [];
    const isMyRoom = !this.room || this.room.hostUserId === this.profile.id;
    const visitors =
      this.room?.players.filter((p) => p.userId !== this.profile?.id) || [];

    this.mountPopupWindow(`
          <div class="popup-header">
            <div class="popup-title">
              <span>👥</span>
              <span>Amigos & Salas</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button class="btn btn-sm" id="btn-copy-invite">🔗 Copiar Link Convite</button>
              <button class="btn btn-icon" id="btn-close-modal">✕</button>
            </div>
          </div>

          <div class="popup-tabs">
            <button class="popup-tab ${this.friendsTab === 'ONLINE' ? 'active' : ''}" data-friends-tab="ONLINE">
              🟢 Salas Online (${otherOnline.length})
            </button>
            <button class="popup-tab ${this.friendsTab === 'MY_ROOM' ? 'active' : ''}" data-friends-tab="MY_ROOM">
              🏠 Minha Sala (${visitors.length}/4)
            </button>
            <button class="popup-tab ${this.friendsTab === 'REQUESTS' ? 'active' : ''}" data-friends-tab="REQUESTS">
              ➕ Adicionar ${pendingIn.length > 0 ? `(${pendingIn.length})` : ''}
            </button>
          </div>

          <div class="popup-body">
            ${
              this.friendsTab === 'ONLINE'
                ? `
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-size: 0.76rem; color: var(--text-secondary);">
                      Visite o cantinho de um amigo ou chame o Bot Pipoca para testar:
                    </span>
                    <button class="btn btn-sm btn-primary" id="btn-summon-bot">
                      🐦 Chamar Pipoca (Bot)
                    </button>
                  </div>

                  <div class="items-grid">
                    ${otherOnline
                      .map((entry) => {
                        const bodyItem = getCosmeticById(entry.equipped.avatar_body);
                        const isVisitingThem = this.room?.hostUserId === entry.userId;
                        const isInMyRoom =
                          entry.currentRoomHostId === this.profile!.id ||
                          (isMyRoom &&
                            this.room?.players.some((p) => p.userId === entry.userId));
                        const isFriend =
                          entry.isBot || this.profile!.friends.includes(entry.userId);
                        const isPendingOut = pendingOut.includes(entry.userId);
                        const isPendingIn = pendingIn.includes(entry.userId);

                        return `
                          <div class="item-card">
                            <div class="item-icon">${bodyItem?.icon || '🧑'}</div>
                            <div class="item-info">
                              <div class="item-name">${this.escapeHtml(entry.displayName)}</div>
                              <div class="item-sub">
                                @${this.escapeHtml(entry.username)} • ${entry.visitorCount}/4
                              </div>
                            </div>
                            <div style="display: flex; gap: 6px; align-items: center;">
                              ${
                                isInMyRoom
                                  ? `<button class="btn btn-sm btn-danger" data-kick-visitor="${entry.userId}" title="Expulsar da sua sala">👢 Expulsar</button>`
                                  : ''
                              }
                              ${
                                isVisitingThem
                                  ? `<span style="font-size: 0.7rem; color: var(--accent-cyan);">Na sala</span>`
                                    : !isFriend
                                      ? isPendingIn
                                        ? `<button class="btn btn-sm btn-gold" data-accept-friend="${entry.userId}">Aceitar</button>`
                                        : isPendingOut
                                          ? `<span style="font-size: 0.7rem; color: var(--text-muted);">Pendente</span>`
                                          : `<button class="btn btn-sm" data-request-friend="@${this.escapeHtml(entry.username)}">+Amigo</button>`
                                      : entry.hostStatus === 'DND'
                                        ? `<button class="btn btn-sm btn-gold" data-drop-mailbox="${entry.userId}">📫 Presente</button>`
                                        : `<button class="btn btn-sm btn-primary" data-visit-user="${entry.userId}">
                                            ${entry.doorPermission === 'KNOCK' ? '🔔 Bater' : '🚀 Visitar'}
                                          </button>`
                                }
                              </div>
                            </div>
                          `;
                        })
                        .join('')}
                    </div>
                  `
                  : this.friendsTab === 'MY_ROOM'
                    ? `
                      <div style="display: flex; flex-direction: column; gap: 14px;">
                        <!-- Status e Porta -->
                        <div class="item-card" style="flex-wrap: wrap;">
                          <div>
                            <div class="item-name">Meu Estado & Ação Idle</div>
                            <div class="item-sub">Escolha como seu avatar aparece na sala</div>
                          </div>
                          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            <button class="btn btn-sm ${this.profile.hostStatus === 'ACTIVE' ? 'active-toggle' : ''}" data-status="ACTIVE">🚶 Livre</button>
                            <button class="btn btn-sm" data-idle="COFFEE">☕ Café</button>
                            <button class="btn btn-sm" data-idle="FISHING">🎣 Pescar</button>
                            <button class="btn btn-sm" data-idle="TYPING">💻 Computador</button>
                            <button class="btn btn-sm" data-idle="READING">📖 Livro</button>
                            <button class="btn btn-sm" data-idle="SLEEPING">💤 Cochilar</button>
                            <button class="btn btn-sm ${this.profile.hostStatus === 'DND' ? 'active-toggle' : ''}" data-status="DND">🔒 DND</button>
                          </div>
                        </div>

                        <div class="item-card" style="flex-wrap: wrap;">
                          <div>
                            <div class="item-name">Permissão da Porta</div>
                            <div class="item-sub">Entrada direta ou pedir permissão (Toc-Toc)</div>
                          </div>
                          <div style="display: flex; gap: 6px;">
                            <button class="btn btn-sm ${this.profile.doorPermission === 'OPEN' ? 'active-toggle' : ''}" data-door="OPEN">🚪 Aberta</button>
                            <button class="btn btn-sm ${this.profile.doorPermission === 'KNOCK' ? 'active-toggle' : ''}" data-door="KNOCK">🔔 Toc-Toc</button>
                          </div>
                        </div>

                        <!-- Lista de Visitantes na Sala para Expulsar -->
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <span style="font-size: 0.8rem; font-weight: 600;">
                            Visitantes na sua sala agora (${visitors.length})
                          </span>
                          ${
                            visitors.length > 0
                              ? `<button class="btn btn-sm btn-danger" id="btn-panic-kick">🚨 Expulsar Todos</button>`
                              : ''
                          }
                        </div>

                        ${
                          visitors.length === 0
                            ? `<div style="font-size: 0.78rem; color: var(--text-muted); padding: 12px 0;">
                                Nenhum visitante na sua sala no momento.
                              </div>`
                            : `<div class="items-grid">
                                ${visitors
                                  .map(
                                    (v) => `
                                      <div class="item-card">
                                        <div class="item-info">
                                          <div class="item-name">${this.escapeHtml(v.displayName)}</div>
                                          <div class="item-sub">@${this.escapeHtml(v.username)}</div>
                                        </div>
                                        <button class="btn btn-sm btn-danger" data-kick-visitor="${v.userId}">
                                          👢 Expulsar
                                        </button>
                                      </div>
                                    `
                                  )
                                  .join('')}
                              </div>`
                        }
                      </div>
                    `
                    : `
                      <!-- Aba Adicionar & Pedidos -->
                      <div class="item-card" style="background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.3);">
                        <div class="item-info">
                          <div class="item-name">Seu ID Único Permanente: <span style="color: var(--accent-cyan);">@${this.escapeHtml(this.profile.username)}</span></div>
                          <div class="item-sub">Passe esse @ID para seus amigos te adicionarem (esse valor é fixo e nunca muda)</div>
                        </div>
                        <button class="btn btn-sm btn-primary" id="btn-copy-my-id">📋 Copiar @ID</button>
                      </div>

                      <div style="display: flex; gap: 8px;">
                        <input
                          type="text"
                          id="input-friend-username"
                          class="chat-input-minimal"
                          style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 12px;"
                          placeholder="Digite o @ID único do amigo (ex: @Rick ou @Rick2)..."
                        />
                        <button class="btn btn-primary" id="btn-add-friend">Enviar Pedido</button>
                      </div>

                      ${
                        pendingIn.length === 0
                          ? `<div style="font-size: 0.78rem; color: var(--text-muted); padding: 8px 0;">
                              Nenhum pedido de amizade pendente.
                            </div>`
                          : `<div class="items-grid">
                              ${pendingIn
                                .map((reqId) => {
                                  const dirUser = this.directory.find((d) => d.userId === reqId);
                                  const label = dirUser
                                    ? `${dirUser.displayName} (@${dirUser.username})`
                                    : reqId;
                                  return `
                                    <div class="item-card">
                                      <div class="item-info">
                                        <div class="item-name">${this.escapeHtml(label)}</div>
                                        <div class="item-sub">Quer ser seu amigo</div>
                                      </div>
                                      <div style="display: flex; gap: 6px;">
                                        <button class="btn btn-sm btn-primary" data-accept-friend="${reqId}">Aceitar</button>
                                        <button class="btn btn-sm btn-danger" data-reject-friend="${reqId}">✕</button>
                                      </div>
                                    </div>
                                  `;
                                })
                                .join('')}
                            </div>`
                      }
                    `
              }
            </div>
      `);

      this.bindCommonPopupEvents();

      this.modalRootEl.querySelectorAll('[data-friends-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.friendsTab = (btn as HTMLElement).dataset.friendsTab as FriendsTab;
          this.renderFriendsPopup();
        });
      });

      document.getElementById('btn-copy-my-id')?.addEventListener('click', () => {
        const myTag = `@${this.profile?.username || ''}`;
        navigator.clipboard.writeText(myTag).then(() => {
          this.showToast('success', `📋 Seu ID único (${myTag}) foi copiado!`);
        });
      });

      document.getElementById('btn-copy-invite')?.addEventListener('click', () => {
        const url = `${window.location.origin}${window.location.pathname}?visit=${encodeURIComponent(
          this.profile?.username || ''
        )}`;
        navigator.clipboard.writeText(url).then(() => {
          this.showToast('success', '🔗 Link de convite copiado!');
        });
      });

      document.getElementById('btn-summon-bot')?.addEventListener('click', () => {
        this.socket.emit('bot:summon_visit');
      });

      document.getElementById('btn-panic-kick')?.addEventListener('click', () => {
        this.socket.emit('room:kick_all');
      });

      const sendFriendReq = () => {
        const inp = document.getElementById('input-friend-username') as HTMLInputElement;
        const val = inp?.value.trim();
        if (!val) return;
        if (!val.startsWith('@') || val.length < 2) {
          this.showToast(
            'warning',
            'Digite o ID único começando com @ (exemplo: @Rick ou @Rick2).'
          );
          return;
        }
        this.socket.emit('friends:add', { usernameOrId: val });
        inp.value = '';
      };

      document.getElementById('btn-add-friend')?.addEventListener('click', sendFriendReq);
      document.getElementById('input-friend-username')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          e.preventDefault();
          sendFriendReq();
        }
      });

    this.modalRootEl.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const status = (btn as HTMLElement).dataset.status as HostStatus;
        this.manualActionSelected = false;
        this.socket.emit('host:set_status', { status });
      });
    });

    this.modalRootEl.querySelectorAll('[data-idle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idleActivity = (btn as HTMLElement).dataset.idle as IdleActivity;
        this.manualActionSelected = true;
        this.socket.emit('host:set_status', { status: 'IDLE', idleActivity });
      });
    });

    this.modalRootEl.querySelectorAll('[data-door]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const doorPermission = (btn as HTMLElement).dataset.door as DoorPermission;
        this.socket.emit('host:set_door', { doorPermission });
      });
    });

    this.modalRootEl.querySelectorAll('[data-request-friend]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const usernameOrId = (btn as HTMLElement).dataset.requestFriend!;
        this.socket.emit('friends:add', { usernameOrId });
      });
    });

    this.modalRootEl.querySelectorAll('[data-accept-friend]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const requesterUserId = (btn as HTMLElement).dataset.acceptFriend!;
        this.socket.emit('friends:respond', { requesterUserId, accept: true });
      });
    });

    this.modalRootEl.querySelectorAll('[data-reject-friend]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const requesterUserId = (btn as HTMLElement).dataset.rejectFriend!;
        this.socket.emit('friends:respond', { requesterUserId, accept: false });
      });
    });

    this.modalRootEl.querySelectorAll('[data-visit-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = (btn as HTMLElement).dataset.visitUser!;
        this.socket.emit('room:visit', { targetUserId });
        this.closeModal();
      });
    });

    this.modalRootEl.querySelectorAll('[data-drop-mailbox]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = (btn as HTMLElement).dataset.dropMailbox!;
        this.socket.emit('player:interact', {
          targetUserId,
          actionType: 'DESK_DROP',
        });
      });
    });

    this.modalRootEl.querySelectorAll('[data-kick-visitor]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = (btn as HTMLElement).dataset.kickVisitor!;
        this.socket.emit('room:kick_visitor', { targetUserId });
      });
    });
  }

  // ------------------------------------------
  // 3. POPUP "🎒 MOCHILA" (Preview do Pocket Player + Abas de Personalização e Móveis)
  // ------------------------------------------
  private renderBackpackPopup() {
    if (!this.profile) return;

    const categoryGroups: Record<BackpackTab, CosmeticCategory[]> = {
      AVATAR: ['avatar_body', 'avatar_head', 'avatar_back'],
      FURNITURE: ['furniture', 'room_skin'],
      FX: ['spawn_fx', 'chat_skin', 'throwable', 'desk_drop'],
    };

    const ownedItems = COSMETIC_CATALOG.filter(
      (item) =>
        this.profile!.inventory.includes(item.id) &&
        categoryGroups[this.backpackTab].includes(item.category)
    );

    const placedList = this.room?.placedFurniture || this.profile.placedFurniture || [];

    this.mountPopupWindow(`
          <div class="popup-header">
            <div class="popup-title">
              <span>🎒</span>
              <span>Minha Mochila & Personalização</span>
            </div>
            <button class="btn btn-icon" id="btn-close-modal">✕</button>
          </div>

          <div class="popup-tabs">
            <button class="popup-tab ${this.backpackTab === 'AVATAR' ? 'active' : ''}" data-bp-tab="AVATAR">
              👕 Meu Visual
            </button>
            <button class="popup-tab ${this.backpackTab === 'FURNITURE' ? 'active' : ''}" data-bp-tab="FURNITURE">
              🛋️ Móveis & Cenário (${placedList.length}/10)
            </button>
            <button class="popup-tab ${this.backpackTab === 'FX' ? 'active' : ''}" data-bp-tab="FX">
              ⚡ Efeitos & Brinquedos
            </button>
          </div>

          <div class="popup-body">
            <div class="backpack-layout">
              <!-- Preview ao Vivo do Pocket Player -->
              <div class="player-preview-card">
                <div class="player-preview-canvas-wrap">
                  <canvas id="pocket-preview-canvas" width="220" height="135"></canvas>
                </div>
                <div style="font-size: 0.78rem; font-weight: 700;">
                  ${this.escapeHtml(this.profile.displayName)}
                </div>
                <button class="btn btn-sm" id="btn-preview-spawn" style="width: 100%; justify-content: center;">
                  ⚡ Testar Entrada
                </button>
              </div>

              <!-- Conteúdo da Aba Selecionada -->
              <div style="display: flex; flex-direction: column; gap: 12px; min-width: 0;">
                <div class="items-grid">
                  ${ownedItems.map((item) => this.renderCatalogItemCard(item)).join('')}
                </div>

                ${
                  this.backpackTab === 'FURNITURE' && placedList.length > 0
                    ? `
                      <div style="border-top: 1px solid var(--border-subtle); padding-top: 12px;">
                        <div style="font-size: 0.76rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 8px;">
                          🎨 Personalizar Móveis na Sala (arraste no cenário ou clique com botão direito para guardar):
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                          ${placedList
                            .map((placed) => {
                              const meta = getCosmeticById(placed.itemId);
                              const activeColor = placed.colorVariant || 'default';
                              return `
                                <div class="item-card" style="padding: 8px 10px; flex-direction: column; align-items: stretch; gap: 6px;">
                                  <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 0.76rem; font-weight: 600; min-width: 125px;">
                                      ${meta?.icon || '🛋️'} ${this.escapeHtml(meta?.name || placed.itemId)}
                                    </span>
                                    <input
                                      type="range"
                                      min="26"
                                      max="334"
                                      value="${Math.round(placed.x)}"
                                      data-furn-slider="${placed.instanceId}"
                                      style="flex: 1; accent-color: var(--accent);"
                                    />
                                    <button class="btn btn-sm" data-furn-flip="${placed.instanceId}" title="Virar lado">🔄</button>
                                    <button class="btn btn-sm btn-danger" data-furn-remove="${placed.instanceId}" title="Guardar na Mochila">🗑️</button>
                                  </div>
                                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <span style="font-size: 0.68rem; color: var(--text-muted);">🎨 Cor:</span>
                                    ${FURNITURE_COLOR_PALETTE.map((col) => {
                                      const isSelected = activeColor === col.id;
                                      const swatchBg = col.secondary || meta?.previewColor || '#64748b';
                                      return `
                                        <button
                                          class="color-swatch-btn ${isSelected ? 'active' : ''}"
                                          data-furn-color-instance="${placed.instanceId}"
                                          data-furn-color-val="${col.id}"
                                          title="Cor: ${col.label}"
                                          style="background: ${swatchBg};"
                                        ></button>
                                      `;
                                    }).join('')}
                                  </div>
                                </div>
                              `;
                            })
                            .join('')}
                        </div>
                      </div>
                    `
                    : ''
                }
              </div>
            </div>
          </div>
    `);

    this.bindCommonPopupEvents();

    const previewCanvas = document.getElementById(
      'pocket-preview-canvas'
    ) as HTMLCanvasElement | null;
    this.renderer.attachPreviewCanvas(previewCanvas);
    this.renderer.renderPreviewFrame(this.profile);

    document.getElementById('btn-preview-spawn')?.addEventListener('click', () => {
      soundEngine.playSpawn(this.profile!.equipped.spawn_fx);
      this.renderer.triggerPreviewSpawnFx();
    });

    this.modalRootEl.querySelectorAll('[data-bp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.backpackTab = (btn as HTMLElement).dataset.bpTab as BackpackTab;
        this.renderBackpackPopup();
      });
    });

    this.bindItemActionButtons();

    this.modalRootEl.querySelectorAll('[data-furn-slider]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const instanceId = target.dataset.furnSlider!;
        const x = Number(target.value);
        const item = this.room?.placedFurniture?.find((f) => f.instanceId === instanceId);
        if (item) item.x = x;
        this.socket.emit('furniture:move', { instanceId, x });
      });
    });

    this.modalRootEl.querySelectorAll('[data-furn-flip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const instanceId = (btn as HTMLElement).dataset.furnFlip!;
        this.socket.emit('furniture:flip', { instanceId });
      });
    });

    this.modalRootEl.querySelectorAll('[data-furn-color-instance]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const el = btn as HTMLElement;
        const instanceId = el.dataset.furnColorInstance!;
        const colorVariant = el.dataset.furnColorVal!;
        this.socket.emit('furniture:color', { instanceId, colorVariant });
      });
    });
  }

  private getItemPriceLabel(item: CosmeticItem): string {
    if (item.realMoneyOnly) return 'R$ 24,90 (Pack)';
    if (item.price === 0) return 'Grátis (0 🪙)';
    const currencyIcon = item.currency === 'COINS' ? '🪙' : '💎';
    return `${item.price} ${currencyIcon}`;
  }

  private renderCatalogItemCard(item: CosmeticItem): string {
    const owned = this.profile!.inventory.includes(item.id);
    const isAdmin = Boolean(this.profile?.isAdmin);
    const isFurniture = item.category === 'furniture';
    const isEquipped =
      item.category !== 'furniture' &&
      this.profile!.equipped[item.category] === item.id;
    const placedInstance = isFurniture
      ? (this.profile!.placedFurniture || []).find((f) => f.itemId === item.id)
      : undefined;
    const currencyIcon = item.currency === 'COINS' ? '🪙' : '💎';
    const rarityLabels: Record<string, string> = {
      COMMON: 'Comum',
      RARE: 'Raro',
      EPIC: 'Épico',
      LEGENDARY: 'Lendário',
    };
    const rarityLabel = rarityLabels[item.rarity] || item.rarity;
    const adminPriceTag = isAdmin
      ? `<span class="rarity-badge" style="background: rgba(250, 204, 21, 0.14); color: var(--accent-gold); border: 1px solid rgba(250, 204, 21, 0.35);" title="Valor configurado no catálogo (visível para validação do Admin)">${this.getItemPriceLabel(item)}</span>`
      : '';

    return `
      <div class="item-card ${isEquipped || placedInstance ? 'equipped' : ''}" title="${this.escapeHtml(item.description)}">
        <div class="item-icon">${item.icon}</div>
        <div class="item-info">
          <div class="item-name">
            ${this.escapeHtml(item.name)}
            <span class="rarity-badge rarity-${item.rarity}">${rarityLabel}</span>
            ${
              item.realMoneyOnly
                ? `<span class="rarity-badge rarity-LEGENDARY" title="Item exclusivo do Double D Pack">💿 Double D</span>`
                : ''
            }
            ${adminPriceTag}
          </div>
        </div>
        <div>
          ${
            owned
              ? isFurniture
                ? placedInstance
                  ? `<button class="btn btn-sm active-toggle" data-furn-remove="${placedInstance.instanceId}" title="Clique para guardar na Mochila">
                      ✓ Na Sala
                    </button>`
                  : `<button class="btn btn-sm btn-primary" data-place-furn="${item.id}">
                      + Colocar
                    </button>`
                : isEquipped
                  ? `<span class="btn btn-sm active-toggle">Em uso</span>`
                  : `<button class="btn btn-sm btn-primary" data-equip-item="${item.id}">Usar</button>`
              : item.realMoneyOnly
                ? `<button class="btn btn-sm btn-gold" data-open-double-d="1" title="Exclusivo do Double D Pack">
                    💿 Ver Pack (R$)
                  </button>`
                : `<button class="btn btn-sm btn-gold" data-buy-item="${item.id}">
                    ${item.price} ${currencyIcon}
                  </button>`
          }
        </div>
        <div class="hover-desc-tooltip">${this.escapeHtml(item.description)}</div>
      </div>
    `;
  }

  private renderFurnitureEditPopup() {
    if (!this.profile) return;
    const placedList = this.room?.placedFurniture || this.profile.placedFurniture || [];
    const placed = placedList.find((f) => f.instanceId === this.editingFurnitureInstanceId);
    if (!placed) {
      this.closeModal();
      return;
    }

    const meta = getCosmeticById(placed.itemId);
    const activeColor = placed.colorVariant || 'default';
    const activeColorMeta =
      FURNITURE_COLOR_PALETTE.find((c) => c.id === activeColor) || FURNITURE_COLOR_PALETTE[0];

    this.mountPopupWindow(
      `
        <div class="popup-header">
          <div class="popup-title">
            <span>${meta?.icon || '🛋️'}</span>
            <span>Editar Móvel: ${this.escapeHtml(meta?.name || placed.itemId)}</span>
          </div>
          <button class="btn btn-icon" id="btn-close-modal">✕</button>
        </div>

        <div class="popup-body" style="gap: 14px;">
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 0.78rem; font-weight: 700; color: var(--text-primary);">
                🎨 Escolha a Cor do Móvel
              </span>
              <span style="font-size: 0.72rem; color: var(--accent-gold); font-weight: 600;">
                Atual: ${this.escapeHtml(activeColorMeta.label)}
              </span>
            </div>

            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
              ${FURNITURE_COLOR_PALETTE.map((col) => {
                const isSelected = activeColor === col.id;
                const swatchBg = col.secondary || meta?.previewColor || '#64748b';
                return `
                  <button
                    class="btn btn-sm ${isSelected ? 'active-toggle' : ''}"
                    data-popup-furn-color="${col.id}"
                    style="display: flex; align-items: center; gap: 6px; justify-content: flex-start; padding: 7px 9px;"
                  >
                    <span
                      style="width: 14px; height: 14px; border-radius: 50%; background: ${swatchBg}; border: 1px solid rgba(255,255,255,0.45); flex-shrink: 0;"
                    ></span>
                    <span style="font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      ${this.escapeHtml(col.label)}
                    </span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border-subtle);">
            <label style="font-size: 0.74rem; color: var(--text-secondary);">
              ↔️ Posição Horizontal na Sala
            </label>
            <input
              type="range"
              min="26"
              max="334"
              value="${Math.round(placed.x)}"
              id="popup-furn-slider"
              style="width: 100%; accent-color: var(--accent);"
            />
          </div>

          <div style="display: flex; justify-content: space-between; gap: 8px; padding-top: 6px;">
            <button class="btn btn-sm btn-primary" id="btn-popup-furn-flip" style="flex: 1; justify-content: center; padding: 8px;">
              🔄 Virar Lado
            </button>
            <button class="btn btn-sm btn-danger" id="btn-popup-furn-remove" style="flex: 1; justify-content: center; padding: 8px;">
              🗑️ Guardar na Mochila
            </button>
          </div>
        </div>
      `,
      '420px'
    );

    this.bindCommonPopupEvents();

    this.modalRootEl.querySelectorAll('[data-popup-furn-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const colorVariant = (btn as HTMLElement).dataset.popupFurnColor!;
        placed.colorVariant = colorVariant;
        this.socket.emit('furniture:color', {
          instanceId: placed.instanceId,
          colorVariant,
        });
        this.renderFurnitureEditPopup();
      });
    });

    document.getElementById('popup-furn-slider')?.addEventListener('input', (e) => {
      const x = Number((e.target as HTMLInputElement).value);
      placed.x = x;
      this.socket.emit('furniture:move', { instanceId: placed.instanceId, x });
    });

    document.getElementById('btn-popup-furn-flip')?.addEventListener('click', () => {
      this.socket.emit('furniture:flip', { instanceId: placed.instanceId });
    });

    document.getElementById('btn-popup-furn-remove')?.addEventListener('click', () => {
      this.socket.emit('furniture:remove', { instanceId: placed.instanceId });
      this.closeModal();
    });
  }

  private bindItemActionButtons() {
    this.modalRootEl.querySelectorAll('[data-equip-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.equipItem!;
        this.socket.emit('inventory:equip', { itemId });
      });
    });

    this.modalRootEl.querySelectorAll('[data-buy-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.buyItem!;
        this.socket.emit('shop:buy', { itemId });
      });
    });

    this.modalRootEl.querySelectorAll('[data-place-furn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.placeFurn!;
        const count = this.room?.placedFurniture?.length || 0;
        const suggestedX = Math.max(36, Math.min(324, 70 + ((count * 55) % 240)));
        this.socket.emit('furniture:place', { itemId, x: suggestedX });
      });
    });

    this.modalRootEl.querySelectorAll('[data-furn-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const instanceId = (btn as HTMLElement).dataset.furnRemove!;
        this.socket.emit('furniture:remove', { instanceId });
      });
    });
  }

  // ------------------------------------------
  // 4. POPUP DE PERFIL / CONTA GOOGLE & NICKNAME
  // ------------------------------------------
  private renderProfilePopup() {
    const currentServerUrl = localStorage.getItem('pc_server_url') || '';
    const isGoogleLinked = Boolean(this.profile?.googleId);
    const googleName = this.profile?.googleName || this.authSession?.googleName || '';
    const googleEmail = this.profile?.email || this.authSession?.email || '';
    const googlePic = this.profile?.picture || this.authSession?.picture || '';

    this.mountPopupWindow(
      `
          <div class="popup-header">
            <div class="popup-title">👤 Minha Conta & Nickname</div>
            <button class="btn btn-icon" id="btn-close-modal">✕</button>
          </div>
          <div class="popup-body">
            <div style="display: flex; flex-direction: column; gap: 12px;">
              ${
                isGoogleLinked
                  ? `<div class="google-account-box">
                      ${
                        googlePic
                          ? `<img src="${this.escapeHtml(googlePic)}" class="google-avatar-img" alt="Google" />`
                          : `<div class="item-icon">🔐</div>`
                      }
                      <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                          <span>${this.escapeHtml(googleName)}</span>
                          ${
                            this.profile?.isAdmin
                              ? `<span class="rarity-badge rarity-LEGENDARY" style="margin-left:0;">🛡️ ADMIN</span>`
                              : ''
                          }
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-secondary);">
                          ${this.escapeHtml(googleEmail || 'Conta Google vinculada')}
                        </div>
                        <div style="font-size: 0.66rem; color: var(--accent-green); margin-top: 2px;">
                          ✓ Conta única vinculada (@${this.escapeHtml(this.profile?.username || '')})
                        </div>
                      </div>
                    </div>`
                  : `<div class="google-account-box">
                      <div class="item-icon">👤</div>
                      <div style="flex: 1;">
                        <div style="font-size: 0.8rem; font-weight: 700;">Sessão Local (@${this.escapeHtml(this.profile?.username || '')})</div>
                        <div style="font-size: 0.7rem; color: var(--text-secondary);">
                          Clique em "Sair da Conta" abaixo se quiser entrar com o Google.
                        </div>
                      </div>
                    </div>`
              }

              ${
                this.profile?.isAdmin
                  ? `
                    <div style="background: rgba(250, 204, 21, 0.1); border: 1px solid rgba(250, 204, 21, 0.4); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;">
                      <div style="font-size: 0.76rem; font-weight: 800; color: var(--accent-gold);">
                        🛡️ Acesso de Administrador Ativo (Validado no Servidor)
                      </div>
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                        <button class="btn btn-sm btn-gold" id="btn-prof-admin-tx" style="justify-content: center;">
                          💳 Ver Transações PIX
                        </button>
                        <button class="btn btn-sm btn-gold" id="btn-prof-admin-purchases" style="justify-content: center;">
                          🛍️ Ver Compras da Loja
                        </button>
                      </div>
                      <button class="btn btn-sm btn-primary" id="btn-prof-admin-test" style="justify-content: center; padding: 7px;">
                        🧪 Testar Qualquer Item / Poderes Admin
                      </button>
                    </div>
                  `
                  : ''
              }

              <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="font-size: 0.74rem; color: var(--text-secondary);">
                  🔒 ID Único Permanente (para amigos te adicionarem — não pode ser alterado)
                </label>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <input
                    type="text"
                    readonly
                    disabled
                    class="chat-input-minimal"
                    style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 9px 12px; color: var(--accent-cyan); font-weight: 700; cursor: not-allowed; opacity: 0.85;"
                    value="@${this.escapeHtml(this.profile?.username || '')}"
                  />
                  <button class="btn btn-sm" id="btn-copy-profile-id" title="Copiar seu @ID único">📋 Copiar</button>
                </div>
              </div>

              <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="font-size: 0.74rem; color: var(--text-secondary);">
                  Nickname que aparece na sala (em cima do bonequinho)
                </label>
                <input
                  type="text"
                  id="modal-displayname"
                  maxlength="24"
                  class="chat-input-minimal"
                  style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 9px 12px;"
                  value="${this.escapeHtml(this.profile?.displayName || '')}"
                />
              </div>

              <div style="display: flex; flex-direction: column; gap: 5px;">
                <label style="font-size: 0.74rem; color: var(--text-secondary);">
                  Servidor Online (opcional)
                </label>
                <input
                  type="text"
                  id="modal-server-url"
                  class="chat-input-minimal"
                  style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 9px 12px;"
                  value="${this.escapeHtml(currentServerUrl)}"
                  placeholder="Padrão local ou https://..."
                />
              </div>

              <div style="font-size: 0.7rem; color: var(--text-muted); display: flex; justify-content: space-between;">
                <span>Banco de Dados:</span>
                <span style="color: ${this.mongoConnected ? 'var(--accent-green)' : 'var(--accent-gold)'};">
                  ${this.mongoConnected ? '☁️ MongoDB Atlas Conectado' : '📁 Local (db.json)'}
                </span>
              </div>

              <button class="btn btn-primary" id="btn-save-profile" style="justify-content: center; padding: 10px;">
                💾 Salvar Nickname
              </button>

              <button class="btn btn-danger" id="btn-logout-account" style="justify-content: center; padding: 9px;">
                🚪 Sair da Conta (Logout)
              </button>
            </div>
          </div>
      `,
      '430px'
    );

    this.bindCommonPopupEvents();

    document.getElementById('btn-prof-admin-tx')?.addEventListener('click', () => {
      this.adminTab = 'TRANSACTIONS';
      this.openModal('ADMIN');
    });

    document.getElementById('btn-prof-admin-purchases')?.addEventListener('click', () => {
      this.adminTab = 'PURCHASES';
      this.openModal('ADMIN');
    });

    document.getElementById('btn-prof-admin-test')?.addEventListener('click', () => {
      this.adminTab = 'TEST_ITEMS';
      this.openModal('ADMIN');
    });

    document.getElementById('btn-copy-profile-id')?.addEventListener('click', () => {
      const myTag = `@${this.profile?.username || ''}`;
      navigator.clipboard.writeText(myTag).then(() => {
        this.showToast('success', `📋 Seu ID único (${myTag}) foi copiado!`);
      });
    });

    document.getElementById('btn-save-profile')?.addEventListener('click', () => {
      const dInp = (document.getElementById('modal-displayname') as HTMLInputElement).value.trim();
      const sInp = (document.getElementById('modal-server-url') as HTMLInputElement).value.trim();
      if (!dInp) return;

      const prevServerUrl = localStorage.getItem('pc_server_url') || '';
      const cleanServerUrl = sInp ? sInp.replace(/\/+$/, '') : '';

      if (cleanServerUrl) {
        localStorage.setItem('pc_server_url', cleanServerUrl);
      } else {
        localStorage.removeItem('pc_server_url');
      }

      if (this.authSession) {
        this.saveAuthSession({
          ...this.authSession,
          displayName: dInp.slice(0, 24),
        });
      }

      this.socket.emit('profile:update_nickname', { displayName: dInp.slice(0, 24) });
      this.closeModal();

      if (prevServerUrl !== cleanServerUrl) {
        this.connectSocket();
      }
    });

    document.getElementById('btn-logout-account')?.addEventListener('click', () => {
      this.logoutAccount();
    });
  }

  // ------------------------------------------
  // 5. POPUP DE ADMINISTRADOR (100% VALIDADO NO BACKEND VIA ADMIN_EMAIL)
  // ------------------------------------------
  private async fetchAdminDashboard() {
    this.adminDashboard.loading = true;
    this.adminDashboard.error = undefined;
    if (this.activeModal === 'ADMIN') {
      this.renderAdminPopup();
    }

    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/admin/dashboard`, {
        method: 'GET',
        headers: this.getAuthHeaders(),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        adminEmail?: string;
        summary?: {
          totalApprovedBrl: number;
          approvedCount: number;
          pendingCount: number;
          totalTransactions: number;
          totalGemsSold: number;
          totalShopPurchases: number;
          totalRegisteredUsers: number;
        };
        paymentTransactions?: PaymentTransactionRecord[];
        shopPurchaseLogs?: ShopPurchaseLogRecord[];
      };

      this.adminDashboard.loading = false;

      if (!res.ok || !data.ok) {
        this.adminDashboard.error =
          data.error || 'Acesso negado pelo servidor (ADMIN_EMAIL não autorizado).';
      } else {
        this.adminDashboard.adminEmail = data.adminEmail;
        this.adminDashboard.summary = data.summary;
        this.adminDashboard.paymentTransactions = data.paymentTransactions || [];
        this.adminDashboard.shopPurchaseLogs = data.shopPurchaseLogs || [];
      }
    } catch (err) {
      this.adminDashboard.loading = false;
      this.adminDashboard.error = `Falha ao consultar servidor: ${(err as Error).message}`;
    }

    if (this.activeModal === 'ADMIN') {
      this.renderAdminPopup();
    }
  }

  private async executeAdminTestAction(
    action: 'UNLOCK_ALL' | 'ADD_COINS' | 'ADD_GEMS' | 'EQUIP_ITEM' | 'EQUIP_DOUBLE_D',
    itemId?: string
  ) {
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/admin/test-action`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ action, itemId }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        profile?: UserProfile;
      };
      if (!res.ok || !data.ok) {
        this.showToast('error', data.error || 'Falha ao executar ação de administrador.');
        return;
      }
      if (data.profile) {
        this.profile = data.profile;
        this.renderTopbar();
        if (this.activeModal === 'ADMIN') {
          this.renderAdminPopup();
        }
      }
    } catch (err) {
      this.showToast('error', `Erro na ação admin: ${(err as Error).message}`);
    }
  }

  private renderAdminPopup() {
    const sum = this.adminDashboard.summary;
    const revenueFormatted = sum ? this.formatBrl(sum.totalApprovedBrl) : 'R$ 0,00';

    const formatDate = (ts?: number) => {
      if (!ts) return '-';
      return new Date(ts).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    this.mountPopupWindow(
      `
        <div class="popup-header">
          <div class="popup-title">
            <span>🛡️</span>
            <span>Painel do Administrador (${this.escapeHtml(this.profile?.email || '')})</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="btn btn-sm btn-primary" id="btn-admin-refresh">🔄 Atualizar</button>
            <button class="btn btn-icon" id="btn-close-modal">✕</button>
          </div>
        </div>

        <div class="popup-tabs">
          <button class="popup-tab ${this.adminTab === 'TRANSACTIONS' ? 'active' : ''}" data-admin-tab="TRANSACTIONS">
            💳 Transações PIX (${this.adminDashboard.paymentTransactions.length})
          </button>
          <button class="popup-tab ${this.adminTab === 'PURCHASES' ? 'active' : ''}" data-admin-tab="PURCHASES">
            🛍️ Compras na Loja (${this.adminDashboard.shopPurchaseLogs.length})
          </button>
          <button class="popup-tab ${this.adminTab === 'TEST_ITEMS' ? 'active' : ''}" data-admin-tab="TEST_ITEMS" style="color: var(--accent-gold);">
            🧪 Testar Itens (${COSMETIC_CATALOG.length})
          </button>
        </div>

        <div class="popup-body">
          ${
            this.adminDashboard.loading
              ? `<div style="padding: 32px; text-align: center; color: var(--text-secondary);">
                  ⏳ Validando credenciais de administrador no servidor e carregando registros...
                </div>`
              : this.adminDashboard.error
                ? `<div style="padding: 24px; text-align: center; color: #f87171; font-weight: 600;">
                    🔒 ${this.escapeHtml(this.adminDashboard.error)}
                  </div>`
                : `
                  <div class="admin-stats-grid">
                    <div class="admin-stat-card">
                      <span class="label">Receita Aprovada (PIX)</span>
                      <span class="val" style="color: #4ade80;">${revenueFormatted}</span>
                    </div>
                    <div class="admin-stat-card">
                      <span class="label">PIX Aprovados / Pendentes</span>
                      <span class="val">${sum?.approvedCount || 0} <span style="font-size:0.75rem; color:var(--text-muted);">/ ${sum?.pendingCount || 0}</span></span>
                    </div>
                    <div class="admin-stat-card">
                      <span class="label">Compras Internas (Loja)</span>
                      <span class="val" style="color: var(--accent-gold);">${sum?.totalShopPurchases || 0}</span>
                    </div>
                    <div class="admin-stat-card">
                      <span class="label">Contas Registradas</span>
                      <span class="val" style="color: var(--accent-cyan);">${sum?.totalRegisteredUsers || 0}</span>
                    </div>
                  </div>

                  ${
                    this.adminTab === 'TRANSACTIONS'
                      ? this.adminDashboard.paymentTransactions.length === 0
                        ? `<div class="empty-hint">Nenhuma transação PIX gerada ainda.</div>`
                        : `
                          <div style="overflow-x: auto;">
                            <table class="admin-table">
                              <thead>
                                <tr>
                                  <th>Data</th>
                                  <th>Jogador / E-mail</th>
                                  <th>Pacote</th>
                                  <th>Valor</th>
                                  <th>Status</th>
                                  <th>ID Mercado Pago</th>
                                </tr>
                              </thead>
                              <tbody>
                                ${this.adminDashboard.paymentTransactions
                                  .map((tx) => {
                                    const statusLabelMap: Record<string, string> = {
                                      APPROVED: 'APROVADO',
                                      PENDING: 'PENDENTE',
                                      CANCELLED: 'CANCELADO',
                                      REJECTED: 'REJEITADO',
                                    };
                                    const statusLabel = statusLabelMap[tx.status] || tx.status;
                                    return `
                                      <tr>
                                        <td>${formatDate(tx.approvedAt || tx.createdAt)}</td>
                                        <td>
                                          <b>${this.escapeHtml(tx.displayName)}</b>
                                          <span style="color:var(--accent-cyan);">@${this.escapeHtml(tx.username)}</span><br/>
                                          <span style="font-size:0.65rem; color:var(--text-muted);">${this.escapeHtml(tx.email || '-')}</span>
                                        </td>
                                        <td>${this.escapeHtml(tx.packageName)}</td>
                                        <td style="font-weight:700; color:var(--accent-gold);">
                                          ${this.formatBrl(tx.amountBrl)}
                                        </td>
                                        <td>
                                          <span class="tx-status-pill tx-status-${tx.status}">
                                            ${statusLabel}
                                          </span>
                                        </td>
                                        <td style="font-family:monospace; font-size:0.66rem; color:var(--text-muted);">
                                          ${this.escapeHtml(tx.mpPaymentId || tx.id)}
                                        </td>
                                      </tr>
                                    `;
                                  })
                                  .join('')}
                              </tbody>
                            </table>
                          </div>
                        `
                      : this.adminTab === 'PURCHASES'
                        ? this.adminDashboard.shopPurchaseLogs.length === 0
                          ? `<div class="empty-hint">Nenhuma compra com Moedas ou Pip Diamantes registrada ainda.</div>`
                          : `
                            <div style="overflow-x: auto;">
                              <table class="admin-table">
                                <thead>
                                  <tr>
                                    <th>Data</th>
                                    <th>Jogador / E-mail</th>
                                    <th>Item Comprado</th>
                                    <th>Origem</th>
                                    <th>Preço Pago</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  ${this.adminDashboard.shopPurchaseLogs
                                    .map(
                                      (log) => `
                                        <tr>
                                          <td>${formatDate(log.createdAt)}</td>
                                          <td>
                                            <b>${this.escapeHtml(log.displayName)}</b>
                                            <span style="color:var(--accent-cyan);">@${this.escapeHtml(log.username)}</span><br/>
                                            <span style="font-size:0.65rem; color:var(--text-muted);">${this.escapeHtml(log.email || '-')}</span>
                                          </td>
                                          <td><b>${log.itemIcon} ${this.escapeHtml(log.itemName)}</b></td>
                                          <td>${log.source === 'GACHAPON' ? '🎰 Cápsula' : '🛍️ Loja'}</td>
                                          <td style="font-weight:700;">
                                            ${log.price} ${log.currency === 'GEMS' ? '💎 Pip Diamantes' : '🪙 Moedas'}
                                          </td>
                                        </tr>
                                      `
                                    )
                                    .join('')}
                                </tbody>
                              </table>
                            </div>
                          `
                        : `
                          <div style="display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; background: rgba(250, 204, 21, 0.08); border: 1px solid rgba(250, 204, 21, 0.3); border-radius: 10px;">
                            <button class="btn btn-sm btn-gold" id="btn-admin-unlock-all">
                              🔓 Liberar Todos os Itens
                            </button>
                            <button class="btn btn-sm btn-gold" id="btn-admin-equip-double-d">
                              💿 Equipar Double D Pack Completo
                            </button>
                            <button class="btn btn-sm btn-primary" id="btn-admin-add-coins">
                              🪙 +1.000 Moedas
                            </button>
                            <button class="btn btn-sm btn-primary" id="btn-admin-add-gems">
                              💎 +500 Pip Diamantes
                            </button>
                          </div>

                          <div class="items-grid">
                            ${COSMETIC_CATALOG.map((item) => {
                              const isEquipped =
                                item.category !== 'furniture' &&
                                this.profile?.equipped[item.category] === item.id;
                              const isPlaced =
                                item.category === 'furniture' &&
                                (this.profile?.placedFurniture || []).some(
                                  (f) => f.itemId === item.id
                                );
                              return `
                                <div class="item-card ${isEquipped || isPlaced ? 'equipped' : ''}" title="${this.escapeHtml(item.description)}">
                                  <div class="item-icon">${item.icon}</div>
                                  <div class="item-info">
                                    <div class="item-name">
                                      ${this.escapeHtml(item.name)}
                                      <span class="rarity-badge" style="background: rgba(250, 204, 21, 0.14); color: var(--accent-gold); border: 1px solid rgba(250, 204, 21, 0.35);">
                                        ${this.getItemPriceLabel(item)}
                                      </span>
                                    </div>
                                  </div>
                                  <div>
                                    <button class="btn btn-sm ${isEquipped || isPlaced ? 'active-toggle' : 'btn-gold'}" data-admin-test-item="${item.id}">
                                      ${isEquipped || isPlaced ? '✓ Ativo' : '⚡ Testar'}
                                    </button>
                                  </div>
                                  <div class="hover-desc-tooltip">${this.escapeHtml(item.description)}</div>
                                </div>
                              `;
                            }).join('')}
                          </div>
                        `
                  }
                `
          }
        </div>
      `,
      '820px'
    );

    this.bindCommonPopupEvents();

    document.getElementById('btn-admin-refresh')?.addEventListener('click', () => {
      void this.fetchAdminDashboard();
    });

    document.getElementById('btn-admin-unlock-all')?.addEventListener('click', () => {
      void this.executeAdminTestAction('UNLOCK_ALL');
    });

    document.getElementById('btn-admin-equip-double-d')?.addEventListener('click', () => {
      void this.executeAdminTestAction('EQUIP_DOUBLE_D');
    });

    document.getElementById('btn-admin-add-coins')?.addEventListener('click', () => {
      void this.executeAdminTestAction('ADD_COINS');
    });

    document.getElementById('btn-admin-add-gems')?.addEventListener('click', () => {
      void this.executeAdminTestAction('ADD_GEMS');
    });

    this.modalRootEl.querySelectorAll('[data-admin-test-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.adminTestItem!;
        void this.executeAdminTestAction('EQUIP_ITEM', itemId);
      });
    });

    this.modalRootEl.querySelectorAll('[data-admin-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.adminTab = (btn as HTMLElement).dataset.adminTab as AdminTab;
        this.renderAdminPopup();
      });
    });
  }

  private bindCommonPopupEvents() {
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'modal-backdrop') {
        this.closeModal();
      }
    });
    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      this.closeModal();
    });
  }

  private showToast(type: 'info' | 'success' | 'warning' | 'error', message: string) {
    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    el.textContent = message;
    this.toastStackEl.appendChild(el);

    setTimeout(() => {
      el.remove();
    }, 3800);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

new PocketCornerApp();
