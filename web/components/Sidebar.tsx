"use client";

import { useSessionList, deleteSession, type SessionSummary } from "@/lib/sessions";

type Props = {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = 60_000, h = 60 * m, d = 24 * h;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function Sidebar({ activeId, onSelect, onNew }: Props) {
  const sessions = useSessionList();

  return (
    <aside className="w-56 shrink-0 bg-[#04070f] border-r border-white/[0.05] flex flex-col h-screen">
      {/* Brand */}
      <div className="px-4 py-4 flex items-center gap-2.5">
        <svg viewBox="0 0 64 64" className="w-7 h-7 rounded-lg shadow-lg shadow-indigo-900/40 select-none" aria-label="DYRN logo">
          <defs>
            <linearGradient id="dyrn-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6366f1" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="14" fill="url(#dyrn-g)" />
          <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.95">
            <path d="M23 17 v30" />
            <path d="M23 17 C45 17 45 47 23 47" />
            <path d="M23 32 h16.5" opacity="0.55" />
          </g>
          <g fill="#fff">
            <circle cx="23" cy="17" r="5" />
            <circle cx="23" cy="47" r="5" />
            <circle cx="39.5" cy="32" r="5" />
          </g>
          <circle cx="39.5" cy="32" r="2.2" fill="#7c3aed" />
        </svg>
        <span className="text-sm font-bold text-zinc-100 tracking-[0.18em]">DYRN</span>
      </div>

      {/* New button */}
      <div className="px-3 pb-3">
        <button
          onClick={onNew}
          className="w-full px-3 py-2.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/20 hover:border-indigo-500/40 text-indigo-300 text-xs font-semibold flex items-center gap-2 transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="6" y1="1" x2="6" y2="11" />
            <line x1="1" y1="6" x2="11" y2="6" />
          </svg>
          New research
        </button>
      </div>

      {/* Divider */}
      <div className="mx-3 mb-2 h-px bg-white/[0.04]" />

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {sessions.length === 0 ? (
          <p className="px-3 py-6 text-xs text-zinc-700 text-center leading-relaxed">
            No sessions yet.<br />Start with a topic above.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((s) => (
              <SidebarItem
                key={s.id}
                session={s}
                active={activeId === s.id}
                onSelect={() => onSelect(s.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/[0.04] text-[10px] text-zinc-700">
        Saved in your browser
      </div>
    </aside>
  );
}

function SidebarItem({
  session,
  active,
  onSelect,
}: {
  session: SessionSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="group relative">
      <button
        onClick={onSelect}
        className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
          active
            ? "bg-indigo-600/15 border border-indigo-500/20 text-zinc-100"
            : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300 border border-transparent"
        }`}
      >
        <div className="truncate text-xs font-medium pr-5 leading-snug">{session.topic}</div>
        <div className="text-[10px] text-zinc-700 mt-0.5">{relativeTime(session.updatedAt)}</div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Delete "${session.topic}"?`)) deleteSession(session.id);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-zinc-600 hover:text-red-400 rounded transition-all"
        title="Delete"
        aria-label="Delete session"
      >
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="1" y1="1" x2="8" y2="8" />
          <line x1="8" y1="1" x2="1" y2="8" />
        </svg>
      </button>
    </li>
  );
}
