import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

function normalizeErrorDescription(description?: string): string | undefined {
  if (!description) return description;

  const trimmed = description.trim();
  const lower = trimmed.toLowerCase();

  if (
    lower.includes("502 bad gateway") ||
    lower.includes("503 service unavailable") ||
    lower.includes("504 gateway timeout") ||
    lower.includes("proxy error") ||
    lower.includes("upstream") ||
    lower.includes("unable to") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror")
  ) {
    return "The API is temporarily unavailable. Try again in a few seconds.";
  }

  return trimmed;
}

export function LoadingState({
  label = "Loading…",
  className,
  spinnerClassName,
  labelClassName,
}: {
  label?: string;
  className?: string;
  spinnerClassName?: string;
  labelClassName?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center h-[60vh]", className)}>
      <div className="flex flex-col items-center gap-4">
        <Spinner className={cn("h-8 w-8 text-primary", spinnerClassName)} />
        <p className={cn("font-mono text-sm text-muted-foreground tracking-widest", labelClassName)}>
          {label}
        </p>
      </div>
    </div>
  );
}

export function ErrorState({
  title = "FAILED TO LOAD DATA",
  description,
  onRetry,
  className,
  cardClassName,
  titleClassName,
  descriptionClassName,
  retryLabel = "Retry",
  compact = false,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
  cardClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  retryLabel?: string;
  compact?: boolean;
}) {
  const normalizedDescription = normalizeErrorDescription(description);

  return (
    <div className={cn("flex items-center justify-center px-6", compact ? "h-40" : "h-[60vh]", className)}>
      <div
        className={cn(
          "flex max-w-md flex-col items-center gap-4 rounded-xl border p-6 text-center",
          compact ? "gap-2 p-4" : "",
          cardClassName,
        )}
      >
        <AlertCircle className={cn("text-red-400", compact ? "h-8 w-8" : "h-8 w-8")} />
        <p className={cn("font-mono text-sm tracking-widest text-red-300", titleClassName)}>
          {title}
        </p>
        {normalizedDescription ? (
          <p className={cn("text-sm text-muted-foreground", compact ? "text-xs" : "", descriptionClassName)}>
            {normalizedDescription}
          </p>
        ) : null}
        {onRetry ? (
          <Button variant="outline" size={compact ? "sm" : "default"} onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
