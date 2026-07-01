#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MACOS_DIR="$ROOT_DIR/apps/macos"
BUILD_DIR="$ROOT_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/Lyre.xcarchive"

VERSION=$(grep 'MARKETING_VERSION' "$MACOS_DIR/project.yml" | head -1 | sed 's/.*"\(.*\)"/\1/')
DMG_NAME="Lyre-${VERSION}.dmg"
DMG_PATH="$BUILD_DIR/$DMG_NAME"

echo "==> Building Lyre v${VERSION}"
echo ""

# --- Validate environment ---
if ! xcodebuild -version &>/dev/null; then
  echo "ERROR: xcodebuild not available. Run:"
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

# --- Clean build directory ---
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# --- Generate Xcode project ---
echo "==> Generating Xcode project..."
cd "$MACOS_DIR"
xcodegen generate

# --- Archive ---
echo "==> Archiving (Release, ad-hoc signed)..."
xcodebuild archive \
  -project Lyre.xcodeproj \
  -scheme Lyre \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=macOS" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="" \
  | tail -5

# --- Extract .app from archive ---
APP_PATH="$ARCHIVE_PATH/Products/Applications/Lyre.app"
if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: Archive failed — Lyre.app not found at $APP_PATH"
  exit 1
fi

echo "==> Ad-hoc signature check..."
codesign --verify --deep "$APP_PATH" && echo "    OK" || echo "    WARN: signature check failed (expected for ad-hoc)"

# --- Create DMG ---
echo "==> Creating DMG..."
DMG_TEMP="$BUILD_DIR/dmg-staging"
DMG_SPARSE="$BUILD_DIR/Lyre-sparse.sparseimage"

mkdir -p "$DMG_TEMP"
cp -R "$APP_PATH" "$DMG_TEMP/"
ln -s /Applications "$DMG_TEMP/Applications"

hdiutil create -size 200m -type SPARSE -fs HFS+ -volname "Lyre" "$DMG_SPARSE"
MOUNT_POINT=$(hdiutil attach "$DMG_SPARSE" -mountpoint /Volumes/Lyre -nobrowse | tail -1 | awk '{print $NF}')
cp -R "$DMG_TEMP/"* "$MOUNT_POINT/"
hdiutil detach "$MOUNT_POINT"
hdiutil convert "$DMG_SPARSE" -format UDZO -imagekey zlib-level=9 -o "$DMG_PATH"
rm -f "$DMG_SPARSE"
rm -rf "$DMG_TEMP"

echo ""
echo "==> Done! Output: $DMG_PATH"
ls -lh "$DMG_PATH"
echo ""
echo "NOTE: This DMG is ad-hoc signed (no Apple Developer certificate)."
echo "      Users must right-click → Open to bypass Gatekeeper on first launch."
