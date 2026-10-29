/* VoiceNav voice navigation for published pages. Uses the browser's own speech recognition (Chrome, Edge,
   Safari), so it works without VoiceNav running. Say "go to pricing", "click book a table", "scroll down". */
(function () {
  if (window.__vnVoiceNav) return;
  window.__vnVoiceNav = true;
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var style = document.createElement("style");
  style.textContent = "#vnv{position:fixed;left:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:9px 14px 9px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(12,14,20,.88);color:#f2f3f8;font:600 13px system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35)}#vnv i{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#22d3ee)}#vnv.on i{animation:vnvp 1.2s infinite}@keyframes vnvp{0%{box-shadow:0 0 0 0 rgba(139,92,246,.6)}100%{box-shadow:0 0 0 12px rgba(139,92,246,0)}}.vnv-ring{outline:3px solid #8b5cf6!important;outline-offset:4px;border-radius:10px}";
  document.head.appendChild(style);
  var pill = document.createElement("button");
  pill.id = "vnv";
  pill.type = "button";
  pill.setAttribute("aria-label", "Navigate this page by voice");
  pill.innerHTML = '<i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg></i><span>Navigate by voice</span>';
  var label = pill.querySelector("span");
  function setLabel(t) { label.textContent = t; }
  function words(s) {
    return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(function (w) {
      return w.length > 1 && ["go", "to", "the", "show", "me", "open", "click", "take", "please", "section", "page", "on", "a", "an", "and", "tap", "press", "button", "link"].indexOf(w) < 0;
    });
  }
  function targets() {
    var list = [];
    document.querySelectorAll("[data-vn-label],section[id],footer").forEach(function (el) {
      var h = el.querySelector("h1,h2,h3");
      list.push({ el: el, kind: "section", text: (el.getAttribute("data-vn-label") || el.id || "") + " " + (h ? h.textContent : "") });
    });
    document.querySelectorAll("a[href],button,[role=tab]").forEach(function (el) {
      if (el.id === "vnv" || !el.getBoundingClientRect().width) return;
      list.push({ el: el, kind: "control", text: el.getAttribute("aria-label") || el.textContent || "" });
    });
    return list;
  }
  function best(utterance, wantClick) {
    var q = words(utterance);
    var top = null, topScore = 0;
    targets().forEach(function (t) {
      var w = words(t.text);
      var score = 0;
      q.forEach(function (x) { w.forEach(function (y) { if (x === y) score += 2; else if (y.indexOf(x) === 0 || x.indexOf(y) === 0) score += 1; }); });
      if (score && t.kind === "section" && !wantClick) score += 0.5;
      if (score && t.kind === "control" && wantClick) score += 0.5;
      if (score > topScore) { topScore = score; top = t; }
    });
    return top;
  }
  function run(said) {
    var s = said.toLowerCase();
    if (/\b(top|beginning|start)\b/.test(s) && /\b(back|go|to)\b/.test(s)) return window.scrollTo({ top: 0, behavior: "smooth" });
    if (/\bbottom|end of (the )?page\b/.test(s)) return window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    if (/\bscroll up|go up|up a bit\b/.test(s)) return window.scrollBy({ top: -innerHeight * 0.8, behavior: "smooth" });
    if (/\bscroll|down|next\b/.test(s) && !/\bgo to|show|open|click\b/.test(s)) return window.scrollBy({ top: innerHeight * 0.8, behavior: "smooth" });
    var wantClick = /\b(click|press|tap|book|buy|sign up|subscribe|order|get started)\b/.test(s);
    var t = best(said, wantClick);
    if (!t) { setLabel("Didn't catch a match"); return; }
    t.el.scrollIntoView({ behavior: "smooth", block: t.kind === "section" ? "start" : "center" });
    t.el.classList.add("vnv-ring");
    setTimeout(function () { t.el.classList.remove("vnv-ring"); }, 1500);
    if (t.kind === "control" && wantClick) setTimeout(function () { t.el.click(); }, 450);
  }
  pill.addEventListener("click", function () {
    if (!Recognition) { setLabel("Voice needs Chrome, Edge or Safari"); return; }
    var r = new Recognition();
    r.lang = document.documentElement.lang || "en-US";
    r.interimResults = false;
    r.maxAlternatives = 1;
    pill.classList.add("on");
    setLabel("Listening…");
    r.onresult = function (e) { var said = e.results[0][0].transcript; setLabel("“" + said + "”"); run(said); };
    r.onerror = function () { setLabel("Try again"); };
    r.onend = function () { pill.classList.remove("on"); setTimeout(function () { setLabel("Navigate by voice"); }, 2200); };
    r.start();
  });
  (document.body || document.documentElement).appendChild(pill);
})();
