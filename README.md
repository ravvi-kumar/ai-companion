# 🌸 Maya — AI Companion Core Loop: Memory Architecture & Evaluation Harness

An AI companion system engineered to solve the two core failure modes of companion products: **stale/contradictory memory** and **persona drift over long horizons**.

---

## 🏛️ 1. System Architecture

```text
                                 ┌──────────────┐
                                 │     USER     │
                                 └───────┬──────┘
                                         │
                                         ▼
                             ┌─────────────────────────┐
                             │  Interactive Chat Loop  │
                             └───────────┬─────────────┘
                                         │
                                user message (Turn N)
                                         │
                      ┌──────────────────┴──────────────────┐
                      ▼                                     ▼
         ┌──────────────────────────┐           ┌─────────────────────────┐
         │     Memory Retriever     │           │     Persona System      │
         │ (Active Filter + Vector) │           │ (Immutable Maya State)  │
         └────────────┬─────────────┘           └─────────────┬───────────┘
                      │                                       │
              top-K memories                          persona prompt
                      │                                       │
                      └──────────────────┬────────────────────┘
                                         ▼
                              ┌────────────────────┐
                              │  Context Builder   │
                              └──────────┬─────────┘
                                         │
                                         ▼
                               ┌───────────────────┐
                               │   LLM Generator   │
                               └─────────┬─────────┘
                                         │
                                  response to user
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   Memory Extractor  │
                              │ (Strict User Input) │
                              └──────────┬──────────┘
                                         │
                                  candidate facts
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   Memory Resolver   │
                              │ ─────────────────── │
                              │ • ADD               │
                              │ • SUPERSEDE         │
                              │ • REINFORCE         │
                              │ • EXPIRE            │
                              └──────────┬──────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │   SQLite Database   │
                              │  (Source of Truth)  │
                              └──────────┬──────────┘
```

---

## 🔑 2. Core Architectural Invariants

1. **Language vs. Truth Separation**: The LLM is responsible for understanding language and extracting semantic candidates; the application code is responsible for maintaining truth, active states, and audit provenance.
2. **Single Authoritative Active State**: At any moment, there is exactly one authoritative `ACTIVE` value for any stateful attribute (`employer`, `city`, `partner`), while historical values are preserved as `SUPERSEDED` for auditability, debugging, and temporal reasoning.
3. **Structured Database is Canonical Truth**: Vector embeddings are merely an approximate semantic index; SQLite determines what is currently believed to be true. A superseded fact is never returned regardless of embedding similarity.
4. **User-Originated Extraction**: Extraction strictly parses user disclosures to prevent assistant hallucination feedback loops.
5. **Strict Environment Validation**: Uses Zod to validate required configuration (`OPENAI_API_KEY`, models, database path) at boot-time with actionable error feedback.

---

## 📦 3. Project Structure

```text
ai-companion/
├── src/
│   ├── main.ts                   # Interactive CLI chat loop entrypoint
│   ├── config/
│   │   └── env.ts                # Zod environment schema & config validation
│   ├── chat/
│   │   ├── chat-loop.ts          # REPL loop, command dispatcher, session management
│   │   └── context-builder.ts    # Prompt budget & message context assembly
│   ├── llm/
│   │   ├── client.ts             # OpenAI client with structured JSON and streaming
│   │   └── embeddings.ts         # Vector embeddings & cosine similarity
│   ├── memory/
│   │   ├── types.ts              # Zod schemas, MemoryType & lifecycle statuses
│   │   ├── extractor.ts          # Structured memory extraction pipeline
│   │   ├── resolver.ts           # Contradiction resolution & lifecycle engine
│   │   └── retriever.ts          # Hybrid semantic + structured active memory recall
│   ├── persona/
│   │   ├── persona.ts            # Maya character traits, backstory, voice, rules
│   │   └── prompt.ts             # Persona system prompt generator
│   └── storage/
│       ├── database.ts           # SQLite connection, statement cache & migrations
│       ├── schema.sql            # Database DDL
│       ├── memories.ts           # Memory persistence & status queries
│       └── messages.ts           # Session & message persistence
│
├── eval/
│   ├── runner.ts                 # Evaluation test suite runner (`npm run eval`)
│   ├── judge.ts                  # Dual judge: keyword-based + LLM-as-judge rubric grader
│   ├── metrics.ts                # Statistical summary & markdown report builder (with LLM scores)
│   ├── results.json              # Machine-readable evaluation results
│   └── cases/
│       └── benchmark-dataset.json # Synthetic test cases (11 cases across 5 categories)
│
├── PROGRESS.md                   # Iteration tracking log
├── package.json
└── tsconfig.json
```

---

## 🚀 4. Quick Start

### Prerequisites
- Node.js `v18+` (Tested on Node `v24.20.0`)
- npm `v9+`

