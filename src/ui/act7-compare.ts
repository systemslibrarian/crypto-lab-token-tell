/**
 * Act VII — what each mechanism actually proves.
 *
 * The structural distinction first, because it explains every row of the comparison that
 * follows, and then the two failure modes side by side as an experiment rather than as
 * prose.
 *
 * No "watermark bad, signature good". These mechanisms solve different problems, and the
 * comparison is arranged so that neither column wins.
 *
 * Two depths, one set of claims. The short route needs four questions and an audit needs
 * ten, so the four are selected out of the same `ROWS` table by id rather than restated
 * beside it. A second copy of "who can verify" would be a second thing to keep true, and
 * the copy that is not under test is always the one that drifts.
 *
 * The reasoning behind each row used to occupy a dedicated row of its own, which nearly
 * doubled the height of a table whose entire job is to be read across. The question is now
 * the trigger for its own explanation, so the table is the comparison and the argument
 * arrives only when it is asked for.
 *
 * On a phone, tinting one of four columns inside a horizontal scroller focuses nothing:
 * the reader still has to scroll past the other two to reach the tinted one. So the same
 * control means two things at two widths — a tint on a desktop, where every column is on
 * screen at once, and a genuine choice of the single column rendered on a narrow one. The
 * width is watched rather than read once, because a rotation changes the answer and an
 * audience should never have to reload to get it.
 */

import attacks from '../data/pinned/attacks.json';
import texts from '../data/pinned/texts.json';
import { buildManifest, encodeUtf8, sha256Hex } from '../c2pa/manifest.ts';
import { generateSignerKeyPair, signManifest } from '../c2pa/sign.ts';
import { validateManifest } from '../c2pa/validate.ts';
import { defaultConstruction, tokenizer, watermarkParams } from '../lab-config.ts';
import { scoreTokens } from '../watermark/score.ts';
import { requireWebCrypto } from './act5-sign.ts';
import { resetButton, runGuarded } from './busy.ts';
import {
  actHeader, clear, consequence, disclosure, el, fixed, integer, liveRegion, panel,
  provenanceTag, readout, scroller, srOnly, verdict,
} from './dom.ts';
import { demoOnly, goToLab, labOnly } from './mode.ts';
import { thresholdForLength } from './score-card.ts';

const GPT2_EOS = 50256;

/** The same breakpoint the stylesheet uses to stack the page into one column. */
const NARROW_QUERY = '(max-width: 640px)';

type Mechanism = 'watermark' | 'signature' | 'c2pa';
type Focus = Mechanism | 'all';

interface MechanismColumn {
  readonly key: Mechanism;
  readonly label: string;
}

const MECHANISMS: readonly MechanismColumn[] = [
  { key: 'watermark', label: 'Statistical watermarking' },
  { key: 'signature', label: 'Digital signatures' },
  { key: 'c2pa', label: 'C2PA provenance' },
];

interface ComparisonRow {
  readonly id: string;
  readonly question: string;
  readonly watermark: { text: string; tone: 'yes' | 'no' | 'partial' };
  readonly signature: { text: string; tone: 'yes' | 'no' | 'partial' };
  readonly c2pa: { text: string; tone: 'yes' | 'no' | 'partial' };
  readonly detail: string;
  readonly loadBearing?: boolean;
}

