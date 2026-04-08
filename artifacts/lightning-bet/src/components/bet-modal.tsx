import { useState, useEffect } from "react";
import { useCreateBet, useGetBetStatus, getGetBetStatusQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, XCircle, Clock, Zap, ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import { saveBetHash } from "@/components/my-bet-widget";

interface BetModalProps {
  isOpen: boolean;
  onClose: () => void;
  direction: "up" | "down";
  btcPriceUsd: number;
  windowId: number;
  asset: "btc" | "eth" | "sol";
}

declare global {
  interface Window {
    webln?: {
      enable: () => Promise<void>;
      sendPayment: (paymentRequest: string) => Promise<{ preimage: string }>;
    };
  }
}

type InputMode = "sats" | "usd";

const SATS_PRESETS = [546, 1000, 5000, 10000];
const USD_PRESETS  = [0.5, 1, 5, 10];

function AmountToggle({ mode, onChange }: { mode: InputMode; onChange: (m: InputMode) => void }) {
  return (
    <div className="flex gap-0 p-0.5 rounded-md bg-muted/50 border border-border/40 w-fit self-end">
      {(["sats", "usd"] as InputMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={`px-3 py-1 rounded text-[11px] font-mono font-bold uppercase tracking-wider transition-colors ${
            mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {m === "sats" ? "⚡ Sats" : "$ USD"}
        </button>
      ))}
    </div>
  );
}

const API_BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export function BetModal({ isOpen, onClose, direction, btcPriceUsd, windowId, asset }: BetModalProps) {
  const [inputMode, setInputMode]   = useState<InputMode>("usd");
  const [rawAmount, setRawAmount]   = useState<string>("0.5");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBet = useCreateBet();

  const [paymentHash, setPaymentHash]   = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<string | null>(null);
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [weblnPaying, setWeblnPaying]   = useState(false);
  const [showPreimageInput, setShowPreimageInput] = useState(false);
  const [preimageInput, setPreimageInput] = useState("");
  const [verifyingPreimage, setVerifyingPreimage] = useState(false);

  // Always fetch the real BTC/USD rate for sats conversion — the invoice is always in
  // satoshis regardless of which prediction market (BTC / ETH / SOL) the user is betting on.
  const { data: btcMarket } = useQuery<{ btcPriceUsd: number }>({
    queryKey: ["/api/market/current", "btc"],
    queryFn: () => fetch(`${API_BASE}/api/market/current?asset=btc`).then((r) => r.json() as Promise<{ btcPriceUsd: number }>),
    refetchInterval: 30_000,
    staleTime: 10_000,
    enabled: isOpen,
  });
  // Use the freshly fetched BTC rate; fall back to the prop while it loads.
  const btcRate = btcMarket?.btcPriceUsd && btcMarket.btcPriceUsd > 0 ? btcMarket.btcPriceUsd : btcPriceUsd;

  const satsAmount = inputMode === "sats"
    ? (parseInt(rawAmount, 10) || 0)
    : (btcRate > 0 ? Math.floor((parseFloat(rawAmount) || 0) / btcRate * 100_000_000) : 0);
  const usdAmount = inputMode === "usd"
    ? (parseFloat(rawAmount) || 0)
    : (satsAmount / 100_000_000 * btcRate);

  useEffect(() => { setWeblnAvailable(typeof window.webln !== "undefined"); }, []);

  const { data: betStatus } = useGetBetStatus(paymentHash || "", {
    query: {
      enabled: !!paymentHash,
      refetchInterval: (query) => {
        const state = query.state.data?.status;
        if (state === "pending") return 3000;
        return false;
      },
      queryKey: getGetBetStatusQueryKey(paymentHash || ""),
    },
  });

  useEffect(() => {
    if (betStatus?.status === "paid" && paymentHash) {
      saveBetHash(paymentHash);
      toast({ title: "Payment confirmed!", description: "Your bet is confirmed. Check the result on the home page.", duration: 4000 });
    }
  }, [betStatus?.status, paymentHash]);

  const isUp = direction === "up";

  const handleModeChange = (m: InputMode) => {
    setInputMode(m);
    setRawAmount(m === "sats" ? "1000" : "0.5");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (usdAmount < 0.50) {
      toast({ title: "Invalid amount", description: "Minimum bet is $0.50 USD", variant: "destructive" });
      return;
    }
    createBet.mutate(
      { data: { amountUsd: usdAmount, direction, asset } },
      {
        onSuccess: (data) => { setPaymentHash(data.paymentHash); setPaymentRequest(data.paymentRequest); },
        onError: (err) => { toast({ title: "Error creating bet", description: err.message || "Unknown error", variant: "destructive" }); },
      }
    );
  };

  const handleWeblnPay = async () => {
    if (!paymentRequest || !paymentHash || !window.webln) return;
    setWeblnPaying(true);
    try {
      await window.webln.enable();
      const result = await window.webln.sendPayment(paymentRequest);
      await submitPreimage(result.preimage);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Payment failed";
      if (!msg.toLowerCase().includes("user rejected") && !msg.toLowerCase().includes("cancelled")) {
        toast({ title: "Payment failed", description: msg, variant: "destructive" });
      }
    } finally { setWeblnPaying(false); }
  };

  const submitPreimage = async (preimage: string) => {
    if (!paymentHash) return;
    const res = await fetch(`/api/bet/${paymentHash}/verify-preimage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preimage }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "Server could not verify the preimage");
    }
    await queryClient.invalidateQueries({ queryKey: getGetBetStatusQueryKey(paymentHash) });
  };

  const handleManualVerify = async () => {
    const trimmed = preimageInput.trim().toLowerCase();
    if (!trimmed || trimmed.length !== 64) {
      toast({ title: "Invalid preimage", description: "Must be 64 hexadecimal characters.", variant: "destructive" });
      return;
    }
    setVerifyingPreimage(true);
    try {
      await submitPreimage(trimmed);
      setShowPreimageInput(false);
      setPreimageInput("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      toast({ title: "Verification failed", description: msg, variant: "destructive" });
    } finally { setVerifyingPreimage(false); }
  };

  const copyToClipboard = () => {
    if (paymentRequest) { navigator.clipboard.writeText(paymentRequest); toast({ title: "Copied!", duration: 2000 }); }
  };

  const handleClose = () => {
    if (betStatus?.status === "pending") {
      toast({ title: "Pending invoice", description: "You can still pay this invoice from your wallet." });
    }
    setPaymentHash(null); setPaymentRequest(null);
    setInputMode("usd"); setRawAmount("0.5");
    setShowPreimageInput(false); setPreimageInput("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md border-2 border-primary/20 bg-background/95 backdrop-blur font-mono max-h-[85dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:w-auto p-4 sm:p-6">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-lg font-bold uppercase tracking-wider flex items-center gap-2">
            Bet <span className={isUp ? "text-green-500" : "text-red-500"}>{isUp ? "UP ↑" : "DOWN ↓"}</span>
          </DialogTitle>
          <DialogDescription className="font-mono uppercase text-xs tracking-wider">
            Window #{windowId}
          </DialogDescription>
        </DialogHeader>

        {!paymentRequest ? (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground uppercase text-xs tracking-wider">
                  Amount ({inputMode === "sats" ? "Sats" : "USD"})
                </Label>
                <AmountToggle mode={inputMode} onChange={handleModeChange} />
              </div>

              {inputMode === "usd" ? (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    type="number" min="0" step="any"
                    value={rawAmount} onChange={(e) => setRawAmount(e.target.value)}
                    className="pl-8 text-xl font-bold h-12 bg-card/50" autoFocus
                    data-testid="input-bet-amount"
                  />
                </div>
              ) : (
                <Input
                  type="number" min="1" step="1"
                  value={rawAmount} onChange={(e) => setRawAmount(e.target.value)}
                  className="text-xl font-bold h-12 bg-card/50" autoFocus
                  data-testid="input-bet-amount"
                />
              )}

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Min: $0.50 USD</span>
                {inputMode === "sats"
                  ? <span>≈ ${usdAmount.toFixed(2)} USD</span>
                  : <span>≈ {new Intl.NumberFormat("en-US").format(satsAmount)} sats</span>
                }
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {inputMode === "sats"
                ? SATS_PRESETS.map((v) => (
                    <button type="button" key={v} onClick={() => setRawAmount(String(v))}
                      className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors">
                      {v >= 1000 ? `${v / 1000}k` : v}
                    </button>
                  ))
                : USD_PRESETS.map((v) => (
                    <button type="button" key={v} onClick={() => setRawAmount(String(v))}
                      className="py-1.5 rounded-md border border-border/50 text-[11px] font-mono hover:bg-muted/50 transition-colors">
                      ${v}
                    </button>
                  ))
              }
            </div>

            <Button
              type="submit"
              className={`w-full h-12 text-base font-bold uppercase tracking-wider text-white ${
                isUp ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
              }`}
              disabled={createBet.isPending || usdAmount < 0.50}
              data-testid="button-submit-bet"
            >
              {createBet.isPending ? "Generating invoice..." : "Generate Invoice"}
            </Button>
          </form>
        ) : (
          <div className="pt-1 space-y-3">
            {betStatus?.status === "pending" || !betStatus ? (
              <>
                <div className="text-center">
                  <p className="text-xl font-bold text-yellow-400 leading-tight">
                    Pay {new Intl.NumberFormat("en-US").format(satsAmount)} sats
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">≈ ${usdAmount.toFixed(2)} USD</p>
                </div>

                <div className="flex justify-center">
                  <div className="bg-white p-2.5 rounded-xl shadow-lg cursor-pointer relative group" onClick={copyToClipboard} title="Click to copy">
                    <QRCodeSVG value={paymentRequest} size={180} level="M" includeMargin={false} />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                      <Copy className="h-8 w-8 text-white" />
                    </div>
                  </div>
                </div>

                <button type="button" onClick={copyToClipboard}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/50 rounded-lg border border-border/60 hover:bg-muted/80 transition-colors text-left overflow-hidden">
                  <span className="flex-1 min-w-0 text-xs font-mono text-muted-foreground truncate">{paymentRequest.slice(0, 28)}…</span>
                  <span className="shrink-0 flex items-center gap-1.5 text-xs text-primary font-bold uppercase tracking-wider">
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </span>
                </button>

                <div className="flex items-center justify-center gap-2 text-yellow-500 text-sm animate-pulse uppercase tracking-wider font-bold">
                  <Clock className="h-4 w-4 shrink-0" /> Waiting for payment...
                </div>

                {weblnAvailable && (
                  <Button onClick={handleWeblnPay} disabled={weblnPaying}
                    className="w-full h-10 font-bold uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-black text-sm"
                    data-testid="button-webln-pay">
                    <Zap className="h-4 w-4 mr-2" />
                    {weblnPaying ? "Paying..." : "Pay with WebLN"}
                  </Button>
                )}

                <div className="border border-muted rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setShowPreimageInput(!showPreimageInput)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider hover:bg-muted/30 transition-colors"
                    data-testid="button-toggle-preimage">
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5" /> Already paid? Verify manually
                    </span>
                    {showPreimageInput ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {showPreimageInput && (
                    <div className="px-3 pb-3 space-y-2 bg-muted/10 border-t border-muted">
                      <p className="text-xs text-muted-foreground pt-2 text-left leading-relaxed">
                        After payment, your wallet shows a <strong className="text-foreground">preimage</strong> (proof of payment). Paste the 64-char hex below.
                      </p>
                      <Input placeholder="Paste 64-char preimage..." value={preimageInput}
                        onChange={(e) => setPreimageInput(e.target.value)}
                        className="font-mono text-xs bg-background" data-testid="input-preimage" />
                      <Button onClick={handleManualVerify}
                        disabled={verifyingPreimage || preimageInput.trim().length !== 64}
                        className="w-full font-bold uppercase tracking-wider" variant="outline" size="sm"
                        data-testid="button-verify-preimage">
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        {verifyingPreimage ? "Verifying..." : "Confirm Payment"}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : betStatus.status === "paid" ? (
              <div className="space-y-4 py-4 flex flex-col items-center">
                <CheckCircle2 className="h-14 w-14 text-green-500" />
                <div className="text-xl font-bold uppercase tracking-wider text-green-500">Payment Received!</div>
                <p className="text-muted-foreground text-sm text-center">Your bet is confirmed. Good luck!</p>
                <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">Close</Button>
              </div>
            ) : (
              <div className="space-y-4 py-4 flex flex-col items-center">
                <XCircle className="h-14 w-14 text-red-500" />
                <div className="text-xl font-bold uppercase tracking-wider text-red-500">Payment Failed or Expired</div>
                <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">Close</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
