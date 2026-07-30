//! Physical and computation constants.
//!
//! Ported from `constants.py` in pyBallistics.

/// Gravitational acceleration, in ft/s^2 (signed, matches upstream).
pub const GRAVITY: f64 = -32.194;

/// Maximum number of yards the trajectory solver will compute before giving up.
pub const BALLISTICS_COMPUTATION_MAX_YARDS: u32 = 601;
