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

  const hit = renderVitalsOverlay(profile.vitals, point.path_inches, point.windage_in);
  renderAnimalInfo(profile, hit, point);
}

function renderVitalsOverlay(vitals, verticalMissIn, horizontalMissIn) {
  const ctx = vitalsCanvas.getContext("2d");
  const size = vitalsCanvas.width;
  ctx.clearRect(0, 0, size, size);

  const halfWidth = vitals.width_in / 2;
  const halfHeight = vitals.height_in / 2;
  const maxExtentIn =
    Math.max(halfWidth, halfHeight, Math.abs(horizontalMissIn), Math.abs(verticalMissIn)) * 1.3;
  const scale = (size / 2 - 20) / maxExtentIn;
  const cx = size / 2;
  const cy = size / 2;

  const style = getComputedStyle(document.documentElement);
  const gridColor = style.getPropertyValue("--grid").trim();
  const textColor = style.getPropertyValue("--muted").trim();

  // Crosshair at point of aim (assumed held on the vitals' center).
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, cy);
  ctx.lineTo(size - 10, cy);
  ctx.moveTo(cx, 10);
  ctx.lineTo(cx, size - 10);
  ctx.stroke();

  // Vital zone ellipse.
  ctx.beginPath();
  ctx.ellipse(cx, cy, halfWidth * scale, halfHeight * scale, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#16a34a22";
  ctx.fill();

  // Impact point. Canvas y grows downward; path_inches is positive above
  // the line of sight, so it's inverted here. windage_in is positive
  // toward the shooter's right, matching canvas x growing rightward.
  const markerX = cx + horizontalMissIn * scale;
  const markerY = cy - verticalMissIn * scale;
  const distance = Math.sqrt(
    (horizontalMissIn / halfWidth) ** 2 + (verticalMissIn / halfHeight) ** 2
  );
  const isVitalsHit = distance <= 1;

  ctx.beginPath();
  ctx.arc(markerX, markerY, 6, 0, Math.PI * 2);
  ctx.fillStyle = isVitalsHit ? "#16a34a" : "#dc2626";
  ctx.fill();
  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.font = "11px sans-serif";
  ctx.fillText("point of aim", cx + 8, cy - 8);

  return { isVitalsHit, distance };
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
