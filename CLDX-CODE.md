cldx code — the sovereign coding agent, and the branches it has to get right

§5.5 of the product spec says what cldx code *is*. This says how it decides, because
the decisions are where a local-model coding agent actually succeeds or fails.

One sentence of scope: **a developer opens a repo in VS Code, types one command, and an
agent loop runs against the model on their own hardware — and no byte of that repo
reaches a cloud provider.** The zero-egress half is the easy half; it is the same
fail-closed gate `utils/model.js` already implements. The hard half is that a 14B model
on a workstation is not Claude, and the agent has to branch around that honestly instead
of pretending otherwise.

---

## Part 0 — The one command

```
$ cldx code
```

Typed in the VS Code integrated terminal, in the repo root. Nothing else — no API key
prompt, no model picker, no config file the user has to author first. Everything below is
resolved by probing, and every probe that fails produces a sentence telling the user the
single next thing to do.

```
cldx code
  │
  ├─ 0.1  workspace root        git rev-parse --show-toplevel, else $PWD
  ├─ 0.2  config               .cldx/config.json → ~/.cldx/config.json → env → defaults
  ├─ 0.3  zone                 sovereign | cloud          ──► Branch A
  ├─ 0.4  runtime discovery    which server is listening   ──► Branch B
  ├─ 0.5  capability probe     can it call tools?          ──► Branch C
  ├─ 0.6  context budget       how much can we feed it?    ──► Branch D
  ├─ 0.7  approval policy      what may it do unasked?     ──► Branch E
  └─ 0.8  attach               open the VS Code side panel on the same session
```

Steps 0.4–0.6 are cached in `.cldx/runtime.json` keyed by `(baseURL, model)`, so the
command is slow exactly once per machine. `--reprobe` clears it.

**Install, also one command:**

```bash
npm i -g @cldx/code          # ships the CLI *and* the VS Code extension bundle
cldx code --install-extension # writes the .vsix into VS Code; no marketplace round-trip
```

The marketplace path cannot be the only path. An air-gapped SCIF workstation has no
marketplace, and "works offline" is the product. The npm tarball must be installable from
a mirror or a USB stick, and the extension must come inside it.

---

## Part 1 — The five branches

```
                                    cldx code
                                        │
                   ┌────────────────────┴────────────────────┐
         A. ZONE   │  sovereign?                             │
                   └────────┬───────────────────────┬────────┘
                        yes │                       │ no
                            ▼                       ▼
              assertSovereignReady()          cloud provider
              CODE-001..005 armed             (existing switch)
                            │                       │
                            └───────────┬───────────┘
                                        ▼
         B. RUNTIME     ┌───── probe GET {baseURL}/models ──────┐
                        │                                       │
            ┌───────────┼───────────┬──────────────┐            │
            ▼           ▼           ▼              ▼            ▼
         Ollama       vLLM       SGLang       llama.cpp      PolicyDenied
         :11434       :8000       :30000        :8080         SOV-001
            └───────────┴───────────┴──────────────┘
                                        │
                                        ▼
         C. TOOLS       ┌──── one probe call with a trivial tool ────┐
                        │                                             │
            ┌───────────┼─────────────────────┬─────────────────────┐
            ▼           ▼                     ▼                     ▼
       native tools  grammar-constrained   XML ReAct          read-only mode
       (tools API)   (guided_json/GBNF)    (tag parsing)      (no edits at all)
                                        │
                                        ▼
         D. CONTEXT     ┌──── n_ctx from /models, else binary-search probe ────┐
                        │                                                       │
            ┌───────────┼───────────────────┬──────────────────┐
            ▼           ▼                   ▼                  ▼
         ≥128k       32k–128k            8k–32k             <8k
        full files   repo map +         repo map +         symbol
                     full files         hunks only         stubs only
                                        │
                                        ▼
         E. APPROVAL    plan / auto-edit / auto-run      ──►  agent loop
```

### Branch A — zone

The zone is **per session**, not per deployment, mirroring the per-turn decision in
`agent.controller.js:42`. `cldx code` defaults to the repo's declared classification:

