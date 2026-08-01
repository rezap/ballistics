const form = document.getElementById("trajectory-form");
const resultsSection = document.getElementById("results");
const errorBox = document.getElementById("error");
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

let animalsList = [];
let factoryLoads = [];
let lastPoints = null;

// Set when the page was opened from a share link, so the trajectory can be
// solved once the species list has arrived and the panel has something to
// draw against.
let pendingSharedPreset = false;

const UNIT_TO_INCHES = { in: 1, cm: 1 / 2.54, m: 39.3701 };
const imageCache = new Map();

// Set by the last render so pointer events can map canvas coordinates back
// into the artwork's own pixel space.
let lastTransform = null;

// Where the crosshair sits relative to the vitals centre, in inches, when
// aiming by hold-over. Deliberately survives a change of range: seeing
// where one fixed hold lands across a band of ranges is what the mode is
// for. It resets on a change of species or aim mode.
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

function groupMoa() {
  return confirmedGroupMoa;
}

/// The number as typed, normalised. Anything blank, negative or unparseable
/// means "treat the rifle as perfect", which is the default.
function typedGroupMoa() {
  const value = Number(groupMoaInput.value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/// Group diameter in inches at this range. One MOA subtends 1.047 inches
/// per 100 yards, near enough that the shorthand "one inch at a hundred"
/// is what most people quote.
function groupDiameterInches(yards) {
  return groupMoa() * 1.047 * (yards / 100);
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

  syncScaleControls();

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
}

/// A ballistic coefficient only means anything paired with the drag model
/// it was measured against, so the two are chosen together. G7 is preferred
/// where the maker publishes it: these are boat-tail hunting bullets and G7
/// fits them far better than G1.
function dragModelFor(entry) {
  return entry.bc_g7 != null
    ? { drag_function: "G7", bc: entry.bc_g7 }
    : { drag_function: "G1", bc: entry.bc_g1 };
}

function applyFactoryLoad(entry) {
  const { drag_function, bc } = dragModelFor(entry);
  form.elements.drag_function.value = drag_function;
  form.elements.ballistic_coefficient.value = bc;
  form.elements.muzzle_velocity.value = entry.muzzle_velocity_fps;
  form.elements.bullet_weight_gr.value = entry.bullet_weight_gr;

  const barrel =
    entry.test_barrel_in != null
      ? `${entry.test_barrel_in}in test barrel`
      : "test barrel length not stated";
  factoryLoadNote.hidden = false;
  factoryLoadNote.innerHTML =
    `Advertised by ${escapeHtml(entry.manufacturer)} &mdash; ${barrel}, ` +
    `BC quoted against ${drag_function}. Your rifle will not match the box: ` +
    `reckon on 20&ndash;30 ft/s per inch of barrel below the test length, and ` +
    `chronograph it if you can. ` +
    `<a href="${escapeHtml(entry.source_url)}" target="_blank" rel="noopener noreferrer">Source</a> ` +
    `(retrieved ${escapeHtml(entry.retrieved)}).`;
}

factoryLoadSelect.addEventListener("change", () => {
  const entry = factoryLoads.find((l) => l.id === factoryLoadSelect.value);
  if (!entry) {
    factoryLoadNote.hidden = true;
    factoryLoadNote.textContent = "";
    return;
  }
  applyFactoryLoad(entry);
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
    scaleUnitSelect.value = "in";
    scaleValueInput.value = round1(referenceInches(profile, basis));
  }

  const vitals = effectiveVitals(profile);
  vitalsWidthInput.value = round1(vitals.width_in);
  vitalsHeightInput.value = round1(vitals.height_in);

  const minEnergy = effectiveMinEnergy(profile);
  minEnergyInput.value = minEnergy == null ? "" : Math.round(minEnergy);
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
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

// Every column the table can show. `visible` is only the default - the
// picker persists whatever the reader chooses, which also keeps the table
// narrow enough to be usable on a phone.
const COLUMNS = [
  { key: "yards", label: "Yards", visible: true, format: (p) => p.yards },
  { key: "drop", label: "Drop (in)", visible: true, format: (p) => p.impact_in.toFixed(2) },
  { key: "path", label: "Path (in)", visible: false, format: (p) => p.path_inches.toFixed(2) },
  { key: "wind", label: "Wind drift (in)", visible: true, format: (p) => p.windage_in.toFixed(2) },
  { key: "moa", label: "MOA", visible: true, format: (p) => p.moa_correction.toFixed(2) },
  { key: "velocity", label: "Velocity (ft/s)", visible: true, format: (p) => Math.round(p.velocity_fps) },
  { key: "energy", label: "Energy (ft\u00b7lb)", visible: true, format: (p) => Math.round(p.energy_ft_lb) },
  { key: "time", label: "Time (s)", visible: false, format: (p) => p.seconds.toFixed(3) },
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

function currentPreset() {
  const preset = {};
  for (const field of PRESET_FIELDS) {
    const input = field.input();
    preset[field.key] = field.kind === "choice" ? input.value : Number(input.value);
  }
  return preset;
}

function applyPreset(preset) {
  for (const field of PRESET_FIELDS) {
    field.input().value = preset[field.key];
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
    } />${c.label}</label>`
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

  const payload = buildRequestPayload(new FormData(form));

  let response;
  try {
    response = await fetch("/api/trajectory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    showError(`Request failed: ${err.message}`);
    return;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    showError(body?.error ?? `Request failed with status ${response.status}`);
    return;
  }

  lastPoints = body;
  // Recalculating the shot also solves it from wherever the crosshair has
  // been left, so the button does what it says even mid-drag.
  applyHold();
  renderResults(body);
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
    scaleUnitSelect.value = "in";
    scaleValueInput.value = round1(referenceInches(profile, scaleBasisSelect.value));
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

  const width = Number(vitalsWidthInput.value);
  const height = Number(vitalsHeightInput.value);
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
  updateOverride(profile, { minEnergy: typed === "" ? null : Number(typed) });
  if (lastPoints) renderAnimalPanel(lastPoints);
});

expansionVelocityInput.addEventListener("input", () => {
  if (lastPoints) renderAnimalPanel(lastPoints);
});

aimModeSelect.addEventListener("change", () => {
  // Start each hold-over session from the vitals centre, so the crosshair
  // is somewhere predictable and switching modes is also how you undo a
  // hold you have dragged into a corner.
  resetHold();
  solveHoldButton.hidden = aimMode() !== "holdover";
  if (lastPoints) renderAnimalPanel(lastPoints);
});

// Finding the hold by dragging is fine for exploring, but the exact answer
// is something the trajectory already knows. Placing the crosshair on it
// also demonstrates the relationship the drag makes confusing: the hold
// goes up and left, and the impact lands on the vitals.
solveHoldButton.addEventListener("click", () => {
  if (!lastPoints) return;
  const point = nearestPoint(lastPoints, Number(shotRangeInput.value));
  holdOffsetIn = { x: -point.windage_in, y: -point.path_inches };
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
    groupWarning.hidden = false;
    groupWarning.innerHTML = `
      ${formatInches(typed)} MOA is poor precision for a modern hunting
      rifle &mdash; about ${formatInches(typed * 1.047 * 3)} in at 300 yd.
      <button type="button" class="link-button" id="group-confirm">Use ${formatInches(typed)} MOA anyway</button>`;
    groupWarning.querySelector("#group-confirm").addEventListener("click", () => {
      confirmedGroupMoa = typed;
      groupWarning.textContent = `Using ${formatInches(typed)} MOA.`;
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
  // Only a hold-over crosshair is movable. In the other modes it is pinned
  // to the vitals centre by definition, and dragging it would also fight
  // the vital-zone drag underneath it.
  if (aimMode() !== "holdover" || !lastTransform?.crosshairPx) return false;
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

  const { offsetX, offsetY, fit, artW, artH } = lastTransform;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  updateOverride(profile, {
    anchor: {
      x: clamp((point.x - offsetX) / fit / artW),
      y: clamp((point.y - offsetY) / fit / artH),
    },
  });
  if (lastPoints) renderAnimalPanel(lastPoints);
}

/// Moves the hold-over crosshair, in inches relative to the vitals centre.
/// Canvas y grows downward while a positive bullet path is above the line
/// of sight, so holding high is a *negative* canvas offset.
function moveHoldTo(point) {
  if (!lastTransform) return;
  const { offsetX, offsetY, fit, centreX, centreY, inPerPx } = lastTransform;
  holdOffsetIn = {
    x: ((point.x - offsetX) / fit - centreX) * inPerPx,
    y: -((point.y - offsetY) / fit - centreY) * inPerPx,
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

function buildRequestPayload(formData) {
  const num = (name) => Number(formData.get(name));

  return {
    load: {
      drag_function: formData.get("drag_function"),
      ballistic_coefficient: num("ballistic_coefficient"),
      muzzle_velocity: num("muzzle_velocity"),
      bullet_weight_gr: num("bullet_weight_gr"),
    },
    rifle: {
      sight_height: num("sight_height"),
      zero_range: num("zero_range"),
      zero_y_intercept: 0,
    },
    atmosphere: {
      altitude: num("altitude"),
      pressure: num("pressure"),
      temperature: num("temperature"),
      relative_humidity: num("relative_humidity"),
    },
    shot: {
      shooting_angle: num("shooting_angle"),
      wind_speed: num("wind_speed"),
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

  const step = Math.max(1, Math.round(Number(tableStepInput.value) || 25));
  const maxRange = Math.max(step, Number(tableMaxInput.value) || 500);
  const rows = points.filter((p) => p.yards % step === 0 && p.yards <= maxRange);

  const chosen = new Set(visibleColumnKeys());
  const columns = COLUMNS.filter((c) => chosen.has(c.key));

  document.querySelector("#results-table thead tr").innerHTML = columns
    .map((c) => `<th>${c.label}</th>`)
    .join("");

  for (const point of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = columns.map((c) => `<td>${c.format(point)}</td>`).join("");
    tableBody.appendChild(tr);
  }
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

  const xTicks = 6;
  for (let i = 0; i <= xTicks; i++) {
    const yards = xMin + ((xMax - xMin) * i) / xTicks;
    const x = toX(yards);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.fillText(Math.round(yards).toString(), x - 10, height - padding.bottom + 16);
  }

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const inches = yMin - yPad + ((yMax + yPad - (yMin - yPad)) * i) / yTicks;
    const y = toY(inches);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(inches.toFixed(0), 26, y + 4);
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
  ctx.fillText("Range (yards)", width / 2 - 40, height - 6);
  ctx.save();
  ctx.translate(14, height / 2 + 30);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Bullet path (inches)", 0, 0);
  ctx.restore();
}

/// Finds the point whose yardage is closest to `target` (the trajectory is
/// one point per whole yard, but the shot-range input isn't constrained to
/// only values that exist, e.g. past the computed max range).
function nearestPoint(points, target) {
  return points.reduce((closest, point) =>
    Math.abs(point.yards - target) < Math.abs(closest.yards - target) ? point : closest
  );
}

async function renderAnimalPanel(points) {
  const profile = currentProfile();
  if (!profile) {
    animalInfo.innerHTML = "";
    vitalsCanvas.getContext("2d").clearRect(0, 0, vitalsCanvas.width, vitalsCanvas.height);
    return;
  }

  const requestedRange = Number(shotRangeInput.value);
  const point = nearestPoint(points, requestedRange);

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
  const groupRadiusIn = groupDiameterInches(point.yards) / 2;

  const artW = profile.image_width_px ?? 400;
  const artH = profile.image_height_px ?? 300;
  const centreX = anchor.x * artW;
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

  // Fit the artwork, the impact and the whole group circle, so nothing
  // that matters gets clipped at long range.
  const pad = 26;
  const minX = Math.min(0, impactX - groupRadiusArt, aimX);
  const maxX = Math.max(artW, impactX + groupRadiusArt, aimX);
  const minY = Math.min(0, impactY - groupRadiusArt, aimY);
  const maxY = Math.max(artH, impactY + groupRadiusArt, aimY);
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
  };

  const style = getComputedStyle(document.documentElement);
  const inkColor = style.getPropertyValue("--silhouette").trim() || "#9aa0aa";
  const textColor = style.getPropertyValue("--muted").trim();

  if (image) {
    drawTinted(ctx, image, toPx(0, 0), artW * fit, artH * fit, inkColor);
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

  const assessment = assessShot(vitals, impact, groupRadiusIn);
  const [impactPxX, impactPxY] = toPx(impactX, impactY);
  const [crossPxX, crossPxY] = toPx(aimX, aimY);

  // Group dispersion: where the shot could land, not where it will.
  if (groupRadiusArt > 0) {
    ctx.beginPath();
    ctx.arc(impactPxX, impactPxY, groupRadiusArt * fit, 0, Math.PI * 2);
    ctx.fillStyle = "#f59e0b26";
    ctx.fill();
    ctx.strokeStyle = "#f59e0b";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
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
  if (aimMode() === "holdover") {
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
  if (aimMode() === "holdover") {
    ctx.font = "11px sans-serif";
    ctx.fillStyle = holdIsPending()
      ? style.getPropertyValue("--accent").trim() || "#b3441e"
      : textColor;
    ctx.fillText(holdIsPending() ? "release to solve" : "hold", crossPxX + 18, crossPxY + 4);
    ctx.fillStyle = VERDICT_COLOURS[assessment.verdict];
    ctx.fillText("impact", impactPxX + 9, impactPxY + 16);
  }

  drawScaleBar(ctx, width, height, fit / inPerPx, textColor);

  return assessment;
}

const VERDICT_COLOURS = {
  hit: "#16a34a",
  marginal: "#f59e0b",
  miss: "#dc2626",
};

/// Assesses the shot as a group rather than a point.
///
/// A perfect rifle either hits the vitals or does not. A real one throws a
/// group, so what matters is whether the *whole* group stays inside: a
/// centre hit with half the group hanging outside is a wounding risk, not
/// a clean shot. The group is sampled around its rim because the vitals
/// are an ellipse, where "how far to the edge" depends on direction.
function assessShot(vitals, impact, groupRadiusIn) {
  const halfWidth = vitals.width_in / 2;
  const halfHeight = vitals.height_in / 2;
  const inside = (x, y) => (x / halfWidth) ** 2 + (y / halfHeight) ** 2 <= 1;

  const centreInside = inside(impact.x, impact.y);
  if (groupRadiusIn <= 0) {
    return {
      verdict: centreInside ? "hit" : "miss",
      centreInside,
      groupFullyInside: centreInside,
    };
  }

  let allInside = true;
  let anyInside = false;
  const samples = 24;
  for (let i = 0; i < samples; i++) {
    const angle = (i / samples) * Math.PI * 2;
    const ok = inside(
      impact.x + Math.cos(angle) * groupRadiusIn,
      impact.y + Math.sin(angle) * groupRadiusIn
    );
    allInside = allInside && ok;
    anyInside = anyInside || ok;
  }

  const verdict = allInside ? "hit" : centreInside || anyInside ? "marginal" : "miss";
  return { verdict, centreInside, groupFullyInside: allInside };
}

/// Draws the silhouette recoloured to `color`. The prepared artwork is a
/// pure alpha mask, so it has to be tinted rather than drawn directly -
/// the source is black, which would be invisible in dark mode.
function drawTinted(ctx, image, [x, y], w, h, color) {
  const buffer = document.createElement("canvas");
  buffer.width = Math.max(1, Math.round(w));
  buffer.height = Math.max(1, Math.round(h));
  const bctx = buffer.getContext("2d");
  bctx.drawImage(image, 0, 0, buffer.width, buffer.height);
  bctx.globalCompositeOperation = "source-in";
  bctx.fillStyle = color;
  bctx.fillRect(0, 0, buffer.width, buffer.height);
  ctx.drawImage(buffer, x, y);
}

function drawScaleBar(ctx, width, height, pxPerInch, textColor) {
  const barPx = pxPerInch * 12;
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
  ctx.fillText("1 ft", x + barPx + 6, y + 4);
}

/// Where the crosshair is held and where the bullet lands, both as offsets
/// in inches from the vitals centre.
///
/// Dead-on hold shows the raw drop, which is what makes the compensation
/// obvious. Dialled elevation removes the drop entirely - wind is left
/// alone, because dialling elevation and holding for wind is what most
/// people actually do. Hold-over puts the crosshair wherever the user has
/// dragged it and lets the bullet fall from there.
function shotGeometry(point) {
  const drift = point.windage_in;
  const drop = point.path_inches;

  switch (aimMode()) {
    case "dialled":
      return { aim: { x: 0, y: 0 }, impact: { x: drift, y: 0 } };
    case "holdover":
      // The crosshair is where you are pointing now; the impact is solved
      // from the aim point that was last applied, so it does not simply
      // follow the drag.
      return {
        aim: { ...holdOffsetIn },
        impact: { x: appliedHoldIn.x + drift, y: appliedHoldIn.y + drop },
      };
    default:
      return { aim: { x: 0, y: 0 }, impact: { x: drift, y: drop } };
  }
}

/// Judges whether the round still performs at this range, separately from
/// whether it lands in the vitals. Both have to hold for an ethical shot,
/// and terminal performance is usually the binding constraint first -
/// energy and velocity fall off much faster than the group opens up.
function assessTerminal(profile, point) {
  const minEnergy = effectiveMinEnergy(profile);
  const expansionFloor = Number(expansionVelocityInput.value);

  const energyOk = minEnergy == null || point.energy_ft_lb >= minEnergy;
  const expansionOk =
    !(expansionFloor > 0) || point.velocity_fps >= expansionFloor;

  return { minEnergy, expansionFloor, energyOk, expansionOk };
}

/// Whether the whole group would stay inside the vitals if it were centred
/// on them. This is precision alone, with aim error taken out of it - the
/// range beyond which even a perfectly-placed shot can no longer be relied
/// on to land where it was aimed.
function groupFitsVitals(vitals, yards) {
  const radius = groupDiameterInches(yards) / 2;
  return radius <= Math.min(vitals.width_in, vitals.height_in) / 2;
}

/// Furthest range at which the round still meets every threshold: enough
/// retained energy, enough velocity to expand, and a group still small
/// enough to fit the vitals.
///
/// Deliberately ignores drop and drift: those are dialled or held off for,
/// so they do not cap the range the way terminal performance and precision
/// do. Returns null when the shot fails even at the muzzle.
function maxEthicalRange(profile, points) {
  const { minEnergy, expansionFloor } = assessTerminal(profile, points[0]);
  const vitals = effectiveVitals(profile);
  let furthest = null;
  for (const point of points) {
    const energyOk = minEnergy == null || point.energy_ft_lb >= minEnergy;
    const expansionOk = !(expansionFloor > 0) || point.velocity_fps >= expansionFloor;
    if (!energyOk || !expansionOk || !groupFitsVitals(vitals, point.yards)) break;
    furthest = point.yards;
  }
  return furthest;
}

/// Describes an aim offset the way a hunter would say it out loud, in both
/// inches on the animal and the MOA they would actually dial or hold.
function describeHold(offset, yards) {
  const perMoa = 1.047 * (yards / 100);
  const inMoa = (inches) => (perMoa > 0 ? ` (${formatInches(Math.abs(inches) / perMoa)} MOA)` : "");

  const parts = [];
  if (Math.abs(offset.y) >= 0.1) {
    parts.push(
      `${formatInches(Math.abs(offset.y))} in ${offset.y > 0 ? "high" : "low"}${inMoa(offset.y)}`
    );
  }
  if (Math.abs(offset.x) >= 0.1) {
    parts.push(
      `${formatInches(Math.abs(offset.x))} in ${offset.x > 0 ? "right" : "left"}${inMoa(offset.x)}`
    );
  }
  return parts.length ? parts.join(", ") : "dead on";
}

function renderAnimalInfo(profile, assessment, point) {
  const terminal = assessTerminal(profile, point);
  const furthest = maxEthicalRange(profile, lastPoints ?? [point]);
  const vitals = effectiveVitals(profile);
  const terminalOk = terminal.energyOk && terminal.expansionOk;

  // Placement is judged first: a round that still performs is no help if
  // the shot is not in the vitals to begin with.
  let badgeClass = "hit";
  let badgeText = "Vitals hit, round still performing";
  if (assessment.verdict === "miss") {
    badgeClass = "miss";
    badgeText = "Impact outside the vitals - reconsider this shot";
  } else if (!terminalOk) {
    badgeClass = "miss";
    badgeText = "In the vitals, but the round is past its limits";
  } else if (assessment.verdict === "marginal") {
    badgeClass = "marginal";
    badgeText = "Group overlaps the edge of the vitals";
  }

  const groupRow =
    groupMoa() > 0
      ? `
      <dt>Group here</dt>
      <dd class="${assessment.groupFullyInside ? "ok" : "bad"}">
        ${formatInches(groupDiameterInches(point.yards))} in across
        (${formatInches(groupMoa())} MOA) vs a
        ${formatInches(vitals.width_in)}&times;${formatInches(vitals.height_in)} in vital zone
      </dd>`
      : "";

  // Dialled elevation answers the hold question by definition, so the row
  // would only be noise there.
  const holdRows =
    aimMode() === "dialled"
      ? ""
      : `
      <dt>Hold needed</dt>
      <dd>${describeHold({ x: -point.windage_in, y: -point.path_inches }, point.yards)}</dd>${
        aimMode() === "holdover"
          ? `
      <dt>Hold set</dt>
      <dd>${describeHold(appliedHoldIn, point.yards)}</dd>`
          : ""
      }`;

  const terminalRows = `
      <dt>Energy here</dt>
      <dd class="${terminal.energyOk ? "ok" : "bad"}">
        ${Math.round(point.energy_ft_lb)} ft&middot;lb${
          terminal.minEnergy == null
            ? " (no minimum set for this species)"
            : ` vs ${Math.round(terminal.minEnergy)} minimum`
        }
      </dd>
      <dt>Velocity here</dt>
      <dd class="${terminal.expansionOk ? "ok" : "bad"}">
        ${Math.round(point.velocity_fps)} ft/s${
          terminal.expansionFloor > 0
            ? ` vs ${Math.round(terminal.expansionFloor)} expansion floor`
            : " (no expansion floor set)"
        }
      </dd>
      <dt>Max ethical range</dt>
      <dd>${
        furthest == null
          ? "under this range even at the muzzle"
          : `about ${furthest} yd for this load, rifle and species`
      }</dd>`;

  animalInfo.innerHTML = `
    <h3>${profile.common_name} <span class="scientific-name">${profile.scientific_name}</span></h3>
    <span class="hit-badge ${badgeClass}">${badgeText} at ${point.yards} yd</span>
    <dl>
      <dt>${profile.male_label}</dt>
      <dd>${formatRange(profile.male.shoulder_height_in)} in shoulder height, ${formatRange(profile.male.weight_lb)} lb</dd>
      <dt>${profile.female_label}</dt>
      <dd>${formatRange(profile.female.shoulder_height_in)} in shoulder height, ${formatRange(profile.female.weight_lb)} lb</dd>
      <dt>Vitals</dt>
      <dd>~${profile.vitals.width_in}in x ${profile.vitals.height_in}in behind the shoulder</dd>
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

function formatRange([min, max]) {
  return `${min}-${max}`;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}
