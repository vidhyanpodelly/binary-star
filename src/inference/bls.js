/**
 * bls.js — Box-Least-Squares (BLS) transit search
 *
 * Implements the BLS algorithm of Kovács, Zucker & Mazeh 2002 (A&A 391, 369)
 * for detecting periodic box-shaped dips in a light curve.
 *
 * Key design decisions to avoid prior-session pitfalls:
 *
 * 1. ECLIPSE REMOVAL: Before searching for the planet, we remove the binary
 *    eclipse signal using the known binary period and epoch (declared known
 *    inputs). This prevents the BLS from locking onto eclipse aliases.
 *
 * 2. PERIOD RANGE: We restrict the BLS search to periods > 3.5 * P_binary
 *    (Holman-Wiegert stability criterion) AND require at least 2 transit events
 *    in the baseline.
 *
 * 3. CIRCUMBINARY CAVEAT: Circumbinary planet transits are NOT strictly periodic
 *    due to the moving binary barycenter. We use BLS as a first-pass detector
 *    and note this limitation explicitly. The transit timing variations (TTVs)
 *    are a feature, not a bug — they confirm the circumbinary nature.
 *
 * 4. SIGNAL RECOVERY: We report the BLS period, depth, duration, and SNR.
 *    We do NOT claim detection unless SNR > threshold AND FAP < 0.01.
 */

/**
 * Remove a known periodic signal (eclipses) from a light curve by
 * phase-folding at the known period and subtracting a running median.
 *
 * @param {number[]} t        - times
 * @param {number[]} flux     - normalized fluxes
 * @param {number}   period   - known period to remove
 * @param {number}   [t0=0]   - reference epoch
 * @param {number}   [nBins=100] - number of phase bins for template
 * @returns {number[]} residual fluxes with eclipse signal removed
 */
export function removePeriodicSignal(t, flux, period, t0 = 0, nBins = 100) {
  const N = t.length;
  const phase = t.map(ti => ((((ti - t0) % period) + period) % period) / period);

  // Build phase-binned template
  const binSum   = new Array(nBins).fill(0);
  const binCount = new Array(nBins).fill(0);

  for (let i = 0; i < N; i++) {
    const bin = Math.floor(phase[i] * nBins) % nBins;
    binSum[bin]   += flux[i];
    binCount[bin] += 1;
  }

  const binMean = binSum.map((s, b) => binCount[b] > 0 ? s / binCount[b] : 1.0);

  // Subtract template from data
  const residual = new Array(N);
  for (let i = 0; i < N; i++) {
    const bin = Math.floor(phase[i] * nBins) % nBins;
    residual[i] = flux[i] - binMean[bin] + 1.0; // add 1 to keep normalized
  }

  return residual;
}

/**
 * Box-Least-Squares periodogram.
 *
 * @param {number[]} t          - times (sorted or unsorted)
 * @param {number[]} flux       - normalized fluxes (≈1.0 out of transit)
 * @param {number[]} periods    - array of trial periods to test
 * @param {number}   [qMin=0.01] - minimum transit duration fraction
 * @param {number}   [qMax=0.15] - maximum transit duration fraction
 * @param {number}   [nBins=200] - number of phase bins
 * @returns {{ power: number[], periods: number[], bestPeriod, bestDepth, bestDuration, snr }}
 */