```json
// .cldx/config.json — committed to the repo, so classification follows the code
{ "classification": "restricted", "zone": "sovereign" }
```

A repo marked `restricted` **cannot** be opened in cloud zone — `cldx code --cloud` in
that repo refuses rather than warning. The same principle as `sovereign__` Qdrant
collections: classification is a property of the thing, not a flag someone remembers to
pass.

### Branch B — runtime discovery

Every supported runtime answers `GET {baseURL}/v1/models`. Probe the configured
`SOVEREIGN_BASE_URL` first; if unset, probe the four default ports **on loopback only**.

Loopback only is not a convenience — a discovery sweep that walks the LAN is a sovereign
product scanning a customer's network, and it will be the first thing a security review
finds. If nothing answers on `127.0.0.1`, throw `PolicyDenied(SOV-001)` with the install
line for Ollama. Never widen the search, never fall back to cloud.

Runtime identity is worth recording even though all four speak the same shape, because
Branch C's answer differs per runtime: vLLM takes `guided_json`, llama.cpp takes a GBNF
`grammar`, Ollama takes `format: "json"`. Same protocol, different lever for the same job.

### Branch C — can the model actually call tools

**This is the branch that decides whether cldx code works at all.** Claude Code is built
on a model with reliable, trained-in tool calling. `qwen2.5-coder:7b` on a laptop is not
that, and an agent loop that assumes it will produce an infinite stream of malformed JSON
and burned GPU hours.

So probe it, once, at startup — one request carrying a single trivial tool
(`ping(message: string)`) and a prompt that can only be answered by calling it:

| Probe result | Mode | How tool calls are produced |
|---|---|---|
| Well-formed `tool_calls` in the response | **native** | OpenAI tools API, unchanged |
| Text that is nearly-JSON, or ignores the tool | **constrained** | Re-issue with `guided_json` / GBNF / `format:json` — the decoder is forced to emit a valid call |
| Neither, after one constrained retry | **react** | XML tags (`<cldx:edit file="…">`), parsed with a tolerant reader |
| Model refuses or returns garbage | **read-only** | Explain and answer questions; no edit or shell tools offered |

The fourth row matters as much as the first three. A degraded mode that is *announced* —
`cldx code: qwen2.5:3b did not pass the tool probe; running read-only` — is a product. A
degraded mode that is silent is a bug report about the agent "deleting my file."

Grammar-constrained decoding is the quiet win here: it moves correctness from *hoping the
model emits valid JSON* to *the sampler being unable to emit anything else*. It is the
single highest-leverage thing in this document for small-model reliability.

### Branch D — the context budget

The second place local models break the Claude Code design. The assumption "paste the
file, paste the neighbours, paste the test output" dies at 8k tokens.

Read `n_ctx` from the runtime (`/v1/models` exposes it on vLLM and llama.cpp; Ollama
exposes it via `/api/show`). If unavailable, binary-search with a cheap request until the
server errors, and cache the result.

Then spend the budget in a fixed order, dropping from the bottom when it runs out:

```
1. system + policy          ~400 tok    never dropped
2. repo map                 ~10%        tree-sitter symbol index, whole repo, no bodies
3. open file / selection    ~35%        the thing the user is actually looking at
4. retrieved neighbours     ~25%        local Qdrant, sovereign__ collection
5. conversation history     ~20%        oldest turns summarised first
6. tool output              ~10%        tail-truncated; errors kept, successes elided
```

The repo map is the piece that makes a 32k model usable on a 400k-line repo: a
tree-sitter pass yields every file's symbols without bodies, so the model can *ask* for
what it needs instead of being handed a guess. Tree-sitter runs locally and in-process —
no network, which is what lets this exist in sovereign mode at all.

### Branch E — approval

Three levels, default middle:

| Level | Reads | Edits | Shell |
|---|---|---|---|
| `--plan` | auto | proposes a diff, applies nothing | never |
| default | auto | applies, each edit a separate undo entry | asks every time |
| `--auto` | auto | applies | allowlist only (`npm test`, `pytest`, `go build`, …) |

