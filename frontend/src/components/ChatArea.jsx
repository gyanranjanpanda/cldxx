import { useState } from "react";
import AIBanner from "./AiBanner";
import ChatInput from "./ChatInput";
import MessageList from "./MessageList";
import Navbar from "./Navbar";
import Particles from "./Particles";


function ChatArea() {
  const [banner,setBanner]=useState({
    open:false,
    title:"",
    message:""
});
  return (
    <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">

      <div className="pointer-events-none absolute inset-0 z-0 opacity-55">
        <Particles
          particleColors={["#818cf8", "#a78bfa", "#67e8f9"]}
          particleCount={180}
          particleSpread={11}
          speed={0.08}
          particleBaseSize={72}
          sizeRandomness={1.2}
          alphaParticles
          moveParticlesOnHover
          particleHoverFactor={0.65}
        />
      </div>

      <div className="relative z-10">
        <Navbar />
      </div>

      <div className="relative z-10 flex-1 min-h-0 flex flex-col">
        <MessageList />
      </div>
      <AIBanner

   open={banner.open}

   title={banner.title}

   message={banner.message}

   onClose={()=>

      setBanner({
         ...banner,
         open:false
      })

   }

/>

      <div className="relative z-10">
        <ChatInput setBanner={setBanner} />
      </div>

    </div>
  );
}

export default ChatArea;
