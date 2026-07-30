# Roadmap

Rust rewrite of [pyBallistics](https://github.com/rezap/pyBallistics) (a
Python port of the GNU Ballistics Library), aimed at a web application that
helps hunters make more ethical shot decisions by visualizing bullet drop,
wind drift and hit point on game animals.

## Phase 1 — Replicate, then complete, the engine in Rust

Goal: a `ballistics-core` crate whose numbers match pyBallistics bit-for-bit
(within floating-point tolerance) where pyBallistics is correct, and that
fixes the known upstream gaps, so Phase 2 builds on a verified, complete
foundation instead of re-deriving the physics.

- [x] Port `constants.py`, `drag.py` (G1/G2/G3/G5/G6/G7/G8 tables + `retard`),
      `angles.py` (unit conversions + `zero_angle` solver), `atmosphere.py`,
      `windage.py`, `utils.py` (moa/mil conversions, cant/incline
      compensation), and `ballistics.py` + `holdover.py` + `points.py`
      (the trajectory integrator) → `crates/ballistics-core`.
- [x] Golden-value parity tests generated directly from the Python source
      (see module-level `#[cfg(test)]` blocks and `tests/parity.rs`).
- [x] `ballistics-cli` demo binary mirroring `example.py`.
- [x] **1.1 Wire up G2/G3/G5/G6/G7/G8 into `retard()`.** Upstream Python only
      ever dispatched to G1 in `drag.retard()` — the dict lookup was built
      with a single `"G1"` key, so requesting any other drag function
      actually raised a `TypeError` there. All seven drag functions are now
      fully wired up in `drag::retard()` (see `drag::DragFunction::ALL` and
      the `every_drag_function_is_wired_up` test), so G7/G8 boat-tail match
      loads work as well as G1.
- [x] **1.2 Make the load/atmosphere/rifle profile configurable.** Added
      `profile::{Load, Rifle, Atmosphere, Shot, TrajectoryRequest}` — any BC,
      drag function, muzzle velocity, sight height, zero range, atmosphere
      and wind/angle can now be solved via `TrajectoryRequest::solve()`
      without editing code. `bdc::calc_bdc()` is kept as a thin wrapper
      around the specific hardcoded profile from upstream `bdc.py`, purely
      as a regression fixture against its golden values.
- [x] **1.3 Fix the incline/cant compensation angle-unit bug.**
      `utils.py`'s `get_incline_compensation`/`get_cant_compensation` fed
      angle arguments straight into `sin`/`cos` with no degrees→radians
      conversion, even though its only caller (`example.py`) passed degree
      values (`-15`, `90`). `utils::incline_compensation` /
      `utils::cant_compensation` now take degrees and convert internally;
      this is a deliberate, intentional divergence from the unfixed Python
      behavior (documented on both functions).
- [x] Property-style tests around the trajectory integrator: every drag
      function converges to a plausible zero angle and produces a finite,
      monotonically-timed trajectory (`zero_angle_converges_for_every_drag_function`,
      `solve_produces_a_sane_trajectory_for_every_drag_function`).

Phase 1 is now feature-complete. Remaining nice-to-haves, not blocking
Phase 2:
- [ ] Wider fuzz/property coverage (e.g. `proptest`) across extreme BCs,
      velocities, and step sizes, if issues show up in practice.
- [ ] Consider upstreaming the 1.3 angle-unit fix to pyBallistics itself.

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
