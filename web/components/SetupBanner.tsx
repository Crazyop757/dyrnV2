import { VANE_URL } from "@/lib/vane";

export default function SetupBanner() {
  return (
    <div className="border border-amber-300 bg-amber-50 text-amber-900 rounded-md px-4 py-3 text-sm">
      <strong>One-time setup required.</strong> Open{" "}
      <a href={VANE_URL} target="_blank" rel="noreferrer" className="underline">
        {VANE_URL}
      </a>{" "}
      and add your OpenAI API key (or another provider) on Vane&apos;s setup screen. Once a chat model
      and an embedding model are configured, refresh this page.
    </div>
  );
}
