import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ColumnDef = {
  key: string;
  label: string;
  default: number;
  min?: number;
  align?: "left" | "right" | "center";
};

export function useResizableColumns(storageKey: string, cols: ColumnDef[]) {
  const initial = useMemo(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, number>;
        return cols.reduce<Record<string, number>>((acc, c) => {
          acc[c.key] = Math.max(c.min ?? 40, saved[c.key] ?? c.default);
          return acc;
        }, {});
      }
    } catch {}
    return cols.reduce<Record<string, number>>((acc, c) => { acc[c.key] = c.default; return acc; }, {});
  }, [storageKey, cols]);

  const [widths, setWidths] = useState<Record<string, number>>(initial);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch {}
  }, [widths, storageKey]);

  const setWidth = useCallback((key: string, w: number) => {
    setWidths((prev) => ({ ...prev, [key]: w }));
  }, []);

  const resetWidth = useCallback((key: string) => {
    const def = cols.find((c) => c.key === key)?.default ?? 120;
    setWidths((prev) => ({ ...prev, [key]: def }));
  }, [cols]);

  return { widths, setWidth, resetWidth };
}

export function ResizeHandle({
  onResize,
  onAutoFit,
}: {
  onResize: (deltaX: number) => void;
  onAutoFit: () => void;
}) {
  const startX = useRef(0);
  const active = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    active.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!active.current) return;
      const dx = ev.clientX - startX.current;
      startX.current = ev.clientX;
      onResize(dx);
    };
    const onUp = () => {
      active.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <span
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); onAutoFit(); }}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/60 active:bg-primary select-none"
      style={{ touchAction: "none" }}
      title="Drag to resize · Double-click to auto-fit"
    />
  );
}

/** Approximate text width in pixels (canvas-based, cached). */
let measureCanvas: HTMLCanvasElement | null = null;
export function measureTextWidth(text: string, font = "13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"): number {
  if (typeof document === "undefined") return text.length * 8;
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return ctx.measureText(text).width;
}