const ROWS: ComparisonRow[] = [
  {
    id: 'secrecy-model',
    question: 'What is the secrecy model?',
    watermark: { text: 'symmetric secret', tone: 'partial' },
    signature: { text: 'asymmetric keypair', tone: 'yes' },
    c2pa: { text: 'asymmetric keypair plus PKI', tone: 'yes' },
    detail:
      'The watermark uses one secret held by whoever generates and whoever detects — the ' +
      'same secret. Signatures split the capability in two: a private half that produces ' +
      'and a public half that checks. C2PA adds the machinery for deciding whose public ' +
      'half to believe.',
  },
  {
    id: 'who-can-verify',
    question: 'WHO CAN VERIFY?',
    watermark: {
      text: 'only a holder of the watermark configuration; in production, the issuer alone',
      tone: 'no',
    },
    signature: { text: 'anyone holding the public key', tone: 'yes' },
    c2pa: { text: 'anyone, via published certificates and trust lists', tone: 'yes' },
    detail:
      'This is the row the rest of the table follows from. Detection needs the key: the ' +
      'paper states that scoring "only requires access to the tokenized text, the ' +
      'watermarking key k and the random seed generator" — no model, but the key is not ' +
      'optional. Google’s own guidance tells issuers that each watermarking configuration ' +
      '"should be stored securely and privately, otherwise your watermark may be trivially ' +
      'replicable by others", and it enumerates exactly three ways an issuer may expose a ' +
      'detector — keep it private, put it behind an API, or publish it. All three are the ' +
      'issuer’s choice. There is no fourth option in which a third party verifies without ' +
      'the issuer. That is a property of the construction, not a gap in the product.',
    loadBearing: true,
  },
  {
    id: 'embedded-evidence',
    question: 'Is evidence embedded in the content itself?',
    watermark: { text: 'yes — in the choice of tokens', tone: 'yes' },
    signature: { text: 'no — it travels beside the content', tone: 'no' },
    c2pa: { text: 'no — in a manifest attached to the asset', tone: 'no' },
    detail:
      'The watermark has no separate carrier to remove: the evidence is the word choices. ' +
      'A signature is a separate object, which is why it can be detached — and why the ' +
      'content survives detaching it completely unharmed.',
  },
  {
    id: 'statistical-or-binary',
    question: 'Is verification statistical or binary?',
    watermark: { text: 'statistical — a score against a threshold', tone: 'partial' },
    signature: { text: 'binary', tone: 'yes' },
    c2pa: { text: 'binary for integrity; trust is a separate judgement', tone: 'partial' },
    detail:
      'Every watermark verdict on this page carries a threshold and a false-positive rate ' +
      'because it has to. The signature verdicts carry neither, because there is nothing ' +
      'to tune: the bytes either verify or they do not.',
  },
  {
    id: 'survives-stripping',
    question: 'Can metadata or manifest removal eliminate the verification material?',
    watermark: { text: 'no — there is no manifest to strip', tone: 'yes' },
    signature: { text: 'yes — drop the signature and nothing verifies', tone: 'no' },
    c2pa: { text: 'yes — a stripped manifest leaves no provenance', tone: 'no' },
    detail:
      'The strongest thing the watermark has over the signature, and the reason the two ' +
      'are complementary rather than competing.',
  },
  {
    id: 'survives-regeneration',
    question: 'Can regeneration destroy the evidence?',
    watermark: { text: 'yes — rewriting discards the keyed choices', tone: 'no' },
    signature: { text: 'the signature stops verifying, which is the point', tone: 'yes' },
    c2pa: { text: 'the manifest no longer binds the new bytes', tone: 'yes' },
    detail:
      'For the watermark this is a loss of evidence: the text still says the same thing ' +
      'and nothing can now be shown about where it came from. For the signature it is a ' +
      'correct detection: the bytes changed, so verification fails, which is exactly what ' +
      'it is for.',
  },
  {
    id: 'alteration-breaks-integrity',
    question: 'Does alteration break integrity verification?',
    watermark: { text: 'partially — evidence degrades with the amount of editing', tone: 'partial' },
    signature: { text: 'yes — one byte is enough', tone: 'yes' },
    c2pa: { text: 'yes — the hard binding fails', tone: 'yes' },
    detail:
      'Act IV measured the degradation. A quarter of the tokens deleted leaves something; ' +
      'a full paraphrase leaves nothing. There is no equivalent gradient on the signature ' +
      'side.',
  },
  {
    id: 'identifies-signer',
    question: 'Can it identify a signer?',
    watermark: { text: 'no — it identifies a configuration, not a person', tone: 'no' },
    signature: { text: 'yes — relative to a key', tone: 'yes' },
    c2pa: { text: 'yes — relative to a certified identity', tone: 'yes' },
    detail:
      'A watermark score says the text is correlated with a key. Who held that key, and ' +
      'whether they are who they say they are, is outside what the mechanism can answer.',
  },
  {
    id: 'establishes-generation',
    question: 'Can it establish model generation?',
    watermark: {
      text: 'evidence that a model carrying this configuration produced it',
      tone: 'partial',
    },
    signature: { text: 'no — only what the signer asserted', tone: 'no' },
    c2pa: { text: 'no — only what the claim generator asserted', tone: 'no' },
    detail:
      'And even the watermark’s version is narrower than it sounds: it is evidence about ' +
      'a configuration, which an issuer could apply to text it did not generate, and which ' +
      'anyone holding a leaked configuration could apply to anything at all.',
  },
  {
    id: 'proves-truth',
    question: 'Does it prove the content is factually true?',
    watermark: { text: 'no', tone: 'no' },
    signature: { text: 'no', tone: 'no' },
    c2pa: { text: 'no', tone: 'no' },
    detail:
      'Act VI signed a plainly false statement with a real key and verified it. No ' +
      'mechanism on this page answers a question about the world.',
  },
];

