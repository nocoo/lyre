#!/bin/bash
# Diagnostic tool for the "M4A plays locally but silent in <audio>" bug.
# Usage: bash scripts/diagnose-m4a.sh '<play-url>'
# Or:    bash scripts/diagnose-m4a.sh path/to/local.m4a
#
# Prints every relevant fact in one pass so we don't do another round-trip.

set -uo pipefail

INPUT="${1:-}"
if [ -z "$INPUT" ]; then
  echo "usage: $0 <play-url | local.m4a>" >&2
  exit 2
fi

TMP="/tmp/m4a-diag-$$"
mkdir -p "$TMP"
trap "rm -rf $TMP" EXIT

# ── Step 1: fetch (or symlink) the file ──
FILE="$TMP/audio.m4a"
if [[ "$INPUT" =~ ^https?:// ]]; then
  echo "══════ HTTP: GET ${INPUT:0:120}... ══════"
  curl -s -D "$TMP/headers.txt" -o "$FILE" -w "http_code=%{http_code}\nsize=%{size_download}\ntime_total=%{time_total}s\n" "$INPUT"
  echo ""
  echo "── Response headers ──"
  grep -iE "^(HTTP|Content-|Accept-Ranges|x-oss|Last-Modified|ETag)" "$TMP/headers.txt"
  echo ""
  echo "── Range: bytes=0-1023 (browser metadata probe simulation) ──"
  curl -s -D "$TMP/range-headers.txt" -o "$TMP/range-body.bin" -H "Range: bytes=0-1023" "$INPUT"
  grep -iE "^(HTTP|Content-Range|Content-Length|Content-Type)" "$TMP/range-headers.txt"
  echo ""
else
  cp "$INPUT" "$FILE"
  echo "══════ Local file: $INPUT ══════"
fi

BYTES=$(wc -c < "$FILE" | tr -d ' ')
echo "══════ File size: $BYTES bytes ══════"
echo ""

# ── Step 2: top-level atom scan (raw byte walk, no external tool) ──
echo "══════ Top-level MP4 atom map ══════"
python3 - "$FILE" <<'PY'
import struct, sys
path = sys.argv[1]
with open(path, "rb") as f:
    data = f.read()

offset = 0
while offset + 8 <= len(data):
    size = struct.unpack(">I", data[offset:offset+4])[0]
    atom = data[offset+4:offset+8].decode("latin-1", errors="replace")
    if size == 1:
        # 64-bit size in next 8 bytes
        size = struct.unpack(">Q", data[offset+8:offset+16])[0]
        header = 16
    elif size == 0:
        # extends to end of file
        size = len(data) - offset
        header = 8
    else:
        header = 8

    # Human-readable atom name
    print(f"  @0x{offset:08x} ({offset:>10}) size={size:>10}  '{atom}'")

    if size < header:
        print(f"  !!! atom size {size} smaller than header {header} — aborting walk")
        break
    offset += size
PY
echo ""

# ── Step 3: ffprobe deep-dive ──
echo "══════ ffprobe stream info ══════"
ffprobe -v error -show_streams -show_format -print_format flat "$FILE" 2>&1 | grep -E "codec_|sample_rate|channels|channel_layout|bit_rate|duration|profile|nb_frames|time_base|tags\.encoder|format_name"
echo ""

# ── Step 4: raw first bytes ──
echo "══════ First 64 bytes hex ══════"
xxd "$FILE" | head -4
echo ""

# ── Step 5: quick faststart verdict ──
echo "══════ VERDICT ══════"
python3 - "$FILE" <<'PY'
import struct, sys
path = sys.argv[1]
with open(path, "rb") as f:
    data = f.read()

# Find moov offset
o = 0
moov_off = None
mdat_off = None
ftyp_end = 0
while o + 8 <= len(data):
    size = struct.unpack(">I", data[o:o+4])[0]
    atom = data[o+4:o+8].decode("latin-1", errors="replace")
    if atom == "ftyp":
        ftyp_end = o + size
    elif atom == "moov" and moov_off is None:
        moov_off = o
    elif atom == "mdat" and mdat_off is None:
        mdat_off = o
    if size == 0: size = len(data) - o
    o += size

print(f"  ftyp ends at: {ftyp_end}")
print(f"  moov at:      {moov_off}")
print(f"  mdat at:      {mdat_off}")
if moov_off is not None and mdat_off is not None:
    if moov_off < mdat_off:
        print("  ✅ faststart OK — moov before mdat")
    else:
        print("  ❌ faststart NOT applied — moov AFTER mdat (browsers may struggle)")
PY
