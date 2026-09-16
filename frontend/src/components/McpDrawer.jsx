import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Plus, RefreshCw, Plug, Hammer, Trash2, Settings2, Check,
  Loader2, AlertCircle, Globe, Terminal, Radio, ChevronLeft
} from "lucide-react";
import {
  getMcpServers, createMcpServer, updateMcpServer,
  toggleMcpServer, deleteMcpServer, checkMcpHealth
} from "../features/mcp.api";

const TRANSPORTS = [
  { id: "http",  label: "Remote (HTTP)", icon: Globe,    hint: "Streamable HTTP — what most hosted MCP servers speak" },
  { id: "sse",   label: "Remote (SSE)",  icon: Radio,    hint: "Older transport, still used by some servers" },
  { id: "stdio", label: "Local process", icon: Terminal, hint: "A command the agent host spawns and talks to over stdio" }
];

const blankDraft = () => ({
  name: "",
  transport: "http",
  url: "",
  command: "",
  args: "",
  headers: [],
  env: [],
  enabled: true
});

// The server never sends secret values back, so an edit form starts with the
// key names and empty values; leaving one blank keeps what is stored.
const draftFrom = (server) => ({
  _id:       server._id,
  name:      server.name,
  transport: server.transport,
  url:       server.url || "",
  command:   server.command || "",
  args:      (server.args || []).join(" "),
  headers:   (server.headers || []).map((h) => ({ key: h.key, value: "", hasValue: h.hasValue })),
  env:       (server.env || []).map((e) => ({ key: e.key, value: "", hasValue: e.hasValue })),
  enabled:   server.enabled
});

const errorMessage = (error) =>
  error?.response?.data?.message || error?.message || "Something went wrong";

