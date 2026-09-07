# Lyre logo assets

The original animal is retained byte-for-byte. This Refined pass adds the lyrebird fan background, fine grain, and shallow contact shadows. No image model was called. The transparent foreground keeps its original pose, colors, anatomy, and native canvas.

## Asset roles

| Surface | Asset | Treatment |
| --- | --- | --- |
| README header | `assets/brand/icon-rounded.png` | Selected presentation at 128 px |
| Expanded / collapsed sidebar | `apps/web/public/logo-24.png` | Transparent original; both sidebar states |
| Loading screen | `apps/web/public/logo-80.png` | Transparent original displayed as a small header mark |
| Browser icons | `apps/web/public/favicon.png; favicon.ico` | Transparent 32 px PNG and decoded 16/32 px ICO |
| Apple touch / Open Graph | `apps/web/public/apple-touch-icon.png; opengraph-image.png` | Square 180 px touch icon; rounded presentation on the existing 1200 × 630 zinc canvas |
| macOS Dock / About / bundle | `apps/macos/Lyre/Assets.xcassets/AppIcon.appiconset/` | Rounded tile occupies 824 px of a transparent 1024 px master; 100 px inset on each side |
| macOS menu bar | `TrayIcon.imageset/; TrayIconRecording.imageset/` | Existing monochrome template and recording-state mark retained without modification |

Root `logo.png` remains the canonical 2048 × 2048 transparent master. `icon.png` and `icon-rounded.png` in this directory are separate square and rounded presentations at the same native dimensions. Small UI marks use the foreground with no external glow, added background, or circular crop. Localized and package READMEs were checked for additional logo headers.

## Reproduce and verify

```sh
uv run --with pillow python scripts/resize-logos.py
```

The exact source, sampled palette, independent background layers, every export size, and frozen finishing recipe are archived in `nocoo/hexly.ai` under `artwork/logo-family/lyre/2026-09-07-03/finishing/01`. [source.json](source.json) records provenance and all master SHA-256 values. The separate UI theme palette is unchanged.

- [Individual logo review](https://hexly.ai/logos/lyre)
- [Local static review](https://index.dev.hexly.ai/artwork/logo-family/lyre/2026-09-07-03/review.html)
- [Shared logo usage SOP](https://github.com/nocoo/hexly.ai/blob/main/docs/07-logo-usage-sop.md)

Before/after deliberately shares the same original foreground. Verify small marks at their actual displayed sizes on both themes, decode every ICO resolution, and keep any platform-specific mask separate from the transparent source.
