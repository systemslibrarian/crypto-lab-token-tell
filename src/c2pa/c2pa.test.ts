/**
 * The signature half of the lab.
 *
 * Everything here runs real ECDSA P-256 through WebCrypto. The assertions are about the
 * two properties the page claims and the two it refuses to claim: a valid signature means
 * intact bytes bound to a key, and it means nothing at all about whether the signed
 * statement is true.
 */

import { describe, expect, it } from 'vitest';

import {
  buildManifest, canonicalize, claimBytes, encodeUtf8, fromBase64, sha256Hex, toBase64,
} from './manifest.ts';
import type { Manifest } from './manifest.ts';
import { generateSignerKeyPair, signManifest } from './sign.ts';
import { validateManifest } from './validate.ts';

const OPTIONS = {
  claimGenerator: 'crypto-lab-token-tell/0.1.0',
  format: 'text/plain',
  instanceId: 'urn:uuid:00000000-0000-4000-8000-000000000000',
};

const ASSERTIONS = [
  { label: 'stds.schema-org.CreativeWork', data: { author: [{ name: 'A. Cataloguer' }] } },
  { label: 'c2pa.actions', data: { actions: [{ action: 'c2pa.created' }] } },
];

const ASSET = encodeUtf8('The library will retain the accession register in paper form.');

describe('canonical serialization', () => {
  it('sorts keys so the same object always signs the same bytes', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ a: 2, b: 1 })).toBe(canonicalize({ b: 1, a: 2 }));
  });

  it('sorts nested keys too', () => {
    expect(canonicalize({ x: { z: 1, y: [3, { b: 1, a: 0 }] } }))
      .toBe('{"x":{"y":[3,{"a":0,"b":1}],"z":1}}');
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('base64 round trips', () => {
  it('survives every byte value', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('hashing', () => {
  it('reproduces a published SHA-256 test vector', () => {
    // The empty-string digest, which is a value from outside this codebase.
    return expect(sha256Hex(new Uint8Array(0))).resolves
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('reproduces the digest of "abc"', () => {
    return expect(sha256Hex(encodeUtf8('abc'))).resolves
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('sign, then verify', () => {
  it('verifies an untouched manifest', async () => {
    const keys = await generateSignerKeyPair();
    const manifest = await signManifest(
      await buildManifest(ASSET, ASSERTIONS, OPTIONS), keys, 'Demo signer');
    const result = await validateManifest(manifest, ASSET);

    expect(result.signatureValid).toBe(true);
    expect(result.bindingValid).toBe(true);
    expect(result.assertionChecks.every((c) => c.matches)).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('fails on a one-byte change to the asset, with no threshold anywhere', async () => {
    const keys = await generateSignerKeyPair();
    const manifest = await signManifest(
      await buildManifest(ASSET, ASSERTIONS, OPTIONS), keys, 'Demo signer');

    const tampered = new Uint8Array(ASSET);
    tampered[0] ^= 0x01;
    const result = await validateManifest(manifest, tampered);

    expect(result.bindingValid).toBe(false);
    // The signature still verifies: it covers the claim, and the claim was not touched.
    // What broke is the binding from the claim to these bytes.
    expect(result.signatureValid).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.actualAssetHash).not.toBe(result.recordedAssetHash);
  });

  it('fails when an assertion is edited after signing', async () => {
    const keys = await generateSignerKeyPair();
    const signed = await signManifest(
      await buildManifest(ASSET, ASSERTIONS, OPTIONS), keys, 'Demo signer');
    const edited: Manifest = {
      ...signed,
      assertions: [
        { label: 'stds.schema-org.CreativeWork', data: { author: [{ name: 'Someone Else' }] } },
        signed.assertions[1],
      ],
    };
    const result = await validateManifest(edited, ASSET);
    expect(result.signatureValid).toBe(true);
    expect(result.assertionChecks[0].matches).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('fails when the claim itself is edited', async () => {
    const keys = await generateSignerKeyPair();
    const signed = await signManifest(
      await buildManifest(ASSET, ASSERTIONS, OPTIONS), keys, 'Demo signer');
    const edited: Manifest = {
      ...signed,
      claim: { ...signed.claim, claim_generator: 'somebody-else/9.9.9' },
    };
    const result = await validateManifest(edited, ASSET);
    expect(result.signatureValid).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('fails against a different signer key', async () => {
    const keys = await generateSignerKeyPair();
    const impostor = await generateSignerKeyPair();
    const signed = await signManifest(
      await buildManifest(ASSET, ASSERTIONS, OPTIONS), keys, 'Demo signer');
    const swapped: Manifest = {
      ...signed,
      signer: { ...signed.signer!, publicKeySpki: impostor.publicKeySpki },
    };
    expect((await validateManifest(swapped, ASSET)).signatureValid).toBe(false);
  });

  it('reports a stripped manifest as absent rather than as broken', async () => {
    // Stripping is not tampering. The bytes are untouched and every hash would still
    // match — there is simply nothing left to check them against.
    const result = await validateManifest(null, ASSET);
    expect(result.manifestPresent).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.actualAssetHash).toBe(await sha256Hex(ASSET));
    expect(result.summary).toContain('nothing to verify');
  });

  it('verifies a signed statement that is plainly false', async () => {
    // Act VI, as a test. A signature is a statement about bytes, not about the world.
    const lie = encodeUtf8('This document was written in the year 1400 by nobody at all.');
    const keys = await generateSignerKeyPair();
    const manifest = await signManifest(
      await buildManifest(lie, [
        { label: 'stds.schema-org.CreativeWork', data: { dateCreated: '1400-01-01' } },
      ], OPTIONS), keys, 'Demo signer');
    const result = await validateManifest(manifest, lie);
    expect(result.valid).toBe(true);
    expect(result.summary).toContain('says nothing about');
  });

  it('signs the canonical claim bytes and nothing else', async () => {
    const manifest = await buildManifest(ASSET, ASSERTIONS, OPTIONS);
    const bytes = claimBytes(manifest.claim);
    expect(new TextDecoder().decode(bytes)).toBe(canonicalize(manifest.claim));
    // The assertion bodies are outside the signed bytes; only their hashes are inside.
    expect(new TextDecoder().decode(bytes)).not.toContain('A. Cataloguer');
    expect(new TextDecoder().decode(bytes)).toContain(manifest.claim.assertions[0].hash);
  });
});
