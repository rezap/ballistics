//! `ballistics-core`: a point-mass exterior ballistics solver.
//!
//! This is a Rust port of [pyBallistics](https://github.com/rezap/pyBallistics),
//! itself a Python port of the GNU Ballistics Library. It numerically
//! integrates a projectile's flight to produce bullet drop, wind drift and
//! elevation-hold tables for common small-arms drag models (G1, G2, G3,
//! G5, G6, G7, G8 — all fully wired up, unlike upstream pyBallistics,
//! which only ever dispatches G1).
//!
//! Use [`TrajectoryRequest`] to solve an arbitrary rifle/load/atmosphere/
//! shot combination; [`calc_bdc`] reproduces the specific reference load
//! hardcoded by upstream pyBallistics' `calcBDC()`, kept mainly as a
//! regression fixture against its golden values.
//!
//! See `ROADMAP.md` at the repository root for the longer-term plan (the
//! Phase 2 web app, then Phase 3's hunting shot assistant).

pub mod angles;
pub mod animals;
pub mod atmosphere;
pub mod bdc;
pub mod constants;
pub mod drag;
pub mod energy;
pub mod profile;
pub mod trajectory;
pub mod utils;
pub mod windage;

pub use animals::{HitAssessment, VitalZone};
pub use bdc::calc_bdc;
pub use drag::{retard, DragFunction, ParseDragFunctionError};
pub use profile::{Atmosphere, Load, Rifle, Shot, TrajectoryRequest};
pub use trajectory::{point_at_range, solve, TrajectoryPoint};
