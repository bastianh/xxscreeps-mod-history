import type { Database, Shard } from 'xxscreeps/engine/db/index.js';
import type { World } from 'xxscreeps/game/map.js';
import { hooks } from 'xxscreeps/backend/index.js';
import { config } from 'xxscreeps/config/index.js';
import { activeRoomsKey } from 'xxscreeps/engine/processor/model.js';
import { getDiff, gunzipChunk, gzipChunk } from './chunk.js';
import { defaults } from './config.js';
import { renderRoomObjects } from './render.js';
import { getHistoryStorage } from './storage.js';
import type { HistoryOptions, HistoryStorage } from './storage.js';
import type { RoomHistoryChunk, RoomObjectDiff, RoomObjectMap } from './types.js';

function options(): HistoryOptions {
	const raw = (config as unknown as Record<string, unknown>).history as Partial<HistoryOptions> | undefined;
	return { ...defaults.history, ...raw } as HistoryOptions;
}

const chunkBaseFor = (time: number, chunkSize: number) => time - (time % chunkSize);

// One storage instance shared by the capture loop (writer) and the HTTP
// endpoints (reader). Resolved lazily, after all backend mods have registered.
let storagePromise: Promise<HistoryStorage> | undefined;
function storage(opts: HistoryOptions): Promise<HistoryStorage> {
	return storagePromise ??= Promise.resolve(getHistoryStorage(opts.storage)(opts));
}

interface RoomCapture {
	base: number;
	// `base` key holds the full room state; later keys hold shallow diffs.
	ticks: Record<string, RoomObjectDiff | RoomObjectMap>;
	prev: RoomObjectMap;
}

// --- Capture loop ---

hooks.register('backendReady', (_db: Database, shard: Shard) => {
	const opts = options();
	if (!opts.capture) {
		console.log('[screepsmod-history] capture disabled (history.capture=false)');
		return;
	}

	let store: HistoryStorage | undefined;
	let world: World | undefined;
	const captures = new Map<string, RoomCapture>();
	const chunkBase = (time: number) => chunkBaseFor(time, opts.chunkSize);

	// Best-effort single-writer lease so multiple backends don't double-write.
	const leaseKey = 'history/capture-owner';
	const leaseId = `${process.pid}-${Math.random().toString(36).slice(2)}`;
	const leaseTtl = Math.max(10_000, opts.cleanupInterval * 50);

	const flush = async (room: string, capture: RoomCapture) => {
		const chunk: RoomHistoryChunk = {
			timestamp: Date.now(),
			room,
			base: capture.base,
			ticks: capture.ticks as Record<string, RoomObjectDiff>,
		};
		try {
			await store!.save(room, capture.base, await gzipChunk(chunk));
		} catch (err) {
			console.error(`[screepsmod-history] failed to save chunk ${room}@${capture.base}:`, err);
		}
	};

	const record = (room: string, time: number, objects: RoomObjectMap) => {
		const base = chunkBase(time);
		let capture = captures.get(room);
		if (!capture || capture.base !== base) {
			if (capture) {
				captures.delete(room);
				void flush(room, capture);
			}
			// First tick seen in this chunk becomes the full base snapshot.
			capture = { base, ticks: { [base]: objects }, prev: objects };
			captures.set(room, capture);
		} else {
			capture.ticks[time] = getDiff(capture.prev, objects);
			capture.prev = objects;
		}
		// Flush the moment the chunk's final tick is recorded.
		if (time === base + opts.chunkSize - 1) {
			captures.delete(room);
			void flush(room, capture);
		}
	};

	const claimLease = async (): Promise<boolean> => {
		try {
			const current = await shard.data.get(leaseKey);
			const now = Date.now();
			if (current) {
				const at = current.lastIndexOf('@');
				const owner = current.slice(0, at);
				const ts = Number(current.slice(at + 1));
				if (owner !== leaseId && Number.isFinite(ts) && now - ts < leaseTtl) {
					return false;
				}
			}
			await shard.data.set(leaseKey, `${leaseId}@${now}`);
			return true;
		} catch {
			// If the lease store misbehaves, fail open — a single backend is the norm.
			return true;
		}
	};

	const onTick = async (time: number) => {
		if (!store || !(await claimLease())) {
			return;
		}
		let rooms: string[];
		try {
			rooms = await shard.scratch.zRange(activeRoomsKey, 0, -1);
		} catch {
			rooms = [];
		}
		world ??= await shard.loadWorld();
		const seen = new Set(rooms);
		await Promise.all(rooms.map(async room => {
			try {
				const state = await shard.loadRoom(room, time);
				record(room, time, renderRoomObjects(world!, state, time));
			} catch {
				// Room not loadable at this tick (timing / closed) — skip.
			}
		}));
		// Flush trailing partial chunks for rooms that have gone inactive.
		const currentBase = chunkBase(time);
		for (const [ room, capture ] of captures) {
			if (capture.base < currentBase && !seen.has(room)) {
				captures.delete(room);
				void flush(room, capture);
			}
		}
		// Retention sweep.
		if (opts.keepTicks > 0 && time % opts.cleanupInterval === 0) {
			void store.cleanup(time - opts.keepTicks).catch(() => {});
		}
	};

	void (async () => {
		try {
			store = await storage(opts);
			console.log(`[screepsmod-history] recording via '${opts.storage}' backend (chunkSize=${opts.chunkSize}, keepTicks=${opts.keepTicks})`);
		} catch (err) {
			console.error('[screepsmod-history] failed to initialize storage backend:', err);
		}
	})();

	shard.channel.listen(message => {
		if (message.type === 'tick') {
			void onTick(message.time);
		}
	});
});

// --- HTTP endpoints (replay viewer) ---

hooks.register('middleware', (koa, router) => {
	const opts = options();

	// Advertise the history chunk size in /api/version so the client's replay
	// viewer aligns its chunk-base requests with what we store. Runs before
	// router.routes(), so it can amend the response body after the route sets it.
	koa.use(async (ctx: any, next: any) => {
		await next();
		if (ctx.path === '/api/version' && ctx.body && typeof ctx.body === 'object') {
			ctx.body.serverData ??= {};
			ctx.body.serverData.historyChunkSize = opts.chunkSize;
		}
	});

	const serve = async (ctx: any, room: string, time: number) => {
		if (!room || !Number.isFinite(time)) {
			ctx.status = 400;
			ctx.body = { error: 'room and time are required' };
			return;
		}
		const base = chunkBaseFor(time, opts.chunkSize);
		let chunkStore: HistoryStorage;
		try {
			chunkStore = await storage(opts);
		} catch (err) {
			ctx.status = 500;
			ctx.body = { error: String(err) };
			return;
		}
		const gz = await chunkStore.load(room, base);
		if (!gz) {
			ctx.status = 404;
			ctx.body = { error: 'no history for this room/tick' };
			return;
		}
		ctx.type = 'application/json';
		ctx.body = await gunzipChunk(gz);
	};

	// Sharded form: GET /room-history/<shard>/<room>/<base>.json
	router.get('/room-history/:shard/:room/:base.json', async (ctx: any) => {
		await serve(ctx, ctx.params.room, Number(ctx.params.base));
	});
	// Private-server form: GET /room-history?room=<room>&time=<tick>
	router.get('/room-history', async (ctx: any) => {
		await serve(ctx, String(ctx.query.room ?? ''), Number(ctx.query.time ?? NaN));
	});
});
