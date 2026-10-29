"""Studio: brief -> questions -> plan + themes -> streamed build -> quality checks -> targeted edits."""

import json
import re
import threading
import time
from html.parser import HTMLParser

from . import llm
from .events import Channel

UNDERSTAND = """You are the lead designer at VoiceNav Studio, an AI website builder. A user described a website.
Decide what you still need to know to build an excellent single-page website. Return JSON only:
{
  "name": "2-4 word project name",
  "summary": "One friendly sentence restating what you will build and for whom.",
  "kind": "short site type, e.g. SaaS landing page, restaurant site, portfolio",
  "questions": [
    {"id": "snake_case_id", "question": "Short question?", "options": ["3 to 5 short answers"],
     "multi": false, "recommended": "one of the options"}
  ]
}
Ask 2 to 4 questions that would materially change the site: audience, tone or vibe, must-have sections or
features, the main call to action. Never ask about colors or fonts; themes are offered next. Options are
concrete and under 6 words. Skip anything the brief already answers. Plain JSON, no markdown."""

PLAN = """You are the lead designer at VoiceNav Studio. Create the build plan for a single-page website.
Return JSON only:
{
  "brand": {"name": "...", "tagline": "...", "voice": "three adjectives"},
  "goal": "the page's primary conversion goal",
  "sections": [{"id": "kebab-id", "name": "Short Name", "purpose": "one line",
                "highlights": ["2-4 short content points"]}],
  "themes": [{"id": "kebab-id", "name": "Evocative name", "mode": "dark or light",
              "description": "mood in under 10 words",
              "colors": {"background": "#hex", "surface": "#hex", "text": "#hex", "muted": "#hex",
                         "primary": "#hex", "accent": "#hex"},
              "fonts": {"heading": "Google Font family", "body": "Google Font family"},
              "radius": "sharp, soft or round", "style": "art direction in under 12 words"}],
  "recommended_theme": "theme id"
}
Rules:
- 6 to 9 sections in page order. The first is "hero" and the last is "footer". No navigation section; the
  navigation bar is built automatically.
- Pick sections that fit this kind of site (menu and reservations for a restaurant, pricing and FAQ for SaaS).
- Exactly 4 distinct themes, at least one dark and one light, each with excellent contrast. Real Google Fonts.
- Content points are specific to this brand, never generic placeholders.
Plain JSON, no markdown."""

BUILD = """You are a world-class web designer and front-end engineer at VoiceNav Studio. Build the website
described by the plan as ONE self-contained HTML file.

Output ONLY the HTML document, starting with <!DOCTYPE html>. No markdown fences, no commentary.

Required structure. The builder tracks progress with these exact comment markers:
<!DOCTYPE html>
<html lang="en">
<head>
  meta charset and viewport, a descriptive <title>, a meta description
  a Google Fonts <link> for the theme's heading and body fonts
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { theme: { extend: { colors: { background, surface, ink (the text color), muted,
    primary, accent: theme hex values }, fontFamily: { heading: [...], body: [...] } } } }</script>
  <style> html{scroll-behavior:smooth} section{scroll-margin-top:84px}
    .reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease}
    .reveal.in{opacity:1;transform:none}
    plus float keyframes and any custom touches, under 100 lines </style>
</head>
<body class="bg-background text-ink font-body antialiased">
<!-- vn:section nav -->
<header id="nav" data-vn-label="Navigation"> sticky header: wordmark, links to every section by #id (skip
  hero and footer), a primary call-to-action button, an accessible mobile menu </header>
<!-- vn:section {id} -->   (repeat for every planned section, in plan order)
<section id="{id}" data-vn-label="{Name}"> ... </section>
<!-- vn:section footer -->
<footer id="footer" data-vn-label="Footer"> ... </footer>
<!-- vn:end -->
<script> small vanilla JS: mobile menu, reveal-on-scroll (an IntersectionObserver that adds the class "in" to
  every .reveal element), and any tabs, accordions, toggles, or carousels you used </script>
</body>
</html>

Design bar. This must look like a premium, award-worthy website:
- Follow the chosen theme exactly: colors (through the Tailwind names above), fonts, corner radius, art
  direction, and its dark or light mode.
- Strong hierarchy, generous whitespace, a bold hero with headline, subheadline, primary and secondary call
  to action, and a striking visual.
- Rich, specific, persuasive copy for this brand. Never lorem ipsum or "Feature 1". Realistic names, numbers,
  prices, testimonials, and FAQs.
- Images: https://picsum.photos/seed/{a-relevant-word}/{width}/{height} with descriptive alt text. Inline SVG
  icons. No other external images.
- Reveal-on-scroll only through the "reveal" class above (never opacity-0 utilities on content).
- Hover and focus states, smooth transitions, and at least two interactive components where
  they fit (tabs, FAQ accordion, pricing toggle, testimonial carousel, menu filter).
- Fully responsive (mobile first, md and lg breakpoints) and accessible: semantic HTML, alt text, aria-labels
  on icon buttons, visible focus, AA contrast.
- Every button and link has clear visible text: visitors navigate this page by voice ("go to pricing",
  "click book a table").
- Be efficient: aim for 450 to 750 lines."""

