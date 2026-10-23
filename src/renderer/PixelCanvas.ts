import { getCosmeticById, getFurnitureColorOption, getPetBreedOption } from '../shared/catalog';
import {
  DeskDropInstance,
  IdleActivity,
  InteractionActionType,
  PlacedFurnitureItem,
  RoomPlayerState,
  RoomSnapshot,
} from '../shared/types';
import { soundEngine } from '../audio/soundEngine';
import { windowBridge } from '../bridge/windowBridge';

export type DayCyclePhase = 'DAWN' | 'DAY' | 'SUNSET' | 'NIGHT';

export interface LocalDayTimeInfo {
  hours: number;
  minutes: number;
  decimalHour: number;
  timeStr: string;
  phase: DayCyclePhase;
  label: string;
  icon: string;
  windowThought: string;
}

export function getLocalDayTimeInfo(): LocalDayTimeInfo {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const decimalHour = hours + minutes / 60;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  if (decimalHour >= 5 && decimalHour < 7.5) {
    return {
      hours,
      minutes,
      decimalHour,
      timeStr,
      phase: 'DAWN',
      label: 'Amanhecer',
      icon: '🌅',
      windowThought: '🌅 Olhando o sol nascer na janela com um café...',
    };
  }
  if (decimalHour >= 7.5 && decimalHour < 16.5) {
    return {
      hours,
      minutes,
      decimalHour,
      timeStr,
      phase: 'DAY',
      label: hours < 12 ? 'Manhã Clara' : 'Tarde Ensolarada',
      icon: '☀️',
      windowThought:
        hours < 12
          ? '☀️ Que manhã clara bonita lá fora!'
          : '🌤️ Aproveitando a luz da tarde na janela...',
    };
  }
  if (decimalHour >= 16.5 && decimalHour < 18.75) {
    return {
      hours,
      minutes,
      decimalHour,
      timeStr,
      phase: 'SUNSET',
      label: 'Pôr do Sol',
      icon: '🌇',
      windowThought: '🌇 Admirando o pôr do sol alaranjado...',
    };
  }
  return {
    hours,
    minutes,
    decimalHour,
    timeStr,
    phase: 'NIGHT',
    label: 'Noite Estrelada',
    icon: '🌙',
    windowThought: '🌙 Olhando as estrelas e a lua pela janela...',
  };
}

export interface FurnitureInteractionMeta {
  activity: IdleActivity;
  label: string;
  thoughtBubble: string;
  seatOffsetY?: number;
}

export const FURNITURE_INTERACTIONS: Record<string, FurnitureInteractionMeta> = {
  furn_coffee_machine: {
    activity: 'COFFEE',
    label: 'Passar um Café',
    thoughtBubble: '☕ Passando um expresso fresquinho...',
  },
  furn_mini_fridge: {
    activity: 'COFFEE',
    label: 'Pegar Bebida',
    thoughtBubble: '🧊 Pegando uma bebida gelada no frigobar...',
  },
  furn_dining_table: {
    activity: 'COFFEE',
    label: 'Pausa pro Café',
    thoughtBubble: '🍽️ Fazendo uma pausa para o café na mesa...',
  },
  furn_pet_bed: {
    activity: 'SLEEPING',
    label: 'Cochilar na Caminha',
    thoughtBubble: '💤 Tirando um cochilo gostoso na caminha...',
    seatOffsetY: -5,
  },
  furn_cozy_sofa: {
    activity: 'SLEEPING',
    label: 'Descansar no Sofá',
    thoughtBubble: '🛋️ Relaxando um pouquinho no sofá...',
    seatOffsetY: -6,
  },
  furn_bookshelf: {
    activity: 'READING',
    label: 'Ler um Livro',
    thoughtBubble: '📚 Escolhendo um livro interessante na estante...',
  },
  furn_floor_lamp: {
    activity: 'READING',
    label: 'Ler sob a Luz',
    thoughtBubble: '💡 Lendo sob a luz aconchegante da luminária...',
  },
  furn_cozy_rug: {
    activity: 'READING',
    label: 'Sentar no Tapete',
    thoughtBubble: '🧶 Lendo confortável no tapete felpudo...',
  },
  furn_gamer_setup: {
    activity: 'TYPING',
    label: 'Usar o PC Gamer',
    thoughtBubble: '🖥️ Focado no código e no trabalho!',
  },
  furn_gamer_chair: {
    activity: 'TYPING',
    label: 'Sentar na Cadeira',
    thoughtBubble: '🪑 Trabalhando confortável na cadeira gamer!',
    seatOffsetY: -5,
  },
  furn_arcade_cabinet: {
    activity: 'TYPING',
    label: 'Jogar Fliperama',
    thoughtBubble: '🕹️ Jogando uma fichinha rápida no Arcade!',
  },
  furn_dj_booth: {
    activity: 'TYPING',
    label: 'Mixar na Mesa DJ',
    thoughtBubble: '🎧 Soltando o beat na Mesa de DJ!',
  },
  furn_aquarium: {
    activity: 'FISHING',
    label: 'Observar Peixinhos',
    thoughtBubble: '🐠 Observando os peixinhos no aquário...',
  },
  furn_sakura_bonsai: {
    activity: 'COFFEE',
    label: 'Admirar Bonsai',
    thoughtBubble: '🌸 Admirando as pétalas do Bonsai de Sakura...',
  },
  furn_monstera_plant: {
    activity: 'COFFEE',
    label: 'Cuidar da Planta',
    thoughtBubble: '🪴 Cuidando da Costela-de-Adão...',
  },
  furn_wall_frames: {
    activity: 'COFFEE',
    label: 'Admirar Quadros',
    thoughtBubble: '🖼️ Olhando a galeria de quadros na parede...',
  },
};

export function getFurnitureInteraction(itemId: string): FurnitureInteractionMeta {
  return (
    FURNITURE_INTERACTIONS[itemId] || {
      activity: 'COFFEE',
      label: 'Interagir com Móvel',
      thoughtBubble: '✨ Que cantinho aconchegante!',
    }
  );
}

interface LocalAvatarPhysics {
  renderX: number;
  renderY: number; // 0 = on floor, negative = in air
  vy: number;
  walkFrame: number;
}

interface ActiveProjectile {
  id: string;
  itemId: string;
  fromX: number;
  toX: number;
  targetUserId: string;
  progress: number; // 0 -> 1
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  life: number;
}

export interface FocusCanvasOverlayState {
  active: boolean;
  phase: 'FOCUS' | 'BREAK';
  remainingSec: number;
  totalSec: number;
  activity: 'TYPING' | 'READING';
  rewardCoins: number;
}

export interface PixelCanvasCallbacks {
  onMoveRequest: (targetX: number) => void;
  onJumpRequest: () => void;
  onSelectPlayer: (userId: string) => void;
  onPokePlayer: (userId: string) => void;
  onClaimDrop: (dropId: string) => void;
  onKickVisitor?: (userId: string) => void;
  onMoveFurniture?: (instanceId: string, x: number) => void;
  onFlipFurniture?: (instanceId: string) => void;
  onRemoveFurniture?: (instanceId: string) => void;
  onEditFurniture?: (instanceId: string) => void;
  onInteractFurniture?: (furn: PlacedFurnitureItem) => void;
  onInteractWindow?: () => void;
  onEditWorkStatus?: () => void;
  onHoverStateChange?: (hoverLabel: string | null) => void;
}

export class PixelCanvasRenderer {
  public static readonly WIDTH = 360;
  public static readonly HEIGHT = 180;
  public static readonly FLOOR_HEIGHT = 24;
  public static readonly FLOOR_Y = PixelCanvasRenderer.HEIGHT - PixelCanvasRenderer.FLOOR_HEIGHT;
  private static readonly WORK_SIGN_X = 140;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: PixelCanvasCallbacks;

  private room: RoomSnapshot | null = null;
  private myUserId = '';
  private selectedTargetUserId: string | null = null;
  private selectedTargetExpiresAt = 0;
  public editFurnitureMode = false;

  // Zoom / Escala da Câmera (1.0x, 1.25x, 1.5x)
  public zoomLevel = 1.2;
  private cameraX = 180;

  private physics = new Map<string, LocalAvatarPhysics>();
  private ambientThoughts = new Map<string, { text: string; expiresAt: number }>();
  private focusOverlay: FocusCanvasOverlayState | null = null;
  private nudgeShakeUntil = 0;
  private nudgeBanner: { text: string; expiresAt: number } | null = null;
  private seenSpawnFx = new Set<string>();
  private projectiles: ActiveProjectile[] = [];
  private particles: Particle[] = [];

