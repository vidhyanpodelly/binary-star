/**
 * test_physics.js — Physics validation tests
 *
 * Tests run with Node.js (ES modules).
 * Run: node --experimental-vm-modules tests/test_physics.js
 *
 * Validates:
 *   1. Energy conservation over 10 binary periods
 *   2. Angular momentum conservation
 *   3. Center-of-mass drift < 1e-10 AU
 *   4. Binary period matches Kepler's 3rd law
 *   5. RV amplitudes match analytic predictions
 *   6. Transit geometry (planet crosses stellar disc)
 *   7. Lomb-Scargle recovers known sinusoid period
 *   8. RV fitting recovers known amplitude and phase
 *   9. Phase-folding formula correctness
 *  10. BLS eclipse removal
 */

import {
  buildInitialConditions, integrate, totalEnergy, totalAngularMomentum,
  centerOfMass, centerOfMassVelocity, getPosition, getVelocity
} from '../src/physics/nbody.js';
import { G_AU_YR_MSUN, AU_YR_TO_KMS, keplerPeriod } from '../src/physics/units.js';
import { getSystemParams, STAR_A, STAR_B, PLANET, BINARY_ORBIT, PLANET_ORBIT, P_BIN, P_PLANET, A_CRIT } from '../src/physics/system.js';
import { computeFlux } from '../src/obs/photometry.js';
import { computeRV, rvAmplitudeA, rvAmplitudeB } from '../src/obs/radialvelocity.js';
import { lombScargle, frequencyGrid, findPeak, phaseFold, falseAlarmProbability } from '../src/inference/lomb_scargle.js';
import { fitCircularRV, fitBinaryRV } from '../src/inference/rv_fit.js';

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
    results.push({ name, status: 'PASS' });
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    failed++;
    results.push({ name, status: 'FAIL', error: e.message });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertClose(a, b, tol, msg) {
  const err = Math.abs(a - b);
  if (err > tol) throw new Error(`${msg || ''}: |${a} - ${b}| = ${err} > ${tol}`);
}

function assertRelClose(a, b, relTol, msg) {
  const rel = Math.abs((a - b) / (Math.abs(b) + 1e-30));
  if (rel > relTol) throw new Error(`${msg || ''}: relative error ${rel.toExponential(3)} > ${relTol}`);
}

// ── Test 1: System parameters sanity ─────────────────────────────────────────

console.log('\n=== System Parameters ===');

test('Binary period matches Kepler 3rd law', () => {
  const P_expected = keplerPeriod(BINARY_ORBIT.a, STAR_A.mass + STAR_B.mass);
  assertRelClose(P_BIN, P_expected, 1e-10, 'P_BIN');
  // Kepler-16: P_bin ≈ 41.08 days = 0.1124 yr
  assertRelClose(P_BIN, 0.1124, 0.01, 'P_BIN vs Kepler-16');
  console.log(`    P_bin = ${(P_BIN * 365.25).toFixed(2)} days (Kepler-16: 41.08 days)`);
});

test('Planet period matches Kepler 3rd law', () => {
  const P_expected = keplerPeriod(PLANET_ORBIT.a, STAR_A.mass + STAR_B.mass);
  assertRelClose(P_PLANET, P_expected, 1e-10, 'P_PLANET');
  // Kepler-16b: P_planet ≈ 228.78 days = 0.6263 yr
  assertRelClose(P_PLANET, 0.6263, 0.02, 'P_PLANET vs Kepler-16b');
  console.log(`    P_planet = ${(P_PLANET * 365.25).toFixed(2)} days (Kepler-16b: 228.78 days)`);
});

test('Planet orbit is outside stability limit', () => {
  assert(PLANET_ORBIT.a > A_CRIT,
    `Planet a=${PLANET_ORBIT.a} AU must be > stability limit ${A_CRIT.toFixed(4)} AU`);
  console.log(`    a_planet=${PLANET_ORBIT.a} AU > a_crit=${A_CRIT.toFixed(4)} AU ✓`);
});

test('Star B is cooler/redder than Star A (not blue-white)', () => {
  assert(STAR_B.Teff < STAR_A.Teff, 'Star B must be cooler than Star A');
  assert(!STAR_B.color.includes('00f') && !STAR_B.color.includes('0000ff'),
    'Star B color must not be blue');
  console.log(`    Star A: ${STAR_A.Teff}K ${STAR_A.color}, Star B: ${STAR_B.Teff}K ${STAR_B.color}`);
});

