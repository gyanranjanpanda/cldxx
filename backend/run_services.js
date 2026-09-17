import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeBin = process.execPath;

const services = [
  { name: "App",   cwd: path.join(__dirname, "app"), script: "index.js", port: 8000 },
  { name: "Agent", cwd: path.join(__dirname, "services/agent"), script: "index.js", port: 8003 }
];

import net from "net";

// A child whose port is already taken dies without ever logging, and the old
// process keeps serving stale code -- which looks exactly like "my fix did
// nothing". Refuse to start instead of leaving that trap.
const portInUse = (port) =>
  new Promise((resolve) => {
    const probe = net
      .createServer()
      .once("error", (err) => resolve(err.code === "EADDRINUSE"))
      .once("listening", () => probe.close(() => resolve(false)))
      .listen(port, "0.0.0.0");
  });

const busy = [];
for (const svc of services) {
  if (await portInUse(svc.port)) busy.push(svc);
}

if (busy.length) {
  for (const svc of busy) {
    console.error(`\u274c Port ${svc.port} (${svc.name}) is already in use.`);
  }
  console.error(
    `\nStop them first:  lsof -ti:${services.map((s) => s.port).join(",")} | xargs kill -9`
  );
  process.exit(1);
}

console.log("🚀 Starting CLDX (app + agent)...");

const children = [];

for (const svc of services) {
  console.log(`[${svc.name}] Spawning on port ${svc.port}...`);
  const child = spawn(nodeBin, ["--watch", svc.script], {
    cwd: svc.cwd,
    env: { ...process.env, PORT: String(svc.port) },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (d) => {
    process.stdout.write(`[${svc.name}] ${d}`);
  });

  child.stderr.on("data", (d) => {
    process.stderr.write(`[${svc.name} ERR] ${d}`);
  });

  child.on("error", (err) => {
    console.error(`❌ [${svc.name}] Failed to start:`, err.message);
  });

  child.on("exit", (code, signal) => {
    console.log(`⚠️ [${svc.name}] Exited with code ${code} (signal: ${signal})`);
  });

  children.push(child);
}

const cleanup = () => {
  console.log("\n🛑 Stopping all services...");
  for (const child of children) {
    try {
      child.kill("SIGINT");
    } catch (e) {}
  }
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
