/**
 * units.js — Physical constants and unit conversions
 *
 * All internal simulation units:
 *   Length : AU (astronomical unit)
 *   Time   : yr (Julian year = 365.25 days)
 *   Mass   : M_sun (solar mass)
 *
 * Derived: G = 4π² AU³ yr⁻² M_sun⁻¹  (exact in these units)
 */

export const G_AU_YR_MSUN = 4 * Math.PI * Math.PI; // AU³ yr⁻² M_sun⁻¹

// SI constants (for unit conversion only)
export const AU_M        = 1.495978707e11;  // metres per AU
export const YR_S        = 365.25 * 86400;  // seconds per Julian year
export const MSUN_KG     = 1.989e30;        // kg per solar mass
export const C_MS        = 2.99792458e8;    // speed of light m/s
export const RSUN_AU     = 0.00465047;      // solar radii per AU
export const REARTH_AU   = 4.2635e-5;       // Earth radii per AU
export const RJUP_AU     = 0.000477895;     // Jupiter radii per AU
export const MJUP_MSUN   = 0.000954588;     // Jupiter mass in solar masses

// Convert AU/yr to km/s
export const AU_YR_TO_KMS = AU_M / YR_S / 1000;

// Convert AU/yr to m/s
export const AU_YR_TO_MS = AU_M / YR_S;

/**
 * Kepler's third law: period in years given semi-major axis in AU and total mass in M_sun
 */
export function keplerPeriod(a_AU, M_total_Msun) {
  return Math.sqrt(a_AU ** 3 / M_total_Msun); // years
}

/**
 * Circular orbit speed in AU/yr
 */
export function circularSpeed(r_AU, M_central_Msun) {
  return Math.sqrt(G_AU_YR_MSUN * M_central_Msun / r_AU);
}
