import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FiExternalLink, FiX } from "react-icons/fi";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";

function MessageBubble({ role, content ,images}) {
  const isUser = role === "user";
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [copiedCode, setCopiedCode] = useState("");

  const resolveImageUrl = (url) => {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
      return url;
    }
    const baseUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
    return `${baseUrl.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  // Older chat messages contain absolute Lightsail artifact links. Route those
  // local files through the current app origin so the session cookie is sent.
  const resolveDownloadUrl = (href) => {
    if (!href) return href;
    try {
      const url = new URL(href, window.location.origin);
      if (/^\/artifacts\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/i.test(url.pathname)) {
        return `${window.location.origin}${url.pathname}`;
      }
    } catch {
      return href;
    }
    return href;
  };

// Escape closes, and the chat behind is frozen -- without the lock a trackpad
// scroll moves the conversation under the overlay while the picture stays put.
useEffect(() => {

  if (!lightboxSrc) return;

  const onKey = (e) => {
    if (e.key === "Escape") setLightboxSrc(null);
  };

  document.addEventListener("keydown", onKey);

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  return () => {
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = previousOverflow;
  };

}, [lightboxSrc]);
const copyCode = async (code) => {
  await navigator.clipboard.writeText(code);

  setCopiedCode(code);

  setTimeout(() => {
    setCopiedCode("");
  }, 2000);
};

const markdown = (content || "")
  .replace(/```review/gi, "```")
  .replace(/```text/gi, "```")
  .replace(/```[a-zA-Z0-9_-]+\s+id="[^"]*"/g, "```");
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`w-fit max-w-[92vw] md:max-w-[72%]
  px-4 py-2.5 rounded-2xl
  break-words overflow-hidden
  leading-relaxed
        ${
          isUser
            ? "bg-gradient-to-br from-blue-500 to-blue-700 text-white rounded-tr-sm"
            : " text-slate-200 rounded-tl-sm"
        }`}
      >
        {images.length > 0 && (
    <div className="flex flex-wrap gap-3 mt-4">
        {images.map((img, i) => {
          const resolvedSrc = resolveImageUrl(img);
          return (
            <img
              key={i}
              src={resolvedSrc}
              loading="lazy"
              onClick={() => setLightboxSrc(resolvedSrc)}
              onError={(e) => {
                console.warn("Failed to load image:", resolvedSrc);
                e.currentTarget.onerror = null;
                e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='112' viewBox='0 0 160 112'%3E%3Crect width='160' height='112' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-size='12'%3EImage Unavailable%3C/text%3E%3C/svg%3E";
              }}
              className="w-40 h-28 rounded-xl object-cover border border-white/10 cursor-zoom-in hover:opacity-90 transition"
            />
          );
        })}
    </div>
)}<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    h1: ({ children }) => (
      <h1 className="text-2xl font-bold mt-5 mb-3">{children}</h1>
    ),

    h2: ({ children }) => (
      <h2 className="text-xl font-semibold mt-4 mb-2">{children}</h2>
    ),

    h3: ({ children }) => (
      <h3 className="text-lg font-semibold mt-3 mb-2">{children}</h3>
    ),

    p: ({ children }) => (
      <p className="mb-3 whitespace-pre-wrap break-words">
        {children}
      </p>
    ),

    ul: ({ children }) => (
      <ul className="list-disc pl-5 space-y-1 my-2">
        {children}
      </ul>
    ),

    ol: ({ children }) => (
      <ol className="list-decimal pl-5 space-y-1 my-2">
        {children}
      </ol>
    ),

    table: ({ children }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border border-white/10">
          {children}
        </table>
      </div>
    ),

    th: ({ children }) => (
      <th className="border border-white/10 bg-white/5 px-3 py-2 text-left">
        {children}
      </th>
    ),

    td: ({ children }) => (
      <td className="border border-white/10 px-3 py-2">
        {children}
      </td>
    ),

    a: ({ href, children }) => (
      <a
        href={resolveDownloadUrl(href)}
        target="_blank"
        rel="noreferrer"
        className="text-blue-400 underline inline-flex items-center gap-1"
      >
        {children}
        <FiExternalLink size={11} />
      </a>
    ),

    img: ({ src }) => {
      if (!src) return null;
      const resolvedSrc = resolveImageUrl(src);

      return (
        <img
          src={resolvedSrc}
          loading="lazy"
          onClick={() => setLightboxSrc(resolvedSrc)}
          onError={(e) => {
            console.warn("Failed to load markdown image:", resolvedSrc);
            e.currentTarget.onerror = null;
            e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='112' viewBox='0 0 160 112'%3E%3Crect width='160' height='112' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-size='12'%3EImage Unavailable%3C/text%3E%3C/svg%3E";
          }}
          className="w-40 h-28 rounded-xl object-cover cursor-pointer"
        />
      );
    },

    code({ className, children }) {
      console.log(children)
      const value = String(children)
  .replace(/^\s*```[^\n]*\n/, "")
  .replace(/\n```\s*$/, "")
  .trim();

      if (!className) {
        return (
          <code className="px-1.5 py-0.5 rounded bg-white/10 text-pink-400">
            {value}
          </code>
        );
      }

      const language = className.replace("language-", "");

      return (
        <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-[#111318]">

          <div className="flex items-center justify-between bg-[#1b1d24] border-b border-white/10 px-4 py-2">

            <span className="uppercase text-xs text-slate-400">
              {language}
            </span>

            <button
              onClick={() => copyCode(value)}
              className="flex items-center gap-1 text-xs"
            >
              {copiedCode === value ? (
                <>
                  <Check size={14} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={14} />
                  Copy
                </>
              )}
            </button>

          </div>

          <SyntaxHighlighter
            language={language}
            style={oneDark}
            wrapLongLines
            showLineNumbers
            customStyle={{
              margin: 0,
              padding: "16px",
              background: "#0d1117",
              fontSize: "13px",
            }}
          >
            {value}
          </SyntaxHighlighter>

        </div>
      );
    },
  }}
>
  {markdown}
</ReactMarkdown>
      </div>

      {lightboxSrc &&
        createPortal(
          // Rendered into <body> on purpose. Every message is wrapped in a
          // framer-motion div, and a transformed ancestor becomes the
          // containing block for position:fixed -- so inset-0 resolved to the
          // message row rather than the window. The backdrop stopped at the
          // sidebar and the picture was clipped by the composer.
          <div
            className="fixed inset-0 z-[999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 md:p-8"
            onClick={() => setLightboxSrc(null)}
            role="dialog"
            aria-modal="true"
          >
            <button
              type="button"
              onClick={() => setLightboxSrc(null)}
              aria-label="Close image"
              className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition"
            >
              <FiX size={20} />
            </button>
            <img
              src={lightboxSrc}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full w-auto h-auto rounded-2xl border border-white/10 shadow-2xl object-contain"
            />
          </div>,
          document.body
        )}
    </div>
  );
}

export default MessageBubble;
