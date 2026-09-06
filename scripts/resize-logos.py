#!/usr/bin/env python3
"""Generate Lyre application assets from the adopted family masters.

Run with: uv run --with pillow python scripts/resize-logos.py
The transparent source, square tile and rounded tile share one composition.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "logo.png"
BRAND = ROOT / "assets" / "brand"


def save_png(image: Image.Image, relative: str, size: int) -> None:
    destination = ROOT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), Image.Resampling.LANCZOS).save(destination, "PNG")
    print(f"  {relative}: {size}x{size}")


def main() -> None:
    foreground = Image.open(SOURCE).convert("RGBA")
    square = Image.open(BRAND / "icon.png").convert("RGBA")
    rounded = Image.open(BRAND / "icon-rounded.png").convert("RGBA")
    if foreground.size != (2048, 2048) or square.size != foreground.size or rounded.size != foreground.size:
        raise ValueError("All approved brand masters must share their 2048-square framing")
    if square.getchannel("A").getextrema() != (255, 255) or rounded.getpixel((0, 0))[3] != 0:
        raise ValueError("Square and rounded master roles are inconsistent")
    save_png(rounded, "apps/web/public/logo-24.png", 24)
    save_png(rounded, "apps/web/public/logo-80.png", 80)
    save_png(square, "apps/web/public/icon.png", 32)
    save_png(square, "apps/web/public/apple-icon.png", 180)

    ico_path = ROOT / "apps/web/public/favicon.ico"
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    ico_sizes = [(16, 16), (32, 32), (48, 48)]
    square.save(ico_path, format="ICO", sizes=ico_sizes)
    with Image.open(ico_path) as icon:
        if icon.ico.sizes() != set(ico_sizes):
            raise ValueError("Favicon is missing an expected embedded resolution")
    print(f"  {ico_path.relative_to(ROOT)}: 16+32+48 ICO, verified")

    og = Image.new("RGB", (1200, 630), (24, 24, 27))
    logo_size = round(630 * 0.4)
    mark = rounded.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    og.paste(mark, ((1200 - logo_size) // 2, (630 - logo_size) // 2), mark)
    og_path = ROOT / "apps/web/public/opengraph-image.png"
    og_path.parent.mkdir(parents=True, exist_ok=True)
    og.save(og_path, "PNG")
    print(f"  {og_path.relative_to(ROOT)}: 1200x630")

    # macOS PNG icons supply their own rounded silhouette inside the platform canvas.
    macos = Image.new("RGBA", (1024, 1024))
    tile = rounded.resize((824, 824), Image.Resampling.LANCZOS)
    macos.alpha_composite(tile, (100, 100))
    macos.save(BRAND / "icon-macos.png", "PNG")
    for size in (16, 32, 64, 128, 256, 512, 1024):
        save_png(macos, f"apps/macos/Lyre/Assets.xcassets/AppIcon.appiconset/icon_{size}.png", size)

    # Preserve the established monochrome bird/recording-dot menu-bar identity.
    luminance = ImageOps.grayscale(foreground)
    dark_planes = luminance.point(lambda value: max(0, min(255, round((210 - value) * 255 / 80))))
    silhouette = Image.new("RGBA", foreground.size)
    silhouette.putalpha(ImageChops.multiply(dark_planes, foreground.getchannel("A")))
    for scale, suffix in ((1, ""), (2, "@2x")):
        size = 22 * scale
        inset = 2 * scale
        tray = Image.new("RGBA", (size, size))
        mark = silhouette.resize((18 * scale, 18 * scale), Image.Resampling.LANCZOS)
        tray.alpha_composite(mark, (inset, inset))
        tray.save(ROOT / f"apps/macos/Lyre/Assets.xcassets/TrayIcon.imageset/tray-icon{suffix}.png", "PNG")
        recording = tray.resize((size * 4, size * 4), Image.Resampling.LANCZOS)
        draw = ImageDraw.Draw(recording)
        draw.ellipse((13 * scale * 4, 1 * scale * 4, 21 * scale * 4, 9 * scale * 4), fill=(255, 59, 48, 255))
        recording.resize((size, size), Image.Resampling.LANCZOS).save(
            ROOT / f"apps/macos/Lyre/Assets.xcassets/TrayIconRecording.imageset/tray-icon-recording{suffix}.png", "PNG"
        )
    print("  macOS: 7 iconset sizes and 1x/2x idle/recording tray marks")


if __name__ == "__main__":
    main()
