import MessageBubble from "./MessageBubble";

import { useDispatch, useSelector } from "react-redux";
import { getMessages } from "../features/message.api";
import { setArtifacts, setMessages } from "../redux/message.slice";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { pickGreeting } from "../utils/greeting";
import { Ghost } from "lucide-react";
function NeuralPulse() {
  return (
    <div className="relative w-9 h-9 flex items-center justify-center shrink-0">
      {[0, 0.45, 0.9].map((delay, i) => (
        <motion.span
          key={i}
          className="absolute inset-0 rounded-full border border-cyan-400/30"
          initial={{ scale: 0.3, opacity: 0.55 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            delay,
            ease: "easeOut",
          }}
        />
      ))}
      <motion.span
        className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-cyan-300 to-violet-400"
        style={{ boxShadow: "0 0 14px rgba(125,211,252,0.55)" }}
        animate={{ scale: [1, 1.25, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

const THINKING_LABELS = ["Thinking", "Analyzing", "Reasoning", "Generating"];

function GeneratingIndicator() {
  const [labelIndex, setLabelIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLabelIndex((prev) => (prev + 1) % THINKING_LABELS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  const label = THINKING_LABELS[labelIndex];

  return (
    <div className="flex items-center gap-3 max-w-[72%] py-1">
      <NeuralPulse />
      <div className="flex overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={label}
            className="flex"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {label.split("").map((ch, i) => (
              <motion.span
                key={i}
                className="text-[13px] font-medium tracking-wide text-slate-400"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.07,
                }}
              >
                {ch}
              </motion.span>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function MessageList() {

  const bottomRef = useRef(null);
  const { messages, isLoading } = useSelector(state => state.message);
  const { selectedConversation, incognito } = useSelector(state => state.conversation);
  const { userData } = useSelector(state => state.user);
  const dispatch = useDispatch();

  const isEmpty = messages.length === 0 && !isLoading;

  // Re-rolled whenever the blank state comes back, so every new chat opens on a
  // different line instead of the same sentence for the whole session.
  const greeting = useMemo(
    () => pickGreeting(userData?.name),
    // isEmpty and the conversation id are the re-roll triggers, not inputs --
    // that is the point of listing them, so the "unnecessary dep" rule is off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isEmpty, userData?.name, selectedConversation?._id]
  );
useEffect(() => {

  requestAnimationFrame(() => {

    bottomRef.current?.scrollIntoView({

      behavior: "smooth",

      block: "end"

    });

  });

}, [messages.length, isLoading]);
  useEffect(() => {
    if (selectedConversation?.title === "New Chat") return;
    // Nothing is selected on first load. Without this the effect requested
    // /get-messages/undefined, which Mongo rejects as an invalid ObjectId --
    // a 500 and an unhandled axios rejection on every visit.
    if (!selectedConversation?._id) return;
    const get = async () => {
      const data = await getMessages(selectedConversation._id);
      dispatch(setMessages(data));
      const latestArtifactMessage =
  [...data]
    .reverse()
    .find(
      msg =>
        msg.artifacts &&
        msg.artifacts.length > 0
    );

if (latestArtifactMessage) {

  dispatch(
    setArtifacts(
      latestArtifactMessage.artifacts
    )
  );

}
    };
    get();
  }, [selectedConversation?._id]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {isEmpty && incognito ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center select-none">
          <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-fuchsia-500/10 border border-fuchsia-500/20">
            <Ghost size={21} className="text-fuchsia-300" strokeWidth={1.5} />
          </div>
          <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-tight leading-snug text-slate-100">
            Incognito chat
          </h1>
          <p className="text-[13px] text-slate-500 max-w-[330px] leading-relaxed">
            This one stays off the record — nothing here is written to your history,
            and it disappears when you switch back or reload.
          </p>
        </div>
      ) : isEmpty ? (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-center select-none">
          <motion.div
            key={greeting.mood}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex items-center justify-center w-11 h-11 rounded-2xl bg-white/[0.04] border border-white/[0.07]"
          >
            <greeting.icon size={21} className={greeting.iconColor} strokeWidth={1.5} />
          </motion.div>

          <motion.h1
            key={greeting.line}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="text-[26px] sm:text-[30px] font-semibold tracking-tight leading-snug"
          >
            <span className="text-slate-100">{greeting.hey}</span>{" "}
            <span className={`bg-gradient-to-r ${greeting.accent} bg-clip-text text-transparent`}>
              {greeting.line}
            </span>
          </motion.h1>
        </div>
      ) : (
        <>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <MessageBubble role={msg.role} content={msg.content} images={msg?.images || []}/>
            </motion.div>
          ))}

          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <GeneratingIndicator />
            </motion.div>
          )}
        
        </>
      )}
        <div ref={bottomRef} />
    </div>
  );
}