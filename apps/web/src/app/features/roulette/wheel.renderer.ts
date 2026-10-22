import { WHEEL_ORDER, pocketColor } from '@casino/game-engine';
import { Application, Container, Graphics, Text, Ticker } from 'pixi.js';

const POCKET = (2 * Math.PI) / WHEEL_ORDER.length;
const COLOURS = { red: 0xc8273a, black: 0x15171f, green: 0x0e8a5a } as const;

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * European wheel and ball. `spinTo(n)` animates wheel and ball in opposite
 * directions and lands the ball exactly in pocket `n` (decided by the server).
 */
export class WheelRenderer {
  private readonly app = new Application();
  private readonly wheel = new Container();
  private readonly ball = new Graphics();
  private readonly marker = new Graphics();
  private radius = 100;
  private wheelAngle = 0;
  private ballAngle = -Math.PI / 2;
  private ballRadius = 0.88;
  private resting: number | null = null;
  private animation: ((ticker: Ticker) => void) | null = null;
  private destroyed = false;

  private constructor(private readonly host: HTMLElement) {}

  static async create(host: HTMLElement): Promise<WheelRenderer> {
    const renderer = new WheelRenderer(host);
    await renderer.init();
    return renderer;
  }

  private async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      autoStart: false,
      preference: 'webgl',
    });
    this.app.canvas.setAttribute('aria-hidden', 'true');
    this.app.canvas.style.display = 'block';
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.wheel, this.marker, this.ball);
    this.app.renderer.on('resize', () => this.layout());
    this.layout();
  }

  /** Spins and resolves when the ball has settled in `number`'s pocket. */
  spinTo(
    number: number,
    { reducedMotion = false, turbo = false } = {},
  ): Promise<void> {
    const index = WHEEL_ORDER.indexOf(number);
    const pocketCentre = index * POCKET;
    if (reducedMotion) {
      this.ballAngle = this.wheelAngle + pocketCentre - Math.PI / 2;
      this.ballRadius = 0.62;
      this.resting = number;
      this.draw();
      return Promise.resolve();
    }

    const duration = turbo ? 2200 : 5200;
    const wheelFrom = this.wheelAngle;
    const wheelTo = wheelFrom + 2 * Math.PI * (turbo ? 1.5 : 3);
    // Ball ends in the pocket's absolute position at the wheel's final angle,
    // after several turns the other way.
    const ballTo = wheelTo + pocketCentre - Math.PI / 2;
    const ballFrom = ballTo + 2 * Math.PI * (turbo ? 3 : 6);
    this.resting = null;

    return new Promise((resolve) => {
      let elapsed = 0;
      this.stopAnimation();
      this.animation = (ticker: Ticker) => {
        elapsed += Math.min(ticker.deltaMS, 50);
        const t = Math.min(1, elapsed / duration);
        const e = easeOutQuart(t);
        this.wheelAngle = wheelFrom + (wheelTo - wheelFrom) * e;
        this.ballAngle = ballFrom + (ballTo - ballFrom) * e;
        // The ball rides the rim, then spirals into the pockets in the last third.
        this.ballRadius =
          t < 0.65
            ? 0.88
            : 0.88 -
              (0.26 * (t - 0.65)) / 0.35 +
              0.02 * Math.sin(t * 60) * (1 - t);
        this.draw();
        if (t >= 1) {
          this.ballRadius = 0.62;
          this.resting = number;
          this.draw();
          this.stopAnimation();
          resolve();
        }
      };
      this.app.ticker.add(this.animation);
      this.app.ticker.start();
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopAnimation();
    this.app.destroy({ removeView: true }, { children: true });
  }

  private stopAnimation(): void {
    if (this.animation) this.app.ticker.remove(this.animation);
    this.animation = null;
    this.app.ticker.stop();
  }

  private layout(): void {
    const { width, height } = this.app.screen;
    this.radius = Math.min(width, height) / 2 - 6;
    this.wheel.position.set(width / 2, height / 2);
    this.buildWheel();
    this.draw();
  }

  private buildWheel(): void {
    this.wheel.removeChildren().forEach((c) => c.destroy({ children: true }));
    const R = this.radius;
    const rim = new Graphics()
      .circle(0, 0, R)
      .fill({ color: 0x5c3a1a })
      .circle(0, 0, R * 0.95)
      .fill({ color: 0x2a1a0c });
    this.wheel.addChild(rim);

    const pockets = new Graphics();
    WHEEL_ORDER.forEach((n, i) => {
      const a0 = i * POCKET - POCKET / 2 - Math.PI / 2;
      const a1 = a0 + POCKET;
      const colour = COLOURS[pocketColor(n)];
      pockets
        .moveTo(0, 0)
        .arc(0, 0, R * 0.92, a0, a1)
        .lineTo(0, 0)
        .fill({ color: colour })
        .moveTo(Math.cos(a0) * R * 0.55, Math.sin(a0) * R * 0.55)
        .lineTo(Math.cos(a0) * R * 0.92, Math.sin(a0) * R * 0.92)
        .stroke({ color: 0xd9b45a, width: Math.max(1, R * 0.008) });
    });
    this.wheel.addChild(pockets);

    WHEEL_ORDER.forEach((n, i) => {
      const angle = i * POCKET - Math.PI / 2;
      const label = new Text({
        text: String(n),
        style: {
          fontFamily: 'Arial, sans-serif',
          fontWeight: '700',
          fontSize: Math.max(8, R * 0.075),
          fill: 0xffffff,
        },
      });
      label.anchor.set(0.5);
      label.position.set(
        Math.cos(angle) * R * 0.82,
        Math.sin(angle) * R * 0.82,
      );
      label.rotation = angle + Math.PI / 2;
      this.wheel.addChild(label);
    });

    const hub = new Graphics()
      .circle(0, 0, R * 0.55)
      .fill({ color: 0x3a2412 })
      .circle(0, 0, R * 0.53)
      .stroke({ color: 0xd9b45a, width: Math.max(1, R * 0.012) })
      .circle(0, 0, R * 0.12)
      .fill({ color: 0xd9b45a });
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      hub
        .moveTo(0, 0)
        .lineTo(Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4)
        .stroke({ color: 0xd9b45a, width: R * 0.03 });
    }
    this.wheel.addChild(hub);
  }

  private draw(): void {
    if (this.destroyed) return;
    this.wheel.rotation = this.wheelAngle;
    const cx = this.wheel.x;
    const cy = this.wheel.y;
    const r = this.radius * this.ballRadius;
    this.ball
      .clear()
      .circle(
        cx + Math.cos(this.ballAngle) * r,
        cy + Math.sin(this.ballAngle) * r,
        Math.max(4, this.radius * 0.035),
      )
      .fill({ color: 0xffffff })
      .stroke({ color: 0x999999, width: 1 });
    this.marker.clear();
    if (this.resting !== null) {
      // Glow around the winning pocket.
      const a = this.ballAngle;
      this.marker
        .circle(
          cx + Math.cos(a) * this.radius * 0.73,
          cy + Math.sin(a) * this.radius * 0.73,
          this.radius * 0.11,
        )
        .stroke({ color: 0xf5c542, width: Math.max(2, this.radius * 0.02) });
    }
    this.app.render();
  }
}
