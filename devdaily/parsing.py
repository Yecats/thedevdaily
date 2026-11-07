"""Structural parsing of edition Markdown files.

The template (``EDITION_TEMPLATE.md``) is the contract:

- one H1 is the issue heading,
- each H2 starts a story,
- each H3 inside a story is an article section rendered in order,
- the labeled story fields are ``Section``, ``Featured``, ``News date``,
  ``Availability``, ``Tags`` and ``Summary``.

Structure is parsed from the raw lines (outside code fences) so a heading
inside a code fence can never split a story, and so field lines are read
even when a Markdown renderer would merge consecutive lines into one
paragraph.  A summary that wraps across lines is supported.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import yaml

EDITION_FILENAME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
CLOSING_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})\s*$")
FIELD_RE = re.compile(
    r"^\s*\*\*(Section|Featured|News date|Availability|Tags|Summary)(?:\s*:)?\*\*\s*:?\s*(.*)$",
    re.IGNORECASE,
)
IMAGE_LINE_RE = re.compile(r"^\s*!\[([^\]]*)\]\(\s*(\S+?)(?:\s+\"[^\"]*\")?\s*\)\s*$")
CREDIT_RE = re.compile(r"^\s*\*\s*(Image credit\b.*)$", re.IGNORECASE)

REQUIRED_META_KEYS = ("title", "edition_date", "coverage_start", "coverage_end")

DEFAULT_SECTION = "Other Tools"


class EditionError(ValueError):
    """An edition file is present but cannot be served; message names the reason."""


@dataclass
class StorySection:
    """An H3 section of a story with its raw Markdown body."""

    heading: str
    content: str


@dataclass
class Story:
    slug: str
    title: str
    section: str
    featured: bool
    news_date: str  # ISO date string or "Unknown"
    availability: str  # may be empty
    tags: list[str]
    summary: str
    image_src: str | None  # raw src as written in the file
    image_alt: str
    credit: str | None  # credit text (without the surrounding asterisks)
    sections: list[StorySection]
    preamble: str  # stray content before the first H3, if any


@dataclass
class Issue:
    filename: str
    date: date
    title: str  # frontmatter title
    heading: str  # H1 text (falls back to title)
    coverage_start: date
    coverage_end: date
    stories: list[Story] = field(default_factory=list)
    featured: Story | None = None


@dataclass
class BrokenIssue:
    """An edition file that exists but is unreadable or invalid."""

    filename: str
    reason: str


# --------------------------------------------------------------------------
# frontmatter
# --------------------------------------------------------------------------


def _as_date(value: object, label: str) -> date:
    """Accept a YAML date or a ``YYYY-MM-DD`` string; refuse anything else."""
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip())
        except ValueError:
            pass
    raise EditionError(f"{label} must be a YYYY-MM-DD calendar date, got {value!r}")


def _parse_frontmatter(text: str, filename: str) -> tuple[dict, str]:
    match = re.match(r"^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?(.*)$", text, re.DOTALL)
    if not match:
        raise EditionError("Missing YAML frontmatter (the file must start with '---').")
    try:
        meta = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise EditionError(f"Invalid YAML frontmatter: {exc}") from exc
    if not isinstance(meta, dict):
        raise EditionError("YAML frontmatter must be a mapping of keys to values.")
    for key in REQUIRED_META_KEYS:
        if key not in meta or meta[key] in (None, ""):
            raise EditionError(f"Frontmatter is missing the required '{key}' key.")
    return meta, match.group(2)


# --------------------------------------------------------------------------
# body splitting
# --------------------------------------------------------------------------


def _fence_marker(line: str) -> str | None:
    match = FENCE_RE.match(line)
    return match.group(1) if match else None


def _is_closing_fence(line: str, marker: str) -> bool:
    match = CLOSING_FENCE_RE.match(line)
    return bool(match and match.group(1)[0] == marker[0] and len(match.group(1)) >= len(marker))


def _split_body(body: str) -> tuple[str | None, list[list[str]]]:
    """Split the body into the issue heading and per-story raw line blocks.

    Code fences are tracked so headings inside them are ignored.  The first
    H1 becomes the issue heading; any later H1 defensively starts a story.
    """
    heading: str | None = None
    stories: list[list[str]] = []
    current: list[str] | None = None
    fence: str | None = None

    for line in body.splitlines():
        if fence is None:
            marker = _fence_marker(line)
            if marker:
                fence = marker
        elif _is_closing_fence(line, fence):
            fence = None
        else:
            # Inside a fence: always content of the current story.
            if current is not None:
                current.append(line)
            continue
        if fence is not None:  # the opening fence line itself
            if current is not None:
                current.append(line)
            continue

        heading_match = HEADING_RE.match(line)
        if heading_match:
            level = len(heading_match.group(1))
            if level == 1 and heading is None:
                heading = heading_match.group(2).strip()
                continue
            if level <= 2:  # H2 starts a story; later H1s defensively too
                current = [line]
                stories.append(current)
                continue
        if current is not None:
            current.append(line)
        # Lines before the first story (after the H1) are template scaffolding
        # and intentionally ignored.

    return heading, stories


# --------------------------------------------------------------------------
# story parsing
# --------------------------------------------------------------------------


def slugify(text: str) -> str:
    folded = (
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", folded).strip("-").lower()
    return slug or "story"


def _unique_slug(base: str, used: set[str]) -> str:
    """Deterministic dedup: first story keeps the plain slug, later ones get -2, -3..."""
    if base not in used:
        used.add(base)
        return base
    n = 2
    while f"{base}-{n}" in used:
        n += 1
    slug = f"{base}-{n}"
    used.add(slug)
    return slug


def _parse_story(raw_lines: list[str], slug: str) -> Story:
    title_match = HEADING_RE.match(raw_lines[0])
    title = title_match.group(2).strip() if title_match else raw_lines[0].strip()

    fields: dict[str, str] = {}
    summary_lines: list[str] = []
    image: tuple[str, str] | None = None  # (alt, src)
    credit: str | None = None
    sections: list[StorySection] = []
    preamble: list[str] = []
    fence: str | None = None

    i = 1  # raw_lines[0] is the H2 title line, already extracted
    while i < len(raw_lines):
        line = raw_lines[i]

        if fence is None:
            marker = _fence_marker(line)
            if marker:
                fence = marker
                _append_line(sections, preamble, line)
                i += 1
                continue
        else:
            if _is_closing_fence(line, fence):
                fence = None
            _append_line(sections, preamble, line)
            i += 1
            continue

        field_match = FIELD_RE.match(line)
        if field_match:
            name = field_match.group(1).lower()
            value = field_match.group(2).strip()
            if name == "summary":
                summary_lines, i = _absorb_summary(raw_lines, i, value)
            else:
                fields[name] = value
                i += 1
            continue

        if image is None:
            image_match = IMAGE_LINE_RE.match(line)
            if image_match:
                image = (image_match.group(1).strip(), image_match.group(2).strip())
                i += 1
                continue

        if credit is None:
            credit_match = CREDIT_RE.match(line)
            if credit_match:
                credit = credit_match.group(1).strip()
                if credit.endswith("*"):
                    credit = credit[:-1].strip()
                i += 1
                continue

        heading_match = HEADING_RE.match(line)
        if heading_match and len(heading_match.group(1)) >= 3:
            sections.append(StorySection(heading_match.group(2).strip(), ""))
            i += 1
            continue

        _append_line(sections, preamble, line)
        i += 1

    summary = _collapse(" ".join(summary_lines))
    sections = [s for s in sections if s.content.strip()]

    news_date = fields.get("news date", "").strip() or "Unknown"
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", news_date):
        news_date = "Unknown"

    tags_raw = fields.get("tags", "")
    tags = [t.strip() for t in tags_raw.split(",") if t.strip()]

    image_alt, image_src = image if image else ("", None)

    return Story(
        slug=slug,
        title=title,
        section=fields.get("section", "").strip() or DEFAULT_SECTION,
        featured=fields.get("featured", "").strip().lower() == "true",
        news_date=news_date,
        availability=fields.get("availability", "").strip(),
        tags=tags,
        summary=summary,
        image_src=image_src,
        image_alt=image_alt,
        credit=credit,
        sections=sections,
        preamble=_collapse("\n".join(preamble)).strip(),
    )


def _append_line(sections: list[StorySection], preamble: list[str], line: str) -> None:
    if sections:
        sections[-1].content += line + "\n"
    else:
        preamble.append(line)


def _absorb_summary(
    raw_lines: list[str], start: int, first_value: str
) -> tuple[list[str], int]:
    """Read the summary line plus any wrapped continuation lines."""
    lines = [first_value] if first_value else []
    i = start + 1
    while i < len(raw_lines):
        nxt = raw_lines[i]
        if not nxt.strip():
            break
        if (
            FIELD_RE.match(nxt)
            or IMAGE_LINE_RE.match(nxt)
            or CREDIT_RE.match(nxt)
            or HEADING_RE.match(nxt)
            or _fence_marker(nxt)
        ):
            break
        lines.append(nxt.strip())
        i += 1
    return lines, i


def _collapse(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text)


# --------------------------------------------------------------------------
# edition entry point
# --------------------------------------------------------------------------


def parse_edition(path: Path) -> Issue | BrokenIssue:
    """Parse one edition file; never raises, returns BrokenIssue on problems."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as exc:
        return BrokenIssue(path.name, f"The file could not be read ({exc}).")
    try:
        return _parse_edition_text(text, path)
    except EditionError as exc:
        return BrokenIssue(path.name, str(exc))
    except Exception as exc:  # defensive: a bad file must never kill the app
        return BrokenIssue(path.name, f"Unexpected error while parsing ({exc}).")


