import { useState } from "react";
import { useDispatch } from "react-redux";
import { FcGoogle } from "react-icons/fc";
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../../firebase";
import api from "../utils/axios";
import { setUserData } from "../redux/user.slice";
import GridScan from "../components/GridScan";

function Login() {
  const dispatch = useDispatch();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGoogleLogin = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const token = await result.user.getIdToken();
      const { data } = await api.post(`/api/auth/login`, { token });
      dispatch(setUserData(data.user));
    } catch (err) {
      console.error("Firebase Login Error:", err);
      if (err?.code !== "auth/popup-closed-by-user" && err?.code !== "auth/cancelled-popup-request") {
        const msg = err?.response?.data?.message || err?.message || err?.code || "Could not sign you in. Please try again.";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#0B0F19]">

      {/* Tunnel backdrop — deep slate navy receding into indigo at the walls. Kept well
          below mid-luminance so the page stays comfortable on a dark room. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 46% 60% at 50% 50%, #000000 0%, #04060C 24%, #0B0F19 34%, #141B2E 46%, #1E293B 58%, #282C6B 78%, #312E81 100%)"
        }}
      />

      {/* Animated wireframe grid. Positioned via inline style rather than a utility
          class: GridScan.css is unlayered, so its own `position: relative` outranks
          Tailwind's layered `absolute`. */}
      <GridScan
        style={{ position: "absolute", inset: 0 }}
        sensitivity={0.6}
        lineThickness={1.4}
        linesColor="#4F46E5"
        gridScale={0.1}
        lineJitter={0.12}
        scanColor="#A5B4FC"
        scanOpacity={0.18}
        scanDirection="pingpong"
        scanDuration={2.6}
        scanDelay={1.6}
        scanGlow={0.35}
        scanSoftness={2}
        enablePost
        bloomIntensity={0.28}
        bloomThreshold={0}
        bloomSmoothing={0}
        chromaticAberration={0.002}
        noiseIntensity={0.02}
        snapBackDelay={400}
      />

      {/* Keeps the card readable without killing the grid parallax underneath */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_38%_46%_at_50%_50%,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.3)_60%,transparent_100%)]" />

      {/* pointer-events-none lets the mouse keep driving the grid everywhere but the button */}
      <div className="relative z-10 h-full w-full flex items-center justify-center px-6 pointer-events-none">
        <div className="w-full max-w-[380px] rounded-3xl border border-[#374151] bg-[#111827]/85 backdrop-blur-2xl p-8 shadow-[0_0_60px_-18px_rgba(99,102,241,0.35)]">

          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6366F1] to-[#4338CA] shadow-[0_0_22px_-6px_rgba(99,102,241,0.7)]">
              <span className="text-[17px] font-bold tracking-tight text-white">c</span>
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Welcome to cldxAI</h1>
            <p className="text-[13px] leading-relaxed text-slate-400">
              Sign in to pick up your conversations, artifacts and agents.
            </p>
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="pointer-events-auto mt-7 flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-[#6366F1] py-[11px] text-sm font-medium text-white shadow-[0_0_20px_-8px_rgba(99,102,241,0.8)] transition-all duration-150 hover:bg-[#4F46E5] hover:shadow-[0_0_26px_-8px_rgba(99,102,241,0.95)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white">
              <FcGoogle size={14} />
            </span>
            {loading ? "Signing in…" : "Continue with Google"}
          </button>

          {error && (
            <p className="mt-3 text-center text-[12px] text-indigo-300">{error}</p>
          )}

          <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-600">
            By continuing you agree to our Terms of Service and Privacy Policy.
          </p>

        </div>
      </div>
    </div>
  );
}

export default Login;
