import { getCosmeticById } from '../shared/catalog';
import {
  DeskDropInstance,
  InteractionActionType,
  PlacedFurnitureItem,
  RoomPlayerState,
  RoomSnapshot,
} from '../shared/types';
import { soundEngine } from '../audio/soundEngine';
import { windowBridge } from '../bridge/windowBridge';

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

export interface PixelCanvasCallbacks {
  onMoveRequest: (targetX: number) => void;
  onJumpRequest: () => void;
  onSelectPlayer: (userId: string) => void;
  onPokePlayer: (userId: string) => void;
  onClaimDrop: (dropId: string) => void;
  onKickVisitor?: (userId: string) => void;
  onMoveFurniture?: (instanceId: string, x: number) => void;
  onFlipFurniture?: (instanceId: string) => void;
  onHoverStateChange?: (hoverLabel: string | null) => void;
}

export class PixelCanvasRenderer {
  public static readonly WIDTH = 360;
  public static readonly HEIGHT = 180;
  public static readonly FLOOR_HEIGHT = 22;
  public static readonly FLOOR_Y = PixelCanvasRenderer.HEIGHT - PixelCanvasRenderer.FLOOR_HEIGHT;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: PixelCanvasCallbacks;

  private room: RoomSnapshot | null = null;
  private myUserId = '';
  private selectedTargetUserId: string | null = null;
  public editFurnitureMode = false;

  private physics = new Map<string, LocalAvatarPhysics>();
  private seenSpawnFx = new Set<string>();
  private projectiles: ActiveProjectile[] = [];
  private particles: Particle[] = [];

  private hoveredDropId: string | null = null;
  private hoveredPlayerId: string | null = null;
  private hoveredFurnitureId: string | null = null;
  private draggingFurnitureId: string | null = null;
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

