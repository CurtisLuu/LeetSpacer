#!/usr/bin/env python3
"""
Generate the extension's icon set.

Written as a generator rather than committed binaries so the mark can be adjusted in one
place and re-rendered at every size, and so a reviewer can see what the icon *is* rather
than being asked to trust four opaque PNGs.

Pure stdlib on purpose: this machine has no SVG rasteriser (no rsvg, ImageMagick, Pillow
or sharp), and adding a native image dependency to a project that otherwise needs none is
a poor trade for four small files. PNG is a simple enough container to emit directly.

The mark: three dots on a line, growing in size and spacing left to right — the intervals
of spaced repetition. It survives 16px because it's three blobs and nothing else.

Usage: python3 scripts/build-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SIZES = (16, 32, 48, 128)
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"

# Matches the badge colour the background worker already paints.
ACCENT = (124, 58, 237)
INK = (255, 255, 255)

CORNER_RADIUS = 0.22
# (centre x, centre y, radius), normalised to the canvas. Gaps widen 0.22 -> 0.31.
DOTS = ((0.21, 0.5, 0.055), (0.43, 0.5, 0.078), (0.74, 0.5, 0.105))

# Samples per axis per pixel. 4 is plenty for shapes this simple and keeps 128px instant.
SUPERSAMPLE = 4


def rounded_rect_covers(x: float, y: float, radius: float) -> bool:
    """Is the normalised point inside a rounded unit square?"""
    cx = min(max(x, radius), 1.0 - radius)
    cy = min(max(y, radius), 1.0 - radius)
    # Straight edges: one axis is unclamped, so the distance collapses to that axis.
    if (x, y) == (cx, cy):
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def sample(x: float, y: float) -> tuple[int, int, int, int] | None:
    """Colour at a normalised point, or None where the canvas is transparent."""
    if not rounded_rect_covers(x, y, CORNER_RADIUS):
        return None
    for dx, dy, r in DOTS:
        if (x - dx) ** 2 + (y - dy) ** 2 <= r**2:
            return (*INK, 255)
    return (*ACCENT, 255)


def render(size: int) -> bytes:
    """One PNG's worth of raw RGBA scanlines, each prefixed with its filter byte."""
    step = 1.0 / (size * SUPERSAMPLE)
    rows = bytearray()

    for py in range(size):
        rows.append(0)  # filter type 0 (None)
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = (px * SUPERSAMPLE + sx + 0.5) * step
                    y = (py * SUPERSAMPLE + sy + 0.5) * step
                    hit = sample(x, y)
                    if hit is None:
                        continue
                    r += hit[0]
                    g += hit[1]
                    b += hit[2]
                    a += 255

            taken = SUPERSAMPLE**2
            if a == 0:
                rows.extend((0, 0, 0, 0))
                continue
            # Average the colour over covered samples only, but the alpha over all of
            # them — otherwise edge pixels pick up the colour of the void they overlap.
            covered = a // 255
            rows.extend((r // covered, g // covered, b // covered, a // taken))

    return bytes(rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    # 8 bits per channel, colour type 6 (RGBA), no interlacing.
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT / f"{size}.png"
        write_png(path, size, render(size))
        print(f"wrote {path.relative_to(OUT.parent.parent)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
