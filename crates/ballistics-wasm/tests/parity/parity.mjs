// The WebAssembly half of the parity check.
//
//   node parity.mjs <golden.json> <ballistics_wasm.wasm>
//
// The golden file is written natively by the `write_parity_golden` test,
// which drives the exported functions compiled for the host and records
// every input byte and every output bit. This replays the same bytes
// through the compiled module and requires the same answers: the same
// return code and error text exactly, the same number of points, and every
// value within the tolerance below.
//
// Why not bit-identical. The solver's transcendental functions come from
// different places on the two targets - the system's libm natively, Rust's
// own port of it on wasm32 - and two correct implementations may round the
// final bit differently. Measured on the first run, across 391,312 values:
//
//   - 99.3% bit-identical; range, windage and time of flight entirely so.
//   - The rest differ, and the difference does compound along a trajectory
//     (position integrates velocity), from 1 ULP to a few hundred.
//   - But the largest is 9.7e-14 relative. In real units the worst anywhere
//     was 1.4e-14 inches of drop, 9e-13 ft/s and 1.6e-12 ft-lb.
//   - Not one of the 391,312 figures the page would display changed.
//
// So the bar is set from that, with a wide margin, and not the other way
// round. Anything genuinely wrong - a field in the wrong slot, a value
// narrowed to f32 (1e-7 relative), a changed constant - is still orders of
// magnitude outside it. And the count of values that differ at all is
// always printed, so if the gap ever starts to grow it is seen, not hidden.

// Ten times the worst relative difference measured.
const REL_TOLERANCE = 1e-12;
// For values at or near zero, where a relative bound means nothing: a drop
// crossing the zero line is the case that needs it. A ten-billionth of an
// inch, a foot per second or a foot-pound is far below anything physical.
const ABS_TOLERANCE = 1e-10;

const withinTolerance = (a, b) =>
  Math.abs(a - b) <= ABS_TOLERANCE + REL_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));

import { readFileSync } from "node:fs";

const [goldenPath, wasmPath] = process.argv.slice(2);
if (!goldenPath || !wasmPath) {
  console.error("usage: node parity.mjs <golden.json> <ballistics_wasm.wasm>");
  process.exit(2);
}

const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const wasm = instance.exports;

const fail = (message) => {
  console.error(`PARITY FAILURE: ${message}`);
  process.exitCode = 1;
};

// --- The boundary, used exactly as a page would use it. -----------------
//
// Every view onto memory is taken fresh, after the call that might have
// moved it: a call can reuse the memory a view points at, and growing
// memory detaches the old buffer outright, leaving views that read as
// empty without any error.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const readString = (ptr, len) =>
  decoder.decode(new Uint8Array(wasm.memory.buffer, ptr, len));

function solveBytes(bytes) {
  const ptr = wasm.input_buffer(bytes.length);
  new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
  return wasm.solve(bytes.length);
}

// --- The contract, before any numbers. ----------------------------------

if (wasm.abi_version() !== golden.abi_version) {
  fail(`module is ABI ${wasm.abi_version()}, golden file expects ${golden.abi_version}`);
}

const layout = JSON.parse(readString(wasm.layout_ptr(), wasm.layout_len()));
if (JSON.stringify(layout) !== JSON.stringify(golden.layout)) {
  fail(`module layout ${JSON.stringify(layout)} != golden ${JSON.stringify(golden.layout)}`);
}

if (!Array.isArray(golden.cases) || golden.cases.length === 0) {
  // Comparing nothing would pass, which is the worst way to fail.
  fail("the golden file has no cases");
}

// --- Every case. --------------------------------------------------------

let values = 0;
let solved = 0;
let rejected = 0;
let notBitIdentical = 0;
let worstRelative = 0;
const hexToFloat = (hex) => new Float64Array(new BigUint64Array([BigInt(`0x${hex}`)]).buffer)[0];
const started = performance.now();

for (const expected of golden.cases) {
  const code = solveBytes(encoder.encode(expected.input));
  const error = readString(wasm.error_ptr(), wasm.error_len());

  if (code !== expected.code) {
    fail(`${expected.name}: returned ${code}, native returned ${expected.code} (${error || expected.error})`);
    continue;
  }
  if (error !== expected.error) {
    fail(`${expected.name}: error ${JSON.stringify(error)} != native ${JSON.stringify(expected.error)}`);
    continue;
  }
  if (code < 0) {
    rejected += 1;
    continue;
  }

  solved += 1;
  const count = code * layout.length;
  if (count !== expected.bits.length) {
    fail(`${expected.name}: ${count} values, native had ${expected.bits.length}`);
    continue;
  }
  // Compared as bits first, so an exact match is recognised as exact - and
  // so +0 and -0, or two NaNs, are judged by what they are rather than by
  // what `===` makes of them. Only a genuine difference falls through to
  // the tolerance.
  const bits = new BigUint64Array(wasm.memory.buffer, wasm.output_ptr(), count);
  for (let i = 0; i < count; i++) {
    const gotHex = bits[i].toString(16).padStart(16, "0");
    if (gotHex === expected.bits[i]) continue;

    notBitIdentical += 1;
    const got = hexToFloat(gotHex);
    const want = hexToFloat(expected.bits[i]);
    const relative = Math.abs(got - want) / Math.max(Math.abs(want), Number.MIN_VALUE);
    if (Number.isFinite(relative)) worstRelative = Math.max(worstRelative, relative);

    if (!withinTolerance(got, want)) {
      const field = layout[i % layout.length];
      const point = Math.floor(i / layout.length);
      fail(
        `${expected.name}: ${field} at point ${point} is ${got} (0x${gotHex}), ` +
          `native ${want} (0x${expected.bits[i]}) - outside tolerance`
      );
      break;
    }
  }
  values += count;
}

const ms = performance.now() - started;
console.log(
  `${golden.cases.length} cases: ${solved} solved, ${rejected} rejected - ` +
    `${values.toLocaleString("en")} f64 values compared in ${ms.toFixed(0)} ms`
);
console.log(
  `${notBitIdentical.toLocaleString("en")} values not bit-identical ` +
    `(${((100 * notBitIdentical) / Math.max(values, 1)).toFixed(2)}%), ` +
    `worst relative difference ${worstRelative.toExponential(2)} ` +
    `against a tolerance of ${REL_TOLERANCE.toExponential(0)}`
);
if (process.exitCode) {
  console.error("the compiled module does not match the native build");
} else {
  console.log("the compiled module matches the native build");
}
