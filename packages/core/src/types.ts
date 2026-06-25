// Wire contract consumed by the screeps client's replay viewer.
//
// Source of truth: `screeps-connectivity` `src/types/{api,game}.ts`. Kept in
// sync here so this package has no cross-repo type dependency. The client's
// replay viewer applies each tick with a deep recursive merge:
//   _.merge(result[id], diff[id])   // partial -> deep merge (arrays replaced whole)
//   result[id] = null               // null    -> remove the object
// A dropped key is only cleared by an explicit `null` (see `getDiff` in
// chunk.ts). The `base`-tick entry is the full room state (no nulls).

export type RoomObject = Record<string, unknown> & { _id?: string };
export type RoomObjectMap = Record<string, RoomObject>;
export type RoomObjectDiff = Record<string, Partial<RoomObject> | null>;

export interface RoomHistoryChunk {
	timestamp: number;
	room: string;
	base: number;
	ticks: Record<string, RoomObjectDiff>;
}
