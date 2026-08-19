/**
 * Real ECDSA P-256, through WebCrypto, with no library in between.
 *
 * This is the asymmetric half of the lab's comparison. The private key signs; anyone
 * holding the public key verifies. Verification capability and production capability are
 * different capabilities — which is exactly what the watermark cannot offer, because
 * there the detector needs the same secret the generator used.
 *
 * What a valid signature here establishes: the signed bytes are intact and are bound to
 * the signing key. It establishes cryptographic integrity and authentication relative to
 * a signer credential and a trust model. It does not establish that the claim inside
 * those bytes is true — Act VI signs an obviously false statement to make that concrete.
 */

import { claimBytes, fromBase64, toBase64 } from './manifest.ts';
import type { Claim, Manifest } from './manifest.ts';

export interface KeyPairMaterial {
  readonly publicKey: CryptoKey;
  readonly privateKey: CryptoKey;
  /** Base64 SPKI, so the public half can travel inside the manifest. */
  readonly publicKeySpki: string;
}

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

export async function generateSignerKeyPair(): Promise<KeyPairMaterial> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeySpki: toBase64(new Uint8Array(spki)),
  };
}

export async function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    fromBase64(spkiBase64) as BufferSource,
    ALGORITHM,
    true,
    ['verify'],
  );
}

export async function signClaim(claim: Claim, privateKey: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign(
    SIGN_PARAMS,
    privateKey,
    claimBytes(claim) as BufferSource,
  );
  return toBase64(new Uint8Array(signature));
}

export async function signManifest(
  manifest: Manifest,
  keys: KeyPairMaterial,
  signerLabel: string,
): Promise<Manifest> {
  return {
    ...manifest,
    signature: await signClaim(manifest.claim, keys.privateKey),
    signer: {
      label: signerLabel,
      publicKeySpki: keys.publicKeySpki,
      algorithm: 'ECDSA-P256-SHA256',
    },
  };
}

export async function verifyClaimSignature(
  claim: Claim,
  signatureBase64: string,
  publicKey: CryptoKey,
): Promise<boolean> {
  return crypto.subtle.verify(
    SIGN_PARAMS,
    publicKey,
    fromBase64(signatureBase64) as BufferSource,
    claimBytes(claim) as BufferSource,
  );
}
