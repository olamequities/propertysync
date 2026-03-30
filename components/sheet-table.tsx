"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import type { SheetRow } from "@/lib/types";

type ParcelFilter = "ALL" | "GOOD_LEAD" | "SOLD" | "NO_REVERSE_MORTGAGE" | "SATISFIED" | "ERROR" | "PENDING";
type SyncFilter = "ALL" | "SYNCED" | "UNSYNCED";
type EstateFilter = "ALL" | "YES" | "NO" | "PENDING";

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
  { key: "parcelStatus", label: "Parcel Status", width: "w-36" },
  { key: "parcelDetails", label: "Details", width: "min-w-[180px]" },
  { key: "estateStatus", label: "Estate", width: "w-24" },
  { key: "estateFileNumber", label: "File Number", width: "min-w-[140px]" },
];

const PARCEL_LOZENGE: Record<string, { class: string; label: string }> = {
  GOOD_LEAD: { class: "lozenge-success", label: "Good Lead" },
  SOLD: { class: "lozenge-danger", label: "Sold" },
  NO_REVERSE_MORTGAGE: { class: "lozenge-default", label: "No Rev. Mtg" },
  SATISFIED: { class: "lozenge-warning", label: "Satisfied" },
  ERROR: { class: "lozenge-danger", label: "Error" },
};

const ROW_HEIGHT = 37;
const OVERSCAN = 10;

const PARCEL_FILTER_OPTIONS: { value: ParcelFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "GOOD_LEAD", label: "Good Lead" },
  { value: "SOLD", label: "Sold" },
  { value: "NO_REVERSE_MORTGAGE", label: "No Rev. Mtg" },
  { value: "SATISFIED", label: "Satisfied" },
  { value: "ERROR", label: "Error" },
  { value: "PENDING", label: "Pending" },
];

const SYNC_FILTER_OPTIONS: { value: SyncFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SYNCED", label: "Synced" },
  { value: "UNSYNCED", label: "Unsynced" },
];

const ESTATE_FILTER_OPTIONS: { value: EstateFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "YES", label: "Has Estate" },
  { value: "NO", label: "No Estate" },
  { value: "PENDING", label: "Pending" },
];

