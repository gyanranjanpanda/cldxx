# cldx code

A coding assistant that runs against a model on your own hardware. No prompt,
no file, and no diff from your repository reaches a cloud provider.

This is **step 1 of 9** from [`../CLDX-CODE.md`](../CLDX-CODE.md): the command,
the zone decision, runtime discovery, and a streaming conversation. It cannot
read or edit files yet — that is `feat/cldx-code-file-tools`, which lands after
the egress interceptor and the capability probe.

## Install

```bash
npm i -g @cldx/code
```

No runtime dependencies. That is deliberate: this has to install on an
air-gapped workstation from a mirror or a USB stick, and every dependency is one
more thing to vendor and one more thing that could open a socket of its own.

## Use

```bash
cd your-repo
cldx code
```

That is the whole setup. It finds whichever local runtime is already listening,
picks a coding model from what that runtime serves, and starts.

```
cldx code 0.1.0   * Sovereign | qwen2.5-coder:7b | Ollama
  /Users/you/your-repo
  zone: default zone is sovereign
```

| | |
|---|---|
| `cldx code -p "..."` | one prompt, one answer, then exit — pipes cleanly |
| `cldx code --doctor` | show what discovery found, as JSON, and stop |
| `cldx code --reprobe` | ignore the cached runtime and probe again |
| `cldx code --model <name>` | override the chosen model |
| `cldx code --base-url <url>` | skip discovery and use a specific runtime |
| `cldx code --cloud` | run this session in Cloud Mode |

In-session: `/model`, `/models`, `/zone`, `/clear`, `/help`, `/exit`. `ctrl-c`
interrupts the answer being streamed; again at an empty prompt exits.

## What it refuses to do

| Rule | Fires when |
|---|---|
| `SOV-001` | nothing is listening locally, or the runtime serves no chat model |
| `CODE-001` | the endpoint resolves anywhere but this machine |
| `CODE-002` | the local runtime is unreachable — the turn dies, it does not fall back |
| `CODE-006` | `--cloud` in a repository classified `restricted` or above |

`CODE-002` is the one worth understanding. A local runtime being down is not a
reason to answer from somewhere else: that fallback fires during an outage, when
nobody is reading logs, and the first anyone knows of it is that proprietary
source reached a vendor.

`CODE-001` is currently enforced at the model endpoint only. The full guarantee —
every socket the process opens, including ones a dependency opens on its own —
is the interceptor on `feat/cldx-code-egress-guard`, which is step 2 precisely
because egress control retrofitted onto a working agent never finishes.

## Configuration

Resolved highest precedence first:

1. command line flags
2. `<repo>/.cldx/config.json` — committed, travels with the code
3. `~/.cldx/config.json`
4. environment (`SOVEREIGN_BASE_URL`, `SOVEREIGN_CODING_MODEL`, `SOVEREIGN_MODEL`, `SOVEREIGN_API_KEY`)
5. defaults

The repository outranks the developer deliberately. Classification is a property
of the code, not a preference of whoever is reading it.

```json
// .cldx/config.json — commit this
{ "classification": "restricted" }
```

`.cldx/` is added to `.gitignore` on first run. Session state contains source;
committing it into the repository being protected would be a self-inflicted
version of the leak this exists to prevent.

## Tests

```bash
npm test
```

Twelve assertions, all of them about refusals and defaults. They need no network
and no running model.