  public setSelectedTarget(userId: string | null) {
    this.selectedTargetUserId = userId;
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
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  private bindEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      const { x, y } = this.getCanvasCoords(e);

      // Handle live furniture dragging!
      if (this.draggingFurnitureId && this.room?.placedFurniture) {
        const furn = this.room.placedFurniture.find(
          (f) => f.instanceId === this.draggingFurnitureId
        );
        if (furn) {
          const clampedX = Math.max(26, Math.min(334, Math.round(x)));
          furn.x = clampedX;
          const now = Date.now();
          if (now - this.lastFurnitureEmitAt >= 70) {
            this.lastFurnitureEmitAt = now;
            this.callbacks.onMoveFurniture?.(furn.instanceId, clampedX);
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
        if (furn) {
          this.callbacks.onMoveFurniture?.(furn.instanceId, furn.x);
        }
        this.draggingFurnitureId = null;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      const isMyRoom = this.room?.hostUserId === this.myUserId;
      if (!isMyRoom) return;

      // If right-clicking a visitor avatar (and not in furniture edit mode), expel that visitor!
      if (!this.editFurnitureMode && this.hoveredPlayerId && this.hoveredPlayerId !== this.myUserId) {
        e.preventDefault();
        soundEngine.playTone(320, 0.12, 'sawtooth', 0.08, 180);
        this.callbacks.onKickVisitor?.(this.hoveredPlayerId);
        return;
      }

      if (this.hoveredFurnitureId) {
        e.preventDefault();
        soundEngine.playTone(440, 0.08, 'triangle', 0.07, 660);
        this.callbacks.onFlipFurniture?.(this.hoveredFurnitureId);
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const { x, y } = this.getCanvasCoords(e);

      // 0. If hovering a furniture item in our own room (and either in edit mode or not clicking a drop/other player), start dragging it!
      const isMyRoom = this.room?.hostUserId === this.myUserId;
      if (
        isMyRoom &&
        this.hoveredFurnitureId &&
        (this.editFurnitureMode || (!this.hoveredDropId && !this.hoveredPlayerId))
      ) {
        this.draggingFurnitureId = this.hoveredFurnitureId;
        soundEngine.playTone(520, 0.06, 'sine', 0.06);
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
        this.callbacks.onSelectPlayer(this.hoveredPlayerId);
        this.callbacks.onPokePlayer(this.hoveredPlayerId);
        return;
      }

      // 3. Otherwise move our avatar along the X axis
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
    let label: string | null = null;

    if (this.room) {
      const isMyRoom = this.room.hostUserId === this.myUserId;

      // In editFurnitureMode, prioritize furniture hit-testing first!
      if (isMyRoom && this.room.placedFurniture) {
        for (let i = this.room.placedFurniture.length - 1; i >= 0; i--) {
          const furn = this.room.placedFurniture[i];
          const item = getCosmeticById(furn.itemId);
          const halfW = (item?.meta?.widthPx || 36) / 2;
          if (
            Math.abs(x - furn.x) <= halfW &&
            y >= PixelCanvasRenderer.FLOOR_Y - 46 &&
            y <= PixelCanvasRenderer.FLOOR_Y + 4
          ) {
            this.hoveredFurnitureId = furn.instanceId;
            label = `🖐️ Segure e arraste para mover "${item?.name || 'Móvel'}" (Botão direito: Virar)`;
            break;
          }
        }
      }

      // Check Desk Drops
      if (!this.editFurnitureMode) {
        for (const drop of this.room.deskDrops) {
          const dx = Math.abs(x - drop.x);
          const dy = Math.abs(y - (PixelCanvasRenderer.FLOOR_Y - 8));
          if (dx <= 14 && dy <= 14) {
            this.hoveredDropId = drop.id;
            const item = getCosmeticById(drop.itemId);
            label = `🎁 Clique para pegar ${item?.name || 'Presente'} (de ${drop.fromDisplayName})`;
            break;
          }
        }
      }

      // Check Avatars
      if (!this.editFurnitureMode && !this.hoveredDropId) {
        for (const p of this.room.players) {
          const phys = this.physics.get(p.userId);
          const px = phys ? phys.renderX : p.x;
          const py = PixelCanvasRenderer.FLOOR_Y + (phys ? phys.renderY : 0) - 18;
          if (Math.abs(x - px) <= 15 && Math.abs(y - py) <= 22) {
            this.hoveredPlayerId = p.userId;
            label =
              p.userId === this.myUserId
                ? `✨ Você (${p.displayName})`
                : isMyRoom
                  ? `👆 Clique: Cutucar/Selecionar ${p.displayName} • Botão Direito: 👢 Expulsar`
                  : `👆 Clique para cutucar/selecionar ${p.displayName}`;
            break;
          }
        }
      }
    }

    if (this.draggingFurnitureId || this.hoveredFurnitureId) {
      this.canvas.style.cursor = this.draggingFurnitureId ? 'grabbing' : 'grab';
    } else if (this.hoveredDropId || this.hoveredPlayerId) {
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

    ctx.clearRect(0, 0, W, H);

    const skinId = this.room?.roomSkinId || 'room_cozy_desk';

    if (!windowBridge.isTransparentOverlay) {
      this.drawRoomBackground(ctx, skinId, W, H, floorY);
    }

    this.drawFloorStrip(ctx, skinId, W, H, floorY);

    if (!this.room) return;

    // Draw Placed Furniture on the floor (Setup Gamer, Cadeira Gamer, Mesa de Jantar, etc.)
    if (this.room.placedFurniture) {
      for (const furn of this.room.placedFurniture) {
        this.drawPlacedFurniture(ctx, furn, floorY);
      }
    }

    // Draw Desk Drops (AFK Gifts) on the floor
    for (const drop of this.room.deskDrops) {
      this.drawDeskDrop(ctx, drop, floorY);
    }

    // Draw Knock Peeking Visitor on the right window edge (Section 2.2 KNOCK)
    if (this.room.pendingKnocks.length > 0) {
      this.drawKnockPeeker(ctx, this.room.pendingKnocks[0], W, floorY);
    }

    // Draw Players (Host + up to 4 Visitors)
    for (const p of this.room.players) {
      this.drawPlayer(ctx, p, floorY);
    }

    // Draw Active Projectiles (Throwables)
    for (const proj of this.projectiles) {
      this.drawProjectile(ctx, proj, floorY);
    }

    // Draw Particles
    for (const pt of this.particles) {
      ctx.save();
      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
      ctx.restore();
    }

    // Draw Floating Chat Bubbles above avatars (max 80 chars, 6s duration)
    for (const p of this.room.players) {
      if (p.chatBubble && p.chatBubble.expiresAt > Date.now()) {
        const phys = this.physics.get(p.userId);
        const px = phys ? phys.renderX : p.x;
        const py = floorY + (phys ? phys.renderY : 0) - 44;
        this.drawChatBubble(ctx, px, py, p.chatBubble.text, p.chatBubble.skinId);
      }
    }
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
    const halfW = Math.round((item?.meta?.widthPx || 36) / 2);

    ctx.save();
    ctx.translate(x, floorY);
    if (furn.flipped) {
      ctx.scale(-1, 1);
    }

    if (furn.itemId === 'furn_gamer_setup') {
      // 🖥️ Setup Gamer RGB (Desk + Dual Monitors + RGB PC Tower + Mechanical Keyboard)
      // Desk legs
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-24, -18, 4, 18);
      ctx.fillRect(20, -18, 4, 18);
      // Carbon desk surface
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-27, -21, 54, 4);
      // Animated RGB LED strip under desk edge
      const rgbColors = ['#22d3ee', '#f472b6', '#a855f7', '#4ade80'];
      const c1 = rgbColors[(this.tick >> 3) % rgbColors.length];
      const c2 = rgbColors[((this.tick >> 3) + 1) % rgbColors.length];
      ctx.fillStyle = c1;
      ctx.fillRect(-26, -18, 26, 2);
      ctx.fillStyle = c2;
      ctx.fillRect(0, -18, 26, 2);

      // Left & Center Dual Monitors
      ctx.fillStyle = '#334155';
      ctx.fillRect(-20, -25, 3, 4); // Stand 1
      ctx.fillRect(-3, -25, 3, 4); // Stand 2
      // Monitor frames
      ctx.fillStyle = '#090d16';
      ctx.fillRect(-25, -39, 15, 14);
      ctx.fillRect(-9, -40, 17, 15);
      // Glowing screens with code/game lines
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(-24, -38, 13, 12);
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(-8, -39, 15, 13);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(-22, -36, 7, 2);
      ctx.fillRect(-22, -32, 9, 2);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(-6, -36, 10, 2);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(-6, -32, 8, 3);

      // RGB Mechanical Keyboard on desk
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-10, -23, 12, 2);
      ctx.fillStyle = c1;
      ctx.fillRect(-9, -22, 10, 1);

      // Glass PC Case Tower on right side of desk
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(11, -39, 13, 18);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(13, -37, 9, 14);
      // Animated RGB coolers inside PC tower
      ctx.fillStyle = c1;
      ctx.fillRect(15, -35, 5, 4);
      ctx.fillStyle = c2;
      ctx.fillRect(15, -29, 5, 4);
    } else if (furn.itemId === 'furn_gamer_chair') {
      // 🪑 Cadeira Gamer Pro (Racing Chair)
      // 5-star wheel base on floor
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-9, -3, 18, 3);
      ctx.fillRect(-2, -9, 4, 6); // Gas lift
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-10, -2, 3, 2);
      ctx.fillRect(7, -2, 3, 2);
      // Seat cushion
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-10, -13, 20, 4);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-10, -12, 4, 3);
      ctx.fillRect(6, -12, 4, 3);
      // High racing backrest
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-7, -36, 14, 23);
      ctx.fillStyle = '#ef4444'; // Racing stripes
      ctx.fillRect(-7, -34, 3, 20);
      ctx.fillRect(4, -34, 3, 20);
      // Headrest & Lumbar pillows
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-4, -33, 8, 3);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-4, -18, 8, 4);
      // Armrests
      ctx.fillStyle = '#334155';
      ctx.fillRect(-11, -19, 3, 6);
      ctx.fillRect(8, -19, 3, 6);
    } else if (furn.itemId === 'furn_dining_table') {
      // 🍽️ Mesa de Jantar Posta
      // Wooden legs
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-24, -18, 4, 18);
      ctx.fillRect(20, -18, 4, 18);
      // Oak tabletop
      ctx.fillStyle = '#92400e';
      ctx.fillRect(-28, -22, 56, 5);
      // White & crimson centerpiece tablecloth overhang
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-22, -22, 44, 3);
      ctx.fillStyle = '#e11d48';
      ctx.fillRect(-8, -22, 16, 6);
      // Left & Right Porcelain Dinner Plates
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-21, -24, 10, 2);
      ctx.fillRect(11, -24, 10, 2);
      // Wine glasses
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-9, -28, 3, 4);
      ctx.fillRect(6, -28, 3, 4);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-8, -24, 1, 2);
      ctx.fillRect(7, -24, 1, 2);
      // Center Candlestick + Flickering Flame
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-2, -26, 4, 4);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(-1, -31, 2, 5);
      const flicker = (this.tick >> 2) % 2 === 0 ? -1 : 0;
      ctx.fillStyle = '#f97316';
      ctx.fillRect(-1, -34 + flicker, 2, 3);
    } else if (furn.itemId === 'furn_arcade_cabinet') {
      // 🕹️ Fliperama Arcade 90s
      ctx.fillStyle = '#3b0764';
      ctx.fillRect(-13, -46, 26, 46);
      ctx.fillStyle = '#7e22ce';
      ctx.fillRect(-15, -46, 3, 46);
      ctx.fillRect(12, -46, 3, 46);
      // Glowing Top Marquee
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-12, -44, 24, 6);
      // CRT Screen
      ctx.fillStyle = '#090d16';
      ctx.fillRect(-10, -35, 20, 14);
      ctx.fillStyle = (this.tick >> 3) % 2 === 0 ? '#22d3ee' : '#f472b6';
      ctx.fillRect(-7, -31, 5, 5);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(2, -28, 4, 4);
      // Joystick deck
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-7, -20, 2, 3);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(3, -19, 2, 2);
      ctx.fillRect(6, -19, 2, 2);
    } else if (furn.itemId === 'furn_cozy_sofa') {
      // 🛋️ Sofá Lofi 2 Lugares
      ctx.fillStyle = '#831843';
      ctx.fillRect(-24, -22, 48, 20);
      ctx.fillStyle = '#be185d';
      ctx.fillRect(-20, -26, 40, 14);
      ctx.fillStyle = '#db2777';
      ctx.fillRect(-20, -13, 19, 8);
      ctx.fillRect(1, -13, 19, 8);
      // Throw pillows
      ctx.fillStyle = '#fde047';
      ctx.fillRect(-17, -21, 7, 7);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(10, -21, 7, 7);
      // Wooden sofa feet
      ctx.fillStyle = '#451a03';
      ctx.fillRect(-22, -2, 4, 2);
      ctx.fillRect(18, -2, 4, 2);
    } else if (furn.itemId === 'furn_mini_fridge') {
      // 🧊 Frigobar RGB
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-11, -30, 22, 30);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-9, -28, 18, 26);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1;
      ctx.strokeRect(-8, -27, 16, 24);
      // Cans inside
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
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-9, -8, 18, 8);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-3, -22, 5, 14);
      ctx.fillRect(-8, -20, 6, 3);
      ctx.fillStyle = '#f472b6';
      ctx.fillRect(-14, -34, 28, 12);
      ctx.fillStyle = '#fbcfe8';
      ctx.fillRect(-10, -38, 20, 8);
    }

    ctx.restore();

    // Draw Dragging / Edit Mode highlight box
    if (isDragging || isHovered || this.editFurnitureMode) {
      ctx.save();
      ctx.strokeStyle = isDragging
        ? '#4ade80'
        : isHovered
          ? '#facc15'
          : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = isDragging || isHovered ? 1.5 : 1;
      ctx.setLineDash(isDragging ? [] : [3, 3]);
      ctx.strokeRect(x - halfW - 2, floorY - 44, halfW * 2 + 4, 44);

      if (isDragging || isHovered) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fillRect(x - 24, floorY - 56, 48, 11);
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`↔ X:${x}`, x, floorY - 48);
      }
      ctx.restore();
    }
  }

  private drawRoomBackground(
    ctx: CanvasRenderingContext2D,
    skinId: string,
    W: number,
    H: number,
    floorY: number
  ) {
    if (skinId === 'room_rainy_rooftop') {
      // Rainy Rooftop Lofi
      const grad = ctx.createLinearGradient(0, 0, 0, floorY);
      grad.addColorStop(0, '#090d16');
      grad.addColorStop(1, '#1e293b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, floorY);

      // Far city buildings
      const buildings = [
        { x: 10, w: 38, h: 90, c: '#0f172a' },
        { x: 52, w: 46, h: 115, c: '#111827' },
        { x: 105, w: 34, h: 78, c: '#0f172a' },
        { x: 148, w: 54, h: 122, c: '#131c31' },
        { x: 210, w: 42, h: 96, c: '#0f172a' },
        { x: 260, w: 50, h: 110, c: '#111827' },
        { x: 315, w: 40, h: 85, c: '#0f172a' },
      ];
      buildings.forEach((b, idx) => {
        ctx.fillStyle = b.c;
        ctx.fillRect(b.x, floorY - b.h, b.w, b.h);
        // Lit pixel windows
        ctx.fillStyle = idx % 2 === 0 ? '#38bdf8' : '#f472b6';
        for (let wy = floorY - b.h + 10; wy < floorY - 14; wy += 14) {
          for (let wx = b.x + 6; wx < b.x + b.w - 8; wx += 10) {
            if ((wx + wy + idx) % 3 !== 0) {
              ctx.fillRect(wx, wy, 4, 6);
            }
          }
        }
      });

      // Falling pixel rain lines
      ctx.fillStyle = 'rgba(125, 211, 252, 0.45)';
      for (let i = 0; i < 36; i++) {
        const rx = ((i * 37 + this.tick * 2) % W);
        const ry = ((i * 29 + this.tick * 5) % floorY);
        ctx.fillRect(rx, ry, 1, 7);
      }
    } else if (skinId === 'room_forest_campfire') {
      // Forest Campfire Night
      const grad = ctx.createLinearGradient(0, 0, 0, floorY);
      grad.addColorStop(0, '#022c22');
      grad.addColorStop(1, '#064e3b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, floorY);

      // Stars & Fireflies
      for (let i = 0; i < 22; i++) {
        const sx = (i * 53) % W;
        const sy = (i * 23) % (floorY - 40);
        ctx.fillStyle = i % 3 === 0 ? '#fde047' : '#a7f3d0';
        const pulse = Math.sin(this.tick * 0.06 + i) > 0 ? 2 : 1;
        ctx.fillRect(sx, sy, pulse, pulse);
      }

      // Pixel Pine Trees
      for (let tx = 16; tx < W; tx += 44) {
        ctx.fillStyle = '#065f46';
        ctx.fillRect(tx + 8, floorY - 64, 8, 64);
        ctx.fillStyle = '#047857';
        ctx.fillRect(tx, floorY - 46, 24, 16);
        ctx.fillRect(tx + 3, floorY - 60, 18, 16);
        ctx.fillRect(tx + 6, floorY - 72, 12, 14);
      }

      // Center Campfire
      const cx = 180;
      ctx.fillStyle = '#78350f';
      ctx.fillRect(cx - 12, floorY - 6, 24, 6);
      const flameH = 10 + Math.floor(Math.sin(this.tick * 0.25) * 3);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(cx - 8, floorY - 6 - flameH, 16, flameH);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(cx - 4, floorY - 6 - Math.floor(flameH * 0.7), 8, Math.floor(flameH * 0.7));
    } else if (skinId === 'room_moving_train') {
      // Moving Sunset Train Carriage
      ctx.fillStyle = '#27171c';
      ctx.fillRect(0, 0, W, floorY);

      // Panoramic train windows showing moving sunset scenery
      for (let wx = 20; wx < W - 30; wx += 112) {
        // Sunset sky inside window
        const skyGrad = ctx.createLinearGradient(0, 24, 0, 114);
        skyGrad.addColorStop(0, '#c2410c');
        skyGrad.addColorStop(0.6, '#fb923c');
        skyGrad.addColorStop(1, '#fde047');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(wx, 26, 94, 86);

        // Scrolling telegraph poles & hills
        const scrollX = (this.tick * 2) % 94;
        ctx.fillStyle = '#431407';
        ctx.fillRect(wx + 94 - scrollX, 54, 3, 58);

        // Window frame border
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 4;
        ctx.strokeRect(wx, 26, 94, 86);
      }

      // Hanging train handles
      for (let hx = 45; hx < W - 30; hx += 65) {
        const sway = Math.round(Math.sin(this.tick * 0.08) * 2);
        ctx.fillStyle = '#a1a1aa';
        ctx.fillRect(hx + sway, 0, 2, 18);
        ctx.strokeStyle = '#e4e4e7';
        ctx.lineWidth = 2;
        ctx.strokeRect(hx - 3 + sway, 18, 8, 6);
      }
    } else {
      // Default: Cozy Lofi Night Studio (room_cozy_desk)
      const grad = ctx.createLinearGradient(0, 0, 0, floorY);
      grad.addColorStop(0, '#1e1b4b');
      grad.addColorStop(1, '#312e81');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, floorY);

      // Night window on the left
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(28, 22, 76, 78);
      // Crescent moon & stars inside window
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(78, 36, 12, 12);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(83, 34, 10, 10);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(42, 40, 2, 2);
      ctx.fillRect(56, 62, 2, 2);
      ctx.fillRect(48, 80, 2, 2);
      // Window frame
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 4;
      ctx.strokeRect(28, 22, 76, 78);
      ctx.fillStyle = '#334155';
      ctx.fillRect(22, 98, 88, 6);

      // Bookshelf on the right
      ctx.fillStyle = '#451a03';
      ctx.fillRect(246, 36, 76, 62);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(242, 64, 84, 5);
      ctx.fillRect(242, 94, 84, 5);

      // Colorful pixel books
      const bookColors = ['#ef4444', '#38bdf8', '#facc15', '#a855f7', '#22c55e'];
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = bookColors[i];
        ctx.fillRect(252 + i * 11, 44, 8, 20);
        ctx.fillRect(256 + i * 11, 72, 9, 22);
      }

      // Cozy potted plant
      ctx.fillStyle = '#b45309';
      ctx.fillRect(152, floorY - 14, 14, 14);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(148, floorY - 26, 22, 12);
      ctx.fillRect(152, floorY - 32, 14, 8);
    }
  }

  private drawFloorStrip(
    ctx: CanvasRenderingContext2D,
    skinId: string,
    W: number,
    _H: number,
    floorY: number
  ) {
    const fh = PixelCanvasRenderer.FLOOR_HEIGHT;
    if (skinId === 'room_forest_campfire') {
      ctx.fillStyle = '#14532d';
      ctx.fillRect(0, floorY, W, fh);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(0, floorY, W, 4);
    } else if (skinId === 'room_rainy_rooftop') {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, floorY, W, fh);
      ctx.fillStyle = '#38bdf8';
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
  }

  private drawDeskDrop(
    ctx: CanvasRenderingContext2D,
    drop: DeskDropInstance,
    floorY: number
  ) {
    const x = Math.round(drop.x);
    const y = floorY - 14;
    const isHovered = this.hoveredDropId === drop.id;
    const bob = isHovered ? -3 : Math.round(Math.sin(this.tick * 0.08 + x) * 1.5);

    ctx.save();
    if (isHovered) {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
      ctx.fillRect(x - 12, y + bob - 4, 24, 20);
    }

    if (drop.itemId === 'drop_coffee') {
      // Espresso mug + rising steam
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 6, y + bob + 2, 12, 11);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - 4, y + bob + 4, 8, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const steamOffset = (this.tick >> 3) % 4;
      ctx.fillRect(x - 3, y + bob - 4 - steamOffset, 2, 4);
      ctx.fillRect(x + 2, y + bob - 2 - steamOffset, 2, 4);
    } else if (drop.itemId === 'drop_rubber_duck') {
      // Yellow rubber duck
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 7, y + bob + 4, 14, 9);
      ctx.fillRect(x + 1, y + bob - 1, 8, 7);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(x + 8, y + bob + 2, 4, 3);
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + 5, y + bob + 1, 2, 2);
    } else if (drop.itemId === 'drop_birthday_cake') {
      // Cake with candle
      ctx.fillStyle = '#fbcfe8';
      ctx.fillRect(x - 8, y + bob + 4, 16, 10);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(x - 8, y + bob + 4, 16, 3);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(x - 1, y + bob - 2, 2, 6);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(x - 1, y + bob - 5, 2, 3);
    } else if (drop.itemId === 'drop_sleeping_cat') {
      // Sleeping orange cat
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(x - 9, y + bob + 5, 18, 9);
      ctx.fillStyle = '#ea580c';
      ctx.fillRect(x - 5, y + bob + 5, 3, 5);
      ctx.fillRect(x + 2, y + bob + 5, 3, 5);
    } else {
      // Post-it note
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(x - 7, y + bob + 2, 14, 12);
      ctx.fillStyle = '#ca8a04';
      ctx.fillRect(x - 5, y + bob + 5, 10, 2);
      ctx.fillRect(x - 5, y + bob + 9, 7, 2);
    }
    ctx.restore();
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
    // Peeking head at right border of the window
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(peekX, peekY, 18, 22);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(peekX + 3, peekY + 7, 3, 3);
    ctx.fillRect(peekX + 10, peekY + 7, 3, 3);

    // Pulsing doorbell badge
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
    let y = Math.round(floorY + (phys ? phys.renderY : 0));

    const now = Date.now();
    const spawnElapsed = p.spawnFx ? now - p.spawnFx.startedAt : 99999;

    // 3.2. Efeitos de Entrada (Spawn FX)
    if (p.spawnFx && spawnElapsed < 1400) {
      const progress = spawnElapsed / 1400;
      if (p.spawnFx.fxId === 'fx_parachute') {
        y = Math.round(floorY - (1 - progress) * 115);
        // Draw pixel parachute canopy above avatar
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
        // Alien UFO tractor beam
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
        // Cardboard box shaking before popping open
        const shake = Math.round(Math.sin(this.tick * 0.8) * 2);
        ctx.fillStyle = '#d97706';
        ctx.fillRect(x - 13 + shake, y - 24, 26, 24);
        ctx.fillStyle = '#92400e';
        ctx.fillRect(x - 13 + shake, y - 14, 26, 3);
        return;
      }
    }

    const walkBob = phys && phys.walkFrame > 0 ? Math.round(Math.abs(Math.sin(phys.walkFrame)) * 3) : 0;
    const baseTop = y - 28 - walkBob;
    const dir = p.facing === 'right' ? 1 : -1;

    // Selection ring if targeted
    if (this.selectedTargetUserId === p.userId) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 14, baseTop - 6, 28, 36);
    }

    // Shadow on floor
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x - 10, floorY - 2, 20, 4);

    // 1. Back Accessory (avatar_back)
    if (p.equipped.avatar_back === 'back_jetpack') {
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x - dir * 11 - 3, baseTop + 8, 7, 13);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x - dir * 11 - 2, baseTop + 10, 5, 4);
    } else if (p.equipped.avatar_back === 'back_angel_wings') {
      const wingFlap = Math.round(Math.sin(this.tick * 0.15) * 2);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x - 16, baseTop + 6 + wingFlap, 8, 10);
      ctx.fillRect(x + 8, baseTop + 6 + wingFlap, 8, 10);
    }

    // 2. Body Sprite (avatar_body)
    const bodyId = p.equipped.avatar_body;
    if (bodyId === 'body_pigeon') {
      // Fantasia de Pombo
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x - 9, baseTop + 6, 18, 18);
      ctx.fillStyle = '#14b8a6'; // Iridescent pigeon neck
      ctx.fillRect(x - 8, baseTop + 10, 16, 4);
      ctx.fillStyle = '#f97316'; // Beak & legs
      ctx.fillRect(x + dir * 8, baseTop + 8, 5, 3);
      ctx.fillRect(x - 4, y - 4, 2, 4);
      ctx.fillRect(x + 3, y - 4, 2, 4);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x + dir * 4, baseTop + 7, 2, 2);
    } else if (bodyId === 'body_cat') {
      // Gatinho Laranja
      ctx.fillStyle = '#f97316';
      ctx.fillRect(x - 9, baseTop + 6, 18, 18);
      // Cat ears
      ctx.fillRect(x - 9, baseTop + 2, 4, 4);
      ctx.fillRect(x + 5, baseTop + 2, 4, 4);
      // Eyes & whiskers
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x + dir * 3 - 4, baseTop + 10, 2, 3);
      ctx.fillRect(x + dir * 3 + 2, baseTop + 10, 2, 3);
      ctx.fillStyle = '#fed7aa';
      ctx.fillRect(x - 5, baseTop + 16, 10, 6);
    } else if (bodyId === 'body_cyber_bot') {
      // Robô Retrô MK-II
      ctx.fillStyle = '#334155';
      ctx.fillRect(x - 9, baseTop + 4, 18, 20);
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(x - 7, baseTop + 7, 14, 5);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(x - 1, baseTop, 2, 4);
    } else {
      // Default: Humano Cozy
      ctx.fillStyle = '#fed7aa'; // Head skin
      ctx.fillRect(x - 7, baseTop + 2, 14, 11);
      ctx.fillStyle = '#312e81'; // Hair
      ctx.fillRect(x - 8, baseTop, 16, 5);
      // Eyes (closed if IDLE SLEEPING)
      ctx.fillStyle = '#0f172a';
      if (p.hostStatus === 'IDLE' && p.idleActivity === 'SLEEPING') {
        ctx.fillRect(x + dir * 2 - 4, baseTop + 8, 3, 1);
        ctx.fillRect(x + dir * 2 + 2, baseTop + 8, 3, 1);
      } else {
        ctx.fillRect(x + dir * 2 - 3, baseTop + 7, 2, 3);
        ctx.fillRect(x + dir * 2 + 3, baseTop + 7, 2, 3);
      }
      // Hoodie body
      ctx.fillStyle = p.isHost ? '#6366f1' : '#10b981';
      ctx.fillRect(x - 8, baseTop + 13, 16, 11);
      // Legs
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(x - 6, y - 4, 4, 4);
      ctx.fillRect(x + 2, y - 4, 4, 4);
    }

    // 3. Head Accessory (avatar_head)
    const headId = p.equipped.avatar_head;
    if (headId === 'head_lofi_headphones') {
      ctx.fillStyle = '#ec4899';
      ctx.fillRect(x - 10, baseTop + 1, 20, 3);
      ctx.fillRect(x - 11, baseTop + 4, 4, 7);
      ctx.fillRect(x + 7, baseTop + 4, 4, 7);
    } else if (headId === 'head_astronaut') {
      ctx.fillStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.fillRect(x - 11, baseTop - 2, 22, 16);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 11, baseTop - 2, 22, 16);
    } else if (headId === 'head_wizard') {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(x - 12, baseTop, 24, 4);
      ctx.fillRect(x - 8, baseTop - 6, 16, 6);
      ctx.fillRect(x - 4, baseTop - 12, 8, 6);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x - 1, baseTop - 8, 2, 2);
    }

    // 4. Host IDLE Animations (Section 2.1: beber café, digitar, cochilar, pescar)
    if (p.hostStatus === 'IDLE' && Math.abs((phys?.renderX || p.x) - p.targetX) < 2) {
      this.drawIdleProp(ctx, x, baseTop, dir, p.idleActivity);
    }

    // 5. Synchronized Emote floating badge
    if (p.activeEmote && p.activeEmote.expiresAt > now) {
      const floatY = baseTop - 16 + Math.round(Math.sin(this.tick * 0.15) * 3);
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.activeEmote.emote, x, floatY);
    }

    // 6. Player Nameplate + Status Dot
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const tag = p.userId === this.myUserId ? `${p.displayName} (Você)` : p.displayName;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    const textW = ctx.measureText(tag).width + 10;
    ctx.fillRect(x - textW / 2, y + 3, textW, 12);

    ctx.fillStyle =
      p.hostStatus === 'DND'
        ? '#f87171'
        : p.hostStatus === 'IDLE'
          ? '#fbbf24'
          : '#4ade80';
    ctx.fillText(tag, x, y + 12);
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
      // Holding steaming mug
      const mx = x + dir * 11;
      const my = baseTop + 14;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mx - 3, my, 6, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(mx - 1, my - 4 - ((this.tick >> 3) % 4), 2, 3);
    } else if (activity === 'TYPING') {
      // Mini pixel laptop in front of avatar
      const lx = x + dir * 10;
      const ly = baseTop + 16;
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(lx - 5, ly + 5, 10, 3);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(lx - 4, ly - 1, 8, 6);
    } else if (activity === 'SLEEPING') {
      // Floating Zzz
      ctx.fillStyle = '#bae6fd';
      ctx.font = 'bold 9px monospace';
      const zOffset = (this.tick >> 2) % 12;
      ctx.fillText('Zzz', x + 10, baseTop - zOffset);
    } else if (activity === 'FISHING') {
      // Fishing rod & bobber
      ctx.strokeStyle = '#fcd34d';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + dir * 8, baseTop + 14);
      ctx.lineTo(x + dir * 24, baseTop + 2);
      ctx.stroke();
      ctx.strokeStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(x + dir * 24, baseTop + 2);
      ctx.lineTo(x + dir * 24, baseTop + 26);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x + dir * 23, baseTop + 25 + Math.round(Math.sin(this.tick * 0.12) * 2), 3, 3);
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
      // Paper ball
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
    ctx.font = '10px monospace';
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

    // Style according to Chat Skin
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

    // Pointer triangle
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
      equipped: profile.equipped,
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
      floorY - 42,
      'Meu Estilo! ✨',
      profile.equipped.chat_skin
    );
  }
}
