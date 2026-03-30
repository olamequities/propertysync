"use client";

import { useEffect, useState, useRef } from "react";

interface EstateSnapshot {
  jobId: string;
  status: "waiting_captcha" | "running" | "completed" | "cancelled" | "error";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  currentName: string;
  errors: { row: number; name: string; error: string }[];
  startedAt: number;
  lastCompletedRow?: {
    rowIndex: number;
    estateStatus: string;
    estateFileNumber: string;
  };
}

interface EstateProgressProps {
  jobId: string;
  onDone: () => void;
  onDismiss: () => void;
  onRowUpdate: (rowIndex: number, estateStatus: string, estateFileNumber: string) => void;
}

export default function EstateProgress({
  jobId,
  onDone,
  onDismiss,
  onRowUpdate,
}: EstateProgressProps) {
  const [progress, setProgress] = useState<EstateSnapshot | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const lastRowRef = useRef<number | null>(null);
  const doneCalledRef = useRef(false);

  useEffect(() => {
    doneCalledRef.current = false;
    lastRowRef.current = null;
    const es = new EventSource(`/api/estate/${jobId}`);

    es.onmessage = (e) => {
      const data: EstateSnapshot = JSON.parse(e.data);
      setProgress(data);

      if (data.lastCompletedRow && data.lastCompletedRow.rowIndex !== lastRowRef.current) {
        lastRowRef.current = data.lastCompletedRow.rowIndex;
        onRowUpdate(
          data.lastCompletedRow.rowIndex,
          data.lastCompletedRow.estateStatus,
          data.lastCompletedRow.estateFileNumber
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
      await fetch(`/api/estate/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
    } catch {
      setCancelling(false);
    }
  }

  if (!progress) {
    return (
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-foreground">Starting estate scanner...</p>
      </div>
    );
  }

  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  const isTerminal = progress.status === "completed" || progress.status === "cancelled" || progress.status === "error";
  const isActive = progress.status === "running" || progress.status === "waiting_captcha";

  const statusMap = {
    waiting_captcha: { label: "Solve CAPTCHA", barColor: "bg-amber-500" },
    running: { label: "Checking Estates", barColor: "bg-amber-500" },
    completed: { label: "Complete", barColor: "bg-green" },
    cancelled: { label: "Cancelled", barColor: "bg-warning" },
    error: { label: "Error", barColor: "bg-danger" },
  }[progress.status];

  return (
    <div className="space-y-3">
      <div className={`${isTerminal ? "bg-green-dim border-green/20" : "bg-amber-500/5 border-amber-500/20"} border rounded-lg overflow-hidden`}>
        <div className="h-1 bg-border/30">
          <div className={`h-full transition-all duration-500 ease-out ${statusMap.barColor}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className={`lozenge ${
                progress.status === "waiting_captcha" ? "lozenge-warning" :
                progress.status === "running" ? "lozenge-info" :
                progress.status === "completed" ? "lozenge-success" : "lozenge-danger"
              }`} style={progress.status === "running" ? { backgroundColor: "rgba(245, 158, 11, 0.1)", color: "rgb(245, 158, 11)" } : undefined}>
                {progress.status === "running" && (
                  <div className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
                )}
                {statusMap.label}
              </span>

              <div className="flex items-center gap-3 text-sm">
                <span className="text-foreground font-medium">{progress.processed}/{progress.total}</span>
                <span className="text-muted">{pct}%</span>
                {progress.succeeded > 0 && <span className="text-green text-xs">{progress.succeeded} estates found</span>}
                {progress.failed > 0 && <span className="text-danger text-xs">{progress.failed} failed</span>}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isActive && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={cancelling}
                  className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                    cancelling ? "text-muted bg-border cursor-not-allowed" : "text-danger bg-danger-dim hover:bg-danger/15 cursor-pointer"
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

          {progress.currentName && isActive && (
            <p className="text-xs text-secondary mt-2 font-[family-name:var(--font-mono)] truncate">
              {progress.status === "waiting_captcha" ? "Waiting:" : "Checking:"} {progress.currentName}
            </p>
          )}

          {progress.status === "waiting_captcha" && (
            <div className="mt-3 p-3 bg-amber-500/10 rounded text-xs text-secondary space-y-1">
              <p className="font-semibold text-amber-600">Solve the CAPTCHA in the browser window that opened</p>
              <p>1. Click the hCaptcha checkbox</p>
              <p>2. Complete the image challenge</p>
              <p>3. Searches will start automatically after</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
