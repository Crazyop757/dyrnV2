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

export type PaperSummary = {
  tldr: string;
  objective: string;
  methods: string;
  key_findings: string;
  limitations: string;
  contribution: string;
};

export type SummarizeResponse = {
  summary: PaperSummary;
  grounded_on: "abstract" | "none";
};

export type LiteratureReviewTheme = {
  theme: string;
  description: string;
  paper_count: number;
};

export type LiteratureReviewResponse = {
  markdown: string;
  themes: LiteratureReviewTheme[];
  debates: string[];
  gaps: string[];
  paper_count: number;
};

export type GraphNode = {
  id: string;
  label: string;
  year: number | null;
  authors: string[];
  citation_count: number;
  url?: string | null;
  tldr?: string | null;
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
  limitations: string[];
  future_work: string[];
  conclusions: string[];
};

export type ExtractResponse = {
  sections: Record<string, PaperSections>;
};

export type GapType =
  | "methodological"
  | "knowledge"
  | "empirical"
  | "population"
  | "theoretical"
  | "evidence_contradictory"
  | "practical";

export type GapGrounding = {
  paper_title: string;
  year: number | null;
  quote: string;
  section: "limitations" | "future_work" | "abstract";
};

export type GapGraphSignal = {
  type: "white_space" | "contradiction" | "bridge";
  description: string;
};

export type GapVerification = {
  confidence: "confirmed" | "partial" | "unlikely" | "incoherent" | "error" | "unverified";
  relevant_count: number;
  queries_used: string[];
  indices_searched: string[];
  sample_papers: { title: string; year: number | null; url: string | null }[];
  status: string;
};

export type Gap = {
  id: string;
  statement: string;
  type: GapType;
  impact?: string | null;
  recommendation?: string | null;
  grounding: GapGrounding[];
  graph_signal: GapGraphSignal | null;
  verification: GapVerification;
  verification_queries: string[];
  egm_cell?: { dim1: string; dim2: string; count: number } | null;
};

export type GapMapClusterPair = {
  cluster_a: string;
  cluster_b: string;
  similarity: number;
  citation_count: number;
  gap_count: number;
};

export type EGMCell = {
  dim2_value: string;
  count: number;
  paper_titles: string[];
};

export type EGMRow = {
  dim1_value: string;
  cells: EGMCell[];
};

export type EGMEmptyCell = {
  dim1_value: string;
  dim2_value: string;
  count: number;
  gap_statement: string;
};

export type EvidenceGapMatrix = {
  dim1_label: string;
  dim2_label: string;
  dim1_values: string[];
  dim2_values: string[];
  matrix: EGMRow[];
  empty_cells: EGMEmptyCell[];
};

export type GapAnalysisResponse = {
  gaps: Gap[];
  gap_map: {
    cluster_pairs: GapMapClusterPair[];
  };
  egm: EvidenceGapMatrix | null;
};

export type ChatTurn =
  | { role: "human"; text: string }
  | { role: "assistant"; text: string; sources?: VaneSource[] };
