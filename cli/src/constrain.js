// The runtime-specific lever that forces a decoder to emit valid JSON.
//
// This is the highest-leverage idea in the whole design for small models: it
// moves correctness from *hoping* the model emits a well-formed call to the
// sampler being unable to emit anything else. Every supported runtime has the
// capability; no two spell it the same way, which is the only reason this file
// exists.

/**
 * @param {string} runtime  the name discovery recorded ("Ollama", "vLLM", ...)
 * @param {object} schema   JSON Schema the response must satisfy
 */
export const constraintFor = (runtime, schema) => {

  switch (runtime) {

    // Ollama takes a JSON Schema directly in `format`; older builds accept the
    // string "json", which still forces valid JSON but not this shape.
    case "Ollama":
      return { format: schema };

    // vLLM's OpenAI server reads guided_json as an extra top-level field.
    case "vLLM":
      return { guided_json: schema };

    // SGLang takes it as a stringified schema under response_format.
    case "SGLang":
      return {
        response_format: {
          type: "json_schema",
          json_schema: { name: "tool_call", schema }
        }
      };

    // llama.cpp converts a JSON Schema to a GBNF grammar internally.
    case "llama.cpp":
      return { json_schema: schema };

    // Unknown runtime, or one reached through an explicit --base-url. The
    // generic form is widely implemented and still forces valid JSON, just not
    // this particular shape -- which is most of the benefit, since the parser
    // is tolerant about shape and intolerant about syntax.
    default:
      return { response_format: { type: "json_object" } };

  }

};

// The envelope a constrained retry is forced into. Deliberately small: every
// field a schema adds is another thing a 7B model can get wrong, and arguments
// are left unconstrained because their shape differs per tool and nesting a
// union of all of them produces a schema small models handle badly.
export const toolCallSchema = (tools) => ({
  type: "object",
  properties: {
    tool: {
      type: "string",
      enum: tools.map((tool) => tool.name)
    },
    arguments: { type: "object" }
  },
  required: ["tool", "arguments"]
});
