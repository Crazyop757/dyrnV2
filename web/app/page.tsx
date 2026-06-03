"use client";

import { useEffect, useRef, useState } from "react";
import TopicBox from "@/components/TopicBox";
import ConceptOverview from "@/components/ConceptOverview";
import PapersList from "@/components/PapersList";
import GapAnalysisSection from "@/components/GapAnalysis";
import RelationsGraph from "@/components/RelationsGraph";
import ChatBox from "@/components/ChatBox";
import SetupBanner from "@/components/SetupBanner";
import Sidebar from "@/components/Sidebar";
import { discoverModels, search, type ModelChoice } from "@/lib/vane";
import { fetchGraph, fetchPapers, fetchGapAnalysis } from "@/lib/researchApi";
import type { ChatTurn, GapAnalysisResponse, GraphResponse, Paper, VaneAnswer } from "@/lib/types";
import {
  createSession,
  loadSession,
  saveSession,
  type Session,
} from "@/lib/sessions";

export default function Page() {
  const [models, setModels] = useState<ModelChoice | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

  const [session, setSession] = useState<Session | null>(null);
  const [running, setRunning] = useState(false);

  const [overviewErr, setOverviewErr] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [papersErr, setPapersErr] = useState<string | null>(null);
  const [papersLoading, setPapersLoading] = useState(false);
  const [graphErr, setGraphErr] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [gapAnalyzing, setGapAnalyzing] = useState(false);
  const [gapErr, setGapErr] = useState<string | null>(null);

  const activeRunId = useRef<string | null>(null);

  useEffect(() => {
    discoverModels()
      .then(setModels)
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    if (!session) return;
    saveSession(session);
  }, [session]);

  const patchSession = (patch: Partial<Session>) => {
    setSession((curr) => (curr ? { ...curr, ...patch, updatedAt: Date.now() } : curr));
  };

  const handleSelect = (id: string) => {
    const s = loadSession(id);
    if (!s) return;
    activeRunId.current = null;
    setOverviewErr(null); setOverviewLoading(false);
    setPapersErr(null); setPapersLoading(false);
    setGraphErr(null); setGraphLoading(false);
    setGapAnalyzing(false); setGapErr(null);
    setRunning(false);
    setSession(s);
  };

  const handleNew = () => {
    activeRunId.current = null;
    setOverviewErr(null); setOverviewLoading(false);
    setPapersErr(null); setPapersLoading(false);
    setGraphErr(null); setGraphLoading(false);
    setGapAnalyzing(false); setGapErr(null);
    setRunning(false);
    setSession(null);
  };

  const runSearch = async (topic: string) => {
    if (!models) return;
    const fresh = createSession(topic);
    activeRunId.current = fresh.id;
    setSession(fresh);
    setRunning(true);
    setOverviewErr(null); setOverviewLoading(true);
    setPapersErr(null); setPapersLoading(true);
    setGraphErr(null); setGraphLoading(false);
    setGapAnalyzing(false); setGapErr(null);

    const stillActive = () => activeRunId.current === fresh.id;

    const overviewP = search({
      query: topic,
      models,
      sources: ["academic", "web"],
      systemInstructions:
        "You are a research intelligence assistant. A researcher has " +
        "submitted a new topic. Give a structured concept overview using " +
        "this exact shape:\n\n" +
        "[ORIENT] 2-3 sentences framing what this topic is and why it " +
        "matters in research — not a textbook definition, a research " +
        "framing.\n\n" +
        "[MAIN APPROACHES] For each major approach in the literature, " +
        "state what it does and where it falls short. Cite specific " +
        "methodological choices, not just category names.\n\n" +
        "[OPEN TENSIONS] What is genuinely unresolved or contested in " +
        "this space? Name the specific contradiction or gap, not a " +
        "generic challenge.\n\n" +
        "Hard limits: No tutorial language. No \"It is important to note.\" " +
        "No more than 4 paragraphs total. Write as a senior collaborator " +
        "briefing a peer, not a professor lecturing a student.",
    })
      .then((a) => {
        if (stillActive()) patchSession({ overview: a });
      })
      .catch((e) => {
        if (stillActive()) setOverviewErr(e.message || String(e));
      })
      .finally(() => {
        if (stillActive()) setOverviewLoading(false);
      });

    const papersP = fetchPapers(topic)
      .then(async (resp) => {
        if (!stillActive()) return;
        patchSession({ papers: resp.papers });
        setPapersLoading(false);

        const seedIds = resp.papers
          .filter((p) => !p.id.startsWith("OA:") && !p.id.startsWith("DOI:") && !p.id.startsWith("PMID:"))
          .slice(0, 20)
          .map((p) => p.id);

        const graphP = (async () => {
          if (seedIds.length === 0) {
            setGraphErr("Need Semantic Scholar IDs to build a graph; none in this result set.");
            return;
          }
          setGraphLoading(true);
          try {
            const g = await fetchGraph(seedIds);
            if (stillActive()) patchSession({ graph: g });
          } catch (e: any) {
            if (stillActive()) setGraphErr(e.message || String(e));
          } finally {
            if (stillActive()) setGraphLoading(false);
          }
        })();

        const gapP = (async () => {
          if (!stillActive()) return;
          try {
            setGapAnalyzing(true);
            const seedIds = resp.papers
              .filter((p) => !p.id.startsWith("OA:") && !p.id.startsWith("DOI:") && !p.id.startsWith("PMID:"))
              .map((p) => p.id);
            const result = await fetchGapAnalysis(topic, resp.papers, seedIds);
            if (stillActive()) patchSession({ gaps: result });
          } catch (e: any) {
            if (stillActive()) setGapErr(e.message || String(e));
          } finally {
            if (stillActive()) setGapAnalyzing(false);
          }
        })();

        await Promise.allSettled([graphP, gapP]);
      })
      .catch((e) => {
        if (stillActive()) { setPapersErr(e.message || String(e)); setPapersLoading(false); }
      });

    await Promise.allSettled([overviewP, papersP]);
    if (stillActive()) setRunning(false);
  };

  const handleTurnsChange = (next: ChatTurn[]) => patchSession({ chat: next });

  const topic: string | null = session?.topic ?? null;
  const overview: VaneAnswer | null = session?.overview ?? null;
  const papers: Paper[] = session?.papers ?? [];
  const gaps: GapAnalysisResponse | null = session?.gaps ?? null;
  const graph: GraphResponse | null = session?.graph ?? null;
  const chat: ChatTurn[] = session?.chat ?? [];

  const EXAMPLE_TOPICS = [
    "CRISPR gene editing off-targets",
    "transformer attention mechanisms",
    "antibiotic resistance evolution",
    "diffusion models for protein structure",
  ];

  return (
    <div className="flex h-screen bg-[#04070f] text-zinc-100 overflow-hidden">
      <Sidebar activeId={session?.id ?? null} onSelect={handleSelect} onNew={handleNew} />

      <main className="flex-1 overflow-y-auto">
        {!topic ? (
          <div className="relative h-full flex flex-col items-center justify-center px-6 py-16 overflow-hidden">
            {/* Background glow */}
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-indigo-600/8 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[300px] bg-violet-600/6 rounded-full blur-[80px] pointer-events-none" />

            {/* Dot grid */}
            <div className="absolute inset-0 bg-dots opacity-100 pointer-events-none" />

            <div className="relative w-full max-w-2xl space-y-8">
              {/* Badge */}
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  Research Intelligence
                </div>
              </div>

              {/* Heading */}
              <div className="text-center space-y-4">
                <h1 className="text-5xl font-bold tracking-tight gradient-heading leading-tight">
                  Research anything.
                </h1>
                <p className="text-zinc-500 text-base leading-relaxed max-w-lg mx-auto">
                  Enter a topic — get a concept overview, related papers,
                  gap analysis, and a research assistant in one shot.
                </p>
              </div>

              {!modelsLoading && !models && <SetupBanner />}

              <TopicBox onSubmit={runSearch} disabled={running || !models} hero />

              {/* Example chips */}
              <div className="space-y-3">
                <p className="text-center text-zinc-700 text-xs">Try an example</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {EXAMPLE_TOPICS.map((t) => (
                    <button
                      key={t}
                      onClick={() => !running && models && runSearch(t)}
                      disabled={running || !models}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] hover:border-indigo-500/30 text-zinc-500 hover:text-zinc-300 text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-center text-zinc-800 text-xs">
                Saved in your browser · No account needed
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-6 py-10 space-y-12">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-zinc-700">
                <span>Research</span>
                <span className="text-zinc-800">/</span>
                <span className="text-zinc-500 truncate max-w-sm font-medium">{topic}</span>
              </div>
              <TopicBox onSubmit={runSearch} disabled={running || !models} />
            </div>

            <ConceptOverview loading={overviewLoading} error={overviewErr} answer={overview} />
            <PapersList loading={papersLoading} error={papersErr} papers={papers} />
            <GapAnalysisSection
              analyzing={gapAnalyzing}
              error={gapErr}
              data={gaps}
            />
            <RelationsGraph loading={graphLoading} error={graphErr} data={graph} />
            {models && (
              <ChatBox
                models={models}
                overview={overview}
                papers={papers}
                topic={topic}
                turns={chat}
                onTurnsChange={handleTurnsChange}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
