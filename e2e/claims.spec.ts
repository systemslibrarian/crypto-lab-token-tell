import { expect, test, type Locator, type Page } from '@playwright/test';

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
 *
 * The page now has two depths, and every test says which one it opens. That is not
 * bookkeeping: Demo hides twenty-four lab-only elements and Full lab hides three demo-only
 * ones, and while `textContent`, counts and `value` all read straight through `hidden`,
 * anything that clicks, fills or asserts visibility does not. Where a claim is about what
 * a reader is shown, the test opens the depth that shows it; where a claim is about two
 * renderings agreeing with each other, it reads both through whichever depth is open and
 * says so.
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

/** The short route a new visitor gets, and the full lab an auditor asks for. */
const DEMO = './?mode=demo';
const LAB = './?mode=lab';

/**
 * Every statistic behind one score, in the order the score card has always printed them.
 * This list IS the contract: the summary cards moved these rows behind a disclosure, and
 * the claim being made by that move is that nothing was dropped to make the page shorter.
 * Compared as a list rather than searched for one at a time, so a term that is reworded,
 * reordered or quietly dropped fails here instead of reading as absent everywhere else.
 */
const CALCULATION_TERMS = [
  'Mean g-score',
  'Expected under no mark',
  'Tokens',
  'Candidate positions',
  'Scored positions',
  'Skipped: repeated context',
  'Skipped: after end-of-text',
  'Tournament layers (depth)',
  'g-values behind the mean',
  'Sum of counted g-values',
  'Exact null',
  'p-value (exact tail)',
  'Standard error if independent',
  'z on that assumption',
  'Threshold at FPR 1%',
];

/** The value beside a term, read out of any definition list inside `scope`. */
async function readout(scope: Locator, term: string): Promise<string> {
  const value = scope.locator('dt', { hasText: new RegExp(`^${term}$`) })
    .first().locator('xpath=following-sibling::dd[1]');
  return (await value.textContent())?.trim() ?? '';
}

/**
 * One of the three Hero result cards, by the scenario it names rather than by its
 * position in the grid. The claim each of these tests makes is about run 1 being the
 * configured key and run 2 the same bytes under a wrong one — an identity, not an index —
 * and a positional selector silently follows the day a card is wrapped or reordered.
 */
function runCard(page: Page, headline: string): Locator {
  return page.locator('#hero-experiment .result-card')
    .filter({ has: page.locator('.panel-title', { hasText: headline }) });
}

function heroPanel(page: Page, title: string): Locator {
  return page.locator('#hero-experiment .panel')
    .filter({ has: page.locator('.panel-title', { hasText: title }) });
}

test('the Hero scores the committed sample to the reference value', async ({ page }) => {
  await page.goto(DEMO);
  const card = runCard(page, 'Correct key');
  const score = await readout(card, 'Mean g-score');
  expect(Number(score)).toBeCloseTo(REFERENCE.watermarkedScore, 4);

  // Re-derivation by a different route: the mean must equal the printed sum over the
  // printed count. The page never divides these on screen — but it prints the mean to
  // four decimals, so that is the precision this comparison can honestly claim. Both
  // operands now sit behind the card's "Show calculation" disclosure, which is built
  // eagerly and read through while shut; a body built on first open would read as an
  // empty string and turn this into a comparison against zero.
  const gSum = Number((await readout(card, 'Sum of counted g-values')).replace(/,/g, ''));
  const counted = Number((await readout(card, 'g-values behind the mean')).replace(/,/g, ''));
  expect(gSum).toBe(REFERENCE.watermarkedGSum);
  expect(gSum / counted).toBeCloseTo(Number(score), 4);
});

