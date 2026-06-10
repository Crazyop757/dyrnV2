"use client";

import { useEffect, useRef, useState } from "react";
import TopicBox from "@/components/TopicBox";
import ConceptOverview from "@/components/ConceptOverview";
import PapersList from "@/components/PapersList";
import LiteratureReview from "@/components/LiteratureReview";
import GapAnalysisSection from "@/components/GapAnalysis";
import ExtractionMatrix from "@/components/ExtractionMatrix";
import CoverageDashboard from "@/components/CoverageDashboard";
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

  const [showGap, setShowGap] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [showLitReview, setShowLitReview] = useState(false);
  const [showChat, setShowChat] = useState(false);

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
    setShowGap(false); setShowMatrix(false); setShowCoverage(false); setShowGraph(false); setShowLitReview(false);
    setRunning(false);
    setSession(s);
  };

  const handleNew = () => {
    activeRunId.current = null;
    setOverviewErr(null); setOverviewLoading(false);
    setPapersErr(null); setPapersLoading(false);
    setGraphErr(null); setGraphLoading(false);
    setGapAnalyzing(false); setGapErr(null);
    setShowGap(false); setShowMatrix(false); setShowCoverage(false); setShowGraph(false); setShowLitReview(false);
    setRunning(false);
    setSession(null);
  };

  const runSearch = async (topic: string) => {
    if (!models) {
      alert("Please complete the one-time setup by configuring an API key first.");
      return;
    }
    const fresh = createSession(topic);
    activeRunId.current = fresh.id;
    setSession(fresh);
    setRunning(true);
    setOverviewErr(null); setOverviewLoading(true);
    setPapersErr(null); setPapersLoading(true);
    setGraphErr(null); setGraphLoading(false);
    setGapAnalyzing(false); setGapErr(null);
    setShowGap(false); setShowMatrix(false); setShowCoverage(false); setShowGraph(false); setShowLitReview(false);

    const stillActive = () => activeRunId.current === fresh.id;

    const overviewP = search({
      // Phrase as an explicit research request — Vane's intent classifier
      // skips searching for bare topic strings ("X for Y"), which leaves the
      // answer ungrounded (and strict models then refuse to answer at all).
      query: `Recent academic research and literature on: ${topic}`,
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
    <div className="flex min-h-screen text-foreground">
      <Sidebar activeId={session?.id ?? null} onSelect={handleSelect} onNew={handleNew} />

      <main className="flex-1 w-full pt-28 pb-12 overflow-y-auto">
        {!topic ? (
          <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center h-full">
            
            {/* Left side: Text & Actions */}
            <div className="space-y-8 max-w-xl">
              {/* Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                AI-Powered Research Analytics
              </div>

              {/* Heading */}
              <div className="space-y-4">
                <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-[1.1]" style={{ fontFamily: "ui-serif, Georgia, serif" }}>
                  Research intelligence, <br />
                  <span className="bg-gradient-to-r from-blue-600 to-indigo-500 dark:from-blue-400 dark:to-indigo-400 bg-clip-text text-transparent italic pr-2">reimagined</span>
                </h1>
                <p className="text-zinc-600 dark:text-zinc-400 text-lg leading-relaxed">
                  Automatically synthesize concept overviews, map academic paper relationships, and generate actionable research gap analyses — all powered by advanced LLMs.
                </p>
              </div>

              {!modelsLoading && !models && <SetupBanner />}

              {/* TopicBox integrated into Hero */}
              <div className="pt-2">
                <TopicBox onSubmit={runSearch} disabled={running} hero />
              </div>

              {/* Example chips */}
              <div className="space-y-3 pt-4">
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_TOPICS.map((t) => (
                    <button
                      key={t}
                      onClick={() => !running && models && runSearch(t)}
                      disabled={running || !models}
                      className="px-3 py-1.5 rounded-full bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/50 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 text-xs transition-all shadow-sm"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right side: Hero Image Card */}
            <div className="relative w-full aspect-[4/3] rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 group">
              {/* Use a standard img tag to avoid needing Next/Image config for local absolute paths right now */}
              <img 
                src="/hero.png" 
                alt="Researcher analyzing data" 
                className="object-cover w-full h-full transition-transform duration-700 group-hover:scale-105"
              />
              {/* Overlay matching "Real-time Detection" from screenshot */}
              <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                <h3 className="text-white font-bold text-lg mb-1">Real-time Literature Analysis</h3>
                <p className="text-white/80 text-sm">LLM-powered gap extraction identifies missing research in real-time</p>
              </div>
              {/* Pagination Dots */}
              <div className="absolute bottom-8 right-8 flex gap-1.5">
                <div className="w-4 h-1.5 rounded-full bg-white"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-white/40"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-white/40"></div>
              </div>
            </div>

          </div>

        ) : (
          <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 space-y-12 pb-32">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span>Research</span>
                <span className="text-zinc-300 dark:text-zinc-700">/</span>
                <span className="text-zinc-900 dark:text-zinc-200 truncate max-w-sm font-medium">{topic}</span>
              </div>
              <TopicBox onSubmit={runSearch} disabled={running} />
            </div>

            {(() => {
              const activeBlocks: React.ReactNode[] = [];
              if (showGap) activeBlocks.push(
                <GapAnalysisSection key="gap" analyzing={gapAnalyzing} error={gapErr} data={gaps} />
              );
              if (showLitReview && papers.length > 0) activeBlocks.push(
                <LiteratureReview key="lit" topic={topic} papers={papers} />
              );
              if (showMatrix && papers.length > 0) activeBlocks.push(
                <ExtractionMatrix key="matrix" papers={papers} />
              );
              if (showCoverage && papers.length > 0) activeBlocks.push(
                <CoverageDashboard 
                  key="coverage"
                  paperIds={papers.map((p) => p.id)} 
                  onAddPaper={(paper) => {
                    if (!papers.some((p) => p.id === paper.id)) {
                      patchSession({ papers: [...papers, paper] });
                    }
                  }}
                />
              );
              if (showGraph) activeBlocks.push(
                <RelationsGraph key="graph" loading={graphLoading} error={graphErr} data={graph} />
              );

              // ConceptOverview (Left) is very short. PapersList (Right) is very long.
              // To prevent massive gaps, we heavily bias the first active blocks into the left column.
              const leftBlocks: React.ReactNode[] = [];
              const rightBlocks: React.ReactNode[] = [];
              activeBlocks.forEach((block, idx) => {
                if (idx === 0 || idx === 1) leftBlocks.push(block); // 1st and 2nd go Left
                else if (idx % 2 === 0) rightBlocks.push(block);    // 3rd goes Right
                else leftBlocks.push(block);                        // 4th goes Left
              });

              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                  {/* Left Column */}
                  <div className="flex flex-col gap-8">
                    <ConceptOverview loading={overviewLoading} error={overviewErr} answer={overview} />
                    {leftBlocks}
                  </div>

                  {/* Right Column */}
                  <div className="flex flex-col gap-8">
                    <PapersList loading={papersLoading} error={papersErr} papers={papers} />
                    {rightBlocks}
                  </div>
                </div>
              );
            })()}

            {/* Floating Ask Follow-ups */}
            {models && showChat && (
              <div className="fixed bottom-[88px] left-1/2 -translate-x-1/2 w-[95vw] max-w-3xl z-40">
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800/80 bg-white/95 dark:bg-[#0c0c0e]/95 backdrop-blur-xl shadow-2xl shadow-black/10 dark:shadow-black/50 p-6 max-h-[60vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Ask Follow-ups</h3>
                    <button onClick={() => setShowChat(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-1">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <ChatBox
                    models={models}
                    overview={overview}
                    papers={papers}
                    topic={topic}
                    turns={chat}
                    onTurnsChange={handleTurnsChange}
                  />
                </div>
              </div>
            )}

            {/* Floating Bottom Dock */}
            {session && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 p-2 rounded-2xl bg-white/70 dark:bg-[#07070a]/70 backdrop-blur-xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-2xl overflow-x-auto max-w-[95vw]">
                <button
                  onClick={() => setShowGap(!showGap)}
                  className={`px-5 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-2 ${showGap ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  Gap Analysis
                </button>
                <button
                  onClick={() => setShowLitReview(!showLitReview)}
                  className={`px-5 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-2 ${showLitReview ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                  Literature Review
                </button>
                <button
                  onClick={() => setShowMatrix(!showMatrix)}
                  className={`px-5 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-2 ${showMatrix ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  Extraction Matrix
                </button>
                <button
                  onClick={() => setShowCoverage(!showCoverage)}
                  className={`px-5 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-2 ${showCoverage ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                  Coverage Saturation
                </button>
                <button
                  onClick={() => setShowGraph(!showGraph)}
                  className={`px-5 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-2 ${showGraph ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  Relation Graphs
                </button>
                <button
                  onClick={() => setShowChat(!showChat)}
                  className={`px-5 py-3 rounded-xl font-medium text-sm whitespace-nowrap transition-colors flex items-center gap-2 ${showChat ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                  Ask Follow-ups
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
