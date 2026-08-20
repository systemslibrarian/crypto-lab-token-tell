/**
 * Draw the link preview and the app icons from the numbers this lab actually produces.
 *
 * A social card is the one part of a page that is read without the page, so it is the
 * easiest place to state something the experiment does not support. This lab exists to
 * argue that a claim should be checkable, and an image asserting a mean g-score nobody can
 * reproduce would be the exact failure it is about. So no figure below is typed: every
 * score, the threshold and the digest are read out of `src/data/pinned/`, and the verdict
 * words are derived by comparing score against threshold rather than written down. If a
 * pinned value moves, this script either draws the new one or stops; it cannot quietly
 * keep drawing the old one.
 *
 * The words are held to the same standard as the figures, and the lede is where that was
 * being lost. It read "the real SynthID-Text detector", which is the vendor's detector and
 * not what this runs: the lab's own first limitation says the statistic here is the mean
 * g-score rather than the learned or Bayesian detector the paper's headline results use,
 * and on the short route that qualification is not on screen at all. The card travels
 * alone, so it says what the page's own hero says — a real keyed g-value detector.
 *
 * The icons are generated here too, for one reason: the previous mark was an emoji data
 * URI, drawn by whichever font the reader's platform supplied, so it changed shape between
 * a phone, a laptop and a projector. The replacement is geometry — rectangles, no text
 * element, no font dependency — in the lab's own accent pair, which is also why it stays
 * legible at 16px where a monogram set in a font would not.
 *
 * Deterministic in the sense that matters: the same pinned inputs give the same image. It
 * is not byte-reproducible across platforms, because text is rasterised by the host's font
 * stack, which is why the PNGs are committed rather than built in CI.
 *
 * Usage: npm run make:social
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'public');

/** The lab's own tokens, copied from src/style.css so the card cannot drift off-palette. */
const PALETTE = {
  bg: '#0b0f14',
  panel: '#131a24',
  raised: '#1a2330',
  text: '#e6edf3',
  textDim: '#a9b8c7',
  textMuted: '#8fa0b1',
  border: '#2b3a4d',
  borderStrong: '#3d5169',
  accent: '#b6a4ff',
  accentInk: '#0b0f14',
  ok: '#4fe0c4',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

/**
 * Fail with the path that was missing rather than with `undefined`, because a silently
 * absent score would be drawn as "NaN" on an image nobody re-reads before posting it.
 */
function dig(source, label, path) {
  let value = source;
  const walked = [];
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !(key in value)) {
      throw new Error(
        `${label}: no value at ${[...walked, key].join('.')}. The social image is drawn ` +
        'from the pinned data and will not be generated with a number it cannot find.',
      );
    }
    walked.push(key);
    value = value[key];
  }
  return value;
}

