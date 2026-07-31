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
use ballistics_core::{DragFunction, TrajectoryPoint, TrajectoryRequest};
use serde::Serialize;
use tower_http::services::ServeDir;

mod species;

use species::AnimalProfile;

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

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/drag-functions", get(drag_functions))
        .route("/api/animals", get(animals_handler))
        .route("/api/trajectory", post(solve_trajectory))
        .fallback_service(ServeDir::new(static_dir))
        .with_state(animals);

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

async fn animals_handler(
    State(animals): State<Arc<Vec<AnimalProfile>>>,
) -> Json<Vec<AnimalProfile>> {
    // serde only serializes Arc behind its "rc" feature; the list is a
    // handful of small records, so cloning it is cheaper than the setup.
    Json(animals.as_ref().clone())
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

/// Rejects inputs that are non-physical or that could send the point-mass
/// integrator into pathological behavior (e.g. dividing by a near-zero
/// velocity, or an unbounded zero range keeping the zero-angle search loop
/// running far longer than any real rifle setup would need).
fn validate_request(request: &TrajectoryRequest) -> Result<(), ApiError> {
    let load = &request.load;
    let rifle = &request.rifle;
    let atmosphere = &request.atmosphere;
    let shot = &request.shot;

    let checks: [(bool, &str); 11] = [
        (
            load.ballistic_coefficient.is_finite() && load.ballistic_coefficient > 0.0,
            "load.ballistic_coefficient must be a positive, finite number",
        ),
        (
            load.muzzle_velocity.is_finite()
                && load.muzzle_velocity > 0.0
                && load.muzzle_velocity < 10_000.0,
            "load.muzzle_velocity must be between 0 and 10000 ft/s",
        ),
        (
            rifle.sight_height.is_finite() && rifle.sight_height.abs() < 100.0,
            "rifle.sight_height must be a plausible number of inches",
        ),
        (
            rifle.zero_range.is_finite() && rifle.zero_range > 0.0 && rifle.zero_range <= 1000.0,
            "rifle.zero_range must be between 0 and 1000 yards",
        ),
        (
            rifle.zero_y_intercept.is_finite(),
            "rifle.zero_y_intercept must be finite",
        ),
        (
            atmosphere.pressure.is_finite() && atmosphere.pressure > 0.0,
            "atmosphere.pressure must be a positive number of in-Hg",
        ),
        (
            atmosphere.temperature.is_finite()
                && atmosphere.temperature > -100.0
                && atmosphere.temperature < 150.0,
            "atmosphere.temperature must be a plausible Fahrenheit value",
        ),
        (
            (0.0..=1.0).contains(&atmosphere.relative_humidity),
            "atmosphere.relative_humidity must be between 0 and 1",
        ),
        (
            atmosphere.altitude.is_finite() && atmosphere.altitude.abs() < 30_000.0,
            "atmosphere.altitude must be a plausible number of feet",
        ),
        (
            shot.shooting_angle.is_finite() && shot.shooting_angle.abs() < 89.0,
            "shot.shooting_angle must be between -89 and 89 degrees",
        ),
        (
            shot.wind_speed.is_finite() && (0.0..200.0).contains(&shot.wind_speed),
            "shot.wind_speed must be between 0 and 200 mph",
        ),
    ];

    match checks.iter().find(|(ok, _)| !ok) {
        Some((_, message)) => Err(ApiError::bad_request(*message)),
        None => Ok(()),
    }
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

    #[test]
    fn accepts_a_sane_request() {
        assert!(validate_request(&valid_request()).is_ok());
    }

    #[test]
    fn rejects_non_positive_muzzle_velocity() {
        let mut request = valid_request();
        request.load.muzzle_velocity = 0.0;
        assert!(validate_request(&request).is_err());

        request.load.muzzle_velocity = -100.0;
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn rejects_non_positive_ballistic_coefficient() {
        let mut request = valid_request();
        request.load.ballistic_coefficient = 0.0;
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn rejects_unbounded_zero_range() {
        let mut request = valid_request();
        request.rifle.zero_range = 1e9;
        assert!(validate_request(&request).is_err());

        request.rifle.zero_range = 0.0;
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn rejects_out_of_range_humidity_and_nan() {
        let mut request = valid_request();
        request.atmosphere.relative_humidity = 1.5;
        assert!(validate_request(&request).is_err());

        request.atmosphere.relative_humidity = f64::NAN;
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn rejects_extreme_shooting_angle() {
        let mut request = valid_request();
        request.shot.shooting_angle = 90.0;
        assert!(validate_request(&request).is_err());
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
}
