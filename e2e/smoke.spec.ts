import { expect, test } from '@playwright/test';

/**
 * The page renders, every act mounts, and no console error escapes.
 *
 * Deliberately not a screenshot test: what matters is that the panels computed something
 * rather than that they look a particular way.
 */
test('every act mounts and computes', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Token Tell');

  for (const id of ['hero-experiment', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5',
    'act-6', 'act-7', 'reference']) {
    const section = page.locator(`#${id}`);
    await expect(section).not.toBeEmpty();
    await expect(section.getByRole('heading', { level: 2 })).toBeVisible();
  }

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the thesis is stated above the fold and repeated on every act', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.thesis-headline')).toContainText(
    'A watermark is not a signature');
  await expect(page.locator('.thesis-precise')).toContainText(
    'does not establish authorship');

  const strips = page.locator('.thesis-strip');
  await expect(strips).toHaveCount(9);
});
