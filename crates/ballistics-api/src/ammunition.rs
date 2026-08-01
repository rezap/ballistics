//! Loads the factory-ammunition catalogue served at `GET /api/ammunition`.
//!
//! Like the species data this lives in the static directory rather than
//! being compiled in, so adding a load is a data change. It follows the
//! same shape deliberately: validate hard at startup and report every
//! problem at once, because the alternative to a loud failure here is a
//! quietly wrong trajectory.
//!
//! Everything in the catalogue is *advertised* data. See the comment block
//! in `loads.json` for why that matters and what the app has to keep
//! visible because of it.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// One factory load as authored in `loads.json`.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct FactoryLoad {
    pub id: String,
    pub manufacturer: String,
    pub product_line: String,
    pub cartridge: String,
    pub bullet: String,
    pub bullet_weight_gr: f64,
    pub muzzle_velocity_fps: f64,
    /// Barrel the maker measured that velocity in. `None` means they do
    /// not state it, which the frontend reports as unknown rather than
    /// assuming the usual 24 inches.
    #[serde(default)]
    pub test_barrel_in: Option<f64>,
    /// Ballistic coefficients, each against the drag model it was measured
    /// with. There is deliberately no bare `bc`: pairing a G1 number with
    /// the G7 drag function is silently wrong rather than an error.
    #[serde(default)]
    pub bc_g1: Option<f64>,
    #[serde(default)]
    pub bc_g7: Option<f64>,
    /// Muzzle energy as the maker states it, where they do.
    ///
    /// Carried purely as a cross-check and never used to compute anything:
    /// energy is fixed by bullet weight and velocity, so a stated figure
    /// that disagrees with those two means one of them was transcribed
    /// wrong. That is the likely error in a hand-entered catalogue, and it
    /// is otherwise invisible - a wrong velocity produces a trajectory that
    /// looks entirely reasonable.
    #[serde(default)]
    pub stated_muzzle_energy_ft_lb: Option<f64>,
    /// The maker's own "maximum recommended distance", where they publish
    /// one (Norma prints it on every product page).
    ///
    /// Stored but not acted on. It is the manufacturer's answer to the same
    /// question this app answers from energy and expansion thresholds, so
    /// it is worth having the two side by side - if they disagree badly on
    /// a load, one of the two is wrong and it is worth knowing which.
    #[serde(default)]
    pub maker_max_range_yd: Option<f64>,
    pub source_url: String,
    pub retrieved: String,
}

#[derive(Debug, Deserialize)]
struct Catalogue {
    schema_version: u32,
    loads: Vec<FactoryLoad>,
}

/// The schema this build understands. Bumped when the shape changes, so a
/// stale data file fails loudly instead of deserialising into defaults.
const SUPPORTED_SCHEMA_VERSION: u32 = 1;

fn validate(load: &FactoryLoad) -> Result<(), String> {
    let mut problems = Vec::new();

    let positive = |label: &str, value: f64, problems: &mut Vec<String>| {
        if !(value.is_finite() && value > 0.0) {
            problems.push(format!("{label} must be a positive, finite number"));
        }
    };

    positive("bullet_weight_gr", load.bullet_weight_gr, &mut problems);
    positive(
        "muzzle_velocity_fps",
        load.muzzle_velocity_fps,
        &mut problems,
    );

    for (label, value) in [("bc_g1", load.bc_g1), ("bc_g7", load.bc_g7)] {
        if let Some(bc) = value {
            positive(label, bc, &mut problems);
        }
    }

    // A load with no coefficient at all cannot be solved, so it is worse
    // than absent - it would look selectable and then not work.
    if load.bc_g1.is_none() && load.bc_g7.is_none() {
        problems.push("at least one of bc_g1 or bc_g7 is required".to_string());
    }

    if let Some(barrel) = load.test_barrel_in {
        if !(barrel.is_finite() && (10.0..=40.0).contains(&barrel)) {
            problems.push("test_barrel_in must be between 10 and 40 inches".to_string());
        }
    }

    for (label, value) in [
        ("manufacturer", &load.manufacturer),
        ("product_line", &load.product_line),
        ("cartridge", &load.cartridge),
        ("bullet", &load.bullet),
    ] {
        if value.trim().is_empty() {
            problems.push(format!("{label} must not be empty"));
        }
    }

    // Provenance is not decoration: an advertised figure with no source
    // cannot be rechecked when the maker revises it.
    if !load.source_url.starts_with("https://") {
        problems.push("source_url must be an https URL".to_string());
    }
    if load.retrieved.len() != 10 || !load.retrieved.starts_with("20") {
        problems.push("retrieved must be an ISO date, e.g. 2026-08-01".to_string());
    }

    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!("{}: {}", load.id, problems.join("; ")))
    }
}

