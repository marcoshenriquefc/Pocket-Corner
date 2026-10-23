import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import cors from 'cors';
import { Server, Socket } from 'socket.io';
import {
  COSMETIC_CATALOG,
  REAL_MONEY_PACKAGES,
  getCosmeticById,
  getRealMoneyPackageById,
} from '../src/shared/catalog';
import {
  ClientToServerEvents,
  DoorPermission,
  HostStatus,
  IdleActivity,
  KnockRequest,
  RoomPlayerState,
  ServerToClientEvents,
  UserProfile,
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

  const prevHostId = store.userCurrentRoom.get(userId) || userId;
  store.userCurrentRoom.set(userId, targetHostId);

  if (prevHostId && prevHostId !== targetHostId) {
    const prevRoom = store.rooms.get(prevHostId);
    if (prevRoom) {
      prevRoom.players.delete(userId);
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
    workStatus: user.workStatus || '',
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

    emitToUser(targetHostId, 'system:toast', {
      type: 'info',
      message: `✨ ${user.displayName} entrou no seu cantinho!`,
    });
  }

  broadcastRoomState(targetHostId);
  broadcastDirectory();
  return true;
}

// ==========================================
// AUTENTICAÇÃO CRIPTOGRÁFICA DE SESSÃO (SERVIDOR)
// NUNCA CONFIAR NO FRONTEND!
// ==========================================
function getServerSessionSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.MONGODB_URI ||
    process.env.GOOGLE_CLIENT_ID ||
    'pocket_corner_hmac_server_secret_2026'
  ).trim();
}

function issueServerSessionToken(user: UserProfile): string {
  const payload = JSON.stringify({
    uid: user.id,
    gid: user.googleId || '',
    email: (user.email || '').toLowerCase(),
    iat: Date.now(),
  });
  const payloadB64 = Buffer.from(payload, 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getServerSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifyServerSessionToken(token?: string): UserProfile | null {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getServerSessionSecret())
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      uid?: string;
      gid?: string;
    };
    if (!parsed.uid) return null;
    const user = store.getUserById(parsed.uid);
    if (!user) return null;
    if (parsed.gid && user.googleId && parsed.gid !== user.googleId) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Resolve o usuário autenticado a partir do token HMAC assinado pelo servidor
 * ou verificando a identidade Google registrada no banco do servidor.
 */
function resolveAuthenticatedRequestUser(req: express.Request): UserProfile | null {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const verified = verifyServerSessionToken(token);
    if (verified) return verified;
  }

  const headerUserId = String(req.headers['x-user-id'] || '').trim();
  const headerGoogleId = String(req.headers['x-google-id'] || '').trim();
  if (headerUserId && headerGoogleId) {
    const user = store.getUserById(headerUserId);
    if (user && user.googleId && user.googleId === headerGoogleId) {
      return user;
    }
  }

  return null;
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
  res.json({ items: COSMETIC_CATALOG, packages: REAL_MONEY_PACKAGES });
});

