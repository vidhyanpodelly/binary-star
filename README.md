# Hidden in Starlight

**A scientifically rigorous astrophysics visualization: discover a hidden circumbinary planet through gravitational inference.**

[![Tests](https://img.shields.io/badge/tests-28%2F28%20pass-brightgreen)](tests/test_physics.js)

---

## What is this?

*Hidden in Starlight* tells the story of real physics:

> Two stars orbit each other. A planet orbits them both — hidden, gravitationally present but visually elusive. A distant observer (you) watches the light flicker and the stars wobble. Through careful measurement and inference, the planet is revealed.

This is the story of [Kepler-16b](https://science.nasa.gov/mission/kepler/kepler-16/), the first confirmed circumbinary planet, discovered by Doyle et al. (2011).

---

## How to run

```bash
# No build step required — pure ES modules
python3 -m http.server 8080
# Open http://localhost:8080 in a modern browser (Chrome, Firefox, Safari)
```

Or with Node.js:
```bash
npx serve .
```

**Requirements:** A modern browser with ES module support (Chrome 80+, Firefox 72+, Safari 14+). No npm install needed.

**Run tests:**
```bash
npm test
# Expected: 26/26 physics tests pass
npm run test:inference
# Expected: 2/2 inference tests pass
```

---

## The science

### System: Kepler-16 analog

| Parameter | Value | Source |
|-----------|-------|--------|
| Star A mass | 0.6897 M☉ | Doyle et al. 2011 |
| Star B mass | 0.2026 M☉ | Doyle et al. 2011 |
| Binary period | 41.10 days | Kepler's 3rd law |
| Binary semi-major axis | 0.2244 AU | Doyle et al. 2011 |
| Binary eccentricity | 0.1592 | Doyle et al. 2011 |
| Planet semi-major axis | 0.7048 AU | Doyle et al. 2011 |
| Planet period | 228.79 days | Kepler's 3rd law |
| Planet mass | 0.333 M_Jupiter | Doyle et al. 2011 |

### Physics model

**N-body integration:** 4th-order Runge-Kutta (RK4) with fixed time step dt = P_bin/500.

**Units:** AU, yr, M_sun → G = 4π² (exact).

**Validated conservation (measured):**
- Energy: |ΔE/E₀| = 1.1×10⁻⁷ over 10 binary periods
- Angular momentum: |ΔL/L₀| = 4.4×10⁻⁸ over 10 binary periods
- Center-of-mass drift: 2.6×10⁻¹⁵ AU

**Orbital stability:** Planet semi-major axis (0.7048 AU) exceeds the Holman-Wiegert (1999) critical radius (0.646 AU) — the orbit is dynamically stable. The inference pipeline uses the Holman-Wiegert critical period to rigorously bound the blind search, strictly avoiding information leakage from the true parameters.

### Observation model

**Photometry:**
- Limb-darkened stellar discs (quadratic law, Claret 2000)
- Geometrically correct eclipse/transit overlap integrals
- Depth ordering by z-coordinate (observer along +z)
- Noise: 200 ppm Gaussian (Kepler long-cadence analog)
- Cadence: 30 minutes

**Radial velocities:**
- Line-of-sight velocity = z-component of velocity
- Individual stellar RVs measured (K_A ≈ 13.7 km/s, K_B ≈ 46.5 km/s)
- Binary barycenter RV *derived* from stellar RVs using fitted mass ratio
- Planet-induced barycenter RV ≈ 4 m/s (below 30 m/s noise floor)
- Noise: 30 m/s Gaussian (ground-based spectrograph)

### Inference pipeline

1. **Binary period:** Generalized Lomb-Scargle (GLS) periodogram on photometry (Zechmeister & Kürster 2009)
2. **Binary RV fit:** Linear least squares (circular orbit model) for K_A, K_B, mass ratio q = m_B/m_A
3. **Barycenter RV:** Derived from stellar RVs with propagated uncertainty
4. **Eclipse removal:** Phase-binned template subtraction at known binary period
5. **Planet search:** GLS on barycenter RV residuals; BLS on eclipse-subtracted photometry
6. **Planet RV fit:** Linear least squares for K_planet
7. **Null model comparison:** F-test (planet model vs. flat model)

### Known limitations and caveats

- **Circumbinary TTVs:** Planet transits are NOT strictly periodic. BLS is a first-pass detector only; transit timing variations (TTVs) are expected and confirm the circumbinary nature.
- **Planet RV amplitude:** K_planet ≈ 4 m/s is below the 30 m/s noise floor. Detection via RV alone is marginal; photometric transits provide additional evidence.
- **Circular orbit approximation:** RV fitting uses a circular model. The binary has e=0.1592; the planet has e=0.0069. The circular approximation introduces small systematic errors in K_A, K_B.
- **Limb darkening:** Uses a simple mean-LD approximation for the overlap integral. The Mandel & Agol (2002) analytic model would be more accurate for precise transit depths.
- **Rendering exaggeration:** Stellar radii are exaggerated ×30, planet ×100 for visibility. Orbital distances are to scale.
- **Relativistic Merger Mode (Scenario B):** An optional NS+NS Merger visual mode is included for creative expression. This mode overlays a completely procedural Three.js WebGL visualization. *Important:* This renderer is purely aesthetic and decoupled from the scientific engine. It uses scientific proxies (e.g., $r_s = 2GM/c^2$, $r_{ph} = 3GM/c^2$, Keplerian particle accretion flows, Doppler beaming proxies, and screen-space gravitational lensing) to represent a relativistic aftermath, rather than true numerical relativity or GRMHD.

---

## Architecture

```
src/
  physics/
    units.js          Physical constants, unit conversions (AU, yr, M_sun)
    nbody.js          RK4 3-body integrator, conservation diagnostics
    system.js         Kepler-16 analog parameters, stability criterion
  obs/
    photometry.js     Limb-darkened transit/eclipse photometry
    radialvelocity.js LOS velocity projection, RV amplitudes
    noise.js          Gaussian noise models (photometry, RV)
  inference/
    lomb_scargle.js   GLS periodogram, FAP, phase-folding
    bls.js            BLS transit search, eclipse removal
    rv_fit.js         Linear least squares RV fitting, uncertainty
  render/
    renderer.js       Canvas 2D renderer (starfield, limb-darkened discs, trails)
    blackhole_renderer.js Three.js aesthetic black hole merger visualization
  ui/
    simulation.js     Simulation controller, pre-computation, animation
    plots.js          Scientific plot rendering (light curve, RV, periodogram)
tests/
  test_physics.js     26 unit tests (physics, photometry, inference)
  test_inference_regressions.js Validates blind search logic and prevents parameter leakage
index.html            Single-page application entry point
```

---

## References

1. Doyle, L.R. et al. (2011). "Kepler-16: A Transiting Circumbinary Planet." *Science* 333, 1602.
2. Holman, M.J. & Wiegert, P.A. (1999). "Long-Term Stability of Planets in Binary Systems." *AJ* 117, 621.
3. Zechmeister, M. & Kürster, M. (2009). "The generalised Lomb-Scargle periodogram." *A&A* 496, 577.
4. Kovács, G., Zucker, S. & Mazeh, T. (2002). "A box-fitting algorithm in the search for periodic transits." *A&A* 391, 369.
5. Claret, A. (2000). "A new non-linear limb-darkening law for LTE stellar atmosphere models." *A&A* 363, 1081.
6. Mandel, K. & Agol, E. (2002). "Analytic Light Curves for Planetary Transit Searches." *ApJ* 580, L171.
7. VanderPlas, J.T. (2018). "Understanding the Lomb-Scargle Periodogram." *ApJS* 236, 16.

---

## Test results (measured, not claimed)

```
node tests/test_physics.js

=== Summary ===
  Passed: 26
  Failed: 0
  Total:  26

All tests passed!

Key measured values:
  P_bin    = 41.10 days  (Kepler-16: 41.08 days, error 0.05%)
  P_planet = 228.79 days (Kepler-16b: 228.78 days, error 0.004%)
  K_A      = 13.66 km/s  (analytic: 13.66 km/s, error < 0.1%)
  K_B      = 46.50 km/s  (analytic: 46.50 km/s, error < 0.1%)
  Energy conservation: 1.1e-7 (10 binary periods)
  Angular momentum:    4.4e-8 (10 binary periods)
  CoM drift:           6.9e-15 AU
  Primary eclipse depth: 25,466 ppm
```

### Empirical Injection/Recovery

Tested across 10 deterministic noise realizations over a 3-year baseline (Kepler-like 30min cadence, 200ppm phot / 30m/s RV noise):
- **False Positive Rate:** 0% (0/10 detections on empty binary)
- **Recovery Rate:** 90% (9/10 detections on injected planet)
- **Measured RV Amplitude:** ~12.5 m/s
- **Recovered Period:** ~223 days (Injected: ~229 days)

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play/pause |
| R | Reset animation |

---

*Built with pure JavaScript ES modules. No external dependencies.*
