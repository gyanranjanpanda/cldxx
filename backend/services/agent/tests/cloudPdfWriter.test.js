import assert from "node:assert/strict";
import test from "node:test";
import { writeAllSections } from "../docgen/agents/writer.agent.js";

test("cloud PDF validates blocks before formatting and rewrites only missing sections", async (t) => {
  const sections = [
    { id: "s1", name: "The equation", description: "Explain the slope.", layout: "bullets" },
    { id: "s2", name: "Worked example", description: "Calculate a prediction.", layout: "prose" },
  ];
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    const request = JSON.parse(body.contents.at(-1).parts[0].text);
    requests.push(request.sections.map(({ id }) => id));
    const returned = requests.length === 1
      ? [
          { id: "s1", blocks: [
            { type: "bullets", items: "This string used to crash word counting" },
            { type: "bullets", items: ["The slope is the change in the prediction for one unit of input."] },
          ] },
          { id: "s2", blocks: [{ type: "paragraph", text: { unexpected: "object" } }] },
        ]
      : [{ id: "s2", blocks: [{ type: "paragraph", text: "For y = 2x + 1, x = 3 predicts 7." }] }];
    return Response.json({
      candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify({ sections: returned }) }] }, finishReason: "STOP" }],
    });
  });

  const blocks = await writeAllSections(sections, {
    format: "pdf", topic: "Linear regression", modelState: { keys: { google: "AQ." + "a".repeat(60) } },
  });
  assert.deepEqual(requests, [["s1", "s2"], ["s2"]]);
  assert.deepEqual(blocks.map(({ type }) => type), ["heading", "bullets", "heading", "paragraph"]);
  assert.match(blocks.at(-1).text, /predicts 7/);
});
