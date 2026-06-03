import { VANE_URL } from "@/lib/vane";

export default function SetupBanner() {
  return (
    <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 px-4 py-3.5 text-sm text-amber-300/80">
      <span className="font-semibold text-amber-200">One-time setup required.</span>{" "}
      Open{" "}
      <a
        href={VANE_URL}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 hover:text-amber-100 transition-colors"
      >
        {VANE_URL}
      </a>{" "}
      and add your API key on Vane&apos;s setup screen. Once a chat model and embedding model are
      configured, refresh this page.
    </div>
  );
}
