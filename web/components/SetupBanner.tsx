import { VANE_URL } from "@/lib/vane";

export default function SetupBanner() {
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3.5 text-sm text-amber-700 dark:text-amber-300/80 shadow-sm">
      <span className="font-semibold text-amber-800 dark:text-amber-200">One-time setup required.</span>{" "}
      Open{" "}
      <a
        href={VANE_URL}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
      >
        {VANE_URL}
      </a>{" "}
      and add your API key on Vane&apos;s setup screen. Once a chat model and embedding model are
      configured, refresh this page.
    </div>
  );
}