test('the position counts sum to the whole', async ({ page }) => {
  await page.goto(DEMO);
  const card = runCard(page, 'Correct key');
  const num = async (term: string) =>
    Number((await readout(card, term)).replace(/,/g, ''));

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
    await page.goto(DEMO);
    const correctCard = runCard(page, 'Correct key');
    const wrongCard = runCard(page, 'Wrong key, same bytes');
    const controlCard = runCard(page, 'Control');

    const correct = Number(await readout(correctCard, 'Mean g-score'));
    const wrongKey = Number(await readout(wrongCard, 'Mean g-score'));
    const control = Number(await readout(controlCard, 'Mean g-score'));

    expect(correct).toBeCloseTo(REFERENCE.watermarkedScore, 4);
    expect(control).toBeCloseTo(REFERENCE.controlScore, 4);
    // The wrong-key run is the same bytes: its position bookkeeping must be identical.
    expect(await readout(wrongCard, 'Scored positions'))
      .toBe(await readout(correctCard, 'Scored positions'));
    expect(Math.abs(wrongKey - 0.5)).toBeLessThan(Math.abs(correct - 0.5) / 4);

    // The verdicts have to agree with the numbers beside them, and the consequence line
    // under the three cards has to agree with the verdicts. It says the evidence
    // disappeared; if run 2 still read as evidence, the page would be narrating one
    // experiment while running another.
    await expect(correctCard.locator('.verdict')).toContainText('Evidence for this key');
    await expect(wrongCard.locator('.verdict')).toContainText('No evidence for this key');
    await expect(controlCard.locator('.verdict')).toContainText('No evidence for this key');
    await expect(page.locator('#hero-experiment > .consequence .consequence-effect'))
      .toHaveText('the watermark verdict disappeared.');
  });

test('the three Hero inputs hash as the page says they do', async ({ page }) => {
  await page.goto(DEMO);
  const hashes = page.locator('#hero-experiment .readout dd.hash');
  await expect(hashes).toHaveCount(3);
  const values = await hashes.allTextContents();
  // Runs 1 and 2 are byte-identical; run 3 is not. The page asserts this in words, and
  // the digests it prints must agree with the words.
  expect(values[0]).toBe(values[1]);
  expect(values[0]).not.toBe(values[2]);
  expect(values[0]).toMatch(/^[0-9a-f]{64}$/);

  // The identity claim is now compressed to a sentence with the digests a click behind
  // it, which creates a second place for the page to be wrong: the sentence and the
  // evidence for it must say the same thing.
  await expect(page.locator('#hero-experiment .identity-claim'))
    .toContainText('Runs 1 and 2: same SHA-256.');
  expect(await readout(heroPanel(page, 'The inputs'), 'Runs 1 and 2 identical'))
    .toContain('yes');
});

test('the summary cards kept the whole calculation trail rather than dropping it',
  async ({ page }) => {
    await page.goto(LAB);
    // Every card ships its disclosure shut, so this is also the check that the trail is
    // rendered into it eagerly: a lazily built body reads as empty through a closed
    // <details>, and every re-derivation above would then be comparing against zero.
    await expect(page.locator('#hero-experiment details[open]')).toHaveCount(0);

    for (const headline of ['Correct key', 'Wrong key, same bytes', 'Control']) {
      const calculation = runCard(page, headline).locator('details.result-calculation');
      await expect(calculation).toHaveCount(1);
      const terms = (await calculation.locator('dt').allTextContents()).map((t) => t.trim());
      expect(terms, `${headline}: every statistic behind the score is still printed`)
        .toEqual(CALCULATION_TERMS);
      // The threshold's provenance travels with it. A number without the corpus it came
      // from is the one thing this lab refuses to print anywhere.
      await expect(calculation).toContainText('Threshold source:');
      await expect(calculation).toContainText('unwatermarked texts');
    }

    // The same list, re-derived from the other card form rather than from this file: Act
    // II prints the full trail inline, and the summary form is only supposed to have
    // changed which of it a reader meets first.
    const fullCard = page.locator('#act-2 .readout[role="group"]');
    await expect(fullCard, 'Act II prints exactly one score card at mount').toHaveCount(1);
    const inline = (await fullCard.locator('dt').allTextContents()).map((t) => t.trim());
    expect(inline).toEqual(CALCULATION_TERMS);
  });

test('the detector retires a verdict when the text changes, and a no-op does not',
  async ({ page }) => {
    // Full lab: Act II is lab-depth, and `fill` and `click` need a painted element.
    await page.goto(LAB);
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
    await page.locator('#act-2').getByRole('button', { name: 'Score it' }).click();
    await expect(page.locator('#act-2 [data-retired]')).toHaveCount(0);
    await expect(page.locator('#act-2 .verdict').first()).toBeVisible();
  });

