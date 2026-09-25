//! `ballistics-api`: an Axum web server exposing `ballistics-core` over
//! HTTP, and serving the static frontend that consumes it.

use std::net::SocketAddr;
use std::time::Duration;

use std::sync::Arc;

use axum::extract::{Json, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use ballistics_core::{
    Atmosphere, DragFunction, Load, Rifle, Shot, TrajectoryPoint, TrajectoryRequest,
};
use serde::Serialize;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;

mod ammunition;
mod species;

use ammunition::FactoryLoad;
use species::AnimalProfile;

/// Reference data loaded once at startup and shared by the handlers that
/// serve it.
#[derive(Clone)]
struct AppState {
    animals: Arc<Vec<AnimalProfile>>,
    ammunition: Arc<Vec<FactoryLoad>>,
}

/// Upper bound on how long a single trajectory solve may run before the
/// request is failed. Untrusted input (e.g. a near-zero ballistic
/// coefficient or muzzle velocity) could otherwise make the integrator
/// take a very long time; `validate_request` rejects the known-bad shapes
/// up front, and this timeout is the backstop for anything it misses.
const SOLVE_TIMEOUT: Duration = Duration::from_secs(5);

#[tokio::main]
async fn main() {
    let static_dir =
        std::env::var("BALLISTICS_STATIC_DIR").unwrap_or_else(|_| "static".to_string());
    warn_if_static_dir_missing(&static_dir);

    // Load the species data up front so a malformed entry fails loudly at
    // startup rather than surfacing as an empty dropdown at runtime.
    let animals = match species::load(std::path::Path::new(&static_dir)) {
        Ok(animals) => {
            println!("loaded {} game species", animals.len());
            Arc::new(animals)
        }
        Err(problems) => {
            eprintln!("warning: could not load game species data:\n{problems}");
            eprintln!("         the app will run, but /api/animals will be empty.");
            Arc::new(Vec::new())
        }
    };

    // Same treatment for the ammunition catalogue: a bad figure should stop
    // us at startup, not become a confident, wrong trajectory later.
    let ammunition = match ammunition::load(std::path::Path::new(&static_dir)) {
        Ok(loads) => {
            println!("loaded {} factory loads", loads.len());
            Arc::new(loads)
        }
        Err(problems) => {
            eprintln!("warning: could not load the ammunition catalogue:\n{problems}");
            eprintln!("         the app will run, but /api/ammunition will be empty.");
            Arc::new(Vec::new())
        }
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/drag-functions", get(drag_functions))
        .route("/api/animals", get(animals_handler))
        .route("/api/ammunition", get(ammunition_handler))
        .route("/api/trajectory", post(solve_trajectory))
        .route("/api/suitability", post(solve_suitability))
        .fallback_service(ServeDir::new(static_dir))
        .with_state(AppState {
            animals,
            ammunition,
        })
        // Trajectory tables are long runs of similar numbers, which gzip
        // eats: the whole-catalogue solve behind `/api/suitability` is
        // roughly 350 kB of JSON and about a tenth of that compressed. The
        // app is meant to be used standing in a field on whatever signal
        // there is, so that difference is the feature.
        .layer(CompressionLayer::new());

    let addr = resolve_addr();

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|err| panic!("failed to bind {addr}: {err}"));
    println!("ballistics-api listening on http://{addr}");
    axum::serve(listener, app)
        .await
        .expect("server error while serving requests");
}

/// `ServeDir` fails requests one at a time instead of erroring at startup,
/// so a missing static directory otherwise shows up as every page and
/// asset silently 404ing — the browser just looks blank, with nothing in
/// the server's own logs pointing at why. Surface it loudly instead: this
/// is almost always caused by running the binary from a directory other
/// than `crates/ballistics-api` (e.g. the repo root) without setting
/// `BALLISTICS_STATIC_DIR`, since the default `static` path is resolved
/// relative to the current working directory, not the crate.
fn warn_if_static_dir_missing(static_dir: &str) {
    if std::path::Path::new(static_dir).is_dir() {
        return;
    }

    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "<unknown>".to_string());
    eprintln!(
        "warning: static assets directory {static_dir:?} does not exist (looked for it relative to \
         the current directory, {cwd}). The API endpoints will still work, but every request for \
         the browser UI will 404 and the page will appear blank. Fix this by running the binary \
         from crates/ballistics-api, using scripts/run.ps1, or setting BALLISTICS_STATIC_DIR to the \
         absolute path of crates/ballistics-api/static."
    );
}

