#!/usr/bin/env python3
"""
Resize logo image for different use cases in the Lyre app.

Generates:
- Sidebar logo (24px height)
- Login page logo (80px height)
- Favicons (16x16, 32x32, apple-touch-icon 180x180, .ico)
"""

from PIL import Image
from pathlib import Path


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


def main():
    root = Path(__file__).parent.parent
    public = root / "public"
    public.mkdir(exist_ok=True)

    # Load source image
    logo = Image.open(root / "logo.png").convert("RGBA")
    print(f"Source logo: {logo.size}")

    # Generate sidebar logo (24px height)
    sidebar = resize_maintaining_aspect(logo, 24)
    sidebar.save(public / "logo-24.png")
    print(f"Sidebar logo: {sidebar.size}")

    # Generate login page logo (80px height)
    login = resize_maintaining_aspect(logo, 80)
    login.save(public / "logo-80.png")
    print(f"Login logo: {login.size}")

    # Generate favicons
    favicon_16 = resize_to_square(logo, 16)
    favicon_32 = resize_to_square(logo, 32)
    apple_touch = resize_to_square(logo, 180)

    favicon_16.save(public / "favicon-16.png")
    favicon_32.save(public / "favicon-32.png")
    apple_touch.save(public / "apple-touch-icon.png")

    # Generate .ico file
    favicon_32_for_ico = resize_to_square(logo, 32)
    favicon_32_for_ico.save(public / "favicon.ico", format="ICO")

    # Also copy to src/app/ for Next.js file-based metadata
    app_dir = root / "src" / "app"
    favicon_32_for_ico.save(app_dir / "favicon.ico", format="ICO")
    resize_to_square(logo, 32).save(app_dir / "icon.png")
    resize_to_square(logo, 180).save(app_dir / "apple-icon.png")

    print("Favicons generated: 16x16, 32x32, 180x180, .ico")
    print("Next.js file-based icons: favicon.ico, icon.png, apple-icon.png")
    print("Done!")


if __name__ == "__main__":
    main()
