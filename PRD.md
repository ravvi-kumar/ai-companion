Yes. Starting from scratch is quite feasible for this assessment because the scope is deliberately narrow: a CLI/minimal chat loop, persistent memory, extraction, relevant retrieval, update/decay, and persona consistency. The evaluation harness is optional.  

My recommendation would be **a small TypeScript application with SQLite, one LLM, embeddings, and a deterministic memory/state layer**. I would avoid LangChain/LlamaIndex unless a concrete need appears.

## 1. The architecture I would build

The key design principle:

> **The LLM is responsible for understanding language; the application is responsible for maintaining truth.**

That gives us this:

```text
                         ┌─────────────┐
                         │    USER     │
                         └──────┬──────┘
                                │
                                ▼
                    ┌──────────────────────┐
                    │      Chat Loop       │
                    └──────────┬───────────┘
                               │
                    current user message
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
     ┌──────────────────┐              ┌──────────────────┐
     │ Memory Retriever │              │ Persona Manager  │
     └────────┬─────────┘              └────────┬─────────┘
              │                                 │
              ▼                                 │
      relevant memories                        │
              │                                 │
              └──────────────┬──────────────────┘
                             ▼
                    ┌─────────────────┐
                    │ Context Builder │
                    └────────┬────────┘
                             │
                             ▼
                         ┌───────┐
                         │  LLM  │
                         └───┬───┘
                             │
                             ▼
                          RESPONSE
                             │
                             ▼
                  ┌────────────────────┐
                  │ Memory Extractor   │
                  └─────────┬──────────┘
                            │
                            ▼
                  ┌────────────────────┐
                  │ Memory Resolver    │
                  │                    │
                  │ ADD                │
                  │ UPDATE             │
                  │ SUPERSEDE         │
                  │ EXPIRE             │
                  │ IGNORE             │
                  └─────────┬──────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │    SQLite    │
                     └──────────────┘
```

There are really **four independent concerns**:

1. Conversation
2. Memory
3. Persona
4. Evaluation

That separation is what will make the system easy to reason about.

---

# 2. The technology stack

I'd use:

| Purpose           | Library                    |
| ----------------- | -------------------------- |
| Runtime           | Node.js                    |
| Language          | TypeScript                 |
| LLM               | OpenAI SDK                 |
| Embeddings        | OpenAI embeddings          |
| Database          | SQLite                     |
| SQLite driver     | `better-sqlite3`           |
| Vector search     | `sqlite-vec`               |
| Schema validation | `zod`                      |
| Tests             | Vitest                     |
| CLI               | Node `readline`            |
| IDs               | `crypto.randomUUID()`      |
| Logging           | built-in console initially |

`better-sqlite3` is currently a mature SQLite driver with transactions and extension support. ([npm][1])

`sqlite-vec` currently provides an npm package and can be installed directly into a Node project, making it a reasonable way to keep vector search inside SQLite rather than introducing another database. ([GitHub][2])

Zod is TypeScript-first schema validation with static inference, which is particularly useful for validating structured LLM output. ([Zod][3])

### I would deliberately NOT use

```text
LangChain
LlamaIndex
Pinecone
Redis
Postgres
Kafka
Redis
Docker
React
Next.js
```

Not because they're bad, but because they add machinery that the assessment doesn't require. The assessment explicitly says UI, production-scale infrastructure, load handling, authentication, etc. are out of scope. 

---

# 3. The database schema

I'd make the database the heart of the system.

## `sessions`

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
```

## `messages`

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## `memories`

This is the important table.

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,

  type TEXT NOT NULL,

  subject TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,

  confidence REAL NOT NULL,
  importance REAL NOT NULL,

  status TEXT NOT NULL,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  valid_from TEXT,
  valid_until TEXT,

  source_message_id TEXT,
  superseded_by TEXT
);
```

Examples:

```text
type        = preference
subject     = user
key         = favorite_drink
value       = tea
status      = active
```

Or:

```text
type        = occupation
subject     = user
key         = employer
value       = Google
status      = active
```

---

# 4. Why `key` is so important

This is what lets us reliably solve contradictions.

Imagine:

```text
id       key                 value
--------------------------------------------
1        employer            Microsoft
```

Later the user says:

> "I left Microsoft and joined Google."

The extractor returns:

```text
key = employer
value = Google
```

Our resolver finds:

```text
existing:
employer = Microsoft
```

and realizes this is an update rather than a brand-new unrelated fact.

Then:

```text
Microsoft → superseded
Google    → active
```

Database:

```text
1  employer  Microsoft  superseded
2  employer  Google     active
```

The old record isn't destroyed, which gives us provenance and debugging.

This is much stronger than a vector database containing:

```text
Microsoft
Google
```

and hoping the model figures out which is current.

---

# 5. Memory states

I'd keep the lifecycle deliberately small:

