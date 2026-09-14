const SARVAM_URL = "https://api.sarvam.ai/speech-to-text";

// Anything shorter than this is a stray tap on the mic button, not speech.
// Sarvam bills per request, so it is worth rejecting before the network call.
const MIN_AUDIO_BYTES = 2000;

const extensionFor = (contentType = "") => {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mpeg")) return "mp3";
  return "webm";
};

export const transcribe = async (req, res) => {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    return res.status(503).json({ message: "Speech-to-text is not configured on the server." });
  }

  const audio = req.body;
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    return res.status(400).json({ message: "No audio received." });
  }
  if (audio.length < MIN_AUDIO_BYTES) {
    return res.status(400).json({ message: "Recording was too short — hold the mic and speak." });
  }

  // MediaRecorder reports "audio/webm;codecs=opus", but Sarvam validates the
  // mime type as an exact string and rejects anything carrying parameters.
  const contentType = (req.headers["content-type"] || "audio/webm").split(";")[0].trim();

  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `audio.${extensionFor(contentType)}`);
  form.append("model", process.env.SARVAM_MODEL || "saarika:v2.5");
  // "unknown" lets Sarvam detect the language, so Hindi and English both work
  // without the user switching anything.
  form.append("language_code", process.env.SARVAM_LANGUAGE || "unknown");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(SARVAM_URL, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
      signal: controller.signal,
    });

    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { /* non-JSON error body */ }

    if (!response.ok) {
      // Surface Sarvam's own message: model and language identifiers change
      // over time and a generic 502 hides which one went stale.
      console.error("Sarvam STT failed:", response.status, raw.slice(0, 300));
      return res.status(502).json({
        message: data?.error?.message || data?.message || `Speech service returned ${response.status}.`,
      });
    }

    return res.status(200).json({
      transcript: (data?.transcript || "").trim(),
      language: data?.language_code || null,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ message: "Speech service timed out. Try a shorter clip." });
    }
    console.error("Sarvam STT error:", err);
    return res.status(502).json({ message: "Could not reach the speech service." });
  } finally {
    clearTimeout(timer);
  }
};
