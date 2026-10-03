// The interactive loop. Step 1 is conversation only -- no file tools, no shell,
// no edits. Those arrive on feat/cldx-code-file-tools, behind the capability
// probe and the approval policy, and this file deliberately has nothing in it
// that would have to be undone to get there.

import readline from "node:readline";
import { newConversation, streamCompletion } from "./chat.js";
import { banner, bold, cyan, dim, policyError } from "./ui.js";

const HELP = [
  "  /model <name>   switch model for the rest of the session",
  "  /models         list what the runtime is serving",
  "  /zone           show the current zone and why",
  "  /clear          forget the conversation, keep the session",
  "  /exit           leave (ctrl-c twice also works)"
].join("\n");

export const runSession = async (context) => {

  process.stdout.write(banner(context));
  process.stdout.write(dim(`  /help for commands\n\n`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: bold("> ")
  });

  let messages = newConversation();
  let model = context.model;

  // ctrl-c cancels the answer being streamed; a second one at an empty prompt
  // exits. Killing the process mid-stream would be the easy implementation and
  // the wrong one -- interrupting a rambling 7B model is the single most used
  // control in a local-model session.
  let streaming = null;

  rl.on("SIGINT", () => {

    if (streaming) {
      streaming.abort();
      return;
    }

    rl.close();

  });

  rl.prompt();

  for await (const line of rl) {

    const input = line.trim();

    if (!input) {
      rl.prompt();
      continue;
    }

    if (input.startsWith("/")) {

      const [command, ...rest] = input.slice(1).split(/\s+/);

      if (command === "exit" || command === "quit") break;

      if (command === "help") {
        process.stdout.write(`${HELP}\n\n`);
      } else if (command === "clear") {
        messages = newConversation();
        process.stdout.write(dim("  conversation cleared\n\n"));
      } else if (command === "models") {
        process.stdout.write(
          context.models.map((id) => `  ${id === model ? cyan(id) : id}`).join("\n") + "\n\n"
        );
      } else if (command === "zone") {
        process.stdout.write(
          `  ${context.zone.sovereign ? "Sovereign" : "Cloud"} -- ${context.zone.reason}\n` +
          dim(`  ${context.baseUrl}\n\n`)
        );
      } else if (command === "model") {
        if (!rest[0]) {
          process.stdout.write(dim(`  currently ${model}\n\n`));
        } else {
          model = rest[0];
          process.stdout.write(dim(`  model is now ${model}\n\n`));
        }
      } else {
        process.stdout.write(dim(`  unknown command. /help\n\n`));
      }

      rl.prompt();
      continue;

    }

    messages.push({ role: "user", content: input });

    streaming = new AbortController();

    let answer = "";

    try {

      process.stdout.write("\n");

      for await (const delta of streamCompletion({
        baseUrl: context.baseUrl,
        apiKey: context.apiKey,
        model,
        messages,
        signal: streaming.signal,
        timeoutMs: context.timeoutMs
      })) {
        answer += delta;
        process.stdout.write(delta);
      }

      process.stdout.write("\n\n");

    } catch (error) {

      process.stdout.write(policyError(error));

      // The failed turn is dropped rather than left in history, so the next
      // question is not answered in the context of a question that was never
      // answered.
      messages.pop();
      answer = "";

    } finally {
      streaming = null;
    }

    if (answer) {
      messages.push({ role: "assistant", content: answer });
    } else {
      // Interrupted: the user does not want this exchange shaping the next one.
      if (messages.at(-1)?.role === "user") messages.pop();
      process.stdout.write("\n");
    }

    rl.prompt();

  }

  rl.close();
  process.stdout.write(dim("\n  session ended. Nothing left this machine.\n"));

};

/**
 * One prompt, one answer, no REPL -- for scripts, CI and `cldx code -p "..." | less`.
 */
export const runOnce = async (context, prompt) => {

  const messages = [...newConversation(), { role: "user", content: prompt }];

  for await (const delta of streamCompletion({
    baseUrl: context.baseUrl,
    apiKey: context.apiKey,
    model: context.model,
    messages,
    timeoutMs: context.timeoutMs
  })) {
    process.stdout.write(delta);
  }

  process.stdout.write("\n");

};
