#!/usr/bin/env python3
"""
Resize logo image for different use cases in the Lyre app.

Single-source pattern: ONE master logo.png generates ALL derived assets.

Outputs:
  public/          — Only for <img src="..."> references in components
    logo-24.png      Sidebar logo
    logo-80.png      Login page logo

  src/app/         — Next.js file-based metadata convention (auto-discovered)
    icon.png         Browser tab icon (32x32)
    apple-icon.png   Apple touch icon (180x180)
    favicon.ico      Multi-size favicon (16+32)
    opengraph-image.png  OG image (1200x630)
"""

from PIL import Image
from pathlib import Path

# Brand background color for OG image canvas
BRAND_BG_COLOR = (24, 24, 27)  # zinc-900


def resize_maintaining_aspect(img: Image.Image, height: int) -> Image.Image:
    """Resize image to specified height while maintaining aspect ratio."""
    aspect_ratio = img.width / img.height
    new_width = int(height * aspect_ratio)
    return img.resize((new_width, height), Image.Resampling.LANCZOS)


def resize_to_square(img: Image.Image, size: int) -> Image.Image:
    """Resize image to square, centering on transparent background."""
    aspect_ratio = img.width / img.height
    if aspect_ratio > 1:
        new_width = size
        new_height = int(size / aspect_ratio)
    else:
        new_height = size
        new_width = int(size * aspect_ratio)

    resized = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

    # Create square canvas with transparent background
    square = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Paste centered
    x = (size - new_width) // 2
    y = (size - new_height) // 2
    square.paste(resized, (x, y), resized if resized.mode == "RGBA" else None)

    return square


def generate_og_image(img: Image.Image) -> Image.Image:
    """Generate 1200x630 OG image with brand background and centered logo."""
    width, height = 1200, 630

    # RGB canvas (social platforms don't support alpha)
    canvas = Image.new("RGB", (width, height), BRAND_BG_COLOR)

    # Resize logo to ~40% of canvas height
    logo_height = int(height * 0.4)
    logo = resize_maintaining_aspect(img, logo_height)

    # Center the logo
    x = (width - logo.width) // 2
    y = (height - logo.height) // 2

    # Paste with alpha mask if RGBA
    if logo.mode == "RGBA":
        canvas.paste(logo, (x, y), logo)
    else:
        canvas.paste(logo, (x, y))

    return canvas


def main():
    root = Path(__file__).parent.parent
    public = root / "apps" / "web" / "public"
    app_dir = root / "apps" / "web" / "src" / "app"
    public.mkdir(exist_ok=True)

    # Load source image
    logo = Image.open(root / "logo.png").convert("RGBA")
    print(f"Source logo: {logo.size}")

    # --- public/: only <img src> assets ---

    sidebar = resize_maintaining_aspect(logo, 24)
    sidebar.save(public / "logo-24.png")
    print(f"  public/logo-24.png: {sidebar.size}")

    login = resize_maintaining_aspect(logo, 80)
    login.save(public / "logo-80.png")
    print(f"  public/logo-80.png: {login.size}")

    # --- src/app/: Next.js file-based metadata (auto-discovered) ---

    icon_32 = resize_to_square(logo, 32)
    icon_32.save(app_dir / "icon.png")
    print(f"  src/app/icon.png: 32x32")

    apple_icon = resize_to_square(logo, 180)
    apple_icon.save(app_dir / "apple-icon.png")
    print(f"  src/app/apple-icon.png: 180x180")

    # .ico with 16+32 embedded sizes
    ico_16 = resize_to_square(logo, 16)
    ico_32 = resize_to_square(logo, 32)
    ico_16.save(
        app_dir / "favicon.ico",
        format="ICO",
        append_images=[ico_32],
        sizes=[(16, 16), (32, 32)],
    )
    print(f"  src/app/favicon.ico: 16x16 + 32x32")

    # OG image (1200x630, RGB)
    og = generate_og_image(logo)
    og.save(app_dir / "opengraph-image.png")
    print(f"  src/app/opengraph-image.png: {og.size}")

    print("Done!")


if __name__ == "__main__":
    main()
