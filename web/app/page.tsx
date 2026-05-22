"use client";

import { useEffect, useState } from "react";
import TopicBox from "@/components/TopicBox";
import ConceptOverview from "@/components/ConceptOverview";
import PapersList from "@/components/PapersList";
import RelationsGraph from "@/components/RelationsGraph";
import ChatBox from "@/components/ChatBox";
import SetupBanner from "@/components/SetupBanner";
import { discoverModels, search, type ModelChoice } from "@/lib/vane";
import { fetchGraph, fetchPapers } from "@/lib/researchApi";
import type { GraphResponse, Paper, VaneAnswer } from "@/lib/types";

export default function Page() {
  const [models, setModels] = useState<ModelChoice | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

  const [topic, setTopic] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [overview, setOverview] = useState<VaneAnswer | null>(null);
  const [overviewErr, setOverviewErr] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  const [papers, setPapers] = useState<Paper[]>([]);
  const [papersErr, setPapersErr] = useState<string | null>(null);
  const [papersLoading, setPapersLoading] = useState(false);

  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [graphErr, setGraphErr] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  useEffect(() => {
    discoverModels()
      .then(setModels)
      .finally(() => setModelsLoading(false));
  }, []);

  const runSearch = async (t: string) => {
    if (!models) return;
    setTopic(t);
    setRunning(true);

    // Reset all sections.
    setOverview(null);
    setOverviewErr(null);
    setOverviewLoading(true);
    setPapers([]);
    setPapersErr(null);
    setPapersLoading(true);
    setGraph(null);
    setGraphErr(null);
    setGraphLoading(false);

    // Concept overview and papers run in parallel.
    const overviewP = search({
      query: t,
      models,
      sources: ["academic", "web"],
      systemInstructions:
        "You are summarizing a research topic for a researcher. Give a concise " +
        "overview (3-5 short paragraphs) of what the topic is, the main approaches, " +
        "and the key open questions. Cite sources inline.",
    })
      .then((a) => setOverview(a))
      .catch((e) => setOverviewErr(e.message || String(e)))
      .finally(() => setOverviewLoading(false));

    const papersP = fetchPapers(t)
      .then(async (resp) => {
        setPapers(resp.papers);
        setPapersLoading(false);

        // Only S2 ids can seed the graph.
        const seedIds = resp.papers
          .filter((p) => !p.id.startsWith("OA:"))
          .slice(0, 6)
          .map((p) => p.id);
        if (seedIds.length === 0) {
          setGraphErr("Need Semantic Scholar IDs to build a graph; none in this result set.");
          return;
        }
        setGraphLoading(true);
        try {
          const g = await fetchGraph(seedIds);
          setGraph(g);
        } catch (e: any) {
          setGraphErr(e.message || String(e));
        } finally {
          setGraphLoading(false);
        }
      })
      .catch((e) => {
        setPapersErr(e.message || String(e));
        setPapersLoading(false);
      });

    await Promise.allSettled([overviewP, papersP]);
    setRunning(false);
  };

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Research MVP</h1>
        <p className="text-stone-600 mt-1 text-sm">
          Type a topic. Get a concept overview, related papers, a graph of how they relate, and a chat box for
          follow-up questions.
        </p>
      </header>

      {!modelsLoading && !models && <SetupBanner />}

      <TopicBox onSubmit={runSearch} disabled={running || !models} />

      {topic && (
        <>
          <ConceptOverview loading={overviewLoading} error={overviewErr} answer={overview} />
          <PapersList loading={papersLoading} error={papersErr} papers={papers} />
          <RelationsGraph loading={graphLoading} error={graphErr} data={graph} />
          {models && (
            <ChatBox models={models} overview={overview} papers={papers} topic={topic} />
          )}
        </>
      )}
    </main>
  );
}