/**
 * The short route's four questions, in the order the ninety-second reading needs them:
 * who can verify, then what kind of answer each mechanism gives, then what survives
 * removal, then what none of them can settle. They
 * are ids into `ROWS` rather than a second table, so the compact comparison cannot come to
 * disagree with the full one.
 */
const COMPACT_IDS: readonly string[] = [
  'who-can-verify', 'statistical-or-binary', 'survives-stripping', 'proves-truth',
];

const BY_ID = new Map(ROWS.map((row) => [row.id, row]));

/** The width watch outlives a single render, so the previous one is detached first. */
let detachWidthWatch: (() => void) | null = null;

export function renderAct7(root: HTMLElement): void {
  clear(root);
  detachWidthWatch?.();
  detachWidthWatch = null;

  // Numeral and noun phrase together: the numeral is what the anchor, the README and the
  // verifier call this beat, and the noun phrase is the chapter chip standing above it.
  root.append(...actHeader(
    'act-7',
    'Act VII · What each proves',
    'What each mechanism actually proves',
    'One structural difference explains every row of the comparison that follows.',
  ));

  root.append(panel('Symmetric secret, or asymmetric public', [
    el('p', {}, [
      el('b', { text: 'SynthID-Text detection is symmetric-secret. ' }),
      'The verifier must hold the same watermark configuration used at generation. ' +
      'Verification capability and generation capability are the same capability.',
    ]),
    el('p', {}, [
      el('b', { text: 'Signatures and C2PA are asymmetric-public. ' }),
      'The private key signs; anyone with the public key verifies. The ability to verify ' +
      'is deliberately separated from the ability to produce.',
    ]),
    el('p', {}, [
      'The consequence, stated plainly: only the issuer can check the issuer’s marks. ' +
      'There is no interoperable third-party verification of SynthID-Text. That is not an ' +
      'implementation gap — it follows from the construction.',
    ]),
    el('p', { class: 'note' }, [
      'Separately, and not to be conflated with the above: SynthID also covers image, ' +
      'audio and video, and the routes Google publishes for checking those are ' +
      'issuer-operated too — verification inside the Gemini app for signed-in users, and a ' +
      'waitlisted detector portal — with no published detector anyone can run. This lab ' +
      'implements none of it and makes no claim about how those media watermarks work ' +
      'internally; the mechanism is carried as an open question rather than asserted.',
    ]),
  ], provenanceTag('paper', 'construction, not policy')));

  root.append(demoOnly(renderCompactComparison()));
  root.append(labOnly(renderComparison()));
  root.append(labOnly(renderStripVsRegenerate()));

  root.append(panel('Neither of these is the good one', [
    el('p', {}, [
      'A watermark survives having its metadata stripped, because there is no metadata. A ' +
      'signature survives being rewritten, because a rewrite is a failure it is designed ' +
      'to catch. Each is strong exactly where the other is weak, and a provenance system ' +
      'that wanted both would carry both.',
    ]),
    // The quotation and the caution that qualifies it travel together or not at all: a
    // sourced claim shown without the note narrowing it would be the one place on this
    // page where the short route said more than it can support. Both are lab-depth.
    labOnly(el('p', {}, [
      'That is not this page’s opinion. C2PA’s own Security Considerations document says ' +
      'it outright: "C2PA does not offer any protection against the complete removal of ' +
      'C2PA manifests from assets", and points implementers at soft bindings and manifest ' +
      'repositories for that case. The specification’s term for the other half of the pair ' +
      'is a soft binding — defined as a content identifier that is either not ' +
      'statistically unique, such as a fingerprint, or embedded as an invisible watermark ' +
      'in the identified digital content. The standard that does the cryptography names ' +
      'the watermark as the answer to the one failure the cryptography cannot address.',
    ])),
    labOnly(el('p', { class: 'note' }, [
      'A caution about that quotation, since precision is the point of this page: the ' +
      'specification does not use the phrase "statistical watermark", and its ' +
      '"not statistically unique" qualifier attaches to the fingerprint branch, not the ' +
      'watermark branch. "Statistical watermarking" is this lab’s name for the mechanism ' +
      'in the table above, not a term borrowed from C2PA.',
    ])),
    el('p', {}, [
      'The mistake this page exists to prevent is not choosing wrongly between them — it ' +
      'is reading either one as an answer to "did a human write this, and is it true?"',
    ]),
  ], provenanceTag('paper', 'C2PA 2.4 §2.3.13, §9.1, Security Considerations §2.3')));

  root.append(demoOnly(renderDemoScope()));
  root.append(demoOnly(renderBranchPanel()));
}

