const form = document.getElementById("trajectory-form");
const resultsSection = document.getElementById("results");
const errorBox = document.getElementById("error");
const engineNote = document.getElementById("engine-note");
const tableBody = document.querySelector("#results-table tbody");
const canvas = document.getElementById("chart");
const speciesSelect = document.getElementById("species-select");
const shotRangeInput = document.getElementById("shot-range");
const vitalsCanvas = document.getElementById("vitals-canvas");
const animalInfo = document.getElementById("animal-info");
const scaleBasisSelect = document.getElementById("scale-basis");
const scaleValueInput = document.getElementById("scale-value");
const scaleUnitSelect = document.getElementById("scale-unit");
const scaleResetButton = document.getElementById("scale-reset");
const vitalsWidthInput = document.getElementById("vitals-width");
const vitalsHeightInput = document.getElementById("vitals-height");
const tableStepInput = document.getElementById("table-step");
const tableMaxInput = document.getElementById("table-max");
const columnToggles = document.getElementById("column-toggles");
const expansionVelocityInput = document.getElementById("expansion-velocity");
const minEnergyInput = document.getElementById("min-energy");
const aimModeSelect = document.getElementById("aim-mode");
const windModeSelect = document.getElementById("wind-mode");
const groupMoaInput = document.getElementById("group-moa");
const groupWarning = document.getElementById("group-warning");
const solveHoldButton = document.getElementById("solve-hold");
const presetSelect = document.getElementById("preset-select");
const presetNameInput = document.getElementById("preset-name");
const presetSaveButton = document.getElementById("preset-save");
const presetDeleteButton = document.getElementById("preset-delete");
const presetShareButton = document.getElementById("preset-share");
const presetExportButton = document.getElementById("preset-export");
const presetImportButton = document.getElementById("preset-import");
const presetFileInput = document.getElementById("preset-file");
const presetStatus = document.getElementById("preset-status");
const factoryLoadSelect = document.getElementById("factory-load");
const factoryLoadNote = document.getElementById("factory-load-note");
const shortlistRunButton = document.getElementById("shortlist-run");
const shortlistSameCartridge = document.getElementById("shortlist-same-cartridge");
const shortlistFilterLabel = document.getElementById("shortlist-filter-label");
const shortlistCartridgeName = document.getElementById("shortlist-cartridge-name");
const shortlistNote = document.getElementById("shortlist-note");
const shortlistWrap = document.getElementById("shortlist-wrap");
const shortlistBody = document.querySelector("#shortlist tbody");
const windScaleSelect = document.getElementById("wind-scale");
const rangeUncertaintyInput = document.getElementById("range-uncertainty");
const windAngleUncertaintyInput = document.getElementById("wind-angle-uncertainty");
const motionGaitSelect = document.getElementById("motion-gait");
const motionSpeedInput = document.getElementById("motion-speed");
const motionSlopInput = document.getElementById("motion-slop");
const motionDirectionSelect = document.getElementById("motion-direction");
const motionAngleSelect = document.getElementById("motion-angle");
const unitSystemSelect = document.getElementById("unit-system");
const angleUnitSelect = document.getElementById("angle-unit");

// ---------------------------------------------------------------------------
// Units.
//
// Everything the page holds is in the solver's own units - yards, inches,
// ft/s, mph, inHg, °F, ft·lb and MOA - whatever is on screen. Metric and
// mrad are a view: units.js converts on the way into an input and on the
// way out to the screen, and nowhere else. Presets and share links are in
// the one set of units too, so a load saved on a metric page opens
// correctly on an imperial one.
//
// Each input with a unit keeps its exact value alongside what it shows, so
// switching back and forth never drifts: a 100 m zero shows as 109.36 yd
// and comes back as 100 m, not 99.99.
// ---------------------------------------------------------------------------

const UNITS_STORAGE_KEY = "ballistics.units";

function loadUnitChoice() {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  const fallback = {
    system: ballisticsUnits.defaultSystem(languages),
    angle: ballisticsUnits.defaultAngle(languages),
  };
  try {
    const saved = JSON.parse(window.localStorage.getItem(UNITS_STORAGE_KEY) ?? "null");
    return {
      system: ballisticsUnits.SYSTEMS.includes(saved?.system) ? saved.system : fallback.system,
      angle: ballisticsUnits.ANGLE_UNITS.includes(saved?.angle) ? saved.angle : fallback.angle,
    };
  } catch {
    return fallback;
  }
}

function saveUnitChoice() {
  try {
    window.localStorage.setItem(UNITS_STORAGE_KEY, JSON.stringify(units));
  } catch {
    // Remembered for this visit only, then.
  }
}

let units = loadUnitChoice();

const imperial = () => units.system === "imperial";

/// A value in the solver's units, converted to what is shown.
const shown = (quantity, value) => ballisticsUnits.toDisplay(quantity, value, units);

/// The unit a quantity is shown in, e.g. "yd" or "m".
const unitOf = (quantity) => ballisticsUnits.unitLabel(quantity, units);

// Every input whose number carries a unit, and which unit it is.
const UNIT_FIELDS = [
  [form.elements.muzzle_velocity, "velocity"],
  [expansionVelocityInput, "velocity"],
  [form.elements.sight_height, "length"],
  [form.elements.zero_range, "distance"],
  [form.elements.wind_speed, "windSpeed"],
  [form.elements.altitude, "altitude"],
  [form.elements.pressure, "pressure"],
  [form.elements.temperature, "temperature"],
  [shotRangeInput, "distance"],
  [rangeUncertaintyInput, "distance"],
  [groupMoaInput, "angle"],
  [vitalsWidthInput, "length"],
  [vitalsHeightInput, "length"],
  [minEnergyInput, "energy"],
  [motionSpeedInput, "animalSpeed"],
  [motionSlopInput, "animalSpeed"],
];

/// An input's value in the solver's units.
///
/// The exact value it was last given, while it still shows what it was
/// given; otherwise whatever has been typed, converted. Blank reads as 0,
/// exactly as `Number("")` did before units existed, so every caller's
/// handling of an empty box is unchanged.
function readCanonical(input) {
  if (input.dataset.canonical !== undefined && input.dataset.shown === input.value) {
    return Number(input.dataset.canonical);
  }
  return ballisticsUnits.toCanonical(input.dataset.quantity, Number(input.value), units);
}

/// Puts a value, in the solver's units, into an input - shown in the
/// current units, and kept exactly. Blank or null empties the input.
function writeCanonical(input, value) {
  if (value === "" || value == null || !Number.isFinite(Number(value))) {
    input.value = "";
    delete input.dataset.canonical;
    delete input.dataset.shown;
    return;
  }
  const quantity = input.dataset.quantity;
  const number = Number(value);
  input.value = ballisticsUnits.trimmed(
    shown(quantity, number),
    ballisticsUnits.inputDecimals(quantity, units)
  );
  input.dataset.canonical = String(number);
  input.dataset.shown = input.value;
}

for (const [input, quantity] of UNIT_FIELDS) {
  input.dataset.quantity = quantity;
  // The markup's limits are in the solver's units; they are converted
  // along with everything else.
  for (const attr of ["min", "max"]) {
    if (input.hasAttribute(attr)) input.dataset[`${attr}Canonical`] = input.getAttribute(attr);
  }
  // A converted value is rarely a whole number, and a fixed step would
  // make the browser refuse to submit it.
  input.step = "any";
  // From the markup's default, not the current value: after a reload a
  // browser may put back what was on screen, and on a metric page that is
  // not in the solver's units. Chromium does not, Firefox does.
  if (input.defaultValue !== "") writeCanonical(input, Number(input.defaultValue));
}

// A zero and a first shot at a round 100 in either system, rather than
// the 91.44 m a converted 100 yd would show. Only the page's own defaults
// get this - anything the user or a preset sets is converted exactly.
if (!imperial()) {
  writeCanonical(form.elements.zero_range, ballisticsUnits.toCanonical("distance", 100, units));
  writeCanonical(shotRangeInput, ballisticsUnits.toCanonical("distance", 100, units));
}

/// A distance, for display without its unit. Imperial prints yards as
/// they are, as it always has; metric rounds to the metre.
///
/// `rounded` rounds imperial too, where the page always did. `atMost` is
/// for a limit - the furthest a load stays ethical - which is rounded down
/// in metric, never up past what was actually solved.
function distanceText(yards, { rounded = false, atMost = false } = {}) {
  if (imperial()) return String(rounded ? Math.round(yards) : yards);
  const metres = shown("distance", yards);
  return String(atMost ? Math.floor(metres + 1e-6) : Math.round(metres));
}

/// A length on the target, to one decimal.
const lengthText = (inches) => formatInches(shown("length", inches));

/// An angle, to one decimal - a quarter-MOA or tenth-mrad click either way.
const angleText = (moa) => formatInches(shown("angle", moa));

/// A wind speed from the Beaufort table, which is whole mph.
const bandSpeedText = (mph) =>
  imperial() ? String(mph) : ballisticsUnits.trimmed(shown("windSpeed", mph), 1);

let animalsList = [];
let factoryLoads = [];
let lastPoints = null;

// Set when the page was opened from a share link, so the trajectory can be
// solved once the species list has arrived and the panel has something to
// draw against.
let pendingSharedPreset = false;

// Whether a load arrived in the URL fragment. Distinct from
// `pendingSharedPreset`, which is cleared as soon as the shared load has been
// solved once: this one has to outlive that, because `loadAnimals` and
// `loadAmmunition` race and either may finish first. Without it, whichever
// lost the race would overwrite someone's shared link with the defaults.
let sharedPresetApplied = false;

// What the form opens on. The old defaults were a 168 gr G7 0.243 at 2700
// and whichever species happened to be first in the list, which is nobody's
// actual rifle and nobody's actual quarry.
const DEFAULT_FACTORY_LOAD = "federal-fusion-308-180";
const DEFAULT_SPECIES = "stag";

// The calibration box has its own unit picker, since a body length might
// be read off anything. Exact factors: an inch is 2.54 cm by definition.
const UNIT_TO_INCHES = { in: 1, cm: 1 / 2.54, m: 100 / 2.54 };
const imageCache = new Map();

// Set by the last render so pointer events can map canvas coordinates back
// into the artwork's own pixel space.
let lastTransform = null;

// Where the crosshair sits relative to the vitals centre, in inches, when
// either axis is being held off for. Deliberately survives a change of
// range: seeing where one fixed hold lands across a band of ranges is what
// the mode is for. It resets on a change of species or of either mode.
//
// One offset covers both axes, but each axis is only live when its own
// mode says so - see `heldAxes`. Holding for wind while dialling elevation
// therefore moves the crosshair sideways only.
let holdOffsetIn = { x: 0, y: 0 };

// The aim point the impact is actually solved from. It lags the crosshair
// while the crosshair is being dragged, and catches up when the shot is
// recalculated - on releasing the drag, or on pressing Calculate.
//
// Dragging both together would be arithmetically identical (the drop is
// fixed at a given range, so the pair just slides), but it hides the one
// thing hold-over is about: you point somewhere other than the vitals,
// and the shot is then worked out from where you pointed. Freezing the
// impact during the drag makes the aim move against a fixed reference,
// and releasing shows the result.
let appliedHoldIn = { x: 0, y: 0 };

function resetHold() {
  holdOffsetIn = { x: 0, y: 0 };
  appliedHoldIn = { x: 0, y: 0 };
}

/// Re-solves the impact from wherever the crosshair has been left.
function applyHold() {
  appliedHoldIn = { ...holdOffsetIn };
}

/// True while the crosshair has been moved but the shot has not been
/// re-solved from its new position.
function holdIsPending() {
  return holdOffsetIn.x !== appliedHoldIn.x || holdOffsetIn.y !== appliedHoldIn.y;
}

// A group this wide is poor for a modern hunting rifle, so typing one is
// more likely a slip than a real measurement - hence the confirmation.
const IMPLAUSIBLE_GROUP_MOA = 2;

// The group size actually in use, which is not simply what is in the box:
// an implausible figure is held back until the user confirms it, so a
// mistyped "30" cannot quietly turn every shot into a miss.
let confirmedGroupMoa = 0;

function aimMode() {
  return aimModeSelect.value;
}

function windMode() {
  return windModeSelect.value;
}

/// Which axes the crosshair is free to move on. Elevation and windage are
/// compensated independently - dialling the turret for drop while holding
/// off into the wind is the usual field combination - so the two selects
/// each own one axis of the hold.
function heldAxes() {
  return {
    x: windMode() === "held",
    y: aimMode() === "holdover",
  };
}

function crosshairIsMovable() {
  const axes = heldAxes();
  return axes.x || axes.y;
}

function groupMoa() {
  return confirmedGroupMoa;
}

