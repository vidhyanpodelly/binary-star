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

import { keplerPeriod, RSUN_AU, RJUP_AU, MJUP_MSUN } from './units.js';

// ── Default Stellar parameters (Immutable internal definitions) ───────────────
const STAR_A_DEF = Object.freeze({
  mass:       0.6897,          // M_sun
  radius:     0.6489 * RSUN_AU, // AU  (Kepler-16A: 0.6489 R_sun)
  luminosity: 0.1569,          // L_sun (Teff ≈ 4450 K)
  Teff:       4450,            // K
  color:      '#ffb347',       // warm orange-yellow (K dwarf)
  name:       'Star A',
});

const STAR_B_DEF = Object.freeze({
  mass:       0.2026,          // M_sun
  radius:     0.2262 * RSUN_AU, // AU  (Kepler-16B: 0.2262 R_sun)
  luminosity: 0.0041,          // L_sun (Teff ≈ 3311 K)
  Teff:       3311,            // K
  color:      '#ff6b35',       // cool red-orange (M dwarf — NOT blue-white)
  name:       'Star B',
});

const PLANET_DEF = Object.freeze({
  mass:       0.333 * MJUP_MSUN,  // M_sun (≈ 0.333 M_Jupiter)
  radius:     0.7538 * RJUP_AU,   // AU  (Kepler-16b: 0.7538 R_Jupiter)
  albedo:     0.35,
  color:      '#4a9eff',       // blue-grey gas giant
  name:       'Planet (hidden)',
});

// ── Default Orbital parameters ───────────────────────────────────────────────
const BINARY_ORBIT_DEF = Object.freeze({
  a:     0.2244,   // AU
  e:     0.1592,   // eccentricity
  inc:   Math.PI/2 - 0.0031,  // rad (nearly edge-on, 89.82°)
  omega: 0.0,      // argument of periapsis [rad]
});

const PLANET_ORBIT_DEF = Object.freeze({
  a:     0.7048,   // AU
  e:     0.0069,   // nearly circular
  inc:   Math.PI/2 - 0.0035,  // rad (nearly edge-on, 89.80°)
  omega: 0.0,      // argument of periapsis [rad]
});

// ── Stability criterion (Holman & Wiegert 1999) ───────────────────────────────
// a_crit ≈ aBin * (1.60 + 5.10*e + (-2.22)*e² + 4.12*mu - 4.27*e*mu - 5.09*mu² + 4.61*e²*mu²)
// where mu = mB/(mA+mB)
export function holmanWiegertCrit(aBin, eBin, mA, mB) {
  const mu = mB / (mA + mB);
  return aBin * (1.60 + 5.10*eBin - 2.22*eBin**2 + 4.12*mu - 4.27*eBin*mu - 5.09*mu**2 + 4.61*eBin**2*mu**2);
}

/**
 * Build an independent, immutable configuration snapshot for one simulation
 * run. Values are in the simulation's canonical units (AU, yr, M_sun), with
 * noise in ppm and m/s.
 */
export function createSystemConfig(overrides = {}) {
  // Alias support for URL parameters
  if (overrides.aPlan !== undefined) overrides.aPlanet = overrides.aPlan;
  if (overrides.mPlan !== undefined) overrides.mP = overrides.mPlan;
  if (overrides.mPlanet !== undefined) overrides.mP = overrides.mPlanet;

  const base = {
    mA: STAR_A_DEF.mass, mB: STAR_B_DEF.mass, mP: PLANET_DEF.mass,
    rA: STAR_A_DEF.radius, rB: STAR_B_DEF.radius, rP: PLANET_DEF.radius,
    aBin: BINARY_ORBIT_DEF.a, aPlanet: PLANET_ORBIT_DEF.a,
    eBin: BINARY_ORBIT_DEF.e, ePlanet: PLANET_ORBIT_DEF.e,
    incBin: BINARY_ORBIT_DEF.inc, incPlanet: PLANET_ORBIT_DEF.inc,
    omegaBin: BINARY_ORBIT_DEF.omega, omegaPlanet: PLANET_ORBIT_DEF.omega,
    photSigmaPPM: 200, rvSigmaMS: 30,
  };
  const p = { ...base, ...overrides };
  if (p.phasePlanet !== undefined && overrides.omegaPlanet === undefined) p.omegaPlanet = p.phasePlanet;
  p.phasePlanet = p.omegaPlanet;
  const P_BIN_run = keplerPeriod(p.aBin, p.mA + p.mB);
  const P_PLANET_run = keplerPeriod(p.aPlanet, p.mA + p.mB);
  return Object.freeze({
    ...p,
    P_BIN: P_BIN_run,
    P_PLANET: P_PLANET_run,
    A_CRIT: holmanWiegertCrit(p.aBin, p.eBin, p.mA, p.mB),
    starA: Object.freeze({ ...STAR_A_DEF, mass: p.mA, radius: p.rA }),
    starB: Object.freeze({ ...STAR_B_DEF, mass: p.mB, radius: p.rB }),
    planet: Object.freeze({ ...PLANET_DEF, mass: p.mP, radius: p.rP }),
  });
}

// ── Observer direction ────────────────────────────────────────────────────────
// Observer is along +z axis. Line-of-sight velocity = vz component.
// Eclipse/transit occurs when bodies are aligned in x-y plane (small |z| separation).
export const OBSERVER_DIR = [0, 0, 1]; // unit vector toward observer

