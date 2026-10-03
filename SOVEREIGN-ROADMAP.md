# Making Sovereign Mode credible for government and regulated buyers

The design is already better than most attempts at this. What separates it from a
product a government security team will actually sign off on is not more features —
it is **moving enforcement down the stack** and **producing evidence**.

---

## The one idea everything else follows from

Today the boundary is a branch in application code:

```js
if (sovereign) { /* local */ }   // ← enforcement lives here
```

A reviewer's first question is always the same: *"What happens when someone adds a
`fetch()` on a new code path next sprint?"* Today the answer is "the prompt leaves."

The upgrade is **defence in depth** — the same rule stated at three levels, so no
single mistake is a breach:

| Level | Mechanism | What it survives |
|---|---|---|
| **Application** | `getModel()` policy gate (built) | ordinary bugs |
| **Process** | egress-denied network namespace | a new code path nobody reviewed |
| **Network** | deny-by-default firewall + allowlist | a compromised dependency |

Application logic is a *policy*. Egress control is *enforcement*. Buyers in this
segment know the difference, and it is the difference between "we route locally" and
"the packet cannot leave."

---

## P0 — Disqualifying today

### 1. The client chooses its own classification

`agent.controller.js` reads `sovereign` from the request body. A user, a stale
frontend, or anyone with a browser console can send `sovereign: false` and route
confidential work to Groq. **The control is enforced by the thing being controlled.**

That is a finding, not a feature gap. Fix:

```
effective_sovereign = org_policy(user)  ||  user_request.sovereign
```

Three policy modes an admin sets server-side, per org / group / workspace:

| Mode | Meaning |
|---|---|
| `sovereign_only` | Every turn is local. The toggle is not shown. |
| `sovereign_default` | Local unless the user explicitly opts out, and the opt-out is audited. |
| `user_choice` | Today's behaviour — fine for individuals, never for a ministry. |

The server must compute this from the user's record, not trust the flag. Keep the
request flag as a *request*, not a decision.

Better still, attach classification to the **workspace or conversation**, not the
turn. "This project is restricted" is how the buyer already thinks, and it removes
the failure mode where one turn in a confidential thread is accidentally cloud.

### 2. No egress control

Run the sovereign path in a container or network namespace whose default route is
dropped, with an allowlist containing exactly: the local model endpoint, the local
embedder, Qdrant, Redis, Mongo. Nothing else resolves.

This single change:
- makes the "no data egress" claim in your diagram *true* rather than aspirational
- lets you honestly say **egress-denied by default** instead of misusing "air-gapped"
- turns SOV-001/002/003/004 from promises into a second line of defence

Then prove it in CI: a test that asserts a sovereign-mode container cannot open a
socket to a public address. That test is worth more in a procurement conversation
than any architecture diagram.

### 3. MCP is an open door in sovereign turns

`grep sovereign backend/services/agent/utils/mcp/*.js` returns nothing, and
`chat.agent.js` calls `runWithMcpTools` regardless of zone. A sovereign turn with an
`http` MCP server sends tool arguments to that server.

Rule: **in Sovereign Mode, `stdio` transports only; remote servers are filtered out
with a visible note.** Same shape as `CLOUD_ONLY_AGENTS` — and note that even a local
MCP server can make network calls of its own, which is another reason the egress
control in §2 is the real fix.

### 4. Memory and history still write down

Covered in `SOVEREIGN-MODE.md`: one Redis key for both zones, and `/save-message`
gated on incognito but not sovereign. Until that lands, a sovereign turn becomes
cloud prompt context on the next message.

### 5. There is no evidence

Zero tests in the repo. For this buyer, **the test suite is the product**. The minimum
set that changes conversations:

- **Canary test** — write a sovereign turn, read as cloud, assert the canary string is absent.
- **Egress test** — assert the sovereign container cannot reach a public IP.
- **Fail-closed test** — unset `SOVEREIGN_BASE_URL`, assert refusal and no cloud call.
- **Capability test** — see §8.

`scripts/verifySovereign.js` is the right seed; it just needs to run in CI and cover
data paths, not only model selection.

---

## P1 — Enterprise table stakes

**Identity.** OIDC/SAML SSO, SCIM provisioning, RBAC. No government pilot survives
"create a local account."

**Customer-held keys.** `secretBox.js` derives from `MCP_SECRET`, falling back to
`INTERNAL_API_KEY`. For this audience, key material belongs in *their* KMS/HSM, and
rotation must be a documented operation. It also buys you **crypto-shredding**:
destroy the key and the data is unreadable — the cleanest answer to a deletion
mandate.

**Audit that survives an insider.** Hash-chaining detects edits but not deletion of
the whole file. Two additions: ship entries to their SIEM (syslog/OTel) as they are
written, and periodically **anchor the chain head** somewhere the app cannot rewrite.
Then "tamper-evident" is defensible.

**Offline install.** A signed bundle — container images, model weights, checksums —
that installs with no internet, no phone-home, no license server. Sign images
(cosign), ship an SBOM. If your installer needs to reach the internet, you are not a
sovereign product.

