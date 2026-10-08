// The range target: concentric rings, for practice rather than game.
//
// Drawn rather than shipped as artwork, because a target is nothing but
// its dimensions: a 4 in ring has to be 4 in, exactly, at every range, and
// the animal artwork's sizes come from measuring pixels. Here they come
// from these numbers.
//
// A real target is made in one system or the other, so there are two: an
// imperial one in whole inches and a metric one in whole centimetres. They
// are not conversions of each other - the metric hit ring is 10 cm, not
// 4 in written as 10.16 cm - and switching the page's units swaps the
// target the way a shooter would swap the paper. The hit ring is the one
// about the size of a deer's heart and lungs, so a group that holds it on
// paper is a group that would hold it on game.
//
// Every figure leaves this file in inches, the unit the rest of the page
// computes in.
//
// A classic script, like the rest of the page, read as the global
// `ballisticsTarget`; Node loads it with `require` for the tests.

(function (root) {
  "use strict";

  // The inch is 2.54 cm by definition.
  const CM_PER_INCH = 2.54;

  /// Each target as made: the spacing between rings (each ring's diameter
  /// is a whole multiple of it), how many rings, and which ring is the hit,
  /// counted from the middle.
  const TARGETS = {
    imperial: { unit: "in", step: 2, rings: 5, hitRing: 2, toInches: 1 },
    metric: { unit: "cm", step: 5, rings: 5, hitRing: 2, toInches: 1 / CM_PER_INCH },
  };

  /// The target for a unit system ("imperial" or "metric"), with every
  /// dimension in inches plus the figures as printed on it, for labels.
  function rangeTarget(system) {
    const spec = TARGETS[system];
    if (!spec) throw new Error(`unknown unit system: ${system}`);
    const printed = Array.from({ length: spec.rings }, (_, i) => spec.step * (i + 1));
    const ringDiametersIn = printed.map((d) => d * spec.toInches);
    return {
      system,
      unit: spec.unit,
      step: spec.step,
      printedDiameters: printed,
      printedDiameter: printed[printed.length - 1],
      printedHitDiameter: printed[spec.hitRing - 1],
      ringDiametersIn,
      diameterIn: ringDiametersIn[ringDiametersIn.length - 1],
      hitDiameterIn: ringDiametersIn[spec.hitRing - 1],
    };
  }

  const api = { rangeTarget, TARGETS, CM_PER_INCH };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.ballisticsTarget = api;
})(typeof window !== "undefined" ? window : globalThis);
