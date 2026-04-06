import { useGetBetStatus, getGetBetStatusQueryKey } from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, Trophy, Copy, X, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "lightning_bet_last_hash";

export function saveLastBetHash(paymentHash: string) {
  localStorage.setItem(STORAGE_KEY, paymentHash);
}

export function clearLastBetHash() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getLastBetHash(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

interface MyBetWidgetProps {
  paymentHash: string;
  onDismiss: () => void;
}

export function MyBetWidget({ paymentHash, onDismiss }: MyBetWidgetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: bet } = useGetBetStatus(paymentHash, {
    query: {
      enabled: true,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "pending") return 3000;
        if (status === "paid") return 15000;
        if (status === "won" && query.state.data?.withdrawStatus === "unclaimed") return 15000;
        return false;
      },
      queryKey: getGetBetStatusQueryKey(paymentHash),
    },
  });

  const handleCopyLnurl = (lnurl: string) => {
    navigator.clipboard.writeText(lnurl);
    toast({ title: "LNURL copied!", description: "Paste into your Lightning wallet.", duration: 3000 });
  };

  const handleClaimSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: getGetBetStatusQueryKey(paymentHash) });
    toast({ title: "Payout on its way!", description: "Your winnings are being sent.", duration: 4000 });
  };

  if (!bet) return null;

  const isUp = bet.direction === "up";
  const dirColor = isUp ? "text-green-500" : "text-red-500";

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur p-4 font-mono relative">
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        My Last Bet — Window #{bet.windowId}
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className={`font-bold text-lg ${dirColor}`}>{bet.direction.toUpperCase()}</span>
        <span className="text-muted-foreground text-sm">{new Intl.NumberFormat().format(bet.amountSats)} sats</span>
        {bet.status === "won" && bet.payoutSats && (
          <span className="text-green-400 text-sm ml-auto">+{new Intl.NumberFormat().format(bet.payoutSats)} sats</span>
        )}
      </div>

      {/* Status badge */}
      {bet.status === "pending" && (
        <div className="flex items-center gap-2 text-yellow-500 text-xs animate-pulse">
          <Clock className="h-3.5 w-3.5" />
          Awaiting payment confirmation...
        </div>
      )}

      {bet.status === "paid" && (
        <div className="flex items-center gap-2 text-blue-400 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Bet confirmed — waiting for window to settle...
        </div>
      )}

      {bet.status === "lost" && (
        <div className="flex items-center gap-2 text-red-500 text-xs">
          <XCircle className="h-3.5 w-3.5" />
          Better luck next round!
        </div>
      )}

      {bet.status === "expired" && (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <XCircle className="h-3.5 w-3.5" />
          Bet expired
        </div>
      )}

      {bet.status === "won" && bet.withdrawStatus === "claimed" && (
        <div className="flex items-center gap-2 text-green-500 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Payout claimed! 🎉
        </div>
      )}

      {/* CLAIM WINNINGS — show QR for unclaimed wins */}
      {bet.status === "won" && bet.withdrawStatus === "unclaimed" && bet.withdrawLnurl && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold uppercase tracking-wider animate-pulse">
            <Trophy className="h-3.5 w-3.5" />
            You won! Scan to claim your payout
          </div>
          <div className="flex flex-col items-center gap-3 pt-1">
            <div
              className="bg-white p-3 rounded-lg cursor-pointer relative group"
              onClick={() => handleCopyLnurl(bet.withdrawLnurl!)}
              title="Click to copy LNURL"
            >
              <QRCodeSVG value={bet.withdrawLnurl} size={160} level="M" includeMargin={false} />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                <Copy className="h-6 w-6 text-white" />
              </div>
            </div>
            <div className="flex gap-2 w-full">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 font-bold uppercase tracking-wider text-xs"
                onClick={() => handleCopyLnurl(bet.withdrawLnurl!)}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copy LNURL
              </Button>
              <Button
                variant="default"
                size="sm"
                className="flex-1 font-bold uppercase tracking-wider text-xs bg-yellow-500 hover:bg-yellow-400 text-black"
                onClick={handleClaimSuccess}
              >
                <Gift className="h-3.5 w-3.5 mr-1.5" />
                I've claimed!
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
              Open your Lightning wallet → Scan QR or paste LNURL → Receive {new Intl.NumberFormat().format(bet.payoutSats ?? 0)} sats
            </p>
          </div>
        </div>
      )}

      {bet.status === "won" && bet.withdrawStatus === "unclaimed" && !bet.withdrawLnurl && (
        <div className="flex items-center gap-2 text-yellow-400 text-xs animate-pulse mt-1">
          <Trophy className="h-3.5 w-3.5" />
          You won {new Intl.NumberFormat().format(bet.payoutSats ?? 0)} sats — generating payout link...
        </div>
      )}
    </div>
  );
}
