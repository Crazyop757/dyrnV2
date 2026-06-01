"use client";

export default function ClusterGroupNode({ data }: { data: any }) {
  return (
    <div className="w-full h-full border-2 border-dashed border-zinc-700 bg-zinc-800/10 rounded-xl pointer-events-none relative">
      <div className="absolute top-2 left-4 text-xs font-bold text-zinc-500 uppercase tracking-widest">
        {data.label}
      </div>
    </div>
  );
}
