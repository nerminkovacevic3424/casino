import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  resource,
} from '@angular/core';
import { GAME_CATALOG, type ProfileStats } from '@casino/shared-types';
import { CreditsPipe } from '@casino/ui';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';
import { errorMessage } from '../../core/api-error';

@Component({
  selector: 'cas-stats-panel',
  imports: [CreditsPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (auth.user(); as user) {
      <dl class="facts">
        <dt i18n="@@profile.name">Display name</dt>
        <dd>{{ user.displayName }}</dd>
        <dt i18n="@@profile.email">Email</dt>
        <dd>
          {{ user.email }}
          @if (user.emailVerified) {
            <span class="ok" i18n="@@profile.verified">✓ verified</span>
          } @else {
            <button
              type="button"
              class="btn btn--small"
              (click)="resend()"
              i18n="@@profile.resend"
            >
              Send verification email
            </button>
          }
        </dd>
        <dt i18n="@@profile.since">Member since</dt>
        <dd>{{ user.createdAt | date: 'longDate' }}</dd>
      </dl>
    }

    @if (stats.value(); as s) {
      <div class="tiles">
        <div class="tile">
          <span class="label" i18n="@@profile.rounds">Rounds played</span
          ><strong>{{ s.totalRounds }}</strong>
        </div>
        <div class="tile">
          <span class="label" i18n="@@profile.staked">Total staked</span
          ><strong>{{ s.totalStaked | credits }}</strong>
        </div>
        <div class="tile">
          <span class="label" i18n="@@profile.won">Total won</span
          ><strong>{{ s.totalWon | credits }}</strong>
        </div>
        <div class="tile">
          <span class="label" i18n="@@profile.biggest">Biggest win</span
          ><strong>{{ s.biggestWin | credits }}</strong>
        </div>
      </div>
      @if (s.byGame.length) {
        <table>
          <caption class="visually-hidden" i18n="@@profile.byGame">
            Results by game
          </caption>
          <thead>
            <tr>
              <th scope="col" i18n="@@profile.game">Game</th>
              <th scope="col" class="num" i18n="@@profile.roundsCol">Rounds</th>
              <th scope="col" class="num" i18n="@@profile.stakedCol">Staked</th>
              <th scope="col" class="num" i18n="@@profile.wonCol">Won</th>
              <th scope="col" class="num" i18n="@@profile.returnCol">Return</th>
            </tr>
          </thead>
          <tbody>
            @for (g of s.byGame; track g.gameId) {
              <tr>
                <th scope="row">{{ name(g.gameId) }}</th>
                <td class="num">{{ g.rounds }}</td>
                <td class="num">{{ g.staked | credits }}</td>
                <td class="num">{{ g.won | credits }}</td>
                <td class="num">
                  {{
                    g.staked ? ((g.won / g.staked) * 100).toFixed(1) + '%' : '—'
                  }}
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="muted" i18n="@@profile.statsNote">
          Short-term results vary widely; the long-run return is the game’s RTP.
        </p>
      } @else {
        <p class="muted" i18n="@@profile.noRounds">
          You have not played any rounds yet.
        </p>
      }
    }
  `,
  styles: `
    .facts {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-2) var(--space-4);
    }
    .facts dt {
      color: var(--color-text-muted);
    }
    .facts dd {
      margin: 0;
      display: flex;
      gap: var(--space-2);
      align-items: center;
      flex-wrap: wrap;
    }
    .ok {
      color: var(--color-success);
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: var(--space-3);
      margin: var(--space-5) 0;
    }
    .tile {
      display: grid;
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      background: var(--color-surface-2);
    }
    .tile strong {
      font-size: var(--font-size-xl);
      font-variant-numeric: tabular-nums;
    }
    .label {
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--color-border);
      text-align: left;
    }
    .num {
      text-align: right;
    }
    .muted {
      color: var(--color-text-muted);
      font-size: var(--font-size-sm);
    }
  `,
})
export class StatsPanelComponent {
  protected readonly auth = inject(AuthStore);
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);
  protected readonly stats = resource({
    loader: () =>
      firstValueFrom(this.http.get<ProfileStats>('/api/profile/stats')),
  });

  protected name(id: string): string {
    return GAME_CATALOG.find((g) => g.id === id)?.name ?? id;
  }

  protected async resend(): Promise<void> {
    try {
      await this.auth.resendVerification();
      this.toasts.success(
        $localize`:@@profile.sent:Check your inbox for the verification link.`,
      );
    } catch (err) {
      this.toasts.error(errorMessage(err));
    }
  }
}
