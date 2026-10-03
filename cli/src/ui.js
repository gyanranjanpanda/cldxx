// Terminal output. Colour is suppressed when the stream is not a TTY, when
// NO_COLOR is set, and when TERM says dumb -- piping `cldx code -p` into
// another tool must produce text, not escape codes.

const CSI = String.fromCharCode(27) + "[";

const enabled =
  process.stdout.isTTY &&
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb";

const wrap = (code) => (text) =>
  enabled ? `${CSI}${code}m${text}${CSI}0m` : String(text);

export const dim = wrap("2");
export const bold = wrap("1");
export const green = wrap("32");
export const yellow = wrap("33");
export const red = wrap("31");
export const cyan = wrap("36");

/**
 * The line a developer must never have to wonder about: which zone just read
 * their repository, and which model answered.
 */
export const banner = ({ zone, model, runtime, root, cached, version }) => {

  const mark = zone.sovereign
    ? green("* Sovereign")
    : yellow("o Cloud");

  return [
    `${bold("cldx code")} ${dim(version)}   ${mark} ${dim("|")} ${cyan(model)} ${dim(`| ${runtime}`)}`,
    dim(`  ${root}`),
    dim(`  zone: ${zone.reason}${cached ? " | runtime from cache" : ""}`),
    ""
  ].join("\n");

};

export const policyError = (error) => [
  "",
  red(`x ${error.rule || "error"}`),
  error.message.split("\n").map((line) => `  ${line}`).join("\n"),
  ""
].join("\n");
