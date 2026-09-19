import { Simulation } from '../src/ui/simulation.js';
import { fitBinaryRV } from '../src/inference/rv_fit.js';

async function run() {
  const sim = new Simulation();
  await sim.precompute();
  
  const obs = sim.obs;
  const sigmaA = new Array(obs.rvTimes.length).fill(obs.rvSigma);
  const sigmaB = new Array(obs.rvTimes.length).fill(obs.rvSigma);
  const binaryOrbit = { t0: 0, e: sim.config.eBin, omega: sim.config.omegaBin, fitT0: true };
  
  const P_true = sim.config.P_BIN;
  const fit = fitBinaryRV(obs.rvTimes, obs.rvA_obs, obs.rvB_obs, sigmaA, sigmaB, P_true, binaryOrbit);
  
  console.log("Using TRUE P_BIN:");
  console.log("chi2 / dof:", fit.chi2_dof);
  
  const resA = fit.fitA.residuals;
  const resB = fit.fitB.residuals;
  const rmsA = Math.sqrt(resA.reduce((s, v) => s + v*v, 0) / resA.length);
  const rmsB = Math.sqrt(resB.reduce((s, v) => s + v*v, 0) / resB.length);
  console.log("RMS residuals A (km/s):", rmsA);
  console.log("RMS residuals B (km/s):", rmsB);
}

run().catch(console.error);