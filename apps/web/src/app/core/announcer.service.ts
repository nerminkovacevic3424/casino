import { Injectable, signal } from '@angular/core';

/**
 * Feeds the app-wide ARIA live regions rendered by the shell. Game results
 * use "polite"; errors that block the player use "assertive".
 */
@Injectable({ providedIn: 'root' })
export class Announcer {
  readonly polite = signal('');
  readonly assertive = signal('');

  announce(
    message: string,
    politeness: 'polite' | 'assertive' = 'polite',
  ): void {
    const target = politeness === 'polite' ? this.polite : this.assertive;
    // Clear first so repeating the same message is announced again.
    target.set('');
    queueMicrotask(() => target.set(message));
  }
}