app.get('/api/auth/config', (_req, res) => {
  dotenv.config({ override: true });
  if (!store.isMongoConnected && !store.isMongoConnecting && process.env.MONGODB_URI?.trim()) {
    void store.initMongo(process.env.MONGODB_URI);
  }
  const googleClientId =
    (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const mercadoPagoConfigured = Boolean((process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim());
  res.json({
    googleClientId,
    mongoConnected: store.isMongoConnected,
    mongoError: store.lastMongoError,
    mercadoPagoConfigured,
  });
});

app.post('/api/auth/google', async (req, res) => {
  dotenv.config({ override: true });
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

    const sessionToken = issueServerSessionToken(profile);
    res.json({ ok: true, profile, sessionToken });
  } catch (err) {
    console.error('[Google Auth] Erro ao validar token:', err);
    res.status(500).json({ error: 'Falha ao validar login com o Google.' });
  }
});

// ==========================================
// MERCADO PAGO PIX - PAGAMENTOS EM DINHEIRO REAL
// Preços e pacotes validados 100% no servidor!
// ==========================================
async function verifyAndFulfillMercadoPagoPayment(
  mpPaymentId: string,
  fallbackTxId?: string
): Promise<{
  ok: boolean;
  status: string;
  approved: boolean;
  rewardSummary?: string;
}> {
  dotenv.config({ override: true });
  const mpToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!mpToken || !mpPaymentId) {
    return { ok: false, status: 'PENDING', approved: false };
  }

  try {
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(mpPaymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${mpToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!mpRes.ok) {
      return { ok: false, status: 'PENDING', approved: false };
    }

    const mpData = (await mpRes.json()) as {
      id?: number | string;
      status?: string;
      external_reference?: string;
      transaction_amount?: number;
    };

    const rawStatus = String(mpData.status || '').toLowerCase();
    const txId = mpData.external_reference || fallbackTxId || '';
    const tx =
      (txId ? store.getPaymentTransactionById(txId) : undefined) ||
      store.findPaymentTransactionByMpId(String(mpData.id || mpPaymentId));

    if (!tx) {
      return { ok: false, status: rawStatus.toUpperCase(), approved: false };
    }

    if (rawStatus === 'approved') {
      const approval = store.approvePaymentTransaction(tx.id, String(mpData.id || mpPaymentId));
      if (approval.ok && !approval.alreadyApproved && approval.user) {
        emitToUser(approval.user.id, 'auth:profile', approval.user);
        emitToUser(approval.user.id, 'system:toast', {
          type: 'success',
          message: `🎉 Pagamento PIX aprovado! ${approval.rewardSummary || ''}`,
        });
        const hostId = store.userCurrentRoom.get(approval.user.id) || approval.user.id;
        broadcastRoomState(hostId);
        if (hostId !== approval.user.id) {
          broadcastRoomState(approval.user.id);
        }
        broadcastDirectory();
      }
      return {
        ok: true,
        status: 'APPROVED',
        approved: true,
        rewardSummary: approval.rewardSummary,
      };
    } else if (rawStatus === 'rejected' || rawStatus === 'cancelled') {
      store.updatePaymentTransactionStatus(
        tx.id,
        rawStatus === 'rejected' ? 'REJECTED' : 'CANCELLED'
      );
      return { ok: true, status: rawStatus.toUpperCase(), approved: false };
    } else if (Date.now() - (tx.createdAt || 0) >= 15 * 60 * 1000) {
      store.updatePaymentTransactionStatus(tx.id, 'CANCELLED');
      return { ok: true, status: 'CANCELLED', approved: false };
    }

    return { ok: true, status: 'PENDING', approved: false };
  } catch (err) {
    console.error('[MercadoPago] Erro ao consultar pagamento:', err);
    return { ok: false, status: 'PENDING', approved: false };
  }
}

app.post('/api/payments/create', async (req, res) => {
  dotenv.config({ override: true });
  const authUser = resolveAuthenticatedRequestUser(req);
  if (!authUser) {
    res.status(401).json({ error: 'Sessão inválida. Faça login novamente com sua conta Google.' });
    return;
  }

  const { packageId } = (req.body || {}) as { packageId?: string };
  const pkg = getRealMoneyPackageById(String(packageId || '').trim());
  if (!pkg) {
    res.status(400).json({ error: 'Pacote inválido ou inexistente no servidor.' });
    return;
  }

  // Se for o pacote exclusivo Double D Pack e o jogador já tiver todos os itens, evita cobrança duplicada
  if (
    pkg.type === 'EXCLUSIVE_BUNDLE' &&
    pkg.grantedItemIds &&
    pkg.grantedItemIds.every((id) => authUser.inventory.includes(id))
  ) {
    res.status(400).json({ error: 'Você já possui todos os itens do Double D Pack na sua conta!' });
    return;
  }

  const mpToken = (process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
  if (!mpToken) {
    res.status(400).json({
      error:
        '🔑 MERCADOPAGO_ACCESS_TOKEN ainda não configurado no .env / Render. Adicione seu Access Token do Mercado Pago para gerar o QR Code PIX!',
    });
    return;
  }

  const tx = store.createPaymentTransaction({
    userId: authUser.id,
    packageId: pkg.id,
  });

  if (!tx) {
    res.status(500).json({ error: 'Não foi possível registrar a transação.' });
    return;
  }

  try {
    const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    const expirationIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const mpBody: Record<string, unknown> = {
      transaction_amount: Number(pkg.priceBrl.toFixed(2)),
      description: `Pocket Corner - ${pkg.name} (@${authUser.username})`,
      payment_method_id: 'pix',
      external_reference: tx.id,
      date_of_expiration: expirationIso,
      payer: {
        email: authUser.email || `${authUser.username}@pocketcorner.app`,
        first_name: authUser.displayName || authUser.username,
      },
    };

    if (publicBaseUrl.startsWith('https://')) {
      mpBody.notification_url = `${publicBaseUrl}/api/payments/webhook`;
    }

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mpToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': tx.id,
      },
      body: JSON.stringify(mpBody),
    });

    const mpData = (await mpRes.json()) as {
      id?: number | string;
      status?: string;
      message?: string;
      cause?: Array<{ description?: string }>;
      point_of_interaction?: {
        transaction_data?: {
          qr_code?: string;
          qr_code_base64?: string;
          ticket_url?: string;
        };
      };
    };

    if (!mpRes.ok || !mpData.id) {
      const detail =
        mpData.cause?.[0]?.description ||
        mpData.message ||
        'Verifique se o seu MERCADOPAGO_ACCESS_TOKEN é de Produção (APP_USR-...) e se há chave PIX cadastrada na sua conta Mercado Pago.';
      store.updatePaymentTransactionStatus(tx.id, 'REJECTED');
      res.status(400).json({
        error: `Erro do Mercado Pago: ${detail}`,
      });
      return;
    }

    store.setPaymentTransactionMpId(tx.id, String(mpData.id));
    const txData = mpData.point_of_interaction?.transaction_data;

    res.json({
      ok: true,
      txId: tx.id,
      mpPaymentId: String(mpData.id),
      packageName: pkg.name,
      amountBrl: pkg.priceBrl,
      qrCode: txData?.qr_code || '',
      qrCodeBase64: txData?.qr_code_base64 || '',
      ticketUrl: txData?.ticket_url || '',
    });
  } catch (err) {
    console.error('[MercadoPago] Falha ao criar pagamento PIX:', err);
    res.status(500).json({ error: `Falha ao conectar com Mercado Pago: ${(err as Error).message}` });
  }
});

