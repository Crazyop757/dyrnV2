export type Paper = {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  year: number | null;
  venue: string | null;
  citation_count: number;
  reference_count: number;
  doi: string | null;
  arxiv_id: string | null;
  pdf_url: string | null;
  url: string | null;
  tldr: string | null;
  source: "semantic_scholar" | "openalex" | "crossref" | "pubmed";
};

export type PapersResponse = { topic: string; papers: Paper[] };

export type GraphNode = {
  id: string;
  label: string;
  year: number | null;
  authors: string[];
  citation_count: number;
  is_seed?: boolean;
  score?: number | null;
  cluster?: string;
};

export type GraphEdge = { 
  source: string; 
  target: string; 
  weight?: number;
  intent?: string;
  context?: string;
};

export type GraphResponse = { nodes: GraphNode[]; edges: GraphEdge[] };

export type VaneSource = {
  content: string;
  metadata: { title?: string; url?: string };
};

export type VaneAnswer = { message: string; sources: VaneSource[] };

export type VaneProvider = {
  id: string;
  name: string;
  chatModels: { key: string; name: string }[];
  embeddingModels: { key: string; name: string }[];
};

export type PaperSections = {
  limitations: string | null;
  future_work: string | null;
  conclusions: string | null;
};

export type ExtractResponse = {
  sections: Record<string, PaperSections>;
};

export type GapVerification = {
  query: string;
  total: number;
  confidence: "confirmed" | "partial" | "unlikely";
  papers: { title: string; year: number | null; url: string | null }[];
};

export type GapAnalysis = {
  message: string;
  sources: VaneSource[];
  verifications: GapVerification[];
};

export type ChatTurn =
  | { role: "human"; text: string }
  | { role: "assistant"; text: string; sources?: VaneSource[] };
