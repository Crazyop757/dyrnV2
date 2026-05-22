"use client";

import { useState } from "react";

type Props = {
  initialTopic?: string;
  disabled?: boolean;
  onSubmit: (topic: string) => void;
};

export default function TopicBox({ initialTopic = "", disabled, onSubmit }: Props) {
  const [value, setValue] = useState(initialTopic);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = value.trim();
        if (t) onSubmit(t);
      }}
      className="flex gap-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter a research topic (e.g. graph neural networks for drug discovery)"
        className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-4 py-3 text-base text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="px-6 py-3 bg-zinc-100 text-zinc-900 rounded-md font-medium hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500 transition-colors"
      >
        Search
      </button>
    </form>
  );
}
