# Sovereign Mode — the flow as built, the gaps, and a one-way memory bridge

Everything in Part 1 is what the code does today, with file and line. Part 2 is what
currently leaks. Part 3 is the design for the cache you asked for.

---

## Part 1 — The flow, end to end

### The decision is per turn, not per deployment

The same install answers an ordinary question from the cloud and a confidential one
locally. So `sovereign` travels with the request, not the environment.

```
Browser  ──►  POST /agent  { prompt, sovereign: true|"true", file? }
                    │
                    ▼
        agent.controller.js:42   isSovereign(sovereign)
                    │            normalises "true" (multipart sends every field
                    │            as a string) into a real boolean
                    ▼
        graph.invoke({ ..., sovereign: isSovereignTurn })
                    │
                    ▼
        graph/state.js:64        sovereign: Annotation()
                    │            declared on the graph state, or every agent
                    │            would read `undefined` and answer from cloud
                    ▼
        router.node.js           picks an agent (chat / coding / vision / …)
                    │
                    ▼
        getModel(agent, state)   ◄── the single policy gate
```

### The gate — `utils/model.js`

Every agent calls `getModel(agent, state)`. When `state.sovereign === true`, four things
happen **before** any model is constructed:

```js
if (sovereign) {
  assertSovereignReady();            // SOV-001
  assertAgentAllowed(agent, sovereign); // SOV-002
  const model = localModelFor(agent);
  audit({ ...context, zone: "SOVEREIGN", model, endpoint: SOVEREIGN_BASE_URL,
          decision: "ALLOW", rule: "SOV-000" });
  return new ChatOpenAI({ apiKey: SOVEREIGN_API_KEY, model,
                          configuration: { baseURL: SOVEREIGN_BASE_URL } });
}
audit({ ...context, zone: "CLOUD", decision: "ALLOW", rule: "CLD-000" });
switch (agent) { /* Groq / DeepSeek / Gemini */ }
```

The sovereign branch **returns before the cloud switch is reachable**. That ordering is
the actual enforcement — not a flag checked inside each provider.

### The fail-closed rules

| Rule | Where | Fires when | Why it refuses instead of falling back |
|---|---|---|---|
| **SOV-001** | `sovereign.js:90` `assertSovereignReady` | `SOVEREIGN_BASE_URL` unset | A fallback to cloud "because local was down" fires during an outage, when nobody is reading logs. That is how local-only products leak. |
| **SOV-002** | `sovereign.js:104` `assertAgentAllowed` | agent ∈ `CLOUD_ONLY_AGENTS` = `{image, search}` | Image generation is a Gemini call, search is a Tavily call. Sending the prompt to Tavily to "just do the search" is the exact leak the mode exists to prevent. |
| **SOV-003** | `embedding.js:88` `getEmbeddings` | sovereign + no local embedder | **The leak nobody notices.** A confidential PDF embedded against `gemini-embedding-001` has already left the building, and no LLM was ever called. |
| **SOV-004** | `storage.js` `storeArtifact` | sovereign artefact write | A locally-generated report holds the same content as the prompt. Uploading the finished PDF to S3 would leak the document at the last step, after every other control did its job. |
| **SOV-005** | `mcp/runTools.js` | sovereign + non-stdio MCP transport | An HTTP MCP server is a third party with the tool arguments in hand. Only a process on this host can be reasoned about. |
| **SOV-006** | `sovereign.js` `assertModelCapable` | vision turn, text-only local model | Without this, "the local model cannot see images" quietly becomes "so we used Gemini". |
| **SOV-008** | `provenance.js` `assertModelIntegrity` | pinned digest != the weights being served | A tag can be repointed at different weights without the tag changing, so "we ran qwen2.5-coder:7b" is an assertion until something checks it. |

All of them throw `PolicyDenied` carrying a rule id, so an audit can reconstruct *why* a
request was refused months later without retaining the prompt.

**SOV-007** is the egress rule and is deliberately not in this table: it is not enforced
by application code at all. It is the container having no route off its network, which is
the only control here that does not depend on this codebase being correct.

### What the audit log records

Every entry carries `modelDigest` alongside `model` -- the digest of the weights that
actually answered, read from the runtime at startup. Without a pin that is provenance;
with `SOVEREIGN_MODEL_DIGESTS` set it is enforcement, and a substituted model is refused
before the client is built rather than discovered in the log afterwards. A runtime that
publishes no digest is recorded as `unverified` rather than as fine.

### Which model answers

`localModelFor(agent)` (`sovereign.js:24`) maps agent → env var, all falling back to one
general model so a small install can point everything at `llama3.1`:

| agent | env var |
|---|---|
| `coding` | `SOVEREIGN_CODING_MODEL` |
| `vision` | `SOVEREIGN_VISION_MODEL` |
| `pdf` / `ppt` / `pdf_rag` | `SOVEREIGN_DOC_MODEL` |
| everything else | `SOVEREIGN_MODEL` |

