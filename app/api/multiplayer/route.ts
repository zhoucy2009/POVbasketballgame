import { ensureMultiplayerSchema, multiplayerDb } from '@/lib/multiplayer-db';
import type { GameInvite, LobbySnapshot, OnlineRoom, PlayerPresence, SignalMessage } from '@/lib/multiplayer-types';

export const dynamic = 'force-dynamic';

type PlayerRow = { id: string; display_name: string; status: PlayerPresence['status']; last_seen: number; room_id: string | null };
type InviteRow = { id: string; from_player: string; to_player: string; status: GameInvite['status']; expires_at: number; from_name: string };
type RoomRow = { id: string; code: string; host_id: string; guest_id: string; status: OnlineRoom['status']; host_ready: number; guest_ready: number; host_name: string; guest_name: string };
type SignalRow = { id: number; from_player: string; signal_type: SignalMessage['type']; payload: string };

const COOKIE_NAME = 'unmatched-player';

function cookieValue(request: Request, name: string) {
  const prefix = `${name}=`;
  return request.headers.get('cookie')?.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function sessionFor(request: Request) {
  const authenticatedId = request.headers.get('oai-authenticated-user-id');
  if (authenticatedId) return { id: `oai:${authenticatedId}`, cookie: null };
  const existing = cookieValue(request, COOKIE_NAME);
  if (existing && /^[a-zA-Z0-9-]{20,80}$/.test(existing)) return { id: existing, cookie: null };
  const id = `guest-${crypto.randomUUID()}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { id, cookie: `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}` };
}

function safeName(value: unknown, fallbackId: string) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 18) : '';
  return name || `球员 ${fallbackId.slice(-4).toUpperCase()}`;
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function responseJson(data: unknown, cookie: string | null, status = 200) {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

function playerFromRow(row: PlayerRow): PlayerPresence {
  return { id: row.id, name: row.display_name, status: row.status, lastSeen: row.last_seen };
}

function roomFromRow(row: RoomRow): OnlineRoom {
  return {
    id: row.id, code: row.code, hostId: row.host_id, guestId: row.guest_id,
    hostName: row.host_name, guestName: row.guest_name,
    hostReady: Boolean(row.host_ready), guestReady: Boolean(row.guest_ready), status: row.status,
  };
}

async function snapshot(request: Request, since = 0): Promise<{ data: LobbySnapshot; cookie: string | null }> {
  await ensureMultiplayerSchema();
  const db = multiplayerDb();
  const session = sessionFor(request);
  const now = Date.now();
  const authenticatedName = request.headers.get('oai-authenticated-user-full-name');
  let decodedAuthenticatedName = authenticatedName ?? '';
  try { decodedAuthenticatedName = decodeURIComponent(decodedAuthenticatedName); } catch { /* Use the header as-is. */ }
  const displayName = safeName(decodedAuthenticatedName, session.id);

  await db.batch([
    db.prepare("UPDATE multiplayer_invites SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").bind(now),
    db.prepare('DELETE FROM multiplayer_signals WHERE created_at < ?').bind(now - 120_000),
    db.prepare(`INSERT INTO multiplayer_players (id, display_name, status, room_id, last_seen, created_at)
      VALUES (?, ?, 'online', NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`).bind(session.id, displayName, now, now),
  ]);

  const meRow = await db.prepare('SELECT id, display_name, status, last_seen, room_id FROM multiplayer_players WHERE id = ?').bind(session.id).first<PlayerRow>();
  if (!meRow) throw new Error('Unable to create player session');
  const playersResult = await db.prepare(`SELECT id, display_name, status, last_seen, room_id
    FROM multiplayer_players WHERE id != ? AND last_seen > ? AND room_id IS NULL ORDER BY last_seen DESC LIMIT 24`).bind(session.id, now - 20_000).all<PlayerRow>();
  const invitesResult = await db.prepare(`SELECT i.id, i.from_player, i.to_player, i.status, i.expires_at, p.display_name AS from_name
    FROM multiplayer_invites i JOIN multiplayer_players p ON p.id = i.from_player
    WHERE i.to_player = ? AND i.status = 'pending' AND i.expires_at > ? ORDER BY i.created_at DESC`).bind(session.id, now).all<InviteRow>();

  let room: OnlineRoom | null = null;
  let signals: SignalMessage[] = [];
  if (meRow.room_id) {
    const roomRow = await db.prepare(`SELECT r.id, r.code, r.host_id, r.guest_id, r.status, r.host_ready, r.guest_ready,
      hp.display_name AS host_name, gp.display_name AS guest_name
      FROM multiplayer_rooms r JOIN multiplayer_players hp ON hp.id = r.host_id JOIN multiplayer_players gp ON gp.id = r.guest_id
      WHERE r.id = ?`).bind(meRow.room_id).first<RoomRow>();
    if (roomRow) {
      room = roomFromRow(roomRow);
      const signalResult = await db.prepare(`SELECT id, from_player, signal_type, payload FROM multiplayer_signals
        WHERE room_id = ? AND id > ? AND from_player != ? ORDER BY id ASC LIMIT 100`).bind(room.id, since, session.id).all<SignalRow>();
      signals = signalResult.results.map((signal) => ({ id: signal.id, fromId: signal.from_player, type: signal.signal_type, payload: signal.payload }));
    }
  }

  return {
    cookie: session.cookie,
    data: {
      me: playerFromRow(meRow),
      players: playersResult.results.map(playerFromRow),
      invites: invitesResult.results.map((invite) => ({ id: invite.id, fromId: invite.from_player, fromName: invite.from_name, toId: invite.to_player, status: invite.status, expiresAt: invite.expires_at })),
      room, signals, serverTime: now,
    },
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await snapshot(request, Number(url.searchParams.get('since') ?? 0) || 0);
    return responseJson(result.data, result.cookie);
  } catch (error) {
    return responseJson({ error: error instanceof Error ? error.message : '大厅暂时不可用' }, null, 500);
  }
}

export async function POST(request: Request) {
  try {
    await ensureMultiplayerSchema();
    const db = multiplayerDb();
    const session = sessionFor(request);
    const body = await request.json() as Record<string, unknown>;
    const action = textValue(body.action);
    const now = Date.now();

    if (action === 'heartbeat') {
      const name = safeName(body.name, session.id);
      await db.prepare(`INSERT INTO multiplayer_players (id, display_name, status, room_id, last_seen, created_at)
        VALUES (?, ?, 'online', NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, last_seen = excluded.last_seen,
        status = CASE WHEN multiplayer_players.room_id IS NULL THEN 'online' ELSE multiplayer_players.status END`).bind(session.id, name, now, now).run();
      return responseJson({ ok: true }, session.cookie);
    }

    if (action === 'invite') {
      const target = textValue(body.target);
      const targetRow = await db.prepare('SELECT id, room_id, last_seen FROM multiplayer_players WHERE id = ?').bind(target).first<{ id: string; room_id: string | null; last_seen: number }>();
      if (!targetRow || target === session.id || targetRow.room_id || targetRow.last_seen < now - 20_000) return responseJson({ error: '该玩家已离线或正在比赛' }, session.cookie, 409);
      const inviteId = crypto.randomUUID();
      await db.batch([
        db.prepare("UPDATE multiplayer_invites SET status = 'expired' WHERE from_player = ? AND status = 'pending'").bind(session.id),
        db.prepare(`INSERT INTO multiplayer_invites (id, from_player, to_player, status, expires_at, created_at)
          VALUES (?, ?, ?, 'pending', ?, ?)`).bind(inviteId, session.id, target, now + 15_000, now),
      ]);
      return responseJson({ ok: true, inviteId }, session.cookie);
    }

    if (action === 'respond') {
      const inviteId = textValue(body.inviteId);
      const accept = Boolean(body.accept);
      const invite = await db.prepare('SELECT id, from_player, to_player, status, expires_at FROM multiplayer_invites WHERE id = ?').bind(inviteId).first<{ id: string; from_player: string; to_player: string; status: string; expires_at: number }>();
      if (!invite || invite.to_player !== session.id || invite.status !== 'pending' || invite.expires_at <= now) return responseJson({ error: '邀请已失效' }, session.cookie, 409);
      if (!accept) {
        await db.prepare("UPDATE multiplayer_invites SET status = 'rejected' WHERE id = ?").bind(inviteId).run();
        return responseJson({ ok: true }, session.cookie);
      }
      const participants = await db.prepare('SELECT id, room_id, last_seen FROM multiplayer_players WHERE id IN (?, ?)').bind(invite.from_player, session.id).all<{ id: string; room_id: string | null; last_seen: number }>();
      if (participants.results.length !== 2 || participants.results.some((player) => player.room_id || player.last_seen < now - 20_000)) return responseJson({ error: '双方状态已变化，请重新邀请' }, session.cookie, 409);
      const roomId = crypto.randomUUID();
      const code = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
      await db.batch([
        db.prepare(`INSERT INTO multiplayer_rooms (id, code, host_id, guest_id, status, created_at) VALUES (?, ?, ?, ?, 'waiting', ?)`).bind(roomId, code, invite.from_player, session.id, now),
        db.prepare("UPDATE multiplayer_invites SET status = 'accepted' WHERE id = ? AND status = 'pending'").bind(inviteId),
        db.prepare("UPDATE multiplayer_invites SET status = 'expired' WHERE status = 'pending' AND (from_player IN (?, ?) OR to_player IN (?, ?)) AND id != ?").bind(invite.from_player, session.id, invite.from_player, session.id, inviteId),
        db.prepare("UPDATE multiplayer_players SET room_id = ?, status = 'in_room' WHERE id IN (?, ?)").bind(roomId, invite.from_player, session.id),
      ]);
      return responseJson({ ok: true, roomId }, session.cookie);
    }

    const player = await db.prepare('SELECT id, room_id FROM multiplayer_players WHERE id = ?').bind(session.id).first<{ id: string; room_id: string | null }>();
    if (!player?.room_id) return responseJson({ error: '你还没有进入房间' }, session.cookie, 409);
    const room = await db.prepare('SELECT id, host_id, guest_id, host_ready, guest_ready, status FROM multiplayer_rooms WHERE id = ?').bind(player.room_id).first<{ id: string; host_id: string; guest_id: string; host_ready: number; guest_ready: number; status: string }>();
    if (!room || (room.host_id !== session.id && room.guest_id !== session.id)) return responseJson({ error: '房间不可用' }, session.cookie, 403);

    if (action === 'signal') {
      const type = textValue(body.type);
      const payload = textValue(body.payload);
      if (!['offer', 'answer', 'ice'].includes(type) || payload.length > 20_000) return responseJson({ error: '无效信令' }, session.cookie, 400);
      await db.prepare('INSERT INTO multiplayer_signals (room_id, from_player, signal_type, payload, created_at) VALUES (?, ?, ?, ?, ?)').bind(room.id, session.id, type, payload, now).run();
      return responseJson({ ok: true }, session.cookie);
    }

    if (action === 'ready') {
      const column = room.host_id === session.id ? 'host_ready' : 'guest_ready';
      await db.prepare(`UPDATE multiplayer_rooms SET ${column} = 1 WHERE id = ?`).bind(room.id).run();
      const readyRoom = await db.prepare('SELECT host_ready, guest_ready FROM multiplayer_rooms WHERE id = ?').bind(room.id).first<{ host_ready: number; guest_ready: number }>();
      if (readyRoom?.host_ready && readyRoom.guest_ready) {
        await db.batch([
          db.prepare("UPDATE multiplayer_rooms SET status = 'playing', started_at = ? WHERE id = ? AND status = 'waiting'").bind(now + 1200, room.id),
          db.prepare("UPDATE multiplayer_players SET status = 'playing' WHERE room_id = ?").bind(room.id),
        ]);
      }
      return responseJson({ ok: true }, session.cookie);
    }

    if (action === 'leave') {
      await db.batch([
        db.prepare("UPDATE multiplayer_rooms SET status = 'finished', ended_at = ? WHERE id = ?").bind(now, room.id),
        db.prepare("UPDATE multiplayer_players SET room_id = NULL, status = 'online', last_seen = ? WHERE room_id = ?").bind(now, room.id),
        db.prepare('DELETE FROM multiplayer_signals WHERE room_id = ?').bind(room.id),
      ]);
      return responseJson({ ok: true }, session.cookie);
    }

    return responseJson({ error: '未知操作' }, session.cookie, 400);
  } catch (error) {
    return responseJson({ error: error instanceof Error ? error.message : '操作失败' }, null, 500);
  }
}