test('a short text is refused a score rather than given a meaningless one', async ({ page }) => {
  await page.goto(LAB);
  await page.locator('#detector-input').fill('four tokens only');
  await page.locator('#act-2').getByRole('button', { name: 'Score it' }).click();
  const verdict = page.locator('#act-2 .verdict').first();
  await expect(verdict).toContainText('No score');
  expect(await readout(page.locator('#act-2'), 'Mean g-score')).toBe('n/a');
});

test('the two constructions disagree on the same bytes and the same keys', async ({ page }) => {
  await page.goto(LAB);
  // Addressed by the panel it belongs to rather than by being the last readout in the
  // section: "the last one" was a positional alias that would quietly move onto a
  // different experiment the day a panel is added below it.
  const panel = heroPanel(page, 'The same key, a different implementation');
  await expect(panel).toBeVisible();
  await expect(panel.locator('dt', { hasText: /^Text$/ })).toHaveCount(1);
  expect(await readout(panel, 'Text')).toBe('identical bytes in both rows');
  expect(await readout(panel, 'Keys')).toBe('identical in both rows');

  // Read by the term beside each score, not by scanning every sub-1 number in the
  // readout: the second is an ordering assumption that a new row would break silently.
  const scores = await panel.locator('dt', { hasText: /^Score · / })
    .locator('xpath=following-sibling::dd[1]').allTextContents();
  expect(scores.length).toBe(2);
  const [marking, other] = scores.map(Number);
  expect(marking).toBeCloseTo(REFERENCE.watermarkedScore, 3);
  expect(Math.abs(other - 0.5)).toBeLessThan(0.02);
});

test('the cross-implementation panel is hidden by the short route, not deleted from it',
  async ({ page }) => {
    // The depth mechanism itself, under test: there is one copy of every experiment, and
    // Demo is a display decision over it. If the short route ever became a second, shorter
    // render path, this panel would be absent rather than hidden — and the page would have
    // two answers to every question, only one of which is the code under test.
    await page.goto(DEMO);
    const panel = heroPanel(page, 'The same key, a different implementation');
    await expect(panel).toHaveCount(1);
    await expect(panel).toBeHidden();
    expect(await readout(panel, 'Text')).toBe('identical bytes in both rows');
    await expect(page.locator('[data-depth="lab"]:not([hidden])')).toHaveCount(0);
    await expect(page.locator('[data-depth="demo"][hidden]')).toHaveCount(0);
  });

test('the attack sweep reports every run, including any that survive', async ({ page }) => {
  await page.goto(LAB);
  await page.locator('#act-4').scrollIntoViewIfNeeded();
  await page.locator('#act-4').getByRole('button', { name: 'Run the sweep' }).click();
  await expect(page.locator('#act-4 .progress')).toContainText('Sweep complete', {
    timeout: 60_000,
  });

  const baseline = Number(await readout(page.locator('#act-4'), 'Baseline score, untouched'));
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
    await page.goto(LAB);
    const row = page.locator('#act-4 table tbody tr', { hasText: 'Paraphrase' }).first();
    // `allTextContents` does not wait for anything, and the acts no longer all render
    // inside the load event: without this the read returns an empty list and every number
    // below it is NaN, which `toBeCloseTo` reports as NaN against NaN rather than as the
    // row being absent. Seven is also the column count the indices below assume, so this
    // fails loudly if a column is ever inserted rather than reading the wrong one.
    await expect(row.locator('td')).toHaveCount(7);
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
  // The short route, because these are its 0:25 beat and it must reach all three.
  await page.goto(DEMO);
  const act5 = page.locator('#act-5');
  // The act signs itself on arrival, so it is still growing for a moment: waiting for the
  // verdict before scrolling to it is what keeps the scroll from chasing a moving section.
  await expect(act5.locator('.verdict')).toContainText('Verification passed');
  await act5.scrollIntoViewIfNeeded();
  expect(await readout(act5, 'Signature verifies')).toBe('yes');
  expect(await readout(act5, 'Hard binding matches the asset')).toBe('yes');
  await expectConsequenceAgrees(page);

  await act5.getByRole('button', { name: 'Flip one byte of the asset' }).click();
  await expect(act5.locator('.verdict')).toContainText('Verification failed');
  // The signature still verifies: what broke is the binding from the claim to the bytes.
  expect(await readout(act5, 'Signature verifies')).toBe('yes');
  expect(await readout(act5, 'Hard binding matches the asset')).toBe('no');
  await expectConsequenceAgrees(page);

  await act5.getByRole('button', { name: 'Strip the manifest' }).click();
  await expect(act5.locator('.verdict')).toContainText('No manifest');
  expect(await readout(act5, 'Manifest present')).toBe('no');
  await expectConsequenceAgrees(page);
});

