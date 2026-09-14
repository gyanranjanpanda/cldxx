import { useSelector } from "react-redux";
import ArtifactPanel from "../components/ArtifactPanel";
import ChatArea from "../components/ChatArea";
import Sidebar from "../components/Sidebar";
import Login from "./Login";

function Home() {
  const { userData, authLoading } = useSelector(state => state.user);

  if (authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0d0f14] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fuchsia-500 border-t-transparent" />
          <span className="text-xs text-slate-400">Loading cldxAI...</span>
        </div>
      </div>
    );
  }

  if (!userData) {
    return <Login />;
  }

  return (
    <div className="h-screen flex bg-[#0d0f14] text-white overflow-hidden">
      <Sidebar />
      <ChatArea />
      <ArtifactPanel />
    </div>
  );
}

export default Home;
