import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PreferencesPanelComponent } from './preferences-panel.component';
import { ResponsiblePanelComponent } from './responsible-panel.component';
import { SecurityPanelComponent } from './security-panel.component';
import { StatsPanelComponent } from './stats-panel.component';

@Component({
  selector: 'cas-profile-page',
  imports: [
    RouterLink,
    StatsPanelComponent,
    PreferencesPanelComponent,
    SecurityPanelComponent,
    ResponsiblePanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page profile">
      <h1 i18n="@@profile.title">Your profile</h1>
      <nav
        class="sections"
        i18n-aria-label="@@profile.sections"
        aria-label="Profile sections"
      >
        <a routerLink="." fragment="overview" i18n="@@profile.overview"
          >Overview</a
        >
        <a routerLink="." fragment="preferences" i18n="@@profile.preferences"
          >Preferences</a
        >
        <a routerLink="." fragment="security" i18n="@@profile.security"
          >Security</a
        >
        <a routerLink="." fragment="responsible" i18n="@@profile.responsible"
          >Responsible play</a
        >
      </nav>

      <section id="overview" class="card" aria-labelledby="overview-title">
        <h2 id="overview-title" i18n="@@profile.overview">Overview</h2>
        <cas-stats-panel />
      </section>

      <section
        id="preferences"
        class="card"
        aria-labelledby="preferences-title"
      >
        <h2 id="preferences-title" i18n="@@profile.preferences">Preferences</h2>
        <cas-preferences-panel />
      </section>

      <section id="security" class="card" aria-labelledby="security-title">
        <h2 id="security-title" i18n="@@profile.security">Security</h2>
        <cas-security-panel />
      </section>

      <section
        id="responsible"
        class="card"
        aria-labelledby="responsible-title"
      >
        <h2 id="responsible-title" i18n="@@profile.responsible">
          Responsible play
        </h2>
        <cas-responsible-panel />
      </section>
    </div>
  `,
  styles: `
    .profile {
      display: grid;
      gap: var(--space-5);
    }
    .profile h1 {
      margin: 0;
    }
    .sections {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      position: sticky;
      top: calc(var(--header-height) + var(--space-2));
      z-index: 1;
    }
    .sections a {
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-pill);
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      text-decoration: none;
      font-size: var(--font-size-sm);
    }
    section {
      scroll-margin-top: calc(var(--header-height) + 64px);
    }
  `,
})
export class ProfilePage {}
