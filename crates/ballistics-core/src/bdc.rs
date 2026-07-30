//! Bullet drop compensation solve using a fixed reference load.
//!
//! Ported from `bdc.py` in pyBallistics. Upstream hardcodes a specific
//! rifle/load/atmosphere profile (.269 BC @ 3165 ft/s, 1.5" sight height,
//! 50 yard zero, standard-ish atmosphere) and even ignores the `range`
//! argument passed to `calcBDC()`. That's preserved as-is here for parity;
//! making the load and atmosphere configurable is tracked in
//! `ROADMAP.md` Phase 1.2.

use crate::angles;
use crate::atmosphere;
use crate::drag::{self, DragFunction};
use crate::trajectory::{self, TrajectoryPoint};

/// Computes the reference bullet-drop-compensation trajectory used by
/// upstream pyBallistics's `calcBDC()`.
pub fn calc_bdc() -> Result<Vec<TrajectoryPoint>, drag::DragError> {
    // Ballistic coefficient for the projectile.
    let mut bc = 0.269;
    // Initial velocity, ft/s.
    let v = 3165.0;
    // Sight height over bore, inches.
    let sh = 1.5;
    // Shooting angle (uphill/downhill), degrees.
    let angle = 0.0;
    // Zero range, yards.
    let zero = 50.0;
    // Wind speed, mi/hr.
    let windspeed = 0.0;
    // Wind angle, degrees (0 = headwind).
    let windangle = 0.0;

    let altitude = 0.0;
    let barometer = 29.59;
    let temperature = 59.0;
    let relative_humidity = 0.7;

    let drag_function = DragFunction::G1;

    // Correct the BC for atmospheric conditions before zeroing/solving.
    bc = atmosphere::atmosphere_correction(bc, altitude, barometer, temperature, relative_humidity);

    let zero_angle = angles::zero_angle(drag_function, bc, v, sh, zero, 0.0)?;

    trajectory::solve(
        drag_function,
        bc,
        v,
        sh,
        angle,
        zero_angle,
        windspeed,
        windangle,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6 * b.abs().max(1.0), "{a} !~= {b}");
    }

    #[test]
    fn matches_python_golden_bdc_points() {
        let points = calc_bdc().unwrap();
        assert_eq!(points.len(), 600);

        let cases: &[(i64, f64, f64, f64, f64)] = &[
            (
                1,
                119.050008311311,
                1.4543253444920239,
                -1.4549069852241518,
                0.0012646997710026053,
            ),
            (
                10,
                10.549718918625663,
                1.1230647471171953,
                -1.1230682674533528,
                0.00985409736889239,
            ),
            (
                50,
                0.010498996941516134,
                0.005515033916516807,
                -0.005515033891236982,
                0.04916752404636104,
            ),
            (
                100,
                -0.4793123481159075,
                -0.5027205637181876,
                0.5027205646698314,
                0.10106022767186583,
            ),
            (
                150,
                0.06100968868897417,
                0.09593050341466966,
                -0.09593050298471623,
                0.15625030312823196,
            ),
            (
                200,
                0.9296497393618867,
                1.9484753478706267,
                -1.9484753864299713,
                0.215035607126472,
            ),
            (
                300,
                3.2228754215816116,
                10.129504663895256,
                -10.129507585039043,
                0.34482150146036705,
            ),
            (
                400,
                6.1580066121186485,
                25.802453211175226,
                -25.802480690518276,
                0.49379193225521756,
            ),
            (
                500,
                9.820292121391557,
                51.42991778715554,
                -51.430057444590986,
                0.6661118209802939,
            ),
            (
                600,
                14.394092773100583,
                90.45406603444039,
                -90.45459422386041,
                0.8663835447045675,
            ),
        ];

        for (yards, moa_correction, impact_in, path_inches, seconds) in cases.iter().copied() {
            let point = trajectory::point_at_range(&points, yards)
                .unwrap_or_else(|| panic!("missing point at {yards} yards"));
            approx(point.moa_correction, moa_correction);
            approx(point.impact_in, impact_in);
            approx(point.path_inches, path_inches);
            approx(point.seconds, seconds);
        }
    }
}
