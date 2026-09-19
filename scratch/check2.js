import { Simulation } from '../src/ui/simulation.js';

async function run() {
  const sim = new Simulation();
  await sim.precompute();
  const res = sim.inference.binaryRV;
  
  console.log("P_BIN (true):", sim.config.P_BIN);
  console.log("P_bin_fit:", res.period);
  console.log("LS method:", sim.inference.binaryPeriod.method);
  
  const diff = res.period - sim.config.P_BIN;
  console.log("Period error (yr):", diff);
  
  console.log("Phase error over 3 years (rad):", (3 / sim.config.P_BIN) * (diff / sim.config.P_BIN) * 2 * Math.PI);
}

run().catch(console.error);