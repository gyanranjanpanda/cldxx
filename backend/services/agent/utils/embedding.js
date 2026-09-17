import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

export const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GOOGLE_API_KEY,
  model: "gemini-embedding-001"
});

// gemini-embedding-001 silently returns zero-length vectors once a batch gets
// large -- 20 inputs come back fine, 50 come back as 50 empty arrays with no
// error. Every cosine score then works out to NaN, the sort becomes a no-op and
// retrieval hands back the document in its original order. A real PDF splits
// into dozens of chunks, so this hit every upload.
//
// Patched on the instance rather than subclassed so it stays a genuine
// GoogleGenerativeAIEmbeddings for the vector-store integrations.
const BATCH_SIZE = 16;
const MAX_ATTEMPTS = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const embedDocumentsUnbatched =
  embeddings.embedDocuments.bind(embeddings);

const isUsable = (vectors) =>
  Array.isArray(vectors) &&
  vectors.length > 0 &&
  vectors.every((v) => v && v.length);

embeddings.embedDocuments = async (texts) => {
  const vectors = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    let batchVectors = null;
    let lastError = null;

    // The free tier allows 100 embed requests a minute and answers a 429 with
    // empty vectors rather than an exception, so treat empties as retryable.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      batchVectors = await embedDocumentsUnbatched(batch).catch((err) => {
        lastError = err;
        return null;
      });

      if (isUsable(batchVectors)) break;

      batchVectors = null;

      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 4000);
    }

    // Fail loudly instead of poisoning the index with empty vectors.
    if (!batchVectors) {
      const detail = /429|quota|rate/i.test(lastError?.message || "")
        ? lastError.message
        : "the embedding quota is likely exhausted (free tier allows 100 requests/minute)";

      throw new Error(`Could not embed the document — ${detail}`);
    }

    vectors.push(...batchVectors);
  }

  return vectors;
};

// ── Sovereign embeddings ────────────────────────────────────────────────────
//
// The embedding model is the leak nobody notices. A confidential PDF sent to
// gemini-embedding-001 has already left the building, and no LLM was ever
// called -- so routing chat to a local model while RAG still embeds against
// Google would defeat the whole mode. In Sovereign Mode retrieval has to use a
// local embedder or not run at all.

import { OpenAIEmbeddings } from "@langchain/openai";
import {
  SOVEREIGN_BASE_URL,
  SOVEREIGN_API_KEY,
  PolicyDenied
} from "./sovereign.js";

let sovereignEmbeddings = null;

export const getEmbeddings = (state = {}) => {
  if (state.sovereign !== true) return embeddings;

  if (!SOVEREIGN_BASE_URL) {
    throw new PolicyDenied(
      "Sovereign Mode is on but no local embedding endpoint is configured. Set SOVEREIGN_BASE_URL. Refusing to embed against a cloud provider.",
      "SOV-003"
    );
  }

  if (!sovereignEmbeddings) {
    sovereignEmbeddings = new OpenAIEmbeddings({
      apiKey: SOVEREIGN_API_KEY,
      model: process.env.SOVEREIGN_EMBEDDING_MODEL || "nomic-embed-text",
      configuration: { baseURL: SOVEREIGN_BASE_URL },
    });
  }

  return sovereignEmbeddings;
};
