import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research MVP",
  description: "Topic → concept overview, related papers, graph, and follow-up chat.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
