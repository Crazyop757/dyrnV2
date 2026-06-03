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
      <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
        className={`flex-1 bg-zinc-900/60 border border-zinc-800/80 rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all backdrop-blur-sm ${
          hero ? "pl-11 pr-4 py-4 text-base" : "pl-10 pr-4 py-3 text-sm"
        }`}
        disabled={disabled}
        autoFocus={hero}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className={`shrink-0 px-6 rounded-xl font-semibold transition-all whitespace-nowrap bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white shadow-lg shadow-indigo-900/30 disabled:bg-zinc-800/80 disabled:text-zinc-600 disabled:shadow-none ${
          hero ? "py-4 text-sm" : "py-3 text-xs"
        }`}
      >
        {hero ? "Explore" : "Search"}
      </button>
    </form>
  );
}
