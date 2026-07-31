// Original, hand-drawn side-profile silhouettes (not traced or copied from
// any photo or third-party artwork) used to visualize where a species'
// vital zone sits and where a shot actually landed.
//
// Coordinate convention ("profile units"): x runs from the tail (low x) to
// the nose (high x, facing right); y runs from the ground (0) upward.
// `spanUnits` is the nose-tip-to-tail-tip distance in that same coordinate
// system, used to convert an AnimalProfile's `body_length_in` into
// profile-units-per-inch, so the vitals ellipse and impact marker (which
// are computed in real inches) are drawn to scale against the body.
const SILHOUETTES = {
  WhitetailDeer: {
    spanUnits: 84,
    vitalsCenter: [48, 38],
    torso: { cx: 42, cy: 38, rx: 24, ry: 11 },
    legs: [
      [[52, 28], [56, 28], [54, 0], [51, 0]],
      [[58, 30], [62, 30], [64, 0], [60, 0]],
      [[20, 26], [24, 26], [22, 0], [19, 0]],
      [[26, 28], [30, 28], [32, 0], [28, 0]],
    ],
    fills: [
      // Neck, head and snout.
      [[58, 42], [62, 50], [68, 54], [74, 56], [80, 55], [86, 52], [92, 47],
       [95, 43], [91, 41], [85, 44], [79, 44], [73, 42], [67, 38], [61, 34]],
      // Ears.
      [[80, 55], [78, 64], [84, 58]],
      [[85, 54], [87, 63], [90, 55]],
      // Tail flick.
      [[20, 42], [13, 50], [23, 46]],
    ],
    strokes: [
      // Small antlers.
      [[81, 58], [79, 68], [75, 72]],
      [[79, 68], [83, 70]],
      [[86, 57], [89, 66], [93, 69]],
      [[89, 66], [93, 64]],
    ],
  },

  WildHog: {
    spanUnits: 88,
    vitalsCenter: [48, 20],
    torso: null, // drawn as a fill polygon below instead of an ellipse.
    legs: [
      [[52, 16], [57, 16], [55, 0], [51, 0]],
      [[58, 17], [63, 17], [65, 0], [60, 0]],
      [[20, 14], [25, 14], [23, 0], [19, 0]],
      [[26, 15], [31, 15], [33, 0], [28, 0]],
    ],
    fills: [
      // Torso: wedge-shaped, taller at the shoulder, tapering to the rump.
      [[15, 20], [16, 28], [22, 34], [32, 37], [45, 38], [55, 37], [62, 32],
       [66, 26], [64, 18], [58, 14], [45, 12], [30, 12], [20, 14]],
      // Snout/head wedge.
      [[60, 30], [68, 32], [78, 30], [88, 26], [97, 22], [100, 20], [96, 16],
       [86, 17], [76, 19], [66, 21]],
      // Ear.
      [[70, 31], [69, 39], [76, 33]],
    ],
    strokes: [
      // Back-ridge bristles - the classic wild-boar tell.
      [[24, 35], [27, 38], [30, 35], [34, 39], [38, 36], [43, 39], [48, 37],
       [53, 38.5], [57, 36], [61, 32]],
      // Tail curl.
      [[18, 20], [13, 24], [16, 28], [12, 29]],
    ],
  },
};
