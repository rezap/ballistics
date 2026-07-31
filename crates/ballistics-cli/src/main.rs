//! Demo binary: prints the reference bullet-drop-compensation table
//! (mirroring pyBallistics' `example.py`) along with incline and cant
//! compensation for each range, then a second table showing a custom
//! G7 load with a crosswind, to demonstrate the fully configurable
//! trajectory API.

use ballistics_core::utils::{cant_compensation, incline_compensation};
use ballistics_core::{Atmosphere, DragFunction, Load, Rifle, Shot, TrajectoryRequest};

fn main() {
    print_reference_bdc_table();
    println!();
    print_custom_g7_load();
}

fn print_reference_bdc_table() {
    let points = ballistics_core::calc_bdc();

    println!("Reference load (.269 G1 BC @ 3165 ft/s, 50 yard zero):");
    println!(
        "{:>6} {:>14} {:>14} {:>14} {:>24}",
        "yards", "path_in", "incline_comp", "abs_diff", "cant_h/v"
    );

    for point in &points {
        // A 15 degree downhill incline and a 90 degree rifle cant.
        let incline = incline_compensation(point.path_inches, -15.0);
        let (cant_h, cant_v) = cant_compensation(point.seconds, 90.0, 1.5);

        println!(
            "{:>6} {:>14.4} {:>14.4} {:>14.4} {:>11.4}/{:<11.4}",
            point.yards,
            point.path_inches,
            incline,
            (point.path_inches - incline).abs(),
            cant_h,
            cant_v
        );
    }
}

fn print_custom_g7_load() {
    let request = TrajectoryRequest {
        load: Load {
            drag_function: DragFunction::G7,
            ballistic_coefficient: 0.243,
            muzzle_velocity: 2700.0,
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

    println!("Custom load (.243 G7 BC @ 2700 ft/s, 100 yard zero, 10 mph 90-degree wind):");
    println!("{:>6} {:>14} {:>14}", "yards", "path_in", "moa_corr");

    for yards in [100, 200, 300, 400, 500] {
        if let Some(point) = ballistics_core::point_at_range(&points, yards) {
            println!(
                "{:>6} {:>14.4} {:>14.4}",
                point.yards, point.path_inches, point.moa_correction
            );
        }
    }
}
