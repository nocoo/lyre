#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MACOS_DIR="$ROOT_DIR/apps/macos"
BUILD_DIR="$ROOT_DIR/build"
ARCHIVE_PATH="$BUILD_DIR/Lyre.xcarchive"
LYRE_SIGNING_IDENTITY="${LYRE_CODE_SIGN_IDENTITY:-}"
LYRE_SIGNING_TEAM="${LYRE_DEVELOPMENT_TEAM:-93WWLTN9XU}"

# TCC matches the signed app identity. Ad-hoc signatures change on every
# build and cannot provide stable microphone authorization across updates.
# Validate before touching the existing build directory.
if [[ -z "$LYRE_SIGNING_IDENTITY" ]]; then
  if [[ "${LYRE_ALLOW_ADHOC:-0}" == "1" ]]; then
    LYRE_SIGNING_IDENTITY="-"
    LYRE_SIGNING_TEAM=""
  else
    echo "ERROR: Set LYRE_CODE_SIGN_IDENTITY to your Developer ID Application certificate."
    echo "Local-only builds can explicitly use LYRE_ALLOW_ADHOC=1; microphone grants may reset after updates."
    exit 1
  fi
elif [[ "$LYRE_SIGNING_IDENTITY" != "Developer ID Application: "* ]]; then
  echo "ERROR: LYRE_CODE_SIGN_IDENTITY must name a Developer ID Application certificate."
  exit 1
elif ! security find-identity -v -p codesigning | grep -F -- "\"$LYRE_SIGNING_IDENTITY\"" > /dev/null; then
  echo "ERROR: The requested Developer ID Application identity is not available in the keychain."
  exit 1
fi

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
echo "==> Archiving (Release, signing: $LYRE_SIGNING_IDENTITY)..."
xcodebuild archive \
  -project Lyre.xcodeproj \
  -scheme Lyre \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination "generic/platform=macOS" \
  CODE_SIGN_IDENTITY="$LYRE_SIGNING_IDENTITY" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="$LYRE_SIGNING_TEAM" \
  | tail -5

# --- Extract .app from archive ---
APP_PATH="$ARCHIVE_PATH/Products/Applications/Lyre.app"
if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: Archive failed — Lyre.app not found at $APP_PATH"
  exit 1
fi

echo "==> Verifying signature..."
codesign --verify --deep --strict "$APP_PATH"

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
if [[ "$LYRE_SIGNING_IDENTITY" == "-" ]]; then
  echo "NOTE: Local ad-hoc build. macOS permissions may need granting again after replacing this app."
else
  echo "NOTE: Developer ID signed. Notarize the app/DMG separately before distributing it."
fi
