import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, KeyRound, Trash2, Check, Loader2, AlertCircle, ShieldCheck, ExternalLink
} from "lucide-react";

import {
  getKeyProviders,
  getUserKeys,
  saveUserKey,
  toggleUserKey,
  deleteUserKey
} from "../features/keys.api";

const errorMessage = (error) =>
  error?.response?.data?.message || error?.message || "Something went wrong";

// Where a user actually goes to mint each key. Linking beats describing: the
// most common reason a key never gets pasted is not knowing where it lives.
const CONSOLES = {
  groq:     "https://console.groq.com/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  google:   "https://aistudio.google.com/apikey",
  tavily:   "https://app.tavily.com"
};

export default function ApiKeysDrawer({ open, onClose }) {

  const [providers, setProviders] = useState([]);
  const [keys, setKeys]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");

  // Which provider's input is open, and what has been typed into it. Held as
  // one object rather than per-provider state so only one key is ever in
  // memory at a time.
  const [entry, setEntry]   = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, stored] = await Promise.all([getKeyProviders(), getUserKeys()]);
      setProviders(list);
      setKeys(stored);
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

  // Escape backs out of a key entry first, then closes the drawer -- so a
  // half-typed key is never left sitting in state behind a closed dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (entry) setEntry(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, entry, onClose]);

  const stored = (id) => keys.find((k) => k.provider === id);

  const save = async (provider) => {
    const value = (entry?.value || "").trim();
    if (!value) return;

    setSaving(true);
    setError("");
    try {
      const result = await saveUserKey(provider, value);
      // Clear the typed key from component state the moment it is stored.
      setEntry(null);
      await load();
      if (!result.verified) {
        setError(result.key?.status?.error || "The key was saved but could not be verified.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (provider, enabled) => {
    try {
      await toggleUserKey(provider, enabled);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (provider) => {
    try {
      await deleteUserKey(provider);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

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
            className="w-full max-w-[640px] max-h-[86vh] flex flex-col rounded-2xl bg-[#111318] border border-white/[0.08] shadow-2xl shadow-black/50 overflow-hidden"
          >

            <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex-1 min-w-0">
                <h2 className="text-[18px] font-semibold text-slate-100 tracking-tight">
                  Your API keys
                </h2>
                <p className="text-[12.5px] text-slate-500 mt-0.5">
                  Bring your own provider key and cldxAI will use it instead of ours.
                </p>
              </div>
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

            <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/15 px-3 py-2.5">
              <ShieldCheck size={13} className="text-emerald-400 shrink-0 mt-px" />
              <p className="text-[12px] text-emerald-200/80 min-w-0">
                Keys are encrypted before they are stored and are never sent back to
                your browser. Only the last four characters are shown.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 [scrollbar-width:thin]">

              {loading ? (
                <div className="flex items-center gap-2 text-[13px] text-slate-500 py-6 justify-center">
                  <Loader2 size={14} className="animate-spin" /> Loading…
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {providers.map((provider) => {

                    const existing = stored(provider.id);
                    const editing  = entry?.provider === provider.id;

                    return (
                      <div
                        key={provider.id}
                        className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3.5"
                      >
                        <div className="flex items-center gap-3">
                          <KeyRound size={15} className="shrink-0 text-slate-400" />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13.5px] font-medium text-slate-200">
                                {provider.label}
                              </span>

                              {existing && existing.status?.state === "ok" && (
                                <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-px rounded-full">
                                  <Check size={9} /> Verified
                                </span>
                              )}

                              {existing && existing.status?.state === "error" && (
                                <span className="text-[10.5px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-px rounded-full">
                                  Unverified
                                </span>
                              )}
                            </div>

                            <p className="text-[11.5px] text-slate-500 mt-0.5 break-words">
                              {existing
                                ? `Using your key ····${existing.last4}`
                                : provider.hint}
                            </p>
                          </div>

                          {existing ? (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => toggle(provider.id, !existing.enabled)}
                                className="text-[11.5px] text-slate-400 hover:text-slate-200 bg-transparent border-none cursor-pointer"
                              >
                                {existing.enabled ? "Disable" : "Enable"}
                              </button>
                              <button
                                onClick={() => remove(provider.id)}
                                aria-label={`Remove ${provider.label} key`}
                                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 bg-transparent border-none cursor-pointer"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEntry({ provider: provider.id, value: "" })}
                              className="shrink-0 text-[12px] font-medium text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer"
                            >
                              Add key
                            </button>
                          )}
                        </div>

                        {editing && (
                          <div className="mt-3 flex flex-col gap-2">
                            <input
                              autoFocus
                              type="password"
                              autoComplete="off"
                              spellCheck={false}
                              value={entry.value}
                              placeholder={`Paste your ${provider.label} key`}
                              onChange={(e) => setEntry({ ...entry, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") save(provider.id);
                                if (e.key === "Escape") setEntry(null);
                              }}
                              className="w-full rounded-lg bg-black/30 border border-white/[0.09] px-3 py-2 text-[13px] text-slate-200 outline-none focus:border-indigo-500/50"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                disabled={saving || !entry.value.trim()}
                                onClick={() => save(provider.id)}
                                className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-[12.5px] font-medium text-white border-none cursor-pointer"
                              >
                                {saving ? "Checking…" : "Save key"}
                              </button>
                              <button
                                onClick={() => setEntry(null)}
                                className="rounded-lg bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 text-[12.5px] text-slate-300 border-none cursor-pointer"
                              >
                                Cancel
                              </button>
                              {CONSOLES[provider.id] && (
                                <a
                                  href={CONSOLES[provider.id]}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-slate-500 hover:text-slate-300 no-underline"
                                >
                                  Get a key <ExternalLink size={10} />
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-[11.5px] text-slate-600 mt-5 leading-relaxed">
                When a key is set, requests to that provider are billed to your account
                instead of ours. Remove it at any time and cldxAI goes back to its own.
                Sovereign Mode never uses these keys — it answers entirely on your
                own hardware.
              </p>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