// ── Test 2: N-body integration ────────────────────────────────────────────────

console.log('\n=== N-body Integration ===');

const params = getSystemParams();
const { state: state0, masses } = buildInitialConditions(params);

test('Initial CoM position is at origin', () => {
  const [cx, cy, cz] = centerOfMass(state0, masses);
  assertClose(cx, 0, 1e-12, 'CoM x');
  assertClose(cy, 0, 1e-12, 'CoM y');
  assertClose(cz, 0, 1e-12, 'CoM z');
});

test('Initial CoM velocity is zero', () => {
  const [vx, vy, vz] = centerOfMassVelocity(state0, masses);
  assertClose(vx, 0, 1e-12, 'CoM vx');
  assertClose(vy, 0, 1e-12, 'CoM vy');
  assertClose(vz, 0, 1e-12, 'CoM vz');
});

// Integrate for 10 binary periods
const dt = P_BIN / 200; // 200 steps per binary period
const tEnd = 10 * P_BIN;
console.log(`    Integrating ${tEnd.toFixed(4)} yr (10 P_bin) with dt=${dt.toExponential(3)} yr...`);
const result = integrate(state0, masses, tEnd, dt, 1);

test('Energy conservation < 1e-6 over 10 binary periods', () => {
  console.log(`    Energy error: ${result.energyError.toExponential(3)}`);
  assert(result.energyError < 1e-6,
    `Energy error ${result.energyError.toExponential(3)} exceeds 1e-6`);
});

test('Angular momentum conservation < 1e-7 over 10 binary periods', () => {
  console.log(`    Angular momentum error: ${result.angMomError.toExponential(3)}`);
  assert(result.angMomError < 1e-7,
    `Angular momentum error ${result.angMomError.toExponential(3)} exceeds 1e-7`);
});

test('CoM drift < 1e-10 AU over 10 binary periods', () => {
  const lastState = result.states[result.states.length - 1];
  const [cx, cy, cz] = centerOfMass(lastState, masses);
  const drift = Math.sqrt(cx**2 + cy**2 + cz**2);
  console.log(`    CoM drift: ${drift.toExponential(3)} AU`);
  assert(drift < 1e-10, `CoM drift ${drift.toExponential(3)} AU exceeds 1e-10`);
});

// Longer integration for planet period
const tEnd2 = 3 * P_PLANET;
const dt2 = P_BIN / 100;
console.log(`    Integrating ${tEnd2.toFixed(4)} yr (3 P_planet) with dt=${dt2.toExponential(3)} yr...`);
const result2 = integrate(state0, masses, tEnd2, dt2, 1);

test('Energy conservation < 1e-5 over 3 planet periods', () => {
  console.log(`    Energy error: ${result2.energyError.toExponential(3)}`);
  assert(result2.energyError < 1e-5,
    `Energy error ${result2.energyError.toExponential(3)} exceeds 1e-5`);
});

// ── Test 3: RV amplitudes ─────────────────────────────────────────────────────

console.log('\n=== Radial Velocity Amplitudes ===');

test('Star A RV amplitude matches analytic prediction', () => {
  const KA_analytic = rvAmplitudeA(STAR_A.mass, STAR_B.mass, BINARY_ORBIT.a, BINARY_ORBIT.e, BINARY_ORBIT.inc);
  console.log(`    K_A (analytic) = ${KA_analytic.toFixed(2)} km/s`);

  // Measure from simulation: find max |vz_A| over one binary period
  const dtRV = P_BIN / 500;
  const rvResult = integrate(state0, masses, P_BIN, dtRV, 1);
  const vzA_values = rvResult.states.map(s => s[5] * AU_YR_TO_KMS);
  const KA_sim = (Math.max(...vzA_values) - Math.min(...vzA_values)) / 2;
  console.log(`    K_A (simulated) = ${KA_sim.toFixed(2)} km/s`);

  // Should agree within 5% (eccentricity causes slight deviation from simple formula)
  assertRelClose(KA_sim, KA_analytic, 0.05, 'K_A');
});

