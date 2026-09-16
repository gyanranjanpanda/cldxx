import {
  Zap,
  MessageSquare,
  Code2,
  FileText,
  Presentation,
  Image as ImageIcon,
  Globe
} from "lucide-react";

// Single source of truth for the agent roster: the composer renders these as
// pills, the sidebar as a nav group. Two copies drifted apart the moment one
// side gained an agent, so both import this list.
export const AGENTS = [
  { id: "auto",   icon: Zap,           label: "Auto",   blurb: "Pick the right agent for me" },
  { id: "chat",   icon: MessageSquare, label: "Chat",   blurb: "Plain conversation" },
  { id: "coding", icon: Code2,         label: "Coding", blurb: "Code and live artifacts" },
  { id: "pdf",    icon: FileText,      label: "PDF",    blurb: "Generate or read documents" },
  { id: "ppt",    icon: Presentation,  label: "PPT",    blurb: "Build slide decks" },
  { id: "image",  icon: ImageIcon,     label: "Image",  blurb: "Generate images" },
  { id: "search", icon: Globe,         label: "Search", blurb: "Search the web" }
];

export const agentById = (id) =>
  AGENTS.find((a) => a.id === id) ?? AGENTS[0];
