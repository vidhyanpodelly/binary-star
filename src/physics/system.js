/**
 * system.js — Canonical Kepler-16-analog system parameters
 *
 * Kepler-16 reference:
 *   Doyle et al. 2011, Science 333, 1602
 *   mA = 0.6897 M_sun, mB = 0.2026 M_sun
 *   aBin = 0.2244 AU, Pbin ≈ 41.08 days
 *   aPlanet = 0.7048 AU, Pplanet ≈ 228.78 days
 *   Planet mass ≈ 0.333 M_Jupiter ≈ 1.05e-4 M_sun
 *
 * We use slightly rounded values for clarity and set inclinations
 * to produce observable eclipses and transits from Earth's direction (+z).
 *
 * Observer direction: +z axis (line of sight from system to observer).
 * Orbital planes are nearly edge-on (inclination ≈ π/2) so eclipses occur.
 */

import { keplerPeriod, RSUN_AU } from './units.js';

// ── Stellar parameters ────────────────────────────────────────────────────────
export const STAR_A = {
  mass:       0.6897,          // M_sun
  radius:     0.6489 * RSUN_AU, // AU  (Kepler-16A: 0.6489 R_sun)
  luminosity: 0.1569,          // L_sun (Teff ≈ 4450 K)
  Teff:       4450,            // K
  color:      '#ffb347',       // warm orange-yellow (K dwarf)
  name:       'Star A',
};

export const STAR_B = {
  mass:       0.2026,          // M_sun
  radius:     0.2262 * RSUN_AU, // AU  (Kepler-16B: 0.2262 R_sun)
  luminosity: 0.0041,          // L_sun (Teff ≈ 3311 K)
  Teff:       3311,            // K
  color:      '#ff6b35',       // cool red-orange (M dwarf — NOT blue-white)
  name:       'Star B',
};

export const PLANET = {
  mass:       1.05e-4,         // M_sun (≈ 0.333 M_Jupiter)
  radius:     0.7538 * 4.2635e-5, // AU  (Kepler-16b: 0.7538 R_Jupiter)
  albedo:     0.35,
  color:      '#4a9eff',       // blue-grey gas giant
  name:       'Planet (hidden)',
};

// ── Orbital parameters ────────────────────────────────────────────────────────
export const BINARY_ORBIT = {
  a:     0.2244,   // AU
  e:     0.1592,   // eccentricity
  inc:   Math.PI/2 - 0.0031,  // rad (nearly edge-on, 89.82°)
  omega: 0.0,      // argument of periapsis [rad]
};

export const PLANET_ORBIT = {
  a:     0.7048,   // AU
  e:     0.0069,   // nearly circular
  inc:   Math.PI/2 - 0.0035,  // rad (nearly edge-on, 89.80°)
  omega: 0.0,      // argument of periapsis [rad]
};

// ── Derived periods ───────────────────────────────────────────────────────────
export const P_BIN    = keplerPeriod(BINARY_ORBIT.a, STAR_A.mass + STAR_B.mass); // yr
export const P_PLANET = keplerPeriod(PLANET_ORBIT.a, STAR_A.mass + STAR_B.mass); // yr

// ── Stability criterion (Holman & Wiegert 1999) ───────────────────────────────
// a_crit ≈ aBin * (1.60 + 5.10*e + (-2.22)*e² + 4.12*mu - 4.27*e*mu - 5.09*mu² + 4.61*e²*mu²)
// where mu = mB/(mA+mB)
export function holmanWiegertCrit(aBin, eBin, mA, mB) {
  const mu = mB / (mA + mB);
  return aBin * (1.60 + 5.10*eBin - 2.22*eBin**2 + 4.12*mu - 4.27*eBin*mu - 5.09*mu**2 + 4.61*eBin**2*mu**2);
}

export const A_CRIT = holmanWiegertCrit(BINARY_ORBIT.a, BINARY_ORBIT.e, STAR_A.mass, STAR_B.mass);

// ── Build system params object for nbody.buildInitialConditions ───────────────
export function getSystemParams() {
  return {
    mA:          STAR_A.mass,
    mB:          STAR_B.mass,
    mP:          PLANET.mass,
    aBin:        BINARY_ORBIT.a,
    aPlanet:     PLANET_ORBIT.a,
    eBin:        BINARY_ORBIT.e,
    ePlanet:     PLANET_ORBIT.e,
    incBin:      BINARY_ORBIT.inc,
    incPlanet:   PLANET_ORBIT.inc,
    omegaBin:    BINARY_ORBIT.omega,
    omegaPlanet: PLANET_ORBIT.omega,
  };
}

// ── Observer direction ────────────────────────────────────────────────────────
// Observer is along +z axis. Line-of-sight velocity = vz component.
// Eclipse/transit occurs when bodies are aligned in x-y plane (small |z| separation).
export const OBSERVER_DIR = [0, 0, 1]; // unit vector toward observer
