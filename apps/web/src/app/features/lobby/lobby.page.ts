import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { GAME_CATALOG, type GameSummary } from '@casino/shared-types';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../core/auth.store';

/** Games with a finished client. The rest are listed as "coming soon". */
export const PLAYABLE_GAMES: ReadonlySet<string> = new Set(['classic-3-reel']);

const ICONS: Record<string, string> = {
  'classic-3-reel': '🍒',
  'video-5-reel': '💎',
  megaways: '🏺',
  roulette: '🎡',
  blackjack: '🂡',
  'video-poker': '🃏',
};

@Component({
  selector: 'cas-lobby-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <section class="hero" aria-labelledby="lobby-title">
        <h1 id="lobby-title" i18n="@@lobby.title">
          Play for fun. Verify every spin.
        </h1>
        <p i18n="@@lobby.lead">
          Free virtual credits, provably fair results and no real money — ever.
        </p>
        @if (auth.status() === 'anonymous') {
          <a
            class="btn btn--primary"
            routerLink="/auth/register"
            i18n="@@lobby.join"
            >Claim 1,000 free credits</a
          >
        }
      </section>

      <h2 i18n="@@lobby.games">Games</h2>
      <ul class="grid" role="list">
        @for (game of games(); track game.id) {
          <li class="tile" [class.tile--disabled]="!isPlayable(game)">
            <span class="tile__icon" aria-hidden="true">{{
              icon(game.id)
            }}</span>
            <h3 class="tile__name">{{ game.name }}</h3>
            <p class="tile__meta">
              <span class="chip">{{ categoryLabel(game.category) }}</span>
              <span i18n="@@lobby.rtp"
                >RTP {{ (game.rtp * 100).toFixed(2) }}%</span
              >
            </p>
            @if (isPlayable(game)) {
              <a
                class="tile__link"
                [routerLink]="['/games', ...game.route.split('/')]"
              >
                <span class="visually-hidden" i18n="@@lobby.play"
                  >Play {{ game.name }}</span
                >
              </a>
            } @else if (!game.enabled) {
              <p class="tile__status" i18n="@@lobby.unavailable">
                Temporarily unavailable
              </p>
            } @else {
              <p class="tile__status" i18n="@@lobby.soon">Coming soon</p>
            }
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    .hero {
      padding: var(--space-6) 0 var(--space-5);
    }
    .hero h1 {
      font-size: var(--font-size-3xl);
      max-width: 18ch;
    }
    .hero p {
      color: var(--color-text-muted);
      font-size: var(--font-size-lg);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
      gap: var(--space-4);
      padding: 0;
      margin: 0;
    }
    .tile {
      position: relative;
      display: grid;
      gap: var(--space-2);
      padding: var(--space-5);
      border-radius: var(--radius-lg);
      background: linear-gradient(
        160deg,
        var(--color-surface-2),
        var(--color-surface)
      );
      border: 1px solid var(--color-border);
      transition:
        transform var(--duration-base) var(--ease-out),
        border-color var(--duration-base);
    }
    .tile:not(.tile--disabled):hover {
      transform: translateY(-3px);
      border-color: var(--color-primary);
    }
    .tile:focus-within {
      outline: 3px solid var(--color-focus);
      outline-offset: 2px;
    }
    .tile--disabled {
      opacity: 0.7;
    }
    .tile__icon {
      font-size: 2.5rem;
    }
    .tile__name {
      margin: 0;
      font-size: var(--font-size-lg);
    }
    .tile__meta {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      margin: 0;
      color: var(--color-text-muted);
      font-size: var(--font-size-sm);
    }
    .tile__status {
      margin: 0;
      color: var(--color-text-muted);
      font-size: var(--font-size-sm);
    }
    /* Whole tile is clickable; the link text stays available to screen readers. */
    .tile__link {
      position: absolute;
      inset: 0;
      border-radius: inherit;
    }
    .tile__link:focus-visible {
      outline: none;
    }
    .chip {
      padding: 2px var(--space-2);
      border-radius: var(--radius-pill);
      background: var(--color-surface-3);
      color: var(--color-text);
    }
  `,
})
export class LobbyPage {
  protected readonly auth = inject(AuthStore);
  private readonly http = inject(HttpClient);

  private readonly catalog = resource({
    loader: () => firstValueFrom(this.http.get<GameSummary[]>('/api/games')),
  });

  /** Falls back to the static catalog if the API is unreachable. */
  protected readonly games = computed<readonly GameSummary[]>(
    () =>
      this.catalog.value() ??
      GAME_CATALOG.map((g) => ({ ...g, enabled: true })),
  );

  protected isPlayable(game: GameSummary): boolean {
    return game.enabled && PLAYABLE_GAMES.has(game.id);
  }

  protected icon(id: string): string {
    return ICONS[id] ?? '🎲';
  }

  protected categoryLabel(category: GameSummary['category']): string {
    switch (category) {
      case 'slots':
        return $localize`:@@category.slots:Slots`;
      case 'table':
        return $localize`:@@category.table:Table`;
      case 'cards':
        return $localize`:@@category.cards:Cards`;
    }
  }
}
