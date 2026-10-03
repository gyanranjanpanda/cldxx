// A scripted OpenAI-shaped runtime on loopback.
//
// The probe and the tool loop classify model behaviour, and the behaviour worth
// testing is the behaviour no model on the test machine exhibits -- a native
// tool_calls response, a model that ignores tools, a runtime that rejects the
// request outright. Scripting it is the only way to cover all four branches
// without four different GPUs.

import http from "node:http";

export const startFakeRuntime = async (script) => {

  const requests = [];

  let turn = 0;

  const server = http.createServer((request, response) => {

    let body = "";

    request.on("data", (chunk) => { body += chunk; });

    request.on("end", () => {

      requests.push({ url: request.url, body: body ? JSON.parse(body) : null });

      const step = Array.isArray(script) ? script[Math.min(turn, script.length - 1)] : script;

      turn += 1;

      if (step.status && step.status !== 200) {
        response.writeHead(step.status, { "content-type": "text/plain" });
        response.end(step.body || "error");
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: step.message }] }));

    });

  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve))
  };

};
