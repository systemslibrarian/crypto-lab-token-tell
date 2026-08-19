/**
 * Act VII — what each mechanism actually proves.
 *
 * The structural distinction first, because it explains every row of the table that
 * follows, and then the two failure modes side by side as an experiment rather than as
 * prose.
 *
 * No "watermark bad, signature good". These mechanisms solve different problems, and the
 * table is arranged so that neither column wins.
 */

import attacks from '../data/pinned/attacks.json';
import texts from '../data/pinned/texts.json';
import { buildManifest, encodeUtf8, sha256Hex } from '../c2pa/manifest.ts';
import { generateSignerKeyPair, signManifest } from '../c2pa/sign.ts';
import { validateManifest } from '../c2pa/validate.ts';
import { defaultConstruction, tokenizer, watermarkParams } from '../lab-config.ts';
import { scoreTokens } from '../watermark/score.ts';
import {
  actHeader, button, clear, el, fixed, integer, liveRegion, panel, provenanceTag, readout,
  scroller, verdict,
} from './dom.ts';
import { thresholdForLength } from './score-card.ts';

const GPT2_EOS = 50256;

interface ComparisonRow {
  readonly question: string;
  readonly watermark: { text: string; tone: 'yes' | 'no' | 'partial' };
  readonly signature: { text: string; tone: 'yes' | 'no' | 'partial' };
  readonly c2pa: { text: string; tone: 'yes' | 'no' | 'partial' };
  readonly detail: string;
  readonly loadBearing?: boolean;
}

const ROWS: ComparisonRow[] = [
  {
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
    question: 'Can metadata or manifest removal eliminate the verification material?',
    watermark: { text: 'no — there is no manifest to strip', tone: 'yes' },
    signature: { text: 'yes — drop the signature and nothing verifies', tone: 'no' },
    c2pa: { text: 'yes — a stripped manifest leaves no provenance', tone: 'no' },
    detail:
      'The strongest thing the watermark has over the signature, and the reason the two ' +
      'are complementary rather than competing.',
  },
  {
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
    question: 'Can it identify a signer?',
    watermark: { text: 'no — it identifies a configuration, not a person', tone: 'no' },
    signature: { text: 'yes — relative to a key', tone: 'yes' },
    c2pa: { text: 'yes — relative to a certified identity', tone: 'yes' },
    detail:
      'A watermark score says the text is correlated with a key. Who held that key, and ' +
      'whether they are who they say they are, is outside what the mechanism can answer.',
  },
  {
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
    question: 'Does it prove the content is factually true?',
    watermark: { text: 'no', tone: 'no' },
    signature: { text: 'no', tone: 'no' },
    c2pa: { text: 'no', tone: 'no' },
    detail:
      'Act VI signed a plainly false statement with a real key and verified it. No ' +
      'mechanism on this page answers a question about the world.',
  },
];

export function renderAct7(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-7',
    'Act VII',
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

  root.append(renderComparison());
  root.append(renderStripVsRegenerate());

  root.append(panel('Neither of these is the good one', [
    el('p', {}, [
      'A watermark survives having its metadata stripped, because there is no metadata. A ' +
      'signature survives being rewritten, because a rewrite is a failure it is designed ' +
      'to catch. Each is strong exactly where the other is weak, and a provenance system ' +
      'that wanted both would carry both.',
    ]),
    el('p', {}, [
      'That is not this page’s opinion. C2PA’s own Security Considerations document says ' +
      'it outright: "C2PA does not offer any protection against the complete removal of ' +
      'C2PA manifests from assets", and points implementers at soft bindings and manifest ' +
      'repositories for that case. The specification’s term for the other half of the pair ' +
      'is a soft binding — defined as a content identifier that is either not ' +
      'statistically unique, such as a fingerprint, or embedded as an invisible watermark ' +
      'in the identified digital content. The standard that does the cryptography names ' +
      'the watermark as the answer to the one failure the cryptography cannot address.',
    ]),
    el('p', { class: 'note' }, [
      'A caution about that quotation, since precision is the point of this page: the ' +
      'specification does not use the phrase "statistical watermark", and its ' +
      '"not statistically unique" qualifier attaches to the fingerprint branch, not the ' +
      'watermark branch. "Statistical watermarking" is this lab’s name for the mechanism ' +
      'in the table above, not a term borrowed from C2PA.',
    ]),
    el('p', {}, [
      'The mistake this page exists to prevent is not choosing wrongly between them — it ' +
      'is reading either one as an answer to "did a human write this, and is it true?"',
    ]),
  ], provenanceTag('paper', 'C2PA 2.4 §2.3.13, §9.1, Security Considerations §2.3')));
}