def _parse_edition_text(text: str, path: Path) -> Issue:
    filename_date = date.fromisoformat(path.stem)
    meta, body = _parse_frontmatter(text, path.name)

    edition_date = _as_date(meta["edition_date"], "edition_date")
    if edition_date != filename_date:
        raise EditionError(
            f"edition_date {edition_date.isoformat()} does not match the "
            f"filename date {filename_date.isoformat()}."
        )
    coverage_start = _as_date(meta["coverage_start"], "coverage_start")
    coverage_end = _as_date(meta["coverage_end"], "coverage_end")
    if coverage_start > coverage_end:
        raise EditionError(
            f"coverage_start {coverage_start.isoformat()} is after "
            f"coverage_end {coverage_end.isoformat()}."
        )
    title = str(meta["title"]).strip()

    heading, story_blocks = _split_body(body)
    used_slugs: set[str] = set()
    stories: list[Story] = []
    for block in story_blocks:
        first = HEADING_RE.match(block[0])
        raw_title = first.group(2).strip() if first else block[0].strip()
        stories.append(_parse_story(block, _unique_slug(slugify(raw_title), used_slugs)))
    featured = next((s for s in stories if s.featured), stories[0] if stories else None)

    return Issue(
        filename=path.name,
        date=filename_date,
        title=title,
        heading=heading or title,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        stories=stories,
        featured=featured,
    )
