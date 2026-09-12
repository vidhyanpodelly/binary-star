/**
 * photometry.js — Synthetic photometry pipeline
 *
 * Computes normalized flux from the binary+planet system as seen by a distant
 * observer along the +z axis.
 *
 * Physics:
 *  - Limb-darkened stellar discs (quadratic law)
 *  - Geometrically correct eclipse/transit overlap integrals
 *  - Depth ordering by z-coordinate (body with larger z is closer to observer)
 *  - Planet transits: planet blocks stellar light (planet is dark)
 *  - Binary eclipses: one star occults the other
 *
 * Reference: Mandel & Agol 2002 (analytic transit model);
 *            Claret 2000 (limb darkening coefficients)
 */

// Quadratic limb darkening coefficients for K/M dwarfs (Claret 2000, Kepler band)
// u1 + u2 < 1 required for physical limb darkening
const LD_A = { u1: 0.40, u2: 0.25 }; // Star A (K dwarf, Teff~4450K)
const LD_B = { u1: 0.55, u2: 0.20 }; // Star B (M dwarf, Teff~3311K)

/**
 * Quadratic limb darkening: I(mu)/I(1) = 1 - u1*(1-mu) - u2*(1-mu)²
 * mu = cos(theta) = sqrt(1 - (r/R)²) for a point at projected radius r from center
 */
function limbDarkening(r_norm, u1, u2) {
  // r_norm = r/R ∈ [0,1]
  if (r_norm >= 1) return 0;
  const mu = Math.sqrt(1 - r_norm * r_norm);
  return 1 - u1 * (1 - mu) - u2 * (1 - mu) ** 2;
}

/**
 * Integrated flux of a limb-darkened disc (analytic).
 * F = π R² * [1 - u1/3 - u2/6]  (normalized to I(1)=1)
 * Returns the total flux in units of π R²
 */
function discFlux(R, u1, u2) {
  return Math.PI * R * R * (1 - u1/3 - u2/6);
}

/**
 * Area of intersection of two circles with radii r1, r2 and center separation d.
 * Returns 0 if no overlap, π*min(r1,r2)² if fully inside.
 */
function circleIntersectionArea(r1, r2, d) {
  if (d >= r1 + r2) return 0;                    // no overlap
  if (d + r2 <= r1) return Math.PI * r2 * r2;   // r2 fully inside r1
  if (d + r1 <= r2) return Math.PI * r1 * r1;   // r1 fully inside r2

  const d1 = (r1*r1 - r2*r2 + d*d) / (2*d);
  const d2 = d - d1;
  const h1 = Math.sqrt(Math.max(0, r1*r1 - d1*d1));
  const h2 = Math.sqrt(Math.max(0, r2*r2 - d2*d2));

  const A1 = r1*r1 * Math.acos(Math.min(1, Math.max(-1, d1/r1))) - d1*h1;
  const A2 = r2*r2 * Math.acos(Math.min(1, Math.max(-1, d2/r2))) - d2*h2;
  return A1 + A2;
}

/**
 * Compute the fractional flux lost when a dark disc (occulter) of radius r_occ
 * passes in front of a limb-darkened stellar disc of radius R_star.
 * d = projected center-to-center distance.
 *
 * Uses a numerical integration over the overlap region weighted by limb darkening.
 * For speed, uses the analytic approximation: uniform-disc area × mean LD weight.
 *
 * @returns {number} fractional flux blocked ∈ [0, 1]
 */
function occultedFlux(R_star, r_occ, d, u1, u2) {
  const overlapArea = circleIntersectionArea(R_star, r_occ, d);
  if (overlapArea === 0) return 0;

  // Approximate mean limb darkening over overlap region
  // Use the LD value at the projected distance of the occulter center from star center
  const r_norm = Math.min(d / R_star, 0.999);
  const ldMean = limbDarkening(r_norm, u1, u2);

  const totalFlux = discFlux(R_star, u1, u2);
  const blockedFlux = overlapArea * ldMean;
  return Math.min(1, blockedFlux / totalFlux);
}

/**
 * Compute normalized system flux at a given simulation state.
 *
 * @param {number[]} state  - 18-element state vector [x1,y1,z1,vx1,vy1,vz1, ...]
 * @param {object}   starA  - { radius, luminosity, ... }
 * @param {object}   starB  - { radius, luminosity, ... }
 * @param {object}   planet - { radius, ... }
 * @returns {number} normalized flux (1.0 = no eclipse/transit)
 */
export function computeFlux(state, starA, starB, planet) {
  // Positions (x,y = sky plane; z = line of sight, larger z = closer to observer)
  const xA = state[0],  yA = state[1],  zA = state[2];
  const xB = state[6],  yB = state[7],  zB = state[8];
  const xP = state[12], yP = state[13], zP = state[14];

  const RA = starA.radius;
  const RB = starB.radius;
  const RP = planet.radius;
  const LA = starA.luminosity;
  const LB = starB.luminosity;
  const Ltot = LA + LB;

  // Baseline flux (normalized)
  let fluxA = LA / Ltot;
  let fluxB = LB / Ltot;

  // ── Binary eclipses ────────────────────────────────────────────────────────
  const dAB = Math.sqrt((xA-xB)**2 + (yA-yB)**2); // projected separation

  if (dAB < RA + RB) {
    // Determine which star is in front (larger z = closer to observer)
    if (zA > zB) {
      // Star A is in front: A occults B
      const frac = occultedFlux(RB, RA, dAB, LD_B.u1, LD_B.u2);
      fluxB *= (1 - frac);
    } else {
      // Star B is in front: B occults A
      const frac = occultedFlux(RA, RB, dAB, LD_A.u1, LD_A.u2);
      fluxA *= (1 - frac);
    }
  }

  // ── Planet transits ────────────────────────────────────────────────────────
  // Planet transits star A when planet is closer to observer (larger z) AND
  // projected separation is within sum of radii.
  const dPA = Math.sqrt((xP-xA)**2 + (yP-yA)**2);
  if (dPA < RA + RP && zP > zA) {
    // Planet is in front of star A (planet closer to observer = larger z)
    const frac = occultedFlux(RA, RP, dPA, LD_A.u1, LD_A.u2);
    fluxA *= (1 - frac);
  }

  // Planet transits star B
  const dPB = Math.sqrt((xP-xB)**2 + (yP-yB)**2);
  if (dPB < RB + RP && zP > zB) {
    const frac = occultedFlux(RB, RP, dPB, LD_B.u1, LD_B.u2);
    fluxB *= (1 - frac);
  }

  return fluxA + fluxB;
}

/**
 * Compute transit depth for a planet of radius RP transiting a star of radius RS
 * with quadratic limb darkening, at impact parameter b (in units of RS).
 * Returns fractional depth (0 to 1).
 */
export function transitDepth(RP, RS, b, u1, u2) {
  const d = b * RS;
  return occultedFlux(RS, RP, d, u1, u2);
}

export { LD_A, LD_B, discFlux, circleIntersectionArea };
