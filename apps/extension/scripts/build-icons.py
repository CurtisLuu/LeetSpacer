#!/usr/bin/env python3
"""
Generate the extension's icon set from the LeetSpacer mark.

Written as a generator rather than committed binaries so the mark can be adjusted in one
place and re-rendered at every size, and so a reviewer can see what the icon *is* rather
than being asked to trust four opaque PNGs.

Pure stdlib on purpose: this machine has no SVG rasteriser (no rsvg, ImageMagick, Pillow
or sharp), and adding a native image dependency to a project that otherwise needs none is
a poor trade for four small files. PNG is a simple enough container to emit directly.

The mark is two stacked cards — a deck, which is what a spaced-repetition schedule is —
with braces on the face for the code. Colours are sampled from the supplied artwork and
happen to be the app's own accent ramp already.

Usage: python3 scripts/build-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# Sizes rendered faithfully, and sizes that need the high-contrast treatment. The mark's
# face is a very pale grey — lovely on a white page, invisible on a white browser toolbar,
# and by 16px its braces are thinner than a pixel. Small sizes therefore invert to a filled
# accent card with light braces: same silhouette, same palette, legible at a glance.
FULL_SIZES = (48, 128)
COMPACT_SIZES = (16, 32)
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"

# Sampled from the artwork. `ACCENT` is also --color-accent in the app's theme.
BACK_CARD = (0xC4, 0xB5, 0xFD)
FACE_CARD = (0xE7, 0xE9, 0xF0)
BRACE = (0xA7, 0x8B, 0xFA)
ACCENT = (0x7C, 0x3A, 0xED)

# Card proportions, measured off the artwork: 513 x 600 with a ~17% corner radius, and a
# second card of the same size rotated 6 degrees and nudged down-right.
CARD_W, CARD_H = 0.62, 0.725
CARD_RADIUS = 0.175  # as a fraction of the card's width
BACK_ROTATION_DEG = 6.0
BACK_OFFSET = (0.035, 0.020)

BRACE_HEIGHT = 0.54  # of the card's height
BRACE_WIDTH = 0.20  # of the card's width, per brace
BRACE_GAP = 0.075  # from centre to each brace's inner edge
BRACE_STROKE = 0.060  # of the card's width

# Compact overrides. The card grows into the margin it no longer needs, and the braces
# thicken enough to survive being a pixel and a half wide.
COMPACT_SCALE = 1.14
COMPACT_BRACE_STROKE = 0.105
COMPACT_BRACE_WIDTH = 0.26
COMPACT_BRACE_GAP = 0.085

SUPERSAMPLE = 4


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


def rounded_rect_covers(x: float, y: float, cx: float, cy: float, w: float, h: float,
                        radius: float, rotation: float = 0.0) -> bool:
    """Point-in-rounded-rectangle, with the rectangle optionally rotated about its centre.

    The point is rotated backwards instead of the rectangle forwards, which keeps the test
    a plain axis-aligned one no matter how the card is turned.
    """
    dx, dy = x - cx, y - cy
    if rotation:
        cos_t, sin_t = _cos(-rotation), _sin(-rotation)
        dx, dy = dx * cos_t - dy * sin_t, dx * sin_t + dy * cos_t

    half_w, half_h = w / 2, h / 2
    if abs(dx) > half_w or abs(dy) > half_h:
        return False

    # Inside the cross formed by the two inset rectangles, or within a corner circle.
    inner_x, inner_y = half_w - radius, half_h - radius
    if abs(dx) <= inner_x or abs(dy) <= inner_y:
        return True
    return (abs(dx) - inner_x) ** 2 + (abs(dy) - inner_y) ** 2 <= radius**2


def _cos(deg: float) -> float:
    import math

    return math.cos(math.radians(deg))


def _sin(deg: float) -> float:
    import math

    return math.sin(math.radians(deg))


def cubic(p0, p1, p2, p3, steps: int = 24):
    """Sample a cubic Bezier into points."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def brace_points(left: float, top: float, w: float, h: float, mirror: bool):
    """A curly brace as a dense polyline, so stroking is just a distance test.

    Drawn opening rightwards — `{` — then mirrored horizontally for the closing one. The
    spine sits at 62% of the width so the nub has somewhere to point.
    """
    spine = w * 0.62
    pts = []
    pts += cubic((w, 0), (spine, 0), (spine, h * 0.03), (spine, h * 0.17))
    pts += [(spine, h * (0.17 + 0.17 * i / 8)) for i in range(9)]
    pts += cubic((spine, h * 0.34), (spine, h * 0.44), (spine * 0.45, h * 0.5), (0, h * 0.5))
    pts += cubic((0, h * 0.5), (spine * 0.45, h * 0.5), (spine, h * 0.56), (spine, h * 0.66))
    pts += [(spine, h * (0.66 + 0.17 * i / 8)) for i in range(9)]
    pts += cubic((spine, h * 0.83), (spine, h * 0.97), (spine, h), (w, h))

    return [(left + (w - px if mirror else px), top + py) for px, py in pts]


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def build_scene(compact: bool):
    """Everything needed to colour a point, precomputed once per variant."""
    scale = COMPACT_SCALE if compact else 1.0
    card_w, card_h = CARD_W * scale, CARD_H * scale
    brace_width = COMPACT_BRACE_WIDTH if compact else BRACE_WIDTH
    brace_gap = COMPACT_BRACE_GAP if compact else BRACE_GAP
    brace_stroke = COMPACT_BRACE_STROKE if compact else BRACE_STROKE
    face, brace = ((ACCENT, FACE_CARD) if compact else (FACE_CARD, BRACE))

    cx, cy = 0.5, 0.5
    # The face sits up-left of centre so the rotated back card can show past it.
    face_cx = cx - BACK_OFFSET[0] / 2
    face_cy = cy - BACK_OFFSET[1] / 2
    back_cx = face_cx + BACK_OFFSET[0]
    back_cy = face_cy + BACK_OFFSET[1]

    brace_h = card_h * BRACE_HEIGHT
    brace_w = card_w * brace_width
    top = face_cy - brace_h / 2
    gap = card_w * brace_gap

    strokes = (
        brace_points(face_cx - gap - brace_w, top, brace_w, brace_h, mirror=False)
        + brace_points(face_cx + gap, top, brace_w, brace_h, mirror=True)
    )
    return {
        "face_c": (face_cx, face_cy),
        "back_c": (back_cx, back_cy),
        "card": (card_w, card_h),
        "radius": card_w * CARD_RADIUS,
        "strokes": strokes,
        "stroke_r2": (card_w * brace_stroke / 2) ** 2,
        "face": face,
        "brace": brace,
    }