function renderComparison(): HTMLElement {
  const highlight = { column: 'all' as 'all' | 'watermark' | 'signature' | 'c2pa' };
  const table = el('table', { class: 'compare-table' });

  const build = () => {
    clear(table);
    // Focus tints the chosen column rather than fading the others. Fading would drop
    // the unfocused text below the contrast floor and hide the comparison the table is
    // for; a tint marks the choice without taking anything away.
    const dim = (column: string) =>
      highlight.column !== 'all' && highlight.column === column
        ? 'background:color-mix(in oklab,var(--accent) 14%,transparent)'
        : '';
    table.append(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Question' }),
      el('th', { style: dim('watermark'), text: 'Statistical watermarking' }),
      el('th', { style: dim('signature'), text: 'Digital signatures' }),
      el('th', { style: dim('c2pa'), text: 'C2PA provenance' }),
    ])]));
    const body = el('tbody');
    ROWS.forEach((row, index) => {
      const tr = el('tr', row.loadBearing ? { class: 'load-bearing' } : {});
      tr.append(
        el('th', { scope: 'row', text: row.question }),
        el('td', { class: row.watermark.tone, style: dim('watermark'), text: row.watermark.text }),
        el('td', { class: row.signature.tone, style: dim('signature'), text: row.signature.text }),
        el('td', { class: row.c2pa.tone, style: dim('c2pa'), text: row.c2pa.text }),
      );
      body.append(tr);
      const detailId = `compare-detail-${index}`;
      const detailRow = el('tr');
      const cell = el('td', { colspan: '4', id: detailId });
      const toggle = button(`Why · ${row.question}`, () => {
        const open = cell.hasChildNodes();
        clear(cell);
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        if (!open) cell.append(el('p', { class: 'note', text: row.detail }));
      });
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', detailId);
      toggle.textContent = 'Why?';
      toggle.setAttribute('aria-label', `Why: ${row.question}`);
      const toggleRow = el('tr', {}, [el('td', { colspan: '4' }, [toggle])]);
      body.append(toggleRow, detailRow);
      detailRow.append(cell);
    });
    table.append(body);
  };

  const buttons = (['all', 'watermark', 'signature', 'c2pa'] as const).map((column) =>
    button(column === 'all' ? 'Show all three' : `Focus: ${column}`, () => {
      highlight.column = column;
      build();
    }));

  build();
  return panel('Three mechanisms, ten questions', [
    el('p', { class: 'note' }, [
      'The second row is the load-bearing one. It is what turns "watermark versus ' +
      'signature" from a taxonomy into a consequence.',
    ]),
    el('div', { class: 'controls' }, buttons),
    scroller('Mechanism comparison', [table]),
  ], provenanceTag('paper', 'sourced in the references section'));
}

/**
 * Stripping and regeneration, side by side.
 *
 * Two different failures that are routinely described in the same breath. Same page, same
 * assets, both measured.
 */
function renderStripVsRegenerate(): HTMLElement {
  const strip = liveRegion('Stripping result');
  const regen = liveRegion('Regeneration result');

  const runStrip = async () => {
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
    );
  };

  const runRegen = () => {
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
    );
  };

  void runStrip();
  runRegen();

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
        strip,
      ]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-title', text: 'REGENERATION · rewrite the text' }),
        el('p', { class: 'note' }, [
          'The bytes change. The manifest was never there. The statistical evidence in ' +
          'token choices is altered by rewriting.',
        ]),
        regen,
      ]),
    ]),
    el('div', { class: 'controls' }, [
      button('Re-run both', () => { void runStrip(); runRegen(); }),
    ]),
  ], provenanceTag('demo', 'both measured live'));
}
