/**
 * Acts V and VI — sign the same text, then sign a lie.
 *
 * Real ECDSA P-256 through WebCrypto, over a C2PA-SHAPED manifest. The contrast with the
 * watermark half of the page is the whole point: this evidence is binary, it survives no
 * amount of editing, and removing it leaves nothing behind rather than something weakened.
 *
 * This is also the act a presenter is most likely to leave broken, because breaking it is
 * the demonstration. So every state it can reach has a way back that does not involve a
 * reload: the controls that break a manifest are switched off until there is a manifest to
 * break, every run is guarded so a WebCrypto failure is answered on the page instead of by
 * a permanently dead button, and one press restores the shipped text and a fresh signature.
 *
 * Each run also closes with a line saying what was changed and what that did, read off the
 * validation result rather than off the button that was pressed. The two are not the same
 * thing: flipping the same byte twice puts it back, and a story told from the button would
 * then announce a failure the page is not showing.
 */

import texts from '../data/pinned/texts.json';
import {
  buildManifest, canonicalize, encodeUtf8, sha256Hex,
} from '../c2pa/manifest.ts';
import type { Assertion, Manifest } from '../c2pa/manifest.ts';
import { generateSignerKeyPair, signManifest } from '../c2pa/sign.ts';
import type { KeyPairMaterial } from '../c2pa/sign.ts';
import { validateManifest } from '../c2pa/validate.ts';
import type { ValidationResult } from '../c2pa/validate.ts';
import { resetButton, runGuarded } from './busy.ts';
import {
  actHeader, button, clear, consequence, disclosure, el, integer, liveRegion, panel,
  provenanceTag, readout, scroller, verdict,
} from './dom.ts';
import { param, setParam } from './mode.ts';

const CLAIM_OPTIONS = {
  claimGenerator: 'crypto-lab-token-tell/0.1.0',
  format: 'text/plain',
  instanceId: 'urn:uuid:2f9c5f10-0000-4000-8000-746f6b656e74',
};

const ACT_5 = 'act-5';
const ACT_6 = 'act-6';

/** The two mutated states a link can honestly restore. Absent means signed and intact. */
const SIGN_PARAM = 'sign';
type Mutation = 'tampered' | 'stripped';

const SIGNING = 'Signing with ECDSA P-256…';
const RECHECKING = 'Re-checking the manifest against the asset…';

/**
 * A cold load may ask for a mutated state; a re-render must not honour the same request.
 * main.ts rebuilds every act for the global reset, and reading the parameter again there
 * would make the reset restore precisely the tampering it was pressed to undo.
 */
let coldMountAct5 = true;
let coldMountAct6 = true;

function defaultAssertions(): Assertion[] {
  return [
    {
      label: 'stds.schema-org.CreativeWork',
      data: {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        author: [{ '@type': 'Person', name: 'A. Cataloguer' }],
        dateCreated: '2026-08-19',
      },
    },
    {
      label: 'c2pa.actions',
      data: { actions: [{ action: 'c2pa.created', softwareAgent: 'crypto-lab-token-tell' }] },
    },
  ];
}

/**
 * WebCrypto is not always there. `crypto.subtle` exists only in a secure context, so a lab
 * opened from a file share or over plain http:// on a projector laptop loses the whole
 * signing half of the page — and the browser's own message for it names a property, not a
 * cause. Failing early with the cause spelled out is the difference between a presenter
 * recovering in one sentence and a presenter apologising.
 */
function requireWebCrypto(): void {
  if (globalThis.crypto?.subtle) return;
  throw new Error(
    'This browser gave the page no WebCrypto. crypto.subtle exists only in a secure ' +
    'context, so the lab cannot sign anything when it is served over plain http:// from ' +
    'anything other than localhost. The same files over https:// restore this act.',
  );
}

/**
 * The effect half of the closing line. Three outcomes, told apart the way the act tells
 * them apart: no manifest is not a failed verification, and a failed verification is not
 * an absent one.
 */
function effectOf(result: ValidationResult): string {
  if (!result.manifestPresent) return 'there was nothing left to verify.';
  return result.valid ? 'integrity verification passed.' : 'integrity verification failed.';
}

/**
 * Keep the address bar on the beat being shown, so the share control copies a link that
 * opens where the audience is looking. `replaceState` rather than assigning to
 * `location.hash`, which scrolls: a presenter pressing a button inside the panel they are
 * already looking at has not asked to be moved.
 */
function markAnchor(id: string): void {
  const url = new URL(window.location.href);
  if (url.hash === `#${id}`) return;
  url.hash = `#${id}`;
  window.history.replaceState(window.history.state, '', url);
}