/// The number as typed, normalised. Anything blank, negative or unparseable
/// means "treat the rifle as perfect", which is the default.
function typedGroupMoa() {
  const value = readCanonical(groupMoaInput);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/// Group diameter in inches at this range. One MOA subtends 1.047 inches
/// per 100 yards, near enough that the shorthand "one inch at a hundred"
/// is what most people quote - but the exact figure is used, the same true
/// MOA the solver works in, so a group given in mrad converts without a
/// rounding of its own.
function groupDiameterInches(yards) {
  return ballisticsUnits.moaToInches(groupMoa(), yards);
}

// Opening index.html directly as a file (e.g. double-clicking it) gives the
// page a "file:" origin, and browsers block fetch() entirely from there —
// the resulting console error ("origin 'null' has been blocked by CORS
// policy") gives no hint that the fix is simply to load the page from the
// running server instead. Detect that case up front and say so plainly,
// rather than letting the user hit a cryptic fetch failure on submit.
if (window.location.protocol === "file:") {
  document.getElementById("protocol-warning").hidden = false;
  form.querySelectorAll("input, select, button").forEach((el) => {
    el.disabled = true;
  });
} else {
  loadAnimals();
  loadAmmunition();
}

async function loadAnimals() {
  try {
    const response = await fetch("/api/animals");
    animalsList = await response.json();
  } catch {
    animalsList = [];
  }

  speciesSelect.innerHTML = animalsList
    .map((a) => `<option value="${a.key}">${a.common_name}</option>`)
    .join("");

  // Unguarded by `sharedPresetApplied`: a preset carries the rifle and the
  // ammunition, never the quarry, so there is nothing here for a shared link
  // to disagree with.
  if (animalsList.some((a) => a.key === DEFAULT_SPECIES)) {
    speciesSelect.value = DEFAULT_SPECIES;
  }

  syncScaleControls();
  preloadArtwork();

  if (pendingSharedPreset) {
    pendingSharedPreset = false;
    form.requestSubmit();
  }
}

function currentProfile() {
  return animalsList.find((a) => a.key === speciesSelect.value) ?? null;
}

// ---------------------------------------------------------------------------
// Factory ammunition.
//
// Picking a box off the shelf beats typing four numbers off it, but every
// figure in the catalogue is what the maker advertises, not what your rifle
// does. The note under the picker says so, with the test barrel length,
// because the gap is not academic: a 20in barrel against a 24in test barrel
// is roughly 100 fps down, which is inches of drop at 400 yards and moves
// the max ethical range in the direction that wounds animals.
// ---------------------------------------------------------------------------

async function loadAmmunition() {
  try {
    const response = await fetch("/api/ammunition");
    factoryLoads = await response.json();
  } catch {
    factoryLoads = [];
  }

  if (!factoryLoads.length) return;

  // Grouped by cartridge, which is how anyone shopping for ammunition
  // thinks about it - you have the rifle already.
  const byCartridge = new Map();
  for (const entry of factoryLoads) {
    if (!byCartridge.has(entry.cartridge)) byCartridge.set(entry.cartridge, []);
    byCartridge.get(entry.cartridge).push(entry);
  }

  factoryLoadSelect.innerHTML =
    `<option value="">Enter figures by hand</option>` +
    [...byCartridge]
      .map(
        ([cartridge, loads]) =>
          `<optgroup label="${escapeHtml(cartridge)}">` +
          loads
            .map(
              (l) =>
                `<option value="${escapeHtml(l.id)}">${escapeHtml(
                  `${l.manufacturer} ${l.product_line} ${l.bullet}`
                )}</option>`
            )
            .join("") +
          `</optgroup>`
      )
      .join("");

  // Opening on a real box off the shelf rather than four typed numbers also
  // means the provenance note is visible from the first screen, which is the
  // one thing about this data that should never be easy to miss.
  //
  // Skipped when a shared link has already set the load: someone handed a
  // rifle should see that rifle.
  if (!sharedPresetApplied) {
    const preferred = factoryLoads.find((l) => l.id === DEFAULT_FACTORY_LOAD);
    if (preferred) {
      factoryLoadSelect.value = preferred.id;
      applyFactoryLoad(preferred);
      noteShortlistCartridge(preferred.cartridge);
    }
  }
}

function applyFactoryLoad(entry) {
  // The drag model and coefficient are picked together, by the same rule
  // the catalogue ranking uses (see solver.js), so a load put in the form
  // solves exactly as it did in the shortlist.
  const load = ballisticsSolver.loadFromCatalogue(entry);
  if (!load) return;
  form.elements.drag_function.value = load.drag_function;
  form.elements.ballistic_coefficient.value = load.ballistic_coefficient;
  writeCanonical(form.elements.muzzle_velocity, entry.muzzle_velocity_fps);
  form.elements.bullet_weight_gr.value = entry.bullet_weight_gr;
  renderFactoryLoadNote(entry, load);
}

/// Where the load's figures come from. Barrels are measured in inches the
/// world over, so a metric page gives the centimetres alongside rather
/// than instead.
function renderFactoryLoadNote(entry, load = ballisticsSolver.loadFromCatalogue(entry)) {
  const barrel =
    entry.test_barrel_in == null
      ? "test barrel length not stated"
      : imperial()
        ? `${entry.test_barrel_in}in test barrel`
        : `${entry.test_barrel_in} in (${Math.round(shown("length", entry.test_barrel_in))} cm) test barrel`;
  // 20-30 ft/s is 6.1-9.1 m/s.
  const perInch = imperial() ? "20&ndash;30 ft/s" : "6&ndash;9 m/s";
  factoryLoadNote.hidden = false;
  factoryLoadNote.innerHTML =
    `Advertised by ${escapeHtml(entry.manufacturer)} &mdash; ${barrel}, ` +
    `BC quoted against ${load?.drag_function}. Your rifle will not match the box: ` +
    `reckon on ${perInch} per inch of barrel below the test length, and ` +
    `chronograph it if you can. ` +
    `<a href="${escapeHtml(entry.source_url)}" target="_blank" rel="noopener noreferrer">Source</a> ` +
    `(retrieved ${escapeHtml(entry.retrieved)}).`;
}

factoryLoadSelect.addEventListener("change", () => {
  const entry = factoryLoads.find((l) => l.id === factoryLoadSelect.value);
  if (!entry) {
    factoryLoadNote.hidden = true;
    factoryLoadNote.textContent = "";
    noteShortlistCartridge(null);
    return;
  }
  applyFactoryLoad(entry);
  noteShortlistCartridge(entry.cartridge);
  presetNameInput.value = `${entry.manufacturer} ${entry.cartridge} ${entry.bullet_weight_gr}gr`;
  if (lastPoints) form.requestSubmit();
});

/// The reference measurement, in inches, that the current scale basis
/// corresponds to. Body length maps to the artwork's width; overall height
/// maps to its height (which for antlered species includes the antlers,
/// hence "as drawn" rather than shoulder height).
function referenceInches(profile, basis) {
  if (basis === "height") {
    // Derive from the artwork's aspect ratio rather than shoulder height:
    // the image spans antler tip to hoof, which shoulder height does not.
    const aspect = profile.image_height_px / profile.image_width_px;
    return profile.body_length_in * aspect;
  }
  return profile.body_length_in;
}

function storageKey(profile) {
  return `ballistics.scale.${profile.key}`;
}

function loadOverride(profile) {
  try {
    const raw = window.localStorage.getItem(storageKey(profile));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveOverride(profile, override) {
  try {
    if (override) {
      window.localStorage.setItem(storageKey(profile), JSON.stringify(override));
    } else {
      window.localStorage.removeItem(storageKey(profile));
    }
  } catch {
    // A blocked or full localStorage should not break the overlay.
  }
}

/// The vitals anchor in use: the calibrated position if the user has
/// dragged it, otherwise the value shipped in species.json.
function effectiveAnchor(profile) {
  return loadOverride(profile)?.anchor ?? profile.vitals_anchor;
}

/// The vital zone in use, in inches.
function effectiveVitals(profile) {
  return loadOverride(profile)?.vitals ?? profile.vitals;
}

/// Minimum retained energy for a clean kill, in foot-pounds, or null when
/// energy is not the limiting factor (anything smaller than roe). An
/// override of null is meaningful and distinct from "no override".
function effectiveMinEnergy(profile) {
  const override = loadOverride(profile);
  if (override && "minEnergy" in override) return override.minEnergy;
  return profile.min_energy_ft_lb ?? null;
}

/// Merges a partial change into the stored override, keeping whatever the
/// user has already calibrated for this species.
function updateOverride(profile, patch) {
  const current = loadOverride(profile) ?? {
    basis: scaleBasisSelect.value,
    value: Number(scaleValueInput.value),
    unit: scaleUnitSelect.value,
  };
  saveOverride(profile, { ...current, ...patch });
}

/// Populates the scale inputs from the stored override, or from the
/// species' reference dimensions when there is no override.
function syncScaleControls() {
  const profile = currentProfile();
  if (!profile) return;

  const override = loadOverride(profile);
  const basis = override?.basis ?? "length";
  scaleBasisSelect.value = basis;

  if (override) {
    scaleUnitSelect.value = override.unit;
    scaleValueInput.value = override.value;
  } else {
    showReferenceScale(profile, basis);
  }

  const vitals = effectiveVitals(profile);
  writeCanonical(vitalsWidthInput, round1(vitals.width_in));
  writeCanonical(vitalsHeightInput, round1(vitals.height_in));

  const minEnergy = effectiveMinEnergy(profile);
  writeCanonical(minEnergyInput, minEnergy == null ? "" : Math.round(minEnergy));
}

/// The species' own reference size, in inches or centimetres to match
/// the rest of the page.
function showReferenceScale(profile, basis) {
  const unit = imperial() ? "in" : "cm";
  scaleUnitSelect.value = unit;
  scaleValueInput.value = round1(referenceInches(profile, basis) / UNIT_TO_INCHES[unit]);
}

/// Inches per pixel of the artwork, honouring any user override.
function inchesPerPixel(profile) {
  const basis = scaleBasisSelect.value;
  const pixels = basis === "height" ? profile.image_height_px : profile.image_width_px;

  const typed = Number(scaleValueInput.value);
  const unit = scaleUnitSelect.value;
  const inches =
    Number.isFinite(typed) && typed > 0
      ? typed * (UNIT_TO_INCHES[unit] ?? 1)
      : referenceInches(profile, basis);

  return inches / pixels;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/// One decimal place, but without a trailing ".0" - "3 MOA" reads better
/// than "3.0 MOA", while "2.5" still needs its half.
function formatInches(value) {
  return String(round1(value));
}

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      // Forget the failure, so the next attempt asks again. It is usually
      // a lost signal, and the drawing should come back with it rather
      // than stay missing until the page is reloaded.
      imageCache.delete(src);
      resolve(null);
    };
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

/// Fetches every species' artwork ahead of need, so switching animal
/// works with no signal. The page otherwise only asks for a drawing when
/// the animal is picked, which in the field is exactly when there is no
/// signal to ask with. Held decoded in `imageCache`, so it does not depend
/// on the browser's HTTP cache keeping them.
///
/// About 480 KB for the lot. Started once the page has finished loading,
/// so it never competes with the page itself, the solver module, or the
/// drawing actually on screen.
function preloadArtwork() {
  const start = () => {
    for (const animal of animalsList) {
      if (animal.image) loadImage(animal.image);
    }
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

// Every column the table can show. `visible` is only the default - the
// picker persists whatever the reader chooses, which also keeps the table
// narrow enough to be usable on a phone.
//
// Labels are functions because they follow the units. A drop is to the
// hundredth of an inch, or the millimetre (a tenth of a centimetre).
const tableLength = (inches) =>
  imperial() ? inches.toFixed(2) : shown("length", inches).toFixed(1);

const COLUMNS = [
  { key: "yards", label: () => (imperial() ? "Yards" : "Metres"), visible: true, format: (p) => distanceText(p.yards) },
  { key: "drop", label: () => `Drop (${unitOf("length")})`, visible: true, format: (p) => tableLength(p.impact_in) },
  { key: "path", label: () => `Path (${unitOf("length")})`, visible: false, format: (p) => tableLength(p.path_inches) },
  { key: "wind", label: () => `Wind drift (${unitOf("length")})`, visible: true, format: (p) => tableLength(p.windage_in) },
  { key: "moa", label: () => unitOf("angle"), visible: true, format: (p) => shown("angle", p.moa_correction).toFixed(2) },
  { key: "velocity", label: () => `Velocity (${unitOf("velocity")})`, visible: true, format: (p) => Math.round(shown("velocity", p.velocity_fps)) },
  { key: "energy", label: () => `Energy (${unitOf("energy")})`, visible: true, format: (p) => Math.round(shown("energy", p.energy_ft_lb)) },
  { key: "time", label: () => "Time (s)", visible: false, format: (p) => p.seconds.toFixed(3) },
];

const COLUMN_STORAGE_KEY = "ballistics.columns";

function visibleColumnKeys() {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    if (raw) {
      const chosen = JSON.parse(raw);
      if (Array.isArray(chosen) && chosen.length) return chosen;
    }
  } catch {
    // Fall through to the defaults.
  }
  return COLUMNS.filter((c) => c.visible).map((c) => c.key);
}

function saveVisibleColumnKeys(keys) {
  try {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // A blocked localStorage should not break the table.
  }
}

// ---------------------------------------------------------------------------
// Rifle and load presets.
//
// Held in localStorage rather than on the server. A preset is worth having
// precisely when there is no signal - setting up at first light - and a
// server-backed store is exactly the thing that cannot load then. Storing
// them per-user on the server would also mean building accounts, which is a
// lot of machinery to attach to a calculator.
//
// The cost is that they live in one browser, so there are two ways out that
// need no account: a JSON file, and a link that carries the preset in its
// fragment. Both round-trip through the same validation as anything else
// from outside.
// ---------------------------------------------------------------------------

const PRESET_STORAGE_KEY = "ballistics.presets";
const PRESET_SHARE_PREFIX = "#preset=";

/// Fields a preset captures: what belongs to the rifle and the ammunition,
/// and stays put between outings. Atmosphere, wind and shot angle are
/// conditions of the day, so recalling last week's would be worse than
/// useless.
const PRESET_FIELDS = [
  { key: "drag_function", input: () => form.elements.drag_function, kind: "choice" },
  { key: "ballistic_coefficient", input: () => form.elements.ballistic_coefficient, kind: "number" },
  { key: "muzzle_velocity", input: () => form.elements.muzzle_velocity, kind: "number" },
  { key: "bullet_weight_gr", input: () => form.elements.bullet_weight_gr, kind: "number" },
  { key: "sight_height", input: () => form.elements.sight_height, kind: "number" },
  { key: "zero_range", input: () => form.elements.zero_range, kind: "number" },
  { key: "expansion_velocity", input: () => expansionVelocityInput, kind: "number" },
];

function loadPresets() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRESET_STORAGE_KEY) ?? "{}");
    return sanitisePresetCollection(parsed);
  } catch {
    return {};
  }
}

function savePresets(presets) {
  try {
    window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    // Private browsing and a full quota both land here.
    setPresetStatus("Could not save - this browser is blocking local storage.");
    return false;
  }
}

/// Validates one preset from anywhere outside this page: a file the user
/// picked, or a link someone sent them. Returns a clean preset or null.
/// Nothing is trusted, because a bad ballistic coefficient silently
/// produces a plausible-looking but wrong trajectory.
function sanitisePreset(raw) {
  if (!raw || typeof raw !== "object") return null;

  const clean = {};
  for (const field of PRESET_FIELDS) {
    const value = raw[field.key];
    if (field.kind === "choice") {
      const allowed = [...field.input().options].map((o) => o.value);
      if (!allowed.includes(value)) return null;
      clean[field.key] = value;
    } else {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) return null;
      clean[field.key] = number;
    }
  }
  return clean;
}

