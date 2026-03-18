"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { SheetRow } from "@/lib/types";

interface SheetTableProps {
  rows: SheetRow[];
  processingRowIndex?: number;
  justFilledRowIndex?: number;
  failedRowIndices?: Set<number>;
}

const COLUMNS = [
  { key: "rowIndex", label: "#", width: "w-12" },
  { key: "fullAddress", label: "Full Address", width: "min-w-[180px]" },
  { key: "houseNumber", label: "House #", width: "w-24" },
  { key: "street", label: "Street", width: "min-w-[140px]" },
  { key: "borough", label: "Borough", width: "w-24" },
  { key: "ownerName", label: "Owner Name", width: "min-w-[160px]" },
  { key: "billingNameAndAddress", label: "Billing Info", width: "min-w-[200px]" },
];

const ROW_HEIGHT = 37;
const OVERSCAN = 10;

export default function SheetTable({
  rows,
  processingRowIndex,
  justFilledRowIndex,
  failedRowIndices,
}: SheetTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [animatingRow, setAnimatingRow] = useState<number | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const programmaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Virtualization state
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(520);

  const totalHeight = rows.length * ROW_HEIGHT;

  const { startIndex, endIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);
    const end = Math.min(rows.length, start + visibleCount + OVERSCAN * 2);
    return { startIndex: start, endIndex: end };
  }, [scrollTop, containerHeight, rows.length]);

  const visibleRows = useMemo(
    () => rows.slice(startIndex, endIndex),
    [rows, startIndex, endIndex]
  );

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);

    if (programmaticScrollRef.current) return;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      setAutoFollow(false);
    }, 150);
  }, []);

  // Measure container height on mount
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-follow processing row
  useEffect(() => {
    if (!autoFollow || !processingRowIndex) return;
    const idx = rows.findIndex((r) => r.rowIndex === processingRowIndex);
    if (idx === -1) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    const headerHeight = 37;
    const targetScroll = idx * ROW_HEIGHT - containerHeight / 2 + headerHeight;
    programmaticScrollRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    el.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    setTimeout(() => { programmaticScrollRef.current = false; }, 1000);
  }, [processingRowIndex, autoFollow, rows, containerHeight]);

  // Re-enable auto-follow when sync starts
  useEffect(() => {
    if (processingRowIndex) {
      setAutoFollow(true);
    }
  }, [!!processingRowIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  function jumpToCurrent() {
    setAutoFollow(true);
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    if (!processingRowIndex) return;
    const idx = rows.findIndex((r) => r.rowIndex === processingRowIndex);
    if (idx === -1) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const headerHeight = 37;
    const targetScroll = idx * ROW_HEIGHT - containerHeight / 2 + headerHeight;
    programmaticScrollRef.current = true;
    el.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    setTimeout(() => { programmaticScrollRef.current = false; }, 1000);
  }

  // Trigger fill animation
  useEffect(() => {
    if (justFilledRowIndex) {
      setAnimatingRow(justFilledRowIndex);
      const timer = setTimeout(() => setAnimatingRow(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [justFilledRowIndex]);

  function getRowClass(row: SheetRow) {
    if (row.rowIndex === processingRowIndex) return "row-processing";
    if (row.rowIndex === animatingRow) return "row-just-filled";
    if (failedRowIndices?.has(row.rowIndex)) return "bg-row-error";
    return "";
  }

  function getStatusIndicator(row: SheetRow) {
    if (row.rowIndex === processingRowIndex) {
      return (
        <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
      );
    }
    if (failedRowIndices?.has(row.rowIndex)) {
      return <div className="w-2 h-2 rounded-full bg-danger" />;
    }
    if (row.processed) {
      return <div className="w-2 h-2 rounded-full bg-green" />;
    }
    return <div className="w-2 h-2 rounded-full bg-dim/40" />;
  }

  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-12 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-dim mx-auto mb-3">
          <path d="M9 17H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-4m-6 0v4m0-4h6m-6 4h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <p className="text-secondary text-sm">No rows found in this sheet</p>
        <p className="text-muted text-xs mt-1">Add addresses to your Google Sheet to get started</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden relative">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="overflow-x-auto overflow-y-auto max-h-[520px]"
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-raised border-b border-border">
              <th className="w-8 px-3 py-2.5" />
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`${col.width} px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted whitespace-nowrap`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Spacer for rows above the visible window */}
            {startIndex > 0 && (
              <tr style={{ height: startIndex * ROW_HEIGHT }} aria-hidden>
                <td colSpan={COLUMNS.length + 1} />
              </tr>
            )}
            {visibleRows.map((row) => (
              <tr
                key={row.rowIndex}
                style={{ height: ROW_HEIGHT }}
                className={`${getRowClass(row)} border-b border-border/50 hover:bg-raised/50 transition-colors duration-150`}
              >
                <td className="px-3 py-2 text-center">
                  {getStatusIndicator(row)}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-muted">
                  {row.rowIndex - 1}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-foreground truncate max-w-[200px]">
                  {row.fullAddress || <span className="text-dim">--</span>}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-foreground">
                  {row.houseNumber || <span className="text-dim">--</span>}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-foreground truncate max-w-[160px]">
                  {row.street || <span className="text-dim">--</span>}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-foreground">
                  {row.borough || <span className="text-dim">--</span>}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs truncate max-w-[180px]">
                  {row.ownerName ? (
                    <span className="text-green font-medium">{row.ownerName}</span>
                  ) : (
                    <span className="text-dim italic">pending</span>
                  )}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs truncate max-w-[220px]">
                  {row.billingNameAndAddress ? (
                    <span className="text-green font-medium">{row.billingNameAndAddress}</span>
                  ) : (
                    <span className="text-dim italic">pending</span>
                  )}
                </td>
              </tr>
            ))}
            {/* Spacer for rows below the visible window */}
            {endIndex < rows.length && (
              <tr style={{ height: (rows.length - endIndex) * ROW_HEIGHT }} aria-hidden>
                <td colSpan={COLUMNS.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Jump to current row button — shown when user scrolls away during sync */}
      {processingRowIndex && !autoFollow && (
        <button
          type="button"
          onClick={jumpToCurrent}
          className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-xs font-semibold rounded-lg shadow-md shadow-accent/20 hover:bg-accent-hover transition-colors cursor-pointer z-20"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
          Jump to current
        </button>
      )}
    </div>
  );
}
