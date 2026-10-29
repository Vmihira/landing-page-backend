"""Offline contracts for Studio, the voice router, event streams, and project storage. No paid APIs."""

import threading
from unittest.mock import Mock

import pytest

from voicenav import model, router
from voicenav.events import Channel
from voicenav.projects import Store
from voicenav.studio import (
    BuildTracker,
    apply_blocks,
    clean_plan,
    finish_document,
    parse_edit,
    quality_checks,
    regions,
)

PAGE = """<!DOCTYPE html>
<html lang="en">
<head><meta name="viewport" content="width=device-width"><title>T</title></head>
<body class="bg-background">
<!-- vn:section nav -->
<header id="nav" data-vn-label="Navigation"><a href="#hero">Home</a><a href="#pricing">Pricing</a></header>
<!-- vn:section hero -->
<section id="hero" data-vn-label="Hero"><h1>Hello</h1><img src="a.jpg" alt="A loaf"></section>
<!-- vn:section pricing -->
<section id="pricing" data-vn-label="Pricing"><button>Buy</button></section>
<!-- vn:section footer -->
<footer id="footer" data-vn-label="Footer">Bye</footer>
<!-- vn:end -->
<script>console.log(1)</script>
</body>
</html>
"""
SECTIONS = [{"id": "hero", "name": "Hero"}, {"id": "pricing", "name": "Pricing"}, {"id": "footer", "name": "Footer"}]


# ---------------------------------------------------------------- events

def test_channel_replays_from_any_sequence_and_keeps_only_the_latest_slot():
    channel = Channel()
    channel.push("start", kind="build")
    channel.set_latest("frame", data="old")
    channel.set_latest("frame", data="new")
    channel.push("done")
    channel.close()
    events = [e for e in channel.follow(0) if e]
    assert [e["type"] for e in events] == ["start", "done", "frame"]
    assert events[-1]["data"] == "new"
    assert [e["type"] for e in channel.follow(1) if e][0] == "done"


def test_follow_waits_for_new_events_from_another_thread():
    channel = Channel()
    seen = []

    def produce():
        channel.push("phase", phase="thinking")
        channel.close()

    threading.Timer(0.05, produce).start()
    for event in channel.follow(0, heartbeat=2):
        if event:
            seen.append(event["type"])
    assert seen == ["phase"]


# ---------------------------------------------------------------- building

def test_build_tracker_marks_parts_done_as_their_successor_starts():
    tracker = BuildTracker(SECTIONS)
    head = PAGE[:PAGE.index("<!-- vn:section hero")]
    progress = tracker.steps(head)
    assert progress["current"] == "nav" and "design" in progress["done"]
    middle = PAGE[:PAGE.index("<!-- vn:section footer")]
    progress = tracker.steps(middle)
    assert progress["current"] == "pricing" and {"nav", "hero"} <= set(progress["done"])
    progress = tracker.steps(PAGE)
    assert progress["current"] is None and "interactions" in progress["done"]


def test_unplanned_sections_are_tracked_before_the_footer():
    tracker = BuildTracker(SECTIONS)
    tracker.steps(PAGE.replace("<!-- vn:section footer -->", "<!-- vn:section faq -->\n<section id='faq'></section>\n"
                                                              "<!-- vn:section footer -->"))
    assert tracker.parts[-2:] == ["faq", "footer"]


def test_partial_preview_contains_only_complete_parts():
    text = PAGE[:PAGE.index("<button>")]
    partial = BuildTracker.partial(text)
    assert partial["body_class"] == "bg-background"
    assert 'id="hero"' in partial["body"] and 'id="pricing"' not in partial["body"]
    assert partial["complete"] == 2
    assert BuildTracker.partial("<!DOCTYPE html><html><head><title>") is None


def test_finish_document_strips_chatter_and_closes_a_truncated_page():
    html = finish_document("Here you go:\n```html\n<!DOCTYPE html><html><body><p>x")
    assert html.startswith("<!DOCTYPE html>") and html.rstrip().endswith("</html>") and "</body>" in html


