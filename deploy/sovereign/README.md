# Sovereign deployment

The boundary here is the network, not the application. Everything runs on a
Docker network created with `internal: true`, which has no gateway: those
containers have no route off the host at all. A bug in application code cannot
exfiltrate, because the process has nowhere to send it.

That is the claim that survives a security review. An `if` statement in
JavaScript is not, which is why this layer exists on top of the policy engine
rather than instead of it.

```
                      ┌──────────────────────────────────────┐
   host :8080 ───────▶│ web (nginx)                          │
                      │                                      │
                      │  app ── agent ── ollama              │  network: internal
                      │   │       │                          │  (no gateway,
                      │  mongo  qdrant  redis                │   no route out)
                      └───────────────┬──────────────────────┘
                                      │
                              ┌───────▼────────┐
                              │ egress-proxy   │  the only dual-homed container
                              │ DEFAULT DENY   │
                              │ allowlist      │
                              │ logs every req │
                              └───────┬────────┘
                                      │  network: egress
                                      ▼
                                  internet
```

## Run it

```bash
cp .env.example .env          # set INTERNAL_API_KEY
docker compose up -d

docker compose exec ollama ollama pull llama3.1
docker compose exec ollama ollama pull nomic-embed-text
docker compose exec ollama ollama pull qwen2.5-coder
```

Open `http://localhost:8080`. That is the only port published to the host.

## Prove it

```bash
./verify-containment.sh
```

Every check runs inside a container against real destinations using the
container's own network stack. Nothing trusts application code. Run this in
front of the security team — the interesting result is not that sovereign turns
reach the local model, it is that the containers cannot reach the internet even
when they try.

For an independent measurement, watch the host while you use the app:

```bash
sudo tcpdump -i any -n 'not net 172.16.0.0/12 and not port 22'
```

## Air-gapped install

Delete the `egress` network, the `egress-proxy` service, and the `*_PROXY`
variables. Leave `allowlist.txt` empty.

Nothing else changes. **If the stack stops working when you do that, the
deployment was never sovereign** — that is the test, and it is worth running
before anyone claims the word in front of a customer.

## What each piece is for

| File | Role |
|---|---|
| `docker-compose.yml` | The topology. `internal: true` is the whole boundary. |
| `squid/squid.conf` | Egress enforcement. Deny by default, CONNECT limited to 443. |
| `squid/allowlist.txt` | The only destinations a connected install may reach. |
| `nginx.conf` | Serves the UI and sets a CSP that forbids client-side egress. |
| `verify-containment.sh` | Proves the above from outside the application. |

## Two things that are easy to get wrong

**The browser is outside the boundary.** The UI renders on a workstation, so any
CDN font or remote script it loads is egress your proxy never sees. The CSP in
`nginx.conf` (`default-src 'self'`) is what stops that, and it is why the PDF
renderer now inlines its fonts, Prism and Mermaid from `node_modules` instead of
fetching them.

**MCP servers are separate processes with their own network stacks.** Any MCP
server added to this stack must go on `internal` with no exception, and a tool
that genuinely needs the outside world has to be marked as such and refused in
sovereign contexts. An MCP server given a route out is a straight line around
everything on this page.
