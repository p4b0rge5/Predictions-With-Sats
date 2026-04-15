import { useState } from "react";
import { ChevronLeft, ChevronRight, Zap } from "lucide-react";
import type { ComponentType } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuideStep {
  icon: ComponentType<{ className?: string }>;
  color: string;       // icon text colour  e.g. "text-orange-400"
  iconBg: string;      // icon container bg + border  e.g. "bg-orange-400/15 border-orange-400/40"
  cardTint: string;    // full card subtle tint  e.g. "bg-orange-400/8"
  cardBorder: string;  // card border colour     e.g. "border-orange-400/30"
  title: string;
  body: string;
}

interface GuidePagerProps {
  steps: GuideStep[];
  onDone?: () => void;
  header: React.ReactNode;
  ctaLabel?: string;
  ctaClass?: string;
}

// ---------------------------------------------------------------------------
// GuidePager — one step at a time, page-style navigation
// ---------------------------------------------------------------------------

export function GuidePager({
  steps,
  onDone,
  header,
  ctaLabel = "Start Betting",
  ctaClass = "bg-yellow-400/10 border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/20",
}: GuidePagerProps) {
  const [page, setPage] = useState(0);
  const step = steps[page];
  const Icon = step.icon;
  const isFirst = page === 0;
  const isLast  = page === steps.length - 1;

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        {header}
      </div>

      {/* Page card — "nitidez": solid bg-card + subtle accent tint + sharp border */}
      <div
        className={`relative rounded-2xl border-2 ${step.cardBorder} bg-card overflow-hidden`}
      >
        {/* Subtle tint layer for visual identity */}
        <div className={`absolute inset-0 ${step.cardTint} pointer-events-none`} />

        <div className="relative flex flex-col items-center gap-4 px-6 pt-8 pb-6 text-center">
          {/* Step counter */}
          <span className="absolute top-3 right-4 text-[10px] font-mono text-muted-foreground tracking-widest">
            {page + 1} / {steps.length}
          </span>

          {/* Icon */}
          <div className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center shrink-0 ${step.iconBg}`}>
            <Icon className={`h-7 w-7 ${step.color}`} />
          </div>

          {/* Text */}
          <div className="space-y-2">
            <p className="text-sm font-bold font-mono uppercase tracking-wider text-foreground">
              {step.title}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
              {step.body}
            </p>
          </div>
        </div>

        {/* Navigation row */}
        <div className="relative flex items-center justify-between px-4 pb-5">
          {/* Prev */}
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={isFirst}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-border/50 bg-muted/40 hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Dot indicators */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`rounded-full transition-all ${
                  i === page
                    ? `w-5 h-2 ${step.color.replace("text-", "bg-")} opacity-90`
                    : "w-2 h-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                }`}
              />
            ))}
          </div>

          {/* Next */}
          <button
            onClick={() => setPage((p) => Math.min(steps.length - 1, p + 1))}
            disabled={isLast}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-border/50 bg-muted/40 hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* CTA — always visible so user can skip */}
      <button
        onClick={onDone}
        className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border font-mono font-bold text-sm uppercase tracking-wider transition-colors ${ctaClass}`}
      >
        <Zap className="h-4 w-4" />
        {ctaLabel}
      </button>
    </div>
  );
}
