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
import { saveBetHash } from "@/components/my-bet-widget";

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
  const [amountUsd, setAmountUsd] = useState<string>("1");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBet = useCreateBet();

  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [paymentRequest, setPaymentRequest] = useState<string | null>(null);
  const [weblnAvailable, setWeblnAvailable] = useState(false);
  const [weblnPaying, setWeblnPaying] = useState(false);

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
        if (state === "pending") return 3000;
        return false;
      },
      queryKey: getGetBetStatusQueryKey(paymentHash || ""),
    },
  });

  useEffect(() => {
    if (betStatus?.status === "paid" && paymentHash) {
      saveBetHash(paymentHash);
      toast({
        title: "Pagamento confirmado!",
        description: "Sua aposta está confirmada. Acompanhe o resultado na página inicial.",
        duration: 4000,
      });
    }
  }, [betStatus?.status, paymentHash]);

  const isUp = direction === "up";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountNum || amountNum < 0.05) {
      toast({ title: "Valor inválido", description: "Aposta mínima é $0.05", variant: "destructive" });
      return;
    }
    createBet.mutate(
      { data: { amountUsd: amountNum, direction } },
      {
        onSuccess: (data) => {
          setPaymentHash(data.paymentHash);
          setPaymentRequest(data.paymentRequest);
        },
        onError: (err) => {
          toast({ title: "Erro ao criar aposta", description: err.message || "Erro desconhecido", variant: "destructive" });
        },
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
      const msg = err instanceof Error ? err.message : "Pagamento falhou";
      if (!msg.toLowerCase().includes("user rejected") && !msg.toLowerCase().includes("cancelled")) {
        toast({ title: "Pagamento falhou", description: msg, variant: "destructive" });
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
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || "Servidor não conseguiu verificar o preimage");
    }
    await queryClient.invalidateQueries({ queryKey: getGetBetStatusQueryKey(paymentHash) });
  };

  const handleManualVerify = async () => {
    const trimmed = preimageInput.trim().toLowerCase();
    if (!trimmed || trimmed.length !== 64) {
      toast({ title: "Preimage inválido", description: "Deve ter 64 caracteres hexadecimais.", variant: "destructive" });
      return;
    }
    setVerifyingPreimage(true);
    try {
      await submitPreimage(trimmed);
      setShowPreimageInput(false);
      setPreimageInput("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verificação falhou";
      toast({ title: "Verificação falhou", description: msg, variant: "destructive" });
    } finally {
      setVerifyingPreimage(false);
    }
  };

  const copyToClipboard = () => {
    if (paymentRequest) {
      navigator.clipboard.writeText(paymentRequest);
      toast({ title: "Copiado!", duration: 2000 });
    }
  };

  const handleClose = () => {
    if (betStatus?.status === "pending") {
      toast({ title: "Invoice pendente", description: "Você ainda pode pagar essa invoice na sua carteira." });
    }
    setPaymentHash(null);
    setPaymentRequest(null);
    setAmountUsd("1");
    setShowPreimageInput(false);
    setPreimageInput("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md border-2 border-primary/20 bg-background/95 backdrop-blur font-mono max-h-[85dvh] overflow-y-auto w-[calc(100vw-2rem)] sm:w-auto p-4 sm:p-6">
        <DialogHeader className="pb-1">
          <DialogTitle className="text-lg font-bold uppercase tracking-wider flex items-center gap-2">
            Apostar <span className={isUp ? "text-green-500" : "text-red-500"}>{isUp ? "ALTA ↑" : "BAIXA ↓"}</span>
          </DialogTitle>
          <DialogDescription className="font-mono uppercase text-xs tracking-wider">
            Janela #{windowId}
          </DialogDescription>
        </DialogHeader>

        {!paymentRequest ? (
          /* ── Amount form ── */
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="amount" className="text-muted-foreground uppercase text-xs tracking-wider">
                Valor (USD)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="amount"
                  type="number"
                  min="0.05"
                  step="any"
                  value={amountUsd}
                  onChange={(e) => setAmountUsd(e.target.value)}
                  className="pl-8 text-xl font-bold h-12 bg-card/50"
                  autoFocus
                  data-testid="input-bet-amount"
                />
              </div>
              <div className="text-right text-xs text-muted-foreground">
                ≈ {new Intl.NumberFormat().format(satsAmount)} sats
              </div>
            </div>

            <Button
              type="submit"
              className={`w-full h-12 text-base font-bold uppercase tracking-wider text-white ${
                isUp ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
              }`}
              disabled={createBet.isPending || !satsAmount}
              data-testid="button-submit-bet"
            >
              {createBet.isPending ? "Gerando invoice..." : "Gerar Invoice"}
            </Button>
          </form>
        ) : (
          /* ── Invoice / payment screen — compact ── */
          <div className="pt-1 space-y-3">
            {betStatus?.status === "pending" || !betStatus ? (
              <>
                {/* QR + info side-by-side to minimise height */}
                <div className="flex items-center gap-3">
                  {/* QR — tappable to copy */}
                  <div
                    className="shrink-0 bg-white p-2 rounded-lg shadow cursor-pointer relative group"
                    onClick={copyToClipboard}
                    title="Clique para copiar"
                  >
                    <QRCodeSVG value={paymentRequest} size={130} level="M" includeMargin={false} />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                      <Copy className="h-6 w-6 text-white" />
                    </div>
                  </div>

                  {/* Info column */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pagar</p>
                      <p className="text-lg font-bold text-yellow-400 leading-tight">
                        {new Intl.NumberFormat().format(satsAmount)} sats
                      </p>
                      <p className="text-xs text-muted-foreground">≈ ${amountUsd} USD</p>
                    </div>

                    {/* Copy button */}
                    <button
                      type="button"
                      onClick={copyToClipboard}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 bg-muted/50 rounded-lg border border-border/60 hover:bg-muted/80 transition-colors text-left overflow-hidden"
                    >
                      <span className="flex-1 min-w-0 text-[10px] font-mono text-muted-foreground truncate">
                        {paymentRequest.slice(0, 16)}…
                      </span>
                      <span className="shrink-0 flex items-center gap-1 text-[10px] text-primary font-bold uppercase tracking-wider">
                        <Copy className="h-3 w-3" />
                        Copiar
                      </span>
                    </button>

                    {/* Status */}
                    <div className="flex items-center gap-1.5 text-yellow-500 text-[11px] animate-pulse uppercase tracking-wider font-bold">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      Aguardando pagamento...
                    </div>
                  </div>
                </div>

                {/* WebLN */}
                {weblnAvailable && (
                  <Button
                    onClick={handleWeblnPay}
                    disabled={weblnPaying}
                    className="w-full h-10 font-bold uppercase tracking-wider bg-yellow-500 hover:bg-yellow-400 text-black text-sm"
                    data-testid="button-webln-pay"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    {weblnPaying ? "Pagando..." : "Pagar com WebLN"}
                  </Button>
                )}

                {/* Manual preimage verify — collapsible */}
                <div className="border border-muted rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowPreimageInput(!showPreimageInput)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-[11px] text-muted-foreground uppercase tracking-wider hover:bg-muted/30 transition-colors"
                    data-testid="button-toggle-preimage"
                  >
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Já paguei? Verificar manualmente
                    </span>
                    {showPreimageInput ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>

                  {showPreimageInput && (
                    <div className="px-3 pb-3 space-y-2 bg-muted/10 border-t border-muted">
                      <p className="text-xs text-muted-foreground pt-2 text-left leading-relaxed">
                        Cole o <strong className="text-foreground">preimage</strong> (hex de 64 caracteres) da sua carteira.
                      </p>
                      <Input
                        placeholder="Cole o preimage de 64 caracteres..."
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
                        {verifyingPreimage ? "Verificando..." : "Confirmar Pagamento"}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : betStatus.status === "paid" ? (
              <div className="space-y-4 py-4 flex flex-col items-center">
                <CheckCircle2 className="h-14 w-14 text-green-500" />
                <div className="text-xl font-bold uppercase tracking-wider text-green-500">Pagamento Recebido!</div>
                <p className="text-muted-foreground text-sm text-center">Sua aposta está confirmada. Boa sorte!</p>
                <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">
                  Fechar
                </Button>
              </div>
            ) : (
              <div className="space-y-4 py-4 flex flex-col items-center">
                <XCircle className="h-14 w-14 text-red-500" />
                <div className="text-xl font-bold uppercase tracking-wider text-red-500">Pagamento Falhou ou Expirou</div>
                <Button onClick={handleClose} className="w-full font-bold uppercase tracking-wider" variant="outline">
                  Fechar
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
