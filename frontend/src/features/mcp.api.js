import api from "../utils/axios";

export const getMcpServers = async () => {
  const { data } = await api.get("/api/mcp/servers");
  return data;
};

export const createMcpServer = async (payload) => {
  const { data } = await api.post("/api/mcp/servers", payload);
  return data.server;
};

export const updateMcpServer = async (id, payload) => {
  const { data } = await api.put(`/api/mcp/servers/${id}`, payload);
  return data.server;
};

export const toggleMcpServer = async (id, enabled) => {
  const { data } = await api.patch(`/api/mcp/servers/${id}/toggle`, { enabled });
  return data.server;
};

export const deleteMcpServer = async (id) => {
  const { data } = await api.delete(`/api/mcp/servers/${id}`);
  return data;
};

// Runs through the agent, which is the process that holds the MCP client.
// Omitting serverId checks every configured server.
export const checkMcpHealth = async (serverId) => {
  const { data } = await api.post("/api/agent/mcp/health", { serverId });
  return data.results || [];
};