**Retention and erasure.** Configurable retention per classification, and a real
delete path across Redis, Mongo, Qdrant and the artifact directory.

---

## P2 — Running local models *properly*

This is the part that decides whether the product feels good or feels like a demo.

### Choose the serving stack deliberately

| Runtime | Use it for |
|---|---|
| **Ollama** | development, single-user desktop, small models. Convenient; not a multi-user server. |
| **vLLM / SGLang** | anything real — continuous batching, tensor parallelism, paged KV cache. This is what a 20-person team needs. |
| **llama.cpp** | CPU-only or Apple Silicon edge boxes. |

Your `SOVEREIGN_BASE_URL` design already supports all of them, which is a genuine
strength — lead with it. "Bring your own runtime" is the right posture.

### Size the hardware honestly

For any model, weights ≈ **params × bytes-per-param**, plus KV cache that grows with
context × concurrency. Rough bytes-per-param: FP16 = 2, FP8/INT8 = 1, INT4 ≈ 0.5.
Mixture-of-experts models (Kimi K2, DeepSeek-V3, Qwen MoE) are the trap: **total**
params set the memory you must hold, while **active** params set the compute per
token. A buyer who budgets for active params will not be able to load the model.

Publish a sizing table per supported model — "this model, this quantization, this
concurrency, this GPU count." Nobody else in the local-AI space does this well, and
it is the question every procurement asks first.

### Verify what you are running

Government buyers must know exactly which weights answered. Hash the model files at
startup, record the digest in the audit log alongside the model name, and refuse to
start if the digest changed unexpectedly. That turns "we run Kimi K2" into a
provable statement, and it closes a supply-chain question they will ask.

### A capability registry, and fail closed on mismatch

`localModelFor("vision")` returns `SOVEREIGN_VISION_MODEL || "llama3.1"`. **Llama 3.1
cannot see images.** A vision turn on default config today produces confident nonsense
rather than an error — worse than refusing, because the user believes it.

Declare what each configured model supports and check before routing:

```js
const CAPABILITIES = {
  vision:  ["llava", "qwen2-vl", "llama3.2-vision"],
  tools:   ["kimi-k2", "qwen2.5", "llama3.1", "mistral-nemo"],
  json:    [/* … */]
};
// then, in the same family as assertAgentAllowed:
assertModelCapable(agent, model);   // SOV-005
```

Refusing with *"the configured local model cannot read images — set
SOVEREIGN_VISION_MODEL to a vision model"* is a far better product than a wrong
answer. It is also the same fail-closed philosophy you already apply elsewhere, so it
fits the existing design rather than bolting on.

### Tool-calling varies wildly between open models

Your MCP loop assumes the model can emit structured tool calls. Some open models are
excellent at this (Kimi K2 is built for agentic work), many are poor, and chat
templates differ per family. Probe tool-calling at startup with a trivial known-answer
call, record the result, and degrade gracefully — bind fewer tools, or tell the user
this model cannot use them — instead of failing mid-conversation.

### Failover stays inside the boundary

Fail-closed is correct and you already do it. The better experience is a **second
local endpoint** — refuse only when every in-boundary option is gone. Never a cloud
fallback, for the reason your own comment gives: it fires during an outage when nobody
is watching.

---

## P3 — The moat

**Classification-aware everything.** The one-way memory bridge you designed is the
seed of a genuinely differentiated idea: a system where classification is a property
of the *data*, carried through retrieval, summaries, artifacts and exports. Most
"private AI" products stop at model routing. Bell–LaPadula applied to an AI workspace
is a story nobody else is telling.

**Proof artifacts.** A published threat model that names what you *don't* defend
against (a compromised host, a malicious operator, a user pasting secrets into a cloud
turn). Naming limits builds more trust than omitting them — every reviewer knows no
system is total, and the ones claiming otherwise get the hardest questions.

**The compliance path.** Ask early which regime the buyer answers to, because it
decides the roadmap. For India: DPDP Act 2023, CERT-In directions, MeitY/STQC
empanelment. Internationally: ISO 27001 and SOC 2 as the baseline, then the
sector-specific ones (FedRAMP/StateRAMP, IRAP, C5) depending on market. A third-party
penetration test with a published summary is usually the highest-leverage single
spend.

---

## Suggested order

1. Server-side policy (§1) — it is a security finding, not a feature
2. Canary + fail-closed tests (§5) — cheap, and they gate everything after
3. MCP stdio-only in sovereign (§3)
4. Memory tiering + Mongo gate (§4)
5. Capability registry, SOV-005 (§P2)
6. Egress-controlled container + CI egress test (§2)
7. Model digest in the audit log (§P2)
8. SSO, customer-held keys, offline bundle (§P1)

1–4 are weeks of work and close every claim your diagram currently overstates. 6 is
the one that changes the sales conversation, because it is the only item on this list
that a sceptical reviewer can verify without reading your source.
