"use client";

import { useEffect, useRef, useState } from "react";
import TopicBox from "@/components/TopicBox";
import ConceptOverview from "@/components/ConceptOverview";
import PapersList from "@/components/PapersList";
import RelationsGraph from "@/components/RelationsGraph";
import ChatBox from "@/components/ChatBox";
import SetupBanner from "@/components/SetupBanner";
import Sidebar from "@/components/Sidebar";
import { discoverModels, search, type ModelChoice } from "@/lib/vane";
import { fetchGraph, fetchPapers } from "@/lib/researchApi";
import type { ChatTurn, GraphResponse, Paper, VaneAnswer } from "@/lib/types";
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

    const stillActive = () => activeRunId.current === fresh.id;

    const overviewP = search({
      query: topic,
      models,
      sources: ["academic", "web"],
      systemInstructions:
        "You are summarizing a research topic for a researcher. Give a concise " +
        "overview (3-5 short paragraphs) of what the topic is, the main approaches, " +
        "and the key open questions. Cite sources inline.",
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
          if (stillActive()) patchSession({ graph: g });
        } catch (e: any) {
          if (stillActive()) setGraphErr(e.message || String(e));
        } finally {
          if (stillActive()) setGraphLoading(false);
        }
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

  const topic: string | null = session?.topic ?? null;
  const overview: VaneAnswer | null = session?.overview ?? null;
  const papers: Paper[] = session?.papers ?? [];
  const graph: GraphResponse | null = session?.graph ?? null;
  const chat: ChatTurn[] = session?.chat ?? [];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <Sidebar activeId={session?.id ?? null} onSelect={handleSelect} onNew={handleNew} />

      <main className="flex-1 overflow-x-hidden">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
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
