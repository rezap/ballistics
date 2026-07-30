//! `ballistics-core`: a point-mass exterior ballistics solver.
//!
//! This is a faithful Rust port of [pyBallistics](https://github.com/rezap/pyBallistics),
//! itself a Python port of the GNU Ballistics Library. It numerically
//! integrates a projectile's flight to produce bullet drop, wind drift and
//! elevation-hold tables for common small-arms drag models.
//!
//! Phase 1 goal: match the existing Python implementation's numbers
//! exactly (see the parity tests in each module and in `tests/parity.rs`),
//! including its current limitations (only [`DragFunction::G1`] is wired
//! into [`retard`]). See `ROADMAP.md` at the repository root for the
//! longer-term plan (full drag model support, then the hunting web app).

pub mod angles;
pub mod atmosphere;
pub mod bdc;
pub mod constants;
pub mod drag;
pub mod trajectory;
pub mod utils;
pub mod windage;

pub use bdc::calc_bdc;
pub use drag::{retard, DragError, DragFunction};
pub use trajectory::{point_at_range, solve, TrajectoryPoint};
