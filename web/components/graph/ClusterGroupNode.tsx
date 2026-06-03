"use client";

const CLUSTER_BORDER_COLORS = ["#10b981", "#3b82f6", "#a78bfa", "#f59e0b"];

export default function ClusterGroupNode({ data }: { data: any }) {
  const colorIndex = data.colorIndex ?? 0;
  const color = CLUSTER_BORDER_COLORS[colorIndex % CLUSTER_BORDER_COLORS.length];

  return (
    <div
      className="w-full h-full rounded-2xl pointer-events-none relative"
      style={{
        border: `1.5px dashed ${color}40`,
        background: `${color}06`,
      }}
    >
      <div
        className="absolute top-3 left-4 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: `${color}90` }}
      >
        {data.label}
      </div>
    </div>
  );
}
