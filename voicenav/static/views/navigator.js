import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/preact-htm.js";
import { api, follow } from "../lib/api.js";
import { listen, registerProvider, submit } from "../lib/hub.js";
import { Icon } from "../lib/icons.js";
import { bus, cx, domain, percent, seconds, toast } from "../lib/util.js";
import { say, settings } from "../lib/voice.js";

const EXAMPLES = [
  "Find the cheapest Samsung Galaxy S25 with 256 GB storage on Amazon and open its product page. Do not add it to the cart.",
  "Find the Wikipedia article about Gödel's incompleteness theorems and open it",
  "Find one-way flights from Bengaluru to Delhi next Friday on Google Flights. Stop when results are visible.",
];

const PHASES = {
  choosing_site: ["globe", "Choosing the website"],
  site: ["globe", "Website chosen"],
  opening: ["globe", "Opening the page"],
  observed: ["eye", "Reading the page"],
  thinking: ["sparkles", "Jev is choosing the next action"],
  decision: ["target", "Next action"],
  writing: ["type", "Writing the text to type"],
  text: ["type", "Text ready"],
  executing: ["cursor", "Executing"],
  settling: ["clock", "Waiting for the page"],
  stale: ["refresh", "The page changed · looking again"],
};
const KIND_ICON = { click: "cursor", fill: "type", select: "list", scroll: "scroll", wait: "clock" };
const OP_WORD = { CLICK: "CLICK", TYPE_TEXT: "TYPE", SELECT: "SELECT", SCROLL_DOWN: "SCROLL", SCROLL_UP: "SCROLL", WAIT: "WAIT", DONE: "DONE", BLOCKED: "BLOCKED" };

function useNow(active) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [active]);
  return Date.now();
}

