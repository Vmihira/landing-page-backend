import { html, useEffect, useState } from "../vendor/preact-htm.js";
import { api, health } from "../lib/api.js";
import { navigate, registerProvider } from "../lib/hub.js";
import { Icon } from "../lib/icons.js";
import { ago, toast } from "../lib/util.js";

export function Projects() {
  const [projects, setProjects] = useState(null);
  const [sites, setSites] = useState(`http://localhost:${location.port}`);
  const [query, setQuery] = useState("");

  const load = () => api("studio/list").then((d) => setProjects(d.projects)).catch((e) => toast(e.message, "error"));
  useEffect(() => {
    load();
    health().then((h) => h.sites && setSites(h.sites)).catch(() => {});
    return registerProvider("projects", { context: () => ({ stage: "projects" }) });
  }, []);

  const remove = async (e, p) => {
    e.stopPropagation();
    if (!confirm(`Delete “${p.name}” and all its versions?`)) return;
    await api("studio/delete", { id: p.id });
    toast(`Deleted ${p.name}`);
    load();
  };
  const shown = (projects || []).filter((p) => `${p.name} ${p.brief}`.toLowerCase().includes(query.toLowerCase()));

  return html`<div class="projects"><div class="projects-inner">
    <div class="row">
      <div class="grow"><h2 style="margin:0;letter-spacing:-.02em">Projects</h2>
        <div class="faint" style="font-size:12.5px">Every site you build is saved on this computer, with every version.</div></div>
      <input class="input" style="width:240px" placeholder="Search projects…" value=${query} onInput=${(e) => setQuery(e.target.value)} />
      <button class="btn primary" onClick=${() => navigate("/studio")}><${Icon} name="plus" size=${15} /> New website</button>
    </div>
    ${projects === null ? html`<div class="grid-cards">${[0, 1, 2].map(() => html`<div class="card"><div class="skeleton" style="height:180px;border-radius:18px 18px 0 0"></div><div style="padding:14px;display:grid;gap:8px"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton" style="height:12px;width:90%"></div></div></div>`)}</div>`
      : shown.length === 0 ? html`<div class="empty-state"><div class="avatar" style="width:52px;height:52px;border-radius:16px;margin:0 auto 16px"><${Icon} name="layout" size=${24} /></div>
          <h3 style="margin:0 0 6px">${projects.length ? "No matches" : "No projects yet"}</h3><p class="muted">Describe a website in Studio, or just say it.</p>
          <button class="btn primary" onClick=${() => navigate("/studio")}>Open Studio</button></div>`
        : html`<div class="grid-cards">${shown.map((p) => html`<div class="card pcard" onClick=${() => navigate(`/studio/${p.id}`)} role="link" tabindex="0"
            onKeyDown=${(e) => e.key === "Enter" && navigate(`/studio/${p.id}`)}>
            <div class="thumb">${p.current ? html`<iframe loading="lazy" tabindex="-1" title=${`${p.name} preview`} src=${`${sites}/sites/${p.id}/v${p.current}`}></iframe>`
              : html`<div class="ph"><span class="pill">${p.stage === "planned" ? "Planned · not built yet" : "In progress"}</span></div>`}</div>
            <div class="body">
              <div class="title"><span class="grow ellipsis">${p.name}</span>${p.theme && html`<span class="swatches">${["background", "primary", "accent"].map((k) => html`<i style=${`background:${p.theme.colors[k]}`}></i>`)}</span>`}</div>
              <div class="brief">${p.brief}</div>
              <div class="foot">
                ${p.current ? html`<span class="pill accent">v${p.current}</span>` : html`<span class="pill">${p.stage}</span>`}
                ${p.sections ? html`<span class="pill">${p.sections} sections</span>` : null}
                <span class="faint grow" style="font-size:11.5px;text-align:right">${ago(p.updated)}</span>
                ${p.current && html`<a class="icon-btn" href=${`${sites}/sites/${p.id}/v${p.current}`} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()} aria-label="Open in new tab"><${Icon} name="external" size=${15} /></a>`}
                <button class="icon-btn danger" onClick=${(e) => remove(e, p)} aria-label="Delete"><${Icon} name="trash" size=${15} /></button>
              </div>
            </div>
          </div>`)}</div>`}
  </div></div>`;
}