/**
 * The other half of the deep link. A cold load addressed at this act arrives before the
 * signature exists and before the acts above have finished growing, so the browser's own
 * jump lands somewhere that stops being the act a moment later. Repeating the jump once
 * the beat is on screen is what makes `?mode=demo#act-5` open on the beat.
 */
function honourAnchor(id: string): void {
  if (window.location.hash !== `#${id}`) return;
  const target = document.getElementById(id);
  if (!target) return;
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

function requestedMutation(): Mutation | null {
  const requested = param(SIGN_PARAM);
  return requested === 'tampered' || requested === 'stripped' ? requested : null;
}

export function renderAct5(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-5',
    'Act V',
    'Sign the same text',
    'The same words that carried a statistical watermark, now carrying a signature. One ' +
    'byte decides this one, and there is no threshold anywhere in it.',
  ));

  const original = texts.samples.watermarked.text.slice(0, 400).trim();

  const assetInput = el('textarea', {
    id: 'sign-asset',
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  assetInput.value = original;

  const progress = el('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });
  const status = liveRegion('Signature status');
  const manifestView = el('div');

  const state: {
    keys: KeyPairMaterial | null;
    manifest: Manifest | null;
    asset: Uint8Array;
    signed: boolean;
  } = { keys: null, manifest: null, asset: encodeUtf8(original), signed: false };

  let manifestOpen = false;

  const renderManifest = (): void => {
    clear(manifestView);
    const manifest = state.manifest;
    if (!manifest) return;
    // Behind a disclosure so the verdict is what the panel leads with, but built eagerly
    // and one press from open: a body that exists only after somebody has asked for it is
    // a body nothing can quote, and this one is the evidence for everything above it.
    const view = disclosure('Show the signed manifest', () => [
      scroller('C2PA-shaped manifest', [
        el('pre', { class: 'mono', text: JSON.stringify(manifest, null, 2) }),
      ]),
      el('p', { class: 'note' }, [
        'The signature covers the claim only. The claim covers the assertions by hash and ' +
        'the asset by hash, so editing either breaks verification without the signature ' +
        'itself being touched — which the buttons above let you check separately.',
      ]),
    ], { eager: true });
    // Re-signing rebuilds this panel, and a presenter who opened the manifest to talk
    // through it has not asked for it to shut again underneath them.
    if (manifestOpen) view.setAttribute('open', '');
    view.addEventListener('toggle', () => { manifestOpen = view.hasAttribute('open'); });
    manifestView.append(view);
  };

  const showValidation = async (change: string): Promise<void> => {
    const result = await validateManifest(state.manifest, state.asset);
    const tone = !result.manifestPresent ? 'none' : result.valid ? 'evidence' : 'alarm';
    const label = !result.manifestPresent
      ? 'No manifest'
      : result.valid ? 'Verification passed' : 'Verification failed';
    // Emptied only once the replacement is ready: on a projector a panel that blanks and
    // refills reads as a result of its own.
    clear(status);
    status.append(verdict(tone, label, result.summary));
    status.append(consequence(change, effectOf(result)));
    status.append(readout([
      ['Manifest present', result.manifestPresent ? 'yes' : 'no'],
      ['Signature present', result.signaturePresent ? 'yes' : 'no'],
      ['Signature verifies', result.signatureValid ? 'yes' : 'no'],
      ['Hard binding matches the asset', result.bindingValid ? 'yes' : 'no'],
      ['Assertion hashes match', result.assertionChecks.every((c) => c.matches) ? 'yes' : 'no'],
      ['Asset bytes now', integer(result.actualAssetLength)],
      ['Asset bytes when signed',
        result.recordedAssetLength === null ? 'n/a' : integer(result.recordedAssetLength)],
    ], 'Validation detail'));
    status.append(el('dl', { class: 'readout' }, [
      el('dt', { text: 'Recorded asset hash' }),
      el('dd', { class: 'hash', text: result.recordedAssetHash ?? 'n/a' }),
      el('dt', { text: 'Actual asset hash' }),
      el('dd', { class: 'hash', text: result.actualAssetHash ?? 'n/a' }),
    ]));
  };

  const sign = async (): Promise<void> => {
    requireWebCrypto();
    state.asset = encodeUtf8(assetInput.value);
    state.keys = state.keys ?? await generateSignerKeyPair();
    const unsigned = await buildManifest(state.asset, defaultAssertions(), CLAIM_OPTIONS);
    state.manifest = await signManifest(unsigned, state.keys, 'Demo signer (session key)');
    state.signed = true;
    renderManifest();
    await showValidation('Signed these exact bytes');
    setParam(SIGN_PARAM, null);
  };

  const tamperAsset = async (): Promise<void> => {
    const bytes = new Uint8Array(state.asset);
    if (!bytes.length) return;
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    state.asset = bytes;
    assetInput.value = new TextDecoder().decode(bytes);
    await showValidation('Changed one byte');
    // The flip is its own undo, so what the link records is what the bytes say, not how
    // many times the button was pressed.
    setParam(SIGN_PARAM, assetInput.value === original ? null : 'tampered');
  };

  const stripManifest = async (): Promise<void> => {
    state.manifest = null;
    clear(manifestView);
    await showValidation('Removed the manifest');
    setParam(SIGN_PARAM, 'stripped');
  };

  const verifyAgain = async (): Promise<void> => {
    // Re-checking answers "does the manifest still describe what is in the box", so it
    // reads the box: a presenter who has typed in it has changed the asset, and a check
    // that ignored the edit would be reporting on bytes nobody can see.
    state.asset = encodeUtf8(assetInput.value);
    await showValidation('Checked the bytes in the box again');
  };

  const resetAct = async (): Promise<void> => {
    assetInput.value = original;
    state.asset = encodeUtf8(original);
    state.manifest = null;
    clear(manifestView);
    await sign();
  };

  const signIt = button('Sign it', () => {
    markAnchor(ACT_5);
    void perform(sign, SIGNING);
  }, true);
  const flipByte = button('Flip one byte of the asset', () => {
    markAnchor(ACT_5);
    void perform(tamperAsset, RECHECKING);
  });
  const stripIt = button('Strip the manifest', () => {
    markAnchor(ACT_5);
    void perform(stripManifest, 'Re-checking with no manifest present…');
  });
  const verifyIt = button('Verify again', () => {
    markAnchor(ACT_5);
    void perform(verifyAgain, RECHECKING);
  });
  const reset = resetButton('Reset act', () => {
    markAnchor(ACT_5);
    void perform(resetAct, 'Restoring the original text and signing it again…');
  });

  const controls = [signIt, flipByte, stripIt, verifyIt, reset];

  /**
   * Nothing that breaks a manifest is offered before one exists: an audience watching
   * "Flip one byte of the asset" act on a page with no manifest learns the wrong lesson
   * about which failure is which. Re-checking survives a strip, because "there is nothing
   * left to verify" is one of the three outcomes this act exists to tell apart.
   */
  const settleControls = (): void => {
    flipByte.disabled = state.manifest === null;
    stripIt.disabled = state.manifest === null;
    verifyIt.disabled = !state.signed;
  };
  settleControls();

  const perform = async (action: () => Promise<void>, busyText: string): Promise<void> => {
    // The guard restores whatever each control was before the run, which is the right
    // default and the wrong answer here: the run is exactly what decides which of them
    // should now be available. So the settle comes after it, not inside the action.
    await runGuarded(action, { controls, region: status, progress, busyText });
    settleControls();
  };

  for (const node of [flipByte, stripIt, verifyIt]) {
    node.setAttribute('aria-describedby', 'sign-controls-note');
  }

  root.append(panel('Sign, then break it', [
    el('p', { class: 'note' }, [
      'The signing key is generated in this tab and never leaves it. Sign the text, then ' +
      'flip one byte of the asset, or throw the manifest away, and watch which failure is ' +
      'which.',
    ]),
    el('p', { class: 'note', id: 'sign-controls-note' }, [
      'Breaking it and re-checking it stay switched off until a signature exists, and ' +
      '"Reset act" puts the original text and a fresh signature back without reloading ' +
      'the page.',
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'sign-asset', text: 'Asset (the exact bytes that get signed)' }),
      assetInput,
    ]),
    el('div', { class: 'controls' }, controls),
    progress,
    status,
    manifestView,
  ], provenanceTag('demo', 'C2PA-shaped, not conformant')));

  root.append(panel('What this manifest is not', [
    el('p', { class: 'note' }, [
      'This is a C2PA-SHAPED manifest, built to carry the three structural ideas a reader ' +
      'needs: assertions, a claim that binds them by hash, and a hard binding over the ' +
      'asset bytes. It is not conformant. There is no JUMBF container, no COSE claim ' +
      'signature, no certificate chain, no trust-list validation and no Conformance ' +
      'Program status. What it does carry faithfully is the property being taught.',
    ]),
    el('p', { class: 'note' }, [
      'The precise claim a passing verification supports: a valid signature establishes ' +
      'cryptographic integrity and authentication relative to a signer credential and a ' +
      'trust model. Here the trust model is "the public key inside the manifest", which is ' +
      'no trust model at all — a real deployment resolves the signer through certificates ' +
      'and a trust list, and that resolution is exactly what this lab does not implement.',
    ]),
  ], provenanceTag('demo', 'structure only')));

  // The act signs itself on arrival so the page opens on a working example rather than an
  // empty panel, then obeys a link that asked for one of the two mutated states.
  const requested = coldMountAct5 ? requestedMutation() : null;
  const cold = coldMountAct5;
  coldMountAct5 = false;
  void (async () => {
    await perform(sign, SIGNING);
    if (requested === 'tampered') await perform(tamperAsset, RECHECKING);
    else if (requested === 'stripped') await perform(stripManifest, RECHECKING);
    if (cold) honourAnchor(ACT_5);
  })();
}