app.get('/api/payments/check/:txId', async (req, res) => {
  const authUser = resolveAuthenticatedRequestUser(req);
  if (!authUser) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }

  const txId = String(req.params.txId || '').trim();
  const tx = store.getPaymentTransactionById(txId);
  if (!tx || (tx.userId !== authUser.id && !store.isUserAdmin(authUser))) {
    res.status(404).json({ error: 'Transação não encontrada.' });
    return;
  }

  if (tx.status === 'APPROVED') {
    res.json({ ok: true, status: 'APPROVED', approved: true });
    return;
  }

  if (tx.mpPaymentId) {
    const check = await verifyAndFulfillMercadoPagoPayment(tx.mpPaymentId, tx.id);
    res.json(check);
    return;
  }

  if (tx.status === 'PENDING' && Date.now() - (tx.createdAt || 0) >= 15 * 60 * 1000) {
    store.updatePaymentTransactionStatus(tx.id, 'CANCELLED');
    res.json({ ok: true, status: 'CANCELLED', approved: false });
    return;
  }

  res.json({ ok: true, status: tx.status, approved: false });
});

app.post('/api/payments/webhook', async (req, res) => {
  try {
    const body = (req.body || {}) as {
      type?: string;
      action?: string;
      data?: { id?: string | number };
      id?: string | number;
    };
    const queryDataId = req.query['data.id'] || req.query.id;
    const paymentId = body.data?.id || queryDataId || body.id;

    if (paymentId) {
      await verifyAndFulfillMercadoPagoPayment(String(paymentId));
    }
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[MercadoPago Webhook] Erro:', err);
    res.status(200).json({ received: true });
  }
});

