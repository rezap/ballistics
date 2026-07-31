//! Unit conversions and cant/incline compensation.
//!
//! Ported from `utils.py` in pyBallistics.

use crate::angles::deg_to_rad;

/// Converts minutes of angle to milliradians.
pub fn moa_to_mil(moa: f64) -> f64 {
    moa * 0.29088821
}

/// Converts an angle in milliradians, subtending `feet` of range, to inches.
pub fn mil_to_inch(mil: f64, feet: f64) -> f64 {
    (feet * 12.0) * (mil / 1000.0)
}

/// Converts an angle in minutes of angle, subtending `feet` of range, to inches.
pub fn moa_to_inch(moa: f64, feet: f64) -> f64 {
    mil_to_inch(moa_to_mil(moa), feet)
}

/// Initial upward velocity (ft/s) used in the cant compensation calculation.
///
/// * `sight_height` - distance of sight above bore height, in inches.
/// * `time_of_flight` - total time of flight to the target, in seconds.
///
/// Source: <https://www.empyrealsciences.com/Estimation%20of%20Shot%20Error%20due%20to%20Rifle%20Cant.pdf>
pub fn initial_upward_velocity(sight_height: f64, time_of_flight: f64) -> f64 {
    (sight_height / 12.0) / time_of_flight + 0.5 * 32.137 * time_of_flight
}

/// Incline compensation for the bullet path, given an incline angle in
/// degrees.
///
/// NOTE: upstream pyBallistics' `get_incline_compensation()` passes its
/// angle argument straight into `math.cos()` with no degrees-to-radians
/// conversion, even though its only caller (`example.py`) passes a degree
/// value (`-15`). That's a latent bug in the source project (see
/// `ROADMAP.md` Phase 1.3) — this port takes `incline_angle` in degrees and
/// converts it, so numeric results differ from the unfixed Python for this
/// function specifically.
pub fn incline_compensation(path_inches: f64, incline_angle: f64) -> f64 {
    -(path_inches * deg_to_rad(incline_angle).cos())
}

/// Cant compensation `(horizontal_error, vertical_error)`, both in inches,
/// given a cant angle in degrees.
///
/// Same fix as [`incline_compensation`]: `cant_angle` is now converted from
/// degrees before use in `sin()`/`cos()`.
///
/// Source: <https://www.empyrealsciences.com/Estimation%20of%20Shot%20Error%20due%20to%20Rifle%20Cant.pdf>
pub fn cant_compensation(time_of_flight: f64, cant_angle: f64, sight_height: f64) -> (f64, f64) {
    let cant_angle = deg_to_rad(cant_angle);
    let v0 = initial_upward_velocity(sight_height, time_of_flight);
    let horizontal_error = (v0 * cant_angle.sin()) * time_of_flight;
    let vertical_error = -(v0 * (1.0 - cant_angle.cos())) * time_of_flight;
    (horizontal_error, vertical_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9 * b.abs().max(1.0), "{a} !~= {b}");
    }

    #[test]
    fn matches_python_golden_values() {
        approx(moa_to_mil(1.0), 0.29088821);
        approx(mil_to_inch(1.0, 100.0), 1.2);
        approx(moa_to_inch(1.0, 100.0), 0.34906585199999995);
        approx(initial_upward_velocity(1.5, 0.5), 8.28425);
    }

    #[test]
    fn incline_compensation_treats_angle_as_degrees() {
        // A level (0 degree) incline should not change the path at all.
        approx(incline_compensation(-10.0, 0.0), 10.0);
        // A 90 degree incline (shooting straight up/down the slope) zeroes
        // out the horizontal-equivalent path.
        approx(incline_compensation(-10.0, 90.0), 0.0);
        // Matches -(path * cos(deg_to_rad(angle))) computed directly.
        approx(
            incline_compensation(-10.0, -15.0),
            -(-10.0 * deg_to_rad(-15.0).cos()),
        );
    }

    #[test]
    fn cant_compensation_treats_angle_as_degrees() {
        // No cant (0 degrees) should produce no horizontal error and no
        // vertical error.
        let (h, v) = cant_compensation(0.5, 0.0, 1.5);
        assert!(h.abs() < 1e-9, "expected ~0 horizontal error, got {h}");
        assert!(v.abs() < 1e-9, "expected ~0 vertical error, got {v}");

        // Matches the formula computed directly with a proper conversion.
        let (h, v) = cant_compensation(0.5, 90.0, 1.5);
        let cant_angle = deg_to_rad(90.0);
        let v0 = initial_upward_velocity(1.5, 0.5);
        approx(h, (v0 * cant_angle.sin()) * 0.5);
        approx(v, -(v0 * (1.0 - cant_angle.cos())) * 0.5);
    }
}
