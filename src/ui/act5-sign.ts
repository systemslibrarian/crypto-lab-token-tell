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
 * Each run also closes with a line saying what was changed and what that did, both halves
 * read off the validation result rather than off the button that was pressed. The two are
 * not the same thing: flipping the same byte twice puts it back, and a story told from the
 * button would then announce a failure the page is not showing — or, worse, keep claiming
 * a byte was changed while the panel shows the signature verifying again.
 *
 * The same rule governs the two verdicts. Neither act can read a sentence, so neither may
 * say anything about what a sentence means: Act VI calls the shipped 1687 claim a lie
 * because this file wrote it, and says only that verification passed the moment a visitor
 * puts their own words in the box.
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
import { onModeChange, param, setParam } from './mode.ts';

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

/* ---------------------------------------------------------------------------------------
   The reveal a press earns.

   Both acts compute on arrival and arrive complete, and that has to stay true: the deep
   links restore a settled panel, the accessibility gate scans arrival as a finished state,
   and a screenshot of a page still assembling itself proves nothing. But a panel that
   already says what pressing the button will say makes the press itself a no-op — the two
   beats chad's script spends forty seconds on were both pre-played, and pressing "Sign it"
   changed not one character on the page.

   So the sequence exists but nobody performs it unasked. The press arms the stage; the
   mount does not. The staging then happens INSIDE the guarded run, which is what keeps the
   busy text, the aria-busy attribute and the switched-off controls spanning the whole
   reveal instead of the few milliseconds of arithmetic underneath it. Under a reduced
   motion preference there are no timers at all, because the request is for the answer
   rather than for a faster performance of it.
   --------------------------------------------------------------------------------------- */

/** Three parts, so a full reveal takes 600ms — long enough to read, short enough to press
 *  through. The hero's five-beat replay runs to 3.9s; one panel is not that story. */
const REVEAL_STEP_MS = 200;

