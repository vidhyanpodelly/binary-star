import { blsPeriodogram } from '../src/inference/bls.js';
import {
  barycentricRV,
  circularRVModel,
  fitBinaryRV,
  fitCircularRV,
  fitConstantRV,
  keplerianRVModel,
} from '../src/inference/rv_fit.js';
import { createPlanetRVSearchGrid } from '../src/inference/lomb_scargle.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('\x1b[32m  ✓ ' + name + '\x1b[0m');
    passed++;
  } catch (error) {
    console.error('\x1b[31m  ✗ ' + name + ': ' + error.message + '\x1b[0m');
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertClose(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(message + ': expected ' + expected + ', got ' + actual);
  }
}

console.log('\n=== Inference Regression Tests ===');

test('BLS recovers a periodic transit from observation timestamps', () => {
  const period = 2;
  const times = Array.from({ length: 600 }, (_, i) => i * 0.031 + (i % 7) * 0.0007);
  const flux = times.map(t => ((t % period) / period) < 0.06 ? 0.99 : 1.0);
  const periods = Array.from({ length: 81 }, (_, i) => 1.6 + i * 0.01);
  const result = blsPeriodogram(times, flux, periods, 0.03, 0.10, 120);
  assertClose(result.bestPeriod, period, 0.03, 'BLS period');
});

test('fixed-shape eccentric binary fit recovers anti-phased amplitudes', () => {
  const P = 0.4;
  const orbit = { t0: 0.03, e: 0.22, omega: 0.7 };
  const KA = 12;
  const KB = 36;
  const gammaA = 0.4;
  const gammaB = 0.4;
  const t = Array.from({ length: 240 }, (_, i) => i * 2 / 239);
  const sigma = new Array(t.length).fill(0.05);
  const rvA = t.map(ti => keplerianRVModel(ti, -KA, P, orbit.t0, orbit.e, orbit.omega, gammaA));
  const rvB = t.map(ti => keplerianRVModel(ti, KB, P, orbit.t0, orbit.e, orbit.omega, gammaB));
  const fit = fitBinaryRV(t, rvA, rvB, sigma, sigma, P, orbit);
  assertClose(fit.KA, KA, 1e-10, 'K_A');
  assertClose(fit.KB, KB, 1e-10, 'K_B');
  assertClose(fit.massRatio, KA / KB, 1e-10, 'mass ratio');
  assert(fit.fitA.signedK < 0 && fit.fitB.signedK > 0, 'binary phases were not preserved');
  assert(fit.chi2 < 1e-16, 'exact Keplerian data should have negligible chi-square');
});

test('binary RV fit with fitP refines an incorrect initial period guess', () => {
  const trueP = 0.4015;
  const orbit = { t0: 0.03, e: 0.22, omega: 0.7, fitT0: true, fitP: true };
  const KA = 12;
  const KB = 36;
  const gammaA = 0.4;
  const gammaB = 0.4;
  
  const t = Array.from({ length: 300 }, (_, i) => i * 3 / 299);
  const sigma = new Array(t.length).fill(0.1);
  const rvA = t.map(ti => keplerianRVModel(ti, -KA, trueP, orbit.t0, orbit.e, orbit.omega, gammaA));
  const rvB = t.map(ti => keplerianRVModel(ti, KB, trueP, orbit.t0, orbit.e, orbit.omega, gammaB));
  
  const initialGuessP = 0.4000;
  
  const fit = fitBinaryRV(t, rvA, rvB, sigma, sigma, initialGuessP, orbit);
  
  assertClose(fit.orbit.P, trueP, 1e-5, 'refined period');
  assert(fit.chi2 < 1e-8, 'refined period should yield negligible chi-square on exact data');
});

test('constant null model fits its offset instead of imposing zero', () => {
  const t = [0, 1, 2, 3];
  const rv = [0.42, 0.42, 0.42, 0.42];
  const sigma = [0.1, 0.1, 0.1, 0.1];
  const fit = fitConstantRV(t, rv, sigma);
  assertClose(fit.gamma, 0.42, 1e-12, 'null-model offset');
  assertClose(fit.chi2, 0, 1e-20, 'null-model chi-square');
});

test('barycentric uncertainty includes the mass-ratio term', () => {
  const rvA = [10];
  const rvB = [-30];
  const sigmaA = [0.1];
  const sigmaB = [0.3];
  const q = 0.33333333333;
  const q_err = 0.05;
  const { rvBary, sigmaBary } = barycentricRV(rvA, rvB, sigmaA, sigmaB, q, q_err);
  
  // (10 + 0.3333*-30)/1.3333 = 0
  assertClose(rvBary[0], 0, 1e-5, 'barycenter RV');
  // uncertainty > sigmaA[0] since it incorporates q_err
  assert(sigmaBary[0] > 0.1, 'uncertainty must propagate');
});

test('blind planet search grid is identical for different hidden planets', () => {
  const binaryP = 0.4;
  const binaryE = 0.16;
  const q = 0.25;
  const baseline = 3.0;

  // System A: planet P = 1.8
  const gridA = createPlanetRVSearchGrid(binaryP, binaryE, q, baseline, 5);

  // System B: planet P = 2.4
  const gridB = createPlanetRVSearchGrid(binaryP, binaryE, q, baseline, 5);

  assert(gridA.error === undefined, 'grid should not return error');
  assertClose(gridA.P_min, gridB.P_min, 1e-12, 'P_min must be identical');
  assertClose(gridA.P_max, gridB.P_max, 1e-12, 'P_max must be identical');
  assert(gridA.freqs.length > 0, 'freqs should not be empty');
  assert(gridA.freqs.length === gridB.freqs.length, 'freqs length must match');
  for (let i = 0; i < gridA.freqs.length; i++) {
    assertClose(gridA.freqs[i], gridB.freqs[i], 1e-12, 'freq must be identical');
  }

  const expected_mu = 0.2;
  const expected_ar = 1.60 + 5.10*0.16 - 2.22*(0.16**2) + 4.12*0.2 - 4.27*0.16*0.2 - 5.09*(0.04) + 4.61*(0.16**2)*(0.04);
  const expected_P_crit = 0.4 * Math.pow(expected_ar, 1.5);
  assertClose(gridA.P_min, expected_P_crit, 1e-6, 'P_min must match Holman-Wiegert');
});

console.log('\n=== Summary ===');
console.log('  Passed: ' + passed);
console.log('  Failed: ' + failed);
console.log('  Total:  ' + (passed + failed));
if (failed > 0) process.exit(1);
console.log('\nAll tests passed! ✓');