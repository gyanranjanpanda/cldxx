import { MessageSquare, Ghost, Share2 } from "lucide-react";
import { useSelector } from "react-redux";
import { useState } from "react";
import ShareDialog from "./ShareDialog";

export default function Navbar() {
  const [showShare, setShowShare] = useState(false);
  const { selectedConversation, incognito } = useSelector(state => state.conversation);
  const {messages} = useSelector(state => state.message);
  return (
    <div className="h-14 flex items-center justify-between px-5 border-b border-white/[0.06] bg-[#0d0f14]">

      {/* Left — chat title */}
      <div className="flex items-center gap-2.5">
        <div className={`flex items-center justify-center w-7 h-7 rounded-lg border
          ${incognito ? "bg-fuchsia-500/10 border-fuchsia-500/25" : "bg-indigo-500/10 border-indigo-500/20"}`}>
          {incognito
            ? <Ghost size={13} className="text-fuchsia-300" />
            : <MessageSquare size={13} className="text-indigo-400" />}
        </div>
        <h2 className="text-[14px] font-semibold text-slate-100 tracking-tight">
          {incognito ? "Incognito chat" : selectedConversation?.title}
        </h2>
        {incognito && (
          <span className="text-[10px] font-medium text-fuchsia-300 bg-fuchsia-500/10 border border-fuchsia-500/20 px-2 py-0.5 rounded-full">
            Not saved
          </span>
        )}
        <span className="text-[10px] font-medium text-slate-600 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">
          {messages?.length || 0} Messages
        </span>
      </div>

      {/* Right — actions */}
      <div className="flex items-center gap-1.5">
        {/* Only a stored conversation can be shared: incognito has no row to
            point a link at, and an unsaved chat has nothing to show a guest. */}
        {selectedConversation && !incognito && (
          <button
            onClick={() => setShowShare(true)}
            title="Share this chat"
            className="flex items-center gap-1.5 text-[12px] font-medium text-slate-300 bg-white/[0.05] border border-white/[0.08] px-2.5 h-[30px] rounded-lg hover:bg-white/[0.09] cursor-pointer transition-colors duration-150"
          >
            <Share2 size={13} />
            Share
          </button>
        )}
      </div>

      <ShareDialog
        open={showShare}
        onClose={() => setShowShare(false)}
        conversation={selectedConversation}
      />

    </div>
  );
}