function sanitisePresetCollection(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const clean = {};
  for (const [name, preset] of Object.entries(raw)) {
    const trimmed = String(name).trim().slice(0, 60);
    const valid = sanitisePreset(preset);
    if (trimmed && valid) clean[trimmed] = valid;
  }
  return clean;
}

/// Always in the solver's units, whatever is on screen, so a preset - or a
/// share link - means the same on a metric page and an imperial one.
function currentPreset() {
  const preset = {};
  for (const field of PRESET_FIELDS) {
    const input = field.input();
    preset[field.key] =
      field.kind === "choice"
        ? input.value
        : input.dataset.quantity
          ? readCanonical(input)
          : Number(input.value);
  }
  return preset;
}

function applyPreset(preset) {
  for (const field of PRESET_FIELDS) {
    const input = field.input();
    if (field.kind !== "choice" && input.dataset.quantity) {
      writeCanonical(input, preset[field.key]);
    } else {
      input.value = preset[field.key];
    }
  }
}

function setPresetStatus(message) {
  presetStatus.hidden = !message;
  presetStatus.textContent = message ?? "";
}

function refreshPresetOptions(selected = "") {
  const names = Object.keys(loadPresets()).sort((a, b) => a.localeCompare(b));
  presetSelect.innerHTML =
    `<option value="">${names.length ? "No preset selected" : "None saved yet"}</option>` +
    names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  presetSelect.value = selected;
}

/// Preset names are user-supplied and go into option markup, so they are
/// escaped rather than interpolated raw.
function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function buildColumnToggles() {
  const chosen = new Set(visibleColumnKeys());
  columnToggles.innerHTML = COLUMNS.map(
    (c) => `<label class="column-toggle"><input type="checkbox" data-column="${c.key}"${
      chosen.has(c.key) ? " checked" : ""
    } />${c.label()}</label>`
  ).join("");

  columnToggles.querySelectorAll("input[data-column]").forEach((box) => {
    box.addEventListener("change", () => {
      const keys = [...columnToggles.querySelectorAll("input[data-column]")]
        .filter((b) => b.checked)
        .map((b) => b.dataset.column);
      // Never let the table become empty; the range column is the anchor.
      saveVisibleColumnKeys(keys.length ? keys : ["yards"]);
      if (!keys.length) buildColumnToggles();
      if (lastPoints) renderTable(lastPoints);
    });
  });
}

buildColumnToggles();

// The sections that change shot to shot. Everything else is set up once and
// then left alone, so on a phone those start folded away - the form ran to
// about three screens before the first number otherwise. They ship open in
// the markup so the page still works with no JavaScript, and above the
// breakpoint nothing is collapsed at all.
const SECTIONS_OPEN_ON_PHONE = new Set(["animal", "shot"]);

const PHONE = "(max-width: 700px)";

function collapseSetOnceSections() {
  if (!window.matchMedia(PHONE).matches) return;
  for (const section of document.querySelectorAll(".section")) {
    section.open = SECTIONS_OPEN_ON_PHONE.has(section.dataset.section);
  }
}

collapseSetOnceSections();

// A required field inside a folded section cannot be focused, so the browser
// would refuse to submit while showing nothing to fix. Unfold whatever failed
// validation. Captured rather than bubbled, because `invalid` does not bubble.
form.addEventListener(
  "invalid",
  (event) => {
    const section = event.target.closest(".section");
    if (section) section.open = true;
  },
  true
);

presetSelect.addEventListener("change", () => {
  const name = presetSelect.value;
  if (!name) return;
  const preset = loadPresets()[name];
  if (!preset) return;
  applyPreset(preset);
  presetNameInput.value = name;
  setPresetStatus(`Loaded "${name}".`);
  // Recalculate straight away: a preset the user has to press a second
  // button to see the effect of is only half a preset.
  form.requestSubmit();
});

presetSaveButton.addEventListener("click", () => {
  const name = presetNameInput.value.trim();
  if (!name) {
    setPresetStatus("Give the preset a name first.");
    presetNameInput.focus();
    return;
  }

  const preset = sanitisePreset(currentPreset());
  if (!preset) {
    setPresetStatus("The current settings are not valid, so there is nothing to save.");
    return;
  }

  const presets = loadPresets();
  const replacing = name in presets;
  presets[name] = preset;
  if (!savePresets(presets)) return;

  refreshPresetOptions(name);
  setPresetStatus(replacing ? `Updated "${name}".` : `Saved "${name}".`);
});

presetDeleteButton.addEventListener("click", () => {
  const name = presetSelect.value;
  if (!name) {
    setPresetStatus("Select a preset to delete.");
    return;
  }
  const presets = loadPresets();
  delete presets[name];
  if (!savePresets(presets)) return;
  refreshPresetOptions();
  setPresetStatus(`Deleted "${name}".`);
});

/// A link that carries the preset in its fragment. The fragment is never
/// sent to the server, so a shared load stays between the two people.
presetShareButton.addEventListener("click", async () => {
  const preset = sanitisePreset(currentPreset());
  if (!preset) {
    setPresetStatus("The current settings are not valid, so there is nothing to share.");
    return;
  }

  const payload = { name: presetNameInput.value.trim() || "Shared load", preset };
  const url = `${window.location.origin}${window.location.pathname}${PRESET_SHARE_PREFIX}${encodeURIComponent(
    JSON.stringify(payload)
  )}`;

  try {
    await navigator.clipboard.writeText(url);
    setPresetStatus("Share link copied to the clipboard.");
  } catch {
    // Clipboard access needs a secure context and can be refused, so fall
    // back to showing the link rather than failing silently.
    setPresetStatus(`Copy this link: ${url}`);
  }
});

presetExportButton.addEventListener("click", () => {
  const presets = loadPresets();
  if (!Object.keys(presets).length) {
    setPresetStatus("There are no presets to export yet.");
    return;
  }

  const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ballistics-presets.json";
  link.click();
  URL.revokeObjectURL(url);
  setPresetStatus(`Exported ${Object.keys(presets).length} preset(s).`);
});

presetImportButton.addEventListener("click", () => presetFileInput.click());

presetFileInput.addEventListener("change", async () => {
  const file = presetFileInput.files?.[0];
  if (!file) return;
  // Reset first, so picking the same file twice fires the event again.
  presetFileInput.value = "";

  let incoming;
  try {
    incoming = sanitisePresetCollection(JSON.parse(await file.text()));
  } catch {
    setPresetStatus("That file is not valid JSON.");
    return;
  }

  const names = Object.keys(incoming);
  if (!names.length) {
    setPresetStatus("No usable presets in that file.");
    return;
  }

  const presets = loadPresets();
  const replaced = names.filter((n) => n in presets).length;
  if (!savePresets({ ...presets, ...incoming })) return;

  refreshPresetOptions();
  setPresetStatus(
    `Imported ${names.length} preset(s)` + (replaced ? `, replacing ${replaced} by name.` : ".")
  );
});

/// Applies a preset arriving in the URL fragment, without saving it: a link
/// from someone else should show its load, not quietly add to your list.
function applySharedPreset() {
  const hash = window.location.hash;
  if (!hash.startsWith(PRESET_SHARE_PREFIX)) return;

  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(hash.slice(PRESET_SHARE_PREFIX.length)));
  } catch {
    setPresetStatus("That shared link is not readable.");
    return;
  }

  const preset = sanitisePreset(payload?.preset);
  if (!preset) {
    setPresetStatus("That shared link does not contain a usable load.");
    return;
  }

  applyPreset(preset);
  presetNameInput.value = String(payload.name ?? "Shared load").trim().slice(0, 60);
  setPresetStatus("Loaded a shared load. Press Save to keep it.");
  pendingSharedPreset = true;
  sharedPresetApplied = true;

  // Someone has just been handed a load; on a phone those sections are
  // folded by default, and they should be able to see what they got and
  // reach the Save button without hunting for them.
  for (const key of ["presets", "load"]) {
    const section = document.querySelector(`[data-section="${key}"]`);
    if (section) section.open = true;
  }
}

refreshPresetOptions();
applySharedPreset();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();

  const payload = buildRequestPayload();

  // On this device when the solver module is loaded, on the server when it
  // is not - the answer is the same either way (see solver.js).
  let body;
  try {
    body = await ballisticsSolver.trajectory(payload);
  } catch (err) {
    showError(
      err instanceof ballisticsSolver.SolveError
        ? ballisticsUnits.translateMessage(err.message, units)
        : `Request failed: ${err.message}`
    );
    return;
  }

  // A valid request can still describe a bullet that never reaches the first
  // yard - a muzzle velocity of a few feet per second, or a coefficient near
  // zero. That is a real answer, not a failure, but everything downstream
  // reads a trajectory by range and has nothing to read. Say so, rather than
  // letting the chart and the vitals panel throw on an empty list.
  if (!Array.isArray(body) || body.length === 0) {
    showError(
      `This load does not reach the first yard${imperial() ? "" : " (0.9 m)"}. Check the muzzle velocity ` +
        "and ballistic coefficient - one of them is far outside anything a " +
        "rifle fires."
    );
    return;
  }

  lastPoints = body;
  // Recalculating the shot also solves it from wherever the crosshair has
  // been left, so the button does what it says even mid-drag.
  applyHold();
  bandPoints = await solveWindBand(payload);
  renderResults(body);
  // Read after the wind band, the last thing solved: if the module was set
  // aside partway, the note should say where the answers now come from.
  showEngine(ballisticsSolver.engine);
});

/// Says where the answers came from. It matters in the field: on this
/// device, the page keeps calculating with no signal; on the server, it
/// stops the moment the signal does.
function showEngine(engine) {
  engineNote.hidden = engine == null;
  engineNote.textContent =
    engine === "device"
      ? "Calculated on this device - no signal needed once the page is open."
      : "Calculated by the server - the on-device solver did not load, so this needs a connection.";
}

// A different wind band is a different pair of trajectories, so it needs a
// re-solve rather than a re-render. Picking a force also fills in the speed
// with the middle of that band, so the table and chart stay sensible.
windScaleSelect.addEventListener("change", () => {
  const band = windBand();
  if (band.force) {
    writeCanonical(form.elements.wind_speed, Math.round((band.lo + band.hi) / 2));
  }
  if (lastPoints) form.requestSubmit();
});

// The range band needs no new trajectories - the client already holds every
// yard of them - so this is a re-render only.
rangeUncertaintyInput.addEventListener("input", () => {
  if (lastPoints) renderAnimalPanel(lastPoints);
});

// Direction does need them, the same as a speed band: a different angle is a
// different wind vector and therefore a different flight.
windAngleUncertaintyInput.addEventListener("input", () => {
  if (lastPoints) form.requestSubmit();
});

// The shot range and species controls don't need a new API call: the
// client already has the full per-yard trajectory from the last submit,
// so re-rendering the vitals overlay against a different range or species
// is just a local lookup.
shotRangeInput.addEventListener("input", () => {
  if (lastPoints) {
    renderAnimalPanel(lastPoints);
  }
});
speciesSelect.addEventListener("change", () => {
  syncScaleControls();
  // A hold measured against one animal's vitals means nothing against
  // another's, so it does not carry over. Range changes deliberately *do*
  // keep it: holding one aim point across a band of ranges and watching
  // where it lands is the whole point of the mode.
  resetHold();
  if (lastPoints) {
    renderAnimalPanel(lastPoints);
  }
});

// Scale overrides exist because the reference dimensions are gathered from
// general wildlife sources and the artwork is stylised, so neither is
// authoritative for a particular animal. Changes persist per species.
function onScaleChanged() {
  const profile = currentProfile();
  if (!profile) return;

  updateOverride(profile, {
    basis: scaleBasisSelect.value,
    value: Number(scaleValueInput.value),
    unit: scaleUnitSelect.value,
  });

  if (lastPoints) renderAnimalPanel(lastPoints);
}

scaleValueInput.addEventListener("input", onScaleChanged);
scaleUnitSelect.addEventListener("change", () => {
  // Convert the displayed number into the newly selected unit rather than
  // reinterpreting it, so switching units does not silently resize.
  const profile = currentProfile();
  if (profile) {
    const previous = loadOverride(profile)?.unit ?? "in";
    const inches = Number(scaleValueInput.value) * (UNIT_TO_INCHES[previous] ?? 1);
    const converted = inches / (UNIT_TO_INCHES[scaleUnitSelect.value] ?? 1);
    scaleValueInput.value = converted >= 10 ? round1(converted) : Math.round(converted * 100) / 100;
  }
  onScaleChanged();
});

scaleBasisSelect.addEventListener("change", () => {
  const profile = currentProfile();
  if (profile) {
    // Show the reference figure for the newly chosen basis.
    showReferenceScale(profile, scaleBasisSelect.value);
  }
  onScaleChanged();
});

scaleResetButton.addEventListener("click", () => {
  const profile = currentProfile();
  if (!profile) return;
  saveOverride(profile, null);
  syncScaleControls();
  if (lastPoints) renderAnimalPanel(lastPoints);
});

function onVitalsSizeChanged() {
  const profile = currentProfile();
  if (!profile) return;

  const width = readCanonical(vitalsWidthInput);
  const height = readCanonical(vitalsHeightInput);
  if (!(width > 0) || !(height > 0)) return;

  updateOverride(profile, { vitals: { width_in: width, height_in: height } });
  if (lastPoints) renderAnimalPanel(lastPoints);
}

vitalsWidthInput.addEventListener("input", onVitalsSizeChanged);
vitalsHeightInput.addEventListener("input", onVitalsSizeChanged);

minEnergyInput.addEventListener("input", () => {
  const profile = currentProfile();
  if (!profile) return;
  const typed = minEnergyInput.value.trim();
  // Blank is a real choice: it means energy is not the limiting factor.
  updateOverride(profile, { minEnergy: typed === "" ? null : readCanonical(minEnergyInput) });
  if (lastPoints) renderAnimalPanel(lastPoints);
});

expansionVelocityInput.addEventListener("input", () => {
  if (lastPoints) renderAnimalPanel(lastPoints);
});

// Start each hold session from the vitals centre, so the crosshair is
// somewhere predictable and switching modes is also how you undo a hold you
// have dragged into a corner.
function onCompensationModeChanged() {
  resetHold();
  solveHoldButton.hidden = !crosshairIsMovable();
  if (lastPoints) renderAnimalPanel(lastPoints);
}

