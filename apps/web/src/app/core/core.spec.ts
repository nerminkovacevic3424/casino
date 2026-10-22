import { FormControl } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { formatCredits } from '@casino/ui';
import { adultValidator } from '../features/auth/register.page';
import { safeReturnUrl } from './guards';
import { WalletStore } from './wallet.store';

describe('formatCredits', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [100, '1.00'],
    [123456, '1,234.56'],
    [-250, '−2.50'],
    [100_000_000_00, '100,000,000.00'],
  ])('%i minor units → %s', (minor, text) => {
    expect(formatCredits(minor, 'en-US')).toBe(text);
  });

  it('uses the locale’s separators', () => {
    expect(formatCredits(123456, 'de-DE')).toBe('1.234,56');
  });
});

describe('safeReturnUrl', () => {
  it.each([
    ['/wallet', '/wallet'],
    ['/games/slots/classic-3-reel?x=1', '/games/slots/classic-3-reel?x=1'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    [undefined, '/'],
    ['', '/'],
  ])('%p → %p', (input, expected) => {
    expect(safeReturnUrl(input)).toBe(expected);
  });
});

describe('adultValidator', () => {
  const check = (value: string) =>
    adultValidator(new FormControl(value, { nonNullable: true }));

  it('accepts adults and empty values (required is separate)', () => {
    expect(check('1990-01-01')).toBeNull();
    expect(check('')).toBeNull();
  });

  it('rejects minors and invalid dates', () => {
    const tomorrowSeventeen = new Date();
    tomorrowSeventeen.setUTCFullYear(tomorrowSeventeen.getUTCFullYear() - 18);
    tomorrowSeventeen.setUTCDate(tomorrowSeventeen.getUTCDate() + 1);
    expect(check(tomorrowSeventeen.toISOString().slice(0, 10))).toEqual({
      underage: true,
    });
    expect(check('not-a-date')).toEqual({ date: true });
  });
});

describe('WalletStore balance holds', () => {
  let store: InstanceType<typeof WalletStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(WalletStore);
  });

  it('applies pushes immediately when not held', () => {
    store.setFromPush(500);
    expect(store.balance()).toBe(500);
  });

  it('holds pushes during a reveal and applies the latest on release', () => {
    store.setBalance(1000);
    store.hold();
    store.setFromPush(900);
    store.setFromPush(950);
    expect(store.balance()).toBe(1000);
    store.release();
    expect(store.balance()).toBe(950);
  });

  it('lets the game’s own final balance supersede held pushes', () => {
    store.hold();
    store.setFromPush(10);
    store.setBalance(20);
    store.release();
    expect(store.balance()).toBe(20);
  });

  it('only releases after the last hold', () => {
    store.hold();
    store.hold();
    store.setFromPush(7);
    store.release();
    expect(store.balance()).toBeNull();
    store.release();
    expect(store.balance()).toBe(7);
  });
});
