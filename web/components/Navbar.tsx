"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export default function Navbar() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-6xl">
      <nav className="flex items-center justify-between px-6 py-3 rounded-full bg-white/80 dark:bg-[#111113]/80 backdrop-blur-md border border-zinc-200 dark:border-zinc-800 shadow-sm">
        
        {/* Logo */}
        <div className="flex items-center">
          <Link href="/" className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100" style={{ fontFamily: "ui-serif, Georgia, serif" }}>
            DYRN
          </Link>
        </div>

        {/* Links */}
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          <Link href="#" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">Dashboard</Link>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 transition-colors"
            aria-label="Toggle theme"
          >
            {mounted ? (
              theme === "dark" ? <Sun size={18} /> : <Moon size={18} />
            ) : (
              <div className="w-[18px] h-[18px]" />
            )}
          </button>
        </div>

      </nav>
    </div>
  );
}
