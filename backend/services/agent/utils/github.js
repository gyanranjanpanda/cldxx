import JSZip from "jszip";

const GITHUB_API = "https://api.github.com";

// Dependencies, build output and VCS internals dwarf the actual source. Left in,
// they dominate retrieval and every answer comes back quoting node_modules.
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".github", "dist", "build", "out", "target",
  "vendor", "coverage", ".next", ".nuxt", ".venv", "venv", "__pycache__",
  ".idea", ".vscode", "bin", "obj", ".cache", "tmp"
]);

// Lockfiles are huge and carry nothing a person would ask about.
const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "composer.lock",
  "Gemfile.lock", "poetry.lock", "Cargo.lock", "go.sum", ".DS_Store"
]);

const SKIP_EXT =
  /\.(png|jpe?g|gif|bmp|ico|svg|webp|avif|mp[34]|wav|ogg|mov|avi|webm|pdf|zip|tar|gz|bz2|7z|rar|woff2?|ttf|otf|eot|exe|dll|so|dylib|class|jar|wasm|db|sqlite3?|pyc|map)$|\.min\.(js|css)$/i;

// Caps exist because embedding is metered: the free Gemini tier allows 100
// requests a minute, and an unbounded repo would burn a user's whole credit
// balance on a single question.
export const LIMITS = {
  fileBytes: 100 * 1024,
  totalBytes: 2 * 1024 * 1024,
  files: 400
};

const authHeaders = () => {
  const headers = {
    Accept: "application/vnd.github+json",
    // GitHub rejects API calls that do not identify themselves.
    "User-Agent": "cldxAI"
  };

  // Optional: lifts the rate limit from 60/hr to 5000/hr, and unlocks private repos.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
};

export const parseRepoUrl = (text = "") => {
  const match = String(text).match(
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|\s|$)/i
  );

  if (!match) return null;

  return { owner: match[1], repo: match[2] };
};

class GithubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const fetchRepoMeta = async (owner, repo) => {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: authHeaders()
  });

  if (res.status === 404) {
    throw new GithubError(
      `Repository ${owner}/${repo} was not found. If it is private, the server needs a GITHUB_TOKEN with access to it.`,
      404
    );
  }

  if (res.status === 403) {
    throw new GithubError(
      "GitHub's rate limit is exhausted. Set GITHUB_TOKEN on the server to raise it, or try again later.",
      403
    );
  }

  if (!res.ok) {
    throw new GithubError(`GitHub returned ${res.status} for ${owner}/${repo}.`, res.status);
  }

  const data = await res.json();

  const commitRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=1&sha=${data.default_branch}`,
    { headers: authHeaders() }
  );

  const commits = commitRes.ok ? await commitRes.json() : [];

  return {
    owner: data.owner?.login || owner,
    repo: data.name || repo,
    defaultBranch: data.default_branch,
    description: data.description || "",
    language: data.language || "",
    // Falling back to the branch name still fetches correctly; it only means the
    // cache key stops changing per commit, so an index could go stale.
    sha: commits?.[0]?.sha || data.default_branch
  };
};

const shouldSkip = (relPath) => {
  const parts = relPath.split("/");
  const name = parts[parts.length - 1];

  if (parts.slice(0, -1).some((dir) => SKIP_DIRS.has(dir))) return true;
  if (SKIP_FILES.has(name)) return true;
  if (SKIP_EXT.test(name)) return true;

  // Dotfiles are mostly tooling config, but a few are worth reading.
  if (name.startsWith(".") && !/^\.(env\.example|gitignore|dockerignore|nvmrc)$/i.test(name)) {
    return true;
  }

  return false;
};

// One zipball request rather than one API call per file: unauthenticated GitHub
// allows 60 calls an hour, so per-file fetching fails on any real repository.
export const fetchRepoFiles = async (owner, repo, ref) => {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/zipball/${ref}`, {
    headers: authHeaders()
  });

  if (!res.ok) {
    throw new GithubError(`Could not download ${owner}/${repo} (HTTP ${res.status}).`, res.status);
  }

  const zip = await JSZip.loadAsync(await res.arrayBuffer());

  const files = [];
  const allPaths = [];
  let totalBytes = 0;
  let truncated = false;

  // Zipball entries are all nested under "<owner>-<repo>-<sha7>/".
  const entries = Object.values(zip.files).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  for (const entry of entries) {
    if (entry.dir) continue;

    const relPath = entry.name.split("/").slice(1).join("/");
    if (!relPath) continue;

    if (shouldSkip(relPath)) continue;

    allPaths.push(relPath);

    if (files.length >= LIMITS.files || totalBytes >= LIMITS.totalBytes) {
      truncated = true;
      continue;
    }

    const content = await entry.async("string");

    if (!content.trim()) continue;

    if (content.length > LIMITS.fileBytes) {
      truncated = true;
      continue;
    }

    // A NUL byte means the extension list missed a binary file.
    if (content.includes("\u0000")) continue;

    files.push({ path: relPath, content });
    totalBytes += content.length;
  }

  return { files, allPaths, totalBytes, truncated };
};
