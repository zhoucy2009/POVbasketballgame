export const multiplayerSchema = [
  `CREATE TABLE IF NOT EXISTS multiplayer_players (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'online',
    room_id TEXT,
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS multiplayer_invites (
    id TEXT PRIMARY KEY,
    from_player TEXT NOT NULL,
    to_player TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS multiplayer_rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    host_id TEXT NOT NULL,
    guest_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    host_ready INTEGER NOT NULL DEFAULT 0,
    guest_ready INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS multiplayer_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    from_player TEXT NOT NULL,
    signal_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_multiplayer_players_presence
    ON multiplayer_players(status, last_seen)`,
  `CREATE INDEX IF NOT EXISTS idx_multiplayer_invites_target
    ON multiplayer_invites(to_player, status, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_multiplayer_signals_room
    ON multiplayer_signals(room_id, id)`,
];
