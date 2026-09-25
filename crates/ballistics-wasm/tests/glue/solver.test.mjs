// Tests for the page's side of the boundary: crates/ballistics-api/static/solver.js.
//
//   BALLISTICS_PARITY_GOLDEN=target/parity-golden.json \
//   BALLISTICS_WASM=target/wasm32-unknown-unknown/wasm/ballistics_wasm.wasm \
//     node --test crates/ballistics-wasm/tests/glue/solver.test.mjs
//
// (The golden file is written by the `write_parity_golden` test; see the
// README.)
//
// parity.mjs proves the compiled module gives the native answers when
// driven by hand. This proves the file the page actually uses drives it
// correctly - the same answers, the same refusals in the same words - and
// that every way the module can fail lands on the server rather than on a
// broken page.
//
// Both paths are required rather than skipped when missing: a check that
// quietly skips in CI is a check that does not exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(here, "../../../ballistics-api/static");
const require = createRequire(import.meta.url);
const { createSolver, wrapModule, loadFromCatalogue, sample, SolveError, ABI_VERSION } = require(
  path.join(staticDir, "solver.js")
);

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`set ${name} - see the top of this file`);
  return value;
};
const golden = JSON.parse(readFileSync(need("BALLISTICS_PARITY_GOLDEN"), "utf8"));
const wasmBytes = readFileSync(need("BALLISTICS_WASM"));
const catalogue = JSON.parse(readFileSync(path.join(staticDir, "ammunition/loads.json"), "utf8")).loads;

// Ordinary conditions: a 100 yard zero in standard air, a 10 mph crosswind.
const conditions = {
  rifle: { sight_height: 1.7, zero_range: 100, zero_y_intercept: 0 },
  atmosphere: { altitude: 0, pressure: 29.53, temperature: 59, relative_humidity: 0.78 },
  shot: { shooting_angle: 0, wind_speed: 10, wind_angle: 90 },
};

const instantiate = async () => (await WebAssembly.instantiate(wasmBytes, {})).instance;

// The same bar as parity.mjs, for the same reasons: see there.
const REL_TOLERANCE = 1e-12;
const ABS_TOLERANCE = 1e-10;
const hexToFloat = (hex) => new Float64Array(new BigUint64Array([BigInt(`0x${hex}`)]).buffer)[0];

/// A server stand-in for tests that must never reach it.
const noServer = async (p) => {
  throw new Error(`asked the server (${p}) when the module should have answered`);
};

/// A server stand-in that records what it was asked and answers with a
/// marker, so a test can tell which engine answered by the answer itself.
function recordingServer() {
  const calls = [];
  const fetchJson = async (p, body) => {
    calls.push({ path: p, body });
    return p === "/api/trajectory" ? [{ from: "server" }] : [{ load_id: "from-server", points: [] }];
  };
  return { calls, fetchJson };
}

// --- The real module, through the glue. ---------------------------------

test("every golden case gives the native answer through the glue", async () => {
  const solver = createSolver({ loadModule: instantiate, fetchJson: noServer });
  await solver.ready;
  assert.equal(solver.local, true);

  let solved = 0;
  let refused = 0;
  for (const expected of golden.cases) {
    // The glue sends `JSON.stringify(request)`, so only cases whose input
    // survives a round trip through JSON unchanged are fed to it. The
    // rest - truncated or malformed bytes - cannot come from the page, and
    // parity.mjs covers them.
    let request;
    try {
      request = JSON.parse(expected.input);
    } catch {
      continue;
    }
    if (JSON.stringify(request) !== expected.input) continue;

    if (expected.code === -1 || expected.code === -2) {
      await assert.rejects(solver.trajectory(request), (err) => {
        assert.ok(err instanceof SolveError, `${expected.name}: ${err}`);
        assert.equal(err.message, expected.error, expected.name);
        return true;
      });
      refused += 1;
      continue;
    }
    assert.ok(expected.code >= 0, `${expected.name}: unexpected golden code ${expected.code}`);

    const points = await solver.trajectory(request);
    assert.equal(points.length, expected.code, expected.name);
    const width = golden.layout.length;
    for (let i = 0; i < points.length; i++) {
      assert.deepEqual(Object.keys(points[i]), golden.layout, expected.name);
      for (let f = 0; f < width; f++) {
        const got = points[i][golden.layout[f]];
        const want = hexToFloat(expected.bits[i * width + f]);
        const bound = ABS_TOLERANCE + REL_TOLERANCE * Math.max(Math.abs(got), Math.abs(want));
        assert.ok(
          Object.is(got, want) || Math.abs(got - want) <= bound,
          `${expected.name}: ${golden.layout[f]} at point ${i} is ${got}, native ${want}`
        );
      }
    }
    solved += 1;
  }

  // Most of the fixtures are ordinary requests; if the round-trip filter
  // ever threw most of them away, this would be testing nothing.
  assert.ok(solved >= 60, `only ${solved} golden cases solved through the glue`);
  assert.ok(refused >= 10, `only ${refused} golden refusals checked through the glue`);
  assert.equal(solver.engine, "device");
  assert.equal(solver.local, true, "a refusal must not set the module aside");
});

