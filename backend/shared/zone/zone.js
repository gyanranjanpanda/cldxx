// How an organisation's policy and a client's request combine into the zone a
// turn runs in.
//
// Shared between the gateway and the agent on purpose. Both have to answer the
// same question -- the agent to choose a model, the gateway to choose a
// database -- and two implementations of a security rule is two chances for
// them to disagree, with the disagreement being a disclosure.

export const SOVEREIGN_POLICIES = new Set([
  "user_choice",
  "sovereign_default",
  "sovereign_only"
]);

// The browser sends this over multipart/form-data alongside file uploads,
// where every field arrives as text, so `false` and `"false"` must not mean
// different things.
export const isSovereign = (value) =>
  value === true || value === "true";

/**
 * A request may ask for Sovereign Mode; only an administrator may require it.
 * The request can narrow the zone, never widen it.
 *
 * @returns {{ sovereign: boolean, policy: string, forced: boolean, optedOut: boolean }}
 *   `forced`   — policy required it, whatever the client asked for
 *   `optedOut` — policy defaulted to sovereign and the client explicitly
 *                declined, which is worth writing to the audit log
 */
export const resolveSovereign = (policy, requested) => {

  const asked = isSovereign(requested);

  const known = SOVEREIGN_POLICIES.has(policy) ? policy : "user_choice";

  if (known === "sovereign_only") {
    return { sovereign: true, policy: known, forced: !asked, optedOut: false };
  }

  if (known === "sovereign_default") {

    // Absent means "no opinion", which under this policy means local. Only an
    // explicit false is an opt-out.
    const declined = requested === false || requested === "false";

    return { sovereign: !declined, policy: known, forced: false, optedOut: declined };

  }

  return { sovereign: asked, policy: known, forced: false, optedOut: false };

};