function readNumber(source, label, path) {
  const value = dig(source, label, path);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}: ${path.join('.')} is not a finite number (${String(value)}).`);
  }
  return value;
}

function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'));
}

/** Matches `fixed` in src/ui/dom.ts, so the card and the page print a score the same way. */
function fixed(value) {
  return value.toFixed(4);
}

/**
 * The decision threshold, resolved exactly as `thresholdForLength` in src/ui/score-card.ts
 * does it: the top 1% of the pinned null at the nearest measured length at or below this
 * text's. Duplicated rather than imported because this is a plain Node script and the lab
 * is TypeScript; the assertion below is what keeps the duplicate honest.
 */
function thresholdForLength(nullCorpus, tokenCount) {
  const byLength = dig(nullCorpus, 'null-corpus.json', ['by_length']);
  const lengths = Object.values(byLength)
    .map((entry) => entry.tokens)
    .filter((tokens) => typeof tokens === 'number' && tokens <= tokenCount)
    .sort((a, b) => a - b);
  if (!lengths.length) {
    throw new Error(
      `null-corpus.json: no measured length at or below ${tokenCount} tokens, so there is ` +
      'no threshold to print.',
    );
  }
  const chosen = lengths[lengths.length - 1];
  return {
    value: readNumber(nullCorpus, 'null-corpus.json',
      ['by_length', String(chosen), 'threshold_fpr_1_percent']),
    measuredAtLength: chosen,
  };
}

/**
 * Everything the card states, with the verdicts derived rather than asserted. If a pinned
 * score ever crossed the threshold the wrong way, the words on the image would change with
 * it — and the check below would stop the run first, because a card that says "Evidence"
 * over a wrong-key score is the one mistake this lab cannot afford to publish.
 */
function collectClaims() {
  const vectors = readJson('src/data/pinned/test-vectors.json');
  const nullCorpus = readJson('src/data/pinned/null-corpus.json');
  const texts = readJson('src/data/pinned/texts.json');

  const label = 'test-vectors.json';
  const correct = readNumber(vectors, label,
    ['pinned_sample_scores', 'watermarked', 'configured_keys', 'score']);
  const wrong = readNumber(vectors, label,
    ['pinned_sample_scores', 'watermarked', 'wrong_keys', 'score']);
  const control = readNumber(vectors, label,
    ['pinned_sample_scores', 'control', 'configured_keys', 'score']);
  const tokenCount = readNumber(vectors, label,
    ['pinned_sample_scores', 'watermarked', 'configured_keys', 'token_count']);

  const threshold = thresholdForLength(nullCorpus, tokenCount);

  const watermarkedText = dig(texts, 'texts.json', ['samples', 'watermarked', 'text']);
  const controlText = dig(texts, 'texts.json', ['samples', 'control', 'text']);
  const sharedDigest = createHash('sha256').update(watermarkedText, 'utf8').digest('hex');
  const controlDigest = createHash('sha256').update(controlText, 'utf8').digest('hex');
  if (sharedDigest === controlDigest) {
    throw new Error(
      'texts.json: the control sample hashes to the same digest as the watermarked one, ' +
      'so the card cannot claim run 3 is a different text.',
    );
  }

  if (!(correct >= threshold.value)) {
    throw new Error(
      `The configured-key score ${fixed(correct)} is below the threshold ` +
      `${fixed(threshold.value)}. The card would print "Evidence" over a score that is ` +
      'not evidence; regenerate the pinned data or fix the lab before publishing it.',
    );
  }
  for (const [name, score] of [['wrong-key', wrong], ['control', control]]) {
    if (score >= threshold.value) {
      throw new Error(
        `The ${name} score ${fixed(score)} is at or above the threshold ` +
        `${fixed(threshold.value)}. The card would print "No evidence" over a score that ` +
        'crosses it.',
      );
    }
  }

  return { correct, wrong, control, tokenCount, threshold, sharedDigest };
}

/** The lab's verdict vocabulary from src/ui/dom.ts: a glyph and a word, never a colour. */
function verdictFor(score, threshold) {
  return score >= threshold
    ? { glyph: '[+]', word: 'Evidence', tone: 'evidence' }
    : { glyph: '[ ]', word: 'No evidence', tone: 'none' };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

function cardMarkup(card) {
  return `
      <section class="card ${card.tone}">
        <p class="scenario">${escapeHtml(card.scenario)}</p>
        <p class="verdict"><span class="glyph">${escapeHtml(card.glyph)}</span>${escapeHtml(card.word)}</p>
        <p class="score">${escapeHtml(card.score)}</p>
        <p class="score-label">mean g-score</p>
        <p class="change">${escapeHtml(card.change)}</p>
      </section>`;
}

function socialMarkup(claims) {
  const cards = [
    {
      scenario: 'Run 1 · correct key',
      ...verdictFor(claims.correct, claims.threshold.value),
      score: fixed(claims.correct),
      change: 'The text as generated, read with the key that marked it.',
    },
    {
      scenario: 'Run 2 · wrong key',
      ...verdictFor(claims.wrong, claims.threshold.value),
      score: fixed(claims.wrong),
      change: 'Byte-identical input to run 1. Only the key changed.',
    },
    {
      scenario: 'Run 3 · control',
      ...verdictFor(claims.control, claims.threshold.value),
      score: fixed(claims.control),
      change: 'A different text, never watermarked, configured key.',
    },
  ];
  const shortDigest = `${claims.sharedDigest.slice(0, 8)}…${claims.sharedDigest.slice(-8)}`;

  return `<style>
      *{box-sizing:border-box;margin:0}
      body{
        width:1200px;height:630px;background:${PALETTE.bg};color:${PALETTE.text};
        font-family:${PALETTE.sans};padding:44px 60px 38px;display:flex;flex-direction:column;
        border-top:6px solid ${PALETTE.accent};
      }
      .eyebrow{
        font-family:${PALETTE.mono};font-size:18px;letter-spacing:.22em;text-transform:uppercase;
        color:${PALETTE.accent};
      }
      h1{font-size:50px;line-height:1.06;letter-spacing:-.015em;margin-top:12px;font-weight:700}
      .lede{font-size:21px;line-height:1.32;color:${PALETTE.textDim};margin-top:10px;max-width:76ch}
      .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:24px}
      .card{
        border:2px solid ${PALETTE.borderStrong};border-radius:14px;background:${PALETTE.raised};
        padding:16px 20px 14px;display:flex;flex-direction:column;
      }
      .card.evidence{border-color:${PALETTE.ok};background:rgba(79,224,196,.10)}
      .scenario{
        font-family:${PALETTE.mono};font-size:15px;letter-spacing:.06em;text-transform:uppercase;
        color:${PALETTE.textMuted};white-space:nowrap;
      }
      .verdict{font-size:29px;font-weight:700;margin-top:8px;display:flex;align-items:baseline;gap:9px}
      .verdict .glyph{font-family:${PALETTE.mono};font-size:25px}
      .card.evidence .verdict{color:${PALETTE.ok}}
      .card.none .verdict{color:${PALETTE.textDim}}
      .score{font-family:${PALETTE.mono};font-size:50px;font-weight:700;margin-top:10px;letter-spacing:-.01em}
      .score-label{
        font-family:${PALETTE.mono};font-size:14px;letter-spacing:.08em;text-transform:uppercase;
        color:${PALETTE.textMuted};margin-top:2px;
      }
      .change{font-size:15px;line-height:1.32;color:${PALETTE.textDim};margin-top:10px}
      .caveat{font-size:18px;line-height:1.3;color:${PALETTE.textDim};margin-top:18px}
      .caveat b{color:${PALETTE.text};font-weight:600}
      footer{
        margin-top:auto;padding-top:14px;border-top:1px solid ${PALETTE.border};
        display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
      }
      footer p{font-family:${PALETTE.mono};font-size:15px;line-height:1.5;color:${PALETTE.textMuted}}
      footer b{color:${PALETTE.textDim};font-weight:400}
      .url{font-family:${PALETTE.mono};font-size:15px;color:${PALETTE.accent};white-space:nowrap}
    </style>
    <p class="eyebrow">Crypto Lab · Token Tell</p>
    <h1>Same bytes. Different key. Different verdict.</h1>
    <p class="lede">
      One watermarked passage, three runs of a real keyed g-value detector. Runs 1 and 2 are
      given byte-identical input and differ only in the key.
    </p>
    <div class="cards">${cards.map(cardMarkup).join('')}
    </div>
    <p class="caveat">
      <b>A watermark is not a signature.</b> This is evidence about one watermark key. It does
      not establish authorship and does not prove that text is AI-generated.
    </p>
    <footer>
      <p>
        <b>Runs 1 and 2 · one SHA-256</b> ${escapeHtml(shortDigest)}<br />
        <b>Threshold</b> ${fixed(claims.threshold.value)} at FPR 1% ·
        ${claims.threshold.measuredAtLength}-token unwatermarked null
      </p>
      <p class="url">systemslibrarian.github.io/crypto-lab-token-tell</p>
    </footer>`;
}

/**
 * The mark: two T's built from rectangles on the accent tile. Geometry rather than a
 * `<text>` element because a favicon set in a font is redrawn by whatever the platform
 * substitutes, and the accent-on-ink pair because it is the lab's own primary-action
 * colouring and the only combination here that still separates from a browser tab strip in
 * either theme.
 */
function iconSvg() {
  // Two T's sharing one crossbar. Set as two separate letters the stems fall below two
  // device pixels at 16px and the pair closes into a blob; sharing the bar buys each stem
  // enough weight, and the gap between them stays visible at tab size.
  const top = 15;
  const barHeight = 10;
  const stemWidth = 10;
  const stemHeight = 34;
  const stems = [15, 39]
    .map((left) =>
      `  <rect x="${left}" y="${top}" width="${stemWidth}" height="${stemHeight}" rx="2" ` +
      `fill="${PALETTE.accentInk}"/>`)
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Token Tell">
  <title>Token Tell</title>
  <rect width="64" height="64" rx="13" fill="${PALETTE.accent}"/>
  <rect x="8" y="${top}" width="48" height="${barHeight}" rx="2" fill="${PALETTE.accentInk}"/>
${stems}
</svg>
`;
}

