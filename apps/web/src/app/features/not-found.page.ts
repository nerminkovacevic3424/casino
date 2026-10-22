import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'cas-not-found-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1 i18n="@@notFound.title">Page not found</h1>
      <p i18n="@@notFound.body">
        The page you were looking for does not exist.
      </p>
      <a class="btn btn--primary" routerLink="/" i18n="@@notFound.back"
        >Back to the lobby</a
      >
    </section>
  `,
})
export class NotFoundPage {}
