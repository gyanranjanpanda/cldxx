# Data Structures in cldxAI — and the DSA questions that map to them

Every structure below is one that actually exists in this repo, with the file and line
where it lives. Part 1 is what you built. Part 2 turns each one into interview answers.

---

## Part 1 — What the codebase actually uses

### 1. Hash map (`Map`) — O(1) lookup by key

| Where | Key → Value | Why it has to be a map |
|---|---|---|
| `utils/mcp/registry.js:83` | `toolIndex`: qualified tool name → `{ server, tool }` | The model replies with a tool *name* (`manim__execute_manim_code`). You must find its owning server before you can call it. With 47 tools across N servers, a linear scan is O(n) **per tool call**, inside a loop that runs up to `MAX_ROUNDS` times. |
| `utils/mcp/registry.js:82` | `clients`: serverId → live MCP client | Connection memoization. Opening an MCP connection costs a process spawn (stdio) or a TLS handshake (http). Open once per turn, reuse, close all at the end. |
| `utils/mcp/runTools.js:164` | `order`: spec object → original index | Restores discovery order after ranking shuffled it. Note: the **key is an object**. A plain `{}` can't do this (keys stringify to `[object Object]`); `Map` keys on identity. |
| `docgen/pipeline/composer.js:31` | `planByKey`: normalized heading → outline section | Matching N written sections against M planned sections. Nested loops = O(n·m); index one side first = O(n+m). |
| `app/modules/mcp/controllers/mcp.controller.js:99` | `previous`: header key → stored value | Merge-on-update: a submitted header with no value means "keep what's stored". |
| `agents/githubRag.agent.js:37`, `utils/localAssets.js:19` | memoization caches | Same input, skip the work. |

### 2. Hash set — O(1) membership

Used everywhere a question is "is X in this fixed group?":

- `utils/mcp/intent.js:26` — `TOO_GENERIC`: stop words. Without it, a server called "Local Tools" would match nearly every prompt.
- `utils/sovereign.js:62` — `CLOUD_ONLY_AGENTS`: the policy allowlist that refuses `image`/`search` in Sovereign Mode.
- `app/index.js:33` — `allowedOrigins`: CORS check, hit on every request.
- `utils/github.js:7,14` — `SKIP_DIRS` / `SKIP_FILES`: consulted once per file in a repo scan.
- `docgen/pipeline/normalizer.js:56` — `seenIds`: deduplication.
- `docgen/design/layouts.js:130`, `renderer/render.js:25,67`, `pipeline/composer.js:18` — layout classification.

**The point to make in an interview:** `array.includes(x)` is O(n). Inside a loop over n items it becomes O(n²). `set.has(x)` is O(1), so the loop stays O(n). In `github.js` that's the difference between a repo scan that finishes and one that crawls.

### 3. Array as an ordered sequence

`utils/mcp/runTools.js` builds `thread` by appending: the assistant's reply, then one
`ToolMessage` per tool result, then the next reply. **Order is semantics** — the model
reads the array as a conversation. You cannot sort it, dedupe it, or reorder it.

`docgen/pipeline/composer.js` does the opposite: it walks a *flat* array of blocks and
rebuilds a **two-level tree** (document → sections → blocks) by tracking a `current`
section and flushing it on each heading. That's the same shape as parsing a token stream
into an AST.

### 4. Vectors + brute-force k-NN — the most "DSA" file in the repo

`utils/memoryVectorStore.js` is written from scratch:

```js
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const magnitude = (a) => Math.sqrt(dot(a, a));
const cosine = (a, b) => { const m = magnitude(a) * magnitude(b); return m ? dot(a, b) / m : 0; };

async similaritySearch(query, k = 5) {
  const queryVector = await this.embeddings.embedQuery(query);
  return this.vectors
    .map((v, i) => ({ doc: this.docs[i], score: cosine(queryVector, v) }))  // O(n·d)
    .sort((a, b) => b.score - a.score)                                       // O(n log n)
    .slice(0, k)                                                             // O(k)
    .map((x) => x.doc);
}
```

**This has since been replaced by a size-k heap** (see `TopK` in the same file). The old
version was O(n·d) to score plus **O(n log n)** to sort; it now scores in O(n·d) and ranks
in **O(n log k)**. Measured on precomputed scores with k=8, the ranking step alone:

