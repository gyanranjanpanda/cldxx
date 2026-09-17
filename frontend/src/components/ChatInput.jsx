import { useState } from "react";
import { Send, Paperclip, Square, FileText, X } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { addMessage, setArtifacts, setIsLoading } from "../redux/message.slice";
import { sendPrompt } from "../features/agent.api";
import api from "../utils/axios";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { createConversation, updateConversations } from "../features/conversation.api";
import { addConversation, setConvTitle, setSelectedAgent, setSelectedConversation } from "../redux/conversation.slice";
import { AGENTS } from "../constants/agents";
import { useRef } from "react";

// Mirrors what the agent's multer filter and utils/extractText.js accept.
const ACCEPTED_EXTENSIONS =
  /\.(pdf|docx|txt|md|markdown|csv|tsv|json|log|ya?ml|xml|html?)$/i;

const isAcceptedFile = (file) =>
  Boolean(file) &&
  (file.type.startsWith("image/") ||
    file.type.startsWith("text/") ||
    ACCEPTED_EXTENSIONS.test(file.name || ""));

// Sending a file with no typed question is a complete request on its own, so
// give the agent a sensible instruction rather than an empty prompt.
const defaultPromptFor = (file) => {
  if (!file) return "";
  if (file.type.startsWith("image/")) return "Describe this image.";
  return "Summarise this document.";
};