// ==========================================
// PAINEL DO ADMINISTRADOR (100% VALIDADO NO SERVIDOR)
// NUNCA CONFIA NO FRONTEND: exige usuário Google autenticado cujo e-mail no banco
// seja idêntico ao ADMIN_EMAIL definido no .env do servidor!
// ==========================================
app.get('/api/admin/dashboard', async (req, res) => {
  dotenv.config({ override: true });
  const authUser = resolveAuthenticatedRequestUser(req);
  if (!authUser) {
    res.status(401).json({ error: 'Não autenticado. Faça login com sua conta Google.' });
    return;
  }

  if (!store.isUserAdmin(authUser)) {
    res.status(403).json({
      error:
        '⛔ Acesso negado pelo servidor: sua conta Google não está autorizada como ADMIN_EMAIL.',
    });
    return;
  }

  // Sincroniza transações PENDING recentes com o Mercado Pago e cancela as expiradas (> 15 min)
  const initialData = store.getAdminDashboardData();
  const pendingWithMp = initialData.paymentTransactions
    .filter((t) => t.status === 'PENDING' && t.mpPaymentId)
    .slice(0, 10);

  for (const ptx of pendingWithMp) {
    if (ptx.mpPaymentId) {
      await verifyAndFulfillMercadoPagoPayment(ptx.mpPaymentId, ptx.id);
    }
  }

  const data = store.getAdminDashboardData();
  res.json({
    ok: true,
    adminEmail: authUser.email,
    ...data,
  });
});