/// Resolves the address to listen on. `BALLISTICS_API_ADDR` (a full
/// `host:port`) takes precedence if set; otherwise, if `PORT` is set (as
/// most PaaS providers — Render, Railway, Heroku-likes — inject to tell an
/// app which port to bind), bind `0.0.0.0` to it; otherwise default to
/// `0.0.0.0:3000`.
fn resolve_addr() -> SocketAddr {
    resolve_addr_from(
        std::env::var("BALLISTICS_API_ADDR").ok(),
        std::env::var("PORT").ok(),
    )
}

fn resolve_addr_from(explicit_addr: Option<String>, port: Option<String>) -> SocketAddr {
    if let Some(addr) = explicit_addr {
        return addr
            .parse()
            .unwrap_or_else(|err| panic!("BALLISTICS_API_ADDR {addr:?} is invalid: {err}"));
    }

    if let Some(port) = port {
        let addr = format!("0.0.0.0:{port}");
        return addr
            .parse()
            .unwrap_or_else(|err| panic!("PORT {port:?} is not a valid port: {err}"));
    }

    "0.0.0.0:3000".parse().expect("hardcoded default is valid")
}

async fn health() -> &'static str {
    "ok"
}

async fn drag_functions() -> Json<Vec<String>> {
    Json(DragFunction::ALL.iter().map(|f| f.to_string()).collect())
}

async fn animals_handler(State(state): State<AppState>) -> Json<Vec<AnimalProfile>> {
    // serde only serializes Arc behind its "rc" feature; the list is a
    // handful of small records, so cloning it is cheaper than the setup.
    Json(state.animals.as_ref().clone())
}

async fn ammunition_handler(State(state): State<AppState>) -> Json<Vec<FactoryLoad>> {
    Json(state.ammunition.as_ref().clone())
}

async fn solve_trajectory(
    Json(request): Json<TrajectoryRequest>,
) -> Result<Json<Vec<TrajectoryPoint>>, ApiError> {
    validate_request(&request)?;

    match tokio::time::timeout(
        SOLVE_TIMEOUT,
        tokio::task::spawn_blocking(move || request.solve()),
    )
    .await
    {
        Ok(Ok(points)) => Ok(Json(points)),
        Ok(Err(_)) => Err(ApiError::internal("the solver task panicked")),
        Err(_) => Err(ApiError::internal("the solver timed out")),
    }
}

/// The reverse query: one set of conditions, every load in the catalogue.
///
/// The forward question is "I have this box of ammunition - where will it
/// hit?". This is the one a hunter actually asks in a shop: "I am after a
/// red deer at 250 yards - what will do the job?". Answering it means
/// solving the whole catalogue against the same rifle, air and shot, which
/// is one request rather than the two dozen the browser would otherwise
/// make.
#[derive(serde::Deserialize)]
struct SuitabilityRequest {
    rifle: Rifle,
    #[serde(default)]
    atmosphere: Atmosphere,
    #[serde(default)]
    shot: Shot,
    /// Only these cartridges, when given; absent means the whole catalogue.
    /// You cannot chamber what your rifle is not cut for, so the usual case
    /// is a list of one.
    #[serde(default)]
    cartridges: Option<Vec<String>>,
    /// Yard spacing of the returned points.
    ///
    /// A per-yard table for two dozen loads is megabytes, and the answer
    /// this endpoint gives - roughly how far each load still carries - is
    /// not a per-yard question. Ten yards keeps the response small enough
    /// to be worth sending over a phone signal.
    #[serde(default = "default_step_yards")]
    step_yards: u32,
}

fn default_step_yards() -> u32 {
    10
}

/// A solved catalogue entry. Carries the load id rather than the load
/// itself: the frontend already has the catalogue from `/api/ammunition`,
/// and repeating every field two dozen times would double the response for
/// nothing.
#[derive(Serialize)]
struct SuitabilityEntry {
    load_id: String,
    points: Vec<TrajectoryPoint>,
}

