import type { HistoryOptions } from './storage.js';

export type HistoryConfig = HistoryOptions;

/** Merged into `xxscreeps/config` at runtime (see config.schema.json). */
export const defaults = {
	history: {
		storage: 'file',
		path: './screeps/history',
		chunkSize: 100,
		keepTicks: 200000,
		cleanupInterval: 1000,
		capture: true,
	},
};

/** Written to `.screepsrc.yaml` on first run as a guide. */
export const initializationDefaults = {
	history: {
		storage: 'file',
		path: './screeps/history',
	},
};
