#!/usr/bin/env python3
"""Build the static brand art from the 12 mood portraits.

The hero is the ape with a deadpan caption; the sheet is all twelve moods at
once, which is the funniest the brand gets without a model in the loop. Both
are flat PNGs on the paper background, so they read at any size and cost
nothing to serve.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
LOGOS = ROOT / "assets" / "logos"
OUT = ROOT / "assets" / "brand"

PAPER = (252, 250, 248)
INK = (30, 28, 24)
MUTED = (111, 104, 98)

MENLO = "/System/Library/Fonts/Menlo.ttc"

MOODS = [
    ("monkey-neutral-blue.png", "neutral"),
    ("monkey-calm-mint.png", "calm"),
    ("monkey-thinking-cyan.png", "thinking"),
    ("monkey-happy-yellow.png", "happy"),
    ("monkey-excited-gold.png", "excited"),
    ("monkey-silly-green.png", "silly"),
    ("monkey-love-pink.png", "love"),
    ("monkey-smile-coral.png", "smile"),
    ("monkey-cool-purple.png", "cool"),
    ("monkey-tired-lavender.png", "tired"),
    ("monkey-shocked-orange.png", "shocked"),
    ("monkey-angry-red.png", "angry"),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(MENLO, size, index=1 if bold else 0)


def portrait(name: str, size: int) -> Image.Image:
    with Image.open(LOGOS / name) as source:
        return source.convert("RGBA").resize((size, size), Image.LANCZOS)


def centered(canvas: Image.Image, draw: ImageDraw.ImageDraw, text: str, y: int, typeface, color) -> None:
    box = draw.textbbox((0, 0), text, font=typeface)
    draw.text(((canvas.width - (box[2] - box[0])) // 2, y), text, font=typeface, fill=color)


def hero() -> Image.Image:
    canvas = Image.new("RGB", (1024, 1024), PAPER)
    art = portrait("monkey-silly-green.png", 700)
    canvas.paste(art, (162, 64), art)
    draw = ImageDraw.Draw(canvas)
    centered(canvas, draw, "IT RUNS ON YOUR MAC", 800, font(62, bold=True), INK)
    centered(canvas, draw, "no cloud · no account · no telemetry", 892, font(30), MUTED)
    return canvas


def sheet() -> Image.Image:
    columns, cell, face, row_height = 4, 320, 224, 292
    width = columns * cell
    canvas = Image.new("RGB", (width, 1000), PAPER)
    draw = ImageDraw.Draw(canvas)
    centered(canvas, draw, "twelve moods, one monkey", 44, font(46, bold=True), INK)
    for index, (name, mood) in enumerate(MOODS):
        column, row = index % columns, index // columns
        x = column * cell + (cell - face) // 2
        y = 130 + row * row_height
        art = portrait(name, face)
        canvas.paste(art, (x, y), art)
        box = draw.textbbox((0, 0), mood, font=font(24))
        draw.text(
            (column * cell + (cell - (box[2] - box[0])) // 2, y + face + 8),
            mood,
            font=font(24),
            fill=MUTED,
        )
    return canvas


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    outputs = {
        OUT / "openmonkey-hero.png": hero(),
        OUT / "openmonkey-moods.png": sheet(),
        # The landing page crops its hero to a circle, so it wants the bare portrait.
        OUT / "openmonkey-face.png": portrait("monkey-silly-green.png", 512),
    }
    for path, image in outputs.items():
        image.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1024:.0f} kB")


if __name__ == "__main__":
    main()
