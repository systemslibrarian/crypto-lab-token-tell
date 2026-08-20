import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the rendering a reduced-motion reader actually gets was never once the
 *     rendering that got scanned. This lab declares no keyframes at all and its
 *     only motion is the top bar's `.cl-btn` colour transition and the skip
 *     link sliding down from `top:-3rem`, so the block has little to cancel
 *     here — which is a reason to exercise it rather than to skip it, because
 *     that fact has to stay true as panels are added. This gate sets the
 *     preference through `emulateMedia`, asserts from inside the page that it
 *     took effect (`test.use({ reducedMotion })` silently does nothing on
 *     Playwright 1.61.1), and injects nothing.
 *
 *  2. IT FORCED EVERY PANEL VISIBLE FROM SCRIPT. The old drive stripped every
 *     `[hidden]` attribute and set every `<details>.open` by JS before its only
 *     scan — a rendering no reader can reach, scanned instead of the real one,
 *     and the SHUT state that every reader arrives at never scanned at all.
 *     This lab now DOES ship `[hidden]` panels: Demo depth hides twenty-four
 *     lab-only elements and Full lab hides three demo-only ones, so the
 *     temptation is stronger here than it was there and the answer is the same.
 *     Depth is changed through the `?mode=` a presenter really links to or
 *     through the segmented control a reader really presses — never by removing
 *     `hidden` from script, which would reintroduce precisely the defect this
 *     rule names. The ten disclosures are opened through their `<summary>` for
 *     the same reason, and both states are scanned.
 *
 *  2b. AND `hidden` MAKES EVERY ORACLE BLIND. Measured, not assumed: a nameless
 *     button, an alt-less image, a nameless select, an unlabelled input and a
 *     1.2:1 paragraph inside a `hidden` section produce ZERO axe violations
 *     while hidden and seven the instant they are shown. `contrast.ts`,
 *     `nontext.ts`, `expectNotBlank`, `expectNoInvisibleFocusTargets` and
 *     `expectScrollersReachable` all skip what `checkVisibility()` denies. So a
 *     drive that scanned only Demo depth would leave Acts I–IV and the whole
 *     reference section — the majority of this page's controls, tables and
 *     charts — unexamined, while reporting a clean run. `driveAllStates` drives
 *     BOTH depths in one pass for that reason, and `boot` asserts the depth
 *     contract as an invariant so an element that loses its tag cannot become
 *     permanently unscanned in silence.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked
 *     every button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed interval, and scanned ONCE at the end,
 *     so a click that silently did nothing looked identical to one that worked.
 *     This drive names every control it touches, asserts a real completion
 *     signal after each — a progress line reaching its terminal wording, a
 *     retired verdict appearing, a verification verdict changing — and scans
 *     after every step, at 1280 and at 380 in the one theme this fleet ships.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning are all `color-mix()` fills axe files under
 *     `incomplete` rather than judging: the four `.verdict` tones, the
 *     `.thesis` and `.thesis-strip` washes, `.warn-box`, the hero aside, the
 *     two scored-token tints, the load-bearing row of the comparison table,
 *     and the shared top bar's ink. So is an `aria-label` on a role-less
 *     element.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The old
 *     spec hand-rolled one luminance check over two input selectors, reading
 *     the DECLARED `border-top-color` and `background-color` — blind to
 *     `color-mix()`, to composited backdrops, and to every state past first
 *     paint. `nontext.ts` replaces it with a measured oracle over every
 *     control at every driven state, which here means the buttons, the two
 *     range sliders, the two selects and the three textareas.
 *     `expectNoHorizontalOverflow` adds the 1.4.10 check axe has no rule for,
 *     and this page needs it: it paints wide tables, long hash strings and
 *     inline SVG charts.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels every animation and transition, so `getAnimations()` is
 * normally empty and this returns on the sixth frame. It stays because the
 * shared top bar's `.cl-btn` transitions and the skip link's `top` transition
 * are declared OUTSIDE that block — `* { transition-duration: 0.001ms
 * !important }` wins today, but that is a property of the current stylesheet,
 * not of the page.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * declares NO keyframes and no element depends on an animation to become
 * visible, so the shape is absent here today. The assertion stays because that
 * is a fact about the current stylesheet rather than about the page, and the
 * first panel authored with a fade-in reveal would otherwise arrive invisible
 * to reduced-motion readers with nothing watching.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is the four
 * decorative verdict glyphs beside their own words, and the top bar's two
 * text-free SVG marks — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Every panel here renders synchronously at first activation, so a
 * renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. Attach before `boot`,
 * assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero IS a `<header class="cl-hero">`, which the fleet template prescribes,
 * and it sits inside `<div id="app">` rather than inside a sectioning element
 * — so on the markup alone it would imply a second banner. The shared bar's
 * inline `dedupeBanner()` demotes it to `role="group"` at load. That makes
 * this lab exactly the case that function exists for, and asserting the
 * OUTCOME rather than the markup is what catches the day the script is
 * dropped or the hero is moved.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab builds several lists from script — the limitations list, the
 * "what this does not prove" list, and the sources list — and each carries an
 * explicit `role="list"` with `role="listitem"` on its children, because
 * `list-style` changes and flex layouts are what make Safari and VoiceOver
 * DROP a list's implicit role. So here, as in the lab this gate came from, an
 * explicit role on a list is the fix rather than the defect. What is asserted
 * is the SHAPE of that fix: any explicit role on a `ul`/`ol` must be
 * `list` (any other value orphans every `<li>` under it), and a `role="list"`
 * must never sit on an empty element, because axe applies
 * `aria-required-children` to the explicit role and fails it the day the
 * pipeline renders with no stages. Roles can be assigned as JS properties in
 * an element-creation helper, so ask the DOM rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

export type Depth = 'demo' | 'lab';

/** The label on each segment of the depth control, and the value the URL carries. */
const DEPTH_LABEL: Record<Depth, string> = { demo: 'Demo', lab: 'Full lab' };

/** `mode.ts` namespaces its preference so it cannot collide with the shared `theme` key. */
const DEPTH_STORAGE_KEY = 'token-tell:mode';

const SECTIONS = [
  'hero-experiment', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'act-6', 'act-7',
  'act-8', 'reference',
] as const;

/** The four sections the short route shows. Their complement is what Full lab adds. */
const DEMO_SECTIONS = ['hero-experiment', 'act-5', 'act-6', 'act-7'];

/**
 * Which depth the page is actually in, read off the control rather than off the
 * URL. A URL records what was asked for; the pressed segment records what the
 * page did with it, and those are the same thing only while `mode.ts` works.
 */
export async function activeDepth(page: Page): Promise<Depth> {
  const pressed = page.locator('.mode-switch-option[aria-pressed="true"]');
  await expect(pressed, 'exactly one depth segment may be pressed').toHaveCount(1);
  return ((await pressed.textContent()) ?? '').includes(DEPTH_LABEL.lab) ? 'lab' : 'demo';
}

