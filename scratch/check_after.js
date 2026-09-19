import { Simulation } from '../src/ui/simulation.js';

async function run() {
  const sim = new Simulation();
  await sim.precompute();
  
  const res = sim.inference.binaryRV;
  
  console.log("P_BIN (true):", sim.config.P_BIN);
  console.log("P_bin_fit (refined):", res.period);
  console.log("chi2 / dof:", res.chi2_dof);
  
  const resA = res.fitA.residuals;
  const resB = res.fitB.residuals;
  const rmsA = Math.sqrt(resA.reduce((s, v) => s + v*v, 0) / resA.length);
  const rmsB = Math.sqrt(resB.reduce((s, v) => s + v*v, 0) / resB.length);
  console.log("RMS residuals A (km/s):", rmsA);
  console.log("RMS residuals B (km/s):", rmsB);
}

run().catch(console.error);