app.post('/api/admin/test-action', (req, res) => {
  dotenv.config({ override: true });
  const authUser = resolveAuthenticatedRequestUser(req);
  if (!authUser) {
    res.status(401).json({ error: 'Não autenticado. Faça login com sua conta Google.' });
    return;
  }

  if (!store.isUserAdmin(authUser)) {
    res.status(403).json({
      error:
        '⛔ Acesso negado pelo servidor: sua conta Google não está autorizada como ADMIN_EMAIL.',
    });
    return;
  }

  const { action, itemId } = (req.body || {}) as {
    action?: 'UNLOCK_ALL' | 'ADD_COINS' | 'ADD_GEMS' | 'EQUIP_ITEM' | 'EQUIP_DOUBLE_D';
    itemId?: string;
  };

  if (!action) {
    res.status(400).json({ error: 'Ação de administrador não informada.' });
    return;
  }

  const result = store.adminExecuteTestAction(authUser.id, action, itemId);
  if (!result.ok || !result.user) {
    res.status(400).json({ error: result.message });
    return;
  }

  emitToUser(result.user.id, 'auth:profile', result.user);
  emitToUser(result.user.id, 'system:toast', {
    type: 'success',
    message: result.message,
  });

  const hostId = store.userCurrentRoom.get(result.user.id) || result.user.id;
  broadcastRoomState(hostId);
  if (hostId !== result.user.id) {
    broadcastRoomState(result.user.id);
  }
  broadcastDirectory();

  res.json({
    ok: true,
    message: result.message,
    profile: result.user,
  });
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

    const currentTargetHostRoom = store.userCurrentRoom.get(targetHost.id) || targetHost.id;
    const isTargetHostAway = currentTargetHostRoom !== targetHost.id;

    if (targetHost.doorPermission === 'OPEN' || targetHost.id === BOT_USER_ID || isTargetHostAway) {
      moveUserToRoom(userId, targetHost.id, !isTargetHostAway);
      socket.emit('system:toast', {
        type: isTargetHostAway ? 'info' : 'success',
        message: isTargetHostAway
          ? `🪧 ${targetHost.displayName} saiu para visitar outra pessoa: "Volto já!"`
          : `🚀 Você invadiu o cantinho de ${targetHost.displayName}!`,
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

  socket.on('host:set_work_status', ({ workStatus }) => {
    const u = store.getUserById(userId);
    if (!u) return;

    const cleanStatus = sanitizeChatText(workStatus || '').slice(0, 38);
    u.workStatus = cleanStatus;
    store.saveDB();

    const myRoom = store.ensureRoom(userId);
    const myPlayer = myRoom.players.get(userId);
    if (myPlayer) {
      myPlayer.workStatus = cleanStatus;
    }

    const currentHostId = store.userCurrentRoom.get(userId) || userId;
    const currentRoom = store.rooms.get(currentHostId);
    const inCurrent = currentRoom?.players.get(userId);
    if (inCurrent) {
      inCurrent.workStatus = cleanStatus;
    }

    socket.emit('auth:profile', u);
    socket.emit('system:toast', {
      type: 'success',
      message: cleanStatus
        ? `🪧 Status na mesa atualizado: "${cleanStatus}"`
        : '🪧 Plaquinha de status removida da mesa.',
    });
    broadcastRoomState(userId);
    if (currentHostId !== userId) broadcastRoomState(currentHostId);
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

      const cleanNote = note ? sanitizeChatText(note).slice(0, 68) : undefined;
      store.addDeskDrop(
        {
          id: `drop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          itemId: requestedDropId,
          fromUserId: userId,
          fromDisplayName: user.displayName,
          x: finalX,
          note: cleanNote,
          createdAt: Date.now(),
        },
        dropHostId
      );

      broadcastRoomState(dropHostId);
      socket.emit('system:toast', {
        type: 'success',
        message: cleanNote
          ? `${cosmetic.icon} Você deixou "${cosmetic.name}" com Post-it ("${cleanNote}") no cantinho de ${dropHost.displayName}!`
          : `${cosmetic.icon} Você deixou "${cosmetic.name}" no cantinho de ${dropHost.displayName}!`,
      });
      if (dropHostId !== userId) {
        emitToUser(dropHostId, 'system:toast', {
          type: 'info',
          message: cleanNote
            ? `🎁 ${user.displayName} deixou ${cosmetic.name} com um Post-it 📝: "${cleanNote}"!`
            : `🎁 ${user.displayName} deixou um ${cosmetic.name} no chão do seu cantinho! Clique nele!`,
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
    } else if (actionType === 'ATTENTION') {
      // 📳 Chamar Atenção (Estilo MSN Messenger! Sacode a sala inteira + som clássico do MSN)
      io.to(`room:${hostId}`).emit('room:interaction_fx', {
        fromUserId: userId,
        fromDisplayName: senderPlayer.displayName,
        targetUserId: targetPlayer.userId,
        actionType: 'ATTENTION',
        fromX: senderPlayer.x,
        toX: targetPlayer.x,
      });
      for (const p of room.players.values()) {
        io.to(`room:${hostId}`).emit('room:player_jumped', { userId: p.userId });
      }
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

    const claimedBonusCoins = result.item.meta?.bonusCoins ?? 0;

    io.to(`room:${userId}`).emit('room:desk_drop_claimed', {
      dropId,
      itemId: result.item.id,
      claimedByUserId: userId,
      fromDisplayName: result.drop.fromDisplayName,
      speedBoostSec: result.item.meta?.speedBoostSec,
      bonusCoins: claimedBonusCoins,
      note: result.drop.note,
    });

    const coinMsg = claimedBonusCoins > 0 ? `+${claimedBonusCoins} 🪙` : '';
    const boostMsg = result.item.meta?.speedBoostSec
      ? `${coinMsg ? ' + ' : ''}Velocidade 2x por ${result.item.meta.speedBoostSec}s!`
      : '';
    const effectParen = coinMsg || boostMsg ? ` (${coinMsg}${boostMsg})` : '';
    const noteMsg = result.drop.note ? ` • 📝 Post-it: "${result.drop.note}"` : '';

    socket.emit('system:toast', {
      type: 'success',
      message: `${result.item.icon} Coletou ${result.item.name} de ${result.drop.fromDisplayName}!${effectParen}${noteMsg}`,
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

  socket.on('avatar:set_human_variant', ({ variantId }) => {
    const res = store.setHumanVariant(userId, variantId);
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

  socket.on('avatar:set_fish_variant', ({ variantId }) => {
    const res = store.setFishVariant(userId, variantId);
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

  socket.on('pet:set_variant', ({ petId, variantId }) => {
    const res = store.setPetVariant(userId, petId, variantId);
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

  socket.on('pet:unequip', () => {
    const res = store.unequipPet(userId);
    const updated = store.getUserById(userId);
    if (updated) socket.emit('auth:profile', updated);
    socket.emit('system:toast', {
      type: res.ok ? 'info' : 'error',
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
    socket.emit('system:toast', {
      type: 'info',
      message:
        '🪙 Você ganha 1 Moeda automaticamente a cada 5 minutos online! Pip Diamantes 💎 são adquiridos na Loja.',
    });
  });

  socket.on('economy:claim_focus_reward', ({ focusMinutes }) => {
    // Limite de segurança no servidor: máx 1 recompensa de ciclo de foco a cada 15 minutos
    const rl = store.consumeRateLimitToken(userId, 'economy:claim_focus_reward', 1, 15 * 60 * 1000);
    if (!rl.allowed) {
      return;
    }

    const u = store.getUserById(userId);
    if (!u) return;

    const mins = Number(focusMinutes) >= 45 ? 50 : 25;
    const bonusCoins = mins >= 50 ? 10 : 5;
    u.coins += bonusCoins;
    u.hostStatus = 'IDLE';

    const myRoom = store.ensureRoom(userId);
    const myPlayer = myRoom.players.get(userId);
    if (myPlayer) {
      myPlayer.hostStatus = 'IDLE';
      myPlayer.idleActivity = 'COFFEE';
    }

    const currentHostId = store.userCurrentRoom.get(userId) || userId;
    const currentRoom = store.rooms.get(currentHostId);
    const inCurrent = currentRoom?.players.get(userId);
    if (inCurrent) {
      inCurrent.hostStatus = 'IDLE';
      inCurrent.idleActivity = 'COFFEE';
    }

    store.saveDB();
    socket.emit('auth:profile', u);
    socket.emit('system:toast', {
      type: 'success',
      message: `🍅 Ciclo de Foco (${mins} min) concluído! Hora do café ☕ (+${bonusCoins} 🪙)`,
    });
    broadcastRoomState(userId);
    if (currentHostId !== userId) broadcastRoomState(currentHostId);
    broadcastDirectory();
  });

  // ------------------------------------------
  // 6.2. Grafo Social de Amizade (PENDING -> ACCEPTED)
  // ------------------------------------------
  socket.on('friends:add', ({ usernameOrId }) => {
    const rawQuery = String(usernameOrId || '').trim();
    if (!rawQuery.startsWith('@') || rawQuery.length < 2) {
      socket.emit('system:toast', {
        type: 'warning',
        message: 'Para adicionar um amigo, digite o ID único começando com @ (ex: @Rick ou @Rick2).',
      });
      return;
    }

    const target = store.findUserByUsernameOrId(rawQuery);
    const u = store.getUserById(userId);
    if (!u || !target) {
      socket.emit('system:toast', {
        type: 'error',
        message: `Nenhum jogador encontrado com o ID único "${rawQuery}".`,
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
        store.ensureRoom(userId);
        broadcastRoomState(userId);
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
// PASSIVE IDLE CURRENCY TICK (1 Moeda a cada 5 min sozinho • 2 Moedas em Co-Working 🤝)
// ==========================================
const FIVE_MINUTES_MS = 5 * 60 * 1000;
setInterval(() => {
  for (const userId of store.onlineUsers) {
    if (userId === BOT_USER_ID) continue;
    const u = store.getUserById(userId);
    if (!u) continue;

    const currentHostId = store.userCurrentRoom.get(userId) || userId;
    const currentRoom = store.rooms.get(currentHostId);
    const isCoWorking = (currentRoom?.players.size || 0) >= 2;

    u.coins += isCoWorking ? 2 : 1;
    emitToUser(userId, 'auth:profile', u);
  }
  store.saveDB();
}, FIVE_MINUTES_MS);

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
