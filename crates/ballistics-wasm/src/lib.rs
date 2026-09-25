//! `ballistics-core`, compiled for the browser.
//!
//! The same solver the server runs, behind a WebAssembly boundary, so a
//! trajectory can be worked out on the phone itself - no round trip, and no
//! signal needed.
//!
//! # Why the boundary looks like this
//!
//! A WebAssembly function can only take and return numbers. There is no
//! string, no object and no array at the boundary, so a `TrajectoryRequest`
//! cannot be passed in and a `Vec<TrajectoryPoint>` cannot be handed back.
//! What both sides share is linear memory: one flat buffer that Rust owns
//! and JavaScript can view. Everything below is arranged around that.
//!
//! - **In: JSON.** The request crosses as UTF-8 JSON and is parsed by the
//!   very serde derives the server uses. The page's existing request object
//!   therefore works unchanged, and field order can never drift between the
//!   two sides - there is none to get wrong. Measured, parsing costs
//!   0.04 ms of a 1.27 ms solve.
//! - **Out: flat `f64`s.** A trajectory is 600 points of 8 numbers. As JSON
//!   that would be serialised and re-parsed on every solve; as a block of
//!   `f64` it is read in place. The order of the 8 is published by
//!   [`layout_ptr`] rather than assumed, so the JavaScript never hardcodes it
//!   either.
//!
//! # Calling protocol
//!
//! ```text
//! abi_version()            -> must equal the version the caller was written for
//! input_buffer(len)        -> pointer to `len` writable bytes; write the JSON there
//! solve(len)               -> >= 0 : number of points solved
//!                             -1   : the JSON did not parse
//!                             -2   : it parsed but failed validation
//!                             -3   : `len` is longer than the buffer
//!                             -4   : too many points to count (cannot
//!                                    happen; reported, never clamped)
//! output_ptr()             -> the points, `count * layout.length` f64s
//! error_ptr(), error_len() -> UTF-8 message explaining the last negative return
//! layout_ptr(), layout_len() -> UTF-8 JSON array naming the fields of a point
//! ```
//!
//! A validation failure carries the exact wording the server returns, since
//! both come from [`ballistics_core::validation`].
//!
//! # The one rule for callers
//!
//! Every pointer above is a window onto memory Rust still owns. **Take a
//! fresh view after every call, or copy out immediately.** The next call may
//! reuse the same memory, and if the module grows its memory the old
//! `ArrayBuffer` is detached and every view taken from it reads as empty -
//! with no error either way.
//!
//! One failure is not a return code. The module is built with
//! `panic = "abort"`, so anything that cannot be reported - in practice, an
//! [`input_buffer`] request too large to allocate - traps instead, and the
//! caller sees a `WebAssembly.RuntimeError`. After a trap the instance is
//! unusable: throw it away and instantiate a fresh one. Ordinary bad input
//! never gets that far; it is caught by the codes above.

use std::cell::RefCell;

use ballistics_core::{TrajectoryPoint, TrajectoryRequest};

/// Bumped whenever the calling protocol above changes, so JavaScript can
/// refuse a module it does not understand. That matters once the module is
/// cached for offline use: a new page and a stale module - or the other way
/// round - must fail loudly rather than misread each other's memory.
pub const ABI_VERSION: u32 = 1;

/// The fields of one point, in the order [`flatten`] writes them.
pub const LAYOUT: [&str; 8] = [
    "yards",
    "path_inches",
    "windage_in",
    "velocity_fps",
    "energy_ft_lb",
    "seconds",
    "moa_correction",
    "impact_in",
];

/// [`LAYOUT`] as JSON, for the boundary. A test holds the two in step.
const LAYOUT_JSON: &str = r#"["yards","path_inches","windage_in","velocity_fps","energy_ft_lb","seconds","moa_correction","impact_in"]"#;

/// Why a solve produced no trajectory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SolveError {
    /// The input was not a request at all.
    Malformed(String),
    /// A request, but one the solver should not be handed. The message is
    /// the core's, word for word.
    Invalid(&'static str),
}

impl SolveError {
    fn code(&self) -> i32 {
        match self {
            SolveError::Malformed(_) => -1,
            SolveError::Invalid(_) => -2,
        }
    }

    fn message(&self) -> &str {
        match self {
            SolveError::Malformed(message) => message,
            SolveError::Invalid(message) => message,
        }
    }
}

