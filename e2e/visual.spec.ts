import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

/**
 * The visual contract: what the page has to look like, asserted as geometry.
 *
 * The defect that produced this file passed every gate the repository had. Every act
 * mounted, every statistic re-derived, axe reported nothing, and the claims suite agreed
 * with each number on the page — while the three figures the whole experiment exists to
 * compare rendered one character per line at an ordinary laptop width. No DOM assertion
 * could see it, because the DOM was correct; only the geometry was wrong.
 *
 * So the gate here is geometry and DOM state, asserted numerically: a value's box width
 * against the character advance of the value's own font, line boxes counted from Range
 * rectangles, blank bands measured in pixels down the first screen, and the position of a
 * heading against the lowest edge of every sticky bar above it.
 *
 * Screenshots are attached to the report for a person to look at, and are never compared
 * against a stored baseline. This repository is developed on macOS and gated on
 * ubuntu-latest, and a pixel baseline across those two font stacks fails on hinting,
 * fallback faces and subpixel rounding rather than on the defect it was written to catch.
 * A suite that fails for the wrong reason is worse than no suite, because the first thing
 * it teaches its reader is to re-record the baseline. Every threshold below is therefore
 * either relative to something the page itself supplies — the advance of the value's own
 * font, the measured height of the sticky bars, the viewport in use — or a distance the
 * layout's own spacing rules fix, so the same numbers hold on a runner with other fonts.
 *
 * The suite shares no machinery with e2e/gate.ts. That is deliberate: a failure here
 * should be a statement about the rendering rather than about the accessibility gate's
 * oracles, and either file should be readable on its own.
 */

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/**
 * The four widths the plan names. 1052 is not a device; it is the width at which the
 * three score cards were measured wrapping a character at a time, and it stays in the
 * list for that reason alone.
 */
const VIEWPORTS: readonly Viewport[] = [
  { name: 'phone 390', width: 390, height: 844 },
  { name: 'tablet 768', width: 768, height: 1024 },
  { name: 'laptop 1052', width: 1052, height: 923 },
  { name: 'presentation 1440', width: 1440, height: 900 },
];

type Mode = 'demo' | 'lab';

const MODES: readonly Mode[] = ['demo', 'lab'];

/**
 * The largest blank band the first screen may contain.
 *
 * Measured rather than guessed. The tallest legitimate band the current layout produces
 * is 62 px at 1440 — the hero row's own 48 px gap plus the presenter bar's 14 px margin —
 * and it falls to 17 px at 390. The failure this catches is the desktop flex basis left
 * in force after the hero stacks into a column, which was recorded as "a large blank gap"
 * in the audit and measures 199 px at 390 when it is put back. 96 px sits between the two
 * and names both: comfortably above every gap the spacing rules ask for, comfortably
 * below a hole where a panel should be.
 */
const MAX_BLANK_BAND_PX = 96;

/**
 * The specific gap the audit named: the one between the hero description and the
 * why-it-matters panel once the layout is a column. Measured as EMPTY pixels between the
 * two boxes rather than as the distance between them, because at 390 the presenter's bar,
 * the thesis and the call to action all sit between them legitimately.
 */
const MAX_HERO_GAP_PX = 40;

/** The chip cloud this control replaced was 322 px tall on a phone. */
const MAX_CHAPTERS_PX = 56;

/**
 * A value's box must be wide enough for eight characters of its own font. Eight is the
 * plan's number and it is the right one: the longest figure the cards print is
 * `Binomial(9,060, 1/2)`, and a box that cannot hold eight characters cannot hold any of
 * the shorter ones either without breaking them across lines.
 */
const MIN_VALUE_CHARS = 8;

/** Two lines is a wrap; six lines of one character each is the defect. */
const MAX_VALUE_LINES = 2;

/**
 * The character-per-line test. A value on a single line has not wrapped and is exempt by
 * construction — several of these figures are one or two characters long. A value that
 * did wrap must average at least four characters a line, which no vertical rendering of a
 * number can satisfy.
 */
const MIN_CHARS_PER_LINE = 4;

/* -----------------------------------------------------------------------------------
   Measurements taken inside the page.

   Each of these is passed whole to `page.evaluate`, so each has to be self-contained:
   they close over nothing in this file and call nothing from it, which is why the
   painted-surface test appears in more than one of them.
   ----------------------------------------------------------------------------------- */

interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface BlankBand {
  readonly px: number;
  readonly at: number;
  readonly above: string;
  readonly below: string;
}

interface FirstScreen {
  readonly documentWidth: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly scrollY: number;
  readonly stickyBottom: number;
  readonly widestOverflowing: string;
  readonly blank: BlankBand;
  readonly heroGap: number | null;
  readonly cta: Box | null;
  readonly ctaHit: string;
  readonly ctaCovered: boolean;
  readonly chapters: Box | null;
  readonly chaptersShape: 'row' | 'compact' | 'none';
}

