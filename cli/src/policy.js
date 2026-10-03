// The refusals cldx code can issue, and why each one refuses instead of
// degrading.
//
// Deliberately the same shape as the agent service's PolicyDenied
// (backend/services/agent/utils/sovereign.js) -- a rule id an audit can
// reconstruct months later without retaining the prompt. The CLI cannot import
// that module (it ships as its own package, installable on a workstation that
// has no backend checkout), so the class is duplicated rather than shared. The
// duplication is the lesser evil: a CLI that depends on the server to know its
// own policy is a CLI that cannot run air-gapped.

import dns from "node:dns/promises";
import net from "node:net";

export class PolicyDenied extends Error {

  constructor(message, rule) {

    super(message);

    this.name = "PolicyDenied";
    this.rule = rule;
    this.isPolicyDenial = true;

  }

}

// ── CODE-001 — nothing leaves the host ─────────────────────────────────────
//
// Step 1 enforces this at the one place a sovereign session is allowed to
// speak: the model endpoint. The full guarantee -- every socket the process
// opens, including ones a future dependency opens on its own -- needs the
// interceptor on feat/cldx-code-egress-guard. This check is the floor, not the
// ceiling, and is written so that tightening it later does not change callers.

const isLoopbackAddress = (address) => {

  if (net.isIPv4(address)) return address.startsWith("127.");

  // ::1, and the v4-mapped form a dual-stack resolver hands back.
  if (net.isIPv6(address)) {
    return address === "::1" || address.startsWith("::ffff:127.");
  }

  return false;

};

/**
 * Resolves a host and refuses unless every address it answers with is
 * loopback.
 *
 * *Every* address, not the first: a name that resolves to both 127.0.0.1 and a
 * routable address would otherwise pass the check and then connect to whichever
 * the socket layer preferred. A hostname that can point off-box is not a
 * sovereign endpoint, however it happens to resolve on the day it is tested.
 */
export const assertLoopback = async (urlString, { sovereign }) => {

  if (!sovereign) return;

  let url;

  try {
    url = new URL(urlString);
  } catch {
    throw new PolicyDenied(
      `"${urlString}" is not a valid URL, so it cannot be verified as local.`,
      "CODE-001"
    );
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (isLoopbackAddress(host)) return;

  let addresses;

  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new PolicyDenied(
      `Sovereign Mode cannot verify that "${host}" is local -- it does not resolve. Refusing to send source code to an endpoint that cannot be checked.`,
      "CODE-001"
    );
  }

  const offBox = addresses
    .filter((entry) => !isLoopbackAddress(entry.address))
    .map((entry) => entry.address);

  if (offBox.length > 0) {
    throw new PolicyDenied(
      `Sovereign Mode refuses "${host}" -- it resolves to ${offBox.join(", ")}, which is not this machine. Source code would leave the host.`,
      "CODE-001"
    );
  }

};

// ── CODE-002 — no cloud fallback ───────────────────────────────────────────
//
// The local runtime being down is not a reason to answer from somewhere else.
// That fallback fires during an outage, which is exactly when nobody is reading
// logs, and the first anyone knows of it is that proprietary source reached a
// vendor. The turn dies instead.

export const localRuntimeUnreachable = (baseUrl, cause) =>
  new PolicyDenied(
    `The local model runtime at ${baseUrl} did not respond (${cause}). Refusing to fall back to a cloud model -- start the runtime and try again.`,
    "CODE-002"
  );

// ── CODE-006 — classification cannot be downgraded from the command line ───
//
// .cldx/config.json is committed, so the repo's classification travels with the
// code. A flag typed in a hurry must not be able to override it; otherwise the
// classification is advice rather than policy.

export const classificationForbidsCloud = (classification) =>
  new PolicyDenied(
    `This repository is classified "${classification}" in .cldx/config.json, so it cannot be opened in Cloud Mode. Remove the classification in a commit if that is genuinely intended.`,
    "CODE-006"
  );
