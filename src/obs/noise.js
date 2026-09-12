/**
 * noise.js — Realistic noise models for synthetic observations
 *
 * Photometry noise:
 *   - Shot noise (Poisson): σ_shot ∝ 1/√(flux × N_photons)
 *   - Systematic floor: σ_sys (instrumental, stellar variability)
 *   - Combined: σ_total = sqrt(σ_shot² + σ_sys²)
 *   - Typical Kepler: σ_phot ≈ 100-300 ppm per 30-min cadence for bright stars
 *
 * RV noise:
 *   - Spectrograph precision: σ_RV ≈ 10-50 m/s (typical ground-based)
 *   - Stellar jitter: σ_jitter ≈ 5-20 m/s (activity, pulsations)
 *   - Combined: σ_RV_total = sqrt(σ_spec² + σ_jitter²)
 *
 * All noise is Gaussian (additive) with the given σ.
 * Uses Box-Muller transform for Gaussian random numbers.
 */

/**
 * Box-Muller transform: generate standard normal random variable.
 * @returns {number} N(0,1)
 */
export function randn() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generate array of n Gaussian random numbers with mean 0, std sigma.
 */
export function gaussianNoise(n, sigma) {
  return Array.from({ length: n }, () => randn() * sigma);
}

/**
 * Photometric noise model.
 * @param {number} flux_normalized  - normalized flux (≈1.0)
 * @param {number} sigma_ppm        - noise level in parts per million
 * @returns {number} noise realization
 */
export function photNoise(flux_normalized, sigma_ppm) {
  return randn() * sigma_ppm * 1e-6;
}

/**
 * Add photometric noise to a flux array.
 * @param {number[]} fluxes       - array of normalized fluxes
 * @param {number}   sigma_ppm    - noise level in ppm
 * @returns {number[]} noisy fluxes
 */
export function addPhotNoise(fluxes, sigma_ppm) {
  return fluxes.map(f => f + photNoise(f, sigma_ppm));
}

/**
 * RV noise model.
 * @param {number} sigma_ms  - total RV noise in m/s
 * @returns {number} noise realization in km/s
 */
export function rvNoise(sigma_ms) {
  return randn() * sigma_ms / 1000; // convert m/s to km/s
}

/**
 * Add RV noise to an array of velocities (km/s).
 * @param {number[]} rvs       - array of RV values in km/s
 * @param {number}   sigma_ms  - noise in m/s
 * @returns {number[]} noisy RVs in km/s
 */
export function addRVNoise(rvs, sigma_ms) {
  return rvs.map(v => v + rvNoise(sigma_ms));
}

/**
 * Compute noise standard deviation for photometry.
 * @param {number} sigma_ppm - noise level in ppm
 * @returns {number} sigma in normalized flux units
 */
export function photSigma(sigma_ppm) {
  return sigma_ppm * 1e-6;
}

/**
 * Compute noise standard deviation for RV.
 * @param {number} sigma_ms - noise in m/s
 * @returns {number} sigma in km/s
 */
export function rvSigma(sigma_ms) {
  return sigma_ms / 1000;
}

// ── Default noise levels ──────────────────────────────────────────────────────
// Kepler-like photometry: 200 ppm per cadence
export const DEFAULT_PHOT_SIGMA_PPM = 200;

// Ground-based spectrograph: 30 m/s total (instrument + jitter)
export const DEFAULT_RV_SIGMA_MS = 30;
