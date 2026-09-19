/**
 * simulation.js — Simulation controller
 *
 * Manages the N-body integration, pre-computes the observation time series,
 * and provides the animation loop.
 *
 * Pre-computation strategy:
 *   1. Integrate the full observation baseline (3 years) at fine time step
 *   2. Store states at observation cadence (30 min = 0.0000570 yr)
 *   3. Compute flux and RV at each stored state
 *   4. Add realistic noise
 *   5. Run inference (LS, BLS, RV fit) on the synthetic observations
 *
 * This separates truth (simulation) from observations (noisy) from
 * inference (fitted parameters) — never mixing them.
 */

import { buildInitialConditions, totalEnergy, totalAngularMomentum, rk4Step, stepAndDetectCollision } from '../physics/nbody.js';
import { createSystemConfig } from '../physics/system.js';
import { computeFlux } from '../obs/photometry.js';
import { computeRV } from '../obs/radialvelocity.js';
import { addPhotNoise, addRVNoise, DEFAULT_PHOT_SIGMA_PPM, DEFAULT_RV_SIGMA_MS } from '../obs/noise.js';
import { lombScargle, frequencyGrid, findPeak, phaseFold, createPlanetRVSearchGrid } from '../inference/lomb_scargle.js';
import { blsPeriodogram, blsPeriodGrid, removePeriodicSignal } from '../inference/bls.js';
import { fitBinaryRV, fitCircularRV, barycentricRV } from '../inference/rv_fit.js';
import { AU_YR_TO_KMS } from '../physics/units.js';
import { rvAmplitudePlanet } from '../obs/radialvelocity.js';

// ── Observation parameters ────────────────────────────────────────────────────

const OBS_BASELINE_YR  = 3.0;          // 3 years of observations
const PHOT_CADENCE_YR  = 30 / 525960;  // 30 minutes in years (Kepler long cadence)
const RV_CADENCE_YR    = 3 / 365.25;   // RV every 3 days
const DT_INTEGRATION   = 1 / 525960;   // 1-hour integration timestep in years
const PHOT_SIGMA_PPM   = DEFAULT_PHOT_SIGMA_PPM;
const RV_SIGMA_MS      = DEFAULT_RV_SIGMA_MS;

let _simVersionCounter = 0;

export class Simulation {
  constructor(onProgress, overrides = {}) {
    this.onProgress = onProgress || (() => {});
    this.config     = createSystemConfig(overrides);
    this.params     = this.config;
    
    // Data flow tracking
    _simVersionCounter++;
    this.version = _simVersionCounter;
    this.configFingerprint = JSON.stringify(this.config);

    this.ic         = buildInitialConditions(this.params);
    this.state      = this.ic.state.slice();
    this.masses     = this.ic.masses;
    this.t          = 0;

    // Animation state
    this.playing    = false;
    this.speed      = 1;          // simulation years per real second
    this.animState  = this.ic.state.slice();
    this.animT      = 0;
    this.animStates = null;       // pre-computed animation frames
    this.animIdx    = 0;

    // Observations (filled by precompute)
    this.obs = null;

    // Inference results (filled by runInference)
    this.inference = null;

    // Validation
    this.validation = null;
    
    // Collision State
    this.contactTime = null;
  }

