import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type {
  Activity,
  LimitValues,
  ResponsibleState,
} from '@casino/shared-types';
import { firstValueFrom } from 'rxjs';

const STARTED_KEY = 'casino.session.startedAt';
const TICK_MS = 15_000;

export interface RealityCheck {
  readonly elapsedMinutes: number;
  readonly activity: Activity | null;
}

/**
 * Session time reminders. The session starts at sign-in (kept across reloads
 * in this tab). Reality checks pop up at the player's chosen interval with
 * time played and net result; the session limit signs the player out.
 */
@Injectable({ providedIn: 'root' })
export class SessionWatchService {
  private readonly http = inject(HttpClient);
  private timer: ReturnType<typeof setInterval> | null = null;
  private realityMinutes: number | null = null;
  private sessionMinutes: number | null = null;
  private nextRealityAt = 0;

  readonly startedAt = signal<number | null>(null);
  readonly realityCheck = signal<RealityCheck | null>(null);
  readonly limitReached = signal(false);

  async start(): Promise<void> {
    if (this.timer) return;
    const stored = Number(sessionStorage.getItem(STARTED_KEY));
    const startedAt =
      Number.isFinite(stored) && stored > 0 ? stored : Date.now();
    sessionStorage.setItem(STARTED_KEY, String(startedAt));
    this.startedAt.set(startedAt);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    try {
      const state = await firstValueFrom(
        this.http.get<ResponsibleState>('/api/responsible'),
      );
      this.configure(state.limits);
    } catch {
      // Without limits there is nothing to remind about yet.
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    sessionStorage.removeItem(STARTED_KEY);
    this.startedAt.set(null);
    this.realityCheck.set(null);
    this.limitReached.set(false);
  }

  configure(
    limits: Pick<LimitValues, 'realityCheckMinutes' | 'sessionLimitMinutes'>,
  ): void {
    this.realityMinutes = limits.realityCheckMinutes;
    this.sessionMinutes = limits.sessionLimitMinutes;
    const elapsed = this.elapsedMinutes();
    // The next reality check is the next whole interval from the session start.
    this.nextRealityAt = this.realityMinutes
      ? (Math.floor(elapsed / this.realityMinutes) + 1) * this.realityMinutes
      : 0;
    void this.tick();
  }

  dismissRealityCheck(): void {
    this.realityCheck.set(null);
  }

  elapsedMinutes(): number {
    const started = this.startedAt();
    return started ? (Date.now() - started) / 60_000 : 0;
  }

  private async tick(): Promise<void> {
    const started = this.startedAt();
    if (!started) return;
    const elapsed = this.elapsedMinutes();
    if (
      this.sessionMinutes &&
      elapsed >= this.sessionMinutes &&
      !this.limitReached()
    ) {
      this.limitReached.set(true);
      this.realityCheck.set(null);
      return;
    }
    if (
      this.realityMinutes &&
      this.nextRealityAt &&
      elapsed >= this.nextRealityAt &&
      !this.realityCheck()
    ) {
      while (this.nextRealityAt <= elapsed)
        this.nextRealityAt += this.realityMinutes;
      this.realityCheck.set({
        elapsedMinutes: Math.floor(elapsed),
        activity: await this.activity(started),
      });
    }
  }

  private async activity(since: number): Promise<Activity | null> {
    try {
      const params = new HttpParams().set(
        'since',
        new Date(since).toISOString(),
      );
      return await firstValueFrom(
        this.http.get<Activity>('/api/responsible/activity', { params }),
      );
    } catch {
      return null;
    }
  }
}
