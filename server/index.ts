import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import { COSMETIC_CATALOG, getCosmeticById } from '../src/shared/catalog';
import {
  ClientToServerEvents,
  DoorPermission,
  HostStatus,
  IdleActivity,
  KnockRequest,
  RoomPlayerState,
  ServerToClientEvents,
} from '../src/shared/types';
import { BOT_USER_ID, PocketStore } from './store';

const PORT = Number(process.env.PORT) || 3001;
const app = express();
app.use(cors());
app.use(express.json());

const store = new PocketStore();
const server = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const socketToUser = new Map<string, string>();
const userSockets = new Map<string, Set<string>>();
const knockTimers = new Map<string, NodeJS.Timeout>();

/**
 * 6.3. Sanitização e Limite de Chat:
 * Strip total de tags HTML/Scripts no backend antes do broadcast + slice(0, 80) rígido.
 */
function sanitizeChatText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]*>?/gm, '')
    .replace(/javascript:/gi, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 80);
}

function emitToUser<K extends keyof ServerToClientEvents>(
  userId: string,
  event: K,
  ...args: Parameters<ServerToClientEvents[K]>
) {
  io.to(`user:${userId}`).emit(event, ...args);
}

function broadcastRoomState(hostUserId: string) {
  const snapshot = store.buildRoomSnapshot(hostUserId);
  io.to(`room:${hostUserId}`).emit('room:state', snapshot);
}

function broadcastDirectory() {
  const dir = store.buildOnlineDirectory();
  io.emit('directory:online', dir);
}

function moveUserToRoom(userId: string, targetHostId: string, triggerSpawnFx = true): boolean {
  const user = store.getUserById(userId);
  const targetHost = store.getUserById(targetHostId);
  if (!user || !targetHost) return false;

  const targetRoom = store.ensureRoom(targetHostId);

  // 2.2 & 6.2. Capacidade da sala: máximo 5 avatares no total (4 visitantes + 1 Host)
  if (userId !== targetHostId && !targetRoom.players.has(userId)) {
    if (targetRoom.players.size >= 5) {
      return false;
    }
  }

  const prevHostId = store.userCurrentRoom.get(userId);
  if (prevHostId && prevHostId !== targetHostId) {
    const prevRoom = store.rooms.get(prevHostId);
    if (prevRoom) {
      if (prevHostId !== userId) {
        prevRoom.players.delete(userId);
      }
      broadcastRoomState(prevHostId);
    }
  }

  const sockets = userSockets.get(userId);
  if (sockets) {
    for (const sid of sockets) {
      const s = io.sockets.sockets.get(sid);
      if (s) {
        if (prevHostId && prevHostId !== targetHostId) {
          s.leave(`room:${prevHostId}`);
        }
        s.join(`room:${targetHostId}`);
      }
    }
  }

  // 6.1. Autoridade Total do Servidor sobre Cosméticos (carregado do Cache/Banco)
  const verifiedEquip = store.getVerifiedEquipped(userId);
  const spawnX = userId === targetHostId ? 120 : Math.floor(60 + Math.random() * 240);

  const playerState: RoomPlayerState = {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    isHost: userId === targetHostId,
    x: spawnX,
    targetX: spawnX,
    facing: spawnX > 180 ? 'left' : 'right',
    hostStatus: user.hostStatus,
    idleActivity: 'COFFEE',
    equipped: verifiedEquip,
    spawnFx: triggerSpawnFx
      ? {
          fxId: verifiedEquip.spawn_fx,
          startedAt: Date.now(),
        }
      : undefined,
    isBot: user.id === BOT_USER_ID,
  };

  targetRoom.players.set(userId, playerState);
  store.userCurrentRoom.set(userId, targetHostId);

  // 5.2. Broadcast de chegada de visitante (room:user_joined) com cosméticos reais do servidor
  if (userId !== targetHostId) {
    io.to(`room:${targetHostId}`).emit('room:user_joined', {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      x: spawnX,
      equippedCosmetics: {
        skin: verifiedEquip.avatar_body,
        spawnEffect: verifiedEquip.spawn_fx,
        chatBubble: verifiedEquip.chat_skin,
        head: verifiedEquip.avatar_head,
        back: verifiedEquip.avatar_back,
        throwable: verifiedEquip.throwable,
        deskDrop: verifiedEquip.desk_drop,
      },
    });

    targetHost.coins += 5;
    store.saveDB();
    emitToUser(targetHostId, 'auth:profile', targetHost);
    emitToUser(targetHostId, 'system:toast', {
      type: 'info',
      message: `✨ ${user.displayName} entrou no seu cantinho! (+5 🪙 de visita)`,
    });
  }

  broadcastRoomState(targetHostId);
  broadcastDirectory();
  return true;
}

import { spawn, ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
let desktopOverlayProcess: ChildProcess | null = null;

// ==========================================
// REST API
// ==========================================
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Pocket Corner Server',
    onlineCount: store.onlineUsers.size,
    desktopOverlayActive: Boolean(desktopOverlayProcess && !desktopOverlayProcess.killed),
  });
});

app.post('/api/desktop/toggle', (req, res) => {
  const { username } = (req.body || {}) as { username?: string };
  if (desktopOverlayProcess && !desktopOverlayProcess.killed) {
    desktopOverlayProcess.kill();
    desktopOverlayProcess = null;
    res.json({ active: false, message: 'Bonequinho transparente fechado.' });
    return;
  }

  if (process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL) {
    res.status(400).json({
      active: false,
      error:
        'No servidor online, use os botões "📺 PiP Sem Barra de Título" ou "📌 Canto Transparente (Aba)" direto no navegador!',
    });
    return;
  }

  try {
    const electronExePath = requireCjs('electron') as string;
    const mainScript = path.resolve(process.cwd(), 'electron', 'main.cjs');
    const userQuery = username ? `&user=${encodeURIComponent(username)}` : '';

    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    cleanEnv.POCKET_URL = `http://localhost:5174/?desktop=1${userQuery}`;

    desktopOverlayProcess = spawn(electronExePath, [mainScript], {
      cwd: process.cwd(),
      shell: false,
      env: cleanEnv,
      stdio: 'ignore',
    });

    desktopOverlayProcess.on('exit', () => {
      desktopOverlayProcess = null;
    });

    res.json({
      active: true,
      message: '👻 Bonequinho 100% transparente iniciado em cima da sua Barra de Tarefas!',
    });
  } catch (err) {
    res.status(500).json({ active: false, error: (err as Error).message });
  }
});