Even `--auto` never auto-runs a command that is not on the allowlist, and the allowlist
is never extended by the model. Edits land through the VS Code workspace edit API so
`⌘Z` works — atomic rollback is cheap if you never write files behind the editor's back.

---

## Part 2 — The policy gate

cldx code reuses `getModel(agent, state)` with `agent: "coding"` and
`state.sovereign: true`, so SOV-001/002/003 apply unchanged. It adds five rules in the
same family — same `PolicyDenied`, same hash-chained `audit()`, same refuse-never-degrade
posture.

| Rule | Fires when | Why |
|---|---|---|
| **CODE-001** | any outbound request in a sovereign session resolves to a non-loopback, non-allowlisted host | The catch-all. Enforced in one HTTP agent that every client shares, so a new dependency cannot route around it. |
| **CODE-002** | local endpoint returns 5xx / times out | **No cloud fallback, ever.** Degrading to a cloud model during a local outage is a silent IP disclosure, and outages are exactly when nobody is watching. Fail the turn. |
| **CODE-003** | an MCP server with `transport: "http"` is configured | Tool arguments in a coding agent *are source code*. This is SOV-003's open question (`sovirgn.md`, Leak 3) answered for the case where it bites hardest: stdio only. |
| **CODE-004** | shell command is outside the allowlist under `--auto` | Prevents `curl`-shaped exfiltration authored by the model itself. |
| **CODE-005** | telemetry, crash reporting, or update check during a sovereign session | A stack trace carries file paths and often source lines. Disabled entirely — including the VS Code extension's own reporter. |
| **CODE-006** | `--cloud` is passed in a repository classified `restricted` or above | Branch A's refusal. `.cldx/config.json` is committed, so classification travels with the code; a flag typed in a hurry must not outrank it, or the classification is advice rather than policy. |

Audit entries record `sha256(path)` and `sha256(diff)`, never the path or the diff. An
auditor can prove *which* file a session touched by hashing a candidate; the log alone
discloses nothing. Same reasoning as `sha256(prompt)` in `utils/audit.js`.

---

## Part 3 — The VS Code extension is a thin client

```
VS Code extension host                     cldx code (node process)
  ├── side panel (webview)                   ├── agent loop
  ├── diff / edit application   ◄── JSON-RPC ─►├── tools: read grep edit shell test
  ├── workspace file reads                   ├── tree-sitter repo map
  └── status bar: zone · model               └── local model client
          │                                            │
     unix domain socket                        http://127.0.0.1:…
     (named pipe on Windows)                   never leaves the host
```

All intelligence lives in the CLI; the extension renders and applies. Three consequences,
each load-bearing:

1. **The terminal and the panel are the same session.** `cldx code` in the integrated
   terminal is detected by the extension (same workspace root, socket in `.cldx/`), and
   the panel attaches. No second agent, no divergent state.
2. **No cloud relay in the loop.** The extension never talks to `cldx.ai` to reach the
   model. A relay would make "sovereign" depend on a remote service being honest.
3. **Headless works.** CI, SSH, a jump box into an air-gapped network — the extension is
   optional sugar over a CLI that is complete on its own.

Status bar is non-negotiable UI: **`◆ Sovereign · qwen2.5-coder:32b · native`** — zone,
model, and tool mode, always visible. A developer must never have to wonder which zone
just read their repo. (And per the identity rule: it shows the *local* model the user
chose, which is the honest answer here — sovereign mode genuinely is running their
hardware.)

---

## Part 4 — Memory follows the same Bell–LaPadula rule

A cldx code session is a conversation, so Part 3 of `sovirgn.md` applies without
amendment:

- Session transcripts write to `conversation:{id}:sov`, never the cloud tier.
- Nothing goes to MongoDB — gate `/save-message` on `isSovereignTurn`, as already
  planned there.
- **Summaries inherit the tier of their inputs.** Flagged in `sovirgn.md` as the most
  likely future regression; cldx code makes it certain, because long coding sessions
  compact constantly. A summary of sovereign turns is sovereign.
- Repo embeddings go to `sovereign__code__{repoHash}` on the local Qdrant. A code index
  built against `gemini-embedding-001` is SOV-003's leak with the entire repository as
  payload.

