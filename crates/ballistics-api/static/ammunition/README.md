# Factory ammunition catalogue

`loads.json` is a hand-curated list of factory loads. The API validates it
at startup and serves it from `GET /api/ammunition`; picking one in the
browser fills in the drag function, ballistic coefficient, muzzle velocity
and bullet weight.

## Adding a load

Add an object to `loads` and run `cargo test -p ballistics-api`. No code
changes. Every field is required except `test_barrel_in`, `bc_g1` and
`bc_g7` — and at least one of the two coefficients must be present.

```json
{
  "id": "maker-line-cartridge-weight-bullet",
  "manufacturer": "Hornady",
  "product_line": "Precision Hunter",
  "cartridge": "6.5 Creedmoor",
  "bullet": "143 gr ELD-X",
  "bullet_weight_gr": 143,
  "muzzle_velocity_fps": 2700,
  "test_barrel_in": 24,
  "bc_g1": 0.625,
  "bc_g7": 0.315,
  "source_url": "https://www.hornady.com/...",
  "retrieved": "2026-08-01"
}
```

## Three rules worth not breaking

**A ballistic coefficient is meaningless without its drag model.** There is
no bare `bc` field, only `bc_g1` and `bc_g7`, and the app picks the drag
function to match whichever it uses (G7 where published, since these are
boat-tail hunting bullets). Putting a G1 figure in `bc_g7` would not error —
it would produce a confident, wrong trajectory, which is the worst failure
this app has.

**Every figure is advertised, not measured.** Muzzle velocity comes from the
maker's test barrel. A shorter hunting barrel loses roughly 20–30 fps per
inch, so a 20in rifle against a 24in test barrel can be 100 fps down — inches
of drop at 400 yards, and it moves the max ethical range the wrong way.
Advertised BCs also tend to be optimistic. The app says so under the picker
and points at chronographing; do not quietly drop that.

`test_barrel_in` is `null` where the maker does not state it, and the app
reports that as unknown rather than assuming 24in.

**Record where the numbers came from.** `source_url` and `retrieved` are
validated, not decorative: catalogues are revised, and a figure with no
provenance cannot be rechecked.

## On where the data comes from

These are individually published facts, transcribed by hand with their
source recorded. Systematically extracting a maker's whole catalogue is a
different thing, and in the EU it runs into the [database
directive](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:01996L0009-20190606)'s
sui generis right, which protects substantial investment in compiling a
database *even when its contents are pure facts*. Its research exception is
explicitly non-commercial. Worth knowing before anyone writes a scraper.

Manufacturer and product names are used to identify the actual product and
nothing more — no logos, no implied endorsement.
