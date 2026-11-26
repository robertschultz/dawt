const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { before, after, beforeEach, test } = require('node:test');

const records = ['a', 'b', 'c', 'd'].map((letter, index) => ({
  id: 'virtualdj:' + letter.repeat(64), title: `Track ${letter.toUpperCase()}`,
  artist: 'Fixture Artist', bpm: 124 + index,
}));
const ids = records.map(track => track.id);
const token = 'local-fixture-token';
let server, adapter, session, program, agent, voice, calls, rejectAction;

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    if (req.method === 'POST') calls.push([req.url, body, req.headers['x-dj-token']]);
    let result;
    if (body && req.headers['x-dj-token'] !== token) {
      res.writeHead(403);
      result = { error: 'Fixture token missing.' };
    } else if (rejectAction && body?.action === rejectAction) {
      res.writeHead(409);
      result = { error: 'Fixture transport declined.' };
    } else if (req.url === '/api/config') result = { service: 'afterhours-music', token };
    else if (req.url === '/api/control-state') result = { program, telemetry: session.telemetry };
    else if (req.url === '/api/set-session' || req.url === '/api/library') result = session;
    else if (req.url === '/api/voice') result = voice;
    else if (req.url === '/api/dj-agent') result = agent;
    else { res.writeHead(404); result = { error: 'Fixture endpoint missing.' }; }
    res.end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env.DOT_AFTERHOURS_PORT = String(server.address().port);
  adapter = require('../native-afterhours.cjs');
});

after(async () => {
  if (!server) return;
  const closed = once(server, 'close');
  server.close();
  await closed;
});

beforeEach(() => {
  session = { id: 'fixture', phase: 'ready', active: false, index: -1, order: records.slice(0, 2),
    candidates: records, maxTempoShift: 8, telemetry: { sampledAt: Date.now() / 1000, decks: [] } };
  program = null;
  agent = { status: 'idle' };
  voice = { configured: true, model: 'gpt-live-1.1', voice: 'gleam', status: 'idle' };
  calls = [];
  rejectAction = null;
});

const requests = () => calls.map(([path, body]) => [path, body]);

test('booth starts measured, quick, and short blend sets through one Afterhours path', async t => {
  for (const scenario of [
    { label: 'measured', options: {}, seconds: 30, style: 'phrase', measured: true, blend: null },
    { label: 'quick', options: { seconds: 20 }, seconds: 20, style: 'quick', measured: false, blend: null },
    { label: 'short blend', options: { blendSeconds: 15 }, seconds: 60, style: 'quick', measured: false, blend: 15 },
  ]) {
    await t.test(scenario.label, async () => {
      calls = [];
      await adapter.run({ action: 'start', ids: ids.slice(0, 2), ...scenario.options });
      assert.deepEqual(requests(), [
        ['/api/set-session', { action: 'plan', ids: ids.slice(0, 2), seconds: scenario.seconds, excerptBars: 0,
          maxTempoShift: 8, mixStyle: scenario.style, quickBlendSeconds: scenario.blend }],
        ['/api/set-session', { action: 'start', prepareWhilePlaying: scenario.measured, rollingQueue: true }],
      ]);
      assert.ok(calls.every(call => call[2] === token));
    });
  }
});

test('booth prevents concurrent starts, duplicate tracks, and dispatch after a declined plan', async () => {
  const first = adapter.run({ action: 'start' });
  await assert.rejects(adapter.run({ action: 'start' }), { status: 409 });
  await first;
  calls = [];
  await assert.rejects(adapter.run({ action: 'start', ids: [ids[0], ids[0]] }), /unique recordings/);
  assert.deepEqual(calls, []);
  rejectAction = 'plan';
  await assert.rejects(adapter.run({ action: 'start' }), { status: 409 });
  assert.deepEqual(calls.map(call => call[1].action), ['plan']);
});

