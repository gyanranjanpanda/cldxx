import api from "../utils/axios";

export const createInvite = async (payload) => {
  const { data } = await api.post("/api/invites", payload);
  return data;
};

export const listInvites = async (conversationId) => {
  const { data } = await api.get(`/api/invites/conversation/${conversationId}`);
  return data.invites || [];
};

export const revokeInvite = async (id) => {
  const { data } = await api.delete(`/api/invites/${id}`);
  return data;
};

/* ── Guest side: no session, the token is the credential ── */

export const getSharedConversation = async (token) => {
  const { data } = await api.get(`/api/shared/${token}`);
  return data;
};

export const sendSharedMessage = async (token, prompt) => {
  const { data } = await api.post(`/api/shared/${token}/message`, {
    prompt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  });
  return data;
};
