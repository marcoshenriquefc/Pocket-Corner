import './style.css';
import { io, Socket } from 'socket.io-client';
import {
  COSMETIC_CATALOG,
  FURNITURE_COLOR_PALETTE,
  GACHAPON_COST_COINS,
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
  RoomSnapshot,
  ServerToClientEvents,
  UserProfile,
} from './shared/types';
import { soundEngine } from './audio/soundEngine';
import { getApiBaseUrl, windowBridge } from './bridge/windowBridge';
import { PixelCanvasRenderer } from './renderer/PixelCanvas';

type ActiveModal = 'NONE' | 'SHOP' | 'FRIENDS' | 'BACKPACK' | 'PROFILE';
type ShopTab = 'AVATAR' | 'ROOM' | 'FX' | 'GACHA';
type FriendsTab = 'ONLINE' | 'MY_ROOM' | 'REQUESTS';
type BackpackTab = 'AVATAR' | 'FURNITURE' | 'FX';

interface AuthSession {
  mode: 'google' | 'local';
  googleId?: string;
  email?: string;
  googleName?: string;
  picture?: string;
  username: string;
  displayName: string;
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

  private activeModal: ActiveModal = 'NONE';
  private shopTab: ShopTab = 'AVATAR';
  private friendsTab: FriendsTab = 'ONLINE';
  private backpackTab: BackpackTab = 'AVATAR';

  private selectedTargetUserId: string | null = null;
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

    // Busca configuração de OAuth e status do MongoDB do backend
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/auth/config`);
      if (res.ok) {
        const cfg = (await res.json()) as { googleClientId?: string; mongoConnected?: boolean };
        if (cfg.googleClientId) {
          this.googleClientId = cfg.googleClientId.trim();
        }
        this.mongoConnected = Boolean(cfg.mongoConnected);
      }
    } catch {
      // Ignora erro de rede inicial
    }

    const saved = this.loadSavedSession();
    if (saved) {
      this.authSession = saved;
      this.hideLoginScreen();
      this.connectSocket();
    } else {
      this.renderLoginScreen();
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
        };
      }
    } catch {
      return null;
    }
    return null;
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
    this.renderLoginScreen();
    this.showToast('info', '🚪 Você saiu da sua conta.');
  }

  private hideLoginScreen() {
    if (this.loginScreenRootEl) {
      this.loginScreenRootEl.innerHTML = '';
    }
  }

  private renderLoginScreen() {
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
              : isSecretInsteadOfId
                ? `<div class="login-env-notice">
                    ⚠️ <b>Atenção no arquivo <code>.env</code>:</b><br/>
                    Você colou a <b>Chave Secreta</b> (que começa com <code>GOCSPX-...</code>) no lugar do <b>ID do Cliente</b>.<br/><br/>
                    No Google Cloud, copie o <b>ID do cliente</b> (que começa com <code>614958022711-...</code> e termina com <code>.apps.googleusercontent.com</code>) e cole em <code>GOOGLE_CLIENT_ID</code> e <code>VITE_GOOGLE_CLIENT_ID</code> no arquivo <code>.env</code>!
                  </div>`
                : `<div class="login-env-notice">
                    🔑 <b>Google OAuth aguardando chave:</b><br/>
                    Adicione seu <code>GOOGLE_CLIENT_ID</code> no arquivo <code>.env</code> na raiz do projeto para ativar o login com o Google.
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

