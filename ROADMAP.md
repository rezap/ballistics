# Roadmap

Rust rewrite of [pyBallistics](https://github.com/rezap/pyBallistics) (a
Python port of the GNU Ballistics Library), aimed at a web application that
helps hunters make more ethical shot decisions by visualizing bullet drop,
wind drift and hit point on game animals.

## Phase 1 — Replicate the Python engine in Rust (this commit starts it)

Goal: a `ballistics-core` crate whose numbers match pyBallistics bit-for-bit
(within floating-point tolerance), so later phases build on a verified
foundation instead of re-deriving the physics.

- [x] Port `constants.py`, `drag.py` (G1/G2/G3/G5/G6/G7/G8 tables + `retard`),
      `angles.py` (unit conversions + `zero_angle` solver), `atmosphere.py`,
      `windage.py`, `utils.py` (moa/mil conversions, cant/incline
      compensation), and `ballistics.py` + `holdover.py` + `points.py`
      (the trajectory integrator) → `crates/ballistics-core`.
- [x] Golden-value parity tests generated directly from the Python source
      (see module-level `#[cfg(test)]` blocks and `tests/parity.rs`).
- [x] `ballistics-cli` demo binary mirroring `example.py`.
- [ ] **1.1 Wire up G2/G3/G5/G6/G7/G8 into `retard()`.** Upstream Python only
      ever dispatches to G1 in `drag.retard()` — the dict lookup is built
      with a single `"G1"` key, so requesting any other drag function
      actually raises a `TypeError` in the Python code. This Rust port
      mirrors that (as a typed `DragError` instead of a panic) for faithful
      Phase 1 parity. Real projectiles use G1 or G7 depending on bullet
      shape, so this needs fixing before the app is useful for boat-tail /
      VLD bullets commonly used in hunting.
- [ ] **1.2 Make the load/atmosphere/rifle profile configurable.** Both
      `bdc.py`/`bdc.rs` hardcode a single reference rifle+load+atmosphere and
      `calcBDC()`'s `range` argument is unused upstream — `calc_bdc()`
      matches that today. Replace with a proper `TrajectoryInput`/`Rifle`/
      `Load`/`Atmosphere` struct so any BC, muzzle velocity, sight height,
      zero range, and weather can be simulated (needed for phase 2).
- [ ] **1.3 Review the incline/cant compensation angle-unit quirk.**
      `utils.py`'s `get_incline_compensation`/`get_cant_compensation` feed
      angle arguments straight into `sin`/`cos` with no degrees→radians
      conversion (`example.py` calls them with `-15` and `90`, i.e. degrees,
      which is almost certainly a bug upstream). Decide the correct
      behavior and fix it in both this port and (optionally) upstream
      pyBallistics.
- [ ] Property/fuzz tests around the trajectory integrator (e.g. dt/step
      stability, extreme BCs) once the above are settled.

## Phase 2 — Web application

- [ ] `ballistics-api`: Axum-based HTTP API wrapping `ballistics-core` —
      endpoints for trajectory tables, wind drift at range, and energy /
      velocity retention.
- [ ] `ballistics-web`: browser front end (server-rendered + a small amount
      of client JS/charting, or a Rust/WASM UI — to be decided) consuming
      the API. Inputs: rifle/load/zero/atmosphere/wind; outputs: a
      drop/drift table and a range chart.
- [ ] Persist common rifle/load presets (SQLite via `sqlx` or similar).
- [ ] Deployment: containerize `ballistics-api` + static frontend assets.

## Phase 3 — Ethical hunting shot assistant

- [ ] Game animal database: species, vital (kill) zone dimensions and
      typical broadside/quartering silhouette, by species (e.g. whitetail
      deer, elk, hogs, etc.).
- [ ] Given a rifle/load and a range + wind, compute point of impact
      relative to point of aim and overlay it on the animal's vital zone to
      flag hits likely to be non-lethal or wounding.
- [ ] Ethical range recommendation: combine group size (precision), drop,
      wind drift, and retained energy/velocity to suggest a maximum ethical
      range per species/cartridge combination, with clear caveats that this
      is decision support, not a guarantee.
- [ ] Polish UI/UX for use in the field (mobile-friendly, offline-capable).

## Non-goals (for now)

- Spin drift, Coriolis effect, and other advanced 6-DOF effects — the
  point-mass model here targets typical hunting ranges, consistent with the
  scope of the original GNU Ballistics Library / pyBallistics.