EDIT = """You are editing a website built by VoiceNav Studio. The page has comment markers:
<!-- vn:section {id} --> before each top-level part (nav, every section, footer) and <!-- vn:end --> before
the final <script>.

Reply in exactly one of two formats.

A) TARGETED EDIT. Prefer this whenever the change touches specific parts:
NOTE: one short sentence describing what you changed
<!-- vn:replace {id} -->
the complete new HTML for that part (for example the whole <section id="{id}" ...> element)
<!-- vn:insert {new-id} after {existing-id} -->
the complete HTML of a new part
<!-- vn:delete {id} -->
<!-- vn:replace head -->
the complete new <head>...</head>, only when fonts, colors, or the Tailwind config change
<!-- vn:replace script -->
the complete new final <script>...</script>
Use as many blocks as needed. Keep ids, data-vn-label attributes, and navigation links consistent: when you
add, rename, or remove a section, also replace "nav" so its links match.

B) FULL REWRITE. Only for global changes such as a new layout across most sections:
NOTE: one short sentence
<!DOCTYPE html> followed by the complete document with the same marker structure.

Keep the original quality bar: premium design, specific copy, responsive, accessible, consistent with the
theme. No markdown fences."""

DEFAULT_THEMES = [
    {"id": "midnight-aurora", "name": "Midnight Aurora", "mode": "dark", "description": "Deep night, electric glow",
     "colors": {"background": "#0b0d17", "surface": "#141a2e", "text": "#eef1ff", "muted": "#9aa3c7",
                "primary": "#7c5cff", "accent": "#22d3ee"},
     "fonts": {"heading": "Space Grotesk", "body": "Inter"}, "radius": "soft",
     "style": "glassy cards, neon gradients, subtle grid"},
    {"id": "paper-studio", "name": "Paper Studio", "mode": "light", "description": "Editorial, calm, confident",
     "colors": {"background": "#faf8f3", "surface": "#ffffff", "text": "#1d1b16", "muted": "#6b6458",
                "primary": "#1d1b16", "accent": "#e2572b"},
     "fonts": {"heading": "Fraunces", "body": "Inter"}, "radius": "sharp",
     "style": "editorial serif headlines, thin rules, big type"},
    {"id": "fresh-mint", "name": "Fresh Mint", "mode": "light", "description": "Friendly, bright, optimistic",
     "colors": {"background": "#f4fbf8", "surface": "#ffffff", "text": "#0f2a22", "muted": "#557067",
                "primary": "#0f9d74", "accent": "#ffb020"},
     "fonts": {"heading": "Plus Jakarta Sans", "body": "Plus Jakarta Sans"}, "radius": "round",
     "style": "rounded cards, soft shadows, playful accents"},
    {"id": "obsidian-gold", "name": "Obsidian Gold", "mode": "dark", "description": "Luxurious, dramatic, refined",
     "colors": {"background": "#0e0d0b", "surface": "#1a1815", "text": "#f5efe3", "muted": "#a89f8c",
                "primary": "#d4a24c", "accent": "#f5efe3"},
     "fonts": {"heading": "Playfair Display", "body": "Manrope"}, "radius": "sharp",
     "style": "high contrast, gold hairlines, cinematic imagery"},
]

SECTION = re.compile(r"<!--\s*vn:section\s+([a-z0-9-]+)\s*-->")
END = re.compile(r"<!--\s*vn:end\s*-->")
EDIT_BLOCK = re.compile(r"<!--\s*vn:(replace|insert|delete)\s+([a-z0-9-]+)(?:\s+after\s+([a-z0-9-]+))?\s*-->")
HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")
FONT = re.compile(r"^[A-Za-z0-9 ]{2,40}$")


