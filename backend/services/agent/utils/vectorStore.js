import { QdrantVectorStore } from "@langchain/qdrant";
import { getEmbeddings } from "./embedding.js";
import { MemoryVectorStore } from "./memoryVectorStore.js";

// Returns { store, backend }. The caller needs the backend because only Qdrant
// leaves a collection behind that has to be cleaned up afterwards.
export const createVectorStore = async (collectionName, docs, state = {}) => {
  const sovereign = state.sovereign === true;
  const embeddings = getEmbeddings(state);

  // Sovereign vectors get their own Qdrant and their own collection namespace.
  // Reusing the cloud QDRANT_URL would ship confidential chunks to a hosted
  // cluster, and sharing a collection name across zones would let an ordinary
  // turn retrieve restricted content -- classification has to be a property of
  // the collection, not a filter someone remembers to apply at query time.
  const url = sovereign
    ? process.env.SOVEREIGN_QDRANT_URL
    : process.env.QDRANT_URL;

  const apiKey = sovereign
    ? process.env.SOVEREIGN_QDRANT_API_KEY
    : process.env.QDRANT_API_KEY;

  const collection = sovereign
    ? `sovereign__${collectionName}`
    : collectionName;

  // In the cloud path an absent API key means Qdrant is not configured. A local
  // Qdrant usually runs without auth, so sovereign only needs the URL.
  const qdrantConfigured = sovereign ? Boolean(url) : Boolean(url && apiKey);

  if (qdrantConfigured) {
    try {
      const store = await QdrantVectorStore.fromDocuments(docs, embeddings, {
        url,
        ...(apiKey ? { apiKey } : {}),
        collectionName: collection
      });

      return { store, backend: "qdrant" };
    } catch (error) {
      // A suspended cluster resets the connection instead of answering, so this
      // fallback is the difference between "PDF chat is broken" and a slightly
      // slower answer. The in-memory store never leaves the process, so it is
      // a safe landing place in either zone.
      console.warn(
        `[vectorStore] Qdrant unavailable (${error.message}); using in-memory store.`
      );
    }
  }

  return {
    store: await MemoryVectorStore.fromDocuments(docs, embeddings),
    backend: "memory"
  };
};
