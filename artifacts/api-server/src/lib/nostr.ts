/**
 * Nostr Integration
 *
 * Handles publishing PWSats events (new markets, settlements, etc.)
 * to the Nostr network for organic promotion.
 *
 * Uses `nostr-tools` v2 API:
 *   - PlainKeySigner for signing (from 'nostr-tools/signer')
 *   - SimplePool for relay connections
 *   - nip19 for npub encoding
 *
 * Required env vars:
 *   NOSTR_PRIVATE_KEY — 32-byte hex private key (64 chars)
 *   NOSTR_RELAYS — comma-separated relay URLs (default: popular public relays)
 */

import {
  SimplePool,
  nip19,
  type EventTemplate,
  type VerifiedEvent,
} from "nostr-tools";
import { PlainKeySigner } from "nostr-tools/signer";
import { hexToBytes } from "nostr-tools/utils";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_RELAYS = [
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.nosver.se",
  "wss://purplepag.es",
];

function getRelays(): string[] {
  const relaysEnv = process.env.NOSTR_RELAYS;
  if (relaysEnv) {
    return relaysEnv.split(",").map((r) => r.trim()).filter(Boolean);
  }
  return DEFAULT_RELAYS;
}

function getPrivateKey(): string | null {
  return process.env.NOSTR_PRIVATE_KEY || null;
}

// ---------------------------------------------------------------------------
// Shared signer + pool (lazy initialization, singletons)
// ---------------------------------------------------------------------------

let _signer: PlainKeySigner | null = null;
let _pool: SimplePool | null = null;

function getSigner(): PlainKeySigner {
  if (!_signer) {
    const sk = getPrivateKey();
    if (!sk) throw new Error("NOSTR_PRIVATE_KEY not set");
    _signer = new PlainKeySigner(hexToBytes(sk));
  }
  return _signer;
}

export function getNostrPool(): SimplePool | null {
  if (!_pool) {
    const relays = getRelays();
    if (relays.length === 0) return null;
    _pool = new SimplePool();
    logger.info({ relays }, "Nostr pool initialized");
  }
  return _pool;
}

// ---------------------------------------------------------------------------
// Publish (fire-and-forget with per-relay timeouts)
// ---------------------------------------------------------------------------

const PUBLISH_TIMEOUT_MS = 8_000;

export async function publishNostrEvent(
  content: string,
  tags: string[][],
  kind: number = 1,
): Promise<{ eventId: string; okCount: number; failCount: number }> {
  const pool = getNostrPool();
  if (!pool) {
    logger.warn("Nostr pool not initialized — skipping publish");
    return { eventId: "", okCount: 0, failCount: 0 };
  }

  const signer = getSigner();
  const event: EventTemplate = {
    kind,
    content,
    created_at: Math.floor(Date.now() / 1000),
    tags,
  };

  const signed: VerifiedEvent = await signer.signEvent(event);
  const relays = getRelays();

  logger.info(
    { eventId: signed.id, pubkey: signed.pubkey.slice(0, 8), contentLength: signed.content.length },
    "Publishing Nostr event",
  );

  const results = await Promise.all(
    relays.map(async (relay) => {
      try {
        const [result] = await Promise.all([
          Promise.race([
            pool.publish([relay], signed),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), PUBLISH_TIMEOUT_MS)),
          ]).then((results) => results[0]),
        ]);
        return { relay, ok: !result || typeof result !== "string" };
      } catch (err) {
        logger.warn({ err, relay }, "Nostr relay publish failed");
        return { relay, ok: false };
      }
    }),
  );

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  logger.info(
    { eventId: signed.id, okCount, failCount, total: relays.length },
    "Nostr event publish results",
  );

  return {
    eventId: signed.id,
    okCount,
    failCount,
  };
}

// ---------------------------------------------------------------------------
// Post with inline image
// ---------------------------------------------------------------------------

export async function publishNostrPostWithImage(
  text: string,
  imageBase64: string, // base64-encoded PNG (without data: prefix)
  tags: string[][] = [],
): Promise<{ eventId: string; okCount: number; failCount: number }> {
  // Compute SHA-256 hash of the image for the "image" tag (NIP-95 style)
  const crypto = await import("node:crypto");
  const hash = crypto
    .createHash("sha256")
    .update(Buffer.from(imageBase64, "base64"))
    .digest("hex");

  const imageDataUri = `data:image/png;base64,${imageBase64}`;

  const content = `${text}\n\n${imageDataUri}`;

  const allTags = [
    ["image", hash],
    ...tags,
  ];

  return publishNostrEvent(content, allTags, 1);
}

// ---------------------------------------------------------------------------
// Convenience: test post
// ---------------------------------------------------------------------------

export async function testNostrPost(): Promise<{
  success: boolean;
  publicKey: string;
  npub: string;
  eventId: string;
  okCount: number;
  failCount: number;
}> {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new Error("NOSTR_PRIVATE_KEY not set — cannot test");
  }

  const signer = getSigner();
  const pubkey = await signer.getPublicKey();
  const npub = nip19.npubEncode(pubkey);

  const result = await publishNostrEvent(
    `🚀 PWSats Nostr integration active!\n\nThis is a test post. New sports prediction markets will be announced here automatically.\n\n⚡ Bet with Lightning — pwsats.com\n\n#pwsats #bitcoin #lightning`,
    [["t", "pwsats"], ["t", "bitcoin"], ["t", "lightning"]],
    1,
  );

  return {
    success: result.okCount > 0,
    publicKey: pubkey,
    npub,
    eventId: result.eventId,
    okCount: result.okCount,
    failCount: result.failCount,
  };
}
