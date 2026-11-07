"""HTTP routes for The Dev Daily."""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from flask import Blueprint, abort, current_app, render_template, request, send_file

from .library import EditionLibrary
from .parsing import BrokenIssue, Issue, Story, slugify
from .rendering import (
    IMAGE_EXTENSIONS,
    external_http_url,
    format_long,
    format_medium,
    format_news_date,
    render_block,
    render_inline,
    resolve_media,
    sanitize_fragment,
)

bp = Blueprint("devdaily", __name__)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Editorial pick: one consistent glyph for every section entry — the
# sparkle from the AI Tools icon in the reference design.
SECTION_ICON = "✧"


def section_icon(name: str) -> str:
    return SECTION_ICON


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _library() -> EditionLibrary:
    return current_app.extensions["devdaily_library"]


def _paths() -> tuple[Path, Path]:
    return Path(current_app.config["EDITIONS_ROOT"]), _library().images_root


def _parse_date(value: str) -> date | None:
    if not _DATE_RE.match(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _article_url(story: Story, issue_date: date) -> str:
    return f"/issue/{issue_date.isoformat()}/{story.slug}"


def _story_image(story: Story, issue: Issue) -> str | None:
    if not story.image_src:
        return None
    external = external_http_url(story.image_src)
    if external is not None:
        return external  # hotlinked announcement image, scheme-checked
    root, images_root = _paths()
    return resolve_media(story.image_src, root, images_root)


def _front_context(issue: Issue, base_url: str = "/", section_filter: str | None = None) -> dict:
    """View-model for the newspaper front page of one issue.

    ``section_filter`` (a section slug from ``?section=``) narrows the
    Roundup at a Glance to that section's stories; the TOC links carry the
    filter as real URLs so it works without JavaScript and is shareable.
    """
    featured = issue.featured
    secondary = [s for s in issue.stories if s is not featured][:2]

    # The Roundup at a Glance indexes the rest of the paper: stories not
    # already shown as the lead or the two secondary cards above it.
    shown_ids = {id(s) for s in secondary}
    if featured is not None:
        shown_ids.add(id(featured))

    active_slug: str | None = None
    active_label = ""
    if section_filter:
        for story in issue.stories:
            if slugify(story.section) == section_filter:
                active_slug = section_filter
                active_label = story.section
                break

    sections: list[dict] = []
    index: dict[str, dict] = {}
    for story in issue.stories:
        slug = slugify(story.section)
        entry = index.get(slug)
        if entry is None:
            entry = {
                "label": story.section,
                "icon": section_icon(story.section),
                "url": f"{base_url}?section={slug}#roundup",
                "count": 0,
                "active": slug == active_slug,
            }
            index[slug] = entry
            sections.append(entry)
        entry["count"] += 1

    # The In-this-edition list is topics only: one entry per section that
    # has stories, in story order. (Top Stories / Roundup Index shortcuts
    # were dropped; the roundup's filter chip resets any section filter.)
    toc = sections

    roundup_all = [s for s in issue.stories if id(s) not in shown_ids]
    roundup_stories = (
        [s for s in roundup_all if slugify(s.section) == active_slug]
        if active_slug else roundup_all
    )

    def story_view(story: Story) -> dict:
        return {
            "story": story,
            "url": _article_url(story, issue.date),
            "image": _story_image(story, issue),
            "icon": section_icon(story.section),
        }

    return {
        "issue": issue,
        "edition_number": _library().edition_number(issue.date),
        "date_long": format_long(issue.date),
        "date_iso": issue.date.isoformat(),
        "featured": None if featured is None else story_view(featured),
        "secondary": [story_view(s) for s in secondary],
        "roundup": [story_view(s) for s in roundup_stories],
        "toc": toc,
        "base_url": base_url,
        "filter_note": {
            "label": active_label,
            "count": len(roundup_stories),
            "total": len(roundup_all),
        } if active_slug else None,
        "coverage": f"{format_medium(issue.coverage_start)} – {format_medium(issue.coverage_end)}",
    }


def _render_issue_front(issue: Issue, section_filter: str | None = None):
    return render_template(
        "front.html",
        **_front_context(
            issue,
            base_url=f"/issue/{issue.date.isoformat()}",
            section_filter=section_filter,
        ),
    )


# --------------------------------------------------------------------------
# pages
# --------------------------------------------------------------------------


@bp.get("/")
def home():
    issue = _library().newest()
    if issue is None:
        return render_template("empty.html", broken=_library().broken())
    section = request.args.get("section", "").strip().lower() or None
    return render_template("front.html", **_front_context(issue, base_url="/", section_filter=section))


@bp.get("/issue/<date_str>")
def issue_front(date_str: str):
    day = _parse_date(date_str)
    if day is None:
        abort(404)
    item = _library().get(day)
    if item is None:
        abort(404)
    if isinstance(item, BrokenIssue):
        return render_template("broken_edition.html", item=item), 404
    section = request.args.get("section", "").strip().lower() or None
    return _render_issue_front(item, section_filter=section)


@bp.get("/issue/<date_str>/<slug>")
def article(date_str: str, slug: str):
    day = _parse_date(date_str)
    if day is None:
        abort(404)
    item = _library().get(day)
    if item is None:
        abort(404)
    if isinstance(item, BrokenIssue):
        return render_template("broken_edition.html", item=item), 404
    story = next((s for s in item.stories if s.slug == slug), None)
    if story is None:
        abort(404)

    root, images_root = _paths()
    sections = [
        {
            "heading": section.heading,
            "html": sanitize_fragment(render_block(section.content), root, images_root),
        }
        for section in story.sections
    ]
    credit_html = (
        sanitize_fragment(render_inline(f"*{story.credit}*"), root, images_root)
        if story.credit
        else None
    )
    preamble_html = (
        sanitize_fragment(render_block(story.preamble), root, images_root)
        if story.preamble
        else None
    )
    context = _front_context(item)
    return render_template(
        "article.html",
        issue=item,
        story=story,
        article_url=_article_url(story, item.date),
        image=_story_image(story, item),
        icon=section_icon(story.section),
        news_date=format_news_date(story.news_date),
        sections=sections,
        credit_html=credit_html,
        preamble_html=preamble_html,
        edition_number=context["edition_number"],
        date_long=context["date_long"],
        date_iso=context["date_iso"],
    )


@bp.get("/archive")
def archive():
    issues = _library().issues()
    rows = [
        {
            "issue": issue,
            "url": f"/issue/{issue.date.isoformat()}",
            "label": format_long(issue.date),
            "number": _library().edition_number(issue.date),
            "story_count": len(issue.stories),
        }
        for issue in issues
    ]
    return render_template("archive.html", rows=rows, broken=_library().broken())


@bp.get("/media/<path:relpath>")
def media(relpath: str):
    images_root = _library().images_root
    if "\\" in relpath or any(part == ".." for part in relpath.split("/")):
        abort(404)
    try:
        target = (images_root / relpath).resolve(strict=True)
    except (OSError, ValueError):
        abort(404)
    base = images_root.resolve(strict=False)
    try:
        target.relative_to(base)
    except ValueError:
        abort(404)  # symlink or path escaped the images tree
    if not target.is_file() or target.suffix.lower() not in IMAGE_EXTENSIONS:
        abort(404)
    return send_file(target, conditional=True, max_age=300)


@bp.get("/healthz")
def healthz():
    return "ok"


# --------------------------------------------------------------------------
# error pages
# --------------------------------------------------------------------------


@bp.app_errorhandler(404)
def not_found(error):
    return render_template("missing.html"), 404


@bp.app_errorhandler(500)
def server_error(error):
    return render_template("error.html"), 500
