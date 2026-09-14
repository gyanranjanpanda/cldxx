import { TavilySearch } from "@langchain/tavily";

// includeAnswer asks Tavily for its own synthesised answer, which for lookups
// like weather or scores is pulled from the live page rather than from an
// indexed snippet -- that is what the chat agent should prefer.
// advanced depth returns longer content chunks, so a number that sits below the
// snippet fold ("humidity 75%") actually reaches the model.
export const searchTool = new TavilySearch({
  maxResults: 5,
  topic: "general",
  searchDepth: "advanced",
  includeAnswer: true,
  includeImages: true
});

// Tavily returns thumbnails for every search, so a time or weather lookup came
// back with a row of stock clock photos above the answer. They are only worth
// the vertical space when the user actually asked to see something, so this is
// a whitelist: factual lookups are long-tail and a blacklist would never cover
// them all.
const VISUAL_QUERY =
  /\b(?:images?|photos?|pictures?|pics?|screenshots?|wallpapers?|posters?|logos?|diagrams?|maps?|illustrations?|artworks?|paintings?|drawings?|thumbnails?|sketch(?:es)?|infographics?)\b|\b(?:show|see)\s+me\b|\blook(?:s)?\s+like\b|\bwhat\s+does\s+.+\s+look\b/i;

export const wantsImages = (prompt) =>
  typeof prompt === "string" && VISUAL_QUERY.test(prompt);
