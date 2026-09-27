// Units: every conversion the page does, and nothing else.
//
// The solver works in yards, inches, ft/s, mph, inHg, °F and ft·lb, and
// so does everything the page holds internally. Metric is a view: numbers
// are converted here on the way into the form and on the way out to the
// screen, never in between, so there is one place a factor can be wrong
// and one set of tests that checks it.
//
// Every factor is the legal definition, not a rounded figure:
//
//   yard       0.9144 m exactly             (international yard, 1959)
//   pound      0.45359237 kg exactly        (international pound, 1959)
//   gravity    9.80665 m/s² exactly         (defines the pound-force)
//   mile       1609.344 m exactly
//   inHg       3386.389 Pa                  (conventional, NIST SP 811)
//   MOA        1/60 degree                  (true MOA, as the solver uses)
//   mrad       1/1000 radian
//
// Angles are a separate choice from metric and imperial: it depends on the
// scope's turrets, not on how someone thinks about distance.
//
// A classic script, like the rest of the page, read as the global
// `ballisticsUnits`; Node loads it with `require` for the tests.

(function (root) {
  "use strict";

  const METRES_PER_YARD = 0.9144;
  const METRES_PER_FOOT = 0.3048;
  const CM_PER_INCH = 2.54;
  const KG_PER_POUND = 0.45359237;
  // 0.3048 m × 0.45359237 kg × 9.80665 m/s², which is exactly
  // 1.3558179483314004 J. Written out because multiplying the three in
  // floating point lands one bit off; the tests check it against the product.
  const JOULES_PER_FOOT_POUND = 1.3558179483314004;
  const MPS_PER_MPH = 1609.344 / 3600;
  const HPA_PER_INHG = 33.86389;
  const MRAD_PER_MOA = (Math.PI / 10800) * 1000;

  const scale = (factor) => ({ toMetric: (v) => v * factor, fromMetric: (v) => v / factor });

  /// Every quantity the page shows, with its unit in each system and how
  /// many decimals a converted value gets when it is written into an input.
  /// The canonical (imperial) value is always kept alongside, so those
  /// decimals only affect what is shown, never what is solved.
  const QUANTITIES = {
    // Ranges: zero, shot, the range band, the table.
    distance: { imperial: "yd", metric: "m", decimals: { imperial: 2, metric: 1 }, ...scale(METRES_PER_YARD) },
    // Drop, drift, sight height, the vital zone, the group on the animal.
    length: { imperial: "in", metric: "cm", decimals: { imperial: 3, metric: 1 }, ...scale(CM_PER_INCH) },
    velocity: { imperial: "ft/s", metric: "m/s", decimals: { imperial: 1, metric: 1 }, ...scale(METRES_PER_FOOT) },
    windSpeed: { imperial: "mph", metric: "m/s", decimals: { imperial: 1, metric: 1 }, ...scale(MPS_PER_MPH) },
    altitude: { imperial: "ft", metric: "m", decimals: { imperial: 0, metric: 0 }, ...scale(METRES_PER_FOOT) },
    pressure: { imperial: "inHg", metric: "hPa", decimals: { imperial: 2, metric: 1 }, ...scale(HPA_PER_INHG) },
    temperature: {
      imperial: "°F",
      metric: "°C",
      decimals: { imperial: 1, metric: 1 },
      toMetric: (f) => ((f - 32) * 5) / 9,
      fromMetric: (c) => (c * 9) / 5 + 32,
    },
    energy: { imperial: "ft·lb", metric: "J", decimals: { imperial: 0, metric: 0 }, ...scale(JOULES_PER_FOOT_POUND) },
    mass: { imperial: "lb", metric: "kg", decimals: { imperial: 0, metric: 0 }, ...scale(KG_PER_POUND) },
  };

  /// Angles follow their own switch. Canonical is MOA.
  const ANGLE = {
    moa: { label: "MOA", decimals: 2, toUnit: (moa) => moa, fromUnit: (v) => v },
    mrad: { label: "mrad", decimals: 2, toUnit: (moa) => moa * MRAD_PER_MOA, fromUnit: (v) => v / MRAD_PER_MOA },
  };

  const SYSTEMS = ["imperial", "metric"];
  const ANGLE_UNITS = Object.keys(ANGLE);

  function quantity(name) {
    const q = QUANTITIES[name];
    if (!q && name !== "angle") throw new Error(`unknown quantity: ${name}`);
    return q;
  }

  function angleUnit(units) {
    const a = ANGLE[units.angle];
    if (!a) throw new Error(`unknown angle unit: ${units.angle}`);
    return a;
  }

  function checkSystem(units) {
    if (!SYSTEMS.includes(units.system)) throw new Error(`unknown unit system: ${units.system}`);
  }

  /// Canonical (imperial, MOA) to what is shown. In the canonical units
  /// this returns the value itself, untouched - not a round trip through a
  /// factor of one - so an imperial page shows exactly what it always has.
  function toDisplay(name, value, units) {
    if (name === "angle") return angleUnit(units).toUnit(value);
    const q = quantity(name);
    checkSystem(units);
    return units.system === "metric" ? q.toMetric(value) : value;
  }

  /// What was typed, back to canonical.
  function toCanonical(name, value, units) {
    if (name === "angle") return angleUnit(units).fromUnit(value);
    const q = quantity(name);
    checkSystem(units);
    return units.system === "metric" ? q.fromMetric(value) : value;
  }

  function unitLabel(name, units) {
    if (name === "angle") return angleUnit(units).label;
    checkSystem(units);
    return quantity(name)[units.system];
  }

  function inputDecimals(name, units) {
    if (name === "angle") return angleUnit(units).decimals;
    checkSystem(units);
    return quantity(name).decimals[units.system];
  }

  /// A number to at most `decimals` places, without trailing zeros, and
  /// never "-0".
  function trimmed(value, decimals) {
    if (!Number.isFinite(value)) return "";
    const fixed = value.toFixed(decimals);
    const clean = decimals > 0 ? fixed.replace(/\.?0+$/, "") : fixed;
    return clean === "-0" ? "0" : clean;
  }

  // ---------------------------------------------------------------------
  // Angles on the target.
  //
  // Small-angle, as the solver's own MOA-to-inches conversion is: an angle
  // subtends range × angle. The difference from the exact tangent is under
  // one part in ten million at a hunting angle of a few MOA.
  // ---------------------------------------------------------------------

  const INCHES_PER_YARD = 36;
  const RADIANS_PER_MOA = Math.PI / 10800;

  /// Inches subtended by `moa` at `yards`. One MOA is 1.0472 in at 100 yd.
  function moaToInches(moa, yards) {
    return moa * RADIANS_PER_MOA * yards * INCHES_PER_YARD;
  }

  /// The angle, in MOA, that `inches` subtends at `yards`.
  function inchesToMoa(inches, yards) {
    return inches / (RADIANS_PER_MOA * yards * INCHES_PER_YARD);
  }

  // ---------------------------------------------------------------------
  // Which system a first-time visitor sees.
  // ---------------------------------------------------------------------

  /// Imperial for a US browser, metric for everyone else. Read from the
  /// first preferred language only: that is the one the browser is set up
  /// for. A bare "en" carries no country, and is treated as US because
  /// that is what browsers report when nothing more specific was set.
  function defaultSystem(languages) {
    const first = String((Array.isArray(languages) ? languages[0] : languages) ?? "").trim();
    if (!first) return "imperial";
    if (/^en$/i.test(first)) return "imperial";
    return /-US$/i.test(first) ? "imperial" : "metric";
  }

  /// MOA where imperial is the default, mrad elsewhere - most scopes sold
  /// outside the US have mrad turrets. Only a starting point: the choice
  /// is the user's and is remembered.
  function defaultAngle(languages) {
    return defaultSystem(languages) === "imperial" ? "moa" : "mrad";
  }

  const api = {
    toDisplay,
    toCanonical,
    unitLabel,
    inputDecimals,
    trimmed,
    moaToInches,
    inchesToMoa,
    defaultSystem,
    defaultAngle,
    SYSTEMS,
    ANGLE_UNITS,
    QUANTITY_NAMES: [...Object.keys(QUANTITIES), "angle"],
    // Exposed for the tests, which check them against published values.
    FACTORS: {
      METRES_PER_YARD,
      METRES_PER_FOOT,
      CM_PER_INCH,
      KG_PER_POUND,
      JOULES_PER_FOOT_POUND,
      MPS_PER_MPH,
      HPA_PER_INHG,
      MRAD_PER_MOA,
      STANDARD_GRAVITY: 9.80665,
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.ballisticsUnits = api;
})(typeof window !== "undefined" ? window : globalThis);