/* ---------------------------------------------------------------------------------------
   The compact comparison: the short route's version of the same four claims.
   --------------------------------------------------------------------------------------- */

function compactRows(): ComparisonRow[] {
  return COMPACT_IDS
    .map((id) => BY_ID.get(id))
    .filter((row): row is ComparisonRow => row !== undefined);
}

/**
 * One question as a card rather than a table row.
 *
 * Four questions across three mechanisms is a small enough grid that a card reads in one
 * pass and needs no horizontal scrolling at any width, which is the whole reason the short
 * route does not simply show the first four rows of the audit table.
 */
function compactCard(row: ComparisonRow): HTMLElement {
  const dl = el('dl');
  for (const mechanism of MECHANISMS) {
    const cell = row[mechanism.key];
    dl.append(
      el('dt', { text: mechanism.label }),
      el('dd', { class: cell.tone, text: cell.text }),
    );
  }

  // Built on the panel and readout the rest of the page already uses, with the card's own
  // classes layered on top as the hook for its typography. A card that carries its own
  // layout from the first render cannot arrive in front of an audience unstyled.
  const card = el('div', {
    class: row.loadBearing ? 'panel compare-card compare-card-lead' : 'panel compare-card',
  }, [
    el('div', { class: 'panel-title compare-card-question', text: row.question }),
    // Same role trick as `readout()`: an aria-label on a bare div is discarded, so the
    // group takes a real role to carry the question it answers.
    el('div', {
      class: 'readout compare-card-answers',
      role: 'group',
      'aria-label': row.question,
    }, [dl]),
  ]);

  // Only the load-bearing card carries its argument, because the short route is meant to
  // be four statements and one reason, not four disclosures a presenter has to skip.
  if (row.loadBearing) {
    card.append(disclosure('Why this is the load-bearing question', () => [
      el('p', { class: 'note', text: row.detail }),
    ]));
  }
  return card;
}

function renderCompactComparison(): HTMLElement {
  return panel('Three mechanisms, four questions', [
    el('p', { class: 'note' }, [
      'The first question is the load-bearing one. It is what turns "watermark versus ' +
      'signature" from a taxonomy into a consequence.',
    ]),
    el('div', { class: 'grid compare-cards' }, compactRows().map(compactCard)),
    // Restated at the precision of the row it closes, which the shorter version dropped:
    // "only the issuer" is what holding the configuration means IN PRODUCTION, and this
    // page has just spent eighty seconds letting a visitor who is nobody's issuer check a
    // watermark — because the configuration is published here. The line the audience
    // repeats afterwards must be the one their own first beat did not falsify.
    consequence('Asked who can verify',
      'a watermark needs the secret configuration; a signature needs only the public key.'),
  ], provenanceTag('paper', 'the same rows as the full table, sourced in the references'));
}

/* ---------------------------------------------------------------------------------------
   The full comparison: ten questions, and one mechanism column at a time on a phone.
   --------------------------------------------------------------------------------------- */

interface FocusState {
  focus: Focus;
  narrow: boolean;
  /**
   * The ids whose explanation is open. Held here rather than in the DOM because the DOM is
   * thrown away: choosing a mechanism column rebuilds the table, and these are the two
   * controls a presenter uses together in the payoff beat — a reader who opened three rows
   * to talk through them has not asked for them to shut again underneath the next click.
   */
  readonly open: Set<string>;
}

const FOCUS_OPTIONS: readonly { readonly focus: Focus; readonly label: string }[] = [
  { focus: 'all', label: 'Show all three' },
  { focus: 'watermark', label: 'Focus: watermark' },
  { focus: 'signature', label: 'Focus: signature' },
  { focus: 'c2pa', label: 'Focus: c2pa' },
];

