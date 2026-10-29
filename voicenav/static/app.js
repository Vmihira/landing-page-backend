import { html, render, useEffect, useMemo, useRef, useState } from "./vendor/preact-htm.js";
import { health } from "./lib/api.js";
import { OP_LABELS, isListening, listen, navigate, stopListening, viewOf } from "./lib/hub.js";
import { Icon } from "./lib/icons.js";
import { bus, cx } from "./lib/util.js";
import { settings } from "./lib/voice.js";
import { Home } from "./views/home.js";
import { Navigator } from "./views/navigator.js";
import { Projects } from "./views/projects.js";
import { Studio } from "./views/studio.js";

const NAV = [
  { view: "home", path: "/", icon: "home", label: "Home" },
  { view: "studio", path: "/studio", icon: "layout", label: "Studio · build websites" },
  { view: "navigator", path: "/navigator", icon: "compass", label: "Navigator · web tasks" },
  { view: "projects", path: "/projects", icon: "folder", label: "Projects" },
];

function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    const off = bus.on("route", update);
    return () => { window.removeEventListener("popstate", update); off(); };
  }, []);
  return path;
}

function Toasts() {
  const [items, setItems] = useState([]);
  useEffect(() => bus.on("toast", (t) => {
    setItems((list) => [...list.slice(-3), t]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), t.kind === "error" ? 6500 : 3800);
  }), []);
  return html`<div class="toasts" role="status">${items.map((t) => html`
    <div class=${cx("toast", t.kind)} key=${t.id}>
      <${Icon} name=${t.kind === "error" ? "alert" : t.kind === "good" ? "check" : "info"} size=${16} />
      <div>${t.message}</div>
    </div>`)}</div>`;
}

function VoiceOverlay() {
  const [voice, setVoice] = useState({ phase: "idle" });
  const bars = useRef([]);
  useEffect(() => bus.on("voice:state", (patch) => setVoice((v) => (patch.phase === "idle" ? { phase: "idle" } : { ...v, ...patch }))), []);
  useEffect(() => bus.on("voice:level", (level) => {
    const list = bars.current;
    list.forEach((bar, i) => {
      if (!bar) return;
      const wobble = 0.55 + 0.45 * Math.sin(performance.now() / 90 + i * 1.7);
      bar.style.height = `${4 + Math.round(level * 26 * wobble)}px`;
    });
    document.documentElement.style.setProperty("--lv", String(1 + level * 0.35));
  }), []);
  if (voice.phase === "idle") return null;
  const listening = voice.phase === "listening" || voice.phase === "starting";
  const result = voice.result;
  return html`<div class="voice-overlay" role="status" aria-live="polite">
    <div class="voice-orb">${listening ? html`<${Icon} name="mic" size=${20} />` : html`<div class="spinner" style="border-top-color:white"></div>`}</div>
    ${listening ? html`<div class="wave">${Array.from({ length: 22 }, (_, i) => html`<i ref=${(el) => (bars.current[i] = el)}></i>`)}</div>` : null}
    <div class="voice-text grow">
      ${listening && html`<div class="big">Listening…</div><div class="faint" style="font-size:12px">Pause to send · Esc to cancel</div>`}
      ${voice.phase === "transcribing" && html`<div class="big">Transcribing with Fish Audio…</div>`}
      ${(voice.phase === "heard" || voice.phase === "routing") && html`<div class="big ellipsis">“${voice.text}”</div><div class="route-chip"><span class="spinner" style="width:10px;height:10px"></span> Jev is routing…</div>`}
      ${voice.phase === "routed" && html`<div class="big ellipsis">“${voice.text}”</div>
        <div class="route-chip"><${Icon} name="arrow" size=${13} /> ${OP_LABELS[result.operation] || result.operation}${result.label ? ` · ${result.label}` : ""}
        <span class="faint">· ${result.ms} ms${result.fallback ? " · fallback" : ""}</span></div>`}
    </div>
    ${listening && html`<button class="btn sm" onClick=${() => stopListening(true)}>Send</button>`}
  </div>`;
}

