"use client";

import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Layout, PanelImperativeHandle } from "react-resizable-panels";
import { usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { isTyping } from "@/lib/keys";
import { LAYOUT_COOKIE } from "@/lib/layout-cookie";
import { Tip } from "./Tip";

type Side = "left" | "right";

const NAME: Record<Side, string> = { left: "agents panel", right: "analysis panel" };
const KEY: Record<Side, string> = { left: "[", right: "]" };

/** Collapse button that lives in a panel's own header. */
export function CollapseButton({ side, onClick }: { side: Side; onClick: () => void }) {
  const Icon = side === "left" ? PanelLeftClose : PanelRightClose;
  return (
    <Tip
      label={
        <span className="flex items-center gap-2">
          Collapse {NAME[side]} <Kbd>{KEY[side]}</Kbd>
        </span>
      }
    >
      <Button variant="ghost" size="icon-xs" className="hidden text-muted-foreground lg:inline-flex" aria-label={`Collapse ${NAME[side]}`} onClick={onClick}>
        <Icon />
      </Button>
    </Tip>
  );
}

function ExpandButton({ side, onClick }: { side: Side; onClick: () => void }) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <Tip
      label={
        <span className="flex items-center gap-2">
          Show {NAME[side]} <Kbd>{KEY[side]}</Kbd>
        </span>
      }
      side={side === "left" ? "right" : "left"}
    >
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Show ${NAME[side]}`}
        onClick={onClick}
        className={`absolute top-1/2 z-20 hidden -translate-y-1/2 bg-card shadow-[var(--shadow-sm)] lg:inline-flex ${side === "left" ? "left-2" : "right-2"}`}
      >
        <Icon />
      </Button>
    </Tip>
  );
}

function useCollapsible(ref: React.RefObject<PanelImperativeHandle | null>, initiallyCollapsed: boolean) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const toggle = useCallback(() => {
    const p = ref.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  }, [ref]);
  const onResize = useCallback((size: { asPercentage: number }) => setCollapsed(size.asPercentage === 0), []);
  return { collapsed, toggle, onResize };
}

/**
 * Three resizable columns on wide screens (agents · graph · analysis); the side columns collapse
 * to nothing. The layout is saved to a cookie so the server renders it at the saved sizes
 * (no layout shift on load). Below `lg` the columns stack and resizing is off.
 */
export function Shell({
  defaultLayout,
  left,
  main,
  right,
}: {
  defaultLayout?: Layout;
  left: (collapse: () => void) => React.ReactNode;
  main: React.ReactNode;
  right: (collapse: () => void) => React.ReactNode;
}) {
  const leftRef = usePanelRef();
  const rightRef = usePanelRef();
  const l = useCollapsible(leftRef, defaultLayout?.left === 0);
  const r = useCollapsible(rightRef, defaultLayout?.right === 0);
  const { toggle: toggleLeft } = l;
  const { toggle: toggleRight } = r;

  // [ and ] toggle the side panels, unless the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "[") toggleLeft();
      else if (e.key === "]") toggleRight();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLeft, toggleRight]);

  return (
    <ResizablePanelGroup
      id="tg-shell"
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={(layout, meta) => {
        const save = meta.requestedLayout ?? layout;
        document.cookie = `${LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(save))}; path=/; max-age=31536000; samesite=lax`;
      }}
      className={[
        "min-h-0 flex-1",
        // Stacked on small screens: undo the library's inline row layout and panel sizing.
        "max-lg:flex-col! max-lg:overflow-y-auto!",
        "max-lg:[&>[data-panel]]:flex-none! max-lg:[&>[data-panel]]:max-h-none!",
        "max-lg:[&>#left]:order-3 max-lg:[&>#main]:order-1 max-lg:[&>#right]:order-2",
      ].join(" ")}
    >
      <ResizablePanel
        id="left"
        panelRef={leftRef}
        collapsible
        collapsedSize={0}
        minSize={220}
        maxSize={440}
        defaultSize="17"
        onResize={l.onResize}
        className="border-t bg-background lg:border-t-0"
      >
        {left(l.toggle)}
      </ResizablePanel>
      <ResizableHandle withHandle className="max-lg:hidden" />
      <ResizablePanel id="main" minSize={360} className="relative max-lg:h-[64vh] max-lg:min-h-[420px]" aria-label="Evidence graph">
        {main}
        {l.collapsed && <ExpandButton side="left" onClick={l.toggle} />}
        {r.collapsed && <ExpandButton side="right" onClick={r.toggle} />}
      </ResizablePanel>
      <ResizableHandle withHandle className="max-lg:hidden" />
      <ResizablePanel
        id="right"
        panelRef={rightRef}
        collapsible
        collapsedSize={0}
        minSize={320}
        maxSize={720}
        defaultSize="26"
        onResize={r.onResize}
        className="flex flex-col border-t bg-surface-2 max-lg:h-[72vh] lg:border-t-0"
      >
        {right(r.toggle)}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