/// Reads `ammunition/loads.json` from `static_dir`.
///
/// Returns every load sorted by cartridge then manufacturer, or a list of
/// every validation problem found.
pub fn load(static_dir: &Path) -> Result<Vec<FactoryLoad>, String> {
    let path = static_dir.join("ammunition").join("loads.json");

    let raw = std::fs::read_to_string(&path)
        .map_err(|err| format!("could not read {}: {err}", path.display()))?;
    let catalogue: Catalogue = serde_json::from_str(&raw)
        .map_err(|err| format!("{} is not valid: {err}", path.display()))?;

    if catalogue.schema_version != SUPPORTED_SCHEMA_VERSION {
        return Err(format!(
            "{} is schema version {}, but this build understands {}",
            path.display(),
            catalogue.schema_version,
            SUPPORTED_SCHEMA_VERSION
        ));
    }

    let mut problems: Vec<String> = catalogue
        .loads
        .iter()
        .filter_map(|l| validate(l).err())
        .collect();

    let mut ids: Vec<&str> = catalogue.loads.iter().map(|l| l.id.as_str()).collect();
    ids.sort_unstable();
    for pair in ids.windows(2) {
        if pair[0] == pair[1] {
            problems.push(format!("duplicate id: {}", pair[0]));
        }
    }

    if !problems.is_empty() {
        return Err(problems.join("\n"));
    }

    let mut loads = catalogue.loads;
    loads.sort_by(|a, b| {
        a.cartridge
            .cmp(&b.cartridge)
            .then_with(|| a.manufacturer.cmp(&b.manufacturer))
            .then_with(|| a.bullet_weight_gr.total_cmp(&b.bullet_weight_gr))
    });
    Ok(loads)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    /// What identifies one projectile: product line, weight and bore. The
    /// floats are bit patterns so the tuple can be a map key.
    type BulletKey = (String, u64, u64);
    /// A cartridge that bullet is loaded in, and its coefficients.
    type LoadedIn = (String, Option<f64>, Option<f64>);

    fn static_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("static")
    }

    fn valid_load() -> FactoryLoad {
        serde_json::from_value(serde_json::json!({
            "id": "test-load",
            "manufacturer": "Testco",
            "product_line": "Test Line",
            "cartridge": ".308 Winchester",
            "bullet": "168 gr Test",
            "bullet_weight_gr": 168,
            "muzzle_velocity_fps": 2700,
            "test_barrel_in": 24,
            "bc_g1": 0.478,
            "bc_g7": 0.241,
            "source_url": "https://example.com/load",
            "retrieved": "2026-08-01"
        }))
        .unwrap()
    }

    #[test]
    fn ships_a_valid_catalogue() {
        let loads = load(&static_dir()).expect("bundled loads.json should be valid");
        assert!(!loads.is_empty());
        for entry in &loads {
            assert!(entry.bc_g1.is_some() || entry.bc_g7.is_some());
            assert!(entry.muzzle_velocity_fps > 0.0);
        }
    }

    #[test]
    fn every_load_records_where_its_numbers_came_from() {
        // Advertised figures get revised. One with no source cannot be
        // rechecked, so it is not allowed in.
        for entry in load(&static_dir()).unwrap() {
            assert!(entry.source_url.starts_with("https://"), "{}", entry.id);
            assert_eq!(entry.retrieved.len(), 10, "{}", entry.id);
        }
    }

    #[test]
    fn shipped_velocities_and_coefficients_are_plausible() {
        // A decimal slip in a hand-entered catalogue is the likely error,
        // and it would produce a confident, wrong trajectory.
        for entry in load(&static_dir()).unwrap() {
            assert!(
                (1000.0..=4500.0).contains(&entry.muzzle_velocity_fps),
                "{} has an implausible muzzle velocity: {}",
                entry.id,
                entry.muzzle_velocity_fps
            );
            assert!(
                (15.0..=750.0).contains(&entry.bullet_weight_gr),
                "{} has an implausible bullet weight: {}",
                entry.id,
                entry.bullet_weight_gr
            );
            for bc in [entry.bc_g1, entry.bc_g7].into_iter().flatten() {
                assert!(
                    bc > 0.05 && bc < 1.5,
                    "{} has an implausible BC: {bc}",
                    entry.id
                );
            }
            // G7 runs roughly half of G1 for the same bullet; the two being
            // close together means one was entered against the wrong model.
            if let (Some(g1), Some(g7)) = (entry.bc_g1, entry.bc_g7) {
                let ratio = g1 / g7;
                assert!(
                    (1.6..=2.6).contains(&ratio),
                    "{} has a G1/G7 ratio of {ratio:.2}, which suggests one is against the wrong drag model",
                    entry.id
                );
            }
        }
    }

    #[test]
    fn stated_muzzle_energy_agrees_with_weight_and_velocity() {
        // Energy is fixed by the other two, so a maker's own figure is a
        // free check on the transcription. A velocity typed wrong yields a
        // perfectly plausible trajectory and nothing else would catch it.
        for entry in load(&static_dir()).unwrap() {
            let Some(stated) = entry.stated_muzzle_energy_ft_lb else {
                continue;
            };
            let computed =
                ballistics_core::energy::ft_lb(entry.bullet_weight_gr, entry.muzzle_velocity_fps);
            let error = (computed - stated).abs() / stated;
            assert!(
                error < 0.015,
                "{}: {} gr at {} ft/s is {computed:.0} ft-lb, but the maker states {stated:.0} \
                 ({:.1}% out) - one of the three figures is wrong",
                entry.id,
                entry.bullet_weight_gr,
                entry.muzzle_velocity_fps,
                error * 100.0
            );
        }
    }

    #[test]
    fn catches_a_mistyped_velocity_via_the_stated_energy() {
        let mut entry = valid_load();
        entry.stated_muzzle_energy_ft_lb = Some(2718.0);
        let computed =
            ballistics_core::energy::ft_lb(entry.bullet_weight_gr, entry.muzzle_velocity_fps);
        assert!((computed - 2718.0).abs() / 2718.0 < 0.015, "{computed}");

        // A transposed digit - 2700 typed as 2070 - is far outside it.
        entry.muzzle_velocity_fps = 2070.0;
        let slipped =
            ballistics_core::energy::ft_lb(entry.bullet_weight_gr, entry.muzzle_velocity_fps);
        assert!((slipped - 2718.0).abs() / 2718.0 > 0.015, "{slipped}");
    }

    /// Bore diameter per cartridge, so "the same bullet" can be recognised.
    /// Test-only: a cartridge missing here just skips the check below rather
    /// than failing it.
    fn bore_in(cartridge: &str) -> Option<f64> {
        Some(match cartridge {
            "6.5 Creedmoor" | "6.5x55 SE" => 0.264,
            ".308 Winchester" | ".30-06 Springfield" | ".300 Winchester Magnum" => 0.308,
            "9.3x57" | "9.3x62" | "9.3x74R" => 0.366,
            _ => return None,
        })
    }

    #[test]
    fn one_bullet_has_one_ballistic_coefficient() {
        // BC is a property of the projectile, not the cartridge it is loaded
        // in, so the same bullet at the same weight and bore must carry the
        // same figure everywhere. Velocity is free to differ; BC is not.
        //
        // This is not hypothetical tidiness. The 285 gr Oryx was entered as
        // 0.330 in 9.3x62 and 0.356 in 9.3x74R, and the mismatch was the
        // only visible sign that one of them came from a bad source.
        let mut seen: BTreeMap<BulletKey, Vec<LoadedIn>> = BTreeMap::new();

        for entry in load(&static_dir()).unwrap() {
            let Some(bore) = bore_in(&entry.cartridge) else {
                continue;
            };
            let key = (
                entry.product_line.clone(),
                entry.bullet_weight_gr.to_bits(),
                bore.to_bits(),
            );
            seen.entry(key)
                .or_default()
                .push((entry.cartridge.clone(), entry.bc_g1, entry.bc_g7));
        }

        for ((line, _, _), group) in seen {
            let (first_cartridge, g1, g7) = &group[0];
            for (cartridge, other_g1, other_g7) in &group[1..] {
                assert_eq!(
                    (g1, g7),
                    (other_g1, other_g7),
                    "{line}: the same bullet has different coefficients in {first_cartridge} \
                     and {cartridge} - one of them came from the wrong source"
                );
            }
        }
    }

    #[test]
    fn rejects_a_load_with_no_ballistic_coefficient() {
        let mut entry = valid_load();
        entry.bc_g1 = None;
        entry.bc_g7 = None;
        assert!(validate(&entry).unwrap_err().contains("bc_g1 or bc_g7"));

        // Either one alone is fine.
        entry.bc_g7 = Some(0.241);
        assert!(validate(&entry).is_ok());
    }

    #[test]
    fn rejects_an_unsourced_load() {
        let mut entry = valid_load();
        entry.source_url = "not a url".to_string();
        assert!(validate(&entry).unwrap_err().contains("source_url"));
    }

    #[test]
    fn rejects_nonsense_figures() {
        let mut entry = valid_load();
        entry.muzzle_velocity_fps = -1.0;
        entry.bullet_weight_gr = f64::NAN;
        entry.test_barrel_in = Some(96.0);
        let error = validate(&entry).unwrap_err();
        assert!(error.contains("muzzle_velocity_fps"), "{error}");
        assert!(error.contains("bullet_weight_gr"), "{error}");
        assert!(error.contains("test_barrel_in"), "{error}");
    }
}