/**
 * The depth contract, asserted rather than trusted.
 *
 * There is one copy of every experiment and the depth is a display decision
 * expressed as a tag, so the whole mechanism is two rules: nothing tagged for
 * the other depth is showing, and nothing tagged for this one is hidden. Both
 * are asserted in both directions, after a non-emptiness guard — a renamed
 * attribute would otherwise satisfy every one of them vacuously, and the first
 * anyone would know is that half the page had stopped being scanned.
 *
 * The section list is the joint-completeness half: the union of what Demo shows
 * and what Full lab shows has to be all nine, or a section tagged for a depth
 * inside an ancestor tagged for the other one is visible nowhere, scanned by
 * nothing, and named by no failure.
 */
export async function expectDepthApplied(page: Page, mode: Depth): Promise<void> {
  await expect(page.getByRole('button', { name: DEPTH_LABEL[mode], exact: true }))
    .toHaveAttribute('aria-pressed', 'true');

  const tagged = await page.locator('[data-depth]').count();
  expect(tagged, 'the depth tag itself must still be on the page').toBeGreaterThan(0);
  await expect(page.locator('[data-depth="lab"]')).not.toHaveCount(0);
  await expect(page.locator('[data-depth="demo"]')).not.toHaveCount(0);

  const other: Depth = mode === 'demo' ? 'lab' : 'demo';
  await expect(
    page.locator(`[data-depth="${other}"]:not([hidden])`),
    `nothing tagged for ${other} depth may show in ${mode} depth`
  ).toHaveCount(0);
  await expect(
    page.locator(`[data-depth="${mode}"][hidden]`),
    `nothing tagged for ${mode} depth may be hidden in ${mode} depth`
  ).toHaveCount(0);

  for (const id of SECTIONS) {
    const shown = mode === 'lab' || DEMO_SECTIONS.includes(id);
    const section = page.locator(`#${id}`);
    if (shown) await expect(section, `#${id} is shown at ${mode} depth`).toBeVisible();
    else await expect(section, `#${id} is a lab-depth section`).toBeHidden();
  }
}

/**
 * Load the page in a known theme AND a known depth, with reduced motion
 * actually in effect, and assert the content every scan relies on is really on
 * the page — including the lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. Nothing in this lab's JS branches on
 * `matchMedia` and it declares no keyframes, so today the block has little to
 * cancel — but the assertion is the difference between scanning the
 * reduced-motion rendering and merely believing we did, and it has to keep
 * holding as panels are added.
 *
 * The theme is seeded through `localStorage` rather than by clicking the
 * toggle, which pins down a real coupling as a side effect: `index.html`'s
 * anti-flash script reads `localStorage.getItem('theme')` and the shared bar's
 * toggle writes `localStorage.setItem('theme', …)`. Both agree on `'theme'`;
 * if either drifted, this boot fails on `data-theme` rather than quietly
 * scanning dark twice.
 *
 * The DEPTH is seeded the other way about, through the URL, and the stored
 * preference is cleared in the same init script. `mode.ts` lets `?mode=`
 * outrank storage precisely so a link survives whatever its recipient last
 * looked at, so the URL is the honest carrier — and it is the one a presenter
 * really has, which makes this a real arrival state rather than a synthesised
 * one. Clearing the key as well means a preference left by an earlier test in
 * the same worker cannot decide the depth while this boot reports the other
 * one. The outcome is then asserted through `expectDepthApplied` rather than
 * inferred from the address bar.
 *
 * `mode` defaults to Demo because that is what a new visitor gets. The usual
 * objection to a default — that it is how one branch quietly stops being
 * scanned — does not apply here: `driveAllStates` drives BOTH depths whichever
 * one it is handed, so coverage does not depend on this argument.
 *
 * The defaults are asserted at length because every panel on this page renders
 * from script at load, and three of them compute at mount: the Hero scores
 * three runs, Act V signs its default asset, and Act VI signs and checks a
 * false statement. A navigation that resolves proves nothing — a renderer that
 * threw would leave its section EMPTY, and an empty region is exactly what a
 * scan reports as perfectly accessible.
 */
