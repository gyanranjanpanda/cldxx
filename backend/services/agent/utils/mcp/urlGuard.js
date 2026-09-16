import dns from "node:dns/promises";
import net from "node:net";

// A "remote" MCP server is a URL the agent fetches from inside your network.
// Left unchecked that is a server-side request forgery primitive: point one at
// http://169.254.169.254/ and the agent reads cloud instance credentials, or at
// an internal admin port and the tool result hands back the response body.
//
// Self-hosted MCP servers genuinely do live on localhost, so this is a policy
// rather than a flat ban: private targets are fine on a single-operator dev
// box, and refused on a deployment serving other people.
export const privateUrlsAllowed = () =>
  process.env.MCP_ALLOW_PRIVATE_URLS === "true" ||
  (process.env.NODE_ENV !== "production" &&
   process.env.MCP_ALLOW_PRIVATE_URLS !== "false");

const ipv4Private = (ip) => {

  const [a, b] = ip.split(".").map(Number);

  return (
    a === 0   ||                          // this network
    a === 10  ||                          // RFC1918
    a === 127 ||                          // loopback
    (a === 169 && b === 254) ||           // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||  // RFC1918
    (a === 192 && b === 168) ||           // RFC1918
    (a === 100 && b >= 64 && b <= 127) || // carrier NAT
    a >= 224                              // multicast and reserved
  );

};

const ipv6Private = (ip) => {

  const address = ip.toLowerCase().split("%")[0];

  if (address === "::1" || address === "::") return true;

  // Unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/.test(address)) return true;
  if (/^fe[89ab]/.test(address)) return true;

  // ::ffff:127.0.0.1 and friends reach the same places as plain IPv4.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);

  return false;

};

export const isPrivateAddress = (ip) =>
  net.isIPv4(ip) ? ipv4Private(ip)
  : net.isIPv6(ip) ? ipv6Private(ip)
  : false;

// Hostnames that resolve to private space without looking like an IP.
const LOCAL_NAMES = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

/**
 * Resolves the host and refuses private targets when policy says so.
 *
 * Deliberately called at connect time rather than only when the server is
 * saved: a hostname that answered publicly during validation can point at
 * 127.0.0.1 by the time it is used, which is the whole DNS-rebinding trick.
 */
export const assertUrlAllowed = async (rawUrl) => {

  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid server URL: ${rawUrl}`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }

  if (privateUrlsAllowed()) return;

  const host = url.hostname.replace(/^\[|\]$/g, "");

  if (LOCAL_NAMES.test(host)) {
    throw new Error(
      `Refusing to connect to ${url.hostname}: private addresses are blocked on this deployment`
    );
  }

  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true }).catch(() => {
        throw new Error(`Could not resolve ${url.hostname}`);
      });

  // Every answer has to be public: a name resolving to one public and one
  // private address is the classic way to slip past a first-answer check.
  const blocked = addresses.find((entry) => isPrivateAddress(entry.address));

  if (blocked) {
    throw new Error(
      `Refusing to connect to ${url.hostname} (${blocked.address}): private addresses are blocked on this deployment`
    );
  }

};

// CR/LF in a header smuggles extra headers into the request. Values arrive
// from user input, so they are checked rather than trusted.
export const assertHeadersSafe = (pairs = []) => {

  pairs.forEach((pair) => {

    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(pair.key || "")) {
      throw new Error(`Invalid header name: ${pair.key}`);
    }

    if (/[\r\n\0]/.test(String(pair.value ?? ""))) {
      throw new Error(`Invalid value for header ${pair.key}`);
    }

  });

};
