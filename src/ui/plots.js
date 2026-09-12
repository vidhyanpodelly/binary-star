/**
 * plots.js — Scientific plot rendering on Canvas 2D
 *
 * Renders:
 *   - Light curve (flux vs time)
 *   - Phase-folded light curve
 *   - Radial velocity curves (star A, star B)
 *   - Lomb-Scargle periodogram
 *   - BLS periodogram
 *   - Phase-folded RV (planet signal)
 *   - Inference summary
 *
 * Design principles:
 *   - Truth (simulation) shown as thin colored line
 *   - Observations shown as points with error bars
 *   - Fitted model shown as thick colored line
 *   - Clear axis labels with units
 *   - Event markers (eclipses, transits) linked to light curve
 */

export class PlotRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.margin = { top: 35, right: 20, bottom: 45, left: 65 };
  }

  get W() { return this.canvas.width; }
  get H() { return this.canvas.height; }
  get plotW() { return this.W - this.margin.left - this.margin.right; }
  get plotH() { return this.H - this.margin.top  - this.margin.bottom; }

  // ── Coordinate transforms ─────────────────────────────────────────────────

  xToScreen(x, xMin, xMax) {
    return this.margin.left + (x - xMin) / (xMax - xMin) * this.plotW;
  }

  yToScreen(y, yMin, yMax) {
    return this.margin.top + (1 - (y - yMin) / (yMax - yMin)) * this.plotH;
  }

  // ── Axes ──────────────────────────────────────────────────────────────────

  drawAxes(xMin, xMax, yMin, yMax, xLabel, yLabel, title, options = {}) {
    const { ctx } = this;
    const { margin, plotW, plotH, W, H } = this;

    // Background
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, W, H);

    // Plot area background
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(margin.left, margin.top, plotW, plotH);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;

    const nGridX = options.nGridX || 5;
    const nGridY = options.nGridY || 5;

    for (let i = 0; i <= nGridX; i++) {
      const x = margin.left + i * plotW / nGridX;
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + plotH);
      ctx.stroke();
    }
    for (let i = 0; i <= nGridY; i++) {
      const y = margin.top + i * plotH / nGridY;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + plotW, y);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);

    // Tick labels
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px monospace';

    // X ticks
    ctx.textAlign = 'center';
    for (let i = 0; i <= nGridX; i++) {
      const val = xMin + i * (xMax - xMin) / nGridX;
      const x   = margin.left + i * plotW / nGridX;
      ctx.fillText(this._formatNum(val, xMax - xMin), x, margin.top + plotH + 14);
    }

    // Y ticks
    ctx.textAlign = 'right';
    for (let i = 0; i <= nGridY; i++) {
      const val = yMin + (1 - i / nGridY) * (yMax - yMin);
      const y   = margin.top + i * plotH / nGridY;
      ctx.fillText(this._formatNum(val, yMax - yMin), margin.left - 5, y + 4);
    }

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(xLabel, margin.left + plotW / 2, H - 5);

    ctx.save();
    ctx.translate(14, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();

    // Title
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(title, margin.left + plotW / 2, margin.top - 10);
  }

  _formatNum(val, range) {
    if (range === 0) return val.toFixed(2);
    const mag = Math.floor(Math.log10(Math.abs(range) + 1e-30));
    if (mag >= 3 || mag <= -3) return val.toExponential(1);
    if (mag >= 1) return val.toFixed(1);
    if (mag >= 0) return val.toFixed(2);
    return val.toFixed(3);
  }

  // ── Data series ───────────────────────────────────────────────────────────

  drawLine(xs, ys, xMin, xMax, yMin, yMax, color, lineWidth = 1.5, alpha = 1) {
    const { ctx } = this;
    if (xs.length < 2) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.margin.left, this.margin.top, this.plotW, this.plotH);
    ctx.clip();

    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth   = lineWidth;
    ctx.beginPath();

    let first = true;
    for (let i = 0; i < xs.length; i++) {
      const sx = this.xToScreen(xs[i], xMin, xMax);
      const sy = this.yToScreen(ys[i], yMin, yMax);
      if (first) { ctx.moveTo(sx, sy); first = false; }
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawPoints(xs, ys, xMin, xMax, yMin, yMax, color, radius = 2, alpha = 0.8) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.margin.left, this.margin.top, this.plotW, this.plotH);
    ctx.clip();

    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;

    for (let i = 0; i < xs.length; i++) {
      const sx = this.xToScreen(xs[i], xMin, xMax);
      const sy = this.yToScreen(ys[i], yMin, yMax);
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawErrorBars(xs, ys, sigma, xMin, xMax, yMin, yMax, color, alpha = 0.5) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.margin.left, this.margin.top, this.plotW, this.plotH);
    ctx.clip();

    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;

    for (let i = 0; i < xs.length; i++) {
      const sx  = this.xToScreen(xs[i], xMin, xMax);
      const sy  = this.yToScreen(ys[i], yMin, yMax);
      const sy1 = this.yToScreen(ys[i] + sigma, yMin, yMax);
      const sy2 = this.yToScreen(ys[i] - sigma, yMin, yMax);
      ctx.beginPath();
      ctx.moveTo(sx, sy1);
      ctx.lineTo(sx, sy2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHLine(y, xMin, xMax, yMin, yMax, color, dash = []) {
    const { ctx } = this;
    const sy = this.yToScreen(y, yMin, yMax);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(this.margin.left, sy);
    ctx.lineTo(this.margin.left + this.plotW, sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawVLine(x, xMin, xMax, yMin, yMax, color, dash = []) {
    const { ctx } = this;
    const sx = this.xToScreen(x, xMin, xMax);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(sx, this.margin.top);
    ctx.lineTo(sx, this.margin.top + this.plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawLegend(items, x, y) {
    const { ctx } = this;
    ctx.font = '10px monospace';
    let dy = 0;
    for (const { color, label, dash } of items) {
      ctx.strokeStyle = color;
      ctx.fillStyle   = color;
      ctx.lineWidth   = 2;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(x, y + dy);
      ctx.lineTo(x + 20, y + dy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(label, x + 25, y + dy + 4);
      dy += 16;
    }
  }

  // ── Specific plots ────────────────────────────────────────────────────────

  /**
   * Light curve plot: flux vs time (days)
   */
  plotLightCurve(obs, options = {}) {
    const { ctx } = this;
    const tDays = obs.photTimes.map(t => t * 365.25);
    const tMax  = obs.baseline * 365.25;

    // Determine y range
    const fluxMin = Math.min(...obs.photFlux_obs) - 0.001;
    const fluxMax = 1.002;

    this.drawAxes(0, tMax, fluxMin, fluxMax,
      'Time (days)', 'Normalized Flux',
      'Light Curve — Binary Star System',
      { nGridX: 6, nGridY: 5 });

    // Observed data (thin points, downsampled for speed)
    const step = Math.max(1, Math.floor(tDays.length / 3000));
    const tSub = tDays.filter((_, i) => i % step === 0);
    const fSub = obs.photFlux_obs.filter((_, i) => i % step === 0);
    this.drawPoints(tSub, fSub, 0, tMax, fluxMin, fluxMax, 'rgba(100,180,255,0.4)', 1);

    // True flux (thin line, downsampled)
    if (options.showTruth) {
      this.drawLine(tSub, obs.photFlux_true.filter((_, i) => i % step === 0),
        0, tMax, fluxMin, fluxMax, 'rgba(255,200,100,0.6)', 1);
    }

    // Legend
    this.drawLegend([
      { color: 'rgba(100,180,255,0.8)', label: 'Observed flux' },
      ...(options.showTruth ? [{ color: 'rgba(255,200,100,0.8)', label: 'True flux' }] : []),
    ], this.margin.left + 10, this.margin.top + 10);
  }

  /**
   * Phase-folded light curve at binary period
   */
  plotPhaseFoldedLC(obs, period, title = 'Phase-Folded Light Curve') {
    const { photTimes, photFlux_obs } = obs;
    const phase = photTimes.map(t => ((t % period) + period) % period / period);

    // Sort by phase
    const idx = phase.map((_, i) => i).sort((a, b) => phase[a] - phase[b]);
    const phSorted = idx.map(i => phase[i]);
    const fSorted  = idx.map(i => photFlux_obs[i]);

    const fluxMin = Math.min(...fSorted) - 0.001;
    const fluxMax = 1.002;

    this.drawAxes(0, 1, fluxMin, fluxMax,
      'Orbital Phase', 'Normalized Flux', title,
      { nGridX: 5, nGridY: 5 });

    // Bin the data for clarity
    const nBins = 200;
    const binFlux  = new Array(nBins).fill(0);
    const binCount = new Array(nBins).fill(0);
    for (let i = 0; i < phSorted.length; i++) {
      const b = Math.min(nBins-1, Math.floor(phSorted[i] * nBins));
      binFlux[b]  += fSorted[i];
      binCount[b] += 1;
    }
    const binPh   = Array.from({ length: nBins }, (_, i) => (i + 0.5) / nBins);
    const binMean = binFlux.map((f, b) => binCount[b] > 0 ? f / binCount[b] : 1);

    // Raw points (faint)
    const step = Math.max(1, Math.floor(phSorted.length / 2000));
    this.drawPoints(
      phSorted.filter((_, i) => i % step === 0),
      fSorted.filter((_, i) => i % step === 0),
      0, 1, fluxMin, fluxMax, 'rgba(100,180,255,0.2)', 1
    );

    // Binned line
    this.drawLine(binPh, binMean, 0, 1, fluxMin, fluxMax, 'rgba(255,200,100,0.9)', 2);
  }

  /**
   * Radial velocity plot: RV vs time
   */
  plotRV(obs, inference, options = {}) {
    const tDays = obs.rvTimes.map(t => t * 365.25);
    const tMax  = obs.baseline * 365.25;

    const allRV = [...obs.rvA_obs, ...obs.rvB_obs];
    const rvMin = Math.min(...allRV) * 1.1;
    const rvMax = Math.max(...allRV) * 1.1;

    this.drawAxes(0, tMax, rvMin, rvMax,
      'Time (days)', 'Radial Velocity (km/s)',
      'Stellar Radial Velocities',
      { nGridX: 6, nGridY: 6 });

    // Error bars
    this.drawErrorBars(tDays, obs.rvA_obs, obs.rvSigma, 0, tMax, rvMin, rvMax, 'rgba(255,180,80,0.4)');
    this.drawErrorBars(tDays, obs.rvB_obs, obs.rvSigma, 0, tMax, rvMin, rvMax, 'rgba(255,100,80,0.4)');

    // Observed points
    this.drawPoints(tDays, obs.rvA_obs, 0, tMax, rvMin, rvMax, 'rgba(255,180,80,0.8)', 2.5);
    this.drawPoints(tDays, obs.rvB_obs, 0, tMax, rvMin, rvMax, 'rgba(255,100,80,0.8)', 2.5);

    // True RV (if showing truth)
    if (options.showTruth) {
      this.drawLine(tDays, obs.rvA_true, 0, tMax, rvMin, rvMax, 'rgba(255,220,100,0.5)', 1);
      this.drawLine(tDays, obs.rvB_true, 0, tMax, rvMin, rvMax, 'rgba(255,150,100,0.5)', 1);
    }

    // Fitted model
    if (inference && inference.binaryRV) {
      const fit = inference.binaryRV;
      const tFine = Array.from({ length: 500 }, (_, i) => i * obs.baseline / 499);
      const tFineDays = tFine.map(t => t * 365.25);
      const P = fit.period;
      const modelA = tFine.map(t => fit.fitA.cosAmp * Math.cos(2*Math.PI*t/P) + fit.fitA.sinAmp * Math.sin(2*Math.PI*t/P) + fit.gamma);
      const modelB = tFine.map(t => fit.fitB.cosAmp * Math.cos(2*Math.PI*t/P) + fit.fitB.sinAmp * Math.sin(2*Math.PI*t/P) + fit.gamma);
      this.drawLine(tFineDays, modelA, 0, tMax, rvMin, rvMax, 'rgba(255,220,80,0.9)', 2);
      this.drawLine(tFineDays, modelB, 0, tMax, rvMin, rvMax, 'rgba(255,120,80,0.9)', 2);
    }

    // Zero line
    this.drawHLine(0, 0, tMax, rvMin, rvMax, 'rgba(255,255,255,0.2)', [4, 4]);

    this.drawLegend([
      { color: 'rgba(255,180,80,0.9)', label: 'Star A (K dwarf)' },
      { color: 'rgba(255,100,80,0.9)', label: 'Star B (M dwarf)' },
      ...(inference ? [{ color: 'rgba(255,220,80,0.9)', label: 'Fitted model', dash: [] }] : []),
    ], this.margin.left + 10, this.margin.top + 10);
  }

  /**
   * Lomb-Scargle periodogram
   */
  plotPeriodogram(freqs, power, peakPeriod, truePeriod, title, fap01Level = null) {
    const periods = freqs.map(f => 1/f * 365.25); // convert to days
    const peakPeriodDays = peakPeriod * 365.25;
    const truePeriodDays = truePeriod * 365.25;

    const pMin = Math.min(...periods);
    const pMax = Math.max(...periods);
    const powerMax = Math.max(...power, 0.1);

    this.drawAxes(pMin, pMax, 0, Math.min(1, powerMax * 1.1),
      'Period (days)', 'GLS Power',
      title, { nGridX: 5, nGridY: 5 });

    // Power spectrum
    this.drawLine(periods, power, pMin, pMax, 0, Math.min(1, powerMax * 1.1),
      'rgba(100,200,255,0.8)', 1.5);

    // Peak marker
    this.drawVLine(peakPeriodDays, pMin, pMax, 0, Math.min(1, powerMax * 1.1),
      'rgba(255,200,80,0.8)', [4, 4]);

    // True period marker
    this.drawVLine(truePeriodDays, pMin, pMax, 0, Math.min(1, powerMax * 1.1),
      'rgba(100,255,100,0.6)', [2, 4]);

    // FAP level
    if (fap01Level !== null) {
      this.drawHLine(fap01Level, pMin, pMax, 0, Math.min(1, powerMax * 1.1),
        'rgba(255,80,80,0.6)', [4, 4]);
    }

    this.drawLegend([
      { color: 'rgba(100,200,255,0.8)', label: 'GLS power' },
      { color: 'rgba(255,200,80,0.8)', label: `Peak: ${peakPeriodDays.toFixed(1)}d`, dash: [4,4] },
      { color: 'rgba(100,255,100,0.6)', label: `True: ${truePeriodDays.toFixed(1)}d`, dash: [2,4] },
    ], this.margin.left + 10, this.margin.top + 10);
  }

  /**
   * Barycenter RV residuals (planet signal)
   */
  plotBaryRV(obs, inference, planetRevealed = false) {
    const { ctx } = this;
    const tDays = obs.rvTimes.map(t => t * 365.25);
    const tMax  = obs.baseline * 365.25;

    const bary = inference.barycentricRV;
    const rvMin = Math.min(...bary.residuals) * 1.5;
    const rvMax = Math.max(...bary.residuals) * 1.5;
    const yRange = Math.max(Math.abs(rvMin), Math.abs(rvMax), 0.05);

    this.drawAxes(0, tMax, -yRange, yRange,
      'Time (days)', 'Barycenter RV residual (km/s)',
      planetRevealed ? 'Binary Barycenter RV — Planet Signal' : 'Binary Barycenter RV — Residuals',
      { nGridX: 6, nGridY: 6 });

    // Error bars
    this.drawErrorBars(tDays, bary.residuals, bary.sigmaBary[0], 0, tMax, -yRange, yRange,
      'rgba(150,150,255,0.4)');

    // Points
    this.drawPoints(tDays, bary.residuals, 0, tMax, -yRange, yRange,
      'rgba(150,150,255,0.8)', 2.5);

    // Zero line
    this.drawHLine(0, 0, tMax, -yRange, yRange, 'rgba(255,255,255,0.2)', [4, 4]);

    // Fitted planet model (only after reveal)
    if (planetRevealed && inference.planetRV) {
      const fit = inference.planetRV;
      const tFine = Array.from({ length: 500 }, (_, i) => i * obs.baseline / 499);
      const tFineDays = tFine.map(t => t * 365.25);
      const P = fit.period;
      const model = tFine.map(t =>
        fit.K * Math.sin(2*Math.PI*t/P + Math.atan2(inference.planetRV.cosAmp || 0, fit.K || 1))
      );
      this.drawLine(tFineDays, model, 0, tMax, -yRange, yRange, 'rgba(100,255,200,0.8)', 2);
    }

    // Note about noise floor
    ctx.fillStyle = 'rgba(255,200,100,0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`σ_RV = ${obs.rvSigmaMS} m/s | K_planet ≈ ${(inference.planetRV?.K_expected_ms || 4).toFixed(1)} m/s`, this.margin.left + 5, this.H - 5);
  }

  /**
   * Inference summary panel
   */
  plotInferenceSummary(inference, obs, planetRevealed = false) {
    const { ctx, W, H } = this;

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, W, H);

    const lines = [];
    const add = (text, color = 'rgba(255,255,255,0.8)', bold = false) => lines.push({ text, color, bold });

    add('INFERENCE RESULTS', 'rgba(100,200,255,1)', true);
    add('');
    add('Known inputs (declared priors):', 'rgba(255,200,100,0.9)', true);
    add(`  Binary period: ${(obs.baseline * 365.25).toFixed(0)} days baseline`);
    add(`  Noise model: σ_phot=${obs.photSigmaPPM} ppm, σ_RV=${obs.rvSigmaMS} m/s`);
    add('');

    if (inference.binaryPeriod) {
      const bp = inference.binaryPeriod;
      add('Binary Period (LS on photometry):', 'rgba(255,200,100,0.9)', true);
      add(`  Fitted:  ${(bp.period * 365.25).toFixed(2)} days`);
      add(`  True:    ${(bp.truePeriod * 365.25).toFixed(2)} days`);
      add(`  Error:   ${(bp.error * 100).toFixed(2)}%`);
      add(`  FAP:     ${bp.fap.toExponential(2)}`);
      add('');
    }

    if (inference.binaryRV) {
      const rv = inference.binaryRV;
      add('Binary RV Fit:', 'rgba(255,200,100,0.9)', true);
      add(`  K_A = ${rv.KA.toFixed(2)} ± ${rv.KA_err.toFixed(2)} km/s  (true: ${rv.trueKA.toFixed(2)})`);
      add(`  K_B = ${rv.KB.toFixed(2)} ± ${rv.KB_err.toFixed(2)} km/s  (true: ${rv.trueKB.toFixed(2)})`);
      add(`  q = m_B/m_A = ${rv.massRatio.toFixed(4)} ± ${rv.massRatio_err.toFixed(4)}  (true: ${rv.trueMassRatio.toFixed(4)})`);
      add(`  χ²/dof = ${rv.chi2_dof.toFixed(2)}`);
      add('');
    }

    if (planetRevealed) {
      add('Planet Detection:', 'rgba(100,255,150,1)', true);

      if (inference.planetPeriodRV) {
        const pp = inference.planetPeriodRV;
        add(`  Period (RV): ${(pp.period * 365.25).toFixed(1)} days  (true: ${(pp.truePeriod * 365.25).toFixed(1)} days)`);
        add(`  FAP: ${pp.fap.toExponential(2)}  ${pp.detected ? '✓ detected' : '(marginal)'}`, pp.detected ? 'rgba(100,255,150,0.9)' : 'rgba(255,200,100,0.8)');
      }

      if (inference.planetRV) {
        const pr = inference.planetRV;
        add(`  K_planet = ${(pr.K * 1000).toFixed(1)} ± ${(pr.K_err * 1000).toFixed(1)} m/s`);
        add(`  Expected: ${pr.K_expected_ms.toFixed(1)} m/s`);
        add(`  ${pr.note}`, 'rgba(255,200,100,0.7)');
      }

      if (inference.nullModel) {
        const nm = inference.nullModel;
        add('');
        add('Null Model Comparison:', 'rgba(255,200,100,0.9)', true);
        add(`  F-statistic: ${nm.F_stat.toFixed(2)}`);
        add(`  Preferred: ${nm.preferred === 'planet' ? '✓ Planet model' : '○ Null (no planet)'}`,
          nm.preferred === 'planet' ? 'rgba(100,255,150,0.9)' : 'rgba(255,100,100,0.9)');
      }
    } else {
      add('Planet: [HIDDEN — run full analysis to reveal]', 'rgba(255,200,100,0.6)');
    }

    // Render text
    let y = 20;
    ctx.textAlign = 'left';
    for (const line of lines) {
      if (line.text === '') { y += 8; continue; }
      ctx.font = line.bold ? 'bold 12px monospace' : '11px monospace';
      ctx.fillStyle = line.color;
      ctx.fillText(line.text, 10, y);
      y += 16;
    }
  }
}
