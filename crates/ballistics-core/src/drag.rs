//! Standard drag functions (G1, G2, G3, G5, G6, G7, G8) and retardation.
//!
//! Ported from `drag.py` in pyBallistics, which itself is a port of the
//! GNU Ballistics Library's drag tables. Each table maps a velocity band
//! (ft/s) to an `(acceleration, mass)` exponent pair used to compute drag
//! retardation.

use std::fmt;
use std::str::FromStr;

/// Standard small-arms drag model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum DragFunction {
    G1,
    G2,
    G3,
    G5,
    G6,
    G7,
    G8,
}

impl DragFunction {
    /// All supported drag functions, in the order GNU Ballistics defines them.
    pub const ALL: [DragFunction; 7] = [
        DragFunction::G1,
        DragFunction::G2,
        DragFunction::G3,
        DragFunction::G5,
        DragFunction::G6,
        DragFunction::G7,
        DragFunction::G8,
    ];
}

impl fmt::Display for DragFunction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

/// Returned by [`DragFunction::from_str`] for an unrecognized name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseDragFunctionError(String);

impl fmt::Display for ParseDragFunctionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "unknown drag function {:?} (expected one of G1, G2, G3, G5, G6, G7, G8)",
            self.0
        )
    }
}

impl std::error::Error for ParseDragFunctionError {}

impl FromStr for DragFunction {
    type Err = ParseDragFunctionError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_uppercase().as_str() {
            "G1" => Ok(DragFunction::G1),
            "G2" => Ok(DragFunction::G2),
            "G3" => Ok(DragFunction::G3),
            "G5" => Ok(DragFunction::G5),
            "G6" => Ok(DragFunction::G6),
            "G7" => Ok(DragFunction::G7),
            "G8" => Ok(DragFunction::G8),
            _ => Err(ParseDragFunctionError(s.to_string())),
        }
    }
}

/// G1 drag table. Returns `None` when `vp <= 0` (no band matches).
fn g1(vp: f64) -> Option<(f64, f64)> {
    let table: &[(f64, f64, f64)] = &[
        (4230.0, 1.477404177730177e-04, 1.9565),
        (3680.0, 1.920339268755614e-04, 1.9250),
        (3450.0, 2.894751026819746e-04, 1.8750),
        (3295.0, 4.349905111115636e-04, 1.8250),
        (3130.0, 6.520421871892662e-04, 1.7750),
        (2960.0, 9.748073694078696e-04, 1.7250),
        (2830.0, 1.453721560187286e-03, 1.6750),
        (2680.0, 2.162887202930376e-03, 1.6250),
        (2460.0, 3.209559783129881e-03, 1.5750),
        (2225.0, 3.904368218691249e-03, 1.5500),
        (2015.0, 3.222942271262336e-03, 1.5750),
        (1890.0, 2.203329542297809e-03, 1.6250),
        (1810.0, 1.511001028891904e-03, 1.6750),
        (1730.0, 8.609957592468259e-04, 1.7500),
        (1595.0, 4.086146797305117e-04, 1.8500),
        (1520.0, 1.954473210037398e-04, 1.9500),
        (1420.0, 5.431896266462351e-05, 2.1250),
        (1360.0, 8.847742581674416e-06, 2.3750),
        (1315.0, 1.456922328720298e-06, 2.6250),
        (1280.0, 2.419485191895565e-07, 2.8750),
        (1220.0, 1.657956321067612e-08, 3.2500),
        (1185.0, 4.745469537157371e-10, 3.7500),
        (1150.0, 1.379746590025088e-11, 4.2500),
        (1100.0, 4.070157961147882e-13, 4.7500),
        (1060.0, 2.938236954847331e-14, 5.1250),
        (1025.0, 1.228597370774746e-14, 5.2500),
        (980.0, 2.916938264100495e-14, 5.1250),
        (945.0, 3.855099424807451e-13, 4.7500),
        (905.0, 1.185097045689854e-11, 4.2500),
        (860.0, 3.566129470974951e-10, 3.7500),
        (810.0, 1.045513263966272e-08, 3.2500),
        (780.0, 1.291159200846216e-07, 2.8750),
        (750.0, 6.824429329105383e-07, 2.6250),
        (700.0, 3.569169672385163e-06, 2.3750),
        (640.0, 1.839015095899579e-05, 2.1250),
        (600.0, 5.71117468873424e-05, 1.9500),
        (550.0, 9.226557091973427e-05, 1.8750),
        (250.0, 9.337991957131389e-05, 1.8750),
        (100.0, 7.225247327590413e-05, 1.9250),
        (65.0, 5.792684957074546e-05, 1.9750),
        (0.0, 5.206214107320588e-05, 2.0000),
    ];
    table
        .iter()
        .find(|(threshold, _, _)| vp > *threshold)
        .map(|(_, acceleration, mass)| (*acceleration, *mass))
}

