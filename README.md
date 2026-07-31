# ballistics

A Rust rewrite of [pyBallistics](https://github.com/rezap/pyBallistics)
(itself a Python port of the GNU Ballistics Library), on its way to becoming
a web app that helps hunters visualize bullet drop, wind drift, and hit
point on game animals to support more ethical shot decisions.

See [`ROADMAP.md`](./ROADMAP.md) for the phased plan.

## Status

**Phase 1 complete:** the core point-mass ballistics engine is ported to
Rust, verified against golden values generated from the original Python
implementation, and feature-complete — all seven drag functions (G1, G2,
G3, G5, G6, G7, G8) are wired up, the rifle/load/atmosphere/shot profile is
fully configurable via `TrajectoryRequest`, and a latent upstream angle-unit
bug in cant/incline compensation has been fixed.

**Phase 2 in progress:** a web app (`ballistics-api`) now serves the engine
over HTTP with a browser UI. Next up is Phase 3 (the hunting shot
assistant).

## Workspace layout

- [`crates/ballistics-core`](./crates/ballistics-core) — the ballistics
  engine: drag models (G1/G2/G3/G5/G6/G7/G8, all fully wired up),
  atmospheric correction, zero-angle solving, wind resolution, the
  trajectory integrator, and a configurable `TrajectoryRequest` API.
- [`crates/ballistics-cli`](./crates/ballistics-cli) — a small demo binary
  that prints a bullet-drop-compensation table (mirrors pyBallistics'
  `example.py`).
- [`crates/ballistics-api`](./crates/ballistics-api) — an Axum web server
  exposing the engine over a JSON API, plus a static HTML/JS frontend
  (form inputs, a results table, and a canvas trajectory chart).

## Building and testing

```sh
cargo build --workspace
cargo test --workspace
cargo run -p ballistics-cli
```

## Running the web app

```sh
cargo run -p ballistics-api
```

Then open <http://localhost:3000> in a browser. Endpoints:

- `POST /api/trajectory` — solve a trajectory from a JSON `{ load, rifle, atmosphere?, shot? }` body (see `crates/ballistics-api/static/app.js` for a working example); returns an array of per-yard trajectory points.
- `GET /api/drag-functions` — list the supported drag functions.
- `GET /health` — liveness check.

Configuration is via environment variables: `BALLISTICS_API_ADDR` (default
`0.0.0.0:3000`) and `BALLISTICS_STATIC_DIR` (default `static`, relative to
the working directory the binary is run from).
