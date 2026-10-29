/* VoiceNav preview bridge. Runs inside the sandboxed preview frame and talks to Studio with postMessage.
   Build mode streams sections in; site mode exposes voice-navigation targets and executes them. */
(function () {
  if (window.__vnBridge) return;
  window.__vnBridge = true;
  var parentWin = window.parent;
  var targets = [];
  var mode = document.documentElement.getAttribute("data-vn-mode") || "site";
  var post = function (msg) { try { parentWin.postMessage(Object.assign({ vn: true }, msg), "*"); } catch (e) {} };

  var css = document.createElement("style");
  css.textContent = [
    "@keyframes vnIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}",
    ".vn-new{animation:vnIn .7s cubic-bezier(.2,.8,.2,1) both}",
    ".vn-ring{outline:3px solid #8b5cf6!important;outline-offset:4px;border-radius:10px;transition:outline-color .6s;box-shadow:0 0 0 9999px rgba(10,10,20,.12)}",
    "@keyframes vnShimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}",
    ".vn-editing{position:relative}",
    ".vn-editing::after{content:'Editing';position:absolute;inset:0;z-index:9990;pointer-events:none;display:flex;align-items:flex-start;justify-content:flex-end;padding:10px;font:600 12px Inter,system-ui,sans-serif;color:#fff;",
    "background:linear-gradient(90deg,rgba(139,92,246,.10),rgba(34,211,238,.22),rgba(139,92,246,.10));background-size:800px 100%;animation:vnShimmer 1.4s linear infinite;outline:2px dashed rgba(139,92,246,.8);outline-offset:-2px}",
    "#vn-pill{position:fixed;left:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:9px 14px 9px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.18);",
    "background:rgba(12,14,20,.86);color:#f2f3f8;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35);backdrop-filter:blur(10px)}",
    "#vn-pill i{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}",
    "#vn-pill.on i{animation:vnPulse 1.2s infinite}@keyframes vnPulse{0%{box-shadow:0 0 0 0 rgba(139,92,246,.6)}100%{box-shadow:0 0 0 12px rgba(139,92,246,0)}}",
    "#vn-toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2147483001;padding:8px 14px;border-radius:12px;background:rgba(12,14,20,.9);color:#fff;",
    "font:600 13px Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:opacity .3s;pointer-events:none}",
  ].join("");
  (document.head || document.documentElement).appendChild(css);

  function text(el) { return (el.getAttribute("aria-label") || el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(); }
  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function collect() {
    targets = [];
    var seen = {};
    var add = function (el, kind, label) {
      label = (label || "").slice(0, 100);
      if (!label) return;
      var key = kind + "|" + label.toLowerCase() + "|" + (el.getAttribute("href") || "");
      if (seen[key]) return;
      seen[key] = 1;
      targets.push({ el: el, kind: kind, label: label });
    };
    document.querySelectorAll("[data-vn-label]").forEach(function (el) {
      if (el.id === "nav") return;
      var heading = el.querySelector("h1,h2,h3");
      var name = el.getAttribute("data-vn-label");
      add(el, "section", heading && text(heading) && text(heading).length < 80 ? name + " — " + text(heading) : name);
    });
    document.querySelectorAll("a[href],button,[role=tab],summary").forEach(function (el) {
      if (targets.length > 110 || !visible(el) || el.id === "vn-pill") return;
      var kind = el.getAttribute("role") === "tab" ? "tab" : el.tagName === "A" ? "link" : "button";
      var label = text(el);
      if (label.length > 1 && label.length < 90) add(el, kind, label);
    });
    return targets.map(function (t, i) { return { index: i, kind: t.kind, label: t.label }; });
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById("vn-toast");
    if (!t) { t = document.createElement("div"); t.id = "vn-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.opacity = "0"; }, 1800);
  }
  function ring(el) {
    el.classList.add("vn-ring");
    setTimeout(function () { el.classList.remove("vn-ring"); }, 1500);
  }

  // In-page links ("#pricing") do not navigate inside a sandboxed srcdoc frame, so the bridge scrolls itself.
  function anchorTarget(el) {
    var href = el && el.tagName === "A" ? el.getAttribute("href") || "" : "";
    if (href[0] !== "#") return null;
    if (href.length === 1) return document.body;
    try { return document.getElementById(decodeURIComponent(href.slice(1))); } catch (e) { return null; }
  }

  function go(index) {
    var t = targets[index];
    if (!t || !t.el.isConnected) { collect(); t = targets[index]; }
    if (!t) return post({ type: "result", ok: false });
    var dest = anchorTarget(t.el);
    toast("→ " + t.label.split(" — ")[0]);
    if (t.kind === "section" || dest) {
      var el = dest || t.el;
      if (el === document.body) window.scrollTo({ top: 0, behavior: "smooth" });
      else el.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(function () { ring(dest && t.el.offsetParent !== null ? t.el : el); if (dest && el !== document.body) ring(el); }, 350);
    } else {
      t.el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(function () {
        ring(t.el);
        try { t.el.focus({ preventScroll: true }); } catch (e) {}
        var href = t.el.getAttribute("href") || "";
        if (!(t.el.tagName === "A" && href && t.el.target !== "_blank")) t.el.click();
      }, 450);
    }
    post({ type: "result", ok: true, label: t.label });
  }

  document.addEventListener("click", function (e) {
    var link = e.target.closest && e.target.closest('a[href^="#"]');
    var dest = anchorTarget(link);
    if (!dest) return;
    e.preventDefault();
    if (dest === document.body) window.scrollTo({ top: 0, behavior: "smooth" });
    else dest.scrollIntoView({ behavior: "smooth", block: "start" });
  }, true);

  // ---------------- build mode: stream sections into the page as they complete
  var lastHead = "", lastBody = "";
  function applyHead(head) {
    if (head === lastHead) return;
    lastHead = head;
    var box = document.createElement("template");
    box.innerHTML = head;
    Array.prototype.forEach.call(box.content.children, function (node) {
      var tag = node.tagName;
      if (tag === "SCRIPT") {
        if (node.src || !node.textContent.trim()) return;
        var s = document.createElement("script");
        s.textContent = node.textContent;
        document.head.appendChild(s);
      } else if (tag === "STYLE" || (tag === "LINK" && node.rel === "stylesheet")) {
        document.head.appendChild(node.cloneNode(true));
      } else if (tag === "TITLE") {
        document.title = node.textContent;
      }
    });
  }
  function applyBody(body, bodyClass, follow) {
    var wait = document.getElementById("vn-wait");
    if (wait && body.trim()) wait.remove();
    if (bodyClass) document.body.className = bodyClass;
    var root = document.getElementById("vn-root");
    if (!root) { root = document.createElement("div"); root.id = "vn-root"; document.body.insertBefore(root, document.body.firstChild); }
    var added = null;
    if (body.indexOf(lastBody) === 0 && lastBody) {
      var holder = document.createElement("div");
      holder.innerHTML = body.slice(lastBody.length);
      added = [];
      while (holder.firstChild) { var n = holder.firstChild; root.appendChild(n); if (n.nodeType === 1) added.push(n); }
    } else {
      root.innerHTML = body;
      added = Array.prototype.filter.call(root.childNodes, function (n) { return n.nodeType === 1; });
    }
    lastBody = body;
    added.forEach(function (n) { n.classList.add("vn-new"); });
    var last = added.length ? added[added.length - 1] : null;
    if (follow && last) setTimeout(function () { last.scrollIntoView({ behavior: "smooth", block: "start" }); }, 120);
  }

  // ---------------- current section tracking
  function watchSections() {
    if (!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) post({ type: "section", id: e.target.id, label: e.target.getAttribute("data-vn-label") });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("[data-vn-label]").forEach(function (el) { io.observe(el); });
  }

  function pill() {
    if (document.getElementById("vn-pill")) return;
    var b = document.createElement("button");
    b.id = "vn-pill";
    b.type = "button";
    b.setAttribute("aria-label", "Navigate this page by voice");
    b.innerHTML = '<i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg></i><span>Navigate by voice</span>';
    b.addEventListener("click", function () { post({ type: "listen" }); });
    document.body.appendChild(b);
  }

  window.addEventListener("message", function (e) {
    if (e.source !== parentWin) return;
    var m = e.data || {};
    if (!m.vn) return;
    if (m.type === "ping") post({ type: "pong", y: Math.round(scrollY), height: document.documentElement.scrollHeight, view: innerHeight, targets: targets.length });
    else if (m.type === "stream") { applyHead(m.head || ""); applyBody(m.body || "", m.body_class, m.follow !== false); }
    else if (m.type === "targets") post({ type: "targets", targets: collect() });
    else if (m.type === "go") go(m.index);
    else if (m.type === "scroll") window.scrollBy({ top: (m.dir === "up" ? -1 : 1) * innerHeight * 0.8, behavior: "smooth" });
    else if (m.type === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    else if (m.type === "toast") toast(m.text);
    else if (m.type === "voice") {
      var p = document.getElementById("vn-pill");
      if (p) { p.classList.toggle("on", m.phase === "listening"); p.querySelector("span").textContent = m.label || "Navigate by voice"; }
    } else if (m.type === "highlight") {
      document.querySelectorAll(".vn-editing").forEach(function (el) { el.classList.remove("vn-editing"); });
      (m.parts || []).forEach(function (id) {
        var el = document.getElementById(id === "nav" ? "nav" : id);
        if (el) { el.classList.add("vn-editing"); if (m.scroll) el.scrollIntoView({ behavior: "smooth", block: "center" }); }
      });
    }
  });

  function ready() {
    if (mode === "site") { pill(); watchSections(); }
    post({ type: "ready", mode: mode, title: document.title, targets: mode === "site" ? collect() : [] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
  // Late layout (fonts, Tailwind) changes which controls are visible; refresh the target list once.
  if (mode === "site") setTimeout(function () { post({ type: "targets", targets: collect() }); }, 1200);
})();
