"""Markdown rendering with content-safety post-processing.

AI-written editions are content, not trusted markup, so:

- raw HTML in Markdown is escaped (``html: False``),
- rendered ``<a href>`` / ``<img src>`` URLs are scheme-checked
  (http, https, mailto and relative-only),
- relative image paths are resolved against the issue file and rewritten
  to ``/media/...`` URLs only when they land inside the configured images
  tree after path and symlink resolution; otherwise the image is dropped
  and the layout stays intact.

Date formatting uses explicit name tables so a calendar date can never
shift by timezone or server locale.
"""

from __future__ import annotations

import html as html_module
import re
from datetime import date
from pathlib import Path
from urllib.parse import quote, unquote

from markdown_it import MarkdownIt

_md = MarkdownIt("js-default", options_update={"html": False, "linkify": False})
_md.enable(["table", "strikethrough"])

SAFE_HREF_SCHEMES = ("http", "https", "mailto")
IMAGE_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".avif", ".bmp", ".ico"}

_SCHEME_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.-]*):")
_IMG_TAG_RE = re.compile(r"<img\s[^>]*>")
_A_TAG_RE = re.compile(r"<a\s[^>]*>.*?</a>", re.DOTALL)
_SRC_ATTR_RE = re.compile(r"\bsrc=\"([^\"]*)\"")
_HREF_ATTR_RE = re.compile(r"\bhref=\"([^\"]*)\"")
_ALT_ATTR_RE = re.compile(r"\balt=\"([^\"]*)\"")

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


# --------------------------------------------------------------------------
# dates
# --------------------------------------------------------------------------


def format_long(d: date) -> str:
    """``Fri, Nov 6, 2026``"""
    return f"{_WEEKDAYS[d.weekday()]}, {_MONTHS[d.month - 1]} {d.day}, {d.year}"


def format_medium(d: date) -> str:
    """``Nov 6, 2026``"""
    return f"{_MONTHS[d.month - 1]} {d.day}, {d.year}"


def format_news_date(raw: str) -> str:
    if raw == "Unknown":
        return "Unknown"
    try:
        return format_medium(date.fromisoformat(raw))
    except ValueError:
        return raw


# --------------------------------------------------------------------------
# markdown
# --------------------------------------------------------------------------


def render_inline(text: str) -> str:
    """Render one line of Markdown to inline HTML (escaped, no <p>)."""
    return _md.renderInline(text)


def render_block(text: str) -> str:
    """Render a Markdown block to HTML (escaped, raw HTML disabled)."""
    return _md.render(text)


# --------------------------------------------------------------------------
# media resolution
# --------------------------------------------------------------------------


def resolve_media(src: str, issue_dir: Path, images_root: Path) -> str | None:
    """Map a relative image ``src`` to a /media URL inside the images tree.

    Returns ``None`` when the source is external (http/https is allowed by
    the caller), outside the images tree after resolution, not an image
    type, or missing on disk.
    """
    cleaned = src.strip()
    if not cleaned or _SCHEME_RE.match(cleaned):
        return None
    try:
        target = (issue_dir / unquote(cleaned)).resolve(strict=False)
    except (OSError, ValueError):
        return None
    base = images_root.resolve(strict=False)
    try:
        target.relative_to(base)
    except ValueError:
        return None
    if target.suffix.lower() not in IMAGE_EXTENSIONS:
        return None
    if not target.is_file():
        return None
    rel = target.relative_to(base).as_posix()
    return "/media/" + quote(rel)


def _attr(tag: str, regex: re.Pattern[str]) -> str | None:
    match = regex.search(tag)
    return html_module.unescape(match.group(1)) if match else None


def _is_safe_href(url: str) -> bool:
    match = _SCHEME_RE.match(url)
    return match is None or match.group(1).lower() in SAFE_HREF_SCHEMES


def _is_external_image(url: str) -> bool:
    match = _SCHEME_RE.match(url)
    return bool(match and match.group(1).lower() in ("http", "https"))


def external_http_url(src: str) -> str | None:
    """Return ``src`` when it is a hotlinkable http(s) URL, else None."""
    cleaned = src.strip()
    match = _SCHEME_RE.match(cleaned)
    if match and match.group(1).lower() in ("http", "https"):
        return cleaned
    return None


def sanitize_fragment(fragment: str, issue_dir: Path, images_root: Path) -> str:
    """Scheme-check links and rewrite/drop images in rendered Markdown."""

    def fix_img(match: re.Match[str]) -> str:
        tag = match.group(0)
        src = _attr(tag, _SRC_ATTR_RE)
        if src is None:
            return ""
        if _is_external_image(src):
            return tag.replace("<img ", '<img loading="lazy" ', 1)
        media_url = resolve_media(src, issue_dir, images_root)
        if media_url is None:
            return ""  # missing or blocked: layout handles the absence
        alt = _attr(tag, _ALT_ATTR_RE) or ""
        return f'<img src="{media_url}" alt="{html_module.escape(alt, quote=True)}" loading="lazy">'

    def fix_a(match: re.Match[str]) -> str:
        tag = match.group(0)
        opening = re.match(r"<a\s[^>]*>", tag).group(0)
        href = _attr(opening, _HREF_ATTR_RE)
        inner = tag[opening.rindex(">") + 1: tag.rindex("</a>")]
        if href is None or not _is_safe_href(href):
            return inner  # unwrap unsafe or href-less anchors
        if href.startswith(("http://", "https://")):
            return (
                f'<a href="{html_module.escape(href, quote=True)}" '
                f'target="_blank" rel="noopener noreferrer">{inner}</a>'
            )
        return f'<a href="{html_module.escape(href, quote=True)}">{inner}</a>'

    fragment = _IMG_TAG_RE.sub(fix_img, fragment)
    return _A_TAG_RE.sub(fix_a, fragment)
