import type { Room } from 'xxscreeps/game/room/index.js';
import type { World } from 'xxscreeps/game/map.js';
import { Render } from 'xxscreeps/backend/symbols.js';
import { runOneShot } from 'xxscreeps/game/index.js';
import type { RoomObject, RoomObjectMap } from './types.js';

/**
 * Render every object in a room into the same `_id`-keyed map the live room
 * socket sends to the client (`object[Render](undefined)` -> full object). This
 * reuses xxscreeps' backend render pipeline so history matches the live view.
 *
 * The room must already be initialized (`shard.loadRoom` does this by default).
 */
export function renderRoomObjects(world: World, room: Room, time: number): RoomObjectMap {
	return runOneShot(world, room, time, '0', () => {
		const objects: RoomObjectMap = {};
		// `#objects` is xxscreeps-internal; access via bracket notation.
		for (const object of (room as any)['#objects'] as Iterable<any>) {
			const value = object[Render]?.(undefined) as RoomObject | undefined;
			if (value?._id) {
				objects[value._id] = value;
			}
		}
		return objects;
	});
}
