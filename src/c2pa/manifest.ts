/**
 * A C2PA-SHAPED manifest.
 *
 * DEMO-SIMPLIFICATION, and the shape of the simplification matters more than the fact of
 * it. This builds the three structural ideas a reader needs — assertions, a claim that
 * binds them by hash, and a hard binding over the asset bytes — and it is deliberately
 * NOT a conformant C2PA manifest. It has no JUMBF container, no COSE claim signature, no
 * certificate chain, no trust-list validation and no Conformance Program status. See the
 * limitations section of the page, which says the same thing where a reader will see it.
 *
 * What it does carry faithfully is the property the lab is teaching: the signature covers
 * a claim, the claim covers hashes, and the hashes cover the assertions and the asset. So
 * changing one byte anywhere under that cover breaks verification, and removing the
 * manifest leaves nothing to break.
 */

export interface Assertion {
  /** C2PA-style label, e.g. "stds.schema-org.CreativeWork". */
  readonly label: string;
  readonly data: unknown;
}

export interface HashedAssertionReference {
  readonly label: string;
  readonly alg: 'sha256';
  /** Hex digest of the canonical serialization of the assertion. */
  readonly hash: string;
}

export interface HardBinding {
  /** C2PA calls the data-hash assertion "c2pa.hash.data"; the name is kept for recognition. */
  readonly label: 'c2pa.hash.data';
  readonly alg: 'sha256';
  /** Hex digest of the asset bytes. */
  readonly hash: string;
  readonly assetByteLength: number;
}

export interface Claim {
  readonly claim_generator: string;
  readonly format: string;
  readonly instance_id: string;
  readonly assertions: HashedAssertionReference[];
  readonly hard_binding: HardBinding;
}

export interface Manifest {
  readonly claim: Claim;
  readonly assertions: Assertion[];
  /** Base64 of the raw ECDSA P-256 signature over the canonical claim bytes. */
  readonly signature: string | null;
  readonly signer: {
    readonly label: string;
    /** Base64 of the SPKI-encoded public key. */
    readonly publicKeySpki: string;
    readonly algorithm: 'ECDSA-P256-SHA256';
  } | null;
}

/**
 * Canonical serialization.
 *
 * Signing has to be over bytes, and "the JSON of this object" is not a single sequence of
 * bytes until key order and whitespace are pinned. Keys are sorted and separators are
 * fixed, so signer and verifier hash the same thing.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

/** Hash one assertion the way the claim will reference it. */
export async function hashAssertion(assertion: Assertion): Promise<HashedAssertionReference> {
  return {
    label: assertion.label,
    alg: 'sha256',
    hash: await sha256Hex(encodeUtf8(canonicalize(assertion))),
  };
}

export interface BuildManifestOptions {
  readonly claimGenerator: string;
  readonly format: string;
  readonly instanceId: string;
}

/** Build the unsigned manifest for an asset and a set of assertions. */
export async function buildManifest(
  assetBytes: Uint8Array,
  assertions: readonly Assertion[],
  options: BuildManifestOptions,
): Promise<Manifest> {
  const hashedAssertions = await Promise.all(assertions.map(hashAssertion));
  return {
    claim: {
      claim_generator: options.claimGenerator,
      format: options.format,
      instance_id: options.instanceId,
      assertions: hashedAssertions,
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

/** The exact bytes a signature covers. */
export function claimBytes(claim: Claim): Uint8Array {
  return encodeUtf8(canonicalize(claim));
}
