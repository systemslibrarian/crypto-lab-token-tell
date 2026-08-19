import { expect, test } from '@playwright/test';

import {
  boot, driveAllStates, expectBaselineNotStale, NARROW, reportCollected, watchPageErrors,
} from './gate.ts';

/**
 * The WCAG 2.1 A/AA gate.
 *
 * It boots the page with reduced motion actually in effect, drives it through every state
 * that renders content, and scans each one with nine oracles rather than with axe's
 * `violations` array alone. What that means in this lab: the Hero has already scored its
 * three runs and Act V and Act VI have already signed at first paint, so arrival is a
 * real state with real verdicts on it; the wrong-key sweep, the attack sweep and the
 * corpus scoring render nothing until their buttons are pressed, so the drive presses
 * them; and the refusal states — a text too short to score, a retired verdict, a broken
 * hard binding, a stripped manifest — are each their own rendering.
 *
 * Dark is the only theme this fleet ships, so there is one theme here and two viewports.
 * The narrow pass matters more than usual: this page paints seven-column tables, 64-
 * character digests and two inline SVG charts, and WCAG 1.4.10 reflow is the one check
 * axe has no rule for at all.
 *
 * `watchPageErrors` is attached BEFORE `boot`, because a renderer that throws leaves its
 * section empty, and an empty region is exactly what a scan reports as perfectly
 * accessible.
 */
for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    // The drive runs every panel's real computation at both viewports, and the corpus
    // passes score 48 texts at depth 30 each. Generous, because a timeout here reads as
    // a failure and sends someone looking for a defect that is not there.
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at ${NARROW.width}px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    await page.setViewportSize(NARROW);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @${NARROW.width}`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
