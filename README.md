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
bug in cant/incline compensation has been fixed. Next up is Phase 2, the
web app.

## Workspace layout

- [`crates/ballistics-core`](./crates/ballistics-core) — the ballistics
  engine: drag models (G1/G2/G3/G5/G6/G7/G8, all fully wired up),
  atmospheric correction, zero-angle solving, wind resolution, the
  trajectory integrator, and a configurable `TrajectoryRequest` API.
- [`crates/ballistics-cli`](./crates/ballistics-cli) — a small demo binary
  that prints a bullet-drop-compensation table (mirrors pyBallistics'
  `example.py`).

## Building and testing

```sh
cargo build --workspace
cargo test --workspace
cargo run -p ballistics-cli
```