def slug(value, fallback="section"):
    value = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")[:40]
    return value or fallback


def clean_text(value, limit=200):
    return " ".join(str(value or "").split())[:limit]


# ---------------------------------------------------------------- understanding and planning

def clean_questions(raw):
    questions = []
    for i, q in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(q, dict):
            continue
        options = [clean_text(o, 60) for o in q.get("options", []) if clean_text(o, 60)][:5]
        text = clean_text(q.get("question"), 140)
        if text and len(options) >= 2:
            recommended = clean_text(q.get("recommended"), 60)
            questions.append({"id": slug(q.get("id"), f"q{i + 1}").replace("-", "_"), "question": text,
                              "options": options, "multi": bool(q.get("multi")),
                              "recommended": recommended if recommended in options else options[0]})
    return questions[:4]


def clean_theme(raw):
    if not isinstance(raw, dict):
        return None
    colors = raw.get("colors") if isinstance(raw.get("colors"), dict) else {}
    names = ("background", "surface", "text", "muted", "primary", "accent")
    if not all(HEX.match(str(colors.get(n, ""))) for n in names):
        return None
    fonts = raw.get("fonts") if isinstance(raw.get("fonts"), dict) else {}
    heading = str(fonts.get("heading", "Inter"))
    body = str(fonts.get("body", "Inter"))
    return {
        "id": slug(raw.get("id") or raw.get("name"), "theme"),
        "name": clean_text(raw.get("name"), 40) or "Theme",
        "mode": "light" if str(raw.get("mode")).lower() == "light" else "dark",
        "description": clean_text(raw.get("description"), 80),
        "colors": {n: colors[n] for n in names},
        "fonts": {"heading": heading if FONT.match(heading) else "Inter",
                  "body": body if FONT.match(body) else "Inter"},
        "radius": raw.get("radius") if raw.get("radius") in {"sharp", "soft", "round"} else "soft",
        "style": clean_text(raw.get("style"), 100),
    }


def clean_plan(raw):
    raw = raw if isinstance(raw, dict) else {}
    sections, seen = [], set()
    for s in raw.get("sections", []) if isinstance(raw.get("sections"), list) else []:
        if not isinstance(s, dict):
            continue
        section_id = slug(s.get("id") or s.get("name"))
        if section_id in seen or section_id in {"nav", "navigation", "header", "navbar", "head", "script"}:
            continue
        seen.add(section_id)
        sections.append({"id": section_id, "name": clean_text(s.get("name"), 40) or section_id.title(),
                         "purpose": clean_text(s.get("purpose"), 140),
                         "highlights": [clean_text(h, 90) for h in s.get("highlights", []) if clean_text(h, 90)][:4],
                         "enabled": True})
    if "hero" not in seen:
        sections.insert(0, {"id": "hero", "name": "Hero", "purpose": "Headline and main call to action",
                            "highlights": [], "enabled": True})
    sections = [s for s in sections if s["id"] != "footer"][:11]
    sections.append({"id": "footer", "name": "Footer", "purpose": "Links, contact, and legal",
                     "highlights": [], "enabled": True})
    themes, theme_ids = [], set()
    for t in raw.get("themes", []) if isinstance(raw.get("themes"), list) else []:
        theme = clean_theme(t)
        if theme and theme["id"] not in theme_ids:
            themes.append(theme)
            theme_ids.add(theme["id"])
    themes = themes[:6] or [dict(t) for t in DEFAULT_THEMES]
    brand = raw.get("brand") if isinstance(raw.get("brand"), dict) else {}
    recommended = slug(raw.get("recommended_theme"), "")
    return {
        "brand": {k: clean_text(brand.get(k), 120) for k in ("name", "tagline", "voice")},
        "goal": clean_text(raw.get("goal"), 160),
        "sections": sections,
        "themes": themes,
        "recommended_theme": recommended if recommended in theme_ids else themes[0]["id"],
    }


def understand(brief):
    raw, meta = llm.json_reply(UNDERSTAND, f"Website brief: {brief}", max_tokens=1500, temperature=0.6)
    return {
        "name": clean_text(raw.get("name"), 40) or "Untitled site",
        "summary": clean_text(raw.get("summary"), 240),
        "kind": clean_text(raw.get("kind"), 60),
        "questions": clean_questions(raw.get("questions")),
    }, meta


