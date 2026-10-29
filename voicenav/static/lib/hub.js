// The voice hub: listen -> transcribe -> route with Jev -> dispatch to the active view.
import { api } from "./api.js";
import { bus, toast } from "./util.js";
import { Utterance, stopSpeaking } from "./voice.js";

const providers = new Map();
let active = null;
let current = null;

export const OP_LABELS = {
  BUILD_WEBSITE: "Build a website", WEB_TASK: "Web task", OPEN_PROJECTS: "Projects", OPEN_STUDIO: "Studio",
  OPEN_NAVIGATOR: "Navigator", ANSWER: "Answer", DECIDE_FOR_ME: "Decide for me", PICK_THEME: "Pick theme",
  BUILD_NOW: "Build now", CHANGE_PLAN: "Change plan", EDIT_SITE: "Edit site", GO_TO: "Go to",
  SCROLL_DOWN: "Scroll down", SCROLL_UP: "Scroll up", SCROLL_TOP: "Back to top", DEVICE: "Device",
  SHOW_CODE: "Show code", SHOW_PREVIEW: "Show preview", DOWNLOAD: "Download", TEST_IN_NAVIGATOR: "Test in Navigator",
  STOP_BUILD: "Stop build", PAUSE: "Pause", RESUME: "Resume", STOP: "Stop", CONFIRM: "Run next action",
};

export function navigate(path) {
  if (location.pathname !== path) history.pushState({}, "", path);
  bus.emit("route", path);
}

export function viewOf(path = location.pathname) {
  if (path.startsWith("/studio")) return "studio";
  if (path.startsWith("/navigator")) return "navigator";
  if (path.startsWith("/projects")) return "projects";
  return "home";
}

/** A view registers how to describe itself to the router and how to handle routed operations. */
export function registerProvider(view, provider) {
  providers.set(view, provider);
  return () => providers.get(view) === provider && providers.delete(view);
}

const state = (patch) => bus.emit("voice:state", patch);

/** Start listening. A second call while listening stops early and sends. */
export async function listen({ mode = "auto", view, source = "global" } = {}) {
  if (active) { active.stop(); return; }
  stopSpeaking();
  const utterance = new Utterance({
    mode,
    onLevel: (level) => bus.emit("voice:level", level),
    onState: (s) => state({ phase: s, source }),
  });
  active = utterance;
  try {
    await utterance.start();
  } catch (error) {
    active = null;
    state({ phase: "idle" });
    toast("Microphone unavailable: allow it in the browser's site settings.", "error");
    return;
  }
  try {
    const result = await utterance.result();
    active = null;
    if (result.cancelled) {
      state({ phase: "idle" });
      if (result.cancelled !== "Cancelled") toast(result.cancelled);
      return;
    }
    state({ phase: "heard", text: result.text, source });
    await submit(result.text, { voice: true, seconds: result.seconds, view, source });
  } catch (error) {
    active = null;
    state({ phase: "idle" });
    toast(error.message, "error");
  }
}

export function stopListening(send = true) {
  if (!active) return;
  if (send) active.stop(); else active.cancel();
}

export const isListening = () => Boolean(active);

/** Route text (spoken or typed) through Jev and dispatch it. */
export async function submit(text, meta = {}) {
  const view = meta.view || viewOf();
  const provider = providers.get(view);
  const context = { view, ...(provider?.context?.() || {}) };
  if (provider?.direct?.(text, meta)) { state({ phase: "idle" }); return; }
  state({ phase: "routing", text, source: meta.source });
  let result;
  const started = performance.now();
  try {
    result = await api("route", { utterance: text, context });
  } catch (error) {
    // Only fall back where the intent is unambiguous; never guess a costly action such as an edit.
    const operation = provider?.fallback?.(text);
    if (!operation) {
      state({ phase: "idle" });
      toast(`Couldn't understand that (${error.message}). Please try again.`, "error");
      return;
    }
    result = { operation, fallback: true };
  }
  result.ms = result.latency_ms ?? Math.round(performance.now() - started);
  current = result;
  state({ phase: "routed", text, result, source: meta.source });
  setTimeout(() => current === result && state({ phase: "idle" }), meta.voice ? 2200 : 1400);
  const op = result.operation;
  const payload = { text, result, ...meta };
  if (op === "BUILD_WEBSITE") { navigate("/studio"); setTimeout(() => bus.emit("studio:new", payload), 30); return; }
  if (op === "WEB_TASK") { navigate("/navigator"); setTimeout(() => bus.emit("nav:start", payload), 30); return; }
  if (op === "OPEN_PROJECTS") return navigate("/projects");
  if (op === "OPEN_STUDIO") return navigate("/studio");
  if (op === "OPEN_NAVIGATOR") return navigate("/navigator");
  if (provider?.handle) provider.handle(result, text, meta);
}
