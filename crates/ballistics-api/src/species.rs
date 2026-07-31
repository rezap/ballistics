//! Loads the game-species reference data served at `GET /api/animals`.
//!
//! The data is deliberately not compiled in. It lives alongside the
//! artwork in the static directory (`species.json`, plus the pixel
//! dimensions in `manifest.json` written by `scripts/prep_silhouettes.py`)
//! so that adding an animal is a data change - drop in a PNG, add an
//! entry, done - with no Rust or JavaScript to touch.
//!
//! The cost of that flexibility is losing the compiler's exhaustiveness
//! checking, so the loader validates aggressively and reports every
//! problem it finds at startup rather than serving quietly-wrong numbers.

use std::collections::BTreeMap;
use std::path::Path;

use ballistics_core::VitalZone;
use serde::{Deserialize, Serialize};

/// A typical adult size range for one sex.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct SizeRange {
    pub shoulder_height_in: (f64, f64),
    pub weight_lb: (f64, f64),
}

/// Where the vitals sit within the artwork, as a fraction of its size.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct VitalsAnchor {
    pub x: f64,
    pub y: f64,
}

/// One species as authored in `species.json`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct SpeciesEntry {
    common_name: String,
    scientific_name: String,
    male_label: String,
    female_label: String,
    male: SizeRange,
    female: SizeRange,
    body_length_in: f64,
    shoulder_height_in: f64,
    vitals: VitalZone,
    vitals_anchor: VitalsAnchor,
    habitat: String,
    diet: String,
    fun_facts: Vec<String>,
}

/// Pixel dimensions of a prepared silhouette, from `manifest.json`.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
struct ImageDims {
    width_px: u32,
    height_px: u32,
}

/// A species as served to the frontend: the authored data plus, when
/// artwork exists for it, the image path and its pixel dimensions.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AnimalProfile {
    pub key: String,
    pub common_name: String,
    pub scientific_name: String,
    pub male_label: String,
    pub female_label: String,
    pub male: SizeRange,
    pub female: SizeRange,
    pub body_length_in: f64,
    pub shoulder_height_in: f64,
    pub vitals: VitalZone,
    pub vitals_anchor: VitalsAnchor,
    pub habitat: String,
    pub diet: String,
    pub fun_facts: Vec<String>,
    /// `None` when no artwork has been prepared yet. The frontend still
    /// renders the species, just without a silhouette behind the overlay.
    pub image: Option<String>,
    pub image_width_px: Option<u32>,
    pub image_height_px: Option<u32>,
}

fn validate(key: &str, entry: &SpeciesEntry) -> Result<(), String> {
    let mut problems = Vec::new();

    let positive = |label: &str, value: f64, problems: &mut Vec<String>| {
        if !(value.is_finite() && value > 0.0) {
            problems.push(format!("{label} must be a positive, finite number"));
        }
    };

    positive("body_length_in", entry.body_length_in, &mut problems);
    positive(
        "shoulder_height_in",
        entry.shoulder_height_in,
        &mut problems,
    );
    positive("vitals.width_in", entry.vitals.width_in, &mut problems);
    positive("vitals.height_in", entry.vitals.height_in, &mut problems);

    for (label, range) in [("male", &entry.male), ("female", &entry.female)] {
        if range.shoulder_height_in.0 > range.shoulder_height_in.1 {
            problems.push(format!("{label}.shoulder_height_in is inverted"));
        }
        if range.weight_lb.0 > range.weight_lb.1 {
            problems.push(format!("{label}.weight_lb is inverted"));
        }
    }

    if !(0.0..=1.0).contains(&entry.vitals_anchor.x)
        || !(0.0..=1.0).contains(&entry.vitals_anchor.y)
    {
        problems.push("vitals_anchor x and y must be between 0 and 1".to_string());
    }

    if entry.fun_facts.is_empty() {
        problems.push("fun_facts must not be empty".to_string());
    }

    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!("{key}: {}", problems.join("; ")))
    }
}

