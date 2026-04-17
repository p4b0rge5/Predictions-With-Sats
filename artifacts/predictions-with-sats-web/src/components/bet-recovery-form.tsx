import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BetRecoveryFormProps {
  description: string;
  onRecover: (paymentHash: string) => void | Promise<void>;
  buttonLabel?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

function isPaymentHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export function BetRecoveryForm({
  description,
  onRecover,
  buttonLabel = "Import",
  className = "",
  placeholder = "payment hash (64 hex chars)",
  disabled = false,
}: BetRecoveryFormProps) {
  const [paymentHash, setPaymentHash] = useState("");
  const normalizedHash = paymentHash.trim().toLowerCase();
  const isValid = isPaymentHash(normalizedHash);

  return (
    <div className={`space-y-2 ${className}`}>
      <p className="text-[10px] text-muted-foreground">{description}</p>
      <div className="flex gap-2">
        <Input
          value={paymentHash}
          onChange={(e) => setPaymentHash(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-xs h-8"
          disabled={disabled}
        />
        <Button
          size="sm"
          className="h-8 text-xs shrink-0"
          disabled={!isValid || disabled}
          onClick={async () => {
            await onRecover(normalizedHash);
            setPaymentHash("");
          }}
        >
          <Search className="h-3 w-3 mr-1.5" />
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
