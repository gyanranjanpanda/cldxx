# Running and checking Sovereign Mode locally

Set up and verified on this machine (Apple M1 Pro, 16 GB) on 2026-09-27.

---

## What is already running here

| Piece | Value |
|---|---|
| Runtime | Ollama 0.34.3, listening on `127.0.0.1:11434` |
| Chat / coding / docs model | `qwen2.5-coder:7b` (4.7 GB) |
| Embedding model | `nomic-embed-text` (274 MB, 768 dims) |
| Vision model | **none** — so SOV-006 refuses vision turns rather than faking them |

Ollama serves an OpenAI-compatible API at `/v1`, which is exactly what
`SOVEREIGN_BASE_URL` expects. Nothing in the application is Ollama-specific.

The config appended to `backend/services/agent/.env`:

```bash
SOVEREIGN_BASE_URL=http://127.0.0.1:11434/v1
SOVEREIGN_API_KEY=not-needed          # local runtimes ignore it; the client demands one
SOVEREIGN_MODEL=qwen2.5-coder:7b
SOVEREIGN_CODING_MODEL=qwen2.5-coder:7b
SOVEREIGN_DOC_MODEL=qwen2.5-coder:7b
SOVEREIGN_EMBEDDING_MODEL=nomic-embed-text
# SOVEREIGN_VISION_MODEL=llava:7b     # uncomment after `ollama pull llava:7b`
SOVEREIGN_ARTIFACT_DIR=./artifacts
```

---

## The three checks

Run all three from `backend/services/agent`.

### 1. Boundary check — `node scripts/verifySovereign.js`

```
Cloud-only agents are refused:
  PASS  image refused (SOV-002)
  PASS  search refused (SOV-002)

Agents resolve to the local runtime:
  PASS  chat → http://127.0.0.1:11434/v1
  PASS  coding → http://127.0.0.1:11434/v1
  PASS  vision refused (SOV-006) — no cloud fallback
  PASS  pdf, ppt, pdf_rag, router → http://127.0.0.1:11434/v1

Embeddings stay local:
  PASS  embeddings → http://127.0.0.1:11434/v1

Audit chain:
  PASS  chain intact over 110 entries
```

`vision refused (SOV-006)` is a **pass**, not a gap. No vision model is
installed, so the mode refuses instead of handing an image to a model that
cannot see. Install one and it flips to a resolution:

```bash
ollama pull llava:7b            # ~4.7 GB
# then uncomment SOVEREIGN_VISION_MODEL in .env
```

### 2. Property tests — `npm test`

11 tests, no external dependencies (`node:test`). They assert the things a
security reviewer will ask about: sovereign content unreadable from a cloud
turn, sovereign reading down into cloud history, merged order, `sovereign_only`
unescapable by the client, and each fail-closed rule.

**These were mutation-tested.** Reintroducing the original bug — sovereign
writes landing in the cloud tier — fails the canary test; letting the client
override `sovereign_only` fails the policy test. A test that cannot fail is
decoration.

### 3. The demo that convinces people — no credentials at all

Blank every cloud key in the process, then run both zones:

```
cloud credentials still readable: none

SOVEREIGN turn:
  PASS  answered locally: OK

CLOUD turn, same process, no credentials:
  PASS  refused: Groq API key not found…
```

A sovereign turn answering with **zero cloud credentials present** is a stronger
statement than any diagram: there was nothing to authenticate with, so nothing
cloud could have been called.

> **A trap worth knowing.** `model.js` calls `dotenv.config()` on import, and
> dotenv *repopulates a deleted key* while leaving an existing one alone. So
> `delete process.env.GROQ_API_KEY` in a test silently comes back, while
> `process.env.GROQ_API_KEY = ""` sticks. The first version of this demo passed
> for the wrong reason because of exactly that. Operationally it means: to
> really disable a cloud provider, remove it from `.env` — do not rely on
> unsetting it in the shell.

### The strongest demo of all

Turn off Wi-Fi, then use the app in Sovereign Mode. It keeps working. Switch to
Cloud Mode and it stops. No instrumentation, no trust in my code — the network
is simply not there.

---

## Hardware reality on this machine

Unified memory is the constraint. Roughly, weights ≈ params × bytes-per-param
(Q4 ≈ 0.5, Q8 ≈ 1, FP16 ≈ 2), plus KV cache that grows with context length and
concurrency.

