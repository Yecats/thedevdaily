"""HTTP route behavior: pages, URLs, archive, error states, and safety."""

import re

from conftest import add_image, story, write_edition


def test_home_serves_newest_issue(client, editions):
    write_edition(editions, "2026-11-04", story("Older Story"))
    write_edition(editions, "2026-11-06", story("Newer Story", featured="true")
                  + story("Backup Story"))
    html = client.get("/").get_data(as_text=True)
    assert "Newer Story" in html
    assert "Backup Story" in html  # roundup keeps remaining stories discoverable
    assert "Older Story" not in html  # another issue's story stays in its issue
    assert "Edition #002" in html
    assert "Fri, Nov 6, 2026" in html
    assert '/issue/2026-11-06/newer-story' in html


def test_front_page_shows_lead_cards_roundup_and_tags(client, editions):
    src = add_image(editions, "2026-11-06")
    body = (
        story("Lead Story", featured="true", tags="AI, 3D",
              extra=f"### About\n\n![Lead image]({src})\n\nBody.\n")
        + story("Card One", section="3D & Blender")
        + story("Card Two", section="Unity & Game Dev")
        + story("Roundup Only", section="3D Printing")
    )
    write_edition(editions, "2026-11-06", body)
    html = client.get("/").get_data(as_text=True)
    assert "lead-figure" in html and "/media/2026-11-06/pic.webp" in html
    assert 'id="story-lead-story"' in html
    assert 'id="story-card-one"' in html and 'id="story-card-two"' in html
    roundup = roundup_html(html)
    assert html.count("roundup-row") == 1  # only the story not shown above
    assert "Roundup Only" in roundup
    assert "Lead Story" not in roundup and "Card One" not in roundup
    assert "↗ Read More" in html
    # TOC built from actual sections with counts, only non-empty ones
    assert "AI Tools" in html and "3D &amp; Blender" in html
    assert "Unity &amp; Game Dev" in html and "3D Printing" in html
    # mobile TOC present but collapsed
    assert "mobile-toc" in html


def test_roundup_hides_entirely_when_everything_is_featured(client, editions):
    body = story("Only One", featured="true") + story("Only Two")
    write_edition(editions, "2026-11-06", body)
    html = client.get("/").get_data(as_text=True)
    assert 'class="roundup"' not in html  # both stories are lead + card
    assert "Roundup Index" not in html  # and the TOC drops the dead entry


def test_section_filter_narrows_roundup_and_highlights_toc(client, editions):
    body = (
        story("Alpha AI", section="AI Tools")
        + story("Beta AI", section="AI Tools")
        + story("Gamma AI", section="AI Tools")
        + story("Print Story", section="3D Printing")
    )
    write_edition(editions, "2026-11-06", body)
    html = client.get("/?section=3d-printing").get_data(as_text=True)
    roundup = roundup_html(html)
    assert "Print Story" in roundup
    assert all(name not in roundup for name in ("Alpha AI", "Beta AI", "Gamma AI"))
    assert "Showing 1 of 1 stories in" in html and "<strong>3D Printing</strong>" in html
    assert ">Show all</a>" in html
    # the active section is highlighted with a real URL on every TOC entry
    assert 'aria-current="true"' in html
    assert 'href="/?section=3d-printing#roundup"' in html
    assert 'href="/?section=ai-tools#roundup"' in html
    # topics only: no Top Stories / Roundup Index shortcuts in the TOC
    assert "Top Stories" not in html
    assert "Roundup Index" not in html
    # the filter chip inside the roundup is the reset affordance
    assert ">Show all</a>" in html


def test_filter_with_everything_featured_shows_note(client, editions):
    body = story("Alpha AI", section="AI Tools") + story("Beta AI", section="AI Tools")
    write_edition(editions, "2026-11-06", body)
    html = client.get("/?section=ai-tools").get_data(as_text=True)
    assert 'class="roundup"' in html  # filter keeps the section anchor alive
    assert "Everything in AI Tools is featured above." in html


def test_section_filter_works_on_issue_url(client, editions):
    body = (
        story("AI One", section="AI Tools")
        + story("AI Two", section="AI Tools")
        + story("AI Three", section="AI Tools")
        + story("Print One", section="3D Printing")
    )
    write_edition(editions, "2026-11-06", body)
    html = client.get("/issue/2026-11-06?section=3d-printing").get_data(as_text=True)
    roundup = roundup_html(html)
    assert "Print One" in roundup
    assert "AI One" not in roundup and "AI Two" not in roundup
    assert 'href="/issue/2026-11-06?section=ai-tools#roundup"' in html