| n | full sort | size-k heap | |
|---|---|---|---|
| 1,000 | 0.16 ms | 0.04 ms | 4.4× |
| 10,000 | 2.20 ms | 0.06 ms | 38× |
| 100,000 | 30.6 ms | 0.48 ms | 64× |
| 1,000,000 | 483 ms | 3.7 ms | 130× |

**The honest caveat to give:** end-to-end the win is much smaller — about 1.5× — because at
a real embedding width (d=1536) the O(n·d) scoring pass dominates and the heap does not
touch it. The heap fixes the ranking step; to speed up scoring you precompute document
norms or move to an approximate index.

**The tie-break that makes it correct:** entries compare on score, then on arrival order.
Without that second rule the heap evicts an arbitrary one of several equal-scoring
entries, so it returns a different *set* of passages than a stable sort — not merely a
different order. Chunks tie constantly (anything orthogonal to the query scores exactly
0), so this is the common case, not an edge case.

**The contrast to draw:** `utils/vectorStore.js` uses Qdrant, which runs **HNSW** —
Hierarchical Navigable Small World, a layered proximity **graph** giving approximate
nearest neighbours in roughly O(log n) instead of O(n). Exact vs approximate is the
tradeoff. The comment in the file explains why brute force is right *here*: one PDF,
embedded, queried once, thrown away — n is small and a hosted DB is a dependency that
can be down.

### 5. Directed graph / state machine

`graph/supervisor.graph.js` is a LangGraph workflow: `addNode` (10 agents), `addEdge`
(fixed transitions), `addConditionalEdges` (the router's branch). Nodes are agents, edges
are legal transitions, and execution is a **traversal driven by state**.

`graph/router.node.js` is the branch function — an LLM classifier that picks the next node.

### 6. Greedy selection under a budget — knapsack-flavoured

`utils/mcp/runTools.js:128-168`. Tool schemas cost tokens; the provider caps the request.
So: score every tool, rank, fill greedily until the budget runs out.

```js
if (name.includes(word)) total += 3;          // name hit: strong signal
else if (description.includes(word)) total += 1;  // description hit: weak

const ranked = [...specs].sort((a, b) =>
  score(b) - score(a) ||
  String(a.function?.name).localeCompare(String(b.function?.name)));  // deterministic tiebreak

ranked.forEach((spec) => {
  if (used + size(spec) <= budget) { kept.push(spec); used += size(spec); }
  else dropped.push(spec.function?.name);
});
```

This is **0/1 knapsack** (each tool is in or out; sizes vary) solved **greedily by value**
rather than by value/weight ratio or DP.

**What to say when challenged:** true 0/1 knapsack is DP in O(n·W) and gives the optimal
set. Greedy is not optimal. But the "value" here is a keyword-match heuristic, not a real
number — optimizing exactly over an approximate score buys nothing, and DP over a 60,000-
unit budget is a big table for no gain. That's a *judgment* answer, which is what senior
interviews are actually testing.

**The tiebreak matters:** `localeCompare` on name makes the ranking deterministic. Without
it, equal-scoring tools could order differently per request, which would defeat prompt
caching on providers that have it.

### 7. Fixed-window rate limiter

`config/agentRateLimit.js`:

```js
const count = await redis.incr(key);          // atomic
if (count === 1) await redis.expire(key, 60); // start the window on first hit
if (count > max) { /* refuse */ }
```

A counter keyed `rate:{agent}:{userId}` with a 60-second TTL. Atomicity comes from
`INCR` being a single Redis operation — no read-modify-write race between concurrent
requests.

**The known flaw, which you should raise before they do:** a fixed window allows a **2×
burst at the boundary** — 20 requests at 11:59:59 and 20 more at 12:00:01 is 40 in two
seconds. Fixes: a **sliding window log** (Redis sorted set of timestamps, trim older than
60s, count what's left), or a **token bucket** (capacity + refill rate, smooths bursts and
is O(1) memory instead of O(requests)).

### 8. TTL cache / cache-aside

`utils/mcp/intent.js:64-77` is the textbook pattern:

```js
const cached = await redis.get(cacheKey(userId));
if (cached) return JSON.parse(cached);           // hit
const vocabulary = buildVocabulary(servers);      // miss → compute
await redis.set(cacheKey(userId), JSON.stringify(vocabulary), "EX", CACHE_TTL);
```

Same shape in `utils/memory.js` (conversation history) and `agents/githubRag.agent.js`
(repo metadata). Redis is a hash map with expiry; the `v2` in the cache key
(`mcp-vocab:v2:${userId}`) is **cache invalidation by versioning** — bump the prefix and
every old entry is orphaned instead of stale.

### 9. Bucketing — counting-sort flavour

`frontend/src/components/Sidebar.jsx:24` groups conversations into Today / Yesterday /
Previous 7 days / Older:

```js
const i = t >= startOfToday ? 0 : t >= startOfToday - DAY ? 1 : t >= startOfToday - 7*DAY ? 2 : 3;
buckets[i][1].push(conv);
```

Sort O(n log n), then a single O(n) pass assigning each item to one of 4 fixed buckets by
threshold comparison. Since the bucket count is constant, assignment is O(1) per item.

### 10. Trees

- **Document tree** — docgen: document → sections → blocks, built by `composer.js`, walked by `renderer/render.js`.
- **Filesystem tree flattened** — `utils/github.js:142` sorts zip entries by path and filters through the skip-sets. A zip is a tree serialized to a list; sorting by path restores sibling order.
- **B-tree indexes (MongoDB)** — `app/modules/mcp/models/mcpServer.model.js:116`:
  `index({ userId: 1, name: 1 }, { unique: true })` is a **compound index**. The prefix rule
  applies: it serves queries on `userId`, and on `userId + name`, but *not* on `name` alone.
  `app/modules/invite/models/invite.model.js:74` is a **TTL index**
  (`expireAfterSeconds: 0`) — the database deletes expired invites itself.

### 11. String algorithms

- **Namespacing to prevent collisions** — `registry.js:13`:
  `qualifiedName = (server, tool) => \`${slug(server)}__${slug(tool)}\``. Two servers can
  both expose `search` without clashing. `slug()` restricts to `[a-z0-9_-]` and truncates
  to 24 chars because models are strict about the tool-name character set.
- **Multi-pattern matching** — `intent.js` `selectServers` tests each server's name tokens
  with a word-boundary regex and each tool name as a substring. That's O(servers × tools ×
  prompt) per turn. A **trie** or **Aho–Corasick** automaton would match all patterns in a
  single pass over the prompt.
