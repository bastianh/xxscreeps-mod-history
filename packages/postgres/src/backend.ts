import pg from 'pg';
import { registerHistoryStorage } from 'xxscreeps-mod-history/storage.js';
import type { HistoryStorage } from 'xxscreeps-mod-history/storage.js';

// `history.url` is the PostgreSQL connection string.
class PostgresHistoryStorage implements HistoryStorage {
	private readonly pool: pg.Pool;
	private readonly ready: Promise<void>;

	constructor(connectionString: string) {
		this.pool = new pg.Pool({ connectionString });
		this.ready = this.pool.query(
			`CREATE TABLE IF NOT EXISTS history (
				room TEXT NOT NULL,
				base BIGINT NOT NULL,
				data BYTEA NOT NULL,
				ts BIGINT NOT NULL,
				PRIMARY KEY (room, base)
			)`).then(() => undefined);
	}

	async save(room: string, base: number, gz: Uint8Array): Promise<void> {
		await this.ready;
		await this.pool.query(
			`INSERT INTO history (room, base, data, ts) VALUES ($1, $2, $3, $4)
				ON CONFLICT (room, base) DO UPDATE SET data = EXCLUDED.data, ts = EXCLUDED.ts`,
			[ room, base, Buffer.from(gz), Date.now() ]);
	}

	async load(room: string, base: number): Promise<Uint8Array | null> {
		await this.ready;
		const res = await this.pool.query<{ data: Buffer }>(
			'SELECT data FROM history WHERE room = $1 AND base = $2', [ room, base ]);
		return res.rows[0]?.data ?? null;
	}

	async cleanup(beforeTick: number): Promise<void> {
		await this.ready;
		await this.pool.query('DELETE FROM history WHERE base < $1', [ beforeTick ]);
	}

	async [Symbol.asyncDispose](): Promise<void> {
		await this.pool.end();
	}
}

registerHistoryStorage('postgres', opts => {
	// Prefer config `history.url`, but fall back to the HISTORY_POSTGRES_URL
	// environment variable so the connection string (with its password) can be
	// supplied via a secret instead of plaintext config.
	const url = opts.url ?? process.env.HISTORY_POSTGRES_URL;
	if (!url) {
		throw new Error("set history.url or the HISTORY_POSTGRES_URL env var for the 'postgres' backend");
	}
	return new PostgresHistoryStorage(url);
});
