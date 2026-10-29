import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, follow, health } from "../lib/api.js";
import { OP_LABELS, listen, navigate, registerProvider, submit } from "../lib/hub.js";
import { Icon } from "../lib/icons.js";
import { ago, bus, cx, highlight, seconds, toast } from "../lib/util.js";
import { say, settings } from "../lib/voice.js";

const IDEAS = [
  { icon: "zap", text: "A sleek SaaS landing page for an AI meeting-notes app with pricing and FAQ" },
  { icon: "palette", text: "A cinematic portfolio for a wedding photographer in Goa" },
  { icon: "sparkles", text: "A landing page for Crumb & Co, a sourdough bakery in Bengaluru with weekend pre-orders" },
  { icon: "globe", text: "An event site for a two-day indie game developers conference in Pune" },
];
const EDITS = ["Make the hero more dramatic", "Add a testimonials carousel", "Tighten all the copy", "Add a FAQ section",
  "Use a darker, moodier palette"];

let bridgeText = "";
let bridgePromise = null;
const loadBridge = () => (bridgePromise ??= fetch("/static/preview-bridge.js").then((r) => r.text()).then((t) => (bridgeText = t)));
loadBridge();
let sitesOrigin = `http://localhost:${location.port}`;
health().then((h) => { sitesOrigin = h.sites || sitesOrigin; }).catch(() => {});

const withBridge = (doc, code) => {
  const tag = `<script>${code}<\/script>`;
  const i = doc.lastIndexOf("</body>");
  return i >= 0 ? doc.slice(0, i) + tag + doc.slice(i) : doc + tag;
};
const shell = (code) => `<!doctype html><html data-vn-mode="build"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"><\/script>` +
  `<style>#vn-wait{position:fixed;inset:0;display:grid;place-items:center;font:500 14px Inter,system-ui,sans-serif;color:#6b7280;` +
  `background:#fafafa}#vn-wait i{display:block;width:180px;height:4px;margin:14px auto 0;border-radius:4px;` +
  `background:linear-gradient(90deg,#8b5cf6,#22d3ee,#8b5cf6);background-size:200% 100%;animation:w 1.2s linear infinite}` +
  `@keyframes w{to{background-position:-200% 0}}.reveal{opacity:1!important;transform:none!important}</style></head><body><div id="vn-wait"><div>Setting up the design system…<i></i></div></div>` +
  `<script>${code}<\/script></body></html>`;

