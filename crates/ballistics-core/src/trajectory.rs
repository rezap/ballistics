//! Full ballistic trajectory solution.
//!
//! Ported from `ballistics.py`, `holdover.py` and `points.py` in
//! pyBallistics. The Python `points`/`holdover` classes are collapsed here
//! into a plain [`TrajectoryPoint`] struct and `Vec<TrajectoryPoint>`.

use crate::angles::{deg_to_rad, rad_to_moa};
use crate::constants::{BALLISTICS_COMPUTATION_MAX_YARDS, GRAVITY};
use crate::drag::{retard, DragFunction};
use crate::utils::moa_to_inch;
use crate::windage;

/// One sampled range along a computed trajectory (one row per yard).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TrajectoryPoint {
    /// Downrange distance, in yards.
    pub yards: i64,
    /// Elevation correction needed at this range, in MOA.
    pub moa_correction: f64,
    /// Elevation correction converted to inches at this range.
    pub impact_in: f64,
    /// Bullet path relative to the line of sight, in inches (sign matches
    /// upstream: negative is below the line of sight before the zero
    /// crossing).
    pub path_inches: f64,
    /// Time of flight to this range, in seconds.
    pub seconds: f64,
    /// Horizontal wind drift, in inches (positive is toward the shooter's
    /// right when `wind_angle` is between 0 and 180 degrees). Computed from
    /// `windage.py`'s deflection formula, which upstream pyBallistics
    /// defines but never actually calls from `solve()` — only the
    /// along-track headwind/tailwind component (which affects drag) was
    /// wired in, not the crosswind deflection itself.
    pub windage_in: f64,
}

/// Looks up the trajectory point computed for an exact range in yards.
pub fn point_at_range(points: &[TrajectoryPoint], yards: i64) -> Option<&TrajectoryPoint> {
    points.iter().find(|p| p.yards == yards)
}

/// Python 3's `round()`: round half to even, for positive values.
fn python_round(value: f64) -> i64 {
    let floor = value.floor();
    let diff = value - floor;
    let floor_i = floor as i64;
    if diff < 0.5 {
        floor_i
    } else if diff > 0.5 {
        floor_i + 1
    } else if floor_i % 2 == 0 {
        floor_i
    } else {
        floor_i + 1
    }
}