### Installation
```bash
# Clone and install dependencies
git clone <repo-url>
cd ai-companion
npm install
```

### Configuration (Optional)
To use live OpenAI models (`gpt-4o-mini`, `text-embedding-3-small`), copy `.env.example` to `.env` and set your key:
```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```
> *Note: If no API key is provided, the system automatically uses its built-in deterministic local engine.*

### Running the Interactive CLI
```bash
npm start
```

### Running Automated Tests
```bash
npm test
```

### Running the Evaluation Benchmark Suite
```bash
npm run eval
```

---

## 💻 5. Interactive CLI Commands

While chatting with Maya, the following commands are available:

| Command | Description |
| :--- | :--- |
| `/help` | Display available commands |
| `/memories` | View all currently `ACTIVE` user memories with confidence and importance |
| `/history <key>` | Display full evolution timeline, state transitions, and audit provenance for a key (e.g. `/history employer`) |
| `/session` | View current session ID and message count |
| `/sessions` | List recent saved sessions |
| `/switch <id>` | Switch to an existing session |
| `/new` | Start a fresh conversation session |
| `/clear` | Clear messages in the current session |
| `/exit`, `/quit` | Exit the application |

---

## 🔄 6. Memory Lifecycle & Contradiction Resolution

Memories transition through four discrete lifecycle states:

```text
   [ Extracted Candidate ]
              │
              ▼
   ┌──────────────────────┐
   │        ACTIVE        │ ◄── (Authoritative current truth)
   └──────────┬───────────┘
              │
   (New contradictory fact)
              │
              ▼
   ┌──────────────────────┐
   │      SUPERSEDED      │ ──► Pointer to replacing record (`superseded_by`)
   └──────────────────────┘
```

### Example Evolution
1. **Turn 1**: User says *"I work at Microsoft as a cloud engineer."*
   - `employer = Microsoft` [Status: `ACTIVE`]
2. **Turn 20**: User says *"I left Microsoft and joined Google!"*
   - `employer = Microsoft` transitions to [Status: `SUPERSEDED`, `superseded_by: mem_google_id`]
   - `employer = Google` created as [Status: `ACTIVE`]
3. **Turn 50**: User asks *"Where do I work now?"*
   - Hybrid retriever searches active facts -> finds `employer = Google`.
   - Historical provenance is preserved for `/history employer`.

---

## 📊 7. Evaluation Benchmark Results

Running `npm run eval` executes the harness against 11 synthetic test conversations designed to stress persistence, contradiction, long-range recall, and persona drift. The harness uses a **dual-judge** approach:

1. **Keyword Judge** (deterministic): Exact substring matching for expected/forbidden terms — fast and reproducible.
2. **LLM Judge** (probabilistic): GPT-4o-mini scores each response on Memory Recall, Stale Avoidance, Persona Consistency, and Naturalness (0.0–1.0 each).

```text
======================================================
🧪 RUNNING AI COMPANION BENCHMARK EVALUATION HARNESS 🧪
======================================================

[1/11]  City location persistence across session restart... ✅ PASSED
[2/11]  Favorite beverage persistence across session restart... ✅ PASSED
[3/11]  Pet ownership fact persistence... ✅ PASSED
[4/11]  Career move from Microsoft to Google supersession... ✅ PASSED
[5/11]  Relationship breakup supersession... ✅ PASSED
[6/11]  Pet loss / negation handling... ✅ PASSED
[7/11]  Targeted retrieval amidst distractor facts... ✅ PASSED
[8/11]  Maya beverage preference consistency... ✅ PASSED
[9/11]  Maya photography and backstory consistency... ✅ PASSED
[10/11] Maya tone resistance to robotic flattening... ✅ PASSED
[11/11] Fact recall after 40+ distractor turns... ✅ PASSED

Category Breakdown:
• CROSS SESSION PERSISTENCE : 3 / 3 (100.0%)
• CONTRADICTION RESOLUTION  : 3 / 3 (100.0%)
• RELEVANT RETRIEVAL        : 1 / 1 (100.0%)
• PERSONA CONSISTENCY       : 3 / 3 (100.0%)
• LONG RANGE RECALL         : 1 / 1 (100.0%)
```

### LLM-as-Judge Limitations
- Scores are subjective approximations, not ground-truth measurements.
- The judge model may apply inconsistent standards across runs.
- The rubric doesn't capture nuance like emotional attunement or humor quality.
- Judge quality depends on the evaluation model's instruction-following capability.

---

## 🎬 8. Demo Walkthrough Script (15-Minute Video Guide)