async fn solve_suitability(
    State(state): State<AppState>,
    Json(request): Json<SuitabilityRequest>,
) -> Result<Json<Vec<SuitabilityEntry>>, ApiError> {
    validate_conditions(&request.rifle, &request.atmosphere, &request.shot)?;
    if !(1..=100).contains(&request.step_yards) {
        return Err(ApiError::bad_request(
            "step_yards must be between 1 and 100",
        ));
    }

    let catalogue = Arc::clone(&state.ammunition);
    let work = move || {
        catalogue
            .iter()
            .filter(|load| match &request.cartridges {
                Some(wanted) => wanted.iter().any(|c| c == &load.cartridge),
                None => true,
            })
            .filter_map(|load| {
                let solved = TrajectoryRequest {
                    load: load_from_catalogue(load)?,
                    rifle: request.rifle,
                    atmosphere: request.atmosphere,
                    shot: request.shot,
                }
                .solve();

                Some(SuitabilityEntry {
                    load_id: load.id.clone(),
                    points: sample(solved, request.step_yards),
                })
            })
            .collect::<Vec<_>>()
    };

    match tokio::time::timeout(SOLVE_TIMEOUT, tokio::task::spawn_blocking(work)).await {
        Ok(Ok(entries)) => Ok(Json(entries)),
        Ok(Err(_)) => Err(ApiError::internal("the solver task panicked")),
        Err(_) => Err(ApiError::internal("the solver timed out")),
    }
}

/// Turns a catalogue entry into something the solver can take.
///
/// A ballistic coefficient only means anything paired with the drag model
/// it was measured against, so the two are chosen together. Preference runs
/// G7, then G5, then G1: these are boat-tail hunting bullets, and both G7
/// and G5 are shaped far closer to one than G1's blunt flat-base reference.
/// The frontend picks the same way.
///
/// `None` for a load with no coefficient at all. Startup validation rejects
/// those, so this is belt and braces rather than a live case.
fn load_from_catalogue(entry: &FactoryLoad) -> Option<Load> {
    let (drag_function, ballistic_coefficient) = match (entry.bc_g7, entry.bc_g5, entry.bc_g1) {
        (Some(bc), _, _) => (DragFunction::G7, bc),
        (None, Some(bc), _) => (DragFunction::G5, bc),
        (None, None, Some(bc)) => (DragFunction::G1, bc),
        (None, None, None) => return None,
    };

    Some(Load {
        drag_function,
        ballistic_coefficient,
        muzzle_velocity: entry.muzzle_velocity_fps,
        bullet_weight_gr: entry.bullet_weight_gr,
    })
}

/// Thins a per-yard trajectory to every `step` yards, always keeping the
/// last point so the furthest range the load reaches is not rounded away.
fn sample(points: Vec<TrajectoryPoint>, step: u32) -> Vec<TrajectoryPoint> {
    let last = points.len().saturating_sub(1);
    points
        .into_iter()
        .enumerate()
        .filter(|(i, point)| *i == last || point.yards % i64::from(step) == 0)
        .map(|(_, point)| point)
        .collect()
}

/// The rules themselves live in [`ballistics_core::validation`], shared with
/// the WebAssembly build so the browser and the server can never disagree
/// about what a valid shot is. This only turns a failure into a 400.
fn validate_request(request: &TrajectoryRequest) -> Result<(), ApiError> {
    request.validate().map_err(ApiError::bad_request)
}