function Settings({ close, status }) {
  const [replies, setReplies] = useState(settings.get("voiceReplies", true));
  const [mode, setMode] = useState(settings.get("navMode", "watch"));
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "dark");
  const set = (key, value, setter) => { settings.set(key, value); setter(value); };
  const flip = (value) => { document.documentElement.dataset.theme = value; try { localStorage.setItem("vn.theme", value); } catch {} setTheme(value); };
  return html`<div class="scrim" onClick=${(e) => e.target === e.currentTarget && close()}>
    <div class="modal" role="dialog" aria-label="Settings">
      <header>Settings <button class="icon-btn" onClick=${close} aria-label="Close"><${Icon} name="x" /></button></header>
      <div class="body">
        <div class="setting"><div class="grow"><div class="t">Voice replies</div><div class="d">The assistant answers out loud (Fish Audio) when you speak to it.</div></div>
          <button class=${cx("toggle", replies && "on")} onClick=${() => set("voiceReplies", !replies, setReplies)} aria-label="Voice replies"></button></div>
        <div class="setting"><div class="grow"><div class="t">Navigator pace</div><div class="d">How long the next action stays visible before it runs.</div></div>
          <div class="seg">${["fast", "watch", "step"].map((m) => html`<button class=${cx(mode === m && "on")} onClick=${() => set("navMode", m, setMode)}>${m === "fast" ? "Fast" : m === "watch" ? "Watch" : "Step"}</button>`)}</div></div>
        <div class="setting"><div class="grow"><div class="t">Appearance</div><div class="d">Dark or light interface.</div></div>
          <div class="seg"><button class=${cx(theme === "dark" && "on")} onClick=${() => flip("dark")}><${Icon} name="moon" size=${14} /> Dark</button><button class=${cx(theme === "light" && "on")} onClick=${() => flip("light")}><${Icon} name="sun" size=${14} /> Light</button></div></div>
        <div class="setting"><div class="grow"><div class="t">Services</div><div class="d">Keys stay in .env on this computer.</div></div>
          <div class="row" style="flex-wrap:wrap;justify-content:flex-end">
            <span class=${cx("pill", status?.openrouter ? "good" : "bad")}><span class="dot"></span>OpenRouter</span>
            <span class=${cx("pill", status?.fish ? "good" : "bad")}><span class="dot"></span>Fish Audio</span></div></div>
        <div class="setting"><div class="grow"><div class="t">Models</div><div class="d mono">${status ? `${status.builder_model} · Jev ${status.jev_model} · ${status.text_model}` : "…"}</div></div></div>
        <div class="setting"><div class="grow"><div class="t">Shortcuts</div><div class="d">
          <span class="kbd">Space</span> hold to talk · <span class="kbd">Ctrl</span> <span class="kbd">K</span> commands · <span class="kbd">Esc</span> cancel</div></div></div>
      </div>
    </div>
  </div>`;
}

function Palette({ close, open }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const commands = useMemo(() => [
    { icon: "sparkles", label: "New website", run: () => { navigate("/studio"); bus.emit("studio:reset"); } },
    { icon: "compass", label: "New web task", run: () => navigate("/navigator") },
    { icon: "mic", label: "Talk to VoiceNav", run: () => listen() },
    { icon: "home", label: "Go to Home", run: () => navigate("/") },
    { icon: "layout", label: "Go to Studio", run: () => navigate("/studio") },
    { icon: "folder", label: "Go to Projects", run: () => navigate("/projects") },
    { icon: "settings", label: "Open settings", run: open },
    { icon: "moon", label: "Toggle dark / light", run: () => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next; try { localStorage.setItem("vn.theme", next); } catch {}
    } },
  ], []);
  const list = commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
  const run = (c) => { close(); c?.run(); };
  return html`<div class="scrim" onClick=${(e) => e.target === e.currentTarget && close()}>
    <div class="modal palette" role="dialog" aria-label="Command palette">
      <input autofocus placeholder="Type a command…" value=${query}
        onInput=${(e) => { setQuery(e.target.value); setIndex(0); }}
        onKeyDown=${(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, list.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter") run(list[index]);
          if (e.key === "Escape") close();
        }} />
      <ul>${list.map((c, i) => html`<li class=${cx(i === index && "on")} onMouseEnter=${() => setIndex(i)} onClick=${() => run(c)}>
        <${Icon} name=${c.icon} size=${16} /><span class="grow">${c.label}</span></li>`)}</ul>
    </div></div>`;
}