/**
 * The closing line of Act V, re-derived from the readout beside it.
 *
 * The line is written from the validation result; this checks it against the three rows
 * the same panel printed, which is a different route to the same claim. It is the check
 * that the consequence is a statement about the state actually reached rather than
 * decorative text keyed to whichever button was last pressed — flipping the same byte
 * twice puts it back, and a line told from the button would then announce a failure the
 * page is not showing.
 */
async function expectConsequenceAgrees(page: Page): Promise<void> {
  const act5 = page.locator('#act-5');
  const present = await readout(act5, 'Manifest present');
  const signature = await readout(act5, 'Signature verifies');
  const binding = await readout(act5, 'Hard binding matches the asset');
  const expected = present === 'no'
    ? 'there was nothing left to verify.'
    : signature === 'yes' && binding === 'yes'
      ? 'integrity verification passed.'
      : 'integrity verification failed.';
  await expect(act5.locator('.consequence-effect')).toHaveText(expected);
}

test('a plainly false statement verifies, and the page says what that means',
  async ({ page }) => {
    await page.goto(DEMO);
    const act6 = page.locator('#act-6');
    await expect(act6.locator('.verdict')).toContainText('Verification passed');
    await act6.scrollIntoViewIfNeeded();
    await expect(act6.locator('.verdict')).toContainText('does not prove that the claim');
    expect(await readout(act6, 'Statement is true'))
      .toBe('not a question this mechanism can answer');
    // The closing line, re-derived: integrity is answered, truth is declined, and the
    // line must not claim more than the readout above it does.
    const signature = await readout(act6, 'Signature verifies');
    await expect(act6.locator('.consequence-effect')).toHaveText(
      signature === 'yes'
        ? 'integrity passed; truth remained unanswered.'
        : 'integrity failed; truth remained unanswered either way.');
  });

test('the comparison table carries all eleven rows and marks the load-bearing one',
  async ({ page }) => {
    await page.goto(LAB);
    const rows = page.locator('#act-7 .compare-table tbody tr th[scope="row"]');
    await expect(rows).toHaveCount(11);
    // The question is now the disclosure trigger and carries a chevron beside it, so the
    // question itself is read rather than the whole cell. The row position is asserted on
    // purpose: the panel's own note says "the second row is the load-bearing one", and
    // that prose and this order have to move together.
    await expect(rows.nth(1).locator('.compare-question')).toHaveText('WHO CAN VERIFY?');
    await expect(page.locator('#act-7 .compare-table tr.load-bearing')).toHaveCount(1);
    await expect(page.locator('#act-7 .compare-table tr.load-bearing th .compare-question'))
      .toHaveText('WHO CAN VERIFY?');
  });

