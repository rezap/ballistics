//! Angular conversions and the zero-angle solver.
//!
//! Ported from `angles.py` in pyBallistics.

use std::f64::consts::PI;

use crate::constants::GRAVITY;
use crate::drag::{retard, DragFunction};

/// Converts degrees to minutes of angle.
pub fn deg_to_moa(deg: f64) -> f64 {
    deg * 60.0
}

/// Converts degrees to radians.
pub fn deg_to_rad(deg: f64) -> f64 {
    deg * PI / 180.0
}

/// Converts minutes of angle to degrees.
pub fn moa_to_deg(moa: f64) -> f64 {
    moa / 60.0
}

/// Converts minutes of angle to radians.
pub fn moa_to_rad(moa: f64) -> f64 {
    moa / 60.0 * PI / 180.0
}

/// Converts radians to degrees.
pub fn rad_to_deg(rad: f64) -> f64 {
    rad * 180.0 / PI
}

/// Converts radians to minutes of angle.
pub fn rad_to_moa(rad: f64) -> f64 {
    rad * 60.0 * 180.0 / PI
}

/// Determines the bore angle (in degrees) needed to achieve a target zero
/// at `zero_range` yards (at standard conditions and on level ground), by
/// successive approximation.
///
/// * `vi` - initial velocity of the projectile, in feet/s.
/// * `sight_height` - height of the sighting system above the bore
///   centerline, in inches.
/// * `zero_range` - range in yards at which the projectile should intersect
///   `y_intercept`.
/// * `y_intercept` - height, in inches, the projectile should be at when it
///   crosses `zero_range` yards. Usually 0 for a target zero.
///
/// Returns the angle of the bore relative to the sighting system, in
/// degrees.
pub fn zero_angle(
    drag_function: DragFunction,
    drag_coefficient: f64,
    vi: f64,
    sight_height: f64,
    zero_range: f64,
    y_intercept: f64,
) -> f64 {
    let mut angle = 0.0_f64;
    // Start with a coarse angular step and halve it every time we cross the
    // target elevation, converging on the correct zero angle.
    let mut da = deg_to_rad(14.0);

    loop {
        angle += da;
        let mut vy = vi * angle.sin();
        let mut vx = vi * angle.cos();
        let gx = GRAVITY * angle.sin();
        let gy = GRAVITY * angle.cos();

        let mut x = 0.0_f64;
        let mut y = -sight_height / 12.0;

        while x <= zero_range * 3.0 {
            let vy1 = vy;
            let vx1 = vx;
            let v = (vx.powi(2) + vy.powi(2)).sqrt();
            let dt = 1.0 / v;

            let dv = retard(drag_function, drag_coefficient, v);
            let dvy = -dv * vy / v * dt;
            let dvx = -dv * vx / v * dt;

            vx += dvx;
            vy += dvy;
            vy += dt * gy;
            vx += dt * gx;

            x += dt * (vx + vx1) / 2.0;
            y += dt * (vy + vy1) / 2.0;

            // Break early to save time if we won't find a solution.
            if vy < 0.0 && y < y_intercept {
                break;
            }
            if vy > 3.0 * vx {
                break;
            }
        }

        if y > y_intercept && da > 0.0 {
            da = -da / 2.0;
        }
        if y < y_intercept && da < 0.0 {
            da = -da / 2.0;
        }

        let converged = da.abs() < moa_to_rad(0.01);
        let overshot = angle > deg_to_rad(45.0);

        angle += da;

        if converged || overshot {
            break;
        }
    }

    rad_to_deg(angle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9 * b.abs().max(1.0), "{a} !~= {b}");
    }

    #[test]
    fn conversions_match_python_golden_values() {
        approx(deg_to_moa(10.0), 600.0);
        approx(deg_to_rad(45.0), std::f64::consts::FRAC_PI_4);
        approx(moa_to_deg(60.0), 1.0);
        approx(moa_to_rad(60.0), 0.017453292519943295);
        approx(rad_to_deg(1.0), 57.29577951308232);
        approx(rad_to_moa(1.0), 3437.7467707849396);
    }

    #[test]
    fn zero_angle_matches_python_golden_value() {
        let angle = zero_angle(DragFunction::G1, 0.269, 3165.0, 1.5, 50.0, 0.0);
        approx(angle, 0.061843872070312486);
    }

    #[test]
    fn zero_angle_converges_for_every_drag_function() {
        for func in DragFunction::ALL {
            let angle = zero_angle(func, 0.4, 2800.0, 1.5, 100.0, 0.0);
            assert!(angle.is_finite(), "{func} produced non-finite zero angle");
            // A sane 100-yard zero for a modern centerfire load is a small,
            // positive bore angle (well under the 45 degree search bound).
            assert!(
                angle > 0.0 && angle < 5.0,
                "{func} produced implausible zero angle {angle}"
            );
        }
    }
}
