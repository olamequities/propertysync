"use client";

import { useState } from "react";

export default function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        setError("Invalid credentials");
        return;
      }

      onSuccess();
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-raised">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="text-center mb-8 animate-fade-in-up">
          <img src="/favicon.svg" alt="Olam PropertySync" className="w-12 h-12 mx-auto mb-5" />
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
            Olam PropertySync
          </h1>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-lg p-8 shadow-sm animate-fade-in-up stagger-1">
          <p className="text-secondary text-sm text-center mb-6">
            Sign in to continue
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs font-semibold text-secondary mb-1.5">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface border-2 border-border rounded-[4px] text-foreground text-sm placeholder-dim focus:outline-none focus:border-accent transition-colors duration-150"
                placeholder="Enter username"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-secondary mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-surface border-2 border-border rounded-[4px] text-foreground text-sm placeholder-dim focus:outline-none focus:border-accent transition-colors duration-150"
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-danger-dim rounded-[4px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-danger flex-shrink-0">
                  <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <p className="text-danger text-sm font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-[4px] font-semibold text-sm text-white transition-colors duration-150 cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-muted text-xs mt-5 animate-fade-in-up stagger-2">
          NYC property owner & billing lookup
        </p>
      </div>
    </div>
  );
}