| Model size | Q4 weights | On 16 GB M1 Pro |
|---|---|---|
| 7–8B | 4–5 GB | comfortable, this is your development target |
| 13–14B | 8–9 GB | works, slower, little headroom |
| 32B | ~18 GB | no |
| 70B | ~40 GB | no |

**About Kimi K2:** it is a mixture-of-experts model of roughly a trillion total
parameters. MoE is the sizing trap — *active* parameters set the compute per
token, but *total* parameters set the memory you must hold. It needs a
multi-GPU server, not a laptop. That is fine: because the runtime is a URL, the
only thing that changes when you move to that server is `SOVEREIGN_BASE_URL`.
Develop against `qwen2.5-coder:7b` here, deploy against whatever the customer's
hardware can hold.

Good intermediate targets if you get a GPU box: Qwen 2.5 32B/72B, Llama 3.3 70B,
DeepSeek-V3 (MoE), Mistral Large.

---

## Moving beyond Ollama

Ollama is a development runtime — convenient, single-user. For a real
deployment use **vLLM** or **SGLang**: continuous batching, paged KV cache,
tensor parallelism across GPUs. Both expose the same OpenAI-shaped API.

```bash
# vLLM, OpenAI-compatible server
vllm serve Qwen/Qwen2.5-32B-Instruct \
  --port 8000 --tensor-parallel-size 2 --max-model-len 32768

# then the only application change:
SOVEREIGN_BASE_URL=http://gpu-host:8000/v1
SOVEREIGN_MODEL=Qwen/Qwen2.5-32B-Instruct
```

Nothing else moves. That portability is worth saying out loud in a proposal —
it means the buyer is not betting on your choice of inference stack.

---

## Checking egress -- `npm run verify:egress`

Prints every destination this configuration would use, split by zone, then tries
to open a TCP connection to each cloud provider this codebase could otherwise
reach. On a laptop everything is reachable and it says so; on a sealed host
nothing is, and that is the result worth showing someone.

It reports rather than fails on reachable internet, deliberately: a check that
always fails on a developer machine is a check people learn to ignore. It exits
non-zero only when a *sovereign* destination points off-host, which is a real
misconfiguration.

The stronger version is `deploy/sovereign/verify-containment.sh`, which asks the
same question from outside the application, inside the compose stack, where the
agent is on a network Docker creates with no gateway. Prefer it when the
deployment uses containers; `verify:egress` exists for an install onto a bare VM
where there is no container to exec into.

## Pinning the weights

`verify:egress` and `verify:sovereign` both report the digest of each local model.
Once you know it, pin it:

```bash
# read what the runtime is serving
curl -s http://127.0.0.1:11434/api/tags | jq -r '.models[] | "\(.name)=\(.digest[0:16])"'

# then in .env
SOVEREIGN_MODEL_DIGESTS="qwen2.5-coder:7b=dae161e27b0e90dd"
```

Unpinned, the digest is recorded in the audit log and a substitution is visible
afterwards. Pinned, a substituted model is refused (SOV-008) before it answers.

## Artefact retention

Sovereign artefacts are written to `SOVEREIGN_ARTIFACT_DIR` with mode `0600` in a
`0700` directory, under a 64-hex-character random name. The name is the
credential: a browser follows a download link and cannot attach the internal
identity header, which is the same bargain a presigned S3 URL makes.

`SOVEREIGN_ARTIFACT_TTL_HOURS` (default 24, matching the cloud presigned window)
bounds how long that link lives. Expiry is enforced both on read -- so a sweep
that has not run yet cannot become an artefact that outlives its window -- and by
a sweeper every 15 minutes, which writes an `EXPIRE` entry into the same audit
chain as the write. Files the sweeper has no metadata for are left alone; it runs
unattended, and deleting what it cannot account for is the more destructive
guess.

## Still to do before this is a government-grade claim

1. **Admin UI for `sovereignPolicy`.** The field and enforcement exist; setting
   it is a database edit today.
2. **Local search and image generation.** `image` and `search` are refused under
   SOV-002 rather than served, because both are third-party API calls. A local
   SearxNG and a local diffusion model would close the gap; until then Sovereign
   Mode is deliberately a smaller product than Cloud Mode.
3. **Sovereign Qdrant is optional.** With `SOVEREIGN_QDRANT_URL` unset, vectors
   live in-process and do not survive a restart. Nothing leaks either way -- the
   fallback is a `MemoryVectorStore`, not the cloud cluster -- but PDF chat
   re-indexes after every restart until an in-boundary Qdrant is configured.
