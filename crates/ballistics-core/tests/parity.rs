//! End-to-end checks exercised through the public crate API (as opposed to
//! the per-module unit tests, which check internals): parity against the
//! original pyBallistics golden values, plus coverage that the engine is
//! now feature-complete across all seven drag functions and configurable
//! rifle/load/atmosphere inputs.

use ballistics_core::{
    point_at_range, Atmosphere, DragFunction, Load, Rifle, Shot, TrajectoryRequest,
};

fn approx(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-6 * b.abs().max(1.0), "{a} !~= {b}");
}

#[test]
fn calc_bdc_matches_python_reference_at_400_yards() {
    let points = ballistics_core::calc_bdc();

    let p = point_at_range(&points, 400).expect("400 yard point present");
    approx(p.moa_correction, 6.1580066121186485);
    approx(p.impact_in, 25.802453211175226);
    approx(p.path_inches, -25.802480690518276);
    approx(p.seconds, 0.49379193225521756);
}

#[test]
fn retard_is_wired_up_for_every_drag_function() {
    for func in DragFunction::ALL {
        let value = ballistics_core::retard(func, 0.3, 2000.0);
        assert!(value.is_finite() && value > 0.0, "{func} produced {value}");
    }
}

#[test]
fn trajectory_request_solves_a_custom_g7_load_with_wind() {
    // A boat-tail match bullet profile, the kind G7 (not G1) is meant for.
    let request = TrajectoryRequest {
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
        shot: Shot {
            shooting_angle: 0.0,
            wind_speed: 10.0,
            wind_angle: 90.0,
        },
    };

    let points = request.solve();
    let p300 = point_at_range(&points, 300).expect("300 yard point present");

    assert!(p300.seconds.is_finite() && p300.seconds > 0.0);
    assert!(p300.path_inches.is_finite());
}