/**
 * The segmented control over the mechanism columns.
 *
 * `role="group"` rather than a bare div for the same reason `readout()` documents, and the
 * selection is announced by `aria-pressed` and shown by a fill, a weight and a glyph — a
 * tinted segment alone would be a colour carrying state on its own.
 */
function mechanismSwitch(state: FocusState, onChange: () => void): {
  node: HTMLElement;
  paint: () => void;
} {
  const status = srOnly('');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const options = FOCUS_OPTIONS.map(({ focus, label }) => {
    const glyph = el('span', { class: 'mechanism-switch-glyph', 'aria-hidden': 'true' });
    const node = el('button', {
      type: 'button', class: 'mechanism-switch-option',
    }, [glyph, label]);
    node.addEventListener('click', () => {
      state.focus = focus;
      // The control has to be repainted here as well as by the width watcher. Without it
      // the table moves to the chosen column while the segments still show — and tell a
      // screen reader through `aria-pressed` — whichever mechanism the panel opened on.
      paint();
      onChange();
      // On a narrow viewport this choice replaces the table rather than tinting it, and a
      // change that large is worth saying to someone who cannot see it happen.
      status.textContent = `${label} selected.`;
    });
    return { focus, node, glyph };
  });

  const paint = (): void => {
    for (const option of options) {
      const selected = option.focus === state.focus;
      option.node.setAttribute('aria-pressed', String(selected));
      option.glyph.textContent = selected ? '●' : '○';
    }
  };

  const node = el('div', {
    class: 'mechanism-switch',
    role: 'group',
    'aria-label': 'Mechanism column',
  }, [...options.map((option) => option.node), status]);

  return { node, paint };
}

/**
 * One comparison row and the explanation it can be asked for.
 *
 * The explanation is built with the row and hidden, rather than built on first open: it is
 * the sourced part of the argument, and text that only exists after a click is text a
 * find-in-page cannot reach and a printed page loses.
 */
function comparisonRow(
  row: ComparisonRow,
  columns: readonly MechanismColumn[],
  focusClass: (key: Mechanism) => string,
  opened: Set<string>,
): HTMLElement[] {
  const detailId = `compare-detail-${row.id}`;
  const chevron = el('span', { class: 'compare-chevron', 'aria-hidden': 'true' });
  const toggle = el('button', { type: 'button', class: 'compare-why' }, [
    el('span', { class: 'compare-question', text: row.question }),
    chevron,
  ]);
  // The visible label is the question, so the question is the trigger; the accessible name
  // adds what expanding it does, which a reader who cannot see the chevron has no other
  // way to learn. WCAG 2.5.3 is satisfied because the visible string is contained in it.
  toggle.setAttribute('aria-controls', detailId);
  toggle.setAttribute('aria-label', `Why: ${row.question}`);

  const detailRow = el('tr', { class: 'compare-detail-row' }, [
    el('td', { colspan: String(columns.length + 1), id: detailId }, [
      el('p', { class: 'note', text: row.detail }),
    ]),
  ]);

  // The row is built into whichever state it was left in, so a rebuild is invisible to a
  // reader who has one open. Three places say the same thing, because three audiences read
  // it: the attribute for a screen reader, the hidden row for everyone, the chevron.
  const paint = (): void => {
    const open = opened.has(row.id);
    toggle.setAttribute('aria-expanded', String(open));
    detailRow.hidden = !open;
    chevron.textContent = open ? '▾' : '▸';
  };
  paint();

  toggle.addEventListener('click', () => {
    if (opened.has(row.id)) opened.delete(row.id);
    else opened.add(row.id);
    paint();
  });

  const tr = el('tr', row.loadBearing ? { class: 'load-bearing' } : {});
  tr.append(el('th', { scope: 'row' }, [toggle]));
  for (const column of columns) {
    const cell = row[column.key];
    const classes = `${cell.tone} ${focusClass(column.key)}`.trim();
    tr.append(el('td', { class: classes, text: cell.text }));
  }
  return [tr, detailRow];
}

