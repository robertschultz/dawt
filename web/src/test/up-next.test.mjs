import assert from 'node:assert/strict';
import test from 'node:test';
import { upNext } from '../up-next.mjs';

const records = ['One', 'Two', 'Three', 'Four', 'Five'].map((title, id) =>
  ({ id: String(id), title, artist: 'Fixture Artist' }));

test('Up Next stays visible as the queue grows across three handoffs', () => {
  const active = { active: true, playing: true };
  const snapshots = [
    { currentId: '0', committed: records[1] },
    { currentId: '1', committed: records[1], mixing: true, rolling: 'searching' },
    { currentId: '1', staged: records.slice(0, 3) },
    { currentId: '2', committed: records[3] },
    { currentId: '3' },
    { currentId: '3', staged: records },
  ];
  const rows = snapshots.map(snapshot => upNext({ ...active, ...snapshot }));
  assert.ok(rows.every(row => row.visible));
  assert.deepEqual(rows.map(row => row.label), [
    'Two · Fixture Artist', 'Finding a track', 'Three · Fixture Artist',
    'Four · Fixture Artist', 'End of queue', 'Five · Fixture Artist',
  ]);
  assert.equal(rows[2].preparing, records[2]);
  assert.equal(rows[2].upcoming, null);
});

test('a held active queue shows its status and an idle empty queue stays hidden', () => {
  assert.deepEqual(upNext({ active: true, playing: true, rolling: 'held' }), {
    upcoming: null, preparing: null, visible: true, label: 'No compatible track found',
  });
  assert.equal(upNext({ active: false, playing: false }).visible, false);
});
