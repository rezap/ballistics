//! Atmospheric correction of drag coefficients.
//!
//! Ported from `atmosphere.py` in pyBallistics.

/// Drag coefficient atmospheric humidity correction factor.
pub fn calc_fr(temperature: f64, pressure: f64, relative_humidity: f64) -> f64 {
    let vpw =
        4e-6 * temperature.powi(3) - 0.0004 * temperature.powi(2) + 0.0234 * temperature - 0.2517;
    0.995 * (pressure / (pressure - (0.3783) * relative_humidity * vpw))
}

/// Barometric pressure correction factor. Standard pressure is 29.53 in-Hg.
pub fn calc_fp(pressure: f64) -> f64 {
    let p_std = 29.53;
    (pressure - p_std) / p_std
}

/// Temperature correction factor relative to standard atmosphere at `altitude`.
pub fn calc_ft(temperature: f64, altitude: f64) -> f64 {
    let t_std = -0.0036 * altitude + 59.0;
    (temperature - t_std) / (459.6 + t_std)
}

/// Altitude correction factor.
pub fn calc_fa(altitude: f64) -> f64 {
    let fa = -4e-15 * altitude.powi(3) + 4e-10 * altitude.powi(2) - 3e-5 * altitude + 1.0;
    1.0 / fa
}

/// Corrects a "standard" drag coefficient for differing atmospheric
/// conditions.
///
/// * `altitude` - altitude above sea level, in feet. Standard is 0.
/// * `barometer` - "standardized" barometric pressure, in-Hg. Standard is
///   29.53.
/// * `temperature` - temperature in Fahrenheit. Standard is 59.
/// * `relative_humidity` - fraction from 0.0 to 1.0. Standard is 0.78.
pub fn atmosphere_correction(
    drag_coefficient: f64,
    altitude: f64,
    barometer: f64,
    temperature: f64,
    relative_humidity: f64,
) -> f64 {
    let fa = calc_fa(altitude);
    let ft = calc_ft(temperature, altitude);
    let fr = calc_fr(temperature, barometer, relative_humidity);
    let fp = calc_fp(barometer);

    let cd = fa * (1.0 + ft - fp) * fr;
    drag_coefficient * cd
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9 * b.abs().max(1.0), "{a} !~= {b}");
    }

    #[test]
    fn matches_python_golden_values() {
        approx(calc_fr(59.0, 29.53, 0.78), 1.0005791184735187);
        approx(calc_fp(29.92), 0.013206908228919761);
        approx(calc_ft(70.0, 500.0), 0.02476780185758513);
        approx(calc_fa(5000.0), 1.1634671320535195);
        approx(
            atmosphere_correction(0.269, 0.0, 29.59, 59.0, 0.7),
            0.2684517796899058,
        );
    }
}
