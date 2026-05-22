"use client";

import { useSessionList, deleteSession, type SessionSummary } from "@/lib/sessions";

type Props = {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * d) return `${Math.floor(diff / d)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function Sidebar({ activeId, onSelect, onNew }: Props) {
  const sessions = useSessionList();

  return (
    <aside className="w-64 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col h-screen sticky top-0">
      <div className="p-3 border-b border-zinc-800">
        <button
          onClick={onNew}
          className="w-full px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-medium flex items-center gap-2 transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          <span>New chat</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <p className="px-3 py-4 text-xs text-zinc-500">
            No chats yet. Start one with a topic above.
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

      <div className="p-3 border-t border-zinc-800 text-[11px] text-zinc-500">
        Chats are stored in your browser.
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
        className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
          active
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
        }`}
      >
        <div className="truncate text-sm pr-6">{session.topic}</div>
        <div className="text-[11px] text-zinc-500 mt-0.5">
          {relativeTime(session.updatedAt)}
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Delete chat "${session.topic}"?`)) {
            deleteSession(session.id);
          }
        }}
        className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-xs px-1.5 py-0.5 rounded transition-opacity"
        title="Delete chat"
        aria-label="Delete chat"
      >
        ×
      </button>
    </li>
  );
}
