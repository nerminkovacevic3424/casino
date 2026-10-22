import { HttpClient, httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import type { AdminGameStats, AdminOverview } from '@casino/shared-types';
import { CreditsPipe } from '@casino/ui';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-error';
import { ToastService } from '../../core/toast.service';

const WINDOWS = [
  { hours: 1, label: $localize`:@@admin.window1h:Last hour` },
  { hours: 24, label: $localize`:@@admin.window24h:Last 24 hours` },
  { hours: 24 * 7, label: $localize`:@@admin.window7d:Last 7 days` },
  { hours: 24 * 30, label: $localize`:@@admin.window30d:Last 30 days` },
];

/** Observed RTP this far from target is flagged (small samples swing widely). */
const RTP_TOLERANCE = 0.05;
const MIN_ROUNDS_FOR_FLAG = 1000;

@Component({
  selector: 'cas-admin-overview',
  imports: [CreditsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin.scss',
  template: `
    <div class="toolbar">
      <div class="field">
        <label for="adm-window" i18n="@@admin.window">Period</label>
        <select
          id="adm-window"
          (change)="hours.set(+$any($event.target).value)"
        >
          @for (w of windows; track w.hours) {
            <option [value]="w.hours" [selected]="w.hours === hours()">
              {{ w.label }}
            </option>
          }
        </select>
      </div>
      <button
        type="button"
        class="btn btn--small"
        (click)="data.reload()"
        i18n="@@admin.refresh"
      >
        Refresh
      </button>
    </div>

    @if (data.error()) {
      <div class="alert alert--error" role="alert">
        {{ errorText(data.error()) }}
      </div>
    }

    @if (data.value(); as o) {
      <div class="tiles">
        <div class="tile">
          <span class="label" i18n="@@admin.players">Players</span>
          <strong>{{ o.users.total }}</strong>
          <span class="muted" i18n="@@admin.playersSub"
            >{{ o.users.new24h }} new · {{ o.users.active24h }} active
            (24h)</span
          >
        </div>
        <div class="tile">
          <span class="label" i18n="@@admin.rounds">Rounds</span>
          <strong>{{ o.totals.rounds }}</strong>
        </div>
        <div class="tile">
          <span class="label" i18n="@@admin.staked">Staked</span>
          <strong>{{ o.totals.staked | credits }}</strong>
        </div>
        <div class="tile">
          <span class="label" i18n="@@admin.ggr">House result</span>
          <strong [class.neg]="o.totals.staked - o.totals.paid < 0">{{
            o.totals.staked - o.totals.paid | credits
          }}</strong>
        </div>
        <div class="tile">
          <span class="label" i18n="@@admin.circulation"
            >Credits in wallets</span
          >
          <strong>{{ o.totals.creditsInCirculation | credits }}</strong>
        </div>
        <div class="tile">
          <span class="label" i18n="@@admin.jackpot">Jackpot pool</span>
          <strong>{{ o.jackpot | credits }}</strong>
        </div>
      </div>

      <h3 i18n="@@admin.games">Games</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" i18n="@@admin.game">Game</th>
              <th scope="col" class="num" i18n="@@admin.roundsCol">Rounds</th>
              <th scope="col" class="num" i18n="@@admin.playersCol">Players</th>
              <th scope="col" class="num" i18n="@@admin.stakedCol">Staked</th>
              <th scope="col" class="num" i18n="@@admin.paidCol">Paid</th>
              <th scope="col" class="num" i18n="@@admin.rtpTarget">
                Target RTP
              </th>
              <th scope="col" class="num" i18n="@@admin.rtpObserved">
                Observed RTP
              </th>
              <th scope="col" i18n="@@admin.status">Status</th>
            </tr>
          </thead>
          <tbody>
            @for (g of o.games; track g.gameId) {
              <tr>
                <th scope="row">{{ g.name }}</th>
                <td class="num">{{ g.rounds }}</td>
                <td class="num">{{ g.players }}</td>
                <td class="num">{{ g.staked | credits }}</td>
                <td class="num">{{ g.paid | credits }}</td>
                <td class="num">{{ pct(g.targetRtp) }}</td>
                <td class="num">
                  @if (g.observedRtp === null) {
                    <span class="muted">—</span>
                  } @else {
                    <span [class.neg]="flagged(g)">{{
                      pct(g.observedRtp)
                    }}</span>
                    @if (flagged(g)) {
                      <span
                        class="pill pill--warn"
                        i18n-title="@@admin.rtpFlagTitle"
                        title="More than 5 points from target over 1,000+ rounds"
                        i18n="@@admin.rtpFlag"
                        >check</span
                      >
                    }
                  }
                </td>
                <td>
                  <button
                    type="button"
                    class="btn btn--small"
                    [class.btn--danger]="g.enabled"
                    [disabled]="busy() === g.gameId"
                    (click)="toggle(g)"
                    [attr.aria-label]="toggleLabel(g)"
                  >
                    @if (g.enabled) {
                      <ng-container i18n="@@admin.disable"
                        >Turn off</ng-container
                      >
                    } @else {
                      <ng-container i18n="@@admin.enable">Turn on</ng-container>
                    }
                  </button>
                  <span
                    class="pill"
                    [class.pill--ok]="g.enabled"
                    [class.pill--bad]="!g.enabled"
                  >
                    @if (g.enabled) {
                      <ng-container i18n="@@admin.live">Live</ng-container>
                    } @else {
                      <ng-container i18n="@@admin.off">Off</ng-container>
                    }
                  </span>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted" i18n="@@admin.rtpNote">
        Observed RTP converges on the target only over many rounds. Turning a
        game off stops new rounds at once; open blackjack and poker hands can
        still finish.
      </p>
    }
  `,
})
export class AdminOverviewComponent {
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);

  protected readonly windows = WINDOWS;
  protected readonly hours = signal(24);
  protected readonly busy = signal<string | null>(null);
  protected readonly data = httpResource<AdminOverview>(
    () => `/api/admin/overview?hours=${this.hours()}`,
  );

  protected pct(v: number): string {
    return `${(v * 100).toFixed(2)}%`;
  }

  protected flagged(g: AdminGameStats): boolean {
    return (
      g.observedRtp !== null &&
      g.rounds >= MIN_ROUNDS_FOR_FLAG &&
      Math.abs(g.observedRtp - g.targetRtp) > RTP_TOLERANCE
    );
  }

  protected toggleLabel(g: AdminGameStats): string {
    return g.enabled
      ? $localize`:@@admin.disableLabel:Turn off ${g.name}:name:`
      : $localize`:@@admin.enableLabel:Turn on ${g.name}:name:`;
  }

  protected errorText(err: unknown): string {
    return errorMessage(err);
  }

  protected async toggle(g: AdminGameStats): Promise<void> {
    this.busy.set(g.gameId);
    try {
      await firstValueFrom(
        this.http.put(`/api/admin/games/${g.gameId}`, { enabled: !g.enabled }),
      );
      this.toasts.success(
        g.enabled
          ? $localize`:@@admin.disabledToast:${g.name}:name: is now off.`
          : $localize`:@@admin.enabledToast:${g.name}:name: is live again.`,
      );
      this.data.reload();
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.busy.set(null);
    }
  }
}