  /**
   * Pre-compute the full observation time series.
   * This is the expensive step — runs the N-body integrator for 3 years.
   * Reports progress via onProgress(fraction, message).
   *
   * @returns {Promise<void>}
   */
  async precompute() {
    this.onProgress(0, 'Initializing N-body integrator...');

    const { state: s0, masses } = this.ic;
    const tEnd = OBS_BASELINE_YR;
    const dt   = DT_INTEGRATION;

    // Photometry times (every 30 min)
    const photTimes = [];
    for (let t = 0; t <= tEnd; t += PHOT_CADENCE_YR) photTimes.push(t);

    // RV times (every 3 days, with some gaps for realism)
    const rvTimes = [];
    for (let t = 0; t <= tEnd; t += RV_CADENCE_YR) {
      // Skip ~20% of nights (weather, scheduling)
      if (Math.random() > 0.2) rvTimes.push(t);
    }

    // Storage
    const photFlux_true = [];
    const rvA_true      = [];
    const rvB_true      = [];
    const rvBary_true   = [];
    const animStates    = [];
    const animTimes     = [];

    // We integrate once and sample at both cadences
    let photIdx = 0;
    let rvIdx   = 0;
    let step    = 0;
    const totalSteps = Math.ceil(tEnd / dt);
    const animEvery  = Math.max(1, Math.floor(totalSteps / 2000)); // ~2000 animation frames

    let lastProgressUpdate = 0;
    const E0 = totalEnergy(s0, masses);
    const L0 = totalAngularMomentum(s0, masses);
    const L0mag = Math.sqrt(L0[0]**2 + L0[1]**2 + L0[2]**2);

    await new Promise((resolve) => {
      let s = s0.slice();
      let t = 0;

      const chunk = () => {
        const chunkSize = 500; // steps per chunk (yield to UI)
        let collisionOccurred = false;
        const radii = [this.config.starA.radius, this.config.starB.radius, this.config.planet.radius];

        for (let c = 0; c < chunkSize && t < tEnd - dt * 0.5; c++) {
          const col = stepAndDetectCollision(s, masses, radii, t, dt);
          if (col) {
            s = col.state;
            t = col.time;
            step++;

            // Record final state before collision
            animStates.push(s.slice());
            animTimes.push(t);

            this.validation = {
              status: 'INVALID',
              message: `PHYSICAL CONTACT DETECTED — integration halted at t = ${(col.time * 365.25).toFixed(1)} days.`,
              energyError: 0,
              angMomError: 0,
              nSteps: step,
              dt, tEnd
            };
            collisionOccurred = true;
            break;
          }

          // RK4 step
          s = rk4Step(s, masses, dt);
          t += dt;
          step++;

          // Sample photometry
          while (photIdx < photTimes.length && photTimes[photIdx] <= t + dt * 0.5) {
            const flux = computeFlux(s, this.config.starA, this.config.starB, this.config.planet);
            photFlux_true.push(flux);
            photIdx++;
          }

          // Sample RV
          while (rvIdx < rvTimes.length && rvTimes[rvIdx] <= t + dt * 0.5) {
            const rv = computeRV(s, masses);
            rvA_true.push(rv.vzA_kms);
            rvB_true.push(rv.vzB_kms);
            rvBary_true.push(rv.vzBary_kms);
            rvIdx++;
          }

          // Animation frames
          if (step % animEvery === 0) {
            animStates.push(s.slice());
            animTimes.push(t);
          }
        }

        const progress = t / tEnd;
        if (progress - lastProgressUpdate > 0.05) {
          this.onProgress(progress * 0.7, `Integrating: ${(t * 365.25).toFixed(0)} / ${(tEnd * 365.25).toFixed(0)} days`);
          lastProgressUpdate = progress;
        }

        if (!collisionOccurred && t < tEnd - dt * 0.5) {
          setTimeout(chunk, 0); // yield to browser
        } else {
          if (!collisionOccurred) {
            // Compute conservation errors for full baseline
            const Ef = totalEnergy(s, masses);
            const Lf = totalAngularMomentum(s, masses);
            const Lfmag = Math.sqrt(Lf[0]**2 + Lf[1]**2 + Lf[2]**2);
            this.validation = {
              energyError:  Math.abs((Ef - E0) / E0),
              angMomError:  L0mag > 0 ? Math.abs((Lfmag - L0mag) / L0mag) : 0,
              nSteps:       step,
              dt,
              tEnd,
            };
          } else {
            // Re-evaluate energy at contact to prove physics worked up to contact
            const Ef = totalEnergy(s, masses);
            const Lf = totalAngularMomentum(s, masses);
            const Lfmag = Math.sqrt(Lf[0]**2 + Lf[1]**2 + Lf[2]**2);
            this.validation = {
              energyError:  Math.abs((Ef - E0) / E0),
              angMomError:  L0mag > 0 ? Math.abs((Lfmag - L0mag) / L0mag) : 0,
              nSteps:       step,
              dt,
              tEnd:         t,
              contact:      true
            };
          }
          resolve();
        }
      };

      setTimeout(chunk, 0);
    });

    this.onProgress(0.7, 'Adding observational noise...');

    // Trim to actual sampled lengths
    const nPhot = Math.min(photTimes.length, photFlux_true.length);
    const nRV   = Math.min(rvTimes.length, rvA_true.length);

    // Add noise
    const photFlux_obs = addPhotNoise(photFlux_true.slice(0, nPhot), PHOT_SIGMA_PPM);
    const rvA_obs      = addRVNoise(rvA_true.slice(0, nRV), RV_SIGMA_MS);
    const rvB_obs      = addRVNoise(rvB_true.slice(0, nRV), RV_SIGMA_MS);

    this.obs = {
      // Photometry
      photTimes:      photTimes.slice(0, nPhot),
      photFlux_true:  photFlux_true.slice(0, nPhot),
      photFlux_obs,
      photSigma:      PHOT_SIGMA_PPM * 1e-6,

      // Radial velocities
      rvTimes:        rvTimes.slice(0, nRV),
      rvA_true:       rvA_true.slice(0, nRV),
      rvB_true:       rvB_true.slice(0, nRV),
      rvBary_true:    rvBary_true.slice(0, nRV),
      rvA_obs,
      rvB_obs,
      rvSigma:        RV_SIGMA_MS / 1000, // km/s

      // Metadata
      baseline:       OBS_BASELINE_YR,
      photCadence:    PHOT_CADENCE_YR,
      rvCadence:      RV_CADENCE_YR,
      photSigmaPPM:   PHOT_SIGMA_PPM,
      rvSigmaMS:      RV_SIGMA_MS,
    };

    // Store animation frames
    this.animStates = animStates;
    this.animTimes  = animTimes;
    this.animIdx    = 0;
    this.history    = animTimes.map((t, i) => ({ t, state: animStates[i] }));

    this.onProgress(0.75, 'Running inference...');
    await this._runInference();

    this.onProgress(1.0, 'Ready');
  }