One addition specific to code: **`.cldx/` must be gitignored, and `cldx code` writes that
line itself on first run.** Session transcripts contain source. Committing them to the
repo that is being protected would be a self-inflicted version of the exact leak.

---

## Part 5 — Prove it, don't assert it

Extend `scripts/verifySovereign.js`. Canary strings over reasoning, same as before:

```js
// CODE-001: nothing leaves the host.
const sock = interceptSockets();                       // record every connect()
await runSession({ sovereign: true, repo: fixtureRepo, prompt: "refactor auth.js" });
assert(sock.every(isLoopback), `egress in sovereign session: ${sock.filter(h => !isLoopback(h))}`);

// CODE-002: local down must fail, not fall back.
await withLocalEndpointDown(async () => {
  await assertRejects(() => runSession({ sovereign: true, prompt: "hi" }), /CODE-002/);
});

// CODE-003: a remote MCP server is refused, not silently used.
await assertRejects(
  () => runSession({ sovereign: true, mcp: [{ transport: "http", url: "https://example.com/mcp" }] }),
  /CODE-003/);

// Source never reaches the cloud tier (the sovirgn.md canary, with code as payload).
await fs.writeFile(`${fixtureRepo}/secret.js`, "// RESTRICTED-CANARY\n");
await runSession({ sovereign: true, prompt: "what does secret.js do?" });
const asCloud = await getMemory(id, { sovereign: false });
assert(!JSON.stringify(asCloud).includes("RESTRICTED-CANARY"), "source leaked to cloud tier");

// Branch C degrades loudly, never silently.
const s = await runSession({ sovereign: true, model: "tool-incapable-stub" });
assert(s.mode === "read-only" && s.warnings.some(w => /read-only/.test(w)),
       "degraded without telling the user");
```

The socket interceptor is the one that earns its keep. It is the only test that survives
a future dependency deciding to phone home, and that is the failure mode no amount of
code review catches.

---

## Implementation order

1. **CLI skeleton + Branch A/B** — `cldx code` discovers a local runtime and streams a
   plain completion. No tools yet. Proves the zero-config promise.
   *Built — `cli/`, zero dependencies, `npm test` covers the refusals.*
2. **The socket interceptor and CODE-001/002** — before any tool exists. Build the cage
   first; retrofitting egress control onto a working agent never finishes.
   *Built — `cli/src/egress.js`, patched at `net.Socket.prototype.connect` and
   `tls.connect`, with the refusal threaded through fetch's error wrapper so a
   blocked connection is never reported as a local outage.*
3. **Branch C probe + native path** — tools working on a model that supports them.
   *Built — `cli/src/capability.js` classifies into all four modes and caches per
   (endpoint, model); `cli/src/tools.js` is the native loop. Measured on Ollama +
   `qwen2.5-coder:7b`: **constrained**, not native — it emits a well-formed call
   as text. The native path is covered by a scripted runtime, not by a local
   model, because no model on hand exhibits it.*
4. **Tools: read, grep, edit** — in that order. Edit last, behind `--plan` until the diff
   quality is trusted.
5. **Branch D: repo map + budget** — the step that makes it usable on a real repo rather
   than a toy one.
6. **Branch C fallbacks** — constrained decoding, then ReAct, then read-only. This is
   where small-model support is actually won.
   *Built, and pulled ahead of steps 4–5: the probe found the local model is not
   native, so tools registered first would have been unreachable. `cli/src/textloop.js`
   plus `cli/src/constrain.js`. Verified end to end — `qwen2.5-coder:7b` drove a
   tool call and answered from its result in one step, no retry needed.*
7. **VS Code extension** — thin client over the socket. Status bar on day one.
8. **Branch E approvals + shell/test tools** — the auto-repair loop from §5.5.
9. **CODE-003/004/005 + the canary suite.** Ship nothing to a customer before step 9.

Steps 1–5 are a working sovereign coding agent for capable local models. Step 6 is what
makes it work on the hardware most customers actually have, and is the step most likely
to be underestimated.