test('crate, mix, takeover and stop preserve exact native action routing', async () => {
  await adapter.run({ action: 'search', query: '  Fixture Artist  ' });
  await adapter.run({ action: 'queue', id: ids[0] });
  await adapter.run({ action: 'reorder', ids: ids.slice(0, 2).reverse() });
  Object.assign(session, { active: true, phase: 'playing', index: 0, startedAt: 12,
    executionPlan: { id: 'applied-plan', applied: true } });
  await adapter.run({ action: 'queue', id: ids[2] });
  await assert.rejects(adapter.run({ action: 'start' }), /already active/);
  await adapter.run({ action: 'mix' });
  await adapter.run({ action: 'takeover' });
  await adapter.run({ action: 'stop' });
  const history = requests();
  assert.equal(typeof history[4][1].commandId, 'string');
  delete history[4][1].commandId;
  assert.deepEqual(history, [
    ['/api/library', { action: 'search', query: 'Fixture Artist', bpmMin: 40, bpmMax: 300 }],
    ['/api/library', { action: 'queue', trackId: ids[0] }],
    ['/api/set-session', { action: 'setlist', operation: 'reorder', ids: [ids[1], ids[0]] }],
    ['/api/set-session', { action: 'insert-track', trackId: ids[2] }],
    ['/api/set-session', { action: 'copilot', command: 'go', expected: {
      sessionId: 'fixture', startedAt: 12, planId: 'applied-plan', index: 0, trackIds: ids.slice(0, 2),
    } }],
    ['/api/set-session', { action: 'takeover' }],
    ['/api/set-session', { action: 'stop' }],
  ]);
});

test('Talk delegates a fresh play request and immediate stop to Afterhours, then releases the peer', async () => {
  assert.equal((await adapter.voice({ action: 'status' })).voice, 'gleam');
  await assert.rejects(adapter.voice({ action: 'start' }), /Start Talk from the booth/);
  await adapter.voice({ action: 'start', approveRequest: true, requestId: 'talk-start', sdp: 'fixture-sdp', clientLease: true });
  const sessionId = 'talk-session';
  const play = { action: 'delegate', text: 'Please play Daft Punk', messageId: 'play-request', sessionId };
  agent = { status: 'searching', playbackRequest: { id: play.messageId, status: 'choosing', message: 'Searching', freshQueue: true } };
  assert.deepEqual(await adapter.voice(play), { message: 'Searching', working: true, phase: 'searching', freshStart: true });
  agent = { status: 'playing', playbackRequest: { ...agent.playbackRequest, status: 'playing', message: 'Playing' } };
  assert.equal((await adapter.voice({ action: 'progress', messageId: play.messageId, sessionId })).working, false);
  const stop = { action: 'delegate', text: '. Stop the music now', messageId: 'stop-request', sessionId };
  agent = { status: 'stopping', message: 'Waiting for deck confirmation' };
  await adapter.voice(stop);
  await adapter.voice({ action: 'heartbeat', sessionId });
  await adapter.voice({ action: 'usage', sessionId, seconds: 4 });
  await adapter.voice({ action: 'end', sessionId, transportClosed: true });
  assert.deepEqual(requests(), [
    ['/api/voice', { action: 'start', sdp: 'fixture-sdp', requestId: 'talk-start', approveRequest: true,
      maxSeconds: 1800, voice: 'gleam', clientLease: true }],
    ['/api/dj-agent', { action: 'message', source: 'voice', text: play.text, messageId: play.messageId,
      sessionId, queueMode: 'steer', approveRequest: true }],
    ['/api/dj-agent', { action: 'message', source: 'voice', text: stop.text, messageId: stop.messageId,
      sessionId, queueMode: 'steer', approveRequest: true }],
    ['/api/voice', { action: 'heartbeat', sessionId, finalized: false, transportClosed: false }],
    ['/api/voice', { action: 'usage', sessionId, seconds: 4, finalized: false, transportClosed: false }],
    ['/api/voice', { action: 'end', sessionId, finalized: false, transportClosed: true }],
  ]);
});

test('the booth distinguishes a staged record from the committed Up Next across handoff', async () => {
  Object.assign(session, { active: true, phase: 'mixing', index: 0,
    activeHandoff: { to: ids[1] }, queuedUpdate: { status: 'analyzing', tracks: records.slice(0, 3) },
    rollingQueue: { status: 'preparing' } });
  program = { current: ids[1], playing: true, library: records, nextTrack: null };
  let snapshot = await adapter.getState();
  assert.equal(snapshot.state.blendTitle, records[1].title);
  assert.equal(snapshot.state.staged[2].id, ids[2]);
  assert.equal(snapshot.program.nextTrack, null);
  Object.assign(session, { phase: 'playing', index: 1, order: records.slice(0, 3), queuedUpdate: null });
  program.nextTrack = records[2];
  snapshot = await adapter.getState();
  assert.equal(snapshot.program.nextTrack.id, ids[2]);
  assert.deepEqual(snapshot.state.staged, []);
});