export default function ChatInput({
  setBanner
}) {
  const [value, setValue] = useState("");
const [isListening, setIsListening] = useState(false);

const [isTranscribing, setIsTranscribing] = useState(false);
  const dispatch = useDispatch();
  const { selectedConversation, selectedAgent, incognito, incognitoId, sovereign } = useSelector(state => state.conversation);
   const { isLoading } = useSelector(state => state.message);
const fileRef = useRef(null);

const [

selectedFile,

setSelectedFile

]=useState(null);

const [isDragging, setIsDragging] = useState(false);

// dragenter/dragleave fire for every child element the cursor crosses, so a
// depth counter is what keeps the overlay from flickering mid-drag.
const dragDepth = useRef(0);

const acceptFile = (file) => {
  if (!file) return;

  if (!isAcceptedFile(file)) {
    setBanner({
      open: true,
      title: "Unsupported file",
      message: `${file.name} isn't supported. Attach an image, PDF, Word document or text file.`
    });
    return;
  }

  setSelectedFile(file);
};

const handleDrop = (e) => {
  e.preventDefault();
  dragDepth.current = 0;
  setIsDragging(false);
  acceptFile(e.dataTransfer.files?.[0]);
};

   const placeholders={

auto:"Ask cldxAI...",

chat:"Chat with cldxAI...",

coding:"Describe the software you want...",

pdf:"Generate a PDF about...",

ppt:"Create a presentation about...",

image:"Describe the image...",

search:"Search the web..."

};

  const agents = AGENTS;

// ── Voice input ───────────────────────────────────────────────────────────
// Recorded in the browser with MediaRecorder, transcribed server-side by
// Sarvam (see backend modules/speech). The Sarvam key is deliberately not
// reachable from here — a VITE_* var would be inlined into the bundle.
const mediaRecorderRef = useRef(null);
const audioChunksRef = useRef([]);
const micStreamRef = useRef(null);

const releaseMic = () => {
  micStreamRef.current?.getTracks().forEach((track) => track.stop());
  micStreamRef.current = null;
};

// Without this the tab keeps showing "recording" if the user navigates away
// mid-capture.
useEffect(() => releaseMic, []);

const transcribeAudio = async (blob) => {
  if (!blob || blob.size < 2000) return;

  setIsTranscribing(true);
  try {
    const { data } = await api.post("/api/speech/transcribe", blob, {
      headers: { "Content-Type": blob.type || "audio/webm" },
    });

    const text = (data?.transcript || "").trim();
    if (!text) {
      setBanner({
        open: true,
        title: "Nothing heard",
        message: "No speech was picked up. Try again a little closer to the mic.",
      });
      return;
    }

    // Append instead of replace — anything already typed has to survive.
    setValue((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  } catch (error) {
    console.error("Transcription failed:", error);
    setBanner({
      open: true,
      title: "Could not transcribe",
      message:
        error.response?.data?.message ||
        "The speech service did not respond. Please try again.",
    });
  } finally {
    setIsTranscribing(false);
  }
};

const startRecording = async () => {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setBanner({
      open: true,
      title: "Mic unavailable",
      message: "This browser does not support audio recording.",
    });
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    audioChunksRef.current = [];

    // Safari has no webm/opus and falls back to mp4; both are accepted upstream.
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
      (type) => MediaRecorder.isTypeSupported?.(type)
    );

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      releaseMic();
      setIsListening(false);
      setBanner({
        open: true,
        title: "Recording failed",
        message: "The microphone stopped unexpectedly. Please try again.",
      });
    };

    recorder.onstop = () => {
      releaseMic();
      setIsListening(false);
      const blob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      audioChunksRef.current = [];
      transcribeAudio(blob);
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsListening(true);
  } catch (error) {
    // The old implementation had no error path at all, so a denied permission
    // left the button stuck in its listening state forever.
    console.error("Mic error:", error);
    releaseMic();
    setIsListening(false);
    setBanner({
      open: true,
      title: "Microphone blocked",
      message:
        error?.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow it in your browser's site settings."
          : error?.name === "NotFoundError"
          ? "No microphone was found on this device."
          : "Could not start the microphone.",
    });
  }
};

const toggleMic = () => {
  if (isTranscribing) return;

  if (isListening) {
    try {
      mediaRecorderRef.current?.stop();
    } catch {
      releaseMic();
      setIsListening(false);
    }
  } else {
    startRecording();
  }
};


  const handleSend = async () => {
    // A file on its own is a complete request -- requiring typed text meant an
    // attached PDF could never be sent.
    const typed = value.trim();
    const prompt = typed || defaultPromptFor(selectedFile);

    if (!prompt) return;

    // Title the conversation after the file when nothing was typed, so the
    // sidebar doesn't fill with identical "Summarise this document" entries.
    const title = (typed || selectedFile?.name || prompt).slice(0, 40);

    dispatch(setIsLoading(true));

    try {


      // Incognito skips both writes: no Conversation row to create, and no
      // title to store. The ephemeral id only ever reaches the agent's Redis
      // memory, which is what keeps the session multi-turn.
      let conversationId = incognitoId;

      if (!incognito) {
        let conversation = selectedConversation;

        if (!conversation) {
          const newConversation = await createConversation();
          dispatch(addConversation(newConversation));
          dispatch(setSelectedConversation(newConversation));
          conversation = newConversation;
        }

        if (conversation.title === "New Chat") {
          await updateConversations(conversation._id, title);
          dispatch(setConvTitle({ conversationId: conversation._id, title }));
        }

        conversationId = conversation._id;
      }

      dispatch(addMessage({ role: "user", content: prompt }));
      setValue("");

      const formData = new FormData();

formData.append(
    "conversationId",
    conversationId
);

formData.append(
    "sovereign",
    String(Boolean(sovereign))
);

formData.append(
    "incognito",
    String(Boolean(incognito))
);

formData.append(
    "prompt",
    prompt
);

formData.append(
    "agent",
    selectedAgent
);

// The server has no idea where the user is. Sending the browser's zone is what
// lets "what is the current time" be answered instead of refused.
formData.append(
    "timezone",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
);

if(selectedFile){

    formData.append(
        "file",
        selectedFile
    );

}

setSelectedFile(null);

// Without this the input keeps the old value and re-picking the same file
// never fires onChange.
if (fileRef.current) fileRef.current.value = "";

      const data = await sendPrompt(formData);
    console.log(data)
     dispatch(
  addMessage({
    role: "assistant",
    content: data.answer,
    images:data.images
  })
);

console.log(data)

if(data.artifacts){
  dispatch(
    setArtifacts(
      data.artifacts
    )
  );
}}
catch(error){

  setBanner({

    open:true,

    title:
      error.response?.data?.title ||
      "Something went wrong",

    message:
      error.response?.data?.message ||
      "Please try again."

  });

}
  finally {
       dispatch(setIsLoading(false));
    }
  };

  return (
   <div
      className="w-full overflow-hidden px-3 md:px-5 py-4 border-t border-white/[0.06] bg-[#0d0f14]"
      onDragEnter={(e) => {
        e.preventDefault();
        if (!e.dataTransfer?.types?.includes("Files")) return;
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <div
        className={`relative flex flex-col gap-2 border rounded-2xl px-4 pt-3.5 pb-3 transition-colors duration-150
          ${isDragging
            ? "bg-indigo-500/[0.07] border-indigo-500/60"
            : "bg-white/[0.03] border-white/[0.07]"}`}
      >

        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[#0d0f14]/85 backdrop-blur-sm pointer-events-none">
            <div className="flex items-center gap-2 text-[13px] font-medium text-indigo-300">
              <Paperclip size={14} />
              Drop to attach — images, PDF, Word or text
            </div>
          </div>
        )}



    <div className="flex w-[80%] gap-2 pr-2 flex-wrap">

    {agents.map((agent) => {

      const Icon = agent.icon;
      const isActive = selectedAgent === agent.id;

      return (

        <button
          key={agent.id}
          onClick={() => dispatch(setSelectedAgent(agent.id))}
          className={`
            flex-shrink-0
            
            inline-flex
            items-center
            gap-1.5
            px-3
            py-2
            rounded-full
            text-xs
            font-medium
            border
            transition-all

            ${
              isActive
                ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white border-transparent shadow-[0_1px_8px_rgba(99,102,241,.35)]"
                : "bg-white/[0.03] text-slate-400 border-white/[0.06] hover:bg-white/[0.07]"
            }
          `}
        >

          <Icon
            size={14}
            className={
              isActive
                ? "text-white"
                : "text-slate-500"
            }
          />

          {agent.label}

        </button>

      );

    })}


</div>

{

selectedFile && (

<div className="my-3">

<div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">

{

(selectedFile.type || "").startsWith("image/")

?

<img

src={URL.createObjectURL(selectedFile)}

className="h-10 w-10 rounded-xl object-cover"

/>

:

<FileText

size={16}

className={
selectedFile.type==="application/pdf"
? "text-red-400"
: "text-indigo-400"
}

/>

}

<div>

<p className="text-xs text-white">

{

selectedFile.name

}

</p>

<p className="text-[10px] text-slate-500">

{

Math.ceil(

selectedFile.size/

1024

)

}

KB

</p>

</div>

<button

onClick={()=>{

setSelectedFile(null);

fileRef.current.value="";

}}

className="ml-2"

>

<X

size={14}

className="text-slate-500 hover:text-white"

/>

</button>

</div>

</div>

)
}


        {/* Textarea */}
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={
placeholders[selectedAgent]
}
          rows={3}
          disabled={isLoading}
          className="w-full bg-transparent outline-none resize-none text-[14px] text-slate-200 placeholder:text-slate-600 leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden disabled:opacity-50"
        />

        {/* Bottom row */}
        <div className="flex items-center justify-between">

          {/* Left — attach + mic */}
          <div className="flex items-center gap-1">
  <input

ref={fileRef}

type="file"

hidden

accept="image/*,.pdf,.docx,.txt,.md,.markdown,.csv,.tsv,.json,.log,.yml,.yaml,.xml,.html,.htm"

onChange={(e)=>{

acceptFile(e.target.files[0]);

}}

/>
            <button className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 hover:text-slate-400 hover:bg-white/[0.05] border border-transparent hover:border-white/[0.06] transition-all duration-150 bg-transparent cursor-pointer"
            onClick={()=>
fileRef.current.click()
}
            >
              <Paperclip size={14} />
            </button>
           <button

onClick={toggleMic}

disabled={isTranscribing}

title={
  isTranscribing
    ? "Transcribing…"
    : isListening
    ? "Stop and transcribe"
    : "Record voice"
}

className={`

flex

items-center

justify-center

w-8

h-8

rounded-lg

transition-all

cursor-pointer

disabled:cursor-not-allowed

${

isListening

?

"bg-red-500 text-white"

:

isTranscribing

?

"text-indigo-400"

:

"text-slate-600 hover:bg-white/[0.05]"

}

`}

>

{

isTranscribing

?

<Loader2 size={14} className="animate-spin"/>

:

isListening

?

<MicOff size={14}/>

:

<Mic size={14}/>

}

</button>
          </div>

          {/* Right — send / stop */}
          <button
            onClick={handleSend}
            disabled={!isLoading && !value.trim() && !selectedFile}
            className={`flex items-center justify-center w-8 h-8 rounded-lg border-none cursor-pointer transition-all duration-150
              ${isLoading
                ? "bg-white text-[#0d0f14] hover:bg-slate-200"
                : value.trim() || selectedFile
                ? "bg-gradient-to-br from-indigo-500 to-violet-700 hover:opacity-90 text-white"
                : "bg-white/[0.05] text-slate-600 cursor-not-allowed"
              }`}
          >
            {isLoading ? <Square size={12} fill="currentColor" /> : <Send size={14} />}
          </button>

        </div>
      </div>

      <p className="text-center text-[10.5px] text-slate-700 mt-2.5">
        cldxAI can make mistakes. Verify important info.
      </p>
    </div>
  );
}