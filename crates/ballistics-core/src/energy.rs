//! Kinetic energy of a projectile in flight.
//!
//! Energy and retained velocity are what a hunter actually judges a shot
//! by: energy for whether the round can do the job at all, impact velocity
//! for whether an expanding bullet will still open up. Both fall off much
//! faster than drop does, which is why a shot can be well inside the
//! vitals geometrically and still be an unethical shot.

/// Grains per pound.
const GRAINS_PER_LB: f64 = 7000.0;
/// Standard gravity, ft/s^2, for converting pounds mass to slugs.
const GRAVITY_FT_S2: f64 = 32.174;

/// Kinetic energy in foot-pounds for a bullet of `grains` travelling at
/// `velocity_fps`.
///
/// This is `1/2 m v^2` with mass converted from grains to slugs, which
/// works out to the familiar `grains * fps^2 / 450436` used throughout
/// reloading references.
pub fn ft_lb(grains: f64, velocity_fps: f64) -> f64 {
    let mass_slugs = grains / GRAINS_PER_LB / GRAVITY_FT_S2;
    0.5 * mass_slugs * velocity_fps * velocity_fps
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, tolerance: f64) {
        assert!((a - b).abs() <= tolerance, "{a} !~= {b}");
    }

    #[test]
    fn matches_the_published_divisor() {
        // The reloading-manual shorthand is grains * fps^2 / 450436.
        for (grains, fps) in [(150.0, 2800.0), (55.0, 3240.0), (300.0, 2400.0)] {
            approx(ft_lb(grains, fps), grains * fps * fps / 450_436.0, 0.5);
        }
    }

    #[test]
    fn matches_known_factory_load_figures() {
        // .308 Win, 150gr at 2820 fps: catalogues list about 2648 ft-lb.
        approx(ft_lb(150.0, 2820.0), 2648.0, 5.0);
        // .223 Rem, 55gr at 3240 fps: about 1282 ft-lb.
        approx(ft_lb(55.0, 3240.0), 1282.0, 5.0);
    }

    #[test]
    fn scales_linearly_with_mass_and_quadratically_with_speed() {
        approx(ft_lb(300.0, 2000.0), 2.0 * ft_lb(150.0, 2000.0), 1e-6);
        approx(ft_lb(150.0, 4000.0), 4.0 * ft_lb(150.0, 2000.0), 1e-6);
    }

    #[test]
    fn is_zero_at_rest() {
        assert_eq!(ft_lb(150.0, 0.0), 0.0);
    }
}
