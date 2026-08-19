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
 *     This lab ships no tabs and no `[hidden]` panels: every act is on the page
 *     at once, and the only disclosures are the two attack-provenance
 *     `<details>` in Act IV. Those are opened through their `<summary>`, which
 *     is the route a reader has, and both states are scanned.
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

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including
 * the lab's DEFAULTS, which are never assumed.
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
 * The defaults are asserted at length because every panel on this page renders
 * from script at load, and three of them compute at mount: the Hero scores
 * three runs, Act V signs its default asset, and Act VI signs and checks a
 * false statement. A navigation that resolves proves nothing — a renderer that
 * threw would leave its section EMPTY, and an empty region is exactly what a
 * scan reports as perfectly accessible.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  // Every act mounted and produced content. This is the empty-region guard: a
  // panel whose renderer threw is silent, and silence scans clean.
  for (const id of ['hero-experiment', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5',
    'act-6', 'act-7', 'reference']) {
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
  await expect(page.locator('#hero-experiment .verdict')).toHaveCount(3);
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification passed');
  await expect(page.locator('#act-6 .verdict')).toContainText('Verification passed');
  // Act II scores the default sample at mount, and its pipeline breakdown renders.
  await expect(page.locator('#act-2 .verdict')).toHaveCount(1);
  await expect(page.locator('#act-2 .token-stream .token').first()).toBeVisible();
  // Act I renders a literal bracket at its default depth of three.
  await expect(page.locator('#act-1 .bracket .bracket-layer')).toHaveCount(3);

  // ── Every shipped control default ───────────────────────────────────────
  await expect(page.locator('#tournament-depth')).toHaveValue('3');
  await expect(page.locator('#tournament-distribution')).toHaveValue('high_entropy');
  await expect(page.locator('#wrong-key-count')).toHaveValue('100');
  await expect(page.locator('#detector-preset')).toHaveValue('');
  await expect(page.locator('#detector-input')).not.toHaveValue('');
  await expect(page.locator('#sign-asset')).not.toHaveValue('');
  await expect(page.locator('#lie-asset')).toHaveValue(/1687/);

  // ── Disclosures ship shut ───────────────────────────────────────────────
  // Act IV's two attack-provenance disclosures arrive closed; the gate this
  // replaces opened every one from script before its only scan.
  await expect(page.locator('details[open]')).toHaveCount(0);
  await expect(page.locator('details')).toHaveCount(2);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
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
 * each `role="region"`, an `aria-label` and `tabindex="0"`; this check is what
 * proves every scrolling region on the page actually went through it, since a
 * scroller born without a keyboard route is invisible to axe.
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

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Five things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: every
 *    act on the page, the Hero's three runs computed, Act V signed, Act VI
 *    signed, Act I's bracket at depth three, both disclosures shut. The gate
 *    this replaces force-revealed everything before its only scan.
 *
 *  - EVERY PANEL THAT COMPUTES ON DEMAND IS MADE TO COMPUTE. The wrong-key
 *    sweep, the attack sweep, the corpus scoring and the browser recomputation
 *    all render nothing until a button is pressed, so an unpressed button is a
 *    region that never existed to be scanned.
 *
 *  - EVERY ERROR AND REFUSAL STATE. A text too short to score paints a "No
 *    score" verdict instead of a number; editing the detector's textarea
 *    retires the previous verdict and replaces it with a notice; flipping an
 *    asset byte produces a failed verification; stripping the manifest
 *    produces a third outcome that is neither pass nor fail. None of these is
 *    reachable without deliberately doing something, and none would be scanned
 *    by a drive that only pressed the happy path.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the
 *    state a reader occupies the instant after pressing a button — and
 *    `button:hover`, `.act-nav a:hover` and `.cl-btn:hover` all repaint their
 *    edge or fill. It is scanned explicitly.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: a
 *    progress line reaching its terminal wording, a verdict changing, a
 *    retirement notice appearing, a row count settling.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (state: string): Promise<void> => scan(page, `${theme} / ${state}`);

  await scanAt('arrival: every act mounted, Hero scored, Act V and VI signed');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── Hero: the wrong-key sweep ───────────────────────────────────────────
  // Reduced to the smallest supported draw so the gate is not paying for 100
  // full re-scores at every viewport; the rendering is the same either way.
  await page.locator('#wrong-key-count').fill('20');
  await page.locator('#hero-experiment').getByRole('button', { name: 'Run the sweep' }).click();
  await expect(page.locator('#hero-experiment .progress')).toContainText('Done.');
  await expect(page.locator('#hero-experiment figure')).toHaveCount(1);
  await scanAt('Hero: wrong-key sweep run, histogram and empirical p-value painted');
  await scanAt('Hero: the sweep button still under the pointer, so :hover is live');

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

  // ── Act II: presets, refusal, retirement ────────────────────────────────
  await page.locator('#detector-preset').selectOption('control');
  await expect(page.locator('#act-2 .verdict')).toHaveCount(1);
  await scanAt('Act II: the unwatermarked control scored, verdict showing no evidence');

  await page.locator('#detector-preset').selectOption('paraphrase');
  await expect(page.locator('#act-2 .verdict')).toHaveCount(1);
  await scanAt('Act II: the paraphrased text scored');

  // A text too short to score is refused rather than given a meaningless
  // number, and the refusal is its own rendering.
  await page.locator('#detector-input').fill('three words only');
  await expect(page.locator('#act-2 [data-retired]')).toHaveCount(1);
  await scanAt('Act II: the previous verdict retired because the text changed');

  await page.locator('#act-2').getByRole('button', { name: 'Score it' }).click();
  await expect(page.locator('#act-2 .verdict')).toContainText('No score');
  await scanAt('Act II: a text too short to score, refused');

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

  // ── Act V: sign, tamper, strip ──────────────────────────────────────────
  await page.locator('#act-5').getByRole('button', { name: 'Flip one byte of the asset' })
    .click();
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification failed');
  await scanAt('Act V: one asset byte flipped, the binding broken');

  await page.locator('#act-5').getByRole('button', { name: 'Strip the manifest' }).click();
  await expect(page.locator('#act-5 .verdict')).toContainText('No manifest');
  await scanAt('Act V: the manifest stripped, nothing left to verify');

  await page.locator('#act-5').getByRole('button', { name: 'Sign it' }).click();
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification passed');
  await scanAt('Act V: re-signed, and the manifest disclosure painted again');

  // ── Act VI: a signed statement that is plainly false ────────────────────
  await page.locator('#lie-asset').fill('The moon is a hologram and this file proves it.');
  await page.locator('#act-6').getByRole('button', { name: 'Sign and verify it' }).click();
  await expect(page.locator('#act-6 .verdict')).toContainText('Verification passed');
  await scanAt('Act VI: a different false statement signed and checked');

  // ── Act VII: the focus controls on the comparison table ─────────────────
  for (const column of ['watermark', 'signature', 'c2pa']) {
    await page.locator('#act-7').getByRole('button', { name: `Focus: ${column}` }).click();
    await expect(page.locator('#act-7 .compare-table')).toBeVisible();
    await scanAt(`Act VII: the ${column} column focused`);
  }
  await page.locator('#act-7').getByRole('button', { name: 'Show all three' }).click();
  await scanAt('Act VII: all three columns shown again');

  // One "Why?" disclosure open, which is a row inserted into the table body
  // rather than a <details>, and therefore a shape nothing else here covers.
  await page.locator('#act-7').getByRole('button', { name: /^Why: / }).first().click();
  await expect(page.locator('#act-7 .compare-table button[aria-expanded="true"]'))
    .toHaveCount(1);
  await scanAt('Act VII: one comparison row explained inline');

  // ── Focus rings on two different control shapes ─────────────────────────
  await page.locator('#detector-input').focus();
  await scanAt('a focused textarea');
  await page.locator('#tournament-depth').focus();
  await scanAt('a focused range slider');
}