```text
ACTIVE
SUPERSEDED
EXPIRED
DISCARDED
```

### ACTIVE

Currently believed to be true.

### SUPERSEDED

Replaced by a newer fact.

### EXPIRED

Was true, but only temporarily relevant.

### DISCARDED

Extracted candidate but determined not worth retaining.

---

# 6. Memory types

Don't create 30 categories.

I'd start with:

```typescript
type MemoryType =
  | "fact"
  | "preference"
  | "relationship"
  | "goal"
  | "plan"
  | "occupation"
  | "location"
  | "habit"
  | "life_event";
```

That's plenty.

---

# 7. The memory extraction pipeline

After a user message:

```text
User message
     │
     ▼
Should we attempt memory extraction?
     │
     ▼
LLM
     │
     ▼
Structured JSON
     │
     ▼
Zod validation
```

Example LLM result:

```json
[
  {
    "type": "occupation",
    "key": "employer",
    "value": "Google",
    "confidence": 0.96,
    "importance": 0.90
  }
]
```

Zod validates the result before our application touches the database. This is exactly the kind of boundary where a schema validator helps. ([Zod][3])

---

# 8. Don't ask the LLM to decide everything

I'd divide responsibility like this:

### LLM

```text
"What did the user say?"

"What facts might be useful?"

"What is the key?"

"What does the new statement mean?"
```

### Application

```text
"Does a matching memory already exist?"

"Is it an update?"

"Is this a contradiction?"

"Which memory is active?"

"Has it expired?"

"What do we store?"
```

That's the important architecture.

---

# 9. Contradiction resolver

Pseudo-code:

```typescript
async function resolveMemory(candidate: MemoryCandidate) {
  const existing = findActiveByKey(
    candidate.subject,
    candidate.key
  );

  if (!existing) {
    return create(candidate);
  }

  if (sameMeaning(existing.value, candidate.value)) {
    return reinforce(existing, candidate);
  }

  if (candidateSupersedesExisting(candidate, existing)) {
    return supersede(existing, candidate);
  }

  return createAsSeparateMemory(candidate);
}
```

The tricky function is:

```text
candidateSupersedesExisting()
```

For a coding assessment, we can use an LLM to classify ambiguous cases.

---

# 10. Make conflict resolution explicit

For example, send the LLM:

```text
Existing memory:
"The user works at Microsoft."

New user statement:
"I left Microsoft last month and joined Google."

Determine:
1. Does the new statement contradict the old memory?
2. Does it supersede it?
3. What is the new canonical value?
```

Expected:

```json
{
  "relationship": "supersedes",
  "new_value": "Google"
}
```

Then **our code** performs the actual DB update.

---

# 11. Retrieval architecture

Retrieval should be hybrid.

### Step 1 — structured filtering

Get candidates where:

```text
status = ACTIVE
```

and potentially relevant types.

### Step 2 — semantic search

Generate an embedding for the user's current question.

For example:

> "Where am I working now?"

could match:

```text
employer = Google
```

even though the exact phrase isn't present.

### Step 3 — ranking

Combine:

```text
semantic similarity
+
importance
+
confidence
+
recency
```

### Step 4 — context budget

Only return perhaps:

```text
top 5–8 memories
```

rather than hundreds.

---

# 12. Embeddings are not the source of truth

This is very important.

The vector store answers:

> "What memories seem relevant?"

The structured database answers:

> "What is currently believed to be true?"

So:

```text
Vector search
    ↓
Candidates
    ↓
Structured state validation
    ↓
Active/current memories
    ↓
LLM
```

That prevents a stale memory from winning merely because its embedding is highly similar.

---

# 13. Persona architecture

I'd create:

```text
src/persona/
  persona.ts
  prompt.ts
```

And use something like:

```typescript
const persona = {
  name: "Maya",

  traits: [
    "warm",
    "curious",
    "playful",
    "empathetic"
  ],

  opinions: [
    "values work-life balance",
    "loves spicy food"
  ],

  backstory: [
    "grew up near the ocean",
    "loves photography"
  ],

  communicationStyle: {
    tone: "casual",
    humor: "light",
    verbosity: "moderate"
  }
};
```

This is **not user memory**.

It is immutable application state.

---

# 14. Prompt construction

Every generation gets:

```text
SYSTEM

You are Maya.

PERSONA:
- warm
- curious
- playful
- empathetic
- ...

PERSONA RULE:
Do not contradict established persona facts.

RELEVANT USER MEMORIES:
- User lives in ...
- User works at Google.
- User prefers tea.

RECENT CONVERSATION:
...
```

Then the user's message.

This makes the model's inputs explainable.

---

# 15. Persona consistency should be tested separately

Don't let "memory recall" and "persona consistency" become one fuzzy score.

I'd create tests such as:

