import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// The on-premises databases are the gateway's settings, not the agent's, so a
// script run from the agent would report them as unconfigured and tell a
// reviewer the boundary was leakier than it is. Loaded without override so the
// agent's own values still win where both define one.
dotenv.config({
  path: path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..", "..", "..", "app", ".env"
  ),
  override: false
});

import net from "net";
import dns from "dns/promises";

import { SOVEREIGN_BASE_URL } from "../utils/sovereign.js";

// The claim Sovereign Mode makes is "nothing about this conversation leaves the
// boundary". No amount of reading the source establishes that, because the
// boundary is a property of the network the service runs on, not of the code:
// one dependency with a telemetry callback, one misconfigured variable, one
// fallback path, and the code is blameless while the data is in Ireland.
//
// So this script does two separate things, and the second is the one that
// matters:
//
//   1. Reports which destinations this configuration would use, per zone.
//   2. Tries to reach the open internet, and says whether it could.
//
// On a correctly sealed host, step 2 fails everywhere. A run where everything
// is reachable is not a failing grade for the code -- it is an accurate
// statement that this host is not sealed, which is exactly what a reviewer
// needs to be told.
//
// deploy/sovereign/verify-containment.sh asks a stronger version of the same
// question from outside the application, and should be preferred where the
// deployment uses the compose stack. This script exists for the case that one
// cannot cover: an install onto a bare VM or an existing host, with no Docker
// to exec into, which is how these deployments often actually arrive.

let findings = 0;

const ok    = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad   = (m) => { findings++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };
const warn  = (m) => console.log(`  \x1b[33mWARN\x1b[0m  ${m}`);
const note  = (m) => console.log(`        ${m}`);

const hostPort = (value, defaultPort) => {

  const raw = String(value || "").trim();

  if (!raw) return null;

  try {
    const url = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
    return {
      host: url.hostname,
      port: Number(url.port) || defaultPort
    };
  } catch {
    return null;
  }

};

const isLocal = (host) =>
  ["127.0.0.1", "localhost", "::1", "0.0.0.0"].includes(host) ||
  host.endsWith(".localhost") ||
  host.endsWith(".internal") ||
  // RFC1918 and link-local. A private address is inside somebody's boundary,
  // which is a different claim from "inside this host" but still not the
  // internet.
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
  /^169\.254\./.test(host);

/** A TCP handshake and nothing more -- no request is sent, no data leaves. */
const reachable = (host, port, timeout = 4000) =>
  new Promise((resolve) => {

    const started = Date.now();
    const socket = new net.Socket();

    const done = (result) => {
      socket.destroy();
      resolve({ ...result, ms: Date.now() - started });
    };

    socket.setTimeout(timeout);
    socket.once("connect", () => done({ open: true }));
    socket.once("timeout", () => done({ open: false, reason: "timed out" }));
    socket.once("error", (error) => done({ open: false, reason: error.code || error.message }));

    socket.connect(port, host);

  });

// ── 1. What this configuration is pointed at ────────────────────────────────

const DESTINATIONS = [
  { name: "local model runtime", value: SOVEREIGN_BASE_URL,                    port: 443, zone: "sovereign" },
  { name: "sovereign Mongo",     value: process.env.SOVEREIGN_MONGODB_URL,     port: 27017, zone: "sovereign",
    absent: "conversations are not persisted in-boundary; sovereign turns live for the session only" },
  { name: "sovereign Qdrant",    value: process.env.SOVEREIGN_QDRANT_URL,      port: 6333, zone: "sovereign" },
  { name: "cloud Mongo",         value: process.env.MONGODB_URL,               port: 27017, zone: "cloud" },
  { name: "cloud Qdrant",        value: process.env.QDRANT_URL,                port: 443, zone: "cloud" },
  { name: "Redis",               value: process.env.REDIS_URL || "127.0.0.1:6379", port: 6379, zone: "both" }
];

console.log("\nEgress check\n");
console.log("Configured destinations:");

for (const dest of DESTINATIONS) {

  const target = hostPort(dest.value, dest.port);

  if (!target) {
    note(`\x1b[90m—     ${dest.name}: not configured\x1b[0m`);
    if (dest.absent) note(`\x1b[90m      ${dest.absent}\x1b[0m`);
    continue;
  }

  const local = isLocal(target.host);

  if (dest.zone === "sovereign" && !local) {
    bad(`${dest.name} is a sovereign destination but points off-host: ${target.host}`);
    continue;
  }

  console.log(
    `  ${local ? "\x1b[32mLOCAL \x1b[0m" : "\x1b[33mREMOTE\x1b[0m"}  ${dest.name.padEnd(22)} ${target.host}:${target.port}  [${dest.zone}]`
  );

}

