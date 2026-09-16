import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, MessageSquare, LogOut, User, PenSquare, Menu, X,
  CoinsIcon, Trash2, Check, Loader2, Search, ChevronDown, Sparkles, Ghost, Plug, Share2
} from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import api from "../utils/axios";
import { setUserData } from "../redux/user.slice";
import { deleteConversation, getConversations } from "../features/conversation.api";
import { removeConversation, setConversations, setIncognito, setSelectedAgent, setSelectedConversation } from "../redux/conversation.slice";
import { getMessages } from "../features/message.api";
import { setArtifacts, setMessages } from "../redux/message.slice";
import { AGENTS } from "../constants/agents";
import BillingDrawer from "./BillingDrawer";
import McpDrawer from "./McpDrawer";
import ShareDialog from "./ShareDialog";
import { getMcpServers } from "../features/mcp.api";

const DAY = 86_400_000;

// ChatGPT buckets its history by age rather than showing one flat list, which
// is what makes a long sidebar scannable. Conversations only carry timestamps,
// so the grouping is derived here instead of asking the API for it.
const groupByAge = (list) => {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const buckets = [
    ["Today",          []],
    ["Yesterday",      []],
    ["Previous 7 days",[]],
    ["Older",          []]
  ];

  [...list]
    .sort((a, b) =>
      new Date(b.updatedAt || b.createdAt || 0) -
      new Date(a.updatedAt || a.createdAt || 0))
    .forEach((conv) => {
      const t = new Date(conv.updatedAt || conv.createdAt || 0).getTime();
      const i = t >= startOfToday       ? 0
              : t >= startOfToday - DAY ? 1
              : t >= startOfToday - 7 * DAY ? 2
              : 3;
      buckets[i][1].push(conv);
    });

  return buckets.filter(([, items]) => items.length);
};

// Defined at module scope: a component created inside render is a new type on
// every pass, so React would unmount and remount it each time.
const PanelIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
  </svg>
);

