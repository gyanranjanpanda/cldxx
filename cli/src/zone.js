// Branch A -- which zone this session runs in.
//
// Per session, not per install, mirroring the per-turn decision the agent
// service makes in agent.controller.js. The same workstation answers an
// ordinary question from the cloud and opens a classified repository locally.

import { classificationForbidsCloud } from "./policy.js";

// Classifications that may never be answered by a model someone else operates.
// Everything outside this set is a label with no enforcement behind it.
const RESTRICTED = new Set([
  "restricted",
  "confidential",
  "secret"
]);

export const isRestricted = (classification) =>
  RESTRICTED.has(String(classification || "").toLowerCase());

/**
 * @returns {{ sovereign: boolean, classification: string, reason: string }}
 */
export const resolveZone = (config, flags = {}) => {

  const classification = String(config.classification || "internal").toLowerCase();

  const restricted = isRestricted(classification);

  // The flag narrows to local but can never widen to cloud -- the same
  // direction-of-travel rule resolveSovereign() enforces server-side.
  if (restricted && flags.cloud) {
    throw classificationForbidsCloud(classification);
  }

  if (restricted) {
    return {
      sovereign: true,
      classification,
      reason: `repository is classified "${classification}"`
    };
  }

  if (flags.cloud) {
    return { sovereign: false, classification, reason: "--cloud was passed" };
  }

  const sovereign = String(config.zone || "sovereign").toLowerCase() !== "cloud";

  return {
    sovereign,
    classification,
    reason: sovereign ? "default zone is sovereign" : "configured zone is cloud"
  };

};
