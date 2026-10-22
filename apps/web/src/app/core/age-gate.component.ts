import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AuthStore } from './auth.store';

const CONFIRMED_KEY = 'casino.ageConfirmed';

/**
 * 18+ age gate for visitors who are not signed in. It cannot be dismissed
 * with Escape or by clicking outside; registration separately checks the date
 * of birth on the server.
 */
@Component({
  selector: 'cas-age-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="gate"
      aria-labelledby="age-title"
      aria-describedby="age-text"
      (cancel)="$event.preventDefault()"
    >
      @if (refused()) {
        <h2 id="age-title" i18n="@@age.refusedTitle">
          Sorry, you can’t play here
        </h2>
        <p id="age-text" i18n="@@age.refusedText">
          This site is only for people aged 18 and over. If gambling is
          affecting you or someone you know, free and confidential help is
          available from
          <a
            href="https://www.gamblingtherapy.org"
            target="_blank"
            rel="noopener noreferrer"
            >Gambling Therapy</a
          >.
        </p>
      } @else {
        <h2 id="age-title" i18n="@@age.title">Are you 18 or older?</h2>
        <p id="age-text" i18n="@@age.text">
          This site offers casino games played with free virtual credits. You
          must be at least 18 years old to enter.
        </p>
        <div class="actions">
          <button
            type="button"
            class="btn btn--primary"
            (click)="confirm()"
            i18n="@@age.yes"
          >
            I am 18 or older
          </button>
          <button
            type="button"
            class="btn"
            (click)="refused.set(true)"
            i18n="@@age.no"
          >
            I am under 18
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .gate {
      max-width: 460px;
      padding: var(--space-6);
      border: 2px solid var(--color-primary);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-text);
      text-align: center;
    }
    .gate::backdrop {
      background: rgb(5 8 16 / 92%);
      backdrop-filter: blur(6px);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      justify-content: center;
    }
  `,
})
export class AgeGateComponent {
  private readonly auth = inject(AuthStore);
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly refused = signal(false);

  constructor() {
    // Decide once the start-up session check has finished: signed-in players were age-checked at registration.
    effect(() => {
      const status = this.auth.status();
      const el = this.dialog().nativeElement;
      if (status === 'authenticated' && el.open) el.close();
      if (status === 'anonymous' && !this.confirmed() && !el.open)
        el.showModal();
    });
  }

  protected confirm(): void {
    try {
      localStorage.setItem(CONFIRMED_KEY, new Date().toISOString());
    } catch {
      // Storage disabled: the gate will ask again next visit.
    }
    this.dialog().nativeElement.close();
  }

  private confirmed(): boolean {
    try {
      return localStorage.getItem(CONFIRMED_KEY) !== null;
    } catch {
      return false;
    }
  }
}
