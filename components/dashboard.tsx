"use client";

import { useEffect, useState, useCallback } from "react";
import type { SheetStats, SheetRow, SheetTab } from "@/lib/types";
import Header from "./header";
import SheetTable from "./sheet-table";
import SyncProgress from "./sync-progress";
import ParcelProgress from "./parcel-progress";

export default function Dashboard() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<SheetStats | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState("");
  const [processingRowIndex, setProcessingRowIndex] = useState<number | undefined>();
  const [justFilledRowIndex, setJustFilledRowIndex] = useState<number | undefined>();
  const [failedRowIndices, setFailedRowIndices] = useState<Set<number>>(new Set());

  // Parcel scan state
  const [parcelScanning, setParcelScanning] = useState(false);
  const [parcelJobId, setParcelJobId] = useState<string | null>(null);
  const [parcelError, setParcelError] = useState("");

  // Row range
  const [rangeMode, setRangeMode] = useState<"all" | "range">("all");
  const [startRow, setStartRow] = useState("");
  const [endRow, setEndRow] = useState("");

  const [refreshing, setRefreshing] = useState(false);

  const fetchTabs = useCallback(async () => {
    try {
      const res = await fetch("/api/sheet/tabs");
      const data = await res.json();
      if (data.tabs && Array.isArray(data.tabs)) {
        setTabs(data.tabs);
        if (data.tabs.length > 0 && !activeTab) setActiveTab(data.tabs[0].title);
      }
      if (data.sheetUrl) setSheetUrl(data.sheetUrl);
    } catch {
      setError("Failed to load sheet tabs");
    }
  }, [activeTab]);

  // Load tabs + check for active sync on mount
  useEffect(() => {
    fetchTabs();
    // Reconnect to active sync if page was refreshed
    fetch("/api/sync")
      .then((res) => res.json())
      .then((data) => {
        if (data.running && data.jobId) {
          setJobId(data.jobId);
          setSyncing(true);
        }
      })
      .catch(() => {});
    // Reconnect to active parcel scan if page was refreshed
    fetch("/api/parcels")
      .then((res) => res.json())
      .then((data) => {
        if (data.running && data.jobId) {
          setParcelJobId(data.jobId);
          setParcelScanning(true);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load stats + rows when tab changes
  const fetchData = useCallback(async () => {
    if (!activeTab) return;
    setLoading(true);
    setError("");

    try {
      const [statsRes, rowsRes] = await Promise.all([
        fetch(`/api/sheet?tab=${encodeURIComponent(activeTab)}`),
        fetch(`/api/sheet/rows?tab=${encodeURIComponent(activeTab)}`),
      ]);

      if (!statsRes.ok || !rowsRes.ok) throw new Error("Failed to load data");

      const [statsData, rowsData] = await Promise.all([
        statsRes.json(),
        rowsRes.json(),
      ]);

      setStats(statsData);
      setRows(rowsData);
    } catch {
      setError("Failed to load sheet data");
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchTabs(), fetchData()]);
    setRefreshing(false);
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  async function handleSync() {
    setSyncError("");
    setFailedRowIndices(new Set());

    const body: Record<string, unknown> = { sheetName: activeTab };
    if (rangeMode === "range") {
      if (startRow) body.startRow = parseInt(startRow, 10);
      if (endRow) body.endRow = parseInt(endRow, 10);
    }

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setSyncError(data.error || "Failed to start sync");
        return;
      }

      const data = await res.json();
      setJobId(data.jobId);
      setSyncing(true);
    } catch {
      setSyncError("Failed to start sync");
    }
  }

  function handleSyncDone() {
    setProcessingRowIndex(undefined);
    // Refresh stats only, not the full table (rows already updated in real-time via SSE)
    if (activeTab) {
      fetch(`/api/sheet?tab=${encodeURIComponent(activeTab)}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => { if (data) setStats(data); })
        .catch(() => {});
    }
  }

  function handleSyncDismiss() {
    setSyncing(false);
    setJobId(null);
    setProcessingRowIndex(undefined);
    setJustFilledRowIndex(undefined);
  }

  const handleRowUpdate = useCallback((rowIndex: number, ownerName: string, billing: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.rowIndex === rowIndex
          ? { ...r, ownerName, billingNameAndAddress: billing }
          : r
      )
    );
    setJustFilledRowIndex(rowIndex);
    // Update stats in real-time
    setStats((prev) => prev ? {
      ...prev,
      filledRows: prev.filledRows + 1,
      emptyRows: prev.emptyRows - 1,
    } : prev);
  }, []);

  async function handleParcelScan() {
    setParcelError("");
    try {
      const res = await fetch("/api/parcels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetName: activeTab }),
      });

      if (!res.ok) {
        const data = await res.json();
        setParcelError(data.error || "Failed to start parcel scan");
        return;
      }

      const data = await res.json();
      setParcelJobId(data.jobId);
      setParcelScanning(true);
    } catch {
      setParcelError("Failed to start parcel scan");
    }
  }

  function handleParcelDone() {
    // Refresh stats
    if (activeTab) {
      fetch(`/api/sheet?tab=${encodeURIComponent(activeTab)}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => { if (data) setStats(data); })
        .catch(() => {});
    }
  }

  function handleParcelDismiss() {
    setParcelScanning(false);
    setParcelJobId(null);
  }

  const handleParcelRowUpdate = useCallback((rowIndex: number, parcelStatus: string, parcelDetails: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.rowIndex === rowIndex
          ? { ...r, parcelStatus, parcelDetails }
          : r
      )
    );
    setStats((prev) => prev ? {
      ...prev,
      parcelScanned: prev.parcelScanned + 1,
      parcelRemaining: prev.parcelRemaining - 1,
    } : prev);
  }, []);

  const handleProcessingRow = useCallback((address: string) => {
    setRows((prev) => {
      const match = prev.find((r) => {
        const street = r.street.replace(/\s*#\s*\d+.*$/, "");
        return `${r.houseNumber} ${street}` === address;
      });
      if (match) setProcessingRowIndex(match.rowIndex);
      return prev;
    });
  }, []);

  const pct = stats && stats.totalRows > 0
    ? Math.round((stats.filledRows / stats.totalRows) * 100)
    : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header onLogout={handleLogout} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 space-y-5">
        {/* Page header row */}
        <div className="flex items-start justify-between animate-fade-in-up">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              Property Data Sync
            </h1>
            <p className="text-secondary text-sm mt-0.5">
              Look up NYC property owner and billing information
            </p>
          </div>
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-accent hover:text-accent-hover bg-accent-dim hover:bg-accent/10 rounded-[4px] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open Sheet
            </a>
          )}
        </div>

        {/* Controls bar */}
        <div className="bg-surface border border-border rounded-lg p-4 animate-fade-in-up stagger-1">
          <div className="flex flex-wrap items-end gap-4">
            {/* Tab selector */}
            <div className="flex-1 min-w-[180px] max-w-[260px]">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">
                Sheet Tab
              </label>
              <select
                value={activeTab}
                onChange={(e) => setActiveTab(e.target.value)}
                disabled={syncing}
                className="w-full px-3 py-2 bg-surface border-2 border-border rounded-[4px] text-sm text-foreground focus:outline-none focus:border-accent transition-colors cursor-pointer disabled:opacity-50"
              >
                {tabs.map((tab) => (
                  <option key={tab.title} value={tab.title}>
                    {tab.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Row range */}
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted mb-1.5">
                  Rows
                </label>
                <div className="flex border-2 border-border rounded-[4px] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setRangeMode("all")}
                    disabled={syncing}
                    className={`px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                      rangeMode === "all"
                        ? "bg-accent text-white"
                        : "bg-surface text-secondary hover:bg-raised"
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setRangeMode("range")}
                    disabled={syncing}
                    className={`px-3 py-2 text-xs font-semibold transition-colors cursor-pointer border-l-2 border-border ${
                      rangeMode === "range"
                        ? "bg-accent text-white"
                        : "bg-surface text-secondary hover:bg-raised"
                    }`}
                  >
                    Range
                  </button>
                </div>
              </div>

              {rangeMode === "range" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="From"
                    value={startRow}
                    onChange={(e) => setStartRow(e.target.value)}
                    disabled={syncing}
                    min={1}
                    className="w-20 px-3 py-2 bg-surface border-2 border-border rounded-[4px] text-sm text-foreground placeholder-dim focus:outline-none focus:border-accent transition-colors font-[family-name:var(--font-mono)]"
                  />
                  <span className="text-muted text-xs">to</span>
                  <input
                    type="number"
                    placeholder="End"
                    value={endRow}
                    onChange={(e) => setEndRow(e.target.value)}
                    disabled={syncing}
                    min={1}
                    className="w-20 px-3 py-2 bg-surface border-2 border-border rounded-[4px] text-sm text-foreground placeholder-dim focus:outline-none focus:border-accent transition-colors font-[family-name:var(--font-mono)]"
                  />
                </div>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Refresh button */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || syncing || parcelScanning}
              className="px-3 py-2 bg-surface border-2 border-border hover:bg-raised disabled:opacity-40 disabled:cursor-not-allowed rounded-[4px] text-secondary transition-colors cursor-pointer"
              title="Refresh sheet data"
            >
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={refreshing ? "animate-spin" : ""}
              >
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            </button>

            {/* Sync button */}
            {!syncing && (
              <button
                type="button"
                onClick={handleSync}
                disabled={!stats || stats.emptyRows === 0 || loading || parcelScanning}
                className="px-5 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-[4px] font-semibold text-sm text-white transition-colors cursor-pointer shadow-sm"
              >
                {stats?.emptyRows === 0 ? "All rows synced" : "Start sync"}
              </button>
            )}

            {/* Identify Parcels button */}
            {!parcelScanning && (
              <button
                type="button"
                onClick={handleParcelScan}
                disabled={loading || syncing}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-[4px] font-semibold text-sm text-white transition-colors cursor-pointer shadow-sm"
              >
                Identify Parcels
              </button>
            )}
          </div>

          {syncError && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="lozenge lozenge-danger">Error</span>
              <span className="text-danger">{syncError}</span>
            </div>
          )}
          {parcelError && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="lozenge lozenge-danger">Error</span>
              <span className="text-danger">{parcelError}</span>
            </div>
          )}
        </div>

        {/* Stats row — Sync + Parcel side by side */}
        {stats && !loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in-up stagger-2">
            {/* Sync stats */}
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-accent" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Property Sync</p>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim mb-0.5">Total</p>
                  <p className="text-xl font-semibold text-foreground tabular-nums">{stats.totalRows}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim mb-0.5">Synced</p>
                  <p className="text-xl font-semibold text-green tabular-nums">{stats.filledRows}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim mb-0.5">Remaining</p>
                  <p className="text-xl font-semibold text-warning tabular-nums">{stats.emptyRows}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-raised rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-accent h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-muted tabular-nums w-10 text-right">{pct}%</span>
              </div>
            </div>

            {/* Parcel stats */}
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-purple-500" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Parcel Scan</p>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim mb-0.5">Total</p>
                  <p className="text-xl font-semibold text-foreground tabular-nums">{stats.totalRows}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim mb-0.5">Scanned</p>
                  <p className="text-xl font-semibold text-green tabular-nums">{stats.parcelScanned}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-dim mb-0.5">Remaining</p>
                  <p className="text-xl font-semibold text-warning tabular-nums">{stats.parcelRemaining}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-raised rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-purple-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${stats.totalRows > 0 ? Math.round((stats.parcelScanned / stats.totalRows) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-muted tabular-nums w-10 text-right">
                  {stats.totalRows > 0 ? Math.round((stats.parcelScanned / stats.totalRows) * 100) : 0}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Sync progress banner */}
        {syncing && jobId && (
          <div className="animate-fade-in-up">
            <SyncProgress
              jobId={jobId}
              onDone={handleSyncDone}
              onDismiss={handleSyncDismiss}
              onRowUpdate={handleRowUpdate}
              onProcessingRow={handleProcessingRow}
              rows={rows}
            />
          </div>
        )}

        {/* Parcel scan progress banner */}
        {parcelScanning && parcelJobId && (
          <div className="animate-fade-in-up">
            <ParcelProgress
              jobId={parcelJobId}
              onDone={handleParcelDone}
              onDismiss={handleParcelDismiss}
              onRowUpdate={handleParcelRowUpdate}
            />
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="bg-danger-dim border border-danger/20 rounded-lg px-4 py-3 flex items-center gap-3">
            <span className="lozenge lozenge-danger">Error</span>
            <span className="text-sm text-danger">{error}</span>
            <button
              type="button"
              onClick={fetchData}
              className="ml-auto text-xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="bg-surface border border-border rounded-lg p-12 flex items-center justify-center">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-secondary text-sm">Loading sheet data...</p>
            </div>
          </div>
        )}

        {/* Spreadsheet table */}
        {!loading && !error && (
          <div className="animate-fade-in-up stagger-3">
            <SheetTable
              rows={rows}
              processingRowIndex={processingRowIndex}
              justFilledRowIndex={justFilledRowIndex}
              failedRowIndices={failedRowIndices}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <p className="text-xs text-muted">
            Olam PropertySync v1.0
          </p>
          <p className="text-xs text-dim">
            NYC property owner & billing lookup
          </p>
        </div>
      </footer>
    </div>
  );
}
