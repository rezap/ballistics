// Tests for crates/ballistics-api/static/units.js.
//
//   node --test crates/ballistics-api/tests/page/units.test.mjs
//
// A wrong factor here would put every metric figure on the page out by the
// same proportion, quietly, so the factors are checked against published
// reference values rather than against themselves - and against each other
// where two definitions have to agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const units = require(path.join(here, "../../static/units.js"));
const { toDisplay, toCanonical, unitLabel, inputDecimals, trimmed, FACTORS: F } = units;

const METRIC = { system: "metric", angle: "moa" };
const IMPERIAL = { system: "imperial", angle: "moa" };
const MRAD = { system: "metric", angle: "mrad" };

/// Equal to within `rel` of the larger magnitude, or `abs` near zero.
function close(actual, expected, { rel = 1e-12, abs = 1e-12 } = {}, message = "") {
  const bound = Math.max(abs, rel * Math.max(Math.abs(actual), Math.abs(expected)));
  assert.ok(
    Math.abs(actual - expected) <= bound,
    `${message} ${actual} is not within ${bound} of ${expected}`
  );
}

// --- The factors, against the definitions and published values. ---------

test("lengths are the 1959 international definitions", () => {
  assert.equal(F.METRES_PER_YARD, 0.9144);
  assert.equal(F.METRES_PER_FOOT, 0.3048);
  assert.equal(F.CM_PER_INCH, 2.54);
  // The three have to agree: 3 ft to the yard, 12 in to the foot.
  close(F.METRES_PER_FOOT * 3, F.METRES_PER_YARD);
  close((F.CM_PER_INCH * 12) / 100, F.METRES_PER_FOOT);
  // 1760 yd to the mile, and the mile is 1609.344 m.
  close(1760 * F.METRES_PER_YARD, 1609.344);
});

test("the mile per hour is exactly 0.44704 m/s", () => {
  assert.equal(F.MPS_PER_MPH, 0.44704);
});

test("the pound, and the grain the bullets are weighed in", () => {
  assert.equal(F.KG_PER_POUND, 0.45359237);
  // 7000 grains to the pound; a grain is 64.79891 mg.
  close((F.KG_PER_POUND / 7000) * 1e6, 64.79891);
});

test("the foot-pound is the exact product of its definitions", () => {
  // ft × lb × standard gravity, to the last bit (the product in floating
  // point lands one bit high, hence the constant is written out).
  close(F.JOULES_PER_FOOT_POUND, 0.3048 * 0.45359237 * F.STANDARD_GRAVITY, { rel: 2.3e-16 });
  // NIST SP 811: 1 ft·lbf = 1.355 818 J.
  close(F.JOULES_PER_FOOT_POUND, 1.355818, { rel: 5e-7 });
});

test("the inch of mercury, and the standard atmosphere", () => {
  // NIST SP 811: 1 inHg (conventional) = 3.386 389 kPa.
  assert.equal(F.HPA_PER_INHG, 33.86389);
  // 1013.25 hPa is 29.921 inHg.
  close(toCanonical("pressure", 1013.25, METRIC), 29.9213, { rel: 2e-6 });
  // The solver's default of 29.53 inHg is almost exactly 1000 hPa.
  close(toDisplay("pressure", 29.53, METRIC), 1000.0, { rel: 1e-4 });
});

test("temperature is affine, not a ratio", () => {
  const cases = [
    [32, 0],
    [212, 100],
    [-40, -40],
    [59, 15],
    [98.6, 37],
    [0, -160 / 9],
  ];
  for (const [f, c] of cases) {
    close(toDisplay("temperature", f, METRIC), c, { abs: 1e-12 }, `${f}°F`);
    close(toCanonical("temperature", c, METRIC), f, { abs: 1e-12 }, `${c}°C`);
  }
});

