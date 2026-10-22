import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { JackpotState } from '@casino/shared-types';
import { CreditsPipe, formatCredits } from '@casino/ui';
import { firstValueFrom } from 'rxjs';
import { Announcer } from '../../core/announcer.service';
import { PreferencesStore } from '../../core/preferences.store';
import { RealtimeService } from '../../core/realtime.service';

const POLL_MS = 15_000;

/**
 * Live community jackpot. Signed-in players get pushes over the socket;
 * visitors poll. The figure counts up smoothly to each new value.
 */
@Component({
  selector: 'cas-jackpot-ticker',
  imports: [CreditsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ticker" aria-labelledby="jackpot-label">
      <span id="jackpot-label" class="ticker__label" i18n="@@jackpot.label"
        >Community jackpot</span
      >
      <!-- The animated figure is hidden from screen readers; they get the rounded value below. -->
      <span class="ticker__amount" aria-hidden="true" data-testid="jackpot">{{
        shown() | credits
      }}</span>
      <span class="visually-hidden">{{ target() | credits }}</span>
      @if (lastWin(); as win) {
        <span class="ticker__last" i18n="@@jackpot.last"
          >Last won by {{ win.displayName }}: {{ win.amount | credits }}</span
        >
      } @else {
        <span class="ticker__last" i18n="@@jackpot.how"
          >Any slot spin can win it — bigger bets, better odds.</span
        >
      }
    </section>
  `,
  styles: `
    .ticker {
      display: grid;
      gap: var(--space-1);
      justify-items: center;
      padding: var(--space-4) var(--space-5);
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, #3a2a05, #1d1504 60%, #3a2a05);
      border: 2px solid var(--color-primary);
      box-shadow: 0 0 30px rgb(245 197 66 / 18%);
      text-align: center;
    }
    .ticker__label {
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: var(--font-size-xs);
      color: var(--color-primary);
    }
    .ticker__amount {
      font-size: clamp(2rem, 7vw, 3.4rem);
      font-weight: var(--font-weight-bold);
      font-variant-numeric: tabular-nums;
      color: #fff3c4;
      text-shadow: 0 0 18px rgb(245 197 66 / 50%);
    }
    .ticker__last {
      font-size: var(--font-size-sm);
      color: var(--color-text-muted);
    }
  `,
})
export class JackpotTickerComponent {
  private readonly http = inject(HttpClient);
  private readonly realtime = inject(RealtimeService);
  private readonly prefs = inject(PreferencesStore);
  private readonly announcer = inject(Announcer);

  private readonly fetched = signal<JackpotState | null>(null);
  protected readonly target = computed(
    () => this.realtime.jackpot() ?? this.fetched()?.amount ?? 0,
  );
  protected readonly lastWin = computed(
    () => this.realtime.jackpotWin() ?? this.fetched()?.lastWin ?? null,
  );
  protected readonly shown = signal(0);
  private frame = 0;

  constructor() {
    void this.load();
    const timer = setInterval(() => {
      if (!this.realtime.connected()) void this.load();
    }, POLL_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      cancelAnimationFrame(this.frame);
    });

    // Count up (or jump, with reduced motion) to every new amount.
    effect(() => {
      const to = this.target();
      untracked(() => this.animateTo(to));
    });

    let lastAnnounced: string | null = null;
    effect(() => {
      const win = this.realtime.jackpotWin();
      if (win && win.wonAt !== lastAnnounced) {
        lastAnnounced = win.wonAt;
        untracked(() =>
          this.announcer.announce(
            $localize`:@@jackpot.won:${win.displayName}:name: just won the jackpot: ${formatCredits(win.amount)}:amount: credits!`,
          ),
        );
      }
    });
  }

  private async load(): Promise<void> {
    try {
      this.fetched.set(
        await firstValueFrom(this.http.get<JackpotState>('/api/jackpot')),
      );
    } catch {
      // Keep showing the last known amount.
    }
  }

  private animateTo(to: number): void {
    cancelAnimationFrame(this.frame);
    const from = this.shown();
    if (this.prefs.reducedMotion() || from === 0 || Math.abs(to - from) > to) {
      this.shown.set(to);
      return;
    }
    const start = performance.now();
    const duration = 900;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      this.shown.set(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }
}