```text
Persona test #1
----------------
Early:
"Maya says she loves hiking."

50 turns later:
"What do you like doing on weekends?"

Expected:
Something compatible with hiking.
```

And:

```text
Persona test #2
----------------
Early:
"Maya values honesty."

Later:
User pressures Maya to lie.

Expected:
Maya remains consistent with her stated values.
```

That's directly tied to the assessment's requirement that the persona not contradict itself across 50+ turns. 

---

# 16. The chat loop

The actual runtime can remain extremely small:

```typescript
while (true) {
  const userMessage = await readInput();

  const memories =
    await memoryRetriever.retrieve(userMessage);

  const context =
    contextBuilder.build({
      persona,
      memories,
      recentMessages
    });

  const response =
    await llm.generate(context, userMessage);

  console.log(response);

  await messageStore.save(userMessage);
  await messageStore.save(response);

  const candidates =
    await memoryExtractor.extract({
      userMessage,
      response
    });

  await memoryManager.resolve(candidates);
}
```

That's the entire application.

The complexity is inside the memory manager, not the chat loop.

---

# 17. Don't extract memory from the assistant's response blindly

This is another design decision I'd make.

Primary source:

```text
USER MESSAGE
```

Secondary:

```text
ASSISTANT RESPONSE
```

The assistant might hallucinate:

> "I remember you told me you love skiing."

That should **not automatically become a new user memory**.

Otherwise an incorrect model statement can contaminate your database.

So memory extraction should primarily operate over **user-originated information**.

---

# 18. Persistence test

This is easy to demonstrate.

### Session 1

```text
User:
I live in Bangalore.
```

Database:

```text
location = Bangalore
```

Quit program.

Start again.

### Session 2

```text
User:
Where do I live?
```

Retrieval finds:

```text
location = Bangalore
```

Response:

> "You live in Bangalore."

That directly demonstrates the persistent-memory requirement. 

---

# 19. Evaluation architecture

I'd add a completely separate `eval` package.

```text
src/
  chat/
  memory/
  persona/
  storage/
  llm/

eval/
  cases/
  runner.ts
  judge.ts
  metrics.ts
```

Test cases could be JSON:

```json
{
  "name": "employer_update",
  "turns": [
    "I work at Microsoft.",
    "... 20 turns ...",
    "I left Microsoft and joined Google."
  ],
  "question": "Where do I work now?",
  "expected": "Google"
}
```

The assessment explicitly suggests synthetic test conversations that establish facts, revisit them after ~40 turns, contradict them, and test what happens. 

---

# 20. Metrics

I'd report at least:

```text
Memory recall
Cross-session persistence
Contradiction resolution
Relevant retrieval
Stale-memory avoidance
Persona consistency
```

For example:

```text
Memory recall              18/20 = 90%
Persistence                10/10 = 100%
Contradiction handling     17/20 = 85%
Relevant retrieval         19/20 = 95%
Persona consistency        19/20 = 95%
```

And importantly:

```text
Failures:
- 2 cases where an old employer was recalled
- 1 case where a temporary plan was treated as permanent
```

The assessment explicitly asks for numbers and example failures if you build the harness. 

---

# 21. I would add one particularly useful debug command

Your CLI could have:

```text
/memories
```

which prints:

```text
ACTIVE MEMORIES

[occupation]
employer = Google
confidence = 0.96
importance = 0.90

[preference]
favorite_drink = tea
confidence = 0.94

[relationship]
partner = Sarah
status = active
```

And:

```text
/history employer
```

shows:

```text
Microsoft
  ↓
superseded
  ↓
Google
  ↓
active
```

That would make your walkthrough extremely effective.

---

# 22. Suggested project structure

I'd keep it around this size:

```text
ai-companion/
│
├── src/
│   ├── main.ts
│   │
│   ├── chat/
│   │   ├── chat-loop.ts
│   │   └── context-builder.ts
│   │
│   ├── llm/
│   │   ├── client.ts
│   │   ├── generate.ts
│   │   └── embeddings.ts
│   │
│   ├── memory/
│   │   ├── types.ts
│   │   ├── extractor.ts
│   │   ├── retriever.ts
│   │   ├── resolver.ts
│   │   ├── lifecycle.ts
│   │   └── manager.ts
│   │
│   ├── persona/
│   │   ├── persona.ts
│   │   └── prompt.ts
│   │
│   └── storage/
│       ├── database.ts
│       ├── schema.sql
│       ├── memories.ts
│       └── messages.ts
│
├── eval/
│   ├── cases/
│   ├── runner.ts
│   ├── judge.ts
│   └── metrics.ts
│
├── tests/
│   ├── memory.test.ts
│   ├── retrieval.test.ts
│   ├── contradictions.test.ts
│   └── persona.test.ts
│
├── data/
│   └── companion.db
│
├── README.md
├── package.json
└── tsconfig.json
```

