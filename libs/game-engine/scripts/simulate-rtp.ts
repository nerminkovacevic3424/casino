/**
 * RTP simulation for every slot config.
 *
 *   pnpm nx run game-engine:simulate                       # 10M spins per game, report only
 *   pnpm nx run game-engine:rtp-check                      # same, exit 1 if RTP drifts > ±0.5%
 *   pnpm tsx libs/game-engine/scripts/simulate-rtp.ts --game megaways --spins 2000000 --seed 7 --json
 *
 * Spins are split into fixed-size chunks with their own derived seed, so the
 * result for a given --seed is identical regardless of how many workers run.
 */
import { availableParallelism } from 'node:os';
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';
import {
  SLOT_CONFIGS,
  SeededRng,
  SimulationReport,
  SimulationTotals,
  emptyTotals,
  getSlotConfig,
  mergeTotals,
  runSpins,
  toReport,
} from '../src/index';

const CHUNK = 1_000_000;

interface Job {
  gameId: string;
  chunk: number;
  spins: number;
  seed: number;
}

interface Options {
  games: string[];
  spins: number;
  seed: number;
  workers: number;
  check: boolean;
  tolerance: number;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const game = get('game') ?? 'all';
  const games = game === 'all' ? Object.keys(SLOT_CONFIGS) : game.split(',');
  games.forEach(getSlotConfig); // fail fast on typos
  const opts: Options = {
    games,
    spins: Number(get('spins') ?? 10_000_000),
    seed: Number(get('seed') ?? 20261021),
    workers: Number(get('workers') ?? Math.max(1, availableParallelism() - 1)),
    check: argv.includes('--check'),
    tolerance: Number(get('tolerance') ?? 0.005),
    json: argv.includes('--json'),
  };
  if (!Number.isInteger(opts.spins) || opts.spins <= 0)
    throw new Error('--spins must be a positive integer');
  if (!Number.isInteger(opts.workers) || opts.workers <= 0)
    throw new Error('--workers must be a positive integer');
  return opts;
}

/** Chunk seeds mix the base seed, game and chunk index so every chunk is an independent stream. */
function chunkSeed(base: number, gameId: string, chunk: number): number {
  let h = base >>> 0;
  for (const ch of `${gameId}:${chunk}`)
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return h;
}

function runJob(job: Job): SimulationTotals {
  return runSpins(
    getSlotConfig(job.gameId),
    job.spins,
    new SeededRng(job.seed),
  );
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const jobs: Job[] = [];
  for (const gameId of opts.games) {
    for (let chunk = 0, left = opts.spins; left > 0; chunk++, left -= CHUNK) {
      jobs.push({
        gameId,
        chunk,
        spins: Math.min(CHUNK, left),
        seed: chunkSeed(opts.seed, gameId, chunk),
      });
    }
  }

  const totals = new Map<string, SimulationTotals>(
    opts.games.map((g) => [g, emptyTotals()]),
  );
  const started = Date.now();
  let done = 0;
  const workerCount = Math.min(opts.workers, jobs.length);
  const queue = [...jobs];

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      const worker = new Worker(__filename, { workerData: { worker: true } });
      try {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const current = job;
          const result = await new Promise<SimulationTotals>(
            (resolve, reject) => {
              const onMessage = (totals: SimulationTotals) => {
                worker.off('error', onError);
                resolve(totals);
              };
              const onError = (err: Error) => {
                worker.off('message', onMessage);
                reject(err);
              };
              worker.once('message', onMessage);
              worker.once('error', onError);
              worker.postMessage(current);
            },
          );
          totals.set(
            current.gameId,
            mergeTotals(totals.get(current.gameId) ?? emptyTotals(), result),
          );
          done++;
          if (!opts.json)
            process.stderr.write(`\r  ${done}/${jobs.length} chunks`);
        }
      } finally {
        await worker.terminate();
      }
    }),
  );
  if (!opts.json) process.stderr.write('\n');

  const reports: SimulationReport[] = opts.games.map((g) =>
    toReport(getSlotConfig(g), totals.get(g) ?? emptyTotals()),
  );
  const failures = reports.filter(
    (r) => Math.abs(r.rtp - r.targetRtp) > opts.tolerance,
  );

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ seed: opts.seed, spins: opts.spins, reports }, null, 2) +
        '\n',
    );
  } else {
    const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
    console.table(
      reports.map((r) => ({
        game: r.gameId,
        spins: r.spins,
        'target RTP': pct(r.targetRtp),
        'actual RTP': pct(r.rtp),
        '±95% CI': pct(r.confidence95),
        'hit freq': pct(r.hitFrequency),
        volatility: r.volatility.toFixed(2),
        'max win (x)': r.maxWinX,
        'free spins 1 in': r.freeSpinTriggers
          ? Math.round(r.spins / r.freeSpinTriggers)
          : '-',
        'bonus 1 in': r.bonusTriggers
          ? Math.round(r.spins / r.bonusTriggers)
          : '-',
      })),
    );
    console.log(
      `seed ${opts.seed}, ${workerCount} workers, ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    for (const r of reports) {
      if (r.confidence95 > opts.tolerance) {
        console.warn(
          `warning: ${r.gameId} 95% CI (±${pct(r.confidence95)}) exceeds the tolerance; use more spins`,
        );
      }
    }
  }

  if (opts.check) {
    if (failures.length > 0) {
      for (const f of failures) {
        console.error(
          `RTP check FAILED for ${f.gameId}: ${f.rtp} vs target ${f.targetRtp} (±${opts.tolerance})`,
        );
      }
      process.exit(1);
    }
    if (!opts.json) console.log(`RTP check passed (±${opts.tolerance * 100}%)`);
  }
}

if (isMainThread) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
} else if ((workerData as { worker?: boolean } | null)?.worker) {
  parentPort?.on('message', (job: Job) => parentPort?.postMessage(runJob(job)));
}
