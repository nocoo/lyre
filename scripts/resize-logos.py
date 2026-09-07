#!/usr/bin/env python3
"""Generate web and macOS assets from the retained foreground and presentation masters.

Run: uv run --with pillow python scripts/resize-logos.py
Menu bar template and recording-state images remain independent, unchanged assets.
"""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "apps/web/public"
CATALOG = ROOT / "apps/macos/Lyre/Assets.xcassets/AppIcon.appiconset"


def main():
    foreground = Image.open(ROOT / "logo.png").convert("RGBA")
    square = Image.open(ROOT / "assets/brand/icon.png").convert("RGBA")
    rounded = Image.open(ROOT / "assets/brand/icon-rounded.png").convert("RGBA")
    for size, name in [(24, "logo-24.png"), (80, "logo-80.png"), (32, "favicon.png")]:
        foreground.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / name)
    foreground.save(PUBLIC / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])
    square.resize((180, 180), Image.Resampling.LANCZOS).convert("RGB").save(
        PUBLIC / "apple-touch-icon.png"
    )
    social = Image.new("RGB", (1200, 630), (24, 24, 27))
    mark = rounded.resize((252, 252), Image.Resampling.LANCZOS)
    social.paste(mark, ((1200 - 252) // 2, (630 - 252) // 2), mark)
    social.save(PUBLIC / "opengraph-image.png")

    # macOS does not apply the iOS icon mask: keep the rounded tile inside its native inset.
    native = Image.new("RGBA", (1024, 1024))
    native.alpha_composite(rounded.resize((824, 824), Image.Resampling.LANCZOS), (100, 100))
    entries = json.loads((CATALOG / "Contents.json").read_text())["images"]
    outputs = {entry["filename"]: int(entry["size"].split("x")[0]) * int(entry["scale"][0]) for entry in entries}
    for filename, size in outputs.items():
        native.resize((size, size), Image.Resampling.LANCZOS).save(CATALOG / filename)
    print("Generated transparent web marks, touch/social presentations, and inset macOS icons.")


if __name__ == "__main__":
    main()