aimModeSelect.addEventListener("change", onCompensationModeChanged);
windModeSelect.addEventListener("change", onCompensationModeChanged);

// Finding the hold by dragging is fine for exploring, but the exact answer
// is something the trajectory already knows. Placing the crosshair on it
// also demonstrates the relationship the drag makes confusing: the hold
// goes up and left, and the impact lands on the vitals.
solveHoldButton.addEventListener("click", () => {
  if (!lastPoints) return;
  const point = pointAt(lastPoints, readCanonical(shotRangeInput));
  const axes = heldAxes();
  // Only the axes actually being held move. A dialled axis is already
  // corrected at the turret, so putting a hold on it too would double the
  // correction.
  holdOffsetIn = {
    x: axes.x ? -point.windage_in : 0,
    y: axes.y ? -point.path_inches : 0,
  };
  applyHold();
  renderAnimalPanel(lastPoints);
});

/// A group wider than a couple of MOA is worth querying rather than
/// accepting silently: at that point the drawing would show a dispersion
/// circle swallowing the whole animal, and the likeliest explanation is a
/// typo or MOA/inches confusion, not a rifle that actually shoots that
/// badly. The figure is held back until the user says they meant it.
function onGroupMoaChanged() {
  const typed = typedGroupMoa();

  if (typed > IMPLAUSIBLE_GROUP_MOA) {
    // What that group covers at 300 of whatever the page is showing.
    const reference = ballisticsUnits.toCanonical("distance", 300, units);
    groupWarning.hidden = false;
    groupWarning.innerHTML = `
      ${angleText(typed)} ${unitOf("angle")} is poor precision for a modern hunting
      rifle &mdash; about ${lengthText(ballisticsUnits.moaToInches(typed, reference))} ${unitOf("length")} at 300 ${unitOf("distance")}.
      <button type="button" class="link-button" id="group-confirm">Use ${angleText(typed)} ${unitOf("angle")} anyway</button>`;
    groupWarning.querySelector("#group-confirm").addEventListener("click", () => {
      confirmedGroupMoa = typed;
      showGroupConfirmed();
      if (lastPoints) renderAnimalPanel(lastPoints);
    });
    return;
  }

  groupWarning.hidden = true;
  groupWarning.textContent = "";
  confirmedGroupMoa = typed;
  if (lastPoints) renderAnimalPanel(lastPoints);
}

groupMoaInput.addEventListener("input", onGroupMoaChanged);

function showGroupConfirmed() {
  groupWarning.textContent = `Using ${angleText(confirmedGroupMoa)} ${unitOf("angle")}.`;
}

/// Re-words the warning, or the confirmation, in the current units without
/// forgetting a confirmation already given.
function refreshGroupWarning() {
  const typed = typedGroupMoa();
  if (typed <= IMPLAUSIBLE_GROUP_MOA) return;
  if (confirmedGroupMoa === typed) showGroupConfirmed();
  else onGroupMoaChanged();
}

// Dragging the vital zone is calibration against the drawing, not a
// preference: the anchor is positioned by eye per species, and only the
// person looking at the illustration can say where it actually belongs.
function canvasPoint(event) {
  const rect = vitalsCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * vitalsCanvas.width,
    y: ((event.clientY - rect.top) / rect.height) * vitalsCanvas.height,
  };
}

function withinVitals(point) {
  if (!lastTransform?.aimPx) return false;
  const [ax, ay] = lastTransform.aimPx;
  const grab = 12;
  return (
    Math.abs(point.x - ax) <= lastTransform.halfW + grab &&
    Math.abs(point.y - ay) <= lastTransform.halfH + grab
  );
}

function withinCrosshair(point) {
  // The crosshair is only movable where at least one axis is held off for.
  // With nothing held it is pinned to the vitals centre by definition, and
  // dragging it would also fight the vital-zone drag underneath it.
  if (!crosshairIsMovable() || !lastTransform?.crosshairPx) return false;
  const [cx, cy] = lastTransform.crosshairPx;
  return Math.hypot(point.x - cx, point.y - cy) <= 14;
}

/// Which handle the pointer has hold of, or null. The crosshair wins ties
/// because it sits on top and is the smaller target.
function grabTarget(point) {
  if (withinCrosshair(point)) return "hold";
  if (withinVitals(point)) return "vitals";
  return null;
}

let dragging = null;

function moveAnchorTo(point) {
  const profile = currentProfile();
  if (!profile || !lastTransform) return;

  const { offsetX, offsetY, fit, artW, artH, mirrored } = lastTransform;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  // Stored as for the drawing facing right, however it is shown now.
  const across = clamp((point.x - offsetX) / fit / artW);
  updateOverride(profile, {
    anchor: {
      x: mirrored ? 1 - across : across,
      y: clamp((point.y - offsetY) / fit / artH),
    },
  });
  if (lastPoints) renderAnimalPanel(lastPoints);
}

/// Moves the hold crosshair, in inches relative to the vitals centre.
/// Canvas y grows downward while a positive bullet path is above the line
/// of sight, so holding high is a *negative* canvas offset.
///
/// Constrained to the axes actually being held: with elevation dialled and
/// only wind held, the crosshair slides along the horizontal and cannot be
/// nudged off it, which is both the honest geometry and a steadier drag.
function moveHoldTo(point) {
  if (!lastTransform) return;
  const { offsetX, offsetY, fit, centreX, centreY, inPerPx, leadIn = 0 } = lastTransform;
  const axes = heldAxes();
  // The crosshair sits ahead of a moving animal by the lead; what is
  // dragged is the hold on top of it.
  holdOffsetIn = {
    x: axes.x ? ((point.x - offsetX) / fit - centreX) * inPerPx - leadIn : 0,
    y: axes.y ? -((point.y - offsetY) / fit - centreY) * inPerPx : 0,
  };
  if (lastPoints) renderAnimalPanel(lastPoints);
}

vitalsCanvas.addEventListener("pointerdown", (event) => {
  const target = grabTarget(canvasPoint(event));
  if (!target) return;
  dragging = target;
  vitalsCanvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});

vitalsCanvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  if (!dragging) {
    vitalsCanvas.style.cursor = grabTarget(point) ? "grab" : "default";
    return;
  }
  vitalsCanvas.style.cursor = "grabbing";
  if (dragging === "hold") {
    moveHoldTo(point);
  } else {
    moveAnchorTo(point);
  }
});

function endDrag(event) {
  if (!dragging) return;
  const wasHold = dragging === "hold";
  dragging = null;
  vitalsCanvas.style.cursor = "grab";
  if (vitalsCanvas.hasPointerCapture?.(event.pointerId)) {
    vitalsCanvas.releasePointerCapture(event.pointerId);
  }
  // Letting go of the crosshair is what re-solves the shot from where it
  // now points.
  if (wasHold) {
    applyHold();
    if (lastPoints) renderAnimalPanel(lastPoints);
  }
}

vitalsCanvas.addEventListener("pointerup", endDrag);
vitalsCanvas.addEventListener("pointercancel", endDrag);

/// The request the solver takes, always in its own units whatever the
/// page is showing.
function buildRequestPayload() {
  const fields = form.elements;
  const num = (name) => Number(fields[name].value);
  const measured = (name) => readCanonical(fields[name]);

  return {
    load: {
      drag_function: fields.drag_function.value,
      ballistic_coefficient: num("ballistic_coefficient"),
      muzzle_velocity: measured("muzzle_velocity"),
      bullet_weight_gr: num("bullet_weight_gr"),
    },
    rifle: {
      sight_height: measured("sight_height"),
      zero_range: measured("zero_range"),
      zero_y_intercept: 0,
    },
    atmosphere: {
      altitude: measured("altitude"),
      pressure: measured("pressure"),
      temperature: measured("temperature"),
      relative_humidity: num("relative_humidity"),
    },
    shot: {
      shooting_angle: num("shooting_angle"),
      wind_speed: measured("wind_speed"),
      wind_angle: num("wind_angle"),
    },
  };
}

function renderResults(points) {
  resultsSection.hidden = false;
  renderTable(points);
  renderChart(points);
  renderAnimalPanel(points);
}

// Row spacing matters more than it looks: a 25 yard step is fine for elk
// at 400 yards, but useless for a pigeon inside 60, where the whole
// usable range fits between two rows.
function renderTable(points) {
  tableBody.innerHTML = "";

  // Step and limit are in whatever the page shows: every 25 yd, or every
  // 25 m. Metric rows fall between solved yards, so they are interpolated.
  const step = Math.max(1, Math.round(Number(tableStepInput.value) || 25));
  const maxRange = Math.max(step, Number(tableMaxInput.value) || 500);
  const rows = imperial()
    ? points.filter((p) => p.yards % step === 0 && p.yards <= maxRange)
    : metricRows(points, step, maxRange);

  const chosen = new Set(visibleColumnKeys());
  const columns = COLUMNS.filter((c) => chosen.has(c.key));

  document.querySelector("#results-table thead tr").innerHTML = columns
    .map((c) => `<th>${c.label()}</th>`)
    .join("");

  for (const point of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = columns.map((c) => `<td>${c.format(point)}</td>`).join("");
    tableBody.appendChild(tr);
  }
}

/// Rows every `step` metres up to `max`, over the distance actually solved.
function metricRows(points, step, max) {
  const first = points[0].yards;
  const last = points[points.length - 1].yards;
  const rows = [];
  for (let metres = 0; metres <= max; metres += step) {
    const yards = ballisticsUnits.toCanonical("distance", metres, units);
    if (yards > last + 1e-9) break;
    if (yards < first - 1e-9) continue;
    rows.push(pointAt(points, yards));
  }
  return rows;
}

// Re-rendering the table is a local filter over data we already have.
for (const input of [tableStepInput, tableMaxInput]) {
  input.addEventListener("input", () => {
    if (lastPoints) renderTable(lastPoints);
  });
}

function renderChart(points) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 20, right: 20, bottom: 36, left: 64 };

  const style = getComputedStyle(document.documentElement);
  const gridColor = style.getPropertyValue("--grid").trim();
  const textColor = style.getPropertyValue("--muted").trim();
  const pathColor = style.getPropertyValue("--path-line").trim();
  const zeroColor = style.getPropertyValue("--zero-line").trim();

  ctx.clearRect(0, 0, width, height);

  const xs = points.map((p) => p.yards);
  const ys = points.map((p) => p.path_inches);
  const xMin = 0;
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const yPad = (yMax - yMin) * 0.08 || 1;

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const toX = (yards) => padding.left + ((yards - xMin) / (xMax - xMin || 1)) * plotWidth;
  const toY = (inches) =>
    padding.top +
    plotHeight -
    ((inches - (yMin - yPad)) / (yMax + yPad - (yMin - yPad) || 1)) * plotHeight;

  // Gridlines + axis labels.
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = textColor;
  ctx.font = "12px sans-serif";
  ctx.lineWidth = 1;

  // Six even divisions of the range solved - which in yards falls on round
  // numbers, and in metres would not (91, 183, 274...), so metric picks a
  // round step instead.
  const xTickYards = [];
  if (imperial()) {
    const xTicks = 6;
    for (let i = 0; i <= xTicks; i++) xTickYards.push(xMin + ((xMax - xMin) * i) / xTicks);
  } else {
    const maxMetres = shown("distance", xMax);
    const step = roundStep(maxMetres / 6);
    for (let metres = 0; metres <= maxMetres + 1e-9; metres += step) {
      xTickYards.push(ballisticsUnits.toCanonical("distance", metres, units));
    }
  }
  for (const yards of xTickYards) {
    const x = toX(yards);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.fillText(distanceText(yards, { rounded: true }), x - 10, height - padding.bottom + 16);
  }

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const inches = yMin - yPad + ((yMax + yPad - (yMin - yPad)) * i) / yTicks;
    const y = toY(inches);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(shown("length", inches).toFixed(0), 26, y + 4);
  }

  // Zero line (line of sight).
  ctx.strokeStyle = zeroColor;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding.left, toY(0));
  ctx.lineTo(width - padding.right, toY(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Bullet path.
  ctx.strokeStyle = pathColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, i) => {
    const x = toX(point.yards);
    const y = toY(point.path_inches);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // Axis titles.
  ctx.fillStyle = textColor;
  ctx.fillText(imperial() ? "Range (yards)" : "Range (metres)", width / 2 - 40, height - 6);
  ctx.save();
  ctx.translate(14, height / 2 + 30);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(imperial() ? "Bullet path (inches)" : "Bullet path (cm)", 0, 0);
  ctx.restore();
}

/// 1, 2 or 5 times a power of ten, at least `raw`.
function roundStep(raw) {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= raw);
}

/// The trajectory at a range that need not be a solved point - see
/// `pointAt` in solver.js, shared with the catalogue ranking.
function pointAt(points, yards) {
  return ballisticsSolver.pointAt(points, yards);
}

async function renderAnimalPanel(points) {
  const profile = currentProfile();
  if (!profile) {
    animalInfo.innerHTML = "";
    vitalsCanvas.getContext("2d").clearRect(0, 0, vitalsCanvas.width, vitalsCanvas.height);
    return;
  }

  const requestedRange = readCanonical(shotRangeInput);
  const point = pointAt(points, requestedRange);

  // A species with no prepared artwork still gets the overlay and the
  // info panel, just without a silhouette behind them.
  const image = profile.image ? await loadImage(profile.image) : null;

  const assessment = renderVitalsOverlay(profile, point, image);
  renderAnimalInfo(profile, assessment, point);
}

