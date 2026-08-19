import { expect, test, type Page } from '@playwright/test';

/**
 * The claims suite: does the page tell the truth?
 *
 * The rule that makes these worth anything is that they compare two values the page
 * itself printed, or re-derive a claim from the page's raw inputs by a different route
 * than the source takes. A test that recomputes the same expression the source uses will
 * agree with a bug quite happily.
 *
 * Internal consistency alone is not enough either — a page can be consistently wrong — so
 * several of these re-derive from committed reference values that came out of Python.
 */

const REFERENCE = {
  // From src/data/pinned/test-vectors.json, produced by the reference implementation.
  // Hard-coded here on purpose: if the page and the vectors drift together, a test that
  // read the same file would follow them.
  watermarkedScore: 0.5974613686534216,
  watermarkedScored: 302,
  watermarkedCandidates: 316,
  watermarkedGSum: 5413,
  depth: 30,
  controlScore: 0.49696936542669583,
};

async function readout(page: Page, panel: string, term: string): Promise<string> {
  const value = page.locator(`${panel} dt`, { hasText: new RegExp(`^${term}$`) })
    .first().locator('xpath=following-sibling::dd[1]');
  return (await value.textContent())?.trim() ?? '';
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('the Hero scores the committed sample to the reference value', async ({ page }) => {
  const panel = '#hero-experiment .grid .panel:nth-child(1)';
  const score = await readout(page, panel, 'Mean g-score');
  expect(Number(score)).toBeCloseTo(REFERENCE.watermarkedScore, 4);

  // Re-derivation by a different route: the mean must equal the printed sum over the
  // printed count. The page never divides these on screen — but it prints the mean to
  // four decimals, so that is the precision this comparison can honestly claim.
  const gSum = Number((await readout(page, panel, 'Sum of counted g-values')).replace(/,/g, ''));
  const counted = Number((await readout(page, panel, 'g-values behind the mean')).replace(/,/g, ''));
  expect(gSum).toBe(REFERENCE.watermarkedGSum);
  expect(gSum / counted).toBeCloseTo(Number(score), 4);
});

test('the position counts sum to the whole', async ({ page }) => {
  const panel = '#hero-experiment .grid .panel:nth-child(1)';
  const num = async (term: string) =>
    Number((await readout(page, panel, term)).replace(/,/g, ''));

  const tokens = await num('Tokens');
  const candidates = await num('Candidate positions');
  const scored = await num('Scored positions');
  const repeated = await num('Skipped: repeated context');
  const afterEos = await num('Skipped: after end-of-text');
  const depth = await num('Tournament layers \\(depth\\)');
  const gValues = await num('g-values behind the mean');

  // Parts sum to whole, twice over.
  expect(scored + repeated + afterEos).toBe(candidates);
  expect(candidates).toBe(tokens - 4); // ngram_len - 1, and the page prints ngram_len nowhere else
  expect(gValues).toBe(scored * depth);

  expect(candidates).toBe(REFERENCE.watermarkedCandidates);
  expect(scored).toBe(REFERENCE.watermarkedScored);
  expect(depth).toBe(REFERENCE.depth);
});

test('the same bytes under a wrong key lose the evidence, and the control never had it',
  async ({ page }) => {
    const scoreOf = async (index: number) =>
      Number(await readout(page, `#hero-experiment .grid .panel:nth-child(${index})`,
        'Mean g-score'));

    const correct = await scoreOf(1);
    const wrongKey = await scoreOf(2);
    const control = await scoreOf(3);

    expect(correct).toBeCloseTo(REFERENCE.watermarkedScore, 4);
    expect(control).toBeCloseTo(REFERENCE.controlScore, 4);
    // The wrong-key run is the same bytes: its position bookkeeping must be identical.
    const scored = async (index: number) =>
      await readout(page, `#hero-experiment .grid .panel:nth-child(${index})`, 'Scored positions');
    expect(await scored(2)).toBe(await scored(1));
    expect(Math.abs(wrongKey - 0.5)).toBeLessThan(Math.abs(correct - 0.5) / 4);
  });

test('the three Hero inputs hash as the page says they do', async ({ page }) => {
  const hashes = page.locator('#hero-experiment .readout dd.hash');
  await expect(hashes).toHaveCount(3);
  const values = await hashes.allTextContents();
  // Runs 1 and 2 are byte-identical; run 3 is not. The page asserts this in words, and
  // the digests it prints must agree with the words.
  expect(values[0]).toBe(values[1]);
  expect(values[0]).not.toBe(values[2]);
  expect(values[0]).toMatch(/^[0-9a-f]{64}$/);
});

test('the detector retires a verdict when the text changes, and a no-op does not',
  async ({ page }) => {
    const input = page.locator('#detector-input');
    await expect(page.locator('#act-2 .verdict').first()).toBeVisible();

    // A no-op: re-entering the identical text must NOT retire a fresh verdict.
    const original = await input.inputValue();
    await input.fill(original);
    await expect(page.locator('#act-2 [data-retired]')).toHaveCount(0);
    await expect(page.locator('#act-2 .verdict').first()).toBeVisible();

    // A real change retires it, and the page says so rather than leaving a stale number.
    await input.fill(`${original} and then something else entirely`);
    await expect(page.locator('#act-2 [data-retired]')).toHaveCount(1);
    await expect(page.locator('#act-2 [data-retired]')).toContainText('retired');
    await expect(page.locator('#act-2 .verdict')).toHaveCount(0);

    // Scoring again produces a verdict for what is in the box now.
    await page.getByRole('button', { name: 'Score it' }).click();
    await expect(page.locator('#act-2 [data-retired]')).toHaveCount(0);
    await expect(page.locator('#act-2 .verdict').first()).toBeVisible();
  });

test('a short text is refused a score rather than given a meaningless one', async ({ page }) => {
  await page.locator('#detector-input').fill('four tokens only');
  await page.getByRole('button', { name: 'Score it' }).click();
  const verdict = page.locator('#act-2 .verdict').first();
  await expect(verdict).toContainText('No score');
  expect(await readout(page, '#act-2', 'Mean g-score')).toBe('n/a');
});

test('the two constructions disagree on the same bytes and the same keys', async ({ page }) => {
  const panel = '#hero-experiment .panel', rows = page.locator(`${panel} dt`);
  await expect(rows.filter({ hasText: 'Text' }).first()).toBeVisible();
  const values = await page.locator('#hero-experiment .readout').last().textContent();
  expect(values).toContain('identical bytes in both rows');

  const scoreCells = await page.locator('#hero-experiment .readout').last()
    .locator('dd').allTextContents();
  const numbers = scoreCells.map(Number).filter((value) => Number.isFinite(value) && value < 1);
  expect(numbers.length).toBeGreaterThanOrEqual(2);
  const [marking, other] = numbers;
  expect(marking).toBeCloseTo(REFERENCE.watermarkedScore, 3);
  expect(Math.abs(other - 0.5)).toBeLessThan(0.02);
});

test('the attack sweep reports every run, including any that survive', async ({ page }) => {
  await page.locator('#act-4').scrollIntoViewIfNeeded();
  await page.locator('#act-4').getByRole('button', { name: 'Run the sweep' }).click();
  await expect(page.locator('#act-4 .progress')).toContainText('Sweep complete', {
    timeout: 60_000,
  });

  const baseline = Number(await readout(page, '#act-4', 'Baseline score, untouched'));
  expect(baseline).toBeCloseTo(REFERENCE.watermarkedScore, 3);

  // Every individual run is listed rather than averaged away: three attacks, five
  // strengths, one deterministic run for truncation and five repeats for the other two.
  // Scoped to the sweep table by a column only it has — #act-4 also holds the pinned
  // transformations table, and counting rows across both counts the wrong thing.
  const sweepTable = page.locator('#act-4 table')
    .filter({ has: page.locator('th', { hasText: 'Run' }) });
  const rows = sweepTable.locator('tbody tr');
  await expect(rows).toHaveCount(5 * (1 + 5 + 5));

  // The change column must equal the score column minus the baseline. Both are printed
  // to four decimals, so the difference can carry two rounding errors.
  const cells = await rows.first().locator('td').allTextContents();
  expect(Number(cells[6])).toBeCloseTo(Number(cells[5]) - baseline, 3);
});

test('the pinned paraphrase result is reported as measured, not as expected',
  async ({ page }) => {
    const row = page.locator('#act-4 table tbody tr', { hasText: 'Paraphrase' }).first();
    const cells = await row.locator('td').allTextContents();
    const before = Number(cells[1]);
    const after = Number(cells[2]);
    const change = Number(cells[3]);
    // Both operands are displayed to four decimals, so their difference carries two
    // rounding errors and cannot be checked more tightly than that.
    expect(change).toBeCloseTo(after - before, 3);
    // Whatever the verdict says, it must agree with the numbers beside it.
    const verdictText = cells[6];
    const threshold = Number(cells[5]);
    expect(verdictText).toBe(after >= threshold ? 'above threshold' : 'below threshold');
  });

test('signing, tampering and stripping report three different outcomes', async ({ page }) => {
  await page.locator('#act-5').scrollIntoViewIfNeeded();
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification passed');
  expect(await readout(page, '#act-5', 'Signature verifies')).toBe('yes');
  expect(await readout(page, '#act-5', 'Hard binding matches the asset')).toBe('yes');

  await page.locator('#act-5').getByRole('button', { name: 'Flip one byte of the asset' }).click();
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification failed');
  // The signature still verifies: what broke is the binding from the claim to the bytes.
  expect(await readout(page, '#act-5', 'Signature verifies')).toBe('yes');
  expect(await readout(page, '#act-5', 'Hard binding matches the asset')).toBe('no');

  await page.locator('#act-5').getByRole('button', { name: 'Strip the manifest' }).click();
  await expect(page.locator('#act-5 .verdict')).toContainText('No manifest');
  expect(await readout(page, '#act-5', 'Manifest present')).toBe('no');
});

test('a plainly false statement verifies, and the page says what that means',
  async ({ page }) => {
    await page.locator('#act-6').scrollIntoViewIfNeeded();
    await expect(page.locator('#act-6 .verdict')).toContainText('Verification passed');
    await expect(page.locator('#act-6 .verdict')).toContainText('does not prove that the claim');
    expect(await readout(page, '#act-6', 'Statement is true'))
      .toBe('not a question this mechanism can answer');
  });

test('the comparison table carries all ten rows and marks the load-bearing one',
  async ({ page }) => {
    const rows = page.locator('#act-7 .compare-table tbody tr th[scope="row"]');
    await expect(rows).toHaveCount(10);
    await expect(rows.nth(1)).toHaveText('WHO CAN VERIFY?');
    await expect(page.locator('#act-7 .compare-table tr.load-bearing')).toHaveCount(1);
    await expect(page.locator('#act-7 .compare-table tr.load-bearing th')).toHaveText(
      'WHO CAN VERIFY?');
  });

test('stripping and regeneration are shown as different failures', async ({ page }) => {
  await page.locator('#act-7').scrollIntoViewIfNeeded();
  const strip = page.locator('#act-7 .grid-2 .panel').first();
  const regen = page.locator('#act-7 .grid-2 .panel').last();

  await expect(strip).toContainText('Asset digest before and after');
  await expect(strip.locator('dd', { hasText: 'identical' })).toBeVisible();

  const before = Number(await regen.locator('dt', { hasText: 'Score before' })
    .locator('xpath=following-sibling::dd[1]').textContent());
  const after = Number(await regen.locator('dt', { hasText: 'Score after' })
    .locator('xpath=following-sibling::dd[1]').textContent());
  expect(before).toBeCloseTo(REFERENCE.watermarkedScore, 3);
  // The regeneration panel's verdict must agree with its own numbers.
  const threshold = Number(await regen.locator('dt', { hasText: 'Threshold at FPR 1%' })
    .locator('xpath=following-sibling::dd[1]').textContent());
  const survived = after >= threshold;
  await expect(regen.locator('.verdict')).toContainText(
    survived ? 'Evidence survived' : 'Evidence did not survive');
});

test('no element is hidden by the cascade while the code believes it is hidden',
  async ({ page }) => {
    // The [hidden] cascade trap: a class rule setting `display` outranks the UA's
    // [hidden] rule, so an element paints while the code thinks it is gone.
    const painted = await page.evaluate(() =>
      [...document.querySelectorAll('[hidden]')]
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => element.className || element.tagName));
    expect(painted).toEqual([]);
  });
