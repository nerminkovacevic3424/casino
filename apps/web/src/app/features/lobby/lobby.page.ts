import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  GAME_CATALOG,
  type GameSummary,
  type RecentGame,
} from '@casino/shared-types';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';
import { JackpotTickerComponent } from './jackpot-ticker.component';

const ICONS: Record<string, string> = {
  'classic-3-reel': '🍒',
  'video-5-reel': '💎',
  megaways: '🏺',
  roulette: '🎡',
  blackjack: '🂡',
  'video-poker': '🃏',
};

type Filter = 'all' | 'slots' | 'table' | 'cards' | 'favourites';

/** Normalises for accent- and case-insensitive search. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

@Component({
  selector: 'cas-lobby-page',
  imports: [RouterLink, JackpotTickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lobby.page.html',
  styleUrl: './lobby.page.scss',
})
export class LobbyPage {
  protected readonly auth = inject(AuthStore);
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);

  protected readonly query = signal('');
  protected readonly filter = signal<Filter>('all');
  protected readonly favourites = signal<ReadonlySet<string>>(new Set());
  protected readonly filters: readonly { value: Filter; label: string }[] = [
    { value: 'all', label: $localize`:@@lobby.filter.all:All games` },
    { value: 'slots', label: $localize`:@@category.slots:Slots` },
    { value: 'table', label: $localize`:@@category.table:Table` },
    { value: 'cards', label: $localize`:@@category.cards:Cards` },
    {
      value: 'favourites',
      label: $localize`:@@lobby.filter.favourites:Favourites`,
    },
  ];

  private readonly catalog = resource({
    loader: () => firstValueFrom(this.http.get<GameSummary[]>('/api/games')),
  });

  private readonly recentRes = resource({
    params: () => (this.auth.isAuthenticated() ? true : undefined),
    loader: () =>
      firstValueFrom(this.http.get<RecentGame[]>('/api/games/recent')),
  });

  /** Falls back to the static catalog if the API is unreachable. */
  protected readonly games = computed<readonly GameSummary[]>(
    () =>
      this.catalog.value() ??
      GAME_CATALOG.map((g) => ({ ...g, enabled: true })),
  );

  protected readonly visible = computed(() => {
    const q = fold(this.query().trim());
    const filter = this.filter();
    const favourites = this.favourites();
    return this.games().filter((g) => {
      if (filter === 'favourites' && !favourites.has(g.id)) return false;
      if (filter !== 'all' && filter !== 'favourites' && g.category !== filter)
        return false;
      return (
        !q ||
        fold(g.name).includes(q) ||
        fold(this.categoryLabel(g.category)).includes(q)
      );
    });
  });

  protected readonly recent = computed(() => {
    const byId = new Map(this.games().map((g) => [g.id as string, g] as const));
    return (this.recentRes.value() ?? [])
      .map((r) => byId.get(r.gameId))
      .filter((g): g is GameSummary => g !== undefined);
  });

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) void this.loadFavourites();
      else this.favourites.set(new Set());
    });
  }

  protected icon(id: string): string {
    return ICONS[id] ?? '🎲';
  }

  protected link(game: GameSummary): string[] {
    return ['/games', ...game.route.split('/')];
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

  protected favouriteLabel(game: GameSummary): string {
    return $localize`:@@lobby.favourite:Favourite ${game.name}:name:`;
  }

  protected async toggleFavourite(game: GameSummary): Promise<void> {
    const current = this.favourites();
    const isFav = current.has(game.id);
    // Optimistic: update now, roll back if the server refuses.
    const next = new Set(current);
    if (isFav) next.delete(game.id);
    else next.add(game.id);
    this.favourites.set(next);
    try {
      const url = `/api/favourites/${encodeURIComponent(game.id)}`;
      await firstValueFrom(
        isFav ? this.http.delete(url) : this.http.put(url, {}),
      );
    } catch (err) {
      this.favourites.set(current);
      this.toasts.error(errorMessage(err));
    }
  }

  private async loadFavourites(): Promise<void> {
    try {
      this.favourites.set(
        new Set(
          await firstValueFrom(this.http.get<string[]>('/api/favourites')),
        ),
      );
    } catch {
      // Favourites are optional.
    }
  }
}
