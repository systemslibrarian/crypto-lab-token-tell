import { expect, test } from '@playwright/test';

/**
 * The page renders, every act mounts, and no console error escapes.
 *
 * Deliberately not a screenshot test: what matters is that the panels computed something
 * rather than that they look a particular way.
 *
 * The page has two depths, and this file is where the difference between "mounted" and
 * "shown" is pinned down. Mounting is asserted with counts and emptiness, which read
 * straight through `hidden`; being shown is asserted separately, per depth, because
 * `getByRole` and `toBeVisible` are scoped to the accessibility tree and a hidden section
 * simply is not in it. Keeping the two apart is what makes this file able to catch the one
 * change that would make the page dishonest — a second, shorter render path for the short
 * route, where only one of the two copies is the code under test.
 */

const SECTIONS = ['hero-experiment', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'act-6',
  'act-7', 'reference'];

/** What the short route shows. Everything else is on the page, tagged for Full lab. */
const DEMO_SECTIONS = ['hero-experiment', 'act-5', 'act-6', 'act-7'];

test('every act mounts and computes', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  // A bare URL, with no stored preference: the depth a new visitor is given is part of
  // the product decision and is asserted rather than assumed.
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Token Tell');
  await expect(page.getByRole('button', { name: 'Demo', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');

  // Mounted: every act rendered content and produced its heading, at the depth that
  // shows four of them. A renderer that threw would leave its section empty, and an empty
  // section says nothing to any other check in this suite.
  for (const id of SECTIONS) {
    const section = page.locator(`#${id}`);
    await expect(section).not.toBeEmpty();
    await expect(section.locator('h2')).toHaveCount(1);
  }

  // Shown: four in Demo, and all nine in Full lab. The union is every section, which is
  // what makes "hidden" the whole of the difference between the two depths.
  for (const id of SECTIONS) {
    const section = page.locator(`#${id}`);
    if (DEMO_SECTIONS.includes(id)) await expect(section).toBeVisible();
    else await expect(section).toBeHidden();
  }

  await page.goto('./?mode=lab');
  for (const id of SECTIONS) {
    await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator(`#${id} h2`)).toHaveCount(1);
  }

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the thesis is stated above the fold, and carried once per act in the full lab',
  async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('.thesis-headline')).toContainText(
      'A watermark is not a signature');
    await expect(page.locator('.thesis-precise')).toContainText(
      'does not establish authorship');

    // Above the fold, measured rather than asserted: the claim this page exists to make
    // has to be readable before anything is scrolled.
    const viewport = page.viewportSize();
    const box = await page.locator('.thesis-headline').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThan(viewport!.height);

    // NINE in the DOM at either depth, because nine renderers each emit exactly one and
    // the depth is a display decision over them, not a second render pass. A count
    // locator reads through `hidden`, so this number would not move even if every strip
    // were hidden — which is why the visible count is asserted separately below.
    const strips = page.locator('.thesis-strip');
    await expect(strips).toHaveCount(9);

    // ONE visible in Demo: the hero keeps its strip, and the other eight carry the lab
    // tag. Stating the thesis once at full size and then eight more times in a row is
    // what the short route was made to stop doing; repeating it to an auditor working
    // through nine acts out of order is still worth doing, so Full lab shows all nine.
    expect(await page.locator('.thesis-strip:visible').count()).toBe(1);
    await page.goto('./?mode=lab');
    expect(await page.locator('.thesis-strip:visible').count()).toBe(9);
  });