test("the catalogue ranks on the device as the server ranks it", async () => {
  const solver = createSolver({ loadModule: instantiate, fetchJson: noServer });
  const all = await solver.rankCatalogue({ loads: catalogue, ...conditions });
  // In catalogue order, one entry per load, as `/api/suitability` returns.
  assert.deepEqual(
    all.map((e) => e.load_id),
    catalogue.map((l) => l.id)
  );

  // Each entry is that load's full trajectory, thinned the server's way.
  const wrapped = wrapModule(await instantiate());
  for (const [i, entry] of catalogue.entries()) {
    const full = wrapped({ load: loadFromCatalogue(entry), ...conditions });
    assert.deepEqual(all[i].points, sample(full, 10), entry.id);
    const yards = all[i].points.map((p) => p.yards);
    assert.equal(yards.at(-1), full.at(-1).yards, `${entry.id}: the last point was dropped`);
    assert.ok(
      yards.slice(0, -1).every((y) => y % 10 === 0),
      `${entry.id}: points off the 10 yard grid`
    );
  }

  const cartridge = catalogue[0].cartridge;
  const one = await solver.rankCatalogue({ loads: catalogue, ...conditions, cartridges: [cartridge] });
  assert.deepEqual(
    one.map((e) => e.load_id),
    catalogue.filter((l) => l.cartridge === cartridge).map((l) => l.id)
  );
  assert.equal(solver.engine, "device");
});

test("bad conditions are refused on the device with the server's words", async () => {
  const solver = createSolver({ loadModule: instantiate, fetchJson: noServer });
  await assert.rejects(
    solver.rankCatalogue({
      loads: catalogue,
      ...conditions,
      rifle: { ...conditions.rifle, zero_range: -5 },
    }),
    SolveError
  );
  assert.equal(solver.local, true);
});

test("a long trajectory after short ones still reads correctly", async () => {
  // Memory can grow on a longer answer, which detaches every earlier view
  // of it. The glue must read through a fresh one every time.
  // The shortest and longest trajectories among the golden cases.
  const solve = wrapModule(await instantiate());
  const solvedCases = golden.cases.filter((c) => c.code > 0).sort((a, b) => a.code - b.code);
  const shortCase = solvedCases[0];
  const longCase = solvedCases.at(-1);
  assert.ok(longCase.code > shortCase.code);

  const short = solve(JSON.parse(shortCase.input));
  const long = solve(JSON.parse(longCase.input));
  const again = solve(JSON.parse(shortCase.input));
  assert.equal(short.length, shortCase.code);
  assert.equal(long.length, longCase.code);
  assert.deepEqual(again, short);
  assert.ok(long.every((p) => Number.isFinite(p.velocity_fps)));
});

// --- Choosing the drag model, and thinning. -----------------------------

test("loadFromCatalogue prefers G7, then G5, then G1", () => {
  const entry = (g1, g5, g7) => ({
    bc_g1: g1,
    bc_g5: g5,
    bc_g7: g7,
    muzzle_velocity_fps: 2700,
    bullet_weight_gr: 150,
  });
  assert.deepEqual(loadFromCatalogue(entry(0.45, 0.26, 0.22)), {
    drag_function: "G7",
    ballistic_coefficient: 0.22,
    muzzle_velocity: 2700,
    bullet_weight_gr: 150,
  });
  assert.equal(loadFromCatalogue(entry(0.45, 0.26, null)).drag_function, "G5");
  assert.equal(loadFromCatalogue(entry(0.45, undefined, undefined)).drag_function, "G1");
  assert.equal(loadFromCatalogue(entry(null, null, null)), null);
});

test("sample keeps every tenth yard and the last point", () => {
  const points = [0, 1, 9, 10, 11, 20, 23].map((yards) => ({ yards }));
  assert.deepEqual(
    sample(points, 10).map((p) => p.yards),
    [0, 10, 20, 23]
  );
  assert.deepEqual(sample([], 10), []);
});

// --- Every way the module can fail lands on the server. -----------------

/// A module that follows the protocol, with hooks to misbehave. Writes its
/// layout and one point into real linear memory, as the real one does.
function fakeModule({ abi = ABI_VERSION, solve } = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const layoutJson = new TextEncoder().encode(JSON.stringify(golden.layout));
  const LAYOUT_AT = 0;
  const ERROR_AT = 1024;
  const OUTPUT_AT = 2048;
  const INPUT_AT = 8192;
  new Uint8Array(memory.buffer, LAYOUT_AT, layoutJson.length).set(layoutJson);
  let errorLen = 0;
  const exports = {
    memory,
    abi_version: () => abi,
    layout_ptr: () => LAYOUT_AT,
    layout_len: () => layoutJson.length,
    input_buffer: () => INPUT_AT,
    output_ptr: () => OUTPUT_AT,
    error_ptr: () => ERROR_AT,
    error_len: () => errorLen,
    solve:
      solve ??
      (() => {
        new Float64Array(memory.buffer, OUTPUT_AT, golden.layout.length).fill(1);
        return 1;
      }),
    setError(text) {
      const bytes = new TextEncoder().encode(text);
      new Uint8Array(memory.buffer, ERROR_AT, bytes.length).set(bytes);
      errorLen = bytes.length;
    },
  };
  return { exports };
}

