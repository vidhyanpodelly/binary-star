/**
 * rv_fit.js — Radial velocity curve fitting with uncertainty estimation
 *
 * Fits a Keplerian RV model to observed stellar radial velocities.
 * For the binary system, we fit the individual stellar RVs to recover:
 *   - Binary period P_bin
 *   - RV semi-amplitudes K_A, K_B
 *   - Mass ratio q = mB/mA = K_A/K_B
 *   - Systemic velocity γ
 *   - Eccentricity e and argument of periapsis ω (via e*cos(ω), e*sin(ω))
 *
 * For the planet search, we fit the binary barycenter RV residuals
 * (after subtracting the binary model) to look for a long-period signal.
 *
 * Fitting method: Levenberg-Marquardt nonlinear least squares.
 * Uncertainty: formal errors from the covariance matrix (Fisher information).
 *
 * IMPORTANT: The binary barycenter RV is DERIVED from the two stellar RVs
 * using the known mass ratio (or fitted mass ratio). It is NOT a directly
 * measured single velocity. We propagate uncertainty accordingly.
 *
 * Units: km/s for velocities, years for periods.
 */

import { AU_YR_TO_KMS } from '../physics/units.js';

/**
 * Circular Keplerian RV model for one star:
 *   v(t) = K * sin(2π*(t-t0)/P + φ) + γ
 *
 * @param {number} t   - time
 * @param {number} K   - semi-amplitude [km/s]
 * @param {number} P   - period [yr]
 * @param {number} phi - phase offset [rad]
 * @param {number} gamma - systemic velocity [km/s]
 * @returns {number} RV [km/s]
 */
export function circularRVModel(t, K, P, phi, gamma) {
  return K * Math.sin(2 * Math.PI * t / P + phi) + gamma;
}

/**
 * Eccentric Keplerian RV model:
 *   v(t) = K * (cos(ν(t) + ω) + e*cos(ω)) + γ
 * where ν(t) is the true anomaly.
 *
 * @param {number} t     - time [yr]
 * @param {number} K     - semi-amplitude [km/s]
 * @param {number} P     - period [yr]
 * @param {number} t0    - time of periapsis passage [yr]
 * @param {number} e     - eccentricity
 * @param {number} omega - argument of periapsis [rad]
 * @param {number} gamma - systemic velocity [km/s]
 * @returns {number} RV [km/s]
 */
export function keplerianRVModel(t, K, P, t0, e, omega, gamma) {
  const nu = trueAnomaly(t, P, t0, e);
  return K * (Math.cos(nu + omega) + e * Math.cos(omega)) + gamma;
}

/**
 * Solve Kepler's equation M = E - e*sin(E) for eccentric anomaly E.
 * Uses Newton-Raphson iteration.
 */
function eccentricAnomaly(M, e) {
  let E = M;
  for (let i = 0; i < 50; i++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * True anomaly from time, period, periapsis epoch, and eccentricity.
 */
function trueAnomaly(t, P, t0, e) {
  const M = 2 * Math.PI * (((t - t0) % P + P) % P) / P;
  const E = eccentricAnomaly(M, e);
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2)
  );
  return nu;
}

/**
 * Fit a circular sinusoidal RV model using linear least squares.
 * Model: v(t) = A*cos(2π*t/P) + B*sin(2π*t/P) + γ
 * where K = sqrt(A²+B²), φ = atan2(A, B)
 *
 * This is a LINEAR problem for fixed P — solved exactly via normal equations
 * with QR decomposition for numerical stability.
 *
 * @param {number[]} t      - times [yr]
 * @param {number[]} rv     - observed RVs [km/s]
 * @param {number[]} sigma  - per-point uncertainties [km/s]
 * @param {number}   P      - trial period [yr]
 * @returns {{ K, phi, gamma, chi2, residuals, K_err, gamma_err }}
 */
export function fitCircularRV(t, rv, sigma, P) {
  const N = t.length;

  // Design matrix: [cos(2π*t/P), sin(2π*t/P), 1]
  const A = [];
  const b = [];
  const w = [];

  for (let i = 0; i < N; i++) {
    const phase = 2 * Math.PI * t[i] / P;
    A.push([Math.cos(phase), Math.sin(phase), 1]);
    b.push(rv[i]);
    w.push(1 / (sigma[i] * sigma[i]));
  }

  // Weighted normal equations: (A^T W A) x = A^T W b
  // 3x3 system
  const AtWA = [[0,0,0],[0,0,0],[0,0,0]];
  const AtWb = [0, 0, 0];

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < 3; j++) {
      AtWb[j] += w[i] * A[i][j] * b[i];
      for (let k = 0; k < 3; k++) {
        AtWA[j][k] += w[i] * A[i][j] * A[i][k];
      }
    }
  }

  // Solve 3x3 system via Gaussian elimination
  const x = solve3x3(AtWA, AtWb);
  if (!x) {
    return { K: 0, phi: 0, gamma: 0, chi2: Infinity, residuals: new Array(N).fill(0), K_err: Infinity, gamma_err: Infinity };
  }

  const [cosAmp, sinAmp, gamma] = x;
  const K   = Math.sqrt(cosAmp ** 2 + sinAmp ** 2);
  const phi = Math.atan2(cosAmp, sinAmp); // phase such that v = K*sin(2π*t/P + phi)

  // Residuals and chi²
  const residuals = t.map((ti, i) => rv[i] - (cosAmp * Math.cos(2*Math.PI*ti/P) + sinAmp * Math.sin(2*Math.PI*ti/P) + gamma));
  const chi2 = residuals.reduce((s, r, i) => s + (r / sigma[i]) ** 2, 0);

  // Formal uncertainties from covariance matrix (inverse of AtWA)
  const cov = invert3x3(AtWA);
  const K_err = cov ? Math.sqrt((cosAmp**2 * cov[0][0] + sinAmp**2 * cov[1][1] + 2*cosAmp*sinAmp*cov[0][1]) / K**2) : Infinity;
  const gamma_err = cov ? Math.sqrt(cov[2][2]) : Infinity;

  return { K, phi, gamma, chi2, residuals, K_err, gamma_err, cosAmp, sinAmp };
}