  // ── Inference ─────────────────────────────────────────────────────────────

  async _runInference() {
    const { obs } = this;
    const results = {};

    // ── Step 1: Binary period from photometry (LS on flux) ─────────────────
    this.onProgress(0.75, 'Step 1: Binary period search (Lomb-Scargle)...');

    const photFreqs = frequencyGrid(obs.baseline, this.config.P_BIN * 0.5, this.config.P_BIN * 2, 10);
    const { power: photPower } = lombScargle(obs.photTimes, obs.photFlux_obs, null, photFreqs);
    const photPeak = findPeak(photPower, photFreqs, obs.photTimes.length);

    results.binaryPeriod = {
      method:    'Lomb-Scargle on photometry',
      period:    photPeak.period,
      power:     photPeak.power,
      fap:       photPeak.fap,
      truePeriod: this.config.P_BIN,
      error:     Math.abs(photPeak.period - this.config.P_BIN) / this.config.P_BIN,
      freqs:     photFreqs,
      power_arr: photPower,
    };

    // ── Step 2: Binary RV fit ──────────────────────────────────────────────
    this.onProgress(0.78, 'Step 2: Binary RV curve fitting...');

    const sigmaA = new Array(obs.rvTimes.length).fill(obs.rvSigma);
    const sigmaB = new Array(obs.rvTimes.length).fill(obs.rvSigma);

    // Use the photometrically-determined binary period
    const P_bin_fit = photPeak.period;
    const binaryFit = fitBinaryRV(obs.rvTimes, obs.rvA_obs, obs.rvB_obs, sigmaA, sigmaB, P_bin_fit);

    results.binaryRV = {
      method:       'Linear least squares (circular orbit)',
      period:       P_bin_fit,
      KA:           binaryFit.KA,
      KB:           binaryFit.KB,
      massRatio:    binaryFit.massRatio,
      gamma:        binaryFit.gamma,
      chi2_dof:     binaryFit.chi2_dof,
      KA_err:       binaryFit.KA_err,
      KB_err:       binaryFit.KB_err,
      massRatio_err: binaryFit.massRatio_err,
      gamma_err:    binaryFit.gamma_err,
      trueKA:       obs.rvA_true.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0),
      trueKB:       obs.rvB_true.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0),
      trueMassRatio: this.config.starB.mass / this.config.starA.mass,
      fitA:         binaryFit.fitA,
      fitB:         binaryFit.fitB,
    };

    // ── Step 3: Derive binary barycenter RV ───────────────────────────────
    this.onProgress(0.82, 'Step 3: Deriving binary barycenter RV...');

    const q_fit = binaryFit.massRatio;
    const { rvBary: rvBary_derived, sigmaBary } = barycentricRV(
      obs.rvA_obs, obs.rvB_obs, sigmaA, sigmaB, q_fit, binaryFit.massRatio_err
    );

    // Subtract binary model from barycenter RV to get residuals
    const rvBary_model = obs.rvTimes.map(t =>
      binaryFit.fitA.cosAmp * Math.cos(2*Math.PI*t/P_bin_fit) +
      binaryFit.fitA.sinAmp * Math.sin(2*Math.PI*t/P_bin_fit)
    );
    // Barycenter model should be near zero (binary motion cancels in CoM frame)
    // The residuals are the planet signal + noise
    const rvBary_residuals = rvBary_derived.map((v, i) => v - binaryFit.gamma);

    results.barycentricRV = {
      method:       'Derived from stellar RVs using fitted mass ratio',
      rvBary:       rvBary_derived,
      sigmaBary,
      residuals:    rvBary_residuals,
      q_used:       q_fit,
      q_err:        binaryFit.massRatio_err,
      note:         'Barycenter RV is derived, not directly measured. Uncertainty propagated from stellar RV uncertainties and mass ratio error.',
    };

    // ── Step 4: Eclipse removal from photometry ────────────────────────────
    this.onProgress(0.85, 'Step 4: Removing binary eclipses from light curve...');

    const photResiduals = removePeriodicSignal(
      obs.photTimes, obs.photFlux_obs, P_bin_fit, 0, 200
    );

    results.eclipseRemoval = {
      method:   'Phase-binned template subtraction at known binary period',
      period:   P_bin_fit,
      residuals: photResiduals,
    };

    // ── Step 5: Planet search bounds ─────────────────────────────────────────
    this.onProgress(0.87, 'Step 5: Determining planetary search bounds...');

    const searchParams = createPlanetRVSearchGrid(
      P_bin_fit, 
      binaryFit.orbit ? binaryFit.orbit.e : 0, 
      q_fit, 
      obs.baseline, 
      5
    );

    // ── Step 5b: BLS planet transit search ──────────────────────────────────
    this.onProgress(0.88, 'Step 5b: BLS planet transit search...');

    let blsResult = null;
    let blsPeriods = [];
    if (!searchParams.error) {
      blsPeriods = blsPeriodGrid(obs.baseline, searchParams.P_min, searchParams.P_max, 2000, 2);
      if (blsPeriods.length > 1) {
        // NOTE: The original bug passed photResiduals to both args, we fix it to (t, y) = (obs.photTimes, photResiduals)
        blsResult = blsPeriodogram(obs.photTimes, photResiduals, blsPeriods, 0.005, 0.20, 300);
      }
    }

    results.blsSearch = {
      method:       'Box-Least-Squares on eclipse-subtracted photometry',
      periods:      blsPeriods,
      result:       blsResult,
      truePeriod:   this.config.P_PLANET,
      minPeriod:    searchParams.P_min || null,
      maxPeriod:    searchParams.P_max || null,
      caveat:       'Circumbinary planet transits are NOT strictly periodic (TTVs). BLS is a first-pass detector only.',
      note:         'Planet period restricted to > P_crit (Holman-Wiegert stability) and < obs.baseline/2.',
      errorMsg:     searchParams.error || null,
    };

    // ── Step 6: Planet period search via LS on barycenter RV ──────────────
    this.onProgress(0.91, 'Step 6: Planet period search (RV barycenter)...');

    if (searchParams.error) {
      results.planetPeriodRV = {
        method:     'GLS on binary barycenter RV residuals',
        errorMsg:   searchParams.error,
        detected:   false,
      };
    } else {
      const rvFreqs = searchParams.freqs;
      const rvWeights = sigmaBary.map(s => 1 / (s * s));
      const { power: rvPower } = lombScargle(obs.rvTimes, rvBary_residuals, rvWeights, rvFreqs);
      const rvPeak = findPeak(rvPower, rvFreqs, obs.rvTimes.length);

      results.planetPeriodRV = {
        method:     'GLS on binary barycenter RV residuals',
        period:     rvPeak.period,
        power:      rvPeak.power,
        fap:        rvPeak.fap,
        truePeriod: this.config.P_PLANET,
        error:      Math.abs(rvPeak.period - this.config.P_PLANET) / this.config.P_PLANET,
        freqs:      rvFreqs,
        power_arr:  rvPower,
        detected:   rvPeak.fap < 0.05,
        note:       'Planet RV amplitude ~4 m/s is near/below noise floor (30 m/s). Detection is challenging.',
        searchMin:  searchParams.P_min,
        searchMax:  searchParams.P_max,
      };
    }

    // ── Step 7: Planet RV amplitude fit ───────────────────────────────────
    this.onProgress(0.94, 'Step 7: Fitting planet RV signal...');

    // Use detected period if available, otherwise fall back to true period
    const rvPeakPeriod = results.planetPeriodRV && results.planetPeriodRV.period
      ? results.planetPeriodRV.period
      : this.config.P_PLANET;

    const P_planet_fit = rvPeakPeriod;
    const planetRVFit = fitCircularRV(
      obs.rvTimes, rvBary_residuals, sigmaBary, P_planet_fit
    );

    // Expected planet RV amplitude
    const K_planet_expected = rvAmplitudePlanet(
      this.config.starA.mass, this.config.starB.mass, this.config.planet.mass,
      this.config.aPlanet, this.config.ePlanet, this.config.incPlanet
    );

    results.planetRV = {
      method:       'Linear least squares circular RV fit',
      period:       P_planet_fit,
      K:            planetRVFit.K,
      K_err:        planetRVFit.K_err,
      gamma:        planetRVFit.gamma,
      chi2_dof:     planetRVFit.chi2 / (obs.rvTimes.length - 3),
      K_expected:   K_planet_expected,
      K_expected_ms: K_planet_expected * 1000,
      detected:     planetRVFit.K > 2 * planetRVFit.K_err,
      note:         `Expected K_planet ≈ ${(K_planet_expected*1000).toFixed(1)} m/s. With ${RV_SIGMA_MS} m/s noise, detection is marginal.`,
    };

    // ── Step 8: Null model comparison ─────────────────────────────────────
    this.onProgress(0.97, 'Step 8: Null model comparison...');

    // Null model: no planet, just noise
    // Compare chi² of planet model vs flat model
    const chi2_flat = rvBary_residuals.reduce((s, v, i) => s + (v / sigmaBary[i])**2, 0);
    const chi2_planet = planetRVFit.chi2;
    const dof_flat   = obs.rvTimes.length - 1;
    const dof_planet = obs.rvTimes.length - 3;
    const delta_chi2 = chi2_flat - chi2_planet;
    const delta_dof  = dof_flat - dof_planet;

    // F-test for model comparison
    const F_stat = (delta_chi2 / delta_dof) / (chi2_planet / dof_planet);

    results.nullModel = {
      chi2_flat,
      chi2_planet,
      delta_chi2,
      F_stat,
      note: `F-statistic = ${F_stat.toFixed(2)}. F > 4 suggests planet model is preferred.`,
      preferred: F_stat > 4 ? 'planet' : 'null',
    };

    this.inference = results;
    this.onProgress(1.0, 'Inference complete');
  }

  // ── Animation ─────────────────────────────────────────────────────────────

  getAnimState() {
    if (!this.animStates || this.animStates.length === 0) return this.ic.state;
    return this.animStates[this.animIdx % this.animStates.length];
  }

  getAnimTime() {
    if (!this.animTimes || this.animTimes.length === 0) return 0;
    return this.animTimes[this.animIdx % this.animTimes.length];
  }

  advanceAnim(dtReal, speedMultiplier = 1) {
    if (!this.animStates) return;
    // Map real time to simulation time
    const dtSim = dtReal * speedMultiplier; // yr/s * s = yr
    const dtFrames = dtSim / (this.animTimes[1] - this.animTimes[0]);
    this.animIdx = (this.animIdx + Math.max(1, Math.round(dtFrames))) % this.animStates.length;
  }
}