def sample(scene, x: float, y: float):
    """Colour at a normalised point, or None where the canvas is transparent."""
    card_w, card_h = scene["card"]
    face_cx, face_cy = scene["face_c"]

    if rounded_rect_covers(x, y, face_cx, face_cy, card_w, card_h, scene["radius"]):
        stroke_r2 = scene["stroke_r2"]
        for px, py in scene["strokes"]:
            if (x - px) ** 2 + (y - py) ** 2 <= stroke_r2:
                return (*scene["brace"], 255)
        return (*scene["face"], 255)

    back_cx, back_cy = scene["back_c"]
    if rounded_rect_covers(
        x, y, back_cx, back_cy, card_w, card_h, scene["radius"], BACK_ROTATION_DEG
    ):
        return (*BACK_CARD, 255)
    return None


def render(size: int, compact: bool = False) -> bytes:
    """One PNG's worth of raw RGBA scanlines, each prefixed with its filter byte."""
    scene = build_scene(compact)
    step = 1.0 / (size * SUPERSAMPLE)
    rows = bytearray()

    for py in range(size):
        rows.append(0)  # filter type 0 (None)
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    hit = sample(
                        scene,
                        (px * SUPERSAMPLE + sx + 0.5) * step,
                        (py * SUPERSAMPLE + sy + 0.5) * step,
                    )
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
    for size, compact in [(s, False) for s in FULL_SIZES] + [(s, True) for s in COMPACT_SIZES]:
        path = OUT / f"{size}.png"
        write_png(path, size, render(size, compact))
        variant = "compact" if compact else "full"
        print(f"wrote {path.relative_to(OUT.parent.parent)} ({variant}, {path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