const loadedFonts = new Set();
function useFonts(themes) {
  useEffect(() => {
    const families = [...new Set((themes || []).flatMap((t) => [t.fonts.heading, t.fonts.body]))].filter((f) => !loadedFonts.has(f));
    if (!families.length) return;
    families.forEach((f) => loadedFonts.add(f));
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${families.map((f) => `family=${encodeURIComponent(f)}:wght@400;600;700`).join("&")}&display=swap`;
    document.head.appendChild(link);
  }, [themes]);
}

function useNow(active, ms = 100) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active]);
  return Date.now();
}

const titleize = (id) => id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const stageOf = (p) => (!p ? "none" : p.stage === "understanding" ? "asking" : p.stage);

// ------------------------------------------------------------------ chat cards

function Thinking({ pending }) {
  const now = useNow(true);
  const lines = pending.kind === "understand"
    ? ["Reading your brief", "Working out who it's for", "Choosing the questions that matter"]
    : ["Mapping the sections and content", "Designing four themes", "Writing the creative direction"];
  const elapsed = now - pending.started;
  const active = Math.min(lines.length - 1, Math.floor(elapsed / (pending.kind === "understand" ? 1400 : 4200)));
  return html`<div class="msg assistant"><div class="avatar"><${Icon} name="sparkles" size=${15} /></div>
    <div class="acard">
      <h4><span class="spinner"></span>${pending.kind === "understand" ? "Understanding your idea" : "Planning your site"}
        <span class="timer">${seconds(elapsed)}</span></h4>
      <div class="thinking">${lines.map((l, i) => html`<div class=${cx("line", i <= active && "on")}>
        ${i < active ? html`<${Icon} name="check" size=${14} />` : i === active ? html`<span class="typing"><i></i><i></i><i></i></span>` : html`<span style="width:14px"></span>`} ${l}</div>`)}</div>
    </div></div>`;
}

function Questions({ message, live, draft, setDraft, onContinue, onSkip }) {
  const answer = (q, option) => setDraft((d) => {
    const current = d.answers[q.id] ?? (q.multi ? [q.recommended] : q.recommended);
    const value = q.multi ? (current.includes(option) ? current.filter((x) => x !== option) : [...current, option]) : option;
    return { ...d, answers: { ...d.answers, [q.id]: value } };
  });
  const chosen = (q, option) => {
    const v = draft.answers[q.id] ?? (q.multi ? [q.recommended] : q.recommended);
    return q.multi ? v.includes(option) : v === option;
  };
  return html`<div class="msg assistant"><div class="avatar"><${Icon} name="sparkles" size=${15} /></div>
    <div class="grow" style="display:grid;gap:10px">
      <div class="bubble">${message.summary} ${message.questions.length ? "A few quick questions so it fits you perfectly:" : ""}</div>
      ${message.questions.length > 0 && html`<div class="acard">
        ${message.questions.map((q) => html`<div class="question">
          <div class="q">${q.question} ${q.multi && html`<span class="faint" style="font-weight:400">· pick any</span>`}</div>
          <div class="opts">${q.options.map((o) => html`<button class=${cx("chip", chosen(q, o) && "on")} disabled=${!live}
            onClick=${() => answer(q, o)}><span class="check">${chosen(q, o) && html`<${Icon} name="check" size=${10} stroke=${3} />`}</span>${o}</button>`)}</div>
        </div>`)}
        ${live && html`<input class="input" placeholder="Anything else? (optional)" value=${draft.note}
          onInput=${(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          onKeyDown=${(e) => e.key === "Enter" && onContinue()} />
        <div class="row"><button class="btn primary" onClick=${onContinue}>Continue <${Icon} name="arrow" size=${15} /></button>
          <button class="btn ghost" onClick=${onSkip}>Decide for me</button><span class="grow"></span>
          <span class="faint" style="font-size:11.5px"><${Icon} name="mic" size=${12} /> or just say your answers</span></div>`}
      </div>`}
    </div></div>`;
}

function ThemeCard({ theme, on, recommended, onPick }) {
  const c = theme.colors;
  return html`<button class=${cx("theme", on && "on")} onClick=${onPick} aria-pressed=${on}>
    <div class="mock" style=${`background:${c.background};color:${c.text}`}>
      <div class="h" style=${`font-family:'${theme.fonts.heading}',serif;color:${c.text}`}>Aa ${theme.name.split(" ")[0]}</div>
      <div class="p" style=${`background:${c.muted};width:80%`}></div><div class="p" style=${`background:${c.muted};width:55%`}></div>
      <div class="b"><i style=${`background:${c.primary};width:42px;border-radius:${theme.radius === "round" ? 99 : theme.radius === "soft" ? 4 : 1}px`}></i>
        <i style=${`background:${c.surface};width:30px;border:1px solid ${c.muted}55`}></i></div>
    </div>
    <div class="info"><div class="name">${theme.name}<span class="swatches">${["background", "surface", "primary", "accent"].map((k) => html`<i style=${`background:${c[k]}`}></i>`)}</span></div>
      <div class="desc">${theme.mode === "dark" ? "Dark" : "Light"} · ${theme.fonts.heading} · ${theme.description}</div></div>
    ${recommended && html`<span class="rec">Recommended</span>`}
  </button>`;
}

function Plan({ project, live, draft, setDraft, onBuild, onReplan }) {
  const plan = project.plan;
  useFonts(project.themes);
  const [adding, setAdding] = useState("");
  const [dragging, setDragging] = useState(null);
  const sections = draft.sections || plan.sections;
  const setSections = (list) => setDraft((d) => ({ ...d, sections: list }));
  const move = (from, to) => {
    if (to < 0 || to >= sections.length) return;
    const list = [...sections];
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    setSections(list);
  };
  if (!live) {
    const theme = project.themes.find((t) => t.id === project.theme_id);
    return html`<div class="msg assistant"><div class="avatar"><${Icon} name="list" size=${15} /></div>
      <div class="acard"><h4><${Icon} name="check" size=${15} /> Plan · ${plan.brand.name || project.name}</h4>
      <p class="lead">${plan.sections.length} sections · ${theme ? `${theme.name} theme` : ""}</p></div></div>`;
  }
  const enabled = sections.filter((s) => s.enabled !== false).length;
  return html`<div class="msg assistant"><div class="avatar"><${Icon} name="list" size=${15} /></div>
    <div class="grow" style="display:grid;gap:10px">
      <div class="bubble">Here's the plan for <b>${plan.brand.name || project.name}</b>${plan.brand.tagline ? html` · “${plan.brand.tagline}”` : ""}. Pick a theme, adjust the sections, and I'll build it.</div>
      <div class="acard">
        <h4><${Icon} name="palette" size=${15} /> Theme</h4>
        <div class="themes">${project.themes.map((t) => html`<${ThemeCard} theme=${t} on=${draft.theme === t.id}
          recommended=${t.id === plan.recommended_theme} onPick=${() => setDraft((d) => ({ ...d, theme: t.id }))} />`)}</div>
      </div>
      <div class="acard">
        <h4><${Icon} name="layout" size=${15} /> Sections <span class="faint" style="font-weight:400">· ${enabled} of ${sections.length} · drag to reorder</span></h4>
        <div class="sections">${sections.map((s, i) => html`<div class=${cx("section-row", s.enabled === false && "off", dragging === i && "drag")}
            draggable="true" onDragStart=${() => setDragging(i)} onDragEnd=${() => setDragging(null)}
            onDragOver=${(e) => { e.preventDefault(); if (dragging !== null && dragging !== i) { move(dragging, i); setDragging(i); } }}>
          <button class=${cx("check-box", s.enabled !== false && "on")} aria-label=${`Include ${s.name}`}
            onClick=${() => setSections(sections.map((x, j) => (j === i ? { ...x, enabled: x.enabled === false } : x)))}>
            ${s.enabled !== false && html`<${Icon} name="check" size=${11} stroke=${3} />`}</button>
          <span class="n">${i + 1}</span>
          <div class="grow"><div class="t">${s.name}</div>${s.purpose && html`<div class="p ellipsis">${s.purpose}</div>`}</div>
          <button class="icon-btn x" style="width:26px;height:26px" aria-label="Move up" onClick=${() => move(i, i - 1)}><${Icon} name="up" size=${14} /></button>
          <button class="icon-btn x" style="width:26px;height:26px" aria-label="Remove" onClick=${() => setSections(sections.filter((_, j) => j !== i))}><${Icon} name="x" size=${14} /></button>
        </div>`)}</div>
        <div class="row"><input class="input" placeholder="Add a section, e.g. Gallery" value=${adding} onInput=${(e) => setAdding(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter" && adding.trim()) { const name = adding.trim(); const footer = sections.findIndex((s) => s.id === "footer");
            const list = [...sections]; list.splice(footer < 0 ? list.length : footer, 0, { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, purpose: "", enabled: true }); setSections(list); setAdding(""); } }} />
        </div>
      </div>
      <div class="row">
        <button class="btn primary lg grow" onClick=${onBuild}><${Icon} name="wand" size=${17} /> Build website</button>
        <button class="btn lg" onClick=${onReplan} title="Regenerate the plan"><${Icon} name="refresh" size=${16} /></button>
      </div>
      <div class="faint" style="font-size:11.5px;text-align:center">Say “use the second theme”, “drop the FAQ”, or “build it”.</div>
    </div></div>`;
}

function Result({ message, last, onSuggest, project }) {
  const [open, setOpen] = useState(false);
  const s = message.stats || {};
  const checks = message.checks || [];
  const passed = checks.filter((c) => c.status === "pass").length;
  return html`<div class="msg assistant"><div class="avatar"><${Icon} name=${message.kind === "edit" ? "wand" : "check"} size=${15} /></div>
    <div class="grow" style="display:grid;gap:10px">
      <div class="acard">
        <h4>${message.kind === "edit" ? "Change applied" : "Your site is live"} <span class="pill accent">v${message.version}</span>
          <span class="timer">${ago(message.t)}</span></h4>
        <p class="lead">${message.note}</p>
        <div class="stats">
          <div class="stat"><b>${seconds(s.ms)}</b><span>build time</span></div>
          <div class="stat"><b>${s.kb} KB</b><span>${s.lines} lines</span></div>
          <div class="stat"><b>${passed}/${checks.length}</b><span>checks</span></div>
          <div class="stat"><b>${s.cost != null ? `$${s.cost.toFixed(3)}` : "—"}</b><span>cost</span></div>
        </div>
        <button class="btn ghost sm" style="justify-self:start" onClick=${() => setOpen(!open)}>
          <${Icon} name="shield" size=${14} /> Quality report <${Icon} name=${open ? "up" : "down"} size=${13} /></button>
        ${open && html`<div class="checks">${checks.map((c) => html`<div class=${cx("check-row", c.status)}>
          <${Icon} name=${c.status === "pass" ? "check" : "alert"} size=${14} /><span>${c.label}</span><span class="d">${c.detail}</span></div>`)}</div>`}
      </div>
      ${last && html`<div class="suggest">${EDITS.map((e) => html`<button class="chip" onClick=${() => onSuggest(e)}><${Icon} name="wand" size=${13} />${e}</button>`)}</div>`}
    </div></div>`;
}

function Job({ job, onStop }) {
  const now = useNow(!job.done);
  const elapsed = now - job.started;
  if (job.kind === "edit") {
    return html`<div class="msg assistant"><div class="avatar"><${Icon} name="wand" size=${15} /></div>
      <div class="acard"><h4><span class="spinner"></span> Applying your change <span class="timer">${seconds(elapsed)}</span></h4>
        <p class="lead">“${job.instruction}”</p>
        <div class="row" style="flex-wrap:wrap">${job.editing.length ? job.editing.map((p) => html`<span class="pill accent"><${Icon} name="target" size=${12} /> ${p === "head" ? "Design tokens" : titleize(p)}</span>`)
          : html`<span class="faint" style="font-size:12px">Reading the page and deciding what to change…</span>`}</div>
        <div class="row faint" style="font-size:11.5px"><${Icon} name="bolt" size=${12} /> ${job.rate ? `${job.rate} tok/s` : "starting"} · ${Math.round((job.chars || 0) / 1024 * 10) / 10} KB written
          <span class="grow"></span><button class="btn ghost sm danger" onClick=${onStop}>Stop</button></div>
      </div></div>`;
  }
  const parts = job.progress?.parts || job.steps.filter((s) => !["design", "interactions", "voice", "qa"].includes(s.id)).map((s) => s.id);
  const labels = Object.fromEntries(job.steps.map((s) => [s.id, s.label]));
  const steps = ["design", ...parts, "interactions", "voice", "qa"];
  const done = new Set([...(job.progress?.done || []), ...Object.entries(job.post).filter(([, v]) => v === "done").map(([k]) => k)]);
  const current = job.post.qa === "active" ? "qa" : job.post.voice === "active" ? "voice" : job.progress?.current;
  const pct = Math.round((done.size / steps.length) * 100);
  return html`<div class="msg assistant"><div class="avatar"><${Icon} name="wand" size=${15} /></div>
    <div class="acard">
      <h4><span class="spinner"></span> Building ${job.theme ? html`with <span class="grad-text">${job.theme.name}</span>` : "your site"}
        <span class="timer">${seconds(elapsed)}</span></h4>
      <div class="row"><div class="bar grow"><i style=${`width:${Math.max(pct, 3)}%`}></i></div><span class="mono faint" style="font-size:11px">${pct}%</span></div>
      <div class="steps">${steps.map((id) => {
        const state = done.has(id) ? "done" : id === current ? "active" : "";
        const t = job.times[id];
        return html`<div class=${cx("step", state)}><span class="ic">${state === "done" ? html`<${Icon} name="check" size=${15} stroke=${2.4} />`
          : state === "active" ? html`<span class="spinner"></span>` : html`<span class="ring"></span>`}</span>
          ${labels[id] || titleize(id)}${id === "design" && job.theme ? html`<span class="faint"> · ${job.theme.fonts.heading}</span>` : null}
          <span class="time">${t?.end ? seconds(t.end - t.start) : state === "active" && t?.start ? seconds(now - t.start) : ""}</span></div>`;
      })}</div>
      <div class="row faint" style="font-size:11.5px"><${Icon} name="bolt" size=${12} />
        ${job.firstToken == null ? "Warming up the model…" : `${job.rate || 0} tok/s · ${Math.round((job.chars || 0) / 102.4) / 10} KB`}
        <span class="grow"></span><button class="btn ghost sm danger" onClick=${onStop}>Stop</button></div>
    </div></div>`;
}

// ------------------------------------------------------------------ canvas

function Blueprint({ project, draft }) {
  const theme = project.themes.find((t) => t.id === (draft.theme || project.theme_id)) || project.themes[0];
  const sections = (draft.sections || project.plan.sections).filter((s) => s.enabled !== false);
  useFonts(project.themes);
  if (!theme) return null;
  const c = theme.colors;
  const r = theme.radius === "round" ? 18 : theme.radius === "soft" ? 10 : 2;
  return html`<div style=${`position:absolute;inset:0;overflow:auto;background:${c.background};color:${c.text};font-family:'${theme.fonts.body}',sans-serif;transition:background .4s`}>
    <div style=${`display:flex;align-items:center;gap:18px;padding:16px 28px;border-bottom:1px solid ${c.muted}33;position:sticky;top:0;background:${c.background}ee;backdrop-filter:blur(8px)`}>
      <b style=${`font-family:'${theme.fonts.heading}',serif;font-size:18px`}>${project.plan.brand.name || project.name}</b><span style="flex:1"></span>
      ${sections.filter((s) => !["hero", "footer"].includes(s.id)).slice(0, 5).map((s) => html`<span style=${`font-size:12px;color:${c.muted}`}>${s.name}</span>`)}
      <span style=${`padding:7px 14px;border-radius:${r}px;background:${c.primary};color:${c.background};font-size:12px;font-weight:600`}>Get started</span>
    </div>
    ${sections.map((s, i) => html`<div key=${s.id} style=${`padding:${s.id === "hero" ? "64px 28px" : "34px 28px"};border-bottom:1px dashed ${c.muted}30;animation:rise .4s both;animation-delay:${i * 40}ms;background:${i % 2 ? c.surface : c.background}`}>
      <div style=${`font:600 10px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:${c.accent};margin-bottom:10px`}>${String(i + 1).padStart(2, "0")} · ${s.name}</div>
      <div style=${`font-family:'${theme.fonts.heading}',serif;font-size:${s.id === "hero" ? 36 : 22}px;font-weight:700;line-height:1.1;max-width:640px;margin-bottom:10px`}>
        ${s.id === "hero" ? project.plan.brand.tagline || project.plan.brand.name : s.purpose || s.name}</div>
      ${(s.highlights || []).length > 0 && html`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:14px">
        ${s.highlights.map((h) => html`<div style=${`padding:12px;border-radius:${r}px;border:1px solid ${c.muted}30;background:${c.surface};font-size:12px;color:${c.muted}`}>${h}</div>`)}</div>`}
      ${s.id === "hero" && html`<div style="display:flex;gap:10px;margin-top:18px"><span style=${`padding:10px 18px;border-radius:${r}px;background:${c.primary};color:${c.background};font-weight:600;font-size:13px`}>Primary action</span>
        <span style=${`padding:10px 18px;border-radius:${r}px;border:1px solid ${c.muted}60;font-size:13px`}>Learn more</span></div>`}
    </div>`)}
  </div>`;
}

function EmptyCanvas({ stage }) {
  const text = stage === "asking" ? ["Answer a few questions", "Then I'll draft the plan and four themes for you."]
    : stage === "planning" ? ["Drafting your plan", "Sections, copy direction, and themes are on the way."]
      : ["Your website appears here", "Describe it in the chat, or just say it."];
  return html`<div class="empty-canvas"><div>
    <div class="wire"><div class="nav"><span class="skeleton" style="width:90px"></span><span class="skeleton" style="width:220px"></span></div>
      <div class="hero skeleton"></div><div class="cols"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div></div>
    <h3 style="margin:0 0 6px">${text[0]}</h3><p class="muted" style="margin:0">${text[1]}</p></div></div>`;
}

function Code({ source, streaming }) {
  const box = useRef();
  useEffect(() => { if (streaming && box.current) box.current.scrollTop = box.current.scrollHeight; }, [source, streaming]);
  return html`<div class="code-view" ref=${box}>
    <div class="code-tools"><button class="btn sm" onClick=${() => { navigator.clipboard.writeText(source || ""); toast("Code copied", "good"); }}><${Icon} name="copy" size=${14} /> Copy</button></div>
    <pre dangerouslySetInnerHTML=${{ __html: highlight(source || "") + (streaming ? '<span class="ln"><span class="cursor"></span></span>' : "") }}></pre></div>`;
}

function Versions({ project, onPick }) {
  const [open, setOpen] = useState(false);
  if (!project?.versions?.length) return null;
  return html`<div class="versions">
    <button class="btn sm" onClick=${() => setOpen(!open)}><${Icon} name="history" size=${14} /> v${project.current}</button>
    ${open && html`<div class="menu" onMouseLeave=${() => setOpen(false)}>${[...project.versions].reverse().map((v) => html`
      <button class=${cx(v.n === project.current && "on")} onClick=${() => { setOpen(false); onPick(v.n); }}>
        <span class="v">v${v.n}</span><span class="grow"><div style="font-size:12.5px">${v.note}</div><div class="faint" style="font-size:11px">${ago(v.created)} · ${v.stats?.kb} KB</div></span>
      </button>`)}</div>`}
  </div>`;
}

// ------------------------------------------------------------------ studio

export function Studio({ path }) {
  const id = path.split("/")[2] || null;
  const [project, setProject] = useState(null);
  const [pending, setPending] = useState(null);
  const [job, setJob] = useState(null);
  const [site, setSite] = useState(null);
  const [mode, setMode] = useState("preview");
  const [device, setDevice] = useState("desktop");
  const [targets, setTargets] = useState([]);
  const [section, setSection] = useState(null);
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState({ answers: {}, note: "", theme: null, sections: null });
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [replies, setReplies] = useState(settings.get("voiceReplies", true));
  const frame = useRef();
  const preview = useRef(null);
  const follower = useRef(null);
  const list = useRef();
  const spoken = useRef(new Set());
  const voiced = useRef(false);
  const ref = useRef({});
  ref.current = { project, draft, targets, site, job };

  const post = (type, data = {}) => frame.current?.contentWindow?.postMessage({ ...data, vn: true, type }, "*");
  const reply = (line) => { if (voiced.current) say(line); };
  const note = (icon, line) => setNotes((n) => [...n.slice(-5), { icon, line, t: Date.now() }]);

  const loadSite = async (p, n) => {
    if (!p?.current) { setSite(null); return; }
    const [{ html: doc }, code] = await Promise.all([api("studio/html", { id: p.id, n: n || p.current }), loadBridge()]);
    setSite({ html: doc, version: n || p.current, srcdoc: withBridge(doc, code) });
  };

  const open = async (projectId) => {
    try {
      const data = await api("studio/get", { id: projectId });
      setProject(data.project);
      setDraft({ answers: {}, note: "", theme: data.project.theme_id, sections: data.project.plan?.sections || null });
      await loadSite(data.project);
      if (data.busy) watch(projectId);
    } catch (error) {
      toast(error.message, "error");
      navigate("/studio");
    }
  };

  useEffect(() => {
    follower.current?.stop();
    setNotes([]);
    if (!id) { setProject(null); setSite(null); setJob(null); setTargets([]); return; }
    if (ref.current.project?.id !== id) open(id);
  }, [id]);
  useEffect(() => { bus.emit("crumb", project?.name || null); }, [project?.name]);
  useEffect(() => bus.on("voice:state", (s) => {
    setListening(s.phase === "listening" || s.phase === "starting");
    if (s.source === "preview") post("voice", { phase: s.phase, label: s.phase === "listening" ? "Listening…" : s.phase === "routed" ? `→ ${s.result?.label || OP_LABELS[s.result?.operation] || ""}` : undefined });
  }), []);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; },
    [project?.messages?.length, pending, job?.kind, job?.done, notes.length, project?.stage]);

  // Messages from the preview frame.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.vn) return;
      const m = e.data;
      if (m.type === "ready" && m.mode === "build" && preview.current) post("stream", { ...preview.current, follow: true });
      if (m.type === "ready" || m.type === "targets") if (m.targets?.length) setTargets(m.targets);
      if (m.type === "section") setSection(m);
      if (m.type === "listen") listen({ view: "preview", source: "preview" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ---------------- actions

  const create = async (brief, meta = {}) => {
    voiced.current = Boolean(meta.voice);
    if (meta.voice) spoken.current.add(brief);
    follower.current?.stop();
    setProject(null); setSite(null); setJob(null); setTargets([]); setNotes([]);
    setDraft({ answers: {}, note: "", theme: null, sections: null });
    setPending({ kind: "understand", text: brief, started: Date.now() });
    try {
      const { project: p } = await api("studio/new", { brief });
      setProject(p);
      setPending(null);
      navigate(`/studio/${p.id}`);
      reply(`${p.summary} ${p.questions.length ? "A few quick questions first." : ""}`);
    } catch (error) {
      setPending(null);
      toast(error.message, "error");
    }
  };

  const plan = async ({ skip = false, note: extra = "" } = {}) => {
    const p = ref.current.project;
    const d = ref.current.draft;
    const answers = {};
    for (const q of p.questions || []) answers[q.id] = d.answers[q.id] ?? (q.multi ? [q.recommended] : q.recommended);
    const noteText = [d.note, extra].filter(Boolean).join(" · ");
    setPending({ kind: "plan", text: skip ? "Decide for me." : noteText, started: Date.now() });
    try {
      const { project: next } = await api("studio/plan", { id: p.id, answers: skip ? {} : answers, note: noteText, skip });
      setProject(next);
      setDraft((x) => ({ ...x, note: "", theme: next.theme_id, sections: next.plan.sections }));
      const theme = next.themes.find((t) => t.id === next.theme_id);
      reply(`Here's the plan: ${next.plan.sections.length} sections. I recommend the ${theme?.name} theme. Pick a theme, then say build it.`);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setPending(null);
    }
  };

  const watch = (projectId) => {
    follower.current?.stop();
    preview.current = null;
    setJob({ kind: null, started: Date.now(), steps: [], progress: null, post: {}, times: {}, editing: [], code: "" });
    const stamp = (times, prevCurrent, progress) => {
      const now = Date.now();
      const next = { ...times };
      for (const d of progress.done) if (next[d] && !next[d].end) next[d] = { ...next[d], end: now };
      if (progress.current && !next[progress.current]) next[progress.current] = { start: now };
      return next;
    };
    follower.current = follow("studio/events", { id: projectId }, (ev) => {
      if (ev.type === "start") setJob((j) => ({ ...j, kind: ev.kind, steps: ev.steps || [], theme: ev.theme, instruction: ev.instruction, started: ev.t * 1000, times: { design: { start: Date.now() } } }));
      else if (ev.type === "first_token") setJob((j) => ({ ...j, firstToken: ev.ms }));
      else if (ev.type === "progress") setJob((j) => ({ ...j, progress: ev, times: stamp(j.times, j.progress?.current, ev) }));
      else if (ev.type === "code") setJob((j) => ({ ...j, code: ev.text, rate: ev.tokens_per_s, chars: ev.chars }));
      else if (ev.type === "preview") { preview.current = ev; post("stream", { ...ev, follow: true }); }
      else if (ev.type === "step") setJob((j) => ({ ...j, post: { ...j.post, [ev.id]: ev.status } }));
      else if (ev.type === "editing") {
        setJob((j) => { const parts = [...j.editing, ev.part]; post("highlight", { parts, scroll: true }); return { ...j, editing: parts }; });
      } else if (ev.type === "done") {
        setJob((j) => ({ ...j, done: ev }));
        api("studio/get", { id: projectId }).then(async ({ project: p }) => {
          setProject(p);
          const code = await loadBridge();
          setSite({ html: ev.html, version: ev.version, srcdoc: withBridge(ev.html, code) });
          setJob(null);
          setMode((m) => (m === "code" ? "code" : "preview"));
          const passed = ev.checks.filter((c) => c.status === "pass").length;
          toast(`v${ev.version} ready · ${passed}/${ev.checks.length} checks passed`, "good");
          reply(ev.note && ev.note.startsWith("First build") ? `Your site is ready. It took ${Math.round(ev.stats.ms / 1000)} seconds. Ask me for any change, or say go to a section.` : ev.note);
        });
      } else if (ev.type === "error") {
        toast(ev.message, "error");
        api("studio/get", { id: projectId }).then(({ project: p }) => { setProject(p); setJob(null); });
      } else if (ev.type === "idle") setJob(null);
    });
  };

  const build = async () => {
    const { project: p, draft: d } = ref.current;
    try {
      const { project: next } = await api("studio/build", { id: p.id, theme_id: d.theme, sections: d.sections });
      setProject(next);
      setMode("preview");
      watch(next.id);
      reply("Building it now. Watch it come together on the left.");
    } catch (error) { toast(error.message, "error"); }
  };

  const edit = async (instruction) => {
    const p = ref.current.project;
    try {
      const { project: next } = await api("studio/edit", { id: p.id, instruction });
      setProject(next);
      watch(next.id);
    } catch (error) { toast(error.message, "error"); }
  };

  const stop = () => ref.current.project && api("studio/cancel", { id: ref.current.project.id }).catch(() => {});
  const pickVersion = async (n) => {
    const { project: p } = await api("studio/version", { id: ref.current.project.id, n });
    setProject(p);
    await loadSite(p, n);
  };
  const siteUrl = (download = false) => {
    const p = ref.current.project;
    return `${sitesOrigin}/sites/${p.id}/v${ref.current.site?.version || p.current}${download ? "?download=1" : ""}`;
  };
  const download = () => { const a = document.createElement("a"); a.href = siteUrl(true); a.click(); toast("Downloading · voice navigation included", "good"); };
  const test = () => {
    const p = ref.current.project;
    navigate("/navigator");
    setTimeout(() => bus.emit("nav:prepare", { url: siteUrl(), name: p.name }), 40);
  };

  const run = (result, said, meta = {}) => {
    voiced.current = Boolean(meta.voice);
    if (meta.voice) spoken.current.add(said);
    const op = result.operation;
    const tag = `“${said}” → ${OP_LABELS[op] || op}${result.label ? ` · ${result.label}` : ""}`;
    switch (op) {
      case "ANSWER": return plan({ note: said });
      case "DECIDE_FOR_ME": return plan({ skip: true });
      case "CHANGE_PLAN": return plan({ note: said });
      case "PICK_THEME": if (result.target) { setDraft((d) => ({ ...d, theme: result.target })); note("palette", tag); reply(`${result.label} it is.`); } return;
      case "BUILD_NOW": return build();
      case "EDIT_SITE": return edit(said);
      case "GO_TO": if (result.target != null) { setMode("preview"); post("go", { index: Number(result.target) }); note("target", tag); } return;
      case "SCROLL_DOWN": post("scroll", { dir: "down" }); return note("scroll", tag);
      case "SCROLL_UP": post("scroll", { dir: "up" }); return note("up", tag);
      case "SCROLL_TOP": post("top"); return note("up", tag);
      case "DEVICE": if (result.target) { setDevice(result.target); note(result.target === "mobile" ? "phone" : result.target === "tablet" ? "tablet" : "monitor", tag); } return;
      case "SHOW_CODE": setMode("code"); return note("code", tag);
      case "SHOW_PREVIEW": setMode("preview"); return note("eye", tag);
      case "DOWNLOAD": return download();
      case "TEST_IN_NAVIGATOR": return test();
      case "STOP_BUILD": stop(); return note("stop", tag);
      default: toast(`“${said}” isn't something I can do here yet.`);
    }
    return undefined;
  };

  useEffect(() => {
    const context = () => {
      const { project: p, targets: t } = ref.current;
      return {
        stage: stageOf(p), has_site: Boolean(p?.current), site_name: p?.name,
        themes: p?.stage === "planned" ? p.themes.map((x) => ({ id: x.id, name: x.name, mode: x.mode, description: x.description })) : [],
        targets: p?.current ? t : [],
      };
    };
    const offStudio = registerProvider("studio", {
      context,
      fallback: () => (!ref.current.project ? "BUILD_WEBSITE" : stageOf(ref.current.project) === "asking" ? "ANSWER" : null),
      handle: run,
    });
    const offPreview = registerProvider("preview", { context: () => ({ targets: ref.current.targets }), handle: run });
    const offNew = bus.on("studio:new", (payload) => create(payload.text, payload));
    const offReset = bus.on("studio:reset", () => { setProject(null); setSite(null); setJob(null); setPending(null); });
    return () => { offStudio(); offPreview(); offNew(); offReset(); follower.current?.stop(); };
  }, []);

  const send = (value = text) => {
    const v = value.trim();
    if (!v) return;
    setText("");
    const box = document.querySelector(".chat .composer textarea");
    if (box) box.style.height = "auto";
    submit(v, { source: "chat", view: "studio" });
  };

  // ---------------- render

  const stage = pending?.kind === "understand" ? "asking" : pending?.kind === "plan" ? "planning" : stageOf(project);
  const building = job && job.kind === "build" && !job.done;
  const busy = Boolean(job) || Boolean(pending);
  const messages = project?.messages || [];
  const lastQuestions = messages.map((m) => m.kind).lastIndexOf("questions");
  const lastPlan = messages.map((m) => m.kind).lastIndexOf("plan");
  const lastResult = Math.max(messages.map((m) => m.kind).lastIndexOf("build"), messages.map((m) => m.kind).lastIndexOf("edit"));
  const placeholder = !project ? "Describe the website you want…"
    : stage === "asking" ? "Answer in your own words…"
      : stage === "planned" ? "“Build it”, or ask for changes…"
        : busy ? "Working… say “stop” to cancel" : "Ask for a change, or “go to pricing”";
  const address = project?.current ? `localhost:${location.port}/sites/${project.id}/v${site?.version || project.current}${section?.id ? `#${section.id}` : ""}`
    : project ? `${project.name} · ${stage === "planned" ? "blueprint" : "draft"}` : "new-site";

  let canvas;
  if (mode === "code" && (job?.code || site)) canvas = html`<${Code} source=${job && !job.done ? job.code : site?.html} streaming=${Boolean(job && !job.done)} />`;
  else if (building) canvas = html`<iframe key="shell" ref=${frame} title="Live build preview" sandbox="allow-scripts" srcdoc=${shell(bridgeText)}></iframe>`;
  else if (site) canvas = html`<iframe key=${`site-${site.version}`} ref=${frame} title="Website preview" sandbox="allow-scripts allow-forms allow-popups allow-modals" srcdoc=${site.srcdoc}></iframe>`;
  else if (project?.plan && stage !== "planning") canvas = html`<${Blueprint} project=${project} draft=${draft} />`;
  else canvas = html`<${EmptyCanvas} stage=${stage} />`;

  return html`<div class="studio">
    <div class="canvas">
      <div class="canvas-bar">
        <div class="seg">
          <button class=${cx(mode === "preview" && "on")} onClick=${() => setMode("preview")}><${Icon} name="eye" size=${14} /> Preview</button>
          <button class=${cx(mode === "code" && "on")} onClick=${() => setMode("code")} disabled=${!site && !job?.code}><${Icon} name="code" size=${14} /> Code</button>
        </div>
        <div class="seg">${[["desktop", "monitor"], ["tablet", "tablet"], ["mobile", "phone"]].map(([d, icon]) => html`
          <button class=${cx(device === d && "on")} onClick=${() => setDevice(d)} aria-label=${d} title=${d}><${Icon} name=${icon} size=${14} /></button>`)}</div>
        <div class="grow row" style="justify-content:center">
          ${building && html`<span class="pill accent"><span class="dot live"></span> Building · ${titleize(job.progress?.current || "design")}</span>`}
          ${job?.kind === "edit" && html`<span class="pill accent"><span class="dot live"></span> Editing${job.editing.length ? ` · ${job.editing.map(titleize).join(", ")}` : "…"}</span>`}
          ${!job && site && section?.label && html`<span class="pill"><${Icon} name="eye" size=${12} /> Viewing · ${section.label}</span>`}
          ${!job && site && html`<span class="pill cyan" title="Voice targets Jev can navigate to"><${Icon} name="target" size=${12} /> ${targets.length} voice targets</span>`}
        </div>
        ${site && html`<button class="btn sm" onClick=${() => listen({ view: "preview", source: "preview" })} disabled=${busy}><${Icon} name="mic" size=${14} /> Navigate</button>`}
        <${Versions} project=${project} onPick=${pickVersion} />
        <button class="icon-btn" data-tip-down data-tip="Open in new tab" disabled=${!site} onClick=${() => window.open(siteUrl(), "_blank")}><${Icon} name="external" size=${16} /></button>
        <button class="icon-btn" data-tip-down data-tip="Download HTML" disabled=${!site} onClick=${download}><${Icon} name="download" size=${16} /></button>
        <button class="btn sm" disabled=${!site || busy} onClick=${test}><${Icon} name="compass" size=${14} /> Test in Navigator</button>
      </div>
      <div class=${cx("stage", !site && !building && !project?.plan && "dots")}>
        <div class=${cx("frame", device)}>
          <div class="chrome"><div class="lights"><i></i><i></i><i></i></div>
            <div class="address"><${Icon} name=${site ? "shield" : "globe"} size=${12} /><span class="ellipsis">${address}</span></div>
            ${site && html`<span class="pill" style="height:22px">v${site.version}</span>`}</div>
          <div style="position:relative;min-height:0">${canvas}</div>
          ${building && html`<div class="build-ribbon"><i style=${`transform:scaleX(${(job.progress?.done?.length || 0) / ((job.progress?.parts?.length || 8) + 4)})`}></i></div>`}
        </div>
        ${building && job.progress?.current && html`<div class="stage-badge"><span class="spinner"></span> Writing <b>${titleize(job.progress.current)}</b>
          <span class="faint mono" style="font-size:11.5px">${job.rate || 0} tok/s</span></div>`}
      </div>
    </div>

    <aside class="chat" aria-label="Studio assistant">
      <div class="chat-head">
        <div class="avatar"><${Icon} name="sparkles" size=${15} /></div>
        <div class="grow"><div style="font-weight:600;font-size:13.5px">Studio</div>
          <div class="faint" style="font-size:11px">Claude Haiku 5.5 builds · Jev routes · Fish listens</div></div>
        <button class=${cx("icon-btn", replies && "on")} data-tip-down data-tip=${replies ? "Voice replies on" : "Voice replies off"}
          onClick=${() => { settings.set("voiceReplies", !replies); setReplies(!replies); }}><${Icon} name=${replies ? "volume" : "mute"} size=${16} /></button>
        <button class="icon-btn" data-tip-down data-tip="New website" onClick=${() => { navigate("/studio"); bus.emit("studio:reset"); }}><${Icon} name="plus" size=${17} /></button>
      </div>
      <div class="chat-list" ref=${list}>
        ${!project && !pending && html`<div class="msg assistant"><div class="avatar"><${Icon} name="sparkles" size=${15} /></div>
          <div class="grow" style="display:grid;gap:10px"><div class="bubble">Hi! Tell me what you want to build: the business, who it's for, and the vibe.
            I'll ask a couple of questions, plan the sections, offer four themes, and build it live. You can talk to me the whole way.</div>
            <div style="display:grid;gap:8px">${IDEAS.map((i) => html`<button class="example" onClick=${() => create(i.text)}><${Icon} name=${i.icon} size=${16} /><span>${i.text}</span></button>`)}</div></div></div>`}
        ${pending?.kind === "understand" && html`<div class="msg user"><div class="bubble">${spoken.current.has(pending.text) && html`<div class="voice-tag"><${Icon} name="mic" size=${11} /> spoken</div>`}${pending.text}</div></div>`}
        ${messages.map((m, i) => {
          if (m.role === "user") return html`<div class="msg user"><div class="bubble">${spoken.current.has(m.text) && html`<div class="voice-tag"><${Icon} name="mic" size=${11} /> spoken</div>`}${m.text}</div></div>`;
          if (m.kind === "questions") return html`<${Questions} message=${m} live=${i === lastQuestions && project.stage === "asking" && !pending} draft=${draft} setDraft=${setDraft} onContinue=${() => plan()} onSkip=${() => plan({ skip: true })} />`;
          if (m.kind === "plan") return html`<${Plan} project=${project} live=${i === lastPlan && project.stage === "planned"} draft=${draft} setDraft=${setDraft} onBuild=${build} onReplan=${() => plan({ note: "Try a different direction." })} />`;
          if (m.kind === "build" || m.kind === "edit") return html`<${Result} message=${m} last=${i === lastResult && !job && project.stage === "ready"} onSuggest=${(s) => submit(s, { source: "chat", view: "studio" })} project=${project} />`;
          if (m.kind === "error") return html`<div class="msg assistant"><div class="avatar" style="background:var(--bad-soft);color:var(--bad)"><${Icon} name="alert" size=${15} /></div><div class="bubble" style="color:var(--bad)">${m.text}</div></div>`;
          return null;
        })}
        ${pending?.kind === "plan" && pending.text && html`<div class="msg user"><div class="bubble">${pending.text}</div></div>`}
        ${pending && html`<${Thinking} pending=${pending} />`}
        ${job && job.kind && html`<${Job} job=${job} onStop=${stop} />`}
        ${notes.map((n) => html`<div class="row faint" style="font-size:11.5px;justify-content:center"><${Icon} name=${n.icon} size=${12} /> ${n.line}</div>`)}
      </div>
      <div class="composer">
        <div class="box">
          <button class=${cx("mic", listening && "listening")} onClick=${() => listen({ view: "studio", source: "chat" })} aria-label="Speak"><${Icon} name="mic" size=${18} /></button>
          <textarea rows="1" value=${text} placeholder=${placeholder} onInput=${(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
            onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.currentTarget.value); } }}></textarea>
          <button class="btn primary" style="height:40px;width:40px;padding:0" onClick=${() => send()} disabled=${!text.trim()} aria-label="Send"><${Icon} name="send" size=${16} /></button>
        </div>
        <div class="foot"><span><span class="kbd">Space</span> hold to talk · <span class="kbd">Enter</span> send</span>
          <span>${stage === "ready" ? `${targets.length} voice targets` : stage === "none" ? "Start with an idea" : titleize(stage)}</span></div>
      </div>
    </aside>
  </div>`;
}