The runtime is a **base URL, not a vendor** — vLLM, SGLang, Ollama and llama.cpp all speak
the OpenAI HTTP shape, so nothing binds you to one of them.

### Retrieval is tiered too

`utils/vectorStore.js:16-26` is the pattern to copy everywhere else:

```js
const url        = sovereign ? SOVEREIGN_QDRANT_URL : QDRANT_URL;
const collection = sovereign ? `sovereign__${collectionName}` : collectionName;
```

Separate cluster **and** separate collection namespace. The comment states the principle
exactly right: *classification has to be a property of the collection, not a filter
someone remembers to apply at query time.*

### The audit trail — `utils/audit.js`

Every routing decision is appended to a **hash-chained** log: each entry carries the hash
of the previous one, so a deleted or edited line breaks the chain and tampering is
detectable even by someone who can write to the file. The log stores `sha256(prompt)`,
never the prompt — otherwise the audit trail becomes its own disclosure.

### To stand it up

```bash
# Local runtime (any OpenAI-shaped server)
ollama serve
ollama pull llama3.1
ollama pull nomic-embed-text

# .env
SOVEREIGN_BASE_URL=http://127.0.0.1:11434/v1
SOVEREIGN_MODEL=llama3.1
SOVEREIGN_EMBEDDING_MODEL=nomic-embed-text
SOVEREIGN_QDRANT_URL=http://127.0.0.1:6333
AUDIT_LOG_PATH=./audit/decisions.log
```

Then `node scripts/verifySovereign.js` — it asserts cloud-only agents are refused, every
other agent resolves locally, and embeddings stay local.

---

## Part 2 — What leaks today

Before adding a tiered cache, fix these. Both are in the *write* path, which is the
direction that matters.

### Leak 1 — conversation memory is shared across zones

`utils/memory.js:24` uses one key for both zones:

```js
const key = `conversation:${conversationId}`;   // no zone in the key
```

`agent.controller.js:47` writes **every** turn to it, sovereign included. So:

```
Turn 1  (SOVEREIGN)  "summarise this acquisition memo"  ──► conversation:abc
Turn 2  (CLOUD)      "what did we just discuss?"
                     getMemory("abc") returns turn 1 ──► sent to Groq / DeepSeek
```

The confidential turn becomes cloud prompt context on the next message. This is a
**write-down** violation: high-classification data reaching a low-classification channel.

### Leak 2 — sovereign turns are persisted to MongoDB

`agent.controller.js:54` gates persistence on incognito only:

```js
if (!isIncognito) {
  await internalApi.post(`/save-message`, { conversationId, role: "user", content: prompt });
}
```

A sovereign prompt and its answer are written to the cloud database verbatim.

### Leak 3 (worth deciding on) — remote MCP servers in a sovereign turn

`chat.agent.js` calls `runWithMcpTools` regardless of zone, and `getModel("mcp", state)`
correctly returns the local model — but the **tools themselves** are remote. A turn with a
`transport: "http"` server such as `https://api.githubcopilot.com/mcp/` ships the model's
tool arguments to GitHub. `assertAgentAllowed` does not cover this.

The consistent rule would be a fourth policy: in Sovereign Mode, only `stdio` MCP servers
are usable; remote ones are filtered out with a note, the same way `image`/`search` are
refused.

---

## Part 3 — The one-way memory bridge

### What you asked for, stated precisely

> Cloud content is readable from Sovereign Mode. Sovereign content is **never** readable
> from Cloud Mode. The cache only ever gives information to Sovereign.

That is exactly **Bell–LaPadula**, the classic multilevel security model. Treat Sovereign
as the *high* classification and Cloud as *low*:

| Rule | Meaning here |
|---|---|
| **Read down — allowed** | A sovereign turn may read cloud history. |
| **No read up** | A cloud turn may never read sovereign history. |
| **No write down** | A sovereign turn may never write anywhere cloud can read. |

The third rule is the one people forget, and it's the one that's broken today.

### Design: classification belongs to the key

Same principle already used for Qdrant collections — the zone is part of the **address**,
not a filter applied at read time. A filter is one forgotten `if` away from a breach; a
key that is never constructed cannot be read.

```
conversation:{id}          ← CLOUD tier   · written by cloud turns   · read by both
conversation:{id}:sov      ← SOVEREIGN tier · written by sovereign turns · read by sovereign only
```

### Read path

```js
// utils/memory.js
const cloudKey     = (id) => `conversation:${id}`;
const sovereignKey = (id) => `conversation:${id}:sov`;

export const getMemory = async (conversationId, { sovereign = false } = {}) => {
  const cloud = await readTier(cloudKey(conversationId));

  // A cloud turn never even builds the sovereign key. There is no filter to
  // forget and no flag to get wrong -- the data is simply not addressed.
  if (!sovereign) return cloud;

  const restricted = await readTier(sovereignKey(conversationId));

  // Two tiers, each already in order, interleaved by timestamp -- the merge
  // step of a merge sort, O(n + m).
  return mergeByTime(cloud, restricted);
};
```