function App() {
  const path = useRoute();
  const view = viewOf(path);
  const [listening, setListening] = useState(false);
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState(null);
  const [crumb, setCrumb] = useState(null);

  useEffect(() => { health().then(setStatus).catch(() => {}); }, []);
  useEffect(() => bus.on("crumb", setCrumb), []);
  useEffect(() => setCrumb(null), [view]);
  useEffect(() => bus.on("voice:state", (s) => setListening(s.phase === "listening" || s.phase === "starting")), []);
  useEffect(() => {
    let holding = false;
    const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const down = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setModal((m) => (m === "palette" ? null : "palette")); }
      if (e.key === "Escape" && isListening()) stopListening(false);
      if (e.code === "Space" && !e.repeat && !typing(document.activeElement) && !modal) {
        e.preventDefault(); holding = true; listen({ mode: "hold", source: "space" });
      }
    };
    const up = (e) => { if (e.code === "Space" && holding) { holding = false; stopListening(true); } };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [modal]);

  const title = { home: "Home", studio: "Studio", navigator: "Navigator", projects: "Projects" }[view];
  return html`<div class="app">
    <nav class="rail" aria-label="Main">
      <button class="logo" onClick=${() => navigate("/")} aria-label="VoiceNav home"><${Icon} name="waves" size=${20} stroke=${2.4} /></button>
      ${NAV.map((n) => html`<button class=${cx("rail-item", view === n.view && "active")} data-tip=${n.label}
        aria-label=${n.label} onClick=${() => navigate(n.path)}><${Icon} name=${n.icon} size=${20} /></button>`)}
      <div class="rail-spacer"></div>
      <button class="rail-item" data-tip="Commands (Ctrl K)" aria-label="Commands" onClick=${() => setModal("palette")}><${Icon} name="command" size=${19} /></button>
      <button class="rail-item" data-tip="Settings" aria-label="Settings" onClick=${() => setModal("settings")}><${Icon} name="settings" size=${19} /></button>
    </nav>
    <div class="main">
      <header class="topbar">
        <div class="crumbs grow"><span class=${crumb ? "faint" : ""}>${title}</span>
          ${crumb && html`<span class="sep">/</span><span class="ellipsis">${crumb}</span>`}</div>
        <span class="pill" title="Models"><${Icon} name="bolt" size=${12} /> Jev · Claude Haiku · Fish</span>
        <button class=${cx("orb-btn", listening && "listening")} onClick=${() => listen()} aria-label="Talk to VoiceNav">
          <span class="orb-mini"><${Icon} name="mic" size=${14} stroke=${2.2} /></span>
          ${listening ? "Listening…" : html`Talk <span class="kbd">Space</span>`}
        </button>
      </header>
      <section class="view">
        ${view === "home" && html`<${Home} status=${status} />`}
        ${view === "studio" && html`<${Studio} path=${path} />`}
        ${view === "navigator" && html`<${Navigator} />`}
        ${view === "projects" && html`<${Projects} />`}
      </section>
    </div>
    <${VoiceOverlay} />
    <${Toasts} />
    ${modal === "settings" && html`<${Settings} close=${() => setModal(null)} status=${status} />`}
    ${modal === "palette" && html`<${Palette} close=${() => setModal(null)} open=${() => setModal("settings")} />`}
  </div>`;
}

render(html`<${App} />`, document.getElementById("root"));
