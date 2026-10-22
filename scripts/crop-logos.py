#!/usr/bin/env python3
"""Slice the 4x3 mood sheet into 12 circular icons used by the app.

Source sheet: 12 ape portraits tiled edge-to-edge, row-major, in the same
order as MOOD_LOGOS in src/utils/types.ts.

Usage: python3 scripts/crop-logos.py [path/to/sheet.png]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "logos"
DEFAULT_SHEET = Path.home() / "Desktop" / "Joker" / "17926631849ca5.png"

# Panel edges detected from the sheet (no gutters: backgrounds touch).
COL_EDGES = [0, 594, 1184, 1767, 2352]
ROW_EDGES = [0, 590, 1177, 1760]

# Row-major, matching MOOD_LOGOS ordering.
FILENAMES = [
    "monkey-happy-yellow.png",
    "monkey-neutral-blue.png",
    "monkey-angry-red.png",
    "monkey-shocked-orange.png",
    "monkey-silly-green.png",
    "monkey-cool-purple.png",
    "monkey-love-pink.png",
    "monkey-tired-lavender.png",
    "monkey-thinking-cyan.png",
    "monkey-excited-gold.png",
    "monkey-calm-mint.png",
    "monkey-smile-coral.png",
]

SIZE = 512
SUPERSAMPLE = 4
# Panels tile edge-to-edge, so trim a few pixels to drop neighbor bleed.
INSET = 6


def circular(im: Image.Image) -> Image.Image:
    im = im.crop((INSET, INSET, im.width - INSET, im.height - INSET))
    side = min(im.size)
    x, y = (im.width - side) // 2, (im.height - side) // 2
    square = im.crop((x, y, x + side, y + side)).convert("RGBA")

    hi = side * SUPERSAMPLE
    big = square.resize((hi, hi), Image.LANCZOS)
    mask = Image.new("L", (hi, hi), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, hi - 1, hi - 1], fill=255)
    big.putalpha(mask)

    return big.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> int:
    sheet_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SHEET
    if not sheet_path.is_file():
        print(f"sheet not found: {sheet_path}", file=sys.stderr)
        return 1

    sheet = Image.open(sheet_path).convert("RGB")
    if sheet.size != (COL_EDGES[-1], ROW_EDGES[-1]):
        print(f"unexpected sheet size {sheet.size}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = 0
    for r in range(len(ROW_EDGES) - 1):
        for c in range(len(COL_EDGES) - 1):
            cell = sheet.crop(
                (
                    COL_EDGES[c],
                    ROW_EDGES[r],
                    COL_EDGES[c + 1],
                    ROW_EDGES[r + 1],
                )
            )
            out = OUT_DIR / FILENAMES[index]
            circular(cell).save(out, optimize=True)
            print(f"{out.relative_to(ROOT)}")
            index += 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
