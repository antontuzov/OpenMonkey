#!/usr/bin/env python3
"""Build the brand animation from the 12 mood portraits.

The animation walks the mood arc and crossfades between portraits, so the logo
reads as one living ape rather than a slideshow of stickers. Output is an
animated WebP (alpha) used by the README and the landing page, plus a static
poster frame.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGOS = ROOT / "assets" / "logos"
OUT = ROOT / "assets" / "brand"

# The arc the app itself walks through: calm -> thinking -> warm -> silly ->
# surprise -> tired -> back to neutral.
ARC = [
    "monkey-neutral-blue.png",
    "monkey-calm-mint.png",
    "monkey-thinking-cyan.png",
    "monkey-happy-yellow.png",
    "monkey-excited-gold.png",
    "monkey-silly-green.png",
    "monkey-love-pink.png",
    "monkey-smile-coral.png",
    "monkey-cool-purple.png",
    "monkey-tired-lavender.png",
    "monkey-shocked-orange.png",
    "monkey-angry-red.png",
]

BLEND_STEPS = 4
HOLD_FRAMES = 2
FRAME_MS = 70


def zoom(image: Image.Image, factor: float) -> Image.Image:
    """Scale around the centre so a portrait can drift without moving its edges."""
    width, height = image.size
    if factor == 1:
        return image
    scaled = image.resize((round(width * factor), round(height * factor)), Image.LANCZOS)
    left = (scaled.width - width) // 2
    top = (scaled.height - height) // 2
    return scaled.crop((left, top, left + width, top + height))


def build(size: int) -> list[Image.Image]:
    portraits = []
    for name in ARC:
        with Image.open(LOGOS / name) as source:
            frame = source.convert("RGBA").resize((size, size), Image.LANCZOS)
        portraits.append(frame)

    frames: list[Image.Image] = []
    count = len(portraits)
    for index in range(count):
        current = portraits[index]
        following = portraits[(index + 1) % count]
        for hold in range(HOLD_FRAMES):
            drift = 1.0 + 0.06 * (hold / max(1, HOLD_FRAMES - 1))
            frames.append(zoom(current, drift))
        for step in range(1, BLEND_STEPS + 1):
            ratio = step / (BLEND_STEPS + 1)
            drift = 1.0 + 0.06 * ratio
            frames.append(Image.blend(zoom(current, drift), zoom(following, drift), ratio))
    return frames


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", type=int, default=256, help="frame edge in pixels")
    parser.add_argument("--quality", type=int, default=72)
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    frames = build(args.size)

    webp = OUT / "openmonkey-moods.webp"
    frames[0].save(
        webp,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        lossless=False,
        quality=args.quality,
        method=6,
    )
    frames[0].save(OUT / "openmonkey-moods-poster.png")

    gif = OUT / "openmonkey-moods.gif"
    indexed = []
    for frame in frames[::2]:
        flat = Image.new("RGB", frame.size, (252, 250, 248))
        flat.paste(frame, mask=frame.getchannel("A"))
        indexed.append(flat.convert("P", palette=Image.ADAPTIVE, colors=128))
    indexed[0].save(
        gif,
        save_all=True,
        append_images=indexed[1:],
        duration=FRAME_MS,
        loop=0,
        disposal=2,
        optimize=True,
    )

    for path in (webp, gif, OUT / "openmonkey-moods-poster.png"):
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1024:.0f} kB")
    print(f"frames: {len(frames)}")


if __name__ == "__main__":
    main()
