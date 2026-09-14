import { getModel } from "../utils/model.js";
import { parseRepoUrl } from "../utils/github.js";
import { isClockQuestion } from "../utils/now.js";
import redis from "../../../shared/redis/redis.js";

export const routerNode =
async(state)=>{


if (

    state.agent &&

    state.agent !== "auto"

) {

    return {

        ...state,

        agent: state.agent

    };

}


// The chat agent is handed the server clock, so this is answered exactly and
// for free. Searching instead returns cached time pages whose timestamps are
// whatever the crawler saw -- that is how "what is current time" came back
// hours behind. Placed after the explicit-agent check so picking Search by
// hand still searches.
if(!state.file && isClockQuestion(state.prompt)){

    return{

        ...state,

        agent:"chat"

    };

}


// A GitHub URL is unambiguous, so it is matched directly instead of paying for
// a router LLM call and hoping the model picks the right label.
if(parseRepoUrl(state.prompt)){

    return{

        ...state,

        agent:"github"

    };

}


if(state.file){

    if(

        state.file.mimetype.startsWith("image/")

    ){

        return{

            ...state,

            agent:"vision"

        };

    }

}

// Everything that is not an image is treated as a document: PDF, Word, or any
// plain-text format. The doc agent extracts the text and answers over it.
if(state.file){

    return{

        ...state,

        agent:"pdf_rag"

    };

}


 const llm =
 getModel("router");

 const result =
 await llm.invoke(`

You are an agent router.

Available agents:

- chat
- search
- coding
- pdf
- ppt
- image

Rules:

chat:
General conversation,
explanations,
learning,
questions.

search:
Current events,
latest information,
news,
recent developments,
internet lookup.

coding:
Generate code,
debug code,
build projects,
architecture,
API design.

pdf:
Questions about generate PDFs
or document context.

ppt:
Questions about generate ppts
or ppt context.

image:
Generate, draw, create or
design a picture, image,
photo, illustration, logo
or artwork.

Pick "image" whenever the user
wants a picture produced, not
code that draws one.

Return ONLY one word, exactly
one of:

chat
search
coding
pdf
ppt
image

User Query:

${state.prompt}

 `);

 // Reasoning models wrap their answer in prose, and any model occasionally
 // adds punctuation or a sentence. Pull the first known label out of the
 // reply rather than trusting the whole string, and fall back to chat --
 // an unrecognised value used to silently land on chat anyway, which is how
 // "create image of snake" ended up answered as code.
 const raw =
 String(result.content)
  .trim()
  .toLowerCase();

 const match =
 raw.match(
  /\b(chat|search|coding|pdf|ppt|image)\b/
 );

 const picked =
 match ? match[1] : "chat";

 // Once a conversation is about a repository, follow-ups drop the URL -- "which
 // file does X" then routes to coding and gets answered from the model's
 // imagination instead of the code. Only chat/coding are redirected, so asking
 // for an image or a PDF in the same conversation still works.
 if(picked === "chat" || picked === "coding"){

  const remembered =
  await redis.get(
   `conv-repo:${state.conversationId}`
  );

  if(remembered){

   return {

    ...state,

    agent:"github"

   };

  }

 }

 return {

  ...state,

  agent: picked

 };

};