def test_quality_checks_pass_a_complete_page_and_flag_problems():
    checks = {c["id"]: c for c in quality_checks(PAGE, SECTIONS)}
    assert all(c["status"] == "pass" for c in checks.values() if c["id"] != "voice")
    broken = PAGE.replace('alt="A loaf"', "").replace('href="#pricing"', 'href="#menu"').replace("<!-- vn:end -->", "")
    checks = {c["id"]: c for c in quality_checks(broken, SECTIONS)}
    assert checks["alt"]["status"] == "warn" and checks["links"]["status"] == "warn"
    assert checks["complete"]["status"] == "fail"


def test_clean_plan_sanitizes_ids_themes_and_bookends():
    plan = clean_plan({
        "sections": [{"id": "Our Menu!", "name": "Menu"}, {"id": "nav", "name": "Nav"}, {"id": "footer"}],
        "themes": [{"id": "Dark One", "name": "Dark", "mode": "dark",
                    "colors": {k: "#112233" for k in ("background", "surface", "text", "muted", "primary", "accent")},
                    "fonts": {"heading": "Inter; drop", "body": "Manrope"}},
                   {"id": "bad", "colors": {"background": "red"}}],
        "recommended_theme": "dark-one",
    })
    assert [s["id"] for s in plan["sections"]] == ["hero", "our-menu", "footer"]
    assert [t["id"] for t in plan["themes"]] == ["dark-one"]
    assert plan["themes"][0]["fonts"] == {"heading": "Inter", "body": "Manrope"}
    assert plan["recommended_theme"] == "dark-one"
    assert len(clean_plan({})["themes"]) == 4  # built-in themes when the model offers none


# ---------------------------------------------------------------- targeted edits

def test_regions_cover_head_sections_and_script():
    spans = regions(PAGE)
    assert {"head", "nav", "hero", "pricing", "footer", "script"} <= set(spans)
    start, stop = spans["pricing"]
    assert PAGE[start:stop].startswith("<!-- vn:section pricing") and "<button>Buy" in PAGE[start:stop]


def test_targeted_edit_replaces_inserts_and_deletes_parts():
    reply = """NOTE: Made pricing bolder and added a FAQ.
<!-- vn:replace pricing -->
<section id="pricing" data-vn-label="Pricing"><button>Buy now</button></section>
<!-- vn:insert faq after pricing -->
<section id="faq" data-vn-label="FAQ"><h2>FAQ</h2></section>
<!-- vn:delete hero -->"""
    note, mode, blocks = parse_edit(reply)
    assert note == "Made pricing bolder and added a FAQ." and mode == "blocks" and len(blocks) == 3
    html, touched = apply_blocks(PAGE, blocks)
    assert touched == ["pricing", "faq", "hero"]
    assert "Buy now" in html and 'id="hero"' not in html
    assert html.index('id="pricing"') < html.index('id="faq"') < html.index('id="footer"')
    assert html.count("<!-- vn:section faq -->") == 1 and "<script>console.log(1)</script>" in html


def test_edit_can_replace_head_and_script():
    blocks = [("replace", "head", None, "<head><title>New</title></head>"),
              ("replace", "script", None, "<script>x()</script>")]
    html, _ = apply_blocks(PAGE, blocks)
    assert "<title>New</title>" in html and "<script>x()</script>" in html and "console.log(1)" not in html


def test_full_rewrite_and_unusable_edits():
    note, mode, doc = parse_edit("NOTE: New look\n<!DOCTYPE html><html><body>hi</body></html>")
    assert mode == "full" and doc.startswith("<!DOCTYPE html>") and note == "New look"
    _, _, blocks = parse_edit("NOTE: nothing to do")
    with pytest.raises(ValueError, match="did not match"):
        apply_blocks(PAGE, blocks)


# ---------------------------------------------------------------- voice routing