/**
 * Everything the first screen has to answer for, in one pass.
 *
 * "Blank" is decided by what actually paints: an element with its own text, a replaced
 * element or a control, or a surface with a background or a border. Marking every box
 * would mark the whole screen — `body` and `#app` cover all of it and paint nothing on
 * their own — and a band scan that can never find a gap is not a check.
 */
const readFirstScreen = (): FirstScreen => {
  const paints = (element: Element): boolean => {
    const styles = getComputedStyle(element);
    if (styles.visibility === 'hidden' || styles.display === 'none') return false;
    const ownText = Array.from(element.childNodes)
      .some((node) => node.nodeType === 3 && (node.textContent ?? '').trim().length > 0);
    if (ownText) return true;
    if (/^(IMG|SVG|CANVAS|INPUT|SELECT|TEXTAREA|BUTTON|HR|VIDEO)$/.test(element.tagName)) {
      return true;
    }
    const background = styles.backgroundColor;
    if (background && !/rgba\(0, 0, 0, 0\)|transparent/.test(background)) return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
      const width = Number.parseFloat(
        styles.getPropertyValue(`border-${side.toLowerCase()}-width`));
      const colour = styles.getPropertyValue(`border-${side.toLowerCase()}-color`);
      return width > 0 && !/rgba\(0, 0, 0, 0\)/.test(colour);
    });
  };

  const name = (element: Element | null): string => {
    if (!element) return 'nothing';
    const id = element.id ? `#${element.id}` : '';
    const className = typeof element.className === 'string' && element.className
      ? `.${element.className.trim().split(/\s+/)[0]}`
      : '';
    return `${element.tagName.toLowerCase()}${id}${className}`;
  };

  const boxOf = (element: Element | null): Box | null => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
  };

  const painted = Array.from(document.querySelectorAll('body *')).filter(paints);
  const viewportHeight = window.innerHeight;

  const occupied = new Uint8Array(Math.ceil(viewportHeight));
  for (const element of painted) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) continue;
    if (rect.bottom < 0 || rect.top > viewportHeight) continue;
    const from = Math.max(0, Math.floor(rect.top));
    const to = Math.min(viewportHeight, Math.ceil(rect.bottom));
    for (let y = from; y < to; y += 1) occupied[y] = 1;
  }
  let worst = 0;
  let worstAt = 0;
  let run = 0;
  for (let y = 0; y < occupied.length; y += 1) {
    if (occupied[y]) {
      run = 0;
      continue;
    }
    run += 1;
    if (run > worst) {
      worst = run;
      worstAt = y - run + 1;
    }
  }
  const middle = window.innerWidth / 2;
  const blank: BlankBand = {
    px: worst,
    at: worstAt,
    above: name(document.elementFromPoint(middle, Math.max(0, worstAt - 2))),
    below: name(document.elementFromPoint(
      middle, Math.min(viewportHeight - 1, worstAt + worst + 2))),
  };

  // The audit's gap, measured as the tallest empty run between the two boxes rather than
  // as the distance between them: at 390 the two are no longer neighbours.
  const main = document.querySelector('.cl-hero-main');
  const why = document.querySelector('.cl-hero-why');
  let heroGap: number | null = null;
  if (main && why) {
    const mainRect = main.getBoundingClientRect();
    const whyRect = why.getBoundingClientRect();
    const from = Math.min(mainRect.bottom, whyRect.bottom);
    const to = Math.max(mainRect.top, whyRect.top);
    if (to <= from) {
      heroGap = 0; // Side by side; there is no vertical gap to measure.
    } else {
      const span = Math.ceil(to - from);
      const between = new Uint8Array(span);
      for (const element of painted) {
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= from || rect.top >= to) continue;
        const start = Math.max(0, Math.floor(rect.top - from));
        const end = Math.min(span, Math.ceil(rect.bottom - from));
        for (let y = start; y < end; y += 1) between[y] = 1;
      }
      let gap = 0;
      let current = 0;
      for (let y = 0; y < span; y += 1) {
        if (between[y]) {
          current = 0;
          continue;
        }
        current += 1;
        if (current > gap) gap = current;
      }
      heroGap = gap;
    }
  }

  // Only a bar that is currently PINNED can cover anything. The chapter control is
  // sticky, but at the top of the document it is still in flow below the call to action,
  // and counting it there would fail the page for the position it is not in. Pinned means
  // the element has reached its own `top` offset.
  const stickyBottom = Array.from(document.querySelectorAll('body *'))
    .filter((element) => getComputedStyle(element).position === 'sticky')
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter((entry) => entry.rect.height > 0 && entry.rect.width > 0)
    .filter((entry) => {
      const offset = Number.parseFloat(getComputedStyle(entry.element).top);
      return Number.isFinite(offset) && entry.rect.top <= offset + 1;
    })
    .reduce((lowest, entry) => Math.max(lowest, entry.rect.bottom), 0);

  const root = document.documentElement;
  const overflowing = Array.from(document.querySelectorAll('body *'))
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter((entry) => entry.rect.width > 0 && entry.rect.right > root.clientWidth + 1)
    .sort((a, b) => b.rect.right - a.rect.right)[0];

  const cta = document.getElementById('run-the-proof');
  const ctaRect = cta ? cta.getBoundingClientRect() : null;
  const hit = ctaRect
    ? document.elementFromPoint(
      ctaRect.left + ctaRect.width / 2, ctaRect.top + ctaRect.height / 2)
    : null;

  const chapters = document.getElementById('chapters');
  const row = document.querySelector('.chapters-inner');
  const compact = document.querySelector('.chapters-compact');
  const shown = (element: Element | null): boolean =>
    element !== null && getComputedStyle(element).display !== 'none';

  return {
    documentWidth: root.scrollWidth,
    viewportWidth: root.clientWidth,
    viewportHeight,
    scrollY: Math.round(window.scrollY),
    stickyBottom: Math.round(stickyBottom),
    widestOverflowing: overflowing
      ? `${name(overflowing.element)} right=${Math.round(overflowing.rect.right)}`
      : 'nothing',
    blank,
    heroGap,
    cta: boxOf(cta),
    ctaHit: name(hit),
    ctaCovered: cta !== null && hit !== null && hit !== cta && !cta.contains(hit),
    chapters: boxOf(chapters),
    chaptersShape: shown(row) ? 'row' : shown(compact) ? 'compact' : 'none',
  };
};

