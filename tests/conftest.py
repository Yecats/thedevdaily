"""Shared fixtures for The Dev Daily tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from devdaily import create_app  # noqa: E402

# A 1x1 transparent PNG, used as a stand-in edition image.
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082"
)

STORY_TEMPLATE = """## {title}

**Section:** {section}
**Featured:** {featured}
**News date:** {news_date}
**Availability:** {availability}
**Tags:** {tags}

**Summary:** {summary}

{extra}
"""


def story(
    title: str,
    section: str = "AI Tools",
    featured: str = "false",
    summary: str = "A short summary of the story.",
    news_date: str = "2026-11-01",
    availability: str = "Shipped",
    tags: str = "AI, Testing",
    extra: str = "### About the tool\n\nIt does things.\n\n### Why it matters\n\nIt matters.\n",
) -> str:
    return STORY_TEMPLATE.format(
        title=title, section=section, featured=featured, news_date=news_date,
        availability=availability, tags=tags, summary=summary, extra=extra,
    )


def frontmatter(date: str, start: str | None = None, end: str | None = None) -> str:
    return (
        "---\n"
        'title: "The Dev Daily"\n'
        f'edition_date: "{date}"\n'
        f'coverage_start: "{start or date}"\n'
        f'coverage_end: "{end or date}"\n'
        "---\n"
    )


def write_edition(editions: Path, date: str, body: str, **fm) -> Path:
    path = editions / f"{date}.md"
    path.write_text(frontmatter(date, **fm) + "\n# The Dev Daily\n\n" + body, encoding="utf-8")
    return path


def add_image(editions: Path, date: str, name: str = "pic.webp") -> str:
    """Create an image in the issue's image folder; return the markdown src."""
    img_dir = editions / "images" / date
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / name).write_bytes(PNG_1PX)
    return f"./images/{date}/{name}"


@pytest.fixture
def editions(tmp_path) -> Path:
    root = tmp_path / "editions"
    root.mkdir()
    return root


@pytest.fixture
def make_app(editions):
    def factory():
        return create_app(editions)

    return factory


@pytest.fixture
def client(make_app):
    return make_app().test_client()
