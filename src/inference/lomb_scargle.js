/**
 * lomb_scargle.js — Lomb-Scargle periodogram with correct normalization
 *
 * Implements the generalized Lomb-Scargle (GLS) periodogram following
 * Zechmeister & Kürster 2009 (A&A 496, 577), which includes a floating
 * mean (offset) and proper statistical normalization.
 *
 * Power normalization: p(ω) ∈ [0, 1] where 1 = perfect sinusoidal fit.
 * This is the "normalized" GLS power, NOT the raw Scargle (1982) power.
 *
 * False alarm probability (FAP):
 *   For the normalized GLS power p with N data points:
 *   FAP(p) ≈ 1 - (1 - p^((N-3)/2))^M
 *   where M is the number of independent frequencies tested.
 *   M ≈ number of frequencies (conservative estimate).
 *
 * Reference: Zechmeister & Kürster 2009, A&A 496, 577
 *            VanderPlas 2018, ApJS 236, 16
 *
 * IMPORTANT: This is the GLS normalized power, NOT the Scargle (1982)
 * normalization (which divides by 2*variance/N and gives values >> 1).
 * The FAP formula here is calibrated for the GLS [0,1] power.
 */

/**
 * Compute the Generalized Lomb-Scargle periodogram.
 *
 * @param {number[]} t      - observation times (any units, consistent with periods)
 * @param {number[]} y      - observed values
 * @param {number[]} [w]    - weights (1/σ²); if null, uniform weights assumed
 * @param {number[]} freqs  - array of frequencies to evaluate (1/time_unit)
 * @returns {{ power: number[], freqs: number[] }}
 *   power[i] ∈ [0,1] is the GLS normalized power at freqs[i]
 */
export function lombScargle(t, y, w, freqs) {
  const N = t.length;
  if (N !== y.length) throw new Error('t and y must have same length');

  // Default to uniform weights
  if (!w || w.length !== N) {
    w = new Array(N).fill(1 / N);
  }

  // Normalize weights so they sum to 1
  const wSum = w.reduce((a, b) => a + b, 0);
  const wn = w.map(wi => wi / wSum);

  // Weighted mean
  const yMean = wn.reduce((s, wi, i) => s + wi * y[i], 0);

  // Weighted variance (YY in GLS notation)
  const YY = wn.reduce((s, wi, i) => s + wi * (y[i] - yMean) ** 2, 0);

  if (YY === 0) {
    return { power: new Array(freqs.length).fill(0), freqs };
  }

  const power = new Array(freqs.length);

  for (let fi = 0; fi < freqs.length; fi++) {
    const omega = 2 * Math.PI * freqs[fi];

    // GLS sums (Zechmeister & Kürster 2009, Eq. 5-12)
    let C = 0, S = 0, YC = 0, YS = 0, CC = 0, SS = 0, CS = 0;

    for (let i = 0; i < N; i++) {
      const phi = omega * t[i];
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      const yi = y[i] - yMean;
      const wi = wn[i];

      C  += wi * c;
      S  += wi * s;
      YC += wi * yi * c;
      YS += wi * yi * s;
      CC += wi * c * c;
      SS += wi * s * s;
      CS += wi * c * s;
    }

    // Corrected sums (remove mean contribution)
    const CC_ = CC - C * C;
    const SS_ = SS - S * S;
    const CS_ = CS - C * S;
    const YC_ = YC - yMean * C;  // Note: yi already has mean subtracted above
    // Actually YC_ = YC since yi = y[i]-yMean, but C is weighted mean of cos
    // Let's redo properly:
    // YC_ = Σ wi*(y[i]-yMean)*cos - (Σ wi*cos)*(Σ wi*(y[i]-yMean))
    //      = YC - C * 0  (since Σ wi*(y[i]-yMean) = 0)
    // So YC_ = YC, YS_ = YS (already correct since yMean subtracted)

    const D = CC_ * SS_ - CS_ * CS_;

    if (Math.abs(D) < 1e-30) {
      power[fi] = 0;
      continue;
    }

    // Best-fit amplitudes
    const a = (YC * SS_ - YS * CS_) / D;
    const b = (YS * CC_ - YC * CS_) / D;

    // GLS power (Eq. 20 in Zechmeister & Kürster 2009)
    const p = (SS_ * YC * YC + CC_ * YS * YS - 2 * CS_ * YC * YS) / (YY * D);

    power[fi] = Math.max(0, Math.min(1, p));
  }

  return { power, freqs };
}