test("MOA and mrad", () => {
  // 1 MOA is 1/60 degree; 1 mrad is 1/1000 rad.
  close(F.MRAD_PER_MOA, ((1 / 60) * (Math.PI / 180)) * 1000);
  // The solver's own figures: rad_to_moa(1.0) = 3437.7467707849396, and its
  // moa_to_mil uses 0.29088821.
  close(1000 / F.MRAD_PER_MOA, 3437.7467707849396);
  close(F.MRAD_PER_MOA, 0.29088821, { rel: 1e-8 });
  close(toDisplay("angle", 1, MRAD), 0.2908882086657216);
  close(toCanonical("angle", 1, MRAD), 3.4377467707849396);
});

test("what an angle covers on the target", () => {
  // One MOA is 1.047 in at 100 yd - the "inch at a hundred" shorthand.
  close(units.moaToInches(1, 100), 1.0471975511965976);
  // One mrad is 3.6 in at 100 yd, and 10 cm at 100 m.
  close(units.moaToInches(toCanonical("angle", 1, MRAD), 100), 3.6);
  const yardsIn100m = toCanonical("distance", 100, METRIC);
  const cm = toDisplay("length", units.moaToInches(toCanonical("angle", 1, MRAD), yardsIn100m), METRIC);
  close(cm, 10);
  // The inverse is the inverse.
  for (const [inches, yards] of [
    [1, 100],
    [7.3, 250],
    [-12, 437],
  ]) {
    close(units.moaToInches(units.inchesToMoa(inches, yards), yards), inches);
  }
});

// --- Everyday values a hunter would recognise. --------------------------

test("recognisable figures", () => {
  // A 100 m zero is 109.36 yd.
  close(toCanonical("distance", 100, METRIC), 109.36132983377078);
  // 2600 ft/s is 792.48 m/s.
  close(toDisplay("velocity", 2600, METRIC), 792.48);
  // 10 mph is 4.47 m/s.
  close(toDisplay("windSpeed", 10, METRIC), 4.4704);
  // 1500 ft·lb is 2034 J.
  close(toDisplay("energy", 1500, METRIC), 2033.7269224971006);
  // Swedish class 1: 2700 J is 1991 ft·lb.
  close(toCanonical("energy", 2700, METRIC), 2700 / 1.355818, { rel: 5e-7 });
  close(toCanonical("energy", 2700, METRIC), 1991.42, { rel: 5e-6 });
  // A 12 in vital zone is 30.48 cm.
  close(toDisplay("length", 12, METRIC), 30.48);
  // 1000 ft of altitude is 304.8 m.
  close(toDisplay("altitude", 1000, METRIC), 304.8);
  // A 500 lb stag is 227 kg.
  close(toDisplay("mass", 500, METRIC), 226.796185);
});

// --- The behaviour the page relies on. ---------------------------------

const SAMPLES = [0, 1, -1, 0.001, 2.5, 100, 109.36132983377078, 2650.25, 1e6, -273.15];

test("imperial shows the value itself, not a round trip through a factor", () => {
  // The imperial page has to read exactly as it did before metric existed,
  // so no arithmetic at all may happen in the canonical units.
  for (const name of units.QUANTITY_NAMES) {
    for (const v of SAMPLES) {
      assert.ok(Object.is(toDisplay(name, v, IMPERIAL), v), `${name} ${v}`);
      assert.ok(Object.is(toCanonical(name, v, IMPERIAL), v), `${name} ${v}`);
    }
  }
});

test("metric round-trips to the value it started from", () => {
  for (const name of units.QUANTITY_NAMES) {
    for (const v of SAMPLES) {
      for (const u of [METRIC, MRAD]) {
        close(toCanonical(name, toDisplay(name, v, u), u), v, { rel: 1e-14, abs: 1e-12 }, `${name} ${v}`);
      }
    }
  }
});