def make_plan(brief, answers, note=""):
    lines = [f"Website brief: {brief}"]
    if answers:
        lines.append("Answers to your questions:")
        lines += [f"- {k}: {', '.join(v) if isinstance(v, list) else v}" for k, v in answers.items()]
    else:
        lines.append("The user asked you to decide everything not stated in the brief.")
    if note:
        lines.append(f"Additional direction: {note}")
    raw, meta = llm.json_reply(PLAN, "\n".join(lines), max_tokens=5000, temperature=0.7)
    return clean_plan(raw), meta


# ---------------------------------------------------------------- building

class BuildTracker:
    """Turns a growing HTML stream into plan progress and a renderable partial page."""

    def __init__(self, sections):
        self.parts = ["nav", *[s["id"] for s in sections]]

    def steps(self, text):
        seen = SECTION.findall(text)
        for part in seen:
            if part not in self.parts:
                self.parts.insert(len(self.parts) - 1 if "footer" in self.parts else len(self.parts), part)
        ended = bool(END.search(text))
        done = {"design"} if seen or "</head>" in text else set()
        done |= set(seen[:-1])
        if seen and ended:
            done.add(seen[-1])
        current = "interactions" if ended else (seen[-1] if seen else "design")
        if "</html>" in text:
            done.add("interactions")
            current = None
        return {"done": sorted(done), "current": current, "parts": list(self.parts)}

    @staticmethod
    def partial(text):
        """Head plus every complete top-level part so far. None until the head is complete."""
        head_end = text.find("</head>")
        head_start = text.find("<head")
        if head_end < 0 or head_start < 0:
            return None
        head = text[text.find(">", head_start) + 1:head_end]
        body_tag = re.search(r"<body([^>]*)>", text[head_end:])
        markers = list(SECTION.finditer(text))
        end = END.search(text)
        cut = end.start() if end else (markers[-1].start() if markers else None)
        body = text[head_end + body_tag.end():cut] if body_tag and cut else ""
        classes = re.search(r'class="([^"]*)"', body_tag.group(1)) if body_tag else None
        complete = len(markers) if end else max(len(markers) - 1, 0)
        return {"head": head, "body_class": classes.group(1) if classes else "", "body": body, "complete": complete}


def finish_document(text):
    """Strip fences or chatter and close a truncated document."""
    start = re.search(r"<!DOCTYPE html|<html", text, re.I)
    html = text[start.start():] if start else text
    html = re.sub(r"\s*```\s*$", "", html).strip()
    if "</body>" not in html:
        html += "\n</body>"
    if "</html>" not in html:
        html += "\n</html>"
    return html + "\n"


class _Audit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.anchors, self.images, self.missing_alt, self.labels = set(), [], 0, 0, []
        self.viewport = False
        self.unnamed = 0
        self.open_controls = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        if a.get("data-vn-label"):
            self.labels.append(a["data-vn-label"])
        if tag == "a" and (a.get("href") or "").startswith("#") and len(a["href"]) > 1:
            self.anchors.append(a["href"][1:])
        if tag == "img":
            self.images += 1
            self.missing_alt += not (a.get("alt") or "").strip()
        if tag == "meta" and a.get("name") == "viewport":
            self.viewport = True
        if tag in {"a", "button"}:
            self.open_controls.append([bool(a.get("aria-label") or a.get("title")), ""])

    def handle_data(self, data):
        for control in self.open_controls:
            control[1] += data.strip()

    def handle_endtag(self, tag):
        if tag in {"a", "button"} and self.open_controls:
            labelled, text = self.open_controls.pop()
            self.unnamed += not (labelled or text)