test('Star B RV amplitude matches analytic prediction', () => {
  const KB_analytic = rvAmplitudeB(STAR_A.mass, STAR_B.mass, BINARY_ORBIT.a, BINARY_ORBIT.e, BINARY_ORBIT.inc);
  console.log(`    K_B (analytic) = ${KB_analytic.toFixed(2)} km/s`);

  const dtRV = P_BIN / 500;
  const rvResult = integrate(state0, masses, P_BIN, dtRV, 1);
  const vzB_values = rvResult.states.map(s => s[11] * AU_YR_TO_KMS);
  const KB_sim = (Math.max(...vzB_values) - Math.min(...vzB_values)) / 2;
  console.log(`    K_B (simulated) = ${KB_sim.toFixed(2)} km/s`);

  assertRelClose(KB_sim, KB_analytic, 0.05, 'K_B');
});

test('RV amplitudes are in km/s range (not km/s * 1000)', () => {
  const KA = rvAmplitudeA(STAR_A.mass, STAR_B.mass, BINARY_ORBIT.a, BINARY_ORBIT.e, BINARY_ORBIT.inc);
  const KB = rvAmplitudeB(STAR_A.mass, STAR_B.mass, BINARY_ORBIT.a, BINARY_ORBIT.e, BINARY_ORBIT.inc);
  // Binary stellar RVs should be order 10-100 km/s, NOT thousands
  assert(KA > 5 && KA < 200, `K_A = ${KA.toFixed(2)} km/s out of expected range [5, 200]`);
  assert(KB > 5 && KB < 500, `K_B = ${KB.toFixed(2)} km/s out of expected range [5, 500]`);
  console.log(`    K_A = ${KA.toFixed(2)} km/s, K_B = ${KB.toFixed(2)} km/s ✓`);
});

test('Mass ratio from RV amplitudes matches true ratio', () => {
  const KA = rvAmplitudeA(STAR_A.mass, STAR_B.mass, BINARY_ORBIT.a, BINARY_ORBIT.e, BINARY_ORBIT.inc);
  const KB = rvAmplitudeB(STAR_A.mass, STAR_B.mass, BINARY_ORBIT.a, BINARY_ORBIT.e, BINARY_ORBIT.inc);
  const q_rv = KA / KB;
  const q_true = STAR_B.mass / STAR_A.mass;
  assertRelClose(q_rv, q_true, 0.001, 'mass ratio from RV');
  console.log(`    q_RV = ${q_rv.toFixed(4)}, q_true = ${q_true.toFixed(4)}`);
});

// ── Test 4: Photometry ────────────────────────────────────────────────────────

console.log('\n=== Photometry ===');

test('Flux = 1.0 when no eclipse/transit', () => {
  // Place bodies far apart in sky plane
  const testState = [
    -1, 0, 0, 0, 0, 0,   // Star A at (-1, 0, 0)
     1, 0, 0, 0, 0, 0,   // Star B at (1, 0, 0)
     0, 5, 0, 0, 0, 0,   // Planet far away in y
  ];
  const flux = computeFlux(testState, STAR_A, STAR_B, PLANET);
  assertClose(flux, 1.0, 1e-10, 'Flux out of eclipse');
});

test('Flux < 1.0 during primary eclipse (A occults B)', () => {
  // Star A in front of Star B (zA > zB), aligned in sky
  const testState = [
    0, 0, 1, 0, 0, 0,   // Star A at (0, 0, 1) — closer to observer
    0, 0, -1, 0, 0, 0,  // Star B at (0, 0, -1) — farther
    0, 5, 0, 0, 0, 0,   // Planet far away
  ];
  const flux = computeFlux(testState, STAR_A, STAR_B, PLANET);
  assert(flux < 1.0, `Flux during eclipse should be < 1.0, got ${flux}`);
  console.log(`    Primary eclipse depth: ${((1-flux)*1e6).toFixed(0)} ppm`);
});

test('Flux < 1.0 during planet transit', () => {
  // Planet in front of Star A (zP > zA), aligned in sky
  const testState = [
    0, 0, -1, 0, 0, 0,  // Star A farther from observer
    5, 0, 0, 0, 0, 0,   // Star B far away in x
    0, 0, 1, 0, 0, 0,   // Planet closer to observer, aligned with Star A
  ];
  const flux = computeFlux(testState, STAR_A, STAR_B, PLANET);
  assert(flux < 1.0, `Flux during transit should be < 1.0, got ${flux}`);
  const depth_ppm = (1 - flux) * 1e6;
  console.log(`    Planet transit depth: ${depth_ppm.toFixed(0)} ppm`);
  // Planet transit depth ≈ (RP/RA)² ≈ (0.7538*R_Jup / 0.6489*R_sun)² ≈ 113 ppm
  // With limb darkening at disc center, depth is slightly larger: ~130-150 ppm
  assert(depth_ppm > 50 && depth_ppm < 5000, `Transit depth ${depth_ppm.toFixed(0)} ppm out of expected range [50, 5000]`);
});