function renderVitalsOverlay(profile, point, image) {
  const ctx = vitalsCanvas.getContext("2d");
  const width = vitalsCanvas.width;
  const height = vitalsCanvas.height;
  ctx.clearRect(0, 0, width, height);

  const vitals = effectiveVitals(profile);
  const anchor = effectiveAnchor(profile);
  const inPerPx = inchesPerPixel(profile);
  const { aim, impact } = shotGeometry(point);
  const movement = motion();
  const groupRadiusIn = groupDiameterInches(point.yards) / 2;
  const region = uncertaintyRegion(point);
  const windEnds = windBandEnds(point);

  const artW = profile.image_width_px ?? 400;
  const artH = profile.image_height_px ?? 300;
  // Every drawing faces right (see animals/README.md), so an animal running
  // right to left is mirrored to face the way it is going - and its vital
  // zone with it. Only the silhouette flips: left and right on the drawing
  // stay the shooter's, for the wind, the hold and the lead alike.
  const mirrored = movement != null && movement.sign < 0;
  const centreX = (mirrored ? 1 - anchor.x : anchor.x) * artW;
  const centreY = anchor.y * artH;

  // Artwork pixels per inch, so real dimensions can be laid out against
  // the drawing. Canvas y grows downward while a positive bullet path is
  // above the line of sight, hence the negation on every y offset.
  const toArtX = (inches) => centreX + inches / inPerPx;
  const toArtY = (inches) => centreY - inches / inPerPx;

  const aimX = toArtX(aim.x);
  const aimY = toArtY(aim.y);
  const impactX = toArtX(impact.x);
  const impactY = toArtY(impact.y);
  const groupRadiusArt = groupRadiusIn / inPerPx;
  const regionArt = region.map((p) => [toArtX(p.x), toArtY(p.y)]);

  // Fit the artwork, the impact, the whole group circle and the whole
  // uncertainty region, so nothing that matters gets clipped at long range.
  const pad = 26;
  const regionXs = regionArt.map(([x]) => x);
  const regionYs = regionArt.map(([, y]) => y);
  const minX = Math.min(0, impactX - groupRadiusArt, aimX, ...regionXs.map((x) => x - groupRadiusArt));
  const maxX = Math.max(artW, impactX + groupRadiusArt, aimX, ...regionXs.map((x) => x + groupRadiusArt));
  const minY = Math.min(0, impactY - groupRadiusArt, aimY, ...regionYs.map((y) => y - groupRadiusArt));
  const maxY = Math.max(artH, impactY + groupRadiusArt, aimY, ...regionYs.map((y) => y + groupRadiusArt));
  const fit = Math.min(
    (width - pad * 2) / (maxX - minX),
    (height - pad * 2) / (maxY - minY)
  );
  const offsetX = pad + (width - pad * 2 - (maxX - minX) * fit) / 2 - minX * fit;
  const offsetY = pad + (height - pad * 2 - (maxY - minY) * fit) / 2 - minY * fit;
  const toPx = (x, y) => [offsetX + x * fit, offsetY + y * fit];

  lastTransform = {
    offsetX,
    offsetY,
    fit,
    artW,
    artH,
    inPerPx,
    centreX,
    centreY,
    halfW: (vitals.width_in / 2 / inPerPx) * fit,
    halfH: (vitals.height_in / 2 / inPerPx) * fit,
    aimPx: toPx(centreX, centreY),
    crosshairPx: toPx(aimX, aimY),
    leadIn: movement ? heldLead(point, movement) : 0,
    mirrored,
  };

  const style = getComputedStyle(document.documentElement);
  const inkColor = style.getPropertyValue("--silhouette").trim() || "#9aa0aa";
  const textColor = style.getPropertyValue("--muted").trim();

  if (image) {
    drawTinted(ctx, image, toPx(0, 0), artW * fit, artH * fit, inkColor, mirrored);
  }

  // Vital zone.
  const [vitalsPxX, vitalsPxY] = toPx(centreX, centreY);
  ctx.beginPath();
  ctx.ellipse(
    vitalsPxX,
    vitalsPxY,
    (vitals.width_in / 2 / inPerPx) * fit,
    (vitals.height_in / 2 / inPerPx) * fit,
    0,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = "#16a34a33";
  ctx.fill();
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 2;
  ctx.stroke();

  const assessment = assessRegion(vitals, region, groupRadiusIn);
  const [impactPxX, impactPxY] = toPx(impactX, impactY);
  const [crossPxX, crossPxY] = toPx(aimX, aimY);

  // Everything the shot could do: the region swept by the range and wind
  // bands, widened by the group.
  //
  // The widening is done by stroking the region's own outline with a pen as
  // wide as the group and round joins, which is exactly a Minkowski sum with
  // the group disc - the true footprint, not an approximation of it. With no
  // bands the region collapses to a single point and this draws the plain
  // group circle it did before.
  const groupPx = groupRadiusArt * fit * 2;
  if (regionArt.length > 1 || groupPx > 0) {
    ctx.beginPath();
    if (regionArt.length > 1) {
      regionArt.forEach(([x, y], i) => {
        const [px, py] = toPx(x, y);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
    } else {
      ctx.arc(impactPxX, impactPxY, Math.max(groupPx / 2, 0.5), 0, Math.PI * 2);
    }

    const shade = REGION_SHADES[assessment.verdict];

    // Shaded from the least wind to the most, along the line between the two
    // wind extremes. That way one picture carries both things: how far the
    // wind pushes the shot at all, and how much of that you are unsure of.
    // The outline keeps the verdict, so safe-or-not is still readable
    // without decoding the fill.
    let fill = shade.fill;
    if (windEnds) {
      const [x0, y0] = toPx(toArtX(windEnds.lo.x), toArtY(windEnds.lo.y));
      const [x1, y1] = toPx(toArtX(windEnds.hi.x), toArtY(windEnds.hi.y));
      if (Math.hypot(x1 - x0, y1 - y0) > 1) {
        const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
        gradient.addColorStop(0, WIND_GRADIENT.calm);
        gradient.addColorStop(1, WIND_GRADIENT.strong);
        fill = gradient;
      }
    }

    if (regionArt.length > 1 && groupPx > 0) {
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = groupPx;
      ctx.strokeStyle = fill;
      ctx.stroke();
    }
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = shade.line;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    // Label which end is which, so the gradient is a scale rather than
    // decoration.
    if (windEnds && bandPoints?.lowest) {
      ctx.font = "10px sans-serif";
      for (const [end, wind, align] of [
        [windEnds.lo, bandPoints.lowest, "right"],
        [windEnds.hi, bandPoints.highest, "left"],
      ]) {
        const [ex, ey] = toPx(toArtX(end.x), toArtY(end.y));
        ctx.fillStyle = textColor;
        ctx.textAlign = align;
        const speed = imperial()
          ? String(Math.round(wind.wind_speed))
          : ballisticsUnits.trimmed(shown("windSpeed", wind.wind_speed), 1);
        ctx.fillText(`${speed} ${unitOf("windSpeed")}`, ex + (align === "right" ? -6 : 6), ey - 8);
      }
      ctx.textAlign = "left";
    }
  }

  // Crosshair, at the hold point rather than the vitals centre. Stroked
  // twice: the silhouette is a mid-grey, so a single grey cross over the
  // animal's back is close to invisible - exactly where a hold-over mark
  // usually sits.
  const crosshair = () => {
    ctx.beginPath();
    ctx.moveTo(crossPxX - 9, crossPxY);
    ctx.lineTo(crossPxX + 9, crossPxY);
    ctx.moveTo(crossPxX, crossPxY - 9);
    ctx.lineTo(crossPxX, crossPxY + 9);
    ctx.stroke();
  };
  ctx.strokeStyle = style.getPropertyValue("--surface").trim() || "#ffffff";
  ctx.lineWidth = 4;
  crosshair();
  ctx.strokeStyle = style.getPropertyValue("--text").trim() || "#1a1a1a";
  ctx.lineWidth = 1.5;
  crosshair();

  // A ring marking what is grabbable, only where the crosshair can be
  // moved. It goes dashed while the crosshair has been moved but the shot
  // has not been re-solved from it yet, so a frozen impact reads as
  // "not applied" rather than as a stuck marker.
  if (crosshairIsMovable()) {
    const accent = style.getPropertyValue("--accent").trim() || "#b3441e";
    ctx.beginPath();
    ctx.arc(crossPxX, crossPxY, 14, 0, Math.PI * 2);
    ctx.strokeStyle = holdIsPending() ? accent : `${accent}66`;
    ctx.lineWidth = holdIsPending() ? 1.5 : 1;
    if (holdIsPending()) ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // The error being nulled: from where the shot should go to where it
  // actually goes. Drawn from the *vitals centre* rather than from the
  // crosshair, because that is the gap the user is trying to close - a
  // line from the crosshair would be the drop, which never changes at a
  // fixed range no matter where you hold, so nothing on the drawing would
  // shrink as the hold converged. In dead-on and dialled modes the
  // crosshair sits on the vitals centre, so this is the same line as before.
  if (Math.hypot(impactPxX - vitalsPxX, impactPxY - vitalsPxY) > 14) {
    ctx.beginPath();
    ctx.moveTo(vitalsPxX, vitalsPxY);
    ctx.lineTo(impactPxX, impactPxY);
    ctx.strokeStyle = assessment.verdict === "hit" ? "#16a34a88" : "#dc262688";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.arc(impactPxX, impactPxY, 5, 0, Math.PI * 2);
  ctx.fillStyle = VERDICT_COLOURS[assessment.verdict];
  ctx.fill();
  ctx.strokeStyle = "#ffffffaa";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Both markers move together when the hold is dragged - the bullet falls
  // from wherever the rifle is pointed - so without labels the pair reads
  // as one stuck object rather than as an aim point and its consequence.
  if (crosshairIsMovable()) {
    ctx.font = "11px sans-serif";
    ctx.fillStyle = holdIsPending()
      ? style.getPropertyValue("--accent").trim() || "#b3441e"
      : textColor;
    ctx.fillText(holdIsPending() ? "release to solve" : "hold", crossPxX + 18, crossPxY + 4);
    ctx.fillStyle = VERDICT_COLOURS[assessment.verdict];
    ctx.fillText("impact", impactPxX + 9, impactPxY + 16);
  }

  if (movement) {
    drawMotion(ctx, movement, {
      vitals: [vitalsPxX, vitalsPxY],
      crosshair: [crossPxX, crossPxY],
      halfH: (vitals.height_in / 2 / inPerPx) * fit,
      lead: heldLead(point, movement),
      color: style.getPropertyValue("--accent").trim() || "#b3441e",
    });
  }

  drawScaleBar(ctx, width, height, fit / inPerPx, textColor);

  return assessment;
}

const VERDICT_COLOURS = {
  hit: "#16a34a",
  marginal: "#f59e0b",
  miss: "#dc2626",
};

/// The uncertainty footprint is shaded by verdict rather than by a fixed
/// colour: the question it answers is whether the shot is safe, so the
/// answer should be readable without reading the panel.
/// The gradient the uncertainty footprint is shaded with: cool where the
/// wind is lightest, hot where it is strongest. It reads as a scale, so the
/// picture shows the offset the wind causes and how much of that offset is
/// guesswork, in one shape.
const WIND_GRADIENT = {
  calm: "#38bdf83d",
  strong: "#ef44443d",
};

const REGION_SHADES = {
  hit: { fill: "#16a34a2e", line: "#16a34a" },
  marginal: { fill: "#f59e0b2e", line: "#f59e0b" },
  miss: { fill: "#dc26262e", line: "#dc2626" },
};

/// Assesses the shot as a group rather than a point.
///
/// A perfect rifle either hits the vitals or does not. A real one throws a
/// group, so what matters is whether the *whole* group stays inside: a
/// centre hit with half the group hanging outside is a wounding risk, not
/// a clean shot. The group is sampled around its rim because the vitals
/// are an ellipse, where "how far to the edge" depends on direction.
function assessShot(vitals, impact, groupRadiusIn) {
  return assessRegion(vitals, [impact], groupRadiusIn);
}

/// The same judgement over a whole region of possible impacts.
///
/// A verdict of "hit" means every combination of range and wind inside the
/// bands, with the group around each of them, still lands in the vitals.
/// That is a demanding test, and it is meant to be: the point of admitting
/// what you do not know is that it sometimes says do not shoot.
function assessRegion(vitals, region, groupRadiusIn) {
  const halfWidth = vitals.width_in / 2;
  const halfHeight = vitals.height_in / 2;
  const inside = (x, y) => (x / halfWidth) ** 2 + (y / halfHeight) ** 2 <= 1;

  let allInside = true;
  let anyInside = false;
  const samples = 24;

  for (const impact of region) {
    if (groupRadiusIn <= 0) {
      const ok = inside(impact.x, impact.y);
      allInside = allInside && ok;
      anyInside = anyInside || ok;
      continue;
    }
    // The group is sampled around its rim because the vitals are an
    // ellipse, where "how far to the edge" depends on direction.
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2;
      const ok = inside(
        impact.x + Math.cos(angle) * groupRadiusIn,
        impact.y + Math.sin(angle) * groupRadiusIn
      );
      allInside = allInside && ok;
      anyInside = anyInside || ok;
    }
  }

  const centre = {
    x: region.reduce((s, p) => s + p.x, 0) / region.length,
    y: region.reduce((s, p) => s + p.y, 0) / region.length,
  };
  const centreInside = inside(centre.x, centre.y);

  const verdict = allInside ? "hit" : centreInside || anyInside ? "marginal" : "miss";
  return { verdict, centreInside, groupFullyInside: allInside };
}

/// Draws the silhouette recoloured to `color`. The prepared artwork is a
/// pure alpha mask, so it has to be tinted rather than drawn directly -
/// the source is black, which would be invisible in dark mode.
function drawTinted(ctx, image, [x, y], w, h, color, mirrored = false) {
  const buffer = document.createElement("canvas");
  buffer.width = Math.max(1, Math.round(w));
  buffer.height = Math.max(1, Math.round(h));
  const bctx = buffer.getContext("2d");
  if (mirrored) {
    bctx.translate(buffer.width, 0);
    bctx.scale(-1, 1);
  }
  bctx.drawImage(image, 0, 0, buffer.width, buffer.height);
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.globalCompositeOperation = "source-in";
  bctx.fillStyle = color;
  bctx.fillRect(0, 0, buffer.width, buffer.height);
  ctx.drawImage(buffer, x, y);
}

/// Which way the animal is going, and how far ahead the crosshair is: an
/// arrow over the vitals, and the lead written by the crosshair.
function drawMotion(ctx, m, { vitals: [vx, vy], crosshair: [cx, cy], halfH, lead, color }) {
  const y = vy - halfH - 14;
  const length = 34;
  const x0 = vx - (m.sign * length) / 2;
  const x1 = vx + (m.sign * length) / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x1 - m.sign * 8, y - 5);
  ctx.lineTo(x1 - m.sign * 8, y + 5);
  ctx.closePath();
  ctx.fill();

  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`lead ${lengthText(Math.abs(lead))} ${unitOf("length")}`, cx, cy - 18);
  ctx.restore();
}

function drawScaleBar(ctx, width, height, pxPerInch, textColor) {
  const [barInches, label] = imperial() ? [12, "1 ft"] : [30 / 2.54, "30 cm"];
  const barPx = pxPerInch * barInches;
  if (!Number.isFinite(barPx) || barPx < 8 || barPx > width - 40) return;

  const x = 16;
  const y = height - 16;
  ctx.strokeStyle = textColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + barPx, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + barPx, y - 4);
  ctx.lineTo(x + barPx, y + 4);
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.font = "11px sans-serif";
  ctx.fillText(label, x + barPx + 6, y + 4);
}

// ---------------------------------------------------------------------------
// What you do not know.
//
// A shot in the field is not taken against known numbers. The range is a
// judgement, the wind is a guess, and the rifle throws a group. Those three
// are different in kind, and that is the useful part:
//
//   * range error is almost purely vertical - drop changes steeply with it
//   * wind error is almost purely horizontal
//   * group is circular
//
// So the impact is not a point but a region, and the *shape* of that region
// says which unknown is the problem. Tall means range it properly. Wide
// means wait for the wind or get closer. Round means it is the rifle, or
// you. A point estimate hides all of that behind a single confident dot.
// ---------------------------------------------------------------------------

/// The Beaufort scale, land observations.
///
/// Written in 1805 for observers with no instruments, which is exactly the
/// problem here: nobody reads wind speed off the air to the mile per hour,
/// but anyone can see whether twigs are moving or small trees are swaying.
/// Every force is already a band rather than a number, so it doubles as the
/// uncertainty itself.
const BEAUFORT = [
  { force: "0-1", lo: 0, hi: 3, seen: "Calm - smoke rises near vertical" },
  { force: "2", lo: 4, hi: 7, seen: "Felt on the face, leaves rustle" },
  { force: "3", lo: 8, hi: 12, seen: "Leaves and twigs always moving, a flag extends" },
  { force: "4", lo: 13, hi: 18, seen: "Dust and loose paper lifting, small branches move" },
  { force: "5", lo: 19, hi: 24, seen: "Small trees in leaf begin to sway" },
  { force: "6", lo: 25, hi: 31, seen: "Large branches moving, hard to hold steady" },
];

/// Trajectories solved at the edges of the wind band, or null when the wind
/// is treated as exact.
let bandPoints = null;

function buildWindScaleOptions() {
  // Keyed by the force itself rather than by position in the array, so the
  // value means something on its own - and survives a rebuild in other units.
  const selected = windScaleSelect.value;
  windScaleSelect.innerHTML =
    `<option value="">Measured &mdash; use the exact figure</option>` +
    BEAUFORT.map(
      (b) =>
        `<option value="${b.force}">Force ${b.force} (${bandSpeedText(b.lo)}-${bandSpeedText(b.hi)} ${unitOf("windSpeed")}) &mdash; ${escapeHtml(b.seen)}</option>`
    ).join("");
  windScaleSelect.value = selected;
}

/// The range of wind speeds the shot might actually be taken in.
function windBand() {
  const chosen = BEAUFORT.find((b) => b.force === windScaleSelect.value);
  if (!chosen) {
    const exact = readCanonical(form.elements.wind_speed) || 0;
    return { lo: exact, hi: exact, force: null };
  }
  return { lo: chosen.lo, hi: chosen.hi, force: chosen };
}

/// The range of distances the animal might actually be at.
function rangeBand(yards) {
  const slop = Math.max(0, readCanonical(rangeUncertaintyInput) || 0);
  return { lo: Math.max(1, yards - slop), hi: yards + slop, slop };
}

/// How far out the wind's direction could be, in degrees either side.
function windAngleBand() {
  const nominal = Number(form.elements.wind_angle.value) || 0;
  const slop = Math.max(0, Number(windAngleUncertaintyInput.value) || 0);
  return { nominal, lo: nominal - slop, hi: nominal + slop, slop };
}

/// The two wind vectors that bound the drift: least crosswind and most.
///
/// Not simply the corners of the speed and angle bands. Crosswind is
/// `speed * sin(angle)`, and sine is not monotonic - if the band straddles
/// 90 degrees then the *middle* of it is the worst case, not either end. A
/// full-value wind called to +/-30 degrees runs from 0.87 to 1.0 of its
/// speed, with the maximum in the interior. So the angle interval is swept
/// and the extremes taken from the sweep.
///
/// Angle is carried alongside speed rather than folded into an equivalent
/// crosswind, because the headwind component changes with it too and that
/// feeds the drag.
function windExtremes() {
  const speed = windBand();
  const angle = windAngleBand();

  let lowest = null;
  let highest = null;
  for (const s of [speed.lo, speed.hi]) {
    for (let step = 0; step <= 24; step++) {
      const a = angle.lo + ((angle.hi - angle.lo) * step) / 24;
      const cross = s * Math.sin((a * Math.PI) / 180);
      const candidate = { wind_speed: s, wind_angle: a, cross };
      if (!lowest || cross < lowest.cross) lowest = candidate;
      if (!highest || cross > highest.cross) highest = candidate;
      if (angle.hi === angle.lo) break;
    }
  }
  return { lowest, highest, spread: highest.cross - lowest.cross };
}

/// Solves the two extra trajectories the uncertainty band needs, at the
/// wind vectors that produce the least and the most drift.
async function solveWindBand(payload) {
  const { lowest, highest } = windExtremes();
  if (Math.abs(highest.cross - lowest.cross) < 1e-9) return null;

  const at = async (wind) => {
    try {
      return await ballisticsSolver.trajectory({
        ...payload,
        shot: {
          ...payload.shot,
          wind_speed: wind.wind_speed,
          wind_angle: wind.wind_angle,
        },
      });
    } catch {
      return null;
    }
  };

  const [lo, hi] = await Promise.all([at(lowest), at(highest)]);
  // `lo && hi` alone is not enough: an empty array is truthy, and a band
  // end that never reaches a yard would pass here and throw later, when the
  // spread is read by range. No band is the honest fallback - the shot is
  // still drawn, just without its wind spread.
  const reaches = (points) => Array.isArray(points) && points.length > 0;
  return reaches(lo) && reaches(hi) ? { lo, hi, lowest, highest } : null;
}

/// Where the bullet lands for one (range, wind) pair, in inches from the
/// vitals centre.
///
/// Each axis has its own reference, set by its own mode. A turret is dialled
/// for the range and the wind you *believe*, so being wrong about either
/// leaves the difference between believed and actual - which is why this
/// takes the nominal point's figure off rather than zeroing the axis
/// outright. A hold is a fixed offset and does not track the range at all.
///
/// A moving animal adds the lead: the crosshair is held ahead by the lead
/// for the nominal range and speed, and the animal actually moves by the
/// lead for this range and `speed`. Guess both right and the two cancel.
function impactOffset(point, nominalPoint, speed) {
  const axes = heldAxes();
  const elevationHold = axes.y ? appliedHoldIn.y : 0;
  const elevationDialled = aimMode() === "dialled" ? nominalPoint.path_inches : 0;
  const windHold = axes.x ? appliedHoldIn.x : 0;
  const windDialled = windMode() === "dialled" ? nominalPoint.windage_in : 0;
  const offset = {
    x: windHold + point.windage_in - windDialled,
    y: elevationHold + point.path_inches - elevationDialled,
  };
  const m = motion();
  if (m) offset.x += heldLead(nominalPoint, m) - leadAt(point, speed ?? m.band.nominal, m);
  return offset;
}

// ---------------------------------------------------------------------------
// A moving animal.
//
// The lead is how far it travels across the line of fire while the bullet
// is in the air. The crosshair is held that far ahead of the vitals, for the
// speed and range you believe; the speed you do not know for sure widens the
// spread, sideways, exactly as an uncertain wind does - and like the wind it
// is folded into the verdict and the maximum ethical range.
// ---------------------------------------------------------------------------

/// The animal's movement, or null when it is standing still.
function motion() {
  const band = ballisticsMotion.speedBand({
    gait: motionGaitSelect.value,
    speed: readCanonical(motionSpeedInput),
    slop: readCanonical(motionSlopInput),
  });
  if (!band) return null;
  return {
    band,
    gait: motionGaitSelect.value,
    across: ballisticsMotion.acrossFactor(motionAngleSelect.value),
    angle: motionAngleSelect.value,
    // Moving right is the direction of positive x on the drawing.
    sign: motionDirectionSelect.value === "left" ? -1 : 1,
    direction: motionDirectionSelect.value,
  };
}

/// How far the animal moves, in inches and signed, in the time the bullet
/// takes to reach `point`.
function leadAt(point, speed, m) {
  return m.sign * ballisticsMotion.leadInches(speed, m.across, point.seconds);
}

/// The lead the crosshair is held at: for the range and speed you believe.
function heldLead(nominalPoint, m) {
  return leadAt(nominalPoint, m.band.nominal, m);
}

/// The speeds at the two sides of the spread: the one that throws the shot
/// furthest left, then the one that throws it furthest right. A faster
/// animal than you held for leaves the shot behind it.
function speedExtremes(m) {
  return m.sign > 0 ? [m.band.hi, m.band.lo] : [m.band.lo, m.band.hi];
}

/// How much of the sideways spread at this range is the speed alone.
function speedSpreadAt(point, m) {
  return Math.abs(leadAt(point, m.band.hi, m) - leadAt(point, m.band.lo, m));
}

function bandRanges(band, steps = 8) {
  if (band.hi <= band.lo) return [band.lo];
  return Array.from({ length: steps + 1 }, (_, i) => band.lo + ((band.hi - band.lo) * i) / steps);
}

/// The region the impact could fall in, as a closed polygon in inches.
///
/// Traced rather than sampled: one edge walks the range band at the low wind,
/// the other walks back at the high wind. Because drop and drift are both
/// monotonic in range, and drift is monotonic in wind, everything the shot
/// could do lies between those two edges.
///
/// A moving animal's speed band rides on the same two edges: the speed that
/// throws the shot furthest left with the wind that does, and likewise right.
function uncertaintyRegion(nominalPoint) {
  const ranges = bandRanges(rangeBand(nominalPoint.yards));
  const m = motion();
  const edge = (points, list, speed) =>
    list.map((r) => impactOffset(pointAt(points, r), nominalPoint, speed));

  const speedSpread = m != null && m.band.hi > m.band.lo;
  if (!bandPoints && !speedSpread) return edge(lastPoints, ranges);
  const [leftSpeed, rightSpeed] = m ? speedExtremes(m) : [undefined, undefined];
  return [
    ...edge(bandPoints?.lo ?? lastPoints, ranges, leftSpeed),
    ...edge(bandPoints?.hi ?? lastPoints, [...ranges].reverse(), rightSpeed),
  ];
}

/// The same spread, but with the aim assumed correct for the nominal range.
/// Used for the range recommendation, where the question is how big the
/// uncertainty is rather than where this particular shot is pointed.
///
/// Takes the trajectory to measure rather than reading the current one, so
/// the ammunition shortlist can ask the same question of every load in the
/// catalogue. A load with no wind band solved for it gets the range band
/// alone, which is the honest answer for what has been computed.
///
/// A moving animal's speed band is part of it: a slow bullet gives the
/// animal longer to be somewhere other than where you led it, which is a
/// real difference between loads, so the shortlist counts it too.
function centredSpreadAt(yards, points = lastPoints, band = bandPoints) {
  const nominal = pointAt(points, yards);
  const ranges = bandRanges(rangeBand(yards));
  const m = motion();
  const edge = (from, speed) =>
    ranges.map((r) => {
      const p = pointAt(from, r);
      const offset = {
        x: p.windage_in - nominal.windage_in,
        y: p.path_inches - nominal.path_inches,
      };
      if (m) offset.x += heldLead(nominal, m) - leadAt(p, speed, m);
      return offset;
    });

  const speedSpread = m != null && m.band.hi > m.band.lo;
  if (!band && !speedSpread) return edge(points, m?.band.nominal);
  const [leftSpeed, rightSpeed] = m ? speedExtremes(m) : [undefined, undefined];
  return [...edge(band?.lo ?? points, leftSpeed), ...edge(band?.hi ?? points, rightSpeed).reverse()];
}

/// Where the shot lands at each end of the wind band, at the nominal range.
/// These anchor the gradient, and give the labels something to sit on.
function windBandEnds(nominalPoint) {
  if (!bandPoints) return null;
  return {
    lo: impactOffset(pointAt(bandPoints.lo, nominalPoint.yards), nominalPoint),
    hi: impactOffset(pointAt(bandPoints.hi, nominalPoint.yards), nominalPoint),
  };
}

function regionBounds(region) {
  const xs = region.map((p) => p.x);
  const ys = region.map((p) => p.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

// Populated here rather than beside the other startup calls: BEAUFORT is a
// const in this block, so calling it from further up the file would run
// before that binding is initialised.
buildWindScaleOptions();

/// The gaits, labelled with their speeds in the units on screen.
function buildMotionOptions() {
  const selected = motionGaitSelect.value;
  const speed = (v) =>
    imperial() ? String(v) : ballisticsUnits.trimmed(shown("animalSpeed", v), 0);
  motionGaitSelect.innerHTML =
    `<option value="">Standing still</option>` +
    ballisticsMotion.GAITS.map(
      (g) => `<option value="${g.key}">${g.label} (${speed(g.lo)}&ndash;${speed(g.hi)} ${unitOf("animalSpeed")})</option>`
    ).join("") +
    `<option value="exact">Exact speed</option>`;
  motionGaitSelect.value = selected;
}

/// Shows only the controls the chosen gait needs.
function syncMotionControls() {
  const gait = motionGaitSelect.value;
  document.getElementById("motion-speed-label").hidden = gait !== "exact";
  document.getElementById("motion-slop-label").hidden = gait !== "exact";
  document.getElementById("motion-direction-label").hidden = !gait;
  document.getElementById("motion-angle-label").hidden = !gait;
}

buildMotionOptions();
syncMotionControls();

// None of it needs a new trajectory - the lead is the animal's speed times
// a time of flight the trajectory already holds - so it is a re-render.
for (const control of [motionGaitSelect, motionSpeedInput, motionSlopInput, motionDirectionSelect, motionAngleSelect]) {
  control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
    syncMotionControls();
    if (lastPoints) renderAnimalPanel(lastPoints);
  });
}

/// Where the crosshair is held and where the bullet lands, both as offsets
/// in inches from the vitals centre.
///
/// Elevation and windage are compensated independently, so each axis is
/// built the same way and the two selects can be set in any combination.
/// Taking the drift or the drop shows it raw, which is what makes the
/// compensation obvious; a dialled turret removes it; a hold puts the
/// crosshair where the user has dragged it and lets the bullet fall from
/// there.
///
/// The crosshair is where you are pointing *now*, while the impact is solved
/// from the aim point that was last applied - so during a drag the impact
/// stays put instead of sliding along with the crosshair.
function shotGeometry(point) {
  const axes = heldAxes();
  // Held ahead of a moving animal by the lead. The impact needs no term of
  // its own: the hold ahead and the animal's travel cancel at the speed and
  // range you believe, and the region is where the doubt about them shows.
  const m = motion();
  const lead = m ? heldLead(point, m) : 0;
  return {
    aim: {
      x: (axes.x ? holdOffsetIn.x : 0) + lead,
      y: axes.y ? holdOffsetIn.y : 0,
    },
    impact: {
      x: (axes.x ? appliedHoldIn.x : 0) + (windMode() === "dialled" ? 0 : point.windage_in),
      y: (axes.y ? appliedHoldIn.y : 0) + (aimMode() === "dialled" ? 0 : point.path_inches),
    },
  };
}

/// Judges whether the round still performs at this range, separately from
/// whether it lands in the vitals. Both have to hold for an ethical shot,
/// and terminal performance is usually the binding constraint first -
/// energy and velocity fall off much faster than the group opens up.
function assessTerminal(profile, point) {
  const minEnergy = effectiveMinEnergy(profile);
  const expansionFloor = readCanonical(expansionVelocityInput);

  const energyOk = minEnergy == null || point.energy_ft_lb >= minEnergy;
  const expansionOk =
    !(expansionFloor > 0) || point.velocity_fps >= expansionFloor;

  return { minEnergy, expansionFloor, energyOk, expansionOk };
}

/// Furthest range at which the round still meets every threshold: enough
/// retained energy, enough velocity to expand, and a group still small
/// enough to fit the vitals.
///
/// Deliberately ignores drop and drift: those are dialled or held off for,
/// so they do not cap the range the way terminal performance and precision
/// do. Returns null when the shot fails even at the muzzle.
function maxEthicalRange(profile, points, band = bandPoints) {
  const { minEnergy, expansionFloor } = assessTerminal(profile, points[0]);
  const vitals = effectiveVitals(profile);
  const groupRadius = (yards) => groupDiameterInches(yards) / 2;

  let furthest = null;
  for (const point of points) {
    // Terminal performance is judged at the *far* end of the range band,
    // where the bullet has least left. Believing 300 and shooting at 325 is
    // the case that has to hold, not the one you hoped for.
    const worst = pointAt(points, rangeBand(point.yards).hi);
    const energyOk = minEnergy == null || worst.energy_ft_lb >= minEnergy;
    const expansionOk = !(expansionFloor > 0) || worst.velocity_fps >= expansionFloor;

    // And placement is judged against the whole spread, not the group alone.
    const spreadOk =
      assessRegion(
        vitals,
        centredSpreadAt(point.yards, points, band),
        groupRadius(point.yards)
      ).verdict === "hit";

    if (!energyOk || !expansionOk || !spreadOk) break;
    furthest = point.yards;
  }
  return furthest;
}

// ---------------------------------------------------------------------------
// The reverse query: "what will do it?"
//
// Everything above answers the forward question - I have this box of
// ammunition, where will it hit? The question a hunter actually asks is the
// other way round: I am after a red deer at 250 yards, what will do the job?
// The app already knows what makes a shot ethical, so answering it is a
// matter of asking that same question of every load in the catalogue rather
// than of the one in the form.
//
// One request does the solving: two dozen trajectories from the browser
// would be two dozen round trips, and this is meant to work on a phone with
// one bar of signal.
//
// What it deliberately does *not* fold in is the wind band. That would be
// three solves per load rather than one, and the wind uncertainty is very
// nearly common to every load - it moves each row by about the same amount,
// so it changes the absolute verdict but not the order. The panel above is
// where a chosen load gets the full treatment; this table is for narrowing
// the shelf down to the two or three worth putting in the panel.
// ---------------------------------------------------------------------------

let shortlistCartridge = null;

/// The last ranking, so a change of units can re-show it without solving
/// the catalogue again.
let lastShortlist = null;

/// Notes what cartridge the form is currently set up for, so the shortlist
/// can offer to stay inside it. Only a catalogue pick establishes this - a
/// hand-typed BC and velocity say nothing about what the rifle chambers.
function noteShortlistCartridge(cartridge) {
  shortlistCartridge = cartridge ?? null;
  shortlistFilterLabel.hidden = shortlistCartridge == null;
  if (shortlistCartridge != null) {
    shortlistCartridgeName.textContent = `${shortlistCartridge} only`;
  }
}

function shortlistStatus(message) {
  shortlistNote.hidden = false;
  shortlistNote.textContent = message;
}

async function runShortlist() {
  const profile = currentProfile();
  if (!profile) {
    shortlistStatus("Pick a species first - the thresholds come from the animal.");
    return;
  }

  const payload = buildRequestPayload();
  const sameCartridge = shortlistCartridge != null && shortlistSameCartridge.checked;

  shortlistRunButton.disabled = true;
  shortlistStatus("Solving the catalogue...");

  let entries;
  try {
    entries = await ballisticsSolver.rankCatalogue({
      loads: factoryLoads,
      rifle: payload.rifle,
      atmosphere: payload.atmosphere,
      shot: payload.shot,
      cartridges: sameCartridge ? [shortlistCartridge] : undefined,
    });
  } catch (err) {
    shortlistStatus(`Could not rank the catalogue: ${ballisticsUnits.translateMessage(err.message, units)}`);
    shortlistRunButton.disabled = false;
    return;
  }
  shortlistRunButton.disabled = false;

  lastShortlist = { entries };
  renderShortlist(profile, entries);
}

/// Judges one catalogue load the way the panel judges the one in the form.
function assessLoad(profile, points) {
  const range = readCanonical(shotRangeInput);
  const point = pointAt(points, range);
  const worst = pointAt(points, rangeBand(range).hi);

  // No wind band solved for these, so the spread is the range band alone.
  const terminal = assessTerminal(profile, worst);
  const placement = assessRegion(
    effectiveVitals(profile),
    centredSpreadAt(range, points, null),
    groupDiameterInches(range) / 2
  );

  return {
    point,
    worst,
    terminal,
    placement,
    furthest: maxEthicalRange(profile, points, null),
    // How far the engine solved at all. A load still passing every
    // threshold at the last point has not been shown a limit, only the end
    // of the table, and the row says "+" rather than claiming a figure.
    solvedTo: points[points.length - 1].yards,
    ok: terminal.energyOk && terminal.expansionOk && placement.verdict === "hit",
  };
}

function renderShortlist(profile, entries) {
  const byId = new Map(factoryLoads.map((l) => [l.id, l]));
  const range = readCanonical(shotRangeInput);

  const rows = entries
    .map((entry) => {
      const load = byId.get(entry.load_id);
      if (!load || !entry.points.length) return null;
      return { load, ...assessLoad(profile, entry.points) };
    })
    .filter(Boolean)
    // Loads that will do the job first, then by how much margin they have -
    // a load that carries to 500 is a safer choice at 250 than one that
    // only just makes it, because the range estimate is a judgement.
    .sort((a, b) => {
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return (b.furthest ?? -1) - (a.furthest ?? -1);
    });

  if (!rows.length) {
    shortlistWrap.hidden = true;
    shortlistStatus("No loads in the catalogue to rank.");
    return;
  }

  const band = rangeBand(range);
  const passing = rows.filter((r) => r.ok).length;
  shortlistStatus(
    `${passing} of ${rows.length} will do it on ${profile.common_name.toLowerCase()} at ` +
      `${distanceText(range)} ${unitOf("distance")}${band.slop > 0 ? ` (±${distanceText(band.slop)})` : ""}. ` +
      `Wind uncertainty is not folded in here${motion() ? ", though the animal's movement is" : ""} - pick a load and read the panel above for that.`
  );

  // Terminal performance is read at the far end of the range band and
  // placement at the range itself, so the headers say which is which rather
  // than leaving two different distances looking like one column of
  // figures.
  document.querySelector("#shortlist thead tr").innerHTML = [
    "Load",
    "Carries to",
    `Energy at ${distanceText(band.hi)} ${unitOf("distance")}`,
    `Velocity at ${distanceText(band.hi)} ${unitOf("distance")}`,
    `Drift at ${distanceText(range)} ${unitOf("distance")}`,
    `Drop at ${distanceText(range)} ${unitOf("distance")}`,
  ]
    .map((h) => `<th>${h}</th>`)
    .join("");

  shortlistBody.innerHTML = rows
    .map((row) => {
      const why = [];
      if (!row.terminal.energyOk) why.push("not enough energy");
      if (!row.terminal.expansionOk) why.push("below expansion velocity");
      if (row.placement.verdict !== "hit") why.push("spread wider than the vitals");

      const carries =
        row.furthest == null
          ? "not at any range"
          : row.furthest >= row.solvedTo
            ? `${distanceText(row.furthest, { atMost: true })}+ ${unitOf("distance")}`
            : `${distanceText(row.furthest, { atMost: true })} ${unitOf("distance")}`;

      return `
        <tr class="shortlist-row ${row.ok ? "ok" : "bad"}" data-load-id="${escapeHtml(row.load.id)}" tabindex="0" role="button">
          <td>
            ${escapeHtml(`${row.load.manufacturer} ${row.load.product_line}`)}<br />
            <span class="shortlist-detail">${escapeHtml(
              // `bullet` already carries the weight, e.g. "143 gr ELD-X".
              `${row.load.cartridge} · ${row.load.bullet}`
            )}${why.length ? ` · <span class="shortlist-why">${escapeHtml(why.join(", "))}</span>` : ""}</span>
          </td>
          <td class="${row.ok ? "ok" : "bad"}">${carries}</td>
          <td class="${row.terminal.energyOk ? "ok" : "bad"}">${Math.round(shown("energy", row.worst.energy_ft_lb))}</td>
          <td class="${row.terminal.expansionOk ? "ok" : "bad"}">${Math.round(shown("velocity", row.worst.velocity_fps))}</td>
          <td>${lengthText(Math.abs(row.point.windage_in))}</td>
          <td>${lengthText(Math.abs(row.point.path_inches))}</td>
        </tr>`;
    })
    .join("");

  shortlistWrap.hidden = false;
}

/// Picking a row is the point of the table: it puts that load in the form
/// and re-solves, so the full panel - wind band and all - is one click from
/// the shortlist.
function chooseShortlistRow(row) {
  const id = row?.dataset.loadId;
  if (!id) return;
  factoryLoadSelect.value = id;
  factoryLoadSelect.dispatchEvent(new Event("change"));
  row.scrollIntoView({ behavior: "smooth", block: "center" });
}

// A ranking is only true for the conditions it was run in, and those are
// half the form: move the range, change the species, widen the group, and
// every figure in the table is wrong. Rather than re-solving the catalogue
// on every keystroke, the table says so and waits to be asked again.
//
// The ammunition fields are exempt because the shortlist does not depend on
// them - it varies the load itself - so picking a row would otherwise
// invalidate the table that was just clicked.
const SHORTLIST_INDEPENDENT_FIELDS = new Set([
  "drag_function",
  "ballistic_coefficient",
  "muzzle_velocity",
  "bullet_weight_gr",
  "factory-load",
]);

function markShortlistStale(event) {
  if (shortlistWrap.hidden) return;
  const field = event.target;
  if (SHORTLIST_INDEPENDENT_FIELDS.has(field.name) || SHORTLIST_INDEPENDENT_FIELDS.has(field.id)) {
    return;
  }
  shortlistWrap.classList.add("stale");
  shortlistStatus("Conditions have changed since this was ranked. Rank the catalogue again.");
}

form.addEventListener("input", markShortlistStale);
form.addEventListener("change", markShortlistStale);

shortlistRunButton.addEventListener("click", () => {
  shortlistWrap.classList.remove("stale");
  runShortlist();
});
shortlistBody.addEventListener("click", (event) =>
  chooseShortlistRow(event.target.closest(".shortlist-row"))
);
shortlistBody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  chooseShortlistRow(event.target.closest(".shortlist-row"));
});

