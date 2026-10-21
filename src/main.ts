import './style.css';
import { io, Socket } from 'socket.io-client';
import {
  COSMETIC_CATALOG,
  GACHAPON_COST_COINS,
  getCosmeticById,
} from './shared/catalog';
import {
  ClientToServerEvents,
  CosmeticCategory,
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

const CATEGORY_LABELS: Record<CosmeticCategory | 'ALL', string> = {
  ALL: '✨ Todos',
  furniture: '🛋️ Móveis',
  avatar_body: '🧑 Corpo',
  avatar_head: '🎩 Cabeça',
  avatar_back: '🎒 Costas',
  spawn_fx: '⚡ Entrada (FX)',
  chat_skin: '💬 Balão Chat',
  throwable: '✈️ Brinquedo',
  room_skin: '🏠 Cenário',
  desk_drop: '☕ Presente AFK',
};

class PocketCornerApp {
  private socket!: Socket<ServerToClientEvents, ClientToServerEvents>;
  private renderer!: PixelCanvasRenderer;

  private profile: UserProfile | null = null;
  private room: RoomSnapshot | null = null;
  private directory: OnlineDirectoryEntry[] = [];

  private activeTab: 'friends' | 'wardrobe' | 'shop' = 'friends';
  private selectedCategory: CosmeticCategory | 'ALL' = 'ALL';
  private selectedTargetUserId: string | null = null;
  private autoIdleOnBlur = true;
  private showAccountModal = false;
  private showShopModal = false;
  private shopModalFilter: 'ALL' | 'OWNED' | 'UNOWNED' = 'ALL';
  private shopModalCategory: CosmeticCategory | 'ALL' = 'ALL';
  private previewAnimId = 0;
  private pendingVisitParam: string | null = null;

  // DOM references
  private stageWidgetEl!: HTMLElement;
  private stagePlaceholderEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private stageTopBarEl!: HTMLElement;
  private knockBannerContainerEl!: HTMLElement;
  private hoverTooltipEl!: HTMLElement;
  private controlsPanelEl!: HTMLElement;
  private sidebarContentEl!: HTMLElement;
  private toastStackEl!: HTMLElement;
  private modalRootEl!: HTMLElement;

  constructor() {
    this.initIdentityAndDOM();
    this.connectSocket();
    this.setupKeyboardAndFocusListeners();
  }

  private getInitialIdentity(): { username: string; displayName: string } {
    const params = new URLSearchParams(window.location.search);
    const urlUser = params.get('user');
    const urlVisit = params.get('visit');
    if (urlVisit) {
      this.pendingVisitParam = urlVisit;
    }

    if (urlUser && urlUser.trim()) {
      const clean = urlUser.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      sessionStorage.setItem('pc_username', clean);
      sessionStorage.setItem('pc_displayName', urlUser.trim());
      return { username: clean, displayName: urlUser.trim() };
    }

    const sessionUser = sessionStorage.getItem('pc_username');
    const sessionDisplay = sessionStorage.getItem('pc_displayName');
    if (sessionUser) {
      return { username: sessionUser, displayName: sessionDisplay || sessionUser };
    }

    const localUser = localStorage.getItem('pc_username');
    const localDisplay = localStorage.getItem('pc_displayName');
    if (localUser) {
      sessionStorage.setItem('pc_username', localUser);
      sessionStorage.setItem('pc_displayName', localDisplay || localUser);
      return { username: localUser, displayName: localDisplay || localUser };
    }

    const randomSuffix = Math.floor(100 + Math.random() * 899);
    const defaultUser = `dev_${randomSuffix}`;
    const defaultDisplay = `Dev #${randomSuffix}`;
    localStorage.setItem('pc_username', defaultUser);
    localStorage.setItem('pc_displayName', defaultDisplay);
    sessionStorage.setItem('pc_username', defaultUser);
    sessionStorage.setItem('pc_displayName', defaultDisplay);
    return { username: defaultUser, displayName: defaultDisplay };
  }

  private initIdentityAndDOM() {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="app-shell">
        <header class="dashboard-header" id="dashboard-header"></header>

        <div class="main-grid">
          <div class="stage-column">
            <div class="stage-placeholder" id="stage-placeholder">
              <div class="pip-active-notice">
                <div style="font-size: 2rem;">🪟</div>
                <div style="font-weight: 700; color: #f8fafc;">
                  Seu Cantinho está aberto em modo Picture-in-Picture (Sempre no Topo)!
                </div>
                <div style="font-size: 0.8rem;">
                  Você pode continuar usando a Loja, Guarda-Roupa e Lista de Amigos por aqui enquanto interage na mini-janela.
                </div>
                <button class="btn btn-primary" id="btn-restore-pip">
                  Trazer Cantinho de volta para a página
                </button>
              </div>

              <!-- O Widget que pode ir para dentro da janela Document PiP -->
              <div class="pocket-stage-widget" id="pocket-stage-widget">
                <div class="stage-top-bar" id="stage-top-bar"></div>

                <div class="canvas-viewport">
                  <canvas id="pocket-canvas" width="360" height="180"></canvas>
                  <div id="knock-banner-container"></div>
                  <div class="canvas-hover-tooltip" id="canvas-hover-tooltip" style="display: none;"></div>
                </div>

                <!-- Mini barra que vai junto para o Picture-in-Picture e Modo Barra de Tarefas -->
                <div class="pip-mini-bar" id="pip-mini-bar">
                  <input
                    type="text"
                    id="chat-input"
                    class="chat-input-box"
                    maxlength="80"
                    placeholder="💬 Falar (Enter)..."
                  />
                  <button class="btn btn-primary btn-sm" id="btn-send-chat" title="Enviar Balão (6s, máx 1 a cada 2s)">
                    💬
                  </button>
                  <button class="btn btn-sm" id="btn-quick-poke" title="Cutucar (Poke - cooldown 3s)">
                    👆
                  </button>
                  <button class="btn btn-sm" id="btn-quick-throw" title="Arremessar Brinquedo (cooldown 3s)">
                    ✈️
                  </button>
                  <button class="btn btn-sm" id="btn-quick-gift" title="Deixar Presente AFK no chão">
                    ☕
                  </button>
                  <button class="btn btn-sm btn-danger" id="btn-quick-kick-visitor" title="Expulsar o amigo/visitante selecionado da sua sala">
                    👢
                  </button>
                  <button class="btn btn-danger btn-sm" id="btn-quick-panic" title="Botão de Pânico: Expulsar todos e fechar cortina (DND)">
                    🚨
                  </button>
                  <button class="btn btn-sm" id="btn-quick-furniture" title="Alternar Modo Arrastar Móveis (arraste com botão esquerdo, gire com botão direito)">
                    🛋️
                  </button>
                  <button class="btn btn-sm btn-gold" id="btn-quick-shop-modal" title="Abrir Popup de Loja & Personalizar Pocket Player">
                    🛒
                  </button>
                  <button class="btn btn-sm" id="btn-quick-transparent" title="Alternar Fundo Transparente (Só Piso + Bonequinho) vs Cenário">
                    👻
                  </button>
                  ${
                    windowBridge.isDesktopWidgetMode
                      ? `
                        <button class="btn btn-sm" id="btn-dock-left" title="Colar no canto esquerdo da Barra de Tarefas">⬅️</button>
                        <button class="btn btn-sm" id="btn-dock-right" title="Colar no canto direito da Barra de Tarefas">➡️</button>
                      `
                      : ''
                  }
                </div>

                <div class="stage-controls-panel" id="stage-controls-panel"></div>
              </div>
            </div>
          </div>

          <aside class="dashboard-sidebar">
            <div class="tabs-header">
              <button class="tab-btn active" data-tab="friends" id="tab-btn-friends">
                👥 Salas & Amigos
              </button>
              <button class="tab-btn" data-tab="wardrobe" id="tab-btn-wardrobe">
                🎒 Inventário
              </button>
              <button class="tab-btn" data-tab="shop" id="tab-btn-shop">
                🛒 Loja & Gacha
              </button>
            </div>
            <div class="tab-content" id="sidebar-content"></div>
          </aside>
        </div>
      </div>

      <div class="toast-stack" id="toast-stack"></div>
      <div id="modal-root"></div>
    `;

    this.stageWidgetEl = document.getElementById('pocket-stage-widget')!;
    this.stagePlaceholderEl = document.getElementById('stage-placeholder')!;
    this.headerEl = document.getElementById('dashboard-header')!;
    this.stageTopBarEl = document.getElementById('stage-top-bar')!;
    this.knockBannerContainerEl = document.getElementById('knock-banner-container')!;
    this.hoverTooltipEl = document.getElementById('canvas-hover-tooltip')!;
    this.controlsPanelEl = document.getElementById('stage-controls-panel')!;
    this.sidebarContentEl = document.getElementById('sidebar-content')!;
    this.toastStackEl = document.getElementById('toast-stack')!;
    this.modalRootEl = document.getElementById('modal-root')!;

    // Ensure hovering over the mini-bar or knock alert disables click-through in Desktop Overlay mode
    const miniBarEl = document.getElementById('pip-mini-bar')!;
    miniBarEl.addEventListener('mouseenter', () => {
      windowBridge.setClickThrough(false);
    });
    this.knockBannerContainerEl.addEventListener('mouseenter', () => {
      windowBridge.setClickThrough(false);
    });

    document.getElementById('btn-quick-furniture')?.addEventListener('click', () => {
      const next = this.renderer.toggleEditFurnitureMode();
      document
        .getElementById('btn-quick-furniture')
        ?.classList.toggle('active-toggle', next);
      this.renderControlsPanel();
      this.showToast(
        'info',
        next
          ? '🛋️ Modo Arrastar Móveis ATIVO: arraste os móveis na sala ou clique com botão direito para virar!'
          : '🛋️ Posição dos móveis salva!'
      );
    });

    document.getElementById('btn-quick-shop-modal')?.addEventListener('click', () => {
      this.openShopModal();
    });

    document.getElementById('btn-quick-transparent')?.addEventListener('click', () => {
      windowBridge.toggleTransparentOverlay();
    });

    document.getElementById('btn-dock-left')?.addEventListener('click', () => {
      windowBridge.dockToCorner('bottom-left');
    });
    document.getElementById('btn-dock-right')?.addEventListener('click', () => {
      windowBridge.dockToCorner('bottom-right');
    });

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
        this.renderControlsPanel();
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

    document.getElementById('btn-send-chat')!.addEventListener('click', sendChat);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChat();
      }
    });

    document.getElementById('btn-quick-poke')!.addEventListener('click', () => {
      const targetId = this.getEffectiveTargetUserId();
      this.socket.emit('player:interact', { targetUserId: targetId, actionType: 'POKE' });
    });

    document.getElementById('btn-quick-throw')!.addEventListener('click', () => {
      const targetId = this.getEffectiveTargetUserId();
      this.socket.emit('player:interact', {
        targetUserId: targetId,
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

    document.getElementById('btn-quick-kick-visitor')!.addEventListener('click', () => {
      const targetId = this.getEffectiveTargetUserId();
      if (!targetId || targetId === this.profile?.id) {
        this.showToast('warning', 'Nenhum visitante na sua sala para expulsar no momento.');
        return;
      }
      this.socket.emit('room:kick_visitor', { targetUserId: targetId });
    });

    // 6.5. Botão de Pânico ("Expulsar / Fechar Cortina")
    document.getElementById('btn-quick-panic')!.addEventListener('click', () => {
      this.socket.emit('room:kick_all');
    });

    document.getElementById('btn-restore-pip')!.addEventListener('click', () => {
      windowBridge.togglePictureInPicture(this.stageWidgetEl, this.stagePlaceholderEl);
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = (btn as HTMLElement).dataset.tab as 'friends' | 'wardrobe' | 'shop';
        this.activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderSidebar();
      });
    });

    windowBridge.onModeChange(() => {
      this.renderHeader();
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
    const identity = this.getInitialIdentity();

    if (this.socket) {
      this.socket.disconnect();
    }

    const baseUrl = getApiBaseUrl();
    const socketOpts = {
      auth: {
        username: identity.username,
        displayName: identity.displayName,
      },
    };
    this.socket = baseUrl ? io(baseUrl, socketOpts) : io(socketOpts);

    this.socket.on('auth:profile', (profile) => {
      this.profile = profile;
      this.renderer.setIdentity(profile.id);
      this.renderHeader();
      this.renderControlsPanel();
      this.renderSidebar();
      if (this.showShopModal) {
        this.renderShopModal();
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
      this.renderStageTopBar();
      this.renderKnockBanner();
      this.renderControlsPanel();
      if (this.activeTab === 'friends') {
        this.renderFriendsTab();
      }
      if (this.showShopModal) {
        this.renderShopModal();
      }
    });

    // 5.2. Broadcast de chegada de visitante (room:user_joined)
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
      if (this.activeTab === 'friends') {
        this.renderSidebar();
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
        `🔔 TOC-TOC! ${knock.visitorDisplayName} está espiando na borda da sua janela (30s)!`
      );
      this.renderKnockBanner();
    });

    this.socket.on('room:knock_result', ({ hostDisplayName, accepted, reason }) => {
      if (accepted) {
        this.showToast('success', `🚪 ${hostDisplayName} abriu a porta para você!`);
      } else {
        this.showToast(
          'warning',
          `🚪 Não foi possível entrar no cantinho de ${hostDisplayName}: ${reason || 'Recusado'}`
        );
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
          ? `🎰 Gachapon: ${item.icon} ${item.name} (Repetido! +${refundCoins} 🪙 de reembolso)`
          : `🎰 GACHAPON! Você ganhou ${item.icon} ${item.name} (${item.rarity})!`
      );
      this.renderSidebar();
      if (this.showShopModal) {
        this.renderShopModal();
      }
    });

    this.socket.on('system:toast', ({ type, message }) => {
      this.showToast(type, message);
    });
  }

  private setupKeyboardAndFocusListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.showShopModal) {
        this.closeShopModal();
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

  private renderHeader() {
    if (!this.profile) return;
    const isPiP = Boolean(windowBridge.pipWindow && !windowBridge.pipWindow.closed);
    const isVideoPiP = windowBridge.videoPipActive;
    const isCornerDock = windowBridge.isBrowserCornerDocked;

    this.headerEl.innerHTML = `
      <div class="brand-block">
        <div class="brand-logo">
          <span>🕹️</span>
          <span>POCKET CORNER</span>
        </div>
        <div class="user-pill">
          <span style="color: var(--accent-green);">●</span>
          <strong>${this.escapeHtml(this.profile.displayName)}</strong>
          <span style="color: var(--text-muted);">@${this.escapeHtml(this.profile.username)}</span>
          <button class="btn btn-sm" id="btn-switch-user" title="Trocar de conta ou criar outro perfil">
            🔄 Trocar Perfil
          </button>
        </div>
      </div>

      <div class="header-actions">
        <div class="currency-badge coins" title="Moeda Idle (ganha passivamente mantendo o cantinho aberto ou recebendo visitas)">
          🪙 <span id="coins-count">${this.profile.coins}</span>
        </div>
        <div class="currency-badge gems" title="Moeda Premium para itens exclusivos e lendários">
          💎 <span id="gems-count">${this.profile.gems}</span>
        </div>
        <button class="btn btn-sm btn-gold" id="btn-open-shop-modal" title="Abre o Popup de Loja & Personalização do seu Pocket Player!">
          🛒 Loja / Personalizar Player
        </button>
        <button class="btn btn-sm" id="btn-starter-pack" title="Resgatar +300 Moedas Idle e +250 Gems para testar a loja!">
          🎁 +Moedas
        </button>
        <button class="btn btn-sm ${soundEngine.muted ? '' : 'active-toggle'}" id="btn-toggle-mute">
          ${soundEngine.muted ? '🔇' : '🔊'}
        </button>
        <button class="btn btn-sm ${isCornerDock ? 'active-toggle' : ''}" id="btn-corner-dock" title="Deixa o bonequinho transparente e sem bordas flutuando no canto inferior do navegador!">
          📌 ${isCornerDock ? 'Voltar ao Painel' : 'Canto Transparente (Aba)'}
        </button>
        <button class="btn btn-sm ${isVideoPiP ? 'active-toggle' : ''}" id="btn-video-pip" title="Abre janela flutuante 100% SEM BARRA DE TÍTULO e sem bordas via navegador!">
          📺 ${isVideoPiP ? 'Sair PiP Sem Borda' : 'PiP Sem Barra de Título'}
        </button>
        <button class="btn btn-pip btn-sm" id="btn-open-pip" title="Abre a mini-janela interativa sempre no topo (controles só aparecem ao passar o mouse)">
          🪟 ${isPiP ? 'Fechar PiP' : 'PiP Interativo'}
        </button>
        <button class="btn btn-primary btn-sm" id="btn-native-taskbar" title="Abre o bonequinho 100% transparente sobre a Barra de Tarefas do Windows com 1 clique pelo navegador (sem usar terminal!)">
          👻 Destacar na Barra de Tarefas
        </button>
      </div>
    `;

    document.getElementById('btn-switch-user')?.addEventListener('click', () => {
      this.showAccountModal = true;
      this.renderAccountModal();
    });

    document.getElementById('btn-open-shop-modal')?.addEventListener('click', () => {
      this.openShopModal();
    });

    document.getElementById('btn-starter-pack')?.addEventListener('click', () => {
      this.socket.emit('economy:claim_starter_pack');
    });

    document.getElementById('btn-toggle-mute')?.addEventListener('click', () => {
      soundEngine.muted = !soundEngine.muted;
      this.renderHeader();
    });

    document.getElementById('btn-corner-dock')?.addEventListener('click', () => {
      windowBridge.toggleBrowserCornerDock();
    });

    document.getElementById('btn-video-pip')?.addEventListener('click', async () => {
      try {
        const canvas = document.getElementById('pocket-canvas') as HTMLCanvasElement;
        await windowBridge.toggleBorderlessVideoPiP(canvas);
      } catch (err) {
        this.showToast('warning', (err as Error).message);
      }
    });

    document.getElementById('btn-open-pip')?.addEventListener('click', async () => {
      try {
        await windowBridge.togglePictureInPicture(
          this.stageWidgetEl,
          this.stagePlaceholderEl
        );
      } catch (err) {
        this.showToast('warning', (err as Error).message);
      }
    });

    document.getElementById('btn-native-taskbar')?.addEventListener('click', async () => {
      try {
        const res = await windowBridge.toggleNativeTaskbarFromBrowser(
          this.profile?.username
        );
        this.showToast(res.active ? 'success' : 'info', res.message);
      } catch (err) {
        this.showToast('error', (err as Error).message);
      }
    });
  }

  private renderStageTopBar() {
    if (!this.room || !this.profile) return;
    const isMyRoom = this.room.hostUserId === this.profile.id;
    const totalAvatars = this.room.players.length;
    const statusIcon =
      this.room.hostStatus === 'DND'
        ? '🔒 DND'
        : this.room.hostStatus === 'IDLE'
          ? '🌙 IDLE'
          : '🟢 ATIVO';
    const doorIcon = this.room.doorPermission === 'OPEN' ? '🚪 Porta Aberta' : '🔔 Porta Toc-Toc';

    this.stageTopBarEl.innerHTML = `
      <div class="room-title-badge">
        <span>${isMyRoom ? '🏠 Meu Cantinho' : `🚀 Cantinho de ${this.escapeHtml(this.room.hostDisplayName)}`}</span>
        <span class="capacity-pill">${totalAvatars}/5 avatares</span>
        <span class="capacity-pill">${statusIcon}</span>
        <span class="capacity-pill">${doorIcon}</span>
      </div>
      <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
        <button class="btn btn-sm btn-gold" id="btn-stage-shop-modal" title="Abrir Popup de Loja & Personalizar seu Pocket Player">
          🛒 Loja
        </button>
        ${
          !isMyRoom
            ? `<button class="btn btn-sm btn-primary" id="btn-return-home">🏠 Voltar pro Meu Cantinho</button>`
            : `<button class="btn btn-sm" id="btn-copy-invite" title="Copia link direto para seu amigo abrir e entrar no seu cantinho!">🔗 Copiar Link Convite</button>`
        }
        <button class="btn btn-sm btn-danger" id="btn-panic-kick" title="6.5. Botão de Pânico: Expulsa instantaneamente todos os visitantes e ativa DND">
          🚨 Fechar Cortina (Pânico)
        </button>
      </div>
    `;

    document.getElementById('btn-stage-shop-modal')?.addEventListener('click', () => {
      this.openShopModal();
    });

    document.getElementById('btn-return-home')?.addEventListener('click', () => {
      this.socket.emit('room:leave_visit');
    });

    document.getElementById('btn-copy-invite')?.addEventListener('click', () => {
      const url = `${window.location.origin}${window.location.pathname}?visit=${encodeURIComponent(
        this.profile?.username || ''
      )}`;
      navigator.clipboard.writeText(url).then(() => {
        this.showToast('success', `🔗 Link copiado! Envie para seu amigo: ${url}`);
      });
    });

    document.getElementById('btn-panic-kick')?.addEventListener('click', () => {
      this.socket.emit('room:kick_all');
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
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--accent-gold);">
            🔔 ${this.escapeHtml(knock.visitorDisplayName)} bateu na porta!
          </div>
          <div style="font-size: 0.68rem; color: var(--text-muted);">
            Espiando na janela • expira em ${secsLeft}s
          </div>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-knock-accept">Aceitar</button>
        <button class="btn btn-sm btn-danger" id="btn-knock-reject">Ignorar</button>
      </div>
    `;

    document.getElementById('btn-knock-accept')?.addEventListener('click', () => {
      this.socket.emit('room:knock_respond', { knockId: knock.id, accept: true });
    });

    document.getElementById('btn-knock-reject')?.addEventListener('click', () => {
      this.socket.emit('room:knock_respond', { knockId: knock.id, accept: false });
    });
  }

  private renderControlsPanel() {
    if (!this.profile || !this.room) return;

    const myStatus = this.profile.hostStatus;
    const myDoor = this.profile.doorPermission;
    const meInRoom = this.room.players.find((p) => p.userId === this.profile?.id);
    const currentIdleAct = meInRoom?.idleActivity || 'COFFEE';

    const otherPlayers = this.room.players.filter((p) => p.userId !== this.profile?.id);
    const currentTargetId = this.getEffectiveTargetUserId();

    const equippedThrowable = getCosmeticById(this.profile.equipped.throwable);
    const equippedDrop = getCosmeticById(this.profile.equipped.desk_drop);
    const isMyRoom = this.room.hostUserId === this.profile.id;
    const isEditFurn = this.renderer?.editFurnitureMode || false;
    const ownedFurnitureItems = COSMETIC_CATALOG.filter(
      (item) => item.category === 'furniture' && this.profile!.inventory.includes(item.id)
    );
    const placedList = this.room.placedFurniture || [];

    this.controlsPanelEl.innerHTML = `
      <!-- 1. Estado do Host & Animações Idle -->
      <div class="control-group">
        <div class="control-group-title">2.1. Meu Estado & Ação Idle</div>
        <div class="btn-row">
          <button class="btn btn-sm ${myStatus === 'ACTIVE' ? 'active-toggle' : ''}" data-status="ACTIVE">
            🟢 ACTIVE
          </button>
          <button class="btn btn-sm ${myStatus === 'IDLE' ? 'active-toggle' : ''}" data-status="IDLE">
            🌙 IDLE
          </button>
          <button class="btn btn-sm ${myStatus === 'DND' ? 'active-toggle' : ''}" data-status="DND" title="Tranca a sala; amigos só podem deixar presentes AFK">
            🔒 DND
          </button>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm ${currentIdleAct === 'COFFEE' && myStatus === 'IDLE' ? 'active-toggle' : ''}" data-idle="COFFEE">
            ☕ Café
          </button>
          <button class="btn btn-sm ${currentIdleAct === 'TYPING' && myStatus === 'IDLE' ? 'active-toggle' : ''}" data-idle="TYPING">
            ⌨️ Digitar
          </button>
          <button class="btn btn-sm ${currentIdleAct === 'SLEEPING' && myStatus === 'IDLE' ? 'active-toggle' : ''}" data-idle="SLEEPING">
            💤 Cochilar
          </button>
          <button class="btn btn-sm ${currentIdleAct === 'FISHING' && myStatus === 'IDLE' ? 'active-toggle' : ''}" data-idle="FISHING">
            🎣 Pescar
          </button>
        </div>
      </div>

      <!-- 2. Permissão da Porta & Simulador de Visita -->
      <div class="control-group">
        <div class="control-group-title">2.2. Porta da Sala (Máx 4 Visitantes)</div>
        <div class="btn-row">
          <button class="btn btn-sm ${myDoor === 'OPEN' ? 'active-toggle' : ''}" data-door="OPEN">
            🚪 OPEN (Entrada Direta)
          </button>
          <button class="btn btn-sm ${myDoor === 'KNOCK' ? 'active-toggle' : ''}" data-door="KNOCK">
            🔔 KNOCK (Toc-Toc 30s)
          </button>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm btn-primary" id="btn-summon-bot">
            🐦 Simular Visita do Pipoca (Bot)
          </button>
        </div>
        ${
          isMyRoom && otherPlayers.length > 0
            ? `
              <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border-pixel);">
                <div style="font-size: 0.68rem; color: var(--accent-gold); margin-bottom: 4px; font-weight: 700;">
                  👥 Visitantes na sua sala (${otherPlayers.length}):
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                  ${otherPlayers
                    .map(
                      (vis) => `
                        <div style="display: inline-flex; align-items: center; gap: 4px; background: #0b1120; border: 1px solid ${
                          vis.userId === currentTargetId ? 'var(--accent-cyan)' : 'var(--border-pixel)'
                        }; border-radius: 6px; padding: 2px 6px;">
                          <button class="btn btn-sm" data-select-visitor="${vis.userId}" style="padding: 1px 5px; font-size: 0.7rem;" title="Selecionar este amigo como alvo">
                            🎯 ${this.escapeHtml(vis.displayName)}
                          </button>
                          <button class="btn btn-sm btn-danger" data-kick-visitor="${vis.userId}" style="padding: 1px 6px; font-size: 0.7rem;" title="Expulsar ${this.escapeHtml(vis.displayName)} da sua sala">
                            👢 Expulsar
                          </button>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              </div>
            `
            : ''
        }
      </div>

      <!-- 3. Microinterações Caóticas na Sala -->
      <div class="control-group">
        <div class="control-group-title">
          Interações na Sala (Cooldown 3s)
          ${
            otherPlayers.length > 0
              ? `• Alvo: ${this.escapeHtml(
                  this.room.players.find((p) => p.userId === currentTargetId)?.displayName || 'Amigo'
                )}`
              : ''
          }
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" id="btn-act-poke">
            👆 Cutucar (Pulinho)
          </button>
          <button class="btn btn-sm" id="btn-act-throw">
            ${equippedThrowable?.icon || '✈️'} Jogar ${this.escapeHtml(equippedThrowable?.name || 'Brinquedo')}
          </button>
          <button class="btn btn-sm" id="btn-act-drop">
            ${equippedDrop?.icon || '☕'} Deixar ${this.escapeHtml(equippedDrop?.name || 'Presente')}
          </button>
          ${
            isMyRoom && otherPlayers.length > 0
              ? `<button class="btn btn-sm btn-danger" id="btn-act-kick-visitor" title="Expulsar o visitante selecionado da sua sala">
                  👢 Expulsar Amigo
                </button>`
              : ''
          }
        </div>
        <div class="btn-row">
          <span style="font-size: 0.7rem; color: var(--text-muted); align-self: center;">Emote Sync:</span>
          ${['🎵', '❤️', '🔥', '🎉', '🚀']
            .map(
              (em) =>
                `<button class="btn btn-sm" data-sync-emote="${em}">${em}</button>`
            )
            .join('')}
        </div>
      </div>

      <!-- 4. Mobiliar & Decorar Sala (Escolher Posição X ou Arrastar no Canvas) -->
      <div class="control-group" style="grid-column: 1 / -1;">
        <div class="control-group-title" style="display: flex; justify-content: space-between; align-items: center;">
          <span>🛋️ Mobiliar & Decorar Sala (${placedList.length}/10 itens • Arraste no cenário ou ajuste abaixo)</span>
          ${
            isMyRoom
              ? `<button class="btn btn-sm ${isEditFurn ? 'active-toggle' : 'btn-gold'}" id="btn-toggle-furn-mode">
                  🖐️ ${isEditFurn ? 'Concluir Edição de Móveis' : 'Modo Arrastar Móveis'}
                </button>`
              : `<span style="font-size: 0.7rem; color: var(--text-muted);">Visitando sala de amigo</span>`
          }
        </div>
        ${
          isMyRoom
            ? `
              <div class="btn-row" style="margin-bottom: 4px;">
                <span style="font-size: 0.72rem; color: var(--text-muted); align-self: center;">Adicionar ao cenário:</span>
                ${ownedFurnitureItems
                  .map(
                    (f) => `
                      <button class="btn btn-sm btn-primary" data-add-furniture="${f.id}" title="Colocar ${this.escapeHtml(f.name)} na sala">
                        ➕ ${f.icon} ${this.escapeHtml(f.name)}
                      </button>
                    `
                  )
                  .join('')}
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 6px;">
                ${
                  placedList.length === 0
                    ? `<div style="font-size: 0.75rem; color: var(--text-muted); padding: 4px;">
                        Nenhum móvel posicionado. Clique nos botões ➕ acima para adicionar seu Setup Gamer, Cadeira Gamer ou Mesa de Jantar!
                      </div>`
                    : placedList
                        .map((placed) => {
                          const meta = getCosmeticById(placed.itemId);
                          return `
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; background: #0b1120; border: 1px solid var(--border-pixel); border-radius: 6px; padding: 5px 8px;">
                              <div style="font-size: 0.74rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 115px;" title="${this.escapeHtml(meta?.name || placed.itemId)}">
                                ${meta?.icon || '🛋️'} ${this.escapeHtml(meta?.name || placed.itemId)}
                              </div>
                              <div style="display: flex; align-items: center; gap: 4px; flex: 1;">
                                <span style="font-size: 0.65rem; color: var(--accent-cyan);">X:</span>
                                <input
                                  type="range"
                                  min="26"
                                  max="334"
                                  value="${Math.round(placed.x)}"
                                  data-furn-slider="${placed.instanceId}"
                                  style="width: 100%; accent-color: #facc15; cursor: pointer;"
                                  title="Escolher onde fica na sala (X: ${Math.round(placed.x)})"
                                />
                              </div>
                              <div style="display: flex; gap: 3px;">
                                <button class="btn btn-sm" data-furn-flip="${placed.instanceId}" title="Virar lado (Esquerda/Direita)">🔄</button>
                                <button class="btn btn-sm btn-danger" data-furn-remove="${placed.instanceId}" title="Guardar móvel no inventário">🗑️</button>
                              </div>
                            </div>
                          `;
                        })
                        .join('')
                }
              </div>
            `
            : ''
        }
      </div>
    `;

    document.getElementById('btn-toggle-furn-mode')?.addEventListener('click', () => {
      const next = this.renderer.toggleEditFurnitureMode();
      document
        .getElementById('btn-quick-furniture')
        ?.classList.toggle('active-toggle', next);
      this.renderControlsPanel();
    });

    this.controlsPanelEl.querySelectorAll('[data-add-furniture]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.addFurniture!;
        // Choose a nice spread X position so newly added items don't overlap identically
        const count = this.room?.placedFurniture?.length || 0;
        const suggestedX = Math.max(36, Math.min(324, 70 + ((count * 55) % 240)));
        this.socket.emit('furniture:place', { itemId, x: suggestedX });
      });
    });

    this.controlsPanelEl.querySelectorAll('[data-furn-slider]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const instanceId = target.dataset.furnSlider!;
        const x = Number(target.value);
        // Update locally immediately for smooth preview
        const item = this.room?.placedFurniture?.find((f) => f.instanceId === instanceId);
        if (item) {
          item.x = x;
        }
        this.socket.emit('furniture:move', { instanceId, x });
      });
    });

    this.controlsPanelEl.querySelectorAll('[data-furn-flip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const instanceId = (btn as HTMLElement).dataset.furnFlip!;
        this.socket.emit('furniture:flip', { instanceId });
      });
    });

    this.controlsPanelEl.querySelectorAll('[data-furn-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const instanceId = (btn as HTMLElement).dataset.furnRemove!;
        this.socket.emit('furniture:remove', { instanceId });
      });
    });

    this.controlsPanelEl.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const status = (btn as HTMLElement).dataset.status as HostStatus;
        this.socket.emit('host:set_status', { status });
      });
    });

    this.controlsPanelEl.querySelectorAll('[data-idle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idleActivity = (btn as HTMLElement).dataset.idle as IdleActivity;
        this.socket.emit('host:set_status', { status: 'IDLE', idleActivity });
      });
    });

    this.controlsPanelEl.querySelectorAll('[data-door]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const doorPermission = (btn as HTMLElement).dataset.door as DoorPermission;
        this.socket.emit('host:set_door', { doorPermission });
      });
    });

    document.getElementById('btn-summon-bot')?.addEventListener('click', () => {
      this.socket.emit('bot:summon_visit');
    });

    this.controlsPanelEl.querySelectorAll('[data-select-visitor]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = (btn as HTMLElement).dataset.selectVisitor!;
        this.selectedTargetUserId = targetUserId;
        this.renderer.setSelectedTarget(targetUserId);
        this.renderControlsPanel();
      });
    });

    this.controlsPanelEl.querySelectorAll('[data-kick-visitor]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = (btn as HTMLElement).dataset.kickVisitor!;
        this.socket.emit('room:kick_visitor', { targetUserId });
      });
    });

    document.getElementById('btn-act-poke')?.addEventListener('click', () => {
      this.socket.emit('player:interact', {
        targetUserId: this.getEffectiveTargetUserId(),
        actionType: 'POKE',
      });
    });

    document.getElementById('btn-act-throw')?.addEventListener('click', () => {
      this.socket.emit('player:interact', {
        targetUserId: this.getEffectiveTargetUserId(),
        actionType: 'THROW_ITEM',
      });
    });

    document.getElementById('btn-act-drop')?.addEventListener('click', () => {
      this.socket.emit('player:interact', {
        targetUserId: this.room?.hostUserId || this.profile?.id || '',
        actionType: 'DESK_DROP',
      });
    });

    document.getElementById('btn-act-kick-visitor')?.addEventListener('click', () => {
      const targetUserId = this.getEffectiveTargetUserId();
      if (targetUserId && targetUserId !== this.profile?.id) {
        this.socket.emit('room:kick_visitor', { targetUserId });
      }
    });

    this.controlsPanelEl.querySelectorAll('[data-sync-emote]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emote = (btn as HTMLElement).dataset.syncEmote!;
        this.socket.emit('player:interact', {
          targetUserId: this.getEffectiveTargetUserId(),
          actionType: 'SYNC_EMOTE',
          emote,
        });
      });
    });
  }

  private renderSidebar() {
    if (!this.profile) return;

    if (this.activeTab === 'friends') {
      this.renderFriendsTab();
    } else if (this.activeTab === 'wardrobe') {
      this.renderWardrobeTab();
    } else {
      this.renderShopTab();
    }
  }

  private renderFriendsTab() {
    if (!this.profile) return;

    const otherOnline = this.directory.filter((d) => d.userId !== this.profile?.id);
    const pendingIn = this.profile.pendingIncomingFriends || [];
    const pendingOut = this.profile.pendingOutgoingFriends || [];

    this.sidebarContentEl.innerHTML = `
      <div style="background: #0f172a; border: 1px solid var(--border-pixel); border-radius: 8px; padding: 10px;">
        <div style="font-size: 0.76rem; font-weight: 700; margin-bottom: 6px; color: var(--accent-cyan);">
          🤝 Grafo Social & Amizades (6.2 Anti-Invasão)
        </div>
        <div style="display: flex; gap: 6px;">
          <input
            type="text"
            id="input-friend-username"
            class="chat-input-box"
            placeholder="Adicionar @username do amigo..."
          />
          <button class="btn btn-primary btn-sm" id="btn-add-friend">
            ➕ Amigo
          </button>
        </div>
        <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 6px;">
          💡 Para testar 2 jogadores: abra <a href="?user=amigo2" target="_blank" style="color: var(--accent-gold);">?user=amigo2</a> em outra aba!
        </div>
      </div>

      ${
        pendingIn.length > 0
          ? `
          <div style="background: rgba(250, 204, 21, 0.1); border: 1px solid var(--accent-gold); border-radius: 8px; padding: 10px;">
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--accent-gold); margin-bottom: 6px;">
              📨 Pedidos de Amizade Recebidos (${pendingIn.length})
            </div>
            <div class="cosmetic-grid">
              ${pendingIn
                .map((reqId) => {
                  const dirUser = this.directory.find((d) => d.userId === reqId);
                  const label = dirUser
                    ? `${dirUser.displayName} (@${dirUser.username})`
                    : reqId;
                  return `
                    <div class="directory-card">
                      <div style="font-size: 0.8rem; font-weight: 700;">${this.escapeHtml(label)}</div>
                      <div style="display: flex; gap: 4px;">
                        <button class="btn btn-sm btn-primary" data-accept-friend="${reqId}">Aceitar</button>
                        <button class="btn btn-sm btn-danger" data-reject-friend="${reqId}">Recusar</button>
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

      <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">
        Cantinhos Online Agora (${otherOnline.length})
      </div>

      <div class="cosmetic-grid">
        ${
          otherOnline.length === 0
            ? `<div style="font-size: 0.8rem; color: var(--text-muted); padding: 12px; text-align: center;">
                Nenhum outro jogador conectado ainda. Clique em "?user=amigo2" acima para abrir uma 2ª janela!
              </div>`
            : otherOnline
                .map((entry) => {
                  const bodyItem = getCosmeticById(entry.equipped.avatar_body);
                  const isVisitingThem = this.room?.hostUserId === entry.userId;
                  const isInMyRoom =
                    entry.currentRoomHostId === this.profile!.id ||
                    (this.room?.hostUserId === this.profile!.id &&
                      this.room.players.some((p) => p.userId === entry.userId));
                  const isAcceptedFriend =
                    entry.isBot || this.profile!.friends.includes(entry.userId);
                  const isPendingOut = pendingOut.includes(entry.userId);
                  const isPendingIn = pendingIn.includes(entry.userId);

                  const statusBadge =
                    entry.hostStatus === 'DND'
                      ? '🔒 DND'
                      : entry.hostStatus === 'IDLE'
                        ? '🌙 IDLE'
                        : '🟢 ATIVO';
                  const doorBadge =
                    entry.doorPermission === 'OPEN' ? '🚪 OPEN' : '🔔 KNOCK';

                  return `
                    <div class="directory-card">
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="cosmetic-icon-box" style="background: ${bodyItem?.previewColor || '#334155'}22;">
                          ${bodyItem?.icon || '🧑'}
                        </div>
                        <div>
                          <div class="cosmetic-name">
                            ${this.escapeHtml(entry.displayName)}
                            <span style="font-size: 0.7rem; color: var(--text-muted);">@${this.escapeHtml(entry.username)}</span>
                            ${
                              isAcceptedFriend
                                ? `<span class="rarity-tag rarity-RARE">🤝 Amigo</span>`
                                : `<span class="rarity-tag rarity-COMMON">Não-Amigo</span>`
                            }
                          </div>
                          <div class="cosmetic-desc">
                            ${statusBadge} • ${doorBadge} • 👥 ${entry.visitorCount}/${entry.maxVisitors} visitantes
                          </div>
                        </div>
                      </div>

                      <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
                        ${
                          isInMyRoom
                            ? `
                              <button class="btn btn-sm btn-danger" data-kick-visitor-dir="${entry.userId}" title="Expulsar ${this.escapeHtml(entry.displayName)} da sua sala">
                                👢 Expulsar da Sala
                              </button>
                            `
                            : ''
                        }
                        ${
                          isVisitingThem
                            ? `<span class="rarity-tag rarity-RARE">Você está aqui</span>`
                            : !isAcceptedFriend
                              ? isPendingIn
                                ? `<button class="btn btn-sm btn-gold" data-accept-friend="${entry.userId}">
                                    ✓ Aceitar Amizade
                                  </button>`
                                : isPendingOut
                                  ? `<span class="btn btn-sm" style="opacity:0.7;">⏳ Pedido Enviado</span>`
                                  : `<button class="btn btn-sm" data-request-friend="${entry.username}">
                                      ➕ Pedir Amizade
                                    </button>`
                              : entry.hostStatus === 'DND'
                                ? `<button class="btn btn-sm btn-gold" data-drop-mailbox="${entry.userId}">
                                    📫 Presente AFK
                                  </button>`
                                : `<button class="btn btn-sm btn-primary" data-visit-user="${entry.userId}">
                                    ${entry.doorPermission === 'KNOCK' ? '🔔 Bater Porta' : '🚀 Invadir'}
                                  </button>`
                        }
                      </div>
                    </div>
                  `;
                })
                .join('')
        }
      </div>
    `;

    document.getElementById('btn-add-friend')?.addEventListener('click', () => {
      const inp = document.getElementById('input-friend-username') as HTMLInputElement;
      const val = inp.value.trim();
      if (!val) return;
      this.socket.emit('friends:add', { usernameOrId: val });
      inp.value = '';
    });

    this.sidebarContentEl.querySelectorAll('[data-request-friend]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const usernameOrId = (btn as HTMLElement).dataset.requestFriend!;
        this.socket.emit('friends:add', { usernameOrId });
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-accept-friend]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const requesterUserId = (btn as HTMLElement).dataset.acceptFriend!;
        this.socket.emit('friends:respond', { requesterUserId, accept: true });
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-reject-friend]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const requesterUserId = (btn as HTMLElement).dataset.rejectFriend!;
        this.socket.emit('friends:respond', { requesterUserId, accept: false });
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-visit-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = (btn as HTMLElement).dataset.visitUser!;
        this.socket.emit('room:visit', { targetUserId });
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-kick-visitor-dir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = (btn as HTMLElement).dataset.kickVisitorDir!;
        this.socket.emit('room:kick_visitor', { targetUserId });
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-drop-mailbox]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = (btn as HTMLElement).dataset.dropMailbox!;
        this.socket.emit('player:interact', {
          targetUserId,
          actionType: 'DESK_DROP',
          note: 'Deixado na sua caixa de correio enquanto você focava no DND! 🎁',
        });
      });
    });
  }

  private renderWardrobeTab() {
    if (!this.profile) return;

    const ownedItems = COSMETIC_CATALOG.filter((item) =>
      this.profile!.inventory.includes(item.id)
    ).filter(
      (item) =>
        this.selectedCategory === 'ALL' || item.category === this.selectedCategory
    );

    const placedFurniture = this.profile.placedFurniture || [];

    this.sidebarContentEl.innerHTML = `
      <div style="font-size: 0.74rem; color: var(--text-muted);">
        🛡️ <strong>Autoridade Total do Servidor (6.1):</strong> O cliente envia apenas o <code>item_id</code> e o servidor valida no banco/cache antes de retransmitir.
      </div>

      <div class="filter-pills">
        ${(Object.keys(CATEGORY_LABELS) as Array<CosmeticCategory | 'ALL'>)
          .map(
            (cat) => `
            <button class="btn btn-sm ${this.selectedCategory === cat ? 'active-toggle' : ''}" data-cat="${cat}">
              ${CATEGORY_LABELS[cat]}
            </button>
          `
          )
          .join('')}
      </div>

      <div class="cosmetic-grid">
        ${ownedItems
          .map((item) => {
            const isFurniture = item.category === 'furniture';
            const placedCount = isFurniture
              ? placedFurniture.filter((f) => f.itemId === item.id).length
              : 0;
            const isEquipped =
              item.category !== 'furniture' &&
              this.profile!.equipped[item.category] === item.id;
            return `
              <div class="cosmetic-card">
                <div class="cosmetic-icon-box" style="background: ${item.previewColor}25;">
                  ${item.icon}
                </div>
                <div class="cosmetic-info">
                  <div class="cosmetic-name">
                    ${this.escapeHtml(item.name)}
                    <span class="rarity-tag rarity-${item.rarity}">${item.rarity}</span>
                  </div>
                  <div class="cosmetic-desc">${this.escapeHtml(item.description)}</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
                  ${
                    isFurniture
                      ? `
                        <button class="btn btn-sm btn-primary" data-place-furniture="${item.id}">
                          ➕ Colocar na Sala
                        </button>
                        ${
                          placedCount > 0
                            ? `<span style="font-size: 0.68rem; color: var(--accent-gold);">✓ ${placedCount} na sala</span>`
                            : ''
                        }
                      `
                      : isEquipped
                        ? `<span class="btn btn-sm active-toggle" style="cursor: default;">✓ Equipado</span>`
                        : `<button class="btn btn-sm btn-primary" data-equip-id="${item.id}">Equipar</button>`
                  }
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    this.sidebarContentEl.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedCategory = (btn as HTMLElement).dataset.cat as CosmeticCategory | 'ALL';
        this.renderWardrobeTab();
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-equip-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.equipId!;
        this.socket.emit('inventory:equip', { itemId });
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-place-furniture]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.placeFurniture!;
        const count = this.room?.placedFurniture?.length || 0;
        const suggestedX = Math.max(36, Math.min(324, 70 + ((count * 55) % 240)));
        this.socket.emit('furniture:place', { itemId, x: suggestedX });
      });
    });
  }

  private renderShopTab() {
    if (!this.profile) return;

    const shopItems = COSMETIC_CATALOG.filter((item) => !item.isStarter).filter(
      (item) =>
        this.selectedCategory === 'ALL' || item.category === this.selectedCategory
    );

    this.sidebarContentEl.innerHTML = `
      <!-- 3.3. Máquina de Gachapon -->
      <div class="gachapon-banner">
        <div>
          <div style="font-family: var(--font-pixel); font-size: 0.9rem; color: var(--accent-gold);">
            🎰 MÁQUINA GACHAPON
          </div>
          <div style="font-size: 0.73rem; color: #e2e8f0; margin-top: 3px;">
            Use suas Moedas Idle (ganhas passivamente) para sortear cápsulas surpresa!
          </div>
        </div>
        <button class="btn btn-gold" id="btn-roll-gachapon">
          Girar (${GACHAPON_COST_COINS} 🪙)
        </button>
      </div>

      <div class="filter-pills">
        ${(Object.keys(CATEGORY_LABELS) as Array<CosmeticCategory | 'ALL'>)
          .map(
            (cat) => `
            <button class="btn btn-sm ${this.selectedCategory === cat ? 'active-toggle' : ''}" data-shop-cat="${cat}">
              ${CATEGORY_LABELS[cat]}
            </button>
          `
          )
          .join('')}
      </div>

      <div class="cosmetic-grid">
        ${shopItems
          .map((item) => {
            const owned = this.profile!.inventory.includes(item.id);
            const isFurniture = item.category === 'furniture';
            const isEquipped =
              item.category !== 'furniture' &&
              this.profile!.equipped[item.category] === item.id;
            const currencyIcon = item.currency === 'COINS' ? '🪙' : '💎';

            return `
              <div class="cosmetic-card">
                <div class="cosmetic-icon-box" style="background: ${item.previewColor}25;">
                  ${item.icon}
                </div>
                <div class="cosmetic-info">
                  <div class="cosmetic-name">
                    ${this.escapeHtml(item.name)}
                    <span class="rarity-tag rarity-${item.rarity}">${item.rarity}</span>
                  </div>
                  <div class="cosmetic-desc">${this.escapeHtml(item.description)}</div>
                </div>
                <div>
                  ${
                    owned
                      ? isFurniture
                        ? `<button class="btn btn-sm btn-primary" data-shop-place-furn="${item.id}">➕ Colocar na Sala</button>`
                        : isEquipped
                          ? `<span class="btn btn-sm active-toggle">✓ Equipado</span>`
                          : `<button class="btn btn-sm" data-shop-equip="${item.id}">Equipar</button>`
                      : `<button class="btn btn-sm ${item.currency === 'GEMS' ? 'btn-primary' : 'btn-gold'}" data-buy-id="${item.id}">
                          ${item.price} ${currencyIcon}
                        </button>`
                  }
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    document.getElementById('btn-roll-gachapon')?.addEventListener('click', () => {
      this.socket.emit('shop:gachapon');
    });

    this.sidebarContentEl.querySelectorAll('[data-shop-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedCategory = (btn as HTMLElement).dataset.shopCat as CosmeticCategory | 'ALL';
        this.renderShopTab();
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-buy-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.buyId!;
        this.socket.emit('shop:buy', { itemId });
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-shop-equip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.shopEquip!;
        this.socket.emit('inventory:equip', { itemId });
      });
    });

    this.sidebarContentEl.querySelectorAll('[data-shop-place-furn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.shopPlaceFurn!;
        const count = this.room?.placedFurniture?.length || 0;
        const suggestedX = Math.max(36, Math.min(324, 70 + ((count * 55) % 240)));
        this.socket.emit('furniture:place', { itemId, x: suggestedX });
      });
    });
  }

  private openShopModal(category?: CosmeticCategory | 'ALL') {
    this.showAccountModal = false;
    this.showShopModal = true;
    if (category) {
      this.shopModalCategory = category;
    }
    if (windowBridge.isDesktopWidgetMode) {
      document.documentElement.classList.add('desktop-popup-expanded');
      windowBridge.setClickThrough(false);
      windowBridge.setPopupExpanded(true);
    }
    this.renderShopModal();
    this.startPreviewLoop();
  }

  private closeShopModal() {
    this.showShopModal = false;
    if (this.previewAnimId) {
      cancelAnimationFrame(this.previewAnimId);
      this.previewAnimId = 0;
    }
    this.renderer.attachPreviewCanvas(null);
    if (windowBridge.isDesktopWidgetMode) {
      document.documentElement.classList.remove('desktop-popup-expanded');
      windowBridge.setPopupExpanded(false);
    }
    this.modalRootEl.innerHTML = '';
  }

  private startPreviewLoop() {
    if (this.previewAnimId) {
      cancelAnimationFrame(this.previewAnimId);
    }
    const tickPreview = () => {
      if (!this.showShopModal) return;
      if (this.profile) {
        this.renderer.renderPreviewFrame(this.profile);
      }
      this.previewAnimId = requestAnimationFrame(tickPreview);
    };
    this.previewAnimId = requestAnimationFrame(tickPreview);
  }

  private renderShopModal() {
    if (!this.showShopModal || !this.profile) {
      if (!this.showAccountModal) {
        this.modalRootEl.innerHTML = '';
      }
      return;
    }

    const eq = this.profile.equipped;
    const placedFurniture = this.profile.placedFurniture || [];

    const slotDefs: Array<{ cat: Exclude<CosmeticCategory, 'furniture'>; label: string }> = [
      { cat: 'avatar_body', label: 'Corpo' },
      { cat: 'avatar_head', label: 'Cabeça' },
      { cat: 'avatar_back', label: 'Costas' },
      { cat: 'spawn_fx', label: 'Entrada FX' },
      { cat: 'chat_skin', label: 'Balão' },
      { cat: 'throwable', label: 'Brinquedo' },
      { cat: 'room_skin', label: 'Cenário' },
      { cat: 'desk_drop', label: 'Presente' },
    ];

    const filteredItems = COSMETIC_CATALOG.filter((item) => {
      const owned = this.profile!.inventory.includes(item.id);
      if (this.shopModalFilter === 'OWNED' && !owned) return false;
      if (this.shopModalFilter === 'UNOWNED' && owned) return false;
      if (this.shopModalCategory !== 'ALL' && item.category !== this.shopModalCategory) {
        return false;
      }
      return true;
    });

    this.modalRootEl.innerHTML = `
      <div class="modal-backdrop" id="shop-modal-backdrop">
        <div class="shop-modal-card" id="shop-modal-card">
          <div class="shop-modal-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 1.35rem;">🛒</span>
              <div>
                <div style="font-family: var(--font-pixel); font-size: 0.95rem; color: var(--accent-gold);">
                  LOJA & PERSONALIZAÇÃO DO POCKET PLAYER
                </div>
                <div style="font-size: 0.72rem; color: var(--text-muted);">
                  Compre cosméticos, gire a máquina Gachapon e personalize seu bonequinho e cenário em tempo real!
                </div>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <div class="currency-badge coins">🪙 ${this.profile.coins}</div>
              <div class="currency-badge gems">💎 ${this.profile.gems}</div>
              <button class="btn btn-sm btn-gold" id="btn-modal-free-coins" title="Ganhar +300 Moedas e +250 Gems para testar tudo!">
                🎁 +Moedas Grátis
              </button>
              <button class="btn btn-sm btn-danger" id="btn-close-shop-modal">
                ✕ Fechar (Esc)
              </button>
            </div>
          </div>

          <div class="shop-modal-body">
            <!-- Coluna Esquerda: Preview ao Vivo do Pocket Player -->
            <div class="player-preview-panel">
              <div style="font-size: 0.75rem; font-weight: 700; color: var(--accent-cyan); text-transform: uppercase;">
                🕹️ Seu Pocket Player Ao Vivo
              </div>

              <div class="player-preview-canvas-wrap">
                <canvas id="pocket-preview-canvas" width="220" height="135"></canvas>
              </div>

              <div style="display: flex; gap: 6px; width: 100%; justify-content: center;">
                <button class="btn btn-sm btn-primary" id="btn-preview-spawn-fx" style="flex: 1; justify-content: center;">
                  ⚡ Testar Entrada (FX)
                </button>
              </div>

              <div style="font-size: 0.68rem; color: var(--text-muted); width: 100%; text-align: left; margin-top: 2px;">
                Clique em um slot equipado para filtrar:
              </div>

              <div class="equipped-slots-grid">
                ${slotDefs
                  .map((s) => {
                    const item = getCosmeticById(eq[s.cat]);
                    const isSelected = this.shopModalCategory === s.cat;
                    return `
                      <button
                        class="slot-chip"
                        data-slot-filter="${s.cat}"
                        style="${isSelected ? 'border-color: var(--accent-cyan); background: rgba(34,211,238,0.12);' : ''}"
                        title="${this.escapeHtml(s.label)}: ${this.escapeHtml(item?.name || '')}"
                      >
                        <span style="font-size: 1rem;">${item?.icon || '✨'}</span>
                        <div style="min-width: 0; overflow: hidden;">
                          <div style="font-size: 0.6rem; color: var(--text-muted);">${this.escapeHtml(s.label)}</div>
                          <div style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${this.escapeHtml(item?.name || 'Padrão')}
                          </div>
                        </div>
                      </button>
                    `;
                  })
                  .join('')}
              </div>

              <!-- Máquina Gachapon dentro do Popup -->
              <div class="gachapon-banner" style="width: 100%; flex-direction: column; text-align: center; padding: 10px;">
                <div style="font-family: var(--font-pixel); font-size: 0.78rem; color: var(--accent-gold);">
                  🎰 CÁPSULA SURPRESA
                </div>
                <button class="btn btn-sm btn-gold" id="btn-modal-gachapon" style="width: 100%; justify-content: center;">
                  Girar Gachapon (${GACHAPON_COST_COINS} 🪙)
                </button>
              </div>
            </div>

            <!-- Coluna Direita: Catálogo de Personalização & Loja -->
            <div class="shop-catalog-panel">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                <div class="btn-row">
                  <button class="btn btn-sm ${this.shopModalFilter === 'ALL' ? 'active-toggle' : ''}" data-modal-filter="ALL">
                    🌟 Todos (${COSMETIC_CATALOG.length})
                  </button>
                  <button class="btn btn-sm ${this.shopModalFilter === 'OWNED' ? 'active-toggle' : ''}" data-modal-filter="OWNED">
                    🎒 Meu Guarda-Roupa (${this.profile.inventory.length})
                  </button>
                  <button class="btn btn-sm ${this.shopModalFilter === 'UNOWNED' ? 'active-toggle' : ''}" data-modal-filter="UNOWNED">
                    🏷️ Falta Desbloquear
                  </button>
                </div>
              </div>

              <div class="filter-pills">
                ${(Object.keys(CATEGORY_LABELS) as Array<CosmeticCategory | 'ALL'>)
                  .map(
                    (cat) => `
                      <button class="btn btn-sm ${this.shopModalCategory === cat ? 'active-toggle' : ''}" data-modal-cat="${cat}">
                        ${CATEGORY_LABELS[cat]}
                      </button>
                    `
                  )
                  .join('')}
              </div>

              <div class="shop-catalog-scroll">
                ${
                  filteredItems.length === 0
                    ? `<div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
                        Nenhum item encontrado neste filtro. Experimente selecionar "🌟 Todos"!
                      </div>`
                    : filteredItems
                        .map((item) => {
                          const owned = this.profile!.inventory.includes(item.id);
                          const isFurniture = item.category === 'furniture';
                          const placedCount = isFurniture
                            ? placedFurniture.filter((f) => f.itemId === item.id).length
                            : 0;
                          const isEquipped =
                            item.category !== 'furniture' &&
                            this.profile!.equipped[item.category] === item.id;
                          const currencyIcon = item.currency === 'COINS' ? '🪙' : '💎';

                          return `
                            <div class="cosmetic-card" style="${isEquipped ? 'border-color: var(--accent-cyan); background: rgba(34,211,238,0.08);' : ''}">
                              <div class="cosmetic-icon-box" style="background: ${item.previewColor}28;">
                                ${item.icon}
                              </div>
                              <div class="cosmetic-info">
                                <div class="cosmetic-name">
                                  ${this.escapeHtml(item.name)}
                                  <span class="rarity-tag rarity-${item.rarity}">${item.rarity}</span>
                                </div>
                                <div class="cosmetic-desc">${this.escapeHtml(item.description)}</div>
                              </div>
                              <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end;">
                                ${
                                  owned
                                    ? isFurniture
                                      ? `
                                        <button class="btn btn-sm btn-primary" data-modal-place-furn="${item.id}">
                                          ➕ Por na Sala
                                        </button>
                                        ${
                                          placedCount > 0
                                            ? `<span style="font-size: 0.65rem; color: var(--accent-gold);">✓ ${placedCount} na sala</span>`
                                            : ''
                                        }
                                      `
                                      : isEquipped
                                        ? `<span class="btn btn-sm active-toggle" style="cursor: default;">✓ Equipado</span>`
                                        : `<button class="btn btn-sm btn-primary" data-modal-equip="${item.id}">👕 Equipar</button>`
                                    : `<button class="btn btn-sm ${item.currency === 'GEMS' ? 'btn-primary' : 'btn-gold'}" data-modal-buy="${item.id}">
                                        🛒 ${item.price} ${currencyIcon}
                                      </button>`
                                }
                              </div>
                            </div>
                          `;
                        })
                        .join('')
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const previewCanvas = document.getElementById(
      'pocket-preview-canvas'
    ) as HTMLCanvasElement | null;
    this.renderer.attachPreviewCanvas(previewCanvas);
    if (this.profile) {
      this.renderer.renderPreviewFrame(this.profile);
    }

    document.getElementById('shop-modal-backdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'shop-modal-backdrop') {
        this.closeShopModal();
      }
    });

    document.getElementById('btn-close-shop-modal')?.addEventListener('click', () => {
      this.closeShopModal();
    });

    document.getElementById('btn-modal-free-coins')?.addEventListener('click', () => {
      this.socket.emit('economy:claim_starter_pack');
    });

    document.getElementById('btn-modal-gachapon')?.addEventListener('click', () => {
      this.socket.emit('shop:gachapon');
    });

    document.getElementById('btn-preview-spawn-fx')?.addEventListener('click', () => {
      soundEngine.playSpawn(this.profile!.equipped.spawn_fx);
      this.renderer.triggerPreviewSpawnFx();
    });

    this.modalRootEl.querySelectorAll('[data-slot-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = (btn as HTMLElement).dataset.slotFilter as CosmeticCategory;
        this.shopModalCategory = this.shopModalCategory === cat ? 'ALL' : cat;
        this.renderShopModal();
      });
    });

    this.modalRootEl.querySelectorAll('[data-modal-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.shopModalFilter = (btn as HTMLElement).dataset.modalFilter as
          | 'ALL'
          | 'OWNED'
          | 'UNOWNED';
        this.renderShopModal();
      });
    });

    this.modalRootEl.querySelectorAll('[data-modal-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.shopModalCategory = (btn as HTMLElement).dataset.modalCat as
          | CosmeticCategory
          | 'ALL';
        this.renderShopModal();
      });
    });

    this.modalRootEl.querySelectorAll('[data-modal-equip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.modalEquip!;
        this.socket.emit('inventory:equip', { itemId });
        const item = getCosmeticById(itemId);
        if (item?.category === 'spawn_fx') {
          setTimeout(() => {
            soundEngine.playSpawn(itemId);
            this.renderer.triggerPreviewSpawnFx();
          }, 80);
        }
      });
    });

    this.modalRootEl.querySelectorAll('[data-modal-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.modalBuy!;
        this.socket.emit('shop:buy', { itemId });
      });
    });

    this.modalRootEl.querySelectorAll('[data-modal-place-furn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = (btn as HTMLElement).dataset.modalPlaceFurn!;
        const count = this.room?.placedFurniture?.length || 0;
        const suggestedX = Math.max(36, Math.min(324, 70 + ((count * 55) % 240)));
        this.socket.emit('furniture:place', { itemId, x: suggestedX });
      });
    });
  }

  private renderAccountModal() {
    if (!this.showAccountModal) {
      if (!this.showShopModal) {
        this.modalRootEl.innerHTML = '';
      }
      return;
    }

    const currentServerUrl = localStorage.getItem('pc_server_url') || '';

    this.modalRootEl.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-card">
          <div style="font-family: var(--font-pixel); font-size: 1rem; color: var(--accent-gold);">
            🔄 Trocar Perfil / Servidor Online
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            Cada perfil possui seu próprio Cantinho, inventário salvo no servidor e lista de amigos.
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <label style="font-size: 0.75rem; color: var(--text-muted);">@username (único)</label>
            <input
              type="text"
              id="modal-username"
              class="chat-input-box"
              value="${this.escapeHtml(this.profile?.username || '')}"
              placeholder="ex: lucas_dev"
            />
            <label style="font-size: 0.75rem; color: var(--text-muted);">Nome de Exibição</label>
            <input
              type="text"
              id="modal-displayname"
              class="chat-input-box"
              value="${this.escapeHtml(this.profile?.displayName || '')}"
              placeholder="ex: Lucas"
            />
            <label style="font-size: 0.75rem; color: var(--text-muted);">🌐 URL do Servidor Online (opcional)</label>
            <input
              type="text"
              id="modal-server-url"
              class="chat-input-box"
              value="${this.escapeHtml(currentServerUrl)}"
              placeholder="Vazio = mesmo servidor atual (ou ex: https://meu-pocket.onrender.com)"
            />
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
            <button class="btn" id="btn-modal-cancel">Cancelar</button>
            <button class="btn btn-primary" id="btn-modal-save">Entrar no Cantinho</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-modal-cancel')?.addEventListener('click', () => {
      this.showAccountModal = false;
      this.renderAccountModal();
    });

    document.getElementById('btn-modal-save')?.addEventListener('click', () => {
      const uInp = (document.getElementById('modal-username') as HTMLInputElement).value.trim();
      const dInp = (document.getElementById('modal-displayname') as HTMLInputElement).value.trim();
      const sInp = (document.getElementById('modal-server-url') as HTMLInputElement).value.trim();
      if (!uInp) return;

      const clean = uInp.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      localStorage.setItem('pc_username', clean);
      localStorage.setItem('pc_displayName', dInp || clean);
      sessionStorage.setItem('pc_username', clean);
      sessionStorage.setItem('pc_displayName', dInp || clean);

      if (sInp) {
        localStorage.setItem('pc_server_url', sInp.replace(/\/+$/, ''));
      } else {
        localStorage.removeItem('pc_server_url');
      }

      this.showAccountModal = false;
      this.renderAccountModal();
      this.connectSocket();
    });
  }

  private showToast(type: 'info' | 'success' | 'warning' | 'error', message: string) {
    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    el.textContent = message;
    this.toastStackEl.appendChild(el);

    setTimeout(() => {
      el.remove();
    }, 4200);
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
