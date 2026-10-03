// CODE-001, enforced at the socket rather than at the endpoint.
//
// Step 1 checked the one URL cldx code intends to call. That is the floor: it
// says nothing about a dependency that opens a connection of its own, an
// update check someone adds later, or a crash reporter pulled in three
// packages deep. None of those go through the endpoint check, and all of them
// are how a product that is sovereign in design stops being sovereign in fact.
//
// So the guard sits under everything: net.Socket.prototype.connect is the
// single funnel every outbound TCP connection in Node passes through,
// including the one Node's built-in fetch uses. Patching there means a
// connection cannot be opened without this file having seen it -- which is a
// much stronger statement than "we reviewed the call sites".

import net from "node:net";
import tls from "node:tls";
import { PolicyDenied } from "./policy.js";

const LOOPBACK_NAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

const attempts = [];

let armed = false;
let allowHosts = new Set();
let originalConnect = null;
let originalTlsConnect = null;

const isLoopbackHost = (host) => {

  if (!host) return true;                       // no host means a local path or default bind

  const bare = String(host).replace(/^\[|\]$/g, "").toLowerCase();

  if (LOOPBACK_NAMES.has(bare)) return true;

  // *.localhost is reserved for loopback by RFC 6761.
  if (bare.endsWith(".localhost")) return true;

  if (net.isIPv4(bare)) return bare.startsWith("127.");

  if (net.isIPv6(bare)) return bare === "::1" || bare.startsWith("::ffff:127.");

  return false;

};

/**
 * Normalises the shapes of Socket.prototype.connect:
 *   connect(options[, listener])
 *   connect(port[, host][, listener])
 *   connect(path[, listener])
 *   connect([options, listener])        <-- see below
 *
 * The fourth is the one that matters and is not in the documentation. Node's
 * own net.connect() runs its arguments through normalizeArgs() and then calls
 * this method with the *result array* as a single argument, and Node's built-in
 * fetch goes through that path. Reading `args[0].host` off that array yields
 * undefined, which defaults to localhost and allows every connection in the
 * process -- a guard that reports "armed" while permitting everything, which is
 * worse than no guard at all. Unwrapped first, and locked down by a test that
 * drives a real fetch rather than calling this function directly.
 */
const describeTarget = (args) => {

  const [first, second] = Array.isArray(args[0]) ? args[0] : args;

  if (typeof first === "object" && first !== null) {

    // A unix domain socket or Windows named pipe cannot leave the machine, and
    // the VS Code transport in step 7 is exactly that.
    if (first.path) return { kind: "ipc", host: null, port: null };

    return { kind: "tcp", host: first.host ?? "localhost", port: first.port ?? null };

  }

  if (typeof first === "string") return { kind: "ipc", host: null, port: null };

  return {
    kind: "tcp",
    host: typeof second === "string" ? second : "localhost",
    port: first ?? null
  };

};

const record = (target, allowed) => {

  attempts.push({
    at: Date.now(),
    host: target.host,
    port: target.port,
    kind: target.kind,
    allowed
  });

  return allowed;

};

const check = (target) => {

  if (target.kind === "ipc") return record(target, true);

  if (isLoopbackHost(target.host)) return record(target, true);

  if (allowHosts.has(String(target.host).toLowerCase())) return record(target, true);

  record(target, false);

  throw new PolicyDenied(
    `Blocked a connection to ${target.host}:${target.port ?? "?"} from inside a Sovereign Mode session. Nothing in this session may leave the machine.`,
    "CODE-001"
  );

};

/**
 * Arms the guard for the rest of the process.
 *
 * Called as early as possible in startup, before discovery -- the probe loop is
 * itself network activity and there is no reason it should be exempt from the
 * rule it exists to uphold.
 *
 * @param {object}   options
 * @param {boolean}  options.sovereign  a cloud session is not subject to this
 * @param {string[]} options.allow      hosts an administrator has accepted
 */
export const armEgressGuard = ({ sovereign, allow = [] }) => {

  if (!sovereign || armed) return false;

  allowHosts = new Set(allow.map((host) => String(host).toLowerCase()));

  originalConnect = net.Socket.prototype.connect;
  originalTlsConnect = tls.connect;

  net.Socket.prototype.connect = function guardedConnect(...args) {
    check(describeTarget(args));
    return originalConnect.apply(this, args);
  };

  // tls.connect can be handed a socket that is already open, in which case the
  // TCP connect above never runs for it. Checked separately rather than
  // assumed to be covered.
  tls.connect = function guardedTlsConnect(...args) {
    check(describeTarget(args));
    return originalTlsConnect.apply(this, args);
  };

  armed = true;

  return true;

};

// Only for tests -- a session never disarms. A guard with a documented
// off switch invites a caller to use it.
export const releaseEgressGuard = () => {

  if (!armed) return;

  net.Socket.prototype.connect = originalConnect;
  tls.connect = originalTlsConnect;

  armed = false;
  allowHosts = new Set();

};

export const isArmed = () => armed;

export const egressLog = () => attempts.slice();

/**
 * Node's fetch wraps whatever the connector threw in a TypeError, so a refusal
 * surfaces as a generic "fetch failed" with the real cause one or more levels
 * down. Without this, CODE-001 arrives at the user disguised as CODE-002 -- a
 * blocked exfiltration attempt reported as "your local model is down", which is
 * the most misleading error this program could possibly produce.
 */
export const policyDenialWithin = (error) => {

  let current = error;

  for (let depth = 0; current && depth < 5; depth += 1) {

    if (current.isPolicyDenial) return current;

    current = current.cause;

  }

  return null;

};
