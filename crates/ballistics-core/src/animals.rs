//! Vital-zone geometry for shot-placement assessment.
//!
//! The per-species reference data (sizes, habitat, diet, artwork) is not
//! here: it lives in `crates/ballistics-api/static/animals/species.json`
//! so that adding an animal needs no code change. What stays in the engine
//! is the part that is actual logic rather than data - deciding whether a
//! given point of impact falls inside the vitals.

/// The vital (heart/lung) zone, as seen from a broadside stance.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct VitalZone {
    /// Width of the vital zone, inches.
    pub width_in: f64,
    /// Height of the vital zone, inches.
    pub height_in: f64,
}

/// Whether a given point of impact would strike the vital zone.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HitAssessment {
    pub is_vitals_hit: bool,
    /// How far the impact sits from the vitals' centre, as a fraction of
    /// the zone's radius in that direction (0 = dead centre, 1 = right on
    /// the edge, > 1 = outside).
    pub ellipse_distance: f64,
}

impl VitalZone {
    /// Assesses a shot with the given vertical and horizontal miss
    /// distances from point of aim (inches), assuming point of aim is
    /// held on the vitals' centre.
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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn assess_scales_with_zone_size() {
        // The same miss is a hit on a big animal and a miss on a small one.
        let elk = VitalZone {
            width_in: 14.0,
            height_in: 16.0,
        };
        let fox = VitalZone {
            width_in: 4.0,
            height_in: 4.0,
        };
        assert!(elk.assess(5.0, 0.0).is_vitals_hit);
        assert!(!fox.assess(5.0, 0.0).is_vitals_hit);
    }
}
