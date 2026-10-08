// Tests for crates/ballistics-api/static/motion.js: how far to lead a
// moving animal.
//
//   node --test crates/ballistics-api/tests/page/motion.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const motion = require(path.join(here, "../../static/motion.js"));
const units = require(path.join(here, "../../static/units.js"));

const close = (a, b, tol = 1e-9, msg = "") =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} is not within ${tol} of ${b}`);

test("one mph is 17.6 inches a second", () => {
  // 1760 yd × 36 in / 3600 s.
  close(motion.INCHES_PER_SECOND_PER_MPH, (1760 * 36) / 3600);
  close(motion.leadInches(1, 1, 1), 17.6);
  close(motion.leadInches(10, 1, 0.5), 88);
});

test("the lead agrees with the same sum done in metric", () => {
  // 36 km/h is 10 m/s; over 0.2 s of flight that is 2 m.
  const mph = units.toCanonical("animalSpeed", 36, { system: "metric", angle: "moa" });
  const inches = motion.leadInches(mph, 1, 0.2);
  close(units.toDisplay("length", inches, { system: "metric", angle: "moa" }), 200, 1e-9, "cm");
});

test("a recognisable case: a stag running at 25 mph, 0.13 s of flight", () => {
  // 25 × 17.6 × 0.13 = 57.2 in, about 1.45 m - more than a body length.
  close(motion.leadInches(25, 1, 0.13), 57.2);
});

test("crossing takes all of the speed, quartering about 0.71", () => {
  assert.equal(motion.acrossFactor("crossing"), 1);
  close(motion.acrossFactor("quartering"), Math.SQRT1_2, 1e-15);
  assert.throws(() => motion.acrossFactor("head-on"));
});

test("the lead grows with speed, the share across, and the time of flight", () => {
  const base = motion.leadInches(20, 1, 0.2);
  assert.ok(motion.leadInches(25, 1, 0.2) > base);
  assert.ok(motion.leadInches(20, 1, 0.3) > base);
  assert.ok(motion.leadInches(20, motion.acrossFactor("quartering"), 0.2) < base);
  assert.equal(motion.leadInches(0, 1, 0.2), 0);
});

test("gaits are bands, in order, each nominal in its middle", () => {
  let previous = 0;
  for (const g of motion.GAITS) {
    assert.ok(g.lo > previous && g.hi > g.lo, g.key);
    previous = g.hi;
    const band = motion.speedBand({ gait: g.key });
    assert.deepEqual(band, { lo: g.lo, hi: g.hi, nominal: (g.lo + g.hi) / 2 });
  }
  assert.deepEqual(
    motion.GAITS.map((g) => g.key),
    ["walk", "trot", "run"]
  );
});

test("an exact speed, with or without doubt", () => {
  assert.deepEqual(motion.speedBand({ gait: "exact", speed: 20, slop: 0 }), { lo: 20, hi: 20, nominal: 20 });
  assert.deepEqual(motion.speedBand({ gait: "exact", speed: 20, slop: 5 }), { lo: 15, hi: 25, nominal: 20 });
  // A band never goes below standing still.
  assert.deepEqual(motion.speedBand({ gait: "exact", speed: 3, slop: 5 }), { lo: 0, hi: 8, nominal: 3 });
  // Unsure whether it is moving at all is still a band.
  assert.deepEqual(motion.speedBand({ gait: "exact", speed: 0, slop: 4 }), { lo: 0, hi: 4, nominal: 0 });
});

test("standing still is no motion at all", () => {
  assert.equal(motion.speedBand({ gait: "" }), null);
  assert.equal(motion.speedBand({ gait: undefined }), null);
  assert.equal(motion.speedBand({ gait: "exact", speed: 0, slop: 0 }), null);
  assert.equal(motion.speedBand({ gait: "exact", speed: -5, slop: 0 }), null);
  assert.throws(() => motion.speedBand({ gait: "gallop" }));
});
