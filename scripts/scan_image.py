#!/usr/bin/env python3
"""Turn a phone photo of a recipe card into a clean, evenly lit "scan".

  python3 scripts/scan_image.py <photo> images/<slug>-card.jpg [options]

  --crop x0,y0,x1,y1   keep only this part of the photo (fractions 0-1 of width/height),
                       e.g. to drop fingers, binder edges or a line of names
  --keep x0,y0,x1,y1   protect a large printed picture (repeatable) so it isn't
                       mistaken for shadow and washed out
  --gamma 1.25         darken the ink; higher = darker (1 = unchanged)
  --white 0.985        how white the paper ends up (1 = pure white)
  --clean 0.92         anything this close to the paper's brightness becomes paper,
                       which hides faint sleeve wrinkles and glare (1 = off)
  --color white        white: paper comes out neutral white, removing color casts (default)
                       card:  paper comes out one even color, the card's own (cream, mint)
                       keep:  only brightness is evened out; use when differently colored
                              cards share one page (yellow cards on white paper)

How it works: the paper's brightness is sampled in small blocks across the page. Small
dark things (writing, logos) are filtered out of that map; large soft dark areas (the
phone's shadow, uneven light) stay in it. Dividing the photo by that map evens out the
lighting. Each color channel is corrected on its own, since shadows also tint the paper.

Like prep_image.py it also rotates per EXIF, caps the long edge at 2000px and strips all
metadata (including GPS). Needs: pip install opencv-python-headless numpy pillow
"""
import argparse

import cv2
import numpy as np
from PIL import Image, ImageOps

MAX = 2000
BLOCK = 24          # px per sample block (at full resolution)
PAPER_PCT = 92      # brightness percentile treated as "paper" inside a block
MEDIAN_BLOCKS = 7   # removes dark objects up to roughly this many blocks across


def box(text):
    vals = [float(v) for v in text.split(",")]
    if len(vals) != 4 or not all(0 <= v <= 1 for v in vals) or vals[0] >= vals[2] or vals[1] >= vals[3]:
        raise argparse.ArgumentTypeError("expected x0,y0,x1,y1 as fractions between 0 and 1")
    return vals


def paper_map(lum, keep):
    """Estimate the paper's brightness everywhere (the lighting), at full resolution."""
    h, w = lum.shape
    gh, gw = -(-h // BLOCK), -(-w // BLOCK)
    padded = np.pad(lum, ((0, gh * BLOCK - h), (0, gw * BLOCK - w)), mode="edge")
    blocks = padded.reshape(gh, BLOCK, gw, BLOCK).transpose(0, 2, 1, 3).reshape(gh, gw, -1)
    grid = np.percentile(blocks, PAPER_PCT, axis=2).astype(np.uint8)

    grid = cv2.medianBlur(grid, MEDIAN_BLOCKS)
    if keep:
        mask = np.zeros_like(grid)
        for x0, y0, x1, y1 in keep:
            mask[int(y0 * gh):int(np.ceil(y1 * gh)), int(x0 * gw):int(np.ceil(x1 * gw))] = 255
        grid = cv2.inpaint(grid, mask, 5, cv2.INPAINT_TELEA)
    grid = cv2.GaussianBlur(grid.astype(np.float32), (0, 0), 1.2)
    full = cv2.resize(grid, (gw * BLOCK, gh * BLOCK), interpolation=cv2.INTER_CUBIC)[:h, :w]
    return np.clip(full, 1, 255) / 255.0


def scan(img, crop=None, keep=(), gamma=1.25, white=0.985, color="white", clean=0.92):
    if crop:
        W, H = img.size
        x0, y0, x1, y1 = crop
        img = img.crop((round(x0 * W), round(y0 * H), round(x1 * W), round(y1 * H)))
        # --keep boxes are given relative to the original photo; re-express them in the crop
        keep = [((a - x0) / (x1 - x0), (b - y0) / (y1 - y0), (c - x0) / (x1 - x0), (d - y0) / (y1 - y0))
                for a, b, c, d in keep]
        keep = [tuple(min(1, max(0, v)) for v in k) for k in keep]

    rgb = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    if color == "keep":
        lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) * 255
        light = paper_map(lum.astype(np.uint8), keep)[..., None]
        target = white
    else:
        light = np.dstack([paper_map((rgb[..., c] * 255).astype(np.uint8), keep) for c in range(3)])
        target = np.full(3, white, dtype=np.float32)
        if color == "card":
            # the card's own color: its brightest well-lit paper, scaled so the top channel = white
            tint = np.percentile(light.reshape(-1, 3), 90, axis=0)
            target = white * tint / tint.max()

    # paper -> 1.0, then: near-paper -> paper, ink a little deeper, then back to paper color
    paper = rgb / np.clip(light, 1 / 255, None)
    paper = np.clip(paper / clean, 0, 1) ** gamma
    out = np.clip(paper * target, 0, 1)
    out = (out * 255 + 0.5).astype(np.uint8)
    # light clean-up of the grain that brightening a shadow brings out
    out = cv2.fastNlMeansDenoisingColored(out, None, 3, 3, 7, 21)
    return Image.fromarray(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--crop", type=box)
    ap.add_argument("--keep", type=box, action="append", default=[])
    ap.add_argument("--gamma", type=float, default=1.25)
    ap.add_argument("--white", type=float, default=0.985)
    ap.add_argument("--color", choices=["white", "card", "keep"], default="white")
    ap.add_argument("--clean", type=float, default=0.92)
    a = ap.parse_args()

    img = ImageOps.exif_transpose(Image.open(a.src))
    out = scan(img, a.crop, a.keep, a.gamma, a.white, a.color, a.clean)
    out.thumbnail((MAX, MAX), Image.LANCZOS)
    out.save(a.dst, "JPEG", quality=84, optimize=True, progressive=True)  # no exif= -> metadata dropped
    print(f"{a.dst}: {out.width}x{out.height}")


if __name__ == "__main__":
    main()
