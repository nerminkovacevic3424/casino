import { LOCALE_ID, Pipe, PipeTransform, inject } from '@angular/core';

/** Minor units → human credits, e.g. 123456 → "1,234.56". Never does float arithmetic on stored values. */
export function formatCredits(
  minor: number,
  locale = 'en-US',
  fractionDigits = 2,
): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const cents = abs % 100;
  const wholeText = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(whole);
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find((p) => p.type === 'decimal')?.value ?? '.';
  const text =
    fractionDigits > 0
      ? `${wholeText}${decimal}${String(cents).padStart(2, '0')}`
      : wholeText;
  return negative ? `−${text}` : text;
}

@Pipe({ name: 'credits' })
export class CreditsPipe implements PipeTransform {
  private readonly locale = inject(LOCALE_ID);

  transform(minor: number | null | undefined, fractionDigits = 2): string {
    return minor === null || minor === undefined
      ? '—'
      : formatCredits(minor, this.locale, fractionDigits);
  }
}
