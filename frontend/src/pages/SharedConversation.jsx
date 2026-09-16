import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Send, Loader2, Eye, Clock, Link2Off, MessageSquare, Users } from "lucide-react";
import MessageBubble from "../components/MessageBubble";
import { getSharedConversation, sendSharedMessage } from "../features/invite.api";

// The guest view is a separate page on purpose. It renders no sidebar, reads no
// user state and imports nothing that fetches the owner's account -- a guest
// has no session, so anything that assumed one would 401 in their face.

const expiryText = (expiresAt) => {

  const ms = new Date(expiresAt).getTime() - Date.now();

  if (ms <= 0) return "expired";

  const hours = Math.floor(ms / 3_600_000);

  if (hours >= 24) return `expires in ${Math.floor(hours / 24)} day${hours >= 48 ? "s" : ""}`;
  if (hours >= 1)  return `expires in ${hours}h`;

  return `expires in ${Math.max(1, Math.floor(ms / 60_000))}m`;
};

function Unavailable({ message }) {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-3 bg-[#0d0f14] text-center px-6">
      <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
        <Link2Off size={22} className="text-slate-500" strokeWidth={1.5} />
      </div>
      <h1 className="text-[20px] font-semibold text-slate-200 tracking-tight">Link unavailable</h1>
      <p className="text-[13px] text-slate-500 max-w-[340px] leading-relaxed">{message}</p>
      <p className="text-[12px] text-slate-600 mt-1">Ask whoever shared it for a new link.</p>
    </div>
  );
}

export default function SharedConversation() {

  const { token } = useParams();

  const [state, setState]     = useState({ status: "loading" });
  const [value, setValue]     = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await getSharedConversation(token);
      setState({ status: "ready", ...data });
    } catch (error) {
      const body = error?.response?.data;
      setState({
        status: "error",
        message: body?.message || "This link could not be opened."
      });
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    requestAnimationFrame(() =>
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    );
  }, [state.messages?.length, sending]);

  const handleSend = async () => {

    const prompt = value.trim();

    if (!prompt || sending) return;

    setSending(true);
    setSendError("");
    setValue("");

    // Shown immediately; the server is the authority on what was stored, and
    // the reload below reconciles.
    setState(prev => ({
      ...prev,
      messages: [...(prev.messages || []), { role: "user", content: prompt, guest: true }]
    }));

    try {

      const data = await sendSharedMessage(token, prompt);

      setState(prev => ({
        ...prev,
        messages: [...(prev.messages || []), {
          role: "assistant",
          content: data.answer,
          images: data.images
        }],
        access: { ...prev.access, repliesLeft: data.repliesLeft }
      }));

    } catch (error) {
      setSendError(error?.response?.data?.message || "Could not send that message.");
      load();
    } finally {
      setSending(false);
    }

  };

  if (state.status === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0d0f14]">
        <Loader2 size={20} className="animate-spin text-slate-500" />
      </div>
    );
  }

  if (state.status === "error") return <Unavailable message={state.message} />;

  const canReply    = state.access?.mode === "reply";
  const repliesLeft = state.access?.repliesLeft ?? 0;
  const exhausted   = canReply && repliesLeft <= 0;

  return (
    <div className="h-screen flex flex-col bg-[#0d0f14] text-white overflow-hidden">

      <div className="shrink-0 flex items-center gap-2.5 px-5 h-14 border-b border-white/[0.06]">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 shrink-0">
          <MessageSquare size={13} className="text-indigo-400" />
        </div>
        <h1 className="text-[14px] font-semibold text-slate-100 tracking-tight truncate">
          {state.conversation?.title}
        </h1>
        <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-white/[0.04] border border-white/[0.07] px-2 py-0.5 rounded-full">
          <Users size={9} /> Shared
        </span>
        <span className="hidden sm:flex shrink-0 items-center gap-1 text-[10px] font-medium text-slate-500 bg-white/[0.03] border border-white/[0.06] px-2 py-0.5 rounded-full">
          {canReply ? <MessageSquare size={9} /> : <Eye size={9} />}
          {canReply ? "Read and reply" : "Read only"}
        </span>
        <span className="ml-auto shrink-0 flex items-center gap-1 text-[10.5px] text-slate-600">
          <Clock size={10} />
          {expiryText(state.access?.expiresAt)}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="max-w-[820px] mx-auto space-y-5">
          {(state.messages || []).map((message, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <MessageBubble
                role={message.role}
                content={message.content}
                images={message.images || []}
              />
            </motion.div>
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-[12.5px]">Thinking…</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-white/[0.06] px-6 py-4">
        <div className="max-w-[820px] mx-auto">

          {sendError && (
            <p className="text-[12px] text-red-400 mb-2">{sendError}</p>
          )}

          {canReply ? (
            <>
              <div className="flex items-end gap-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] px-4 py-3">
                <textarea
                  rows={1}
                  value={value}
                  disabled={exhausted || sending}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={exhausted ? "This link has used up its replies" : "Reply to this conversation…"}
                  className="flex-1 min-w-0 bg-transparent outline-none resize-none text-[14px] text-slate-200 placeholder:text-slate-600 leading-relaxed disabled:opacity-50 [scrollbar-width:none]"
                />
                <button
                  onClick={handleSend}
                  disabled={!value.trim() || sending || exhausted}
                  className="shrink-0 flex items-center justify-center w-8 h-8 rounded-xl border-none bg-indigo-600 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors duration-150"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
              <p className="text-[11px] text-slate-600 mt-2 text-center">
                {exhausted
                  ? "The reply limit for this link has been reached — you can still read the conversation."
                  : `${repliesLeft} ${repliesLeft === 1 ? "reply" : "replies"} left on this link.`}
              </p>
            </>
          ) : (
            <p className="text-[12px] text-slate-600 text-center flex items-center justify-center gap-1.5">
              <Eye size={12} />
              This is a read-only link — you can read this conversation but not reply.
            </p>
          )}

        </div>
      </div>
    </div>
  );
}
