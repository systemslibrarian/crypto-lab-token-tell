/**
 * Acts V and VI — sign the same text, then sign a lie.
 *
 * Real ECDSA P-256 through WebCrypto, over a C2PA-SHAPED manifest. The contrast with the
 * watermark half of the page is the whole point: this evidence is binary, it survives no
 * amount of editing, and removing it leaves nothing behind rather than something weakened.
 */

import texts from '../data/pinned/texts.json';
import {
  buildManifest, canonicalize, encodeUtf8, sha256Hex,
} from '../c2pa/manifest.ts';
import type { Assertion, Manifest } from '../c2pa/manifest.ts';
import { generateSignerKeyPair, signManifest } from '../c2pa/sign.ts';
import type { KeyPairMaterial } from '../c2pa/sign.ts';
import { validateManifest } from '../c2pa/validate.ts';
import {
  actHeader, button, clear, el, integer, liveRegion, panel, provenanceTag, readout,
  scroller, verdict,
} from './dom.ts';

const CLAIM_OPTIONS = {
  claimGenerator: 'crypto-lab-token-tell/0.1.0',
  format: 'text/plain',
  instanceId: 'urn:uuid:2f9c5f10-0000-4000-8000-746f6b656e74',
};

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

export function renderAct5(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-5',
    'Act V',
    'Sign the same text',
    'The same words that carried a statistical watermark, now carrying a signature. One ' +
    'byte decides this one, and there is no threshold anywhere in it.',
  ));

  const assetInput = el('textarea', {
    id: 'sign-asset',
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  assetInput.value = texts.samples.watermarked.text.slice(0, 400).trim();

  const status = liveRegion('Signature status');
  const manifestView = el('div');

  const state: { keys: KeyPairMaterial | null; manifest: Manifest | null; asset: Uint8Array } = {
    keys: null,
    manifest: null,
    asset: encodeUtf8(assetInput.value),
  };

  const showValidation = async () => {
    clear(status);
    const result = await validateManifest(state.manifest, state.asset);
    const tone = !result.manifestPresent ? 'none' : result.valid ? 'evidence' : 'alarm';
    const label = !result.manifestPresent
      ? 'No manifest'
      : result.valid ? 'Verification passed' : 'Verification failed';
    status.append(verdict(tone, label, result.summary));
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

  const renderManifest = () => {
    clear(manifestView);
    if (!state.manifest) return;
    manifestView.append(
      el('h4', { text: 'The manifest' }),
      scroller('C2PA-shaped manifest', [
        el('pre', { class: 'mono', text: JSON.stringify(state.manifest, null, 2) }),
      ]),
      el('p', { class: 'note' }, [
        'The signature covers the claim only. The claim covers the assertions by hash and ' +
        'the asset by hash, so editing either breaks verification without the signature ' +
        'itself being touched — which the buttons above let you check separately.',
      ]),
    );
  };

  const sign = async () => {
    state.asset = encodeUtf8(assetInput.value);
    state.keys = state.keys ?? await generateSignerKeyPair();
    const unsigned = await buildManifest(state.asset, defaultAssertions(), CLAIM_OPTIONS);
    state.manifest = await signManifest(unsigned, state.keys, 'Demo signer (session key)');
    renderManifest();
    await showValidation();
  };

  const tamperAsset = async () => {
    const bytes = new Uint8Array(state.asset);
    if (!bytes.length) return;
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    state.asset = bytes;
    assetInput.value = new TextDecoder().decode(bytes);
    await showValidation();
  };

  const stripManifest = async () => {
    state.manifest = null;
    clear(manifestView);
    await showValidation();
  };

  root.append(panel('Sign, then break it', [
    el('p', { class: 'note' }, [
      'The signing key is generated in this tab and never leaves it. Sign the text, then ' +
      'flip one byte of the asset, or throw the manifest away, and watch which failure is ' +
      'which.',
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'sign-asset', text: 'Asset (the exact bytes that get signed)' }),
      assetInput,
    ]),
    el('div', { class: 'controls' }, [
      button('Sign it', () => { void sign(); }, true),
      button('Flip one byte of the asset', () => { void tamperAsset(); }),
      button('Strip the manifest', () => { void stripManifest(); }),
      button('Verify again', () => { void showValidation(); }),
    ]),
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

  void sign();
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

  const claimInput = el('textarea', {
    id: 'lie-asset',
    spellcheck: 'false',
    style: 'min-height:6rem',
  }) as HTMLTextAreaElement;
  claimInput.value =
    'This document was written by hand in 1687, contains no errors of any kind, and was ' +
    'never touched by a computer.';

  const status = liveRegion('Signed statement status');
  const detail = el('div');

  const signAndVerify = async () => {
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

    clear(status);
    status.append(verdict(
      result.valid ? 'alarm' : 'none',
      result.valid ? 'Verification passed — on a false statement' : 'Verification failed',
      'A valid signature proves that the signed bytes are intact and bound to the signing ' +
      'key. It does not prove that the claim inside those bytes is true.',
    ));
    status.append(readout([
      ['Signature verifies', result.signatureValid ? 'yes' : 'no'],
      ['Hard binding matches', result.bindingValid ? 'yes' : 'no'],
      ['Assertion hashes match', result.assertionChecks.every((c) => c.matches) ? 'yes' : 'no'],
      ['Statement is true', 'not a question this mechanism can answer'],
      ['Assertion claims creation date', '1687-01-01'],
    ], 'Signed-lie verification'));

    clear(detail);
    detail.append(
      el('h4', { text: 'What was signed' }),
      scroller('Signed claim bytes', [
        el('pre', { class: 'mono', text: canonicalize(manifest.claim) }),
      ]),
      el('p', { class: 'note' }, [
        `Asset digest: ${await sha256Hex(asset)}. The signature is over the canonical ` +
        'claim bytes above, which contain that digest. Everything in the chain is intact. ' +
        'The date in the assertion is still wrong.',
      ]),
    );
  };

  root.append(panel('Sign something false', [
    el('div', { class: 'field' }, [
      el('label', { for: 'lie-asset', text: 'A statement to sign' }),
      claimInput,
    ]),
    el('div', { class: 'controls' }, [
      button('Sign and verify it', () => { void signAndVerify(); }, true),
    ]),
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

  void signAndVerify();
}
