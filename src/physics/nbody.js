/**
 * nbody.js — Coupled 3-body gravitational integrator
 *
 * Uses 4th-order Runge-Kutta (RK4) with adaptive step-size control.
 * State vector: [x1,y1,z1, vx1,vy1,vz1, x2,y2,z2, vx2,vy2,vz2, x3,y3,z3, vx3,vy3,vz3]
 * Units: AU, yr, M_sun  →  G = 4π²
 *
 * Validation: energy and angular momentum conservation, center-of-mass drift.
 */

import { G_AU_YR_MSUN } from './units.js';

const G = G_AU_YR_MSUN;

// ─── State helpers ────────────────────────────────────────────────────────────

/** Extract body i position [x,y,z] from flat state array */
function pos(s, i) { return [s[i*6], s[i*6+1], s[i*6+2]]; }

/** Extract body i velocity [vx,vy,vz] from flat state array */
function vel(s, i) { return [s[i*6+3], s[i*6+4], s[i*6+5]]; }

/** Euclidean distance between two 3-vectors */
function dist(a, b) {
  const dx = a[0]-b[0], dy = a[1]-b[1], dz = a[2]-b[2];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

// ─── Derivatives ─────────────────────────────────────────────────────────────

/**
 * Compute time derivatives of the state vector for N=3 bodies.
 * @param {number[]} s  - state [x1,y1,z1,vx1,vy1,vz1, ...]
 * @param {number[]} m  - masses [m1, m2, m3]
 * @returns {number[]} ds/dt
 */
function derivatives(s, m) {
  const n = 3;
  const ds = new Array(n * 6).fill(0);

  for (let i = 0; i < n; i++) {
    const pi = pos(s, i);
    const vi = vel(s, i);
    // velocity → position derivative
    ds[i*6]   = vi[0];
    ds[i*6+1] = vi[1];
    ds[i*6+2] = vi[2];

    // gravitational acceleration from all other bodies
    let ax = 0, ay = 0, az = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const pj = pos(s, j);
      const dx = pj[0] - pi[0];
      const dy = pj[1] - pi[1];
      const dz = pj[2] - pi[2];
      const r2 = dx*dx + dy*dy + dz*dz;
      const r  = Math.sqrt(r2);
      const fac = G * m[j] / (r2 * r);
      ax += fac * dx;
      ay += fac * dy;
      az += fac * dz;
    }
    ds[i*6+3] = ax;
    ds[i*6+4] = ay;
    ds[i*6+5] = az;
  }
  return ds;
}

// ─── RK4 step ────────────────────────────────────────────────────────────────

function addScaled(a, b, scale) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i] * scale;
  return out;
}

function rk4Step(s, m, dt) {
  const k1 = derivatives(s, m);
  const k2 = derivatives(addScaled(s, k1, dt/2), m);
  const k3 = derivatives(addScaled(s, k2, dt/2), m);
  const k4 = derivatives(addScaled(s, k3, dt), m);

  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s[i] + (dt/6) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]);
  }
  return out;
}

// ─── Conservation diagnostics ────────────────────────────────────────────────

/**
 * Total mechanical energy (kinetic + potential) in simulation units.
 */
export function totalEnergy(s, m) {
  const n = 3;
  let KE = 0, PE = 0;
  for (let i = 0; i < n; i++) {
    const vi = vel(s, i);
    KE += 0.5 * m[i] * (vi[0]**2 + vi[1]**2 + vi[2]**2);
    for (let j = i+1; j < n; j++) {
      const r = dist(pos(s, i), pos(s, j));
      PE -= G * m[i] * m[j] / r;
    }
  }
  return KE + PE;
}

/**
 * Total angular momentum vector L = Σ mᵢ (rᵢ × vᵢ)
 */
export function totalAngularMomentum(s, m) {
  const n = 3;
  let Lx = 0, Ly = 0, Lz = 0;
  for (let i = 0; i < n; i++) {
    const [x,y,z]    = pos(s, i);
    const [vx,vy,vz] = vel(s, i);
    Lx += m[i] * (y*vz - z*vy);
    Ly += m[i] * (z*vx - x*vz);
    Lz += m[i] * (x*vy - y*vx);
  }
  return [Lx, Ly, Lz];
}

/**
 * Center-of-mass position
 */
