import { QdrantVectorStore } from "@langchain/qdrant";
import { embeddings } from "./embedding.js";
import { MemoryVectorStore } from "./memoryVectorStore.js";

// Returns { store, backend }. The caller needs the backend because only Qdrant
// leaves a collection behind that has to be cleaned up afterwards.
export const createVectorStore = async (collectionName, docs) => {
  if (process.env.QDRANT_URL && process.env.QDRANT_API_KEY) {
    try {
      const store = await QdrantVectorStore.fromDocuments(docs, embeddings, {
        url: process.env.QDRANT_URL,
        apiKey: process.env.QDRANT_API_KEY,
        collectionName
      });

      return { store, backend: "qdrant" };
    } catch (error) {
      // A suspended cluster resets the connection instead of answering, so this
      // fallback is the difference between "PDF chat is broken" and a slightly
      // slower answer.
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
