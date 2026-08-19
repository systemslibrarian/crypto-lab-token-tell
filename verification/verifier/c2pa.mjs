/**
 * An independent implementation of the manifest binding and signature checks.
 *
 * Same reasoning as the watermark verifier: written from the structure rather than from
 * the lab's TypeScript, so agreement is evidence. Uses Node's WebCrypto for ECDSA P-256,
 * which is the same standard primitive the browser side uses and is deliberately not
 * reimplemented — hand-rolling a curve here would be checking the wrong thing.
 */

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' };

/** Canonical JSON: keys sorted, no whitespace, array order preserved. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

export async function sha256Hex(bytes) {
  const digest = await subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}

export async function buildManifest(assetBytes, assertions, options) {
  const hashed = [];
  for (const assertion of assertions) {
    hashed.push({
      label: assertion.label,
      alg: 'sha256',
      hash: await sha256Hex(Buffer.from(canonicalize(assertion), 'utf8')),
    });
  }
  return {
    claim: {
      claim_generator: options.claimGenerator,
      format: options.format,
      instance_id: options.instanceId,
      assertions: hashed,
      hard_binding: {
        label: 'c2pa.hash.data',
        alg: 'sha256',
        hash: await sha256Hex(assetBytes),
        assetByteLength: assetBytes.byteLength,
      },
    },
    assertions: [...assertions],
    signature: null,
    signer: null,
  };
}

export async function signManifest(manifest, keyPair) {
  const bytes = Buffer.from(canonicalize(manifest.claim), 'utf8');
  const signature = await subtle.sign(SIGN_PARAMS, keyPair.privateKey, bytes);
  const spki = await subtle.exportKey('spki', keyPair.publicKey);
  return {
    ...manifest,
    signature: Buffer.from(signature).toString('base64'),
    signer: {
      label: 'verifier session key',
      publicKeySpki: Buffer.from(spki).toString('base64'),
      algorithm: 'ECDSA-P256-SHA256',
    },
  };
}

export async function generateKeyPair() {
  return subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
}

export async function validate(manifest, assetBytes) {
  const actualAssetHash = await sha256Hex(assetBytes);
  if (!manifest) {
    return {
      manifestPresent: false, signatureValid: false, bindingValid: false,
      assertionsValid: false, valid: false, actualAssetHash,
    };
  }
  const binding = manifest.claim.hard_binding;
  const bindingValid = binding.hash === actualAssetHash
    && binding.assetByteLength === assetBytes.byteLength;

  let assertionsValid = true;
  for (const recorded of manifest.claim.assertions) {
    const assertion = manifest.assertions.find((entry) => entry.label === recorded.label);
    const actual = assertion
      ? await sha256Hex(Buffer.from(canonicalize(assertion), 'utf8'))
      : null;
    if (actual !== recorded.hash) assertionsValid = false;
  }

  let signatureValid = false;
  if (manifest.signature && manifest.signer) {
    const publicKey = await subtle.importKey(
      'spki', Buffer.from(manifest.signer.publicKeySpki, 'base64'), ALGORITHM, true, ['verify']);
    signatureValid = await subtle.verify(
      SIGN_PARAMS, publicKey,
      Buffer.from(manifest.signature, 'base64'),
      Buffer.from(canonicalize(manifest.claim), 'utf8'));
  }

  return {
    manifestPresent: true,
    signatureValid,
    bindingValid,
    assertionsValid,
    valid: signatureValid && bindingValid && assertionsValid,
    actualAssetHash,
  };
}