/// Solves a full ballistic trajectory by numerical integration.
///
/// * `vi` - initial (muzzle) velocity, ft/s.
/// * `sight_height` - height of sight above bore centerline, inches.
/// * `shooting_angle` - uphill/downhill shot angle, degrees.
/// * `zero_angle` - bore angle relative to the sight, degrees (see
///   [`crate::angles::zero_angle`]).
/// * `wind_speed` - wind velocity, mi/hr.
/// * `wind_angle` - wind angle in degrees (0 = headwind, 90 = right-to-left,
///   180 = tailwind, 270/-90 = left-to-right).
///
/// Returns one [`TrajectoryPoint`] per yard of travel, until the shot drops
/// out of a sane flight envelope or [`BALLISTICS_COMPUTATION_MAX_YARDS`] is
/// reached.
#[allow(clippy::too_many_arguments)]
pub fn solve(
    drag_function: DragFunction,
    drag_coefficient: f64,
    vi: f64,
    sight_height: f64,
    shooting_angle: f64,
    zero_angle: f64,
    wind_speed: f64,
    wind_angle: f64,
) -> Vec<TrajectoryPoint> {
    let hwind = windage::headwind(wind_speed, wind_angle);
    let xwind = windage::crosswind(wind_speed, wind_angle);

    let gy = GRAVITY * deg_to_rad(shooting_angle + zero_angle).cos();
    let gx = GRAVITY * deg_to_rad(shooting_angle + zero_angle).sin();

    let mut vx = vi * deg_to_rad(zero_angle).cos();
    let mut vy = vi * deg_to_rad(zero_angle).sin();

    // y is in feet.
    let mut y = -sight_height / 12.0;
    let mut x = 0.0_f64;
    let mut t = 0.0_f64;
    let mut n: u32 = 0;

    let mut points = Vec::new();

    loop {
        let vx1 = vx;
        let vy1 = vy;
        let v = (vx.powi(2) + vy.powi(2)).sqrt();
        let dt = 0.5 / v;

        // Acceleration from drag retardation.
        let dv = retard(drag_function, drag_coefficient, v + hwind);
        let dvx = -(vx / v) * dv;
        let dvy = -(vy / v) * dv;

        // Velocity, including resolved gravity vectors.
        vx = vx + dt * dvx + dt * gx;
        vy = vy + dt * dvy + dt * gy;

        if x / 3.0 >= n as f64 {
            if x > 0.0 {
                let range_yards = python_round(x / 3.0);
                let moa_correction = -rad_to_moa((y / x).atan());
                let path_inches = y * 12.0;
                let impact_in = moa_to_inch(moa_correction, x);
                let seconds = t + dt;
                let windage_in = windage::windage(xwind, vi, x, seconds);
                points.push(TrajectoryPoint {
                    yards: range_yards,
                    moa_correction,
                    impact_in,
                    path_inches,
                    seconds,
                    windage_in,
                });
            }
            n += 1;
        }

        // Position from average velocity.
        x += dt * (vx + vx1) / 2.0;
        y += dt * (vy + vy1) / 2.0;

        if vy.abs() > (3.0 * vx).abs() || n >= BALLISTICS_COMPUTATION_MAX_YARDS {
            break;
        }

        t += dt;
    }

    points
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_round_matches_builtin_semantics() {
        assert_eq!(python_round(2.4), 2);
        assert_eq!(python_round(2.6), 3);
        assert_eq!(python_round(2.5), 2); // round-half-to-even
        assert_eq!(python_round(3.5), 4); // round-half-to-even
    }

    #[test]
    fn solve_produces_a_sane_trajectory_for_every_drag_function() {
        for func in DragFunction::ALL {
            let bc = 0.4;
            let vi = 2800.0;
            let zero_angle = crate::angles::zero_angle(func, bc, vi, 1.5, 100.0, 0.0);
            let points = solve(func, bc, vi, 1.5, 0.0, zero_angle, 10.0, 90.0);

            assert!(!points.is_empty(), "{func} produced no trajectory points");
            assert!(
                points.len() as u32 <= BALLISTICS_COMPUTATION_MAX_YARDS,
                "{func} exceeded the max computed range"
            );

            let mut previous_seconds = 0.0;
            for point in &points {
                assert!(point.seconds.is_finite(), "{func} produced non-finite time");
                assert!(
                    point.path_inches.is_finite(),
                    "{func} produced non-finite path"
                );
                assert!(
                    point.seconds > previous_seconds,
                    "{func} time of flight did not increase monotonically"
                );
                previous_seconds = point.seconds;
            }
        }
    }

    #[test]
    fn windage_is_zero_for_a_pure_headwind() {
        let bc = 0.4;
        let vi = 2800.0;
        let zero_angle = crate::angles::zero_angle(DragFunction::G1, bc, vi, 1.5, 100.0, 0.0);
        // wind_angle 0 = pure headwind, no crosswind component.
        let points = solve(DragFunction::G1, bc, vi, 1.5, 0.0, zero_angle, 10.0, 0.0);
        for point in &points {
            assert!(
                point.windage_in.abs() < 1e-9,
                "expected ~0 windage with a pure headwind, got {} at {} yards",
                point.windage_in,
                point.yards
            );
        }
    }

    #[test]
    fn windage_grows_with_range_for_a_crosswind() {
        let bc = 0.4;
        let vi = 2800.0;
        let zero_angle = crate::angles::zero_angle(DragFunction::G1, bc, vi, 1.5, 100.0, 0.0);
        // wind_angle 90 = full crosswind, from the shooter's right.
        let points = solve(DragFunction::G1, bc, vi, 1.5, 0.0, zero_angle, 10.0, 90.0);

        let at_100 = point_at_range(&points, 100).unwrap();
        let at_400 = point_at_range(&points, 400).unwrap();

        assert!(at_100.windage_in.is_finite());
        assert!(at_400.windage_in.is_finite());
        assert!(
            at_400.windage_in.abs() > at_100.windage_in.abs(),
            "windage should grow with range: {} at 100yd vs {} at 400yd",
            at_100.windage_in,
            at_400.windage_in
        );
    }
}
