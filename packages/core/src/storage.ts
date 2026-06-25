import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Resolved `history` config block, passed to each backend factory. */
export interface HistoryOptions {
	storage: string;
	path: string;
	url?: string;
	bucket?: string;
	prefix?: string;
	region?: string;
	endpoint?: string;
	chunkSize: number;
	keepTicks: number;
	cleanupInterval: number;
	capture: boolean;
	[key: string]: unknown;
}

/**
 * Minimal, history-specific persistence surface. A chunk is an opaque gzipped
 * JSON blob keyed by `(room, base-tick)`.
 */
export interface HistoryStorage {
	save(room: string, base: number, gz: Uint8Array): Promise<void>;
	load(room: string, base: number): Promise<Uint8Array | null>;
	/** Prune all chunks whose base tick is below `beforeTick`. */
	cleanup(beforeTick: number): Promise<void>;
	[Symbol.asyncDispose]?(): Promise<void> | void;
}

export type HistoryStorageFactory = (opts: HistoryOptions) => Promise<HistoryStorage> | HistoryStorage;

const registry = new Map<string, HistoryStorageFactory>();

/** Register a named storage backend. Called by backend mods on import. */
export function registerHistoryStorage(name: string, factory: HistoryStorageFactory): void {
	registry.set(name, factory);
}

export function getHistoryStorage(name: string): HistoryStorageFactory {
	const factory = registry.get(name);
	if (!factory) {
		const known = [ ...registry.keys() ].join(', ') || 'none';
		throw new Error(
			`No history storage backend registered for '${name}' (registered: ${known}). ` +
			`Add the backend package (e.g. '@screepsmod-history/sqlite') to your mods list.`);
	}
	return factory;
}

// --- Filesystem backend (bundled in core, no extra dependencies) ---

class FileHistoryStorage implements HistoryStorage {
	constructor(private readonly dir: string) {}

	private file(room: string, base: number) {
		return path.join(this.dir, room, `${base}.json.gz`);
	}

	async save(room: string, base: number, gz: Uint8Array) {
		const file = this.file(room, base);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, gz);
	}

	async load(room: string, base: number) {
		try {
			return await readFile(this.file(room, base));
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw err;
		}
	}

	async cleanup(beforeTick: number) {
		if (!existsSync(this.dir)) {
			return;
		}
		const rooms = await readdir(this.dir).catch(() => [] as string[]);
		await Promise.all(rooms.map(async room => {
			const roomDir = path.join(this.dir, room);
			const files = await readdir(roomDir).catch(() => [] as string[]);
			await Promise.all(files.map(async name => {
				const base = Number.parseInt(name, 10);
				if (Number.isFinite(base) && base < beforeTick) {
					await unlink(path.join(roomDir, name)).catch(() => {});
				}
			}));
		}));
	}
}

registerHistoryStorage('file', opts => new FileHistoryStorage(opts.path));