- **Delimiter selection under adversarial input** — `utils/guardrails.js` `newFence()`
  generates a random fence per turn so untrusted tool output can be wrapped in a delimiter
  it could not have guessed and therefore cannot forge.

---

## Part 2 — DSA questions this project answers

### A. The mapping table

| Your code | DSA concept | Classic problems with the same shape |
|---|---|---|
| `toolIndex` Map | Hash map for O(1) dispatch | Two Sum · Group Anagrams · Design HashMap |
| `clients` Map, `processCache` | Memoization / pooling | LRU Cache · Fibonacci memo |
| `TOO_GENERIC`, `SKIP_DIRS` | Hash set membership | Contains Duplicate · Longest Consecutive Sequence |
| `seenIds` in normalizer | Dedup with a set | Remove Duplicates · Happy Number (cycle via set) |
| `memoryVectorStore.similaritySearch` | **Top-k selection** | Kth Largest Element · Top K Frequent Elements · Merge k Sorted Lists |
| Qdrant / HNSW | Graph-based ANN, skip-list layering | Design Skiplist · graph traversal |
| `fitToBudget` | **Greedy under a budget / knapsack** | 0/1 Knapsack · Fractional Knapsack · Task Scheduler · Maximum Units on a Truck |
| `supervisor.graph.js` | Directed graph, state machine | Course Schedule (topo sort) · Clone Graph · Number of Islands |
| `agentRateLimit.js` | Rate limiting design | Logger Rate Limiter · Design Hit Counter |
| Redis TTL caches | Cache-aside, eviction | LRU Cache · LFU Cache |
| `groupByAge` | Bucketing / counting sort | Sort Colors (Dutch flag) · Group Anagrams · Top K Frequent (bucket sort) |
| `qualifiedName` / `slug` | Encoding with a delimiter | **Encode and Decode Strings** — literally the same problem |
| `newFence()` | Delimiter that input can't forge | Encode and Decode Strings, adversarial variant |
| `selectServers` matching | Multi-pattern string search | Implement Trie · Word Search II · Design Add and Search Words |
| `composer.js` flat → tree | Parsing a stream into a tree | Flatten Nested List Iterator · Binary Tree from Preorder |
| `MAX_ROUNDS` in the tool loop | Bounded iteration / cycle guard | Linked List Cycle · detecting non-termination |
| `truncate` at `MAX_RESULT_CHARS` | Fixed-size window on a stream | Sliding Window Maximum · Longest Substring Without Repeating |
| MongoDB compound index | B-tree, prefix rule | Design Search Autocomplete · Trie prefix queries |

