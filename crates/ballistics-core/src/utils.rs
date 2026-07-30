//! Unit conversions and cant/incline compensation.
//!
//! Ported from `utils.py` in pyBallistics.

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

/// Incline compensation for the bullet path, given an incline angle.
///
/// NOTE: matches `get_incline_compensation()` in pyBallistics, which passes
/// `incline_angle` straight into `cos()` without a degrees-to-radians
/// conversion. That quirk is preserved here for numeric parity; feeding in a
/// degree value (as the upstream `example.py` does) is very likely a latent
/// bug in the source project, tracked for review in `ROADMAP.md` Phase 1.1.
pub fn incline_compensation(path_inches: f64, incline_angle: f64) -> f64 {
    -(path_inches * incline_angle.cos())
}

/// Cant compensation `(horizontal_error, vertical_error)`, both in inches.
///
/// Same caveat as [`incline_compensation`]: `cant_angle` is used directly in
/// `sin()`/`cos()` with no unit conversion, matching upstream.
///
/// Source: <https://www.empyrealsciences.com/Estimation%20of%20Shot%20Error%20due%20to%20Rifle%20Cant.pdf>
pub fn cant_compensation(time_of_flight: f64, cant_angle: f64, sight_height: f64) -> (f64, f64) {
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
        approx(incline_compensation(-10.0, -15.0), -7.596879128588213);

        let (h, v) = cant_compensation(0.5, 90.0, 1.5);
        approx(h, 3.7030459302164607);
        approx(v, -5.998101927209039);
    }
}
