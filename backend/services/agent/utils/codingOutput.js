// Only a response that starts with a file header is a generated project.
// Review and debugging answers may mention "FILE:" in prose or code examples.
const FILE_HEADER = /^FILE:[ \t]*([^\r\n]+)\r?\n/gm;

const cleanFileContent = (content) => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/);
  return (fenced ? fenced[1] : trimmed).trim();
};

const safeName = (name) =>
  /^[A-Za-z0-9._/-]+$/.test(name) &&
  !name.startsWith("/") &&
  !name.split("/").some((part) => !part || part === "." || part === "..");

export const parseProjectFiles = (answer) => {
  const text = String(answer ?? "").trim();
  if (!text.startsWith("FILE:")) return [];

  const matches = [...text.matchAll(FILE_HEADER)];
  if (!matches.length || matches[0].index !== 0) return [];

  const names = new Set();
  const files = [];
  for (let i = 0; i < matches.length; i += 1) {
    const name = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const content = cleanFileContent(text.slice(start, end));
    if (!safeName(name) || names.has(name.toLowerCase()) || !content) return [];
    names.add(name.toLowerCase());
    files.push({ name, content });
  }
  return files;
};

export const codingContext = (history, prompt, { recentTurns = 8, maxProjectChars = 100_000 } = {}) => {
  const previous = history.at(-1)?.role === "user" && history.at(-1)?.content === prompt
    ? history.slice(0, -1)
    : history;
  const recent = previous.slice(-recentTurns);
  const project = [...previous].reverse()
    .flatMap((message) => message.artifacts || [])
    .find((artifact) => artifact.type === "project" && artifact.files?.length);

  if (!project) return { recent, projectText: "" };
  const source = project.files
    .map((file) => `FILE: ${file.name}\n${file.content}`)
    .join("\n\n");
  const projectText = source.length > maxProjectChars
    ? `Previous project files exceed the context limit (${project.files.map((file) => file.name).join(", ")}). Ask which files to edit before claiming to update the full project.`
    : `Previous generated project files:\n${source}`;
  return { recent, projectText };
};