### B. Questions they'll actually ask about *your* project

**"Walk me through a request."**
> A message enters the LangGraph supervisor — a directed graph where nodes are agents.
> The router node classifies it and picks the next node via a conditional edge. If it lands
> on chat, we fetch the user's MCP servers, narrow them by what the prompt names, discover
> their tools, rank those tools against the prompt and greedily fill a token budget, then
> bind what fits and run a bounded tool-calling loop — max 5 rounds, so a server that keeps
> asking to be called again can't spin forever.

**"Why a Map and not an object?"**
> `order` in `fitToBudget` keys on the spec *object itself*. Plain objects stringify keys, so
> every spec would collapse to `[object Object]`. Map preserves identity. Map also keeps
> insertion order and doesn't inherit prototype keys — no `__proto__` collision risk from
> a tool name arriving over the network.

**"Where's the bottleneck?"**
> Brute-force k-NN in `memoryVectorStore` is O(n·d) per query, and the sort is O(n log n)
> when I only need the top 5. A size-k heap makes it O(n log k). It hasn't mattered because
> n is one PDF's chunks — but that's the first thing I'd change if documents got large.

**"How would this scale to 10,000 tools?"**
> `selectServers` is O(servers × tools × prompt) per turn — fine at 47 tools, not at 10,000.
> I'd build an **inverted index**: token → set of tool IDs, constructed once and cached,
> then intersect the prompt's tokens. That turns per-turn matching into a few set lookups.
> Ranking would move to a heap since I'd only ever need the top handful.

**"How do you prevent the tool loop from running forever?"**
> `MAX_ROUNDS = 5`. After that it appends a message telling the model to answer from what it
> has and does one final call. Cycle detection by bounding depth rather than tracking state,
> because the "cycle" here is a model that keeps requesting tools, not a graph cycle.

**"Your rate limiter — what breaks?"**
> Fixed window, so it allows a 2× burst across the boundary. I'd move to a sliding window log
> with a Redis sorted set, or a token bucket if I cared about memory.

### C. Weak spots — raise these before they do

Interviewers respect a candidate who names their own tradeoffs:

1. **Brute-force k-NN is still O(n·d) per query.** The ranking step now uses a size-k heap,
   but every chunk is still scored. At large n the answer is an approximate index (HNSW).
2. **Fixed-window rate limiter bursts at the boundary.** Known; sliding window is the fix.
3. **Greedy tool selection isn't optimal.** Deliberate — the scoring function is a heuristic.
4. **`selectServers` is linear per turn in tools × prompt length.** An inverted index or trie is the scaling answer.
5. **No automated tests in the repo.** The honest answer is "that's my next piece of work,
   starting with router-accuracy evaluation, because the router touches every request."

---

## Quick complexity reference

| Operation | Current | Better at scale |
|---|---|---|
| Tool name → server | O(1) Map | — |
| Tool ranking | O(n log n) sort | O(n log k) heap for top-k |
| Budget fill | O(n) greedy | O(n·W) DP if the score were exact |
| Vector top-k | O(n·d + n log k) heap | O(log n) with HNSW; precompute doc norms to halve the scoring pass |
| Server selection | O(servers × tools × prompt) | Inverted index or Aho–Corasick |
| Set membership | O(1) | — |
| Conversation fetch | O(1) Redis hit, else DB | — |
| Sidebar grouping | O(n log n) sort + O(n) bucket | O(n) if sorted per bucket |
