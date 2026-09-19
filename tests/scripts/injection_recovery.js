import fs from 'fs';
import { Simulation } from '../../src/ui/simulation.js';

// Simple seeded PRNG (Mulberry32)
function mulberry32(a) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

async function runExperiment() {
  const seeds = [42, 1337, 2026, 9999, 12345, 98765, 55555, 123, 777, 888];
  
  const results = {
    noPlanet: [],
    hiddenPlanet: []
  };

  const originalRandom = Math.random;

  console.log("Starting Injection/Recovery Experiment...");
  console.log("=========================================\n");

  // Case A: No Planet
  console.log("CASE A: NO PLANET");
  for (const seed of seeds) {
    Math.random = mulberry32(seed);
    const sim = new Simulation(null, { mP: 0 }); 
    await sim.precompute();
    
    const res = sim.inference;
    results.noPlanet.push({
      seed,
      binaryPeriod: res.binaryRV.period,
      binaryChi2: res.binaryRV.chi2_dof,
      rmsA: Math.sqrt(res.binaryRV.fitA.residuals.reduce((s, v) => s + v*v, 0) / res.binaryRV.fitA.residuals.length),
      rmsB: Math.sqrt(res.binaryRV.fitB.residuals.reduce((s, v) => s + v*v, 0) / res.binaryRV.fitB.residuals.length),
      planetPeriodDetected: res.planetPeriodRV.detected,
      planetFAP: res.planetPeriodRV.fap,
      planetPeriod: res.planetPeriodRV.period,
      planetK: res.planetRV.K,
      planetKErr: res.planetRV.K_err
    });
    console.log(`  Seed ${seed} complete.`);
  }

  // Case B: Hidden Planet
  console.log("\nCASE B: HIDDEN PLANET");
  for (const seed of seeds) {
    Math.random = mulberry32(seed);
    const sim = new Simulation(null); // Defaults include mP = 1.05e-4
    await sim.precompute();
    
    const res = sim.inference;
    results.hiddenPlanet.push({
      seed,
      binaryPeriod: res.binaryRV.period,
      binaryChi2: res.binaryRV.chi2_dof,
      rmsA: Math.sqrt(res.binaryRV.fitA.residuals.reduce((s, v) => s + v*v, 0) / res.binaryRV.fitA.residuals.length),
      rmsB: Math.sqrt(res.binaryRV.fitB.residuals.reduce((s, v) => s + v*v, 0) / res.binaryRV.fitB.residuals.length),
      planetPeriodDetected: res.planetPeriodRV.detected,
      planetFAP: res.planetPeriodRV.fap,
      planetPeriod: res.planetPeriodRV.period,
      planetK: res.planetRV.K,
      planetKErr: res.planetRV.K_err
    });
    console.log(`  Seed ${seed} complete.`);
  }

  Math.random = originalRandom;

  // Print results
  console.log("\n=== QUANTITATIVE REPORT ===\n");
  
  function analyze(data, isPlanetCase) {
    const avgBinaryPeriod = data.reduce((s, r) => s + r.binaryPeriod, 0) / data.length;
    const avgChi2 = data.reduce((s, r) => s + r.binaryChi2, 0) / data.length;
    const avgRmsA = data.reduce((s, r) => s + r.rmsA, 0) / data.length * 1000; // m/s
    const avgRmsB = data.reduce((s, r) => s + r.rmsB, 0) / data.length * 1000; // m/s
    
    const detections = data.filter(r => r.planetFAP < 0.05); // fap < 5% is standard detection threshold
    const detectionRate = detections.length / data.length;
    
    console.log(`${isPlanetCase ? 'CASE B (HIDDEN PLANET)' : 'CASE A (NO PLANET)'}`);
    console.log(`  Avg Binary Period: ${avgBinaryPeriod.toFixed(6)} yr`);
    console.log(`  Avg Binary reduced chi2: ${avgChi2.toFixed(2)}`);
    console.log(`  Avg RMS Residuals: Star A = ${avgRmsA.toFixed(1)} m/s | Star B = ${avgRmsB.toFixed(1)} m/s`);
    
    if (isPlanetCase) {
      console.log(`  Recovery Rate (FAP < 0.05): ${(detectionRate * 100).toFixed(0)}%`);
    } else {
      console.log(`  False Positive Rate (FAP < 0.05): ${(detectionRate * 100).toFixed(0)}%`);
    }
    
    if (detections.length > 0) {
      const avgDetectedPeriod = detections.reduce((s, r) => s + r.planetPeriod, 0) / detections.length;
      const avgDetectedK = detections.reduce((s, r) => s + r.planetK, 0) / detections.length * 1000;
      console.log(`  Avg Detected Planet Period: ${avgDetectedPeriod.toFixed(4)} yr`);
      console.log(`  Avg Detected Planet Amplitude (K): ${avgDetectedK.toFixed(2)} m/s`);
    }
    console.log("");
  }

  analyze(results.noPlanet, false);
  analyze(results.hiddenPlanet, true);
  
  // Dump raw results for artifact table
  fs.writeFileSync('scratch/injection_results.json', JSON.stringify(results, null, 2));
}

runExperiment().catch(console.error);