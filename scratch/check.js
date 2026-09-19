import { Simulation } from '../src/ui/simulation.js';

async function run() {
  const sim = new Simulation();
  await sim.precompute();
  const res = sim.inference;
  
  console.log("Binary RV chi2 / dof:", res.binaryRV.chi2_dof);
  
  // Calculate RMS of residuals
  const resA = res.binaryRV.fitA.residuals;
  const resB = res.binaryRV.fitB.residuals;
  
  const rmsA = Math.sqrt(resA.reduce((s, v) => s + v*v, 0) / resA.length);
  const rmsB = Math.sqrt(resB.reduce((s, v) => s + v*v, 0) / resB.length);
  
  console.log("RMS residuals A (km/s):", rmsA);
  console.log("RMS residuals B (km/s):", rmsB);
  console.log("Expected noise (km/s):", sim.config.rvSigmaMS / 1000);
}

run().catch(console.error);