fn g2(vp: f64) -> Option<(f64, f64)> {
    let table: &[(f64, f64, f64)] = &[
        (1674.0, 0.0079470052136733, 1.36999902851493),
        (1172.0, 1.00419763721974e-03, 1.65392237010294),
        (1060.0, 7.15571228255369e-23, 7.91913562392361),
        (949.0, 1.39589807205091e-10, 3.81439537623717),
        (670.0, 2.34364342818625e-04, 1.71869536324748),
        (335.0, 1.77962438921838e-04, 1.76877550388679),
        (0.0, 5.18033561289704e-05, 1.98160270524632),
    ];
    table
        .iter()
        .find(|(threshold, _, _)| vp > *threshold)
        .map(|(_, acceleration, mass)| (*acceleration, *mass))
}

fn g3(vp: f64) -> Option<(f64, f64)> {
    let table: &[(f64, f64, f64)] = &[
        (1730.0, 7.24854775171929e-03, 1.41538574492812),
        (1228.0, 3.50563361516117e-05, 2.13077307854948),
        (1116.0, 1.84029481181151e-13, 4.81927320350395),
        (1004.0, 1.34713064017409e-22, 7.81005552814220),
        (837.0, 1.03965974081168e-07, 2.84204791809926),
        (335.0, 1.09301593869823e-04, 1.81096361579504),
        (0.0, 3.51963178524273e-05, 2.00477856801111),
    ];
    table
        .iter()
        .find(|(threshold, _, _)| vp > *threshold)
        .map(|(_, acceleration, mass)| (*acceleration, *mass))
}

/// G5 shares the same table as G3 in the upstream pyBallistics source.
fn g5(vp: f64) -> Option<(f64, f64)> {
    g3(vp)
}

fn g6(vp: f64) -> Option<(f64, f64)> {
    let table: &[(f64, f64, f64)] = &[
        (3236.0, 0.0455384883480781, 1.15997674041274),
        (2065.0, 7.16726184965377e-02, 1.10704436538885),
        (1311.0, 1.66676386084348e-03, 1.60085100195952),
        (1144.0, 1.01482730119215e-07, 2.95696747318380),
        (1004.0, 4.31542773103552e-18, 6.34106317069757),
        (670.0, 2.04835650496866e-05, 2.11688446325998),
        (0.0, 7.50912466084823e-05, 1.92031057847052),
    ];
    table
        .iter()
        .find(|(threshold, _, _)| vp > *threshold)
        .map(|(_, acceleration, mass)| (*acceleration, *mass))
}

fn g7(vp: f64) -> Option<(f64, f64)> {
    let table: &[(f64, f64, f64)] = &[
        (4200.0, 1.29081656775919e-09, 3.24121295355962),
        (3000.0, 0.0171422231434847, 1.27907168025204),
        (1470.0, 2.33355948302505e-03, 1.52693913274526),
        (1260.0, 7.97592111627665e-04, 1.67688974440324),
        (1110.0, 5.71086414289273e-12, 4.32128262648890),
        (960.0, 3.02865108244904e-17, 5.99074203776707),
        (670.0, 7.52285155782535e-06, 2.17380198510750),
        (540.0, 1.31766281225189e-05, 2.08774690257991),
        (0.0, 1.34504843776525e-05, 2.08702306738884),
    ];
    table
        .iter()
        .find(|(threshold, _, _)| vp > *threshold)
        .map(|(_, acceleration, mass)| (*acceleration, *mass))
}