def quality_checks(html, sections):
    audit = _Audit()
    try:
        audit.feed(html)
    except Exception:  # A malformed page still gets a report.
        pass
    planned = [s["id"] for s in sections]
    missing = [p for p in planned if p not in audit.ids]
    broken = sorted({a for a in audit.anchors if a not in audit.ids})
    lorem = bool(re.search(r"lorem ipsum", html, re.I))
    complete = bool(END.search(html)) and html.rfind("<script") > END.search(html).start()
    size_kb = round(len(html.encode()) / 1024, 1)

    def check(check_id, label, ok, detail, warn_only=True):
        return {"id": check_id, "label": label, "status": "pass" if ok else ("warn" if warn_only else "fail"),
                "detail": detail}

    return [
        check("complete", "Complete document", complete, "all parts and scripts present" if complete
              else "the page was cut off before its closing parts", warn_only=False),
        check("sections", "All planned sections built", not missing,
              f"{len(planned) - len(missing)}/{len(planned)} sections" + (f" · missing {', '.join(missing)}"
                                                                          if missing else "")),
        check("links", "Navigation links resolve", not broken,
              f"{len(audit.anchors)} in-page links" + (f" · broken: {', '.join(broken[:4])}" if broken else "")),
        check("voice", "Voice navigation targets", len(audit.labels) >= 3,
              f"{len(audit.labels)} labelled regions + {len(set(audit.anchors))} link targets"),
        check("alt", "Images have alt text", audit.missing_alt == 0,
              f"{audit.images - audit.missing_alt}/{audit.images} images described"),
        check("names", "Buttons and links are named", audit.unnamed == 0,
              "all controls have a name" if not audit.unnamed else f"{audit.unnamed} without a name"),
        check("responsive", "Responsive viewport", audit.viewport, "viewport meta present" if audit.viewport
              else "no viewport meta"),
        check("copy", "Real copy (no lorem ipsum)", not lorem, "no placeholder text" if not lorem
              else "placeholder text found"),
        check("weight", "Page weight", size_kb < 180, f"{size_kb} KB single file"),
    ]


# ---------------------------------------------------------------- targeted edits

def regions(html):
    """Character ranges of the editable parts: head, each marked section, and the final script."""
    found = {}
    head_start, head_end = html.find("<head"), html.find("</head>")
    if head_start >= 0 and head_end >= 0:
        found["head"] = (head_start, head_end + len("</head>"))
    markers = list(SECTION.finditer(html))
    end = END.search(html)
    for i, m in enumerate(markers):
        stop = markers[i + 1].start() if i + 1 < len(markers) else (end.start() if end else html.rfind("</body>"))
        found[m.group(1)] = (m.start(), stop)
    body_end = html.rfind("</body>")
    if end and body_end > end.end():
        found["script"] = (end.end(), body_end)
    return found


def parse_edit(reply):
    """-> (note, mode, payload). mode "full" carries a document; "blocks" carries [(op, id, after, html)]."""
    note_match = re.search(r"NOTE:\s*(.+)", reply)
    note = clean_text(note_match.group(1), 200) if note_match else "Updated the page."
    doc = re.search(r"<!DOCTYPE html|<html[\s>]", reply, re.I)
    blocks = list(EDIT_BLOCK.finditer(reply))
    if doc and (not blocks or doc.start() < blocks[0].start()):
        return note, "full", finish_document(reply[doc.start():])
    parsed = []
    for i, m in enumerate(blocks):
        stop = blocks[i + 1].start() if i + 1 < len(blocks) else len(reply)
        content = re.sub(r"^\s*```[a-z]*\s*|\s*```\s*$", "", reply[m.end():stop]).strip()
        parsed.append((m.group(1), m.group(2), m.group(3), content))
    return note, "blocks", parsed


def apply_blocks(html, blocks):
    touched = []
    for op, part, after, content in blocks:
        spans = regions(html)
        if op == "delete":
            if part in spans and part not in {"head", "script"}:
                start, stop = spans[part]
                html = html[:start] + html[stop:]
                touched.append(part)
            continue
        if not content:
            continue
        if part == "head":
            if "head" in spans:
                start, stop = spans["head"]
                block = content if content.lstrip().startswith("<head") else f"<head>\n{content}\n</head>"
                html = html[:start] + block + html[stop:]
                touched.append(part)
            continue
        if part == "script":
            end = END.search(html)
            if end:
                stop = spans["script"][1] if "script" in spans else html.rfind("</body>")
                html = html[:end.end()] + "\n" + content + "\n" + html[stop:]
                touched.append(part)
            continue
        block = f"<!-- vn:section {part} -->\n{content}\n"
        if op == "replace" and part in spans:
            start, stop = spans[part]
            html = html[:start] + block + html[stop:]
        else:
            if after and after in spans:
                position = spans[after][1]
            elif "footer" in spans:
                position = spans["footer"][0]
            else:
                end = END.search(html)
                position = end.start() if end else html.rfind("</body>")
            html = html[:position] + block + html[position:]
        touched.append(part)
    if not touched:
        raise ValueError("The edit did not match any part of the page.")
    return html, touched