**This requires a timestamp on every message.** Today they are `{ role, content }` with no
ordering field, so the two tiers cannot be interleaved correctly. Add `at: Date.now()` in
`addMessage` and migrate old entries by treating a missing `at` as `0` (they sort first,
which is right — they are older than anything written after the change).

### Write path

```js
export const addMessage = async (conversationId, role, content, { sovereign = false } = {}) => {
  // No write down: a sovereign turn only ever touches the restricted tier.
  const key = sovereign ? sovereignKey(conversationId) : cloudKey(conversationId);
  ...
};
```

And in `agent.controller.js`, persistence becomes conditional on **both** flags:

```js
if (!isIncognito && !isSovereignTurn) {
  await internalApi.post(`/save-message`, { ... });   // MongoDB is a cloud store
}
```

### Where the sovereign tier actually lives

`shared/redis/redis.js:6` defaults to `redis://127.0.0.1:6379`, so today it is local and
this works. **But the mode is only as sovereign as its weakest store.** If `REDIS_URL` ever
points at a hosted Redis, the restricted tier is sitting on someone else's infrastructure
and the whole feature is theatre. Two options:

1. **Assert it.** Refuse to start a sovereign turn if `REDIS_URL` resolves to a non-local,
   non-allowlisted host — a fourth fail-closed rule in the same family as SOV-001.
2. **Separate instance.** `SOVEREIGN_REDIS_URL`, mirroring what `vectorStore.js` already
   does with `SOVEREIGN_QDRANT_URL`. More moving parts, but consistent with the existing
   pattern and easier to prove to a buyer.

### The consequence you have to design for

A user asks a sovereign question, then flips to Cloud Mode and says "what did we just
discuss?" The cloud turn legitimately cannot see it — and the model will **confabulate**
rather than admit a gap, because nothing in its context says anything is missing.

Tell it, without telling it what is missing:

```js
if (!sovereign && (await hasRestrictedTier(conversationId))) {
  messages.push(new SystemMessage(
    "Some earlier turns in this conversation were answered in Sovereign Mode and are " +
    "not available here. If the user refers to them, say they are only visible in " +
    "Sovereign Mode. Do not guess at their contents."
  ));
}
```

Note `hasRestrictedTier` returns a **boolean, not content** — the existence of restricted
turns is metadata the cloud side may know; the turns themselves are not. If even that
leaks too much for your threat model, drop the note and accept the confabulation risk, or
block mode-switching inside a conversation entirely.

### Two more places the rule has to hold

- **Summaries inherit the highest tier of their inputs.** If you ever compact history, a
  summary of sovereign turns is itself sovereign and belongs in `:sov`. This is the most
  likely future regression.
- **Conversation titles.** If a title is generated from the first message and stored in
  Mongo, a sovereign first message leaks through the sidebar. Check where titles are
  written.

### Prove it, don't assert it

`scripts/verifySovereign.js` already tests the model gate. Extend it with the property
that actually matters:

```js
// Write a sovereign turn, then read as cloud. The content must not appear.
await addMessage(id, "user", "RESTRICTED-CANARY", { sovereign: true });
const asCloud = await getMemory(id, { sovereign: false });
assert(!JSON.stringify(asCloud).includes("RESTRICTED-CANARY"), "sovereign content leaked to cloud");

// Read down must still work: cloud content is visible from sovereign.
await addMessage(id, "user", "PUBLIC-CANARY", { sovereign: false });
const asSovereign = await getMemory(id, { sovereign: true });
assert(JSON.stringify(asSovereign).includes("PUBLIC-CANARY"), "sovereign lost cloud context");
assert(JSON.stringify(asSovereign).includes("RESTRICTED-CANARY"), "sovereign lost its own context");
```

A canary string is worth more than any amount of reasoning about the code.

---

## Implementation order

1. **Stop the bleeding** — sovereign-gate `/save-message` in `agent.controller.js`. One
   condition; removes the Mongo leak immediately.
2. **Add `at` timestamps** in `addMessage`, tolerate missing ones on read.
3. **Split the tiers** — `cloudKey` / `sovereignKey`, thread `{ sovereign }` through
   `getMemory` / `addMessage` and their two call sites in the controller.
4. **Merge on read** for sovereign turns.
5. **Canary test** in `verifySovereign.js`. Do this before believing step 3.
6. **The missing-context system note** for cloud turns in a mixed conversation.
7. **Decide on remote MCP servers** in sovereign turns (Leak 3) — filter or refuse.
8. **Decide where the sovereign tier lives** — assert Redis is local, or add
   `SOVEREIGN_REDIS_URL`.

Steps 1 and 5 are worth doing even if you never build the rest.