// ── Roche Lobe Approximation (Eggleton 1983) ───────────────────────────────────
// q = M1 / M2 (mass ratio). Returns rL / a.
export function eggletonRocheLobe(q) {
  const q13 = Math.pow(q, 1/3);
  const q23 = Math.pow(q, 2/3);
  return (0.49 * q23) / (0.6 * q23 + Math.log(1 + q13));
}

// ── Configuration Validation ──────────────────────────────────────────────────
/**
 * Validates a system configuration for physical consistency.
 * If history (N-body trajectory) is provided, uses 3D distances from the integration.
 * Otherwise, uses Keplerian approximations.
 * 
 * Returns { status: 'VALID'|'WARNING'|'INVALID', message: string, details: object }
 */
export function validateConfiguration(config, history = null) {
  const { mA, mB, rA, rB, rP, aBin, eBin, aPlanet } = config;
  const A_CRIT = config.A_CRIT || holmanWiegertCrit(aBin, eBin, mA, mB);
  
  let min_dAB = aBin * (1 - eBin); // Keplerian periastron
  let min_dAP = aPlanet - aBin;    // Very rough approximation for Keplerian
  let min_dBP = aPlanet - aBin;
  let t_col = null;

  if (history && history.length > 0) {
    min_dAB = Infinity;
    min_dAP = Infinity;
    min_dBP = Infinity;
    
    for (let i = 0; i < history.length; i++) {
      const state = history[i].state;
      const t = history[i].t;
      // state: [xA,yA,zA, vxA,vyA,vzA, xB,yB,zB, vxB,vyB,vzB, xP,yP,zP, vxP,vyP,vzP]
      const dAB = Math.hypot(state[0]-state[6], state[1]-state[7], state[2]-state[8]);
      const dAP = Math.hypot(state[0]-state[12], state[1]-state[13], state[2]-state[14]);
      const dBP = Math.hypot(state[6]-state[12], state[7]-state[13], state[8]-state[14]);
      
      if (dAB < min_dAB) { min_dAB = dAB; if (dAB <= rA + rB && t_col === null) t_col = t; }
      if (dAP < min_dAP) { min_dAP = dAP; if (dAP <= rA + rP && t_col === null) t_col = t; }
      if (dBP < min_dBP) { min_dBP = dBP; if (dBP <= rB + rP && t_col === null) t_col = t; }
    }
  }

  // 1. Surface Intersection (Collision)
  if (min_dAB <= rA + rB) {
    return {
      status: 'WARNING',
      message: `STELLAR COLLISION POSSIBLE\nMinimum separation: ${min_dAB.toFixed(4)} AU\nPhysical radii sum: ${(rA+rB).toFixed(4)} AU` + (t_col !== null ? `\nDetected at t = ${t_col.toFixed(2)} yr` : ''),
      type: 'collision_stars'
    };
  }
  if (min_dAP <= rA + rP || min_dBP <= rB + rP) {
    const minP = Math.min(min_dAP, min_dBP);
    const sumP = min_dAP < min_dBP ? rA + rP : rB + rP;
    return {
      status: 'WARNING',
      message: `PLANET COLLISION POSSIBLE\nTrajectory intersects stellar surface.\nMinimum separation: ${minP.toFixed(4)} AU\nRadii sum: ${sumP.toFixed(4)} AU` + (t_col !== null ? `\nDetected at t = ${t_col.toFixed(2)} yr` : ''),
      type: 'collision_planet'
    };
  }

  // 2. Roche-lobe overflow
  const qA = mA / mB;
  const qB = mB / mA;
  const rL_A = min_dAB * eggletonRocheLobe(qA);
  const rL_B = min_dAB * eggletonRocheLobe(qB);
  
  if (rA >= rL_A || rB >= rL_B) {
    return {
      status: 'INVALID',
      message: `ROCHE-LOBE OVERFLOW\nConfiguration is not a detached binary.\nMinimum separation: ${min_dAB.toFixed(4)} AU`,
      type: 'roche_overflow'
    };
  }
  if (rA >= rL_A * 0.9 || rB >= rL_B * 0.9) {
    return {
      status: 'WARNING',
      message: 'Near Roche limit',
      type: 'roche_warning'
    };
  }
  if (min_dAB <= (rA + rB) * 1.5) {
    return {
      status: 'WARNING',
      message: 'Near stellar-surface intersection',
      type: 'surface_warning'
    };
  }

  // 3. Circumbinary Orbital Stability
  if (aPlanet < A_CRIT) {
    return {
      status: 'INVALID',
      message: `PLANETARY ORBIT UNSTABLE\nOrbit inside circumbinary stability boundary.\na_planet = ${aPlanet.toFixed(3)} AU < a_crit = ${A_CRIT.toFixed(3)} AU`,
      type: 'stability_invalid'
    };
  }
  if (aPlanet < A_CRIT * 1.1) {
    return {
      status: 'WARNING',
      message: 'Dynamically marginal',
      type: 'stability_warning'
    };
  }

  const isNonStandard = Math.abs(mA - 0.6897) > 0.05 || Math.abs(mB - 0.2026) > 0.05 || Math.abs(rA - (0.6489 * 0.00465)) > 0.001 || Math.abs(rB - (0.2262 * 0.00465)) > 0.001;

  return {
    status: 'VALID',
    message: isNonStandard ? 'NONSTANDARD / TOY STELLAR CONFIGURATION' : 'Detached',
    type: 'valid'
  };
}