/// Describes an aim offset the way a hunter would say it out loud, in both
/// inches on the animal and the MOA they would actually dial or hold.
function describeHold(offset, yards) {
  const inMoa = (inches) =>
    yards > 0
      ? ` (${angleText(Math.abs(ballisticsUnits.inchesToMoa(inches, yards)))} ${unitOf("angle")})`
      : "";

  const parts = [];
  if (Math.abs(offset.y) >= 0.1) {
    parts.push(
      `${lengthText(Math.abs(offset.y))} ${unitOf("length")} ${offset.y > 0 ? "high" : "low"}${inMoa(offset.y)}`
    );
  }
  if (Math.abs(offset.x) >= 0.1) {
    parts.push(
      `${lengthText(Math.abs(offset.x))} ${unitOf("length")} ${offset.x > 0 ? "right" : "left"}${inMoa(offset.x)}`
    );
  }
  return parts.length ? parts.join(", ") : "dead on";
}

/// How far the wind moves the shot, and how much of that is guesswork.
///
/// Reported separately from the spread because they are separate problems.
/// The offset you can hold off for; the spread you cannot, because you do
/// not know which way to correct. At any real range on a small animal the
/// offset alone is usually the bigger number - ten miles an hour at three
/// hundred yards is most of the way across a roe deer's vitals - and a
/// shooter who reads only the uncertainty would miss that entirely.
function describeWindPush(point) {
  const drift = point.windage_in;
  const side = drift >= 0 ? "right" : "left";
  const offset = `${lengthText(Math.abs(drift))} ${unitOf("length")} ${side} at ${distanceText(point.yards)} ${unitOf("distance")}`;

  const ends = windBandEnds(point);
  if (!ends) return offset;

  const spread = Math.abs(ends.hi.x - ends.lo.x);
  return `${offset}, and you are unsure of ${lengthText(spread)} ${unitOf("length")} of that`;
}