export function blsPeriodogram(t, flux, periods, qMin = 0.01, qMax = 0.15, nBins = 200) {
  const N = t.length;
  const tMean = flux.reduce((a, b) => a + b, 0) / N;
  const variance = flux.reduce((s, f) => s + (f - tMean) ** 2, 0) / N;
  const sigma = Math.sqrt(variance);

  const power = new Array(periods.length).fill(0);
  let bestPower = -Infinity;
  let bestPeriod = periods[0];
  let bestDepth = 0;
  let bestDuration = 0;
  let bestPhase = 0;

  for (let pi = 0; pi < periods.length; pi++) {
    const P = periods[pi];

    // Phase-fold
    const phase = t.map(ti => ((ti % P) + P) % P / P);

    // Bin the flux
    const binFlux  = new Array(nBins).fill(0);
    const binCount = new Array(nBins).fill(0);

    for (let i = 0; i < N; i++) {
      const bin = Math.min(nBins - 1, Math.floor(phase[i] * nBins));
      binFlux[bin]  += flux[i];
      binCount[bin] += 1;
    }

    // Normalize bins
    const s = binFlux.map((f, b) => binCount[b] > 0 ? f / binCount[b] : tMean);
    const r = binCount.map(c => c / N);

    // BLS: find the box (contiguous bins) that maximizes signal
    // Signal = Σ_in(1 - s_i) * r_i / sqrt(q*(1-q))
    // We search over all box widths from qMin to qMax

    const qMinBins = Math.max(1, Math.floor(qMin * nBins));
    const qMaxBins = Math.min(nBins - 1, Math.ceil(qMax * nBins));

    let maxSignal = -Infinity;
    let bestBinStart = 0;
    let bestBinWidth = qMinBins;

    for (let width = qMinBins; width <= qMaxBins; width++) {
      for (let start = 0; start < nBins; start++) {
        // Sum over the box (wrapping)
        let sumS = 0, sumR = 0;
        for (let k = 0; k < width; k++) {
          const bin = (start + k) % nBins;
          sumS += s[bin] * r[bin];
          sumR += r[bin];
        }
        if (sumR < 1e-10) continue;

        const meanInBox = sumS / sumR;
        const depth = tMean - meanInBox; // positive for a dip
        if (depth <= 0) continue;

        // BLS signal (Kovács et al. 2002, Eq. 5)
        const q = sumR;
        const signal = depth * Math.sqrt(q * (1 - q));

        if (signal > maxSignal) {
          maxSignal = signal;
          bestBinStart = start;
          bestBinWidth = width;
        }
      }
    }

    power[pi] = maxSignal;

    if (maxSignal > bestPower) {
      bestPower = maxSignal;
      bestPeriod = P;
      bestPhase = bestBinStart / nBins;
      bestDuration = bestBinWidth / nBins * P;

      // Compute depth at best period
      const phase2 = t.map(ti => ((ti % P) + P) % P / P);
      const inTransit = phase2.map(ph => {
        const d = Math.min(Math.abs(ph - bestPhase), 1 - Math.abs(ph - bestPhase));
        return d < bestBinWidth / (2 * nBins);
      });
      const inFlux  = flux.filter((_, i) => inTransit[i]);
      const outFlux = flux.filter((_, i) => !inTransit[i]);
      const meanIn  = inFlux.length  > 0 ? inFlux.reduce((a,b)=>a+b,0)/inFlux.length   : tMean;
      const meanOut = outFlux.length > 0 ? outFlux.reduce((a,b)=>a+b,0)/outFlux.length : tMean;
      bestDepth = meanOut - meanIn;
    }
  }

  // SNR: depth / (sigma / sqrt(N_in_transit))
  const phase_best = t.map(ti => ((ti % bestPeriod) + bestPeriod) % bestPeriod / bestPeriod);
  const nInTransit = phase_best.filter(ph => {
    const d = Math.min(Math.abs(ph - bestPhase), 1 - Math.abs(ph - bestPhase));
    return d < bestDuration / (2 * bestPeriod);
  }).length;
  const snr = nInTransit > 0 ? bestDepth / (sigma / Math.sqrt(nInTransit)) : 0;

  return {
    power,
    periods,
    bestPeriod,
    bestDepth,
    bestDuration,
    bestPhase,
    snr,
  };
}

/**
 * Generate a period grid for BLS search.
 * Restricted to periods > minPeriod (stability criterion) and
 * requiring at least minTransits transit events in the baseline.
 *
 * @param {number} tBaseline   - total observation baseline
 * @param {number} minPeriod   - minimum period (e.g., 3.5 * P_binary)
 * @param {number} maxPeriod   - maximum period (e.g., tBaseline / 2)
 * @param {number} [nPeriods=1000] - number of trial periods
 * @param {number} [minTransits=2] - minimum number of transits required
 * @returns {number[]} array of trial periods
 */
export function blsPeriodGrid(tBaseline, minPeriod, maxPeriod, nPeriods = 1000, minTransits = 2) {
  // Ensure at least minTransits transits
  const maxPeriodFromTransits = tBaseline / minTransits;
  const effectiveMax = Math.min(maxPeriod, maxPeriodFromTransits);

  if (effectiveMax <= minPeriod) {
    console.warn('BLS: period range is empty (baseline too short for minTransits)');
    return [minPeriod];
  }

  const periods = [];
  for (let i = 0; i < nPeriods; i++) {
    const p = minPeriod + (effectiveMax - minPeriod) * i / (nPeriods - 1);
    periods.push(p);
  }
  return periods;
}
