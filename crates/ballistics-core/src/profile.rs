//! Configurable rifle/load/atmosphere/shot inputs for solving a trajectory.
//!
//! `bdc::calc_bdc()` (and upstream pyBallistics' `calcBDC()`) hardcode a
//! single reference profile. This module generalizes that into
//! independently adjustable inputs so any bullet, rifle setup, atmosphere
//! and shot geometry can be solved without editing code — the foundation
//! the Phase 2 web app will build its API on.

use crate::angles;
use crate::atmosphere;
use crate::drag::DragFunction;
use crate::trajectory::{self, TrajectoryPoint};

/// The projectile and its muzzle velocity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Load {
    pub drag_function: DragFunction,
    /// Ballistic coefficient for `drag_function`, before atmospheric correction.
    pub ballistic_coefficient: f64,
    /// Muzzle velocity, ft/s.
    pub muzzle_velocity: f64,
}

/// Sight and zeroing geometry.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rifle {
    /// Height of the sighting system above the bore centerline, inches.
    pub sight_height: f64,
    /// Range at which the rifle is zeroed, yards.
    pub zero_range: f64,
    /// Bullet path height at `zero_range`, inches. Usually 0.
    pub zero_y_intercept: f64,
}

/// Atmospheric conditions used to correct the ballistic coefficient.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Atmosphere {
    /// Altitude above sea level, feet.
    pub altitude: f64,
    /// Barometric pressure, in-Hg.
    pub pressure: f64,
    /// Temperature, Fahrenheit.
    pub temperature: f64,
    /// Relative humidity, 0.0-1.0.
    pub relative_humidity: f64,
}

impl Atmosphere {
    /// Standard atmosphere: sea level, 29.53 in-Hg, 59F, 78% humidity.
    pub fn standard() -> Self {
        Self {
            altitude: 0.0,
            pressure: 29.53,
            temperature: 59.0,
            relative_humidity: 0.78,
        }
    }
}

impl Default for Atmosphere {
    fn default() -> Self {
        Self::standard()
    }
}

/// Shot geometry: uphill/downhill angle and wind.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Shot {
    /// Uphill (positive) / downhill (negative) shot angle, degrees.
    pub shooting_angle: f64,
    /// Wind speed, mi/hr.
    pub wind_speed: f64,
    /// Wind angle, degrees (0 = headwind, 90 = right-to-left, 180 =
    /// tailwind, 270/-90 = left-to-right).
    pub wind_angle: f64,
}

/// A full set of inputs needed to solve a trajectory.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrajectoryRequest {
    pub load: Load,
    pub rifle: Rifle,
    pub atmosphere: Atmosphere,
    pub shot: Shot,
}

impl TrajectoryRequest {
    /// Corrects the ballistic coefficient for `atmosphere`, solves for the
    /// bore angle needed to achieve `rifle`'s zero, then integrates the
    /// full trajectory. Returns one [`TrajectoryPoint`] per yard of travel.
    pub fn solve(&self) -> Vec<TrajectoryPoint> {
        let bc = atmosphere::atmosphere_correction(
            self.load.ballistic_coefficient,
            self.atmosphere.altitude,
            self.atmosphere.pressure,
            self.atmosphere.temperature,
            self.atmosphere.relative_humidity,
        );

        let zero_angle = angles::zero_angle(
            self.load.drag_function,
            bc,
            self.load.muzzle_velocity,
            self.rifle.sight_height,
            self.rifle.zero_range,
            self.rifle.zero_y_intercept,
        );

        trajectory::solve(
            self.load.drag_function,
            bc,
            self.load.muzzle_velocity,
            self.rifle.sight_height,
            self.shot.shooting_angle,
            zero_angle,
            self.shot.wind_speed,
            self.shot.wind_angle,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trajectory::point_at_range;

    #[test]
    fn matches_manual_solve_for_the_same_inputs() {
        let request = TrajectoryRequest {
            load: Load {
                drag_function: DragFunction::G7,
                ballistic_coefficient: 0.22,
                muzzle_velocity: 2700.0,
            },
            rifle: Rifle {
                sight_height: 1.7,
                zero_range: 100.0,
                zero_y_intercept: 0.0,
            },
            atmosphere: Atmosphere::standard(),
            shot: Shot {
                shooting_angle: 5.0,
                wind_speed: 8.0,
                wind_angle: 90.0,
            },
        };

        let via_request = request.solve();

        let bc = atmosphere::atmosphere_correction(
            request.load.ballistic_coefficient,
            request.atmosphere.altitude,
            request.atmosphere.pressure,
            request.atmosphere.temperature,
            request.atmosphere.relative_humidity,
        );
        let zero_angle = angles::zero_angle(
            request.load.drag_function,
            bc,
            request.load.muzzle_velocity,
            request.rifle.sight_height,
            request.rifle.zero_range,
            request.rifle.zero_y_intercept,
        );
        let via_manual_calls = trajectory::solve(
            request.load.drag_function,
            bc,
            request.load.muzzle_velocity,
            request.rifle.sight_height,
            request.shot.shooting_angle,
            zero_angle,
            request.shot.wind_speed,
            request.shot.wind_angle,
        );

        assert_eq!(via_request, via_manual_calls);
        assert!(point_at_range(&via_request, 300).is_some());
    }

    #[test]
    fn standard_atmosphere_matches_documented_values() {
        let atmosphere = Atmosphere::standard();
        assert_eq!(atmosphere.altitude, 0.0);
        assert_eq!(atmosphere.pressure, 29.53);
        assert_eq!(atmosphere.temperature, 59.0);
        assert_eq!(atmosphere.relative_humidity, 0.78);
        assert_eq!(atmosphere, Atmosphere::default());
    }
}
