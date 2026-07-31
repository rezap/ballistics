//! Game animal reference data: vitals geometry for shot-placement
//! assessment, plus general profile info (size, habitat, diet, fun facts)
//! for the web app's info panel.
//!
//! Figures are typical/approximate ranges compiled from hunting and
//! wildlife-biology sources — real animals vary by region, subspecies,
//! age, and individual condition, so treat these as reasonable defaults
//! rather than precise measurements. Sources are cited per species below.
//!
//! Only a couple of species are filled in so far; see `ROADMAP.md` Phase 3
//! for the full target list and how to add more (copy a `match` arm in
//! [`profile`], following the same shape).

use std::fmt;
use std::str::FromStr;

/// A supported game species.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum Species {
    WhitetailDeer,
    WildHog,
}

impl Species {
    /// All species with a filled-in [`AnimalProfile`] so far.
    pub const ALL: [Species; 2] = [Species::WhitetailDeer, Species::WildHog];
}

impl fmt::Display for Species {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

/// Returned by [`Species::from_str`] for an unrecognized name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseSpeciesError(String);

impl fmt::Display for ParseSpeciesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown species {:?}", self.0)
    }
}

impl std::error::Error for ParseSpeciesError {}

impl FromStr for Species {
    type Err = ParseSpeciesError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "WhitetailDeer" => Ok(Species::WhitetailDeer),
            "WildHog" => Ok(Species::WildHog),
            _ => Err(ParseSpeciesError(s.to_string())),
        }
    }
}

/// A typical size range for one sex of a species.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SizeRange {
    /// Height at the shoulder, inches.
    pub shoulder_height_in: (f64, f64),
    /// Live weight, pounds.
    pub weight_lb: (f64, f64),
}

/// The vital (heart/lung) zone, as seen from a broadside stance, used to
/// assess whether a given point of impact would be an ethical hit.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VitalZone {
    /// Width of the vital zone, inches.
    pub width_in: f64,
    /// Height of the vital zone, inches.
    pub height_in: f64,
}

/// Full reference profile for a species.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct AnimalProfile {
    pub species: Species,
    pub common_name: &'static str,
    pub scientific_name: &'static str,
    /// Label for an adult male (e.g. "Buck", "Boar").
    pub male_label: &'static str,
    /// Label for an adult female (e.g. "Doe", "Sow").
    pub female_label: &'static str,
    pub male: SizeRange,
    pub female: SizeRange,
    /// Typical body length, nose to base of tail, inches. Used by the
    /// frontend to scale its (hand-drawn, not traced from any photo)
    /// silhouette illustration to the vitals zone and impact marker.
    pub body_length_in: f64,
    pub vitals: VitalZone,
    pub habitat: &'static str,
    pub diet: &'static str,
    pub fun_facts: &'static [&'static str],
}

/// Whether a given miss distance from point of aim would still strike the
/// vital zone, modeled as an ellipse centered on point of aim.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HitAssessment {
    pub is_vitals_hit: bool,
    /// Fraction of the vitals ellipse's radius the impact point is from
    /// center (0 = dead center, 1 = right at the edge, >1 = outside).
    pub ellipse_distance: f64,
}

impl VitalZone {
    /// Assesses a shot with the given vertical and horizontal miss
    /// distances from point of aim (inches), assuming point of aim is
    /// held on the vitals' center.
    pub fn assess(&self, vertical_miss_in: f64, horizontal_miss_in: f64) -> HitAssessment {
        let half_width = self.width_in / 2.0;
        let half_height = self.height_in / 2.0;
        let ellipse_distance = ((horizontal_miss_in / half_width).powi(2)
            + (vertical_miss_in / half_height).powi(2))
        .sqrt();
        HitAssessment {
            is_vitals_hit: ellipse_distance <= 1.0,
            ellipse_distance,
        }
    }
}

