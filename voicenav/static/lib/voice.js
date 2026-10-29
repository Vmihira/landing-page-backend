// Microphone capture with voice-activity detection, and spoken replies.
import { speech, transcribe } from "./api.js";

export const settings = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`vn.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`vn.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

/**
 * One utterance. Resolves with { text } after Fish Audio transcribes it, or { cancelled } if nothing was said.
 * mode "auto": stops after ~1.2 s of silence following speech. mode "hold": stops when stop() is called.
 */
export class Utterance {
  constructor({ mode = "auto", onLevel = () => {}, onState = () => {} } = {}) {
    this.mode = mode;
    this.onLevel = onLevel;
    this.onState = onState;
    this.chunks = [];
    this.cancelled = false;
  }

  async start() {
    stopSpeaking();
    this.onState("starting");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.addEventListener("dataavailable", (e) => e.data.size && this.chunks.push(e.data));
    this.done = new Promise((resolve) => this.recorder.addEventListener("stop", resolve, { once: true }));
    this.recorder.start(100);
    this.started = performance.now();
    this.onState("listening");
    this.watch();
    return this;
  }

  watch() {
    const context = new AudioContext();
    this.context = context;
    const source = context.createMediaStreamSource(this.stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let floor = 0.01, heard = false, quietSince = 0;
    const tick = () => {
      if (!this.recorder || this.recorder.state !== "recording") return;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      const elapsed = performance.now() - this.started;
      if (elapsed < 350) floor = Math.max(floor * 0.9 + rms * 0.1, 0.004);
      const threshold = Math.max(floor * 2.6, 0.018);
      const speaking = rms > threshold;
      this.onLevel(Math.min(1, rms / 0.12), speaking);
      if (this.mode === "auto") {
        if (speaking) { heard = true; quietSince = 0; }
        else if (heard) {
          quietSince ||= performance.now();
          if (performance.now() - quietSince > 1200) return this.stop();
        } else if (elapsed > 9000) {
          return this.cancel("I didn't hear anything.");
        }
        if (elapsed > 60000) return this.stop();
      }
      this.heard = heard || this.heard;
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  release() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.context?.close().catch(() => {});
  }

  async stop() {
    if (!this.recorder || this.recorder.state === "inactive") return;
    this.recorder.stop();
    this.release();
  }

  cancel(reason = "") {
    this.cancelled = reason || "Cancelled";
    this.stop();
  }

  /** Wait for the recording to end, then transcribe it. */
  async result() {
    await this.done;
    if (this.cancelled) return { cancelled: this.cancelled };
    const duration = performance.now() - this.started;
    const blob = new Blob(this.chunks, { type: this.recorder.mimeType || "audio/webm" });
    if (duration < 450 || blob.size < 2000) return { cancelled: "That was too short." };
    this.onState("transcribing");
    const text = await transcribe(blob);
    return { text, seconds: Math.round(duration / 100) / 10 };
  }
}

// ---------------------------------------------------------------- spoken replies

let audio = null;
let queue = Promise.resolve();

export function stopSpeaking() {
  if (audio) { audio.pause(); audio = null; }
}

export function say(text) {
  if (!text || !settings.get("voiceReplies", true)) return;
  const short = text.replace(/\s+/g, " ").trim().slice(0, 300);
  queue = queue.then(async () => {
    try {
      const blob = await speech(short);
      stopSpeaking();
      audio = new Audio(URL.createObjectURL(blob));
      await audio.play();
      await new Promise((resolve) => audio && audio.addEventListener("ended", resolve, { once: true }));
    } catch { /* replies are optional */ }
  });
}
