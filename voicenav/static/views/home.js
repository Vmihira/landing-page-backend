import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api } from "../lib/api.js";
import { listen, navigate, registerProvider, submit } from "../lib/hub.js";
import { Icon } from "../lib/icons.js";
import { ago, bus, cx } from "../lib/util.js";

const BUILD = [
  "A landing page for Crumb & Co, a sourdough bakery in Bengaluru with weekend pre-orders",
  "A sleek SaaS site for an AI meeting-notes app, with pricing and FAQ",
  "A portfolio for a wedding photographer in Goa, dark and cinematic",
];
const DO = [
  "Find the cheapest Samsung Galaxy S25 with 256 GB storage on Amazon",
  "Find the Wikipedia article about Gödel's incompleteness theorems",
  "Find one-way flights from Bengaluru to Delhi next Friday on Google Flights",
];

export function Home({ status }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [recent, setRecent] = useState([]);
  const box = useRef();

  useEffect(() => registerProvider("home", { context: () => ({ stage: "home" }) }), []);
  useEffect(() => bus.on("voice:state", (s) => setListening(s.phase === "listening" || s.phase === "starting")), []);
  useEffect(() => { api("studio/list").then((d) => setRecent(d.projects.slice(0, 4))).catch(() => {}); }, []);

  const send = (value = text) => {
    const v = value.trim();
    if (!v) return;
    setText("");
    if (box.current) box.current.style.height = "auto";
    submit(v, { source: "home" });
  };
  const grow = (e) => { e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`; };

  return html`<div class="home">
    <div class="home-bg"></div>
    <div class="home-inner">
      <button class=${cx("hero-orb", listening && "listening")} onClick=${() => listen({ source: "home" })} aria-label="Speak to VoiceNav">
        <span class="halo"></span><span class="halo b"></span>
        <span class="core"><${Icon} name="mic" size=${34} stroke=${2} /></span>
      </button>
      <h1>What should we <span class="grad-text">do</span> today?</h1>
      <p class="sub">Describe a website to build, or a task to get done on the web. Say it or type it. VoiceNav figures out the rest.</p>
      <div class="ask">
        <button class=${cx("mic", listening && "listening")} onClick=${() => listen({ source: "home" })} aria-label="Speak"><${Icon} name="mic" /></button>
        <textarea ref=${box} rows="1" value=${text} placeholder="e.g. Build a landing page for my yoga studio… or Find a flight to Delhi on Friday"
          onInput=${(e) => { setText(e.target.value); grow(e); }}
          onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.currentTarget.value); } }}></textarea>
        <button class="btn primary lg" onClick=${() => send()} disabled=${!text.trim()}>Go <${Icon} name="arrow" size=${16} /></button>
      </div>
      <div class="ask-hint">
        <span><span class="kbd">Space</span> hold to talk</span><span><span class="kbd">Enter</span> send</span><span><span class="kbd">Ctrl</span> <span class="kbd">K</span> commands</span>
      </div>
      <div class="lanes">
        <div class="card lane">
          <h3><span class="avatar" style="width:24px;height:24px;border-radius:8px"><${Icon} name="layout" size=${14} /></span> Build a website</h3>
          <p>Studio asks a few questions, plans the sections, lets you pick a theme, and builds it live.</p>
          <div class="examples">${BUILD.map((b) => html`<button class="example" onClick=${() => submit(b, { source: "home" })}><${Icon} name="sparkles" size=${16} /><span>${b}</span></button>`)}</div>
        </div>
        <div class="card lane">
          <h3><span class="avatar" style="width:24px;height:24px;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#22d3ee)"><${Icon} name="compass" size=${14} /></span> Get it done on the web</h3>
          <p>Navigator opens the right site and works through it while you watch every next move.</p>
          <div class="examples">${DO.map((d) => html`<button class="example" onClick=${() => submit(d, { source: "home" })}><${Icon} name="cursor" size=${16} /><span>${d}</span></button>`)}</div>
        </div>
      </div>
      ${recent.length > 0 && html`<div class="recent">
        <div class="row"><span class="label grow">Recent projects</span><button class="btn ghost sm" onClick=${() => navigate("/projects")}>All projects <${Icon} name="arrow" size=${14} /></button></div>
        <div class="recent-row">${recent.map((p) => html`<button class="example" onClick=${() => navigate(`/studio/${p.id}`)}>
          <${Icon} name="layout" size=${16} /><span class="grow ellipsis"><b style="color:var(--text);font-weight:600">${p.name}</b><br/><span class="faint" style="font-size:11.5px">${p.versions ? `v${p.current}` : p.stage} · ${ago(p.updated)}</span></span></button>`)}</div>
      </div>`}
      <div class="status-row">
        <span class=${cx("pill", status?.openrouter ? "good" : "bad")}><span class="dot"></span> Jev + Claude via OpenRouter</span>
        <span class=${cx("pill", status?.fish ? "good" : "bad")}><span class="dot"></span> Fish Audio voice</span>
        <span class="pill"><${Icon} name="shield" size=${12} /> Keys stay on this computer</span>
      </div>
    </div>
  </div>`;
}
