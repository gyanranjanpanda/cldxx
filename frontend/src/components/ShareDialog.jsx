import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Link2, Copy, Check, Trash2, Loader2, AlertCircle,
  Eye, MessageSquare, Clock, Share2
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

  // wa.me works on desktop web, the WhatsApp desktop app and mobile alike, so
  // one URL covers every place the owner might be when they share.
  const shareText = (link) =>
    `Here's an AI conversation I want you to see: "${conversation?.title || "a chat"}"\n\n${link}`;

  const handleWhatsApp = () => {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(shareText(freshLink))}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  // Phones and newer desktop browsers can hand the link to any installed app.
  // Undefined elsewhere, so the button only appears where it works.
  const canNativeShare = typeof navigator !== "undefined" && Boolean(navigator.share);

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: conversation?.title || "Shared chat",
        text: shareText(freshLink)
      });
    } catch {
      // The user dismissed the sheet; nothing to report.
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

  // Rendered into document.body rather than in place. Navbar lives inside
  // ChatArea's `relative z-10` wrapper, which opens a stacking context -- the
  // modal's own z-index only competed inside it, so the message list (a later
  // sibling at the same level) painted straight over the dialog and its
  // backdrop. A portal takes it out of that context entirely.
  return createPortal(
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
                      title="Copy link"
                      className="flex items-center gap-1.5 shrink-0 text-[12.5px] font-medium text-slate-200 bg-white/[0.07] border border-white/[0.09] px-3 h-[36px] rounded-lg cursor-pointer hover:bg-white/[0.12] transition-colors duration-150"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleWhatsApp}
                      className="flex-1 flex items-center justify-center gap-2 text-[13px] font-medium text-white bg-[#25D366] hover:bg-[#1eb855] h-[36px] rounded-lg border-none cursor-pointer transition-colors duration-150"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.898 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                      </svg>
                      Send on WhatsApp
                    </button>

                    {canNativeShare && (
                      <button
                        onClick={handleNativeShare}
                        title="Share another way"
                        className="flex items-center justify-center shrink-0 w-[36px] h-[36px] rounded-lg border border-white/[0.09] bg-white/[0.05] text-slate-300 cursor-pointer hover:bg-white/[0.1] transition-colors duration-150"
                      >
                        <Share2 size={14} />
                      </button>
                    )}
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
    </AnimatePresence>,
    document.body
  );
}
