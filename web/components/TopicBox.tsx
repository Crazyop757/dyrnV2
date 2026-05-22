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
        className="flex-1 border border-stone-300 rounded-md px-4 py-3 text-base focus:outline-none focus:border-stone-600"
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="px-6 py-3 bg-stone-900 text-white rounded-md font-medium disabled:bg-stone-400"
      >
        Search
      </button>
    </form>
  );
}