/// Parses, validates and solves one request, returning the points laid out
/// flat as [`LAYOUT`] describes.
///
/// This is the whole job; the exported functions below only move bytes in
/// and out of it. It is public so the parity check can call exactly this,
/// natively, and compare the answer with the compiled module's.
pub fn solve_json(input: &[u8]) -> Result<Vec<f64>, SolveError> {
    let request: TrajectoryRequest =
        serde_json::from_slice(input).map_err(|err| SolveError::Malformed(err.to_string()))?;
    request.validate().map_err(SolveError::Invalid)?;
    Ok(flatten(&request.solve()))
}

/// One point after another, each written in [`LAYOUT`] order.
fn flatten(points: &[TrajectoryPoint]) -> Vec<f64> {
    let mut flat = Vec::with_capacity(points.len() * LAYOUT.len());
    for p in points {
        flat.extend_from_slice(&[
            // Exact: a yard count tops out near 600, and an f64 holds every
            // integer up to 2^53.
            p.yards as f64,
            p.path_inches,
            p.windage_in,
            p.velocity_fps,
            p.energy_ft_lb,
            p.seconds,
            p.moa_correction,
            p.impact_in,
        ]);
    }
    flat
}

// Thread locals rather than `static mut`: WebAssembly here is single
// threaded, so these behave as plain globals, but without `static mut`'s
// unsound shared references. On a native build each test thread gets its own
// copy, which is exactly the isolation the tests want.
thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static ERROR: RefCell<String> = const { RefCell::new(String::new()) };
}

/// See the module docs.
#[no_mangle]
pub extern "C" fn abi_version() -> u32 {
    ABI_VERSION
}

/// Makes room for `len` bytes of request JSON and returns where to put them.
///
/// Growing this buffer can grow linear memory, which detaches any view the
/// caller already holds - so call this first, then take the view.
#[no_mangle]
pub extern "C" fn input_buffer(len: usize) -> *mut u8 {
    INPUT.with(|input| {
        let mut input = input.borrow_mut();
        input.clear();
        input.resize(len, 0);
        input.as_mut_ptr()
    })
}

/// Solves the `len` bytes of JSON most recently written to [`input_buffer`].
/// See the module docs for the return values.
#[no_mangle]
pub extern "C" fn solve(len: usize) -> i32 {
    let result = INPUT.with(|input| input.borrow().get(..len).map(solve_json));

    let Some(result) = result else {
        set_error("the request length is longer than the input buffer");
        return -3;
    };

    match result {
        Ok(flat) => {
            // No trajectory comes near this - wasm32 memory tops out at
            // 4 GiB, so no vector could hold enough points to overflow an
            // i32. But the count tells the caller how far to read, and a
            // wrong one would send it past the end of the buffer without a
            // word, so an impossible case is still reported as a failure
            // rather than clamped to a number that is merely plausible.
            let Ok(count) = i32::try_from(flat.len() / LAYOUT.len()) else {
                OUTPUT.with(|output| output.borrow_mut().clear());
                set_error("the trajectory has too many points to report");
                return -4;
            };
            OUTPUT.with(|output| *output.borrow_mut() = flat);
            set_error("");
            count
        }
        Err(err) => {
            OUTPUT.with(|output| output.borrow_mut().clear());
            set_error(err.message());
            err.code()
        }
    }
}

fn set_error(message: &str) {
    ERROR.with(|error| {
        let mut error = error.borrow_mut();
        error.clear();
        error.push_str(message);
    });
}

/// Where the last successful solve's points are.
#[no_mangle]
pub extern "C" fn output_ptr() -> *const f64 {
    OUTPUT.with(|output| output.borrow().as_ptr())
}

/// Where the message for the last failed solve is.
#[no_mangle]
pub extern "C" fn error_ptr() -> *const u8 {
    ERROR.with(|error| error.borrow().as_ptr())
}

/// How many bytes that message is.
#[no_mangle]
pub extern "C" fn error_len() -> usize {
    ERROR.with(|error| error.borrow().len())
}

/// Where the JSON naming a point's fields is.
#[no_mangle]
pub extern "C" fn layout_ptr() -> *const u8 {
    LAYOUT_JSON.as_ptr()
}

