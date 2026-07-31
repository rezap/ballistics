#!/usr/bin/env python3
"""Report the characteristics of the animal silhouette PNGs.

Run this BEFORE wiring new artwork into the app. It answers the questions
that determine how an image can be scaled to real-world dimensions:

  * Is there an alpha channel (making the tight bounding box unambiguous)
    or is the subject on a flat background colour we have to key out?
  * How much blank margin surrounds the subject?
  * Is there a reflection or drop shadow below the subject? This matters a
    lot: the bounding box is what converts pixels to inches, so including
    a reflection in it silently corrupts every real-world height derived
    from that image (roughly halving it, for a full mirror reflection).

Reflection detection keys off *lightness*, not pixel density. Density is
the wrong signal - an animal's legs are legitimately thin, so a
density-based rule flags them as a reflection while missing an actual
reflection that is as wide as the body. Reflections and drop shadows are
instead consistently lighter (or, with an alpha channel, more
transparent) than the subject itself.

The lightness rule is still only a hint on real artwork, so this script
reports what it measured rather than silently "fixing" anything. Confirm
by looking at the image before trusting a bounding box that excludes a
suspected reflection.

Usage:
    pip install Pillow
    python3 scripts/inspect_silhouettes.py [image_dir]
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

DEFAULT_DIR = Path("crates/ballistics-api/static/animals")

# A pixel this far (per channel, 0-255) from the detected background colour
# counts as subject rather than background.
BACKGROUND_TOLERANCE = 18
# A row whose subject pixels average at least this much lighter (0-255)
# than the subject's core is treated as a reflection/shadow candidate.
REFLECTION_LIGHTNESS_MARGIN = 45
# Rows at least this dense (fraction of the peak row) define the "core"
# lightness of the subject's body.
CORE_ROW_FRACTION = 0.5


def subject_rows(image):
    """Per-row (count, mean_lightness, min_x, max_x) for subject pixels."""
    if "A" in image.getbands():
        rgba = image.convert("RGBA")
        pixels = rgba.load()
        width, height = rgba.size

        def sample(x, y):
            r, g, b, a = pixels[x, y]
            if a <= 8:
                return None
            # Treat transparency as lightness: a half-alpha reflection reads
            # as light, the same way a grey one does on a white background.
            return (r + g + b) / 3 * (a / 255) + 255 * (1 - a / 255)

        has_alpha = True
    else:
        rgb = image.convert("RGB")
        pixels = rgb.load()
        width, height = rgb.size
        corners = [
            pixels[0, 0],
            pixels[width - 1, 0],
            pixels[0, height - 1],
            pixels[width - 1, height - 1],
        ]
        background = max(set(corners), key=corners.count)

        def sample(x, y):
            pixel = pixels[x, y]
            if all(abs(pixel[i] - background[i]) <= BACKGROUND_TOLERANCE for i in range(3)):
                return None
            return sum(pixel) / 3

        has_alpha = False

    rows = []
    for y in range(height):
        count = 0
        total = 0.0
        row_min_x, row_max_x = width, -1
        for x in range(width):
            value = sample(x, y)
            if value is None:
                continue
            count += 1
            total += value
            if x < row_min_x:
                row_min_x = x
            if x > row_max_x:
                row_max_x = x
        rows.append((count, total / count if count else 0.0, row_min_x, row_max_x))

    return width, height, rows, has_alpha


def analyse(path):
    with Image.open(path) as image:
        image.load()
        width, height, rows, has_alpha = subject_rows(image)
        mode = image.mode

    occupied = [y for y, (count, *_) in enumerate(rows) if count > 0]
    if not occupied:
        return {"path": path, "empty": True}

    top, bottom = occupied[0], occupied[-1]
    peak = max(count for count, *_ in rows)
    core = [
        lightness
        for count, lightness, *_ in rows
        if count >= peak * CORE_ROW_FRACTION
    ]
    core_lightness = sum(core) / len(core) if core else 0.0

    # Walk up from the bottom while rows stay notably lighter than the core.
    reflection_top = None
    for y in range(bottom, top - 1, -1):
        count, lightness, *_ = rows[y]
        if count == 0:
            continue
        if lightness - core_lightness >= REFLECTION_LIGHTNESS_MARGIN:
            reflection_top = y
        else:
            break

    def bbox_for(last_row):
        xs = [(rmin, rmax) for count, _, rmin, rmax in rows[top : last_row + 1] if count]
        min_x = min(pair[0] for pair in xs)
        max_x = max(pair[1] for pair in xs)
        return min_x, top, max_x, last_row

    full_bbox = bbox_for(bottom)
    body_bottom = reflection_top - 1 if reflection_top is not None else bottom
    body_bbox = bbox_for(body_bottom) if body_bottom >= top else full_bbox

    return {
        "path": path,
        "empty": False,
        "mode": mode,
        "has_alpha": has_alpha,
        "canvas": (width, height),
        "core_lightness": core_lightness,
        "full_bbox": full_bbox,
        "body_bbox": body_bbox,
        "reflection_rows": (bottom - reflection_top + 1) if reflection_top is not None else 0,
        "margins": {
            "left": full_bbox[0],
            "right": width - 1 - full_bbox[2],
            "top": top,
            "bottom": height - 1 - full_bbox[3],
        },
    }


def describe(bbox):
    min_x, min_y, max_x, max_y = bbox
    w = max_x - min_x + 1
    h = max_y - min_y + 1
    return f"{w}x{h} (aspect {w / h:.3f})"


def main():
    image_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DIR
    if not image_dir.is_dir():
        sys.exit(f"no such directory: {image_dir}")

    paths = sorted(image_dir.glob("*.png"))
    if not paths:
        sys.exit(f"no PNGs found in {image_dir}")

    for path in paths:
        result = analyse(path)
        print(f"\n=== {path.name} ===")
        if result["empty"]:
            print("  no subject pixels detected (fully blank?)")
            continue

        print(f"  mode={result['mode']} alpha={result['has_alpha']}")
        print(f"  canvas={result['canvas'][0]}x{result['canvas'][1]}")
        print(f"  margins={result['margins']}")
        print(f"  subject core lightness={result['core_lightness']:.1f}")
        print(f"  bbox (all subject pixels): {describe(result['full_bbox'])}")

        if result["reflection_rows"]:
            print(
                f"  bbox (excluding suspected reflection): "
                f"{describe(result['body_bbox'])}"
            )
            print(
                f"  NOTE: {result['reflection_rows']} lighter rows at the bottom look like a\n"
                f"        reflection or drop shadow. Confirm visually. If real, scale from the\n"
                f"        body-only bbox - the full bbox would corrupt real-world heights."
            )


if __name__ == "__main__":
    main()