interface ValueGeometry {
  readonly text: string;
  readonly width: number;
  readonly advance: number;
  readonly chars: number;
  readonly lines: number;
  readonly charsPerLine: number;
}

/**
 * Every value matching a selector, measured against its own font.
 *
 * The character advance is taken from a canvas configured with the element's computed
 * font rather than from an assumed em ratio, so the same thresholds hold when the CI
 * runner substitutes DejaVu for the mono stack this laptop resolves. Lines are counted
 * from the Range's client rectangles: height arithmetic cannot tell a wrapped value from
 * a value with a taller line box, and it was height arithmetic that let the original
 * defect through.
 */
const readValues = (selector: string): ValueGeometry[] => {
  const advanceOf = (element: Element): number => {
    const styles = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return Number.NaN;
    context.font =
      `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
    return context.measureText('00000000').width / 8;
  };

  const linesOf = (element: Element): number => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops: number[] = [];
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 0.5 || rect.height < 0.5) continue;
      if (!tops.some((top) => Math.abs(top - rect.top) < 2)) tops.push(rect.top);
    }
    return tops.length;
  };

  return Array.from(document.querySelectorAll(selector))
    .filter((element) => (element.textContent ?? '').trim().length > 0)
    .map((element) => {
      const text = (element.textContent ?? '').trim();
      const width = element.getBoundingClientRect().width;
      const advance = advanceOf(element);
      const lines = linesOf(element);
      return {
        text,
        width: Math.round(width),
        advance: Math.round(advance * 100) / 100,
        chars: Math.round((width / advance) * 10) / 10,
        lines,
        charsPerLine: lines > 0 ? Math.round((text.length / lines) * 10) / 10 : 0,
      };
    });
};

interface AnchorGeometry {
  readonly found: boolean;
  readonly sectionTop: number;
  readonly headingTop: number;
  readonly headingText: string;
  readonly stickyBottom: number;
  readonly viewportHeight: number;
  readonly hit: string;
  readonly hitInsideHeading: boolean;
}

/**
 * Where a deep-link target came to rest, and whether anything is sitting on top of it.
 *
 * Two sticky bars stack above this document, so "did the jump clear the bars" is a
 * question about the lowest edge of all of them rather than about a constant. The hit
 * test is the part that cannot be argued with: a heading whose own centre belongs to some
 * other element is covered, whatever the arithmetic says about the offsets.
 */
const readAnchor = (id: string): AnchorGeometry => {
  const section = document.getElementById(id);
  const heading = section?.querySelector('h2, .panel-title') ?? null;
  // Pinned bars only, for the reason `readFirstScreen` gives: a sticky element still in
  // flow is not covering the thing below it.
  const stickyBottom = Array.from(document.querySelectorAll('body *'))
    .filter((element) => getComputedStyle(element).position === 'sticky')
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter((entry) => entry.rect.height > 0 && entry.rect.width > 0)
    .filter((entry) => {
      const offset = Number.parseFloat(getComputedStyle(entry.element).top);
      return Number.isFinite(offset) && entry.rect.top <= offset + 1;
    })
    .reduce((lowest, entry) => Math.max(lowest, entry.rect.bottom), 0);

  if (!section || !heading) {
    return {
      found: false, sectionTop: 0, headingTop: 0, headingText: '',
      stickyBottom: Math.round(stickyBottom), viewportHeight: window.innerHeight,
      hit: 'nothing', hitInsideHeading: false,
    };
  }

  const rect = heading.getBoundingClientRect();
  const hit = document.elementFromPoint(
    rect.left + rect.width / 2, rect.top + rect.height / 2);
  const classes = hit && typeof hit.className === 'string' && hit.className
    ? `.${hit.className.trim().split(/\s+/)[0]}`
    : '';
  const name = hit
    ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${classes}`
    : 'nothing';

  return {
    found: true,
    sectionTop: Math.round(section.getBoundingClientRect().top),
    headingTop: Math.round(rect.top),
    headingText: (heading.textContent ?? '').trim().slice(0, 60),
    stickyBottom: Math.round(stickyBottom),
    viewportHeight: window.innerHeight,
    hit: name,
    hitInsideHeading: hit !== null && (hit === heading || heading.contains(hit)),
  };
};

/* -----------------------------------------------------------------------------------
   Driving the page.
   ----------------------------------------------------------------------------------- */

/**
 * Open the page at a depth and wait for the hero to have finished scoring.
 *
 * The mode travels in the URL because that is the route a presenter really has — the
 * share control copies exactly this link — so the arrival state being measured is one a
 * reader can reach rather than one the test arranged.
 */
async function open(page: Page, mode: Mode, hash = ''): Promise<void> {
  await page.goto(`./?mode=${mode}${hash}`);
  await expect(page.locator('#hero-experiment .result-card')).toHaveCount(3);
  await expect(page.locator('#run-the-proof')).toBeEnabled();
}

/**
 * Wait for scrolling to stop rather than for a duration that might outlive it. Polled a
 * frame at a time, and satisfied only by three consecutive frames at the same offset, so
 * a jump that lands in two stages cannot be measured between them.
 */
async function scrollSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = window as unknown as { __lastY?: number; __stillFor?: number };
    const y = Math.round(window.scrollY);
    state.__stillFor = y === state.__lastY ? (state.__stillFor ?? 0) + 1 : 0;
    state.__lastY = y;
    return (state.__stillFor ?? 0) >= 3;
  }, undefined, { polling: 'raf', timeout: 10_000 });
}