  private hoveredDropId: string | null = null;
  private hoveredPlayerId: string | null = null;
  private hoveredFurnitureId: string | null = null;
  private hoveredWindow = false;
  private hoveredWorkSign = false;
  private draggingFurnitureId: string | null = null;
  private draggingStartMouseX = 0;
  private draggingDidMove = false;
  private singleClickFurnTimer: number | null = null;
  private lastFurnitureEmitAt = 0;
  private lastMoveEmitAt = 0;
  private animFrameId = 0;
  private tick = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: PixelCanvasCallbacks) {
    this.canvas = canvas;
    this.canvas.width = PixelCanvasRenderer.WIDTH;
    this.canvas.height = PixelCanvasRenderer.HEIGHT;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('2D Canvas context not supported');
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;
    this.callbacks = callbacks;

    this.bindEvents();
    this.startLoop();
  }

  public setIdentity(userId: string) {
    this.myUserId = userId;
  }

  public setFocusOverlay(state: FocusCanvasOverlayState | null) {
    this.focusOverlay = state;
  }

  public showAmbientThought(userId: string, text: string, durationMs = 4500) {
    this.ambientThoughts.set(userId, {
      text,
      expiresAt: Date.now() + durationMs,
    });
  }

  public setSelectedTarget(userId: string | null) {
    this.selectedTargetUserId = userId;
    this.selectedTargetExpiresAt = userId ? Date.now() + 2000 : 0;
  }

  public cycleZoom(): number {
    if (this.zoomLevel < 1.15) {
      this.zoomLevel = 1.25;
    } else if (this.zoomLevel < 1.4) {
      this.zoomLevel = 1.5;
    } else {
      this.zoomLevel = 1.0;
    }
    return this.zoomLevel;
  }

  private getCameraViewport(): { viewLeft: number; viewTop: number; visW: number; visH: number } {
    const W = PixelCanvasRenderer.WIDTH;
    const H = PixelCanvasRenderer.HEIGHT;
    const visW = W / this.zoomLevel;
    const visH = H / this.zoomLevel;
    const viewLeft = Math.max(0, Math.min(W - visW, this.cameraX - visW / 2));
    const viewTop = Math.max(0, H - visH);
    return { viewLeft, viewTop, visW, visH };
  }

  public toggleEditFurnitureMode(force?: boolean): boolean {
    this.editFurnitureMode =
      typeof force === 'boolean' ? force : !this.editFurnitureMode;
    this.draggingFurnitureId = null;
    return this.editFurnitureMode;
  }

  public updateRoom(snapshot: RoomSnapshot) {
    // If currently dragging a furniture item locally, preserve its smooth local X
    if (this.draggingFurnitureId && this.room?.placedFurniture && snapshot.placedFurniture) {
      const localFurn = this.room.placedFurniture.find(
        (f) => f.instanceId === this.draggingFurnitureId
      );
      const incomingFurn = snapshot.placedFurniture.find(
        (f) => f.instanceId === this.draggingFurnitureId
      );
      if (localFurn && incomingFurn) {
        incomingFurn.x = localFurn.x;
      }
    }

    this.room = snapshot;

    const currentIds = new Set<string>();
    for (const p of snapshot.players) {
      currentIds.add(p.userId);
      if (!this.physics.has(p.userId)) {
        this.physics.set(p.userId, {
          renderX: p.x,
          renderY: 0,
          vy: 0,
          walkFrame: 0,
        });
      }

      if (p.spawnFx) {
        const key = `${p.userId}:${p.spawnFx.startedAt}`;
        if (!this.seenSpawnFx.has(key) && Date.now() - p.spawnFx.startedAt < 2500) {
          this.seenSpawnFx.add(key);
          soundEngine.playSpawn(p.spawnFx.fxId);
          this.spawnBurst(p.x, PixelCanvasRenderer.FLOOR_Y - 16, '#38bdf8', 16);
        }
      }
    }

    for (const oldId of Array.from(this.physics.keys())) {
      if (!currentIds.has(oldId)) {
        this.physics.delete(oldId);
      }
    }
  }

  public onPlayerMoved(userId: string, targetX: number, facing: 'left' | 'right') {
    if (!this.room) return;
    const p = this.room.players.find((pl) => pl.userId === userId);
    if (p) {
      p.targetX = targetX;
      p.x = targetX;
      p.facing = facing;
    }
  }

  public triggerJump(userId: string) {
    const phys = this.physics.get(userId);
    if (phys && phys.renderY >= -2) {
      phys.vy = -5.2;
      soundEngine.playJump();
      this.spawnBurst(phys.renderX, PixelCanvasRenderer.FLOOR_Y - 2, '#cbd5e1', 6);
    }
  }

  public triggerInteractionFx(payload: {
    fromUserId: string;
    fromDisplayName?: string;
    targetUserId: string;
    actionType: InteractionActionType;
    verifiedItemId?: string;
    emote?: string;
    fromX: number;
    toX: number;
  }) {
    if (payload.actionType === 'POKE') {
      soundEngine.playPoke();
      this.triggerJump(payload.targetUserId);
      this.spawnBurst(payload.toX, PixelCanvasRenderer.FLOOR_Y - 28, '#facc15', 14);
    } else if (payload.actionType === 'THROW_ITEM') {
      soundEngine.playThrow();
      this.projectiles.push({
        id: `proj_${Date.now()}_${Math.random()}`,
        itemId: payload.verifiedItemId || 'throw_paper_ball',
        fromX: payload.fromX,
        toX: payload.toX,
        targetUserId: payload.targetUserId,
        progress: 0,
      });
    } else if (payload.actionType === 'SYNC_EMOTE') {
      soundEngine.playTone(587.33, 0.14, 'triangle', 0.07, 880);
      this.spawnBurst(payload.fromX, PixelCanvasRenderer.FLOOR_Y - 34, '#f472b6', 12);
    } else if (payload.actionType === 'ATTENTION') {
      // 📳 Chamar Atenção (Estilo MSN Messenger: som clássico de mensagem chegando + tremedeira brusca!)
      soundEngine.playMsnAttention();
      this.nudgeShakeUntil = Date.now() + 920;
      const senderName = payload.fromDisplayName || 'Amigo';
      this.nudgeBanner = {
        text:
          payload.fromUserId === this.myUserId
            ? '📳 Você enviou um Chamar Atenção!'
            : `📳 ${senderName} chamou sua atenção!`,
        expiresAt: Date.now() + 3400,
      };
      this.spawnBurst(payload.fromX, PixelCanvasRenderer.FLOOR_Y - 28, '#facc15', 22);
      this.spawnBurst(payload.toX, PixelCanvasRenderer.FLOOR_Y - 28, '#38bdf8', 22);
    }
  }

  public spawnBurst(x: number, y: number, color: string, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 1 + Math.random() * 2.6;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        color,
        size: Math.random() > 0.5 ? 3 : 2,
        alpha: 1,
        life: 24 + Math.floor(Math.random() * 16),
      });
    }
  }

  private getCanvasCoords(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = PixelCanvasRenderer.WIDTH / rect.width;
    const scaleY = PixelCanvasRenderer.HEIGHT / rect.height;
    const rawX = (e.clientX - rect.left) * scaleX;
    const rawY = (e.clientY - rect.top) * scaleY;
    const { viewLeft, viewTop } = this.getCameraViewport();
    return {
      x: viewLeft + rawX / this.zoomLevel,
      y: viewTop + rawY / this.zoomLevel,
    };
  }

  private bindEvents() {
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (e.deltaY < 0) {
          this.zoomLevel = Math.min(1.6, Number((this.zoomLevel + 0.12).toFixed(2)));
        } else {
          this.zoomLevel = Math.max(1.0, Number((this.zoomLevel - 0.12).toFixed(2)));
        }
      },
      { passive: false }
    );

    this.canvas.addEventListener('mousemove', (e) => {
      const { x, y } = this.getCanvasCoords(e);

      // Handle live furniture dragging!
      if (this.draggingFurnitureId && this.room?.placedFurniture) {
        const furn = this.room.placedFurniture.find(
          (f) => f.instanceId === this.draggingFurnitureId
        );
        if (furn) {
          if (Math.abs(x - this.draggingStartMouseX) >= 3) {
            this.draggingDidMove = true;
          }
          if (this.draggingDidMove) {
            const clampedX = Math.max(26, Math.min(334, Math.round(x)));
            furn.x = clampedX;
            const now = Date.now();
            if (now - this.lastFurnitureEmitAt >= 70) {
              this.lastFurnitureEmitAt = now;
              this.callbacks.onMoveFurniture?.(furn.instanceId, clampedX);
            }
          }
          return;
        }
      }

      this.updateHoverAndClickThrough(x, y);
    });

    window.addEventListener('mouseup', () => {
      if (this.draggingFurnitureId && this.room?.placedFurniture) {
        const furn = this.room.placedFurniture.find(
          (f) => f.instanceId === this.draggingFurnitureId
        );
        const didMove = this.draggingDidMove;
        this.draggingFurnitureId = null;
        this.draggingDidMove = false;

        if (furn) {
          if (didMove) {
            this.callbacks.onMoveFurniture?.(furn.instanceId, furn.x);
          } else if (!this.editFurnitureMode) {
            // Single click without dragging -> interact with furniture (delayed slightly so dblclick can cancel it)
            if (this.singleClickFurnTimer) {
              window.clearTimeout(this.singleClickFurnTimer);
            }
            const targetFurn = { ...furn };
            this.singleClickFurnTimer = window.setTimeout(() => {
              this.singleClickFurnTimer = null;
              this.callbacks.onInteractFurniture?.(targetFurn);
            }, 210);
          }
        }
      }
    });

    this.canvas.addEventListener('dblclick', (e) => {
      if (this.singleClickFurnTimer) {
        window.clearTimeout(this.singleClickFurnTimer);
        this.singleClickFurnTimer = null;
      }
      const isMyRoom = this.room?.hostUserId === this.myUserId;
      if (!isMyRoom) return;
      const { x, y } = this.getCanvasCoords(e);
      this.updateHoverAndClickThrough(x, y);
      if (this.hoveredFurnitureId) {
        e.preventDefault();
        this.draggingFurnitureId = null;
        this.draggingDidMove = false;
        soundEngine.playTone(580, 0.08, 'triangle', 0.08, 780);
        this.callbacks.onEditFurniture?.(this.hoveredFurnitureId);
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      const isMyRoom = this.room?.hostUserId === this.myUserId;
      if (!isMyRoom) return;

      // 1. Se clicar com botão direito em um móvel da própria sala: remove (ou Shift+Direito vira)
      if (this.hoveredFurnitureId) {
        e.preventDefault();
        if (e.shiftKey) {
          soundEngine.playTone(440, 0.08, 'triangle', 0.07, 660);
          this.callbacks.onFlipFurniture?.(this.hoveredFurnitureId);
        } else {
          soundEngine.playTone(300, 0.1, 'sine', 0.08, 200);
          this.callbacks.onRemoveFurniture?.(this.hoveredFurnitureId);
          this.hoveredFurnitureId = null;
        }
        return;
      }

      // 2. Se clicar com botão direito em um visitante: expulsa da sala
      if (this.hoveredPlayerId && this.hoveredPlayerId !== this.myUserId) {
        e.preventDefault();
        soundEngine.playTone(320, 0.12, 'sawtooth', 0.08, 180);
        this.callbacks.onKickVisitor?.(this.hoveredPlayerId);
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const { x, y } = this.getCanvasCoords(e);

      // 0. If hovering a furniture item:
      const isMyRoom = this.room?.hostUserId === this.myUserId;
      if (
        this.hoveredFurnitureId &&
        (this.editFurnitureMode || (!this.hoveredDropId && !this.hoveredPlayerId))
      ) {
        if (isMyRoom) {
          this.draggingFurnitureId = this.hoveredFurnitureId;
          this.draggingStartMouseX = x;
          this.draggingDidMove = false;
          soundEngine.playTone(520, 0.06, 'sine', 0.06);
          return;
        } else {
          // Visiting a friend's room: clicking furniture walks over and interacts with it!
          const furn = this.room?.placedFurniture?.find(
            (f) => f.instanceId === this.hoveredFurnitureId
          );
          if (furn) {
            soundEngine.playTone(520, 0.06, 'sine', 0.06);
            this.callbacks.onInteractFurniture?.(furn);
            return;
          }
        }
      }

      // 0.5. Check if clicking the Work Status Desk Sign (Plaquinha de Mesa)
      if (this.hoveredWorkSign && !this.hoveredDropId && !this.hoveredPlayerId) {
        soundEngine.playTone(560, 0.07, 'triangle', 0.07, 740);
        if (isMyRoom) {
          this.callbacks.onEditWorkStatus?.();
        } else if (this.room?.hostWorkStatus) {
          this.showAmbientThought(
            this.room.hostUserId,
            `🪧 ${this.room.hostWorkStatus}`,
            4500
          );
        }
        return;
      }

      // 0.6. Check if clicking the room window to look outside
      if (this.hoveredWindow && !this.hoveredDropId && !this.hoveredPlayerId) {
        soundEngine.playTone(540, 0.07, 'sine', 0.06);
        this.callbacks.onInteractWindow?.();
        return;
      }

      // 1. Check if clicking a Desk Drop on the floor
      if (this.hoveredDropId) {
        this.callbacks.onClaimDrop(this.hoveredDropId);
        return;
      }

      // 2. Check if clicking another player avatar
      if (this.hoveredPlayerId && this.hoveredPlayerId !== this.myUserId) {
        this.selectedTargetUserId = this.hoveredPlayerId;
        this.selectedTargetExpiresAt = Date.now() + 2000;
        this.callbacks.onSelectPlayer(this.hoveredPlayerId);
        this.callbacks.onPokePlayer(this.hoveredPlayerId);
        return;
      }

      // 3. Otherwise move our avatar along the X axis (and clear any target highlight)
      this.selectedTargetExpiresAt = 0;
      const clampedX = Math.max(24, Math.min(336, Math.round(x)));
      const myPhys = this.physics.get(this.myUserId);
      if (myPhys) {
        const me = this.room?.players.find((pl) => pl.userId === this.myUserId);
        if (me) {
          me.facing = clampedX < myPhys.renderX ? 'left' : 'right';
          me.targetX = clampedX;
          me.x = clampedX;
        }
      }

      if (y < PixelCanvasRenderer.FLOOR_Y - 50) {
        this.triggerJump(this.myUserId);
        this.callbacks.onJumpRequest();
      }

      const now = Date.now();
      if (now - this.lastMoveEmitAt >= 100) {
        this.lastMoveEmitAt = now;
        this.callbacks.onMoveRequest(clampedX);
      } else {
        setTimeout(() => {
          this.callbacks.onMoveRequest(clampedX);
        }, 105);
      }
    });
  }

  /**
   * 4.2. Hit-testing para Tauri/Electron Transparente (setIgnoreCursorEvents) + Tooltips
   */
  private updateHoverAndClickThrough(x: number, y: number) {
    this.hoveredDropId = null;
    this.hoveredPlayerId = null;
    this.hoveredFurnitureId = null;
    this.hoveredWindow = false;
    this.hoveredWorkSign = false;
    let label: string | null = null;

    if (this.room) {
      const isMyRoom = this.room.hostUserId === this.myUserId;

      // Check Work Status Desk Sign hit-testing (Plaquinha na mesa)
      const hasWorkStatus = Boolean(this.room.hostWorkStatus && this.room.hostWorkStatus.trim());
      if (!this.editFurnitureMode && (hasWorkStatus || isMyRoom)) {
        const signX = PixelCanvasRenderer.WORK_SIGN_X;
        const signHalfW = hasWorkStatus
          ? Math.min(68, Math.max(28, this.room.hostWorkStatus!.length * 2.6 + 14))
          : 24;
        if (
          Math.abs(x - signX) <= signHalfW &&
          y >= PixelCanvasRenderer.FLOOR_Y - 28 &&
          y <= PixelCanvasRenderer.FLOOR_Y + 2
        ) {
          this.hoveredWorkSign = true;
          label = isMyRoom
            ? hasWorkStatus
              ? `🪧 Plaquinha: "${this.room.hostWorkStatus}" — Clique para editar status`
              : '🪧 Plaquinha de Mesa — Clique para definir "No que estou trabalhando"'
            : `🪧 ${this.room.hostDisplayName}: "${this.room.hostWorkStatus}"`;
        }
      }

      // Check Furniture hit-testing (in both own room and friend's room!)
      if (!this.hoveredWorkSign && this.room.placedFurniture) {
        for (let i = this.room.placedFurniture.length - 1; i >= 0; i--) {
          const furn = this.room.placedFurniture[i];
          const item = getCosmeticById(furn.itemId);
          const halfW = ((item?.meta?.widthPx || 36) * 1.25) / 2;
          let minY = PixelCanvasRenderer.FLOOR_Y - 58;
          let maxY = PixelCanvasRenderer.FLOOR_Y + 6;

          if (furn.itemId === 'furn_wall_frames') {
            minY = PixelCanvasRenderer.FLOOR_Y - 98;
            maxY = PixelCanvasRenderer.FLOOR_Y - 40;
          } else if (furn.itemId === 'furn_cozy_rug') {
            minY = PixelCanvasRenderer.FLOOR_Y - 8;
            maxY = PixelCanvasRenderer.FLOOR_Y + 14;
          }

          if (Math.abs(x - furn.x) <= halfW && y >= minY && y <= maxY) {
            this.hoveredFurnitureId = furn.instanceId;
            const inter = getFurnitureInteraction(furn.itemId);
            label = isMyRoom
              ? `✨ 1x Clique: ${inter.label} • 🖐️ Arraste "${item?.name || 'Móvel'}" • 2x Clique: 🎨 Cor`
              : `✨ Clique para ${inter.label} em "${item?.name || 'Móvel'}"`;
            break;
          }
        }
      }

      // Check Window / Sky / Horizon hit-testing across ALL scenarios (adaptive day/night & weather)
      if (!this.hoveredFurnitureId && !this.hoveredWorkSign && !this.editFurnitureMode) {
        const skinId = this.room.roomSkinId || 'room_cozy_desk';
        const isCozyWin =
          skinId === 'room_cozy_desk' && x >= 26 && x <= 106 && y >= 20 && y <= 104;
        const isOfficeWin =
          skinId === 'room_office' && x >= 18 && x <= 132 && y >= 18 && y <= 104;
        const isTrainWin =
          skinId === 'room_moving_train' &&
          y >= 24 &&
          y <= 114 &&
          ((x >= 20 && x <= 114) || (x >= 132 && x <= 226) || (x >= 244 && x <= 338));
        const isOutdoorSky =
          (skinId === 'room_dense_forest' ||
            skinId === 'room_forest_campfire' ||
            skinId === 'room_rainy_rooftop' ||
            skinId === 'room_beco_rapariga' ||
            skinId === 'room_underwater') &&
          y >= 2 &&
          y <= 44;

        if (isCozyWin || isOfficeWin || isTrainWin || isOutdoorSky) {
          this.hoveredWindow = true;
          const dayInfo = getLocalDayTimeInfo();
          const weatherTags: string[] = [];
          if (soundEngine.isAmbientActive('rain')) weatherTags.push('🌧️ Chuva');
          if (soundEngine.isAmbientActive('fireplace')) weatherTags.push('🔥 Lareira');
          if (soundEngine.isAmbientActive('brown_noise')) weatherTags.push('🍃 Brisa');
          if (soundEngine.isAmbientActive('coffee')) weatherTags.push('☕ Aroma de Café');
          const weatherSuffix = weatherTags.length > 0 ? ` • ${weatherTags.join(' + ')}` : '';
          const viewName =
            isCozyWin || isOfficeWin || isTrainWin ? 'Janela' : 'Clima do Cenário';
          label = `${dayInfo.icon} ${viewName} (${dayInfo.timeStr} • ${dayInfo.label}${weatherSuffix}) — Clique para admirar`;
        }
      }

      // Check Desk Drops
      if (!this.editFurnitureMode) {
        for (const drop of this.room.deskDrops) {
          const dx = Math.abs(x - drop.x);
          const dy = Math.abs(y - (PixelCanvasRenderer.FLOOR_Y - 10));
          if (dx <= 16 && dy <= 16) {
            this.hoveredDropId = drop.id;
            const item = getCosmeticById(drop.itemId);
            label = drop.note
              ? `🎁 ${item?.name || 'Presente'} de ${drop.fromDisplayName} • 📝 "${drop.note}" — Clique para pegar`
              : `🎁 Clique para pegar ${item?.name || 'Presente'} (de ${drop.fromDisplayName})`;
            break;
          }
        }
      }

      // Check Avatars
      if (!this.editFurnitureMode && !this.hoveredDropId) {
        for (const p of this.room.players) {
          const phys = this.physics.get(p.userId);
          const px = phys ? phys.renderX : p.x;
          const py = PixelCanvasRenderer.FLOOR_Y + (phys ? phys.renderY : 0) - 24;
          if (Math.abs(x - px) <= 18 && Math.abs(y - py) <= 28) {
            this.hoveredPlayerId = p.userId;
            label =
              p.userId === this.myUserId
                ? `✨ Você (${p.displayName})`
                : isMyRoom
                  ? `👆 Clique: Cutucar ${p.displayName} • Botão Direito: 👢 Expulsar`
                  : `👆 Clique para cutucar ${p.displayName}`;
            break;
          }
        }
      }
    }

    if (this.draggingFurnitureId || this.hoveredFurnitureId) {
      this.canvas.style.cursor = this.draggingDidMove ? 'grabbing' : 'pointer';
    } else if (
      this.hoveredDropId ||
      this.hoveredPlayerId ||
      this.hoveredWindow ||
      this.hoveredWorkSign
    ) {
      this.canvas.style.cursor = 'pointer';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }

    this.callbacks.onHoverStateChange?.(label);

    if (windowBridge.isTransparentOverlay) {
      const isOverInteractive =
        y >= PixelCanvasRenderer.FLOOR_Y - 6 ||
        Boolean(this.hoveredDropId) ||
        Boolean(this.hoveredPlayerId) ||
        Boolean(this.hoveredFurnitureId) ||
        Boolean(this.hoveredWindow) ||
        Boolean(this.hoveredWorkSign) ||
        Boolean(this.draggingFurnitureId);
      windowBridge.setClickThrough(!isOverInteractive);
    }
  }

  private startLoop() {
    const step = () => {
      this.tick++;
      this.updatePhysics();
      this.render();
      this.animFrameId = requestAnimationFrame(step);
    };
    this.animFrameId = requestAnimationFrame(step);
  }

  private updatePhysics() {
    if (!this.room) return;
    const now = Date.now();

    for (const p of this.room.players) {
      const phys = this.physics.get(p.userId);
      if (!phys) continue;

      const hasSpeedBoost = Boolean(p.speedBoostUntil && p.speedBoostUntil > now);
      const moveSpeed = hasSpeedBoost ? 3.8 : 2.1;

      const dx = p.targetX - phys.renderX;
      if (Math.abs(dx) > 0.8) {
        phys.renderX += Math.sign(dx) * Math.min(Math.abs(dx), moveSpeed);
        phys.walkFrame += hasSpeedBoost ? 0.35 : 0.22;

        if (hasSpeedBoost && this.tick % 4 === 0) {
          this.particles.push({
            x: phys.renderX,
            y: PixelCanvasRenderer.FLOOR_Y - 6,
            vx: (Math.random() - 0.5) * 0.6,
            vy: -0.5,
            color: '#facc15',
            size: 2,
            alpha: 0.9,
            life: 14,
          });
        }
      } else {
        phys.renderX = p.targetX;
        phys.walkFrame = 0;
      }

      if (phys.renderY < 0 || phys.vy !== 0) {
        phys.renderY += phys.vy;
        phys.vy += 0.38;

        if (p.equipped.avatar_back === 'back_jetpack' && phys.vy < 0 && this.tick % 2 === 0) {
          this.particles.push({
            x: phys.renderX + (p.facing === 'right' ? -7 : 7),
            y: PixelCanvasRenderer.FLOOR_Y + phys.renderY - 8,
            vx: (Math.random() - 0.5) * 0.8,
            vy: 1.4,
            color: Math.random() > 0.5 ? '#f97316' : '#facc15',
            size: 3,
            alpha: 1,
            life: 12,
          });
        }

        if (phys.renderY >= 0) {
          phys.renderY = 0;
          phys.vy = 0;
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.progress += 0.045;
      if (proj.progress >= 1) {
        soundEngine.playHit(proj.itemId);
        this.triggerJump(proj.targetUserId);
        const burstColor =
          proj.itemId === 'throw_glitter_bomb'
            ? '#f472b6'
            : proj.itemId === 'throw_gold_plane'
              ? '#facc15'
              : '#38bdf8';
        this.spawnBurst(
          proj.toX,
          PixelCanvasRenderer.FLOOR_Y - 20,
          burstColor,
          proj.itemId === 'throw_glitter_bomb' ? 28 : 14
        );
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.life--;
      pt.alpha = Math.max(0, pt.life / 30);
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private render() {
    const ctx = this.ctx;
    const W = PixelCanvasRenderer.WIDTH;
    const H = PixelCanvasRenderer.HEIGHT;
    const floorY = PixelCanvasRenderer.FLOOR_Y;

    // Smoothly track own player horizontally for camera zoom
    const myPhys = this.physics.get(this.myUserId);
    const targetCamX = myPhys ? myPhys.renderX : 180;
    this.cameraX += (targetCamX - this.cameraX) * 0.14;

    const { viewLeft, viewTop } = this.getCameraViewport();

    ctx.clearRect(0, 0, W, H);

    const nowMs = Date.now();
    ctx.save();
    if (nowMs < this.nudgeShakeUntil) {
      // Tremedeira brusca estilo MSN Messenger (inclusive visível dentro do PiP Flutuante!)
      const intensity = Math.max(0.25, (this.nudgeShakeUntil - nowMs) / 920);
      const shakeX = Math.round((Math.random() - 0.5) * 16 * intensity);
      const shakeY = Math.round((Math.random() - 0.5) * 12 * intensity);
      ctx.translate(shakeX, shakeY);
    }
    if (this.zoomLevel !== 1) {
      ctx.scale(this.zoomLevel, this.zoomLevel);
      ctx.translate(-viewLeft, -viewTop);
    }

    const skinId = this.room?.roomSkinId || 'room_cozy_desk';

    if (!windowBridge.isTransparentOverlay) {
      this.drawRoomBackground(ctx, skinId, W, H, floorY);
    }

    this.drawFloorStrip(ctx, skinId, W, H, floorY);

    if (!this.room) {
      ctx.restore();
      return;
    }

    // 1. Draw Floor Rugs FIRST so furniture and avatars stand on top of them
    if (this.room.placedFurniture) {
      for (const furn of this.room.placedFurniture) {
        if (furn.itemId === 'furn_cozy_rug') {
          this.drawPlacedFurniture(ctx, furn, floorY);
        }
      }
      // 2. Draw all other Furniture & Wall Decor
      for (const furn of this.room.placedFurniture) {
        if (furn.itemId !== 'furn_cozy_rug') {
          this.drawPlacedFurniture(ctx, furn, floorY);
        }
      }
    }

    // 2.5. Draw Work Status Desk Sign ("No que estou trabalhando") on the desk/floor
    this.drawWorkStatusDeskSign(ctx, floorY);

    // Draw Desk Drops (AFK Gifts) on the floor
    for (const drop of this.room.deskDrops) {
      this.drawDeskDrop(ctx, drop, floorY);
    }

    // Draw Knock Peeking Visitor on the right window edge (Section 2.2 KNOCK)
    if (this.room.pendingKnocks.length > 0) {
      this.drawKnockPeeker(ctx, this.room.pendingKnocks[0], W, floorY);
    }

    if (this.room.hostAwayVisiting) {
      // Se o amigo saiu para visitar outra pessoa, a sala dele fica vazia e exibe a placa "Volto já"
      this.drawHostAwayNotice(ctx, W, floorY);
    } else {
      // Draw Players (Host + up to 4 Visitors)
      for (const p of this.room.players) {
        this.drawPlayer(ctx, p, floorY);
      }

      // Draw Active Projectiles (Throwables)
      for (const proj of this.projectiles) {
        this.drawProjectile(ctx, proj, floorY);
      }

      // Draw Floating Chat Bubbles above avatars (max 80 chars, 6s duration)
      const now = Date.now();
      for (const p of this.room.players) {
        const phys = this.physics.get(p.userId);
        const px = phys ? phys.renderX : p.x;
        const py = floorY + (phys ? phys.renderY : 0) - 52;
        if (p.chatBubble && p.chatBubble.expiresAt > now) {
          this.drawChatBubble(ctx, px, py, p.chatBubble.text, p.chatBubble.skinId);
        } else {
          const thought = this.ambientThoughts.get(p.userId);
          if (thought && thought.expiresAt > now) {
            this.drawAmbientThoughtBubble(ctx, px, py + 4, thought.text, thought.expiresAt - now);
          }
        }
      }
    }

    // Draw Particles
    for (const pt of this.particles) {
      ctx.save();
      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
      ctx.restore();
    }

    // Camada de Clima e Atmosfera Adaptativa em TODO o cenário (não apenas na janela!)
    if (!windowBridge.isTransparentOverlay) {
      this.drawAdaptiveScenarioWeatherForeground(ctx, skinId, W, H, floorY);
    }

    ctx.restore();

    // Screen-Space HUD (visível inclusive dentro do PiP Flutuante via captureStream)
    if (!this.room.hostAwayVisiting && (this.room.players.length || 0) >= 2) {
      this.drawCoWorkingHud(ctx);
    }
    if (this.focusOverlay && this.focusOverlay.active) {
      this.drawFocusTimerHud(ctx, W, H);
    }
    if (this.nudgeBanner && this.nudgeBanner.expiresAt > nowMs) {
      this.drawMsnNudgeHud(ctx, W, this.nudgeBanner.text);
    }
  }

  /**
   * Exibe a placa e mensagem "Volto já" quando você visita a sala de um amigo
   * que saiu para visitar outra pessoa (deixando a sala vazia).
   */
  private drawHostAwayNotice(ctx: CanvasRenderingContext2D, W: number, floorY: number) {
    if (!this.room) return;
    const cx = Math.round(W / 2);
    const bob = Math.round(Math.sin(Date.now() * 0.004) * 1.5);

    ctx.save();

    // 1. Pequeno cavalete de madeira no centro do chão da sala vazia
    ctx.fillStyle = '#451a03';
    ctx.fillRect(cx - 14, floorY - 3, 28, 3);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(cx - 9, floorY - 16, 3, 14);
    ctx.fillRect(cx + 6, floorY - 16, 3, 14);

    // 2. Placa principal centralizada na sala ("Volto já")
    const title = '🪧 Volto já!';
    const hostName = (this.room.hostDisplayName || 'Amigo').slice(0, 18);
    const targetName = (this.room.hostVisitingDisplayName || '').slice(0, 16);
    const subtitle = targetName
      ? `${hostName} foi visitar ${targetName}`
      : `${hostName} foi visitar outro cantinho`;

    ctx.font = 'bold 8px monospace';
    const subW = ctx.measureText(subtitle).width;
    const boxW = Math.max(136, Math.round(subW + 22));
    const boxH = 38;
    const boxX = Math.round(cx - boxW / 2);
    const boxY = floorY - 54 + bob;

    // Sombra da placa
    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.fillRect(boxX + 2, boxY + 2, boxW, boxH);

    // Moldura de madeira dourada
    ctx.fillStyle = '#d97706';
    ctx.fillRect(boxX - 2, boxY - 2, boxW + 4, boxH + 4);
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(boxX - 1, boxY - 1, boxW + 2, 1);

    // Fundo escuro aconchegante da placa
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    // Pinos nos cantos da placa
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(boxX + 3, boxY + 3, 2, 2);
    ctx.fillRect(boxX + boxW - 5, boxY + 3, 2, 2);

    // Texto principal "🪧 Volto já!"
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#fde047';
    ctx.textAlign = 'center';
    ctx.fillText(title, cx, boxY + 16);

    // Subtítulo explicando que o amigo saiu para visitar outra pessoa
    ctx.font = 'bold 7.5px monospace';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(subtitle, cx, boxY + 30);

    ctx.restore();
  }

  /**
   * Banner estilo MSN Messenger no topo central do Canvas quando alguém chama atenção
   */
  private drawMsnNudgeHud(ctx: CanvasRenderingContext2D, W: number, text: string) {
    ctx.save();
    ctx.font = 'bold 8.5px monospace';
    const textW = ctx.measureText(text).width;
    const boxW = Math.round(textW + 16);
    const boxH = 18;
    const boxX = Math.round((W - boxW) / 2);
    const boxY = 24;

    ctx.fillStyle = 'rgba(30, 58, 138, 0.94)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    ctx.fillStyle = '#fef08a';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, boxY + 12);
    ctx.restore();
  }

  /**
   * Ícone discreto de "🤝 Trabalhando juntos (+2 🪙)" no canto superior esquerdo do Canvas
   */
  private drawCoWorkingHud(ctx: CanvasRenderingContext2D) {
    if (!this.room || this.room.players.length < 2) return;
    const label = '🤝 Trabalhando juntos (+2 🪙)';

    ctx.save();
    ctx.font = 'bold 8px monospace';
    const textW = ctx.measureText(label).width;
    const boxW = Math.round(textW + 12);
    const boxH = 15;
    const boxX = 6;
    const boxY = 6;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.84)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    ctx.fillStyle = '#86efac';
    ctx.textAlign = 'center';
    ctx.fillText(label, boxX + boxW / 2, boxY + 10.5);
    ctx.restore();
  }

  /**
   * Plaquinha de Mesa ("No que estou trabalhando") visível quando amigos visitam a sala
   */
  private drawWorkStatusDeskSign(ctx: CanvasRenderingContext2D, floorY: number) {
    if (!this.room) return;
    const isMyRoom = this.room.hostUserId === this.myUserId;
    const rawStatus = (this.room.hostWorkStatus || '').trim();
    if (!rawStatus && !isMyRoom) return;

    const signX = PixelCanvasRenderer.WORK_SIGN_X;
    const isHovered = this.hoveredWorkSign;

    ctx.save();
    ctx.font = 'bold 7.5px monospace';

    const displayText = rawStatus ? `🪧 ${rawStatus}` : '🪧 + Status';
    const textW = ctx.measureText(displayText).width;
    const boardW = Math.min(138, Math.max(44, Math.round(textW + 12)));
    const boardH = 14;
    const boardTop = floorY - 21;
    const leftX = Math.round(signX - boardW / 2);

    // 1. Pedestal / Cavalete de madeira na mesa
    ctx.fillStyle = '#451a03';
    ctx.fillRect(signX - 10, floorY - 3, 20, 3);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(signX - 6, floorY - 8, 3, 6);
    ctx.fillRect(signX + 3, floorY - 8, 3, 6);

    // 2. Moldura de madeira da plaquinha
    ctx.fillStyle = isHovered ? '#facc15' : rawStatus ? '#d97706' : '#78350f';
    ctx.fillRect(leftX - 1, boardTop - 1, boardW + 2, boardH + 2);

    // 3. Quadro interno escuro estilo lousa / placa de mesa
    ctx.fillStyle = rawStatus ? 'rgba(15, 23, 42, 0.94)' : 'rgba(30, 41, 59, 0.82)';
    ctx.fillRect(leftX, boardTop, boardW, boardH);

    // Detalhe de pino dourado no topo da plaquinha
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(signX - 1, boardTop + 1, 2, 2);

    // 4. Texto do status de trabalho
    ctx.fillStyle = rawStatus ? '#fef08a' : '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText(displayText, signX, boardTop + 10);

    ctx.restore();
  }

  /**
   * Contador discreto do Pomodoro / Timer de Foco no cantinho superior direito do Canvas
   * (Funciona inclusive dentro da janela PiP Flutuante!)
   */
  private drawFocusTimerHud(ctx: CanvasRenderingContext2D, W: number, _H: number) {
    if (!this.focusOverlay || !this.focusOverlay.active) return;

    const { phase, remainingSec, totalSec, activity } = this.focusOverlay;
    const mins = String(Math.floor(Math.max(0, remainingSec) / 60)).padStart(2, '0');
    const secs = String(Math.floor(Math.max(0, remainingSec) % 60)).padStart(2, '0');
    const icon = phase === 'FOCUS' ? (activity === 'READING' ? '📖' : '🍅') : '☕';
    const phaseText = phase === 'FOCUS' ? 'FOCO' : 'PAUSA';
    const label = `${icon} ${phaseText} ${mins}:${secs}`;

    ctx.save();
    ctx.font = 'bold 9px monospace';
    const textW = ctx.measureText(label).width;
    const boxW = Math.round(textW + 14);
    const boxH = 18;
    const boxX = W - boxW - 6;
    const boxY = 6;

    // Fundo translúcido escuro
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    // Borda temática (âmbar/vermelho suave para Foco, verde menta para Pausa)
    const accentColor = phase === 'FOCUS' ? '#fb923c' : '#4ade80';
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    // Barrinha de progresso discreta na base do badge
    const ratio = totalSec > 0 ? Math.max(0, Math.min(1, 1 - remainingSec / totalSec)) : 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(boxX + 2, boxY + boxH - 3, boxW - 4, 2);
    ctx.fillStyle = accentColor;
    ctx.fillRect(boxX + 2, boxY + boxH - 3, Math.round((boxW - 4) * ratio), 2);

    // Texto do timer
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(label, boxX + boxW / 2, boxY + 11.5);
    ctx.restore();
  }

  private drawAmbientThoughtBubble(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    remainingMs: number
  ) {
    ctx.save();
    const alpha = Math.min(0.92, remainingMs / 600);
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = 'bold 8.5px monospace';
    const boxW = Math.min(220, ctx.measureText(text).width + 14);
    const boxH = 15;
    const clampedX = Math.max(
      boxW / 2 + 6,
      Math.min(PixelCanvasRenderer.WIDTH - boxW / 2 - 6, x)
    );
    const floatY = y - boxH + Math.round(Math.sin(this.tick * 0.1) * 1.5);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(clampedX - boxW / 2, floatY, boxW, boxH);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(clampedX - boxW / 2, floatY, boxW, boxH);

    // Little thought cloud dots
    ctx.fillStyle = 'rgba(226, 232, 240, 0.75)';
    ctx.fillRect(clampedX - 1, floatY + boxH + 1, 3, 2);
    ctx.fillRect(clampedX, floatY + boxH + 4, 2, 2);

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(text, clampedX, floatY + 10.5);
    ctx.restore();
  }

  private drawPlacedFurniture(
    ctx: CanvasRenderingContext2D,
    furn: PlacedFurnitureItem,
    floorY: number
  ) {
    const x = Math.round(furn.x);
    const isHovered = this.hoveredFurnitureId === furn.instanceId;
    const isDragging = this.draggingFurnitureId === furn.instanceId;
    const item = getCosmeticById(furn.itemId);
    const colorOpt = getFurnitureColorOption(furn.colorVariant);
    const furnScale = 1.24;
    const halfW = Math.round(((item?.meta?.widthPx || 36) * furnScale) / 2);

    ctx.save();
    ctx.translate(x, floorY);
    ctx.scale(furn.flipped ? -furnScale : furnScale, furnScale);

    if (furn.itemId === 'furn_gamer_setup') {
      // 🖥️ Setup Gamer RGB (Desk + Dual Monitors + RGB PC Tower + Mechanical Keyboard)
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-24, -18, 4, 18);
      ctx.fillRect(20, -18, 4, 18);
      ctx.fillStyle = colorOpt ? colorOpt.primary : '#0f172a';
      ctx.fillRect(-27, -21, 54, 4);

      const rgbColors = colorOpt
        ? [colorOpt.secondary, colorOpt.accent]
        : ['#22d3ee', '#f472b6', '#a855f7', '#4ade80'];
      const c1 = rgbColors[(this.tick >> 3) % rgbColors.length];
      const c2 = rgbColors[((this.tick >> 3) + 1) % rgbColors.length];
      ctx.fillStyle = c1;
      ctx.fillRect(-26, -18, 26, 2);
      ctx.fillStyle = c2;
      ctx.fillRect(0, -18, 26, 2);

      // Left & Center Dual Monitors
      ctx.fillStyle = '#334155';
      ctx.fillRect(-20, -25, 3, 4);
      ctx.fillRect(-3, -25, 3, 4);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(-25, -39, 15, 14);
      ctx.fillRect(-9, -40, 17, 15);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(-24, -38, 13, 12);
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(-8, -39, 15, 13);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(-22, -36, 7, 2);
      ctx.fillRect(-22, -32, 9, 2);
      ctx.fillStyle = c1;
      ctx.fillRect(-6, -36, 10, 2);
      ctx.fillStyle = c2;
      ctx.fillRect(-6, -32, 8, 3);

      // RGB Mechanical Keyboard
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-10, -23, 12, 2);
      ctx.fillStyle = c1;
      ctx.fillRect(-9, -22, 10, 1);

      // Glass PC Case Tower
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(11, -39, 13, 18);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(13, -37, 9, 14);
      ctx.fillStyle = c1;
      ctx.fillRect(15, -35, 5, 4);
      ctx.fillStyle = c2;
      ctx.fillRect(15, -29, 5, 4);
    } else if (furn.itemId === 'furn_gamer_chair') {
      // 🪑 Cadeira Gamer Pro (Racing Chair with customizable color)
      const mainTrim = colorOpt ? colorOpt.secondary : '#ef4444';
      const darkBase = colorOpt ? colorOpt.primary : '#1e293b';
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-9, -3, 18, 3);
      ctx.fillRect(-2, -9, 4, 6);
      ctx.fillStyle = mainTrim;
      ctx.fillRect(-10, -2, 3, 2);
      ctx.fillRect(7, -2, 3, 2);
      ctx.fillStyle = darkBase;
      ctx.fillRect(-10, -13, 20, 4);
      ctx.fillStyle = mainTrim;
      ctx.fillRect(-10, -12, 4, 3);
      ctx.fillRect(6, -12, 4, 3);
      ctx.fillStyle = darkBase;
      ctx.fillRect(-7, -36, 14, 23);
      ctx.fillStyle = mainTrim;
      ctx.fillRect(-7, -34, 3, 20);
      ctx.fillRect(4, -34, 3, 20);
      ctx.fillStyle = colorOpt ? colorOpt.accent : '#f8fafc';
      ctx.fillRect(-4, -33, 8, 3);
      ctx.fillStyle = mainTrim;
      ctx.fillRect(-4, -18, 8, 4);
      ctx.fillStyle = '#334155';
      ctx.fillRect(-11, -19, 3, 6);
      ctx.fillRect(8, -19, 3, 6);
    } else if (furn.itemId === 'furn_dining_table') {
      // 🍽️ Mesa de Jantar Posta
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-24, -18, 4, 18);
      ctx.fillRect(20, -18, 4, 18);
      ctx.fillStyle = '#92400e';
      ctx.fillRect(-28, -22, 56, 5);
      ctx.fillStyle = colorOpt ? colorOpt.accent : '#f8fafc';
      ctx.fillRect(-22, -22, 44, 3);
      ctx.fillStyle = colorOpt ? colorOpt.secondary : '#e11d48';
      ctx.fillRect(-8, -22, 16, 6);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-21, -24, 10, 2);
      ctx.fillRect(11, -24, 10, 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-9, -28, 3, 4);
      ctx.fillRect(6, -28, 3, 4);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-8, -24, 1, 2);
      ctx.fillRect(7, -24, 1, 2);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-2, -26, 4, 4);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(-1, -31, 2, 5);
      const flicker = (this.tick >> 2) % 2 === 0 ? -1 : 0;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-1, -34 + flicker, 2, 3);
    } else if (furn.itemId === 'furn_cozy_sofa') {
      // 🛋️ Sofá Lofi 2 Lugares (Com suporte total a troca de cor!)
      const sofaDark = colorOpt ? colorOpt.primary : '#831843';
      const sofaMid = colorOpt ? colorOpt.secondary : '#db2777';
      const pillowAccent = colorOpt ? colorOpt.accent : '#fde047';

      ctx.fillStyle = sofaDark;
      ctx.fillRect(-24, -22, 48, 20);
      ctx.fillStyle = sofaMid;
      ctx.fillRect(-20, -26, 40, 14);
      ctx.fillStyle = sofaMid;
      ctx.fillRect(-20, -13, 19, 8);
      ctx.fillRect(1, -13, 19, 8);
      // Throw pillows
      ctx.fillStyle = pillowAccent;
      ctx.fillRect(-17, -21, 7, 7);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(10, -21, 7, 7);
      // Wooden sofa feet
      ctx.fillStyle = '#451a03';
      ctx.fillRect(-22, -2, 4, 2);
      ctx.fillRect(18, -2, 4, 2);
    } else if (furn.itemId === 'furn_cozy_rug') {
      // 🧶 Tapete Felpudo no chão (Personalizável por cor)
      const rugBase = colorOpt ? colorOpt.primary : '#92400e';
      const rugInner = colorOpt ? colorOpt.secondary : '#eab308';
      const rugPattern = colorOpt ? colorOpt.accent : '#fef08a';

      // White tassels on both ends
      ctx.fillStyle = '#f8fafc';
      for (let ty = -2; ty <= 4; ty += 2) {
        ctx.fillRect(-35, ty, 3, 1);
        ctx.fillRect(32, ty, 3, 1);
      }
      ctx.fillStyle = rugBase;
      ctx.fillRect(-32, -3, 64, 9);
      ctx.fillStyle = rugInner;
      ctx.fillRect(-28, -2, 56, 7);
      // Geometric pixel diamonds
      ctx.fillStyle = rugPattern;
      ctx.fillRect(-18, 0, 6, 3);
      ctx.fillRect(-3, 0, 6, 3);
      ctx.fillRect(12, 0, 6, 3);
    } else if (furn.itemId === 'furn_wall_frames') {
      // 🖼️ Galeria de Quadros na Parede
      const frameColor = colorOpt ? colorOpt.primary : '#78350f';
      const artAccent = colorOpt ? colorOpt.secondary : '#38bdf8';
      const artHighlight = colorOpt ? colorOpt.accent : '#facc15';

      // Left Frame (Mountain sunset)
      ctx.fillStyle = frameColor;
      ctx.fillRect(-22, -74, 14, 18);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-20, -72, 10, 14);
      ctx.fillStyle = artHighlight;
      ctx.fillRect(-17, -69, 4, 4);
      ctx.fillStyle = artAccent;
      ctx.fillRect(-20, -63, 10, 5);

      // Center Large Frame (Portrait / Abstract)
      ctx.fillStyle = frameColor;
      ctx.fillRect(-6, -78, 16, 22);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-4, -76, 12, 18);
      ctx.fillStyle = artAccent;
      ctx.fillRect(-2, -73, 8, 8);
      ctx.fillStyle = artHighlight;
      ctx.fillRect(0, -64, 4, 5);

      // Right Frame (Mini landscape)
      ctx.fillStyle = frameColor;
      ctx.fillRect(12, -72, 12, 15);
      ctx.fillStyle = artHighlight;
      ctx.fillRect(14, -70, 8, 11);
      ctx.fillStyle = artAccent;
      ctx.fillRect(14, -64, 8, 5);
    } else if (furn.itemId === 'furn_floor_lamp') {
      // 💡 Luminária de Piso Aconchegante com Cone de Luz
      const shadeColor = colorOpt ? colorOpt.secondary : '#eab308';
      const glowColor = colorOpt ? colorOpt.accent : '#fef08a';

      // Soft warm light cone
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.moveTo(-6, -34);
      ctx.lineTo(6, -34);
      ctx.lineTo(18, 0);
      ctx.lineTo(-18, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Stand base & pole
      ctx.fillStyle = '#475569';
      ctx.fillRect(-7, -3, 14, 3);
      ctx.fillRect(-1, -36, 2, 33);

      // Lamp Shade
      ctx.fillStyle = shadeColor;
      ctx.fillRect(-8, -46, 16, 11);
      ctx.fillStyle = glowColor;
      ctx.fillRect(-6, -36, 12, 2);
    } else if (furn.itemId === 'furn_bookshelf') {
      // 📚 Estante de Livros & Plantas
      const woodMain = colorOpt ? colorOpt.primary : '#451a03';
      const woodShelf = colorOpt ? colorOpt.secondary : '#78350f';

      ctx.fillStyle = woodMain;
      ctx.fillRect(-18, -44, 36, 44);
      ctx.fillStyle = woodShelf;
      ctx.fillRect(-19, -44, 38, 3);
      ctx.fillRect(-19, -29, 38, 3);
      ctx.fillRect(-19, -15, 38, 3);

      // Books on shelves
      const bCols = ['#ef4444', '#38bdf8', '#facc15', '#a855f7', '#4ade80'];
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = bCols[i];
        ctx.fillRect(-15 + i * 6, -40, 4, 11);
        ctx.fillRect(-14 + i * 6, -25, 5, 10);
        ctx.fillRect(-15 + i * 6, -11, 4, 10);
      }

      // Hanging vine on top right of bookshelf
      ctx.fillStyle = '#10b981';
      ctx.fillRect(10, -47, 8, 5);
      ctx.fillRect(13, -42, 4, 10);
      ctx.fillRect(15, -32, 3, 8);
    } else if (furn.itemId === 'furn_aquarium') {
      // 🐠 Aquário Iluminado com Peixinho Nadando
      const standColor = colorOpt ? colorOpt.primary : '#1e293b';
      ctx.fillStyle = standColor;
      ctx.fillRect(-18, -18, 36, 18);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-15, -15, 13, 12);
      ctx.fillRect(2, -15, 13, 12);

      // Glass Water Tank
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(-19, -38, 38, 20);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-17, -36, 34, 16);

      // Sand & seaweed inside tank
      ctx.fillStyle = '#fde047';
      ctx.fillRect(-17, -23, 34, 3);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(-12, -31, 3, 8);
      ctx.fillRect(9, -33, 3, 10);

      // Swimming mini fish inside aquarium
      const fishX = Math.round(Math.sin(this.tick * 0.06) * 9);
      const fishDir = Math.cos(this.tick * 0.06) >= 0 ? 1 : -1;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(fishX - 3, -31, 6, 4);
      ctx.fillRect(fishX - fishDir * 5, -30, 2, 2);

      // Top LED Hood
      ctx.fillStyle = colorOpt ? colorOpt.secondary : '#0f172a';
      ctx.fillRect(-20, -41, 40, 3);
    } else if (furn.itemId === 'furn_arcade_cabinet') {
      // 🕹️ Fliperama Arcade 90s
      ctx.fillStyle = colorOpt ? colorOpt.primary : '#3b0764';
      ctx.fillRect(-13, -46, 26, 46);
      ctx.fillStyle = colorOpt ? colorOpt.secondary : '#7e22ce';
      ctx.fillRect(-15, -46, 3, 46);
      ctx.fillRect(12, -46, 3, 46);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-12, -44, 24, 6);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(-10, -35, 20, 14);
      ctx.fillStyle = (this.tick >> 3) % 2 === 0 ? '#22d3ee' : '#f472b6';
      ctx.fillRect(-7, -31, 5, 5);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(2, -28, 4, 4);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-7, -20, 2, 3);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(3, -19, 2, 2);
      ctx.fillRect(6, -19, 2, 2);
    } else if (furn.itemId === 'furn_mini_fridge') {
      // 🧊 Frigobar RGB
      ctx.fillStyle = colorOpt ? colorOpt.primary : '#0f172a';
      ctx.fillRect(-11, -30, 22, 30);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-9, -28, 18, 26);
      ctx.strokeStyle = colorOpt ? colorOpt.secondary : '#22d3ee';
      ctx.lineWidth = 1;
      ctx.strokeRect(-8, -27, 16, 24);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-5, -23, 3, 5);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(0, -23, 3, 5);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-5, -13, 3, 5);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(0, -13, 3, 5);
    } else if (furn.itemId === 'furn_sakura_bonsai') {
      // 🌸 Bonsai de Sakura
      ctx.fillStyle = colorOpt ? colorOpt.primary : '#1e293b';
      ctx.fillRect(-9, -8, 18, 8);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-3, -22, 5, 14);
      ctx.fillRect(-8, -20, 6, 3);
      ctx.fillStyle = colorOpt ? colorOpt.secondary : '#f472b6';
      ctx.fillRect(-14, -34, 28, 12);
      ctx.fillStyle = colorOpt ? colorOpt.accent : '#fbcfe8';
      ctx.fillRect(-10, -38, 20, 8);
    } else if (furn.itemId === 'furn_coffee_machine') {
      // ☕ Estação de Café Expresso (Bancada + Cafeteira Italiana/Barista + Canecas + Vapor)
      const cabColor = colorOpt ? colorOpt.primary : '#78350f';
      const machineColor = colorOpt ? colorOpt.secondary : '#dc2626';
      const cupAccent = colorOpt ? colorOpt.accent : '#fde047';

      // Wooden Barista Cabinet
      ctx.fillStyle = cabColor;
      ctx.fillRect(-14, -18, 28, 18);
      ctx.fillStyle = '#451a03';
      ctx.fillRect(-12, -15, 11, 12);
      ctx.fillRect(1, -15, 11, 12);
      // Countertop slab
      ctx.fillStyle = '#d6d3d1';
      ctx.fillRect(-15, -20, 30, 3);

      // Espresso Machine Body
      ctx.fillStyle = machineColor;
      ctx.fillRect(-11, -33, 14, 13);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-10, -31, 12, 3);
      // Grouphead & Portafilter
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-6, -26, 4, 3);
      ctx.fillRect(-3, -25, 5, 1);
      // Espresso cup underneath with warm coffee
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-6, -23, 4, 3);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-5, -23, 2, 1);

      // Coffee Bean Grinder / Jar & Stacked Mugs on right
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(5, -29, 6, 9);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(6, -28, 4, 5);
      ctx.fillStyle = cupAccent;
      ctx.fillRect(11, -24, 3, 4);

      // Animated rising coffee steam wisps
      const steamOffset = (this.tick >> 3) % 4;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(-5, -36 - steamOffset, 2, 3);
      ctx.fillRect(-2, -34 - ((steamOffset + 2) % 4), 1, 2);
    } else if (furn.itemId === 'furn_pet_bed') {
      // 🛏️ Caminha Pet & Pufe Aconchegante
      const bolsterColor = colorOpt ? colorOpt.primary : '#581c87';
      const cushionColor = colorOpt ? colorOpt.secondary : '#a855f7';
      const pillowTrim = colorOpt ? colorOpt.accent : '#fde047';

      // Soft outer plush bolster ring
      ctx.fillStyle = bolsterColor;
      ctx.fillRect(-17, -9, 34, 9);
      ctx.fillRect(-19, -7, 38, 6);
      // Inner quilted cushion
      ctx.fillStyle = cushionColor;
      ctx.fillRect(-14, -7, 28, 5);
      // Little side pillow / headrest
      ctx.fillStyle = pillowTrim;
      ctx.fillRect(-13, -10, 8, 4);
      // Cute stitch dots on cushion
      ctx.fillStyle = bolsterColor;
      ctx.fillRect(-2, -5, 2, 1);
      ctx.fillRect(5, -5, 2, 1);
    } else if (furn.itemId === 'furn_monstera_plant') {
      // 🪴 Vaso Costela-de-Adão (Monstera Deliciosa)
      const potBase = colorOpt ? colorOpt.primary : '#b45309';
      const potRim = colorOpt ? colorOpt.secondary : '#d97706';
      const leafMain = '#15803d';
      const leafBright = colorOpt ? colorOpt.accent : '#22c55e';
      const sway = Math.round(Math.sin(this.tick * 0.05 + furn.x) * 1.5);

      // Ceramic Pot & Stand
      ctx.fillStyle = '#451a03';
      ctx.fillRect(-6, -3, 2, 3);
      ctx.fillRect(4, -3, 2, 3);
      ctx.fillStyle = potBase;
      ctx.fillRect(-7, -13, 14, 10);
      ctx.fillStyle = potRim;
      ctx.fillRect(-8, -15, 16, 3);

      // Stems
      ctx.fillStyle = '#166534';
      ctx.fillRect(-2, -25, 2, 10);
      ctx.fillRect(1, -28, 2, 13);

      // Broad Monstera Leaves with gentle sway
      ctx.fillStyle = leafMain;
      ctx.fillRect(-12 + sway, -26, 9, 7);
      ctx.fillRect(3 + sway, -27, 9, 7);
      ctx.fillStyle = leafBright;
      ctx.fillRect(-6 + sway, -34, 12, 8);
      // Fenestration slits on leaves
      ctx.fillStyle = '#064e3b';
      ctx.fillRect(-4 + sway, -32, 2, 1);
      ctx.fillRect(2 + sway, -30, 2, 1);
    } else if (furn.itemId === 'furn_dj_booth') {
      // 🎛️ Mesa de DJ Double D (Toca-discos duplos + Mixer + Subwoofers + Equalizador LED Frontal)
      const boothBase = colorOpt ? colorOpt.primary : '#0f172a';
      const goldTrim = colorOpt ? colorOpt.secondary : '#facc15';
      const neonAccent = colorOpt ? colorOpt.accent : '#22d3ee';

      // Side Subwoofers (Left & Right Speakers)
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-30, -26, 9, 26);
      ctx.fillRect(21, -26, 9, 26);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(-28, -23, 5, 8);
      ctx.fillRect(-28, -12, 5, 9);
      ctx.fillRect(23, -23, 5, 8);
      ctx.fillRect(23, -12, 5, 9);
      const speakerPulse = (this.tick >> 2) % 2 === 0 ? neonAccent : '#f472b6';
      ctx.fillStyle = speakerPulse;
      ctx.fillRect(-27, -20, 3, 3);
      ctx.fillRect(-27, -9, 3, 3);
      ctx.fillRect(24, -20, 3, 3);
      ctx.fillRect(24, -9, 3, 3);

      // Main DJ Booth Cabinet
      ctx.fillStyle = boothBase;
      ctx.fillRect(-21, -22, 42, 22);
      // Golden top trim & base trim
      ctx.fillStyle = goldTrim;
      ctx.fillRect(-23, -24, 46, 3);
      ctx.fillRect(-21, -2, 42, 2);

      // Front Animated LED Equalizer Bars (7 columns)
      const eqColors = ['#22d3ee', '#38bdf8', '#a855f7', '#ec4899', '#f43f5e', '#facc15', '#4ade80'];
      for (let i = 0; i < 7; i++) {
        const colX = -17 + i * 5;
        const barH = 4 + Math.abs(Math.round(Math.sin(this.tick * 0.18 + i * 0.9) * 12));
        ctx.fillStyle = eqColors[i % eqColors.length];
        ctx.fillRect(colX, -3 - barH, 4, barH);
      }

      // Dual Vinyl Turntables on Top of Deck
      const spinPhase = (this.tick >> 2) % 4;
      // Left Turntable
      ctx.fillStyle = '#111827';
      ctx.fillRect(-19, -28, 12, 4);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-15 + (spinPhase % 2), -27, 4, 2);
      // Right Turntable
      ctx.fillStyle = '#111827';
      ctx.fillRect(7, -28, 12, 4);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(11 + (spinPhase % 2), -27, 4, 2);

      // Center Mixer & Raised DJ Laptop Stand
      ctx.fillStyle = '#334155';
      ctx.fillRect(-6, -27, 12, 3);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(-4, -26, 2, 1);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(0, -26, 2, 1);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(3, -26, 2, 1);

      // DJ Laptop Screen with Soundwave
      ctx.fillStyle = '#090d16';
      ctx.fillRect(-7, -37, 14, 10);
      ctx.strokeStyle = goldTrim;
      ctx.lineWidth = 1;
      ctx.strokeRect(-7, -37, 14, 10);
      ctx.fillStyle = neonAccent;
      ctx.fillRect(-5, -33, 10, 2);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(-3, -35 + (spinPhase % 2), 6, 2);
    }

    ctx.restore();

    // Draw Dragging / Hover highlight box & coordinate only in the owner's own room
    const isMyRoom = !this.room || this.room.hostUserId === this.myUserId;
    if (isMyRoom && (isDragging || isHovered || this.editFurnitureMode)) {
      ctx.save();
      ctx.strokeStyle = isDragging
        ? '#4ade80'
        : isHovered
          ? '#facc15'
          : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = isDragging || isHovered ? 1.5 : 1;
      ctx.setLineDash(isDragging ? [] : [3, 3]);

      const boxTop =
        furn.itemId === 'furn_wall_frames'
          ? floorY - 98
          : furn.itemId === 'furn_cozy_rug'
            ? floorY - 6
            : floorY - 56;
      const boxH =
        furn.itemId === 'furn_wall_frames'
          ? 52
          : furn.itemId === 'furn_cozy_rug'
            ? 14
            : 56;

      ctx.strokeRect(x - halfW - 2, boxTop, halfW * 2 + 4, boxH);

      if (isDragging || isHovered) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(x - 28, boxTop - 13, 56, 11);
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`↔ X:${x}`, x, boxTop - 5);
      }
      ctx.restore();
    }
  }

  private drawRoomBackground(
    ctx: CanvasRenderingContext2D,
    skinId: string,
    W: number,
    _H: number,
    floorY: number
  ) {
    const dayInfo = getLocalDayTimeInfo();
    const isRainActive = soundEngine.isAmbientActive('rain');
    const isFireActive = soundEngine.isAmbientActive('fireplace');

    if (skinId === 'room_dense_forest') {
      // 🌲 Floresta Densa Encantada (Clima e Horário Adaptativos: Dia Ensolarado, Amanhecer/Pôr do Sol, Noite Bioluminescente e Chuva)
      const grad = ctx.createLinearGradient(0, 0, 0, floorY);
      if (isRainActive) {
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(0.55, '#064e3b');
        grad.addColorStop(1, '#115e59');
      } else if (dayInfo.phase === 'DAY') {
        grad.addColorStop(0, '#047857');
        grad.addColorStop(0.55, '#065f46');
        grad.addColorStop(1, '#14532d');
      } else if (dayInfo.phase === 'DAWN') {
        grad.addColorStop(0, '#3b0764');
        grad.addColorStop(0.45, '#701a75');
        grad.addColorStop(1, '#064e3b');
      } else if (dayInfo.phase === 'SUNSET') {
        grad.addColorStop(0, '#7c2d12');
        grad.addColorStop(0.5, '#9a3412');
        grad.addColorStop(1, '#14532d');
      } else {
        grad.addColorStop(0, '#022c22');
        grad.addColorStop(0.6, '#064e3b');
        grad.addColorStop(1, '#14532d');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, floorY);

      // Raios de sol / crepúsculo atravessando a copa das árvores durante o Dia, Amanhecer ou Pôr do Sol (quando não chove)
      if (!isRainActive && dayInfo.phase !== 'NIGHT') {
        ctx.save();
        ctx.fillStyle =
          dayInfo.phase === 'DAY'
            ? 'rgba(254, 240, 138, 0.14)'
            : dayInfo.phase === 'SUNSET'
              ? 'rgba(251, 146, 60, 0.18)'
              : 'rgba(244, 114, 182, 0.14)';
        for (let rx = 24; rx < W; rx += 105) {
          ctx.beginPath();
          ctx.moveTo(rx, 18);
          ctx.lineTo(rx + 28, 18);
          ctx.lineTo(rx + 74, floorY);
          ctx.lineTo(rx + 32, floorY);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // Back layer giant tree trunks
      ctx.fillStyle = dayInfo.phase === 'DAY' && !isRainActive ? '#064e3b' : '#052e16';
      for (let tx = 8; tx < W; tx += 52) {
        ctx.fillRect(tx, 0, 18, floorY);
      }

      // Foreground giant oak trunks with bark texture
      for (let tx = 30; tx < W; tx += 78) {
        ctx.fillStyle = dayInfo.phase === 'DAY' && !isRainActive ? '#522f0a' : '#3f2305';
        ctx.fillRect(tx, 0, 24, floorY);
        ctx.fillStyle = '#291502';
        ctx.fillRect(tx + 16, 0, 8, floorY);
      }

      // Dense leaf canopy along top ceiling
      ctx.fillStyle = dayInfo.phase === 'DAY' && !isRainActive ? '#047857' : '#065f46';
      ctx.fillRect(0, 0, W, 28);
      for (let lx = 0; lx < W; lx += 28) {
        ctx.fillStyle =
          lx % 56 === 0
            ? dayInfo.phase === 'SUNSET'
              ? '#15803d'
              : '#047857'
            : '#15803d';
        ctx.fillRect(lx, 16, 30, 18);
      }

      // Hanging vines swaying gently
      const windBoost = soundEngine.isAmbientActive('brown_noise') || isRainActive ? 3.5 : 2;
      for (let vx = 22; vx < W; vx += 46) {
        const sway = Math.round(Math.sin(this.tick * 0.05 + vx) * windBoost);
        const vineLen = 28 + (vx % 26);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(vx + sway, 24, 2, vineLen);
        ctx.fillStyle = '#4ade80';
        ctx.fillRect(vx + sway - 2, 24 + vineLen - 4, 5, 4);
      }

      // Glowing bioluminescent mushrooms near forest floor (brilham mais forte à noite e na chuva!)
      const mushPositions = [48, 128, 224, 312];
      mushPositions.forEach((mx, idx) => {
        if (dayInfo.phase === 'NIGHT' || isRainActive) {
          ctx.fillStyle =
            idx % 2 === 0 ? 'rgba(56, 189, 248, 0.22)' : 'rgba(244, 114, 182, 0.22)';
          ctx.fillRect(mx - 8, floorY - 15, 17, 14);
        }
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(mx - 1, floorY - 7, 3, 7);
        ctx.fillStyle = idx % 2 === 0 ? '#38bdf8' : '#f472b6';
        ctx.fillRect(mx - 5, floorY - 11, 11, 5);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(mx - 3, floorY - 10, 2, 2);
        ctx.fillRect(mx + 2, floorY - 9, 2, 2);
      });

      // Vaga-lumes à noite/crepúsculo OU pólen/borboletas douradas durante o dia
      for (let i = 0; i < 18; i++) {
        const fx = (i * 47 + Math.round(Math.sin(this.tick * 0.03 + i) * 8)) % W;
        const fy = 32 + ((i * 29 + Math.round(Math.cos(this.tick * 0.04 + i) * 6)) % (floorY - 46));
        ctx.fillStyle =
          dayInfo.phase === 'DAY'
            ? i % 3 === 0
              ? '#f472b6'
              : '#fef08a'
            : '#fde047';
        const s = Math.sin(this.tick * 0.1 + i) > 0 ? 2 : 1;
        ctx.fillRect(fx, fy, s, s);
      }
    } else if (skinId === 'room_office') {
      // 🏢 Escritório Executivo Moderno (Com Ciclo Dia / Pôr do Sol / Noite + Clima Adaptativo e Relógio Real)
      const grad = ctx.createLinearGradient(0, 0, 0, floorY);
      if (isRainActive) {
        grad.addColorStop(0, '#1e293b');
        grad.addColorStop(1, '#334155');
      } else if (dayInfo.phase === 'DAY') {
        grad.addColorStop(0, '#26354d');
        grad.addColorStop(1, '#3b4f6b');
      } else if (dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN') {
        grad.addColorStop(0, '#2b243d');
        grad.addColorStop(1, '#47364f');
      } else {
        grad.addColorStop(0, '#131c2e');
        grad.addColorStop(1, '#1e293b');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, floorY);

      // Panoramic Corporate Window with Dynamic Skyline (Left: x=20..130, y=20..102)
      const winSkyGrad = ctx.createLinearGradient(0, 20, 0, 102);
      if (isRainActive) {
        winSkyGrad.addColorStop(0, '#1e293b');
        winSkyGrad.addColorStop(0.6, '#334155');
        winSkyGrad.addColorStop(1, '#475569');
      } else if (dayInfo.phase === 'DAY') {
        winSkyGrad.addColorStop(0, '#38bdf8');
        winSkyGrad.addColorStop(1, '#bae6fd');
      } else if (dayInfo.phase === 'DAWN') {
        winSkyGrad.addColorStop(0, '#6d28d9');
        winSkyGrad.addColorStop(0.55, '#f472b6');
        winSkyGrad.addColorStop(1, '#fde047');
      } else if (dayInfo.phase === 'SUNSET') {
        winSkyGrad.addColorStop(0, '#7c2d12');
        winSkyGrad.addColorStop(0.55, '#f97316');
        winSkyGrad.addColorStop(1, '#fde047');
      } else {
        winSkyGrad.addColorStop(0, '#090d16');
        winSkyGrad.addColorStop(1, '#1e1b4b');
      }
      ctx.fillStyle = winSkyGrad;
      ctx.fillRect(20, 20, 110, 82);

      // Sun or Moon in Office Window (hidden behind clouds when raining heavily)
      if (!isRainActive) {
        if (dayInfo.phase === 'DAY') {
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(104, 28, 12, 12);
        } else if (dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN') {
          ctx.fillStyle = '#fb923c';
          ctx.fillRect(98, 52, 16, 14);
          ctx.fillStyle = '#fde047';
          ctx.fillRect(101, 55, 10, 8);
        } else {
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(106, 28, 10, 10);
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(36, 30, 2, 2);
          ctx.fillRect(74, 27, 2, 2);
        }
      } else {
        // Nuvens carregadas de chuva no topo do janelão
        ctx.fillStyle = '#475569';
        ctx.fillRect(24, 22, 46, 8);
        ctx.fillRect(76, 24, 48, 8);
      }

      // City skyline silhouette
      const bldgColor = isRainActive
        ? '#1e293b'
        : dayInfo.phase === 'DAY'
          ? '#0284c7'
          : dayInfo.phase === 'NIGHT'
            ? '#0f172a'
            : '#31102f';
      ctx.fillStyle = bldgColor;
      ctx.fillRect(28, 48, 22, 54);
      ctx.fillRect(54, 34, 28, 68);
      ctx.fillRect(88, 52, 32, 50);

      // Lit building windows at Sunset/Night or during Rainy Overcast weather
      if (dayInfo.phase === 'NIGHT' || dayInfo.phase === 'SUNSET' || isRainActive) {
        ctx.fillStyle = '#fde047';
        for (let wy = 40; wy < 96; wy += 10) {
          ctx.fillRect(58, wy, 4, 4);
          ctx.fillRect(68, wy, 4, 4);
          if (wy >= 54) {
            ctx.fillRect(32, wy, 4, 4);
            ctx.fillRect(94, wy, 4, 4);
            ctx.fillRect(104, wy, 4, 4);
          }
        }
      }

      // Rain streaks & droplets inside Office Window when raining
      if (isRainActive) {
        this.drawWindowRainAndDroplets(ctx, 20, 20, 110, 82);
      }

      // Horizontal office blinds
      ctx.fillStyle = 'rgba(241, 245, 249, 0.45)';
      for (let by = 24; by < 52; by += 6) {
        ctx.fillRect(22, by, 106, 2);
      }
      ctx.strokeStyle = this.hoveredWindow ? '#facc15' : '#0f172a';
      ctx.lineWidth = 3;
      ctx.strokeRect(20, 20, 110, 82);

      // Diagonal Window Light Beam onto office floor
      ctx.save();
      ctx.fillStyle = isRainActive
        ? 'rgba(125, 211, 252, 0.08)'
        : dayInfo.phase === 'DAY'
          ? 'rgba(186, 230, 253, 0.10)'
          : dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN'
            ? 'rgba(251, 146, 60, 0.13)'
            : 'rgba(148, 163, 184, 0.06)';
      ctx.beginPath();
      ctx.moveTo(20, 102);
      ctx.lineTo(130, 102);
      ctx.lineTo(175, floorY);
      ctx.lineTo(35, floorY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Wall Clock (Center) reflecting real time
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(156, 24, 18, 18);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.strokeRect(156, 24, 18, 18);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(164, 28, 2, 6);
      ctx.fillRect(164, 32, 5, 2);

      // Agile Kanban / Strategy Whiteboard (Right)
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(198, 24, 96, 62);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3;
      ctx.strokeRect(198, 24, 96, 62);
      // Bar chart on whiteboard
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(208, 64, 8, 14);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(220, 56, 8, 22);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(232, 44, 8, 34);
      // Sticky notes on whiteboard
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(254, 34, 12, 12);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(270, 34, 12, 12);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(254, 50, 12, 12);

      // Office Water Cooler on far right
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(318, floorY - 34, 20, 34);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(321, floorY - 52, 14, 18);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(323, floorY - 24, 3, 4);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(330, floorY - 24, 3, 4);
    } else if (skinId === 'room_underwater') {
      // 🌊 Fundo do Mar / Recife de Corais (Adaptativo: Mar Turquesa Solar de Dia, Reflexos Dourados no Pôr do Sol e Mar Bioluminescente à Noite)
      const grad = ctx.createLinearGradient(0, 0, 0, floorY);
      if (dayInfo.phase === 'DAY') {
        grad.addColorStop(0, isRainActive ? '#0c4a6e' : '#0284c7');
        grad.addColorStop(0.55, '#0369a1');
        grad.addColorStop(1, '#075985');
      } else if (dayInfo.phase === 'DAWN' || dayInfo.phase === 'SUNSET') {
        grad.addColorStop(0, '#4c1d95');
        grad.addColorStop(0.45, '#0369a1');
        grad.addColorStop(1, '#082f49');
      } else {
        // Noite Abissal Bioluminescente
        grad.addColorStop(0, '#020617');
        grad.addColorStop(0.55, '#082f49');
        grad.addColorStop(1, '#0c4a6e');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, floorY);

      // Feixes de luz atravessando a água (solares de dia, dourados/rosados no pôr do sol, luar sutil à noite)
      ctx.save();
      ctx.fillStyle =
        dayInfo.phase === 'DAY'
          ? 'rgba(186, 230, 253, 0.14)'
          : dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN'
            ? 'rgba(251, 146, 60, 0.14)'
            : 'rgba(56, 189, 248, 0.06)';
      for (let rx = 20; rx < W; rx += 95) {
        ctx.beginPath();
        ctx.moveTo(rx, 0);
        ctx.lineTo(rx + 36, 0);
        ctx.lineTo(rx + 78, floorY);
        ctx.lineTo(rx + 28, floorY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Plâncton bioluminescente brilhando à noite
      if (dayInfo.phase === 'NIGHT') {
        for (let p = 0; p < 16; p++) {
          const px = (p * 43 + Math.round(Math.sin(this.tick * 0.04 + p) * 6)) % W;
          const py = 18 + ((p * 27 + Math.round(Math.cos(this.tick * 0.03 + p) * 5)) % (floorY - 36));
          ctx.fillStyle = p % 2 === 0 ? '#22d3ee' : '#f472b6';
          const sz = Math.sin(this.tick * 0.08 + p) > 0 ? 2 : 1;
          ctx.fillRect(px, py, sz, sz);
        }
      }

      // Background swimming fish silhouettes
      for (let i = 0; i < 4; i++) {
        const fx = ((this.tick * (i % 2 === 0 ? 1 : -1) + i * 95) % W + W) % W;
        const fy = 28 + i * 22;
        ctx.fillStyle =
          dayInfo.phase === 'NIGHT' ? 'rgba(34, 211, 238, 0.45)' : 'rgba(12, 74, 110, 0.65)';
        ctx.fillRect(fx, fy, 10, 5);
        ctx.fillRect(fx - 3, fy + 1, 3, 3);
      }

      // Swaying kelp / seaweed & colorful corals along bottom
      for (let kx = 18; kx < W; kx += 48) {
        const sway = Math.round(Math.sin(this.tick * 0.06 + kx) * 3);
        ctx.fillStyle = '#10b981';
        ctx.fillRect(kx, floorY - 22, 5, 22);
        ctx.fillRect(kx + sway, floorY - 42, 5, 20);
        ctx.fillStyle = kx % 96 === 0 ? '#f43f5e' : '#a855f7';
        ctx.fillRect(kx + 18, floorY - 18, 14, 18);
        ctx.fillRect(kx + 14, floorY - 24, 8, 10);
        ctx.fillRect(kx + 26, floorY - 22, 8, 10);
      }

      // Rising water bubbles
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.7)';
      ctx.lineWidth = 1;
      const bubbleCount = isRainActive ? 22 : 14;
      for (let b = 0; b < bubbleCount; b++) {
        const bx = (b * 29 + Math.round(Math.sin(this.tick * 0.05 + b) * 4)) % W;
        const by = floorY - ((this.tick + b * 19) % floorY);
        ctx.strokeRect(bx, by, 4, 4);
      }
    } else if (skinId === 'room_rainy_rooftop') {
      // 🌆 Terraço Urbano Lofi (Adaptativo: Céu Diurno, Amanhecer, Pôr do Sol Laranja e Noite Neon + Chuva Adaptativa)
      const grad = ctx.createLinearGradient(0, 0, 0, floorY);
      if (isRainActive) {
        grad.addColorStop(0, '#090d16');
        grad.addColorStop(1, '#1e293b');
      } else if (dayInfo.phase === 'DAY') {
        grad.addColorStop(0, '#0284c7');
        grad.addColorStop(0.65, '#38bdf8');
        grad.addColorStop(1, '#bae6fd');
      } else if (dayInfo.phase === 'DAWN') {
        grad.addColorStop(0, '#4c1d95');
        grad.addColorStop(0.55, '#ec4899');
        grad.addColorStop(1, '#fde047');
      } else if (dayInfo.phase === 'SUNSET') {
        grad.addColorStop(0, '#431407');
        grad.addColorStop(0.45, '#c2410c');
        grad.addColorStop(0.8, '#fb923c');
        grad.addColorStop(1, '#fde047');
      } else {
        grad.addColorStop(0, '#090d16');
        grad.addColorStop(1, '#1e293b');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, floorY);

      // Sol, Lua ou Nuvens no horizonte do Terraço Urbano
      if (!isRainActive) {
        if (dayInfo.phase === 'DAY') {
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(290, 18, 16, 16);
          const cx = ((this.tick * 0.15) % (W + 60)) - 30;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.fillRect(Math.round(cx), 22, 34, 6);
          ctx.fillRect(Math.round(cx) + 6, 18, 20, 4);
        } else if (dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN') {
          ctx.fillStyle = 'rgba(251, 146, 60, 0.35)';
          ctx.fillRect(196, 30, 28, 28);
          ctx.fillStyle = '#fde047';
          ctx.fillRect(201, 35, 18, 18);
        } else {
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(292, 16, 12, 12);
          ctx.fillStyle = '#090d16';
          ctx.fillRect(297, 14, 10, 10);
        }
      }

      const buildings = [
        { x: 10, w: 38, h: 90, c: dayInfo.phase === 'DAY' && !isRainActive ? '#1e3a5f' : '#0f172a' },
        { x: 52, w: 46, h: 115, c: dayInfo.phase === 'DAY' && !isRainActive ? '#1e293b' : '#111827' },
        { x: 105, w: 34, h: 78, c: dayInfo.phase === 'DAY' && !isRainActive ? '#1e3a5f' : '#0f172a' },
        { x: 148, w: 54, h: 122, c: dayInfo.phase === 'DAY' && !isRainActive ? '#172554' : '#131c31' },
        { x: 210, w: 42, h: 96, c: dayInfo.phase === 'DAY' && !isRainActive ? '#1e3a5f' : '#0f172a' },
        { x: 260, w: 50, h: 110, c: dayInfo.phase === 'DAY' && !isRainActive ? '#1e293b' : '#111827' },
        { x: 315, w: 40, h: 85, c: dayInfo.phase === 'DAY' && !isRainActive ? '#1e3a5f' : '#0f172a' },
      ];
      buildings.forEach((b, idx) => {
        ctx.fillStyle = b.c;
        ctx.fillRect(b.x, floorY - b.h, b.w, b.h);
        ctx.fillStyle =
          dayInfo.phase === 'DAY' && !isRainActive
            ? 'rgba(186, 230, 253, 0.55)'
            : idx % 2 === 0
              ? '#38bdf8'
              : '#f472b6';
        for (let wy = floorY - b.h + 10; wy < floorY - 14; wy += 14) {
          for (let wx = b.x + 6; wx < b.x + b.w - 8; wx += 10) {
            if ((wx + wy + idx) % 3 !== 0) {
              ctx.fillRect(wx, wy, 4, 6);
            }
          }
        }
      });

      // Chuva lofi nativa do terraço (ou intensificada quando o som de chuva está ativo)
      if (isRainActive || dayInfo.phase === 'NIGHT') {
        ctx.fillStyle = 'rgba(125, 211, 252, 0.45)';
        for (let i = 0; i < 36; i++) {
          const rx = (i * 37 + this.tick * 2) % W;
          const ry = (i * 29 + this.tick * 5) % floorY;
          ctx.fillRect(rx, ry, 1, 7);
        }
      }
    } else if (skinId === 'room_forest_campfire') {
      // 🏕️ Acampamento na Floresta (Adaptativo: Dia Claro na Montanha, Pôr do Sol Dourado e Noite Estrelada na Fogueira)
      const grad = ctx.createLinearGradient(0, 0, 0, floorY);
      if (isRainActive) {
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(1, '#134e4a');
      } else if (dayInfo.phase === 'DAY') {
        grad.addColorStop(0, '#0284c7');
        grad.addColorStop(0.6, '#38bdf8');
        grad.addColorStop(1, '#bae6fd');
      } else if (dayInfo.phase === 'DAWN') {
        grad.addColorStop(0, '#4c1d95');
        grad.addColorStop(0.55, '#f472b6');
        grad.addColorStop(1, '#fde047');
      } else if (dayInfo.phase === 'SUNSET') {
        grad.addColorStop(0, '#431407');
        grad.addColorStop(0.5, '#ea580c');
        grad.addColorStop(1, '#fde047');
      } else {
        grad.addColorStop(0, '#022c22');
        grad.addColorStop(1, '#064e3b');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, floorY);

      if (dayInfo.phase === 'DAY' && !isRainActive) {
        // Sol da montanha e nuvens brancas
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(288, 16, 16, 16);
        const cloudX = ((this.tick * 0.12) % (W + 50)) - 25;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(Math.round(cloudX), 22, 32, 6);
        ctx.fillRect(Math.round(cloudX) + 6, 18, 18, 4);
      } else if (!isRainActive) {
        // Estrelas / Vaga-lumes no céu noturno ou crepuscular
        for (let i = 0; i < 22; i++) {
          const sx = (i * 53) % W;
          const sy = (i * 23) % (floorY - 40);
          ctx.fillStyle = i % 3 === 0 ? '#fde047' : '#a7f3d0';
          const pulse = Math.sin(this.tick * 0.06 + i) > 0 ? 2 : 1;
          ctx.fillRect(sx, sy, pulse, pulse);
        }
      }

      // Pinheiros da floresta
      for (let tx = 16; tx < W; tx += 44) {
        ctx.fillStyle = dayInfo.phase === 'DAY' && !isRainActive ? '#15803d' : '#065f46';
        ctx.fillRect(tx + 8, floorY - 64, 8, 64);
        ctx.fillStyle = dayInfo.phase === 'DAY' && !isRainActive ? '#16a34a' : '#047857';
        ctx.fillRect(tx, floorY - 46, 24, 16);
        ctx.fillRect(tx + 3, floorY - 60, 18, 16);
        ctx.fillRect(tx + 6, floorY - 72, 12, 14);
      }

      // Fogueira central (fica mais intensa à noite, no pôr do sol ou com som de Lareira ligado!)
      const cx = 180;
      ctx.fillStyle = '#78350f';
      ctx.fillRect(cx - 12, floorY - 6, 24, 6);
      const fireBoost = isFireActive ? 5 : dayInfo.phase === 'NIGHT' ? 2 : 0;
      const flameH = 10 + fireBoost + Math.floor(Math.sin(this.tick * 0.25) * 3);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(cx - 8, floorY - 6 - flameH, 16, flameH);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(cx - 4, floorY - 6 - Math.floor(flameH * 0.7), 8, Math.floor(flameH * 0.7));

      // Halo quente da fogueira iluminando o acampamento
      if (dayInfo.phase !== 'DAY' || isFireActive) {
        ctx.save();
        ctx.fillStyle = 'rgba(251, 146, 60, 0.16)';
        ctx.fillRect(cx - 42, floorY - 26, 84, 26);
        ctx.restore();
      }
    } else if (skinId === 'room_moving_train') {
      // 🚆 Vagão de Trem em Movimento (Janelas Panorâmicas e Luz Interna Adaptativas ao Horário Real e Chuva!)
      ctx.fillStyle =
        dayInfo.phase === 'DAY' && !isRainActive
          ? '#332228'
          : dayInfo.phase === 'NIGHT'
            ? '#171019'
            : '#27171c';
      ctx.fillRect(0, 0, W, floorY);

      for (let wx = 20; wx < W - 30; wx += 112) {
        const skyGrad = ctx.createLinearGradient(0, 24, 0, 114);
        if (isRainActive) {
          skyGrad.addColorStop(0, '#1e293b');
          skyGrad.addColorStop(0.6, '#334155');
          skyGrad.addColorStop(1, '#475569');
        } else if (dayInfo.phase === 'DAY') {
          skyGrad.addColorStop(0, '#0284c7');
          skyGrad.addColorStop(0.6, '#38bdf8');
          skyGrad.addColorStop(1, '#bae6fd');
        } else if (dayInfo.phase === 'DAWN') {
          skyGrad.addColorStop(0, '#581c87');
          skyGrad.addColorStop(0.55, '#f472b6');
          skyGrad.addColorStop(1, '#fde047');
        } else if (dayInfo.phase === 'SUNSET') {
          skyGrad.addColorStop(0, '#c2410c');
          skyGrad.addColorStop(0.6, '#fb923c');
          skyGrad.addColorStop(1, '#fde047');
        } else {
          skyGrad.addColorStop(0, '#090d16');
          skyGrad.addColorStop(1, '#1e1b4b');
        }
        ctx.fillStyle = skyGrad;
        ctx.fillRect(wx, 26, 94, 86);

        // Paisagem em movimento lá fora (colinas de dia, estrelas/luzes urbanas à noite)
        ctx.save();
        ctx.beginPath();
        ctx.rect(wx, 26, 94, 86);
        ctx.clip();

        if (dayInfo.phase === 'NIGHT' && !isRainActive) {
          ctx.fillStyle = '#fef08a';
          ctx.fillRect(wx + 18, 36, 2, 2);
          ctx.fillRect(wx + 64, 42, 2, 2);
          // Luzes distantes da cidade passando
          const cityScroll = (this.tick * 1.5) % 94;
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(wx + 94 - cityScroll, 96, 12, 16);
          ctx.fillStyle = '#f472b6';
          ctx.fillRect(wx + ((140 - cityScroll) % 94), 92, 10, 20);
        } else if (dayInfo.phase === 'DAY' && !isRainActive) {
          ctx.fillStyle = '#16a34a';
          ctx.fillRect(wx, 94, 94, 18);
        }

        const scrollX = (this.tick * 2) % 94;
        ctx.fillStyle = dayInfo.phase === 'DAY' ? '#1e293b' : '#431407';
        ctx.fillRect(wx + 94 - scrollX, 54, 3, 58);

        if (isRainActive) {
          this.drawWindowRainAndDroplets(ctx, wx, 26, 94, 86);
        }
        ctx.restore();

        ctx.strokeStyle = this.hoveredWindow ? '#facc15' : '#78350f';
        ctx.lineWidth = 4;
        ctx.strokeRect(wx, 26, 94, 86);
      }

      // Alças suspensas do vagão
      for (let hx = 45; hx < W - 30; hx += 65) {
        const sway = Math.round(Math.sin(this.tick * 0.08) * 2);
        ctx.fillStyle = '#a1a1aa';
        ctx.fillRect(hx + sway, 0, 2, 18);
        ctx.strokeStyle = '#e4e4e7';
        ctx.lineWidth = 2;
        ctx.strokeRect(hx - 3 + sway, 18, 8, 6);
      }
    } else if (skinId === 'room_beco_rapariga') {
      // 🪧 Beco da Rapariga (Fiel à arte enviada + Céu e Iluminação do Poste Adaptativos ao Horário Real e Clima!)
      // 1. Céu no topo (0..26) com dithering quadriculado adaptativo (Azul de Dia, Laranja no Pôr do Sol, Estrelado à Noite, Cinza na Chuva)
      const skyTop = isRainActive
        ? '#1e293b'
        : dayInfo.phase === 'DAY'
          ? '#2764c8'
          : dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN'
            ? '#9a3412'
            : '#090d16';
      const skyDither = isRainActive
        ? '#475569'
        : dayInfo.phase === 'DAY'
          ? '#4f8fe8'
          : dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN'
            ? '#fb923c'
            : '#1e1b4b';

      ctx.fillStyle = skyTop;
      ctx.fillRect(0, 0, W, 26);
      ctx.fillStyle = skyDither;
      for (let dy = 18; dy < 26; dy += 2) {
        for (let dx = dy % 4 === 0 ? 0 : 2; dx < W; dx += 4) {
          ctx.fillRect(dx, dy, 2, 2);
        }
      }

      // Nuvem pixelada no canto superior direito (ou estrelas à noite quando limpo)
      if (dayInfo.phase === 'NIGHT' && !isRainActive) {
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(44, 8, 2, 2);
        ctx.fillRect(142, 11, 2, 2);
        ctx.fillRect(284, 7, 3, 3);
      } else {
        ctx.fillStyle = isRainActive
          ? '#64748b'
          : dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN'
            ? '#fed7aa'
            : '#ffffff';
        ctx.fillRect(268, 7, 36, 5);
        ctx.fillRect(252, 11, 68, 5);
        ctx.fillRect(240, 15, 92, 4);
        ctx.fillStyle = isRainActive
          ? '#475569'
          : dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN'
            ? '#fdba74'
            : '#c5d9f2';
        ctx.fillRect(248, 19, 76, 3);
      }

      // 2. Viga de concreto superior (y = 25..31)
      ctx.fillStyle = '#d6d6ce';
      ctx.fillRect(0, 25, W, 5);
      ctx.fillStyle = '#73787d';
      ctx.fillRect(0, 30, W, 2);

      // 3. Muro de concreto superior e inferior em dois tons com recorte diagonal serrilhado
      ctx.fillStyle = '#9ca2a6';
      ctx.fillRect(0, 32, W, floorY - 32);

      // Sombra diagonal esquerda do muro (#6b7075)
      ctx.fillStyle = '#6b7075';
      for (let row = 0; row < 28; row++) {
        const ry = 32 + row * 4;
        const rw = Math.max(8, 122 - row * 4);
        ctx.fillRect(0, ry, rw, 4);
      }

      // Viga horizontal divisória no meio do muro (y = 86..91)
      ctx.fillStyle = '#d6d6ce';
      ctx.fillRect(0, 86, W, 5);

      // 4. Faixa inferior salpicada da calçada (y = floorY - 22 .. floorY)
      const curbWallY = floorY - 22;
      ctx.fillStyle = '#b8bcbd';
      ctx.fillRect(0, curbWallY, W, 22);
      ctx.fillStyle = '#8c9194';
      const speckles = [
        12, 28, 64, 112, 118, 134, 148, 166, 178, 196, 208, 222, 240, 288, 304, 336, 348,
      ];
      speckles.forEach((sx, i) => {
        ctx.fillRect(sx, curbWallY + 3 + ((i * 5) % 15), 4, 2);
        ctx.fillRect((sx + 17) % W, curbWallY + 6 + ((i * 7) % 12), 3, 2);
      });

      // 5. Caixinha elétrica branca com disjuntor vermelho (ao lado da placa)
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(128, 97, 12, 16);
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(131, 99, 6, 7);
      ctx.fillStyle = '#111827';
      ctx.fillRect(133, 108, 2, 2);

      // 6. Pichações / Grafites de Rua em Pixel Art (Preto, Rosa e Vermelho)
      ctx.fillStyle = '#181b1e';
      const tagStrokes: Array<[number, number, number, number]> = [
        [152, 92, 3, 12],
        [155, 100, 3, 14],
        [146, 112, 6, 3],
        [143, 115, 3, 12],
        [176, 95, 3, 12],
        [179, 105, 3, 16],
        [182, 115, 3, 10],
        [185, 104, 3, 12],
        [188, 96, 3, 10],
        [194, 104, 3, 14],
        [197, 114, 3, 12],
        [204, 102, 3, 12],
        [210, 96, 3, 14],
        [216, 104, 3, 18],
        [232, 94, 3, 16],
        [238, 104, 3, 14],
        [248, 97, 3, 15],
        [254, 105, 3, 14],
        [324, 100, 3, 16],
        [329, 108, 3, 14],
        [335, 102, 3, 14],
        [345, 96, 3, 24],
      ];
      for (const [tx, ty, tw, th] of tagStrokes) {
        ctx.fillRect(tx, ty, tw, th);
      }

      // Símbolo circular / alvo pichado à direita
      ctx.strokeStyle = '#181b1e';
      ctx.lineWidth = 2;
      ctx.strokeRect(266, 103, 24, 19);
      ctx.strokeRect(272, 107, 12, 11);
      ctx.fillRect(276, 96, 3, 16);

      // Zig-zag rosa neon pichado por cima
      ctx.fillStyle = '#e86f9a';
      ctx.fillRect(136, 119, 8, 3);
      ctx.fillRect(144, 116, 8, 3);
      ctx.fillRect(152, 113, 6, 3);
      ctx.fillRect(158, 117, 5, 5);
      ctx.fillRect(163, 122, 6, 4);
      ctx.fillRect(169, 118, 6, 3);
      ctx.fillRect(175, 114, 6, 3);

      // Rabisco vermelho no canto esquerdo e pichação na base esquerda
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(8, 122, 4, 6);
      ctx.fillRect(12, 126, 4, 8);
      ctx.fillRect(9, 132, 4, 5);
      ctx.fillStyle = '#181b1e';
      ctx.fillRect(10, curbWallY + 2, 3, 12);
      ctx.fillRect(14, curbWallY + 8, 3, 9);
      ctx.fillRect(22, curbWallY + 4, 3, 11);
      ctx.fillRect(48, curbWallY + 6, 3, 10);
      ctx.fillRect(54, curbWallY + 3, 3, 12);
      ctx.fillRect(62, curbWallY + 7, 3, 9);

      // 7. Dois postes verticais cinza-claros que sustentam a placa até o chão
      ctx.fillStyle = '#b4b4ac';
      ctx.fillRect(36, 86, 8, floorY - 86);
      ctx.fillRect(92, 86, 8, floorY - 86);
      ctx.fillStyle = '#d4d4cc';
      ctx.fillRect(38, 86, 4, floorY - 86);
      ctx.fillRect(94, 86, 4, floorY - 86);

      // 8. Placa Vermelha/Marrom Icônica (Exatamente como na imagem!)
      ctx.fillStyle = '#5c1916';
      ctx.fillRect(16, 52, 104, 36);
      ctx.fillStyle = '#9e473e';
      ctx.fillRect(19, 55, 98, 30);
      ctx.fillStyle = '#7f231c';
      ctx.fillRect(21, 57, 94, 26);

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(44, 59, 48, 13);
      ctx.fillStyle = '#111827';
      ctx.fillRect(61, 60, 14, 6);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(64, 62, 8, 2);
      ctx.fillStyle = '#111827';
      ctx.fillRect(54, 66, 9, 5);
      ctx.fillRect(73, 66, 9, 5);

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(36, 74, 18, 2);
      ctx.fillRect(58, 74, 18, 2);
      ctx.fillRect(80, 74, 20, 2);
      ctx.fillRect(36, 78, 26, 2);
      ctx.fillRect(66, 78, 34, 2);
      ctx.fillRect(36, 81, 64, 2);

      // 9. Arbusto verde pontiagudo na calçada (direita)
      ctx.fillStyle = '#275927';
      ctx.fillRect(248, floorY - 10, 26, 10);
      ctx.fillStyle = '#3b7a2e';
      ctx.fillRect(258, floorY - 22, 6, 14);
      ctx.fillRect(246, floorY - 20, 5, 12);
      ctx.fillRect(270, floorY - 20, 5, 12);
      ctx.fillRect(236, floorY - 15, 8, 7);
      ctx.fillRect(278, floorY - 15, 8, 7);
      ctx.fillStyle = '#539e3f';
      ctx.fillRect(228, floorY - 11, 8, 4);
      ctx.fillRect(286, floorY - 11, 8, 4);
      ctx.fillRect(260, floorY - 22, 3, 10);

      // Banho de luz ambiente no muro conforme horário (Pôr do sol alaranjado / Noite urbana)
      if (dayInfo.phase === 'SUNSET' || dayInfo.phase === 'DAWN') {
        ctx.fillStyle = 'rgba(249, 115, 22, 0.14)';
        ctx.fillRect(0, 25, W, floorY - 25);
      } else if (dayInfo.phase === 'NIGHT') {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.34)';
        ctx.fillRect(0, 25, W, floorY - 25);
      }

      // 10. Poste baixo cinza-escuro com lâmpada amarela acesa à direita (brilha muito mais forte à noite e na chuva!)
      ctx.fillStyle = '#323a47';
      ctx.fillRect(300, floorY - 4, 32, 4);
      ctx.fillStyle = '#3b4454';
      ctx.fillRect(308, floorY - 32, 11, 28);
      ctx.fillRect(308, floorY - 32, 30, 8);
      ctx.fillRect(328, floorY - 24, 10, 4);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(328, floorY - 20, 7, 4);
      ctx.save();
      const baseGlow = dayInfo.phase === 'NIGHT' || isRainActive ? 0.34 : 0.18;
      ctx.globalAlpha = baseGlow + Math.sin(this.tick * 0.08) * 0.05;
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.moveTo(327, floorY - 16);
      ctx.lineTo(336, floorY - 16);
      ctx.lineTo(352, floorY);
      ctx.lineTo(306, floorY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      // Default: Estúdio Lofi Aconchegante com Ciclo Dia / Tarde / Pôr do Sol / Noite + Clima Adaptativo (room_cozy_desk)
      const wallGrad = ctx.createLinearGradient(0, 0, 0, floorY);
      if (isRainActive) {
        wallGrad.addColorStop(0, '#1e293b');
        wallGrad.addColorStop(1, '#334155');
      } else if (dayInfo.phase === 'DAY') {
        wallGrad.addColorStop(0, '#27325c');
        wallGrad.addColorStop(1, '#3b4c7e');
      } else if (dayInfo.phase === 'DAWN') {
        wallGrad.addColorStop(0, '#2e1d4a');
        wallGrad.addColorStop(1, '#4c2d5e');
      } else if (dayInfo.phase === 'SUNSET') {
        wallGrad.addColorStop(0, '#361942');
        wallGrad.addColorStop(1, '#5c2b45');
      } else {
        wallGrad.addColorStop(0, '#1e1b4b');
        wallGrad.addColorStop(1, '#312e81');
      }
      ctx.fillStyle = wallGrad;
      ctx.fillRect(0, 0, W, floorY);

      // Janela do Quarto (x: 28..104, y: 22..100) com Céu Dinâmico conforme Horário Local e Clima
      const skyGrad = ctx.createLinearGradient(0, 22, 0, 100);
      if (isRainActive) {
        skyGrad.addColorStop(0, '#0f172a');
        skyGrad.addColorStop(0.55, '#1e293b');
        skyGrad.addColorStop(1, '#475569');
      } else if (dayInfo.phase === 'DAY') {
        skyGrad.addColorStop(0, '#0284c7');
        skyGrad.addColorStop(0.55, '#38bdf8');
        skyGrad.addColorStop(1, '#bae6fd');
      } else if (dayInfo.phase === 'DAWN') {
        skyGrad.addColorStop(0, '#4c1d95');
        skyGrad.addColorStop(0.5, '#f472b6');
        skyGrad.addColorStop(1, '#fde047');
      } else if (dayInfo.phase === 'SUNSET') {
        skyGrad.addColorStop(0, '#4c1d95');
        skyGrad.addColorStop(0.45, '#c2410c');
        skyGrad.addColorStop(0.8, '#f97316');
        skyGrad.addColorStop(1, '#fde047');
      } else {
        skyGrad.addColorStop(0, '#090d16');
        skyGrad.addColorStop(1, '#0f172a');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(28, 22, 76, 78);

      // Elementos dentro da janela conforme o horário real e clima
      ctx.save();
      ctx.beginPath();
      ctx.rect(28, 22, 76, 78);
      ctx.clip();

      if (isRainActive) {
        // Nuvens densas e colinas escuras sob a chuva
        ctx.fillStyle = '#334155';
        ctx.fillRect(30, 26, 40, 8);
        ctx.fillRect(62, 30, 40, 8);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(28, 86, 46, 14);
        ctx.fillRect(62, 83, 42, 17);
        this.drawWindowRainAndDroplets(ctx, 28, 22, 76, 78);
      } else if (dayInfo.phase === 'DAY') {
        // Sol radiante + Halo suave
        ctx.fillStyle = 'rgba(254, 240, 138, 0.32)';
        ctx.fillRect(73, 29, 20, 20);
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(76, 32, 14, 14);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(78, 34, 10, 10);

        // Nuvens brancas fofinhas passando devagar
        const cloud1X = 28 + (((this.tick * 0.15) % 86) - 18);
        const cloud2X = 28 + ((((this.tick * 0.1) + 44) % 86) - 18);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(cloud1X), 48, 20, 5);
        ctx.fillRect(Math.round(cloud1X) + 4, 45, 12, 3);
        ctx.fillRect(Math.round(cloud2X), 66, 16, 4);
        ctx.fillRect(Math.round(cloud2X) + 3, 63, 10, 3);

        // Colinas verdes distantes na base da janela
        ctx.fillStyle = '#15803d';
        ctx.fillRect(28, 86, 46, 14);
        ctx.fillStyle = '#166534';
        ctx.fillRect(62, 83, 42, 17);
      } else if (dayInfo.phase === 'DAWN') {
        // Sol nascendo no horizonte rosado/dourado
        ctx.fillStyle = 'rgba(253, 224, 71, 0.35)';
        ctx.fillRect(52, 66, 28, 22);
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(56, 70, 20, 18);
        ctx.fillStyle = '#fde047';
        ctx.fillRect(59, 73, 14, 14);

        // Nuvens rosadas matinais
        ctx.fillStyle = '#fbcfe8';
        ctx.fillRect(34, 42, 22, 4);
        ctx.fillRect(70, 36, 18, 4);

        // Silhueta suave no horizonte
        ctx.fillStyle = '#3b0764';
        ctx.fillRect(28, 88, 76, 12);
      } else if (dayInfo.phase === 'SUNSET') {
        // Pôr do sol alaranjado clássico (16h30–18h45)
        ctx.fillStyle = 'rgba(249, 115, 22, 0.35)';
        ctx.fillRect(50, 56, 30, 28);
        ctx.fillStyle = '#ea580c';
        ctx.fillRect(54, 60, 22, 20);
        ctx.fillStyle = '#fde047';
        ctx.fillRect(58, 64, 14, 12);

        // Nuvens douradas/púrpura de fim de tarde
        const scX = 28 + (((this.tick * 0.1) % 84) - 16);
        ctx.fillStyle = '#fed7aa';
        ctx.fillRect(Math.round(scX), 38, 22, 4);
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(66, 48, 24, 4);

        // Silhueta dos telhados/colinas ao entardecer
        ctx.fillStyle = '#27171c';
        ctx.fillRect(28, 86, 42, 14);
        ctx.fillRect(64, 82, 40, 18);
      } else {
        // Noite estrelada com Lua Crescente
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(78, 36, 12, 12);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(83, 34, 10, 10);

        // Estrelas cintilando
        const starBlink = (this.tick >> 4) % 2 === 0;
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(42, 40, 2, 2);
        ctx.fillRect(56, 62, starBlink ? 2 : 1, starBlink ? 2 : 1);
        ctx.fillRect(48, 80, 2, 2);
        ctx.fillStyle = '#fde047';
        ctx.fillRect(68, 52, starBlink ? 1 : 2, starBlink ? 1 : 2);
        ctx.fillRect(36, 66, 2, 2);
      }
      ctx.restore();

      // Cruz das esquadrias da janela + moldura + peitoril
      ctx.fillStyle = 'rgba(71, 85, 105, 0.75)';
      ctx.fillRect(65, 22, 2, 78);
      ctx.fillRect(28, 60, 76, 2);
      ctx.strokeStyle = this.hoveredWindow ? '#facc15' : '#475569';
      ctx.lineWidth = 4;
      ctx.strokeRect(28, 22, 76, 78);
      ctx.fillStyle = '#334155';
      ctx.fillRect(22, 98, 88, 6);

      // Feixe de Luz entrando pela Janela (Luz do Sol / Pôr do Sol / Luar / Reflexo de Chuva)
      ctx.save();
      if (isRainActive) {
        ctx.fillStyle = 'rgba(125, 211, 252, 0.08)';
      } else if (dayInfo.phase === 'DAY') {
        ctx.fillStyle = 'rgba(254, 249, 195, 0.13)';
      } else if (dayInfo.phase === 'SUNSET') {
        ctx.fillStyle = 'rgba(251, 146, 60, 0.17)';
      } else if (dayInfo.phase === 'DAWN') {
        ctx.fillStyle = 'rgba(244, 114, 182, 0.13)';
      } else {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.06)';
      }
      ctx.beginPath();
      ctx.moveTo(28, 100);
      ctx.lineTo(104, 100);
      ctx.lineTo(164, floorY);
      ctx.lineTo(42, floorY);
      ctx.closePath();
      ctx.fill();

      // Partículas de poeira dourada flutuando dentro do feixe de luz solar/pôr do sol
      if (dayInfo.phase !== 'NIGHT' && !isRainActive) {
        ctx.fillStyle =
          dayInfo.phase === 'SUNSET'
            ? 'rgba(253, 224, 71, 0.65)'
            : 'rgba(255, 255, 255, 0.55)';
        for (let m = 0; m < 6; m++) {
          const mx = 46 + ((m * 19 + Math.round(Math.sin(this.tick * 0.04 + m) * 5)) % 92);
          const my = 104 + ((m * 11 + Math.round(Math.cos(this.tick * 0.03 + m) * 4)) % (floorY - 108));
          ctx.fillRect(mx, my, 2, 2);
        }
      }
      ctx.restore();

      // Estante de livros na parede direita
      ctx.fillStyle = '#451a03';
      ctx.fillRect(246, 36, 76, 62);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(242, 64, 84, 5);
      ctx.fillRect(242, 94, 84, 5);

      const bookColors = ['#ef4444', '#38bdf8', '#facc15', '#a855f7', '#22c55e'];
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = bookColors[i];
        ctx.fillRect(252 + i * 11, 44, 8, 20);
        ctx.fillRect(256 + i * 11, 72, 9, 22);
      }

      // Plantinha nativa do cenário
      ctx.fillStyle = '#b45309';
      ctx.fillRect(152, floorY - 14, 14, 14);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(148, floorY - 26, 22, 12);
      ctx.fillRect(152, floorY - 32, 14, 8);
    }
  }

  /**
   * Chuva e gotículas escorrendo em janelas (Estúdio Lofi, Escritório e Vagão de Trem)
   */
  private drawWindowRainAndDroplets(
    ctx: CanvasRenderingContext2D,
    wx: number,
    wy: number,
    ww: number,
    wh: number
  ) {
    ctx.fillStyle = 'rgba(125, 211, 252, 0.55)';
    for (let i = 0; i < 16; i++) {
      const rx = wx + ((i * 19 + this.tick * 2) % ww);
      const ry = wy + ((i * 17 + this.tick * 4) % wh);
      ctx.fillRect(rx, ry, 1, 6);
    }
    // Gotículas de água escorrendo devagar pelo vidro da janela
    ctx.fillStyle = 'rgba(224, 242, 254, 0.78)';
    for (let d = 0; d < 7; d++) {
      const dx = wx + 8 + ((d * 13) % Math.max(10, ww - 16));
      const dy = wy + 6 + ((d * 23 + Math.floor(this.tick * 0.4)) % Math.max(10, wh - 12));
      ctx.fillRect(dx, dy, 2, 2);
    }
  }

  /**
   * Camada de Clima & Atmosfera Adaptativa em TODO o cenário (não apenas na janela!):
   * - Chuva em cenários abertos, respingos no chão, ondulações na água e reflexo chuvoso em ambientes internos
   * - Brilho quente e fagulhas de Lareira em todo o cenário
   * - Brisa suave com folhinhas/pétalas flutuando pelo cenário
   * - Iluminação atmosférica sutil do horário (Pôr do Sol / Noite / Manhã) sobre toda a cena
   */
  private drawAdaptiveScenarioWeatherForeground(
    ctx: CanvasRenderingContext2D,
    skinId: string,
    W: number,
    H: number,
    floorY: number
  ) {
    const dayInfo = getLocalDayTimeInfo();
    const isRainActive = soundEngine.isAmbientActive('rain');
    const isFireActive = soundEngine.isAmbientActive('fireplace');
    const isBreezeActive = soundEngine.isAmbientActive('brown_noise');
    const isCoffeeActive = soundEngine.isAmbientActive('coffee');
    const isOutdoor =
      skinId === 'room_dense_forest' ||
      skinId === 'room_forest_campfire' ||
      skinId === 'room_rainy_rooftop' ||
      skinId === 'room_beco_rapariga';

    ctx.save();

    // 1. Iluminação Atmosférica Global do Horário sobre todo o cenário e piso
    if (dayInfo.phase === 'SUNSET') {
      ctx.fillStyle = 'rgba(251, 146, 60, 0.06)';
      ctx.fillRect(0, 0, W, H);
    } else if (dayInfo.phase === 'DAWN') {
      ctx.fillStyle = 'rgba(244, 114, 182, 0.05)';
      ctx.fillRect(0, 0, W, H);
    } else if (dayInfo.phase === 'NIGHT' && skinId !== 'room_cozy_desk' && skinId !== 'room_office') {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.10)';
      ctx.fillRect(0, 0, W, H);
    }

    // 2. 🌧️ Clima de Chuva Adaptativo em todo o cenário
    if (isRainActive || (skinId === 'room_rainy_rooftop' && dayInfo.phase === 'NIGHT')) {
      if (isOutdoor) {
        // Chuva caindo por toda a extensão do cenário aberto + respingos quicando no chão!
        ctx.fillStyle = 'rgba(125, 211, 252, 0.5)';
        for (let i = 0; i < 42; i++) {
          const rx = (i * 31 + this.tick * 2) % W;
          const ry = (i * 23 + this.tick * 6) % floorY;
          ctx.fillRect(rx, ry, 1, 7);
        }
        // Respingos animados (splashes) quicando em todo o piso/grama/calçada
        ctx.fillStyle = 'rgba(186, 230, 253, 0.72)';
        for (let s = 0; s < 14; s++) {
          const sx = (s * 27 + Math.floor(this.tick * 1.7)) % W;
          const splashPhase = (this.tick + s * 5) % 8;
          if (splashPhase < 4) {
            ctx.fillRect(sx - splashPhase, floorY - 1 - (splashPhase % 2), 2, 1);
            ctx.fillRect(sx + splashPhase, floorY - 1 - (splashPhase % 2), 2, 1);
          }
        }
      } else if (skinId === 'room_underwater') {
        // Gotas agitando a superfície da água no topo do recife
        ctx.fillStyle = 'rgba(186, 230, 253, 0.65)';
        for (let r = 0; r < 10; r++) {
          const rx = (r * 37 + this.tick * 2) % W;
          const rippleW = 4 + ((this.tick + r * 3) % 8);
          ctx.fillRect(rx - Math.floor(rippleW / 2), 3 + (r % 5), rippleW, 1);
        }
      } else {
        // Ambientes internos (Estúdio Lofi, Escritório, Vagão de Trem): atmosfera azulada aconchegante de chuva no ambiente inteiro
        ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
        ctx.fillRect(0, 0, W, H);
      }
    }

    // 3. 🔥 Clima de Lareira Acesa / Aconchego (Brilho âmbar pulsante no piso e brasas suaves subindo pelo cenário)
    if (isFireActive) {
      const pulse = 0.09 + Math.sin(this.tick * 0.12) * 0.025;
      const fireGrad = ctx.createLinearGradient(0, floorY - 75, 0, H);
      fireGrad.addColorStop(0, 'rgba(251, 146, 60, 0)');
      fireGrad.addColorStop(0.65, `rgba(249, 115, 22, ${pulse.toFixed(3)})`);
      fireGrad.addColorStop(1, `rgba(234, 88, 12, ${(pulse * 1.35).toFixed(3)})`);
      ctx.fillStyle = fireGrad;
      ctx.fillRect(0, floorY - 75, W, H - (floorY - 75));

      // Pequenas fagulhas/brasas douradas subindo suavemente
      for (let e = 0; e < 10; e++) {
        const ex = (e * 39 + Math.round(Math.sin(this.tick * 0.05 + e) * 6) + W) % W;
        const ey = floorY - ((this.tick + e * 17) % 68);
        ctx.fillStyle = e % 2 === 0 ? '#fde047' : '#fb923c';
        ctx.fillRect(ex, ey, 2, 2);
      }
    }

    // 4. 🍃 Clima de Brisa Suave (Folhinhas / pétalas flutuando horizontalmente pelo cenário)
    if (isBreezeActive) {
      for (let b = 0; b < 9; b++) {
        const bx = ((this.tick * 1.4 + b * 43) % (W + 20)) - 10;
        const by = 24 + ((b * 19 + Math.round(Math.sin(this.tick * 0.06 + b) * 7)) % (floorY - 34));
        ctx.fillStyle =
          skinId === 'room_underwater'
            ? 'rgba(186, 230, 253, 0.7)'
            : b % 2 === 0
              ? '#86efac'
              : '#fbcfe8';
        ctx.fillRect(Math.round(bx), Math.round(by), 3, 2);
      }
    }

    // 5. ☕ Clima de Cafeteria (Luz sépia aconchegante sutil no ambiente)
    if (isCoffeeActive) {
      ctx.fillStyle = 'rgba(217, 119, 6, 0.045)';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

  private drawFloorStrip(
    ctx: CanvasRenderingContext2D,
    skinId: string,
    W: number,
    _H: number,
    floorY: number
  ) {
    const fh = PixelCanvasRenderer.FLOOR_HEIGHT;
    const dayInfo = getLocalDayTimeInfo();
    const isRainActive = soundEngine.isAmbientActive('rain');

    if (skinId === 'room_beco_rapariga') {
      // Meio-fio e calçada cinza urbana com frestas verticais (fiel à imagem!)
      ctx.fillStyle = dayInfo.phase === 'NIGHT' ? '#525b66' : '#6c7582';
      ctx.fillRect(0, floorY, W, fh);
      ctx.fillStyle = '#59616e';
      ctx.fillRect(0, floorY, W, 3);
      ctx.fillStyle = '#4e5661';
      for (let px = 8; px < W; px += 20) {
        ctx.fillRect(px, floorY + 3, 4, fh - 3);
        ctx.fillRect(px + 10, floorY + 7, 3, fh - 7);
      }
    } else if (skinId === 'room_forest_campfire' || skinId === 'room_dense_forest') {
      ctx.fillStyle = dayInfo.phase === 'DAY' && !isRainActive ? '#15803d' : '#14532d';
      ctx.fillRect(0, floorY, W, fh);
      ctx.fillStyle = dayInfo.phase === 'SUNSET' ? '#4ade80' : '#22c55e';
      ctx.fillRect(0, floorY, W, 4);
    } else if (skinId === 'room_underwater') {
      // Sandy ocean floor with shells (adapta o tom da areia entre Dia e Noite Abissal)
      ctx.fillStyle = dayInfo.phase === 'NIGHT' ? '#78350f' : '#d97706';
      ctx.fillRect(0, floorY, W, fh);
      ctx.fillStyle = dayInfo.phase === 'NIGHT' ? '#ca8a04' : '#fde047';
      ctx.fillRect(0, floorY, W, 4);
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(65, floorY + 7, 5, 4);
      ctx.fillRect(245, floorY + 8, 6, 4);
    } else if (skinId === 'room_office') {
      // Executive carpet tile floor
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, floorY, W, fh);
      ctx.fillStyle = '#475569';
      ctx.fillRect(0, floorY, W, 4);
    } else if (skinId === 'room_rainy_rooftop') {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, floorY, W, fh);
      ctx.fillStyle =
        dayInfo.phase === 'SUNSET' && !isRainActive ? '#fb923c' : '#38bdf8';
      ctx.fillRect(0, floorY, W, 3);
    } else {
      // Cozy wooden planks
      ctx.fillStyle = '#451a03';
      ctx.fillRect(0, floorY, W, fh);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(0, floorY, W, 4);
      ctx.fillStyle = '#290f02';
      for (let px = 0; px < W; px += 36) {
        ctx.fillRect(px, floorY + 4, 2, fh - 4);
      }
    }

    // Poças d'água reflexivas no chão de cenários abertos quando está chovendo
    if (
      isRainActive &&
      (skinId === 'room_beco_rapariga' ||
        skinId === 'room_dense_forest' ||
        skinId === 'room_forest_campfire' ||
        skinId === 'room_rainy_rooftop')
    ) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.fillRect(46, floorY + 4, 34, 3);
      ctx.fillRect(156, floorY + 6, 44, 3);
      ctx.fillRect(272, floorY + 4, 38, 3);
    }
  }

  private drawDeskDrop(
    ctx: CanvasRenderingContext2D,
    drop: DeskDropInstance,
    floorY: number
  ) {
    const x = Math.round(drop.x);
    const y = floorY - 16;
    const isHovered = this.hoveredDropId === drop.id;
    const bob = isHovered ? -3 : Math.round(Math.sin(this.tick * 0.08 + x) * 1.5);

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.scale(1.25, 1.25);

    if (isHovered) {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
      ctx.fillRect(-12, -4, 24, 20);
    }

    if (drop.itemId === 'drop_coffee') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-6, 2, 12, 11);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-4, 4, 8, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const steamOffset = (this.tick >> 3) % 4;
      ctx.fillRect(-3, -4 - steamOffset, 2, 4);
      ctx.fillRect(2, -2 - steamOffset, 2, 4);
    } else if (drop.itemId === 'drop_rubber_duck') {
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-7, 4, 14, 9);
      ctx.fillRect(1, -1, 8, 7);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(8, 2, 4, 3);
      ctx.fillStyle = '#000000';
      ctx.fillRect(5, 1, 2, 2);
    } else if (drop.itemId === 'drop_birthday_cake') {
      ctx.fillStyle = '#fbcfe8';
      ctx.fillRect(-8, 4, 16, 10);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(-8, 4, 16, 3);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(-1, -2, 2, 6);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-1, -5, 2, 3);
    } else if (drop.itemId === 'drop_sleeping_cat') {
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(-9, 5, 18, 9);
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(-5, 5, 3, 5);
      ctx.fillRect(2, 5, 3, 5);
    } else {
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(-7, 2, 14, 12);
      ctx.fillStyle = '#ca8a04';
      ctx.fillRect(-5, 5, 10, 2);
      ctx.fillRect(-5, 9, 7, 2);
    }

    // Se o presente tiver um recado personalizado, desenha um mini Post-it amarelo colado ao lado!
    if (drop.note) {
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(6, 3, 8, 8);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(12, 9, 2, 2);
      // Alfinete vermelho no topo do Post-it
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(9, 2, 2, 2);
      // Linhas de texto em pixel art no Post-it
      ctx.fillStyle = '#854d0e';
      ctx.fillRect(7, 5, 5, 1);
      ctx.fillRect(7, 7, 4, 1);
    }
    ctx.restore();

    // Quando passa o mouse sobre um presente com Post-it, exibe o bilhetinho amarelo flutuando acima dele
    if (isHovered && drop.note) {
      ctx.save();
      ctx.font = 'bold 8px monospace';
      const noteLabel = `📝 "${drop.note}"`;
      const boxW = Math.min(220, Math.round(ctx.measureText(noteLabel).width + 14));
      const boxH = 16;
      const clampedX = Math.max(
        boxW / 2 + 6,
        Math.min(PixelCanvasRenderer.WIDTH - boxW / 2 - 6, x)
      );
      const topY = y - 24;

      ctx.fillStyle = '#fef08a';
      ctx.fillRect(clampedX - boxW / 2, topY, boxW, boxH);
      ctx.strokeStyle = '#ca8a04';
      ctx.lineWidth = 1;
      ctx.strokeRect(clampedX - boxW / 2 + 0.5, topY + 0.5, boxW - 1, boxH - 1);

      ctx.fillStyle = '#ef4444';
      ctx.fillRect(clampedX - 1, topY + 1, 3, 2);

      ctx.fillStyle = '#451a03';
      ctx.textAlign = 'center';
      ctx.fillText(noteLabel, clampedX, topY + 11.5);
      ctx.restore();
    }
  }

  private drawKnockPeeker(
    ctx: CanvasRenderingContext2D,
    knock: { visitorDisplayName: string; expiresAt: number },
    W: number,
    floorY: number
  ) {
    const peekX = W - 18 + Math.round(Math.sin(this.tick * 0.12) * 3);
    const peekY = floorY - 34;

    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(peekX, peekY, 18, 22);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(peekX + 3, peekY + 7, 3, 3);
    ctx.fillRect(peekX + 10, peekY + 7, 3, 3);

    const secsLeft = Math.max(0, Math.ceil((knock.expiresAt - Date.now()) / 1000));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(W - 118, peekY - 22, 114, 18);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1;
    ctx.strokeRect(W - 118, peekY - 22, 114, 18);

    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`🔔 ${knock.visitorDisplayName.slice(0, 9)} (${secsLeft}s)`, W - 113, peekY - 10);
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, p: RoomPlayerState, floorY: number) {
    const phys = this.physics.get(p.userId);
    const x = Math.round(phys ? phys.renderX : p.x);
    let seatOffsetY = 0;
    if (this.room?.placedFurniture && Math.abs(p.targetX - x) <= 2) {
      for (const furn of this.room.placedFurniture) {
        const inter = FURNITURE_INTERACTIONS[furn.itemId];
        if (inter?.seatOffsetY && Math.abs(x - furn.x) <= 18) {
          seatOffsetY = inter.seatOffsetY;
          break;
        }
      }
    }
    let y = Math.round(floorY + (phys ? phys.renderY : 0) + seatOffsetY);

    const now = Date.now();
    const spawnElapsed = p.spawnFx ? now - p.spawnFx.startedAt : 99999;

    // 3.2. Efeitos de Entrada (Spawn FX)
    if (p.spawnFx && spawnElapsed < 1400) {
      const progress = spawnElapsed / 1400;
      if (p.spawnFx.fxId === 'fx_parachute') {
        y = Math.round(floorY - (1 - progress) * 115);
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(x - 16, y - 48, 32, 12);
        ctx.fillStyle = '#fde047';
        ctx.fillRect(x - 8, y - 52, 16, 4);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 12, y - 36);
        ctx.lineTo(x - 4, y - 22);
        ctx.moveTo(x + 12, y - 36);
        ctx.lineTo(x + 4, y - 22);
        ctx.stroke();
      } else if (p.spawnFx.fxId === 'fx_cyber_lightning') {
        ctx.fillStyle = spawnElapsed % 120 < 60 ? '#00f5d4' : '#f472b6';
        ctx.fillRect(x - 3, 0, 6, y);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 1, 0, 2, y);
      } else if (p.spawnFx.fxId === 'fx_alien_abduction') {
        ctx.fillStyle = 'rgba(34, 197, 94, 0.28)';
        ctx.beginPath();
        ctx.moveTo(x - 6, 14);
        ctx.lineTo(x + 6, 14);
        ctx.lineTo(x + 22, floorY);
        ctx.lineTo(x - 22, floorY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(x - 16, 8, 32, 7);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x - 8, 4, 16, 5);
      } else if (p.spawnFx.fxId === 'fx_cardboard_box' && progress < 0.7) {
        const shake = Math.round(Math.sin(this.tick * 0.8) * 2);
        ctx.fillStyle = '#d97706';
        ctx.fillRect(x - 13 + shake, y - 24, 26, 24);
        ctx.fillStyle = '#92400e';
        ctx.fillRect(x - 13 + shake, y - 14, 26, 3);
        return;
      }
    }

    const walkBob = phys && phys.walkFrame > 0 ? Math.round(Math.abs(Math.sin(phys.walkFrame)) * 3) : 0;
    const avatarScale = 1.38;
    const dir = p.facing === 'right' ? 1 : -1;

    // 0. Companion Pet (acompanha o Pip ao lado; o Dragão Guardião é maior que os outros pets e maior que o Pip!)
    if (p.equipped.companion_pet) {
      this.drawCompanionPet(ctx, p, x, floorY, dir, walkBob);
    }

    // Shadow on floor
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x - 13, floorY - 2, 26, 4);

    // Draw scaled character centered at (x, y)
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(avatarScale, avatarScale);

    const baseTop = -28 - walkBob;

    // Selection ring if targeted (desaparece automaticamente após 2 segundos)
    if (this.selectedTargetUserId === p.userId && now < this.selectedTargetExpiresAt) {
      const remainingMs = this.selectedTargetExpiresAt - now;
      const alpha = Math.min(1, remainingMs / 500);
      ctx.strokeStyle = `rgba(250, 204, 21, ${alpha.toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(-14, baseTop - 6, 28, 36);
    }

    // 1. Back Accessory (avatar_back)
    if (p.equipped.avatar_back === 'back_jetpack') {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-dir * 11 - 3, baseTop + 8, 7, 13);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-dir * 11 - 2, baseTop + 10, 5, 4);
    } else if (p.equipped.avatar_back === 'back_angel_wings') {
      const wingFlap = Math.round(Math.sin(this.tick * 0.15) * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-16, baseTop + 6 + wingFlap, 8, 10);
      ctx.fillRect(8, baseTop + 6 + wingFlap, 8, 10);
    }

    // 2. Body Sprite (avatar_body)
    const bodyId = p.equipped.avatar_body;
    if (bodyId === 'body_fox') {
      // 🦊 Raposa Astuta
      const tailWag = Math.round(Math.sin(this.tick * 0.14) * 2);
      // Fluffy orange & white tail
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(-dir * 13, baseTop + 13 + tailWag, 8, 7);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-dir * 16, baseTop + 14 + tailWag, 4, 5);
      // Orange body & head
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-9, baseTop + 5, 18, 19);
      // Pointed Fox Ears
      ctx.fillRect(-9, baseTop, 5, 5);
      ctx.fillRect(4, baseTop, 5, 5);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-9, baseTop, 3, 2);
      ctx.fillRect(6, baseTop, 3, 2);
      // White cheeks & belly
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-6, baseTop + 12, 12, 11);
      // Eyes & black nose tip
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dir * 3 - 4, baseTop + 9, 2, 3);
      ctx.fillRect(dir * 3 + 2, baseTop + 9, 2, 3);
      ctx.fillRect(dir * 7, baseTop + 11, 3, 2);
      // Dark paws
      ctx.fillRect(-6, -4, 4, 4);
      ctx.fillRect(2, -4, 4, 4);
    } else if (bodyId === 'body_fish') {
      // 🐠 Peixinho Tropical
      const finWave = Math.round(Math.sin(this.tick * 0.2) * 2);
      // Tail fin
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-dir * 14, baseTop + 9 + finWave, 6, 10);
      // Tropical blue & orange striped body
      ctx.fillStyle = '#0ea5e9';
      ctx.fillRect(-10, baseTop + 6, 20, 16);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-4, baseTop + 6, 4, 16);
      ctx.fillRect(3, baseTop + 6, 3, 16);
      // Top dorsal fin
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-5, baseTop + 2, 10, 4);
      // Cute bubble & eye
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dir * 5, baseTop + 10, 3, 3);
      ctx.fillStyle = '#bae6fd';
      ctx.fillRect(dir * 11, baseTop + 4 - ((this.tick >> 3) % 6), 3, 3);
    } else if (bodyId === 'body_frog') {
      // 🐸 Sapinho Cururu
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(-10, baseTop + 7, 20, 17);
      // Bulging frog eyes on top
      ctx.fillRect(-8, baseTop + 2, 6, 6);
      ctx.fillRect(2, baseTop + 2, 6, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-7, baseTop + 3, 4, 4);
      ctx.fillRect(3, baseTop + 3, 4, 4);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-5, baseTop + 4, 2, 2);
      ctx.fillRect(5, baseTop + 4, 2, 2);
      // Cream belly & rosy cheeks
      ctx.fillStyle = '#dcfce7';
      ctx.fillRect(-6, baseTop + 14, 12, 9);
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(-8, baseTop + 11, 3, 2);
      ctx.fillRect(5, baseTop + 11, 3, 2);
    } else if (bodyId === 'body_penguin') {
      // 🐧 Pinguim Gelado
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-9, baseTop + 4, 18, 20);
      // White belly
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-6, baseTop + 10, 12, 13);
      // Golden beak & orange feet
      ctx.fillStyle = '#facc15';
      ctx.fillRect(dir * 6, baseTop + 9, 5, 3);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-7, -3, 5, 3);
      ctx.fillRect(2, -3, 5, 3);
      // Eyes
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(dir * 3, baseTop + 7, 2, 2);
    } else if (bodyId === 'body_capybara') {
      // 🦫 Capivara Zen (com tangerina na cabeça!)
      ctx.fillStyle = '#92400e';
      ctx.fillRect(-10, baseTop + 6, 20, 18);
      // Snout
      ctx.fillStyle = '#78350f';
      ctx.fillRect(dir * 4, baseTop + 8, 7, 8);
      // Round ears
      ctx.fillRect(-7, baseTop + 3, 4, 3);
      // Serene closed zen eyes
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dir * 1, baseTop + 9, 4, 1);
      // Tangerine / Mandarin orange balanced on top of head!
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-3, baseTop + 1, 6, 5);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(-1, baseTop - 1, 3, 2);
      // Little paws
      ctx.fillStyle = '#451a03';
      ctx.fillRect(-7, -4, 4, 4);
      ctx.fillRect(3, -4, 4, 4);
    } else if (bodyId === 'body_red_panda') {
      // 🐼 Panda Vermelho
      const tailBob = Math.round(Math.sin(this.tick * 0.14) * 2);
      // Ringed tail
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-dir * 14, baseTop + 12 + tailBob, 9, 7);
      ctx.fillStyle = '#fef2f2';
      ctx.fillRect(-dir * 12, baseTop + 12 + tailBob, 2, 7);
      // Reddish-orange body
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-9, baseTop + 5, 18, 19);
      // White ears & eyebrow markings
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-9, baseTop + 2, 4, 4);
      ctx.fillRect(5, baseTop + 2, 4, 4);
      ctx.fillRect(-6, baseTop + 8, 12, 8);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dir * 2 - 4, baseTop + 10, 2, 3);
      ctx.fillRect(dir * 2 + 2, baseTop + 10, 2, 3);
      ctx.fillRect(-6, -4, 4, 4);
      ctx.fillRect(2, -4, 4, 4);
    } else if (bodyId === 'body_ghost') {
      // 👻 Fantasminha Boo (Flutua suavemente!)
      const hoverY = Math.round(Math.sin(this.tick * 0.1) * 3);
      ctx.fillStyle = 'rgba(241, 245, 249, 0.92)';
      ctx.fillRect(-9, baseTop + 3 + hoverY, 18, 19);
      // Wavy ghost bottom skirt
      ctx.fillRect(-9, baseTop + 22 + hoverY, 4, 3);
      ctx.fillRect(-2, baseTop + 22 + hoverY, 4, 3);
      ctx.fillRect(5, baseTop + 22 + hoverY, 4, 3);
      // Glowing cyan/dark eyes & blush
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dir * 3 - 4, baseTop + 9 + hoverY, 3, 4);
      ctx.fillRect(dir * 3 + 2, baseTop + 9 + hoverY, 3, 4);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(dir * 3 - 3, baseTop + 10 + hoverY, 1, 2);
      ctx.fillRect(dir * 3 + 3, baseTop + 10 + hoverY, 1, 2);
    } else if (bodyId === 'body_dragon') {
      // 🐉 Dragãozinho Rubi
      const wingFlap = Math.round(Math.sin(this.tick * 0.18) * 2);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-14, baseTop + 7 + wingFlap, 6, 9);
      ctx.fillRect(8, baseTop + 7 + wingFlap, 6, 9);
      // Ruby body
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-9, baseTop + 5, 18, 19);
      // Golden horns & belly scales
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-7, baseTop, 3, 5);
      ctx.fillRect(4, baseTop, 3, 5);
      ctx.fillRect(-5, baseTop + 13, 10, 10);
      // Glowing eyes
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(dir * 3 - 4, baseTop + 8, 2, 3);
      ctx.fillRect(dir * 3 + 2, baseTop + 8, 2, 3);
    } else if (bodyId === 'body_pigeon') {
      // Fantasia de Pombo
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-9, baseTop + 6, 18, 18);
      ctx.fillStyle = '#14b8a6';
      ctx.fillRect(-8, baseTop + 10, 16, 4);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(dir * 8, baseTop + 8, 5, 3);
      ctx.fillRect(-4, -4, 2, 4);
      ctx.fillRect(3, -4, 2, 4);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dir * 4, baseTop + 7, 2, 2);
    } else if (bodyId === 'body_cat') {
      // Gatinho Laranja
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-9, baseTop + 6, 18, 18);
      ctx.fillRect(-9, baseTop + 2, 4, 4);
      ctx.fillRect(5, baseTop + 2, 4, 4);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(dir * 3 - 4, baseTop + 10, 2, 3);
      ctx.fillRect(dir * 3 + 2, baseTop + 10, 2, 3);
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(-5, baseTop + 16, 10, 6);
    } else if (bodyId === 'body_cyber_bot') {
      // Robô Retrô MK-II
      ctx.fillStyle = '#334155';
      ctx.fillRect(-9, baseTop + 4, 18, 20);
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(-7, baseTop + 7, 14, 5);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(-1, baseTop, 2, 4);
    } else if (bodyId === 'body_deer') {
      // 🦌 Veado (Galhada ramificada, pintinhas brancas e focinho fofo)
      ctx.save();
      ctx.scale(dir, 1);
      const tailFlick = Math.round(Math.sin(this.tick * 0.15) * 1.5);
      // Little white-tipped deer tail
      ctx.fillStyle = '#9a5825';
      ctx.fillRect(-12, baseTop + 13 + tailFlick, 4, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-13, baseTop + 12 + tailFlick, 3, 3);
      // Branched antlers on top
      ctx.fillStyle = '#d6c5a3';
      ctx.fillRect(-6, baseTop - 5, 2, 6);
      ctx.fillRect(-9, baseTop - 4, 3, 2);
      ctx.fillRect(-4, baseTop - 3, 2, 2);
      ctx.fillRect(3, baseTop - 5, 2, 6);
      ctx.fillRect(5, baseTop - 4, 3, 2);
      ctx.fillRect(1, baseTop - 3, 2, 2);
      // Pointed deer ears
      ctx.fillStyle = '#9a5825';
      ctx.fillRect(-10, baseTop + 1, 4, 3);
      ctx.fillRect(5, baseTop + 1, 4, 3);
      ctx.fillStyle = '#fda4af';
      ctx.fillRect(-9, baseTop + 2, 2, 1);
      ctx.fillRect(6, baseTop + 2, 2, 1);
      // Warm chestnut brown head & body
      ctx.fillStyle = '#b4692e';
      ctx.fillRect(-9, baseTop + 4, 18, 17);
      // Cream chest & belly
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(-3, baseTop + 11, 12, 10);
      // White fawn spots on back
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-7, baseTop + 13, 2, 2);
      ctx.fillRect(-5, baseTop + 16, 2, 2);
      ctx.fillRect(-8, baseTop + 17, 2, 2);
      // Eyes & dark snout nose
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-1, baseTop + 7, 2, 3);
      ctx.fillRect(5, baseTop + 7, 2, 3);
      ctx.fillStyle = '#27170c';
      ctx.fillRect(7, baseTop + 9, 3, 2);
      // Dark hooves
      ctx.fillRect(-7, -3, 4, 3);
      ctx.fillRect(3, -3, 4, 3);
      ctx.restore();
    } else if (bodyId === 'body_hawk') {
      // 🦅 Gavião (Plumagem escura, peito branco rajado e bico curvo dourado)
      ctx.save();
      ctx.scale(dir, 1);
      const wingFlap = Math.round(Math.sin(this.tick * 0.18) * 1.5);
      // Dark tail feathers at back
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-13, baseTop + 15, 5, 5);
      ctx.fillStyle = '#475569';
      ctx.fillRect(-14, baseTop + 17, 4, 3);
      // Main slate/charcoal plumage body & head
      ctx.fillStyle = '#334155';
      ctx.fillRect(-9, baseTop + 3, 17, 18);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-9, baseTop + 2, 15, 5);
      // White feathered chest with hawk bars
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-3, baseTop + 10, 11, 11);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(-1, baseTop + 12, 7, 1);
      ctx.fillRect(0, baseTop + 15, 6, 1);
      ctx.fillRect(-1, baseTop + 18, 7, 1);
      // Folded dark wing on side
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-8, baseTop + 9 + wingFlap, 6, 10);
      // Fierce hawk eyes & white brow
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(1, baseTop + 5, 5, 2);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(2, baseTop + 6, 3, 3);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(3, baseTop + 7, 2, 2);
      // Hooked golden raptor beak
      ctx.fillStyle = '#facc15';
      ctx.fillRect(8, baseTop + 6, 5, 4);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(11, baseTop + 8, 2, 4);
      // Yellow talons on floor
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-5, -3, 4, 3);
      ctx.fillRect(2, -3, 4, 3);
      ctx.restore();
    } else if (bodyId === 'body_caramelo') {
      // 🐕 Caramelo (Vira-lata Caramelo sentado, óculos escuros e camisa listrada alvinegra — 100 Diamantes)
      ctx.save();
      ctx.scale(dir, 1);
      const tailWag = Math.round(Math.sin(this.tick * 0.18) * 1.5);

      // 1. Raised Caramel Tail (at back) with dark pixel outline
      ctx.fillStyle = '#1c1917';
      ctx.fillRect(-14, baseTop + 9 + tailWag, 5, 10);
      ctx.fillStyle = '#f5820b';
      ctx.fillRect(-13, baseTop + 10 + tailWag, 3, 8);

      // 2. Sitting Hind Haunch & Back Paw (left/back side)
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-11, baseTop + 15, 5, 8);
      ctx.fillStyle = '#f5820b';
      ctx.fillRect(-10, baseTop + 16, 4, 7);
      ctx.fillRect(-11, -2, 5, 2);

      // 3. Black & White Vertical Striped Jersey (Corinthians style torso)
      ctx.fillStyle = '#111827';
      ctx.fillRect(-8, baseTop + 10, 16, 11);
      // White vertical stripes
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-6, baseTop + 11, 2, 9);
      ctx.fillRect(-2, baseTop + 11, 2, 9);
      ctx.fillRect(2, baseTop + 11, 2, 9);
      ctx.fillRect(6, baseTop + 11, 2, 9);
      // White V-neck collar & sleeve cuffs
      ctx.fillRect(-3, baseTop + 10, 6, 2);
      // Tiny Red & White Crest Badge on chest
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(3, baseTop + 13, 3, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, baseTop + 14, 1, 1);

      // 4. Front Caramel Legs sitting upright & Paws on floor
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-5, baseTop + 18, 4, 6);
      ctx.fillRect(2, baseTop + 18, 4, 6);
      ctx.fillStyle = '#f5820b';
      ctx.fillRect(-4, baseTop + 18, 3, 6);
      ctx.fillRect(3, baseTop + 18, 3, 6);
      // Paw toes outline
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-4, -1, 3, 1);
      ctx.fillRect(3, -1, 3, 1);

      // 5. Caramel Dog Head & Snout
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-8, baseTop, 15, 11);
      ctx.fillStyle = '#f5820b';
      ctx.fillRect(-7, baseTop + 1, 14, 9);
      // Snout projecting forward
      ctx.fillStyle = '#f5820b';
      ctx.fillRect(4, baseTop + 5, 7, 5);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(4, baseTop + 5, 5, 2);
      // Black nose tip & smile line
      ctx.fillStyle = '#111827';
      ctx.fillRect(9, baseTop + 5, 3, 2);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(5, baseTop + 9, 4, 1);

      // 6. Floppy Caramel Ears
      ctx.fillStyle = '#b45309';
      ctx.fillRect(-10, baseTop + 2, 4, 6);
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-9, baseTop + 2, 3, 5);

      // 7. Iconic Black-Framed Glasses with reflective grey/white lenses
      ctx.fillStyle = '#111827';
      ctx.fillRect(-5, baseTop + 3, 13, 4);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-3, baseTop + 4, 4, 2);
      ctx.fillRect(3, baseTop + 4, 4, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-3, baseTop + 4, 2, 1);
      ctx.fillRect(3, baseTop + 4, 2, 1);

      ctx.restore();
    } else if (bodyId === 'body_dj_double_d') {
      // 🎧 Double D (Pip Lendário sentado na pose da foto: barba, óculos escuros, camiseta rosé, calça azul-marinho, descalço, relógio e fone na mão!)
      ctx.save();
      ctx.scale(dir, 1);
      const beatPulse = Math.sin(this.tick * 0.18);

      // 1. Subtle Golden VIP Floor Glow
      ctx.save();
      ctx.globalAlpha = 0.35 + beatPulse * 0.1;
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-13, -2, 26, 2);
      ctx.restore();

      // 2. Seated Dark Navy Pants (left leg bent on ground + right knee raised up)
      ctx.fillStyle = '#111827';
      // Seated hip & folded lower leg
      ctx.fillRect(-10, baseTop + 17, 14, 6);
      // Raised front knee (right side)
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(2, baseTop + 13, 6, 10);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(2, baseTop + 14, 2, 8);

      // 3. Barefoot feet resting at bottom (as in reference photo)
      ctx.fillStyle = '#e8beac';
      ctx.fillRect(-2, -2, 4, 2);
      ctx.fillRect(5, -3, 5, 3);
      ctx.fillStyle = '#d5a38e';
      ctx.fillRect(8, -2, 2, 2);

      // 4. Dusty Rose / Mauve-Pink T-Shirt (Torso)
      ctx.fillStyle = '#d6b4ad';
      ctx.fillRect(-9, baseTop + 10, 14, 9);
      // Subtle shirt folds & sleeve shading
      ctx.fillStyle = '#c29d95';
      ctx.fillRect(-9, baseTop + 11, 4, 5);
      ctx.fillRect(-3, baseTop + 15, 6, 3);

      // 5. Head, Styled Brown Parted Hair & Full Trimmed Beard
      ctx.fillStyle = '#ecc6b5';
      ctx.fillRect(-7, baseTop + 1, 13, 10);
      // Swept medium-brown hair with top volume
      ctx.fillStyle = '#5c3a21';
      ctx.fillRect(-8, baseTop - 2, 15, 4);
      ctx.fillRect(-8, baseTop + 1, 3, 4);
      ctx.fillStyle = '#784b2a';
      ctx.fillRect(-5, baseTop - 3, 9, 2);
      // Full trimmed dark brown beard & mustache
      ctx.fillStyle = '#3b2213';
      ctx.fillRect(-6, baseTop + 7, 12, 4);
      ctx.fillRect(-7, baseTop + 5, 2, 4);
      // Subtle confident smile inside beard
      ctx.fillStyle = '#d5a38e';
      ctx.fillRect(-1, baseTop + 8, 4, 1);

      // 6. Square Dark Sunglasses
      ctx.fillStyle = '#334155';
      ctx.fillRect(-6, baseTop + 3, 13, 4);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(-5, baseTop + 4, 5, 2);
      ctx.fillRect(1, baseTop + 4, 5, 2);
      // Lens reflection
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-4, baseTop + 4, 2, 1);
      ctx.fillRect(2, baseTop + 4, 2, 1);

      // 7. Arms resting forward over knee + Black Wristwatch + DJ Headphones held in hand!
      ctx.fillStyle = '#ecc6b5';
      ctx.fillRect(-5, baseTop + 12, 11, 3);
      // Black wristwatch on wrist
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(3, baseTop + 12, 2, 3);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(3, baseTop + 13, 2, 1);

      // Black & Silver DJ Headphones held in hand in front of knee
      ctx.fillStyle = '#111827';
      ctx.fillRect(6, baseTop + 12, 6, 6);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(5, baseTop + 15, 4, 4);
      ctx.fillRect(9, baseTop + 15, 4, 4);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(6, baseTop + 16, 2, 2);
      ctx.fillRect(10, baseTop + 16, 2, 2);

      ctx.restore();
    } else {
      // Default: Humano Cozy
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(-7, baseTop + 2, 14, 11);
      ctx.fillStyle = '#312e81';
      ctx.fillRect(-8, baseTop, 16, 5);
      ctx.fillStyle = '#0f172a';
      if (p.hostStatus === 'IDLE' && p.idleActivity === 'SLEEPING') {
        ctx.fillRect(dir * 2 - 4, baseTop + 8, 3, 1);
        ctx.fillRect(dir * 2 + 2, baseTop + 8, 3, 1);
      } else {
        ctx.fillRect(dir * 2 - 3, baseTop + 7, 2, 3);
        ctx.fillRect(dir * 2 + 3, baseTop + 7, 2, 3);
      }
      ctx.fillStyle = p.isHost ? '#6366f1' : '#10b981';
      ctx.fillRect(-8, baseTop + 13, 16, 11);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-6, -4, 4, 4);
      ctx.fillRect(2, -4, 4, 4);
    }

    // 3. Head Accessory (avatar_head)
    const headId = p.equipped.avatar_head;
    if (headId === 'head_lofi_headphones') {
      ctx.fillStyle = '#ec4899';
      ctx.fillRect(-10, baseTop + 1, 20, 3);
      ctx.fillRect(-11, baseTop + 4, 4, 7);
      ctx.fillRect(7, baseTop + 4, 4, 7);
    } else if (headId === 'head_astronaut') {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.fillRect(-11, baseTop - 2, 22, 16);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.strokeRect(-11, baseTop - 2, 22, 16);
    } else if (headId === 'head_wizard') {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(-12, baseTop, 24, 4);
      ctx.fillRect(-8, baseTop - 6, 16, 6);
      ctx.fillRect(-4, baseTop - 12, 8, 6);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-1, baseTop - 8, 2, 2);
    }

    // 4. Player Action & Idle Props (permanecem visíveis mesmo andando!)
    if (p.hostStatus === 'IDLE' && p.idleActivity) {
      this.drawIdleProp(ctx, 0, baseTop, dir, p.idleActivity);
    }

    ctx.restore();

    // 5. Synchronized Emote floating badge
    if (p.activeEmote && p.activeEmote.expiresAt > now) {
      const floatY = y - 48 + Math.round(Math.sin(this.tick * 0.15) * 3);
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.activeEmote.emote, x, floatY);
    }

    // 6. Player Nameplate + Status Dot
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const tag = p.userId === this.myUserId ? `${p.displayName} (Você)` : p.displayName;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    const textW = ctx.measureText(tag).width + 10;
    ctx.fillRect(x - textW / 2, y + 3, textW, 13);

    ctx.fillStyle =
      p.hostStatus === 'DND'
        ? '#f87171'
        : p.hostStatus === 'IDLE'
          ? '#fbbf24'
          : '#4ade80';
    ctx.fillText(tag, x, y + 12);
    ctx.restore();
  }

  private drawCompanionPet(
    ctx: CanvasRenderingContext2D,
    p: RoomPlayerState,
    playerX: number,
    floorY: number,
    dir: number,
    walkBob: number
  ) {
    const petId = p.equipped.companion_pet;
    if (!petId) return;

    const breed = getPetBreedOption(petId, p.equipped.companion_pet_variant);
    const isDragon = petId === 'pet_dragon';

    // Posiciona o pet com uma distância confortável ao lado/atrás do Pip (sem ficar colado nele)
    const isPreview = p.userId === '__preview__';
    const offsetDist = isPreview ? (isDragon ? 42 : 34) : isDragon ? 48 : 36;
    let petX = playerX - dir * offsetDist;
    const minStageX = isPreview ? 18 : 24;
    const maxStageX = isPreview ? 202 : 336;
    if (petX < minStageX) petX = playerX + offsetDist;
    if (petX > maxStageX) petX = playerX - offsetDist;

    const bob = walkBob > 0 ? Math.round(Math.abs(Math.sin(this.tick * 0.22)) * 2) : 0;
    const breath = Math.round(Math.sin(this.tick * 0.1) * 1);
    const tailWag = Math.round(Math.sin(this.tick * 0.2) * 2);

    ctx.save();

    if (isDragon) {
      // 🐉 DRAGÃO GUARDIÃO ANCESTRAL: MAIOR QUE OS OUTROS PETS E MAIOR QUE O PRÓPRIO PIP!
      // Pip tem ~38px de altura renderizada; o Dragão tem ~54px de altura e asas imponentes!
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.fillRect(petX - 20, floorY - 3, 40, 5);

      ctx.translate(petX, floorY - bob);
      ctx.scale(dir, 1);

      const wingFlap = Math.round(Math.sin(this.tick * 0.16) * 4);

      // Cauda longa escamosa com ponta de lança flamejante
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-26, -14 + tailWag, 14, 6);
      ctx.fillRect(-32, -19 + tailWag, 8, 6);
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-36, -22 + tailWag, 6, 6);

      // Asas Colossais abertas (maiores que o Pip!)
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-22, -46 + wingFlap, 18, 22);
      ctx.fillRect(-28, -52 + wingFlap, 14, 14);
      // Membrana interna da asa
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-19, -42 + wingFlap, 13, 16);
      ctx.fillRect(-25, -48 + wingFlap, 9, 9);
      // Garras douradas no topo da asa
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-28, -54 + wingFlap, 4, 3);

      // Corpo robusto de Dragão Guardião (peito couraçado e barriga escamosa)
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-13, -34 + breath, 24, 28);
      // Placas peitorais da linhagem
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-5, -31 + breath, 14, 22);
      ctx.fillStyle = breed.primaryColor;
      for (let py = -28; py <= -14; py += 5) {
        ctx.fillRect(-4, py + breath, 12, 1);
      }

      // Espinhos dorsais ao longo das costas
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-15, -32 + breath, 3, 4);
      ctx.fillRect(-15, -25 + breath, 3, 4);
      ctx.fillRect(-15, -18 + breath, 3, 4);

      // Pescoço e Cabeça Majestosa no alto (-52px acima do chão!)
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-8, -48 + breath, 22, 16);
      // Focinho longo de dragão com presas
      ctx.fillRect(10, -44 + breath, 10, 10);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(13, -34 + breath, 2, 3);
      ctx.fillRect(17, -34 + breath, 2, 3);

      // Chifres Imperiais curvados para trás
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-10, -56 + breath, 6, 8);
      ctx.fillRect(-14, -60 + breath, 6, 6);
      ctx.fillRect(-2, -55 + breath, 5, 7);

      // Olho dracônico brilhante
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(4, -44 + breath, 5, 4);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(6, -44 + breath, 2, 4);

      // Braços com garras afiadas
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(6, -24 + breath, 8, 5);
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(13, -23 + breath, 3, 3);

      // Patas traseiras fortes no chão
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-10, -7, 9, 7);
      ctx.fillRect(2, -7, 9, 7);
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-2, -3, 3, 3);
      ctx.fillRect(10, -3, 3, 3);

      // Sopro elemental animado saindo das narinas
      const flamePhase = (this.tick >> 2) % 4;
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(21 + flamePhase * 2, -42 + breath, 5, 4);
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(25 + flamePhase * 3, -44 + breath, 3, 3);

      ctx.restore();
      return;
    }

    // Sombra padrão para os outros 8 pets companheiros
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(petX - 9, floorY - 2, 18, 3);

    ctx.translate(petX, floorY - bob);
    ctx.scale(dir, 1);

    if (petId === 'pet_cat') {
      // 🐱 Gatinho Companheiro (Siamês, Laranja, Pretinho, Persa, Frajola, Tricolor)
      // Rabinho levantado em curva
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-10, -13 + tailWag, 3, 8);
      ctx.fillRect(-12, -16 + tailWag, 3, 4);
      // Corpo
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-7, -11, 14, 8);
      // Manchinhas se for Tricolor ou Laranja Tigrado ou Frajola
      if (breed.id === 'calico') {
        ctx.fillStyle = breed.secondaryColor;
        ctx.fillRect(-5, -11, 5, 4);
        ctx.fillStyle = breed.accentColor;
        ctx.fillRect(1, -10, 4, 4);
      } else if (breed.id === 'tuxedo') {
        ctx.fillStyle = breed.secondaryColor;
        ctx.fillRect(2, -9, 5, 5);
      } else if (breed.id === 'orange') {
        ctx.fillStyle = breed.secondaryColor;
        ctx.fillRect(-4, -11, 2, 5);
        ctx.fillRect(0, -11, 2, 5);
      }
      // Cabeça e orelhas pontudas
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-3, -18, 11, 9);
      ctx.fillStyle = breed.id === 'siamese' ? breed.secondaryColor : breed.primaryColor;
      ctx.fillRect(-3, -21, 3, 3);
      ctx.fillRect(5, -21, 3, 3);
      if (breed.id === 'siamese') {
        // Máscara escura típica do Siamês
        ctx.fillRect(1, -15, 7, 5);
      }
      // Coleira na cor de destaque
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-2, -10, 9, 2);
      // Olhinhos brilhantes
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(1, -15, 2, 2);
      ctx.fillRect(5, -15, 2, 2);
      // Patinhas
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-6, -3, 3, 3);
      ctx.fillRect(3, -3, 3, 3);
    } else if (petId === 'pet_dog') {
      // 🐶 Cachorrinho Fiel (Caramelo, Golden, Husky, Pug, Shiba, Dálmata)
      // Rabinho abanando rápido
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-11, -12 + tailWag, 4, 4);
      // Corpo
      ctx.fillRect(-8, -12, 15, 9);
      // Barriga / peito secundário
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-2, -9, 9, 5);
      if (breed.id === 'dalmatian') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-6, -11, 2, 2);
        ctx.fillRect(-1, -10, 2, 2);
        ctx.fillRect(2, -7, 2, 2);
      }
      // Cabeça e focinho
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-2, -19, 11, 9);
      ctx.fillStyle = breed.id === 'pug' ? '#292524' : breed.secondaryColor;
      ctx.fillRect(7, -15, 4, 5);
      // Orelhas (caidinhas ou em pé para Husky/Shiba)
      ctx.fillStyle = breed.secondaryColor;
      if (breed.id === 'husky' || breed.id === 'shiba') {
        ctx.fillRect(-1, -22, 3, 3);
        ctx.fillRect(5, -22, 3, 3);
      } else {
        ctx.fillRect(-3, -18, 3, 6);
      }
      // Coleira
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-2, -11, 10, 2);
      // Olhos e nariz
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(3, -16, 2, 2);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(9, -15, 2, 2);
      // Patas
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-7, -3, 3, 3);
      ctx.fillRect(3, -3, 3, 3);
    } else if (petId === 'pet_dino') {
      // 🦖 Dinossauro Pré-Histórico (T-Rex, Triceratops, Velociraptor, Estegossauro, Albino)
      // Cauda grossa de dinossauro
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-14, -11 + tailWag, 7, 5);
      ctx.fillRect(-18, -9 + tailWag, 4, 3);
      // Corpo e barriga
      ctx.fillRect(-8, -16, 15, 13);
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-2, -13, 9, 9);
      // Placas dorsais / Crista (destaque especial para Estegossauro e Triceratops)
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-10, -18, 3, 3);
      ctx.fillRect(-10, -13, 3, 3);
      // Cabeça grande jurássica e mandíbula
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-3, -24, 14, 10);
      if (breed.id === 'triceratops_blue') {
        // Escudo e 3 chifres brancos de Triceratops
        ctx.fillStyle = breed.secondaryColor;
        ctx.fillRect(-6, -27, 6, 11);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(9, -23, 5, 2);
        ctx.fillRect(11, -18, 3, 2);
      } else {
        // Dentes afiados de T-Rex / Raptor
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(6, -14, 2, 2);
        ctx.fillRect(9, -14, 2, 2);
      }
      // Olho reptiliano
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(4, -21, 3, 3);
      // Bracinhos curtos de T-Rex
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(7, -12, 4, 2);
      // Patas fortes
      ctx.fillRect(-6, -3, 4, 3);
      ctx.fillRect(2, -3, 4, 3);
    } else if (petId === 'pet_fox') {
      // 🦊 Raposinha Astuta (Vermelha, Ártica, Fennec, Prateada, Kitsune)
      // Rabo super felpudo bicolor
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-14, -12 + tailWag, 7, 6);
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-17, -11 + tailWag, 4, 4);
      // Corpo e peito branco macio
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-7, -11, 14, 8);
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(1, -10, 6, 6);
      // Cabeça e orelhas grandes (ainda maiores na Fennec!)
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-2, -18, 11, 8);
      const earH = breed.id === 'fennec_fox' ? 6 : 4;
      ctx.fillRect(-2, -18 - earH, 3, earH);
      ctx.fillRect(5, -18 - earH, 3, earH);
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-2, -18 - earH, 2, 2);
      ctx.fillRect(6, -18 - earH, 2, 2);
      // Olhos e focinho
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(3, -15, 2, 2);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(9, -14, 2, 2);
      // Patinhas escuras
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-6, -3, 3, 3);
      ctx.fillRect(3, -3, 3, 3);
    } else if (petId === 'pet_bunny') {
      // 🐰 Coelhinho Saltitante (Neve, Lop Caramelo, Holandês, Chinchila, Rosa)
      const hopY = walkBob > 0 ? -2 : 0;
      // Pompom do rabinho
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-10, -8 + hopY, 4, 4);
      // Corpo arredondado
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-7, -11 + hopY, 13, 9);
      if (breed.id === 'dutch_panda') {
        ctx.fillStyle = breed.secondaryColor;
        ctx.fillRect(-2, -11 + hopY, 5, 8);
      }
      // Cabeça e orelhas compridas (caídas no Lop Caramelo!)
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-2, -17 + hopY, 10, 8);
      if (breed.id === 'caramel_lop') {
        ctx.fillRect(-3, -16 + hopY, 3, 8);
      } else {
        ctx.fillRect(0, -25 + hopY, 3, 8);
        ctx.fillRect(4, -25 + hopY, 3, 8);
        ctx.fillStyle = breed.secondaryColor;
        ctx.fillRect(1, -23 + hopY, 1, 5);
        ctx.fillRect(5, -23 + hopY, 1, 5);
      }
      // Olho e narizinho rosado
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(4, -14 + hopY, 2, 2);
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(7, -13 + hopY, 2, 2);
      // Pézinhos
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-5, -2, 4, 2);
      ctx.fillRect(2, -2, 4, 2);
    } else if (petId === 'pet_owl') {
      // 🦉 Corujinha Sábia (Neves, Buraqueira, Real Dourada, Cósmica)
      const wingFlap = Math.round(Math.sin(this.tick * 0.18) * 2);
      // Corpo rechonchudo emplumado
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-7, -16, 14, 13);
      // Peito rajado
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-4, -12, 9, 8);
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-2, -10, 2, 2);
      ctx.fillRect(2, -10, 2, 2);
      ctx.fillRect(0, -7, 2, 2);
      // Asinha lateral batendo
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-8, -13 + wingFlap, 4, 7);
      // Penachos de coruja no topo
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(-6, -19, 3, 3);
      ctx.fillRect(4, -19, 3, 3);
      // Olhos grandes redondos de coruja + bico
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(-3, -15, 3, 3);
      ctx.fillRect(3, -15, 3, 3);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-2, -14, 1, 2);
      ctx.fillRect(4, -14, 1, 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(0, -13, 3, 2);
      // Garrinhas
      ctx.fillRect(-4, -3, 3, 3);
      ctx.fillRect(2, -3, 3, 3);
    } else if (petId === 'pet_capybara') {
      // 🦫 Capivara Zen (Clássica com Laranja, Termas Onsen, Dourada, Chocolate)
      // Corpo retangular super tranquilo de capivara
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-9, -12, 17, 9);
      // Cabeça quadradinha clássica de capivara
      ctx.fillRect(-1, -17, 12, 9);
      // Focinho escuro e orelhinha arredondada
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(7, -16, 4, 6);
      ctx.fillRect(0, -19, 3, 2);
      // Olhinho calmo semicerrado ("-")
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(3, -14, 3, 1);
      // Tangerina / Laranja ou Toalhinha de Onsen equilibrada na cabeça!
      if (breed.id === 'onsen_towel') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(1, -20, 7, 3);
      } else {
        ctx.fillStyle = '#f97316';
        ctx.fillRect(3, -21, 4, 4);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(4, -22, 2, 1);
      }
      // Patinhas curtas
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-7, -3, 3, 3);
      ctx.fillRect(-2, -3, 3, 3);
      ctx.fillRect(4, -3, 3, 3);
    } else if (petId === 'pet_panda') {
      // 🐼 Ursinho Companheiro (Panda Gigante, Panda Vermelho, Urso Polar, Pardo, Sakura)
      // Rabinho (anelado longo se for Panda Vermelho, ou pompom para os outros)
      if (breed.id === 'red_panda') {
        ctx.fillStyle = breed.primaryColor;
        ctx.fillRect(-14, -11 + tailWag, 7, 5);
        ctx.fillStyle = breed.accentColor;
        ctx.fillRect(-12, -11 + tailWag, 2, 5);
      } else {
        ctx.fillStyle = breed.secondaryColor;
        ctx.fillRect(-9, -9, 3, 3);
      }
      // Corpo fofinho
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-7, -12, 14, 9);
      // Faixa peitoral / ombros do Panda
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-4, -12, 6, 4);
      // Cabeça redonda e orelhinhas redondas
      ctx.fillStyle = breed.primaryColor;
      ctx.fillRect(-3, -19, 11, 9);
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-4, -21, 3, 3);
      ctx.fillRect(5, -21, 3, 3);
      // Manchas nos olhos do Panda + olhinhos
      ctx.fillRect(0, -16, 3, 3);
      ctx.fillRect(5, -16, 3, 3);
      ctx.fillStyle = breed.eyeColor;
      ctx.fillRect(1, -15, 1, 1);
      ctx.fillRect(6, -15, 1, 1);
      // Bambu ou florzinha na boca
      ctx.fillStyle = breed.accentColor;
      ctx.fillRect(8, -13, 3, 2);
      // Patinhas
      ctx.fillStyle = breed.secondaryColor;
      ctx.fillRect(-6, -3, 3, 3);
      ctx.fillRect(3, -3, 3, 3);
    }

    ctx.restore();
  }

  private drawIdleProp(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseTop: number,
    dir: number,
    activity: string
  ) {
    if (activity === 'COFFEE') {
      const mx = x + dir * 11;
      const my = baseTop + 13;
      // Mug body & handle
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(mx - 3, my, 6, 7);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(mx + (dir > 0 ? 3 : -5), my + 1, 2, 4);
      // Coffee liquid rim
      ctx.fillStyle = '#78350f';
      ctx.fillRect(mx - 2, my + 1, 4, 2);
      // Animated steam wisps
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(mx - 1, my - 4 - ((this.tick >> 3) % 4), 2, 3);
      ctx.fillRect(mx + 1, my - 2 - (((this.tick >> 3) + 2) % 4), 1, 2);
    } else if (activity === 'TYPING') {
      const lx = x + dir * 11;
      const ly = baseTop + 14;
      // Laptop keyboard base
      ctx.fillStyle = '#64748b';
      ctx.fillRect(lx - 6, ly + 5, 12, 3);
      // Laptop screen frame & glowing display
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(lx - 5, ly - 2, 10, 7);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(lx - 4, ly - 1, 8, 5);
      // Animated code lines on screen
      ctx.fillStyle = '#bae6fd';
      ctx.fillRect(lx - 3, ly, 4 + ((this.tick >> 2) % 3), 1);
      ctx.fillRect(lx - 3, ly + 2, 3 + (((this.tick >> 2) + 1) % 4), 1);
    } else if (activity === 'READING') {
      const bx = x + dir * 11;
      const by = baseTop + 13;
      // Open book cover
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(bx - 5, by + 1, 10, 7);
      // Cream book pages
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(bx - 4, by, 4, 7);
      ctx.fillRect(bx + 1, by, 4, 7);
      // Spine & text lines
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(bx, by, 1, 8);
      ctx.fillStyle = '#92400e';
      ctx.fillRect(bx - 3, by + 2, 2, 1);
      ctx.fillRect(bx - 3, by + 4, 2, 1);
      ctx.fillRect(bx + 2, by + 2, 2, 1);
      ctx.fillRect(bx + 2, by + 4, 2, 1);
    } else if (activity === 'SLEEPING') {
      ctx.fillStyle = '#bae6fd';
      ctx.font = 'bold 9px monospace';
      const zOffset = (this.tick >> 2) % 12;
      ctx.fillText('Zzz', x + 10, baseTop - zOffset);
    } else if (activity === 'FISHING') {
      ctx.strokeStyle = '#fcd34d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + dir * 8, baseTop + 14);
      ctx.lineTo(x + dir * 24, baseTop + 1);
      ctx.stroke();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + dir * 24, baseTop + 1);
      ctx.lineTo(x + dir * 24, baseTop + 25);
      ctx.stroke();
      const bobY = baseTop + 24 + Math.round(Math.sin(this.tick * 0.14) * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x + dir * 23, bobY, 3, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + dir * 23, bobY + 2, 3, 2);
    }
  }

  private drawProjectile(
    ctx: CanvasRenderingContext2D,
    proj: ActiveProjectile,
    floorY: number
  ) {
    const t = proj.progress;
    const x = proj.fromX + (proj.toX - proj.fromX) * t;
    const arcHeight = 52;
    const y = floorY - 22 - Math.sin(t * Math.PI) * arcHeight;

    ctx.save();
    if (proj.itemId === 'throw_gold_plane') {
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 6, y - 3, 12, 5);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(x - 3, y - 5, 6, 2);
    } else if (proj.itemId === 'throw_frozen_fish') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x - 6, y - 4, 12, 7);
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(x - 9, y - 2, 4, 4);
    } else if (proj.itemId === 'throw_glitter_bomb') {
      ctx.fillStyle = this.tick % 4 < 2 ? '#f472b6' : '#c084fc';
      ctx.fillRect(x - 5, y - 5, 10, 10);
    } else {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    ctx.restore();
  }

  /**
   * 2.2 & 3.2. Balão de Chat (máx 80 caracteres, flutua 6s e some, estilizado por Chat Skin)
   */
  private drawChatBubble(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    text: string,
    skinId: string
  ) {
    ctx.save();
    ctx.font = 'bold 10px monospace';
    const maxCharsPerLine = 24;
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';

    for (const w of words) {
      if ((current + ' ' + w).trim().length > maxCharsPerLine) {
        if (current) lines.push(current);
        current = w.slice(0, maxCharsPerLine);
      } else {
        current = (current + ' ' + w).trim();
      }
    }
    if (current) lines.push(current);

    const lineHeight = 12;
    const boxW =
      Math.max(...lines.map((l) => ctx.measureText(l).width), 36) + 14;
    const boxH = lines.length * lineHeight + 10;

    const clampedX = Math.max(boxW / 2 + 6, Math.min(PixelCanvasRenderer.WIDTH - boxW / 2 - 6, x));
    const topY = Math.max(6, y - boxH);

    let bg = '#ffffff';
    let border = '#0f172a';
    let textColor = '#0f172a';

    if (skinId === 'chat_medieval') {
      bg = '#fde68a';
      border = '#92400e';
      textColor = '#451a03';
    } else if (skinId === 'chat_neon') {
      bg = '#090d16';
      border = '#22d3ee';
      textColor = '#67e8f9';
    } else if (skinId === 'chat_flames') {
      bg = '#431407';
      border = '#f97316';
      textColor = '#ffedd5';
    }

    ctx.fillStyle = bg;
    ctx.fillRect(clampedX - boxW / 2, topY, boxW, boxH);
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(clampedX - boxW / 2, topY, boxW, boxH);

    ctx.fillStyle = border;
    ctx.fillRect(clampedX - 3, topY + boxH, 6, 4);

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    lines.forEach((line, idx) => {
      ctx.fillText(line, clampedX, topY + 13 + idx * lineHeight);
    });
    ctx.restore();
  }

  private previewCanvas: HTMLCanvasElement | null = null;
  private previewSpawnStartedAt = 0;

  public attachPreviewCanvas(canvas: HTMLCanvasElement | null) {
    this.previewCanvas = canvas;
    if (canvas) {
      canvas.width = 220;
      canvas.height = 135;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.imageSmoothingEnabled = false;
    }
  }

  public triggerPreviewSpawnFx() {
    this.previewSpawnStartedAt = Date.now();
  }

  public renderPreviewFrame(profile: {
    id: string;
    username: string;
    displayName: string;
    equipped: RoomPlayerState['equipped'];
    petVariants?: Record<string, string>;
  }) {
    if (!this.previewCanvas) return;
    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) return;

    const W = 220;
    const H = 135;
    const floorY = H - 20;

    ctx.clearRect(0, 0, W, H);
    this.drawRoomBackground(ctx, profile.equipped.room_skin || 'room_cozy_desk', W, H, floorY);
    this.drawFloorStrip(ctx, profile.equipped.room_skin || 'room_cozy_desk', W, H, floorY);

    const petId = profile.equipped.companion_pet;
    const mockPlayer: RoomPlayerState = {
      userId: '__preview__',
      username: profile.username,
      displayName: profile.displayName,
      isHost: true,
      x: Math.round(W / 2),
      targetX: Math.round(W / 2),
      facing: Math.floor(this.tick / 90) % 2 === 0 ? 'right' : 'left',
      hostStatus: 'ACTIVE',
      idleActivity: 'COFFEE',
      equipped: {
        ...profile.equipped,
        companion_pet_variant: petId
          ? profile.petVariants?.[petId] || profile.equipped.companion_pet_variant
          : undefined,
      },
      spawnFx:
        this.previewSpawnStartedAt > 0
          ? {
              fxId: profile.equipped.spawn_fx,
              startedAt: this.previewSpawnStartedAt,
            }
          : undefined,
    };

    this.drawPlayer(ctx, mockPlayer, floorY);
    this.drawChatBubble(
      ctx,
      Math.round(W / 2),
      floorY - 48,
      'Meu Estilo! ✨',
      profile.equipped.chat_skin
    );
  }
}
