"""Structural parsing tests: the template is the contract."""

from devdaily.parsing import parse_edition

from conftest import add_image, story, write_edition


def test_valid_edition_parses(editions):
    body = story("First Story", featured="true") + story("Second Story", section="3D & Blender")
    write_edition(editions, "2026-11-06", body)
    parsed = parse_edition(editions / "2026-11-06.md")
    assert not hasattr(parsed, "reason"), parsed
    assert parsed.title == "The Dev Daily"
    assert parsed.heading == "The Dev Daily"
    assert [s.slug for s in parsed.stories] == ["first-story", "second-story"]
    assert parsed.featured.slug == "first-story"
    assert parsed.date.isoformat() == "2026-11-06"


def test_fields_read_across_merged_paragraph(editions):
    # Fields sit on consecutive lines; a Markdown renderer would merge them
    # into one paragraph. The parser must still read each label.
    body = story("Fields Story")
    write_edition(editions, "2026-11-06", body)
    parsed = parse_edition(editions / "2026-11-06.md")
    s = parsed.stories[0]
    assert s.section == "AI Tools"
    assert s.featured is False
    assert s.news_date == "2026-11-01"
    assert s.availability == "Shipped"
    assert s.tags == ["AI", "Testing"]
    assert s.summary == "A short summary of the story."


def test_summary_wraps_across_lines(editions):
    body = story(
        "Wrapped Story",
        extra=(
            "**Summary:** This is a long summary that the AI wrapped\n"
            "onto a second line, and even a third one appears here.\n"
            "\n"
            "### About the tool\n\nBody.\n"
        ),
    )
    write_edition(editions, "2026-11-06", body)
    s = parse_edition(editions / "2026-11-06.md").stories[0]
    assert s.summary == (
        "This is a long summary that the AI wrapped onto a second line, "
        "and even a third one appears here."
    )


def test_heading_inside_code_fence_does_not_split_story(editions):
    body = (
        story("Fenced Story", extra="### Try or teach\n\n```python\n## Not a story\n**Section:** fake\n```\n")
        + story("After Story")
    )
    write_edition(editions, "2026-11-06", body)
    parsed = parse_edition(editions / "2026-11-06.md")
    assert len(parsed.stories) == 2
    assert parsed.stories[0].slug == "fenced-story"
    assert "## Not a story" in parsed.stories[0].sections[-1].content
    assert parsed.stories[0].section == "AI Tools"  # the fence line did not overwrite


def test_featured_first_marked_wins_when_multiple(editions):
    body = story("A", featured="false") + story("B", featured="true") + story("C", featured="true")
    write_edition(editions, "2026-11-06", body)
    parsed = parse_edition(editions / "2026-11-06.md")
    assert parsed.featured.slug == "b"


def test_featured_falls_back_to_first_story(editions):
    body = story("A", featured="false") + story("B", featured="false")
    write_edition(editions, "2026-11-06", body)
    assert parse_edition(editions / "2026-11-06.md").featured.slug == "a"


def test_duplicate_slugs_are_deterministic(editions):
    body = story("Same Title Here") + story("Same Title Here") + story("Same Title Here")
    write_edition(editions, "2026-11-06", body)
    parsed = parse_edition(editions / "2026-11-06.md")
    assert [s.slug for s in parsed.stories] == ["same-title-here", "same-title-here-2", "same-title-here-3"]


def test_empty_sections_are_dropped(editions):
    body = story("Gaps", extra="### Empty one\n\n### About the tool\n\nReal content.\n")
    write_edition(editions, "2026-11-06", body)
    sections = parse_edition(editions / "2026-11-06.md").stories[0].sections
    assert [s.heading for s in sections] == ["About the tool"]


def test_image_and_credit_are_captured(editions):
    src = add_image(editions, "2026-11-06")
    body = story(
        "With Image",
        extra=(
            "### Before\n\n"
            f"![An alt text]({src})\n"
            "*Image credit: [Someone](https://example.com/photo).*\n"
            "\n### About the tool\n\nBody.\n"
        ),
    )
    write_edition(editions, "2026-11-06", body)
    s = parse_edition(editions / "2026-11-06.md").stories[0]
    assert s.image_src == src
    assert s.image_alt == "An alt text"
    assert s.credit == "Image credit: [Someone](https://example.com/photo)."


def test_news_date_bad_value_becomes_unknown(editions):
    body = story("Bad Date", news_date="sometime soon")
    write_edition(editions, "2026-11-06", body)
    assert parse_edition(editions / "2026-11-06.md").stories[0].news_date == "Unknown"


def test_one_story_issue(editions):
    write_edition(editions, "2026-11-06", story("Only Story"))
    parsed = parse_edition(editions / "2026-11-06.md")
    assert len(parsed.stories) == 1
    assert parsed.featured is parsed.stories[0]


def test_long_headline_slugs_cleanly(editions):
    long_title = (
        "Blender Releases an Extremely Long Headline About Gaussian Splatting, "
        "Procedural Nodes, and Everything Else That Went Into This Massive Update"
    )
    write_edition(editions, "2026-11-06", story(long_title))
    parsed = parse_edition(editions / "2026-11-06.md")
    assert parsed.stories[0].slug.startswith("blender-releases-an-extremely-long")


# --------------------------------------------------------------------------
# invalid editions
# --------------------------------------------------------------------------


def test_missing_frontmatter(editions):
    path = editions / "2026-11-06.md"
    path.write_text("# The Dev Daily\n", encoding="utf-8")
    parsed = parse_edition(path)
    assert parsed.filename == "2026-11-06.md"
    assert "frontmatter" in parsed.reason.lower()


def test_edition_date_must_match_filename(editions):
    body = story("A")
    path = editions / "2026-11-06.md"
    path.write_text(
        '---\ntitle: "T"\nedition_date: "2026-11-05"\n'
        'coverage_start: "2026-11-05"\ncoverage_end: "2026-11-06"\n---\n' + body,
        encoding="utf-8",
    )
    parsed = parse_edition(path)
    assert "does not match" in parsed.reason


def test_coverage_must_be_ordered(editions):
    body = story("A")
    path = editions / "2026-11-06.md"
    path.write_text(
        '---\ntitle: "T"\nedition_date: "2026-11-06"\n'
        'coverage_start: "2026-11-07"\ncoverage_end: "2026-11-05"\n---\n' + body,
        encoding="utf-8",
    )
    parsed = parse_edition(path)
    assert "coverage" in parsed.reason.lower()


def test_broken_yaml_reports_filename(editions):
    path = editions / "2026-11-06.md"
    path.write_text("---\ntitle: [unclosed\n---\nbody\n", encoding="utf-8")
    parsed = parse_edition(path)
    assert parsed.filename == "2026-11-06.md"
    assert parsed.reason


def test_missing_required_key(editions):
    path = editions / "2026-11-06.md"
    path.write_text(
        '---\ntitle: "T"\nedition_date: "2026-11-06"\n---\n' + story("A"),
        encoding="utf-8",
    )
    parsed = parse_edition(path)
    assert "coverage_start" in parsed.reason
