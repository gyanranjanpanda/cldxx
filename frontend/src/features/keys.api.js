import api from "../utils/axios";

// A user's own provider keys. The server never sends a key back -- these calls
// return the provider, the last four characters and whether it verified, which
// is everything the settings screen needs to show.

export const getKeyProviders = async () => {
  const { data } = await api.get("/api/keys/providers");
  return data.providers || [];
};

export const getUserKeys = async () => {
  const { data } = await api.get("/api/keys");
  return data.keys || [];
};

export const saveUserKey = async (provider, key) => {
  const { data } = await api.put(`/api/keys/${provider}`, { key });
  return data;
};

export const toggleUserKey = async (provider, enabled) => {
  const { data } = await api.patch(`/api/keys/${provider}/toggle`, { enabled });
  return data.key;
};

export const deleteUserKey = async (provider) => {
  const { data } = await api.delete(`/api/keys/${provider}`);
  return data;
};