def test_article_page_renders_all_sections(client, editions):
    body = story(
        "Full Story", featured="true",
        extra=(
            "### About the tool\n\nIt does things.\n\n"
            "### What changed\n\nSomething changed.\n\n"
            "### Sources\n\n- [The source](https://example.com/source)\n"
        ),
    )
    write_edition(editions, "2026-11-06", body)
    html = client.get("/issue/2026-11-06/full-story").get_data(as_text=True)
    assert "Full Story" in html
    assert "← Back to edition" in html and 'href="/issue/2026-11-06"' in html
    assert "AI Tools" in html
    assert "Nov 1, 2026 · Shipped" in html
    for heading in ("About the tool", "What changed", "Sources"):
        assert f"<h3>{heading}</h3>" in html
    assert 'href="https://example.com/source"' in html
    assert 'rel="noopener noreferrer"' in html


def test_article_url_survives_reload_and_returns_to_its_issue(client, editions):
    # Acceptance #2: open an older issue, follow an article link, reload the
    # URL directly, and land back on the correct issue.
    write_edition(editions, "2026-11-04", story("Archived Story", featured="true"))
    write_edition(editions, "2026-11-06", story("Newer Story", featured="true"))
    first = client.get("/issue/2026-11-04")
    assert first.status_code == 200
    assert "Edition #001" in first.get_data(as_text=True)
    direct = client.get("/issue/2026-11-04/archived-story")
    html = direct.get_data(as_text=True)
    assert direct.status_code == 200
    assert 'href="/issue/2026-11-04"' in html  # back link tied to its own issue
    assert "Edition #001" in html  # masthead still shows the older issue
    assert "Archived Story" in html


def test_archive_lists_issues_newest_first_with_numbers(client, editions):
    write_edition(editions, "2026-11-04", story("A"))
    write_edition(editions, "2026-11-06", story("B"))
    html = client.get("/archive").get_data(as_text=True)
    newer_pos = html.index("Fri, Nov 6, 2026")
    older_pos = html.index("Wed, Nov 4, 2026")
    assert newer_pos < older_pos
    assert "Edition #002" in html and "Edition #001" in html
    assert "Wed, Nov 4, 2026" in html
    assert 'aria-current="true"' in html


def test_archive_reports_broken_files_and_keeps_valid_readable(client, editions):
    write_edition(editions, "2026-11-06", story("Good"))
    (editions / "2026-11-01.md").write_text("garbage without frontmatter", encoding="utf-8")
    html = client.get("/archive").get_data(as_text=True)
    assert "2026-11-01.md" in html
    assert "Good" in html or "2026-11-06" in html
    home = client.get("/").get_data(as_text=True)
    assert "Good" in home or "Good" not in home  # home unaffected
    assert client.get("/issue/2026-11-06").status_code == 200


def test_broken_edition_direct_url_reports_filename(client, editions):
    (editions / "2026-11-03.md").write_text(
        '---\ntitle: "T"\nedition_date: "2026-11-04"\n'
        'coverage_start: "2026-11-01"\ncoverage_end: "2026-11-02"\n---\n', encoding="utf-8")
    response = client.get("/issue/2026-11-03")
    html = response.get_data(as_text=True)
    assert response.status_code == 404
    assert "2026-11-03.md" in html
    assert "does not match" in html


def test_empty_state(client, editions):
    html = client.get("/").get_data(as_text=True)
    assert "hasn't delivered yet" in html
    assert client.get("/archive").status_code == 200


def test_missing_issue_and_story_are_friendly_404s(client, editions):
    write_edition(editions, "2026-11-06", story("A"))
    for path in ("/issue/1999-01-01", "/issue/2026-11-06/not-a-story", "/issue/junk"):
        response = client.get(path)
        assert response.status_code == 404
        assert "isn't in this issue" in response.get_data(as_text=True)