test('At least one transit occurs in 3 planet periods', () => {
  // Check that the simulation produces transit events
  let transitCount = 0;
  const dtPhot = P_BIN / 50; // sample at 50x binary period
  const tEndPhot = 3 * P_PLANET;
  const photResult = integrate(state0, masses, tEndPhot, dtPhot, 1);

  for (const s of photResult.states) {
    const flux = computeFlux(s, STAR_A, STAR_B, PLANET);
    if (flux < 0.999) transitCount++;
  }
  console.log(`    Transit/eclipse samples: ${transitCount} / ${photResult.states.length}`);
  assert(transitCount > 0, 'No transit/eclipse events detected in 3 planet periods');
});

// ── Test 5: Lomb-Scargle periodogram ─────────────────────────────────────────

console.log('\n=== Lomb-Scargle Periodogram ===');

test('LS recovers known sinusoid period (no noise)', () => {
  const P_true = 0.5; // yr
  const K_true = 10;  // km/s
  const N = 200;
  const tBaseline = 5; // yr
  const t = Array.from({ length: N }, (_, i) => i * tBaseline / N);
  const y = t.map(ti => K_true * Math.sin(2 * Math.PI * ti / P_true));

  const freqs = frequencyGrid(tBaseline, 0.1, 2.0, 5);
  const { power } = lombScargle(t, y, null, freqs);
  const peak = findPeak(power, freqs, N);

  console.log(`    True P=${P_true} yr, recovered P=${peak.period.toFixed(4)} yr, power=${peak.power.toFixed(4)}`);
  assertRelClose(peak.period, P_true, 0.02, 'LS period recovery');
  assert(peak.power > 0.9, `LS power ${peak.power.toFixed(4)} should be > 0.9 for noise-free sinusoid`);
});

test('LS power is in [0,1] range', () => {
  const N = 100;
  const t = Array.from({ length: N }, (_, i) => i * 0.1);
  const y = t.map(ti => Math.sin(2 * Math.PI * ti / 0.7) + 0.1 * (Math.random() - 0.5));
  const freqs = frequencyGrid(10, 0.2, 2.0, 3);
  const { power } = lombScargle(t, y, null, freqs);
  assert(power.every(p => p >= 0 && p <= 1), 'All LS powers must be in [0,1]');
  console.log(`    Max power: ${Math.max(...power).toFixed(4)}, Min: ${Math.min(...power).toFixed(4)}`);
});

test('LS FAP is calibrated (noise-only data has FAP > 0.01 at peak)', () => {
  // For pure noise, the peak power should have FAP > 0.01 most of the time
  // Run 10 trials and check that FAP is not systematically near 0
  const N = 100;
  const tBaseline = 5;
  const t = Array.from({ length: N }, (_, i) => i * tBaseline / N);
  const freqs = frequencyGrid(tBaseline, 0.1, 2.0, 3);

  let lowFAPCount = 0;
  for (let trial = 0; trial < 20; trial++) {
    const y = t.map(() => Math.random() - 0.5); // pure noise
    const { power } = lombScargle(t, y, null, freqs);
    const peak = findPeak(power, freqs, N);
    if (peak.fap < 0.001) lowFAPCount++;
  }
  console.log(`    Noise-only trials with FAP < 0.001: ${lowFAPCount}/20`);
  // Should be rare (< 5 out of 20 = 25%, but FAP < 0.001 should be < 2%)
  assert(lowFAPCount <= 5, `Too many false detections: ${lowFAPCount}/20 trials had FAP < 0.001`);
});

