import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Link2, Copy, Check, Trash2, Loader2, AlertCircle,
  Eye, MessageSquare, Clock
} from "lucide-react";
import { createInvite, listInvites, revokeInvite } from "../features/invite.api";

const EXPIRY_CHOICES = [
  { hours: 1,   label: "1 hour" },
  { hours: 24,  label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" }
];

const MODES = [
  {
    id: "read",
    icon: Eye,
    label: "Read only",
    blurb: "They can read this conversation. Nothing else."
  },
  {
    id: "reply",
    icon: MessageSquare,
    label: "Read and reply",
    blurb: "They can also ask follow-ups — answered on your credits."
  }
];

const errorMessage = (error) =>
  error?.response?.data?.message || error?.message || "Something went wrong";

const remaining = (expiresAt) => {

  const ms = new Date(expiresAt).getTime() - Date.now();

  if (ms <= 0) return "expired";

  const hours = Math.floor(ms / 3_600_000);

  if (hours >= 24) return `${Math.floor(hours / 24)}d left`;
  if (hours >= 1)  return `${hours}h left`;

  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
};

export default function ShareDialog({ open, onClose, conversation }) {

  const [invites, setInvites]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError]       = useState("");
  const [mode, setMode]         = useState("read");
  const [hours, setHours]       = useState(24);
  const [allowance, setAllowance] = useState(20);
  // The token exists exactly once, in the creation response. Losing it means
  // making a new link, so it stays on screen until dismissed.
  const [freshLink, setFreshLink] = useState(null);
  const [copied, setCopied]     = useState(false);

  const conversationId = conversation?._id;

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      setInvites(await listInvites(conversationId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!open) return;
    // Resetting on open is the point: a stale link from a previous session must
    // not still be on screen, and the list has to be refetched.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFreshLink(null);
    setError("");
    load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const data = await createInvite({
        conversationId,
        mode,
        ttlHours: hours,
        maxGuestMessages: mode === "reply" ? Number(allowance) || 0 : 0
      });
      setFreshLink(`${window.location.origin}/shared/${data.token}`);
      setCopied(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(freshLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (invite) => {
    setInvites(list => list.map(i => i._id === invite._id ? { ...i, active: false, revokedAt: new Date() } : i));
    try {
      await revokeInvite(invite._id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
      load();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
            className="w-full max-w-[560px] max-h-[86vh] flex flex-col rounded-2xl bg-[#111318] border border-white/[0.08] shadow-2xl shadow-black/50 overflow-hidden"
          >

            <div className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-white/[0.06]">
              <div className="flex-1 min-w-0">
                <h2 className="text-[18px] font-semibold text-slate-100 tracking-tight">Share this chat</h2>
                <p className="text-[12.5px] text-slate-500 mt-0.5 truncate">
                  Anyone with the link sees only “{conversation?.title || "this conversation"}”.
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

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 [scrollbar-width:thin]">

              {freshLink ? (
                <div className="rounded-xl bg-indigo-500/[0.08] border border-indigo-500/25 p-4 space-y-2.5">
                  <p className="text-[13px] font-semibold text-indigo-200">Link ready</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={freshLink}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 min-w-0 px-3 h-[36px] rounded-lg bg-black/30 border border-white/[0.09] outline-none text-[12px] text-slate-200 font-mono"
                    />
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 shrink-0 text-[12.5px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 px-3 h-[36px] rounded-lg border-none cursor-pointer"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-[11.5px] text-slate-500">
                    Copy it now — this is the only time the link is shown. You can always create another.
                  </p>
                  <button
                    onClick={() => setFreshLink(null)}
                    className="text-[12px] text-slate-400 hover:text-slate-200 bg-transparent border-none cursor-pointer p-0"
                  >
                    Create another link
                  </button>
                </div>
              ) : (
                <div className="space-y-4">

                  <div className="space-y-2">
                    <label className="text-[12px] font-medium text-slate-300">What can they do?</label>
                    {MODES.map((option) => {
                      const Icon = option.icon;
                      const active = mode === option.id;
                      return (
                        <button
                          key={option.id}
                          onClick={() => setMode(option.id)}
                          className={`w-full flex items-start gap-3 px-3.5 py-3 rounded-xl border text-left cursor-pointer transition-colors duration-150
                            ${active
                              ? "bg-indigo-500/[0.10] border-indigo-500/35"
                              : "bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.06]"}`}
                        >
                          <Icon size={15} className={`shrink-0 mt-0.5 ${active ? "text-indigo-300" : "text-slate-500"}`} />
                          <span className="flex-1 min-w-0">
                            <span className={`block text-[13px] font-medium ${active ? "text-slate-100" : "text-slate-300"}`}>
                              {option.label}
                            </span>
                            <span className="block text-[11.5px] text-slate-500 mt-0.5">{option.blurb}</span>
                          </span>
                          <span className={`shrink-0 w-4 h-4 rounded-full border mt-0.5
                            ${active ? "border-indigo-400 bg-indigo-500" : "border-white/20"}`} />
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[12px] font-medium text-slate-300">Expires after</label>
                    <div className="grid grid-cols-4 gap-2">
                      {EXPIRY_CHOICES.map((choice) => (
                        <button
                          key={choice.hours}
                          onClick={() => setHours(choice.hours)}
                          className={`h-[34px] rounded-lg border text-[12.5px] font-medium cursor-pointer transition-colors duration-150
                            ${hours === choice.hours
                              ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-200"
                              : "bg-white/[0.03] border-white/[0.07] text-slate-400 hover:bg-white/[0.06]"}`}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Only meaningful for reply links: this is the cap on how much
                      of the owner's balance a guest can spend. */}
                  {mode === "reply" && (
                    <div className="space-y-1.5">
                      <label className="text-[12px] font-medium text-slate-300">Reply limit</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="200"
                          value={allowance}
                          onChange={(e) => setAllowance(e.target.value)}
                          className="w-[90px] px-3 h-[36px] rounded-lg bg-white/[0.04] border border-white/[0.08] outline-none text-[13px] text-slate-200 focus:border-indigo-500/40"
                        />
                        <span className="text-[11.5px] text-slate-500">
                          messages, then the link becomes read-only. Replies run on your credits.
                        </span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleCreate}
                    disabled={creating || !conversationId}
                    className="w-full flex items-center justify-center gap-2 text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-500 h-[38px] rounded-lg border-none cursor-pointer disabled:opacity-50 transition-colors duration-150"
                  >
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                    Create link
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-widest text-slate-600">
                  Active links
                </p>

                {loading ? (
                  <div className="flex items-center gap-2 text-slate-500 py-3">
                    <Loader2 size={13} className="animate-spin" />
                    <span className="text-[12.5px]">Loading…</span>
                  </div>
                ) : invites.length === 0 ? (
                  <p className="text-[12px] text-slate-600 py-2">No links yet.</p>
                ) : (
                  invites.map((invite) => (
                    <div
                      key={invite._id}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border
                        ${invite.active
                          ? "bg-white/[0.03] border-white/[0.07]"
                          : "bg-white/[0.01] border-white/[0.05] opacity-55"}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${invite.active ? "bg-emerald-400" : "bg-slate-600"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] text-slate-200">
                          {invite.mode === "reply" ? "Read and reply" : "Read only"}
                          {invite.mode === "reply" && (
                            <span className="text-slate-500">
                              {" "}· {invite.guestMessageCount}/{invite.maxGuestMessages} used
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                          <Clock size={10} />
                          {invite.revokedAt ? "revoked" : remaining(invite.expiresAt)}
                          {invite.useCount > 0 && ` · opened ${invite.useCount}×`}
                        </p>
                      </div>
                      {invite.active && (
                        <button
                          onClick={() => handleRevoke(invite)}
                          title="Revoke this link"
                          className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg border-none bg-transparent text-slate-600 hover:text-red-400 hover:bg-white/[0.06] cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