fn g8(vp: f64) -> Option<(f64, f64)> {
    let table: &[(f64, f64, f64)] = &[
        (3571.0, 0.0112263766252305, 1.33207346655961),
        (1841.0, 0.0167252613732636, 1.28662041261785),
        (1120.0, 2.20172456619625e-03, 1.55636358091189),
        (1088.0, 2.05380371670980e-16, 5.80410776994789),
        (976.0, 5.92182174254121e-12, 4.29275576134191),
        (0.0, 4.39173437951170e-05, 1.99978116283334),
    ];
    table
        .iter()
        .find(|(threshold, _, _)| vp > *threshold)
        .map(|(_, acceleration, mass)| (*acceleration, *mass))
}

/// Raw table lookup for a given drag function and velocity, exposed for
/// testing / future use. Returns `None` for `vp <= 0`, matching the `(-1,
/// -1)` sentinel used in the Python tables.
fn table(drag_function: DragFunction, vp: f64) -> Option<(f64, f64)> {
    match drag_function {
        DragFunction::G1 => g1(vp),
        DragFunction::G2 => g2(vp),
        DragFunction::G3 => g3(vp),
        DragFunction::G5 => g5(vp),
        DragFunction::G6 => g6(vp),
        DragFunction::G7 => g7(vp),
        DragFunction::G8 => g8(vp),
    }
}

/// Ballistic retardation for a given drag function, coefficient and
/// projectile velocity (ft/s), in ft/s per second.
///
/// Returns `-1.0` for velocities outside the modeled range (`vp <= 0` or
/// `vp >= 10000`), matching the sentinel used by the original GNU
/// Ballistics tables. Unlike upstream pyBallistics — whose `retard()` only
/// ever dispatched [`DragFunction::G1`], silently crashing on any other
/// drag function — every drag function here is fully wired up.
pub fn retard(drag_function: DragFunction, drag_coefficient: f64, vp: f64) -> f64 {
    match table(drag_function, vp) {
        Some((acceleration, mass)) if vp > 0.0 && vp < 10000.0 => {
            acceleration * vp.powf(mass) / drag_coefficient
        }
        _ => -1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9 * b.abs().max(1.0), "{a} !~= {b}");
    }

    #[test]
    fn g1_retard_matches_python_golden_values() {
        let cases = [
            (100.0, 1.0325471804611852),
            (500.0, 21.470998882431488),
            (900.0, 85.43513550232399),
            (1100.0, 227.11944787438125),
            (1300.0, 433.8504996637566),
            (1500.0, 609.7831069007154),
            (2000.0, 1019.2558110027082),
            (2500.0, 1442.882542312585),
            (3000.0, 1940.8097433117512),
            (3500.0, 2557.2241399275654),
            (4000.0, 3298.932593732959),
        ];
        for (vp, expected) in cases {
            approx(retard(DragFunction::G1, 0.5, vp), expected);
        }
    }

    #[test]
    fn every_drag_function_is_wired_up() {
        // Each drag function's table has an entry valid at 2000 ft/s, so
        // retard() should produce a real (non-sentinel), finite value for
        // all seven — this is the bug upstream pyBallistics has (it only
        // ever dispatches G1; everything else crashes).
        for func in DragFunction::ALL {
            let value = retard(func, 0.3, 2000.0);
            assert!(
                value.is_finite() && value != -1.0,
                "{func} produced {value}"
            );

            let (acceleration, mass) = table(func, 2000.0).unwrap();
            approx(value, acceleration * 2000.0_f64.powf(mass) / 0.3);
        }
    }

    #[test]
    fn retard_returns_sentinel_outside_modeled_velocity_range() {
        for func in DragFunction::ALL {
            assert_eq!(retard(func, 0.3, 0.0), -1.0);
            assert_eq!(retard(func, 0.3, -5.0), -1.0);
            assert_eq!(retard(func, 0.3, 10_000.0), -1.0);
        }
    }

    #[test]
    fn g1_returns_none_below_zero_velocity() {
        assert_eq!(g1(0.0), None);
        assert_eq!(g1(-5.0), None);
    }

    #[test]
    fn drag_function_display_and_parse_roundtrip() {
        for func in DragFunction::ALL {
            let parsed: DragFunction = func.to_string().parse().unwrap();
            assert_eq!(parsed, func);
        }
        assert!("G4".parse::<DragFunction>().is_err());
        assert_eq!("g7".parse::<DragFunction>().unwrap(), DragFunction::G7);
    }
}