export function renderAct6(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-6',
    'Act VI',
    'A signature can sign a lie',
    'Compose something plainly false, sign it with the same real key, and verify it. The ' +
    'verification passes, because that is not the question a signature answers.',
  ));

  const original =
    'This document was written by hand in 1687, contains no errors of any kind, and was ' +
    'never touched by a computer.';

  const claimInput = el('textarea', {
    id: 'lie-asset',
    spellcheck: 'false',
    style: 'min-height:6rem',
  }) as HTMLTextAreaElement;
  claimInput.value = original;

  const progress = el('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });
  const status = liveRegion('Signed statement status');
  const detail = el('div');

  let detailOpen = false;

  const signAndVerify = async (): Promise<void> => {
    requireWebCrypto();
    const asset = encodeUtf8(claimInput.value);
    const keys = await generateSignerKeyPair();
    const assertions: Assertion[] = [{
      label: 'stds.schema-org.CreativeWork',
      data: {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        dateCreated: '1687-01-01',
        creditText: 'Written entirely by hand',
      },
    }];
    const manifest = await signManifest(
      await buildManifest(asset, assertions, CLAIM_OPTIONS), keys, 'Demo signer (session key)');
    const result = await validateManifest(manifest, asset);
    const digest = await sha256Hex(asset);

    clear(status);
    status.append(verdict(
      result.valid ? 'alarm' : 'none',
      result.valid ? 'Verification passed — on a false statement' : 'Verification failed',
      'A valid signature proves that the signed bytes are intact and bound to the signing ' +
      'key. It does not prove that the claim inside those bytes is true.',
    ));
    // Only the effect is derived. Whether the statement is false is not something this
    // page can compute — which is the act's entire point, and why the readout below
    // answers the truth question by declining it.
    status.append(consequence('Signed a lie', result.valid
      ? 'integrity passed; truth remained unanswered.'
      : 'integrity failed; truth remained unanswered either way.'));
    status.append(readout([
      ['Signature verifies', result.signatureValid ? 'yes' : 'no'],
      ['Hard binding matches', result.bindingValid ? 'yes' : 'no'],
      ['Assertion hashes match', result.assertionChecks.every((c) => c.matches) ? 'yes' : 'no'],
      ['Statement is true', 'not a question this mechanism can answer'],
      ['Assertion claims creation date', '1687-01-01'],
    ], 'Signed-lie verification'));

    clear(detail);
    const view = disclosure('Show what was signed', () => [
      scroller('Signed claim bytes', [
        el('pre', { class: 'mono', text: canonicalize(manifest.claim) }),
      ]),
      el('p', { class: 'note' }, [
        `Asset digest: ${digest}. The signature is over the canonical claim bytes above, ` +
        'which contain that digest. Everything in the chain is intact. The date in the ' +
        'assertion is still wrong.',
      ]),
    ], { eager: true });
    if (detailOpen) view.setAttribute('open', '');
    view.addEventListener('toggle', () => { detailOpen = view.hasAttribute('open'); });
    detail.append(view);
  };

  const signIt = button('Sign and verify it', () => {
    markAnchor(ACT_6);
    void perform(signAndVerify);
  }, true);
  const reset = resetButton('Reset act', () => {
    markAnchor(ACT_6);
    claimInput.value = original;
    void perform(signAndVerify);
  });

  const controls = [signIt, reset];

  const perform = (action: () => Promise<void>): Promise<void> =>
    runGuarded(action, {
      controls,
      region: status,
      progress,
      busyText: 'Signing the statement and verifying it…',
    });

  root.append(panel('Sign something false', [
    el('div', { class: 'field' }, [
      el('label', { for: 'lie-asset', text: 'A statement to sign' }),
      claimInput,
    ]),
    el('div', { class: 'controls' }, controls),
    progress,
    status,
    detail,
  ], provenanceTag('demo', 'real ECDSA over a false claim')));

  root.append(el('p', { class: 'act-lede' }, [
    'This is not a flaw in signatures. Integrity and truth are different properties, and a ' +
    'mechanism that delivers the first is not defective for failing to deliver the second. ' +
    'The failure would be a reader who takes a green tick as a fact-check — which is ' +
    'exactly the reading that "AI detector" marketing invites for the watermark half of ' +
    'this page too.',
  ]));

  const cold = coldMountAct6;
  coldMountAct6 = false;
  void (async () => {
    await perform(signAndVerify);
    if (cold) honourAnchor(ACT_6);
  })();
}