/// Looks up the full reference profile for a species.
pub fn profile(species: Species) -> AnimalProfile {
    match species {
        // Shoulder height and weight: Realtree/onX/ammunitiontogo hunting
        // guides. Body length (nose to tail base): commonly cited as
        // 66-72 in (animaldiversity.org, esf.edu); using the midpoint.
        // Vital zone: commonly cited "8-10 inch" rule of thumb /
        // "14x10x10 in" kill zone box for whitetail deer, simplified to a
        // width x height ellipse behind the shoulder. Fun facts:
        // mentalfloss.com / facts.net whitetail deer roundups.
        Species::WhitetailDeer => AnimalProfile {
            species,
            common_name: "Whitetail Deer",
            scientific_name: "Odocoileus virginianus",
            male_label: "Buck",
            female_label: "Doe",
            male: SizeRange {
                shoulder_height_in: (37.0, 42.0),
                weight_lb: (150.0, 300.0),
            },
            female: SizeRange {
                shoulder_height_in: (36.0, 40.0),
                weight_lb: (90.0, 200.0),
            },
            body_length_in: 70.0,
            vitals: VitalZone {
                width_in: 9.0,
                height_in: 12.0,
            },
            habitat: "Forests, forest edges, agricultural fields, and brushy cover across most \
                      of North America; highly adaptable, including to suburban areas.",
            diet: "Herbivore: browses on leaves, twigs, acorns, forbs, and agricultural crops.",
            fun_facts: &[
                "Can run 35-40 mph and leap up to 30 ft horizontally or 7-10 ft vertically.",
                "Only bucks normally grow antlers - about 1 in 10,000 does grow small antlers too.",
            ],
        },

        // Shoulder height and weight: animals.net / a-z-animals.com wild
        // boar profiles (species-wide range, split roughly by sex from
        // reported average boar/sow weights). Body length (nose to tail
        // base): commonly cited as 60-72 in (biologyinsights.com,
        // openlearning.blog); using the midpoint. Vital zone: hunting
        // shot-placement guides (ammunitiontogo.com, sightmark.com) cite
        // an ~8 inch heart/lung area, positioned lower and more forward
        // than a deer's and shielded by cartilage on mature boars. Fun
        // facts: factanimal.com / facts.net wild boar roundups.
        Species::WildHog => AnimalProfile {
            species,
            common_name: "Wild Hog",
            scientific_name: "Sus scrofa",
            male_label: "Boar",
            female_label: "Sow",
            male: SizeRange {
                shoulder_height_in: (24.0, 38.0),
                weight_lb: (150.0, 300.0),
            },
            female: SizeRange {
                shoulder_height_in: (22.0, 34.0),
                weight_lb: (110.0, 180.0),
            },
            body_length_in: 66.0,
            vitals: VitalZone {
                width_in: 8.0,
                height_in: 8.0,
            },
            habitat: "Highly adaptable: bottomland hardwood forests, marshes, swamps, and \
                      agricultural land, usually near water and dense cover.",
            diet: "Omnivore and opportunistic feeder: grasses and forbs in spring, fruit in \
                   summer/fall, roots, tubers, and invertebrates year-round.",
            fun_facts: &[
                "Can run up to 30 mph despite their bulky build, and are strong swimmers.",
                "Highly intelligent - by some measures on par with or smarter than dogs.",
                "Vitals sit lower and further forward than a deer's, and mature boars grow a \
                 thick cartilage \"shield\" over the shoulder that can blunt a broadside shot - \
                 quartering-away shots are more reliable.",
            ],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_species_has_a_sane_profile() {
        for species in Species::ALL {
            let p = profile(species);
            assert_eq!(p.species, species);
            assert!(p.male.shoulder_height_in.0 < p.male.shoulder_height_in.1);
            assert!(p.male.weight_lb.0 < p.male.weight_lb.1);
            assert!(p.female.shoulder_height_in.0 < p.female.shoulder_height_in.1);
            assert!(p.female.weight_lb.0 < p.female.weight_lb.1);
            assert!(p.body_length_in > 0.0);
            assert!(p.vitals.width_in > 0.0);
            assert!(p.vitals.height_in > 0.0);
            assert!(!p.fun_facts.is_empty());
        }
    }

    #[test]
    fn species_display_and_parse_roundtrip() {
        for species in Species::ALL {
            let parsed: Species = species.to_string().parse().unwrap();
            assert_eq!(parsed, species);
        }
        assert!("NotASpecies".parse::<Species>().is_err());
    }

    #[test]
    fn assess_hit_center_of_vitals() {
        let vitals = VitalZone {
            width_in: 8.0,
            height_in: 10.0,
        };
        let assessment = vitals.assess(0.0, 0.0);
        assert!(assessment.is_vitals_hit);
        assert_eq!(assessment.ellipse_distance, 0.0);
    }

    #[test]
    fn assess_hit_at_edge_and_outside_vitals() {
        let vitals = VitalZone {
            width_in: 8.0,
            height_in: 10.0,
        };
        // Straight up by exactly half the height: right at the edge.
        let at_edge = vitals.assess(5.0, 0.0);
        assert!(at_edge.is_vitals_hit);
        assert!((at_edge.ellipse_distance - 1.0).abs() < 1e-9);

        // Well outside in both dimensions.
        let outside = vitals.assess(20.0, 20.0);
        assert!(!outside.is_vitals_hit);
        assert!(outside.ellipse_distance > 1.0);
    }
}
