//! Demo binary mirroring pyBallistics' `example.py`: prints the reference
//! bullet-drop-compensation table along with incline and cant compensation
//! for each range.

use ballistics_core::utils::{cant_compensation, incline_compensation};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let points = ballistics_core::calc_bdc()?;

    println!(
        "{:>6} {:>14} {:>14} {:>14} {:>24}",
        "yards", "path_in", "incline_comp", "abs_diff", "cant_h/v"
    );

    for point in &points {
        // NOTE: -15 / 90 are passed straight into sin()/cos() with no
        // degrees-to-radians conversion, matching pyBallistics' example.py
        // exactly (see doc comments on `incline_compensation` /
        // `cant_compensation` for why that's likely an upstream quirk).
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

    Ok(())
}