/// As above, for the conditions alone - `/api/suitability` holds these fixed
/// while varying the load, so they are checked once rather than per entry.
fn validate_conditions(
    rifle: &Rifle,
    atmosphere: &Atmosphere,
    shot: &Shot,
) -> Result<(), ApiError> {
    ballistics_core::validation::validate_conditions(rifle, atmosphere, shot)
        .map_err(ApiError::bad_request)
}

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ballistics_core::{Atmosphere, Load, Rifle, Shot};

    fn valid_request() -> TrajectoryRequest {
        TrajectoryRequest {
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
            shot: Shot::default(),
        }
    }

    // The rules are tested one by one in `ballistics_core::validation`. What
    // belongs here is only that the server turns a failure into a 400 that
    // carries the core's message unchanged - the same text the WebAssembly
    // build reports, so a person sees one wording whichever way it solved.

    #[test]
    fn accepts_a_sane_request() {
        assert!(validate_request(&valid_request()).is_ok());
    }

    #[test]
    fn a_rejected_request_is_a_400_with_the_cores_message() {
        let mut request = valid_request();
        request.load.muzzle_velocity = 0.0;

        let error = validate_request(&request).expect_err("should be rejected");
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert_eq!(
            error.message,
            request.validate().unwrap_err(),
            "the server must pass the core's wording through verbatim"
        );
    }

    #[test]
    fn warn_if_static_dir_missing_does_not_panic_either_way() {
        // A real directory (this crate's own manifest dir always exists).
        warn_if_static_dir_missing(env!("CARGO_MANIFEST_DIR"));
        // A path that can't exist.
        warn_if_static_dir_missing("/definitely/not/a/real/path/xyz123");
    }

    #[test]
    fn resolve_addr_prefers_explicit_addr_over_port() {
        let addr = resolve_addr_from(Some("127.0.0.1:9999".to_string()), Some("8080".to_string()));
        assert_eq!(addr, "127.0.0.1:9999".parse().unwrap());
    }

    #[test]
    fn resolve_addr_falls_back_to_port() {
        let addr = resolve_addr_from(None, Some("8080".to_string()));
        assert_eq!(addr, "0.0.0.0:8080".parse().unwrap());
    }

    #[test]
    fn resolve_addr_defaults_when_nothing_set() {
        let addr = resolve_addr_from(None, None);
        assert_eq!(addr, "0.0.0.0:3000".parse().unwrap());
    }

    fn catalogue_entry(bc_g1: Option<f64>, bc_g5: Option<f64>, bc_g7: Option<f64>) -> FactoryLoad {
        FactoryLoad {
            id: "test".to_string(),
            manufacturer: "Test".to_string(),
            product_line: "Line".to_string(),
            cartridge: ".308 Winchester".to_string(),
            bullet: "168 gr TTSX".to_string(),
            bullet_weight_gr: 168.0,
            muzzle_velocity_fps: 2700.0,
            test_barrel_in: Some(24.0),
            bc_g1,
            bc_g5,
            bc_g7,
            stated_muzzle_energy_ft_lb: None,
            maker_max_range_yd: None,
            source_url: "https://example.invalid/load".to_string(),
            retrieved: "2026-01-01".to_string(),
        }
    }

    /// The pairing that matters: a G1 number handed to the G7 drag function
    /// is not an error, just a wrong trajectory, so the two travel together.
    #[test]
    fn a_catalogue_load_keeps_its_coefficient_with_its_drag_model() {
        let g7 = load_from_catalogue(&catalogue_entry(Some(0.45), None, Some(0.22))).unwrap();
        assert_eq!(g7.drag_function, DragFunction::G7);
        assert_eq!(g7.ballistic_coefficient, 0.22);

        // G5 outranks G1 but not G7.
        let g5 = load_from_catalogue(&catalogue_entry(Some(0.45), Some(0.26), None)).unwrap();
        assert_eq!(g5.drag_function, DragFunction::G5);
        assert_eq!(g5.ballistic_coefficient, 0.26);
        let both = load_from_catalogue(&catalogue_entry(None, Some(0.26), Some(0.22))).unwrap();
        assert_eq!(both.drag_function, DragFunction::G7);

        let g1_only = load_from_catalogue(&catalogue_entry(Some(0.45), None, None)).unwrap();
        assert_eq!(g1_only.drag_function, DragFunction::G1);
        assert_eq!(g1_only.ballistic_coefficient, 0.45);

        assert!(load_from_catalogue(&catalogue_entry(None, None, None)).is_none());
    }

    fn point_at(yards: i64) -> TrajectoryPoint {
        TrajectoryPoint {
            yards,
            moa_correction: 0.0,
            impact_in: 0.0,
            path_inches: 0.0,
            seconds: 0.0,
            velocity_fps: 0.0,
            energy_ft_lb: 0.0,
            windage_in: 0.0,
        }
    }

    #[test]
    fn sampling_thins_to_the_step_and_keeps_the_last_point() {
        let points: Vec<_> = (1..=25).map(point_at).collect();
        let yards: Vec<_> = sample(points, 10).iter().map(|p| p.yards).collect();
        // 10 and 20 are on the step; 25 survives as the furthest range the
        // load reached, which is the figure the shortlist reports.
        assert_eq!(yards, vec![10, 20, 25]);
    }

    #[test]
    fn sampling_does_not_duplicate_a_last_point_already_on_the_step() {
        let points: Vec<_> = (1..=20).map(point_at).collect();
        let yards: Vec<_> = sample(points, 10).iter().map(|p| p.yards).collect();
        assert_eq!(yards, vec![10, 20]);
    }

    /// The whole point of the split: the shortlist holds these fixed while
    /// varying the load, so they have to be checkable on their own.
    #[test]
    fn conditions_validate_without_a_load() {
        let request = valid_request();
        assert!(
            validate_conditions(&request.rifle, &request.atmosphere, &request.shot).is_ok(),
            "the shared valid fixture should pass"
        );

        let mut bad = request;
        bad.rifle.zero_range = 0.0;
        assert!(validate_conditions(&bad.rifle, &bad.atmosphere, &bad.shot).is_err());
    }
}