// ── 2. Where sovereign vectors actually go ──────────────────────────────────

console.log("\nSovereign vector storage:");
{
  const configured = (process.env.SOVEREIGN_QDRANT_URL || "").trim();

  if (!configured) {
    // Not a gap: with no in-boundary Qdrant the store falls back to an
    // in-process index, which cannot leave by construction. Worth printing
    // because the alternative -- quietly reusing QDRANT_URL -- would send
    // document chunks to a hosted cluster, and the difference is invisible
    // from the outside.
    ok("no sovereign Qdrant configured → vectors stay in-process (MemoryVectorStore)");
    note("chunks are never written to the cloud cluster; they are also not persisted between restarts");
  } else {
    const target = hostPort(configured, 6333);
    isLocal(target?.host)
      ? ok(`sovereign Qdrant is in-boundary: ${target.host}:${target.port}`)
      : bad(`SOVEREIGN_QDRANT_URL points off-host: ${target?.host}`);
  }

  const cloud = hostPort(process.env.QDRANT_URL, 443);

  if (cloud && !isLocal(cloud.host)) {
    note(`\x1b[90mfor contrast, cloud-zone vectors go to ${cloud.host}\x1b[0m`);
  }
}

// ── 3. Can this host reach the open internet at all? ────────────────────────

// Chosen because these are the destinations this codebase would use if a
// sovereign turn ever fell back to a hosted provider. Reaching them proves the
// host is not sealed; failing to reach them is the evidence a reviewer wants.
const CANARIES = [
  { host: "api.groq.com",         port: 443, why: "cloud chat provider" },
  { host: "api.deepseek.com",     port: 443, why: "cloud coding/vision provider" },
  { host: "generativelanguage.googleapis.com", port: 443, why: "Gemini fallback" },
  { host: "api.tavily.com",       port: 443, why: "web search" },
  { host: "s3.amazonaws.com",     port: 443, why: "artefact upload" },
  { host: "1.1.1.1",              port: 443, why: "bare IP, no DNS needed" }
];

console.log("\nCan this host reach the open internet?");

const results = await Promise.all(
  CANARIES.map(async (canary) => ({
    ...canary,
    ...(await reachable(canary.host, canary.port))
  }))
);

for (const result of results) {

  result.open
    ? warn(`REACHABLE  ${result.host}:${result.port} in ${result.ms}ms  (${result.why})`)
    : ok(`blocked    ${result.host}:${result.port} — ${result.reason}  (${result.why})`);

}

const openCount = results.filter((r) => r.open).length;

// DNS separately: a host can have egress blocked at the firewall and still
// resolve names, and a reviewer reading a "blocked" line should know which of
// the two they are looking at.
console.log("\nName resolution:");
try {
  const addresses = await dns.resolve4("api.groq.com");
  note(`DNS resolves external names (api.groq.com → ${addresses[0]})`);
} catch (error) {
  ok(`DNS does not resolve external names — ${error.code}`);
}

// ── 4. What this run does and does not establish ────────────────────────────

console.log("\nConclusion:");

if (findings) {

  console.log(
    `  \x1b[31m${findings} configuration finding(s): a sovereign destination points outside the boundary.\x1b[0m`
  );

} else if (openCount === 0) {

  console.log("  \x1b[32mThis host could not open a connection to any external destination.\x1b[0m");
  note("That is the strong result: even a bug or a dependency's telemetry has nowhere to go.");

} else {

  console.log(
    `  \x1b[33mConfiguration is in-boundary, but this host reached ${openCount} of ${results.length} external destinations.\x1b[0m`
  );
  note("So the guarantee currently rests on the code being correct, rather than on the");
  note("network making a mistake impossible. To remove that reliance, deploy with");
  note("deploy/sovereign/docker-compose.yml, which puts the agent on a network Docker");
  note("creates with no gateway, and verify it with deploy/sovereign/verify-containment.sh.");

}

console.log(
  "\n  What this run establishes: the destinations in this configuration, and whether"
);
console.log(
  "  this host had egress at the moment the script ran. It is not a permanent"
);
console.log(
  "  property -- re-run it from inside the deployed container, not from a laptop.\n"
);

// Exits non-zero only for a misconfigured destination. Reachable internet is
// reported, not failed: on a developer machine it is expected, and a check that
// always fails there is a check people learn to ignore.
process.exit(findings ? 1 : 0);
