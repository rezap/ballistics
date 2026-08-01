# Animal silhouettes and species data

## Adding a species

1. Drop the artwork in as `<key>.raw.png` (side profile, facing right,
   plain light background).
2. Run `python3 scripts/prep_silhouettes.py <key>` from the repository
   root. That writes the web asset `<key>.png` and merges an entry into
   `manifest.json`. **Name the species.** Running the script bare
   re-prepares everything, and a change to the crop heuristic will then
   silently re-crop animals whose placement was already calibrated.
3. Add an entry to `species.json` under the same `<key>`.
4. Place `vitals_anchor` by looking at it. Load the app, pick the
   species, and compare against an animal whose placement is already
   right (the roe deer is the reference). There is no substitute for
   this - see below.

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

## Minimum energy

`min_energy_ft_lb` is the retained energy at impact commonly cited for
cleanly taking a species. Leave it out (or `null`) for anything smaller
than roe: below that size the limiting factor is shot placement and
bullet construction rather than energy, and a made-up threshold would
only look authoritative. The loader treats absent as meaningful and
rejects a present-but-nonsensical value.

## Scaling

`species.json` carries each animal's real-world `body_length_in` and the
`vitals_anchor` marking where the heart/lung centre sits within the
artwork, as a fraction of its width and height. Combined with the pixel
dimensions in `manifest.json`, that maps the ballistics engine's
real-inch drop and wind drift onto the drawing.

`body_length_in` is the real-world span of the drawing's *width*. For a
standing broadside animal that is its head-and-body length. Where the
artwork shows another posture it is that posture's span instead: the
hare is drawn sitting, so its 18in is rump-to-nose seated rather than
the 24-30in of a stretched-out hare.

### Placing the vitals anchor

By eye, against the drawing. Deriving it from the artwork does not work
and is not worth attempting - a heuristic that finds the shoulder crease
on a standing deer has nothing to say about a sitting hare, a strutting
turkey or a bird, and every species needs checking by eye anyway. Aim
for the crease just behind the front leg, roughly a third of the chest's
depth below the back line, and compare against the roe deer, whose
placement is the reference the others were matched to.

Those dimensions are typical figures from general wildlife references,
not authoritative measurements, and the artwork is stylised. The app
therefore lets the user override the reference size at runtime (in
inches, centimetres or metres) and remembers it per species.