/**
 * The PNGs are drawn full-bleed rather than with the SVG's rounded corners: iOS and
 * Android mask an app icon themselves, and a transparent corner is composited onto white
 * before they do it, which would put a pale notch on each corner of a dark-purple tile.
 * The tab favicon keeps the rounded SVG, where nothing masks it.
 */
function iconMarkup(svg, size) {
  const scaled = svg.replace('width="64" height="64"', `width="${size}" height="${size}"`);
  return `<style>
      *{margin:0}
      body{width:${size}px;height:${size}px;background:${PALETTE.accent};overflow:hidden}
    </style>${scaled}`;
}

async function shoot(browser, markup, width, height, outPath) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  await page.setContent(markup, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: outPath, type: 'png' });
  await page.close();
}

async function main() {
  const claims = collectClaims();
  const svg = iconSvg();
  writeFileSync(join(PUBLIC_DIR, 'icon.svg'), svg, 'utf8');

  const browser = await chromium.launch();
  try {
    await shoot(browser, socialMarkup(claims), 1200, 630, join(PUBLIC_DIR, 'og.png'));
    for (const size of [180, 192, 512]) {
      await shoot(browser, iconMarkup(svg, size), size, size,
        join(PUBLIC_DIR, `icon-${size}.png`));
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(
    'public/og.png, public/icon.svg, public/icon-180.png, public/icon-192.png and ' +
    'public/icon-512.png regenerated.\n' +
    `Scores drawn: ${fixed(claims.correct)} / ${fixed(claims.wrong)} / ` +
    `${fixed(claims.control)} against a threshold of ${fixed(claims.threshold.value)}.\n` +
    `Shared input digest: ${claims.sharedDigest}\n` +
    'The og:image:alt in index.html states these same figures; update it if they moved.\n',
  );
}

await main();
