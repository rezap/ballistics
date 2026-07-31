const form = document.getElementById("trajectory-form");
const resultsSection = document.getElementById("results");
const errorBox = document.getElementById("error");
const tableBody = document.querySelector("#results-table tbody");
const canvas = document.getElementById("chart");
const speciesSelect = document.getElementById("species-select");
const shotRangeInput = document.getElementById("shot-range");
const vitalsCanvas = document.getElementById("vitals-canvas");
const animalInfo = document.getElementById("animal-info");

let animalsList = [];
let lastPoints = null;

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
    .map((a) => `<option value="${a.species}">${a.common_name}</option>`)
    .join("");
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
  if (lastPoints) {
    renderAnimalPanel(lastPoints);
  }
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

function renderAnimalPanel(points) {
  const profile = animalsList.find((a) => a.species === speciesSelect.value);
  if (!profile) {
    animalInfo.innerHTML = "";
    vitalsCanvas.getContext("2d").clearRect(0, 0, vitalsCanvas.width, vitalsCanvas.height);
    return;
  }

  const requestedRange = Number(shotRangeInput.value);
  const point = nearestPoint(points, requestedRange);

  const hit = renderVitalsOverlay(profile, point.path_inches, point.windage_in);
  renderAnimalInfo(profile, hit, point);
}

function renderVitalsOverlay(profile, verticalMissIn, horizontalMissIn) {
  const ctx = vitalsCanvas.getContext("2d");
  const size = vitalsCanvas.width;
  ctx.clearRect(0, 0, size, size);

  const silhouette = SILHOUETTES[profile.species];
  const vitals = profile.vitals;

  // Profile-unit space is fixed per silhouette; scale it to fill the
  // canvas, anchoring the ground line near the bottom with a margin.
  const margin = 36;
  const scale = (size - margin * 2) / 100;
  const groundY = size - margin;
  const originX = margin * 0.6;
  const toPx = (x, y) => [originX + x * scale, groundY - y * scale];

  // Converts a real-inch distance into the same profile-unit space the
  // silhouette was authored in, so the vitals ellipse and impact marker
  // are drawn to scale against this specific body's length.
  const unitsPerInch = silhouette.spanUnits / profile.body_length_in;

  const style = getComputedStyle(document.documentElement);
  const textColor = style.getPropertyValue("--muted").trim();

  // Body silhouette.
  ctx.fillStyle = "#9aa0aa77";
  ctx.strokeStyle = "#9aa0aa77";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";

  for (const leg of silhouette.legs) {
    fillPolyPx(ctx, toPx, leg);
  }
  if (silhouette.torso) {
    const { cx, cy, rx, ry } = silhouette.torso;
    const [px, py] = toPx(cx, cy);
    ctx.beginPath();
    ctx.ellipse(px, py, rx * scale, ry * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const shape of silhouette.fills) {
    fillPolyPx(ctx, toPx, shape);
  }
  ctx.lineWidth = 1.6;
  for (const line of silhouette.strokes) {
    strokePolyPx(ctx, toPx, line);
  }

  // Point of aim (assumed held on the vitals' center) and vitals ellipse,
  // in the same profile-unit space as the body.
  const [vitalsCenterX, vitalsCenterY] = silhouette.vitalsCenter;
  const [aimPx, aimPy] = toPx(vitalsCenterX, vitalsCenterY);
  const halfWidthUnits = (vitals.width_in / 2) * unitsPerInch;
  const halfHeightUnits = (vitals.height_in / 2) * unitsPerInch;

  ctx.beginPath();
  ctx.ellipse(aimPx, aimPy, halfWidthUnits * scale, halfHeightUnits * scale, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#16a34a33";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(aimPx, aimPy, 2, 0, Math.PI * 2);
  ctx.fillStyle = textColor;
  ctx.fill();

  // Impact point: verticalMissIn is positive above the line of sight,
  // matching this profile space's y-up convention, so it adds directly;
  // horizontalMissIn is positive toward the shooter's right, matching x
  // growing toward the animal's front (as drawn, facing right).
  const impactX = vitalsCenterX + horizontalMissIn * unitsPerInch;
  const impactY = vitalsCenterY + verticalMissIn * unitsPerInch;
  const [impactPx, impactPy] = toPx(impactX, impactY);

  const distance = Math.sqrt(
    (horizontalMissIn / (vitals.width_in / 2)) ** 2 + (verticalMissIn / (vitals.height_in / 2)) ** 2
  );
  const isVitalsHit = distance <= 1;

  ctx.beginPath();
  ctx.arc(impactPx, impactPy, 6, 0, Math.PI * 2);
  ctx.fillStyle = isVitalsHit ? "#16a34a" : "#dc2626";
  ctx.fill();
  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 1;
  ctx.stroke();

  return { isVitalsHit, distance };
}

function fillPolyPx(ctx, toPx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const [px, py] = toPx(x, y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
}

function strokePolyPx(ctx, toPx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const [px, py] = toPx(x, y);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
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
