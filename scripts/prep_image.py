#!/usr/bin/env python3
"""Prepare a recipe photo for the site.

  python3 scripts/prep_image.py <photo> images/<recipe-slug>-card.jpg

- rotates per the phone's EXIF orientation
- shrinks to 2000px on the long edge (phone photos are 3-8 MB)
- strips ALL metadata, including GPS location (the site is public)
"""
import sys
from PIL import Image, ImageOps

MAX = 2000

def main(src, dst):
    im = ImageOps.exif_transpose(Image.open(src))
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    im.thumbnail((MAX, MAX), Image.LANCZOS)
    im.save(dst, "JPEG", quality=84, optimize=True, progressive=True)  # no exif= -> metadata dropped
    print(f"{dst}: {im.width}x{im.height}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