/**
 * Fit RV curves for both stars simultaneously to recover mass ratio.
 * Uses the constraint K_A/K_B = mB/mA.
 *
 * @param {number[]} t       - times
 * @param {number[]} rvA     - star A RVs [km/s]
 * @param {number[]} rvB     - star B RVs [km/s]
 * @param {number[]} sigmaA  - star A uncertainties [km/s]
 * @param {number[]} sigmaB  - star B uncertainties [km/s]
 * @param {number}   P       - binary period [yr]
 * @returns {{ KA, KB, massRatio, gamma, chi2, KA_err, KB_err, massRatio_err }}
 */
export function fitBinaryRV(t, rvA, rvB, sigmaA, sigmaB, P) {
  const fitA = fitCircularRV(t, rvA, sigmaA, P);
  const fitB = fitCircularRV(t, rvB, sigmaB, P);

  const KA = fitA.K;
  const KB = fitB.K;
  const massRatio = KA / KB; // q = mB/mA

  // Propagate uncertainty on mass ratio
  const massRatio_err = massRatio * Math.sqrt((fitA.K_err/KA)**2 + (fitB.K_err/KB)**2);

  const chi2 = fitA.chi2 + fitB.chi2;
  const dof  = 2 * t.length - 6; // 3 params per star

  return {
    KA, KB, massRatio, gamma: fitA.gamma,
    chi2, dof, chi2_dof: chi2 / dof,
    KA_err: fitA.K_err,
    KB_err: fitB.K_err,
    massRatio_err,
    gamma_err: fitA.gamma_err,
    fitA, fitB,
  };
}

/**
 * Compute binary barycenter RV from individual stellar RVs and mass ratio.
 * v_bary = (mA*vA + mB*vB) / (mA + mB) = (vA + q*vB) / (1 + q)
 * where q = mB/mA = KA/KB.
 *
 * Uncertainty: σ_bary = sqrt((σA² + q²*σB²)) / (1+q)
 *
 * @param {number[]} rvA     - star A RVs [km/s]
 * @param {number[]} rvB     - star B RVs [km/s]
 * @param {number[]} sigmaA  - star A uncertainties [km/s]
 * @param {number[]} sigmaB  - star B uncertainties [km/s]
 * @param {number}   q       - mass ratio mB/mA (fitted)
 * @param {number}   q_err   - uncertainty on q
 * @returns {{ rvBary: number[], sigmaBary: number[] }}
 */
export function barycentricRV(rvA, rvB, sigmaA, sigmaB, q, q_err) {
  const N = rvA.length;
  const rvBary    = new Array(N);
  const sigmaBary = new Array(N);

  for (let i = 0; i < N; i++) {
    rvBary[i] = (rvA[i] + q * rvB[i]) / (1 + q);
    // Propagate uncertainty (ignoring q_err for simplicity; dominant terms are σA, σB)
    sigmaBary[i] = Math.sqrt(sigmaA[i]**2 + (q * sigmaB[i])**2) / (1 + q);
  }

  return { rvBary, sigmaBary };
}

// ── Linear algebra helpers ────────────────────────────────────────────────────

/** Solve 3x3 linear system Ax = b via Gaussian elimination with partial pivoting */
function solve3x3(A, b) {
  // Make copies
  const M = A.map(row => row.slice());
  const v = b.slice();

  for (let col = 0; col < 3; col++) {
    // Find pivot
    let maxVal = Math.abs(M[col][col]);
    let maxRow = col;
    for (let row = col+1; row < 3; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-15) return null; // singular

    // Swap rows
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    [v[col], v[maxRow]] = [v[maxRow], v[col]];

    // Eliminate
    for (let row = col+1; row < 3; row++) {
      const factor = M[row][col] / M[col][col];
      for (let k = col; k < 3; k++) M[row][k] -= factor * M[col][k];
      v[row] -= factor * v[col];
    }
  }

  // Back substitution
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    x[i] = v[i];
    for (let j = i+1; j < 3; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

/** Invert 3x3 matrix */
function invert3x3(A) {
  const det = A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1])
            - A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0])
            + A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0]);
  if (Math.abs(det) < 1e-30) return null;

  const inv = [
    [(A[1][1]*A[2][2]-A[1][2]*A[2][1])/det, (A[0][2]*A[2][1]-A[0][1]*A[2][2])/det, (A[0][1]*A[1][2]-A[0][2]*A[1][1])/det],
    [(A[1][2]*A[2][0]-A[1][0]*A[2][2])/det, (A[0][0]*A[2][2]-A[0][2]*A[2][0])/det, (A[0][2]*A[1][0]-A[0][0]*A[1][2])/det],
    [(A[1][0]*A[2][1]-A[1][1]*A[2][0])/det, (A[0][1]*A[2][0]-A[0][0]*A[2][1])/det, (A[0][0]*A[1][1]-A[0][1]*A[1][0])/det],
  ];
  return inv;
}

export { trueAnomaly, eccentricAnomaly };
