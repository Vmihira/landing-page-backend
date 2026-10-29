// Formatting, a tiny event bus, and an HTML highlighter for the code view.
export const cx = (...names) => names.filter(Boolean).join(" ");

export const seconds = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);

export function ago(t) {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString();
}

export const percent = (p) => `${Math.round((p || 0) * 100)}%`;

export function domain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || ""; }
}

const listeners = new Map();
export const bus = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
  },
  emit(name, data) {
    (listeners.get(name) || []).forEach((fn) => fn(data));
  },
};

export function toast(message, kind = "info") {
  bus.emit("toast", { message, kind, id: Math.random() });
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML highlighter: comments (VoiceNav markers stand out), tags, attributes, and strings. */
export function highlight(source) {
  const out = [];
  const pattern = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][\w-]*)|([\w:-]+)(=)("[^"]*"|'[^']*')|(\/?>)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(source))) {
    out.push(escape(source.slice(last, match.index)));
    if (match[1]) {
      out.push(`<span class="${/vn:/.test(match[1]) ? "tk-marker" : "tk-com"}">${escape(match[1])}</span>`);
    } else if (match[2]) out.push(`<span class="tk-tag">${escape(match[2])}</span>`);
    else if (match[3]) out.push(`<span class="tk-attr">${escape(match[3])}</span>=<span class="tk-str">${escape(match[5])}</span>`);
    else out.push(`<span class="tk-tag">${escape(match[6])}</span>`);
    last = pattern.lastIndex;
  }
  out.push(escape(source.slice(last)));
  return out.join("").split("\n").map((line) => `<span class="ln">${line || " "}</span>`).join("");
}

export function useInterval(hooks, fn, ms, active = true) {
  const { useEffect } = hooks;
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
