// Builds a single self-contained document from a generated project so it can
// run inside the sandboxed preview iframe.
//
// The iframe renders from srcDoc, so it has no origin and no base URL: every
// <link href="style.css"> and <script src="script.js"> in the generated HTML
// would 404. This resolves those references against the project's own files
// and inlines them, which also means the model is free to name its files
// whatever it likes instead of exactly style.css / script.js.

const basename = (p = "") => p.split(/[?#]/)[0].split("/").filter(Boolean).pop() || "";

const findFile = (files, ref) => {
  const want = basename(ref).toLowerCase();
  if (!want) return null;
  return files.find((f) => basename(f.name).toLowerCase() === want) || null;
};

const isCss = (f) => /\.css$/i.test(f.name);
const isJs = (f) => /\.js$/i.test(f.name);

// A full-stack answer ships server.js next to script.js. Both end in .js, but
// running the server file in the browser throws on the first require/import and
// takes the rest of the preview down with it, so keep it out unless the HTML
// explicitly asked for it via <script src>.
const NODE_MARKERS =
  /(\brequire\s*\(|\bmodule\.exports\b|\bprocess\.env\b|\bapp\.listen\s*\(|\bfrom\s+["']express["'])/;

const looksLikeServerCode = (f) => NODE_MARKERS.test(f.content || "");

// Keep generated code from terminating the <script> block it is embedded in.
const safeForScriptTag = (code = "") => code.replace(/<\/script>/gi, "<\\/script>");
const safeForStyleTag = (code = "") => code.replace(/<\/style>/gi, "<\\/style>");

export function buildPreviewDoc(files = [], htmlFile = null) {
  if (!htmlFile) return "";

  const used = new Set([htmlFile.name]);
  let html = htmlFile.content || "";

  // <link rel="stylesheet" href="..."> -> inline <style>
  html = html.replace(
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
    (tag, href) => {
      if (!/stylesheet/i.test(tag) && !/\.css$/i.test(href)) return tag;
      const match = findFile(files, href);
      if (!match) return tag;
      used.add(match.name);
      return `<style>\n${safeForStyleTag(match.content)}\n</style>`;
    }
  );

  // <script src="..."></script> -> inline <script>
  html = html.replace(
    /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (tag, src) => {
      const match = findFile(files, src);
      if (!match) return tag;
      used.add(match.name);
      return `<script>\n${safeForScriptTag(match.content)}\n</script>`;
    }
  );

  // Anything the HTML never referenced still belongs in the preview -- a model
  // that emits style.css without linking it is common, and dropping the file
  // silently is what made previews render unstyled or blank.
  const leftoverCss = files.filter((f) => !used.has(f.name) && isCss(f));
  const leftoverJs = files.filter(
    (f) => !used.has(f.name) && isJs(f) && !looksLikeServerCode(f)
  );

  const styleBlock = leftoverCss
    .map((f) => `<style>\n${safeForStyleTag(f.content)}\n</style>`)
    .join("\n");

  const scriptBlock = leftoverJs
    .map((f) => `<script>\n${safeForScriptTag(f.content)}\n</script>`)
    .join("\n");

  const isFullDocument = /<html[\s>]/i.test(html);

  if (!isFullDocument) {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
${styleBlock}
</head>
<body>
${html}
${scriptBlock}
</body>
</html>`;
  }

  if (styleBlock) {
    html = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, `${styleBlock}\n</head>`)
      : `${styleBlock}\n${html}`;
  }

  if (scriptBlock) {
    html = /<\/body>/i.test(html)
      ? html.replace(/<\/body>/i, `${scriptBlock}\n</body>`)
      : `${html}\n${scriptBlock}`;
  }

  return html;
}

export default buildPreviewDoc;