      const data = (await res.json()) as { ok?: boolean; profile?: UserProfile; error?: string };
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
        this.socket.emit('player:move', { targetX });
      },
      onJumpRequest: () => {
        this.socket.emit('player:jump');
      },
      onSelectPlayer: (userId) => {
        this.selectedTargetUserId = userId;
      },
      onPokePlayer: (userId) => {
        this.socket.emit('player:interact', {
          targetUserId: userId,
          actionType: 'POKE',
        });
      },
      onClaimDrop: (dropId) => {
        this.socket.emit('desk_drop:claim', { dropId });
      },
      onKickVisitor: (userId) => {
        this.socket.emit('room:kick_visitor', { targetUserId: userId });
      },
      onMoveFurniture: (instanceId, x) => {
        this.socket.emit('furniture:move', { instanceId, x });
      },
      onFlipFurniture: (instanceId) => {
        this.socket.emit('furniture:flip', { instanceId });
      },
      onRemoveFurniture: (instanceId) => {
        this.socket.emit('furniture:remove', { instanceId });
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
      this.socket.emit('player:chat', { text });
      chatInput.value = '';
    };

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChat();
      }
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
      if (this.activeModal !== 'NONE') {
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
      this.room = snapshot;
      this.renderer.updateRoom(snapshot);
      this.renderTopbar();
      this.renderKnockBanner();
      this.renderFloatingDock();
      if (this.activeModal !== 'NONE') {
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
        const nextX = Math.max(24, me.targetX - 28);
        me.targetX = nextX;
        me.facing = 'left';
        this.socket.emit('player:move', { targetX: nextX });
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        const nextX = Math.min(336, me.targetX + 28);
        me.targetX = nextX;
        me.facing = 'right';
        this.socket.emit('player:move', { targetX: nextX });
      } else if (e.key === ' ' || e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') {
        e.preventDefault();
        this.renderer.triggerJump(this.profile.id);
        this.socket.emit('player:jump');
      }
    });

    window.addEventListener('blur', () => {
      if (!this.autoIdleOnBlur || !this.profile) return;
      if (this.profile.hostStatus === 'ACTIVE') {
        this.socket.emit('host:set_status', { status: 'IDLE' });
      }
    });

    window.addEventListener('focus', () => {
      if (!this.autoIdleOnBlur || !this.profile) return;
      if (this.profile.hostStatus === 'IDLE') {
        this.socket.emit('host:set_status', { status: 'ACTIVE' });
      }
    });

    setInterval(() => {
      if (this.room && this.room.pendingKnocks.length > 0) {
        this.renderKnockBanner();
      }
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
        <span class="currency-pill coins" title="Moedas Idle">🪙 ${this.profile.coins}</span>
        <span class="currency-pill gems" title="Gems">💎 ${this.profile.gems}</span>
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
    } else {
      this.modalRootEl.innerHTML = '';
    }
  }

  // ------------------------------------------
  // 1. POPUP "🛍️ LOJA" (Com Abas em vez de filtros)
  // ------------------------------------------
  private renderShopPopup() {
    if (!this.profile) return;

    const categoryGroups: Record<ShopTab, CosmeticCategory[]> = {
      AVATAR: ['avatar_body', 'avatar_head', 'avatar_back'],
      ROOM: ['furniture', 'room_skin'],
      FX: ['spawn_fx', 'chat_skin', 'throwable', 'desk_drop'],
      GACHA: [],
    };

    const items =
      this.shopTab === 'GACHA'
        ? []
        : COSMETIC_CATALOG.filter((it) =>
            categoryGroups[this.shopTab].includes(it.category)
          );

    this.modalRootEl.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="popup-window">
          <div class="popup-header">
            <div class="popup-title">
              <span>🛍️</span>
              <span>Loja</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="currency-pill coins">🪙 ${this.profile.coins}</span>
              <span class="currency-pill gems">💎 ${this.profile.gems}</span>
              <button class="btn btn-sm btn-gold" id="btn-shop-free-coins">+Moedas Grátis</button>
              <button class="btn btn-icon" id="btn-close-modal">✕</button>
            </div>
          </div>

          <div class="popup-tabs">
            <button class="popup-tab ${this.shopTab === 'AVATAR' ? 'active' : ''}" data-shop-tab="AVATAR">
              🧑 Roupas & Visual
            </button>
            <button class="popup-tab ${this.shopTab === 'ROOM' ? 'active' : ''}" data-shop-tab="ROOM">
              🛋️ Móveis & Cenários
            </button>
            <button class="popup-tab ${this.shopTab === 'FX' ? 'active' : ''}" data-shop-tab="FX">
              ✨ Efeitos & Brinquedos
            </button>
            <button class="popup-tab ${this.shopTab === 'GACHA' ? 'active' : ''}" data-shop-tab="GACHA">
              🎰 Gachapon
            </button>
          </div>

          <div class="popup-body">
            ${
              this.shopTab === 'GACHA'
                ? `
                  <div style="text-align: center; padding: 28px 16px; display: flex; flex-direction: column; align-items: center; gap: 14px;">
                    <div style="font-size: 3rem;">🎰</div>
                    <div style="font-size: 1rem; font-weight: 700; color: var(--accent-gold);">
                      Máquina de Cápsulas Surpresa
                    </div>
                    <div style="font-size: 0.8rem; color: var(--text-secondary); max-width: 420px;">
                      Sorteie qualquer cosmético do catálogo usando suas Moedas Idle! Itens repetidos devolvem metade do valor.
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
        </div>
      </div>
    `;

    this.bindCommonPopupEvents();

    document.getElementById('btn-shop-free-coins')?.addEventListener('click', () => {
      this.socket.emit('economy:claim_starter_pack');
    });

    document.getElementById('btn-roll-gachapon')?.addEventListener('click', () => {
      this.socket.emit('shop:gachapon');
    });

    this.modalRootEl.querySelectorAll('[data-shop-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.shopTab = (btn as HTMLElement).dataset.shopTab as ShopTab;
        this.renderShopPopup();
      });
    });

    this.bindItemActionButtons();
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

    this.modalRootEl.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="popup-window">
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
                                        : `<button class="btn btn-sm" data-request-friend="${entry.username}">+Amigo</button>`
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
                          <button class="btn btn-sm ${this.profile.hostStatus === 'ACTIVE' ? 'active-toggle' : ''}" data-status="ACTIVE">🟢 Ativo</button>
                          <button class="btn btn-sm ${this.profile.hostStatus === 'IDLE' ? 'active-toggle' : ''}" data-idle="COFFEE">☕ Café</button>
                          <button class="btn btn-sm" data-idle="TYPING">⌨️ Digitar</button>
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
                    <div style="display: flex; gap: 8px;">
                      <input
                        type="text"
                        id="input-friend-username"
                        class="chat-input-minimal"
                        style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 12px;"
                        placeholder="Digite o @username do amigo..."
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
        </div>
      </div>
    `;

    this.bindCommonPopupEvents();

    this.modalRootEl.querySelectorAll('[data-friends-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.friendsTab = (btn as HTMLElement).dataset.friendsTab as FriendsTab;
        this.renderFriendsPopup();
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

    document.getElementById('btn-add-friend')?.addEventListener('click', () => {
      const inp = document.getElementById('input-friend-username') as HTMLInputElement;
      const val = inp?.value.trim();
      if (!val) return;
      this.socket.emit('friends:add', { usernameOrId: val });
      inp.value = '';
    });

    this.modalRootEl.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const status = (btn as HTMLElement).dataset.status as HostStatus;
        this.socket.emit('host:set_status', { status });
      });
    });

    this.modalRootEl.querySelectorAll('[data-idle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idleActivity = (btn as HTMLElement).dataset.idle as IdleActivity;
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

    this.modalRootEl.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="popup-window">
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
        </div>
      </div>
    `;

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

  private renderCatalogItemCard(item: CosmeticItem): string {
    const owned = this.profile!.inventory.includes(item.id);
    const isFurniture = item.category === 'furniture';
    const isEquipped =
      item.category !== 'furniture' &&
      this.profile!.equipped[item.category] === item.id;
    const placedInstance = isFurniture
      ? (this.profile!.placedFurniture || []).find((f) => f.itemId === item.id)
      : undefined;
    const currencyIcon = item.currency === 'COINS' ? '🪙' : '💎';

    return `
      <div class="item-card ${isEquipped || placedInstance ? 'equipped' : ''}">
        <div class="item-icon">${item.icon}</div>
        <div class="item-info">
          <div class="item-name">${this.escapeHtml(item.name)}</div>
          <div class="item-sub">${this.escapeHtml(item.description)}</div>
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
              : `<button class="btn btn-sm btn-gold" data-buy-item="${item.id}">
                  ${item.price} ${currencyIcon}
                </button>`
          }
        </div>
      </div>
    `;
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

    this.modalRootEl.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="popup-window" style="max-width: 430px;">
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
                        <div style="font-size: 0.8rem; font-weight: 700; color: var(--text-primary);">
                          ${this.escapeHtml(googleName)}
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
        </div>
      </div>
    `;

    this.bindCommonPopupEvents();

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
