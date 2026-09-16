import { McpSession, fetchServers, reportStatus } from "../utils/mcp/registry.js";

/**
 * Connects to one server (or every configured server) and reports what it
 * found. This is the only way to know a server actually works -- a URL that
 * parses tells you nothing about whether it speaks MCP.
 */
export const health = async (req, res, next) => {

  let session = null;

  try {

    const userId = req.headers["x-user-id"];

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { serverId } = req.body || {};

    const { servers, stdioAllowed } = await fetchServers(userId, {
      enabledOnly: false,
      id: serverId
    });

    if (!servers.length) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    const results = [];

    // One session, one connection per server, closed together at the end.
    for (const server of servers) {

      session = new McpSession([server], { stdioAllowed });

      const { specs, errors } = await session.discover();
      const failure = errors[0];

      const tools = specs.map((spec) => ({
        name: spec.function.name,
        description: spec.function.description
      }));

      results.push({
        _id:   server._id,
        name:  server.name,
        state: failure ? "error" : "ok",
        error: failure?.error || "",
        tools
      });

      await reportStatus({
        serverId: server._id,
        userId,
        state: failure ? "error" : "ok",
        error: failure?.error || "",
        tools
      });

      await session.close();
      session = null;

    }

    res.json({ success: true, results });

  } catch (error) {

    next(error);

  } finally {

    await session?.close();

  }

};
