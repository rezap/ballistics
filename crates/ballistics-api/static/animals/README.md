# Animal silhouette artwork

One PNG per species, named in `snake_case` matching the species key used
by the animal data (for example `whitetail_deer.png`, `wild_hog.png`).

Do not hand-trim the surrounding margins. `scripts/inspect_silhouettes.py`
measures the exact subject bounding box in pixels, and that measurement is
what converts pixels to real-world inches - so an automated, precise
bounding box is both easier and more accurate than trimming by eye.

Reflections and drop shadows below the subject do need attention, because
the bounding box drives the pixel-to-inches scale: including a reflection
in it silently corrupts every real-world height derived from the image.
Run the inspect script and confirm visually before wiring in new artwork.
