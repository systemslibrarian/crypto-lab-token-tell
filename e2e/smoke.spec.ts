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
 *
 * The offline shell is checked here too, for the same reason: it is a shipped feature with
 * no rendering of its own, so nothing else in the suite could ever have noticed that what
 * it precached and what the page declares were two different lists.
 */

const SECTIONS = ['hero-experiment', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'act-6',
  'act-7', 'act-8', 'reference'];

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

  // Shown: four in Demo, and all ten in Full lab. The union is every section, which is
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

/**
 * The one shipped feature nothing in this repository had ever looked at.
 *
 * The lab installs as an app: the document declares three `<link rel="…icon">` for the tab
 * strip and the home screen, and `manifest.webmanifest` names three for the installed one.
 * The service worker is generated at build time from a list of what the build emitted —
 * and that list came out of Rollup's bundle, which Vite fills in BEFORE it copies
 * `public/`, so the artwork was the one thing never in it. An installed copy therefore
 * pointed at files it could not fetch and showed a blank tile with no connection, which is
 * the whole of the visual identity this lab has.
 *
 * Asserted against the page's own declarations rather than against a list of filenames, so
 * adding a fourth icon to either the document or the web manifest and forgetting the
 * worker fails here rather than shipping.
 */
test('the offline shell precaches every icon the page declares', async ({ page }) => {
  await page.goto('./');
  const cached = await page.evaluate(async () => {
    // Registration is deferred to `load`, and `ready` resolves only once a worker has
    // activated — which is after its install has finished filling the cache.
    await navigator.serviceWorker.ready;

    const declared = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel$="icon"]'),
    ).map((link) => link.href);
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifestLink) {
      const manifest = await (await fetch(manifestLink.href)).json() as
        { icons?: { src: string }[] };
      for (const icon of manifest.icons ?? []) {
        declared.push(new URL(icon.src, manifestLink.href).href);
      }
    }

    const urls = [...new Set(declared)];
    const missing: string[] = [];
    for (const url of urls) if (!await caches.match(url)) missing.push(url);
    return { urls, missing };
  });

  // Six declarations, four distinct files: the SVG and the 192 are named by both the
  // document and the web manifest. If either stops declaring any, this stops proving it.
  expect(cached.urls.length, 'the page must declare its icons somewhere')
    .toBeGreaterThanOrEqual(4);
  expect(cached.missing, `declared but not precached: ${cached.missing.join(', ')}`)
    .toEqual([]);
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

    // TEN in the DOM at either depth, because ten renderers each emit exactly one and
    // the depth is a display decision over them, not a second render pass. A count
    // locator reads through `hidden`, so this number would not move even if every strip
    // were hidden — which is why the visible count is asserted separately below.
    const strips = page.locator('.thesis-strip');
    await expect(strips).toHaveCount(10);

    // NONE visible in Demo. The strip is a travelling copy of the `.thesis` block, and on
    // the short route that block is permanently on screen a third of a viewport above the
    // first act — so the hero's strip was a verbatim restatement, all twenty-seven words
    // of it, inside the opening twenty seconds. Zero is therefore the number that means
    // the claim is stated once rather than the number that means it went missing, which
    // is why the assertion below checks the full claim is still there to be read.
    expect(await page.locator('.thesis-strip:visible').count()).toBe(0);
    await expect(page.locator('.thesis-headline')).toBeVisible();
    await expect(page.locator('.thesis-precise')).toBeVisible();
    await page.goto('./?mode=lab');
    // The ten in the DOM again first, and it is a retrying assertion for a reason: the
    // sections do not all mount in the load event any more, so a visible count taken the
    // instant the navigation resolves is counting a page that is still being built. The
    // number below is unchanged; only the assumption that the page was finished is.
    await expect(strips).toHaveCount(10);
    expect(await page.locator('.thesis-strip:visible').count()).toBe(10);
  });