app.get('/api/catalog', (_req, res) => {
  res.json({ items: COSMETIC_CATALOG });
});

app.get('/api/auth/config', (_req, res) => {
  dotenv.config({ override: true });
  if (!store.isMongoConnected && !store.isMongoConnecting && process.env.MONGODB_URI?.trim()) {
    void store.initMongo(process.env.MONGODB_URI);
  }
  const googleClientId =
    (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  res.json({
    googleClientId,
    mongoConnected: store.isMongoConnected,
    mongoError: store.lastMongoError,
  });
});

app.post('/api/auth/google', async (req, res) => {
  const { credential } = (req.body || {}) as { credential?: string };
  if (!credential || !credential.trim()) {
    res.status(400).json({ error: 'Token do Google ausente.' });
    return;
  }

  try {
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential.trim())}`
    );
    if (!verifyRes.ok) {
      res.status(401).json({ error: 'Token do Google inválido ou expirado.' });
      return;
    }

    const tokenInfo = (await verifyRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      given_name?: string;
      picture?: string;
      aud?: string;
    };

    const expectedClientId = (
      process.env.GOOGLE_CLIENT_ID ||
      process.env.VITE_GOOGLE_CLIENT_ID ||
      ''
    ).trim();

    if (expectedClientId && tokenInfo.aud && tokenInfo.aud !== expectedClientId) {
      res.status(401).json({ error: 'Client ID do token não corresponde ao servidor.' });
      return;
    }

    if (!tokenInfo.sub) {
      res.status(401).json({ error: 'Identificador único da conta Google (sub) não encontrado.' });
      return;
    }

    const googleName =
      tokenInfo.name ||
      tokenInfo.given_name ||
      (tokenInfo.email ? tokenInfo.email.split('@')[0] : 'Jogador Google');

    const profile = store.getOrCreateGoogleUser({
      googleId: tokenInfo.sub,
      email: tokenInfo.email,
      googleName,
      picture: tokenInfo.picture,
    });

    res.json({ ok: true, profile });
  } catch (err) {
    console.error('[Google Auth] Erro ao validar token:', err);
    res.status(500).json({ error: 'Falha ao validar login com o Google.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, displayName } = req.body as { username?: string; displayName?: string };
  if (!username || !username.trim()) {
    res.status(400).json({ error: 'Informe um nome de usuário.' });
    return;
  }
  const profile = store.getOrCreateUser(username, displayName);
  res.json({ profile });
});

// ==========================================
// SOCKET.IO REALTIME PROTOCOL
// ==========================================
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  const rawGoogleId = String(socket.handshake.auth?.googleId || '').trim();
  const rawEmail = String(socket.handshake.auth?.email || '').trim();
  const rawGoogleName = String(socket.handshake.auth?.googleName || '').trim();
  const rawPicture = String(socket.handshake.auth?.picture || '').trim();
  const rawUsername = String(socket.handshake.auth?.username || 'jogador');
  const rawDisplayName = String(socket.handshake.auth?.displayName || rawUsername);

  const user = rawGoogleId
    ? store.getOrCreateGoogleUser({
        googleId: rawGoogleId,
        email: rawEmail || undefined,
        googleName: rawGoogleName || rawDisplayName || 'Jogador Google',
        picture: rawPicture || undefined,
      })
    : store.getOrCreateUser(rawUsername, rawDisplayName);
  const userId = user.id;

  // 6.1. No momento da conexão WebSocket, o servidor carrega do banco os itens equipados do usuário e salva na sessão do cache
  store.loadSessionCosmetics(userId);

  socketToUser.set(socket.id, userId);
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId)!.add(socket.id);
  store.onlineUsers.add(userId);

  socket.join(`user:${userId}`);

  store.ensureRoom(userId);
  const currentRoomHostId = store.userCurrentRoom.get(userId) || userId;
  socket.join(`room:${currentRoomHostId}`);

  socket.emit('auth:profile', user);
  broadcastRoomState(currentRoomHostId);
  broadcastDirectory();

  // ------------------------------------------
  // 0. Atualizar Nickname que aparece na sala (profile:update_nickname)
  // ------------------------------------------
  socket.on('profile:update_nickname', (rawPayload) => {
    const updated = store.updateUserNickname(userId, String(rawPayload?.displayName || ''));
    if (!updated) {
      socket.emit('system:toast', {
        type: 'warning',
        message: 'Informe um nickname válido (1 a 24 caracteres).',
      });
      return;
    }

    emitToUser(userId, 'auth:profile', updated);
    const activeHostId = store.userCurrentRoom.get(userId) || userId;
    broadcastRoomState(activeHostId);
    if (activeHostId !== userId) {
      broadcastRoomState(userId);
    }
    broadcastDirectory();
    socket.emit('system:toast', {
      type: 'success',
      message: `✨ Nickname na sala atualizado para "${updated.displayName}"!`,
    });
  });

  // ------------------------------------------
  // 1. Solicitar visita a um amigo (room:visit)
  // 6.2. Validação de Grafo Social (ACCEPTED) + DND + Capacidade < 5
  // 6.4. Rate Limiting: Cooldown de 5 segundos entre trocas de sala
  // ------------------------------------------
  socket.on('room:visit', (rawPayload) => {
    const targetUserId = String(rawPayload?.targetUserId || '');
    const inviteBypass = Boolean(rawPayload?.inviteBypass);

    const targetHost =
      store.getUserById(targetUserId) || store.findUserByUsernameOrId(targetUserId);
    if (!targetHost) {
      socket.emit('system:toast', {
        type: 'error',
        message: 'Usuário ou sala não encontrada.',
      });
      return;
    }

    // Returning to own room
    if (targetHost.id === userId) {
      moveUserToRoom(userId, userId, true);
      socket.emit('system:toast', {
        type: 'info',
        message: '🏠 Você voltou para o seu cantinho.',
      });
      return;
    }

    // 6.4. Cooldown de 5 segundos entre trocas de sala
    const rl = store.consumeRateLimitToken(userId, 'room:visit', 1, 5000);
    if (!rl.allowed) {
      socket.emit('system:toast', {
        type: 'warning',
        message: `⏳ Cooldown de visita: aguarde ${rl.waitSec}s antes de trocar de sala novamente.`,
      });
      return;
    }

    // Se veio por link direto de convite, estabelece amizade ACCEPTED automaticamente
    if (inviteBypass && !store.areFriendsAccepted(userId, targetHost.id)) {
      store.requestOrAcceptFriendship(userId, targetHost.id, true);
      const uUpdated = store.getUserById(userId);
      const tUpdated = store.getUserById(targetHost.id);
      if (uUpdated) socket.emit('auth:profile', uUpdated);
      if (tUpdated) emitToUser(targetHost.id, 'auth:profile', tUpdated);
    }

    // 6.2. Validação de Grafo Social (Anti-Invasão): exige amizade ACCEPTED
    if (!store.areFriendsAccepted(userId, targetHost.id)) {
      const reqRes = store.requestOrAcceptFriendship(userId, targetHost.id, false);
      const uUpdated = store.getUserById(userId);
      const tUpdated = store.getUserById(targetHost.id);
      if (uUpdated) socket.emit('auth:profile', uUpdated);
      if (tUpdated) emitToUser(targetHost.id, 'auth:profile', tUpdated);

      if (reqRes.status === 'PENDING') {
        emitToUser(targetHost.id, 'system:toast', {
          type: 'info',
          message: `🤝 ${user.displayName} (@${user.username}) quer visitar você! Aceite o pedido de amizade na aba Salas & Amigos.`,
        });
        socket.emit('system:toast', {
          type: 'warning',
          message: `🛡️ Anti-Invasão: relação de amizade ACCEPTED necessária! Enviamos um pedido de amizade para ${targetHost.displayName}.`,
        });
        return;
      }
    }

    // 6.2. Verifica se o status do Host não está como DND
    if (targetHost.hostStatus === 'DND') {
      socket.emit('system:toast', {
        type: 'warning',
        message: `🔒 ${targetHost.displayName} está em Não Perturbe (DND). Você pode deixar um Presente AFK na caixa de correio!`,
      });
      return;
    }

    const targetRoom = store.ensureRoom(targetHost.id);
    // 6.2. Verifica se a sala não está lotada (count >= 5)
    if (targetRoom.players.size >= 5 && !targetRoom.players.has(userId)) {
      socket.emit('system:toast', {
        type: 'warning',
        message: `Cantinho de ${targetHost.displayName} está lotado (5/5 avatares)!`,
      });
      return;
    }

    if (targetHost.doorPermission === 'OPEN' || targetHost.id === BOT_USER_ID) {
      moveUserToRoom(userId, targetHost.id, true);
      socket.emit('system:toast', {
        type: 'success',
        message: `🚀 Você invadiu o cantinho de ${targetHost.displayName}!`,
      });
    } else {
      const knockId = `knock_${userId}_${targetHost.id}`;
      if (targetRoom.pendingKnocks.has(knockId)) {
        socket.emit('system:toast', {
          type: 'info',
          message: `🔔 Você já bateu na porta de ${targetHost.displayName}. Aguarde...`,
        });
        return;
      }

      const knockReq: KnockRequest = {
        id: knockId,
        visitorUserId: user.id,
        visitorUsername: user.username,
        visitorDisplayName: user.displayName,
        visitorEquipped: store.getVerifiedEquipped(user.id),
        targetHostId: targetHost.id,
        expiresAt: Date.now() + 30_000,
      };

      targetRoom.pendingKnocks.set(knockId, knockReq);
      emitToUser(targetHost.id, 'room:knock_alert', knockReq);
      broadcastRoomState(targetHost.id);

      socket.emit('system:toast', {
        type: 'info',
        message: `🔔 Toc-toc! Você está espiando na janela de ${targetHost.displayName} (30s)...`,
      });

      const existingTimer = knockTimers.get(knockId);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        const r = store.rooms.get(targetHost.id);
        if (r && r.pendingKnocks.has(knockId)) {
          r.pendingKnocks.delete(knockId);
          broadcastRoomState(targetHost.id);
          emitToUser(userId, 'room:knock_result', {
            targetHostId: targetHost.id,
            hostDisplayName: targetHost.displayName,
            accepted: false,
            reason: 'Tempo esgotado (30s sem resposta).',
          });
        }
        knockTimers.delete(knockId);
      }, 30_000);

      knockTimers.set(knockId, timer);
    }
  });

  socket.on('room:leave_visit', () => {
    moveUserToRoom(userId, userId, true);
    socket.emit('system:toast', {
      type: 'info',
      message: '🏠 Você voltou para o seu cantinho.',
    });
  });

  // ------------------------------------------
  // 6.5. Botão de Pânico ("Expulsar / Fechar Cortina" — room:kick_all)
  // Desconecta instantaneamente todos os visitantes da sala do Host e muda para DND
  // ------------------------------------------
  socket.on('room:kick_all', () => {
    const u = store.getUserById(userId);
    if (!u) return;

    u.hostStatus = 'DND';
    store.saveDB();

    const myRoom = store.ensureRoom(userId);
    const hostPlayer = myRoom.players.get(userId);
    if (hostPlayer) {
      hostPlayer.hostStatus = 'DND';
    }

    // Clear all pending knocks
    for (const [kId, knock] of myRoom.pendingKnocks.entries()) {
      const t = knockTimers.get(kId);
      if (t) clearTimeout(t);
      knockTimers.delete(kId);
      emitToUser(knock.visitorUserId, 'room:knock_result', {
        targetHostId: userId,
        hostDisplayName: u.displayName,
        accepted: false,
        reason: 'O Host fechou a cortina (Modo DND ativado).',
      });
    }
    myRoom.pendingKnocks.clear();

    // Expel all visitors back to their own rooms immediately
    let kickedCount = 0;
    for (const pid of Array.from(myRoom.players.keys())) {
      if (pid !== userId) {
        kickedCount++;
        if (pid === BOT_USER_ID) {
          myRoom.players.delete(BOT_USER_ID);
        } else {
          moveUserToRoom(pid, pid, false);
          emitToUser(pid, 'system:toast', {
            type: 'warning',
            message: `🚨 ${u.displayName} fechou a cortina (Botão de Pânico / DND). Você voltou para o seu cantinho.`,
          });
        }
      }
    }

    // If Host was visiting someone else, bring Host home too
    if (store.userCurrentRoom.get(userId) !== userId) {
      moveUserToRoom(userId, userId, false);
    }

    socket.emit('auth:profile', u);
    broadcastRoomState(userId);
    broadcastDirectory();

    socket.emit('system:toast', {
      type: 'warning',
      message: `🚨 Cortina fechada! Status alterado para DND e ${kickedCount} visitante(s) expulso(s).`,
    });
  });

  // ------------------------------------------
  // Expulsar um amigo/visitante específico da sua sala (sem fechar a cortina para os demais)
  // ------------------------------------------
  socket.on('room:kick_visitor', ({ targetUserId }) => {
    const u = store.getUserById(userId);
    if (!u || !targetUserId || targetUserId === userId) return;

    const myRoom = store.ensureRoom(userId);
    const visitorPlayer = myRoom.players.get(targetUserId);
    if (!visitorPlayer) {
      socket.emit('system:toast', {
        type: 'warning',
        message: 'Esse visitante não está na sua sala no momento.',
      });
      return;
    }

    const visitorName = visitorPlayer.displayName || 'Visitante';

    if (targetUserId === BOT_USER_ID) {
      myRoom.players.delete(BOT_USER_ID);
    } else {
      moveUserToRoom(targetUserId, targetUserId, false);
      emitToUser(targetUserId, 'system:toast', {
        type: 'warning',
        message: `👢 ${u.displayName} expulsou você da sala. Você voltou para o seu cantinho!`,
      });
    }

    broadcastRoomState(userId);
    broadcastDirectory();

    socket.emit('system:toast', {
      type: 'info',
      message: `👢 Você expulsou ${visitorName} da sua sala!`,
    });
  });

  socket.on('room:knock_respond', ({ knockId, accept }) => {
    const myRoom = store.ensureRoom(userId);
    const knock = myRoom.pendingKnocks.get(knockId);
    if (!knock) return;

    myRoom.pendingKnocks.delete(knockId);
    const timer = knockTimers.get(knockId);
    if (timer) {
      clearTimeout(timer);
      knockTimers.delete(knockId);
    }

    if (accept) {
      if (knock.visitorUserId === BOT_USER_ID) {
        triggerBotEnterRoom(userId);
      } else {
        const joined = moveUserToRoom(knock.visitorUserId, userId, true);
        emitToUser(knock.visitorUserId, 'room:knock_result', {
          targetHostId: userId,
          hostDisplayName: user.displayName,
          accepted: joined,
          reason: joined ? undefined : 'A sala ficou cheia.',
        });
      }
    } else {
      emitToUser(knock.visitorUserId, 'room:knock_result', {
        targetHostId: userId,
        hostDisplayName: user.displayName,
        accepted: false,
        reason: 'O Host não pôde atender agora.',
      });
    }

    broadcastRoomState(userId);
  });

  // ------------------------------------------
  // Configurações de Estado e Porta do Host
  // ------------------------------------------
  socket.on('host:set_status', ({ status, idleActivity }) => {
    const validStatuses: HostStatus[] = ['IDLE', 'ACTIVE', 'DND'];
    if (!validStatuses.includes(status)) return;

    const u = store.getUserById(userId);
    if (!u) return;
    u.hostStatus = status;

    const myRoom = store.ensureRoom(userId);
    const hostPlayer = myRoom.players.get(userId);
    if (hostPlayer) {
      hostPlayer.hostStatus = status;
      if (idleActivity) {
        hostPlayer.idleActivity = idleActivity;
      } else if (status === 'IDLE') {
        const activities: IdleActivity[] = ['COFFEE', 'TYPING', 'SLEEPING', 'FISHING'];
        hostPlayer.idleActivity = activities[Math.floor(Math.random() * activities.length)];
      }
    }

    if (status === 'DND') {
      for (const pid of Array.from(myRoom.players.keys())) {
        if (pid !== userId) {
          if (pid === BOT_USER_ID) {
            myRoom.players.delete(BOT_USER_ID);
          } else {
            moveUserToRoom(pid, pid, false);
            emitToUser(pid, 'system:toast', {
              type: 'info',
              message: `🔒 ${u.displayName} ativou o modo Não Perturbe (DND).`,
            });
          }
        }
      }
    }

    const currentHostId = store.userCurrentRoom.get(userId) || userId;
    const currentRoom = store.rooms.get(currentHostId);
    const inCurrent = currentRoom?.players.get(userId);
    if (inCurrent) {
      inCurrent.hostStatus = status;
      if (idleActivity) inCurrent.idleActivity = idleActivity;
    }

    store.saveDB();
    socket.emit('auth:profile', u);
    broadcastRoomState(userId);
    if (currentHostId !== userId) broadcastRoomState(currentHostId);
    broadcastDirectory();
  });

  socket.on('host:set_door', ({ doorPermission }) => {
    const validDoors: DoorPermission[] = ['OPEN', 'KNOCK'];
    if (!validDoors.includes(doorPermission)) return;

    const u = store.getUserById(userId);
    if (!u) return;
    u.doorPermission = doorPermission;
    store.saveDB();

    socket.emit('auth:profile', u);
    broadcastRoomState(userId);
    broadcastDirectory();
  });

  // ------------------------------------------
  // 2. Mover avatar no eixo X
  // 6.4. Rate Limiting: Máximo 10 pacotes/seg; targetX < 0 ou > 360 são descartados!
  // ------------------------------------------
  socket.on('player:move', (rawPayload) => {
    const rl = store.consumeRateLimitToken(userId, 'player:move', 10, 100);
    if (!rl.allowed) return;

    const numX = Number(rawPayload?.targetX);
    // 6.4. Coordenadas targetX fora do limite < 0 ou > 360 são descartadas
    if (!Number.isFinite(numX) || numX < 0 || numX > 360) {
      return;
    }

    const safeX = Math.max(20, Math.min(340, Math.round(numX)));
    const hostId = store.userCurrentRoom.get(userId) || userId;
    const room = store.ensureRoom(hostId);
    const p = room.players.get(userId);
    if (!p) return;

    p.facing = safeX < p.x ? 'left' : 'right';
    p.x = safeX;
    p.targetX = safeX;

    io.to(`room:${hostId}`).emit('room:player_moved', {
      userId,
      targetX: safeX,
      facing: p.facing,
    });
  });

  socket.on('player:jump', () => {
    const rl = store.consumeRateLimitToken(userId, 'player:jump', 3, 350);
    if (!rl.allowed) return;
    const hostId = store.userCurrentRoom.get(userId) || userId;
    io.to(`room:${hostId}`).emit('room:player_jumped', { userId });
  });

  // ------------------------------------------
  // 3. Enviar mensagem de balão
  // 6.3. Strip total de tags HTML/Scripts + slice(0, 80) rígido
  // 6.4. Rate Limiting: Máximo de 1 mensagem a cada 2 segundos
  // ------------------------------------------
  socket.on('player:chat', (rawPayload) => {
    const rl = store.consumeRateLimitToken(userId, 'player:chat', 1, 2000);
    if (!rl.allowed) {
      socket.emit('system:toast', {
        type: 'warning',
        message: `⏳ Rate limit de chat: aguarde ${rl.waitSec}s (máx 1 mensagem a cada 2s).`,
      });
      return;
    }

    const cleanText = sanitizeChatText(rawPayload?.text);
    if (!cleanText) return;

    const hostId = store.userCurrentRoom.get(userId) || userId;
    const room = store.ensureRoom(hostId);
    const p = room.players.get(userId);
    if (!p) return;

    // 6.1. Cosmético de balão carregado exclusivamente do cache/banco do servidor
    const verifiedEquip = store.getVerifiedEquipped(userId);
    const expiresAt = Date.now() + 6000;

    p.chatBubble = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: cleanText,
      skinId: verifiedEquip.chat_skin,
      expiresAt,
    };

    io.to(`room:${hostId}`).emit('room:chat_message', {
      userId,
      displayName: p.displayName,
      text: cleanText,
      skinId: verifiedEquip.chat_skin,
      expiresAt,
    });
    broadcastRoomState(hostId);
  });

  // ------------------------------------------
  // 4. Interagir / Jogar objeto / Presente AFK
  // 6.4. Rate Limiting: Máximo de 1 ação a cada 3 segundos
  // ------------------------------------------
  socket.on('player:interact', (rawPayload) => {
    const rl = store.consumeRateLimitToken(userId, 'player:interact', 1, 3000);
    if (!rl.allowed) {
      socket.emit('system:toast', {
        type: 'warning',
        message: `⏳ Cooldown de interação: aguarde ${rl.waitSec}s (máx 1 ação a cada 3s).`,
      });
      return;
    }

    const { targetUserId, actionType, itemId, emote, note, dropX } = rawPayload || {};
    const hostId = store.userCurrentRoom.get(userId) || userId;
    const room = store.ensureRoom(hostId);
    const senderPlayer = room.players.get(userId);

    // 6.1. Cosméticos sempre vindos da sessão autenticada no servidor
    const verifiedEquip = store.getVerifiedEquipped(userId);

    if (actionType === 'DESK_DROP') {
      const dropHostId = targetUserId || hostId;
      const dropHost = store.getUserById(dropHostId);
      if (!dropHost) return;

      const requestedDropId = itemId || verifiedEquip.desk_drop;
      if (!store.verifyOwnership(userId, requestedDropId)) {
        socket.emit('system:toast', {
          type: 'error',
          message: 'Verificação do servidor: você não possui este presente no inventário!',
        });
        return;
      }

      const cosmetic = getCosmeticById(requestedDropId);
      if (!cosmetic || cosmetic.category !== 'desk_drop') return;

      const finalX = Math.max(40, Math.min(320, Math.round(dropX ?? 70 + Math.random() * 220)));

      store.addDeskDrop(
        {
          id: `drop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          itemId: requestedDropId,
          fromUserId: userId,
          fromDisplayName: user.displayName,
          x: finalX,
          note: note ? sanitizeChatText(note).slice(0, 60) : undefined,
          createdAt: Date.now(),
        },
        dropHostId
      );

      broadcastRoomState(dropHostId);
      socket.emit('system:toast', {
        type: 'success',
        message: `${cosmetic.icon} Você deixou "${cosmetic.name}" no cantinho de ${dropHost.displayName}!`,
      });
      if (dropHostId !== userId) {
        emitToUser(dropHostId, 'system:toast', {
          type: 'info',
          message: `🎁 ${user.displayName} deixou um ${cosmetic.name} no chão do seu cantinho! Clique nele!`,
        });
      }
      return;
    }

    if (!senderPlayer) return;
    const targetPlayer =
      room.players.get(targetUserId) ||
      Array.from(room.players.values()).find((pl) => pl.userId !== userId) ||
      senderPlayer;

    if (actionType === 'POKE') {
      io.to(`room:${hostId}`).emit('room:interaction_fx', {
        fromUserId: userId,
        fromDisplayName: senderPlayer.displayName,
        targetUserId: targetPlayer.userId,
        actionType: 'POKE',
        fromX: senderPlayer.x,
        toX: targetPlayer.x,
      });
      io.to(`room:${hostId}`).emit('room:player_jumped', { userId: targetPlayer.userId });
    } else if (actionType === 'THROW_ITEM') {
      const requestedThrowId = itemId || verifiedEquip.throwable;
      if (!store.verifyOwnership(userId, requestedThrowId)) {
        socket.emit('system:toast', {
          type: 'error',
          message: 'Verificação do servidor: você não possui este brinquedo arremessável!',
        });
        return;
      }

      io.to(`room:${hostId}`).emit('room:interaction_fx', {
        fromUserId: userId,
        fromDisplayName: senderPlayer.displayName,
        targetUserId: targetPlayer.userId,
        actionType: 'THROW_ITEM',
        verifiedItemId: requestedThrowId,
        fromX: senderPlayer.x,
        toX: targetPlayer.x,
      });
    } else if (actionType === 'SYNC_EMOTE') {
      const chosenEmote = sanitizeChatText(emote || '🎵').slice(0, 8) || '🎵';
      const expiresAt = Date.now() + 4500;
      for (const p of room.players.values()) {
        p.activeEmote = { emote: chosenEmote, expiresAt };
      }
      io.to(`room:${hostId}`).emit('room:interaction_fx', {
        fromUserId: userId,
        fromDisplayName: senderPlayer.displayName,
        targetUserId: targetPlayer.userId,
        actionType: 'SYNC_EMOTE',
        emote: chosenEmote,
        fromX: senderPlayer.x,
        toX: targetPlayer.x,
      });
      broadcastRoomState(hostId);
    }
  });

  // ------------------------------------------
  // Coletar Presente de Mesa (Desk Drop)
  // ------------------------------------------
  socket.on('desk_drop:claim', ({ dropId }) => {
    const currentHostId = store.userCurrentRoom.get(userId) || userId;
    if (currentHostId !== userId) {
      socket.emit('system:toast', {
        type: 'warning',
        message: 'Apenas o dono do cantinho (Host) pode recolher os presentes do chão!',
      });
      return;
    }

    const result = store.claimDeskDrop(userId, dropId);
    if (!result.ok || !result.drop || !result.item) return;

    const updatedUser = store.getUserById(userId)!;
    socket.emit('auth:profile', updatedUser);

    io.to(`room:${userId}`).emit('room:desk_drop_claimed', {
      dropId,
      itemId: result.item.id,
      claimedByUserId: userId,
      speedBoostSec: result.item.meta?.speedBoostSec,
      bonusCoins: result.item.meta?.bonusCoins ?? 10,
      note: result.drop.note,
    });

    const boostMsg = result.item.meta?.speedBoostSec
      ? ` + Velocidade 2x por ${result.item.meta.speedBoostSec}s!`
      : '';
    const noteMsg = result.drop.note ? ` Recado: "${result.drop.note}"` : '';

    socket.emit('system:toast', {
      type: 'success',
      message: `${result.item.icon} Coletou ${result.item.name} de ${result.drop.fromDisplayName}! (+${result.item.meta?.bonusCoins ?? 10} 🪙${boostMsg})${noteMsg}`,
    });

    broadcastRoomState(userId);
  });

  // ------------------------------------------
  // Mobiliar Cenário (Posicionar, Mover, Virar e Remover Móveis)
  // ------------------------------------------
  socket.on('furniture:place', ({ itemId, x }) => {
    const res = store.placeFurniture(userId, itemId, x);
    const updated = store.getUserById(userId);
    if (updated) socket.emit('auth:profile', updated);
    socket.emit('system:toast', {
      type: res.ok ? 'success' : 'warning',
      message: res.message,
    });
    broadcastRoomState(userId);
  });

  socket.on('furniture:move', ({ instanceId, x }) => {
    const rl = store.consumeRateLimitToken(userId, 'furniture:move', 15, 65);
    if (!rl.allowed) return;
    if (store.moveFurniture(userId, instanceId, x)) {
      const updated = store.getUserById(userId);
      if (updated) socket.emit('auth:profile', updated);
      broadcastRoomState(userId);
    }
  });

  socket.on('furniture:flip', ({ instanceId }) => {
    if (store.flipFurniture(userId, instanceId)) {
      const updated = store.getUserById(userId);
      if (updated) socket.emit('auth:profile', updated);
      broadcastRoomState(userId);
    }
  });

  socket.on('furniture:color', ({ instanceId, colorVariant }) => {
    if (store.setFurnitureColor(userId, instanceId, colorVariant)) {
      const updated = store.getUserById(userId);
      if (updated) socket.emit('auth:profile', updated);
      broadcastRoomState(userId);
    }
  });

  socket.on('furniture:remove', ({ instanceId }) => {
    if (store.removeFurniture(userId, instanceId)) {
      const updated = store.getUserById(userId);
      if (updated) socket.emit('auth:profile', updated);
      socket.emit('system:toast', {
        type: 'info',
        message: '📦 Móvel guardado de volta na sua Mochila!',
      });
      broadcastRoomState(userId);
    }
  });

  // ------------------------------------------
  // Economia & Inventário (Validados no Servidor)
  // ------------------------------------------
  socket.on('inventory:equip', ({ itemId }) => {
    const res = store.equipItem(userId, itemId);
    const updated = store.getUserById(userId);
    if (updated) socket.emit('auth:profile', updated);
    socket.emit('system:toast', {
      type: res.ok ? 'success' : 'error',
      message: res.message,
    });

    const hostId = store.userCurrentRoom.get(userId) || userId;
    broadcastRoomState(hostId);
    if (hostId !== userId) broadcastRoomState(userId);
    broadcastDirectory();
  });

  socket.on('shop:buy', ({ itemId }) => {
    const res = store.buyItem(userId, itemId);
    const updated = store.getUserById(userId);
    if (updated) socket.emit('auth:profile', updated);
    socket.emit('system:toast', {
      type: res.ok ? 'success' : 'error',
      message: res.message,
    });

    const hostId = store.userCurrentRoom.get(userId) || userId;
    broadcastRoomState(hostId);
    broadcastDirectory();
  });

  socket.on('shop:gachapon', () => {
    const res = store.rollGachapon(userId);
    const updated = store.getUserById(userId);
    if (updated) socket.emit('auth:profile', updated);

    if (res.ok && res.item) {
      socket.emit('shop:gachapon_result', {
        item: res.item,
        isDuplicate: Boolean(res.isDuplicate),
        refundCoins: res.refundCoins || 0,
      });
    } else {
      socket.emit('system:toast', {
        type: 'warning',
        message: res.message,
      });
    }
  });

  socket.on('economy:claim_starter_pack', () => {
    const rl = store.consumeRateLimitToken(userId, 'economy:starter', 1, 4000);
    if (!rl.allowed) return;
    const u = store.getUserById(userId);
    if (!u) return;
    u.coins += 300;
    u.gems += 250;
    store.saveDB();
    socket.emit('auth:profile', u);
    socket.emit('system:toast', {
      type: 'success',
      message: '🎁 Pacote de Suprimentos recebido: +300 🪙 Moedas Idle e +250 💎 Gems!',
    });
  });

  // ------------------------------------------
  // 6.2. Grafo Social de Amizade (PENDING -> ACCEPTED)
  // ------------------------------------------
  socket.on('friends:add', ({ usernameOrId }) => {
    const target = store.findUserByUsernameOrId(usernameOrId);
    const u = store.getUserById(userId);
    if (!u || !target) {
      socket.emit('system:toast', {
        type: 'error',
        message: 'Usuário não encontrado com esse @username ou ID.',
      });
      return;
    }
    if (target.id === userId) {
      socket.emit('system:toast', {
        type: 'warning',
        message: 'Você não precisa adicionar a si mesmo!',
      });
      return;
    }

    const res = store.requestOrAcceptFriendship(userId, target.id, false);
    socket.emit('auth:profile', store.getUserById(userId)!);
    emitToUser(target.id, 'auth:profile', store.getUserById(target.id)!);

    socket.emit('system:toast', {
      type: res.status === 'ERROR' ? 'error' : 'success',
      message: res.message,
    });

    if (res.status === 'PENDING') {
      emitToUser(target.id, 'system:toast', {
        type: 'info',
        message: `📨 ${u.displayName} (@${u.username}) enviou um pedido de amizade! Aceite na aba Salas & Amigos.`,
      });
    } else if (res.status === 'ACCEPTED') {
      emitToUser(target.id, 'system:toast', {
        type: 'success',
        message: `🤝 ${u.displayName} (@${u.username}) e você agora são amigos (ACCEPTED)!`,
      });
    }
    broadcastDirectory();
  });

  socket.on('friends:respond', ({ requesterUserId, accept }) => {
    const res = store.respondFriendship(userId, requesterUserId, accept);
    const u = store.getUserById(userId);
    const reqUser = store.getUserById(requesterUserId);
    if (u) socket.emit('auth:profile', u);
    if (reqUser) {
      emitToUser(requesterUserId, 'auth:profile', reqUser);
      emitToUser(requesterUserId, 'system:toast', {
        type: accept ? 'success' : 'info',
        message: accept
          ? `🤝 ${u?.displayName} aceitou seu pedido de amizade (ACCEPTED)! Já pode visitar o cantinho!`
          : `${u?.displayName} recusou o pedido de amizade.`,
      });
    }
    socket.emit('system:toast', {
      type: res.ok ? 'success' : 'error',
      message: res.message,
    });
    broadcastDirectory();
  });

  // ------------------------------------------
  // Simulador de Visita do Bot Amigo (Pipoca)
  // ------------------------------------------
  socket.on('bot:summon_visit', () => {
    const u = store.getUserById(userId);
    const bot = store.getUserById(BOT_USER_ID);
    if (!u || !bot) return;

    if (u.hostStatus === 'DND') {
      store.addDeskDrop(
        {
          id: `drop_bot_${Date.now()}`,
          itemId: 'drop_birthday_cake',
          fromUserId: BOT_USER_ID,
          fromDisplayName: bot.displayName,
          x: Math.floor(80 + Math.random() * 200),
          note: 'Vi que você estava em DND, deixei um bolo na caixa de correio! 🎂',
          createdAt: Date.now(),
        },
        userId
      );
      broadcastRoomState(userId);
      socket.emit('system:toast', {
        type: 'info',
        message: '📫 Pipoca viu que você está em DND e deixou um Bolo de Aniversário na sua sala!',
      });
      return;
    }

    const myRoom = store.ensureRoom(userId);
    if (u.doorPermission === 'KNOCK' && !myRoom.players.has(BOT_USER_ID)) {
      const knockId = `knock_${BOT_USER_ID}_${userId}`;
      const knockReq: KnockRequest = {
        id: knockId,
        visitorUserId: bot.id,
        visitorUsername: bot.username,
        visitorDisplayName: bot.displayName,
        visitorEquipped: store.getVerifiedEquipped(bot.id),
        targetHostId: userId,
        expiresAt: Date.now() + 30_000,
      };
      myRoom.pendingKnocks.set(knockId, knockReq);
      emitToUser(userId, 'room:knock_alert', knockReq);
      broadcastRoomState(userId);
      return;
    }

    triggerBotEnterRoom(userId);
  });

  socket.on('disconnect', () => {
    socketToUser.delete(socket.id);
    const set = userSockets.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        userSockets.delete(userId);
        store.onlineUsers.delete(userId);
        store.sessionCosmeticsCache.delete(userId);
        const currentHostId = store.userCurrentRoom.get(userId);
        if (currentHostId && currentHostId !== userId) {
          const r = store.rooms.get(currentHostId);
          r?.players.delete(userId);
          broadcastRoomState(currentHostId);
        }
        store.userCurrentRoom.set(userId, userId);
        broadcastDirectory();
      }
    }
  });
});

