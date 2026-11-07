"""Rendering safety: escaping, URL schemes, media resolution."""

from pathlib import Path

from devdaily.rendering import (
    format_long,
    format_medium,
    format_news_date,
    render_block,
    render_inline,
    resolve_media,
    sanitize_fragment,
)

from conftest import PNG_1PX


# --------------------------------------------------------------------------
# dates: calendar dates must never shift by timezone or locale
# --------------------------------------------------------------------------


from datetime import date

def test_date_formatting_is_deterministic():
    assert format_long(date(2026, 11, 6)) == "Fri, Nov 6, 2026"
    assert format_medium(date(2026, 11, 6)) == "Nov 6, 2026"
    assert format_medium(date(2026, 1, 1)) == "Jan 1, 2026"
    assert format_news_date("Unknown") == "Unknown"
    assert format_news_date("2026-11-03") == "Nov 3, 2026"


# --------------------------------------------------------------------------
# markdown escaping
# --------------------------------------------------------------------------


def test_raw_html_is_escaped():
    html = render_block("<script>alert(1)</script>\n\n<b>hi</b>")
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "<b>hi</b>" not in html


def test_inline_html_is_escaped():
    html = render_inline('hello <img src=x onerror=alert(1)> world')
    assert "<img" not in html
    assert "&lt;img" in html


# --------------------------------------------------------------------------
# link schemes
# --------------------------------------------------------------------------


def test_javascript_link_is_unwrapped():
    html = sanitize_fragment('<a href="javascript:alert(1)">click me</a>', Path("."), Path("images"))
    assert "<a" not in html
    assert "click me" in html


def test_data_link_is_unwrapped():
    html = sanitize_fragment('<a href="data:text/html,hi">x</a>', Path("."), Path("images"))
    assert "<a" not in html


def test_https_link_kept_with_noopener():
    html = sanitize_fragment('<a href="https://example.com/x">x</a>', Path("."), Path("images"))
    assert 'href="https://example.com/x"' in html
    assert 'rel="noopener noreferrer"' in html
    assert 'target="_blank"' in html


def test_relative_link_kept():
    html = sanitize_fragment('<a href="./other.md">x</a>', Path("."), Path("images"))
    assert 'href="./other.md"' in html


# --------------------------------------------------------------------------
# media resolution
# --------------------------------------------------------------------------


def test_resolve_media_inside_tree(tmp_path):
    editions = tmp_path / "editions"
    img = editions / "images" / "2026-11-06" / "pic.webp"
    img.parent.mkdir(parents=True)
    img.write_bytes(PNG_1PX)
    url = resolve_media("./images/2026-11-06/pic.webp", editions, editions / "images")
    assert url == "/media/2026-11-06/pic.webp"


def test_resolve_media_rejects_escape(tmp_path):
    editions = tmp_path / "editions"
    editions.mkdir()
    outside = tmp_path / "outside.webp"
    outside.write_bytes(PNG_1PX)
    assert resolve_media("../outside.webp", editions, editions / "images") is None


def test_resolve_media_rejects_missing_file(tmp_path):
    editions = tmp_path / "editions"
    editions.mkdir()
    assert resolve_media("./images/2026-11-06/nope.webp", editions, editions / "images") is None


def test_resolve_media_rejects_non_image(tmp_path):
    editions = tmp_path / "editions"
    secret = editions / "images" / "secret.md"
    secret.parent.mkdir(parents=True)
    secret.write_text("hi", encoding="utf-8")
    assert resolve_media("./images/secret.md", editions, editions / "images") is None


def test_resolve_media_rejects_symlink_escape(tmp_path):
    editions = tmp_path / "editions"
    images = editions / "images"
    images.mkdir(parents=True)
    outside = tmp_path / "outside.webp"
    outside.write_bytes(PNG_1PX)
    link = images / "evil.webp"
    try:
        link.symlink_to(outside)
    except OSError:
        return  # symlink unsupported on this platform/filesystem
    assert resolve_media("./images/evil.webp", editions, images) is None


# --------------------------------------------------------------------------
# image sanitization
# --------------------------------------------------------------------------


def test_missing_image_is_dropped(tmp_path):
    editions = tmp_path / "editions"
    editions.mkdir()
    html = sanitize_fragment(
        '<img src="./images/2026-11-06/missing.webp" alt="gone">',
        editions, editions / "images",
    )
    assert "<img" not in html


def test_external_https_image_kept(tmp_path):
    editions = tmp_path / "editions"
    editions.mkdir()
    html = sanitize_fragment(
        '<img src="https://example.com/pic.webp" alt="remote">',
        editions, editions / "images",
    )
    assert 'src="https://example.com/pic.webp"' in html
    assert 'alt="remote"' in html


def test_data_image_dropped(tmp_path):
    editions = tmp_path / "editions"
    editions.mkdir()
    html = sanitize_fragment(
        '<img src="data:image/png;base64,AAAA" alt="inline">',
        editions, editions / "images",
    )
    assert "<img" not in html
