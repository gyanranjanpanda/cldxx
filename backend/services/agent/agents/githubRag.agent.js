import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantVectorStore } from "@langchain/qdrant";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import redis from "../../../shared/redis/redis.js";
import { getModel } from "../utils/model.js";
import { embeddings } from "../utils/embedding.js";
import { createVectorStore } from "../utils/vectorStore.js";
import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import { parseRepoUrl, fetchRepoMeta, fetchRepoFiles, LIMITS } from "../utils/github.js";

// Questions about layout and purpose are answered from the file tree and the
// README, not from whichever chunks happen to sit nearest the wording.
const STRUCTURE_INTENT =
  /\b(structure|architecture|overview|what is this|about this|how.*organi[sz]ed|folder|directory|tech stack|stack|summar|explain the (repo|project|codebase))\b/i;

const TOP_K = 8;

// Remembering the repo per conversation is what makes follow-up questions work
// without pasting the URL again every single time.
const repoKey = (conversationId) => `conv-repo:${conversationId}`;
const REPO_TTL = 60 * 60 * 24 * 7;

// Qdrant collection names accept only [A-Za-z0-9_-].
const collectionFor = ({ owner, repo, sha }) =>
  `repo-${`${owner}-${repo}-${String(sha).slice(0, 7)}`.replace(/[^A-Za-z0-9_-]/g, "-")}`;

const qdrantConfigured = () =>
  Boolean(process.env.QDRANT_URL && process.env.QDRANT_API_KEY);

// When Qdrant is down the in-memory store cannot persist, so hold the last few
// indexes in the process. Bounded because each one holds a repo's worth of
// vectors and this would otherwise grow until the service runs out of memory.
const PROCESS_CACHE_MAX = 3;
const processCache = new Map();

const rememberInProcess = (key, store) => {
  processCache.set(key, store);

  while (processCache.size > PROCESS_CACHE_MAX) {
    processCache.delete(processCache.keys().next().value);
  }
};

// Asked directly rather than through the langchain wrapper because the wrapper
// creates the collection on connect, which would make "does it exist" always true.
const collectionExists = async (name) => {
  try {
    const res = await fetch(
      `${process.env.QDRANT_URL.replace(/\/$/, "")}/collections/${name}`,
      { headers: { "api-key": process.env.QDRANT_API_KEY } }
    );

    if (!res.ok) return false;

    const body = await res.json();
    // A collection that exists but holds nothing must be rebuilt, not reused.
    return (body?.result?.points_count ?? 0) > 0;
  } catch (error) {
    console.warn("[githubRag] collection check failed:", error.message);
    return false;
  }
};

// Chunking per file keeps a chunk from straddling two unrelated files, and the
// path in both metadata and text is what lets the model cite a real location.
const buildDocuments = async (files) => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1200,
    chunkOverlap: 150
  });

  const docs = [];

  for (const file of files) {
    const chunks = await splitter.createDocuments(
      [file.content],
      [{ path: file.path }]
    );

    for (const chunk of chunks) {
      chunk.pageContent = `// ${file.path}\n${chunk.pageContent}`;
      docs.push(chunk);
    }
  }

  return docs;
};

const treeSummary = (paths, limit = 200) => {
  const shown = paths.slice(0, limit);
  const extra = paths.length - shown.length;

  return shown.join("\n") + (extra > 0 ? `\n… and ${extra} more files` : "");
};

const readmeExcerpt = (files, max = 4000) => {
  const readme = files.find((f) => /^readme(\.md|\.rst|\.txt)?$/i.test(f.path));
  return readme ? readme.content.slice(0, max) : "";
};

