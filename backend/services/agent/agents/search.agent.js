import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import { searchTool, wantsImages } from "../utils/tavily.js";
import { describeNow } from "../utils/now.js";

// TavilySearch resolves with { error } rather than throwing when the key is
// rejected or the quota is spent, so a try/catch on its own never sees the
// failure and the agent happily forwards an error object as "results".
const normalise = (raw, keepImages) => {
  if (!raw || raw.error) return null;

  const results = Array.isArray(raw) ? raw : raw.results;

  if (!Array.isArray(results) || !results.length) return null;

  return {
    // Tavily's own answer is read off the live page, so for a "what is the
    // weather / score / price" lookup it beats any indexed snippet.
    answer: typeof raw.answer === "string" ? raw.answer.trim() : "",
    results: results
      .filter((r) => r && (r.content || r.title))
      .map((r) => ({
        title: r.title || "",
        url: r.url || "",
        content: r.content || "",
        // Dropping these was why the model could not tell a page crawled today
        // from one crawled in July, and reported a stale temperature as current.
        publishedDate: r.published_date || r.publishedDate || "",
        score: typeof r.score === "number" ? r.score : null
      })),
    images: keepImages && Array.isArray(raw.images) ? raw.images : []
  };
};

export const searchAgent = async (state) => {
  await checkAgentLimit(state.userId, "search");
  await deductCredits(state.userId, "search");

  let searchResults = null;
  let searchError = null;

  const now = describeNow(state.timezone);

  try {
    // The raw prompt ("what is the weather of bengaluru") matches evergreen
    // pages just as well as today's. Naming the date pushes the provider
    // towards the current reading.
    const raw = await searchTool.invoke({
      query: `${state.prompt} (as of ${now.dateOnly})`
    });

    searchResults = normalise(raw, wantsImages(state.prompt));

    if (searchResults) {
      // Stamped here rather than in the chat agent so the "as of" the user is
      // shown is when the data was actually fetched.
      searchResults.searchedAt = now.formatted;
    } else {
      searchError = raw?.error || "the search returned no usable results";
      console.error("[search] unusable response:", searchError);
    }
  } catch (error) {
    searchError = error.message;
    console.error("[search] request failed:", error.message);
  }

  // null, not [] -- an empty array is truthy, which is what previously let the
  // chat agent believe it had results and answer "using only" nothing.
  return {
    ...state,
    searchResults,
    searchError
  };
};
