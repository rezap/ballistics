// Tests for reading a trajectory between solved points: `pointAt` in
// crates/ballistics-api/static/solver.js.
//
//   node --test crates/ballistics-api/tests/page/trajectory.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { pointAt, sample } = require(path.join(here, "../../static/solver.js"));

/// A made-up trajectory with the solver's fields: a parabola for the drop,
/// straight lines for the rest, so the right answer is known exactly.
function trajectory(to = 600) {
  const points = [];
  for (let yards = 0; yards <= to; yards++) {
    points.push({
      yards,
      path_inches: 1.5 - 0.0005 * yards * yards,
      windage_in: 0.02 * yards,
      moa_correction: 0.01 * yards,
      impact_in: 0.0005 * yards * yards,
      velocity_fps: 2600 - 2 * yards,
      energy_ft_lb: 2700 - 3 * yards,
      seconds: yards / 800,
    });
  }
  return points;
}

test("a solved point is returned as it is", () => {
  const points = trajectory();
  for (const yards of [0, 1, 100, 250, 600]) {
    assert.equal(pointAt(points, yards), points[yards]);
  }
  const sampled = sample(points, 10);
  assert.equal(pointAt(sampled, 270), sampled[27]);
});

test("between two points, every field is interpolated", () => {
  const sampled = sample(trajectory(), 10);
  const p = pointAt(sampled, 275);
  assert.equal(p.yards, 275);
  // Straight-line fields are exact.
  assert.equal(p.velocity_fps, 2600 - 2 * 275);
  assert.equal(p.energy_ft_lb, 2700 - 3 * 275);
  assert.ok(Math.abs(p.windage_in - 0.02 * 275) < 1e-12);
  assert.ok(Math.abs(p.seconds - 275 / 800) < 1e-12);
  // The parabola is within the chord's error, h²/8 × curvature.
  const chordError = (10 * 10 / 8) * 2 * 0.0005;
  assert.ok(Math.abs(p.path_inches - (1.5 - 0.0005 * 275 * 275)) <= chordError + 1e-12);
});

test("a tie is no longer settled toward the nearer point", () => {
  // Reading 275 on a ten-yard grid used to take 270 - the point with more
  // energy left. It is now halfway between.
  const sampled = sample(trajectory(), 10);
  const p = pointAt(sampled, 275);
  assert.ok(p.energy_ft_lb < pointAt(sampled, 270).energy_ft_lb);
  assert.ok(p.energy_ft_lb > pointAt(sampled, 280).energy_ft_lb);
});

test("fractional yards, as metric ranges give", () => {
  const points = trajectory();
  const yards = 200 / 0.9144; // 200 m
  const p = pointAt(points, yards);
  assert.equal(p.yards, yards);
  assert.ok(Math.abs(p.velocity_fps - (2600 - 2 * yards)) < 1e-9);
  assert.ok(p.velocity_fps < points[218].velocity_fps && p.velocity_fps > points[219].velocity_fps);
});

test("past either end, the end point", () => {
  const points = trajectory(437);
  assert.equal(pointAt(points, 500), points.at(-1));
  assert.equal(pointAt(points, -5), points[0]);
  assert.equal(pointAt(points, NaN), points[0]);
  // A trajectory that does not start at zero.
  const late = points.slice(10);
  assert.equal(pointAt(late, 3), late[0]);
});

test("a single point", () => {
  const one = [trajectory(0)[0]];
  assert.equal(pointAt(one, 0), one[0]);
  assert.equal(pointAt(one, 50), one[0]);
});
