"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** One-line wrapper so every hint in the app uses the same shadcn tooltip. */
export function Tip({ label, children, side = "top" }: { label: React.ReactNode; children: React.ReactElement; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A section heading inside a panel: sentence case and quiet, so content leads. */
export function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`text-[12.5px] font-semibold tracking-[-0.005em] text-ink-2 ${className}`}>{children}</h3>;
}