export const githubRagAgent = async (state) => {
  await checkAgentLimit(state.userId, "github");
  await deductCredits(state.userId, "github");

  try {
    const parsed = parseRepoUrl(state.prompt);

    let meta = null;

    if (parsed) {
      meta = await fetchRepoMeta(parsed.owner, parsed.repo);

      await redis.set(repoKey(state.conversationId), JSON.stringify(meta), "EX", REPO_TTL);
    } else {
      // No URL in this message — fall back to the repo this conversation is about.
      const remembered = await redis.get(repoKey(state.conversationId));

      if (!remembered) {
        return {
          ...state,
          response:
            "Paste a GitHub repository URL (for example `https://github.com/owner/repo`) and I'll read the code and answer questions about it."
        };
      }

      meta = JSON.parse(remembered);
    }

    const collectionName = collectionFor(meta);
    const usingQdrant = qdrantConfigured();

    let store = null;
    let indexed = false;
    let fileInfo = null;

    if (usingQdrant && (await collectionExists(collectionName))) {
      // Already indexed at this exact commit, so skip fetching and embedding.
      try {
        store = await QdrantVectorStore.fromExistingCollection(embeddings, {
          url: process.env.QDRANT_URL,
          apiKey: process.env.QDRANT_API_KEY,
          collectionName
        });
      } catch (error) {
        // A suspended cluster resets the connection midway rather than failing
        // the existence check, so this has to degrade instead of throwing.
        console.warn(`[githubRag] could not open ${collectionName}: ${error.message}`);
      }
    }

    // Second chance for the same commit while Qdrant is unreachable: without it
    // every follow-up question re-downloads and re-embeds the whole repository.
    if (!store) store = processCache.get(collectionName) || null;

    if (!store) {
      fileInfo = await fetchRepoFiles(meta.owner, meta.repo, meta.sha);

      if (!fileInfo.files.length) {
        return {
          ...state,
          response: `I downloaded **${meta.owner}/${meta.repo}** but found no readable source files in it.`
        };
      }

      const docs = await buildDocuments(fileInfo.files);

      // createVectorStore already falls back to an in-memory store when Qdrant
      // is unavailable, which is why the build path goes through it rather than
      // constructing a QdrantVectorStore directly.
      const built = await createVectorStore(collectionName, docs);
      store = built.store;

      if (built.backend !== "qdrant") rememberInProcess(collectionName, store);

      indexed = true;
    }

    const wantsStructure = STRUCTURE_INTENT.test(state.prompt);

    const matches = await store.similaritySearch(state.prompt, TOP_K);

    const codeContext = matches
      .map((doc) => doc.pageContent)
      .join("\n\n---\n\n");

    // The tree and README are only fetched when they are actually useful, and
    // only when this request downloaded the repo anyway.
    const structureContext =
      wantsStructure && fileInfo
        ? `\nRepository file tree:\n${treeSummary(fileInfo.allPaths)}\n\nREADME:\n${readmeExcerpt(fileInfo.files)}\n`
        : "";

    const llm = getModel("chat");

    const response = await llm.invoke([
      new SystemMessage(
        `
You are answering questions about the GitHub repository ${meta.owner}/${meta.repo}.
${meta.description ? `Repository description: ${meta.description}` : ""}
${meta.language ? `Primary language: ${meta.language}` : ""}

Rules:

- Answer only from the code below. If it does not contain the answer, say so
  plainly rather than guessing at how the project probably works.
- Cite the file path when you refer to specific code, like \`src/index.js\`.
- The excerpts are retrieved fragments, not the whole repository. Never claim
  something does not exist anywhere -- only that you did not see it.
- Keep the answer as short as the question deserves.
${structureContext}
Relevant code:

${codeContext}
`.trim()
      ),
      new HumanMessage(state.prompt)
    ]);

    const notes = [];

    if (indexed && fileInfo) {
      notes.push(
        `Indexed ${fileInfo.files.length} files from \`${meta.owner}/${meta.repo}\` at \`${String(meta.sha).slice(0, 7)}\`.`
      );
    }

    if (fileInfo?.truncated) {
      notes.push(
        `The repository is larger than the ${LIMITS.files}-file / ${Math.round(LIMITS.totalBytes / 1024 / 1024)}MB scan limit, so some files were left out.`
      );
    }

    return {
      ...state,
      response:
        String(response.content) +
        (notes.length ? `\n\n---\n\n_${notes.join(" ")}_` : "")
    };
  } catch (error) {
    console.error("[githubRag] Error:", error);

    const apiError = error?.data ?? error?.response?.data;

    if (apiError?.title) {
      return {
        ...state,
        response: `❌ **${apiError.title}**\n\n${apiError.message ?? "Please upgrade your plan or wait before trying again."}`,
        isError: true
      };
    }

    // GithubError carries a message written for the user; anything else does not.
    if (error?.status) {
      return {
        ...state,
        response: `❌ **Could not read that repository**\n\n${error.message}`,
        isError: true
      };
    }

    return {
      ...state,
      response: "❌ Failed to scan that repository. Please try again.",
      isError: true
    };
  }
};