test("every quantity converts in the right direction", () => {
  // A metric figure is bigger or smaller than the imperial one by a known
  // ratio; a factor applied upside down would pass a round trip, so this
  // pins which way each one goes.
  const bigger = ["length", "energy"]; // cm > in, J > ft·lb
  const smaller = ["distance", "velocity", "windSpeed", "altitude", "mass"]; // m < yd, ...
  for (const name of bigger) assert.ok(toDisplay(name, 10, METRIC) > 10, name);
  for (const name of smaller) assert.ok(toDisplay(name, 10, METRIC) < 10, name);
  assert.ok(toDisplay("pressure", 10, METRIC) > 10, "hPa > inHg");
  assert.ok(toDisplay("angle", 10, MRAD) < 10, "mrad > MOA, so fewer of them");
});

test("the angle unit is independent of the system", () => {
  // A metric user with an MOA scope, and an imperial user with a mil scope.
  assert.equal(toDisplay("angle", 3, { system: "metric", angle: "moa" }), 3);
  close(toDisplay("angle", 3, { system: "imperial", angle: "mrad" }), 3 * F.MRAD_PER_MOA);
  // And the system does not care about the angle.
  assert.equal(
    toDisplay("distance", 100, { system: "metric", angle: "moa" }),
    toDisplay("distance", 100, { system: "metric", angle: "mrad" })
  );
});

test("labels", () => {
  const expected = {
    distance: ["yd", "m"],
    length: ["in", "cm"],
    velocity: ["ft/s", "m/s"],
    windSpeed: ["mph", "m/s"],
    altitude: ["ft", "m"],
    pressure: ["inHg", "hPa"],
    temperature: ["°F", "°C"],
    energy: ["ft·lb", "J"],
    mass: ["lb", "kg"],
  };
  for (const [name, [imperial, metric]] of Object.entries(expected)) {
    assert.equal(unitLabel(name, IMPERIAL), imperial);
    assert.equal(unitLabel(name, METRIC), metric);
  }
  assert.equal(unitLabel("angle", IMPERIAL), "MOA");
  assert.equal(unitLabel("angle", MRAD), "mrad");
  // Every quantity has a label and decimals in both systems.
  for (const name of units.QUANTITY_NAMES) {
    for (const u of [IMPERIAL, METRIC, MRAD]) {
      assert.ok(unitLabel(name, u), `${name} label`);
      assert.ok(Number.isInteger(inputDecimals(name, u)), `${name} decimals`);
    }
  }
});

test("anything unknown is an error, not a silent pass-through", () => {
  assert.throws(() => toDisplay("furlongs", 1, METRIC));
  assert.throws(() => toDisplay("distance", 1, { system: "nautical", angle: "moa" }));
  assert.throws(() => toDisplay("angle", 1, { system: "metric", angle: "degrees" }));
  assert.throws(() => toCanonical("distance", 1, { system: "Metric", angle: "moa" }));
});

test("trimmed", () => {
  assert.equal(trimmed(4.4704, 2), "4.47");
  assert.equal(trimmed(100, 1), "100");
  assert.equal(trimmed(91.44, 1), "91.4");
  assert.equal(trimmed(2600, 1), "2600");
  assert.equal(trimmed(-0.04, 1), "0");
  assert.equal(trimmed(0.5, 0), "1");
  assert.equal(trimmed(15.000000000000002, 1), "15");
  assert.equal(trimmed(NaN, 1), "");
});

test("the first-visit default follows the browser", () => {
  assert.equal(units.defaultSystem(["en-US", "sv-SE"]), "imperial");
  assert.equal(units.defaultSystem(["sv-SE", "en-US"]), "metric");
  assert.equal(units.defaultSystem("nb-NO"), "metric");
  assert.equal(units.defaultSystem("en-GB"), "metric");
  assert.equal(units.defaultSystem("es-US"), "imperial");
  assert.equal(units.defaultSystem("en"), "imperial");
  assert.equal(units.defaultSystem([]), "imperial");
  assert.equal(units.defaultSystem(undefined), "imperial");
  assert.equal(units.defaultAngle(["de-DE"]), "mrad");
  assert.equal(units.defaultAngle(["en-US"]), "moa");
});
