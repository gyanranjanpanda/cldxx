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

// Keeps a buggy generated page from destroying its own preview.
//
// The panel already shields the host from generated code. This shields the
// preview from itself, which turns out to matter more: a page that calls
// location.reload() inside a srcDoc iframe does not re-run -- it navigates
// away and leaves a white rectangle, with no clue as to why. That is a real
// failure we hit, from a snake game whose game-over check fired on frame one
// and reloaded before the user could press a key.
//
// alert() is blocked outright by sandbox="allow-scripts" (no allow-modals), so
// a page that tries to explain itself through one says nothing at all. Both are
// forwarded to the panel instead, which can actually show them.
//
// Navigation itself cannot be stopped from inside the frame (see below), so
// the guard announces each run instead and lets the panel recognise a page
// that keeps restarting itself.
const PREVIEW_GUARD = `<script>
(function () {
  // A broken game loop reports the same failure every frame -- the snake game
  // this was built for managed several hundred in the first second. The panel
  // only shows the latest, but posting them is still work, so the guard goes
  // quiet after a handful and says so once.
  var sent = 0;
  var LIMIT = 12;

  var send = function (kind, text) {
    if (sent > LIMIT) return;
    sent += 1;
    var body = sent > LIMIT
      ? "further messages suppressed — the page is repeating this every frame"
      : String(text);
    try { parent.postMessage({ __cldxPreview: true, kind: kind, text: body }, "*"); } catch (e) {}
  };

  // Modals the sandbox would swallow silently.
  window.alert   = function (m) { send("alert", m); };
  window.confirm = function (m) { send("alert", m); return false; };
  window.prompt  = function (m) { send("alert", m); return null; };

  // Navigation cannot actually be prevented from in here. location.reload,
  // assign and replace are [LegacyUnforgeable] in WebIDL, which makes them
  // own, non-configurable properties of the location object -- assigning to
  // Location.prototype is simply ignored, and defineProperty throws. Measured,
  // not assumed: a page calling location.reload() in a loop re-ran this guard
  // hundreds of times in one second.
  //
  // So the guard reports rather than blocks. Announcing each execution lets
  // the panel notice a document that keeps restarting itself and say so, which
  // is the part the user actually needs -- the alternative is a preview that
  // flickers or blanks with no explanation.
  send("boot", "preview started");

  // A thrown error otherwise shows as an unexplained blank or frozen frame.
  window.addEventListener("error", function (e) {
    send("error", (e.message || "Script error") + (e.lineno ? " (line " + e.lineno + ")" : ""));
  });

  window.addEventListener("unhandledrejection", function (e) {
    send("error", "Unhandled promise rejection: " + ((e.reason && e.reason.message) || e.reason));
  });
}());
</script>`;

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
${PREVIEW_GUARD}
${styleBlock}
</head>
<body>
${html}
${scriptBlock}
</body>
</html>`;
  }

  // First thing in the document, so it is already in place when the generated
  // scripts run. A page with no <head> gets it prepended instead.
  html = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (tag) => `${tag}\n${PREVIEW_GUARD}`)
    : `${PREVIEW_GUARD}\n${html}`;

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
