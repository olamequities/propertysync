"use client";

import { useEffect, useState } from "react";

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "not-available"; version?: string }
  | { state: "error"; error: string };

interface ElectronAPI {
  getVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{
    ok: boolean;
    error?: string;
    currentVersion?: string;
    latestVersion?: string;
  }>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export default function UpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(typeof window !== "undefined" && !!window.electronAPI);
    if (!window.electronAPI) return;
    const off = window.electronAPI.onUpdateStatus((s) => setStatus(s));
    return off;
  }, []);

  if (!available) return null;

  async function handleCheck() {
    if (!window.electronAPI) return;
    setStatus({ state: "checking" });
    const result = await window.electronAPI.checkForUpdates();
    if (!result.ok) {
      setStatus({ state: "error", error: result.error || "Unknown error" });
      return;
    }
    if (result.currentVersion === result.latestVersion) {
      setStatus({ state: "not-available", version: result.latestVersion });
    }
    // Other states (available/downloading/downloaded) come via onUpdateStatus
  }

  function statusText(): string {
    switch (status.state) {
      case "checking":
        return "Checking…";
      case "available":
        return `v${status.version} available — downloading…`;
      case "downloading":
        return `Downloading update… ${status.percent}%`;
      case "downloaded":
        return `v${status.version} ready — restart to install`;
      case "not-available":
        return "Up to date";
      case "error":
        return `Error: ${status.error}`;
      default:
        return "";
    }
  }

  const isBusy = status.state === "checking" || status.state === "downloading";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleCheck}
        disabled={isBusy}
        className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:border-foreground/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isBusy ? "Checking…" : "Check for Updates"}
      </button>
      {status.state !== "idle" && (
        <span
          className={`text-xs ${
            status.state === "error"
              ? "text-red-400"
              : status.state === "downloaded" || status.state === "available"
              ? "text-green-400"
              : "text-dim"
          }`}
        >
          {statusText()}
        </span>
      )}
    </div>
  );
}