| Timestamp | Segment | Actions / Talking Points |
| :--- | :--- | :--- |
| **0:00 - 2:00** | **Architecture Overview** | Introduce system architecture, separation of truth vs language understanding, and SQLite as canonical state. |
| **2:00 - 4:00** | **Normal Interaction & Extraction** | Start CLI (`npm start`). Chat naturally with Maya: *"I live in Bangalore and work at Microsoft."* Show memory extraction log. |
| **4:00 - 6:00** | **Persistence Across Restart** | Type `/exit`. Restart process (`npm start`). Ask Maya *"Where do I live?"*. Observe instant cross-session recall. |
| **6:00 - 9:00** | **Contradiction Resolution** | Tell Maya *"I left Microsoft and joined Google!"*. Show `/memories` (only Google active) and `/history employer` (Microsoft -> Google visual timeline). |
| **9:00 - 11:30** | **50+ Turn Persona Consistency** | Ask Maya about her backstory, photography hobbies, tea preferences, and adversarial reset prompt. Show unwavering character stability. |
| **11:30 - 14:00** | **Evaluation Harness** | Run `npm run eval` in terminal. Walk through the pass/fail metrics, LLM judge scores, rubric, and test cases. |
| **14:00 - 15:00** | **Trade-offs & Limitations** | Discuss architectural trade-offs, embedding storage strategy, and next steps. |

---

## ⚖️ 9. Architecture Decisions, Abandoned Approaches & Limitations

### Decisions Made & Why
1. **SQLite over Vector SaaS**: Keeping both structured records and vector embeddings queryable in a single local database eliminates network round-trips, vendor lock-in, and synchronization drift between document stores and vector databases.
2. **Embeddings Stored at Insert Time with Graceful Outage Fallback**: Pre-computing and persisting embedding vectors alongside each memory in SQLite avoids recomputing all memory embeddings on every retrieval query. If embedding services experience an outage or rate limit, retrieval seamlessly falls back to structured lexical ranking with canonical concept mapping.
3. **Atomic Transactional Supersession**: Supersession of conflicting or stateful facts is executed inside SQLite transactions (`MemoryRepository.supersedeMemory()`), guaranteeing atomic transition from `ACTIVE` to `SUPERSEDED` and preventing split-brain states.
4. **Prompt Injection Guardrails for Recalled Memories**: Recalled memories are formatted inside explicit `<recalled_user_memories>` boundary tags and treated as passive, untrusted user data with strict system instructions prohibiting instruction execution from memory values.
5. **Direct OpenAI Client with Zod Environment Validation**: Replaces fragile heuristics with direct OpenAI chat completions and embeddings, guarded by runtime Zod validation at startup.
6. **Audit Lineage over Hard Deletions**: Superseded records are tagged with `superseded_by` rather than deleted, enabling full temporal queries (*"Where did I work before Google?"*).
7. **Conservative Conflict Resolution Defaults & IGNORE Action**: When the LLM classifier determines redundant or irrelevant updates, the candidate is safely discarded (`DISCARD`), and when classification fails, it defaults to `ADDITIONAL` (coexist) to prevent accidental data loss.
8. **Deterministic Offline Unit Tests with Mocks**: Standard test suite (`npm test`) uses fast, deterministic fakes for CI gating, while the live benchmark harness (`npm run eval`) tests real model performance with full run metadata.

### What Was Tried & Abandoned
- **Blind LLM-only memory storage without application invariants**: Early experiments storing memories purely as raw text embeddings led to stale facts competing with active facts purely based on vector similarity. Moving state enforcement to the application layer solved this deterministically.
- **Pinecone / Chroma for vector storage**: Considered dedicated vector databases for semantic search, but the additional network dependency, synchronization complexity, and the small scale of companion memory (hundreds, not millions of records) made SQLite with in-process cosine similarity the better fit.
- **Re-computing all memory embeddings on every retrieval query**: The initial implementation generated embeddings for all active memories on each user message. This was O(N) API calls per query and became a latency and cost concern. Refactored to pre-compute and store embeddings at memory creation time.
- **SUPERSEDE-on-error as conflict resolution default**: Initially defaulted to overwriting the existing memory when the LLM classifier failed. This was data-destructive — a network failure could silently delete valid active memories. Changed to `ADDITIONAL` (conservative coexist) to avoid accidental data loss.

### Known Limitations
- Multi-user authentication and web/mobile UI are intentionally out of scope per assessment guidelines.
- Complex multi-fact temporal reasoning (e.g., *"Where did I live 3 years before moving to Bangalore?"*) requires explicit date parsing across multiple historical records.
- Negation handling (e.g., *"I don't have a dog anymore"*) relies on the LLM extractor correctly interpreting the negation and producing a superseding memory, which may not always succeed for subtle retractions.
- The extraction context is configurable between user-only messages or full conversation context; user-only prevents hallucination feedback loops but may miss facts that require assistant context for disambiguation.

