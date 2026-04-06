import { useState, useEffect } from "react";
import { useCreateBet, useGetBetStatus, getGetBetStatusQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, XCircle, Clock, Zap, ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import { saveLastBetHash } from "@/components/my-bet-widget";

interface BetModalProps {
  isOpen: boolean;
  onClose: () => void;
  direction: "up" | "down";
  btcPriceUsd: number;
  windowId: number;
}

declare global {
  interface Window {
    webln?: {
      enable: () => Promise<void>;
      sendPayment: (paymentRequest: string) => Promise<{ preimage: string }>;
    };
  }
}

export function BetModal({ isOpen, onClose, direction, btcPriceUsd, windowId }: BetModalProps) {
  const [amountUsd, setAmountUsd] = useState<string>("5");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBet = useCreateBet();

  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<string | null>(null);
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [weblnPaying, setWeblnPaying] = useState(false);

  // Manual preimage verification state
  const [showPreimageInput, setShowPreimageInput] = useState(false);
  const [preimageInput, setPreimageInput] = useState("");
  const [verifyingPreimage, setVerifyingPreimage] = useState(false);

  const amountNum = parseFloat(amountUsd);
  const satsAmount = !isNaN(amountNum) && amountNum > 0 ? Math.floor((amountNum / btcPriceUsd) * 100000000) : 0;

  useEffect(() => {
    setWeblnAvailable(typeof window.webln !== "undefined");
  }, []);

  const { data: betStatus } = useGetBetStatus(paymentHash || "", {
    query: {
      enabled: !!paymentHash,
      refetchInterval: (query) => {
        const state = query.state.data?.status;
        // Keep polling while pending (waiting for LUD-21 auto-confirm)
        if (state === "pending") return 3000;
        return false;
      },
      queryKey: getGetBetStatusQueryKey(paymentHash || "")
    }
  });

  // When LUD-21 auto-confirms the payment, save the hash to localStorage so the
  // MyBetWidget on the home page can track the result even after the modal closes.
  useEffect(() => {
    if (betStatus?.status === "paid" && paymentHash) {
      saveLastBetHash(paymentHash);
      toast({ title: "Payment confirmed!", description: "Your bet is locked in. Check the homepage to see your result.", duration: 4000 });
    }
  }, [betStatus?.status, paymentHash]);

  const isUp = direction === "up";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountNum || amountNum < 1) {
      toast({ title: "Invalid amount", description: "Minimum bet is $1", variant: "destructive" });
      return;
    }

    createBet.mutate({ data: { amountUsd: amountNum, direction } }, {
      onSuccess: (data) => {
        setPaymentHash(data.paymentHash);
        setPaymentRequest(data.paymentRequest);
      },
      onError: (err) => {
        toast({
          title: "Error creating bet",
          description: err.message || "Unknown error occurred",
          variant: "destructive"
        });
      }
    });
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
    } finally {
      setWeblnPaying(false);
    }
  };

  const submitPreimage = async (preimage: string) => {
    if (!paymentHash) return;
    const res = await fetch(`/api/bet/${paymentHash}/verify-preimage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preimage }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || "Server could not verify preimage");
    }

    await queryClient.invalidateQueries({
      queryKey: getGetBetStatusQueryKey(paymentHash),
    });
    // saveLastBetHash and confirmation toast are handled by the betStatus useEffect above
  };

  const handleManualVerify = async () => {
    const trimmed = preimageInput.trim().toLowerCase();
    if (!trimmed || trimmed.length !== 64) {
      toast({ title: "Invalid preimage", description: "Payment proof must be 64 hex characters.", variant: "destructive" });
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
    } finally {
      setVerifyingPreimage(false);
    }
  };

  const copyToClipboard = () => {
    if (paymentRequest) {
      navigator.clipboard.writeText(paymentRequest);
      toast({ title: "Copied to clipboard", duration: 2000 });
    }
  };

  const handleClose = () => {
    if (betStatus?.status === "pending") {
      toast({ title: "Invoice pending", description: "You can still pay this invoice in your wallet." });
    }
    setPaymentHash(null);
    setPaymentRequest(null);
    setAmountUsd("5");
    setShowPreimageInput(false);
    setPreimageInput("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md border-2 border-primary/20 bg-background/95 backdrop-blur font-mono">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold uppercase tracking-wider flex items-center gap-2">
            Bet <span className={isUp ? "text-green-500" : "text-red-500"}>{direction}</span>
          </DialogTitle>
          <DialogDescription className="font-mono uppercase text-xs tracking-wider">
            Window #{windowId}
          </DialogDescription>
        </DialogHeader>

        {!paymentRequest ? (
          <form onSubmit={handleSubmit} className="space-y-6 pt-4">
            <div className="space-y-2">
              <Label htmlFor="amount" className="text-muted-foreground uppercase text-xs tracking-wider">Amount (USD)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="amount"
                  type="number"
                  min="1"
                  step="0.01"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  className="pl-8 text-xl font-bold h-14 bg-card/50"
                  autoFocus
                  data-testid="input-bet-amount"
                />
              </div>
              <div className="text-right text-sm text-muted-foreground">
                ≈ {new Intl.NumberFormat().format(satsAmount)} sats
              </div>
            </div>

            <Button
              type="submit"
              className={`w-full h-14 text-lg font-bold uppercase tracking-wider text-white ${isUp ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-900' : 'bg-red-600 hover:bg-red-700 disabled:bg-red-900'}`}
              disabled={createBet.isPending || !satsAmount}
              data-testid="button-submit-bet"
            >
              {createBet.isPending ? "Generating Invoice..." : "Generate Invoice"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col items-center py-6 space-y-6 text-center">
            {betStatus?.status === "pending" || !betStatus ? (
              <>
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground uppercase tracking-wider">Pay Invoice</div>
                  <div className="text-2xl font-bold text-yellow-400">{new Intl.NumberFormat().format(satsAmount)} sats</div>
                </div>

                <div className="bg-white p-4 rounded-xl shadow-lg relative group cursor-pointer" onClick={copyToClipboard}>
                  <QRCodeSVG
                    value={paymentRequest}
                    size={200}
                    level="M"
                    includeMargin={false}
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
                    <Copy className="h-8 w-8 text-white" />
                  </div>
                </div>

                <div className="w-full flex items-center gap-2 p-3 bg-muted/50 rounded border text-sm font-mono break-all cursor-pointer hover:bg-muted/80 transition-colors" onClick={copyToClipboard}>
                  <div className="truncate opacity-70">{paymentRequest.slice(0, 30)}...{paymentRequest.slice(-10)}</div>
                  <Copy className="h-4 w-4 shrink-0 opacity-50 ml-auto" />
                </div>

                {weblnAvailable && (
                  <Button
                    onClick={handleWeblnPay}
                    disabled={weblnPaying}
                    className="w-full h-12 font-bold uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-black"
                    data-testid="button-webln-pay"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    {weblnPaying ? "Paying..." : "Pay with WebLN"}
                  </Button>
                )}

                <div className="flex items-center gap-2 text-yellow-500 text-sm animate-pulse uppercase tracking-wider font-bold">
                  <Clock className="h-4 w-4" />
                  Waiting for payment...
                </div>

                {/* Manual preimage verification */}
                <div className="w-full border border-muted rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowPreimageInput(!showPreimageInput)}
                    className="w-full flex items-center justify-between px-4 py-3 text-xs text-muted-foreground uppercase tracking-wider hover:bg-muted/30 transition-colors"
                    data-testid="button-toggle-preimage"
                  >
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Already paid? Verify manually
                    </span>
                    {showPreimageInput ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>

                  {showPreimageInput && (
                    <div className="px-4 pb-4 space-y-3 bg-muted/10 border-t border-muted">
                      <p className="text-xs text-muted-foreground pt-3 text-left leading-relaxed">
                        After paying, your wallet shows a <strong className="text-foreground">payment proof</strong> (preimage). Paste the 64-character hex string below to confirm your bet instantly.
                      </p>
                      <Input
                        placeholder="Paste 64-char payment preimage..."
                        value={preimageInput}
                        onChange={(e) => setPreimageInput(e.target.value)}
                        className="font-mono text-xs bg-background"
                        data-testid="input-preimage"
                      />
                      <Button
                        onClick={handleManualVerify}
                        disabled={verifyingPreimage || preimageInput.trim().length !== 64}
                        className="w-full font-bold uppercase tracking-wider"
                        variant="outline"
                        size="sm"
                        data-testid="button-verify-preimage"
                      >
                        <ShieldCheck className="h-4 w-4 mr-2" />
                        {verifyingPreimage ? "Verifying..." : "Confirm Payment"}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : betStatus.status === "paid" ? (
              <div className="space-y-4 py-8 flex flex-col items-center">
                <CheckCircle2 className="h-16 w-16 text-green-500 mb-2" />
                <div className="text-xl font-bold uppercase tracking-wider text-green-500">Payment Received!</div>
                <p className="text-muted-foreground text-sm">Your bet is locked in. Good luck.</p>
                <Button onClick={handleClose} className="mt-4 w-full font-bold uppercase tracking-wider" variant="outline">
                  Close
                </Button>
              </div>
            ) : (
              <div className="space-y-4 py-8 flex flex-col items-center">
                <XCircle className="h-16 w-16 text-red-500 mb-2" />
                <div className="text-xl font-bold uppercase tracking-wider text-red-500">Payment Failed or Expired</div>
                <Button onClick={handleClose} className="mt-4 w-full font-bold uppercase tracking-wider" variant="outline">
                  Close
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