function renderComparison(): HTMLElement {
  const media = window.matchMedia(NARROW_QUERY);
  // A phone opens on one mechanism. "Show all three" stays available, but it becomes a
  // request rather than the state a narrow viewport starts in.
  const state: FocusState = {
    focus: media.matches ? 'watermark' : 'all',
    narrow: media.matches,
    open: new Set<string>(),
  };
  const table = el('table', { class: 'compare-table' });

  const visibleColumns = (): readonly MechanismColumn[] =>
    state.narrow && state.focus !== 'all'
      ? MECHANISMS.filter((mechanism) => mechanism.key === state.focus)
      : MECHANISMS;

  const build = (): void => {
    clear(table);
    const columns = visibleColumns();
    // Focus tints the chosen column rather than fading the others. Fading would drop the
    // unfocused text below the contrast floor and hide the comparison the table is for; a
    // tint marks the choice without taking anything away. Where only one column is
    // rendered there is nothing left to distinguish it from, so nothing is tinted.
    const focusClass = (key: Mechanism): string =>
      state.focus === key && columns.length > 1 ? 'compare-focus' : '';

    const head = el('tr', {}, [el('th', { scope: 'col', text: 'Question' })]);
    for (const column of columns) {
      head.append(el('th', {
        scope: 'col', class: focusClass(column.key), text: column.label,
      }));
    }
    table.append(el('thead', {}, [head]));

    const body = el('tbody');
    for (const row of ROWS) {
      body.append(...comparisonRow(row, columns, focusClass, state.open));
    }
    table.append(body);
  };

  const control = mechanismSwitch(state, () => build());

  const onWidthChange = (): void => {
    state.narrow = media.matches;
    if (state.narrow && state.focus === 'all') state.focus = 'watermark';
    control.paint();
    build();
  };
  media.addEventListener('change', onWidthChange);
  detachWidthWatch = () => media.removeEventListener('change', onWidthChange);

  control.paint();
  build();

  return panel('Three mechanisms, ten questions', [
    el('p', { class: 'note' }, [
      'The second row is the load-bearing one. It is what turns "watermark versus ' +
      'signature" from a taxonomy into a consequence. Every question expands into the ' +
      'reasoning behind its answer.',
    ]),
    control.node,
    scroller('Mechanism comparison', [table]),
  ], provenanceTag('paper', 'sourced in the references section'));
}

/* ---------------------------------------------------------------------------------------
   Stripping and regeneration, side by side.

   Two different failures that are routinely described in the same breath. Same page, same
   assets, both measured — and both re-runnable, because a presenter who has watched this
   panel fail on a conference network needs a way back that is not a reload.
   --------------------------------------------------------------------------------------- */

