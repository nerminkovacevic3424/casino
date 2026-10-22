import type { Ticker } from 'pixi.js';

export type Easing = (t: number) => number;
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - t, 3);
export const easeInQuad: Easing = (t) => t * t;
export const easeOutBounce: Easing = (t) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

interface Tween {
  readonly apply: (t: number) => void;
  readonly duration: number;
  readonly delay: number;
  readonly ease: Easing;
  elapsed: number;
  readonly resolve: () => void;
}

/** Minimal promise-based tweening on the Pixi ticker (no extra dependency). */
export class Tweener {
  private readonly tweens = new Set<Tween>();

  constructor(private readonly ticker: Ticker) {
    ticker.add(this.update);
  }

  get active(): boolean {
    return this.tweens.size > 0;
  }

  /** Interpolates numeric properties of `target` to `to` over `duration` ms. */
  to(
    target: object,
    to: Readonly<Record<string, number>>,
    duration: number,
    { ease = easeOutCubic, delay = 0 }: { ease?: Easing; delay?: number } = {},
  ): Promise<void> {
    const record = target as Record<string, number>;
    const from = Object.fromEntries(Object.keys(to).map((k) => [k, record[k]]));
    if (duration <= 0) {
      Object.assign(target, to);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.add({
        duration,
        delay,
        ease,
        elapsed: 0,
        resolve,
        apply: (t) => {
          for (const [k, v] of Object.entries(to))
            record[k] = from[k] + (v - from[k]) * t;
        },
      });
      this.ticker.start();
    });
  }

  wait(ms: number): Promise<void> {
    return this.to({ v: 0 }, { v: 1 }, ms);
  }

  destroy(): void {
    this.ticker.remove(this.update);
    for (const tween of this.tweens) tween.resolve();
    this.tweens.clear();
  }

  private readonly update = (ticker: Ticker): void => {
    const dt = Math.min(ticker.deltaMS, 50);
    for (const tween of this.tweens) {
      tween.elapsed += dt;
      const local = tween.elapsed - tween.delay;
      if (local < 0) continue;
      const t = Math.min(1, local / tween.duration);
      tween.apply(tween.ease(t));
      if (t >= 1) {
        this.tweens.delete(tween);
        tween.resolve();
      }
    }
  };
}