function exportCSV(rows: SheetRow[], filename: string) {
  const headers = ["Full Address", "House Number", "Street", "Borough", "Owner Name", "Billing Name", "Block", "Lot", "Parcel Status", "Parcel Details", "Estate Status", "Estate File Number"];
  const csvRows = [
    headers.join(","),
    ...rows.map((r) =>
      [r.fullAddress, r.houseNumber, r.street, r.borough, r.ownerName, r.billingNameAndAddress, r.block, r.lot, r.parcelStatus, r.parcelDetails, r.estateStatus, r.estateFileNumber]
        .map((v) => `"${(v || "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

  // Filter state
  const [parcelFilter, setParcelFilter] = useState<ParcelFilter>("ALL");
  const [syncFilter, setSyncFilter] = useState<SyncFilter>("ALL");
  const [estateFilter, setEstateFilter] = useState<EstateFilter>("ALL");
  const [searchText, setSearchText] = useState("");

  const filteredRows = useMemo(() => {
    let result = rows;

    if (parcelFilter !== "ALL") {
      if (parcelFilter === "PENDING") {
        result = result.filter((r) => !r.parcelStatus);
      } else {
        result = result.filter((r) => r.parcelStatus === parcelFilter);
      }
    }

    if (syncFilter === "SYNCED") {
      result = result.filter((r) => !!r.processed);
    } else if (syncFilter === "UNSYNCED") {
      result = result.filter((r) => !r.processed);
    }

    if (estateFilter === "YES") {
      result = result.filter((r) => r.estateStatus === "YES");
    } else if (estateFilter === "NO") {
      result = result.filter((r) => r.estateStatus === "NO");
    } else if (estateFilter === "PENDING") {
      result = result.filter((r) => r.parcelStatus === "GOOD_LEAD" && !r.estateStatus);
    }

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter((r) =>
        r.fullAddress.toLowerCase().includes(q) ||
        r.ownerName.toLowerCase().includes(q) ||
        r.billingNameAndAddress.toLowerCase().includes(q) ||
        r.street.toLowerCase().includes(q) ||
        r.borough.toLowerCase().includes(q)
      );
    }

    return result;
  }, [rows, parcelFilter, syncFilter, estateFilter, searchText]);

  const isFiltered = parcelFilter !== "ALL" || syncFilter !== "ALL" || estateFilter !== "ALL" || searchText.trim() !== "";

  // Virtualization state
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(520);

  const totalHeight = filteredRows.length * ROW_HEIGHT;

  const { startIndex, endIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);
    const end = Math.min(filteredRows.length, start + visibleCount + OVERSCAN * 2);
    return { startIndex: start, endIndex: end };
  }, [scrollTop, containerHeight, filteredRows.length]);

  const visibleRows = useMemo(
    () => filteredRows.slice(startIndex, endIndex),
    [filteredRows, startIndex, endIndex]
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
    const idx = filteredRows.findIndex((r) => r.rowIndex === processingRowIndex);
    if (idx === -1) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    const headerHeight = 37;
    const targetScroll = idx * ROW_HEIGHT - containerHeight / 2 + headerHeight;
    programmaticScrollRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    el.scrollTo({ top: Math.max(0, targetScroll), behavior: "smooth" });
    setTimeout(() => { programmaticScrollRef.current = false; }, 1000);
  }, [processingRowIndex, autoFollow, filteredRows, containerHeight]);

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
    const idx = filteredRows.findIndex((r) => r.rowIndex === processingRowIndex);
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
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border bg-raised/50">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search address, owner..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded text-xs text-foreground placeholder-dim focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Sync filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Sync:</span>
          <div className="flex border border-border rounded overflow-hidden">
            {SYNC_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSyncFilter(opt.value)}
                className={`px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  syncFilter === opt.value
                    ? "bg-accent text-white"
                    : "bg-surface text-secondary hover:bg-raised"
                } ${opt.value !== "ALL" ? "border-l border-border" : ""}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Parcel filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Parcel:</span>
          <select
            value={parcelFilter}
            onChange={(e) => setParcelFilter(e.target.value as ParcelFilter)}
            className="px-2 py-1 bg-surface border border-border rounded text-[11px] text-foreground focus:outline-none focus:border-accent transition-colors cursor-pointer"
          >
            {PARCEL_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Estate filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Estate:</span>
          <select
            value={estateFilter}
            onChange={(e) => setEstateFilter(e.target.value as EstateFilter)}
            className="px-2 py-1 bg-surface border border-border rounded text-[11px] text-foreground focus:outline-none focus:border-accent transition-colors cursor-pointer"
          >
            {ESTATE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Row count + Export */}
        <div className="flex items-center gap-3">
          {isFiltered && (
            <span className="text-[11px] text-muted">
              {filteredRows.length} of {rows.length} rows
            </span>
          )}
          <button
            type="button"
            onClick={() => exportCSV(
              filteredRows,
              `property-data${parcelFilter !== "ALL" ? `-${parcelFilter.toLowerCase()}` : ""}${syncFilter !== "ALL" ? `-${syncFilter.toLowerCase()}` : ""}.csv`
            )}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-secondary bg-surface border border-border hover:bg-raised rounded transition-colors cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>
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
                <td className="px-3 py-2 text-xs">
                  {row.parcelStatus ? (
                    <span className={`lozenge ${PARCEL_LOZENGE[row.parcelStatus]?.class ?? "lozenge-default"}`}>
                      {PARCEL_LOZENGE[row.parcelStatus]?.label ?? row.parcelStatus}
                    </span>
                  ) : (
                    row.block && row.lot ? (
                      <span className="text-dim italic">pending</span>
                    ) : (
                      <span className="text-dim">--</span>
                    )
                  )}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs truncate max-w-[200px]" title={row.parcelDetails || undefined}>
                  {row.parcelDetails ? (
                    <span className="text-secondary">{row.parcelDetails}</span>
                  ) : (
                    <span className="text-dim">--</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.estateStatus === "YES" ? (
                    <span className="lozenge lozenge-success">Yes</span>
                  ) : row.estateStatus === "NO" ? (
                    <span className="lozenge lozenge-default">No</span>
                  ) : row.estateStatus === "ERROR" ? (
                    <span className="lozenge lozenge-danger">Error</span>
                  ) : row.parcelStatus === "GOOD_LEAD" ? (
                    <span className="text-dim italic">pending</span>
                  ) : (
                    <span className="text-dim">--</span>
                  )}
                </td>
                <td className="px-3 py-2 font-[family-name:var(--font-mono)] text-xs truncate max-w-[160px]" title={row.estateFileNumber || undefined}>
                  {row.estateFileNumber ? (
                    <span className="text-secondary">{row.estateFileNumber}</span>
                  ) : (
                    <span className="text-dim">--</span>
                  )}
                </td>
              </tr>
            ))}
            {/* Spacer for rows below the visible window */}
            {endIndex < filteredRows.length && (
              <tr style={{ height: (filteredRows.length - endIndex) * ROW_HEIGHT }} aria-hidden>
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
