# Science Notes — Hidden in Starlight

## Physical model

### Units and constants

All simulation calculations use:
- Length: AU (astronomical unit = 1.496×10¹¹ m)
- Time: yr (Julian year = 365.25 days = 3.156×10⁷ s)
- Mass: M_sun (solar mass = 1.989×10³⁰ kg)

In these units, Newton's gravitational constant is exactly:
```
G = 4π² AU³ yr⁻² M_sun⁻¹
```
This follows from Kepler's third law: P² = a³/M for a circular orbit.

### N-body integration

The three-body equations of motion are:
```
d²rᵢ/dt² = G Σⱼ≠ᵢ mⱼ (rⱼ - rᵢ) / |rⱼ - rᵢ|³
```

We use 4th-order Runge-Kutta (RK4) with fixed time step dt = P_bin/500 ≈ 5.6×10⁻⁴ yr ≈ 0.2 days.

**Conservation validation (measured):**
- Energy error: |ΔE/E₀| = 1.1×10⁻⁷ over 10 binary periods
- Angular momentum error: |ΔL/L₀| = 4.4×10⁻⁸ over 10 binary periods
- Center-of-mass drift: 2.6×10⁻¹⁵ AU (numerical noise only)

### Initial conditions

Bodies start at periapsis (true anomaly = 0) in the center-of-mass frame.

**Binary (bodies 0 and 1):**
- Relative separation at periapsis: r_peri = a_bin × (1 - e_bin)
- Relative velocity at periapsis (vis-viva): v_rel = √(G M_bin × (2/r_peri - 1/a_bin))
- Individual positions: r_A = -(m_B/M_bin) × r_rel, r_B = +(m_A/M_bin) × r_rel
- Individual velocities: v_A = -(m_B/M_bin) × v_rel, v_B = +(m_A/M_bin) × v_rel

**Planet (body 2):**
- Orbits the binary center of mass
- Initial position: r_peri_planet = a_planet × (1 - e_planet)
- Initial velocity: v_planet = √(G M_bin × (2/r_peri_planet - 1/a_planet))