/// Names the unknown that is costing the most, and what to do about it.
///
/// This is the part worth reading. The three sources spread the shot in
/// different directions, so the shape of the footprint says which one to go
/// and fix - and they are fixed in completely different ways. Range you can
/// measure. Wind you can wait out or walk closer to. The group is the rifle
/// and the position, and neither changes in the next thirty seconds.
///
/// Also carries the one asymmetry that matters: getting the range short
/// throws the shot low, into brisket and leg, while getting it long throws
/// it high, into spine or clean over the back. A miss beats a gut shot, so
/// when the estimate is a band, take the long end of it.
///
/// Both the wind and a moving animal's speed spread the shot sideways, and
/// add; `speedSpread` is the speed's share, so each is named for its own.
function describeDominantUncertainty(spread, groupInches, range, wind, speedSpread = 0) {
  const parts = [
    { source: "range", size: spread.height, advice: "range it if you can - a rangefinder collapses this to nothing" },
    { source: "wind", size: spread.width - speedSpread, advice: "wait for it to drop, or close the distance" },
    { source: "animal's speed", size: speedSpread, advice: "wait for it to stop or slow down, or let it go" },
    { source: "group", size: groupInches, advice: "that is the rifle and your position, and neither improves in the next minute" },
  ].filter((p) => p.size > 0.05);

  if (!parts.length) return "nothing much - everything is pinned down";

  parts.sort((a, b) => b.size - a.size);
  const worst = parts[0];
  const lead = `the ${worst.source}, ${lengthText(worst.size)} ${unitOf("length")} of it &mdash; ${worst.advice}`;

  if (worst.source !== "range" || range.slop <= 0) return lead;
  return `${lead}. Being short throws the shot low into the brisket; being long throws it high. Take the long end of your estimate.`;
}