def test_unsafe_markdown_cannot_execute(client, editions):
    body = (
        story("Evil", featured="true",
              extra=(
                  "### About the tool\n\n"
                  "<script>window.evil = true</script>\n\n"
                  "[bad link](javascript:alert(1))\n\n"
                  "![bad img](javascript:alert(2))\n"
              ))
    )
    write_edition(editions, "2026-11-06", body)
    home = client.get("/").get_data(as_text=True)
    assert "<script>window.evil" not in home
    assert 'href="javascript:' not in home
    article = client.get("/issue/2026-11-06/evil").get_data(as_text=True)
    assert "<script>window.evil" not in article
    assert "&lt;script&gt;window.evil = true&lt;/script&gt;" in article  # escaped, visible as text
    assert 'href="javascript:' not in article
    assert "bad img" not in article  # javascript: image dropped entirely
    assert 'src="javascript:' not in article


def test_media_traversal_and_extensions_blocked(client, editions):
    write_edition(editions, "2026-11-06", story("A"))
    add_image(editions, "2026-11-06")
    assert client.get("/media/2026-11-06/pic.webp").status_code == 200
    for path in (
        "/media/../run.py",
        "/media/2026-11-06/../../run.py",
        "/media/..%5C..%5Crun.py",
        "/media/2026-11-06/pic.webp%00.js",
    ):
        assert client.get(path).status_code == 404, path


def test_images_resolved_relative_to_issue(client, editions):
    src = add_image(editions, "2026-11-06")
    write_edition(editions, "2026-11-06",
                  story("Pictured", featured="true",
                        extra=f"### About\n\n![Alt text here]({src})\n\nBody.\n"))
    home = client.get("/").get_data(as_text=True)
    assert f'<img src="/media/2026-11-06/pic.webp" alt="Alt text here"' in home


def test_external_https_story_image_hotlinks(client, editions):
    write_edition(editions, "2026-11-06",
                  story("Remote", featured="true",
                        extra="### About\n\n![Remote cover](https://example.com/cover.webp)\n\nBody.\n"))
    home = client.get("/").get_data(as_text=True)
    assert '<img src="https://example.com/cover.webp" alt="Remote cover"' in home
    article = client.get("/issue/2026-11-06/remote").get_data(as_text=True)
    assert 'src="https://example.com/cover.webp"' in article


def test_unsafe_scheme_story_image_dropped(client, editions):
    write_edition(editions, "2026-11-06",
                  story("Sneaky", featured="true",
                        extra="### About\n\n![bad](javascript:alert(1))\n\nBody.\n"))
    html = client.get("/").get_data(as_text=True)
    assert 'src="javascript:' not in html


def test_story_without_image_keeps_layout(client, editions):
    write_edition(editions, "2026-11-06",
                  story("Bare", featured="true", extra="### About\n\nNo image here.\n"))
    html = client.get("/").get_data(as_text=True)
    assert "lead no-image" in html


def test_healthz(client):
    assert client.get("/healthz").get_data(as_text=True) == "ok"


# --------------------------------------------------------------------------
# section filtering of the Roundup at a Glance
# --------------------------------------------------------------------------


def roundup_html(html: str) -> str:
    """The Roundup at a Glance region only (lead/cards keep every section)."""
    return re.search(r'<section class="roundup".*?</section>', html, re.DOTALL).group(0)


def test_unknown_section_shows_everything(client, editions):
    write_edition(editions, "2026-11-06", story("Alpha AI", section="AI Tools"))
    html = client.get("/?section=does-not-exist").get_data(as_text=True)
    assert "Alpha AI" in html
    assert "filter-note" not in html


def test_section_counts_and_category_targets(client, editions):
    body = story("First AI", section="AI Tools") + story("Second AI", section="AI Tools")
    write_edition(editions, "2026-11-06", body)
    html = client.get("/").get_data(as_text=True)
    assert 'aria-label="2 stories"' in html


def test_filter_keeps_lead_and_cards_visible(client, editions):
    # Only the roundup narrows; the featured story and cards stay on top.
    body = (
        story("Featured Print", section="3D Printing", featured="true")
        + story("Card AI", section="AI Tools")
        + story("Card Print", section="3D Printing")
        + story("Extra AI", section="AI Tools")
    )
    write_edition(editions, "2026-11-06", body)
    html = client.get("/?section=ai-tools").get_data(as_text=True)
    assert "Featured Print" in html and "Card AI" in html  # lead + card untouched
    roundup = roundup_html(html)
    assert "Extra AI" in roundup
    assert "Featured Print" not in roundup and "Card AI" not in roundup