export function centerOfMass(s, m) {
  const n = 3;
  let Mx = 0, My = 0, Mz = 0, Mtot = 0;
  for (let i = 0; i < n; i++) {
    const [x,y,z] = pos(s, i);
    Mx += m[i]*x; My += m[i]*y; Mz += m[i]*z;
    Mtot += m[i];
  }
  return [Mx/Mtot, My/Mtot, Mz/Mtot];
}

/**
 * Center-of-mass velocity
 */
export function centerOfMassVelocity(s, m) {
  const n = 3;
  let Pvx = 0, Pvy = 0, Pvz = 0, Mtot = 0;
  for (let i = 0; i < n; i++) {
    const [vx,vy,vz] = vel(s, i);
    Pvx += m[i]*vx; Pvy += m[i]*vy; Pvz += m[i]*vz;
    Mtot += m[i];
  }
  return [Pvx/Mtot, Pvy/Mtot, Pvz/Mtot];
}

// ─── Initial conditions ───────────────────────────────────────────────────────

/**
 * Build initial state for a Kepler-16-analog system:
 *   Body 0: Star A (primary, more massive)
 *   Body 1: Star B (secondary)
 *   Body 2: Planet (circumbinary)
 *
 * All bodies start in the x-y plane (z=0).
 * The binary orbits their common barycenter; the planet orbits the binary barycenter.
 * Velocities are set for circular orbits in the CoM frame.
 *
 * @param {object} p - system parameters
 * @param {number} p.mA      - mass of star A [M_sun]
 * @param {number} p.mB      - mass of star B [M_sun]
 * @param {number} p.mP      - mass of planet [M_sun]
 * @param {number} p.aBin    - binary semi-major axis [AU]
 * @param {number} p.aPlanet - planet semi-major axis around binary CoM [AU]
 * @param {number} p.eBin    - binary eccentricity (0 = circular)
 * @param {number} p.ePlanet - planet eccentricity (0 = circular)
 * @param {number} p.incBin  - binary orbital inclination [rad] (0 = face-on)
 * @param {number} p.incPlanet - planet orbital inclination [rad]
 * @param {number} p.omegaBin  - binary argument of periapsis [rad]
 * @param {number} p.omegaPlanet - planet argument of periapsis [rad]
 * @returns {{ state: number[], masses: number[], params: object }}
 */
export function buildInitialConditions(p) {
  const { mA, mB, mP, aBin, aPlanet, eBin, ePlanet, incBin, incPlanet, omegaBin, omegaPlanet } = p;
  const mBin = mA + mB;
  const mTot = mBin + mP;

  // ── Binary: bodies orbit their mutual CoM ──────────────────────────────────
  // Reduced mass coordinates: rA = -mB/mBin * r_rel, rB = mA/mBin * r_rel
  // At periapsis (true anomaly = 0), r_rel = aBin*(1-eBin)
  const rBin = aBin * (1 - eBin); // periapsis separation

  // Relative velocity at periapsis (vis-viva)
  const vBin_rel = Math.sqrt(G * mBin * (2/rBin - 1/aBin));

  // Positions in orbital plane (periapsis along +x before rotation)
  const xA_orb = -mB/mBin * rBin;
  const xB_orb =  mA/mBin * rBin;

  // Velocities in orbital plane (perpendicular to r at periapsis = +y direction)
  const vyA_orb = -mB/mBin * vBin_rel;  // star A moves in -y at periapsis (prograde)
  const vyB_orb =  mA/mBin * vBin_rel;

  // Rotate by omegaBin then incBin
  function rotateOrbit(x, y, omega, inc) {
    // Rotate by argument of periapsis in orbital plane
    const xr = x * Math.cos(omega) - y * Math.sin(omega);
    const yr = x * Math.sin(omega) + y * Math.cos(omega);
    // Tilt by inclination (rotation about x-axis)
    return [xr, yr * Math.cos(inc), yr * Math.sin(inc)];
  }
  function rotateVel(vx, vy, omega, inc) {
    const vxr = vx * Math.cos(omega) - vy * Math.sin(omega);
    const vyr = vx * Math.sin(omega) + vy * Math.cos(omega);
    return [vxr, vyr * Math.cos(inc), vyr * Math.sin(inc)];
  }

  const [xA, yA, zA] = rotateOrbit(xA_orb, 0, omegaBin, incBin);
  const [xB, yB, zB] = rotateOrbit(xB_orb, 0, omegaBin, incBin);
  const [vxA, vyA, vzA] = rotateVel(0, vyA_orb, omegaBin, incBin);
  const [vxB, vyB, vzB] = rotateVel(0, vyB_orb, omegaBin, incBin);

  // ── Planet: orbits binary CoM ──────────────────────────────────────────────
  const rPlanet = aPlanet * (1 - ePlanet);
  const vPlanet = Math.sqrt(G * mBin * (2/rPlanet - 1/aPlanet));

  const [xP, yP, zP] = rotateOrbit(rPlanet, 0, omegaPlanet, incPlanet);
  const [vxP, vyP, vzP] = rotateVel(0, vPlanet, omegaPlanet, incPlanet);

  // ── Shift to true CoM frame ────────────────────────────────────────────────
  // CoM position (planet contribution is tiny but included for correctness)
  const comX = (mA*xA + mB*xB + mP*xP) / mTot;
  const comY = (mA*yA + mB*yB + mP*yP) / mTot;
  const comZ = (mA*zA + mB*zB + mP*zP) / mTot;
  const comVX = (mA*vxA + mB*vxB + mP*vxP) / mTot;
  const comVY = (mA*vyA + mB*vyB + mP*vyP) / mTot;
  const comVZ = (mA*vzA + mB*vzB + mP*vzP) / mTot;

  const state = [
    xA-comX, yA-comY, zA-comZ, vxA-comVX, vyA-comVY, vzA-comVZ,
    xB-comX, yB-comY, zB-comZ, vxB-comVX, vyB-comVY, vzB-comVZ,
    xP-comX, yP-comY, zP-comZ, vxP-comVX, vyP-comVY, vzP-comVZ,
  ];

  return { state, masses: [mA, mB, mP], params: p };
}