/**
 * A focused screenshot, written to the run's output directory and attached to the report.
 *
 * Focused because the document is between six and forty thousand pixels tall: a full-page
 * capture of it is a picture nobody opens, and the renderings worth a person's attention
 * are the hero summary, the signing experiment and the comparison.
 *
 * Attached as bytes rather than compared against anything. To look at them, run this file
 * with `--reporter=html`: the images are then written into `playwright-report/` beside the
 * state that produced them. The repository's default `list` reporter records the
 * attachment and prints nothing, which is the right trade for a suite whose gate is the
 * arithmetic above and whose pictures are for a person deciding whether the arithmetic
 * asked for the right thing.
 */
async function capture(testInfo: TestInfo, target: Locator, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await target.screenshot(),
    contentType: 'image/png',
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('the first screen leads with the proof and holds no accidental blank region',
      async ({ page }) => {
        for (const mode of MODES) {
          await open(page, mode);
          const screen = await page.evaluate(readFirstScreen);
          const where = `${mode} @${viewport.width}x${viewport.height}`;

          expect(screen.scrollY, `${where}: a cold load must open at the top`).toBe(0);

          // WCAG 1.4.10, and the reason the phone column exists in this suite at all.
          expect(
            screen.documentWidth,
            `${where}: the page must not scroll sideways on arrival; widest offender ` +
            `${screen.widestOverflowing}`,
          ).toBeLessThanOrEqual(screen.viewportWidth);

          // The audit's finding was that the first actionable control was 3,607 px down.
          // This is the assertion that keeps it in the first screen at every width.
          expect(screen.cta, `${where}: "Run the proof" must exist`).not.toBeNull();
          const cta = screen.cta as Box;
          expect(
            cta.bottom,
            `${where}: "Run the proof" must be readable without scrolling, and its foot ` +
            `is at ${cta.bottom} against a fold at ${screen.viewportHeight}`,
          ).toBeLessThanOrEqual(screen.viewportHeight);
          expect(
            cta.top,
            `${where}: "Run the proof" must not start behind the sticky bars, which end ` +
            `at ${screen.stickyBottom}`,
          ).toBeGreaterThanOrEqual(screen.stickyBottom);
          // Arithmetic can agree while something floats over the button; this cannot.
          expect(
            screen.ctaCovered,
            `${where}: "Run the proof" is covered — its own centre belongs to ` +
            `${screen.ctaHit}`,
          ).toBe(false);

          // The hero spacer: a desktop flex basis becomes vertical space in a column.
          expect(screen.heroGap, `${where}: both halves of the hero must be present`)
            .not.toBeNull();
          expect(
            screen.heroGap as number,
            `${where}: ${screen.heroGap}px of nothing between the hero description and ` +
            'the why-it-matters panel is a spacer left over from the row layout',
          ).toBeLessThanOrEqual(MAX_HERO_GAP_PX);

          expect(
            screen.blank.px,
            `${where}: a ${screen.blank.px}px blank band at y=${screen.blank.at}, between ` +
            `${screen.blank.above} and ${screen.blank.below}, reads as a missing panel`,
          ).toBeLessThanOrEqual(MAX_BLANK_BAND_PX);

          // Navigation must not displace the thing it navigates to: the chip cloud this
          // control replaced was 322 px tall on a phone.
          expect(screen.chapters, `${where}: the chapter control must exist`).not.toBeNull();
          const chapters = screen.chapters as Box;
          expect(
            chapters.height,
            `${where}: the chapter control is ${chapters.height}px tall in its ` +
            `${screen.chaptersShape} shape`,
          ).toBeLessThanOrEqual(MAX_CHAPTERS_PX);
          expect(
            screen.chaptersShape,
            `${where}: exactly one shape of the chapter control must paint`,
          ).toBe(viewport.width <= 640 ? 'compact' : 'row');
        }
      });

    test('no hero result value is narrower than eight characters, or wraps a character ' +
      'at a time', async ({ page }, testInfo) => {
      // The hero carries no depth tag, so these three cards are the same DOM at both
      // depths; the depth-independence is asserted below rather than assumed, and the
      // measurements are taken once.
      await open(page, 'demo');

      const promoted = await page.evaluate(
        readValues, '#hero-experiment .result-card .result-metric-value');
      expect(promoted.length,
        'the hero must promote three figures on each of its three cards').toBe(9);

      // The full calculation trail is where the original failure lived: fifteen dense
      // pairs in a 319px card, with the value track measured at 0px. It is behind a
      // disclosure now, and a disclosure is exactly where a broken layout hides.
      const summaries = page.locator('#hero-experiment .result-calculation > summary');
      await expect(summaries).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) await summaries.nth(index).click();
      await expect(page.locator('#hero-experiment .result-calculation[open]')).toHaveCount(3);

      const trail = await page.evaluate(
        readValues, '#hero-experiment .result-card .disclosure-body dd');
      expect(trail.length,
        'the calculation trail must render its rows, not merely reserve room for them')
        .toBeGreaterThan(20);

      const where = `@${viewport.width}x${viewport.height}`;
      for (const value of [...promoted, ...trail]) {
        const described = `${where}: "${value.text}" in a box ${value.width}px wide, ` +
          `${value.chars} characters of its own ${value.advance}px advance, on ` +
          `${value.lines} line(s)`;
        // A box narrower than eight characters cannot print a mean g-score, a threshold
        // or a p-value without breaking it, whatever the text in it happens to be.
        expect(value.chars, `${described} — below ${MIN_VALUE_CHARS} characters`)
          .toBeGreaterThanOrEqual(MIN_VALUE_CHARS);
        expect(value.lines, `${described} — a value on more than ${MAX_VALUE_LINES} lines`)
          .toBeLessThanOrEqual(MAX_VALUE_LINES);
        // One line has not wrapped and is exempt: several of these figures are shorter
        // than four characters to begin with.
        if (value.lines > 1) {
          expect(value.charsPerLine,
            `${described} — wrapped at ${value.charsPerLine} characters a line`)
            .toBeGreaterThanOrEqual(MIN_CHARS_PER_LINE);
        }
      }

      await capture(testInfo, page.locator('#hero-experiment .result-grid'),
        `hero-summary-${viewport.width}.png`);

      // The depth switch is a display decision. If it resizes the hero, one of the two
      // depths is being measured and the other is not.
      const before = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#hero-experiment .result-card'))
          .map((card) => Math.round(card.getBoundingClientRect().width)));
      await page.getByRole('button', { name: 'Full lab' }).click();
      await expect(page.locator('#act-1')).toBeVisible();
      const after = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#hero-experiment .result-card'))
          .map((card) => Math.round(card.getBoundingClientRect().width)));
      expect(after, `${where}: the depth switch must not resize the result cards`)
        .toEqual(before);
    });

    test('the comparison never pushes the page sideways', async ({ page }, testInfo) => {
      // Four questions as cards on the short route, ten as a table in the lab, and on a
      // phone one mechanism column at a time. Each of those is a different width of
      // content inside the same column, and each is driven here rather than assumed.
      const overflow = async (state: string): Promise<void> => {
        const screen = await page.evaluate(readFirstScreen);
        expect(
          screen.documentWidth,
          `${state} @${viewport.width}: the comparison must not push the document ` +
          `sideways; widest offender ${screen.widestOverflowing}`,
        ).toBeLessThanOrEqual(screen.viewportWidth);
      };

      await open(page, 'demo');
      await page.locator('#act-7').scrollIntoViewIfNeeded();
      await expect(page.locator('#act-7 .compare-card:visible')).toHaveCount(4);
      await expect(page.locator('#act-7 .compare-table:visible')).toHaveCount(0);
      await overflow('demo, four cards');
      await page.locator('#act-7 .compare-card summary').first().click();
      await overflow('demo, the load-bearing card expanded');
      await capture(testInfo, page.locator('#act-7 .compare-cards'),
        `comparison-demo-${viewport.width}.png`);

      await open(page, 'lab');
      await page.locator('#act-7').scrollIntoViewIfNeeded();
      await expect(page.locator('#act-7 .compare-table:visible')).toHaveCount(1);
      await expect(page.locator('#act-7 .compare-card:visible')).toHaveCount(0);
      for (const mechanism of
        ['Focus: watermark', 'Focus: signature', 'Focus: c2pa', 'Show all three']) {
        await page.locator('#act-7').getByRole('button', { name: mechanism }).click();
        await expect(page.locator('#act-7 .mechanism-switch-option[aria-pressed="true"]'))
          .toHaveCount(1);
        await overflow(`lab, ${mechanism}`);
      }
      // The one disclosure on the page that inserts a full-width row into a table.
      await page.locator('#act-7 .compare-why').first().click();
      await expect(page.locator('#act-7 .compare-table button[aria-expanded="true"]'))
        .toHaveCount(1);
      await overflow('lab, a question expanded');
      // The panel rather than the table: the table is deliberately wider than the column
      // at narrow widths and lives inside a scroller, so the panel is what a reader sees.
      await capture(
        testInfo,
        page.locator('#act-7 .panel').filter({ has: page.locator('.compare-table') }),
        `comparison-lab-${viewport.width}.png`,
      );
    });

    test('sticky controls never cover a heading a deep link landed on', async ({ page }) => {
      // Reduced motion makes the browser's own jump instant, which removes a race the
      // assertion would otherwise have to guess at. It is a preference a reader really
      // sets, so the geometry measured under it is geometry a reader really gets.
      await page.emulateMedia({ reducedMotion: 'reduce' });

      for (const mode of MODES) {
        await open(page, mode);
        // The chapter list is read from the links, which both shapes of the control
        // render; the navigation below then goes through whichever shape this width
        // actually paints, because driving the hidden one would prove nothing.
        const chapters = await page.locator('#chapters .chapters-link')
          .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
        expect(chapters.length,
          `${mode}: the chapter control must offer the beats of this depth`)
          .toBeGreaterThan(3);
        const compact = viewport.width <= 640;

        for (const href of chapters) {
          const id = href.replace('#', '');
          if (compact) await page.locator('#chapter-select').selectOption(id);
          else await page.locator(`#chapters .chapters-link[href="${href}"]`).click();
          await scrollSettled(page);
          const anchor = await page.evaluate(readAnchor, id);
          const where = `${mode} @${viewport.width}, jumped to #${id}`;

          expect(anchor.found, `${where}: the chapter must point at something`).toBe(true);
          expect(
            anchor.headingTop,
            `${where}: "${anchor.headingText}" starts at ${anchor.headingTop}, above the ` +
            `${anchor.stickyBottom}px the sticky bars occupy`,
          ).toBeGreaterThanOrEqual(anchor.stickyBottom);
          expect(
            anchor.sectionTop,
            `${where}: the target's own top edge is behind the sticky bars`,
          ).toBeGreaterThanOrEqual(anchor.stickyBottom - 1);
          expect(
            anchor.headingTop,
            `${where}: the jump must land the heading on screen`,
          ).toBeLessThan(anchor.viewportHeight);
          expect(
            anchor.hitInsideHeading,
            `${where}: the heading's own centre belongs to ${anchor.hit}`,
          ).toBe(true);
        }
      }

      // A cold arrival is not the same rendering as a jump within a loaded page: the act
      // is still signing when the browser performs its own jump, and the page repeats it.
      // Each target waits on the thing that arrives last in it, so the measurement is
      // taken once the section has stopped growing under the scroll position.
      for (const [mode, id, settled] of [
        ['lab', 'act-5', '#act-5 .verdict'],
        ['demo', 'act-7', '#act-7 .compare-cards'],
      ] as const) {
        await open(page, mode, `#${id}`);
        await expect(page.locator(settled).first()).toBeVisible();
        await scrollSettled(page);
        const anchor = await page.evaluate(readAnchor, id);
        expect(
          anchor.headingTop,
          `cold ?mode=${mode}#${id} @${viewport.width}: "${anchor.headingText}" landed at ` +
          `${anchor.headingTop} against sticky bars ending at ${anchor.stickyBottom}`,
        ).toBeGreaterThanOrEqual(anchor.stickyBottom);
        expect(anchor.hitInsideHeading,
          `cold ?mode=${mode}#${id} @${viewport.width}: the heading is covered by ` +
          `${anchor.hit}`).toBe(true);
      }
    });
  });
}

