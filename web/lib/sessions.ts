"use client";

import { useEffect, useState, useCallback } from "react";
import type { ChatTurn, GapAnalysisResponse, GraphResponse, Paper, VaneAnswer } from "@/lib/types";

// One session = one research topic and everything the user accumulated for it:
// the concept overview, the papers list, the relations graph, and the chat
// transcript. Sessions live in localStorage so they survive a refresh — no
// backend tables, no auth required for the MVP.

export type Session = {
  id: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  overview: VaneAnswer | null;
  papers: Paper[];
  graph: GraphResponse | null;
  gaps: GapAnalysisResponse | null;
  chat: ChatTurn[];
};

// Sidebar list only needs the lightweight pieces; loading every full session
// blob just to render titles would be wasteful as the list grows.
export type SessionSummary = Pick<Session, "id" | "topic" | "updatedAt">;

const INDEX_KEY = "dyrn:sessions:index";
const SESSION_KEY = (id: string) => `dyrn:sessions:${id}`;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readIndex(): SessionSummary[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s) => s && typeof s.id === "string" && typeof s.topic === "string",
    );
  } catch {
    return [];
  }
}

function writeIndex(list: SessionSummary[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  // Same-tab listeners (the hook below) won't see `storage` events, so emit
  // a custom event for them; cross-tab updates still arrive via `storage`.
  window.dispatchEvent(new Event("dyrn:sessions:changed"));
}

export function listSessions(): SessionSummary[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadSession(id: string): Session | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY(id));
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(SESSION_KEY(s.id), JSON.stringify(s));
  const index = readIndex().filter((x) => x.id !== s.id);
  index.push({ id: s.id, topic: s.topic, updatedAt: s.updatedAt });
  writeIndex(index);
}

export function deleteSession(id: string): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(SESSION_KEY(id));
  writeIndex(readIndex().filter((x) => x.id !== id));
}

export function newSessionId(): string {
  // crypto.randomUUID is in every modern browser, but guard for older targets.
  if (isBrowser() && "randomUUID" in crypto) return crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createSession(topic: string): Session {
  const now = Date.now();
  return {
    id: newSessionId(),
    topic,
    createdAt: now,
    updatedAt: now,
    overview: null,
    papers: [],
    graph: null,
    gaps: null,
    chat: [],
  };
}

// Reactive view of the sidebar list. Re-reads on local saves (custom event)
// and cross-tab edits (storage event).
export function useSessionList(): SessionSummary[] {
  const [list, setList] = useState<SessionSummary[]>(() => listSessions());

  const refresh = useCallback(() => setList(listSessions()), []);

  useEffect(() => {
    refresh();
    const onLocal = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === INDEX_KEY || e.key.startsWith("dyrn:sessions:")) {
        refresh();
      }
    };
    window.addEventListener("dyrn:sessions:changed", onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("dyrn:sessions:changed", onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  return list;
}
