// Tests for crates/ballistics-api/static/target.js: the range target's
// rings, which have to be exactly the size printed on them.
//
//   node --test crates/ballistics-api/tests/page/target.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const target = require(path.join(here, "../../static/target.js"));
const units = require(path.join(here, "../../static/units.js"));

const close = (a, b, tol = 1e-12, msg = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} is not within ${tol} of ${b}`);

test("imperial: 10 in across, rings every 2 in, the 4 in ring is the hit", () => {
  const t = target.rangeTarget("imperial");
  assert.deepEqual(t.ringDiametersIn, [2, 4, 6, 8, 10]);
  assert.equal(t.diameterIn, 10);
  assert.equal(t.hitDiameterIn, 4);
  assert.equal(t.printedHitDiameter, 4);
  assert.equal(t.unit, "in");
});

test("metric: 25 cm across, rings every 5 cm, the 10 cm ring is the hit", () => {
  const t = target.rangeTarget("metric");
  assert.deepEqual(t.printedDiameters, [5, 10, 15, 20, 25]);
  t.ringDiametersIn.forEach((inches, i) => close(inches * 2.54, 5 * (i + 1), 1e-12, `ring ${i + 1}`));
  close(t.diameterIn, 25 / 2.54);
  close(t.hitDiameterIn, 10 / 2.54);
  assert.equal(t.printedDiameter, 25);
  assert.equal(t.printedHitDiameter, 10);
  assert.equal(t.unit, "cm");
});

test("the page's own length conversion reads the metric rings back as whole centimetres", () => {
  // The panel prints ring sizes through units.js; a factor that disagreed
  // with target.js would show 9.9 or 10.1 cm on a 10 cm ring.
  const t = target.rangeTarget("metric");
  for (const [i, inches] of t.ringDiametersIn.entries()) {
    close(units.toDisplay("length", inches, { system: "metric", angle: "moa" }), t.printedDiameters[i], 1e-9);
  }
});

test("the hit ring is about a deer's heart and lungs in both systems", () => {
  // Not the same ring - one is whole inches, the other whole centimetres -
  // but within a few percent of each other.
  const imperial = target.rangeTarget("imperial").hitDiameterIn;
  const metric = target.rangeTarget("metric").hitDiameterIn;
  assert.ok(Math.abs(imperial - metric) / imperial < 0.02, `${imperial} vs ${metric}`);
});

test("rings are concentric, evenly spaced and the hit ring is one of them", () => {
  for (const system of ["imperial", "metric"]) {
    const t = target.rangeTarget(system);
    const gaps = t.ringDiametersIn.slice(1).map((d, i) => d - t.ringDiametersIn[i]);
    gaps.forEach((g) => close(g, t.ringDiametersIn[0], 1e-12, system));
    assert.ok(t.ringDiametersIn.includes(t.hitDiameterIn), system);
  }
});

test("an unknown unit system is an error, not a silent default", () => {
  assert.throws(() => target.rangeTarget("furlongs"), /unknown unit system/);
});
