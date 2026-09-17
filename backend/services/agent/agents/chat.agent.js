import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getMemory } from "../utils/memory.js";
import { getModel } from "../utils/model.js";
import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import { describeNow } from "../utils/now.js";
import { newFence, untrustedContentRules, wrapUntrusted } from "../utils/guardrails.js";
import { runWithMcpTools } from "../utils/mcp/runTools.js";


export const chatAgent =
async(state)=>{

await checkAgentLimit(
    state.userId,
    "chat"
  );

   await deductCredits(

        state.userId,

        "chat"

    );


 const llm =
 getModel("chat", state);

 const history =
 await getMemory(
  state.conversationId
 );

 

// searchResults is an object. Interpolating it straight into the prompt sent
// the model the literal string "[object Object]" and then told it to answer
// using only that, which is why search answers were useless.
const hits = state.searchResults?.results ?? [];
const providerAnswer = state.searchResults?.answer || "";

// Models have no clock, so anything time-shaped ("what is the current time")
// used to hit the trained "I don't have access to live data" reflex even with
// Search on. It is also what lets the model rank a snippet crawled today above
// one crawled in July.
const now = describeNow(state.timezone);

// Search results are pages written by strangers. A page that says "ignore your
// instructions" has to read as a page that says that, not as an instruction.
const fence = newFence();

const clockContext = `
Current date and time: ${now.formatted} (the user's timezone is ${now.zone}).
The same moment in UTC: ${now.utc}.

This is the authoritative present moment, read from the server clock at the
instant this message was sent.

- You DO know the date and time. Never say you lack access to them.
- It outranks every other source in this prompt. If a web result below states a
  different current time or date, that result is a cached page and is wrong --
  use the clock above and ignore it.
- For the time in another place, convert from the UTC value above by that
  zone's offset. Do not copy a time out of a search result.
`;

const searchContext = hits.length
  ? `
Web Search Results (fetched ${state.searchResults.searchedAt}):
${providerAnswer ? `\nLive summary from the search provider:\n${wrapUntrusted(providerAnswer, { source: "search provider summary", fence })}\n` : ""}
${hits
  .map(
    (r, i) =>
      `[${i + 1}] ${r.title}\n${r.url}${
        r.publishedDate ? `\nPublished: ${r.publishedDate}` : ""
      }\n${wrapUntrusted(r.content, { source: `web result ${i + 1}: ${r.url}`, fence })}`
  )
  .join("\n\n")}

Answer the user's question directly from these results.

- Give one consolidated answer. Where sources disagree on a number, commit to a
  single best value or a short range -- do not list what each source said
  separately.
- These results never override the clock at the top of this prompt. Time pages
  are cached and routinely hours behind; the date and time up there are correct.
- Freshness beats agreement. For anything that changes through the day --
  weather, prices, scores, live status -- the live summary above is the most
  current reading there is. Take your numbers from it, and use the numbered
  results only to fill in what it does not mention.
- The results are a mix of today's pages and older ones; most carry no publish
  date, so read the date out of the title and body ("Sunday, Sep 13", "in
  September"). Ignore a result dated before today for a live question even when
  several older results agree with each other, and never take a
  month-in-review or seasonal-average page as the current reading.
- If nothing above is actually from today, say the reading may be out of date
  and give it with whatever date it does carry.
- For a live reading, state what it is as of: "26 degrees C as of 11:44 PM".
- Keep it as short as the question deserves. A weather or score lookup is two or
  three lines, not a report with a section per metric.
- Cite inline and sparingly, only where a claim is genuinely contested or
  time-sensitive. Never append a "Sources" list unless the user asks for one.
`
  : state.searchError
  ? `
A web search was attempted for this question but failed (${state.searchError}).

Answer from your own knowledge, and tell the user plainly that you could not
fetch live data, so anything time-sensitive may be out of date. This does not
apply to the date and time, which you have above and should answer directly.
`
  : "";


const messages = [

  new SystemMessage(
`
You are cldxAI, an intelligent AI assistant.
${clockContext}
${searchContext}



${untrustedContentRules(fence)}

Rules:

- Never mention internal tools or that a search was run.
- For simple questions, greetings, and short queries, respond naturally in plain text.
- For technical, educational, coding, or detailed topics, use clean Markdown.
- Match the answer's length to the question. A one-line question gets a one-line
  answer; do not expand it into headings and bullets because you can.
- Do not restate the question, and do not close with an "Overall, ..." or
  "In summary, ..." paragraph that repeats what you just said.

Formatting:

- Use # for titles and ## for sections.
- Leave a blank line after headings.
- Use bullet points for lists.
- Use numbered lists for steps.
- Use fenced code blocks with language tags for code.
- Keep paragraphs short and readable.
- Never write headings and content on the same line.
- Never generate large walls of text.




`
  )

 ];

 history.forEach((msg)=>{

  if(
   msg.role === "user"
  ){

   messages.push(

    new HumanMessage(
     msg.content
    )

   );

  }

  if(
   msg.role === "assistant"
  ){

   messages.push(

    new AIMessage(
     msg.content
    )

   );

  }

 });

 messages.push(

  new HumanMessage(
   state.prompt
  )

 );

 // Runs the model with whatever MCP tools the user has enabled bound to it,
 // and falls back to a plain invoke when there are none.
 const { response, toolCalls, mcpErrors } = await runWithMcpTools({
   llm,
   messages,
   userId: state.userId
 });

 if (mcpErrors?.length) {
   console.warn("[mcp] unreachable servers:", mcpErrors);
 }

 const images = state.searchResults?.images || [];

 return {
  ...state,

  response,
  images:images,
  // Surfaced to the client so the UI can show what the answer actually ran.
  toolCalls: toolCalls || []

};

};