def test_router_offers_only_operations_that_fit_the_view_and_stage():
    ready = router.operations_for({"view": "studio", "stage": "ready", "has_site": True, "targets": [{"index": 0}]})
    assert {"EDIT_SITE", "GO_TO", "DEVICE"} <= set(ready) and "PICK_THEME" not in ready
    planned = router.operations_for({"view": "studio", "stage": "planned", "themes": [{"id": "a"}]})
    assert {"BUILD_NOW", "PICK_THEME", "CHANGE_PLAN"} <= set(planned) and "EDIT_SITE" not in planned
    assert set(router.operations_for({"view": "preview", "targets": [{"index": 1}]})) == {
        "SCROLL_DOWN", "SCROLL_UP", "SCROLL_TOP", "GO_TO"}
    waiting = router.operations_for({"view": "navigator", "nav_status": "waiting"})
    assert "CONFIRM" in waiting and "PAUSE" in waiting


def choice(ids, selected):
    return {"choice": selected, "confidence": 0.9, "probabilities": {i: float(i == selected) for i in ids}}


def test_route_maps_the_chosen_target_back_to_the_observed_option(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router")

    def post(_url, _key, body):
        questions = body["questions"]
        assert set(questions) == {"operation", "page_target", "device_target"}
        return {"answers": {"operation": choice(questions["operation"]["criteria"], "GO_TO"),
                            "page_target": choice(questions["page_target"]["criteria"], "7")}}

    monkeypatch.setattr(router, "post_json", post)
    context = {"view": "studio", "stage": "ready", "has_site": True,
               "targets": [{"index": 3, "kind": "section", "label": "Hero"},
                           {"index": 7, "kind": "section", "label": "Pricing"}]}
    result = router.route("take me to pricing", context)
    assert result["operation"] == "GO_TO" and result["target"] == 7 and result["label"] == "Pricing"


def test_route_picks_a_theme_by_id(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router")
    themes = [{"id": "dawn", "name": "Dawn", "mode": "light"}, {"id": "ember", "name": "Ember", "mode": "dark"}]
    post = Mock(side_effect=lambda _u, _k, body: {"answers": {
        "operation": choice(body["questions"]["operation"]["criteria"], "PICK_THEME"),
        "theme_target": choice(body["questions"]["theme_target"]["criteria"], "2")}})
    monkeypatch.setattr(router, "post_json", post)
    result = router.route("the dark one", {"view": "studio", "stage": "planned", "themes": themes})
    assert result["target"] == "ember" and result["label"] == "Ember"


def test_route_rejects_an_invented_operation(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router")
    invented = {"answers": {"operation": choice(["DELETE_ALL"], "DELETE_ALL")}}
    monkeypatch.setattr(router, "post_json", Mock(return_value=invented))
    with pytest.raises(ValueError):
        router.route("delete everything", {"view": "home"})


def test_plan_progress_head_never_blocks_the_action(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "router")
    state = {"url": "u", "title": "t", "text": "x", "actions": [{"id": "wait", "kind": "wait", "label": "Wait"}]}

    def post(_url, _key, body):
        assert "plan_step" in body["questions"]
        assert "plan" not in str(body["questions"]["operation"])
        return {"model": "jev", "answers": {"operation": choice(body["questions"]["operation"]["criteria"], "WAIT"),
                                            "plan_step": {"choice": "99"}}}

    monkeypatch.setattr(model, "post_json", post)
    decision = model.choose(state, "Find a book", [], plan=["Open the shop", "Search"])
    assert decision["choice"] == "wait" and decision["plan_step"] is None


# ---------------------------------------------------------------- projects

def test_store_keeps_versions_and_rejects_path_tricks(tmp_path):
    store = Store(tmp_path)
    project = store.create("A bakery site")
    assert store.add_version(project, "<html>v1</html>", "First build") == 1
    assert store.add_version(project, "<html>v2</html>", "Darker") == 2
    assert store.html(project["id"]) == "<html>v2</html>" and store.html(project["id"], 1) == "<html>v1</html>"
    assert [p["id"] for p in store.list()] == [project["id"]]
    for bad in ("../etc", "..", "A" * 8, "x/y"):
        with pytest.raises(ValueError):
            store.get(bad)
    store.delete(project["id"])
    assert store.list() == []
