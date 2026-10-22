// Synthesises the game's sound effects as small 16-bit mono WAV files, so the
// repo carries no third-party audio. Re-run after changing a recipe:
//   node apps/web/scripts/generate-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22_050;
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'sounds',
);

const envelope = (t, duration, attack = 0.005, release = 0.08) =>
  Math.min(1, t / attack) * Math.min(1, Math.max(0, (duration - t) / release));

/** Sum of partial notes: [startSeconds, durationSeconds, frequencyHz, gain, type]. */
function render(duration, notes) {
  const samples = new Float32Array(Math.ceil(duration * RATE));
  for (const [start, length, freq, gain, type = 'sine'] of notes) {
    const from = Math.floor(start * RATE);
    const to = Math.min(samples.length, from + Math.floor(length * RATE));
    for (let i = from; i < to; i++) {
      const t = (i - from) / RATE;
      const phase =
        2 * Math.PI * (typeof freq === 'function' ? freq(t) : freq) * t;
      let v;
      if (type === 'square') v = Math.sign(Math.sin(phase)) * 0.5;
      else if (type === 'noise') v = Math.random() * 2 - 1;
      else if (type === 'triangle')
        v = (2 / Math.PI) * Math.asin(Math.sin(phase));
      else v = Math.sin(phase);
      samples[i] += v * gain * envelope(t, length);
    }
  }
  return samples;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const scale = peak > 0.95 ? 0.95 / peak : 1;
  samples.forEach((s, i) =>
    data.writeInt16LE(Math.round(s * scale * 32767), i * 2),
  );
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const C5 = 523.25,
  E5 = 659.25,
  G5 = 783.99,
  C6 = 1046.5,
  E6 = 1318.5,
  G6 = 1568;

const sounds = {
  click: render(0.06, [[0, 0.05, 1800, 0.5, 'triangle']]),
  spin: render(0.7, [
    [0, 0.7, (t) => 180 + 120 * t, 0.25, 'square'],
    [0, 0.7, 0, 0.08, 'noise'],
  ]),
  stop: render(0.14, [
    [0, 0.12, (t) => 220 - 600 * t, 0.7, 'sine'],
    [0, 0.03, 0, 0.3, 'noise'],
  ]),
  win: render(0.55, [
    [0, 0.15, C5, 0.4, 'triangle'],
    [0.12, 0.15, E5, 0.4, 'triangle'],
    [0.24, 0.3, G5, 0.45, 'triangle'],
  ]),
  bigwin: render(1.6, [
    [0, 0.2, C5, 0.35, 'square'],
    [0.15, 0.2, E5, 0.35, 'square'],
    [0.3, 0.2, G5, 0.35, 'square'],
    [0.45, 0.25, C6, 0.4, 'square'],
    [0.7, 0.9, C6, 0.3, 'triangle'],
    [0.7, 0.9, E6, 0.25, 'triangle'],
    [0.7, 0.9, G6, 0.2, 'triangle'],
  ]),
  feature: render(1.0, [
    [0, 1.0, (t) => 300 + 900 * t, 0.3, 'triangle'],
    [0.5, 0.5, G6, 0.2, 'sine'],
  ]),
};

mkdirSync(OUT, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) {
  writeFileSync(join(OUT, `${name}.wav`), wav(samples));
  console.log(`wrote sounds/${name}.wav (${samples.length} samples)`);
}