function renderStripVsRegenerate(): HTMLElement {
  const strip = liveRegion('Stripping result');
  const regen = liveRegion('Regeneration result');
  const stripProgress = el('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });
  const regenProgress = el('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });

  const runStrip = async (): Promise<void> => {
    // The same written cause Acts V and VI give. Without it this region answers a lab
    // opened over plain http:// with "Cannot read properties of undefined (reading
    // 'generateKey')" — a V8 internal string, in the one place a reader needs plain words.
    requireWebCrypto();
    clear(strip);
    const asset = encodeUtf8(texts.samples.watermarked.text);
    const keys = await generateSignerKeyPair();
    const signed = await signManifest(
      await buildManifest(asset, [{
        label: 'stds.schema-org.CreativeWork',
        data: { '@type': 'CreativeWork', author: [{ name: 'A. Cataloguer' }] },
      }], {
        claimGenerator: 'crypto-lab-token-tell/0.1.0',
        format: 'text/plain',
        instanceId: 'urn:uuid:2f9c5f10-0000-4000-8000-746f6b656e74',
      }),
      keys, 'Demo signer (session key)');

    const before = await validateManifest(signed, asset);
    const after = await validateManifest(null, asset);
    const digest = await sha256Hex(asset);

    strip.append(
      verdict('none', 'Nothing left to verify', after.summary),
      readout([
        ['Before: signature verifies', before.signatureValid ? 'yes' : 'no'],
        ['Before: binding matches', before.bindingValid ? 'yes' : 'no'],
        ['After: manifest present', after.manifestPresent ? 'yes' : 'no'],
        ['Asset bytes before', integer(asset.byteLength)],
        ['Asset bytes after', integer(after.actualAssetLength)],
        ['Asset digest before and after', 'identical'],
      ], 'Stripping measurements'),
      el('p', { class: 'hash', text: digest }),
      el('p', { class: 'note' }, [
        'The file did not change at all. Not one byte. What changed is that it is now ' +
        'unmarked — and an unmarked file is indistinguishable from one that never had ' +
        'provenance in the first place.',
      ]),
      consequence('Removed the manifest', 'there was nothing left to verify.'),
    );
  };

  const runRegen = (): void => {
    clear(regen);
    const tok = tokenizer();
    const paraphrase = attacks.transformations.find((t) => t.id === 'paraphrase')
      ?? attacks.transformations[0];
    const before = scoreTokens(tok.encode(paraphrase.original_text), watermarkParams,
      defaultConstruction, GPT2_EOS);
    const after = scoreTokens(tok.encode(paraphrase.transformed_text), watermarkParams,
      defaultConstruction, GPT2_EOS);
    const threshold = thresholdForLength(after.tokenCount);
    const survived = after.score !== null && threshold.value !== null
      && after.score >= threshold.value;

    regen.append(
      verdict(survived ? 'caution' : 'none',
        survived ? 'Evidence survived the rewrite' : 'Evidence did not survive the rewrite',
        survived
          ? 'The rewrite left enough of the keyed choices in place to clear the threshold.'
          : 'The bytes changed, no manifest was ever involved, and the statistical evidence ' +
            'in the token choices did not survive the rewriting.'),
      readout([
        ['Score before', fixed(before.score)],
        ['Score after', fixed(after.score)],
        ['Threshold at FPR 1%', fixed(threshold.value ?? Number.NaN)],
        ['Tokens before', integer(before.tokenCount)],
        ['Tokens after', integer(after.tokenCount)],
        ['Scored positions after', integer(after.scoredPositions)],
        ['Transformation', paraphrase.name],
      ], 'Regeneration measurements'),
      el('p', { class: 'note' }, [
        'Nothing was removed from this text. It was rewritten, and the words that carried ' +
        'the evidence are gone because the words are gone. There was never a manifest here ' +
        'to strip.',
      ]),
      // The closure line is written from the measurement rather than beside it, so it
      // cannot end up asserting the opposite of the numbers above it.
      consequence('Rewrote the same claim in new words', survived
        ? 'enough keyed choices survived to clear the threshold.'
        : 'the evidence went with the words that carried it.'),
    );
  };

  // This panel holds nothing a visitor can edit, so re-running from the pinned inputs is
  // both the measurement and the reset. The two halves are guarded separately because they
  // fail separately: WebCrypto is unavailable outside a secure context and the scorer is
  // not, and a signing failure must not blank a regeneration result that is still true.
  const rerun = resetButton('Reset and re-run both', () => { void runBoth(); });

  async function runBoth(): Promise<void> {
    await Promise.all([
      runGuarded(runStrip, {
        // One control, one owner. The guard snapshots each control's state on entry and
        // restores it on exit, so two concurrent runs over the same button record two
        // snapshots — `[false]` for whichever entered first, `[true]` for the other — and
        // whichever finishes LAST decides. Today the scoring half is synchronous and the
        // order happens to end enabled; the day it gains an await, "Reset and re-run both"
        // would be left switched off with no way back but a global reset. So the signing
        // half owns the button for the whole run and the scoring half claims nothing.
        controls: [rerun],
        region: strip,
        progress: stripProgress,
        busyText: 'Signing, then removing the manifest…',
      }),
      runGuarded(runRegen, {
        controls: [],
        region: regen,
        progress: regenProgress,
        busyText: 'Scoring the rewrite…',
      }),
    ]);
  }

  void runBoth();

  return panel('Two different failures', [
    el('p', { class: 'note' }, [
      'Stripping and regeneration get described in the same breath and they are not the ' +
      'same thing. Same page, same assets, both measured.',
    ]),
    el('div', { class: 'grid grid-2' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-title', text: 'STRIPPING · remove the manifest' }),
        el('p', { class: 'note' }, [
          'The verification material is gone. The file is unchanged and now unmarked.',
        ]),
        stripProgress,
        strip,
      ]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-title', text: 'REGENERATION · rewrite the text' }),
        el('p', { class: 'note' }, [
          'The bytes change. The manifest was never there. The statistical evidence in ' +
          'token choices is altered by rewriting.',
        ]),
        regenProgress,
        regen,
      ]),
    ]),
    el('div', { class: 'controls' }, [rerun]),
  ], provenanceTag('demo', 'both measured live'));
}

/* ---------------------------------------------------------------------------------------
   The end of the short route: what it did not claim, and where to go next.
   --------------------------------------------------------------------------------------- */

