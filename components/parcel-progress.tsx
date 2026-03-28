"use client";

import { useEffect, useState, useRef } from "react";
import type { ParcelProgress as ParcelProgressType } from "@/lib/types";

interface ParcelProgressProps {
  jobId: string;
  onDone: () => void;
  onDismiss: () => void;
  onRowUpdate: (rowIndex: number, parcelStatus: string, parcelDetails: string) => void;
}

export default function ParcelProgress({
  jobId,
  onDone,
  onDismiss,
  onRowUpdate,
}: ParcelProgressProps) {
  const [progress, setProgress] = useState<ParcelProgressType | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const lastRowRef = useRef<number | null>(null);
  const doneCalledRef = useRef(false);

  useEffect(() => {
    doneCalledRef.current = false;
    const es = new EventSource(`/api/parcels/${jobId}`);

    es.onmessage = (e) => {
      const data: ParcelProgressType = JSON.parse(e.data);
      setProgress(data);

      if (data.lastCompletedRow && data.lastCompletedRow.rowIndex !== lastRowRef.current) {
        lastRowRef.current = data.lastCompletedRow.rowIndex;
        onRowUpdate(
          data.lastCompletedRow.rowIndex,
          data.lastCompletedRow.parcelStatus,
          data.lastCompletedRow.parcelDetails
        );
      }

      if (data.status === "completed" || data.status === "cancelled" || data.status === "error") {
        es.close();
        if (!doneCalledRef.current) {
          doneCalledRef.current = true;
          onDone();
        }
      }
    };

    es.onerror = () => es.close();

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function handleCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await fetch(`/api/parcels/${jobId}/cancel`, { method: "POST" });
    } catch {
      setCancelling(false);
    }
  }

  async function handlePauseResume() {
    if (togglingPause) return;
    setTogglingPause(true);
    try {
      await fetch(`/api/parcels/${jobId}/pause`, { method: "POST" });
    } catch {
      // allow retry
    } finally {
      setTogglingPause(false);
    }
  }

  if (!progress) {
    return (
      <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-foreground">Connecting to parcel scan...</p>
      </div>
    );
  }

  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const elapsed = Date.now() - progress.startedAt;
  const eta =
    progress.processed > 0 && progress.status === "running"
      ? Math.round(((elapsed / progress.processed) * (progress.total - progress.processed)) / 1000)
      : null;

  const isTerminal = progress.status !== "running" && progress.status !== "paused";
  const isActive = progress.status === "running" || progress.status === "paused";

  const statusMap = {
    running: { label: "Scanning", bg: "bg-purple-500/5", border: "border-purple-500/20", barColor: "bg-purple-500" },
    paused: { label: "Paused", bg: "bg-warning-dim", border: "border-warning/20", barColor: "bg-warning" },
    completed: { label: "Complete", bg: "bg-green-dim", border: "border-green/20", barColor: "bg-green" },
    cancelled: { label: "Cancelled", bg: "bg-warning-dim", border: "border-warning/20", barColor: "bg-warning" },
    error: { label: "Error", bg: "bg-danger-dim", border: "border-danger/20", barColor: "bg-danger" },
  }[progress.status];

  return (
    <div className="space-y-3">
      <div className={`${statusMap.bg} border ${statusMap.border} rounded-lg overflow-hidden`}>
        {/* Progress bar */}
        <div className="h-1 bg-border/30">
          <div
            className={`h-full transition-all duration-500 ease-out ${statusMap.barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Status lozenge */}
              <span className={`lozenge ${
                progress.status === "running" ? "lozenge-info" :
                progress.status === "paused" ? "lozenge-warning" :
                progress.status === "completed" ? "lozenge-success" :
                progress.status === "error" ? "lozenge-danger" : "lozenge-warning"
              }`} style={progress.status === "running" ? { backgroundColor: "rgba(139, 92, 246, 0.1)", color: "rgb(139, 92, 246)" } : undefined}>
                {progress.status === "running" && (
                  <div className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
                )}
                {statusMap.label}
              </span>

              {/* Stats */}
              <div className="flex items-center gap-3 text-sm">
                <span className="text-foreground font-medium">
                  {progress.processed}/{progress.total}
                </span>
                <span className="text-muted">
                  {pct}%
                </span>
                {progress.succeeded > 0 && (
                  <span className="text-green text-xs">
                    {progress.succeeded} done
                  </span>
                )}
                {progress.failed > 0 && progress.status !== "cancelled" && (
                  <span className="text-danger text-xs">
                    {progress.failed} failed
                  </span>
                )}
                {eta !== null && (
                  <span className="text-muted text-xs">
                    ~{eta > 60 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : `${eta}s`} left
                  </span>
                )}
              </div>
            </div>

            {/* Pause / Cancel / Dismiss */}
            <div className="flex items-center gap-2">
              {isActive && (
                <button
                  type="button"
                  onClick={handlePauseResume}
                  disabled={togglingPause}
                  className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                    togglingPause
                      ? "text-muted bg-border cursor-not-allowed"
                      : "text-warning bg-warning-dim hover:bg-warning/15 cursor-pointer"
                  }`}
                >
                  {togglingPause
                    ? (progress.status === "paused" ? "Resuming..." : "Pausing...")
                    : (progress.status === "paused" ? "Resume" : "Pause")}
                </button>
              )}
              {isActive && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={cancelling}
                  className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                    cancelling
                      ? "text-muted bg-border cursor-not-allowed"
                      : "text-danger bg-danger-dim hover:bg-danger/15 cursor-pointer"
                  }`}
                >
                  {cancelling ? "Cancelling..." : "Cancel"}
                </button>
              )}
              {isTerminal && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="px-3 py-1.5 text-xs font-semibold text-secondary bg-raised hover:bg-border rounded transition-colors cursor-pointer"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>

          {/* Current address */}
          {progress.currentAddress && isActive && (
            <p className="text-xs text-secondary mt-2 font-[family-name:var(--font-mono)] truncate">
              {progress.status === "paused" ? "Paused at:" : "Scanning:"} {progress.currentAddress}
            </p>
          )}
        </div>
      </div>

      {/* Errors expandable */}
      {progress.errors.length > 0 && progress.status !== "cancelled" && (
        <div className="bg-surface border border-border rounded-lg">
          <button
            type="button"
            onClick={() => setErrorsExpanded(!errorsExpanded)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm cursor-pointer hover:bg-raised/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="lozenge lozenge-danger">{progress.errors.length}</span>
              <span className="text-secondary font-medium">
                Error{progress.errors.length !== 1 ? "s" : ""} encountered
              </span>
            </span>
            <svg
              className={`w-4 h-4 text-muted transition-transform duration-200 ${errorsExpanded ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {errorsExpanded && (
            <div className="border-t border-border max-h-48 overflow-y-auto">
              {progress.errors.map((err, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-2 text-xs border-b border-border last:border-0">
                  <span className="text-muted font-[family-name:var(--font-mono)] flex-shrink-0">Row {err.row}</span>
                  <span className="text-secondary flex-shrink-0 font-[family-name:var(--font-mono)]">{err.address}</span>
                  <span className="text-danger truncate">{err.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