export async function boot(
  page: Page,
  theme: 'dark' | 'light',
  mode: Depth = 'demo',
): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    (seed: { theme: string; depthKey: string }) => {
      localStorage.setItem('theme', seed.theme);
      localStorage.removeItem(seed.depthKey);
    },
    { theme, depthKey: DEPTH_STORAGE_KEY }
  );
  await page.goto(`./?mode=${mode}`);
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  // Every act mounted and produced content, AT BOTH DEPTHS. Both assertions
  // read through `hidden` — `toBeEmpty` and a count locator traverse the whole
  // DOM, not the accessibility tree — which is what makes this pair the proof
  // that Demo depth HIDES the lab rather than skipping it. A second render path
  // for the short route is the one thing that would make this page dishonest,
  // because only one of the two copies would be the code under test; if one
  // ever appeared, five of these nine would go empty in Demo and say so here.
  // It stays the empty-region guard as well: a panel whose renderer threw is
  // silent, and silence scans clean.
  for (const id of SECTIONS) {
    await expect(page.locator(`#${id}`)).not.toBeEmpty();
    await expect(page.locator(`#${id} h2`)).toHaveCount(1);
  }

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // This lab ships NO in-page theme toggle of its own — the shared bar's
  // Dark is the only theme, so the page must carry no theme control at all —
  // not the shared bar's, which was removed, and not a lab-local one. The
  // shared CSS hides any lab toggle with `display:none !important`, which would
  // leave a dead-but-known element; asserting the count at zero catches the day
  // one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(0);

  // ── The arrival state: three panels have already computed ───────────────
  // The Hero scores its three runs at mount, Act V signs its default asset,
  // and Act VI signs and checks a false statement. All three verdicts must be
  // on the page before anything is scanned.
  //
  // Scoped to the result cards rather than counted across the section: the Hero
  // now also carries a consequence line, a staged reveal and — when the browser
  // gives the page no SHA-256 — an alarm verdict over the digests, and none of
  // those should be able to move a count whose meaning is "three runs scored".
  await expect(page.locator('#hero-experiment .result-card .verdict')).toHaveCount(3);
  await expect(
    page.locator('#hero-experiment .verdict.alarm'),
    'the Hero computes its digests at mount; an alarm there means it could not'
  ).toHaveCount(0);
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification passed');
  await expect(page.locator('#act-6 .verdict')).toContainText('Verification passed');
  // Act II scores the default sample at mount. Its pipeline breakdown is now
  // built on first open rather than eagerly, so what arrival can assert is that
  // the route to it exists; `driveLab` opens it and checks the stream itself.
  await expect(page.locator('#act-2 .verdict')).toHaveCount(1);
  await expect(page.locator('#act-2 details summary'))
    .toHaveText('Show the pipeline, on this text');
  // Act I renders a literal bracket at its default depth of three.
  await expect(page.locator('#act-1 .bracket .bracket-layer')).toHaveCount(3);

  // ── Every shipped control default ───────────────────────────────────────
  // `toHaveValue` is a property read with no actionability check, so these hold
  // at both depths and are worth keeping exactly as they are: four of the seven
  // live inside sections Demo hides, and this is what proves the lab tree
  // mounted with its shipped defaults while the short route is on screen.
  await expect(page.locator('#tournament-depth')).toHaveValue('3');
  await expect(page.locator('#tournament-distribution')).toHaveValue('high_entropy');
  await expect(page.locator('#wrong-key-count')).toHaveValue('100');
  await expect(page.locator('#detector-preset')).toHaveValue('');
  await expect(page.locator('#detector-input')).not.toHaveValue('');
  await expect(page.locator('#sign-asset')).not.toHaveValue('');
  await expect(page.locator('#lie-asset')).toHaveValue(/1687/);

  // ── Disclosures ship shut ───────────────────────────────────────────────
  // Every one of the ten arrives closed; the gate this replaces opened every
  // one from script before its only scan. The families are counted separately
  // as well as in total, because a total alone absorbs a disclosure appearing
  // in one panel while another loses its own.
  await expect(page.locator('details[open]')).toHaveCount(0);
  await expect(page.locator('details')).toHaveCount(10);
  // The Hero: one over the digests, and one calculation trail per result card.
  await expect(page.locator('#hero-experiment details')).toHaveCount(4);
  await expect(page.locator('#hero-experiment details.result-calculation')).toHaveCount(3);
  await expect(page.locator('#act-2 details')).toHaveCount(1);
  // Act IV's two attack-provenance disclosures, which is what this count was.
  await expect(page.locator('#act-4 details')).toHaveCount(2);
  await expect(page.locator('#act-5 details')).toHaveCount(1);
  await expect(page.locator('#act-6 details')).toHaveCount(1);
  await expect(page.locator('#act-7 details')).toHaveCount(1);
  // Act VII's eleven row explanations are `aria-expanded` triggers over rows that
  // are `hidden`, not `<details>`, so they are counted in their own shape.
  await expect(page.locator('#act-7 .compare-table button[aria-expanded]')).toHaveCount(11);
  await expect(page.locator('#act-7 .compare-table button[aria-expanded="true"]')).toHaveCount(0);

  // ── The depth this boot asked for is the depth the page is in ───────────
  await expectDepthApplied(page, mode);
  // The first real action is offered in the first viewport at both depths, and
  // it is enabled: it ships disabled with the reason on it and the Hero enables
  // it once the three runs have scored, so a disabled one here means they did
  // not.
  await expect(page.locator('#run-the-proof')).toBeEnabled();
  await expect(page.locator('#run-the-proof')).toBeInViewport();

  await settle(page);
  await expectNotBlank(page, `${theme} ${mode} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all. This lab's long
 * values are 64-byte hex runs — every `.field-value` and `.eq-derivation`
 * relies on `overflow-wrap: anywhere` instead of a scroll region, and the
 * `.sig-pair` grid collapses to one column at 640px — so the shapes at risk
 * are a new unwrapped `<code>` run or a grid item whose automatic minimum size
 * is the min-content of a 128-char line. At 380px that is precisely what this
 * check exists to catch.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab is full of scrollers, which makes the assertion the opposite of
 * vacuous: `.scroller` is the stylesheet's only author overflow rule, and
 * `dom.ts`'s `scroller()` helper wraps every wide table, the scored-token
 * stream, both inline charts and the comparison table in one. The helper gives
 * each `role="region"` and an `aria-label` unconditionally, and adds the tab
 * stop only for the ones that are ACTUALLY overflowing at the current width —
 * it measures, and re-measures on resize, rather than writing a literal
 * `tabindex="0"` every time. That is deliberate: a tab stop on a box with
 * nothing to scroll is a dead stop a keyboard reader has to pass through for
 * no gain, and at 1440 twelve of the fourteen fit their content.
 *
 * So this check is not a proof that the helper wrapped everything — it is the
 * stronger statement, that whatever overflows HERE, in this state and at this
 * width, has a keyboard route to it. A scroller born without one is invisible
 * to axe, and a scroller whose stop the measurement wrongly withheld fails
 * here rather than silently.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because the surfaces carrying
 *    this lab's meaning are `color-mix()` fills axe cannot resolve: every
 *    verdict tone, both pill states, the danger/caveat callouts, the
 *    learner-check tint, the hero aside and the shared bar's ink. Everything
 *    else in that bucket is a real result axe simply could not finish —
 *    including `aria-prohibited-attr`, which is where an `aria-label` on a
 *    role-less element hides. This page leans on getting that right: the
 *    `.seg`, `.radio-row`, `.preset-row` and learner-check option groups all
 *    pair their labels with `role="group"`. Drop any of those roles and the
 *    label is silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding a `<header class="cl-hero">` with an
  // `<aside class="cl-hero-why">` inside it, two `<nav>`s (the shared actions
  // and the section list), one `<main>` wrapping the acts, and a footer. The
  // aside sits OUTSIDE `<main>` for this reason: nested inside it, the
  // complementary landmark is no longer top level and this run says so.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

type ScanAt = (state: string) => Promise<void>;

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Eight things shape this drive:
 *
 *  - BOTH DEPTHS, IN ONE PASS, whichever one `boot` was handed. Demo hides
 *    twenty-four lab-only elements and Full lab hides three demo-only ones, and
 *    every oracle here goes blind on a `hidden` subtree — see rule 2b at the
 *    top of this file. A depth that is never driven is a depth that is never
 *    checked, and it would report as a clean run. The depth is changed through
 *    the segmented control in both directions and, once, through the branch
 *    link the short route ends with, because a page mid-life whose depth
 *    attributes have just been rewritten is a third rendering that booting into
 *    `?mode=` never produces.
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: every act
 *    mounted, the Hero's three runs computed, Act V signed, Act VI signed, Act
 *    I's bracket at depth three, all ten disclosures shut. The gate this
 *    replaces force-revealed everything before its only scan.
 *
 *  - THE DEMO BEATS ARE DRIVEN IN THE ORDER THE SCRIPT READS THEM — the proof,
 *    then signing and breaking, then the signed lie, then the comparison, then
 *    the branch — so the drive doubles as a rehearsal of the ninety seconds
 *    this page was staged for. A beat that cannot be reached in one action
 *    fails here rather than in front of an audience.
 *
 *  - EVERY PANEL THAT COMPUTES ON DEMAND IS MADE TO COMPUTE. The wrong-key
 *    sweep, the attack sweep, both corpus runs, the browser recomputation and
 *    Act II's pipeline breakdown all render nothing until something is pressed,
 *    so an unpressed control is a region that never existed to be scanned.
 *
 *  - EVERY ERROR AND REFUSAL STATE. A text too short to score paints a "No
 *    score" verdict instead of a number; editing the detector's textarea
 *    retires the previous verdict and replaces it with a notice; flipping an
 *    asset byte produces a failed verification; stripping the manifest produces
 *    a third outcome that is neither pass nor fail, and disables the two
 *    controls that break a manifest; a refused clipboard prints the link as
 *    selectable text; and a browser that gives the page no WebCrypto turns both
 *    signing acts into a recovery block with a retry. None of these is
 *    reachable without deliberately doing something, and none would be scanned
 *    by a drive that only pressed the happy path.
 *
 *  - HOVER IS A STATE. `:hover` stays on the element under the pointer after
 *    `page.click()` resolves — but only until something scrolls out from under
 *    the cursor, which several of these actions do, so the states meant to be
 *    hovered are hovered explicitly rather than inherited from a click.
 *    `button:hover`, `.mode-switch-option:hover`, `.chapters-link:hover` and
 *    `.cl-btn:hover` all repaint an edge or a fill.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: a
 *    progress line reaching its terminal wording, a verdict changing, a
 *    consequence line naming the outcome, a depth tag changing sides, a
 *    retirement notice appearing, a row count settling.
 *
 *  - THREE STATES NEED THE ENVIRONMENT CHANGED, AND NONE CHANGES THE PAGE.
 *    A busy rendering exists only while work runs, and a recovery rendering
 *    only when a browser capability is missing, so the last three steps make
 *    `crypto.subtle.sign` slow, then make `crypto.subtle` absent, then give it
 *    back and press the retry. All three are emulations of the machine a reader
 *    is on, in the same spirit as the reduced motion this gate boots with:
 *    nothing is injected into the document, no `hidden` is stripped, no state
 *    is forced, and the page runs its own code down its own paths. They run
 *    last, and in this order, because an init script cannot be taken back: the
 *    slow signature has to be able to find a `crypto.subtle` to be slow about,
 *    and the recovery has to boot into the loss before it can undo it.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt: ScanAt = (state) => scan(page, `${theme} / ${state}`);

  const arrival = await activeDepth(page);
  await scanAt(
    `arrival at ${DEPTH_LABEL[arrival]} depth: every act mounted, Hero scored, Act V and VI signed`
  );

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── The depth control, which is a control shape this page had none of ───
  const unselected = page.locator('.mode-switch-option[aria-pressed="false"]');
  await unselected.focus();
  await expect(unselected).toBeFocused();
  await scanAt('the depth control focused on its unselected segment');
  await unselected.hover();
  await scanAt('the depth control hovered on its unselected segment');

  if (arrival !== 'demo') await switchDepth(page, 'demo', scanAt);
  await driveDemo(page, scanAt);
  // Both directions through the real control, then the short route's own exit,
  // which is a link rather than a button and lands at a named act.
  await switchDepth(page, 'lab', scanAt);
  await switchDepth(page, 'demo', scanAt);
  await followBranchLink(page, scanAt);
  await driveLab(page, scanAt);
  // A cold arrival in Full lab, which `boot` does not have to have been given.
  // It is not the rendering reached by pressing the control: here everything
  // Acts I to IV draw is measured and painted while visible, where the
  // switched-to lab was laid out inside a `display: none` section and revealed
  // afterwards. A chart that measured a zero-width container would differ
  // between the two, and `?mode=lab` is the link an auditor is handed.
  await driveColdArrival(page, scanAt, 'lab');
  // The last two both install an init script, which cannot be taken back, so
  // they run at the end and in this order: the slow signature has to be able to
  // find a `crypto.subtle` to be slow about.
  await driveSlowSignature(page, scanAt);
  await driveWithoutWebCrypto(page, scanAt);
  // And the capability coming back, which is how a presenter leaves the state above:
  // the page has to recover into an act that can still be driven, not into a passed
  // verification with every control that acts on it switched off.
  await driveRestoredWebCrypto(page, scanAt);
}

/** The state a shared link opens on, at a depth the drive did not boot into. */
async function driveColdArrival(page: Page, scanAt: ScanAt, mode: Depth): Promise<void> {
  await page.goto(`./?mode=${mode}`);
  await expectDepthApplied(page, mode);
  await expect(page.locator('#hero-experiment .result-card .verdict')).toHaveCount(3);
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification passed');
  await expect(page.locator('details[open]')).toHaveCount(0);
  await scanAt(`a cold arrival at ${DEPTH_LABEL[mode]} depth, as a shared link opens it`);
}

/**
 * Change depth the way a reader does, and prove it took before scanning.
 *
 * The completion signal is the depth tags themselves rather than a wait: one
 * side has to be entirely hidden and the other entirely shown before this is a
 * settled rendering at all.
 */
async function switchDepth(page: Page, to: Depth, scanAt: ScanAt): Promise<void> {
  const from: Depth = to === 'demo' ? 'lab' : 'demo';
  await page.getByRole('button', { name: DEPTH_LABEL[to], exact: true }).click();
  await expect(page.locator(`[data-depth="${from}"]:not([hidden])`)).toHaveCount(0);
  await expect(page.locator(`[data-depth="${to}"]:not([hidden])`)).not.toHaveCount(0);
  await expectDepthApplied(page, to);
  await scanAt(`the depth control pressed: ${DEPTH_LABEL[from]} → ${DEPTH_LABEL[to]}`);
}

/**
 * The 90-second route, in the order the demo script reads it out.
 *
 * Each beat ends on the line that says what changed and what that did, and the
 * line is asserted against the state actually reached rather than against the
 * button that was pressed — flipping the same byte twice puts it back, and a
 * story told from the button would then announce a failure the page is not
 * showing.
 */
async function driveDemo(page: Page, scanAt: ScanAt): Promise<void> {
  const act5 = page.locator('#act-5');
  const act6 = page.locator('#act-6');

  // ── 0:00 Run the proof ──────────────────────────────────────────────────
  await page.locator('#run-the-proof').click();
  // Reduced motion is in effect and asserted in `boot`, so the staged reveal is
  // required to finish AT ONCE rather than over five beats: the preference asks
  // for the answer, not for a faster performance of it. A placeholder still on
  // the page here means the reveal is staging timers or opacity instead of
  // content, which is also what `expectNotBlank` exists to catch.
  await expect(page.locator('#hero-experiment .result-waiting')).toHaveCount(0);
  await expect(page.locator('#hero-experiment .result-metric-major .result-metric-value'))
    .toHaveCount(3);
  await expect(page.locator('#hero-experiment .consequence'))
    .toContainText('the watermark verdict disappeared.');
  await scanAt('demo 0:00 — the proof replayed, all three results shown at once');
  await page.locator('#run-the-proof').hover();
  await scanAt('demo 0:00 — the proof button hovered');

  // The audit trail the summary cards moved behind a disclosure. Opened one at
  // a time, then all three, which is the tallest the Hero ever gets and so the
  // shape the reflow check has the most to say about.
  const calculations = page.locator('#hero-experiment details.result-calculation');
  await calculations.first().locator('summary').click();
  await expect(calculations.first()).toHaveAttribute('open', '');
  await scanAt('demo — one result card’s calculation trail open');
  for (const index of [1, 2]) await calculations.nth(index).locator('summary').click();
  await expect(page.locator('#hero-experiment details[open]')).toHaveCount(3);
  await scanAt('demo — all three calculation trails open');

  // The identity claim is compressed to a sentence with the digests behind it,
  // so the copy affordance is the route most readers take to the evidence.
  const copyDigest = page.locator('#hero-experiment .identity-copy');
  const digests = page.locator('#hero-experiment details.identity-digests');
  await copyDigest.click();
  // Both outcomes are real renderings: a granted clipboard renames the button,
  // and a refusal — which is what a headless browser without the permission
  // gives, and what a reader behind an enterprise policy gets — opens the
  // digests and says so in a live region. Neither may reach the console;
  // `watchPageErrors` fails the whole run if one does.
  await expect
    .poll(
      async () =>
        (await copyDigest.textContent())?.trim() === 'Digest copied'
        || (await digests.getAttribute('open')) !== null,
      { message: 'the digest copy must answer on the page, whichever way it goes' }
    )
    .toBe(true);
  await scanAt('demo — the shared digest copy answered on the page');

  if ((await digests.getAttribute('open')) === null) await digests.locator('summary').click();
  await expect(page.locator('#hero-experiment .readout dd.hash').first()).toBeVisible();
  await scanAt('demo — the three 64-character digests revealed');

  // The share control, which is the deep link a presenter hands to a room.
  const share = page.locator('.share-button');
  await share.click();
  await expect
    .poll(
      async () =>
        (await share.textContent())?.trim() === 'Link copied'
        || (await page.locator('#share-link').count()) === 1,
      { message: 'the share control must answer on the page, whichever way it goes' }
    )
    .toBe(true);
  await scanAt('demo — the deep link copied, or offered as selectable text');

  // ── 0:25 Sign the same bytes, break it, put it back ─────────────────────
  await act5.getByRole('button', { name: 'Flip one byte of the asset' }).click();
  await expect(act5.locator('.verdict')).toContainText('Verification failed');
  await expect(act5.locator('.consequence')).toContainText('integrity verification failed.');
  await scanAt('demo 0:25 — one asset byte flipped, the hard binding broken');

  await act5.getByRole('button', { name: 'Strip the manifest' }).click();
  await expect(act5.locator('.verdict')).toContainText('No manifest');
  await expect(act5.locator('.consequence')).toContainText('there was nothing left to verify.');
  // With no manifest there is nothing to break, so the two controls that break
  // one are switched off. A disabled control is a distinct rendering with its
  // own colours, and WCAG 1.4.11 exempts it — which is a reason to scan it, not
  // a reason to skip it.
  await expect(act5.getByRole('button', { name: 'Flip one byte of the asset' })).toBeDisabled();
  await expect(act5.getByRole('button', { name: 'Strip the manifest' })).toBeDisabled();
  await scanAt('demo 0:25 — the manifest stripped, and what breaks one disabled');

  await act5.getByRole('button', { name: 'Reset act' }).click();
  await expect(act5.locator('.verdict')).toContainText('Verification passed');
  await expect(act5.locator('.consequence')).toContainText('integrity verification passed.');
  await expect(act5.getByRole('button', { name: 'Flip one byte of the asset' })).toBeEnabled();
  await scanAt('demo 0:25 — Act V reset: the shipped text and a fresh signature, no reload');

  // ── 0:55 Sign something false ───────────────────────────────────────────
  await page.locator('#lie-asset').fill('The moon is a hologram and this file proves it.');
  await act6.getByRole('button', { name: 'Sign and verify it' }).click();
  await expect(act6.locator('.verdict')).toContainText('Verification passed');
  await expect(act6.locator('.consequence')).toContainText('truth remained unanswered');
  await scanAt('demo 0:55 — a different false statement signed and checked');

  // ── 1:15 The compact comparison ─────────────────────────────────────────
  const lead = page.locator('#act-7 .compare-card-lead');
  await expect(lead).toContainText('WHO CAN VERIFY?');
  await lead.locator('summary').click();
  await expect(lead.locator('details')).toHaveAttribute('open', '');
  await scanAt('demo 1:15 — the load-bearing comparison card, explained');

  await driveChapters(page, scanAt, 'demo');

  // ── Presenter reliability: recover a tampered page without a reload ─────
  await act5.getByRole('button', { name: 'Flip one byte of the asset' }).click();
  await expect(act5.locator('.verdict')).toContainText('Verification failed');
  await page.locator('#reset-all').click();
  await expect(page.locator('#reset-status')).toHaveText('Every experiment has been reset.');
  await expect(act5.locator('.verdict')).toContainText('Verification passed');
  await expect(page.locator('#run-the-proof')).toBeEnabled();
  await expect(page.locator('#hero-experiment .result-waiting')).toHaveCount(0);
  // The rebuild replaces every panel, so the depth has to be re-applied to
  // elements that did not exist when it was last chosen.
  await expectDepthApplied(page, 'demo');
  await scanAt('demo — the global reset pressed from a tampered Act V');
}

/**
 * The chapter control, in whichever of its two shapes this viewport gets.
 *
 * One control, two renderings: a row of links on a wide screen, a chooser and
 * two step buttons on a phone, with the one that does not apply removed by
 * `display: none` rather than faded out. Which is operable is asked rather than
 * assumed — driving the other would time out on an element with no box, and
 * asserting on it would be asserting about something no reader can reach.
 *
 * Nothing here assumes where in the list the drive arrived: the earlier beats
 * scroll the page, so the current chapter is wherever they left it, and the
 * ends of the range are reached by choosing them rather than by counting on
 * them.
 */
async function driveChapters(page: Page, scanAt: ScanAt, depth: string): Promise<void> {
  const row = page.locator('.chapters-inner');
  if (await row.isVisible()) {
    const links = row.locator('.chapters-link');
    const last = links.last();
    // Nine chapter names are wider than the strip at every desktop width, so
    // focusing the last one is also the check that a link the reader cannot
    // see is still reachable and still brings itself into view.
    await last.focus();
    await expect(last).toBeFocused();
    await scanAt(`${depth} — the last chapter link focused, revealed inside the strip`);
    await last.hover();
    await scanAt(`${depth} — a chapter link hovered`);
    await last.click();
    await expect(last).toHaveAttribute('aria-current', 'true');
    await scanAt(`${depth} — the last chapter marked as current`);
    await links.first().click();
    await expect(links.first()).toHaveAttribute('aria-current', 'true');
    return;
  }

  const compact = page.locator('.chapters-compact');
  await expect(compact).toBeVisible();
  const select = page.locator('#chapter-select');
  const previous = page.getByRole('button', { name: 'Previous section' });
  const next = page.getByRole('button', { name: 'Next section' });
  const options = await select.locator('option').count();

  await select.selectOption({ index: 0 });
  // The ends of the range are genuinely inactive, and a real `disabled` is what
  // keeps them out of the tab order and out of the oracles that exempt an
  // inactive control. Each end is its own rendering.
  await expect(previous).toBeDisabled();
  await scanAt(`${depth} — the compact chapter control at the first chapter`);
  await select.focus();
  await expect(select).toBeFocused();
  await scanAt(`${depth} — the chapter chooser focused`);
  await next.click();
  await expect(previous).toBeEnabled();
  await scanAt(`${depth} — one chapter stepped forward`);
  await select.selectOption({ index: options - 1 });
  await expect(next).toBeDisabled();
  await scanAt(`${depth} — the last chapter chosen, and the step forward disabled`);
  await select.selectOption({ index: 0 });
  await expect(previous).toBeDisabled();
}

/**
 * The short route's own exit, which is a link into a section the short route
 * hides. It keeps a real `href` so it opens in a new tab and survives a page
 * with no script; the handler is what makes an ordinary click change depth in
 * place rather than reload the page an audience is looking at. If that ever
 * stopped working the link would land on a `hidden` section, which is exactly
 * the failure this step is here to find.
 */
async function followBranchLink(page: Page, scanAt: ScanAt): Promise<void> {
  const branch = page.locator('#branch-depth .branch-link').first();
  await branch.focus();
  await expect(branch).toBeFocused();
  await scanAt('demo 1:40 — a branch out of the short route, focused');
  await branch.click();
  await expect(page.locator('#act-1')).toBeVisible();
  await expectDepthApplied(page, 'lab');
  await scanAt('demo 1:40 — the branch followed: the full lab opened at the act that answers it');
}

/** Everything the full lab adds, at the depth where a reader can reach it. */
async function driveLab(page: Page, scanAt: ScanAt): Promise<void> {
  const hero = page.locator('#hero-experiment');
  const narrow = (page.viewportSize()?.width ?? 0) <= 640;

  // ── Hero: the wrong-key sweep ───────────────────────────────────────────
  // The largest draw the control offers rather than the smallest: it is three
  // seconds here, it exercises the range at its maximum, and the busy rendering
  // it puts up on the way — `aria-busy` on the region, the count in words,
  // every control switched off — is asserted as it passes. It is not scanned
  // here, because three seconds is not long enough to hold a scan still;
  // `driveSlowSignature` scans a busy rendering that is.
  await page.locator('#wrong-key-count').fill('300');
  const sweep = hero.getByRole('button', { name: 'Run the sweep' });
  await sweep.click();
  await expect(hero.locator('[aria-busy="true"]')).toHaveCount(1);
  await expect(hero.locator('.progress')).toContainText(/Scor(ing|ed)/);
  await expect(sweep).toBeDisabled();

  await expect(hero.locator('.progress')).toContainText('Done.');
  await expect(hero.locator('figure')).toHaveCount(1);
  await expect(sweep).toBeEnabled();
  await scanAt('Hero: wrong-key sweep run, histogram and empirical p-value painted');
  await sweep.hover();
  await scanAt('Hero: the sweep button under the pointer, so :hover is live');

  await hero.getByRole('button', { name: 'Reset the sweep' }).click();
  await expect(hero.locator('figure')).toHaveCount(0);
  await expect(page.locator('#wrong-key-count')).toHaveValue('100');
  await scanAt('Hero: the sweep reset to the draw it ships with');

  // ── Act I: the literal bracket, then the layered view ───────────────────
  await page.locator('#tournament-depth').fill('1');
  await expect(page.locator('#act-1 .bracket .bracket-layer')).toHaveCount(1);
  await scanAt('Act I: one tournament layer, two candidates');

  await page.locator('#tournament-depth').fill('8');
  await expect(page.locator('#act-1 .bracket .bracket-layer')).toHaveCount(8);
  await scanAt('Act I: eight layers, the largest bracket that is drawn literally');

  // Above eight layers the bracket is replaced by the aggregated view, which
  // is a different rendering with a different table and no match chips.
  await page.locator('#tournament-depth').fill('30');
  await expect(page.locator('#act-1 .bracket')).toHaveCount(0);
  await expect(page.locator('#act-1 table')).not.toHaveCount(0);
  await scanAt('Act I: thirty layers, the aggregated view with no bracket materialised');

  await page.locator('#tournament-distribution').selectOption('low_entropy');
  await expect(page.locator('#act-1 .readout').first()).toContainText('Effective candidates');
  await scanAt('Act I: the low-entropy distribution selected');

  // ── Act II: presets, the pipeline, refusal, retirement ──────────────────
  await page.locator('#detector-preset').selectOption('control');
  await expect(page.locator('#act-2 .verdict')).toHaveCount(1);
  await scanAt('Act II: the unwatermarked control scored, verdict showing no evidence');

  await page.locator('#detector-preset').selectOption('paraphrase');
  await expect(page.locator('#act-2 .verdict')).toHaveCount(1);
  await scanAt('Act II: the paraphrased text scored');

  // The whole breakdown — the token stream, the legend, the per-position table
  // and both readouts — is built on first open, so until this is pressed it is
  // not a closed region but an absent one, and a drive that never opened it
  // would leave the largest rendering in this act unscanned.
  await page.locator('#act-2 details summary').click();
  await expect(page.locator('#act-2 details .token-stream')).toHaveCount(1);
  await expect(page.locator('#act-2 .token-stream .token').first()).toBeVisible();
  await scanAt('Act II: the pipeline breakdown built and open, on the text just scored');

  // A text too short to score is refused rather than given a meaningless
  // number, and the refusal is its own rendering.
  await page.locator('#detector-input').fill('three words only');
  await expect(page.locator('#act-2 [data-retired]')).toHaveCount(1);
  await scanAt('Act II: the previous verdict retired because the text changed');

  await page.locator('#act-2').getByRole('button', { name: 'Score it' }).click();
  await expect(page.locator('#act-2 .verdict')).toContainText('No score');
  await scanAt('Act II: a text too short to score, refused');

  await page.locator('#act-2').getByRole('button', { name: 'Reset the detector' }).click();
  await expect(page.locator('#detector-preset')).toHaveValue('');
  await expect(page.locator('#act-2 .verdict')).not.toContainText('No score');
  await scanAt('Act II: the detector reset to the text and the verdict it ships with');

  // ── Act III: the corpus-scale entropy analysis ──────────────────────────
  await page.locator('#act-3').getByRole('button', { name: 'Score the watermarked corpus' })
    .click();
  await expect(page.locator('#act-3 .progress')).toContainText('Done.');
  await expect(page.locator('#act-3 table')).not.toHaveCount(0);
  await scanAt('Act III: the watermarked corpus scored, undetected texts listed');

  // ── Act IV: the attack sweep and both disclosures ───────────────────────
  await page.locator('#act-4').getByRole('button', { name: 'Run the sweep' }).click();
  await expect(page.locator('#act-4 .progress')).toContainText('Sweep complete.');
  await expect(page.locator('#act-4 tbody tr')).not.toHaveCount(0);
  await scanAt('Act IV: the attack sweep run, every individual measurement listed');

  const disclosures = page.locator('#act-4 details');
  const disclosureCount = await disclosures.count();
  for (let index = 0; index < disclosureCount; index += 1) {
    await disclosures.nth(index).locator('summary').click();
    await expect(disclosures.nth(index)).toHaveAttribute('open', '');
    await scanAt(`Act IV: attack provenance disclosure ${index + 1} open`);
  }

  // Acts V and VI carry no depth tag and render identically at both depths, so
  // they are driven once, in Demo, where the script needs them — and at both
  // viewports, because both viewports run this whole drive.

  // ── Act VII: the mechanism control over the comparison table ────────────
  for (const column of ['watermark', 'signature', 'c2pa']) {
    const segment = page.locator('#act-7').getByRole('button', { name: `Focus: ${column}` });
    await segment.click();
    // The control and the table have to agree. Once they did not: the click
    // rebuilt the table and announced the change but never repainted the
    // segments, so the table showed the chosen column while `aria-pressed`
    // still named whichever the panel had opened on. axe cannot see that —
    // `aria-pressed="true"` is valid, merely wrong — so it is asserted here.
    await expect(segment).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#act-7 .mechanism-switch-option[aria-pressed="true"]'))
      .toHaveCount(1);
    await expect(page.locator('#act-7 .compare-table')).toBeVisible();
    // On a phone the control is a genuine choice of the single column rendered,
    // rather than a tint on one of four that are all still there.
    if (narrow) await expect(page.locator('#act-7 .compare-table thead th')).toHaveCount(2);
    await scanAt(`Act VII: the ${column} column focused`);
  }
  await page.locator('#act-7').getByRole('button', { name: 'Show all three' }).click();
  await expect(page.locator('#act-7 .compare-table thead th')).toHaveCount(4);
  await scanAt('Act VII: all three columns shown again');

  // The question is its own disclosure trigger, and what it opens is a row
  // toggled with `hidden` rather than a `<details>` — a shape nothing else here
  // covers. Targeted through the id it controls rather than through its label,
  // because the label is the question and the question is editorial copy.
  const why = page.locator('#act-7 [aria-controls="compare-detail-who-can-verify"]');
  await why.click();
  await expect(why).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#compare-detail-who-can-verify')).toBeVisible();
  await expect(page.locator('#act-7 .compare-table button[aria-expanded="true"]'))
    .toHaveCount(1);
  await scanAt('Act VII: the load-bearing question explained inline');

  // ── Act VIII: the population estimate, and the corpus re-mixed ──────────
  // This act paints nothing at all until the run: 768 documents are scored in
  // the browser, and everything below the controls — the headline, three
  // readouts, the convergence chart and its table — is built from that one
  // result. An undriven Act VIII is not a shut region but an absent one.
  const act8 = page.locator('#act-8');
  await act8.getByRole('button', { name: 'Score the corpus and estimate' }).click();
  await expect(act8.locator('.progress')).toContainText('Done.');
  await expect(act8.locator('.act-headline-figure')).not.toBeEmpty();
  await expect(act8.locator('figure')).toHaveCount(1);
  await scanAt('Act VIII: the corpus scored, the marked fraction estimated with its interval');

  // Changing the mixture re-mixes documents already scored rather than scoring a
  // second pile, so this is a second rendering reached by moving one control —
  // and the readout is the completion signal, because there is no run to wait on.
  await page.locator('#act8-mixture').selectOption('0.10');
  await expect(act8.locator('.readout').first()).toContainText('10.0%');
  await scanAt('Act VIII: the same documents re-mixed at a tenth marked');

  await act8.getByRole('button', { name: 'Reset the estimate' }).click();
  await expect(act8.locator('.act-headline')).toHaveCount(0);
  await expect(page.locator('#act8-mixture')).toHaveValue('0.30');
  await scanAt('Act VIII: the estimate reset, back to the panel a reader arrives at');

  await driveChapters(page, scanAt, 'lab');

  // ── Focus rings on two different control shapes ─────────────────────────
  // `locator.focus()` succeeds on an element that paints nothing, so each is
  // confirmed to have taken the focus rather than assumed: a ring scanned on an
  // unpainted control is the one failure this pair could not otherwise report.
  await page.locator('#detector-input').focus();
  await expect(page.locator('#detector-input')).toBeFocused();
  await scanAt('a focused textarea');
  await page.locator('#tournament-depth').focus();
  await expect(page.locator('#tournament-depth')).toBeFocused();
  await scanAt('a focused range slider');
}

/**
 * The busy rendering, held still long enough to be scanned.
 *
 * Every asynchronous run on this page goes through one guard, which carries
 * `aria-busy` on the region for exactly as long as the work lasts, says so in
 * words rather than with a spinner — a spinner is invisible to a screen reader
 * and to a contrast oracle alike — and switches every control off. That
 * rendering is real and a reader on modest hardware sees it; on this machine
 * the longest run the page offers is a three-second sweep, and a scan is two
 * axe passes and three DOM walks, so nothing here stands still long enough to
 * be measured properly.
 *
 * So one browser primitive is made slow. `crypto.subtle.sign` is wrapped to
 * return the same bytes from the same call twenty seconds later; the page's own
 * code path, its inputs and its result are untouched, and three panels sign at
 * mount, so the whole busy rendering is on screen at once. This is the same
 * kind of emulation as the reduced motion above it — the environment, not the
 * page — and it is the only way to scan a state whose whole definition is "for
 * as long as the work runs".
 *
 * Twenty seconds is chosen against the scan rather than for effect: a scan on a
 * loaded runner is several seconds, and the window has to outlast one. The
 * assertions that wait for the settle afterwards therefore carry their own
 * timeout, because what is left of the twenty seconds can exceed the default.
 */
async function driveSlowSignature(page: Page, scanAt: ScanAt): Promise<void> {
  await page.addInitScript(() => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return;
    const sign = subtle.sign.bind(subtle) as unknown as
      (...args: unknown[]) => Promise<ArrayBuffer>;
    Object.defineProperty(subtle, 'sign', {
      configurable: true,
      value: (...args: unknown[]) => new Promise((resolve, reject) => {
        window.setTimeout(() => void sign(...args).then(resolve, reject), 20_000);
      }),
    });
  });
  await page.goto('./?mode=demo');

  await expect(page.locator('#act-5 [aria-busy="true"]')).toHaveCount(1);
  await expect(page.locator('#act-5 .progress')).toContainText('Signing with ECDSA P-256');
  await expect(page.locator('#act-6 [aria-busy="true"]')).toHaveCount(1);
  // Nothing that mutates a manifest may be pressed while one is being built.
  const live = await page.locator('#act-5 .controls button')
    .evaluateAll((buttons) => buttons.filter(
      (button) => !(button as HTMLButtonElement).disabled).length);
  expect(live, 'every control is switched off for the length of the run').toBe(0);
  await scanAt('the busy rendering: two acts signing, every control switched off');

  // And it has to end: a busy state that outlives its work is a hung panel, and
  // the scan above would be scanning one.
  const settled = { timeout: 40_000 };
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification passed', settled);
  await expect(page.locator('#act-5 [aria-busy="true"]')).toHaveCount(0, settled);
  await expect(page.locator('#act-5 .progress')).toHaveText('', settled);
}

/**
 * The lab in a browser that gives the page no WebCrypto.
 *
 * `crypto.subtle` exists only in a secure context, so a lab opened over plain
 * http:// from a projector laptop or a file share loses the whole signing half
 * of the page. Both signing acts answer that on the page — a recovery block
 * naming the cause, with a retry — and the Hero says its digests could not be
 * computed rather than leaving the identity claim asserted and unchecked. Those
 * are three renderings a happy-path drive never reaches, and they carry the
 * alarm tone, which nothing else in the arrival state uses.
 *
 * This removes a browser capability the page explicitly tests for, in the same
 * spirit as the reduced-motion emulation above it: it is the environment being
 * emulated, not the page being edited. Nothing is injected into the document,
 * no `hidden` is stripped and no state is forced — the page is left to discover
 * the loss the way a reader's browser would hand it over. It runs last because
 * an init script cannot be removed once added.
 */
async function driveWithoutWebCrypto(page: Page, scanAt: ScanAt): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, 'subtle', {
      get: () => undefined,
      configurable: true,
    });
  });
  await page.goto('./?mode=demo');

  await expect(page.locator('#act-5 .verdict')).toContainText('This run did not finish');
  await expect(page.locator('#act-6 .verdict')).toContainText('This run did not finish');
  await expect(page.locator('#hero-experiment .verdict.alarm'))
    .toContainText('The digests could not be computed');
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(2);
  // The detector half is untouched by any of this: it needs no WebCrypto, and a
  // page that had blanked it would be a page that lost more than it had to.
  await expect(page.locator('#hero-experiment .result-card .verdict')).toHaveCount(3);
  await scanAt('a browser with no WebCrypto: both signing acts recovered, the digests refused');

  await page.locator('#act-5').getByRole('button', { name: 'Try again' }).click();
  // The retry clears the notice before running, so a second failure has to
  // reprint it rather than leave an empty region behind.
  await expect(page.locator('#act-5 .verdict')).toContainText('This run did not finish');
  await scanAt('a browser with no WebCrypto: the retry pressed, and the failure restated');
}

/**
 * The retry that WORKS — the half of recovery no gate in this repository had reached.
 *
 * Every check above this one presses "Try again" in a browser that still has no
 * WebCrypto, so the only thing they can observe is the same failure printed twice. That
 * leaves the state a presenter actually ends up in unasserted: the projector laptop is
 * moved onto https, or the lab is reopened from localhost, the capability comes back and
 * the retry succeeds. What it succeeds INTO is the thing worth gating. Act V's three
 * mutation controls are switched off before a manifest exists, and the guard restores
 * every control to whatever it was before the run — which is the right default and
 * exactly the wrong answer here, because the run is what decides which of them should now
 * be available. A retry that bypasses the act's own settle therefore lands on a signed
 * manifest with "Flip one byte of the asset", "Strip the manifest" and "Verify again" all
 * still disabled: a passed verification the audience cannot do anything with, and no
 * failure anywhere to explain why.
 *
 * The capability is taken away and given back rather than counted out after a fixed
 * number of property reads. A read count is a guess about how many times the page happens
 * to touch `crypto.subtle` at boot, which is a number no contract fixes and which any
 * later edit moves; a flag the emulation itself owns restores exactly when this drive says
 * so, and until then the page boots into precisely the recovery state the drive above it
 * asserted. Nothing is injected into the document either way — this is the browser being
 * emulated, not the page being edited.
 *
 * `sign` is still the twenty-second one the slow-signature drive installed on the same
 * page, so the successful retry is deliberately slow and the waits below carry their own
 * budget.
 */
async function driveRestoredWebCrypto(page: Page, scanAt: ScanAt): Promise<void> {
  await page.addInitScript(() => {
    // The earlier emulation shadows `subtle` with an own property on `window.crypto`; the
    // prototype's own getter is untouched, and is where the real one is still reachable.
    const native = Object.getOwnPropertyDescriptor(Crypto.prototype, 'subtle')?.get;
    const real = native?.call(window.crypto) as SubtleCrypto | undefined;
    let restored = false;
    Object.defineProperty(window.crypto, 'subtle', {
      get: () => (restored ? real : undefined),
      configurable: true,
    });
    Object.defineProperty(window, '__restoreWebCrypto', {
      value: () => { restored = true; },
      configurable: true,
    });
  });
  await page.goto('./?mode=demo');

  const act5 = page.locator('#act-5');
  await expect(act5.locator('.verdict')).toContainText('This run did not finish');
  await page.evaluate(() =>
    (window as unknown as { __restoreWebCrypto: () => void }).__restoreWebCrypto());

  const slow = { timeout: 60_000 };
  await act5.getByRole('button', { name: 'Try again' }).click();
  await expect(act5.locator('.verdict')).toContainText('Verification passed', slow);
  // A recovery that leaves its own retry behind is a panel still claiming it failed.
  await expect(act5.getByRole('button', { name: 'Try again' })).toHaveCount(0);

  // The point of the case. A manifest now exists and is verified, so every control that
  // acts on one has to be pressable — this is the state the act's own settle describes,
  // and reaching it through the recovery path must not produce a different one.
  for (const name of ['Flip one byte of the asset', 'Strip the manifest', 'Verify again']) {
    await expect(
      act5.getByRole('button', { name }),
      `"${name}" is dead after a recovered run that produced a manifest`,
    ).toBeEnabled();
  }
  await scanAt('a browser that got WebCrypto back: the retry succeeded and the act is live');
}
