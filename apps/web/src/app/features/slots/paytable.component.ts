import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { LinesSlotConfig } from '@casino/game-engine';
import { CreditsPipe } from '@casino/ui';

interface PayRow {
  id: string;
  name: string;
  pays: { count: number; multiplier: number; credits: number }[];
}

/** Paytable, paylines and feature rules, computed from the same config the server uses. */
@Component({
  selector: 'cas-paytable',
  imports: [CreditsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="intro">
      <ng-container i18n="@@paytable.intro">
        Line wins pay left to right on adjacent reels, highest win per line
        only. Pays are shown for the current bet of
      </ng-container>
      <strong>{{ totalBet() | credits }}</strong
      >.
    </p>

    <table class="pays">
      <caption class="visually-hidden" i18n="@@paytable.caption">
        Symbol pays
      </caption>
      <thead>
        <tr>
          <th scope="col" i18n="@@paytable.symbol">Symbol</th>
          <th scope="col" i18n="@@paytable.pays">Pays</th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.id) {
          <tr>
            <th scope="row">{{ row.name }}</th>
            <td>
              @for (p of row.pays; track p.count) {
                <span class="pay"
                  ><span class="count">{{ p.count }}×</span>
                  {{ p.credits | credits }}</span
                >
              }
            </td>
          </tr>
        }
      </tbody>
    </table>

    @if (config().scatter; as scatter) {
      <h3 i18n="@@paytable.scatterTitle">Scatter</h3>
      <p i18n="@@paytable.scatter">
        Scatters pay anywhere on the reels, as a multiple of the total bet.
      </p>
      @if (scatter.freeSpins; as fs) {
        <p i18n="@@paytable.freeSpins">
          {{ fs.minCount }} or more scatters award {{ fs.spins }} free spins
          with all wins ×{{ fs.multiplier }}. Free spins can retrigger (+{{
            fs.retriggerSpins
          }}, up to {{ fs.maxTotalSpins }}).
        </p>
      }
    }
    @if (config().pickBonus; as bonus) {
      <h3 i18n="@@paytable.bonusTitle">Bonus game</h3>
      <p i18n="@@paytable.bonus">
        A bonus symbol on reels {{ bonusReels() }} starts the pick-me bonus:
        open boxes to collect prizes until you find “Collect”.
      </p>
    }
    @if (wildName(); as wild) {
      <p i18n="@@paytable.wild">
        {{ wild }} substitutes for every symbol except scatters and bonus
        symbols.
      </p>
    }

    <h3 i18n="@@paytable.lines">Paylines ({{ config().paylines.length }})</h3>
    <ol class="lines">
      @for (line of config().paylines; track $index) {
        <li>
          <svg
            [attr.viewBox]="
              '0 0 ' + config().reels.length * 10 + ' ' + config().rows * 10
            "
            role="img"
            [attr.aria-label]="lineLabel($index, line)"
          >
            @for (row of rowsArray(); track row) {
              @for (reel of reelsArray(); track reel) {
                <rect
                  [attr.x]="reel * 10 + 1"
                  [attr.y]="row * 10 + 1"
                  width="8"
                  height="8"
                  rx="2"
                  [class.on]="line[reel] === row"
                />
              }
            }
          </svg>
        </li>
      }
    </ol>

    <p class="rtp" i18n="@@paytable.rtp">
      Theoretical return to player:
      {{ (config().targetRtp * 100).toFixed(2) }}%. Maximum win
      {{ config().maxWinMultiplier }}× the bet. Every outcome is generated on
      the server and can be verified on the Verify page.
    </p>
  `,
  styles: `
    .intro,
    .rtp {
      color: var(--color-text-muted);
    }
    .pays {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: var(--space-4);
    }
    .pays th,
    .pays td {
      padding: var(--space-2);
      border-bottom: 1px solid var(--color-border);
      text-align: left;
    }
    .pay {
      display: inline-block;
      margin-right: var(--space-4);
      font-variant-numeric: tabular-nums;
    }
    .count {
      color: var(--color-primary);
      font-weight: var(--font-weight-bold);
    }
    .lines {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: var(--space-3);
      padding-left: var(--space-5);
    }
    .lines svg {
      width: 100%;
      height: auto;
    }
    rect {
      fill: var(--color-surface-3);
    }
    rect.on {
      fill: var(--color-primary);
    }
  `,
})
export class PaytableComponent {
  readonly config = input.required<LinesSlotConfig>();
  readonly totalBet = input.required<number>();

  protected readonly rows = computed<PayRow[]>(() => {
    const config = this.config();
    const lineBet = this.totalBet() / config.betDivisor;
    return config.symbols
      .filter((s) => config.paytable[s.id])
      .map((s) => ({
        id: s.id,
        name: s.name,
        pays: Object.entries(config.paytable[s.id])
          .map(([count, multiplier]) => ({
            count: Number(count),
            multiplier: multiplier as number,
            credits: lineBet * (multiplier as number),
          }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort(
        (a, b) => (b.pays[0]?.multiplier ?? 0) - (a.pays[0]?.multiplier ?? 0),
      );
  });

  protected readonly wildName = computed(
    () => this.config().symbols.find((s) => s.kind === 'wild')?.name ?? null,
  );
  protected readonly bonusReels = computed(
    () =>
      this.config()
        .pickBonus?.triggerReels.map((r) => r + 1)
        .join(', ') ?? '',
  );
  protected readonly rowsArray = computed(() =>
    Array.from({ length: this.config().rows }, (_, i) => i),
  );
  protected readonly reelsArray = computed(() =>
    Array.from({ length: this.config().reels.length }, (_, i) => i),
  );

  protected lineLabel(index: number, line: readonly number[]): string {
    const rows = line.map((r) => r + 1).join('-');
    return $localize`:@@paytable.lineLabel:Line ${index + 1}:line:: rows ${rows}:rows:`;
  }
}
