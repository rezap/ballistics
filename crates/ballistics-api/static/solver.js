// Where trajectories get solved.
//
// On this device when it can, by the WebAssembly build of the same Rust
// solver the server runs; on the server when it cannot. The page asks this
// file for answers and does not need to know which one it got, because
// both give the same answers in the same shapes. That is the whole
// contract, and it is why ranking the catalogue here still thins each
// trajectory to every ten yards: full resolution would be more precise,
// but the page would then show different numbers depending on whether
// there was signal.
//
// Falling back to the server:
//   - the module is missing, will not compile, or takes too long to arrive
//   - it speaks a different protocol version (a cached page against a newer
//     module, or the reverse)
//   - it traps mid-solve, after which the instance is unusable
//   - it returns a code only a bug in this file could produce
//
// Not falling back: a request the solver rejects. That is an answer, and
// the server would give the same one in the same words - both read their
// rules from `ballistics_core::validation`.
//
// A classic script rather than a module, like app.js, which reads it as
// the global `ballisticsSolver`. Node loads it with `require` for testing,
// and gets the factory instead of a running instance.

(function (root) {
  "use strict";

  const MODULE_URL = "wasm/ballistics_wasm.wasm";

  // The protocol this file speaks. See the module docs in
  // crates/ballistics-wasm/src/lib.rs.
  const ABI_VERSION = 1;

  // `/api/suitability` thins each trajectory to this, and the local ranking
  // matches it so the shortlist reads the same either way.
  const SAMPLE_STEP_YARDS = 10;

  // A 37 KB download that has not arrived in this long is not coming soon,
  // and every solve waits for it - better to answer from the server.
  const MODULE_TIMEOUT_MS = 10_000;

  /// The solver declined the request. Carries its wording, which is the
  /// server's wording too.
  class SolveError extends Error {
    constructor(message) {
      super(message);
      this.name = "SolveError";
    }
  }

  /// A catalogue entry as the solver wants it. A coefficient only means
  /// anything with the drag model it was measured against, so the two are
  /// picked together, preferring G7, then G5, then G1 - the order the
  /// server's `load_from_catalogue` uses. This is the one place in the page
  /// that decides it; the form reads it from here too.
  function loadFromCatalogue(entry) {
    const [drag_function, ballistic_coefficient] =
      entry.bc_g7 != null
        ? ["G7", entry.bc_g7]
        : entry.bc_g5 != null
          ? ["G5", entry.bc_g5]
          : entry.bc_g1 != null
            ? ["G1", entry.bc_g1]
            : [null, null];
    if (drag_function == null) return null;
    return {
      drag_function,
      ballistic_coefficient,
      muzzle_velocity: entry.muzzle_velocity_fps,
      bullet_weight_gr: entry.bullet_weight_gr,
    };
  }

  /// Every `step` yards, and always the last point, so the furthest range
  /// a load reaches is not rounded away. The same rule as the server's
  /// `sample`, so the same points survive.
  function sample(points, step) {
    const last = points.length - 1;
    return points.filter((point, i) => i === last || point.yards % step === 0);
  }

  /// Wraps an instantiated module in a function that takes the same request
  /// the server takes and returns the same array of points.
  ///
  /// Throws `SolveError` for a request the solver rejects; anything else
  /// thrown means the module cannot be trusted any more.
  function wrapModule(instance) {
    const wasm = instance.exports;

    const abi = wasm.abi_version();
    if (abi !== ABI_VERSION) {
      throw new Error(`the module speaks protocol ${abi}, this page speaks ${ABI_VERSION}`);
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    // Every view onto memory is taken fresh, after the call that might have
    // moved it, and read out at once. A call can reuse the memory a view
    // points at, and growing memory detaches the old buffer outright -
    // both silently.
    const readString = (ptr, len) => decoder.decode(new Uint8Array(wasm.memory.buffer, ptr, len));

    // The module says which field is where; this file never assumes it.
    const layout = JSON.parse(readString(wasm.layout_ptr(), wasm.layout_len()));
    const width = layout.length;

    return function solve(request) {
      const bytes = encoder.encode(JSON.stringify(request));
      const ptr = wasm.input_buffer(bytes.length);
      new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);

      const count = wasm.solve(bytes.length);
      if (count === -1 || count === -2) {
        // Unparseable or invalid. The server parses and validates with the
        // same code, so asking it would only produce the same refusal - or,
        // offline, a worse one.
        throw new SolveError(readString(wasm.error_ptr(), wasm.error_len()));
      }
      if (count < 0) {
        throw new Error(
          `the module returned ${count}: ${readString(wasm.error_ptr(), wasm.error_len())}`
        );
      }

      const flat = new Float64Array(wasm.memory.buffer, wasm.output_ptr(), count * width);
      const points = new Array(count);
      for (let i = 0; i < count; i++) {
        const point = {};
        for (let f = 0; f < width; f++) point[layout[f]] = flat[i * width + f];
        points[i] = point;
      }
      return points;
    };
  }

  /// Builds a solver.
  ///
  /// - `loadModule()` resolves to an instantiated module, or rejects.
  /// - `fetchJson(path, body)` POSTs to the server and resolves to the
  ///   parsed body, or rejects: `SolveError` for a refusal, anything else
  ///   for a request that never got an answer.
  /// - `warn(message)` is told when the module is set aside.
  function createSolver({ loadModule, fetchJson, warn = () => {} }) {
    let local = null;
    let lastEngine = null;

    const ready = Promise.resolve()
      .then(loadModule)
      .then((instance) => {
        local = wrapModule(instance);
      })
      .catch((err) => {
        warn(`solving on the server: ${err?.message ?? err}`);
        local = null;
      });

    // Once the module has misbehaved it stays set aside. A trap leaves the
    // instance unusable, and a module that returned nonsense once should
    // not be trusted to be right the next time.
    function setAside(err) {
      warn(`solving on the server from now on: ${err?.message ?? err}`);
      local = null;
    }

    async function trajectory(request) {
      await ready;
      if (local) {
        try {
          const points = local(request);
          lastEngine = "device";
          return points;
        } catch (err) {
          if (err instanceof SolveError) throw err;
          setAside(err);
        }
      }
      const points = await fetchJson("/api/trajectory", request);
      lastEngine = "server";
      return points;
    }

    /// Every catalogue load against one set of conditions: what
    /// `/api/suitability` returns, in the same order and shape.
    ///
    /// The server checks the conditions before solving anything, so with
    /// bad conditions it refuses even an empty selection, where this would
    /// return an empty list. The page cannot ask for an empty selection -
    /// its cartridge filter only ever names a cartridge from the catalogue.
    ///
    /// With no catalogue in hand (it failed to load) there is nothing to
    /// solve here, and the server, which has its own copy, is asked.
    async function rankCatalogue({ loads, rifle, atmosphere, shot, cartridges }) {
      await ready;
      if (local && loads?.length) {
        try {
          const chosen = cartridges ? loads.filter((l) => cartridges.includes(l.cartridge)) : loads;
          const entries = [];
          for (const entry of chosen) {
            const load = loadFromCatalogue(entry);
            if (!load) continue;
            const points = local({ load, rifle, atmosphere, shot });
            entries.push({ load_id: entry.id, points: sample(points, SAMPLE_STEP_YARDS) });
          }
          lastEngine = "device";
          return entries;
        } catch (err) {
          if (err instanceof SolveError) throw err;
          setAside(err);
        }
      }
      const entries = await fetchJson("/api/suitability", {
        rifle,
        atmosphere,
        shot,
        ...(cartridges ? { cartridges } : {}),
      });
      lastEngine = "server";
      return entries;
    }

    return {
      ready,
      trajectory,
      rankCatalogue,
      /// "device", "server", or null before anything has been solved.
      get engine() {
        return lastEngine;
      },
      /// Whether the module is loaded and trusted right now.
      get local() {
        return local != null;
      },
    };
  }

  const api = { createSolver, wrapModule, loadFromCatalogue, sample, SolveError, ABI_VERSION };

  if (typeof module !== "undefined" && module.exports) {
    // Node, for the tests: hand over the parts, start nothing.
    module.exports = api;
    return;
  }

  // The browser: start fetching the module now, alongside everything else
  // the page is loading, so it is usually ready before the first solve.
  async function loadModule() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODULE_TIMEOUT_MS);
    try {
      const response = await fetch(MODULE_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`${MODULE_URL} answered ${response.status}`);
      // Read whole rather than streamed: instantiateStreaming insists on the
      // application/wasm content type, and a static host that gets it wrong
      // should cost a little speed, not the whole feature.
      const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
      return instance;
    } finally {
      clearTimeout(timer);
    }
  }

  // Resolves to the parsed body, or rejects: with a `SolveError` carrying
  // the server's own wording when it refused, and with the browser's
  // network error untouched when the request never got an answer - each
  // caller words that its own way, as it did before this file existed.
  async function fetchJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok) {
      throw new SolveError(parsed?.error ?? `Request failed with status ${response.status}`);
    }
    return parsed;
  }

  root.ballisticsSolver = Object.assign(
    createSolver({ loadModule, fetchJson, warn: (m) => console.warn(`[solver] ${m}`) }),
    { loadFromCatalogue, SolveError }
  );
})(typeof window !== "undefined" ? window : globalThis);
