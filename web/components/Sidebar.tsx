"use client";

import { useState } from "react";
import { useSessionList, deleteSession, type SessionSummary } from "@/lib/sessions";
import { History, X, Plus } from "lucide-react";

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
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed right-6 bottom-6 z-40 p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-zinc-600 dark:text-zinc-300 ${isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}
        aria-label="Open session history"
      >
        <History size={24} />
      </button>

      {/* Floating Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Floating Panel */}
      <aside 
        className={`fixed top-0 right-0 z-50 w-80 h-full bg-white dark:bg-[#111113] border-l border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col transform transition-transform duration-500 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100 dark:border-zinc-800/50">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <History size={16} />
            Session History
          </h2>
          <button 
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* New button */}
        <div className="p-4">
          <button
            onClick={() => {
              onNew();
              setIsOpen(false);
            }}
            className="w-full px-4 py-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-600/10 dark:hover:bg-blue-600/20 border border-blue-200 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-medium flex items-center justify-center gap-2 transition-all shadow-sm"
          >
            <Plus size={16} />
            New research
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="w-12 h-12 rounded-full bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-center mb-4">
                <History className="text-zinc-300 dark:text-zinc-600" size={24} />
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No sessions yet.
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                Start searching to build history.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {sessions.map((s) => (
                <SidebarItem
                  key={s.id}
                  session={s}
                  active={activeId === s.id}
                  onSelect={() => {
                    onSelect(s.id);
                    setIsOpen(false);
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-100 dark:border-zinc-800/50 text-xs text-center text-zinc-400 dark:text-zinc-500 bg-zinc-50 dark:bg-transparent">
          Saved locally in your browser
        </div>
      </aside>
    </>
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
    <li className="group relative px-2">
      <button
        onClick={onSelect}
        className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
          active
            ? "bg-blue-50 dark:bg-blue-600/10 border border-blue-200/50 dark:border-blue-500/20"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent"
        }`}
      >
        <div className={`truncate text-sm font-medium pr-6 ${active ? 'text-blue-700 dark:text-blue-300' : 'text-zinc-700 dark:text-zinc-300'}`}>
          {session.topic}
        </div>
        <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
          {relativeTime(session.updatedAt)}
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Delete "${session.topic}"?`)) deleteSession(session.id);
        }}
        className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-all"
        title="Delete"
        aria-label="Delete session"
      >
        <X size={14} />
      </button>
    </li>
  );
}