/**
 * A link out of the short route.
 *
 * Every destination below is lab-depth and therefore `hidden` while Demo mode is on, so a
 * bare fragment would land on nothing. It keeps a real `href` all the same: that is what
 * makes it openable in a new tab and what a page with no script would still follow. The
 * handler exists only so an ordinary click changes depth in place rather than reloading
 * the page the audience is already looking at.
 */
function labLink(anchor: string, className: string, children: (Node | string)[]): HTMLElement {
  const url = new URL(window.location.href);
  url.searchParams.set('mode', 'lab');
  url.hash = `#${anchor}`;
  const link = el('a', { class: className, href: url.href }, children);
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    goToLab(anchor);
  });
  return link;
}

interface Branch {
  readonly question: string;
  readonly anchor: string;
  readonly destination: string;
}

const BRANCHES: readonly Branch[] = [
  {
    question: 'How does the hidden token choice work?',
    anchor: 'act-1',
    destination: 'Act I · the tournament, one layer at a time',
  },
  {
    question: 'How do I read the detector?',
    anchor: 'act-2',
    destination: 'Act II · tokens, g-values, and the null it is compared against',
  },
  {
    question: 'How robust is it?',
    anchor: 'act-3',
    destination: 'Acts III and IV · entropy, then live attacks',
  },
  {
    question: 'Can I verify the claims?',
    anchor: 'reference',
    destination: 'Reference · limitations, the maths, test vectors and sources',
  },
];

function renderBranchPanel(): HTMLElement {
  // The question is the link and the destination is a note beneath it, rather than two
  // spans inside one anchor: the accessible name stays the question a listener asked, and
  // the two lines read as two lines without waiting for a stylesheet to separate them.
  const items = BRANCHES.map((branch) => el('li', { class: 'branch-item' }, [
    labLink(branch.anchor, 'branch-link', [branch.question]),
    el('p', { class: 'note branch-destination', text: branch.destination }),
  ]));

  const node = panel('Choose the depth', [
    el('p', { class: 'note' }, [
      'The short route ends here. Each of these opens the full lab at the act that ' +
      'answers it — the same page at more depth, not a different set of experiments.',
    ]),
    el('ul', { class: 'branch-list', role: 'list' }, items),
  ]);
  node.id = 'branch-depth';
  // No `.branch-panel` class any more. It existed for one rule — the
  // `scroll-margin-top` that cleared the two sticky bars — and that clearance
  // now lives once on the scrollport as `:root { scroll-padding-top }`, which
  // reaches every jump target without being told about any of them. Leaving
  // the class behind would leave a hook the stylesheet never mentions, and the
  // next reader would have to grep the sheet to find that out.
  return node;
}

/**
 * The short route's own scope note.
 *
 * Demo mode hides the reference section, and a shorter page must not become a page that
 * reads as though the caveats were dropped along with the detail. Four lines, and a way to
 * the full list in one action.
 *
 * Two of those lines exist because the short route makes claims whose qualifications only
 * the lab was carrying. It tells a visitor that a watermark can only be checked by a holder
 * of the configuration — while they have just checked one, which is possible solely because
 * this repository publishes its configuration. And it shows a single wrong key as the whole
 * key argument, where the lab scores three hundred. Neither is a new claim; both are facts
 * the app already computes, said where the shorter reading needs them.
 */
function renderDemoScope(): HTMLElement {
  return panel('What this demo does not claim', [
    el('p', { class: 'note' }, [
      'Neither mechanism shown here establishes that a person wrote something, and ' +
      'neither answers whether what it says is true.',
    ]),
    el('p', { class: 'note' }, [
      'The manifest on this page is C2PA-shaped rather than conformant, and the detector ' +
      'is this lab’s implementation of a published algorithm — the mean g-score, not the ' +
      'learned detector the paper’s headline results use, and not any vendor’s.',
    ]),
    el('p', { class: 'note' }, [
      'The watermark configuration is published in this repository, which is the only ' +
      'reason you can check this mark here; in production it is the issuer’s secret. And ' +
      'this route shows one wrong key — the full lab scores the same bytes under up to 300.',
    ]),
    el('p', { class: 'note' }, [
      'The complete list of limitations, the divergences from both reference ' +
      'implementations and every source are in ',
      labLink('reference', 'branch-inline', ['the reference section']),
      '.',
    ]),
  ], provenanceTag('demo', 'scope of the short route'));
}
