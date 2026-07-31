#!/usr/bin/env python3
"""Turn raw silhouette artwork into web assets plus a scaling manifest.

The source art is large (roughly 2816x1536, ~3MB each), sits on an opaque
white background, and is drawn with a ground shadow under the animal's
feet. None of that is usable as-is:

  * The white background would box the artwork against the page and break
    dark mode, so it is keyed out to transparency.
  * The ground shadow has to be excluded from the bounding box. The
    bounding box is what converts pixels to real-world inches, and the
    shadow is drawn *wider than the animal* - on the roe deer it spans
    1232px against the animal's 675px legs - so including it would
    silently corrupt every derived real-world dimension.
  * 3MB per image is far too heavy to ship to a browser.

Output: `<species>.png`, cropped tight to the animal (shadow excluded),
transparent background, downscaled, plus `manifest.json` recording each
image's pixel dimensions so the frontend can map pixels to inches.

Shadow detection keys off the sharp jump in row pixel count where the
legs give way to the much wider shadow ellipse. It is a heuristic tuned
to this artwork style, so the script also writes bounding-box preview
images for visual confirmation - do not trust a crop you have not looked
at.

Usage:
    pip install Pillow
    python3 scripts/prep_silhouettes.py [--preview-dir DIR]
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

SOURCE_DIR = Path("crates/ballistics-api/static/animals")
MANIFEST = SOURCE_DIR / "manifest.json"

# Luminance below this counts as silhouette rather than background when
# measuring the bounding box.
INK_THRESHOLD = 128
# Alpha ramp for the emitted mask: at or below this luminance the shape is
# fully opaque, at or above INK_CLEAR_ABOVE it is fully transparent, and
# in between it fades - which both preserves anti-aliased edges and
# discards the light grey ground shadows.
INK_SOLID_BELOW = 60
INK_CLEAR_ABOVE = 190
# Within the bottom slice of the subject, a row whose ink count jumps by at
# least this factor over the row above marks the top of the ground shadow.
SHADOW_JUMP_FACTOR = 1.8
# Only look for that jump inside the bottom fraction of the subject; the
# animal's own body has plenty of legitimate width changes higher up.
SHADOW_SEARCH_FRACTION = 0.25
# Longest edge of the emitted asset. The overlay is drawn a few hundred
# pixels wide, so anything beyond this is wasted bytes.
MAX_OUTPUT_EDGE = 900


def ink_rows(image):
    """Per-row (count, min_x, max_x) of silhouette pixels, top to bottom."""
    grey = image.convert("L")
    width, height = grey.size
    pixels = grey.load()

    rows = []
    for y in range(height):
        count = 0
        min_x, max_x = width, -1
        for x in range(width):
            if pixels[x, y] < INK_THRESHOLD:
                count += 1
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
        rows.append((count, min_x, max_x))
    return rows


def find_shadow_top(rows):
    """First row of the ground shadow, or None if no shadow is detected."""
    occupied = [y for y, (count, *_) in enumerate(rows) if count]
    if not occupied:
        return None

    top, bottom = occupied[0], occupied[-1]
    search_from = bottom - int((bottom - top) * SHADOW_SEARCH_FRACTION)

    best_y = None
    best_ratio = SHADOW_JUMP_FACTOR
    for y in range(max(search_from, top + 1), bottom + 1):
        previous = rows[y - 1][0]
        current = rows[y][0]
        if previous <= 0:
            continue
        ratio = current / previous
        if ratio >= best_ratio:
            best_ratio = ratio
            best_y = y

    if best_y is None:
        return None

    # A real shadow is wider than what stands on it. If the widest row at or
    # below the candidate is no wider than the legs above it, this is more
    # likely part of the animal (a splayed stance, a low tail) than a shadow.
    legs_extent = rows[best_y - 1][2] - rows[best_y - 1][1] + 1
    below_extent = max(
        (r[2] - r[1] + 1) for r in rows[best_y : bottom + 1] if r[0]
    )
    if below_extent <= legs_extent:
        return None

    return best_y


def bbox_excluding(rows, last_row):
    occupied = [y for y, (count, *_) in enumerate(rows[: last_row + 1]) if count]
    if not occupied:
        return None
    top, bottom = occupied[0], occupied[-1]
    min_x = min(rows[y][1] for y in occupied)
    max_x = max(rows[y][2] for y in occupied)
    return min_x, top, max_x, bottom


def to_transparent(image, bbox):
    """Crop to bbox and reduce the artwork to a pure alpha mask.

    The emitted RGB is meaningless - the frontend tints the shape via
    canvas compositing so one asset serves both light and dark themes.
    Baking in the source's black would make the silhouette all but
    invisible against a dark background.

    Luminance maps to alpha through a ramp rather than a straight
    inversion. A straight `255 - luminance` keeps the faint grey ground
    shadow that sits below the ink threshold, which shows up as a smudge
    under some animals but not others (their shadows are darker and get
    cropped instead), so the artwork ends up inconsistent. The ramp's
    upper cutoff discards those light greys outright while the ramp
    itself preserves the anti-aliased edge.
    """
    cropped = image.convert("RGBA").crop(
        (bbox[0], bbox[1], bbox[2] + 1, bbox[3] + 1)
    )
    pixels = cropped.load()
    width, height = cropped.size
    ramp = INK_CLEAR_ABOVE - INK_SOLID_BELOW
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            luminance = (r + g + b) / 3
            if luminance <= INK_SOLID_BELOW:
                alpha = 255
            elif luminance >= INK_CLEAR_ABOVE:
                alpha = 0
            else:
                alpha = round(255 * (INK_CLEAR_ABOVE - luminance) / ramp)
            pixels[x, y] = (0, 0, 0, alpha)
    return cropped


def downscale(image):
    width, height = image.size
    longest = max(width, height)
    if longest <= MAX_OUTPUT_EDGE:
        return image
    factor = MAX_OUTPUT_EDGE / longest
    return image.resize(
        (max(1, round(width * factor)), max(1, round(height * factor))),
        Image.LANCZOS,
    )


def write_preview(source, bbox, shadow_top, path):
    preview = source.convert("RGB")
    draw = ImageDraw.Draw(preview)
    draw.rectangle(
        [bbox[0], bbox[1], bbox[2], bbox[3]], outline=(220, 30, 30), width=6
    )
    if shadow_top is not None:
        draw.line(
            [(0, shadow_top), (preview.width, shadow_top)],
            fill=(30, 120, 220),
            width=6,
        )
    preview.thumbnail((900, 900))
    preview.save(path, quality=85)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview-dir", type=Path, default=None)
    args = parser.parse_args()

    if not SOURCE_DIR.is_dir():
        sys.exit(f"no such directory: {SOURCE_DIR}")

    raw_paths = sorted(SOURCE_DIR.glob("*.raw.png"))
    if not raw_paths:
        sys.exit(
            f"no *.raw.png found in {SOURCE_DIR}.\n"
            "Rename the source artwork to <species>.raw.png so the generated\n"
            "web assets (<species>.png) never overwrite the originals."
        )

    if args.preview_dir:
        args.preview_dir.mkdir(parents=True, exist_ok=True)

    manifest = {}
    for path in raw_paths:
        key = path.name[: -len(".raw.png")]
        with Image.open(path) as source:
            source.load()
            rows = ink_rows(source)
            shadow_top = find_shadow_top(rows)
            last_row = (shadow_top - 1) if shadow_top is not None else len(rows) - 1
            bbox = bbox_excluding(rows, last_row)
            if bbox is None:
                print(f"  {key}: no silhouette pixels found, skipping")
                continue

            asset = downscale(to_transparent(source, bbox))
            out_path = SOURCE_DIR / f"{key}.png"
            asset.save(out_path, optimize=True)

            if args.preview_dir:
                write_preview(
                    source, bbox, shadow_top, args.preview_dir / f"{key}.preview.jpg"
                )

        manifest[key] = {"width_px": asset.width, "height_px": asset.height}
        size_kb = out_path.stat().st_size / 1024
        shadow_note = "shadow trimmed" if shadow_top is not None else "no shadow found"
        print(
            f"  {key}: {asset.width}x{asset.height}px, {size_kb:.0f}KB ({shadow_note})"
        )

    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"\nwrote {MANIFEST} with {len(manifest)} entries")


if __name__ == "__main__":
    main()
