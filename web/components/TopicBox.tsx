"use client";

import { useState } from "react";

type Props = {
  initialTopic?: string;
  disabled?: boolean;
  onSubmit: (topic: string) => void;
  hero?: boolean;
};

export default function TopicBox({ initialTopic = "", disabled, onSubmit, hero }: Props) {
  const [value, setValue] = useState(initialTopic);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = value.trim();
        if (t) onSubmit(t);
      }}
      className={`relative flex items-center gap-3 ${hero ? "" : ""}`}
    >
      {/* Search icon */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 dark:text-zinc-500">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
      </div>

      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          hero
            ? "e.g. graph neural networks for drug discovery"
            : "Search a different topic…"
        }
        className={`flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all shadow-sm ${
          hero ? "pl-11 pr-4 py-4 text-base" : "pl-10 pr-4 py-3 text-sm"
        }`}
        disabled={disabled}
        autoFocus={hero}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className={`shrink-0 px-6 rounded-xl font-medium transition-all whitespace-nowrap bg-blue-600 hover:bg-blue-700 active:scale-95 text-white shadow-md disabled:bg-zinc-100 dark:disabled:bg-zinc-800 disabled:text-zinc-400 dark:disabled:text-zinc-600 disabled:shadow-none ${
          hero ? "py-4 text-sm" : "py-3 text-sm"
        }`}
      >
        {hero ? "Get Started \u2192" : "Search"}
      </button>
    </form>
  );
}
