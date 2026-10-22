import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { BonusPick } from '@casino/game-engine';
import { CreditsPipe } from '@casino/ui';
import { Announcer } from '../../core/announcer.service';
import { SoundService } from '../../core/sound.service';

/**
 * Pick-me bonus. The prizes were drawn by the server when the bonus
 * triggered; each chest the player opens reveals the next one in that
 * sequence, so which chest is chosen does not change the result.
 */
@Component({
  selector: 'cas-bonus-pick',
  imports: [CreditsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="lead" i18n="@@bonus.lead">
      Open chests to collect prizes until you find “Collect”.
    </p>
    <ul class="chests" role="list">
      @for (box of boxes(); track box) {
        <li>
          <button
            type="button"
            class="chest"
            [class.chest--open]="opened().has(box)"
            [disabled]="finished() || opened().has(box)"
            (click)="open(box)"
            [attr.aria-label]="label(box)"
          >
            @if (revealed().get(box); as pick) {
              <span
                class="chest__prize"
                [class.collect]="pick.prize === 'collect'"
              >
                @if (pick.prize === 'collect') {
                  <ng-container i18n="@@bonus.collect">Collect</ng-container>
                } @else {
                  {{ pick.win | credits }}
                }
              </span>
            } @else {
              <span aria-hidden="true">🧰</span>
            }
          </button>
        </li>
      }
    </ul>
    <p class="total" aria-live="polite">
      <span i18n="@@bonus.total">Bonus total:</span>
      <strong>{{ total() | credits }}</strong>
    </p>
    @if (finished()) {
      <button
        type="button"
        class="btn btn--primary"
        (click)="done.emit()"
        i18n="@@bonus.continue"
      >
        Continue
      </button>
    }
  `,
  styles: `
    .lead {
      color: var(--color-text-muted);
    }
    .chests {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--space-3);
      padding: 0;
      margin: 0 0 var(--space-4);
      list-style: none;
    }
    .chest {
      width: 100%;
      aspect-ratio: 1;
      display: grid;
      place-items: center;
      font-size: 2rem;
      border-radius: var(--radius-md);
      border: 2px solid var(--color-primary);
      background: linear-gradient(160deg, #5c3a1a, #2e1c0b);
      cursor: pointer;
      transition: transform var(--duration-fast) var(--ease-out);
    }
    .chest:hover:not(:disabled) {
      transform: translateY(-2px);
    }
    .chest:disabled {
      cursor: default;
    }
    .chest--open {
      background: var(--color-surface-2);
    }
    .chest__prize {
      font-size: var(--font-size-md);
      font-weight: var(--font-weight-bold);
      color: var(--color-success);
    }
    .chest__prize.collect {
      color: var(--color-warning);
    }
    .total {
      font-size: var(--font-size-lg);
    }
  `,
})
export class BonusPickComponent {
  readonly picks = input.required<readonly BonusPick[]>();
  readonly boxCount = input.required<number>();
  readonly done = output<void>();
  private readonly announcer = inject(Announcer);
  private readonly sound = inject(SoundService);

  protected readonly boxes = computed(() =>
    Array.from({ length: this.boxCount() }, (_, i) => i),
  );
  /** Chest index → revealed pick. */
  protected readonly revealed = signal(new Map<number, BonusPick>());
  protected readonly opened = computed(() => new Set(this.revealed().keys()));
  protected readonly finished = computed(
    () => this.revealed().size >= this.picks().length,
  );
  protected readonly total = computed(() =>
    [...this.revealed().values()].reduce((s, p) => s + p.win, 0),
  );

  protected open(box: number): void {
    if (this.finished() || this.opened().has(box)) return;
    const pick = this.picks()[this.revealed().size];
    this.revealed.update((m) => new Map(m).set(box, pick));
    this.sound.play(pick.prize === 'collect' ? 'stop' : 'win');
    this.announcer.announce(
      pick.prize === 'collect'
        ? $localize`:@@bonus.announceCollect:Collect. The bonus is over.`
        : $localize`:@@bonus.announcePrize:${(pick.win / 100).toFixed(2)}:amount: credits!`,
    );
  }

  protected label(box: number): string {
    const pick = this.revealed().get(box);
    if (!pick) return $localize`:@@bonus.closed:Chest ${box + 1}:n:, closed`;
    return pick.prize === 'collect'
      ? $localize`:@@bonus.openCollect:Chest ${box + 1}:n:: collect`
      : $localize`:@@bonus.openPrize:Chest ${box + 1}:n:: ${(pick.win / 100).toFixed(2)}:amount: credits`;
  }
}
