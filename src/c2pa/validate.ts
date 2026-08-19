/**
 * Validating a manifest against an asset.
 *
 * Three separate questions, reported separately, because collapsing them into one green
 * tick is how a reader ends up believing a signature says more than it does:
 *
 *   1. Does the claim signature verify against the signer's public key?
 *   2. Does the hard binding still match the asset bytes?
 *   3. Does every assertion still hash to what the claim recorded?
 *
 * Each answer is binary. There is no threshold anywhere in this file, and that is the
 * contrast with the watermark half of the lab, where every answer is a matter of degree.
 */

import { canonicalize, encodeUtf8, hashAssertion, sha256Hex } from './manifest.ts';
import type { Manifest } from './manifest.ts';
import { importPublicKey, verifyClaimSignature } from './sign.ts';

export interface AssertionCheck {
  readonly label: string;
  readonly recordedHash: string;
  readonly actualHash: string;
  readonly matches: boolean;
}

export interface ValidationResult {
  /** No manifest at all: nothing to verify, which is not the same as failing to verify. */
  readonly manifestPresent: boolean;
  readonly signaturePresent: boolean;
  readonly signatureValid: boolean;
  readonly bindingValid: boolean;
  readonly recordedAssetHash: string | null;
  readonly actualAssetHash: string | null;
  readonly recordedAssetLength: number | null;
  readonly actualAssetLength: number;
  readonly assertionChecks: AssertionCheck[];
  /** True only when a signature verified and every hash still matched. */
  readonly valid: boolean;
  readonly summary: string;
}

export async function validateManifest(
  manifest: Manifest | null,
  assetBytes: Uint8Array,
): Promise<ValidationResult> {
  const actualAssetHash = await sha256Hex(assetBytes);

  if (!manifest) {
    return {
      manifestPresent: false,
      signaturePresent: false,
      signatureValid: false,
      bindingValid: false,
      recordedAssetHash: null,
      actualAssetHash,
      recordedAssetLength: null,
      actualAssetLength: assetBytes.byteLength,
      assertionChecks: [],
      valid: false,
      summary:
        'No manifest. There is nothing to verify, and nothing was broken to get here — ' +
        'the asset is byte-for-byte what it was, and now carries no provenance at all.',
    };
  }

  const binding = manifest.claim.hard_binding;
  const bindingValid =
    binding.hash === actualAssetHash && binding.assetByteLength === assetBytes.byteLength;

  const assertionChecks: AssertionCheck[] = [];
  for (const recorded of manifest.claim.assertions) {
    const assertion = manifest.assertions.find((a) => a.label === recorded.label);
    const actualHash = assertion
      ? (await hashAssertion(assertion)).hash
      : await sha256Hex(encodeUtf8(canonicalize(null)));
    assertionChecks.push({
      label: recorded.label,
      recordedHash: recorded.hash,
      actualHash,
      matches: Boolean(assertion) && recorded.hash === actualHash,
    });
  }

  let signatureValid = false;
  if (manifest.signature && manifest.signer) {
    const publicKey = await importPublicKey(manifest.signer.publicKeySpki);
    signatureValid = await verifyClaimSignature(manifest.claim, manifest.signature, publicKey);
  }

  const assertionsValid = assertionChecks.every((check) => check.matches);
  const valid = signatureValid && bindingValid && assertionsValid;

  return {
    manifestPresent: true,
    signaturePresent: Boolean(manifest.signature),
    signatureValid,
    bindingValid,
    recordedAssetHash: binding.hash,
    actualAssetHash,
    recordedAssetLength: binding.assetByteLength,
    actualAssetLength: assetBytes.byteLength,
    assertionChecks,
    valid,
    summary: summarize(signatureValid, bindingValid, assertionsValid),
  };
}

function summarize(signature: boolean, binding: boolean, assertions: boolean): string {
  if (signature && binding && assertions) {
    return 'Signature verifies, and the bytes it covers are unchanged. This says the ' +
      'signed content is intact and bound to the signing key. It says nothing about ' +
      'whether the claim is true.';
  }
  if (!signature && binding && assertions) {
    return 'The signature does not verify against this public key, although the hashes ' +
      'still match. The bytes are as recorded; the signature over them is not.';
  }
  if (signature) {
    return 'The signature verifies over the claim, but the claim no longer describes ' +
      'what is here: a hash it recorded does not match. Integrity has failed.';
  }
  return 'Verification failed. Neither the signature nor the recorded hashes hold.';
}