export default function Sidebar() {
  const [hovered, setHovered]           = useState(null);
  // Deleting is irreversible, so the trash icon arms a confirm step rather than
  // firing straight away — a stray click in a list is far too easy.
  const [confirmingId, setConfirmingId] = useState(null);
  const [deletingId, setDeletingId]     = useState(null);
  const [collapsed, setCollapsed]       = useState(false);
  const [mobileOpen, setMobileOpen]     = useState(false);
  const [imageError, setImageError]     = useState(false);
  const [showBilling, setShowBilling]   = useState(false);
  const [showMcp, setShowMcp]           = useState(false);
  // Only the count is kept here; the drawer owns the full list.
  const [mcpEnabled, setMcpEnabled]     = useState(0);
  // Which conversation the share dialog is open for. Kept here rather than in
  // the row so the dialog is not remounted as the list re-renders.
  const [sharing, setSharing]           = useState(null);
  const [searchOpen, setSearchOpen]     = useState(false);
  const [query, setQuery]               = useState("");
  const [agentsOpen, setAgentsOpen]     = useState(false);

  const { userData } = useSelector(state => state.user);
  const { conversations, selectedConversation, selectedAgent, incognito } = useSelector(state => state.conversation);
  const dispatch = useDispatch();

  const logout = async () => {
    try {
      await api.get("/api/auth/logout");
      dispatch(setUserData(null));
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const data = await getConversations();
        dispatch(setConversations(data));
      } catch (error) {
        console.log(error);
      }
    };
    fetchConversations();
  }, [userData?._id]);

  const refreshMcpCount = useCallback(async () => {
    try {
      const data = await getMcpServers();
      setMcpEnabled((data.servers || []).filter(s => s.enabled).length);
    } catch {
      // The badge is decoration -- a failure here must not break the sidebar.
    }
  }, []);

  useEffect(() => {
    // Same shape as the conversation fetch above: load once the user is known.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (userData?._id) refreshMcpCount();
  }, [userData?._id, refreshMcpCount]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? conversations.filter(c => (c.title || "").toLowerCase().includes(q))
      : conversations;
    return groupByAge(filtered);
  }, [conversations, query]);

  const handleCreateConversation = () => {
    // A normal new chat is also the way out of incognito -- otherwise the next
    // message would still go to the ephemeral thread and never be stored.
    if (incognito) dispatch(setIncognito(false));
    dispatch(setSelectedConversation(null));
    dispatch(setMessages([]));
    dispatch(setArtifacts([]));
    setMobileOpen(false);
  };

  // Switching either way starts from a blank transcript: carrying messages
  // across the boundary would show stored and unstored turns in one thread.
  const toggleIncognito = () => {
    dispatch(setIncognito(!incognito));
    dispatch(setMessages([]));
    dispatch(setArtifacts([]));
    setMobileOpen(false);
  };

  // Picking an agent from the nav is a "start something new with this" action:
  // switching the agent mid-thread would silently change what the open chat is.
  const handlePickAgent = (agentId) => {
    dispatch(setSelectedAgent(agentId));
    handleCreateConversation();
  };

  const handleDeleteConversation = async (conversationId) => {
    setDeletingId(conversationId);
    try {
      await deleteConversation(conversationId);
      const wasOpen = selectedConversation?._id === conversationId;
      dispatch(removeConversation(conversationId));
      // The open conversation just vanished, so clear what it was rendering.
      if (wasOpen) {
        dispatch(setMessages([]));
        dispatch(setArtifacts([]));
      }
    } catch (error) {
      console.log(error);
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  };

  const handleSelectConversation = async (conversation) => {
    setMobileOpen(false);
    dispatch(setSelectedConversation(conversation));
    const messages = await getMessages(conversation._id);
    dispatch(setMessages(messages));
    dispatch(setArtifacts(messages.artifacts));
  };

  const toggleSearch = () => {
    setSearchOpen(open => {
      if (open) setQuery("");
      return !open;
    });
  };

  const navRow = (active) =>
    `w-full flex items-center gap-3 px-3 h-[38px] rounded-[10px] text-[13.5px] font-medium
     border-none cursor-pointer text-left transition-colors duration-150
     ${active ? "bg-white/[0.08] text-slate-100" : "bg-transparent text-slate-300 hover:bg-white/[0.05]"}`;

  /* ── Collapsed rail — desktop only ── */
  if (collapsed) {
    return (
      <div className="hidden lg:flex flex-col items-center w-[56px] h-screen bg-[#0d0f14] border-r border-white/[0.06] py-4 gap-1 shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
          className="flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-colors duration-150 bg-transparent border-none cursor-pointer mb-1"
        >
          <PanelIcon />
        </button>

        <button
          onClick={handleCreateConversation}
          title="New chat"
          className="flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-colors duration-150 bg-transparent border-none cursor-pointer"
        >
          <Plus size={17} />
        </button>

        <button
          onClick={() => { setCollapsed(false); setSearchOpen(true); }}
          title="Search chats"
          className="flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-colors duration-150 bg-transparent border-none cursor-pointer"
        >
          <Search size={16} />
        </button>

        <button
          onClick={() => setShowMcp(true)}
          title="MCP servers"
          className="relative flex items-center justify-center w-9 h-9 rounded-xl text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-colors duration-150 bg-transparent border-none cursor-pointer"
        >
          <Plug size={16} />
          {mcpEnabled > 0 && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-indigo-400" />
          )}
        </button>

        <button
          onClick={toggleIncognito}
          title={incognito ? "Incognito on — history off" : "Incognito chat"}
          className={`flex items-center justify-center w-9 h-9 rounded-xl transition-colors duration-150 border-none cursor-pointer
            ${incognito ? "bg-fuchsia-500/15 text-fuchsia-300" : "bg-transparent text-slate-500 hover:bg-white/[0.05] hover:text-slate-200"}`}
        >
          <Ghost size={16} />
        </button>

        <div className="w-6 h-px bg-white/[0.06] my-1.5" />

        {/* The agent roster stays reachable in the rail — it is the one nav
            group that changes what the next message actually does. */}
        {AGENTS.filter(a => a.id !== "auto").map((agent) => {
          const Icon = agent.icon;
          const isActive = selectedAgent === agent.id;
          return (
            <button
              key={agent.id}
              onClick={() => handlePickAgent(agent.id)}
              title={`${agent.label} — ${agent.blurb}`}
              className={`flex items-center justify-center w-9 h-9 rounded-xl transition-colors duration-150 border-none cursor-pointer
                ${isActive ? "bg-indigo-500/15 text-indigo-400" : "bg-transparent text-slate-500 hover:bg-white/[0.05] hover:text-slate-300"}`}
            >
              <Icon size={15} />
            </button>
          );
        })}

        <div className="w-6 h-px bg-white/[0.06] my-1.5" />

        <div className="flex-1 flex flex-col items-center gap-1 overflow-y-auto w-full px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {conversations.map((chat) => {
            const isActive = selectedConversation?._id === chat._id;
            return (
              <button
                key={chat._id}
                onClick={() => handleSelectConversation(chat)}
                title={chat.title}
                className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-colors duration-150 border-none cursor-pointer
                  ${isActive ? "bg-indigo-500/15 text-indigo-400" : "bg-transparent text-slate-500 hover:bg-white/[0.05] hover:text-slate-300"}`}
              >
                <MessageSquare size={15} />
              </button>
            );
          })}
        </div>

        <div className="mt-auto pt-2">
          {userData && (
            <div className="relative">
              {!userData.avatar || imageError
                ? <div className="w-8 h-8 rounded-[8px] bg-white/[0.06] flex items-center justify-center"><User size={14} className="text-slate-400" /></div>
                : <img src={userData.avatar} alt={userData.name} onError={() => setImageError(true)} className="w-8 h-8 rounded-[8px] object-cover border-2 border-indigo-500/25" />
              }
              <span className="absolute -bottom-px -right-px w-2 h-2 bg-green-500 rounded-full border-[1.5px] border-[#0d0f14] block" />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ── Mobile hamburger ── */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3.5 left-4 z-50 flex items-center justify-center w-8 h-8 rounded-lg bg-[#0d0f14] border border-white/[0.06] text-slate-400 hover:text-slate-200 transition-colors duration-150 cursor-pointer"
      >
        <Menu size={16} />
      </button>

      {/* ── Mobile backdrop ── */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
      )}

      {/* ── Sidebar panel ──
          Rendered inline rather than as a nested <SidebarContent /> component:
          a component defined in the render body is a new type every render, so
          React remounts it and the search field loses focus on each keystroke. */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-[270px] h-screen shrink-0
        bg-[#0d0f14] border-r border-white/[0.06]
        transition-transform duration-250
        ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        <div className="flex flex-col h-full">

          {/* Header — brand left, controls right */}
          <div className="flex items-center gap-1 pl-4 pr-3 h-[52px] shrink-0">
            <span className="text-[16px] font-semibold text-slate-100 tracking-tight flex-1">cldxAI</span>

            <button
              onClick={toggleSearch}
              title="Search chats"
              className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors duration-150 bg-transparent border-none cursor-pointer
                ${searchOpen ? "text-slate-100 bg-white/[0.06]" : "text-slate-500 hover:text-slate-200 hover:bg-white/[0.05]"}`}
            >
              <Search size={15} />
            </button>

            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-colors duration-150 bg-transparent border-none cursor-pointer"
            >
              <PanelIcon />
            </button>

            <button
              onClick={() => setMobileOpen(false)}
              className="lg:hidden flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-colors duration-150 bg-transparent border-none cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>

          {/* Search field — only occupies space once asked for */}
          {searchOpen && (
            <div className="px-2.5 pb-2">
              <div className="flex items-center gap-2 px-3 h-[36px] rounded-[10px] bg-white/[0.05] border border-white/[0.07]">
                <Search size={13} className="text-slate-500 shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && toggleSearch()}
                  placeholder="Search chats"
                  className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-slate-200 placeholder:text-slate-600"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="shrink-0 flex items-center justify-center w-5 h-5 rounded border-none bg-transparent text-slate-600 hover:text-slate-300 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Primary nav — every row here maps to something cldxAI actually does */}
          <div className="px-2.5 space-y-0.5">
            <button onClick={handleCreateConversation} className={navRow(!selectedConversation && !incognito)}>
              <PenSquare size={15} className="shrink-0 text-slate-400" />
              New chat
            </button>

            <button
              onClick={toggleIncognito}
              title="Replies still work; nothing is written to your history"
              className={navRow(incognito)}
            >
              <Ghost size={15} className={`shrink-0 ${incognito ? "text-fuchsia-300" : "text-slate-400"}`} />
              <span className="flex-1">Incognito</span>
              {/* A switch rather than a label: this one is a mode, not a link */}
              <span className={`relative w-[26px] h-[15px] rounded-full transition-colors duration-150 shrink-0
                ${incognito ? "bg-fuchsia-500/70" : "bg-white/[0.12]"}`}>
                <span className={`absolute top-[2px] w-[11px] h-[11px] rounded-full bg-white transition-all duration-150
                  ${incognito ? "left-[13px]" : "left-[2px]"}`} />
              </span>
            </button>

            <button onClick={() => { setShowMcp(true); setMobileOpen(false); }} className={navRow(false)}>
              <Plug size={15} className="shrink-0 text-slate-400" />
              <span className="flex-1">MCP Servers</span>
              {mcpEnabled > 0 && (
                <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-px rounded-full">
                  {mcpEnabled}
                </span>
              )}
            </button>

            {/* Agents group — the composer's roster, mirrored as a nav tree */}
            <button onClick={() => setAgentsOpen(o => !o)} className={navRow(false)}>
              <Sparkles size={15} className="shrink-0 text-slate-400" />
              <span className="flex-1">Agents</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-400/90">
                {AGENTS.find(a => a.id === selectedAgent)?.label ?? "Auto"}
              </span>
              <ChevronDown
                size={13}
                className={`shrink-0 text-slate-500 transition-transform duration-150 ${agentsOpen ? "rotate-180" : ""}`}
              />
            </button>

            {agentsOpen && (
              <div className="pl-3 pb-0.5 space-y-0.5">
                {AGENTS.map((agent) => {
                  const Icon = agent.icon;
                  const isActive = selectedAgent === agent.id;
                  return (
                    <button
                      key={agent.id}
                      onClick={() => handlePickAgent(agent.id)}
                      title={agent.blurb}
                      className={`w-full flex items-center gap-2.5 px-3 h-[32px] rounded-[9px] text-[12.5px] font-medium border-none cursor-pointer text-left transition-colors duration-150
                        ${isActive
                          ? "bg-indigo-500/10 text-indigo-300"
                          : "bg-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"}`}
                    >
                      <Icon size={14} className={`shrink-0 ${isActive ? "text-indigo-400" : "text-slate-500"}`} />
                      {agent.label}
                    </button>
                  );
                })}
              </div>
            )}

            <button onClick={() => { setShowBilling(true); setMobileOpen(false); }} className={navRow(false)}>
              <CoinsIcon size={15} className="shrink-0 text-slate-400" />
              <span className="flex-1">Credits</span>
              <span className="text-[10px] font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-px rounded-full tracking-wide">
                {userData?.plan ?? "free"}
              </span>
            </button>
          </div>

          <div className="mx-2.5 mt-3 h-px bg-white/[0.06]" />

          {/* History — bucketed by age, like the reference panel */}
          <div className="flex-1 overflow-y-auto px-2.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {groups.length === 0 ? (
              <p className="px-2.5 pt-4 text-[12px] text-slate-600">
                {query ? `No chats matching "${query}"` : "No conversations yet"}
              </p>
            ) : (
              groups.map(([label, items]) => (
                <div key={label}>
                  <p className="px-2.5 pt-4 pb-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-slate-600">
                    {label}
                  </p>

                  {items.map((chat) => {
                    const isActive = selectedConversation?._id === chat._id;
                    const isHov    = hovered === chat._id;
                    return (
                      <div
                        key={chat._id}
                        onClick={() => handleSelectConversation(chat)}
                        onMouseEnter={() => setHovered(chat._id)}
                        onMouseLeave={() => { setHovered(null); setConfirmingId(null); }}
                        className={`group flex items-center gap-2 cursor-pointer mb-0.5 pl-3 pr-2 h-[34px] rounded-[9px] transition-colors duration-150
                          ${isActive ? "bg-white/[0.08]" : isHov ? "bg-white/[0.05]" : "bg-transparent"}`}
                      >
                        <p className={`flex-1 min-w-0 text-[13px] truncate ${isActive ? "text-slate-100 font-medium" : "text-slate-300"}`}>
                          {chat.title}
                        </p>

                        {/* Sharing is per conversation, so the action lives on the row.
                  Requiring the chat to be open first is what made the feature
                  hard to find at all. */}
              {confirmingId !== chat._id && deletingId !== chat._id && (
                <button
                  title="Share this chat"
                  onClick={(e) => { e.stopPropagation(); setSharing(chat); }}
                  className={`flex shrink-0 items-center justify-center w-6 h-6 rounded-md border-none bg-transparent text-slate-600 cursor-pointer hover:bg-white/[0.08] hover:text-indigo-300 transition-all duration-150
                    ${isHov || isActive ? "opacity-100" : "opacity-0"}`}
                >
                  <Share2 size={12} />
                </button>
              )}

              {deletingId === chat._id ? (
                          <Loader2 size={13} className="shrink-0 animate-spin text-slate-500" />
                        ) : confirmingId === chat._id ? (
                          <span className="flex shrink-0 items-center gap-0.5">
                            <button
                              title="Confirm delete"
                              onClick={(e) => { e.stopPropagation(); handleDeleteConversation(chat._id); }}
                              className="flex items-center justify-center w-6 h-6 rounded-md border-none bg-red-500/15 text-red-400 cursor-pointer hover:bg-red-500/25 transition-colors duration-150"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              title="Cancel"
                              onClick={(e) => { e.stopPropagation(); setConfirmingId(null); }}
                              className="flex items-center justify-center w-6 h-6 rounded-md border-none bg-white/[0.06] text-slate-400 cursor-pointer hover:bg-white/[0.12] transition-colors duration-150"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ) : (
                          <button
                            title="Delete conversation"
                            onClick={(e) => { e.stopPropagation(); setConfirmingId(chat._id); }}
                            className={`flex shrink-0 items-center justify-center w-6 h-6 rounded-md border-none bg-transparent text-slate-600 cursor-pointer hover:bg-white/[0.08] hover:text-red-400 transition-all duration-150
                              ${isHov || isActive ? "opacity-100" : "opacity-0"}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-2.5 py-2.5 border-t border-white/[0.06]">
            {userData ? (
              <div className="flex items-center gap-2.5 cursor-pointer rounded-xl px-2.5 py-2 hover:bg-white/[0.05] transition-colors duration-150">
                <div className="relative shrink-0">
                  {!userData?.avatar || imageError ? (
                    <div className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center">
                      <User size={15} className="text-slate-400" />
                    </div>
                  ) : (
                    <img
                      src={userData.avatar}
                      alt={userData.name}
                      className="w-8 h-8 rounded-full object-cover border-2 border-indigo-500/25"
                      onError={() => setImageError(true)}
                    />
                  )}
                  <span className="absolute -bottom-px -right-px w-[9px] h-[9px] bg-green-500 rounded-full border-2 border-[#0d0f14] block" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-100 truncate">{userData.name}</p>
                  <p className="text-[11px] text-slate-600 mt-px">{userData.plan || "Free Plan"}</p>
                </div>
                <button
                  onClick={logout}
                  title="Log out"
                  className="flex items-center justify-center w-7 h-7 rounded-[7px] border-none bg-transparent text-slate-600 cursor-pointer hover:bg-white/[0.08] hover:text-slate-400 transition-all duration-150"
                >
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button className="w-full flex items-center justify-center gap-2 text-sm font-medium text-slate-200 bg-white/[0.05] border border-white/[0.08] rounded-xl py-[11px] cursor-pointer hover:bg-white/[0.08] transition-colors duration-150">
                Login
              </button>
            )}
          </div>

        </div>
      </div>

      <BillingDrawer open={showBilling} onClose={() => setShowBilling(false)} />

      <McpDrawer
        open={showMcp}
        onClose={() => { setShowMcp(false); refreshMcpCount(); }}
      />

      <ShareDialog
        open={Boolean(sharing)}
        conversation={sharing}
        onClose={() => setSharing(null)}
      />
    </>
  );
}
