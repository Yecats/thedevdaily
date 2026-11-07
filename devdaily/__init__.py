"""The Dev Daily — a local-network newspaper for AI-curated dev news."""

from __future__ import annotations

from pathlib import Path

from flask import Flask

from .library import EditionLibrary
from .rendering import format_long, format_medium, format_news_date
from .routes import bp


def create_app(editions_dir: str | Path, images_dirname: str = "images") -> Flask:
    """Application factory. ``editions_dir`` is the content source of truth."""
    root = Path(editions_dir).expanduser().resolve()
    app = Flask(__name__)
    app.config["EDITIONS_ROOT"] = root
    app.extensions["devdaily_library"] = EditionLibrary(root, images_dirname)

    app.register_blueprint(bp)
    app.add_template_filter(format_long, "longdate")
    app.add_template_filter(format_medium, "mediumdate")
    app.add_template_filter(format_news_date, "newsdate")
    return app