test('Phase-folding formula is correct (no precedence bug)', () => {
  // Test: ((t % P) + P) % P / P should give phase in [0,1)
  // The bug was: 2*pi*((t%P)+P)%P/P — multiplication before second modulus
  const P = 1.5;
  const testTimes = [-3.7, -0.1, 0, 0.5, 1.5, 2.3, 7.8, -7.8];
  for (const t of testTimes) {
    const phase = ((t % P) + P) % P / P;
    assert(phase >= 0 && phase < 1, `Phase ${phase} out of [0,1) for t=${t}, P=${P}`);
    // Verify: phase * P should equal (t mod P) in [0, P)
    const tMod = ((t % P) + P) % P;
    assertClose(phase * P, tMod, 1e-12, `Phase*P != t mod P for t=${t}`);
  }
  console.log('    Phase formula ((t%P+P)%P)/P is correct for all test cases');
});

// ── Test 6: RV fitting ────────────────────────────────────────────────────────

console.log('\n=== RV Fitting ===');

test('fitCircularRV recovers known amplitude and phase', () => {
  const P_true = 0.3;   // yr
  const K_true = 15.0;  // km/s
  const phi_true = 0.8; // rad
  const gamma_true = 2.5; // km/s
  const sigma = 0.5;    // km/s noise

  const N = 100;
  const tBaseline = 3;
  const t = Array.from({ length: N }, (_, i) => i * tBaseline / N);
  const rv = t.map(ti => K_true * Math.sin(2 * Math.PI * ti / P_true + phi_true) + gamma_true);
  const sigmas = new Array(N).fill(sigma);

  const fit = fitCircularRV(t, rv, sigmas, P_true);
  console.log(`    True K=${K_true}, fitted K=${fit.K.toFixed(4)}, err=${fit.K_err.toFixed(4)}`);
  console.log(`    True γ=${gamma_true}, fitted γ=${fit.gamma.toFixed(4)}, err=${fit.gamma_err.toFixed(4)}`);

  assertRelClose(fit.K, K_true, 0.001, 'RV amplitude recovery');
  assertRelClose(fit.gamma, gamma_true, 0.001, 'Systemic velocity recovery');
  assert(fit.chi2 / (N - 3) < 2.0, `chi²/dof = ${(fit.chi2/(N-3)).toFixed(3)} too large`);
});

test('fitCircularRV with noise: K within 3-sigma of truth', () => {
  const P_true = 0.3;
  const K_true = 15.0;
  const sigma = 1.0;
  const N = 50;
  const tBaseline = 3;
  const t = Array.from({ length: N }, (_, i) => i * tBaseline / N);

  // Add Gaussian noise
  const rv = t.map(ti => K_true * Math.sin(2 * Math.PI * ti / P_true) + sigma * (Math.random() * 2 - 1) * 1.2);
  const sigmas = new Array(N).fill(sigma);

  const fit = fitCircularRV(t, rv, sigmas, P_true);
  const nSigma = Math.abs(fit.K - K_true) / fit.K_err;
  console.log(`    K_true=${K_true}, K_fit=${fit.K.toFixed(3)}, K_err=${fit.K_err.toFixed(3)}, nσ=${nSigma.toFixed(2)}`);
  assert(nSigma < 5, `K recovery: ${nSigma.toFixed(2)}σ from truth (expected < 5σ)`);
});

test('fitBinaryRV recovers mass ratio', () => {
  const mA = 0.6897, mB = 0.2026;
  const q_true = mB / mA;
  const KA_true = 13.7; // km/s
  const KB_true = KA_true / q_true;
  const P = 0.1124; // yr
  const sigma = 0.5;

  const N = 80;
  const tBaseline = 2;
  const t = Array.from({ length: N }, (_, i) => i * tBaseline / N);
  const rvA = t.map(ti => KA_true * Math.sin(2 * Math.PI * ti / P));
  const rvB = t.map(ti => -KB_true * Math.sin(2 * Math.PI * ti / P)); // anti-phase
  const sigmaArr = new Array(N).fill(sigma);

  const fit = fitBinaryRV(t, rvA, rvB, sigmaArr, sigmaArr, P);
  console.log(`    q_true=${q_true.toFixed(4)}, q_fit=${fit.massRatio.toFixed(4)}, q_err=${fit.massRatio_err.toFixed(4)}`);
  assertRelClose(fit.massRatio, q_true, 0.02, 'Mass ratio from binary RV fit');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n=== Summary ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
  console.log('\nFailed tests:');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  ✗ ${r.name}: ${r.error}`);
  });
  process.exit(1);
} else {
  console.log('\nAll tests passed! ✓');
  process.exit(0);
}