function renderAnimalInfo(profile, assessment, point) {
  const range = rangeBand(point.yards);
  const wind = windBand();
  const angle = windAngleBand();
  const movement = motion();
  const speedSpread = movement ? speedSpreadAt(point, movement) : 0;
  const uncertain =
    range.slop > 0 || wind.force != null || angle.slop > 0 || speedSpread > 0;

  // Terminal performance is read at the far end of the range band. If the
  // animal might be at 325 and you believe 300, 325 is the shot you are
  // actually taking.
  const worstPoint = pointAt(lastPoints ?? [point], range.hi);
  const terminal = assessTerminal(profile, worstPoint);
  const furthest = maxEthicalRange(profile, lastPoints ?? [point]);
  const vitals = effectiveVitals(profile);
  const terminalOk = terminal.energyOk && terminal.expansionOk;

  // Placement is judged first: a round that still performs is no help if
  // the shot is not in the vitals to begin with.
  let badgeClass = "hit";
  let badgeText = uncertain
    ? "Safe across everything you are unsure of"
    : "Vitals hit, round still performing";
  // Placement is tested before terminal performance, and "in the vitals" is
  // only ever claimed when the verdict is actually a hit. A marginal spread
  // with failing energy used to report "in the vitals, but past its limits",
  // which is a comforting way of saying something untrue about the half of
  // the problem that matters most.
  if (assessment.verdict === "miss") {
    badgeClass = "miss";
    badgeText = "Impact outside the vitals - reconsider this shot";
  } else if (assessment.verdict === "marginal" && !terminalOk) {
    badgeClass = "miss";
    badgeText = "Spread reaches past the vitals, and the round is past its limits";
  } else if (assessment.verdict === "marginal") {
    badgeClass = "marginal";
    badgeText = uncertain
      ? "Only safe if every estimate is right - do not take it"
      : "Group overlaps the edge of the vitals";
  } else if (!terminalOk) {
    badgeClass = "miss";
    badgeText = "In the vitals, but the round is past its limits";
  }

  const spread = regionBounds(uncertaintyRegion(point));
  const groupHere = groupDiameterInches(point.yards);
  const uncertaintyRows = uncertain
    ? `
      <dt>Range could be</dt>
      <dd>${distanceText(range.lo, { rounded: true })}&ndash;${distanceText(range.hi, { rounded: true })} ${unitOf("distance")}${
        range.slop > 0 ? "" : " (ranged)"
      }</dd>
      <dt>Wind could be</dt>
      <dd>${
        wind.force
          ? `Beaufort ${wind.force.force}, ${bandSpeedText(wind.lo)}&ndash;${bandSpeedText(wind.hi)} ${unitOf("windSpeed")} &mdash; ${escapeHtml(
              wind.force.seen.toLowerCase()
            )}`
          : `${formatInches(shown("windSpeed", wind.lo))} ${unitOf("windSpeed")}, taken as measured`
      }${
        angle.slop > 0
          ? `, from ${Math.round(angle.lo)}&ndash;${Math.round(angle.hi)}&deg;`
          : ` at ${Math.round(angle.nominal)}&deg;`
      }</dd>
      <dt>Wind pushes it</dt>
      <dd class="${Math.abs(point.windage_in) <= vitals.width_in / 2 ? "ok" : "bad"}">
        ${describeWindPush(point)}
      </dd>
      <dt>That spreads the shot</dt>
      <dd class="${assessment.groupFullyInside ? "ok" : "bad"}">
        ${lengthText(spread.height + groupHere)} ${unitOf("length")} tall &times;
        ${lengthText(spread.width + groupHere)} ${unitOf("length")} wide,
        against a ${lengthText(vitals.width_in)}&times;${lengthText(
          vitals.height_in
        )} ${unitOf("length")} vital zone
      </dd>
      <dt>Worst of it is</dt>
      <dd>${describeDominantUncertainty(spread, groupHere, range, wind, speedSpread)}</dd>`
    : "";

  const motionRow = movement
    ? `
      <dt>Animal moving</dt>
      <dd>${describeMotion(movement)} &mdash; the crosshair is held ahead of it by the lead, as drawn</dd>`
    : "";

  const groupRow =
    groupMoa() > 0
      ? `
      <dt>Group here</dt>
      <dd class="${assessment.groupFullyInside ? "ok" : "bad"}">
        ${lengthText(groupDiameterInches(point.yards))} ${unitOf("length")} across
        (${angleText(groupMoa())} ${unitOf("angle")}) vs a
        ${lengthText(vitals.width_in)}&times;${lengthText(vitals.height_in)} ${unitOf("length")} vital zone
      </dd>`
      : "";

  // A dialled turret answers the hold question for its axis by definition,
  // so that axis is dropped from the row - and with both dialled there is
  // no row at all.
  const heldOrTaken = {
    x: windMode() === "dialled" ? 0 : -point.windage_in,
    y: aimMode() === "dialled" ? 0 : -point.path_inches,
  };
  const axes = heldAxes();
  const holdRows =
    aimMode() === "dialled" && windMode() === "dialled"
      ? ""
      : `
      <dt>Hold needed</dt>
      <dd>${describeHold(heldOrTaken, point.yards)}</dd>${
        crosshairIsMovable()
          ? `
      <dt>Hold set</dt>
      <dd>${describeHold(
        { x: axes.x ? appliedHoldIn.x : 0, y: axes.y ? appliedHoldIn.y : 0 },
        point.yards
      )}</dd>`
          : ""
      }`;

  const terminalRows = `
      <dt>Energy${uncertain ? ` at ${distanceText(range.hi, { rounded: true })} ${unitOf("distance")}` : " here"}</dt>
      <dd class="${terminal.energyOk ? "ok" : "bad"}">
        ${Math.round(shown("energy", worstPoint.energy_ft_lb))} ${unitOf("energy")}${
          terminal.minEnergy == null
            ? " (no minimum set for this species)"
            : ` vs ${Math.round(shown("energy", terminal.minEnergy))} minimum`
        }
      </dd>
      <dt>Velocity${uncertain ? ` at ${distanceText(range.hi, { rounded: true })} ${unitOf("distance")}` : " here"}</dt>
      <dd class="${terminal.expansionOk ? "ok" : "bad"}">
        ${Math.round(shown("velocity", worstPoint.velocity_fps))} ${unitOf("velocity")}${
          terminal.expansionFloor > 0
            ? ` vs ${Math.round(shown("velocity", terminal.expansionFloor))} expansion floor`
            : " (no expansion floor set)"
        }
      </dd>
      <dt>Max ethical range</dt>
      <dd>${
        furthest == null
          ? "under this range even at the muzzle"
          : `about ${distanceText(furthest, { atMost: true })} ${unitOf("distance")} for this load, rifle and species`
      }</dd>`;

  animalInfo.innerHTML = `
    <h3>${profile.common_name} <span class="scientific-name">${profile.scientific_name}</span></h3>
    <span class="hit-badge ${badgeClass}">${badgeText} at ${distanceText(point.yards)} ${unitOf("distance")}</span>
    <dl>
      <dt>${profile.male_label}</dt>
      <dd>${sizeRange("length", profile.male.shoulder_height_in)} ${unitOf("length")} shoulder height, ${sizeRange("mass", profile.male.weight_lb)} ${unitOf("mass")}</dd>
      <dt>${profile.female_label}</dt>
      <dd>${sizeRange("length", profile.female.shoulder_height_in)} ${unitOf("length")} shoulder height, ${sizeRange("mass", profile.female.weight_lb)} ${unitOf("mass")}</dd>
      <dt>Vitals</dt>
      <dd>~${
        imperial()
          ? `${profile.vitals.width_in}in x ${profile.vitals.height_in}in`
          : `${Math.round(shown("length", profile.vitals.width_in))} cm x ${Math.round(shown("length", profile.vitals.height_in))} cm`
      } behind the shoulder</dd>
      ${motionRow}
      ${uncertaintyRows}
      ${holdRows}
      ${groupRow}
      ${terminalRows}
      <dt>Habitat</dt>
      <dd>${profile.habitat}</dd>
      <dt>Diet</dt>
      <dd>${profile.diet}</dd>
    </dl>
    <h4>Fun facts</h4>
    <ul>${profile.fun_facts.map((fact) => `<li>${fact}</li>`).join("")}</ul>
  `;
}

/// "running, 24-45 km/h, left to right, crossing", or "at 30 km/h, ..."
/// for an exact speed.
function describeMotion(m) {
  const gait = ballisticsMotion.GAITS.find((g) => g.key === m.gait);
  const speed = (v) => ballisticsUnits.trimmed(shown("animalSpeed", v), gait ? 0 : 1);
  const speeds =
    m.band.hi > m.band.lo ? `${speed(m.band.lo)}&ndash;${speed(m.band.hi)}` : speed(m.band.nominal);
  return [
    gait ? `${gait.label.toLowerCase()}, ${speeds} ${unitOf("animalSpeed")}` : `at ${speeds} ${unitOf("animalSpeed")}`,
    m.direction === "left" ? "right to left" : "left to right",
    m.angle,
  ].join(", ");
}

function formatRange([min, max]) {
  return `${min}-${max}`;
}

/// A species' size range, as authored in imperial, or rounded to the
/// whole centimetre or kilogram - the figures are typical, not measured.
function sizeRange(quantity, range) {
  return formatRange(imperial() ? range : range.map((v) => Math.round(shown(quantity, v))));
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

// ---------------------------------------------------------------------------
// Switching units.
//
// At the very end of the file because it touches nearly everything above,
// some of it const tables that do not exist until their line has run.
// ---------------------------------------------------------------------------

/// Re-labels and re-shows everything for the units now chosen. The values
/// themselves are not touched here - see `setUnits`.
function applyUnitsToPage() {
  unitSystemSelect.value = units.system;
  angleUnitSelect.value = units.angle;

  for (const [input, quantity] of UNIT_FIELDS) {
    for (const attr of ["min", "max"]) {
      const limit = input.dataset[`${attr}Canonical`];
      if (limit !== undefined) input.setAttribute(attr, String(shown(quantity, Number(limit))));
    }
  }
  // A whole caption per label, filled from a template, rather than a unit
  // span inside the text: labels are flex columns, and a span would land
  // on a line of its own.
  for (const caption of document.querySelectorAll("[data-label]")) {
    caption.textContent = caption.dataset.label.replace(/\{(\w+)\}/g, (_, quantity) => unitOf(quantity));
  }
  for (const span of document.querySelectorAll("[data-unit]")) {
    span.textContent = unitOf(span.dataset.unit);
  }
  for (const element of document.querySelectorAll("[data-title-metric]")) {
    element.dataset.titleImperial ??= element.title;
    element.title = imperial() ? element.dataset.titleImperial : element.dataset.titleMetric;
  }

  buildWindScaleOptions();
  buildMotionOptions();
  buildColumnToggles();
  const entry = factoryLoads.find((l) => l.id === factoryLoadSelect.value);
  if (entry) renderFactoryLoadNote(entry);
  syncScaleControls();
  refreshGroupWarning();

  if (lastPoints) {
    renderTable(lastPoints);
    renderChart(lastPoints);
    renderAnimalPanel(lastPoints);
  }

  // A ranking still true for the current conditions is shown again in the
  // new units. One already marked stale is not: re-showing it would mix
  // the old trajectories with the new range and thresholds.
  if (lastShortlist && !shortlistWrap.hidden) {
    if (shortlistWrap.classList.contains("stale")) {
      shortlistWrap.hidden = true;
    } else {
      const profile = currentProfile();
      if (profile) renderShortlist(profile, lastShortlist.entries);
    }
  }
}

/// Changes the units shown. Every value is read in the old units first and
/// written back in the new, so nothing is reinterpreted - 100 m becomes
/// 109.36 yd, never 100 yd.
function setUnits(next) {
  const held = UNIT_FIELDS.map(([input]) => [input, input.value === "" ? "" : readCanonical(input)]);
  units = next;
  saveUnitChoice();
  for (const [input, value] of held) writeCanonical(input, value);
  applyUnitsToPage();
}

unitSystemSelect.addEventListener("change", () => setUnits({ ...units, system: unitSystemSelect.value }));
angleUnitSelect.addEventListener("change", () => setUnits({ ...units, angle: angleUnitSelect.value }));

applyUnitsToPage();