test('the compact comparison agrees, row for row, with the eleven-row table it summarises',
  async ({ page }) => {
    // Opened at Demo depth, where the compact cards are what a reader is shown; the full
    // table is hidden here, and read through `hidden` on purpose — the claim is that the
    // short route's four answers are the audit table's four answers, not a restatement of
    // them that could drift.
    await page.goto(DEMO);
    const { cards, rows } = await page.evaluate(() => {
      const text = (node: Element | null): string =>
        (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const cards = [...document.querySelectorAll('#act-7 .compare-card')].map((card) => ({
        question: text(card.querySelector('.compare-card-question')),
        lead: card.classList.contains('compare-card-lead'),
        answers: [...card.querySelectorAll('.compare-card-answers dd')].map((dd) => ({
          tone: dd.className.trim(),
          text: text(dd),
        })),
      }));
      const rows = [...document.querySelectorAll('#act-7 .compare-table tbody tr')]
        .filter((row) => row.querySelector('th[scope="row"]'))
        .map((row) => ({
          question: text(row.querySelector('.compare-question')),
          answers: [...row.querySelectorAll('td')].map((td) => ({
            // The focus tint is a display state of the table, not part of the answer.
            tone: td.className.replace(/\bcompare-focus\b/, '').trim(),
            text: text(td),
          })),
        }));
      return { cards, rows };
    });

    expect(cards.length, 'the short route asks four questions').toBe(4);
    expect(rows.length, 'the audit table asks eleven').toBe(11);
    // The load-bearing question leads the short route, exactly as it is marked in the
    // table: it is the row the rest of the comparison follows from, so it is the one a
    // ninety-second reading has to reach first.
    expect(cards[0].question).toBe('WHO CAN VERIFY?');
    expect(cards[0].lead).toBe(true);

    for (const card of cards) {
      const row = rows.find((candidate) => candidate.question === card.question);
      expect(row, `"${card.question}" is one of the eleven audit questions`).toBeDefined();
      expect(card.answers.length, `${card.question}: three mechanisms`).toBe(3);
      expect(row?.answers.length, `${card.question}: three mechanisms in the table`).toBe(3);
      expect(card.answers, `${card.question}: the same answers, in the same order, with the `
        + 'same yes/no/partial tone').toEqual(row?.answers);
    }

    // And the card that carries an argument carries the table's argument, not a second
    // one written for the short route. The card builds its body on first open, so it is
    // opened; the table's detail row is built with the row and read where it lies.
    const card = page.locator('#act-7 .compare-card-lead details');
    await card.locator('summary').click();
    await expect(card).toContainText('This is the row the rest of the table follows from.');
    expect(await page.locator('#compare-detail-who-can-verify').textContent())
      .toContain('This is the row the rest of the table follows from.');
  });

test('stripping and regeneration are shown as different failures', async ({ page }) => {
  await page.goto(LAB);
  // By the half each panel is, rather than by which is printed first.
  const half = (title: string): Locator => page.locator('#act-7 .grid-2 .panel')
    .filter({ has: page.locator('.panel-title', { hasText: title }) });
  const strip = half('STRIPPING');
  const regen = half('REGENERATION');

  // Both halves measure themselves at mount and are guarded separately, because they fail
  // separately. Waiting for both verdicts is what stops the scroll chasing a section that
  // is still filling in.
  await expect(strip.locator('.verdict')).toBeVisible();
  await expect(regen.locator('.verdict')).toBeVisible();
  await page.locator('#act-7').scrollIntoViewIfNeeded();

  await expect(strip).toContainText('Asset digest before and after');
  await expect(strip.locator('dd', { hasText: 'identical' })).toBeVisible();

  const before = Number(await readout(regen, 'Score before'));
  const after = Number(await readout(regen, 'Score after'));
  expect(before).toBeCloseTo(REFERENCE.watermarkedScore, 3);
  // The regeneration panel's verdict must agree with its own numbers.
  const threshold = Number(await readout(regen, 'Threshold at FPR 1%'));
  const survived = after >= threshold;
  await expect(regen.locator('.verdict')).toContainText(
    survived ? 'Evidence survived' : 'Evidence did not survive');
  // And so must the line that closes it.
  await expect(regen.locator('.consequence-effect')).toHaveText(
    survived
      ? 'enough keyed choices survived to clear the threshold.'
      : 'the evidence went with the words that carried it.');
});

/**
 * Act VIII's estimate is re-derived here from the page's own printed inputs, by a route
 * the act does not take: the correction is applied in this file, in percentage points, to
 * the flagged count and the two calibration rates the page printed — not to the internal
 * numbers behind them. A rounding-only agreement would still be an agreement, so the
 * bookkeeping is checked as well, and both are what a wrong estimator would have to
 * defeat at once.
 */
test('the population estimate is what its own printed inputs imply', async ({ page }) => {
  await page.goto(LAB);
  const act8 = page.locator('#act-8');
  await act8.getByRole('button', { name: 'Score the corpus and estimate' }).click();
  await expect(act8.locator('.progress')).toContainText('Done.');

  const percent = async (scope: Locator, term: string): Promise<number> =>
    Number.parseFloat((await readout(scope, term)).replace('%', ''));

  const estimatePanel = act8.locator('.readout').first();
  const calibration = act8.locator('.panel')
    .filter({ has: page.locator('.panel-title', { hasText: 'calibrated' }) });
  const singles = act8.locator('.panel')
    .filter({ has: page.locator('.panel-title', { hasText: 'one document at a time' }) });

  const documents = Number(await readout(estimatePanel, 'Documents in the corpus'));
  const flagged = Number(await readout(estimatePanel, 'Documents flagged'));
  const rate = await percent(estimatePanel, 'Flagged fraction, uncorrected');
  const estimate = await percent(estimatePanel, 'Estimated marked fraction');
  const fpr = await percent(calibration, 'False-positive rate, calibration');
  const tpr = await percent(calibration, 'True-positive rate, calibration');

  // The uncorrected rate is the count over the corpus, and the estimate is that rate
  // inverted through the two rates.
  expect((100 * flagged) / documents).toBeCloseTo(rate, 1);
  // Every input to that inversion is printed to a tenth of a point, and the correction
  // divides by the separation between the rates, so half a tenth on each arrives
  // magnified by its reciprocal. The tolerance is derived from the figures on screen
  // rather than guessed at: at the separation this detector has it is about a quarter of
  // a point, and an estimator that was actually wrong would miss by more than the page's
  // own rounding can explain.
  const tick = 0.05;
  const separation = (tpr - fpr) / 100;
  const tolerance = (2 * tick) / separation + (estimate * 2 * tick) / (tpr - fpr) + tick;
  expect(Math.abs((rate - fpr) / separation - estimate)).toBeLessThan(tolerance);

  // The interval brackets the estimate, and the page's own yes/no about the fraction the
  // corpus was built at agrees with the interval it printed beside it.
  const held = await percent(estimatePanel, 'Marked fraction, held out');
  const [low, high] = (await readout(estimatePanel, '95% interval'))
    .split(' to ').map((half) => Number.parseFloat(half));
  expect(low).toBeLessThanOrEqual(estimate);
  expect(high).toBeGreaterThanOrEqual(estimate);
  expect(await readout(estimatePanel, 'True fraction inside the interval'))
    .toBe(held >= low && held <= high ? 'yes' : 'no');

  // The same flags, counted the other way: the two classes have to add up to the corpus
  // and to the flagged count the estimate was computed from.
  const markedDocuments = Number(await readout(singles, 'Marked documents in the corpus'));
  const unmarkedDocuments = Number(await readout(singles, 'Unmarked documents in the corpus'));
  const flaggedMarked = Number(await readout(singles, 'Marked documents flagged'));
  const flaggedUnmarked = Number(await readout(singles, 'Unmarked documents flagged'));
  expect(markedDocuments + unmarkedDocuments).toBe(documents);
  expect(flaggedMarked + flaggedUnmarked).toBe(flagged);
  expect(markedDocuments).toBe(Math.round((held / 100) * documents));
  expect(await percent(singles, 'Of the flagged documents, share actually marked'))
    .toBeCloseTo((100 * flaggedMarked) / flagged, 1);

  // The claim the act is built on: the interval closes as documents are added, and the
  // last row of the ladder is the corpus the readouts above describe.
  const ladder = await act8.locator('tbody tr').evaluateAll((rows) => rows.map((row) =>
    [...row.children].map((cell) => (cell.textContent ?? '').trim())));
  expect(ladder.length).toBeGreaterThan(4);
  const halfWidths = ladder.map((row) => Number.parseFloat(row[row.length - 1]));
  for (let index = 1; index < halfWidths.length; index += 1) {
    expect(halfWidths[index], `corpus ${ladder[index][0]} must not widen on ` +
      `corpus ${ladder[index - 1][0]}`).toBeLessThan(halfWidths[index - 1]);
  }
  expect(Number(ladder[ladder.length - 1][0])).toBe(documents);
  expect(Number(ladder[ladder.length - 1][1])).toBe(flagged);

  // And the mixture is held out of the estimate rather than fed to it: a different corpus
  // built from the same scored documents moves the answer, and moves it towards the
  // fraction it was built at.
  await page.locator('#act8-mixture').selectOption('0.50');
  await expect(estimatePanel).toContainText('50.0%');
  const richer = await percent(estimatePanel, 'Estimated marked fraction');
  expect(richer).toBeGreaterThan(estimate);
});

/**
 * A reset that has nothing to reset says so, rather than doing nothing.
 *
 * The defect this pins down was invisible to every other check here: pressing "Reset the
 * sweep" before running a sweep did exactly what it should — nothing — and looked exactly
 * like a broken control while doing it, because the page gave no signal either way. The
 * page's own rule, stated in the README and obeyed by Act V's flip and strip controls, is
 * that a control which cannot act is switched off with the reason on it.
 *
 * Asserted as a cycle rather than as a state: disabled at arrival, enabled by the run,
 * disabled again by its own press. The last of those is what makes the press perceptible
 * even when the output it cleared was below the fold.
 */
test('a reset offers itself only when there is something to reset', async ({ page }) => {
  await page.goto(LAB);
  const panels: [string, string, string][] = [
    ['#hero-experiment', 'Run the sweep', 'Reset the sweep'],
    ['#act-3', 'Score the watermarked corpus', 'Reset the corpus scoring'],
    ['#act-8', 'Score the corpus and estimate', 'Reset the estimate'],
  ];

  for (const [act, runLabel, resetLabel] of panels) {
    const scope = page.locator(act);
    const reset = scope.getByRole('button', { name: resetLabel });
    const run = scope.getByRole('button', { name: runLabel });

    await expect(reset, `${act}: nothing has run, so ${resetLabel} must be off`)
      .toBeDisabled();
    // The reason is carried where a disabled control can still be read, not only in a
    // title a keyboard never surfaces.
    const describedBy = await reset.getAttribute('aria-describedby');
    expect(describedBy, `${act}: ${resetLabel} must name its reason`).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText('first');

    await run.click();
    await expect(scope.locator('.progress')).toContainText('Done.', { timeout: 60_000 });
    await expect(reset, `${act}: the run produced something, so ${resetLabel} must be on`)
      .toBeEnabled();

    await reset.click();
    await expect(reset, `${act}: ${resetLabel} must switch itself off once it has fired`)
      .toBeDisabled();
    // And it actually cleared the panel rather than only switching itself off. The Hero
    // keeps three result figures of its own, which the sweep's reset must not touch.
    const figures = act === '#hero-experiment'
      ? scope.locator('.panel', { hasText: 'Not one wrong key' }).locator('figure')
      : scope.locator('figure');
    await expect(figures, `${act}: ${resetLabel} must clear what the run drew`)
      .toHaveCount(0);
  }
});

test('the social preview prints the three scores this page computes', async ({ page }) => {
  // The Open Graph image is generated from these numbers rather than drawn, so the alt
  // text is a claim about the detector made outside the page — and the one claim on this
  // site that a reader can see without ever loading the app. If the detector, the pinned
  // vectors or the threshold move, this fails here rather than going wrong silently in
  // everyone else's link previews.
  await page.goto(DEMO);
  const alt = await page.locator('meta[property="og:image:alt"]').getAttribute('content');
  const printed = await page.locator('#hero-experiment .result-metric-major .result-metric-value')
    .allTextContents();
  expect(printed.length).toBe(3);
  expect(alt).toBeTruthy();
  expect([...(alt ?? '').matchAll(/\d\.\d{4}/g)].map((match) => match[0]))
    .toEqual(printed.map((value) => value.trim()));
});

test('a deep link opens the exact scenario it advertises', async ({ page }) => {
  // A presenter hands out these links and has to know what the audience will see. Each
  // is a full navigation, so each is a cold load: the state under test is the one the URL
  // restored on arrival, never one left behind by the assertion above it.
  await page.goto(`${DEMO}#act-5`);
  await expect(page.getByRole('button', { name: 'Demo', exact: true }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#act-1')).toBeHidden();
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification passed');
  await expectLandsClearOfTheStickyBars(page, 'act-5');

  // The mutated states a link can honestly restore.
  await page.goto(`${LAB}&sign=tampered#act-5`);
  await expect(page.locator('#act-5 .verdict')).toContainText('Verification failed');
  expect(await readout(page.locator('#act-5'), 'Hard binding matches the asset')).toBe('no');
  await expect(page.locator('#act-5 .consequence-effect'))
    .toHaveText('integrity verification failed.');
  await expectLandsClearOfTheStickyBars(page, 'act-5');

  await page.goto(`${LAB}&scenario=mid_entropy#act-1`);
  await expect(page.locator('#tournament-distribution')).toHaveValue('mid_entropy');
  await expectLandsClearOfTheStickyBars(page, 'act-1');
});

test('a deep link to a sample loads that sample, and a link to nothing is dropped',
  async ({ page }) => {
    await page.goto(LAB);
    const shipped = await page.locator('#detector-input').inputValue();

    await page.goto(`${LAB}&sample=back-translation#act-2`);
    await expect(page.locator('#detector-preset')).toHaveValue('back-translation');
    const linked = await page.locator('#detector-input').inputValue();
    expect(linked).not.toBe(shipped);
    expect(linked.length).toBeGreaterThan(0);
    // The score on screen describes the text the link asked for, not the shipped one.
    await expect(page.locator('#act-2 .verdict')).toHaveCount(1);

    // A parameter naming a sample this page does not hold is a link that lies about what
    // the audience will see, so the page drops it rather than leaving it in the address
    // bar beside a different text.
    await page.goto(`${LAB}&sample=not-a-sample-this-lab-holds#act-2`);
    await expect(page.locator('#detector-preset')).toHaveValue('');
    expect(await page.locator('#detector-input').inputValue()).toBe(shipped);
    expect(new URL(page.url()).searchParams.get('sample')).toBeNull();
  });

/**
 * A deep link has to land its target below both sticky bars, not behind them. The bars
 * measure themselves into custom properties at mount, so the expectation is read off the
 * page rather than written here as a constant that was true once.
 */
async function expectLandsClearOfTheStickyBars(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => page.evaluate((target: string) => {
      const styles = getComputedStyle(document.documentElement);
      const px = (name: string): number =>
        Number.parseFloat(styles.getPropertyValue(name)) || 0;
      const bars = px('--cl-topbar-h') + px('--chapters-h');
      const top = document.getElementById(target)?.getBoundingClientRect().top ?? NaN;
      return top >= bars && top < bars + 48
        ? 'clear of the sticky bars'
        : `top ${Math.round(top)} against bars ending at ${Math.round(bars)}`;
    }, id), { message: `#${id} must land below both sticky bars`, timeout: 15_000 })
    .toBe('clear of the sticky bars');
}

test('no element is hidden by the cascade while the code believes it is hidden',
  async ({ page }) => {
    // The [hidden] cascade trap: a class rule setting `display` outranks the UA's
    // [hidden] rule, so an element paints while the code thinks it is gone. The depth
    // mechanism rests entirely on this, and it is checked at both depths because each one
    // hides a different set: twenty-four lab-only elements in Demo, three demo-only ones
    // in Full lab, on classes the stylesheet gives an explicit display to.
    const painted = async (): Promise<string[]> => page.evaluate(() =>
      [...document.querySelectorAll('[hidden]')]
        .filter((element) => getComputedStyle(element).display !== 'none')
        .map((element) => element.className || element.tagName));

    await page.goto(DEMO);
    await expect(page.locator('[hidden]')).not.toHaveCount(0);
    expect(await painted()).toEqual([]);

    await page.goto(LAB);
    await expect(page.locator('[hidden]')).not.toHaveCount(0);
    expect(await painted()).toEqual([]);
  });
