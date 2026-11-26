import redis from "../../../shared/redis/redis.js";
import { graph } from "../graph/supervisor.graph.js";
import { addMessage, isEphemeral } from "../utils/memory.js";
import { internalApi } from "../utils/internalApi.js";
import { resolveSovereign, assertRedisLocal, assertAgentAllowed, PolicyDenied } from "../utils/sovereign.js";
import { audit } from "../utils/audit.js";
import { fetchUserKeys } from "../utils/userKeys.js";
import { createTrace, traceSpan, recordBreakpoint, endTrace } from "../utils/diagnostics/tracer.js";
import fs from "fs/promises";
import { storeArtifact } from "../utils/storage.js";

export const chat = async (req, res, next) => {
  const localOnly = process.env.SOVEREIGN_ONLY === "true";
  let trace = null;
  try {
    const {
      prompt,
      conversationId,
      agent,
      timezone,
      incognito,
      sovereign
    } = req.body;

    // Incognito turns are answered normally but never written to Mongo. The id is
    // checked too, so a forged `incognito:false` on an ephemeral id cannot talk the
    // server into creating history for a conversation that does not exist.
    const isIncognito =
      isEphemeral(conversationId) ||
      incognito === true ||
      incognito === "true";

    // Sovereign Mode is decided per turn, but not by the turn alone: the
    // organisation's policy arrives on a header the gateway sets and the client
    // cannot, and it outranks the request. A user may ask for Sovereign Mode; only
    // an administrator may require it.
    const zone = resolveSovereign(
      localOnly ? "sovereign_only" : req.headers["x-sovereign-policy"],
      sovereign
    );
    const isSovereignTurn = zone.sovereign;
    if (localOnly) {
      assertAgentAllowed(agent, true);
      if (!process.env.SOVEREIGN_VISION_MODEL && (agent === "vision" || req.file?.mimetype.startsWith("image/"))) {
        throw new PolicyDenied("Image attachments require an optional local vision model.", "SOV-006");
      }
    }

    // Initialize diagnostic trace immediately on ingress
    trace = createTrace({
      conversationId,
      userId: req.headers["x-user-id"],
      prompt,
      agent,
      isIncognito,
      zone: isSovereignTurn ? "SOVEREIGN" : "CLOUD"
    });

    // SOV-004: assert the Redis tier is local before the first sovereign write.
    if (isSovereignTurn) {
      await traceSpan(trace, "SOVEREIGN_ASSERT", () => assertRedisLocal());
    }

    if (zone.forced || zone.optedOut) {
      audit({
        userId: req.headers["x-user-id"],
        conversationId,
        agent,
        zone: zone.sovereign ? "SOVEREIGN" : "CLOUD",
        decision: zone.forced ? "FORCED" : "ALLOW",
        rule: "SOV-007",
        model: null,
        endpoint: zone.policy
      });
    }

    // Redis still gets the turn either way -- that is what makes the next message
    // aware of this one. For incognito it expires on its own.
    await traceSpan(trace, "INGRESS_PERSIST", async () => {
      // Retain new non-incognito uploads with their conversation so a later
      // cloud export can carry the file into the local Sovereign installation.
      let savedContent = prompt;
      if (req.file && !isIncognito) {
        const fileUrl = await storeArtifact(
          await fs.readFile(req.file.path), req.file.originalname, req.file.mimetype,
          { sovereign: isSovereignTurn, persistent: true,
            userId: req.headers["x-user-id"], conversationId }
        );
        savedContent += `\n\n[Uploaded file](${fileUrl})`;
      }
      await addMessage(
        conversationId,
        "user",
        savedContent,
        { sovereign: isSovereignTurn }
      );

      if (!isIncognito) {
        await internalApi.post("/save-message", {
          conversationId,
          role: "user",
          content: savedContent,
          sovereign: isSovereignTurn
        });
      }
    });

    // Resolved once per turn rather than per model construction: getModel is
    // synchronous, so the lookup cannot live inside it.
    const keys = await traceSpan(trace, "FETCH_USER_KEYS", async () => {
      return isSovereignTurn
        ? {}
        : await fetchUserKeys(req.headers["x-user-id"]);
    });

    const result = await traceSpan(trace, "GRAPH_INVOKE", async () => {
      return await graph.invoke({
        prompt,
        conversationId,
        userId: req.headers["x-user-id"],
        agent,
        timezone,
        file: req.file,
        sovereign: isSovereignTurn,
        keys,
        trace
      });
    });

    // Credit / rate-limit failures are transient, not part of the conversation.
    if (!result.isError) {
      await traceSpan(trace, "EGRESS_PERSIST", async () => {
        await addMessage(
          conversationId,
          "assistant",
          result.response,
          { sovereign: isSovereignTurn, artifacts: result.artifacts || [] }
        );

        if (!isIncognito) {
          await internalApi.post("/save-message", {
            conversationId,
            role: "assistant",
            content: result.response,
            images: result.images,
            artifacts: result.artifacts || [],
            sovereign: isSovereignTurn
          });
        }
      });
    }

    const responsePayload = {
      success: true,
      incognito: isIncognito,
      zone: isSovereignTurn ? "SOVEREIGN" : "CLOUD",
      answer: result.response,
      images: result.images,
      artifacts: result.artifacts || []
    };

    endTrace(trace, responsePayload);

    return res.json(responsePayload);
  } catch (error) {
    if (localOnly && error.isPolicyDenial && req.file) {
      await fs.rm(req.file.path, { force: true }).catch(() => {});
    }
    if (trace) {
      recordBreakpoint(trace, "CONTROLLER_EXCEPTION", error, {
        conversationId: req.body?.conversationId,
        agent: req.body?.agent
      });
    }
    next(error);
  }
};