const request = { load: {}, rifle: {} };

test("a module that will not load: the server answers", async () => {
  const server = recordingServer();
  const warnings = [];
  const solver = createSolver({
    loadModule: async () => {
      throw new Error("404");
    },
    fetchJson: server.fetchJson,
    warn: (m) => warnings.push(m),
  });
  assert.deepEqual(await solver.trajectory(request), [{ from: "server" }]);
  assert.equal(solver.engine, "server");
  assert.equal(solver.local, false);
  assert.equal(server.calls[0].path, "/api/trajectory");
  assert.deepEqual(server.calls[0].body, request);
  assert.equal(warnings.length, 1);
});

test("a module speaking another protocol version: the server answers", async () => {
  const server = recordingServer();
  const solver = createSolver({
    loadModule: async () => fakeModule({ abi: ABI_VERSION + 1 }),
    fetchJson: server.fetchJson,
  });
  assert.deepEqual(await solver.trajectory(request), [{ from: "server" }]);
  assert.equal(solver.local, false);
});

test("a trap mid-solve: the server answers, and the module is set aside for good", async () => {
  const server = recordingServer();
  let solves = 0;
  const solver = createSolver({
    loadModule: async () =>
      fakeModule({
        solve: () => {
          solves += 1;
          throw new WebAssembly.RuntimeError("unreachable");
        },
      }),
    fetchJson: server.fetchJson,
  });
  await solver.ready;
  assert.equal(solver.local, true);

  assert.deepEqual(await solver.trajectory(request), [{ from: "server" }]);
  assert.equal(solver.local, false);
  assert.equal(solver.engine, "server");

  // A trapped instance is unusable; it must not be tried again.
  await solver.trajectory(request);
  assert.equal(solves, 1);
  assert.equal(server.calls.length, 2);
});

test("a code only a bug could produce: the server answers", async () => {
  for (const code of [-3, -4, -99]) {
    const server = recordingServer();
    const module = fakeModule({ solve: () => code });
    const solver = createSolver({ loadModule: async () => module, fetchJson: server.fetchJson });
    assert.deepEqual(await solver.trajectory(request), [{ from: "server" }], `code ${code}`);
    assert.equal(solver.local, false, `code ${code}`);
  }
});

test("a trap while ranking: the server ranks, with the same filter", async () => {
  const server = recordingServer();
  const solver = createSolver({
    loadModule: async () =>
      fakeModule({
        solve: () => {
          throw new WebAssembly.RuntimeError("unreachable");
        },
      }),
    fetchJson: server.fetchJson,
  });
  const entries = await solver.rankCatalogue({ loads: catalogue, ...conditions, cartridges: [".308 Winchester"] });
  assert.deepEqual(entries, [{ load_id: "from-server", points: [] }]);
  assert.equal(server.calls[0].path, "/api/suitability");
  assert.deepEqual(server.calls[0].body, { ...conditions, cartridges: [".308 Winchester"] });

  // No filter: the key is left out, as the page always sent it.
  await solver.rankCatalogue({ loads: catalogue, ...conditions });
  assert.ok(!("cartridges" in server.calls[1].body));
});

test("no catalogue in hand: the server, which has its own, ranks", async () => {
  const server = recordingServer();
  const solver = createSolver({ loadModule: instantiate, fetchJson: server.fetchJson });
  await solver.rankCatalogue({ loads: [], ...conditions });
  assert.equal(server.calls[0].path, "/api/suitability");
  assert.equal(solver.local, true, "an empty catalogue says nothing about the module");
});

// --- A refusal is an answer, not a failure. -----------------------------

test("a refusal from the module is passed on, not retried on the server", async () => {
  const module = fakeModule({
    solve: () => {
      module.exports.setError("muzzle_velocity must be positive");
      return -2;
    },
  });
  const solver = createSolver({ loadModule: async () => module, fetchJson: noServer });
  await assert.rejects(solver.trajectory(request), (err) => {
    assert.ok(err instanceof SolveError);
    assert.equal(err.message, "muzzle_velocity must be positive");
    return true;
  });
  assert.equal(solver.local, true);
});

test("a network failure with no module is passed on as is", async () => {
  const solver = createSolver({
    loadModule: async () => {
      throw new Error("offline");
    },
    fetchJson: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  await assert.rejects(solver.trajectory(request), (err) => {
    // Not a SolveError: the page words this one itself ("Request failed: ...").
    assert.ok(!(err instanceof SolveError));
    assert.equal(err.message, "Failed to fetch");
    return true;
  });
});