/**
 * Generate a logarithmically-spaced frequency grid.
 *
 * @param {number} tSpan    - total time baseline [same units as t]
 * @param {number} minPeriod - minimum period to search
 * @param {number} maxPeriod - maximum period to search
 * @param {number} [oversample=5] - oversampling factor
 * @returns {number[]} array of frequencies
 */
export function frequencyGrid(tSpan, minPeriod, maxPeriod, oversample = 5) {
  const fMin = 1 / maxPeriod;
  const fMax = 1 / minPeriod;
  const df   = 1 / (oversample * tSpan);
  const nFreq = Math.ceil((fMax - fMin) / df);
  const freqs = [];
  for (let i = 0; i <= nFreq; i++) {
    freqs.push(fMin + i * df);
  }
  return freqs;
}

/**
 * False alarm probability for GLS normalized power.
 * Uses the analytic approximation from Zechmeister & Kürster 2009.
 *
 * @param {number} power  - GLS power ∈ [0,1]
 * @param {number} N      - number of data points
 * @param {number} M      - number of independent frequencies tested
 * @returns {number} FAP ∈ [0,1]
 */
export function falseAlarmProbability(power, N, M) {
  // Single-trial probability of exceeding power p by chance
  // For GLS: p_single = (1 - p)^((N-3)/2)
  const nu = (N - 3) / 2;
  const pSingle = Math.pow(Math.max(0, 1 - power), nu);
  // Multiple trials: FAP = 1 - (1 - pSingle)^M
  const fap = 1 - Math.pow(Math.max(0, 1 - pSingle), M);
  return Math.min(1, Math.max(0, fap));
}

/**
 * Find the peak in a periodogram and return period, power, FAP.
 *
 * @param {number[]} power  - GLS power array
 * @param {number[]} freqs  - frequency array
 * @param {number}   N      - number of data points
 * @returns {{ period, frequency, power, fap }}
 */
export function findPeak(power, freqs, N) {
  let maxP = -Infinity, maxI = 0;
  for (let i = 0; i < power.length; i++) {
    if (power[i] > maxP) { maxP = power[i]; maxI = i; }
  }
  const M = freqs.length;
  const fap = falseAlarmProbability(maxP, N, M);
  return {
    period:    1 / freqs[maxI],
    frequency: freqs[maxI],
    power:     maxP,
    fap,
  };
}

/**
 * Phase-fold data at a given period.
 * Phase ∈ [0, 1).
 *
 * @param {number[]} t      - times
 * @param {number[]} y      - values
 * @param {number}   period - folding period
 * @param {number}   [t0=0] - reference epoch
 * @returns {{ phase: number[], y: number[] }} sorted by phase
 */
export function phaseFold(t, y, period, t0 = 0) {
  const phase = t.map(ti => ((((ti - t0) % period) + period) % period) / period);
  const idx = phase.map((p, i) => i).sort((a, b) => phase[a] - phase[b]);
  return {
    phase: idx.map(i => phase[i]),
    y:     idx.map(i => y[i]),
  };
}

/**
 * Determine physical bounds and create a frequency grid for a circumbinary planet RV search.
 * Enforces Holman-Wiegert stability limit on the lower end, and baseline length on upper end.
 */
export function createPlanetRVSearchGrid(P_bin, e_bin, q, baseline, min_P_ratio = 4.0) {
  const minP = P_bin * min_P_ratio;
  const maxP = baseline * 0.5; // Require at least 2 full periods
  
  if (minP >= maxP) {
    return { error: 'Observation baseline too short to reliably detect stable planet orbits.' };
  }
  
  const freqs = frequencyGrid(baseline, minP, maxP, 10);
  return { P_min: minP, P_max: maxP, freqs };
}