/* ── Key/value editor used for both HTTP headers and process env ── */
function PairEditor({ label, hint, pairs, onChange }) {

  const update = (index, patch) =>
    onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[12px] font-medium text-slate-300">{label}</label>
        <button
          type="button"
          onClick={() => onChange([...pairs, { key: "", value: "" }])}
          className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer"
        >
          + Add
        </button>
      </div>

      {pairs.length === 0 ? (
        <p className="text-[11.5px] text-slate-600">{hint}</p>
      ) : (
        pairs.map((pair, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={pair.key}
              onChange={(e) => update(i, { key: e.target.value })}
              placeholder="Name"
              className="w-[38%] px-2.5 h-[34px] rounded-lg bg-white/[0.04] border border-white/[0.08] outline-none text-[12.5px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/40"
            />
            <input
              value={pair.value}
              onChange={(e) => update(i, { value: e.target.value })}
              type="password"
              placeholder={pair.hasValue ? "•••••• (unchanged)" : "Value"}
              className="flex-1 min-w-0 px-2.5 h-[34px] rounded-lg bg-white/[0.04] border border-white/[0.08] outline-none text-[12.5px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/40"
            />
            <button
              type="button"
              onClick={() => onChange(pairs.filter((_, index) => index !== i))}
              className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg border-none bg-transparent text-slate-600 hover:text-red-400 hover:bg-white/[0.06] cursor-pointer"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

/* ── One configured server ── */
function ServerCard({ server, busy, onToggle, onCheck, onEdit, onDelete }) {

  const [confirming, setConfirming] = useState(false);
  const state = server.status?.state || "unknown";

  const dot = state === "ok"    ? "bg-emerald-400"
            : state === "error" ? "bg-red-400"
            :                     "bg-slate-600";

  const Icon = server.transport === "stdio" ? Terminal
             : server.transport === "sse"   ? Radio
             :                                Globe;

  return (
    <div className={`rounded-xl border p-3.5 transition-colors duration-150
      ${server.enabled
        ? "bg-indigo-500/[0.06] border-indigo-500/20"
        : "bg-white/[0.02] border-white/[0.07]"}`}>

      <div className="flex items-start gap-2.5">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.05] shrink-0">
          <Icon size={14} className="text-slate-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
            <h4 className="text-[13.5px] font-semibold text-slate-100 truncate">{server.name}</h4>
          </div>
          <p className="text-[11.5px] text-slate-500 truncate mt-0.5" title={server.url || server.command}>
            {server.transport === "stdio"
              ? [server.command, ...(server.args || [])].join(" ")
              : server.url}
          </p>
        </div>

        {/* Enable switch — a disabled server keeps its config but is not offered to the model */}
        <button
          onClick={() => onToggle(server)}
          disabled={busy}
          title={server.enabled ? "Enabled" : "Disabled"}
          className={`relative w-[34px] h-[19px] rounded-full shrink-0 border-none cursor-pointer transition-colors duration-150 disabled:opacity-50
            ${server.enabled ? "bg-indigo-500" : "bg-white/[0.14]"}`}
        >
          <span className={`absolute top-[2.5px] w-[14px] h-[14px] rounded-full bg-white transition-all duration-150
            ${server.enabled ? "left-[17px]" : "left-[2.5px]"}`} />
        </button>
      </div>

      {state === "error" && server.status?.error && (
        <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-red-400/90">
          <AlertCircle size={12} className="shrink-0 mt-px" />
          <span className="min-w-0 break-words">{server.status.error}</span>
        </p>
      )}

      {state === "ok" && (
        <p className="mt-2 text-[11.5px] text-emerald-400/80">
          {server.status.toolCount} tool{server.status.toolCount === 1 ? "" : "s"} available
          {server.tools?.length > 0 && (
            <span className="text-slate-600"> — {server.tools.slice(0, 3).map((t) => t.name).join(", ")}
              {server.tools.length > 3 ? "…" : ""}</span>
          )}
        </p>
      )}

      <div className="flex items-center gap-1.5 mt-3">
        <button
          onClick={() => onCheck(server)}
          disabled={busy}
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-300 bg-white/[0.05] border border-white/[0.07] px-2.5 h-[27px] rounded-lg hover:bg-white/[0.09] cursor-pointer disabled:opacity-50 transition-colors duration-150"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Health Check
        </button>

        <button
          onClick={() => onEdit(server)}
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-300 bg-white/[0.05] border border-white/[0.07] px-2.5 h-[27px] rounded-lg hover:bg-white/[0.09] cursor-pointer transition-colors duration-150"
        >
          <Settings2 size={11} />
          Settings
        </button>

        {confirming ? (
          <span className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => { onDelete(server); setConfirming(false); }}
              className="flex items-center justify-center w-[27px] h-[27px] rounded-lg border-none bg-red-500/15 text-red-400 hover:bg-red-500/25 cursor-pointer"
            >
              <Check size={12} />
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="flex items-center justify-center w-[27px] h-[27px] rounded-lg border-none bg-white/[0.06] text-slate-400 hover:bg-white/[0.12] cursor-pointer"
            >
              <X size={12} />
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            title="Remove server"
            className="ml-auto flex items-center justify-center w-[27px] h-[27px] rounded-lg border-none bg-transparent text-slate-600 hover:text-red-400 hover:bg-white/[0.06] cursor-pointer transition-colors duration-150"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function McpDrawer({ open, onClose }) {

  const [servers, setServers]           = useState([]);
  const [stdioAllowed, setStdioAllowed] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [checkingId, setCheckingId]     = useState(null);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState("");
  const [draft, setDraft]               = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getMcpServers();
      setServers(data.servers || []);
      setStdioAllowed(Boolean(data.stdioAllowed));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetching when the drawer opens is the point; the spinner it sets is what
    // the rule objects to, and there is nothing to cascade into here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load();
  }, [open, load]);

  // Esc closes the form first, then the drawer -- closing the whole thing on a
  // half-filled form loses the work.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (draft) setDraft(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, draft, onClose]);

  const runCheck = async (server) => {
    setCheckingId(server?._id || "all");
    setError("");
    try {
      await checkMcpHealth(server?._id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCheckingId(null);
    }
  };

  const handleToggle = async (server) => {
    // Optimistic: the switch has to feel instant, and a failure re-syncs below.
    setServers(list => list.map(s => s._id === server._id ? { ...s, enabled: !s.enabled } : s));
    try {
      await toggleMcpServer(server._id, !server.enabled);
    } catch (err) {
      setError(errorMessage(err));
      load();
    }
  };

  const handleDelete = async (server) => {
    setServers(list => list.filter(s => s._id !== server._id));
    try {
      await deleteMcpServer(server._id);
    } catch (err) {
      setError(errorMessage(err));
      load();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        name:      draft.name.trim(),
        transport: draft.transport,
        url:       draft.url.trim(),
        command:   draft.command.trim(),
        // A shell-style arg string is what people paste; the API wants a list.
        args:      draft.args.trim() ? draft.args.trim().split(/\s+/) : [],
        headers:   draft.headers.filter(p => p.key.trim()),
        env:       draft.env.filter(p => p.key.trim()),
        enabled:   draft.enabled
      };

      const saved = draft._id
        ? await updateMcpServer(draft._id, payload)
        : await createMcpServer(payload);

      setDraft(null);
      await load();
      // Connecting straight away means the card shows real state instead of
      // "unknown" until the user thinks to press Health Check.
      runCheck(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const isRemote   = draft?.transport !== "stdio";
  const enabledCount = servers.filter(s => s.enabled).length;
  const transports = TRANSPORTS.filter(t => t.id !== "stdio" || stdioAllowed);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[720px] max-h-[86vh] flex flex-col rounded-2xl bg-[#111318] border border-white/[0.08] shadow-2xl shadow-black/50 overflow-hidden"
          >

            {/* Header */}
            <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex-1 min-w-0">
                <h2 className="text-[18px] font-semibold text-slate-100 tracking-tight">
                  {draft ? (draft._id ? "Edit server" : "Add MCP server") : "MCP Servers"}
                </h2>
                <p className="text-[12.5px] text-slate-500 mt-0.5">
                  {draft
                    ? "Connect a local process or a remote endpoint."
                    : "Connect MCP servers to extend cldxAI with external tools."}
                </p>
              </div>

              {draft && (
                <button
                  onClick={() => setDraft(null)}
                  className="flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200 bg-transparent border-none cursor-pointer"
                >
                  <ChevronLeft size={14} /> Back
                </button>
              )}

              <button
                onClick={onClose}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] bg-transparent border-none cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {error && (
              <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                <AlertCircle size={13} className="text-red-400 shrink-0 mt-px" />
                <p className="text-[12px] text-red-300 min-w-0 break-words">{error}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-5 [scrollbar-width:thin]">

              {draft ? (
                /* ── Add / edit form ── */
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-slate-300">Name</label>
                    <input
                      autoFocus
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="My tools"
                      className="w-full px-3 h-[38px] rounded-lg bg-white/[0.04] border border-white/[0.08] outline-none text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/40"
                    />
                    <p className="text-[11px] text-slate-600">Used to namespace its tools, so keep it short.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[12px] font-medium text-slate-300">Transport</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {transports.map((t) => {
                        const Icon = t.icon;
                        const active = draft.transport === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setDraft({ ...draft, transport: t.id })}
                            title={t.hint}
                            className={`flex items-center gap-2 px-3 h-[38px] rounded-lg border cursor-pointer text-[12.5px] font-medium transition-colors duration-150
                              ${active
                                ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-200"
                                : "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:bg-white/[0.06]"}`}
                          >
                            <Icon size={13} />
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                    {!stdioAllowed && (
                      <p className="text-[11px] text-slate-600">
                        Local servers are disabled on this deployment — set MCP_ALLOW_STDIO=true to enable them.
                      </p>
                    )}
                  </div>

                  {isRemote ? (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-slate-300">Server URL</label>
                        <input
                          value={draft.url}
                          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                          placeholder="https://mcp.example.com/mcp"
                          className="w-full px-3 h-[38px] rounded-lg bg-white/[0.04] border border-white/[0.08] outline-none text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/40"
                        />
                      </div>

                      <PairEditor
                        label="HTTP headers"
                        hint="Add an Authorization header if the server needs a token."
                        pairs={draft.headers}
                        onChange={(headers) => setDraft({ ...draft, headers })}
                      />
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-slate-300">Command</label>
                        <input
                          value={draft.command}
                          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                          placeholder="npx"
                          className="w-full px-3 h-[38px] rounded-lg bg-white/[0.04] border border-white/[0.08] outline-none text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/40"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-slate-300">Arguments</label>
                        <input
                          value={draft.args}
                          onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                          placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                          className="w-full px-3 h-[38px] rounded-lg bg-white/[0.04] border border-white/[0.08] outline-none text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/40"
                        />
                        <p className="text-[11px] text-slate-600">Separated by spaces. The process runs on the agent host.</p>
                      </div>

                      <PairEditor
                        label="Environment variables"
                        hint="Only what you add here is passed to the process, plus PATH."
                        pairs={draft.env}
                        onChange={(env) => setDraft({ ...draft, env })}
                      />
                    </>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleSave}
                      disabled={saving || !draft.name.trim()}
                      className="flex items-center gap-2 text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 px-4 h-[36px] rounded-lg border-none cursor-pointer disabled:opacity-50 transition-colors duration-150"
                    >
                      {saving && <Loader2 size={13} className="animate-spin" />}
                      {draft._id ? "Save changes" : "Add server"}
                    </button>
                    <button
                      onClick={() => setDraft(null)}
                      className="text-[13px] font-medium text-slate-400 bg-white/[0.05] border border-white/[0.08] px-4 h-[36px] rounded-lg hover:bg-white/[0.09] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* ── List ── */
                <div className="space-y-5">

                  <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.07] px-4 py-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 shrink-0">
                      <Plug size={16} className="text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-semibold text-slate-100">
                        {servers.length} server{servers.length === 1 ? "" : "s"} configured
                      </p>
                      <p className="text-[11.5px] text-slate-500">{enabledCount} enabled</p>
                    </div>

                    <button
                      onClick={() => runCheck(null)}
                      disabled={!servers.length || checkingId !== null}
                      className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-300 bg-white/[0.05] border border-white/[0.08] px-3 h-[34px] rounded-lg hover:bg-white/[0.09] cursor-pointer disabled:opacity-40 transition-colors duration-150"
                    >
                      {checkingId === "all"
                        ? <Loader2 size={12} className="animate-spin" />
                        : <RefreshCw size={12} />}
                      Refresh
                    </button>

                    <button
                      onClick={() => setDraft(blankDraft())}
                      className="flex items-center gap-1.5 text-[12.5px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 px-3 h-[34px] rounded-lg border-none cursor-pointer transition-colors duration-150"
                    >
                      <Plus size={13} />
                      Add Server
                    </button>
                  </div>

                  {loading ? (
                    <div className="flex items-center justify-center py-12 text-slate-500 gap-2">
                      <Loader2 size={15} className="animate-spin" />
                      <span className="text-[13px]">Loading servers…</span>
                    </div>
                  ) : servers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-12 rounded-xl border border-dashed border-white/[0.09]">
                      <Hammer size={30} className="text-slate-600" strokeWidth={1.4} />
                      <p className="text-[14px] font-semibold text-slate-300 mt-1">No servers yet</p>
                      <p className="text-[12.5px] text-slate-600">Add your own MCP servers with custom tools</p>
                      <button
                        onClick={() => setDraft(blankDraft())}
                        className="flex items-center gap-1.5 mt-2 text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 px-4 h-[36px] rounded-lg border-none cursor-pointer transition-colors duration-150"
                      >
                        <Plus size={14} />
                        Add Your First Server
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {servers.map((server) => (
                        <ServerCard
                          key={server._id}
                          server={server}
                          busy={checkingId === server._id || checkingId === "all"}
                          onToggle={handleToggle}
                          onCheck={runCheck}
                          onEdit={(s) => setDraft(draftFrom(s))}
                          onDelete={handleDelete}
                        />
                      ))}
                    </div>
                  )}

                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3.5">
                    <p className="text-[12.5px] font-semibold text-slate-300 mb-2">💡 Quick tips</p>
                    <ul className="space-y-1 text-[11.5px] text-slate-500 leading-relaxed">
                      <li>• Only connect to servers you trust — their tools run with your agent's access.</li>
                      <li>• Enable a server to make its tools available in chat.</li>
                      <li>• Use Health Check to confirm connectivity and see what tools it exposes.</li>
                      <li>• Add HTTP headers for authentication when a remote server needs a token.</li>
                    </ul>
                  </div>

                </div>
              )}
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