interface Stage {
  /** A press asks for the sequence. Nothing else does. */
  arm(): void;
  /**
   * Put the parts on screen: at once, or one beat at a time when a press armed it. The
   * waiting line is required rather than optional because the alternative is a region that
   * collapses to an empty box and springs back — the reflow the hero's placeholders exist
   * to stop, and a rendering that reads as a result of its own.
   */
  present(region: HTMLElement, parts: HTMLElement[], waiting: string): Promise<void>;
  /** Land on the finished panel now — half a verdict is the state this must never leave. */
  settle(): void;
  /** Give up the depth subscription, for a render pass that has replaced this act's DOM. */
  stop(): void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function makeStage(): Stage {
  let timers: number[] = [];
  let armed = false;
  let land: (() => void) | null = null;

  const settle = (): void => {
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
    // A reveal that is cut short still has to resolve: the guarded run awaiting it is
    // holding every control in the act switched off until it does.
    const finish = land;
    land = null;
    finish?.();
  };

  // A depth change is not a request to watch the rest of an animation, and it can arrive
  // part-way through one, so it lands the panel on the state the sequence was heading for.
  const detachDepth = onModeChange(settle);

  return {
    arm(): void { armed = true; },
    settle,
    stop(): void { settle(); detachDepth(); },
    present(region: HTMLElement, parts: HTMLElement[], waiting: string): Promise<void> {
      settle();
      const staged = armed && !prefersReducedMotion();
      armed = false;
      // Emptied only once the replacement is ready: on a projector a panel that blanks and
      // refills on its own reads as a result. Here the blank was asked for, and it says so.
      clear(region);
      if (!staged) {
        region.append(...parts);
        return Promise.resolve();
      }
      const placeholder = el('p', { class: 'result-waiting', text: waiting });
      region.append(placeholder);
      return new Promise<void>((resolve) => {
        let next = 0;
        const show = (): void => {
          placeholder.remove();
          region.append(parts[next]);
          next += 1;
        };
        land = (): void => {
          while (next < parts.length) show();
          resolve();
        };
        for (let index = 0; index < parts.length; index += 1) {
          timers.push(window.setTimeout(() => {
            show();
            if (next < parts.length) return;
            timers = [];
            land = null;
            resolve();
          }, (index + 1) * REVEAL_STEP_MS));
        }
      });
    },
  };
}

/**
 * One stage per act, held across renders. main.ts rebuilds both acts for the global reset,
 * and a timer written for the panel that has just been replaced would otherwise put a
 * verdict back into a node that is no longer in the document.
 */
const STAGES = new Map<string, Stage>();

function remountStage(act: string): Stage {
  STAGES.get(act)?.stop();
  const stage = makeStage();
  STAGES.set(act, stage);
  return stage;
}

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
 *
 * Exported because Act VII signs too, and the browser's own message for the same loss —
 * "Cannot read properties of undefined (reading 'generateKey')" — is a V8 internal string
 * in the one place a reader most needs the cause written out.
 */
export function requireWebCrypto(): void {
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
  const stage = remountStage(ACT_5);
  // The numeral is the anchor, the README and the verifier's name for this beat; the noun
  // phrase is the chapter chip standing directly above it. Carrying both is what stops a
  // visitor twenty-five seconds into the short route being told they are at Act V of
  // something whose first four acts the page is not offering them.
  root.append(...actHeader(
    'act-5',
    'Act V · Sign it',
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
  /**
   * The two digests live beside the live region rather than inside it. They are the audit
   * detail a reader goes looking for and never the answer to "what happened when I pressed
   * that": one press of the global reset used to announce this act as a paragraph ending in
   * the same sixty-four hex characters twice, read out one character at a time. On screen
   * they have not moved.
   */
  const hashView = el('div');
  const manifestView = el('div');

  const state: {
    keys: KeyPairMaterial | null;
    manifest: Manifest | null;
    asset: Uint8Array;
    signed: boolean;
    /** The text the result on screen was computed from; null once an edit retired it. */
    verifiedText: string | null;
  } = {
    keys: null, manifest: null, asset: encodeUtf8(original), signed: false, verifiedText: null,
  };

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
    // What the numbers below are about. Recorded here rather than by each caller, because
    // every route to a result comes through this function and none of them may leave the
    // panel claiming a verdict about bytes that are no longer in the box.
    state.verifiedText = assetInput.value;
    clear(hashView);
    await stage.present(status, [
      verdict(tone, label, result.summary),
      consequence(change, effectOf(result)),
      readout([
        ['Manifest present', result.manifestPresent ? 'yes' : 'no'],
        ['Signature present', result.signaturePresent ? 'yes' : 'no'],
        ['Signature verifies', result.signatureValid ? 'yes' : 'no'],
        ['Hard binding matches the asset', result.bindingValid ? 'yes' : 'no'],
        ['Assertion hashes match', result.assertionChecks.every((c) => c.matches) ? 'yes' : 'no'],
        ['Asset bytes now', integer(result.actualAssetLength)],
        ['Asset bytes when signed',
          result.recordedAssetLength === null ? 'n/a' : integer(result.recordedAssetLength)],
      ], 'Validation detail'),
    ], 'Signing, then checking the manifest against these exact bytes…');
    hashView.append(el('div', {
      class: 'readout', role: 'group', 'aria-label': 'Asset digests',
    }, [
      el('dl', {}, [
        el('dt', { text: 'Recorded asset hash' }),
        el('dd', { class: 'hash', text: result.recordedAssetHash ?? 'n/a' }),
        el('dt', { text: 'Actual asset hash' }),
        el('dd', { class: 'hash', text: result.actualAssetHash ?? 'n/a' }),
      ]),
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
    // The flip is its own undo, so both the sentence and the link record what the bytes
    // say rather than how many times the button was pressed. Pressing it twice restores
    // exactly what was signed, and "changed one byte → verification passed" would teach a
    // room that a signature tolerates a one-byte edit — the opposite of what is on screen.
    const restored = assetInput.value === original;
    await showValidation(restored ? 'Put the byte back' : 'Changed one byte');
    setParam(SIGN_PARAM, restored ? null : 'tampered');
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
    // An edit takes the manifest off the page along with the verdict it belonged to. This
    // is the press that answers for the new bytes, so it is the press that puts it back.
    renderManifest();
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
    // The one press in this act that is a demonstration rather than a correction, and the
    // only one that stages: the audience is being shown a signature being made.
    stage.arm();
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
   * about which failure is which. Nor after an edit has retired the result — breaking a
   * verification the page has already withdrawn is a demonstration of nothing. Re-checking
   * survives both, because it is the way back from either: "there is nothing left to
   * verify" is one of the three outcomes this act exists to tell apart, and a re-check is
   * what answers for whatever is in the box now.
   */
  const settleControls = (): void => {
    const breakable = state.manifest !== null && state.verifiedText !== null;
    flipByte.disabled = !breakable;
    stripIt.disabled = !breakable;
    verifyIt.disabled = !state.signed;
  };
  settleControls();

  /**
   * A verdict that outlives its input is worse than no verdict — and this is the act where
   * that costs the most. A green "Verification passed" standing over visibly different text
   * is the precise misreading the whole page exists to prevent, and "Asset bytes now: 399"
   * beside a box holding 426 characters is simply a false statement.
   */
  const retire = (): void => {
    // Re-typing the same text is not a change: a no-op must not retire a fresh verdict.
    if (state.verifiedText === null || assetInput.value === state.verifiedText) return;
    state.verifiedText = null;
    stage.settle();
    clear(status);
    clear(hashView);
    clear(manifestView);
    status.append(el('p', { class: 'note', 'data-retired': 'true' }, [
      'These bytes changed, so the previous verification was retired. Press Verify again ' +
      'for a result about what is in the box now.',
    ]));
    settleControls();
  };
  assetInput.addEventListener('input', retire);

  const perform = async (action: () => Promise<void>, busyText: string): Promise<void> => {
    // The guard restores whatever each control was before the run, which is the right
    // default and the wrong answer here: the run is exactly what decides which of them
    // should now be available. Settled through the guard rather than after this await,
    // because the retry the guard offers on a failure calls back into it directly — a
    // recovered run used to leave every control it had just made available switched off.
    await runGuarded(action, {
      controls, region: status, progress, busyText, onSettled: settleControls,
    });
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
    hashView,
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
  const stage = remountStage(ACT_6);
  root.append(...actHeader(
    'act-6',
    'Act VI · Sign a lie',
    'A signature can sign a lie',
    // Not "the same real key". This act holds its own keypair, and on the short route it
    // sits directly beneath Act V, where "the same" reads as "the key you just watched" —
    // a claim a reader who opened both manifests would find two public keys under.
    'Compose something plainly false, sign it with a real key of its own, and verify it. ' +
    'The verification passes, because that is not the question a signature answers.',
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

  const state: {
    /** One keypair for the act, not one per press: "signed with a session key" has to be
     *  a fact a reader can check by opening two manifests, not a shape of words. */
    keys: KeyPairMaterial | null;
    /** The statement the result on screen was computed from. */
    signedText: string | null;
  } = { keys: null, signedText: null };

  const signAndVerify = async (): Promise<void> => {
    requireWebCrypto();
    const asset = encodeUtf8(claimInput.value);
    state.keys = state.keys ?? await generateSignerKeyPair();
    const keys = state.keys;
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

    /**
     * Whether the statement is false is not something this page can compute — which is the
     * act's entire point, and why the readout below answers the truth question by declining
     * it. There is exactly one falsehood here the code knows about: the 1687 claim this
     * file shipped. The textarea is labelled, editable and invited to be edited, so the
     * moment a visitor's own sentence is in it the page has no standing to call it a lie,
     * and the honest verdict is the narrower one it can actually support.
     */
    const shipped = claimInput.value.trim() === original.trim();
    state.signedText = claimInput.value;
    clear(detail);

    // The tone does not move with the wording. What the alarm is about is a passing
    // verification being read as a fact-check, and that misreading is available whatever
    // the sentence says.
    await stage.present(status, [
      verdict(
        result.valid ? 'alarm' : 'none',
        result.valid
          ? (shipped ? 'Verification passed — on a false statement' : 'Verification passed')
          : 'Verification failed',
        'A valid signature proves that the signed bytes are intact and bound to the ' +
        'signing key. It does not prove that the claim inside those bytes is true.',
      ),
      consequence(shipped ? 'Signed a lie' : 'Signed this statement', result.valid
        ? 'integrity passed; truth remained unanswered.'
        : 'integrity failed; truth remained unanswered either way.'),
      readout([
        ['Signature verifies', result.signatureValid ? 'yes' : 'no'],
        ['Hard binding matches', result.bindingValid ? 'yes' : 'no'],
        ['Assertion hashes match', result.assertionChecks.every((c) => c.matches) ? 'yes' : 'no'],
        ['Statement is true', 'not a question this mechanism can answer'],
        ['Assertion claims creation date', '1687-01-01'],
      ], 'Signed-lie verification'),
    ], 'Signing the statement, then checking the signature over it…');

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

  /**
   * An edit is a new statement, and the verdict above it was about the old one. Same
   * doctrine as Act II and Act V: a page that leaves "Verification passed" standing over a
   * sentence it never signed is teaching exactly the misreading this act exists to correct.
   */
  const retire = (): void => {
    if (state.signedText === null || claimInput.value === state.signedText) return;
    state.signedText = null;
    stage.settle();
    clear(status);
    clear(detail);
    status.append(el('p', { class: 'note', 'data-retired': 'true' }, [
      'This statement changed, so the previous verification was retired. Press Sign and ' +
      'verify it for a result about what is in the box now.',
    ]));
  };
  claimInput.addEventListener('input', retire);

  const signIt = button('Sign and verify it', () => {
    markAnchor(ACT_6);
    stage.arm();
    void perform(signAndVerify);
  }, true);
  const reset = resetButton('Reset act', () => {
    markAnchor(ACT_6);
    claimInput.value = original;
    // The act's key goes back with its text. A reset that kept the keypair would leave the
    // panel's "session key" describing a session the reader has just been told is over.
    state.keys = null;
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
