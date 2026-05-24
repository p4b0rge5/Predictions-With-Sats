/**
 * NIP-57 Lightning Zap receiver for PWSats.
 *
 * Implements the server-side of the Nostr Zap protocol:
 *   1. GET /.well-known/lnurlp/<user> — LNURL metadata (with allowsNostr + nostrPubkey)
 *   2. GET /api/lnurl-zap/callback — validates zap request, generates invoice
 *   3. POST /api/lnurl-zap/receipt — publish zap receipt after payment confirmed
 *
 * When a user zaps a PWSats market post:
 *   - The zap comment contains the outcome selector ("home", "draw", "away")
 *   - The zap amount becomes the bet amount
 *   - The zap event id (e tag) identifies which market post was zapped
 */

import { validateZapRequest, makeZapReceipt } from "nostr-tools/nip57";
import { SimplePool, verifyEvent, type VerifiedEvent, nip19 } from "nostr-tools";
import { PlainKeySigner } from "nostr-tools/signer";
import { hexToBytes } from "nostr-tools/utils";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Config helpers (cached pubkey)
// ---------------------------------------------------------------------------

function getPrivateKey(): string | null {
  return process.env.NOSTR_PRIVATE_KEY || null;
}

// Cached pubkey — derived once on first access
let _pubkey: string | null = null;

async function getPublicKey(): Promise<string | null> {
  const sk = getPrivateKey();
  if (!sk) return null;
  if (_pubkey) return _pubkey;
  const signer = new PlainKeySigner(hexToBytes(sk));
  _pubkey = await signer.getPublicKey();
  return _pubkey;
}

function requirePublicKey(): string {
  const sk = getPrivateKey();
  if (!sk) throw new Error("NOSTR_PRIVATE_KEY not set");
  return _pubkey ?? (
    // Synchronous fallback — should never hit because getPublicKey() caches
    (() => { throw new Error("Public key not cached yet. Call getPublicKey() first."); })()
  );
}

function getRelays(): string[] {
  const relaysEnv = process.env.NOSTR_RELAYS;
  if (relaysEnv) {
    return relaysEnv.split(",").map((r) => r.trim()).filter(Boolean);
  }
  return ["wss://relay.nostr.band", "wss://nos.lol"];
}

// ---------------------------------------------------------------------------
// LNURL-Zap metadata response (NIP-57 Appendix C)
// ---------------------------------------------------------------------------

interface LnurlZapMetadata {
  allowedModels: string[];
  callback: string;
  commentAllowed: number;
  defaultDescription: string;
  maxSendable: number;
  minSendable: number;
  metadata: string[];
  nostrPubkey: string;
  allowsNostr: true;
  tag: string;
  url: string;
}

/**
 * Build the LNURL-Zap metadata response for GET /.well-known/lnurlp/pwsats
 */
export async function buildLnurlZapMetadata(callbackUrl: string): Promise<LnurlZapMetadata> {
  const pubkey = await getPublicKey();
  if (!pubkey) {
    throw new Error("NOSTR_PRIVATE_KEY required for zap receiver");
  }

  const minSats = 250;
  const maxSats = 100_000;

  const metadataJson = JSON.stringify([["text/plain", "PWSats — Bet with Bitcoin Lightning"]]);
  const metadataB64 = Buffer.from(metadataJson).toString("base64");

  return {
    allowedModels: ["text/plain"],
    callback: callbackUrl,
    commentAllowed: 200,
    defaultDescription: "Bet on a market with Bitcoin Lightning",
    maxSendable: maxSats * 1000,
    minSendable: minSats * 1000,
    metadata: [metadataB64],
    nostrPubkey: pubkey,
    allowsNostr: true,
    tag: "lnurl-pay",
    url: "", // filled in by route handler
  };
}

// ---------------------------------------------------------------------------
// Zap request validation (NIP-57 Appendix D)
// ---------------------------------------------------------------------------

export interface ParsedZapRequest {
  zapRequest: VerifiedEvent;
  zapRequestJson: string;
  eventId: string;
  pubkey: string;
  senderPubkey: string;
  amountMsats: number;
  amountSats: number;
  comment: string;
  relays: string[];
  outcome: string | null;
}

