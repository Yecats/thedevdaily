"""Command-line entry point: ``python run.py`` or ``python -m devdaily``."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

DEFAULT_PORT = 8787


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="the-dev-daily",
        description="Serve The Dev Daily newspaper from a folder of Markdown editions.",
    )
    parser.add_argument(
        "--editions",
        default=None,
        help="Editions content folder (default: ./editions, or DEVDAILY_EDITIONS)",
    )
    parser.add_argument(
        "--host",
        default=None,
        help="Bind address (default: 127.0.0.1, or DEVDAILY_HOST; use 0.0.0.0 for the LAN)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help=f"Port (default: {DEFAULT_PORT}, or DEVDAILY_PORT)",
    )
    parser.add_argument(
        "--images-dirname",
        default=None,
        help="Subfolder of the editions folder holding images (default: images)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = create_parser().parse_args(argv)

    editions = Path(
        args.editions
        or os.environ.get("DEVDAILY_EDITIONS")
        or "editions"
    ).expanduser()
    host = args.host or os.environ.get("DEVDAILY_HOST", "127.0.0.1")
    port = args.port if args.port is not None else int(
        os.environ.get("DEVDAILY_PORT") or DEFAULT_PORT
    )
    images_dirname = args.images_dirname or os.environ.get("DEVDAILY_IMAGES_DIRNAME", "images")

    # Keep the local import so --help works without the server deps loaded twice.
    from . import create_app

    app = create_app(editions, images_dirname=images_dirname)

    display_host = "localhost" if host in ("127.0.0.1", "0.0.0.0", "::") else host
    print(f"The Dev Daily")
    print(f"  Reading editions from: {editions.resolve()}")
    print(f"  Serving at:            http://{display_host}:{port}/")
    if host == "127.0.0.1":
        print("  (local only - use --host 0.0.0.0 to share on your home LAN)")
    sys.stdout.flush()

    from waitress import serve

    serve(app, host=host, port=port, threads=8, ident="TheDevDaily")
    return 0
