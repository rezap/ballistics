//! Wind deflection and wind-angle resolution.
//!
//! Ported from `windage.py` in pyBallistics.

use crate::angles::deg_to_rad;

/// Computes windage deflection (in inches) for a given crosswind speed
/// (mi/hr), muzzle velocity `vi` (ft/s), range `x` (ft) and real flight
/// time `t` (s) to reach that range.
pub fn windage(wind_speed: f64, vi: f64, x: f64, t: f64) -> f64 {
    // Convert to inches per second.
    let vw = wind_speed * 17.60;
    vw * (t - x / vi)
}

/// Resolves a wind speed/angle combination into its headwind component
/// (mi/hr). Positive at `wind_angle == 0` (wind from straight ahead).
///
/// `wind_angle` conventions: 0 = headwind, 90 = right-to-left, 180 =
/// tailwind, 270/-90 = left-to-right.
pub fn headwind(wind_speed: f64, wind_angle: f64) -> f64 {
    let w_angle = deg_to_rad(wind_angle);
    w_angle.cos() * wind_speed
}

/// Resolves a wind speed/angle combination into its crosswind component
/// (mi/hr). Positive is shooter's right to left (wind from 90 degrees).
pub fn crosswind(wind_speed: f64, wind_angle: f64) -> f64 {
    let w_angle = deg_to_rad(wind_angle);
    w_angle.sin() * wind_speed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9 * b.abs().max(1.0), "{a} !~= {b}");
    }

    #[test]
    fn matches_python_golden_values() {
        approx(headwind(10.0, 0.0), 10.0);
        approx(crosswind(10.0, 90.0), 10.0);
        approx(headwind(10.0, 45.0), 7.0710678118654755);
        approx(crosswind(10.0, 45.0), 7.071067811865475);
        approx(windage(10.0, 3165.0, 1200.0, 0.4), 3.6701421800947953);
    }
}