// ─── Integrator ───────────────────────────────────────────────────────────────

/**
 * Integrate the 3-body system for a given duration.
 *
 * @param {number[]} state0  - initial state (18 elements)
 * @param {number[]} masses  - [mA, mB, mP] in M_sun
 * @param {number}   tEnd    - integration end time [yr]
 * @param {number}   dt      - time step [yr]
 * @param {number}   [outputEvery=1] - store state every N steps
 * @returns {{ times: number[], states: number[][], energyError: number, angMomError: number }}
 */
export function integrate(state0, masses, tEnd, dt, outputEvery = 1) {
  const times  = [];
  const states = [];

  let s = state0.slice();
  let t = 0;
  let step = 0;

  const E0 = totalEnergy(s, masses);
  const L0 = totalAngularMomentum(s, masses);
  const L0mag = Math.sqrt(L0[0]**2 + L0[1]**2 + L0[2]**2);

  times.push(t);
  states.push(s.slice());

  while (t < tEnd - dt * 0.5) {
    s = rk4Step(s, masses, dt);
    t += dt;
    step++;
    if (step % outputEvery === 0) {
      times.push(t);
      states.push(s.slice());
    }
  }

  const Ef = totalEnergy(s, masses);
  const Lf = totalAngularMomentum(s, masses);
  const Lfmag = Math.sqrt(Lf[0]**2 + Lf[1]**2 + Lf[2]**2);

  const energyError  = Math.abs((Ef - E0) / E0);
  const angMomError  = L0mag > 0 ? Math.abs((Lfmag - L0mag) / L0mag) : 0;

  return { times, states, energyError, angMomError, E0, Ef };
}

/**
 * Integrate and call a callback at each stored step (memory-efficient streaming).
 * @param {number[]} state0
 * @param {number[]} masses
 * @param {number}   tEnd
 * @param {number}   dt
 * @param {function} callback  - (t, state) => void; return false to stop early
 */
export function integrateStream(state0, masses, tEnd, dt, callback) {
  let s = state0.slice();
  let t = 0;

  callback(t, s);

  while (t < tEnd - dt * 0.5) {
    s = rk4Step(s, masses, dt);
    t += dt;
    if (callback(t, s) === false) break;
  }
}

// ─── Convenience accessors ────────────────────────────────────────────────────

export function getPosition(state, bodyIndex) {
  return [state[bodyIndex*6], state[bodyIndex*6+1], state[bodyIndex*6+2]];
}

export function getVelocity(state, bodyIndex) {
  return [state[bodyIndex*6+3], state[bodyIndex*6+4], state[bodyIndex*6+5]];
}