export async function parseZapRequest(
  nostrParam: string,
  amountMsats: number,
): Promise<ParsedZapRequest> {
  const zapRequestJson = decodeURIComponent(nostrParam);

  const validationError = validateZapRequest(zapRequestJson);
  if (validationError) {
    throw new Error(`Zap request invalid: ${validationError}`);
  }

  const zapEvent = JSON.parse(zapRequestJson) as VerifiedEvent;

  if (!verifyEvent(zapEvent)) {
    throw new Error("Invalid signature on zap request");
  }

  const ourPubkey = await getPublicKey();
  if (!ourPubkey) {
    throw new Error("NOSTR_PRIVATE_KEY not set");
  }

  const pTag = zapEvent.tags.find(([t]) => t === "p");
  if (!pTag || pTag[1] !== ourPubkey) {
    throw new Error("Zap request 'p' tag does not match our pubkey");
  }

  const eTag = zapEvent.tags.find(([t]) => t === "e");
  if (!eTag || !eTag[1]) {
    throw new Error("Zap request missing 'e' tag (target event id required)");
  }

  const amountTag = zapEvent.tags.find(([t]) => t === "amount");
  if (amountTag) {
    const eventAmount = parseInt(amountTag[1], 10);
    if (eventAmount !== amountMsats) {
      throw new Error(`Amount mismatch: event says ${amountTag[1]} but param says ${amountMsats}`);
    }
  }

  const comment = zapEvent.content || "";
  const outcomeMatch = comment.trim().toLowerCase().match(/^(home|draw|away|yes|no)$/);
  const outcome = outcomeMatch ? outcomeMatch[1] : null;

  if (!outcome) {
    throw new Error(
      `Zap comment must be a single outcome: "home", "draw", or "away". Got: "${comment.slice(0, 50)}"`,
    );
  }

  const relaysTag = zapEvent.tags.find(([t]) => t === "relays");
  const relays = relaysTag ? relaysTag.slice(1) : getRelays();

  return {
    zapRequest: zapEvent,
    zapRequestJson,
    eventId: eTag[1],
    pubkey: pTag[1],
    senderPubkey: zapEvent.pubkey,
    amountMsats,
    amountSats: Math.round(amountMsats / 1000),
    comment,
    relays,
    outcome,
  };
}

// ---------------------------------------------------------------------------
// Invoice generation
// ---------------------------------------------------------------------------

export interface ZapInvoiceResult {
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
}

let _createInvoice: ((amountSats: number, memo: string) => Promise<{
  paymentHash: string;
  paymentRequest: string;
  expiresAt: string;
  verifyUrl: string | null;
}>) | null = null;

async function getCreateInvoice() {
  if (!_createInvoice) {
    const alby = await import("./alby");
    _createInvoice = alby.createInvoice;
  }
  return _createInvoice!;
}

export async function createZapInvoice(
  amountSats: number,
  zapRequestId: string,
  outcome: string,
): Promise<ZapInvoiceResult> {
  const ci = await getCreateInvoice();
  const memo = `Nostr zap bet: ${outcome} (${zapRequestId.slice(0, 8)})`;
  const result = await ci(amountSats, memo);
  return {
    paymentRequest: result.paymentRequest,
    paymentHash: result.paymentHash,
    expiresAt: result.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Zap receipt publishing (NIP-57 Appendix E)
// ---------------------------------------------------------------------------

export async function publishZapReceipt(
  zapRequestJson: string,
  bolt11: string,
  relays: string[],
  preimage: string | null = null,
): Promise<{ eventId: string; okCount: number; failCount: number }> {
  const sk = getPrivateKey();
  if (!sk) throw new Error("NOSTR_PRIVATE_KEY not set");

  const signer = new PlainKeySigner(hexToBytes(sk));
  const receiptTemplate = makeZapReceipt({
    zapRequest: zapRequestJson,
    preimage: preimage || undefined,
    bolt11,
    paidAt: new Date(),
  });

  const signed = await signer.signEvent(receiptTemplate);

  const pool = new SimplePool();
  const results = await Promise.all(
    relays.map(async (relay) => {
      try {
        const [result] = await Promise.all([
          Promise.race([
            pool.publish([relay], signed),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 8000)),
          ]),
        ]);
        return { relay, ok: !result || typeof result !== "string" };
      } catch (err) {
        logger.warn({ err, relay }, "Zap receipt publish failed");
        return { relay, ok: false };
      }
    }),
  );

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;

  logger.info(
    { eventId: signed.id, okCount, failCount, relays: relays.length },
    "Zap receipt published",
  );

  return { eventId: signed.id, okCount, failCount };
}

// ---------------------------------------------------------------------------
// Public key helpers
// ---------------------------------------------------------------------------

export async function getNostrPubkey(): Promise<string | null> {
  return getPublicKey();
}

export async function getNostrNpub(): Promise<string | null> {
  const pubkey = await getPublicKey();
  if (!pubkey) return null;
  return nip19.npubEncode(pubkey);
}

export { getRelays };