/// How many bytes that JSON is.
#[no_mangle]
pub extern "C" fn layout_len() -> usize {
    LAYOUT_JSON.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ballistics_core::{Atmosphere, DragFunction, Load, Rifle, Shot};

    fn request() -> TrajectoryRequest {
        TrajectoryRequest {
            load: Load {
                drag_function: DragFunction::G1,
                ballistic_coefficient: 0.503,
                muzzle_velocity: 2600.0,
                bullet_weight_gr: 180.0,
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
        }
    }

    fn json(request: &TrajectoryRequest) -> Vec<u8> {
        serde_json::to_vec(request).unwrap()
    }

    #[test]
    fn the_published_layout_matches_the_one_written() {
        let published: Vec<String> = serde_json::from_str(LAYOUT_JSON).unwrap();
        assert_eq!(published, LAYOUT);
    }

    #[test]
    fn flattening_writes_every_field_where_the_layout_says() {
        let points = request().solve();
        let flat = flatten(&points);
        assert_eq!(flat.len(), points.len() * LAYOUT.len());

        for (i, p) in points.iter().enumerate() {
            let row = &flat[i * LAYOUT.len()..(i + 1) * LAYOUT.len()];
            let expected = [
                p.yards as f64,
                p.path_inches,
                p.windage_in,
                p.velocity_fps,
                p.energy_ft_lb,
                p.seconds,
                p.moa_correction,
                p.impact_in,
            ];
            for (field, (got, want)) in LAYOUT.iter().zip(row.iter().zip(expected)) {
                assert_eq!(
                    got.to_bits(),
                    want.to_bits(),
                    "{field} at point {i} is in the wrong place"
                );
            }
        }
    }

    #[test]
    fn solving_json_matches_solving_the_request_directly() {
        let direct = flatten(&request().solve());
        let via_json = solve_json(&json(&request())).unwrap();
        assert_eq!(direct.len(), via_json.len());
        assert!(direct
            .iter()
            .zip(&via_json)
            .all(|(a, b)| a.to_bits() == b.to_bits()));
    }

    #[test]
    fn the_pages_request_shape_is_accepted_as_it_is() {
        // The shape `buildRequestPayload` in app.js sends: the drag function
        // as a string, whole numbers without a decimal point, all four
        // sections present. If this stops parsing, the page and the module
        // disagree about what a request is.
        let page = br#"{
            "load": {"drag_function": "G1", "ballistic_coefficient": 0.503,
                     "muzzle_velocity": 2600, "bullet_weight_gr": 180},
            "rifle": {"sight_height": 1.7, "zero_range": 100, "zero_y_intercept": 0},
            "atmosphere": {"altitude": 0, "pressure": 29.53, "temperature": 59,
                           "relative_humidity": 0.78},
            "shot": {"shooting_angle": 0, "wind_speed": 10, "wind_angle": 90}
        }"#;
        let flat = solve_json(page).unwrap();
        assert_eq!(flat.len() / LAYOUT.len(), 600);
    }

    #[test]
    fn a_rejected_request_carries_the_cores_own_wording() {
        let mut bad = request();
        bad.rifle.zero_range = 0.0;
        assert_eq!(
            solve_json(&json(&bad)),
            Err(SolveError::Invalid(bad.validate().unwrap_err()))
        );
    }

    #[test]
    fn malformed_input_is_an_error_not_a_panic() {
        for input in [&b""[..], b"{", b"null", b"[]", br#"{"load": "nonsense"}"#] {
            assert!(
                matches!(solve_json(input), Err(SolveError::Malformed(_))),
                "{:?} should be reported as malformed",
                String::from_utf8_lossy(input)
            );
        }
    }

    // The exported functions, driven natively in the same sequence the
    // JavaScript uses. This is the part of the boundary that deals in raw
    // pointers, so it is checked here too rather than only through a
    // compiled module.

    fn write_input(bytes: &[u8]) {
        let ptr = input_buffer(bytes.len());
        // SAFETY: `input_buffer` just made exactly `bytes.len()` bytes
        // available at `ptr`, and nothing touches the buffer until `solve`.
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len()) };
    }

    fn read_error() -> String {
        // SAFETY: the pointer and length describe the live error string.
        let bytes = unsafe { std::slice::from_raw_parts(error_ptr(), error_len()) };
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[test]
    fn the_exported_protocol_round_trips_a_solve() {
        assert_eq!(abi_version(), ABI_VERSION);

        let input = json(&request());
        write_input(&input);
        let count = solve(input.len());
        assert_eq!(count, 600);
        assert_eq!(read_error(), "");

        // SAFETY: a successful solve leaves `count * LAYOUT.len()` f64s there.
        let out =
            unsafe { std::slice::from_raw_parts(output_ptr(), count as usize * LAYOUT.len()) };
        let direct = flatten(&request().solve());
        assert!(out
            .iter()
            .zip(&direct)
            .all(|(a, b)| a.to_bits() == b.to_bits()));
    }

    #[test]
    fn the_exported_protocol_reports_each_kind_of_failure() {
        write_input(b"not json");
        assert_eq!(solve(8), -1);
        assert!(!read_error().is_empty());

        let mut bad = request();
        bad.load.muzzle_velocity = 0.0;
        let input = json(&bad);
        write_input(&input);
        assert_eq!(solve(input.len()), -2);
        assert_eq!(
            read_error(),
            "load.muzzle_velocity must be between 0 and 10000 ft/s"
        );

        write_input(b"{}");
        assert_eq!(solve(1_000), -3, "a length past the buffer must be refused");

        // And a success afterwards clears the last error.
        let input = json(&request());
        write_input(&input);
        assert!(solve(input.len()) > 0);
        assert_eq!(read_error(), "");
    }

    /// Writes the native half of the parity check. Not a test in itself -
    /// ignored by default, and run on purpose:
    ///
    /// ```text
    /// BALLISTICS_PARITY_GOLDEN=$PWD/target/parity-golden.json \
    ///   cargo test -p ballistics-wasm -- --ignored write_parity_golden
    /// ```
    ///
    /// It feeds every fixture through the exported functions - the same
    /// `input_buffer`, `solve`, `output_ptr` and `error_ptr` the browser
    /// calls, compiled natively - and records the exact input bytes, the
    /// return code, the error text and every output `f64` as its bit
    /// pattern. `tests/parity/parity.mjs` then replays those bytes through
    /// the compiled `.wasm`: codes and error text must match exactly, and
    /// every value must fall within a tolerance set from measurement - the
    /// two targets' maths libraries may round a final bit differently, and
    /// the runner explains how far and prints how often. The only thing
    /// that differs between the two runs is the target the code was
    /// compiled for.
    #[test]
    #[ignore = "generates the parity golden file; run explicitly"]
    fn write_parity_golden() {
        let out = std::env::var("BALLISTICS_PARITY_GOLDEN")
            .expect("set BALLISTICS_PARITY_GOLDEN to the file to write");
        // Cargo runs tests from this crate's directory, not the workspace
        // root, so a relative path would quietly land inside `crates/`.
        assert!(
            std::path::Path::new(&out).is_absolute(),
            "BALLISTICS_PARITY_GOLDEN must be an absolute path (got {out:?}): \
             tests run from the crate directory, so a relative one ends up \
             somewhere unexpected"
        );
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../tests/parity/fixtures.json")).unwrap();

        let mut golden = Vec::new();
        for fixture in fixtures["fixtures"].as_array().unwrap() {
            let name = fixture["name"].as_str().unwrap();
            let input = match (fixture.get("request"), fixture.get("raw")) {
                (Some(request), None) => serde_json::to_string(request).unwrap(),
                (None, Some(raw)) => raw.as_str().unwrap().to_string(),
                _ => panic!("fixture {name:?} needs exactly one of `request` or `raw`"),
            };

            write_input(input.as_bytes());
            let code = solve(input.len());
            let bits: Vec<String> = if code > 0 {
                // SAFETY: a positive return leaves that many points there.
                let flat = unsafe {
                    std::slice::from_raw_parts(output_ptr(), code as usize * LAYOUT.len())
                };
                flat.iter()
                    .map(|v| format!("{:016x}", v.to_bits()))
                    .collect()
            } else {
                Vec::new()
            };

            golden.push(serde_json::json!({
                "name": name,
                "input": input,
                "code": code,
                "error": read_error(),
                "bits": bits,
            }));
        }

        let golden =
            serde_json::json!({ "abi_version": ABI_VERSION, "layout": LAYOUT, "cases": golden });
        std::fs::write(&out, serde_json::to_vec(&golden).unwrap()).unwrap();
        eprintln!(
            "wrote {} parity cases to {out}",
            golden["cases"].as_array().unwrap().len()
        );
    }

    #[test]
    fn the_parity_fixtures_are_well_formed() {
        // Cheap enough to run always, so a broken fixture file fails here
        // rather than only when someone remembers to write the golden file.
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../tests/parity/fixtures.json")).unwrap();
        let fixtures = fixtures["fixtures"].as_array().unwrap();
        assert!(
            fixtures.len() > 50,
            "the fixture set should not shrink unnoticed"
        );

        let mut names = std::collections::HashSet::new();
        for fixture in fixtures {
            let name = fixture["name"].as_str().expect("every fixture is named");
            assert!(names.insert(name), "duplicate fixture name {name:?}");
            assert!(
                fixture.get("request").is_some() != fixture.get("raw").is_some(),
                "{name:?} needs exactly one of `request` or `raw`"
            );
        }
    }

    #[test]
    fn the_published_layout_is_readable_through_the_boundary() {
        // SAFETY: a `'static` string, described by its own pointer and length.
        let bytes = unsafe { std::slice::from_raw_parts(layout_ptr(), layout_len()) };
        let layout: Vec<String> = serde_json::from_slice(bytes).unwrap();
        assert_eq!(layout, LAYOUT);
    }
}
