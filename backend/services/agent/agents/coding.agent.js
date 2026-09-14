import { checkAgentLimit } from "../config/agentRateLimit.js";
import { deductCredits } from "../utils/deductCredits.js";
import { getModel } from "../utils/model.js";

function cleanCode(code = "") {
  return code
    .replace(/```[\w-]*\n?/g, "")
    .replace(/```/g, "")
    .trim();
}

// The panel previews a project by inlining files into one sandboxed iframe, so
// only these can actually run there. Backend files still ship in the artifact
// for the user to download and run locally.
//
// server.js also ends in .js, so match how buildPreviewDoc.js decides what to
// inline -- otherwise the summary promises a preview of a file the panel
// deliberately leaves out.
const PREVIEWABLE = /\.(html|css|js)$/i;

const NODE_MARKERS =
  /(\brequire\s*\(|\bmodule\.exports\b|\bprocess\.env\b|\bapp\.listen\s*\(|\bfrom\s+["']express["'])/;

const runsInPreview = (f) =>
  PREVIEWABLE.test(f.name) && !NODE_MARKERS.test(f.content || "");

const buildSummary = (title, files) => {
  const frontend = files.filter(runsInPreview);
  const backend = files.filter((f) => !runsInPreview(f));

  const lines = [`# ${title}`, "", `Generated ${files.length} files.`, ""];

  if (frontend.length) {
    lines.push("**Frontend** — runs in the preview panel", "");
    frontend.forEach((f) => lines.push(`- \`${f.name}\``));
    lines.push("");
  }

  if (backend.length) {
    lines.push("**Backend / config**", "");
    backend.forEach((f) => lines.push(`- \`${f.name}\``));
    lines.push("");
    lines.push(
      "Open the **Preview** tab to try the prototype. The backend files are",
      "included for you to run locally — see `README.md` for the commands."
    );
  } else {
    lines.push("Open the **Preview** tab to try it.");
  }

  return lines.join("\n");
};

export const codingAgent = async (state) => {
  await checkAgentLimit(state.userId, "coding");
  await deductCredits(state.userId, "coding");

  const llm = getModel("coding");

  const response = await llm.invoke(`You are cldxAI Coding Agent.

Your first task is to identify the user's intent.

=========================
INTENT DETECTION
=========================

Classify the request into ONE of these:

1. CODE_GENERATION
2. CODE_REVIEW
3. CODE_EXPLANATION
4. DEBUGGING
5. OPTIMIZATION
6. CONVERSION
7. DOCUMENTATION

=========================
CODE REVIEW
=========================

If the user provides code and asks:

- review
- explain
- optimize
- debug
- find bugs
- improve
- refactor

DO NOT generate a new project.

Instead return Markdown only.

Include:

# Overview

## What this code does

## Problems

## Improvements

## Best Practices

## Optimized snippets (if required)

For explanations:

- Never wrap variable names in triple backticks.
- Use single backticks only for inline code.
- Use triple backticks ONLY for complete code blocks.

=========================
CODE GENERATION
=========================

Default stack:

HTML
CSS
JavaScript

Do NOT use a frontend framework unless explicitly requested.

"React dashboard"  -> React
"Next.js blog"     -> Next.js

=========================
THE PREVIEW CONTRACT
=========================

index.html is loaded on its own inside a sandboxed iframe.

There is NO server, NO build step and NO network when it runs.

Therefore index.html MUST work standing alone:

- Vanilla HTML/CSS/JS only. No bundler, no JSX, no TypeScript.
- No <script type="module"> and no import/export statements.
- No CDN links, no external fonts, no remote scripts.
- No fetch() to your own backend on first paint. Seed the UI from a
  hard-coded array of demo data so it renders fully with no server.
- If a backend exists, route calls through one api() helper that falls
  back to the demo data when the fetch fails. The prototype must never
  show an empty screen just because no server is running.

=========================
FULL STACK
=========================

When the user asks for a website, app or "full stack" project, generate BOTH:

Frontend (must satisfy the preview contract above):

FILE: index.html
FILE: style.css
FILE: script.js

Backend (only when the request implies stored or shared data):

FILE: server.js          Express, in-memory store, CORS enabled, REST routes
FILE: package.json       name, "type": "module", scripts.start, express dep
FILE: README.md          what it is, how to run, the API routes

Keep the backend small and genuinely runnable with npm install && npm start.

The frontend and backend must agree on route paths and JSON shapes.

=========================
CORRECTNESS RULES
=========================

These fail silently, so never do them:

- <canvas> drawing: ctx.fillStyle / ctx.strokeStyle DO NOT understand CSS
  variables. "var(--x)" is ignored and leaves the previous colour, which
  is usually black on black. Always assign literal colours ("#ffcc00")
  or JS constants.
- Draw at least one visible frame immediately; never leave a blank canvas.
- Define every function and variable you reference. No stubs, no TODOs,
  no "// rest of the logic here".
- Give <canvas> explicit width and height attributes.
- Attach keyboard handlers to window, not to the canvas element.
- Wire every interactive control to real, working logic.

Prefer a smaller feature set that fully works over a large one that does not.

=========================
WEBSITE RULE
=========================

Unless the user explicitly requests multiple pages,

ALWAYS build a SINGLE PAGE website.

Use sections:

Home
About
Services
Features
Pricing
Testimonials
Contact
Footer

Navigation should smoothly scroll.

=========================
DESIGN
=========================

Modern UI

Glassmorphism when suitable

Responsive

CSS Variables (in stylesheets only, never in canvas calls)

Grid

Flexbox

Smooth Scroll

Hover Effects

Subtle Animations

Professional spacing

=========================
IMAGES
=========================

Use real Unsplash URLs for <img> tags.

Never use placeholder services.

=========================
OUTPUT
=========================

If intent is CODE_GENERATION

Return ONLY file blocks in this exact form:

FILE: index.html

...

FILE: style.css

...

FILE: script.js

...

No markdown fences. No explanation before or after.

If intent is REVIEW / EXPLAIN / DEBUG

Return Markdown only. Do NOT generate project files.

=========================
COMPLETENESS
=========================

Finish every file you start. A truncated file is worse than a smaller project.

Write complete, working code — this runs immediately with no edits.

User Request:

${state.prompt}`);

  const content = response.content?.trim() || "";

  if (!content.includes("FILE:")) {
    return {
      ...state,
      response: content,
      artifacts: []
    };
  }

  const files = [
    ...content.matchAll(
      /FILE:\s*([^\n]+)\n([\s\S]*?)(?=\nFILE:\s*[^\n]+\n|$)/g
    )
  ]
    .map((match) => ({
      name: match[1].trim(),
      content: cleanCode(match[2])
    }))
    .filter((f) => f.name && f.content);

  // The model announced files but produced nothing parseable -- show whatever
  // it did say rather than an artifact with no files in it.
  if (!files.length) {
    return {
      ...state,
      response: content,
      artifacts: []
    };
  }

  return {
    ...state,

    response: buildSummary(state.prompt, files),

    artifacts: [
      {
        id: Date.now(),
        type: "project",
        title: state.prompt,
        files,
        createdAt: new Date().toISOString()
      }
    ]
  };
};
