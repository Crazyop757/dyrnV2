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
import { discoverModels, search, analyzeGaps, type ModelChoice } from "@/lib/vane";
import { fetchGraph, fetchPapers, fetchExtraction } from "@/lib/researchApi";
import type { ChatTurn, GapAnalysis, GapVerification, GraphResponse, Paper, PaperSections, VaneAnswer } from "@/lib/types";
import {
  createSession,
  loadSession,
  saveSession,
  type Session,
} from "@/lib/sessions";

export default function Page() {
  const [models, setModels] = useState<ModelChoice | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);

  // The full session in view. `null` = blank slate (no topic submitted yet).
  // The page owns this so the sidebar can swap it out wholesale on select.
  const [session, setSession] = useState<Session | null>(null);
  const [running, setRunning] = useState(false);

  const [overviewErr, setOverviewErr] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [papersErr, setPapersErr] = useState<string | null>(null);
  const [papersLoading, setPapersLoading] = useState(false);
  const [graphErr, setGraphErr] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [gapExtracting, setGapExtracting] = useState(false);
  const [gapAnalyzing, setGapAnalyzing] = useState(false);
  const [gapErr, setGapErr] = useState<string | null>(null);

  // runSearch resolves async pieces and then patches them onto whatever
  // session is current. We capture the id at start so a late response from a
  // previous topic can't smash a session the user has since switched away
  // from.
  const activeRunId = useRef<string | null>(null);

  useEffect(() => {
    discoverModels()
      .then(setModels)
      .finally(() => setModelsLoading(false));
  }, []);

  // Persist the session every time it changes (chat turns, fetched data, etc.).
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
    setOverviewErr(null);
    setOverviewLoading(false);
    setPapersErr(null);
    setPapersLoading(false);
    setGraphErr(null);
    setGraphLoading(false);
    setGapExtracting(false);
    setGapAnalyzing(false);
    setGapErr(null);
    setRunning(false);
    setSession(s);
  };

  const handleNew = () => {
    activeRunId.current = null;
    setOverviewErr(null);
    setOverviewLoading(false);
    setPapersErr(null);
    setPapersLoading(false);
    setGraphErr(null);
    setGraphLoading(false);
    setGapExtracting(false);
    setGapAnalyzing(false);
    setGapErr(null);
    setRunning(false);
    setSession(null);
  };

  const runSearch = async (topic: string) => {
    if (!models) return;
    const fresh = createSession(topic);
    activeRunId.current = fresh.id;
    setSession(fresh);
    setRunning(true);

    setOverviewErr(null);
    setOverviewLoading(true);
    setPapersErr(null);
    setPapersLoading(true);
    setGraphErr(null);
    setGraphLoading(false);
    setGapExtracting(false);
    setGapAnalyzing(false);
    setGapErr(null);

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

        // Launch graph building and gap extraction in parallel.
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
          if (!models || !stillActive()) return;
          try {
            setGapExtracting(true);
            let sections: Record<string, import("@/lib/types").PaperSections> = {};
            try {
              const extracted = await fetchExtraction(resp.papers);
              sections = extracted.sections;
              if (stillActive()) patchSession({ extractedSections: sections });
            } catch {
              // Extraction is best-effort; continue with abstract-only.
            }
            if (!stillActive()) return;
            setGapExtracting(false);
            setGapAnalyzing(true);

            const answer = await analyzeGaps({
              topic,
              papers: resp.papers,
              sections,
              models,
            });
            if (stillActive()) {
              patchSession({ gaps: { message: answer.message, sources: answer.sources, verifications: [] } });
            }
          } catch (e: any) {
            if (stillActive()) setGapErr(e.message || String(e));
          } finally {
            if (stillActive()) {
              setGapExtracting(false);
              setGapAnalyzing(false);
            }
          }
        })();

        await Promise.allSettled([graphP, gapP]);
      })
      .catch((e) => {
        if (stillActive()) {
          setPapersErr(e.message || String(e));
          setPapersLoading(false);
        }
      });

    await Promise.allSettled([overviewP, papersP]);
    if (stillActive()) setRunning(false);
  };

  const handleTurnsChange = (next: ChatTurn[]) => {
    patchSession({ chat: next });
  };

  const handleGapVerifications = (verifications: GapVerification[]) => {
    patchSession({
      gaps: session?.gaps
        ? { ...session.gaps, verifications }
        : undefined,
    });
  };

  const topic: string | null = session?.topic ?? null;
  const overview: VaneAnswer | null = session?.overview ?? null;
  const papers: Paper[] = session?.papers ?? [];
  const gaps: GapAnalysis | null = session?.gaps ?? null;
  const graph: GraphResponse | null = session?.graph ?? null;
  const chat: ChatTurn[] = session?.chat ?? [];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <Sidebar activeId={session?.id ?? null} onSelect={handleSelect} onNew={handleNew} />

      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
          <header>
            <h1 className="text-3xl font-bold tracking-tight">Research</h1>
            <p className="text-zinc-400 mt-1 text-sm">
              Type a topic. Get an overview, related papers, a relations graph, and a follow-up
              chat — all kept in this browser as a chat you can return to.
            </p>
          </header>

          {!modelsLoading && !models && <SetupBanner />}

          <TopicBox onSubmit={runSearch} disabled={running || !models} />

          {topic && (
            <>
              <ConceptOverview loading={overviewLoading} error={overviewErr} answer={overview} />
              <PapersList loading={papersLoading} error={papersErr} papers={papers} />
              <GapAnalysisSection
                extracting={gapExtracting}
                analyzing={gapAnalyzing}
                error={gapErr}
                data={gaps}
                onVerificationsChange={handleGapVerifications}
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
            </>
          )}

          {!topic && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
              <p className="text-zinc-300 text-base">Start a new chat with a research topic above.</p>
              <p className="text-zinc-500 text-xs mt-2">
                Past chats appear in the sidebar and pick up where you left off.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
