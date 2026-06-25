import Database from 'better-sqlite3';
import { registerHistoryStorage } from 'xxscreeps-mod-history/storage.js';
import type { HistoryStorage } from 'xxscreeps-mod-history/storage.js';

// `history.path` is the SQLite database file (e.g. ./screeps/history.db).
class SqliteHistoryStorage implements HistoryStorage {
	private readonly db: Database.Database;
	private readonly insertStmt: Database.Statement;
	private readonly selectStmt: Database.Statement;
	private readonly deleteStmt: Database.Statement;

	constructor(file: string) {
		this.db = new Database(file);
		this.db.pragma('journal_mode = WAL');
		this.db.exec(
			`CREATE TABLE IF NOT EXISTS history (
				room TEXT NOT NULL,
				base INTEGER NOT NULL,
				data BLOB NOT NULL,
				ts INTEGER NOT NULL,
				PRIMARY KEY (room, base)
			)`);
		this.insertStmt = this.db.prepare('INSERT OR REPLACE INTO history (room, base, data, ts) VALUES (?, ?, ?, ?)');
		this.selectStmt = this.db.prepare('SELECT data FROM history WHERE room = ? AND base = ?');
		this.deleteStmt = this.db.prepare('DELETE FROM history WHERE base < ?');
	}

	async save(room: string, base: number, gz: Uint8Array): Promise<void> {
		this.insertStmt.run(room, base, Buffer.from(gz), Date.now());
	}

	async load(room: string, base: number): Promise<Uint8Array | null> {
		const row = this.selectStmt.get(room, base) as { data: Buffer } | undefined;
		return row ? row.data : null;
	}

	async cleanup(beforeTick: number): Promise<void> {
		this.deleteStmt.run(beforeTick);
	}

	[Symbol.asyncDispose](): void {
		this.db.close();
	}
}

registerHistoryStorage('sqlite', opts => new SqliteHistoryStorage(opts.path));
