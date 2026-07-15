#!/usr/bin/env python3
"""Derive the two Weather-Deck composite contrast grounds from the SHIPPED asset
(A03, FR-01.48). Committed one-off (requires Pillow) so the constants baked into
weather-deck.css (`--ground-glass-worst`, `--ground-photo-worst`) are reviewable
and reproducible, tied to the exact JPEG that ships at
client/public/backdrops/deck-golden.jpg.

The token contrast ladder (src/styles/tokens.contrast.test.ts) tests against these
committed hexes; this script is how they were computed. Re-run it if the asset is
ever re-encoded, then update the two constants + this note.

    python client/scripts/derive-weather-deck-grounds.py

--ground-photo-worst : lightest region of deck-golden under the 3-layer
  .scene-bg::after scrim — the ground bare LIGHT chrome text would ride if it left
  the taupe/glass chrome (it fails there ~1.5:1, which is the proof text must ride
  chrome, never the bare bright photo).
--ground-glass-worst : the 0.62α-white middle band of --glass-light over the GLOBAL
  MEAN region of deck-golden after --glass-filter brightness(1.55)+saturate(1.3). The
  glass blur(20px) averages the backdrop toward the local mean, so the global mean —
  a deterministic, grid-refinement-stable proxy — is the honest effective glass
  ground (a per-pixel extreme would be neither reproducible nor physical under blur).
"""
import os
from PIL import Image

ASSET = os.path.join(os.path.dirname(__file__), "..", "public", "backdrops", "deck-golden.jpg")
SCRIM_INK = (44, 38, 29)


def clamp(x): return max(0.0, min(255.0, x))
def brightness(rgb, m): return tuple(clamp(c * m) for c in rgb)
def contrast(rgb, m): return tuple(clamp((c - 128) * m + 128) for c in rgb)
def saturate(rgb, m):
    r, g, b = rgb
    y = 0.213 * r + 0.715 * g + 0.072 * b
    return tuple(clamp(y + (c - y) * m) for c in (r, g, b))
def over(fg, a, bg): return tuple(fg[i] * a + bg[i] * (1 - a) for i in range(3))
def hx(rgb): return "#" + "".join(f"{int(round(c)):02X}" for c in rgb)


def srgb_to_lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def rel_lum(rgb): return 0.2126 * srgb_to_lin(rgb[0]) + 0.7152 * srgb_to_lin(rgb[1]) + 0.0722 * srgb_to_lin(rgb[2])


def scene_img(rgb):
    # .scene-bg>img { filter: saturate(.9) contrast(1.02) brightness(1.06) }
    return brightness(contrast(saturate(rgb, 0.9), 1.02), 1.06)


def scrim_alpha(fx, fy, H):
    y = fy * H
    a1 = (0.5 + (0.24 - 0.5) * (y / 110)) if y <= 110 else \
         (0.24 + (-0.24) * ((y - 110) / 190)) if y <= 300 else 0.0
    dx = (fx - 0.5) / 0.65
    dy = (fy - 0.20)
    d = (dx * dx + dy * dy) ** 0.5
    t = (d - 0.5) / 0.5
    a2 = 0.0 if t <= 0 else (0.2 if t >= 1 else 0.2 * t)
    a3 = (0.26 + (0.2 - 0.26) * (fy / 0.55)) if fy <= 0.55 else (0.2 + (0.14) * ((fy - 0.55) / 0.45))
    return (a1, a2, a3)


def main():
    img = Image.open(os.path.normpath(ASSET)).convert("RGB")
    W, H = img.size
    px = img.load()
    photo_worst = None
    n = 0
    acc = [0.0, 0.0, 0.0]
    for iy in range(0, H, 2):
        for ix in range(0, W, 2):
            photo = scene_img(px[ix, iy])
            n += 1
            for i in range(3):
                acc[i] += photo[i]
            fx, fy = ix / W, iy / H
            ground = photo
            for a in scrim_alpha(fx, fy, H):
                ground = over(SCRIM_INK, a, ground)
            L = rel_lum(ground)
            if photo_worst is None or L > photo_worst[0]:
                photo_worst = (L, tuple(round(c) for c in ground))
    mean = tuple(a / n for a in acc)
    glass = over((255, 255, 255), 0.62, brightness(saturate(mean, 1.3), 1.55))
    print(f"asset {os.path.normpath(ASSET)} {W}x{H}")
    print(f"--ground-photo-worst: {hx(photo_worst[1])}  (lum {photo_worst[0]:.3f})")
    print(f"--ground-glass-worst: {hx(glass)}  (global-mean photo {hx(mean)})")


if __name__ == "__main__":
    main()