function triggerBotEnterRoom(hostUserId: string) {
  const bot = store.getUserById(BOT_USER_ID);
  if (!bot) return;
  const room = store.ensureRoom(hostUserId);
  const botEquip = store.getVerifiedEquipped(BOT_USER_ID);

  const spawnX = Math.floor(70 + Math.random() * 200);
  room.players.set(BOT_USER_ID, {
    userId: bot.id,
    username: bot.username,
    displayName: bot.displayName,
    isHost: false,
    x: spawnX,
    targetX: spawnX,
    facing: spawnX > 180 ? 'left' : 'right',
    hostStatus: 'ACTIVE',
    idleActivity: 'COFFEE',
    equipped: botEquip,
    spawnFx: {
      fxId: 'fx_parachute',
      startedAt: Date.now(),
    },
    isBot: true,
  });

  // 5.2. Emitir room:user_joined no broadcast
  io.to(`room:${hostUserId}`).emit('room:user_joined', {
    userId: bot.id,
    username: bot.username,
    displayName: bot.displayName,
    x: spawnX,
    equippedCosmetics: {
      skin: botEquip.avatar_body,
      spawnEffect: botEquip.spawn_fx,
      chatBubble: botEquip.chat_skin,
      head: botEquip.avatar_head,
      back: botEquip.avatar_back,
      throwable: botEquip.throwable,
      deskDrop: botEquip.desk_drop,
    },
  });

  broadcastRoomState(hostUserId);

  setTimeout(() => {
    const r = store.rooms.get(hostUserId);
    const bp = r?.players.get(BOT_USER_ID);
    if (!r || !bp) return;
    const phrases = [
      'Pruu! Vim trazer café quentinho pro seu cantinho! ☕',
      'Que cantinho aconchegante! Bora focar no código? 💻',
      'Passei para dar um salve e jogar um aviãozinho! ✈️',
      'Olha meu paraquedas novo! Como estão os projetos hoje?',
    ];
    const text = phrases[Math.floor(Math.random() * phrases.length)];
    const expiresAt = Date.now() + 6000;
    bp.chatBubble = {
      id: `bot_msg_${Date.now()}`,
      text,
      skinId: bp.equipped.chat_skin,
      expiresAt,
    };
    io.to(`room:${hostUserId}`).emit('room:chat_message', {
      userId: BOT_USER_ID,
      displayName: bp.displayName,
      text,
      skinId: bp.equipped.chat_skin,
      expiresAt,
    });
    broadcastRoomState(hostUserId);
  }, 1200);

  setTimeout(() => {
    const r = store.rooms.get(hostUserId);
    const bp = r?.players.get(BOT_USER_ID);
    const hp = r?.players.get(hostUserId);
    if (!r || !bp || !hp) return;

    const newX = Math.max(45, Math.min(310, hp.x + (Math.random() > 0.5 ? 70 : -70)));
    bp.facing = newX < bp.x ? 'left' : 'right';
    bp.x = newX;
    bp.targetX = newX;
    io.to(`room:${hostUserId}`).emit('room:player_moved', {
      userId: BOT_USER_ID,
      targetX: newX,
      facing: bp.facing,
    });

    io.to(`room:${hostUserId}`).emit('room:interaction_fx', {
      fromUserId: BOT_USER_ID,
      fromDisplayName: bp.displayName,
      targetUserId: hostUserId,
      actionType: 'THROW_ITEM',
      verifiedItemId: 'throw_gold_plane',
      fromX: bp.x,
      toX: hp.x,
    });

    store.addDeskDrop(
      {
        id: `drop_bot_${Date.now()}`,
        itemId: 'drop_coffee',
        fromUserId: BOT_USER_ID,
        fromDisplayName: bp.displayName,
        x: Math.max(50, Math.min(310, bp.x)),
        note: 'Expresso duplo deixado pelo Pipoca! ☕⚡',
        createdAt: Date.now(),
      },
      hostUserId
    );
    broadcastRoomState(hostUserId);
  }, 3200);
}

// ==========================================
// PASSIVE IDLE CURRENCY TICK (3.3 Moeda Idle)
// ==========================================
setInterval(() => {
  for (const userId of store.onlineUsers) {
    if (userId === BOT_USER_ID) continue;
    const u = store.getUserById(userId);
    if (!u) continue;

    const room = store.rooms.get(userId);
    let visitorBonus = 0;
    if (room) {
      for (const pid of room.players.keys()) {
        if (pid !== userId) visitorBonus += 2;
      }
    }

    u.coins += 3 + visitorBonus;
    emitToUser(userId, 'auth:profile', u);
  }
  store.saveDB();
}, 15_000);

const distPath = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ [Pocket Corner Server] Rodando em http://localhost:${PORT}`);
  void store.initMongo(process.env.MONGODB_URI);
});
