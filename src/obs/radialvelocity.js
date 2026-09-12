/**
 * radialvelocity.js — Radial velocity (line-of-sight velocity) pipeline
 *
 * The observer is along the +z axis. The line-of-sight (LOS) velocity
 * of a body is its z-component of velocity (positive = receding from observer).
 *
 * We model the MEASURED radial velocity as the luminosity-weighted combination
 * of the two stellar spectra. In practice, cross-correlation of the composite
 * spectrum yields a blended velocity; for a well-separated binary we can
 * measure each star's velocity independently.
 *
 * For this simulation we provide:
 *   1. Individual stellar LOS velocities (vz_A, vz_B) — what a spectrograph
 *      resolving both components would measure.
 *   2. The binary barycenter LOS velocity (derived from known mass ratio).
 *
 * Units: AU/yr internally; converted to km/s for output.
 *
 * RV amplitude for Kepler-16 analog:
 *   K_A ≈ (2π/P_bin) * (mB/(mA+mB)) * aBin * sin(i) / sqrt(1-e²)
 *   K_A ≈ 2π/0.1124 * (0.2026/0.8923) * 0.2244 * 1.0 / sqrt(1-0.1592²)
 *       ≈ 55.9 * 0.227 * 0.2244 / 0.9872 ≈ 2.89 AU/yr ≈ 13.7 km/s
 *   K_B ≈ K_A * mA/mB ≈ 13.7 * 3.40 ≈ 46.6 km/s
 *
 * Planet-induced RV on binary barycenter:
 *   K_bary ≈ (2π/P_planet) * (mP/(mBin+mP)) * aPlanet * sin(i)
 *           ≈ 2π/0.6275 * (1.05e-4/0.8923) * 0.7048
 *           ≈ 10.01 * 1.177e-4 * 0.7048 ≈ 8.3e-4 AU/yr ≈ 0.0039 km/s ≈ 3.9 m/s
 *
 * This is below typical spectrograph precision (~10 m/s), making direct
 * planet detection via RV very challenging — consistent with Kepler-16.
 * We use the binary stellar RVs as the primary observable.
 */

import { AU_YR_TO_KMS } from '../physics/units.js';

/**
 * Compute radial velocities of all bodies at a given state.
 *
 * @param {number[]} state  - 18-element state vector
 * @returns {{ vzA_kms, vzB_kms, vzP_kms, vzBary_kms }}
 *   All in km/s. Positive = receding (redshift).
 */
export function computeRV(state, masses) {
  const vzA = state[5];   // AU/yr
  const vzB = state[11];
  const vzP = state[17];

  const [mA, mB, mP] = masses;
  const mBin = mA + mB;
  const mTot = mA + mB + mP;

  // Binary barycenter velocity (derived from individual stellar velocities)
  const vzBary = (mA * vzA + mB * vzB) / mBin;

  // System CoM velocity (should be ~0 in CoM frame)
  const vzCoM = (mA * vzA + mB * vzB + mP * vzP) / mTot;

  return {
    vzA_kms:    vzA    * AU_YR_TO_KMS,
    vzB_kms:    vzB    * AU_YR_TO_KMS,
    vzP_kms:    vzP    * AU_YR_TO_KMS,
    vzBary_kms: vzBary * AU_YR_TO_KMS,
    vzCoM_kms:  vzCoM  * AU_YR_TO_KMS,
  };
}

/**
 * Expected RV semi-amplitude for star A due to binary orbit (km/s).
 * Analytic formula for Keplerian orbit.
 */
export function rvAmplitudeA(mA, mB, aBin, eBin, incBin) {
  const mBin = mA + mB;
  const P = Math.sqrt(aBin**3 / mBin); // yr (Kepler's 3rd law, G=4π²)
  // K = (2π/P) * (mB/mBin) * aBin * sin(i) / sqrt(1-e²)
  const K = (2 * Math.PI / P) * (mB / mBin) * aBin * Math.sin(incBin) / Math.sqrt(1 - eBin**2);
  return K * AU_YR_TO_KMS;
}

/**
 * Expected RV semi-amplitude for star B due to binary orbit (km/s).
 */
export function rvAmplitudeB(mA, mB, aBin, eBin, incBin) {
  const mBin = mA + mB;
  const P = Math.sqrt(aBin**3 / mBin);
  const K = (2 * Math.PI / P) * (mA / mBin) * aBin * Math.sin(incBin) / Math.sqrt(1 - eBin**2);
  return K * AU_YR_TO_KMS;
}

/**
 * Expected RV semi-amplitude of binary barycenter due to planet (km/s).
 */
export function rvAmplitudePlanet(mA, mB, mP, aPlanet, ePlanet, incPlanet) {
  const mBin = mA + mB;
  const P = Math.sqrt(aPlanet**3 / mBin);
  const K = (2 * Math.PI / P) * (mP / (mBin + mP)) * aPlanet * Math.sin(incPlanet) / Math.sqrt(1 - ePlanet**2);
  return K * AU_YR_TO_KMS;
}