That's small enough for an assessment and clean enough to explain.

---

# 23. How much effort?

I would estimate:

| Work                     |       Hours |
| ------------------------ | ----------: |
| Project setup + CLI      |         0.5 |
| LLM integration          |           1 |
| SQLite layer             |           1 |
| Memory schema            |           1 |
| Memory extraction        |         1.5 |
| Memory resolution/update |           2 |
| Retrieval + embeddings   |           2 |
| Memory expiry/decay      |           1 |
| Persona system           |           1 |
| Context assembly         |           1 |
| Integration/debugging    |           2 |
| Unit tests               |           1 |
| Evaluation harness       |         2–3 |
| README/demo              |           1 |
| **Total**                | **17–19 h** |

This lines up nicely with the assessment's own estimate of roughly **18 hours of focused work**. 

---

# 24. How I'd prioritize the 18 hours

The biggest mistake would be trying to make a sophisticated "AI companion."

Don't.

Make a **small memory research prototype**.

### Phase 1 — Core loop

```text
CLI
→ LLM
→ response
```

**~1.5h**

### Phase 2 — Persistence

```text
SQLite
messages
sessions
```

**~1h**

### Phase 3 — Memory

```text
extract
store
retrieve
```

**~4h**

### Phase 4 — Correctness

```text
update
supersede
expire
```

**~3h**

### Phase 5 — Persona

```text
traits
opinions
backstory
consistent prompt
```

**~1h**

### Phase 6 — Tests

```text
persistence
recall
contradiction
50+ turns
persona
```

**~3h**

### Phase 7 — Evaluation

**~2h**

### Phase 8 — README/demo/polish

**~2h**

---

# 25. What I would consider the "MVP" if time runs out

The assessment says a strong core loop is preferable to a weak system with a fancy evaluation harness. 

So if we only have 10–12 hours:

```text
✅ SQLite persistence
✅ Structured memory
✅ Retrieval
✅ Contradiction resolution
✅ Persona
✅ 50-turn demonstration
✅ Basic tests

❌ Fancy dashboard
❌ Multiple memory providers
❌ Complex agent framework
❌ Emotional simulation
❌ Production infrastructure
```

That's a much better submission.

---

# 26. One architectural decision I would strongly recommend

Don't make the vector database your canonical memory.

Use:

```text
                 MEMORY
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
   Canonical state        Semantic index
       SQLite              embeddings
          │                   │
          │              approximate
          │                retrieval
          │                   │
          └─────────┬─────────┘
                    ▼
              Memory Manager
```

SQLite tells us **what is true now**.

Embeddings tell us **what might be relevant**.

That separation makes contradiction handling much easier.

---

# 27. Another architectural decision: don't delete history

Suppose:

```text
2026-08-01
employer = Microsoft
```

then:

```text
2026-09-01
employer = Google
```

Keep both:

```text
Microsoft → superseded
Google    → active
```

This gives you:

* auditability
* temporal reasoning
* debugging
* evaluation
* explainability

and lets you answer historical questions:

> "Where did I work before Google?"

That's much richer than simply overwriting the row.

---

# 28. What I think your final submission should demonstrate

Your 15–20 minute walkthrough should probably be:

```text
1 min
Architecture

2 min
Normal conversation

2 min
Memory extraction

2 min
Restart program → memory persists

3 min
Contradiction:
Microsoft → Google

2 min
Inspect memory history

3 min
50+ turn personality test

3 min
Evaluation results

2 min
Limitations / future work
```

The assessment specifically asks for a 15–20 minute walkthrough of the core loop and evaluation results if available. 

---

## The stack I'd actually choose

```text
Node.js
TypeScript
OpenAI SDK
Zod
better-sqlite3
sqlite-vec
Vitest
Node readline
```

No framework.

No frontend.

No vector SaaS.

No separate memory provider.

No complicated agent framework.

That keeps the architecture **small enough to implement in ~18 hours but sophisticated enough to demonstrate the actual engineering problem**. `better-sqlite3`, `sqlite-vec`, and Zod are all currently maintained/relevant choices for this kind of Node/TypeScript implementation. ([npm][1])

And I would structure the implementation around one central invariant:

> **At any moment, there should be one authoritative active value for a stateful fact, while historical values remain available for audit and temporal reasoning.**

That one rule solves a surprisingly large part of the assessment.

[1]: https://www.npmjs.com/package/better-sqlite3?activeTab=versions&utm_source=chatgpt.com "better-sqlite3 - npm"
[2]: https://github.com/asg017/sqlite-vec/blob/main/site/getting-started/installation.md?utm_source=chatgpt.com "sqlite-vec/site/getting-started/installation.md at main · asg017/sqlite-vec · GitHub"
[3]: https://zod.dev/?utm_source=chatgpt.com "Intro | Zod"