/// Reads `species.json` and `manifest.json` from `static_dir/animals`.
///
/// Returns every species sorted by common name, or a list of every
/// validation problem found. Keys starting with `_` are treated as
/// comments so the data file can document itself.
pub fn load(static_dir: &Path) -> Result<Vec<AnimalProfile>, String> {
    let dir = static_dir.join("animals");
    let species_path = dir.join("species.json");
    let manifest_path = dir.join("manifest.json");

    let species_raw = std::fs::read_to_string(&species_path)
        .map_err(|err| format!("could not read {}: {err}", species_path.display()))?;
    let entries: BTreeMap<String, serde_json::Value> = serde_json::from_str(&species_raw)
        .map_err(|err| format!("{} is not valid JSON: {err}", species_path.display()))?;

    // The manifest is generated from the artwork, so treat it as optional:
    // species without prepared images should still be usable.
    let images: BTreeMap<String, ImageDims> = match std::fs::read_to_string(&manifest_path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|err| format!("{} is not valid JSON: {err}", manifest_path.display()))?,
        Err(_) => BTreeMap::new(),
    };

    let mut profiles = Vec::new();
    let mut problems = Vec::new();

    for (key, value) in entries {
        if key.starts_with('_') {
            continue;
        }

        let entry: SpeciesEntry = match serde_json::from_value(value) {
            Ok(entry) => entry,
            Err(err) => {
                problems.push(format!("{key}: {err}"));
                continue;
            }
        };

        if let Err(problem) = validate(&key, &entry) {
            problems.push(problem);
            continue;
        }

        let dims = images.get(&key);
        profiles.push(AnimalProfile {
            image: dims.map(|_| format!("animals/{key}.png")),
            image_width_px: dims.map(|d| d.width_px),
            image_height_px: dims.map(|d| d.height_px),
            key,
            common_name: entry.common_name,
            scientific_name: entry.scientific_name,
            male_label: entry.male_label,
            female_label: entry.female_label,
            male: entry.male,
            female: entry.female,
            body_length_in: entry.body_length_in,
            shoulder_height_in: entry.shoulder_height_in,
            vitals: entry.vitals,
            vitals_anchor: entry.vitals_anchor,
            habitat: entry.habitat,
            diet: entry.diet,
            fun_facts: entry.fun_facts,
        });
    }

    if !problems.is_empty() {
        return Err(problems.join("\n"));
    }

    profiles.sort_by(|a, b| a.common_name.cmp(&b.common_name));
    Ok(profiles)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn static_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("static")
    }

    #[test]
    fn ships_valid_species_data() {
        let profiles = load(&static_dir()).expect("bundled species.json should be valid");
        assert!(!profiles.is_empty(), "expected at least one species");

        for profile in &profiles {
            assert!(profile.body_length_in > 0.0);
            assert!(profile.vitals.width_in > 0.0);
            assert!(!profile.fun_facts.is_empty());
        }
    }

    #[test]
    fn every_shipped_species_has_prepared_artwork() {
        // Not a hard requirement of the loader - a species without art is
        // still served - but everything we ship should have been through
        // the prep script, so a missing image means a forgotten step.
        let profiles = load(&static_dir()).unwrap();
        let missing: Vec<_> = profiles
            .iter()
            .filter(|p| p.image.is_none())
            .map(|p| p.key.as_str())
            .collect();
        assert!(missing.is_empty(), "no prepared artwork for: {missing:?}");
    }

    #[test]
    fn image_paths_point_at_files_that_exist() {
        let dir = static_dir();
        for profile in load(&dir).unwrap() {
            if let Some(image) = &profile.image {
                let path = dir.join(image);
                assert!(path.is_file(), "missing image file: {}", path.display());
            }
        }
    }

    #[test]
    fn rejects_an_invalid_entry() {
        let entry: SpeciesEntry = serde_json::from_value(serde_json::json!({
            "common_name": "Broken",
            "scientific_name": "Nonexistus",
            "male_label": "M",
            "female_label": "F",
            "male": { "shoulder_height_in": [10, 20], "weight_lb": [10, 20] },
            "female": { "shoulder_height_in": [10, 20], "weight_lb": [10, 20] },
            "body_length_in": 0,
            "shoulder_height_in": 10,
            "vitals": { "width_in": 5, "height_in": 5 },
            "vitals_anchor": { "x": 1.7, "y": 0.5 },
            "habitat": "nowhere",
            "diet": "nothing",
            "fun_facts": []
        }))
        .unwrap();

        let error = validate("broken", &entry).unwrap_err();
        assert!(error.contains("body_length_in"), "{error}");
        assert!(error.contains("vitals_anchor"), "{error}");
        assert!(error.contains("fun_facts"), "{error}");
    }
}
