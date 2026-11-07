"""Edition library: scans the content folder and caches parsed issues.

The folder is rescanned on every request; unchanged files (same mtime and
size) are served from the parse cache, so a new ``YYYY-MM-DD.md`` file
appears on browser refresh without a server restart or rebuild.
"""

from __future__ import annotations

import threading
from datetime import date
from pathlib import Path

from .parsing import EDITION_FILENAME_RE, BrokenIssue, Issue, parse_edition


class EditionLibrary:
    def __init__(self, root: Path, images_dirname: str = "images"):
        self.root = Path(root)
        self.images_root = self.root / images_dirname
        self._cache: dict[str, tuple[tuple[int, int], Issue | BrokenIssue]] = {}
        self._lock = threading.Lock()

    def scan(self) -> list[Issue | BrokenIssue]:
        """Valid issues newest-first, then broken files newest-first."""
        if not self.root.is_dir():
            return []

        entries: list[tuple[Path, tuple[int, int]]] = []
        for path in sorted(self.root.iterdir(), key=lambda p: p.name, reverse=True):
            if not path.is_file() or not EDITION_FILENAME_RE.match(path.name):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            entries.append((path, (stat.st_mtime_ns, stat.st_size)))

        parsed: list[Issue | BrokenIssue] = []
        with self._lock:
            for path, signature in entries:
                cached = self._cache.get(path.name)
                if cached is not None and cached[0] == signature:
                    parsed.append(cached[1])
                    continue
                item = parse_edition(path)
                self._cache[path.name] = (signature, item)
                parsed.append(item)

        valid = sorted(
            (item for item in parsed if isinstance(item, Issue)),
            key=lambda issue: issue.date,
            reverse=True,
        )
        broken = sorted(
            (item for item in parsed if isinstance(item, BrokenIssue)),
            key=lambda item: item.filename,
            reverse=True,
        )
        return valid + broken

    def issues(self) -> list[Issue]:
        return [item for item in self.scan() if isinstance(item, Issue)]

    def broken(self) -> list[BrokenIssue]:
        return [item for item in self.scan() if isinstance(item, BrokenIssue)]

    def newest(self) -> Issue | None:
        for item in self.scan():
            if isinstance(item, Issue):
                return item
        return None

    def get(self, key: date) -> Issue | BrokenIssue | None:
        """The issue for a calendar date, its broken file entry, or None."""
        filename = key.isoformat() + ".md"
        broken: BrokenIssue | None = None
        for item in self.scan():
            if isinstance(item, Issue) and item.date == key:
                return item
            if isinstance(item, BrokenIssue) and item.filename == filename:
                broken = item
        return broken

    def edition_number(self, issue_date: date) -> int:
        """Display-only number: the oldest published issue is #1."""
        dates = sorted(issue.date for issue in self.issues())
        try:
            return dates.index(issue_date) + 1
        except ValueError:
            return 0
