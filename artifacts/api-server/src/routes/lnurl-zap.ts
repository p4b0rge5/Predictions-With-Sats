/**
 * NIP-57 Zap Receiver Routes
 */

import { Router } from "express";
import { bech32 } from "bech32";
import {
  buildLnurlZapMetadata,
  parseZapRequest,
  type ParsedZapRequest,
  createZapInvoice,
  publishZapReceipt,
  getNostrPubkey,
  getNostrNpub,
  getRelays,
} from "../lib/nostr-zap";
import { logger } from "../lib/logger";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodeLnurl(url: string): string {
  const words = bech32.toWords(Buffer.from(url, "utf8"));
  return bech32.encode("lnurl", words, 1500);
}

function getPublicBase(): string {
  return process.env.PUBLIC_BASE_URL || "https://pwsats.com";
}

function getMinBetSats(): number {
  const envVal = process.env.ZAP_MIN_SATS;
  return envVal ? parseInt(envVal, 10) : 250;
}

// In-memory pending zaps (paymentHash → zap details)
const pendingZaps = new Map<string, {
  zapRequestId: string;
  zapRequestJson: string;
  relays: string[];
  paymentHash: string;
  outcome: string | null;
  eventId: string;
  amountSats: number;
  senderPubkey: string;
  createdAt: Date;
}>();

// Cleanup stale pending zaps every 10 min
setInterval(() => {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  for (const [key, val] of pendingZaps) {
    if (val.createdAt < cutoff) {
      pendingZaps.delete(key);
      logger.info({ paymentHash: key.slice(0, 12) }, "Cleaned up stale pending zap");
    }
  }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// LNURL metadata route (mounted at root level: /.well-known/lnurlp/pwsats)
// ---------------------------------------------------------------------------

export function getLnurlMetadataRoute(): Router {
  const lnurlRouter = Router();

  lnurlRouter.get("/.well-known/lnurlp/pwsats", async (_req, res) => {
    try {
      const base = getPublicBase();
      const callbackUrl = `${base}/api/lnurl-zap/callback`;

      const metadata = await buildLnurlZapMetadata(callbackUrl);
      const lnurl = encodeLnurl(callbackUrl);

      logger.info({ nostrPubkey: metadata.nostrPubkey }, "Serving LNURL zap metadata");
      return res.json({ ...metadata, url: lnurl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, "Failed to build LNURL zap metadata");
      return res.status(503).json({ status: "ERROR", reason: "Zap receiver not configured" });
    }
  });

  return lnurlRouter;
}

// ---------------------------------------------------------------------------
// GET /api/lnurl-zap/callback
// ---------------------------------------------------------------------------

router.get("/callback", async (req, res) => {
  const { amount, nostr, lnurl } = req.query as {
    amount?: string;
    nostr?: string;
    lnurl?: string;
  };

  if (!amount || !nostr) {
    return res.json({ status: "ERROR", reason: "Missing 'amount' and 'nostr' query parameters" });
  }

  const amountMsats = parseInt(amount, 10);
  if (isNaN(amountMsats) || amountMsats <= 0) {
    return res.json({ status: "ERROR", reason: "Invalid amount" });
  }

  const minSats = getMinBetSats();
  if (amountMsats < minSats * 1000) {
    return res.json({ status: "ERROR", reason: `Minimum bet is ${minSats} sats` });
  }

  let parsed: ParsedZapRequest;
  try {
    parsed = await parseZapRequest(nostr, amountMsats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg }, "Zap request validation failed");
    return res.json({ status: "ERROR", reason: msg });
  }

  logger.info(
    {
      eventId: parsed.eventId,
      senderPubkey: parsed.senderPubkey.slice(0, 12),
      amountSats: parsed.amountSats,
      outcome: parsed.outcome,
    },
    "Zap request received — generating invoice",
  );

  try {
    const invoice = await createZapInvoice(parsed.amountSats, parsed.zapRequest.id, parsed.outcome || "home");

    pendingZaps.set(invoice.paymentHash, {
      zapRequestId: parsed.zapRequest.id,
      zapRequestJson: parsed.zapRequestJson,
      relays: parsed.relays,
      paymentHash: invoice.paymentHash,
      outcome: parsed.outcome,
      eventId: parsed.eventId,
      amountSats: parsed.amountSats,
      senderPubkey: parsed.senderPubkey,
      createdAt: new Date(),
    });

    return res.json({ pr: invoice.paymentRequest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to create zap invoice");
    return res.json({ status: "ERROR", reason: `Failed to create invoice: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// GET /api/lnurl-zap/status
// ---------------------------------------------------------------------------

router.get("/status", async (_req, res) => {
  const pubkey = await getNostrPubkey();
  const npub = await getNostrNpub();
  const relays = getRelays();
  const base = getPublicBase();

  return res.json({
    enabled: !!pubkey,
    publicKey: pubkey,
    npub,
    relays,
    callbackUrl: `${base}/api/lnurl-zap/callback`,
    lnurlMetadataUrl: `${base}/.well-known/lnurlp/pwsats`,
    pendingZapCount: pendingZaps.size,
    minBetSats: getMinBetSats(),
  });
});

// ---------------------------------------------------------------------------
// POST /api/lnurl-zap/receipt
// ---------------------------------------------------------------------------

router.post("/receipt", async (req, res) => {
  const { paymentHash, bolt11, preimage } = req.body as {
    paymentHash: string;
    bolt11: string;
    preimage?: string;
  };

  if (!paymentHash || !bolt11) {
    return res.status(400).json({ error: "Missing paymentHash or bolt11" });
  }

  const pending = pendingZaps.get(paymentHash);
  if (!pending) {
    return res.status(404).json({ error: "No pending zap found for this payment hash" });
  }

  try {
    const result = await publishZapReceipt(
      pending.zapRequestJson,
      bolt11,
      pending.relays,
      preimage || null,
    );

    const outcomeInfo = {
      outcome: pending.outcome,
      eventId: pending.eventId,
      amountSats: pending.amountSats,
      senderPubkey: pending.senderPubkey,
    };

    pendingZaps.delete(paymentHash);
    logger.info({ paymentHash, outcome: pending.outcome }, "Zap receipt published");

    return res.json({ success: true, ...result, outcome: outcomeInfo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, paymentHash }, "Failed to publish zap receipt");
    return res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/lnurl-zap/pending (internal/debug)
// ---------------------------------------------------------------------------

router.get("/pending", (_req, res) => {
  const pending = Array.from(pendingZaps.values()).map((p) => ({
    zapRequestId: p.zapRequestId,
    paymentHash: p.paymentHash.slice(0, 16) + "...",
    outcome: p.outcome,
    eventId: p.eventId,
    amountSats: p.amountSats,
    createdAt: p.createdAt.toISOString(),
  }));

  return res.json({ count: pending.length, pending });
});

export { pendingZaps };
export default router;