/* -----------------------------------------------------------------------------------
   The states a presenter drives the page into.

   These are renderings rather than layouts, so they are driven at two widths rather than
   four: the phone, where every panel is one column and a broken control has nowhere to
   go, and the laptop that exposed the card failure. Each state is asserted and captured.
   ----------------------------------------------------------------------------------- */

for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
  test.describe(`${viewport.name} — presenter states`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('signed, tampered, stripped and reset each render, and focus is visible',
      async ({ page }, testInfo) => {
        await open(page, 'demo');
        const act5 = page.locator('#act-5');
        const verdict = act5.locator('.verdict').first();
        const consequence = act5.locator('.consequence').first();
        const panel = act5.locator('.panel').first();

        await expect(verdict).toContainText('Verification passed');
        await expect(consequence).toBeVisible();
        await capture(testInfo, panel, `signing-signed-${viewport.width}.png`);

        await act5.getByRole('button', { name: 'Flip one byte of the asset' }).click();
        await expect(verdict).toContainText('Verification failed');
        await expect(consequence).toContainText('Changed one byte');
        await capture(testInfo, panel, `signing-tampered-${viewport.width}.png`);

        await act5.getByRole('button', { name: 'Strip the manifest' }).click();
        await expect(verdict).toContainText('No manifest');
        await expect(consequence).toContainText('there was nothing left to verify');
        await capture(testInfo, panel, `signing-stripped-${viewport.width}.png`);

        await act5.getByRole('button', { name: 'Reset act' }).click();
        await expect(verdict).toContainText('Verification passed');
        await capture(testInfo, panel, `signing-reset-${viewport.width}.png`);

        // Every one of those renderings has to fit the column it is in. A verdict that
        // pushes the page sideways is the same class of defect as a value that wraps.
        const screen = await page.evaluate(readFirstScreen);
        expect(
          screen.documentWidth,
          `@${viewport.width}: driving Act V must not push the document sideways; ` +
          `widest offender ${screen.widestOverflowing}`,
        ).toBeLessThanOrEqual(screen.viewportWidth);

        // The ring is painted by `:focus-visible`, which a scripted `focus()` does not
        // satisfy. Focusing the control before it and pressing Tab is the keyboard route
        // a reader has, and it is the only one that renders what this asserts.
        await page.locator('#reset-all').focus();
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const active = document.activeElement;
          if (!active) return { id: '', width: 0, style: 'none', visible: false };
          const styles = getComputedStyle(active);
          return {
            id: active.id,
            width: Number.parseFloat(styles.outlineWidth),
            style: styles.outlineStyle,
            visible: active.matches(':focus-visible'),
          };
        });
        expect(focus.id, 'Tab from the reset control must reach "Run the proof"')
          .toBe('run-the-proof');
        expect(focus.visible, 'a keyboard focus must match :focus-visible').toBe(true);
        expect(focus.style, 'the focused control must paint a ring, not merely hold focus')
          .not.toBe('none');
        expect(focus.width, 'the focus ring must have a measurable width')
          .toBeGreaterThanOrEqual(2);
        await capture(testInfo, page.locator('.cta-row'), `focus-cta-${viewport.width}.png`);
      });
  });
}

