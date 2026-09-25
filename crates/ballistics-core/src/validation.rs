//! Rejects inputs that are non-physical or that could send the point-mass
//! integrator into pathological behaviour - dividing by a near-zero
//! velocity, say, or an unbounded zero range keeping the zero-angle search
//! running far longer than any real rifle setup would need.
//!
//! Lives in the core rather than beside the HTTP handlers because there is
//! more than one caller. The server checks a request before solving it, and
//! so does the WebAssembly build that solves in the browser. Two copies of
//! these rules would be two chances for the browser and the server to
//! disagree about what counts as a valid shot.
//!
//! Every failure is a `&'static str` naming the field and its bound, so a
//! caller can hand it straight back to the person who typed the number.

use crate::profile::{Atmosphere, Load, Rifle, Shot, TrajectoryRequest};

/// Checks a complete request: the load, then the conditions it is fired in.
pub fn validate_request(request: &TrajectoryRequest) -> Result<(), &'static str> {
    validate_load(&request.load)?;
    validate_conditions(&request.rifle, &request.atmosphere, &request.shot)
}

/// The ammunition on its own.
pub fn validate_load(load: &Load) -> Result<(), &'static str> {
    first_failure(&[
        (
            load.ballistic_coefficient.is_finite() && load.ballistic_coefficient > 0.0,
            "load.ballistic_coefficient must be a positive, finite number",
        ),
        (
            load.muzzle_velocity.is_finite()
                && load.muzzle_velocity > 0.0
                && load.muzzle_velocity < 10_000.0,
            "load.muzzle_velocity must be between 0 and 10000 ft/s",
        ),
        (
            load.bullet_weight_gr.is_finite()
                && load.bullet_weight_gr > 0.0
                && load.bullet_weight_gr < 20_000.0,
            "load.bullet_weight_gr must be between 0 and 20000 grains",
        ),
    ])
}

/// Everything that is not the ammunition: the rifle it is fired from, the
/// air it flies through and the shot being taken. Split out because ranking
/// the catalogue holds these fixed while varying the load, so they are
/// checked once rather than once per catalogue entry.
pub fn validate_conditions(
    rifle: &Rifle,
    atmosphere: &Atmosphere,
    shot: &Shot,
) -> Result<(), &'static str> {
    first_failure(&[
        (
            rifle.sight_height.is_finite() && rifle.sight_height.abs() < 100.0,
            "rifle.sight_height must be a plausible number of inches",
        ),
        (
            rifle.zero_range.is_finite() && rifle.zero_range > 0.0 && rifle.zero_range <= 1000.0,
            "rifle.zero_range must be between 0 and 1000 yards",
        ),
        (
            rifle.zero_y_intercept.is_finite(),
            "rifle.zero_y_intercept must be finite",
        ),
        (
            atmosphere.pressure.is_finite() && atmosphere.pressure > 0.0,
            "atmosphere.pressure must be a positive number of in-Hg",
        ),
        (
            atmosphere.temperature.is_finite()
                && atmosphere.temperature > -100.0
                && atmosphere.temperature < 150.0,
            "atmosphere.temperature must be a plausible Fahrenheit value",
        ),
        (
            (0.0..=1.0).contains(&atmosphere.relative_humidity),
            "atmosphere.relative_humidity must be between 0 and 1",
        ),
        (
            atmosphere.altitude.is_finite() && atmosphere.altitude.abs() < 30_000.0,
            "atmosphere.altitude must be a plausible number of feet",
        ),
        (
            shot.shooting_angle.is_finite() && shot.shooting_angle.abs() < 89.0,
            "shot.shooting_angle must be between -89 and 89 degrees",
        ),
        (
            shot.wind_speed.is_finite() && (0.0..200.0).contains(&shot.wind_speed),
            "shot.wind_speed must be between 0 and 200 mph",
        ),
    ])
}

fn first_failure(checks: &[(bool, &'static str)]) -> Result<(), &'static str> {
    match checks.iter().find(|(ok, _)| !ok) {
        Some((_, message)) => Err(message),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drag::DragFunction;

    fn valid_request() -> TrajectoryRequest {
        TrajectoryRequest {
            load: Load {
                drag_function: DragFunction::G7,
                ballistic_coefficient: 0.243,
                muzzle_velocity: 2700.0,
                bullet_weight_gr: 168.0,
            },
            rifle: Rifle {
                sight_height: 1.7,
                zero_range: 100.0,
                zero_y_intercept: 0.0,
            },
            atmosphere: Atmosphere::standard(),
            shot: Shot::default(),
        }
    }

    /// Asserts the request is rejected *for the stated reason*, not merely
    /// rejected. Before the move these tests only checked `is_err()`, which
    /// would have passed just as happily had the wrong rule fired.
    fn rejected_for(request: &TrajectoryRequest, field: &str) {
        match validate_request(request) {
            Ok(()) => panic!("expected {field} to be rejected, but the request passed"),
            Err(message) => assert!(
                message.starts_with(field),
                "expected a {field} error, got: {message}"
            ),
        }
    }

    #[test]
    fn accepts_a_sane_request() {
        assert_eq!(validate_request(&valid_request()), Ok(()));
    }

    #[test]
    fn rejects_non_positive_muzzle_velocity() {
        let mut request = valid_request();
        request.load.muzzle_velocity = 0.0;
        rejected_for(&request, "load.muzzle_velocity");
        request.load.muzzle_velocity = -100.0;
        rejected_for(&request, "load.muzzle_velocity");
    }

    #[test]
    fn rejects_implausible_bullet_weight() {
        let mut request = valid_request();
        for weight in [0.0, -20.0, 1e9] {
            request.load.bullet_weight_gr = weight;
            rejected_for(&request, "load.bullet_weight_gr");
        }
    }

    #[test]
    fn rejects_non_positive_ballistic_coefficient() {
        let mut request = valid_request();
        request.load.ballistic_coefficient = 0.0;
        rejected_for(&request, "load.ballistic_coefficient");
    }

    #[test]
    fn rejects_unbounded_zero_range() {
        let mut request = valid_request();
        for range in [1e9, 0.0] {
            request.rifle.zero_range = range;
            rejected_for(&request, "rifle.zero_range");
        }
    }

    #[test]
    fn rejects_out_of_range_humidity_and_nan() {
        let mut request = valid_request();
        for humidity in [1.5, f64::NAN] {
            request.atmosphere.relative_humidity = humidity;
            rejected_for(&request, "atmosphere.relative_humidity");
        }
    }

    #[test]
    fn rejects_extreme_shooting_angle() {
        let mut request = valid_request();
        request.shot.shooting_angle = 90.0;
        rejected_for(&request, "shot.shooting_angle");
    }

    #[test]
    fn the_load_is_checked_before_the_conditions() {
        // Two faults at once: the message names the load, which is the one a
        // person is more likely to have just typed.
        let mut request = valid_request();
        request.load.muzzle_velocity = 0.0;
        request.rifle.zero_range = 0.0;
        rejected_for(&request, "load.muzzle_velocity");
    }

    #[test]
    fn conditions_validate_without_a_load() {
        let request = valid_request();
        assert_eq!(
            validate_conditions(&request.rifle, &request.atmosphere, &request.shot),
            Ok(())
        );

        let mut bad = request;
        bad.rifle.zero_range = 0.0;
        assert_eq!(
            validate_conditions(&bad.rifle, &bad.atmosphere, &bad.shot),
            Err("rifle.zero_range must be between 0 and 1000 yards")
        );
    }
}