/** Largest 1120x780 screen (+38px chrome) that fits the stage. */
function useFit(ref) {
  const [size, setSize] = useState({ w: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const w = el.clientWidth - 36, h = el.clientHeight - 36;
      setSize({ w: Math.max(320, Math.min(w, (h - 38) * (1120 / 780))) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

export function Navigator() {
  const [run, setRun] = useState(null);
  const [text, setText] = useState("");
  const [mode, setModeState] = useState(settings.get("navMode", "watch"));
  const [prepared, setPrepared] = useState(null);
  const [listening, setListening] = useState(false);
  const follower = useRef(null);
  const wrap = useRef();
  const size = useFit(wrap);
  const ref = useRef({});
  const voiced = useRef(false);
  ref.current = { run, prepared, mode };
  const active = run && !run.finished && !run.error;
  const now = useNow(Boolean(active));

  const update = (patch) => setRun((r) => (r ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r));

  const onEvent = (ev) => {
    if (ev.type === "idle") return;
    if (ev.type === "status") update({ status: ev.status });
    else if (ev.type === "phase") {
      update((r) => {
        const next = { phase: { ...ev, at: Date.now() } };
        if (ev.phase === "site" || ev.phase === "opening") next.url = ev.url;
        if (ev.phase === "observed") next.page = ev;
        if (ev.phase === "text") next.typed = ev.text;
        if (ev.phase === "thinking") { next.decision = null; next.typed = null; next.clicking = false; }
        if (ev.phase === "executing") next.clicking = true;
        if (ev.phase === "settling") next.clicking = false;
        if (ev.phase === "site" && voiced.current) say(`Opening ${domain(ev.url)}.`);
        return next;
      });
    } else if (ev.type === "plan") update({ plan: ev.steps });
    else if (ev.type === "decision") update((r) => ({ decision: ev, planStep: ev.plan_step || r.planStep, decisions: (r.decisions || 0) + 1, phase: { phase: "decision", at: Date.now() } }));
    else if (ev.type === "action") update((r) => ({ actions: [...r.actions, { ...ev, typed: ev.text }] }));
    else if (ev.type === "frame") update({ frame: ev.data, url: ev.url || undefined, title: ev.title });
    else if (ev.type === "mode") update({ mode: ev.mode });
    else if (ev.type === "finished") {
      update({ finished: ev, status: ev.status });
      const words = ev.status === "done" ? "Done." : ev.status === "blocked" ? "I got stuck and stopped." : "Stopped.";
      if (voiced.current) say(`${words} ${ev.actions} actions in ${Math.round(ev.elapsed_ms / 1000)} seconds.`);
    } else if (ev.type === "error") { update({ error: ev.message }); toast(ev.message, "error"); }
  };

  const watch = () => {
    follower.current?.stop();
    follower.current = follow("nav/events", {}, onEvent);
  };

  const start = async (goal, meta = {}) => {
    const g = (goal || "").trim();
    if (!g) return;
    voiced.current = Boolean(meta.voice);
    const url = meta.url ?? ref.current.prepared?.url ?? null;
    setRun({ goal: g, url, status: "starting", phase: { phase: url ? "opening" : "choosing_site", at: Date.now() }, plan: null, planStep: null,
      actions: [], decision: null, frame: null, started: Date.now(), spoken: Boolean(meta.voice), mode: ref.current.mode });
    setText("");
    try {
      await api("nav/start", { goal: g, url, mode: ref.current.mode });
      watch();
    } catch (error) {
      update({ error: error.message });
      toast(error.message, "error");
    }
  };

  const control = (action, value) => api("nav/control", { action, value }).catch((e) => toast(e.message, "error"));
  const setMode = (m) => { setModeState(m); settings.set("navMode", m); if (ref.current.run && !ref.current.run.finished) control("mode", m); };

  useEffect(() => {
    api("nav/state").then((s) => {
      if (s.active && !ref.current.run) {
        setRun({ goal: s.goal, status: s.status, phase: { phase: "observed", at: Date.now() }, plan: null, actions: [], started: Date.now() });
        watch();
      }
    }).catch(() => {});
    const offs = [
      bus.on("voice:state", (s) => setListening(s.phase === "listening" || s.phase === "starting")),
      bus.on("nav:start", (p) => start(p.text, p)),
      bus.on("nav:prepare", (p) => { setPrepared(p); toast(`Navigator will work on ${p.name}. Say or type the task.`, "good"); }),
      registerProvider("navigator", {
        context: () => ({ nav_status: ref.current.run && !ref.current.run.finished ? ref.current.run.status : "idle", nav_goal: ref.current.run?.goal }),
        direct: (said, meta) => { if (ref.current.prepared && !(ref.current.run && !ref.current.run.finished)) { start(said, meta); return true; } return false; },
        fallback: () => (ref.current.run && !ref.current.run.finished ? null : "WEB_TASK"),
        handle: (result, said, meta) => {
          voiced.current = Boolean(meta.voice);
          const op = result.operation;
          if (op === "PAUSE") control("pause");
          else if (op === "RESUME") control("resume");
          else if (op === "STOP") control("stop");
          else if (op === "CONFIRM") control("confirm");
          else start(said, meta);
        },
      }),
    ];
    return () => { offs.forEach((off) => off()); follower.current?.stop(); };
  }, []);

  const send = (value = text) => { const v = value.trim(); if (v) submit(v, { source: "navigator", view: "navigator" }); setText(""); };

  // ---------------- derived
  const r = run || {};
  const d = r.decision;
  const page = d?.page || r.page;
  const pw = page?.w || 1120, ph = page?.h || 780;
  const showTarget = d && d.rect && !r.finished && ["decision", "writing", "text", "executing"].includes(r.phase?.phase);
  const box = showTarget ? { left: `${(d.rect.x / pw) * 100}%`, top: `${(d.rect.y / ph) * 100}%`, width: `${(d.rect.w / pw) * 100}%`, height: `${(d.rect.h / ph) * 100}%` } : null;
  const cursor = d?.rect ? { left: `${((d.rect.x + d.rect.w / 2) / pw) * 100}%`, top: `${((d.rect.y + d.rect.h / 2) / ph) * 100}%` } : { left: "50%", top: "45%" };
  const [phaseIcon, phaseTitle] = r.phase?.phase === "decision" && d ? ["target", `Next: ${OP_WORD[d.operation] || d.operation}`] : PHASES[r.phase?.phase] || ["sparkles", "Starting"];
  const phaseTime = r.phase ? now - r.phase.at : 0;
  const elapsed = r.finished ? r.finished.elapsed_ms : r.started ? now - r.started : 0;
  const statusPill = r.finished ? { done: ["good", "Done"], blocked: ["warn", "Blocked"], stopped: ["", "Stopped"], error: ["bad", "Error"] }[r.finished.status] || ["", r.finished.status]
    : r.error ? ["bad", "Error"] : r.status === "paused" ? ["warn", "Paused"] : r.status === "waiting" ? ["accent", "Waiting for you"] : run ? ["cyan", "Running"] : ["", "Idle"];
  const caption = !run || r.finished ? null : r.phase?.phase === "decision" || r.phase?.phase === "executing" || r.phase?.phase === "text" || r.phase?.phase === "writing"
    ? d && { op: OP_WORD[d.operation] || d.operation, label: d.label, typed: r.typed }
    : { op: "…", label: phaseTitle + (r.phase?.elements ? ` · ${r.phase.elements} elements` : "") };

  return html`<div class="nav">
    <div class="nav-stage">
      <div class="canvas-bar">
        <span class=${cx("pill", statusPill[0])}><span class=${cx("dot", active && "live")}></span>${statusPill[1]}</span>
        ${run && html`<span class="mono faint" style="font-size:12px">${seconds(elapsed)}</span>`}
        <div class="grow"></div>
        <div class="seg" title="How the agent paces itself">
          ${[["fast", "zap", "Fast"], ["watch", "eye", "Watch"], ["step", "step", "Step"]].map(([m, icon, label]) => html`
            <button class=${cx(mode === m && "on")} onClick=${() => setMode(m)}><${Icon} name=${icon} size=${13} /> ${label}</button>`)}
        </div>
        ${active && r.status === "waiting" && html`<button class="btn sm primary" onClick=${() => control("confirm")}><${Icon} name="play" size=${13} /> Run next</button>`}
        ${active && (r.status === "paused"
          ? html`<button class="btn sm" onClick=${() => control("resume")}><${Icon} name="play" size=${13} /> Resume</button>`
          : html`<button class="btn sm" onClick=${() => control("pause")}><${Icon} name="pause" size=${13} /> Pause</button>`)}
        ${active && html`<button class="btn sm danger" onClick=${() => control("stop")}><${Icon} name="stop" size=${13} /> Stop</button>`}
      </div>
      <div class="screen-wrap" ref=${wrap}>
        <div class="screen" style=${`width:${size.w}px;aspect-ratio:auto;grid-template-rows:38px ${size.w * 780 / 1120}px`}>
          <div class="chrome"><div class="lights"><i></i><i></i><i></i></div>
            <div class="address">${(r.url || page?.url) ? html`<img src=${`https://www.google.com/s2/favicons?domain=${domain(r.url || page?.url)}&sz=32`} width="12" height="12" alt="" />` : html`<${Icon} name="globe" size=${12} />`}
              <span class="ellipsis">${r.url || page?.url || "Waiting for a task"}</span></div>
            ${active && html`<span class="live-badge"><span class="dot live"></span>LIVE</span>`}</div>
          <div class="screen-body">
            ${r.frame ? html`<img src=${`data:image/jpeg;base64,${r.frame}`} alt="The agent's browser" />`
              : html`<div class="screen-empty"><div>
                ${run && r.error ? html`<div class="avatar" style="width:52px;height:52px;border-radius:16px;margin:0 auto 16px;background:var(--bad-soft);color:var(--bad)"><${Icon} name="alert" size=${24} /></div>
                    <h3 style="margin:0 0 6px">The run stopped</h3><p class="muted" style="margin:0 auto;max-width:440px">${r.error}</p>`
                  : run ? html`<div class="spinner lg" style="margin:0 auto 16px"></div><h3 style="margin:0 0 6px">${phaseTitle}…</h3><p class="muted" style="margin:0">${r.url ? domain(r.url) : "Picking the best website for this task"}</p>`
                  : html`<div class="hero-orb" style="width:84px;height:84px;margin-bottom:22px" onClick=${() => listen({ view: "navigator", source: "navigator" })}><span class="halo"></span><span class="core"><${Icon} name="compass" size=${30} /></span></div>
                    <h2 style="margin:0 0 8px;letter-spacing:-.02em">Tell me what to get done</h2>
                    <p class="muted" style="margin:0 auto;max-width:420px">I'll open the right website and work through it here, showing every next move before I make it.</p>`}
              </div></div>`}
            ${box && html`<div class=${cx("target-box", d.rect.y < 40 && "under")} style=${box}><span class="tag">${OP_WORD[d.operation]} · ${d.label}</span></div>`}
            ${run && r.frame && !r.finished && html`<svg class=${cx("cursor-dot", r.clicking && "click")} style=${cursor} viewBox="0 0 24 24" fill="#fff" stroke="#111" stroke-width="1.4"><path d="M4 3l7 17 2.5-7.5L21 10 4 3Z" /></svg>`}
            ${caption && html`<div class="caption"><span class="op">${caption.op}</span><span class="ellipsis">${caption.label}</span>
              ${caption.typed && html`<span class="mono" style="color:#a5f3fc">“${caption.typed}”</span>`}</div>`}
          </div>
        </div>
      </div>
    </div>

    <aside class="side">
      <div class="side-scroll">
        ${run ? html`
          <div class="panel">
            <div class="label"><${Icon} name="flag" size=${13} /> Task ${r.spoken && html`<span class="pill accent" style="height:20px"><${Icon} name="mic" size=${11} /> spoken</span>`}</div>
            <div style="font-size:13.5px;line-height:1.5">${r.goal}</div>
            ${(r.url) && html`<div class="row" style="margin-top:10px"><span class="pill"><img src=${`https://www.google.com/s2/favicons?domain=${domain(r.url)}&sz=32`} width="12" height="12" alt="" /> ${domain(r.url)}</span>
              ${r.decisions ? html`<span class="pill">${r.decisions} decisions</span>` : null}<span class="pill">${r.actions.length} actions</span></div>`}
          </div>
          ${!r.finished && !r.error && html`<div class="panel now">
            <div class="label"><span class="dot live" style="color:var(--accent-2)"></span> Now</div>
            <div class="phase"><${Icon} name=${phaseIcon} size=${17} /> ${phaseTitle} ${r.phase?.phase !== "decision" && html`<span class="spinner"></span>`}<span class="timer">${seconds(phaseTime)}</span></div>
            ${d && ["decision", "writing", "text", "executing"].includes(r.phase?.phase) && html`<div class="next">
              <span class="op">${d.operation}${d.target_confidence != null ? ` · ${percent(d.target_confidence)} sure` : ` · ${percent(d.confidence)} sure`}</span>
              <span style="font-size:13px">${d.label}</span>
              ${r.typed && html`<span class="mono" style="font-size:12px;color:var(--accent-ink)">types “${r.typed}”</span>`}
              ${r.status === "waiting" && html`<div class="row" style="margin-top:6px"><button class="btn sm primary" onClick=${() => control("confirm")}>Run it</button><button class="btn sm" onClick=${() => control("stop")}>Stop</button>
                <span class="faint" style="font-size:11px">or say “go ahead”</span></div>`}
            </div>`}
            ${r.phase?.phase === "thinking" && html`<div class="detail">Reading ${r.phase.elements || "the"} elements on screen and weighing every possible operation in one request.</div>`}
            ${r.phase?.phase === "choosing_site" && html`<div class="detail">Working out which website fits “${r.goal.slice(0, 60)}${r.goal.length > 60 ? "…" : ""}”.</div>`}
          </div>`}
          ${r.finished && !r.error && html`<div class="panel result">
            <div class="big"><${Icon} name=${r.finished.status === "done" ? "check" : "alert"} size=${18} /> ${r.finished.status === "done" ? "Task complete" : r.finished.status === "blocked" ? "Agent got stuck" : "Stopped"}</div>
            <div class="stats" style="grid-template-columns:repeat(3,1fr)">
              <div class="stat"><b>${seconds(r.finished.elapsed_ms)}</b><span>total</span></div>
              <div class="stat"><b>${r.finished.actions}</b><span>actions</span></div>
              <div class="stat"><b>${r.finished.decisions}</b><span>decisions</span></div></div>
            ${r.finished.page && html`<a class="pill" style="justify-self:start;max-width:100%" href=${r.finished.page.url} target="_blank" rel="noopener"><${Icon} name="external" size=${12} /><span class="ellipsis">${r.finished.page.title || r.finished.page.url}</span></a>`}
            <div class="faint" style="font-size:11.5px">“Done” is the agent's own judgement. Check the final page yourself.</div>
            <div class="row"><button class="btn sm" onClick=${() => start(r.goal, { url: r.url })}><${Icon} name="refresh" size=${13} /> Run again</button>
              <button class="btn sm ghost" onClick=${() => setRun(null)}>New task</button></div>
          </div>`}
          ${r.error && html`<div class="panel"><div class="big" style="color:var(--bad);display:flex;gap:8px;align-items:center;font-weight:600"><${Icon} name="alert" size=${17} /> The run stopped</div>
            <p class="muted" style="font-size:12.5px;margin:8px 0">${r.error}</p><div class="row"><button class="btn sm" onClick=${() => start(r.goal)}>Try again</button><button class="btn sm ghost" onClick=${() => setRun(null)}>New task</button></div></div>`}
          <div class="panel">
            <div class="label"><${Icon} name="list" size=${13} /> Plan</div>
            ${r.plan == null ? html`<div class="thinking"><div class="skeleton" style="height:14px;width:80%"></div><div class="skeleton" style="height:14px;width:65%"></div><div class="skeleton" style="height:14px;width:72%"></div></div>`
              : r.plan.length === 0 ? html`<div class="faint" style="font-size:12.5px">Working directly from the goal.</div>`
                : html`<div class="plan-steps">${r.plan.map((step, i) => {
                  const n = i + 1;
                  const doneAll = r.finished?.status === "done";
                  const state = doneAll || (r.planStep && n < r.planStep) ? "done" : r.planStep === n && !r.finished ? "current" : "";
                  return html`<div class=${cx("plan-step", state)}><span class="ic">${state === "done" ? html`<${Icon} name="check" size=${12} stroke=${3} />` : n}</span><span>${step}</span></div>`;
                })}</div>`}
          </div>
          ${d && html`<div class="panel">
            <div class="label"><${Icon} name="sparkles" size=${13} /> Jev's decision <span class="faint mono" style="margin-left:auto;text-transform:none;letter-spacing:0">${d.latency_ms} ms · ${d.elements} elements</span></div>
            <div class="probs">${Object.entries(d.operations).map(([op, p], i) => html`<div class=${cx("prob", i === 0 && "top")}>
              <div class="name"><span>${op}</span></div><span class="v">${percent(p)}</span><div class="track"><i style=${`width:${p * 100}%`}></i></div></div>`)}</div>
            ${d.candidates?.length > 0 && html`<div class="divider"></div><div class="label" style="margin-bottom:8px">Top targets</div>
              <div class="probs">${d.candidates.slice(0, 4).map((c, i) => html`<div class=${cx("prob", i === 0 && "top")}>
                <div class="name"><span>[${c.index}] ${c.label}</span></div><span class="v">${percent(c.p)}</span><div class="track"><i style=${`width:${c.p * 100}%`}></i></div></div>`)}</div>`}
          </div>`}
          ${r.actions.length > 0 && html`<div class="panel"><div class="label"><${Icon} name="history" size=${13} /> Timeline</div>
            <div class="timeline">${[...r.actions].reverse().map((a) => html`<div class="tl">
              <span class="k"><${Icon} name=${KIND_ICON[a.kind] || "cursor"} size=${13} /></span>
              <div class="what"><b>${a.action}</b>${a.typed ? html`<div class="typed">“${a.typed}”</div>` : null}
                <div class="faint" style="font-size:11px">${a.page_changed ? "page changed" : "no visible change"}${a.page?.url && a.page.url !== r.url ? ` · ${domain(a.page.url)}` : ""}</div></div>
              <span class="when">#${a.step}<br />${seconds(a.latency_ms)}</span></div>`)}</div></div>`}
        ` : html`
          ${prepared && html`<div class="panel" style="border-color:rgba(139,92,246,.4)"><div class="label"><${Icon} name="layout" size=${13} /> Testing your site</div>
            <div class="row"><b class="grow ellipsis">${prepared.name}</b><button class="icon-btn" onClick=${() => setPrepared(null)} aria-label="Clear"><${Icon} name="x" size=${15} /></button></div>
            <div class="faint" style="font-size:12px;margin-top:4px">Tell the agent what a visitor would do, e.g. “find the pricing and click the main call to action”.</div></div>`}
          <div class="panel"><div class="label"><${Icon} name="sparkles" size=${13} /> Try</div>
            <div style="display:grid;gap:8px">${(prepared ? ["Find the pricing section and click the main call to action", "Read the FAQ and open the contact section"] : EXAMPLES).map((e) => html`
              <button class="example" onClick=${() => (prepared ? start(e) : submit(e, { source: "navigator", view: "navigator" }))}><${Icon} name="cursor" size=${15} /><span>${e}</span></button>`)}</div></div>
          <div class="panel"><div class="label"><${Icon} name="info" size=${13} /> How it works</div>
            <div class="muted" style="font-size:12.5px;line-height:1.6">The page becomes a numbered list of what's on screen. Jev picks one operation and one element in a single request. Only typing calls a language model. Every action is shown before it runs, and clicks are re-checked against the live page.</div></div>
        `}
      </div>
      <div class="side-composer">
        <div class="composer" style="padding:0;border:0;background:none">
          <div class="box">
            <button class=${cx("mic", listening && "listening")} onClick=${() => listen({ view: "navigator", source: "navigator" })} aria-label="Speak"><${Icon} name="mic" size=${18} /></button>
            <textarea rows="1" value=${text} placeholder=${active ? "Say “pause”, “stop”, or give a new task…" : prepared ? `What should a visitor do on ${prepared.name}?` : "Tell the agent what to do on the web…"}
              onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.currentTarget.value); } }}></textarea>
            <button class="btn primary" style="height:40px;width:40px;padding:0" onClick=${() => send()} disabled=${!text.trim()} aria-label="Start"><${Icon} name="arrow" size=${16} /></button>
          </div>
          <div class="foot"><span><span class="kbd">Space</span> hold to talk</span><span>${mode === "step" ? "Step: you approve each action" : mode === "fast" ? "Fast: no pause between actions" : "Watch: each action shown first"}</span></div>
        </div>
      </div>
    </aside>
  </div>`;
}
