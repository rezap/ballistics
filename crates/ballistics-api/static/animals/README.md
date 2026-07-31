# Animal silhouettes and species data

## Adding a species

1. Drop the artwork in as `<key>.raw.png` (side profile, facing right,
   plain light background).
2. Run `python3 scripts/prep_silhouettes.py` from the repository root.
   That writes the web asset `<key>.png` and updates `manifest.json`.
3. Add an entry to `species.json` under the same `<key>`.

No Rust or JavaScript changes are needed - the species dropdown, the
silhouette overlay and the info panel are all driven by these files.

## Why the artwork is preprocessed

The source art is large (around 2816x1536, ~3MB each), sits on an opaque
white background, and is drawn with a ground shadow under the animal's
feet. The prep script fixes all three:

- **Crops to the animal.** The bounding box is what converts pixels to
  real-world inches, so it has to be measured precisely rather than
  trimmed by eye.
- **Excludes the ground shadow from that box.** The shadow is drawn
  *wider than the animal* - on the roe deer it spans 1232px against the
  animal's 675px leg span - so including it would silently corrupt every
  dimension derived from the image.
- **Keys out the background and reduces the art to an alpha mask.** The
  frontend tints the mask to the current theme, so one asset works in
  both light and dark mode. Baking in the source's black would make the
  silhouette nearly invisible against a dark background.

The result is roughly 50KB per animal instead of 3MB.

Run `python3 scripts/inspect_silhouettes.py` to report what the script
sees in a set of images without modifying anything, and pass
`--preview-dir DIR` to `prep_silhouettes.py` to write bounding-box
previews. Shadow detection is a heuristic tuned to this artwork style, so
look at a preview before trusting a new crop.

## Scaling

`species.json` carries each animal's real-world `body_length_in` and the
`vitals_anchor` marking where the heart/lung centre sits within the
artwork, as a fraction of its width and height. Combined with the pixel
dimensions in `manifest.json`, that maps the ballistics engine's
real-inch drop and wind drift onto the drawing.

Those dimensions are typical figures from general wildlife references,
not authoritative measurements, and the artwork is stylised. The app
therefore lets the user override the reference size at runtime (in
inches, centimetres or metres) and remembers it per species.