test.describe('presenter states at laptop 1052', () => {
  test.use({ viewport: { width: VIEWPORTS[2].width, height: VIEWPORTS[2].height } });

  test('the busy state says so in words while WebCrypto runs', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    // The real signature, made slow enough to be read. A signing run on this machine
    // settles in single-digit milliseconds, so the busy rendering exists for readers on
    // hardware this laptop is not — which is precisely why it has to be checked rather
    // than assumed. Nothing is faked: the same call runs and returns the same bytes, a
    // second and a half later. Only this test installs it.
    await page.addInitScript(() => {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) return;
      const sign = subtle.sign.bind(subtle) as unknown as
        (...args: unknown[]) => Promise<ArrayBuffer>;
      Object.defineProperty(subtle, 'sign', {
        configurable: true,
        value: (...args: unknown[]) => new Promise((resolve, reject) => {
          window.setTimeout(() => void sign(...args).then(resolve, reject), 1500);
        }),
      });
    });

    await open(page, 'demo');
    await expect(page.locator('#act-5 .verdict').first()).toContainText('Verification passed');

    await page.locator('#act-5').getByRole('button', { name: 'Reset act' }).click();

    // Busy is a word and an attribute, not a spinner: a spinner is invisible to a screen
    // reader and to a contrast oracle alike.
    const busy = page.locator('#act-5 [aria-busy="true"]');
    await expect(busy).toHaveCount(1);
    await expect(page.locator('#act-5 .progress')).toContainText('signing it again');
    // Nothing that mutates a manifest may be pressed while the manifest is being rebuilt.
    const enabled = await page.locator('#act-5 .controls button')
      .evaluateAll((buttons) => buttons.filter(
        (button) => !(button as HTMLButtonElement).disabled).length);
    expect(enabled, 'every control must be switched off for the length of the run').toBe(0);
    await capture(testInfo, page.locator('#act-5 .panel').first(), 'signing-busy.png');

    // And it has to end. A busy state that outlives its work is a hung panel.
    await expect(busy).toHaveCount(0);
    await expect(page.locator('#act-5 .progress')).toHaveText('');
    await expect(page.locator('#act-5 .verdict').first())
      .toContainText('Verification passed');
    await expect(page.locator('#act-5').getByRole('button', { name: 'Sign it' })).toBeEnabled();

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('a browser with no WebCrypto gets a recovery, not a dead control',
    async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));

      // The documented cause, reproduced rather than invented: `crypto.subtle` exists
      // only in a secure context, so a lab opened over plain http:// on a conference
      // network loses the signing half of the page. What the audience must not see is a
      // permanently disabled button beside a half-written panel.
      await page.addInitScript(() => {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          configurable: true,
          get: () => undefined,
        });
      });

      await open(page, 'demo');
      const act5 = page.locator('#act-5');
      await expect(act5.locator('.verdict').first()).toContainText('This run did not finish');
      await expect(act5.locator('.verdict').first()).toContainText('secure context');
      await expect(act5.getByRole('button', { name: 'Try again' })).toBeEnabled();
      await expect(act5.getByRole('button', { name: 'Sign it' })).toBeEnabled();
      await capture(testInfo, act5.locator('.panel').first(), 'signing-error.png');

      // The detector half is independent of WebCrypto and must survive intact: losing the
      // signature costs the signing act, not the page.
      await expect(page.locator('#hero-experiment .result-card .verdict')).toHaveCount(3);
      await expect(page.locator('#hero-experiment .identity .verdict'))
        .toContainText('The digests could not be computed');
      await capture(testInfo, page.locator('#hero-experiment .result-grid'),
        'hero-no-webcrypto.png');

      // The failure is answered on the page. A console error here would mean the reader
      // was told nothing and the developer tools were told instead.
      expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
    });

  test('reduced motion shows the final result without depending on animation',
    async ({ page }, testInfo) => {
      // `test.use({ reducedMotion })` has been observed to do nothing on this version, so
      // the preference is emulated and then asserted from inside the page, the same
      // discipline the accessibility gate uses for the theme.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, 'demo');
      expect(
        await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        'the reduced-motion preference must be in effect before this proves anything',
      ).toBe(true);

      await page.locator('#run-the-proof').click();
      // Read with no wait of any kind. Anything staged behind a timer is absent here, and
      // that is the whole assertion: the reveal must be a sequence of already-answered
      // questions, not the source of the answers.
      const immediately = await page.evaluate(() => ({
        waiting: document.querySelectorAll('#hero-experiment .result-waiting').length,
        verdicts: document.querySelectorAll('#hero-experiment .result-card .verdict').length,
        figures: Array.from(document.querySelectorAll(
          '#hero-experiment .result-metric-major .result-metric-value'))
          .map((value) => (value.textContent ?? '').trim()),
        animations: document.getAnimations().length,
      }));
      expect(immediately.waiting,
        'a reduced-motion reader must not be left holding placeholders').toBe(0);
      expect(immediately.verdicts,
        'all three verdicts must be present the moment the button is pressed').toBe(3);
      // The figures are checked for shape rather than for value: what the detector
      // computes is the claims suite's to police, and a visual suite that pinned the
      // numbers would fail twice for one change. Distinctness is the visual claim — three
      // identical figures would mean the reveal is showing one card's result three times.
      expect(immediately.figures.length, 'each card must promote its own figure').toBe(3);
      for (const figure of immediately.figures) {
        expect(figure, `"${figure}" is not a mean g-score`).toMatch(/^\d\.\d{4}$/);
      }
      expect(new Set(immediately.figures).size,
        'the three runs must show three different figures').toBe(3);
      expect(immediately.animations,
        'reduced motion must leave nothing animating').toBe(0);
      await capture(testInfo, page.locator('#hero-experiment .result-grid'),
        'hero-reduced-motion.png');

      // The complement, so the assertion above is a claim about the preference rather
      // than about a page that never staged anything: with motion allowed, the same press
      // replaces the cards with placeholders first, and the placeholders are content
      // rather than a faded copy of the result.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await open(page, 'demo');
      await page.locator('#run-the-proof').click();
      const staged = await page.evaluate(() => ({
        waiting: document.querySelectorAll('#hero-experiment .result-waiting').length,
        verdicts: document.querySelectorAll('#hero-experiment .result-card .verdict').length,
      }));
      expect(staged.waiting,
        'with motion allowed the reveal must stage content, so placeholders must appear')
        .toBeGreaterThan(0);
      expect(staged.verdicts, 'and the verdicts must not all be present yet').toBe(0);
      // Five beats at 750ms, so the settled state arrives about four seconds later. Waited
      // for as a real condition rather than slept through.
      await expect(page.locator('#hero-experiment .result-card .verdict'))
        .toHaveCount(3, { timeout: 15_000 });
      await expect(page.locator('#hero-experiment .result-waiting')).toHaveCount(0);
    });
});
