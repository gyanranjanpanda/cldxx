import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// The PDF renderer claimed to emit "self-contained HTML" while pulling fonts
// from Google, Prism from Cloudflare and Mermaid from jsDelivr. Every document
// render therefore opened three outbound connections from inside the service --
// a headless Chrome reaching the internet while rendering a confidential report
// is exactly the egress Sovereign Mode exists to prevent, and it is the kind of
// leak that survives an application-level policy check because no model is
// involved.
//
// Every one of those assets was already an npm dependency. They are read from
// node_modules and inlined, so the page Chrome loads has no external reference
// left and the renderer works in an air-gapped install.

const cache = new Map();

const read =
(key, loader)=>{

 if(!cache.has(key)){

  try{

   cache.set(key, loader());

  }catch(error){

   // A missing asset must not take document generation down -- the PDF is
   // still readable without syntax colours. Staying silent would be worse:
   // the failure would look like a styling bug months later.
   console.warn(
    `[localAssets] ${key} unavailable (${error.message}); rendering without it.`
   );

   cache.set(key, "");

  }

 }

 return cache.get(key);

};

const dataUri =
(file)=>
 `data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}`;

// Only the latin subsets are embedded. Shipping every subset fontsource
// publishes would add megabytes to a document whose text is already latin.
const face =
(pkg, family, weight, style = "normal")=>{

 const dir =
 path.join(
  path.dirname(
   require.resolve(`${pkg}/package.json`)
  ),
  "files"
 );

 const file =
 path.join(
  dir,
  `${pkg.split("/")[1]}-latin-${weight}-${style}.woff2`
 );

 return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(${dataUri(file)}) format('woff2');}`;

};

export const fontCss =
()=>
 read("fonts", ()=>
  [
   face("@fontsource/inter", "Inter", 400),
   face("@fontsource/inter", "Inter", 500),
   face("@fontsource/inter", "Inter", 600),
   face("@fontsource/inter", "Inter", 700),
   face("@fontsource/sora", "Sora", 600),
   face("@fontsource/sora", "Sora", 700),
   face("@fontsource/sora", "Sora", 800),
   face("@fontsource/jetbrains-mono", "JetBrains Mono", 400),
   face("@fontsource/jetbrains-mono", "JetBrains Mono", 500)
  ].join("\n")
 );

const prismDir =
()=>
 path.dirname(
  require.resolve("prismjs/package.json")
 );

export const prismCss =
()=>
 read("prism-css", ()=>
  fs.readFileSync(
   path.join(prismDir(), "themes/prism-tomorrow.min.css"),
   "utf8"
  )
 );

export const prismJs =
()=>
 read("prism-js", ()=>{

  const base = prismDir();

  // Prism's core must be evaluated before any component registers against it,
  // so the order here is load-bearing.
  const files = [
   "prism.js",
   "components/prism-javascript.min.js",
   "components/prism-typescript.min.js",
   "components/prism-python.min.js",
   "components/prism-sql.min.js",
   "components/prism-bash.min.js",
   "components/prism-json.min.js",
   "components/prism-yaml.min.js"
  ];

  // Prism highlights on DOMContentLoaded by default. That race is already won
  // by the time Puppeteer waits for network idle, but the flag is set anyway
  // so highlighting is driven explicitly below.
  return [
   "window.Prism = window.Prism || {}; window.Prism.manual = true;",
   ...files.map((f)=>
    fs.readFileSync(path.join(base, f), "utf8")
   ),
   "Prism.highlightAll();"
  ].join("\n;\n");

 });

export const mermaidJs =
()=>
 read("mermaid", ()=>
  // The UMD build is one self-contained file. The ESM entry point is only 32KB
  // because it lazily imports its chunks over the network, which would put the
  // CDN dependency straight back.
  fs.readFileSync(
   path.join(
    path.dirname(require.resolve("mermaid/package.json")),
    "dist/mermaid.min.js"
   ),
   "utf8"
  )
 );
