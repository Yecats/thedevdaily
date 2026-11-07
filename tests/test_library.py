"""Library scan ordering, cache freshness, and edition numbering."""

from devdaily.library import EditionLibrary
from devdaily.parsing import parse_edition

from conftest import story, write_edition


def test_newest_first_broken_last(editions):
    write_edition(editions, "2026-11-04", story("Older"))
    write_edition(editions, "2026-11-06", story("Newer"))
    (editions / "2026-11-05.md").write_text("not an edition", encoding="utf-8")
    lib = EditionLibrary(editions)
    items = lib.scan()
    assert [i.date.isoformat() for i in items if hasattr(i, "date")] == [
        "2026-11-06", "2026-11-04",
    ]
    assert items[-1].filename == "2026-11-05.md"


def test_new_file_appears_without_restart(editions):
    lib = EditionLibrary(editions)
    write_edition(editions, "2026-11-06", story("First"))
    assert [i.date.isoformat() for i in lib.issues()] == ["2026-11-06"]
    write_edition(editions, "2026-11-07", story("Second"))
    assert [i.date.isoformat() for i in lib.issues()] == ["2026-11-07", "2026-11-06"]


def test_unchanged_files_not_reparsed(editions, monkeypatch):
    write_edition(editions, "2026-11-06", story("First"))
    lib = EditionLibrary(editions)
    lib.scan()  # prime cache

    calls = []
    original = parse_edition

    def counting(path):
        calls.append(path.name)
        return original(path)

    monkeypatch.setattr("devdaily.library.parse_edition", counting)
    lib.scan()
    lib.scan()
    assert calls == []  # everything served from the mtime/size cache


def test_changed_file_is_reparsed(editions, monkeypatch):
    path = write_edition(editions, "2026-11-06", story("Before"))
    lib = EditionLibrary(editions)
    lib.scan()
    path.write_text(
        path.read_text(encoding="utf-8").replace("Before", "After"), encoding="utf-8"
    )
    items = lib.scan()
    assert items[0].stories[0].title == "After"


def test_edition_numbers_oldest_is_one(editions):
    write_edition(editions, "2026-11-05", story("A"))
    write_edition(editions, "2026-11-06", story("B"))
    write_edition(editions, "2026-11-07", story("C"))
    lib = EditionLibrary(editions)
    assert lib.edition_number(lib.issues()[0].date) == 3  # newest
    assert lib.edition_number(lib.issues()[-1].date) == 1  # oldest
