import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { RoomHistoryChunk, RoomObjectDiff, RoomObjectMap } from './types.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Per-object diff for the client's replay viewer. The client applies each tick
 * diff with a *deep recursive merge* (`_.merge(state[id], diff[id])`), so a key
 * that disappears can only be cleared by an explicit `null` tombstone — emitting
 * a smaller replacement object leaves the old sub-keys in place. The classic
 * symptom is a finished action (`actionLog.upgradeController`) that keeps
 * animating after the creep moves away, because the idle tick renders
 * `actionLog: {}` and a deep merge of `{}` is a no-op.
 *
 * So each changed property carries the *full* new value plus `null` tombstones
 * for any key (at every nesting level) that existed in `prev` but is gone in
 * `next`. This is also correct under a shallow one-level merge, so the format
 * works for both client implementations.
 *
 * - object present in `prev` but not `next` -> `null` (removed)
 * - object only in `next`                   -> full object (added)
 * - object in both                          -> changed props, recursively
 *   tombstoned for removed keys
 */
export function getDiff(prev: RoomObjectMap, next: RoomObjectMap): RoomObjectDiff {
	const diff: RoomObjectDiff = {};
	for (const id in prev) {
		if (!(id in next)) {
			diff[id] = null;
		}
	}
	for (const id in next) {
		const before = prev[id];
		const after = next[id];
		if (!before) {
			diff[id] = after;
			continue;
		}
		let objectDiff: Record<string, unknown> | undefined;
		for (const key in after) {
			if (!valueEqual(before[key], after[key])) {
				(objectDiff ??= {})[key] = tombstoned(before[key], after[key]);
			}
		}
		// Top-level property removed since `prev` — null it so the deep merge clears it.
		for (const key in before) {
			if (!(key in after)) {
				(objectDiff ??= {})[key] = null;
			}
		}
		if (objectDiff) {
			diff[id] = objectDiff;
		}
	}
	return diff;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Value to emit for a changed property. For plain objects, returns the new
 * value with `null` tombstones for keys dropped since `before`, applied
 * recursively. Non-objects and arrays are replaced wholesale (the client's
 * merge customizer swaps arrays out whole).
 */
function tombstoned(before: unknown, after: unknown): unknown {
	if (!isPlainObject(before) || !isPlainObject(after)) {
		return after;
	}
	const out: Record<string, unknown> = {};
	for (const key in after) {
		out[key] = tombstoned(before[key], after[key]);
	}
	for (const key in before) {
		if (!(key in after)) {
			out[key] = null;
		}
	}
	return out;
}

function valueEqual(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
		return false;
	}
	// Nested objects/arrays (e.g. `store`, `body`) — compare by serialization.
	// Rendered output is deterministic per tick so key order is stable.
	return JSON.stringify(a) === JSON.stringify(b);
}

export async function gzipChunk(chunk: RoomHistoryChunk): Promise<Uint8Array> {
	return gzipAsync(Buffer.from(JSON.stringify(chunk)));
}

export async function gunzipChunk(gz: Uint8Array): Promise<RoomHistoryChunk> {
	const buf = await gunzipAsync(gz);
	return JSON.parse(buf.toString('utf8')) as RoomHistoryChunk;
}
