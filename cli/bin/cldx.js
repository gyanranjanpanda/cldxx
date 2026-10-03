#!/usr/bin/env node

// `cldx code` -- the one command.
//
// Everything the session needs is resolved by probing, in the order set out in
// CLDX-CODE.md Part 0. No API key prompt, no model picker, no configuration
// file the developer has to author first. Every probe that fails ends in a
// sentence naming the single next thing to do.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../src/config.js";
import { armEgressGuard, egressLog } from "../src/egress.js";
import { discoverRuntime } from "../src/discovery.js";
import { PolicyDenied } from "../src/policy.js";
import { runOnce, runSession } from "../src/session.js";
import { policyError } from "../src/ui.js";
import { ensureCldxDir, findRoot } from "../src/workspace.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `
cldx code -- sovereign coding assistant

  cldx code                    start a session in the current repository
  cldx code -p "<prompt>"      one prompt, one answer, then exit
  cldx code --doctor           show what discovery found and stop

Options
  --cloud              run this session in Cloud Mode (refused for
                       repositories classified restricted or above)
  --model <name>       use a specific model instead of the chosen default
  --base-url <url>     use a specific runtime instead of discovering one
  --reprobe            ignore .cldx/runtime.json and probe again
  -p, --print <text>   non-interactive single turn
  -h, --help           this
  -v, --version        version
`;

const parseArgs = (argv) => {

  const flags = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {

    const argument = argv[index];

    switch (argument) {
      case "--cloud":      flags.cloud = true; break;
      case "--reprobe":    flags.reprobe = true; break;
      case "--doctor":     flags.doctor = true; break;
      case "-h":
      case "--help":       flags.help = true; break;
      case "-v":
      case "--version":    flags.version = true; break;
      case "--model":      flags.model = argv[++index]; break;
      case "--base-url":   flags.baseUrl = argv[++index]; break;
      case "-p":
      case "--print":      flags.print = argv[++index]; break;
      default:             positional.push(argument);
    }

  }

  return { flags, positional };

};

const version = async () => {

  const manifest = JSON.parse(
    await fs.readFile(path.join(here, "..", "package.json"), "utf8")
  );

  return manifest.version;

};

const main = async () => {

  const { flags, positional } = parseArgs(process.argv.slice(2));

  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (flags.version) {
    process.stdout.write(`${await version()}\n`);
    return;
  }

  // `cldx` on its own is the same as `cldx code`. The subcommand exists so the
  // name reads right in documentation and so later subcommands have somewhere
  // to go, not to make anyone type it.
  if (positional[0] && positional[0] !== "code") {
    process.stderr.write(`cldx: unknown command "${positional[0]}"\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  // 0.1 workspace, 0.2 config
  const root = await findRoot();
  const config = await loadConfig(root, {
    model: flags.model,
    baseUrl: flags.baseUrl
  });

  // 0.3 zone. Resolved before anything is written or probed -- a classification
  // refusal should cost nothing and touch nothing.
  const { resolveZone } = await import("../src/zone.js");
  const zone = resolveZone(config, flags);

  await ensureCldxDir(root);

  // Armed before discovery, not after. The probe loop is itself network
  // activity, and an exemption carved out for "our own" traffic is the first
  // thing that grows.
  armEgressGuard({
    sovereign: zone.sovereign,
    allow: config.allowHosts || []
  });

  // 0.4 runtime discovery
  const runtime = await discoverRuntime(root, config, {
    sovereign: zone.sovereign,
    reprobe: flags.reprobe
  });

  const context = {
    root,
    zone,
    baseUrl: runtime.baseUrl,
    runtime: runtime.runtime,
    models: runtime.models,
    model: runtime.model,
    cached: runtime.cached,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    version: await version()
  };

  if (flags.doctor) {
    process.stdout.write(JSON.stringify(
      {
        ...context,
        zone: { ...zone },
        egressGuard: zone.sovereign ? "armed" : "not armed (cloud session)",
        connections: egressLog()
      },
      null,
      2
    ) + "\n");
    return;
  }

  if (flags.print) {
    await runOnce(context, flags.print);
    return;
  }

  // Steps 0.5 (capability probe), 0.6 (context budget) and 0.8 (VS Code
  // attach) are the next branches. Until they exist the session is
  // conversation only, which the system prompt states outright rather than
  // letting the model improvise about files it cannot read.
  await runSession(context);

};

try {
  await main();
} catch (error) {

  if (error instanceof PolicyDenied || error?.isPolicyDenial) {
    process.stderr.write(policyError(error));
    process.exitCode = 1;
  } else {
    throw error;
  }

}
