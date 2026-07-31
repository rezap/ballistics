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

let animalsList = [];
let lastPoints = null;

const UNIT_TO_INCHES = { in: 1, cm: 1 / 2.54, m: 39.3701 };
const imageCache = new Map();

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
}

function currentProfile() {
  return animalsList.find((a) => a.key === speciesSelect.value) ?? null;
}

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

  saveOverride(profile, {
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

function buildRequestPayload(formData) {
  const num = (name) => Number(formData.get(name));

  return {
    load: {
      drag_function: formData.get("drag_function"),
      ballistic_coefficient: num("ballistic_coefficient"),
      muzzle_velocity: num("muzzle_velocity"),
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

function renderTable(points) {
  tableBody.innerHTML = "";

  const step = 25;
  const rows = points.filter((p) => p.yards % step === 0);

  for (const point of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${point.yards}</td>
      <td>${point.path_inches.toFixed(2)}</td>
      <td>${point.moa_correction.toFixed(2)}</td>
      <td>${point.impact_in.toFixed(2)}</td>
      <td>${point.seconds.toFixed(3)}</td>
    `;
    tableBody.appendChild(tr);
  }
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

  const hit = renderVitalsOverlay(profile, point.path_inches, point.windage_in, image);
  renderAnimalInfo(profile, hit, point);
}

function renderVitalsOverlay(profile, verticalMissIn, horizontalMissIn, image) {
  const ctx = vitalsCanvas.getContext("2d");
  const width = vitalsCanvas.width;
  const height = vitalsCanvas.height;
  ctx.clearRect(0, 0, width, height);

  const vitals = profile.vitals;
  const inPerPx = inchesPerPixel(profile);

  // Everything is laid out in artwork-pixel space first, then fitted into
  // the canvas as a single transform at the end.
  const artW = profile.image_width_px ?? 400;
  const artH = profile.image_height_px ?? 300;
  const aimX = profile.vitals_anchor.x * artW;
  const aimY = profile.vitals_anchor.y * artH;

  // Impact offset, converted from real inches into artwork pixels.
  // path_inches is positive above the line of sight and canvas y grows
  // downward, hence the negation; windage_in is positive to the shooter's
  // right, matching x growing toward the animal's head (drawn facing right).
  const impactX = aimX + horizontalMissIn / inPerPx;
  const impactY = aimY - verticalMissIn / inPerPx;

  // Fit the artwork *and* the impact marker, so a long-range shot that
  // lands well off the animal stays visible instead of being clipped.
  const pad = 26;
  const minX = Math.min(0, impactX);
  const maxX = Math.max(artW, impactX);
  const minY = Math.min(0, impactY);
  const maxY = Math.max(artH, impactY);
  const fit = Math.min(
    (width - pad * 2) / (maxX - minX),
    (height - pad * 2) / (maxY - minY)
  );
  const offsetX = pad + (width - pad * 2 - (maxX - minX) * fit) / 2 - minX * fit;
  const offsetY = pad + (height - pad * 2 - (maxY - minY) * fit) / 2 - minY * fit;
  const toPx = (x, y) => [offsetX + x * fit, offsetY + y * fit];

  const style = getComputedStyle(document.documentElement);
  const inkColor = style.getPropertyValue("--silhouette").trim() || "#9aa0aa";
  const textColor = style.getPropertyValue("--muted").trim();

  if (image) {
    drawTinted(ctx, image, toPx(0, 0), artW * fit, artH * fit, inkColor);
  }

  // Vital zone, sized from real inches through the same scale.
  const [aimPxX, aimPxY] = toPx(aimX, aimY);
  const halfW = (vitals.width_in / 2 / inPerPx) * fit;
  const halfH = (vitals.height_in / 2 / inPerPx) * fit;

  ctx.beginPath();
  ctx.ellipse(aimPxX, aimPxY, halfW, halfH, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#16a34a33";
  ctx.fill();
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Point of aim.
  ctx.beginPath();
  ctx.moveTo(aimPxX - 7, aimPxY);
  ctx.lineTo(aimPxX + 7, aimPxY);
  ctx.moveTo(aimPxX, aimPxY - 7);
  ctx.lineTo(aimPxX, aimPxY + 7);
  ctx.strokeStyle = textColor;
  ctx.lineWidth = 1;
  ctx.stroke();

  const assessment = assessHit(vitals, verticalMissIn, horizontalMissIn);
  const [impactPxX, impactPxY] = toPx(impactX, impactY);

  // Connect aim to impact when they are far enough apart to read.
  if (Math.hypot(impactPxX - aimPxX, impactPxY - aimPxY) > 14) {
    ctx.beginPath();
    ctx.moveTo(aimPxX, aimPxY);
    ctx.lineTo(impactPxX, impactPxY);
    ctx.strokeStyle = assessment.isVitalsHit ? "#16a34a88" : "#dc262688";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.arc(impactPxX, impactPxY, 6, 0, Math.PI * 2);
  ctx.fillStyle = assessment.isVitalsHit ? "#16a34a" : "#dc2626";
  ctx.fill();
  ctx.strokeStyle = "#ffffffaa";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Scale bar: one foot, so the drawn size is checkable at a glance.
  drawScaleBar(ctx, width, height, fit / inPerPx, textColor);

  return assessment;
}

/// Mirrors ballistics_core::VitalZone::assess on the client so the overlay
/// and the badge cannot disagree.
function assessHit(vitals, verticalMissIn, horizontalMissIn) {
  const distance = Math.hypot(
    horizontalMissIn / (vitals.width_in / 2),
    verticalMissIn / (vitals.height_in / 2)
  );
  return { isVitalsHit: distance <= 1, distance };
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

function renderAnimalInfo(profile, hit, point) {
  const badgeClass = hit.isVitalsHit ? "hit" : "miss";
  const badgeText = hit.isVitalsHit ? "Vitals hit" : "Likely non-lethal - reconsider this shot";

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
