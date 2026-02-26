"use client";

export default function Header({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="bg-nav border-b border-nav-hover">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-6 h-14">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="w-7 h-7 rounded" />
          <span className="text-[15px] font-semibold text-white tracking-tight">
            Olam PropertySync
          </span>
        </div>

        <button
          onClick={onLogout}
          className="px-3 py-1.5 text-sm font-medium text-nav-text-dim hover:text-nav-text hover:bg-white/10 rounded transition-colors duration-150 cursor-pointer"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
