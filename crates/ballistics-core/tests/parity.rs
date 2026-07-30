//! End-to-end parity check against the original pyBallistics implementation,
//! exercised through the public crate API (as opposed to the per-module
//! unit tests, which check internals).

use ballistics_core::{point_at_range, DragFunction};

fn approx(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6 * b.abs().max(1.0), "{a} !~= {b}");
}

#[test]
fn calc_bdc_matches_python_reference_at_400_yards() {
    let points = ballistics_core::calc_bdc().expect("G1 is supported");

    let p = point_at_range(&points, 400).expect("400 yard point present");
    approx(p.moa_correction, 6.1580066121186485);
    approx(p.impact_in, 25.802453211175226);
    approx(p.path_inches, -25.802480690518276);
    approx(p.seconds, 0.49379193225521756);
}

#[test]
fn retard_rejects_unwired_drag_functions_without_panicking() {
    let result = ballistics_core::retard(DragFunction::G7, 0.3, 2000.0);
    assert!(result.is_err());
}
