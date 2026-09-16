import { Annotation } from "@langchain/langgraph";

export const AgentState =
Annotation.Root({

 prompt:
 Annotation(),

 conversationId:
 Annotation(),

 userId:
 Annotation(),

 agent:
 Annotation(),

 response:
 Annotation(),

 images:
  Annotation(),
 model:
 Annotation(),
  file:
 Annotation(),

 artifacts:
 Annotation(),

 searchResults:
 Annotation(),

 // The browser's IANA zone. Without it the chat agent has no "now" to give the
 // model, which is why time-shaped questions were answered "I don't have
 // access to live data" even with Search on.
 timezone:
 Annotation(),

 codeContext:
 Annotation(),

 pdfContext:
 Annotation(),

 // Undeclared keys are dropped by LangGraph, so searchError never reached the
 // chat agent and its "search failed" branch was unreachable.
 searchError:
 Annotation(),

 // Marks a response as an error so the controller can skip persisting it.
 isError:
 Annotation(),

 // Which MCP tools the answer ran. Undeclared keys are dropped by LangGraph,
 // so without this the chat agent's tool list never reaches the controller.
 toolCalls:
 Annotation()

});