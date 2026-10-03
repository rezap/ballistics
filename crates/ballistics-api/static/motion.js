// A moving animal: how fast it might be going, and how far ahead to hold.
//
// The lead is how far the animal travels across the line of fire while the
// bullet is in the air - its speed across, times the time of flight. The
// solver already gives the time of flight at every yard, so this file needs
// nothing else, and works in the same units as the rest of the page: mph
// for speed, inches for distance on the animal.
//
// Speed is a guess, the way wind is, so it is a band rather than a number;
// the page folds the band into the verdict exactly as it does the wind.
//
// A classic script, like the rest of the page, read as the global
// `ballisticsMotion`; Node loads it with `require` for the tests.

(function (root) {
  "use strict";

  // 1 mph is 1760 × 36 inches in 3600 seconds: exactly 17.6 in/s.
  const INCHES_PER_SECOND_PER_MPH = 17.6;

  /// What a hunter can actually judge on a moving animal, as speed bands in
  /// mph. Rough and generic - deer, boar and fox all walk, trot and run at
  /// broadly these speeds - and deliberately wide, because the width is the
  /// honest part. An exact figure can be entered instead.
  const GAITS = [
    { key: "walk", label: "Walking", lo: 2, hi: 4 },
    { key: "trot", label: "Trotting", lo: 6, hi: 12 },
    { key: "run", label: "Running", lo: 15, hi: 28 },
  ];

  /// Crossing straight across, or angling at about 45 degrees - all that
  /// can really be told apart on a running animal.
  const ANGLES = { crossing: 90, quartering: 45 };

  /// The share of the animal's speed that is across the line of fire. A
  /// crossing animal is all of it; a quartering one about 0.71.
  function acrossFactor(angle) {
    const degrees = ANGLES[angle];
    if (degrees == null) throw new Error(`unknown angle: ${angle}`);
    return degrees === 90 ? 1 : Math.sin((degrees * Math.PI) / 180);
  }

  /// The speeds the animal might be doing, in mph, or null when it is
  /// standing still.
  ///
  /// `gait` is a key from GAITS, "exact" (with `speed` and `slop`), or
  /// empty for standing. The nominal speed - the one the hold is worked out
  /// for - is the middle of a gait's band, or the exact figure.
  function speedBand({ gait, speed = 0, slop = 0 }) {
    if (!gait) return null;
    if (gait === "exact") {
      const nominal = Math.max(0, Number(speed) || 0);
      const spread = Math.max(0, Number(slop) || 0);
      if (!(nominal + spread > 0)) return null;
      return { lo: Math.max(0, nominal - spread), hi: nominal + spread, nominal };
    }
    const g = GAITS.find((candidate) => candidate.key === gait);
    if (!g) throw new Error(`unknown gait: ${gait}`);
    return { lo: g.lo, hi: g.hi, nominal: (g.lo + g.hi) / 2 };
  }

  /// How far, in inches, an animal doing `speedMph` with `across` of it
  /// across the line of fire moves in `seconds` of bullet flight.
  function leadInches(speedMph, across, seconds) {
    return speedMph * INCHES_PER_SECOND_PER_MPH * across * seconds;
  }

  const api = { GAITS, ANGLES, acrossFactor, speedBand, leadInches, INCHES_PER_SECOND_PER_MPH };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.ballisticsMotion = api;
})(typeof window !== "undefined" ? window : globalThis);
