import fs from "fs";
import { extractText } from "../utils/extractText.js";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { createVectorStore } from "../utils/vectorStore.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { newFence, untrustedContentRules, wrapUntrusted } from "../utils/guardrails.js";
import { getModel } from "../utils/model.js";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";

// Small documents fit in the prompt whole. Retrieving the top few chunks for
// "summarise this" gives the model a handful of passages and a summary of only
// those, which is the wrong shape of answer.
const FULL_TEXT_LIMIT = 16000;

// Questions that need the whole document rather than the passages nearest to
// the wording of the question.
const WHOLE_DOC_INTENT =
  /\b(summar|overview|tl;?dr|key points?|main points?|what is this|about this|takeaways?|abstract|outline)\b/i;

export const pdfRagAgent = async (state) => {
  // Declared out here so the finally block can actually see them -- previously
  // collectionName was scoped to the try, so cleanup threw ReferenceError and
  // every uploaded PDF leaked its Qdrant collection.
  const collectionName = `pdf-${Date.now()}`;
  // vectorStore.js prefixes sovereign collections with "sovereign__". The
  // cleanup has to use the same name or it deletes nothing and the collection
  // grows without bound.
  const sovereign = state.sovereign === true;
  const storedCollectionName = sovereign
    ? `sovereign__${collectionName}`
    : collectionName;
  let backend = null;

  try {
    const { text, kind } = await extractText(state.file);

    if (!text) {
      return {
        ...state,
        response:
          kind === "pdf"
            ? "I couldn't read any text from that PDF. If it's a scanned document it has no text layer, so it would need OCR first."
            : "That file appears to be empty — I couldn't read any text from it."
      };
    }

    let context;

    if (text.length <= FULL_TEXT_LIMIT || WHOLE_DOC_INTENT.test(state.prompt)) {
      // Short doc, or a question about the document as a whole.
      context = text.slice(0, FULL_TEXT_LIMIT);
    } else {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200
      });

      const docs = await splitter.createDocuments([text]);

      const created = await createVectorStore(collectionName, docs, state);
      backend = created.backend;

      const relevantDocs = await created.store.similaritySearch(state.prompt, 8);

      context = relevantDocs.map((doc) => doc.pageContent).join("\n\n");
    }

    const llm = getModel("pdf_rag", state);

    // An uploaded file is attacker-controlled whenever the user did not write
    // it themselves -- a forwarded PDF, a downloaded report, a CSV export.
    const fence = newFence();

    const messages = [
      new SystemMessage(`
You are cldxAI Document Assistant.

The user uploaded "${state.file.originalname || "a document"}". Its full text,
or the passages most relevant to the question, appear below.

Rules:

- Answer ONLY from the document text provided.

- Never make up information.

- The document may be a report, a spreadsheet exported as CSV, notes, code or
  any other text. Read whatever is there and answer from it. Tabular data still
  counts as content -- describe the rows and columns you were given.

- If the answer genuinely is not in the text, reply:

"I couldn't find this information in the uploaded document."

- Use Markdown formatting.

${untrustedContentRules(fence)}
`),

      new HumanMessage(`
Document:

${wrapUntrusted(context, {
  source: `uploaded file: ${state.file.originalname || "document"}`,
  fence
})}

Question:

${state.prompt}
`)
    ];

    const response = await llm.invoke(messages);

    return {
      ...state,
      response: response.content
    };
  } catch (error) {
    console.error("[pdf_rag] failed:", error.message);

    return {
      ...state,
      response: `I couldn't process that PDF: ${error.message}`
    };
  } finally {
    try {
      fs.unlinkSync(state.file.path);
    } catch (err) {
      console.log("[pdf_rag] temp file cleanup:", err.message);
    }

    if (backend === "qdrant") {
      try {
        // Use the collection name as it was actually stored, including the
        // "sovereign__" prefix that vectorStore.js adds for sovereign turns.
        // Using the bare name would silently delete nothing, leaving the
        // collection and its contents behind.
        const qdrantUrl = sovereign
          ? process.env.SOVEREIGN_QDRANT_URL
          : process.env.QDRANT_URL;
        const qdrantApiKey = sovereign
          ? process.env.SOVEREIGN_QDRANT_API_KEY
          : process.env.QDRANT_API_KEY;

        const client = new QdrantClient({
          url: qdrantUrl,
          ...(qdrantApiKey ? { apiKey: qdrantApiKey } : {}),
        });

        await client.deleteCollection(storedCollectionName);
      } catch (err) {
        console.log("[pdf_rag] collection cleanup:", err.message);
      }
    }
  }
};