# ---------------------------------------------------------------- jobs

class Studio:
    def __init__(self, store):
        self.store = store
        self.jobs = {}
        self.lock = threading.Lock()

    def channel(self, project_id):
        with self.lock:
            job = self.jobs.get(project_id)
            return job["channel"] if job else None

    def busy(self, project_id):
        with self.lock:
            job = self.jobs.get(project_id)
            return bool(job and job["thread"].is_alive())

    def _start(self, project_id, kind, work):
        with self.lock:
            job = self.jobs.get(project_id)
            if job and job["thread"].is_alive():
                raise ValueError("This project is already being built. Wait for it to finish.")
            channel = Channel()
            cancel = threading.Event()
            thread = threading.Thread(target=self._run, args=(project_id, kind, work, channel, cancel), daemon=True)
            self.jobs[project_id] = {"channel": channel, "thread": thread, "cancel": cancel, "kind": kind}
            thread.start()
            return kind

    def cancel(self, project_id):
        with self.lock:
            job = self.jobs.get(project_id)
        if job:
            job["cancel"].set()

    def _run(self, project_id, kind, work, channel, cancel):
        started = time.perf_counter()
        try:
            work(channel, cancel, started)
        except Exception as error:  # Report every failure to the client; the job never hangs.
            message = str(error) if isinstance(error, (ValueError, RuntimeError)) else "The build failed unexpectedly."
            channel.push("error", message=message)
            project = self.store.get(project_id)
            project["stage"] = "ready" if project.get("current") else "planned"
            project["messages"].append({"role": "assistant", "kind": "error", "text": message, "t": time.time()})
            self.store.save(project)
        finally:
            channel.close()

    # -------- build

    def build(self, project_id, sections, theme_id):
        project = self.store.get(project_id)
        plan = project.get("plan")
        if not plan:
            raise ValueError("Make a plan first")
        chosen = [s for s in sections if isinstance(s, dict) and s.get("enabled", True)] if sections else None
        if chosen is not None:
            known = {s["id"]: s for s in plan["sections"]}
            plan["sections"] = [{**known.get(slug(s.get("id")), {}), "id": slug(s.get("id")),
                                 "name": clean_text(s.get("name"), 40) or slug(s.get("id")).title(),
                                 "purpose": clean_text(s.get("purpose") or known.get(slug(s.get("id")), {})
                                                       .get("purpose"), 140),
                                 "highlights": known.get(slug(s.get("id")), {}).get("highlights", []),
                                 "enabled": True} for s in chosen]
            if not any(s["id"] == "footer" for s in plan["sections"]):
                plan["sections"].append({"id": "footer", "name": "Footer", "purpose": "Links and contact",
                                         "highlights": [], "enabled": True})
        theme = next((t for t in project["themes"] if t["id"] == theme_id), None) or project["themes"][0]
        project.update(plan=plan, theme_id=theme["id"], stage="building")
        project["messages"].append({"role": "user", "kind": "text", "t": time.time(),
                                    "text": f"Build it with the {theme['name']} theme."})
        self.store.save(project)

        def work(channel, cancel, started):
            self._build(project, theme, channel, cancel, started)

        return self._start(project_id, "build", work)

    def _build(self, project, theme, channel, cancel, started):
        sections = project["plan"]["sections"]
        tracker = BuildTracker(sections)
        steps = [{"id": "design", "label": "Design system", "detail": f"{theme['name']} · {theme['fonts']['heading']}"},
                 {"id": "nav", "label": "Navigation"},
                 *[{"id": s["id"], "label": s["name"]} for s in sections],
                 {"id": "interactions", "label": "Interactions"},
                 {"id": "voice", "label": "Voice navigation"},
                 {"id": "qa", "label": "Quality checks"}]
        channel.push("start", kind="build", steps=steps, model=llm.builder_model(), theme=theme)
        brief = {"brief": project["brief"], "answers": project.get("answers", {}),
                 "brand": project["plan"]["brand"], "goal": project["plan"]["goal"],
                 "sections": [{k: s[k] for k in ("id", "name", "purpose", "highlights")} for s in sections]}
        messages = [{"role": "system", "content": BUILD},
                    {"role": "user", "content": "Plan:\n" + json.dumps(brief, indent=1) + "\n\nTheme:\n" +
                     json.dumps(theme, indent=1) + "\n\nBuild the complete page now."}]
        text, usage = self._stream(messages, channel, cancel, started, tracker)
        if cancel.is_set():
            raise RuntimeError("Build stopped.")
        html = finish_document(text)
        self._finish(project, html, channel, started, usage, note=f"First build · {theme['name']}", kind="build")

    def _stream(self, messages, channel, cancel, started, tracker=None, on_text=None):
        text, usage = "", {}
        last_code = last_steps = 0.0
        last_complete = -1
        first_token = None
        for kind, value in llm.stream(messages, max_tokens=32000, temperature=0.7, cancelled=cancel.is_set):
            if kind == "usage":
                usage = value
                continue
            if first_token is None:
                first_token = time.perf_counter()
                channel.push("first_token", ms=round((first_token - started) * 1000))
            text += value
            now = time.perf_counter()
            if now - last_code > 0.25:
                last_code = now
                rate = len(text) / 4 / max(now - first_token, 0.2)
                channel.set_latest("code", text=text, chars=len(text), tokens_per_s=round(rate))
            if tracker and now - last_steps > 0.2:
                last_steps = now
                channel.set_latest("progress", **tracker.steps(text))
                partial = tracker.partial(text)
                if partial and partial["complete"] != last_complete:
                    last_complete = partial["complete"]
                    channel.set_latest("preview", **partial)
            if on_text:
                on_text(text)
        channel.set_latest("code", text=text, chars=len(text), tokens_per_s=0)
        if tracker:
            channel.set_latest("progress", **tracker.steps(text + "</html>"))
        return text, usage

    def _finish(self, project, html, channel, started, usage, note, kind):
        channel.push("step", id="voice", status="active")
        sections = project["plan"]["sections"]
        channel.push("step", id="voice", status="done")
        channel.push("step", id="qa", status="active")
        checks = quality_checks(html, sections)
        channel.push("step", id="qa", status="done")
        stats = {"ms": round((time.perf_counter() - started) * 1000), "kb": round(len(html.encode()) / 1024, 1),
                 "lines": html.count("\n"), "tokens": usage.get("completion_tokens"), "cost": usage.get("cost"),
                 "passed": sum(c["status"] == "pass" for c in checks), "checks": len(checks)}
        project = self.store.get(project["id"])
        number = self.store.add_version(project, html, note, stats)
        project = self.store.get(project["id"])
        project["stage"] = "ready"
        project["messages"].append({"role": "assistant", "kind": kind, "version": number, "note": note,
                                    "stats": stats, "checks": checks, "t": time.time()})
        self.store.save(project)
        channel.push("done", version=number, note=note, stats=stats, checks=checks, html=html)

    # -------- edit

    def edit(self, project_id, instruction):
        project = self.store.get(project_id)
        if not project.get("current"):
            raise ValueError("Build the site first")
        instruction = clean_text(instruction, 1500)
        if not instruction:
            raise ValueError("Describe the change")
        project["stage"] = "editing"
        project["messages"].append({"role": "user", "kind": "text", "text": instruction, "t": time.time()})
        self.store.save(project)

        def work(channel, cancel, started):
            html = self.store.html(project_id)
            channel.push("start", kind="edit", instruction=instruction, model=llm.builder_model())
            seen = []

            def on_text(text):
                for m in EDIT_BLOCK.finditer(text):
                    if m.group(2) not in seen:
                        seen.append(m.group(2))
                        channel.push("editing", part=m.group(2), op=m.group(1))

            messages = [{"role": "system", "content": EDIT},
                        {"role": "user", "content": f"Current page:\n{html}\n\nChange request: {instruction}"}]
            reply, usage = self._stream(messages, channel, cancel, started, on_text=on_text)
            if cancel.is_set():
                raise RuntimeError("Edit stopped.")
            note, mode, payload = parse_edit(reply)
            if mode == "full":
                new_html, touched = payload, ["page"]
            else:
                new_html, touched = apply_blocks(html, payload)
            channel.push("applied", mode=mode, parts=touched)
            self._finish(project, new_html, channel, started, usage, note=note, kind="edit")

        return self._start(project_id, "edit", work)
