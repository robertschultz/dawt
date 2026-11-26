import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

function worklet() {
  let Output;
  class AudioWorkletProcessor {
    port = {};
  }
  const script = readFileSync(new URL('../virtualdj-worklet.js', import.meta.url), 'utf8');
  runInNewContext(script, { AudioWorkletProcessor, sampleRate: 48_000, registerProcessor(name, Constructor) {
    assert.equal(name, 'virtualdj-output');
    Output = Constructor;
  } });
  return new Output();
}

test('VirtualDJ browser audio buffers stereo PCM and drops the previous generation', () => {
  const output = worklet();
  const render = () => {
    const channels = [new Float32Array(128), new Float32Array(128)];
    assert.equal(output.process([], [channels]), true);
    return channels;
  };
  assert.ok(render().every(channel => channel.every(value => value === 0)));
  const pcm = new Int16Array(4_000 * 2);
  for (let index = 0; index < pcm.length; index += 2) {
    pcm[index] = 8192;
    pcm[index + 1] = -4096;
  }
  output.port.onmessage({ data: { pcm, rate: 48_000, generation: 1 } });
  const [left, right] = render();
  assert.ok(left.every(value => value === .25));
  assert.ok(right.every(value => value === -.125));
  output.port.onmessage({ data: { pcm: new Int16Array(2), rate: 48_000, generation: 2 } });
  assert.ok(render().every(channel => channel.every(value => value === 0)));
});

test('music ducks for Dot’s reply and returns to the listener’s exact volume', () => {
  const music = { volume: .8 };
  const voice = { volume: 1 };
  const frames = [];
  let time = 0;
  const script = readFileSync(new URL('../talk-mix.js', import.meta.url), 'utf8').replace('export function', 'function');
  const createTalkMix = runInNewContext(`${script}\ncreateTalkMix`, {
    performance: { now: () => time }, requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
  });
  const mix = createTalkMix(() => [music], () => voice);
  const animate = () => {
    for (let count = 0; frames.length && count < 120; count++) frames.shift()(time += 16);
    assert.equal(frames.length, 0);
  };
  mix(false);
  assert.equal(voice.volume, .5);
  mix(true);
  animate();
  assert.equal(music.volume, .8 * .23);
  assert.equal(voice.volume, 1);
  mix(false);
  animate();
  assert.equal(music.volume, .8);
  assert.equal(voice.volume, .5);
});
