# DYRN: Dynamic Research Network — Technical Documentation

This document provides an in-depth technical overview of the DYRN (Dynamic Research Network) solution. It is designed to be consumed by Large Language Models (LLMs) or developers to understand the architecture, feature set, implementations, and internal workings of the platform.

---

## 1. System Architecture

DYRN is a multi-container Dockerized application designed for advanced academic research intelligence. It synthesizes literature, builds citation graphs, and identifies research gaps by orchestrating multiple APIs and machine learning models.

The architecture consists of three primary interconnected services:

1. **`web` (Next.js Frontend)**: A modern React application using Tailwind CSS and Next-Themes. It serves as the single pane of glass for the user.
2. **`research-api` (FastAPI Backend)**: A Python-based backend that orchestrates data retrieval from major scientific databases, performs graph analytics, processes PDFs, and extracts insights.
3. **`vane` (Perplexica/Vane + SearxNG)**: A bundled search and chat backend that powers the contextual "Concept Overview" and interactive research chat.

---

## 2. Core Features & Implementation Details

### 2.1. Multi-Source Literature Aggregation
**What it does:** Fetches and normalizes academic papers from multiple major scientific indices simultaneously.
**Why it matters:** Pure relevance-ranking from a single source often hides complementary coverage. By merging multiple sources, DYRN captures biomedical-specific papers (PubMed), open-access data (OpenAlex), and strong citation networks (Semantic Scholar) in one unified list.
**Implementation (`research-api/main.py -> /papers`)**:
- Executes concurrent asynchronous requests to Semantic Scholar, OpenAlex, CrossRef, and PubMed.
- Deduplicates results primarily by DOI, falling back to normalized title slugs.
- Applies a round-robin merging strategy: It front-loads the list with Semantic Scholar results (up to 40%) to ensure sufficient seed IDs for the graph engine, then fills the remaining slots by alternating across all sources.

### 2.2. Interactive Citation Relations Graph
**What it does:** Visualizes how papers interact with each other (e.g., "Builds Upon", "Refutes", "Applies Method") rather than just showing that they cite each other.
**Why it matters:** Helps researchers instantly understand the lineage of ideas, identify foundational papers (hubs), and spot contradictions in the literature.
**Implementation (`web/components/RelationsGraph.tsx` & `research-api/graph.py`)**:
- **Backend:** Takes seed IDs (Semantic Scholar only) and fetches citation contexts. It classifies the intent of the citation using natural language processing.
- **Frontend:** Built with `@xyflow/react` (ReactFlow). It uses the ELK.js force-directed layout algorithm (`org.eclipse.elk.force`) to organize clusters organically.
- **Visual Encodings:**
  - *Node Size:* Proportional to the citation count.
  - *Node Color/Stroke:* Represents the K-Means thematic cluster.
  - *Edge Style:* Differentiates citation intents (e.g., Red = Refutes, Green = Builds Upon).
  - *Interactivity:* Hovering over edges reveals the exact verbatim sentence where the citation occurred.

### 2.3. Automated Gap Analysis & Evidence Gap Matrix (EGM)
**What it does:** Discovers genuinely unresolved research questions and structural gaps in the literature.
**Why it matters:** Prevents researchers from duplicating work and helps them identify high-impact areas for future study.
**Implementation (`research-api/main.py -> /gaps`)**:
This is a sophisticated, multi-stage pipeline:
1. **PDF Extraction:** Uses GROBID to parse full-text open-access PDFs, extracting the exact "Limitations" and "Future Work" sections.
2. **Citation Network Signals:** Uses SPECTER v2 embeddings to cluster papers (via K-Means). It looks for "white space" (clusters that are semantically similar but lack cross-citations) and "fragile bridges" (papers connecting distinct disciplines).
3. **Citing-Paper Evidence:** (The strongest signal). The system searches for papers that *cite* the seed papers and explicitly state a limitation (e.g., "Smith (2023) failed to address...").
4. **LLM Induction:** Feeds all this context to an LLM (OpenAI/Groq) with strict grounding rules to output structured JSON gaps, avoiding vague filler like "more research is needed."
5. **Evidence Gap Matrix (EGM):** The LLM dynamically infers the two most orthogonal dimensions for the topic (e.g., "Algorithm Type" vs "Imaging Modality"), classifies all papers, and outputs a sparse matrix to visually highlight empty cells (structural gaps).

