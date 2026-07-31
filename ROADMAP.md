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

- [x] `ballistics-api`: Axum-based HTTP API wrapping `ballistics-core`.
      `POST /api/trajectory` takes a JSON `TrajectoryRequest` (load/rifle/
      atmosphere/shot — atmosphere and shot are optional, defaulting to
      standard atmosphere and a flat, windless shot) and returns the full
      per-yard trajectory; `GET /api/drag-functions` lists the supported
      drag models; `GET /health` is a liveness check. Untrusted input is
      validated (positive/finite BC, velocity, pressure, humidity in
      [0,1], bounded zero range/angle/wind) and the solve itself runs in
      `spawn_blocking` with a 5s timeout, so a request can't hang a worker
      thread indefinitely.
- [x] Frontend: a static HTML/CSS/vanilla-JS page (`crates/ballistics-api/static`)
      served directly by Axum via `tower-http`'s `ServeDir` — a form for
      rifle/load/atmosphere/shot inputs, a decimated results table, and a
      hand-drawn `<canvas>` chart of bullet path vs. range. No Node/WASM
      build step; chosen for fastest path to a working Phase 2 over a
      Leptos/WASM or server-rendered+htmx alternative (revisit if the UI
      outgrows vanilla JS).
- [ ] Persist common rifle/load presets (SQLite via `sqlx` or similar).
- [x] Deployment: containerize `ballistics-api` + static frontend assets.
      A multi-stage `Dockerfile` builds the release binary and packages it
      with its `static/` assets; `render.yaml` and `railway.json` let
      Render or Railway build and deploy it directly from the GitHub repo
      with no manual configuration. The server also honors a bare `PORT`
      env var (falling back to it when `BALLISTICS_API_ADDR` isn't set),
      matching the convention most PaaS providers use. Live at
      `ballistics-production-2c51.up.railway.app`.

## Phase 3 — Ethical hunting shot assistant

- [x] **Game animal database** (`ballistics-core::animals`): per-species
      vital (heart/lung) zone dimensions (modeled as a width x height
      ellipse, broadside), male/female shoulder height and weight ranges,
      habitat, diet, and fun facts, compiled from hunting and wildlife-
      biology sources (cited in `animals.rs` doc comments). Exposed via
      `GET /api/animals`. Two species fully implemented so far, to prove
      the data model and pipeline scale before filling in the rest:
      - [x] Whitetail deer (*Odocoileus virginianus*)
      - [x] Wild hog (*Sus scrofa*)
      - [ ] Roe deer
      - [ ] Red deer (stag)
      - [ ] Fallow deer
      - [ ] Elk (wapiti)
      - [ ] American moose
      - [ ] European moose (elk)
      - [ ] Fox
      - [ ] Hare

      To add one: add a `Species` enum variant, a `match` arm in
      `animals::profile()` following the existing two as a template
      (web-search shoulder height/weight/vitals/habitat/diet/fun-facts
      and cite sources in a doc comment above the arm, the same way), and
      add it to `Species::ALL`. No frontend changes needed — the species
      dropdown, vitals overlay, and info panel are all data-driven.
- [x] **Fixed a real engine gap needed for this**: `windage.py`'s
      crosswind deflection formula was ported to Rust in Phase 1
      (`windage::windage()`) but never actually wired into `solve()` —
      only the along-track headwind/tailwind component (which affects
      drag) was used. `TrajectoryPoint` now also carries `windage_in`
      (horizontal drift, inches), computed per point, which is what makes
      a horizontal miss distance available for the vitals assessment
      below.
- [x] Given a rifle/load and a shot range, compute point of impact
      relative to point of aim (vertical: `path_inches`; horizontal:
      `windage_in`) and assess it against the selected species' vital
      zone, modeled as an ellipse centered on point of aim
      (`VitalZone::assess`, tested for center/edge/outside cases). The
      frontend renders this as a canvas overlay (vitals ellipse + a
      green/red impact marker) plus an info panel (sizes, habitat, diet,
      fun facts), and both update live from the already-fetched
      trajectory when the species or shot range changes — no extra
      network round-trip.
- [ ] Ethical range recommendation: combine group size (precision), drop,
      wind drift, and retained energy/velocity to suggest a maximum ethical
      range per species/cartridge combination, with clear caveats that this
      is decision support, not a guarantee.
- [ ] Quartering-angle silhouettes (not just broadside) — several fun
      facts already flag that shot placement differs a lot by angle
      (e.g. wild hog's shoulder "shield" mostly matters broadside).
- [ ] Polish UI/UX for use in the field (mobile-friendly, offline-capable).

## Non-goals (for now)

- Spin drift, Coriolis effect, and other advanced 6-DOF effects — the
  point-mass model here targets typical hunting ranges, consistent with the
  scope of the original GNU Ballistics Library / pyBallistics.
