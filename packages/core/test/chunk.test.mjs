import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDiff } from '../dist/chunk.js';

// `getDiff` emits diffs for the replay client's deep recursive merge
// (`_.merge(state[id], diff[id])`): the full new value of a changed property
// plus explicit `null` tombstones for keys dropped since the previous tick.

test('a finished action is tombstoned so it stops animating', () => {
	// Creep upgrades a controller, then moves away and goes idle. xxscreeps
	// renders the idle tick as `actionLog: {}` (no active actions).
	const prev = { c1: { _id: 'c1', x: 10, y: 20, actionLog: { upgradeController: { x: 11, y: 21 } } } };
	const next = { c1: { _id: 'c1', x: 12, y: 22, actionLog: {} } };
	// Without the null, a deep merge of `{}` is a no-op and the upgrade
	// animation never clears.
	assert.deepEqual(getDiff(prev, next), {
		c1: { x: 12, y: 22, actionLog: { upgradeController: null } },
	});
});

test('removed object -> null', () => {
	const prev = { a: { _id: 'a', x: 1, y: 1 } };
	const next = {};
	assert.deepEqual(getDiff(prev, next), { a: null });
});

test('added object -> full value', () => {
	const prev = {};
	const next = { a: { _id: 'a', x: 1, y: 1 } };
	assert.deepEqual(getDiff(prev, next), { a: { _id: 'a', x: 1, y: 1 } });
});

test('unchanged object -> no entry in diff', () => {
	const obj = { _id: 'a', x: 1, y: 1, store: { energy: 50 } };
	assert.deepEqual(getDiff({ a: obj }, { a: { ...obj, store: { energy: 50 } } }), {});
});

test('changed nested key emits new value and keeps unchanged siblings', () => {
	const prev = { a: { _id: 'a', store: { energy: 50, power: 10 } } };
	const next = { a: { _id: 'a', store: { energy: 80, power: 10 } } };
	// Full new store value (the client deep-merges; siblings are preserved either way).
	assert.deepEqual(getDiff(prev, next), { a: { store: { energy: 80, power: 10 } } });
});

test('dropped nested key is tombstoned', () => {
	const prev = { a: { _id: 'a', store: { energy: 50, power: 10 } } };
	const next = { a: { _id: 'a', store: { energy: 50 } } };
	assert.deepEqual(getDiff(prev, next), { a: { store: { energy: 50, power: null } } });
});

test('removed top-level property is tombstoned', () => {
	const prev = { a: { _id: 'a', x: 1, fatigue: 5 } };
	const next = { a: { _id: 'a', x: 1 } };
	assert.deepEqual(getDiff(prev, next), { a: { fatigue: null } });
});

test('arrays are replaced wholesale, not merged', () => {
	const prev = { a: { _id: 'a', body: [ { type: 'move' }, { type: 'work' } ] } };
	const next = { a: { _id: 'a', body: [ { type: 'move' } ] } };
	assert.deepEqual(getDiff(prev, next), { a: { body: [ { type: 'move' } ] } });
});