### 2.4. Publication-Ready Literature Synthesis
**What it does:** Generates a thematic literature review from the selected papers.
**Why it matters:** Replaces the tedious process of reading 20 abstracts and writing a summary. It writes by theme, not paper-by-paper.
**Implementation (`web/components/LiteratureReview.tsx`)**:
- Takes a subset of user-selected papers and sends them to the backend.
- The LLM synthesizes the content, groups it by inferred themes, applies in-text academic citations `(Author, Year)`, highlights open debates, and generates a formatted references list.
- Outputs pure Markdown that can be instantly copied or downloaded as a `.md` file.

### 2.5. Intelligent Concept Overview & Chat
**What it does:** Provides a high-level framing of the topic and an interactive chat assistant grounded in the retrieved papers.
**Why it matters:** Helps orient the researcher before diving into dense PDFs and allows them to ask specific questions about the corpus.
**Implementation (`vane` container)**:
- Uses the Vane service (a fork of Perplexica), which leverages a local SearxNG instance for web-grounding.
- The **Concept Overview** uses a strict system prompt to force a specific structure: `[ORIENT]`, `[MAIN APPROACHES]`, and `[OPEN TENSIONS]`, explicitly banning tutorial-like language to maintain an academic tone.
- The **ChatBox** maintains conversation state and allows the user to chat with the LLM.

---

## 3. UI/UX and Design Philosophy

The frontend (`web`) is meticulously designed to feel like a premium, modern macOS-like application:
- **Theme Support:** Full Light/Dark mode toggling via `next-themes`.
- **Aesthetics:** Utilizes sophisticated CSS, including backdrop blurs (`backdrop-blur-md`), subtle borders (`border-zinc-200/800`), smooth transitions, and a curated HSL color palette tailored for professional intelligence tools.
- **Animations:** Uses CSS keyframes for dot-loaders and micro-interactions (e.g., hovering over graph edges scales up the label).
- **Responsive Layout:** A clean sidebar for session management and a centered main content area (`max-w-4xl`) for high readability.

---

## 4. Environment & Deployment Configuration

DYRN is orchestrated via `docker-compose.yml`.

### Key Networking Details:
- The **Frontend** runs on host port `3001` (mapped from container port `3000`).
- The **Research API** runs on host port `8000`.
- The **Vane API** runs on host port `3002`.

### Security & Proxying:
To avoid Adblockers (which commonly block endpoints named `/gap-analysis`) and browser CORS issues, the Next.js application acts as a secure proxy:
- `web/app/api/research/[...path]/route.ts` forwards `/api/research/*` to the internal `http://research-api:8000`.
- `web/app/api/vane/[...path]/route.ts` forwards `/api/vane/*` to the internal `http://vane:3000`.
Environment variables like `RESEARCH_API_URL` are evaluated *dynamically at request time* within the Node.js runtime, ensuring compatibility with Next.js standalone Docker builds.

### API Integrations:
The system requires (or optionally benefits from) several API keys configured in `.env`:
- `OPENAI_API_KEY` / `GROQ_API_KEY`: For LLM synthesis and gap extraction.
- `SEMANTIC_SCHOLAR_API_KEY`: For high-throughput citation graph building.
- `OPENALEX_EMAIL` / `CROSSREF_EMAIL`: For polite-pool API access to scholarly metadata.
- `PUBMED_API_KEY`: For high-rate NCBI biomedical paper retrieval.
