# ballistics

A Rust rewrite of [pyBallistics](https://github.com/rezap/pyBallistics)
(itself a Python port of the GNU Ballistics Library), on its way to becoming
a web app that helps hunters visualize bullet drop, wind drift, and hit
point on game animals to support more ethical shot decisions.

See [`ROADMAP.md`](./ROADMAP.md) for the phased plan.

## Status

**Phase 1 complete:** the core point-mass ballistics engine is ported to
Rust, verified against golden values generated from the original Python
implementation, and feature-complete — all seven drag functions (G1, G2,
G3, G5, G6, G7, G8) are wired up, the rifle/load/atmosphere/shot profile is
fully configurable via `TrajectoryRequest`, and a latent upstream angle-unit
bug in cant/incline compensation has been fixed.

**Phase 2 complete:** a web app (`ballistics-api`) serves the engine over
HTTP with a browser UI, and is deployed and live at
<https://ballistics-production-2c51.up.railway.app>.

**Phase 3 in progress:** the ethical-shot assistant. Eleven game species
(roe deer, fallow deer, red deer stag, whitetail deer, elk, moose, wild
hog, red fox, brown hare, pigeon, wild turkey) ship with silhouette
artwork, vital-zone geometry, sizes,
habitat, diet and fun facts. The web app scales the artwork to real-world
dimensions and overlays the computed point of impact against the vital
zone. Range takes a "could be ±" band and wind takes a Beaufort force
rather than a speed, so the impact is drawn as the region it could
actually fall in rather than a single confident dot — and the shape of
that region says which unknown is costing you. The shot can be aimed
dead-on, with elevation dialled, or by
dragging a hold-over crosshair onto the drawing, and the rifle's group
size in MOA is drawn as a dispersion circle so the impact is judged as a
group rather than a single perfect point. Species data is data-driven:
adding an animal is a PNG plus a `species.json` entry, with no code
change.

## Workspace layout

- [`crates/ballistics-core`](./crates/ballistics-core) — the ballistics
  engine: drag models (G1/G2/G3/G5/G6/G7/G8, all fully wired up),
  atmospheric correction, zero-angle solving, wind resolution, the
  trajectory integrator, and a configurable `TrajectoryRequest` API.
- [`crates/ballistics-cli`](./crates/ballistics-cli) — a small demo binary
  that prints a bullet-drop-compensation table (mirrors pyBallistics'
  `example.py`).
- [`crates/ballistics-api`](./crates/ballistics-api) — an Axum web server
  exposing the engine over a JSON API, plus a static HTML/JS frontend
  (form inputs, a results table, a canvas trajectory chart, and a
  species-vs-vitals overlay with an animal info panel). Rifle and load
  presets are kept in the browser rather than on the server, so they work
  with no signal; they can be exported as a JSON file or shared as a
  link.

## Building and testing

```sh
cargo build --workspace
cargo test --workspace
cargo run -p ballistics-cli
```

## Running the web app

```sh
cd crates/ballistics-api
cargo run
```

`ballistics-api` looks for its frontend in a `static` folder *relative to
whatever directory you launch it from* — running `cargo run -p ballistics-api`
from the repo root instead (rather than from inside `crates/ballistics-api`)
won't find it, and the browser UI will 404 while the API endpoints keep
working fine. If that happens, the server prints a warning to the terminal
explaining exactly this and how to fix it (`scripts/run.ps1` on Windows
already sets this up correctly, or set `BALLISTICS_STATIC_DIR` to the
absolute path of `crates/ballistics-api/static`).

Then, **in your browser's address bar, go to <http://localhost:3000>.**
Don't open `crates/ballistics-api/static/index.html` directly (e.g. by
double-clicking it in a file browser) — that loads the page from a `file://`
URL with no server behind it, so the "Calculate trajectory" button can't
reach the API and the browser blocks the request with a CORS error. The
page it serves at `http://localhost:3000` *is* `index.html`; it just needs
to be loaded through the running server, not opened as a bare file. If you
do open it directly, the page now shows a banner explaining this instead of
silently failing.

Endpoints:

- `POST /api/trajectory` — solve a trajectory from a JSON `{ load, rifle, atmosphere?, shot? }` body (see `crates/ballistics-api/static/app.js` for a working example); returns an array of per-yard trajectory points (drop, wind drift, retained velocity and energy, time of flight).
- `GET /api/drag-functions` — list the supported drag functions.
- `GET /api/animals` — list supported game species with vital-zone geometry, artwork dimensions, sizes, habitat, diet, and fun facts. Loaded from `crates/ballistics-api/static/animals/species.json`; see that directory's README for how to add a species.
- `GET /api/ammunition` — list factory loads with bullet weight, advertised muzzle velocity, test barrel length and ballistic coefficients (each against its own drag model). Loaded from `crates/ballistics-api/static/ammunition/loads.json`; see that directory's README for how to add a load and why the figures are labelled advertised rather than measured.
- `GET /health` — liveness check.

Configuration is via environment variables: `BALLISTICS_API_ADDR` (a full
`host:port`, takes precedence if set), `PORT` (just the port number — used
if `BALLISTICS_API_ADDR` isn't set; this is what most hosting platforms
inject), and `BALLISTICS_STATIC_DIR` (default `static`, relative to the
working directory the binary is run from). With neither `BALLISTICS_API_ADDR`
nor `PORT` set, it defaults to `0.0.0.0:3000`.

## Deploying

The repo includes a `Dockerfile` that builds `ballistics-api` (multi-stage:
compiles the release binary, then copies it plus its `static/` assets into
a slim runtime image), plus config for two PaaS providers that both build
that Dockerfile directly from the GitHub repo — pick whichever you already
have an account on.

### Railway

`railway.json` tells Railway to use the Dockerfile (rather than
auto-detecting a builder) and where to health-check:

1. In the Railway dashboard: **New Project** → **Deploy from GitHub repo**
   → select `rezap/ballistics`.
2. Railway detects `railway.json`, builds `Dockerfile`, and deploys — no
   other configuration needed. It injects its own `PORT`, which
   `ballistics-api` already reads (see below).
3. Once the deploy finishes, go to the service's **Settings** → **Networking**
   and click **Generate Domain** to get a public
   `https://<service-name>.up.railway.app` URL (Railway doesn't expose one
   automatically by default).

### Render

`render.yaml` is a [Render](https://render.com) blueprint:

1. On Render: **New +** → **Blueprint**, connect the repo. Render detects
   `render.yaml` and configures the service automatically (Docker build,
   free plan, `/health` health check) — no manual setup needed.
2. Click **Apply**. Render builds the `Dockerfile` and gives you a public
   `https://<service-name>.onrender.com` URL once it's live.

Neither path needs a CLI or local Docker install. The image also runs
anywhere else that can run a container — it respects `PORT` if the
platform sets one, and `BALLISTICS_API_ADDR` otherwise.

To build and run it locally with Docker instead:

```sh
docker build -t ballistics-api .
docker run --rm -p 3000:3000 ballistics-api
```

### Windows

[`scripts/run.ps1`](./scripts/run.ps1) runs `cargo test --workspace` and,
only if every test passes, starts `ballistics-api` on
<http://localhost:3000>:

```powershell
.\scripts\run.ps1
```

If PowerShell blocks it with a "running scripts is disabled" error, run it
once via:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1
```
