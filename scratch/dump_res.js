import { Simulation } from '../src/ui/simulation.js';
import fs from 'fs';

async function run() {
  const sim = new Simulation();
  await sim.precompute();
  const res = sim.inference.binaryRV;
  
  let out = "t,rvA,modelA,resA\n";
  const t = sim.obs.rvTimes;
  const rvA = sim.obs.rvA_obs;
  const resA = res.fitA.residuals;
  for(let i=0; i<t.length; i++) {
     out += `${t[i]},${rvA[i]},${rvA[i] - resA[i]},${resA[i]}\n`;
  }
  fs.writeFileSync('scratch/residuals.csv', out);
  console.log("Wrote residuals.csv");
}

run().catch(console.error);