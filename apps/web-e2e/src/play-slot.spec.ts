import { expect, test, type Page } from '@playwright/test';

/** Parses "1,234.56" (as rendered by the credits pipe) into minor units. */
const minor = (text: string): number => {
  const negative = text.includes('−');
  const value = Math.round(Number(text.replace(/[^\d.]/g, '')) * 100);
  return negative ? -value : value;
};

async function balance(page: Page): Promise<number> {
  return minor((await page.getByTestId('balance').innerText()).trim());
}

async function signUp(page: Page): Promise<string> {
  const email = `e2e.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/auth/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill(`e2e_${Date.now() % 1_000_000}`);
  await page.getByLabel('Password').fill('purple-otter-sings-42');
  await page.getByLabel('Date of birth').fill('1990-05-17');
  await page.getByLabel(/I am 18 or older/).check();
  await page.getByTestId('register-submit').click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('balance')).toHaveText('1,000.00');
  return email;
}

test.describe('sign-up → bet → win/lose → history', () => {
  test('a new player spins the classic slot and sees the round in their history', async ({
    page,
  }) => {
    await signUp(page);

    await page.getByRole('link', { name: /Play Classic 3-Reel/ }).click();
    await expect(page).toHaveURL('/games/slots/classic-3-reel');
    const spin = page.getByTestId('spin');
    await expect(spin).toBeEnabled();
    await expect(page.getByTestId('bet')).toHaveText('0.10');

    const before = await balance(page);
    await spin.click();
    // The stake is shown as deducted while the reels spin.
    await expect(spin).toBeDisabled();
    await expect(spin).toBeEnabled();

    const won = minor(await page.getByTestId('last-win').innerText());
    await expect.poll(() => balance(page)).toBe(before - 10 + won);
    // The result was announced to assistive technology.
    await expect(page.locator('[aria-live="polite"]').first()).toHaveText(
      won > 0 ? /You won/ : /No win/,
    );

    await page.getByRole('link', { name: 'Wallet', exact: true }).click();
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'Welcome bonus' }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Bets' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Wins' })).toHaveCount(
      won > 0 ? 1 : 0,
    );

    // Filtering by type narrows the history.
    await page.getByLabel('Type').selectOption('BET');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('−0.10');
  });

  test('the round can be verified after rotating seeds', async ({ page }) => {
    await signUp(page);
    await page.goto('/games/slots/classic-3-reel');
    const spin = page.getByTestId('spin');
    await expect(spin).toBeEnabled();
    await spin.click();
    await expect(spin).toBeDisabled();
    await expect(spin).toBeEnabled();

    await page
      .getByRole('link', { name: 'Verify', exact: true })
      .last()
      .click();
    await expect(page.getByText('still in use, so it is secret')).toBeVisible();
    await page.getByRole('button', { name: /Rotate seeds/ }).click();
    await expect(page.getByTestId('verify-match')).toContainText(
      'matches the recorded round',
    );
    await expect(
      page.getByText('matches the hash published before betting'),
    ).toBeVisible();
  });

  test('keyboard players can spin with Space on the focused reels', async ({
    page,
  }) => {
    await signUp(page);
    await page.goto('/games/slots/classic-3-reel');
    await expect(page.getByTestId('spin')).toBeEnabled();
    const before = await balance(page);
    await page.getByTestId('slot-stage').focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('spin')).toBeDisabled();
    await expect(page.getByTestId('spin')).toBeEnabled();
    await expect.poll(() => balance(page)).not.toBe(before);
  });

  test('signed-out players are sent to sign in before playing', async ({
    page,
  }) => {
    await page.goto('/games/slots/classic-3-reel');
    await expect(page).toHaveURL(
      /\/auth\/login\?returnUrl=%2Fgames%2Fslots%2Fclassic-3-reel/,
    );
  });
});
