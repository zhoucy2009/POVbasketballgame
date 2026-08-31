import { env } from 'cloudflare:workers';
import { multiplayerSchema } from '@/db/schema';

type Bindings = Cloudflare.Env & { DB: D1Database };

let schemaReady: Promise<void> | null = null;

export function multiplayerDb() {
  const db = (env as Bindings).DB;
  if (!db) throw new Error('D1 binding DB is unavailable');
  return db;
}

export async function ensureMultiplayerSchema() {
  if (!schemaReady) {
    const db = multiplayerDb();
    schemaReady = db.batch(multiplayerSchema.map((statement) => db.prepare(statement))).then(() => undefined);
  }
  await schemaReady;
}