All positions and velocities are then shifted to the true center-of-mass frame (including the planet's small contribution).

### Orbital stability

The Holman-Wiegert (1999) critical semi-major axis for circumbinary stability:
```
a_crit = a_bin × (1.60 + 5.10e - 2.22e² + 4.12μ - 4.27eμ - 5.09μ² + 4.61e²μ²)
```
where e = binary eccentricity, μ = m_B/(m_A + m_B).

For our system: a_crit = 0.646 AU, a_planet = 0.7048 AU > a_crit ✓

---

## Photometry model

### Limb darkening

Quadratic limb darkening law (Claret 2000):
```
I(μ)/I(1) = 1 - u₁(1-μ) - u₂(1-μ)²
```
where μ = cos(θ) = √(1 - (r/R)²) for a point at projected radius r from disc center.

Coefficients (Kepler band):
- Star A (K dwarf, T_eff = 4450 K): u₁ = 0.40, u₂ = 0.25
- Star B (M dwarf, T_eff = 3311 K): u₁ = 0.55, u₂ = 0.20

Total disc flux (analytic):
```
F = π R² × (1 - u₁/3 - u₂/6)
```

### Eclipse/transit geometry

Observer is along the +z axis. The sky plane is x-y.

**Projected separation:** d = √((xᵢ - xⱼ)² + (yᵢ - yⱼ)²)

**Overlap condition:** d < Rᵢ + Rⱼ

**Depth ordering:** Body with larger z is closer to the observer (in front).

**Overlap area:** Analytic formula for intersection of two circles (Kovács et al. 2002).

**Blocked flux:** Approximated as overlap_area × LD(d/R_star) / total_disc_flux.

This is an approximation; the exact Mandel & Agol (2002) integral would be more accurate but is not implemented here.

### Measured transit depths

- Primary eclipse (A occults B): ~25,466 ppm (2.5%)
- Secondary eclipse (B occults A): smaller (B is less luminous)
- Planet transit (across A): ~134 ppm = (R_P/R_A)² × LD_correction
  - (R_P/R_A)² = (0.7538 R_Jup / 0.6489 R_sun)² ≈ 113 ppm
  - With limb darkening at disc center: ~134 ppm ✓

---

## Radial velocity model

### Line-of-sight velocity

Observer along +z. LOS velocity = z-component of velocity.

**Star A:** v_z,A = state[5] (AU/yr) × 1.496×10¹¹/3.156×10⁷/1000 km/s

**Conversion:** 1 AU/yr = 4.740 km/s

### RV amplitudes (analytic)

For a Keplerian orbit with semi-major axis a, eccentricity e, inclination i, period P:
```
K = (2π/P) × (m_companion/M_total) × a × sin(i) / √(1-e²)
```

**Measured values:**
- K_A = 13.66 km/s (analytic and simulated agree to < 0.1%)
- K_B = 46.50 km/s (analytic and simulated agree to < 0.1%)
- K_planet (barycenter) ≈ 4 m/s (below 30 m/s noise floor)

### Binary barycenter RV

The binary barycenter RV is DERIVED, not directly measured:
```
v_bary = (m_A × v_A + m_B × v_B) / (m_A + m_B)
       = (v_A + q × v_B) / (1 + q)
```
where q = m_B/m_A is the fitted mass ratio.

Uncertainty:
```
σ_bary = √(σ_A² + q² × σ_B²) / (1 + q)
```

This is an idealization — in practice, the two stellar spectra must be deblended.

---

## Inference model

### Generalized Lomb-Scargle (GLS) periodogram

Following Zechmeister & Kürster (2009), the GLS power at frequency ω is:
```
p(ω) = (SS × YC² + CC × YS² - 2CS × YC × YS) / (YY × D)
```
where CC, SS, CS, YC, YS are weighted sums of cos²(ωt), sin²(ωt), etc., and D = CC×SS - CS².

**Normalization:** p(ω) ∈ [0, 1]. This is NOT the Scargle (1982) normalization (which divides by 2σ²/N and gives values >> 1).

**False alarm probability:**
```
FAP(p) ≈ 1 - (1 - (1-p)^((N-3)/2))^M
```
where M = number of frequencies tested (conservative estimate of independent trials).

### RV fitting

For a fixed period P, the circular RV model is linear:
```
v(t) = A cos(2πt/P) + B sin(2πt/P) + γ
```
Solved by weighted normal equations (3×3 system). Formal uncertainties from the covariance matrix.

**Mass ratio:** q = K_A/K_B = (√(A_A²+B_A²)) / (√(A_B²+B_B²))

### Null model comparison

F-test comparing planet model (3 parameters: K, φ, γ) vs. flat model (1 parameter: γ):
```
F = (Δχ²/Δdof) / (χ²_planet/dof_planet)
```
F > 4 suggests the planet model is preferred (p < 0.05 approximately).

---

## Circumbinary planet caveats

### Transit timing variations (TTVs)

Circumbinary planet transits are NOT strictly periodic because:
1. The binary barycenter moves relative to the stars
2. The planet's orbital period is measured relative to the barycenter, but transits occur when the planet crosses in front of a specific star
3. The binary stars move during the planet's orbit, changing the geometry

TTVs for Kepler-16b are ~1-2 days (Doyle et al. 2011). This means:
- BLS (which assumes strict periodicity) will not find a clean peak
- The transit timing variations are themselves evidence for the circumbinary nature
- A full circumbinary transit model (Welsh et al. 2012) is needed for precise parameter recovery

### Planet detection difficulty

The planet-induced RV signal on the binary barycenter is:
```
K_planet ≈ 4 m/s
```
This is well below our 30 m/s noise floor. The planet is primarily detected through:
1. Photometric transits (134 ppm depth, detectable with Kepler-like precision)
2. The pattern of transit timing variations
3. The gravitational perturbation of the binary orbit (not modeled here)

This is consistent with the real Kepler-16b discovery, which relied primarily on photometry.
