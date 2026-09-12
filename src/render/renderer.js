/**
 * renderer.js — Canvas 2D renderer for the binary star + planet system
 *
 * Renders a cinematic, NASA/planetarium-inspired view of the system.
 * Uses Canvas 2D (not WebGL) for broad compatibility.
 *
 * Coordinate system:
 *   - Simulation: AU, with observer along +z axis
 *   - Screen: x-right, y-down (canvas convention)
 *   - Sky plane: simulation x → screen x, simulation y → screen -y
 *   - Depth: simulation z (larger = closer to observer)
 *
 * Visual features:
 *   - Deep-space starfield background
 *   - Limb-darkened stellar discs with glow halos
 *   - Depth-ordered rendering (farther bodies drawn first)
 *   - Orbital trails with fade
 *   - Planet rendered as dark disc during transit
 *   - Observer direction indicator
 *   - Scale bar
 *   - Rendering-scale exaggeration disclosed
 */

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} options
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.options = {
      scaleAU:      200,   // pixels per AU (rendering scale)
      trailLength:  300,   // number of trail points per body
      showTrails:   true,
      showLabels:   true,
      showScaleBar: true,
      showGlow:     true,
      starfieldN:   800,   // number of background stars
      ...options,
    };

    this.starfield = this._generateStarfield();
    this.trails    = [[], [], []]; // trails for [starA, starB, planet]
    this.time      = 0;

    // Visual radii (pixels) — exaggerated for visibility
    // True radii are ~0.003 AU = 0.6 px at 200 px/AU — invisible
    // We exaggerate by ~30x for stars, ~100x for planet
    this.EXAGGERATION_STAR   = 30;
    this.EXAGGERATION_PLANET = 100;
  }

  // ── Starfield ─────────────────────────────────────────────────────────────

  _generateStarfield() {
    const stars = [];
    const N = this.options.starfieldN;
    for (let i = 0; i < N; i++) {
      stars.push({
        x:    Math.random(),
        y:    Math.random(),
        r:    0.3 + Math.random() * 1.2,
        a:    0.3 + Math.random() * 0.7,
        // Twinkle phase
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 2,
        // Color: mostly white, some blue/yellow tints
        hue:  Math.random() < 0.7 ? 0 : (Math.random() < 0.5 ? 220 : 45),
        sat:  Math.random() < 0.7 ? 0 : 30 + Math.random() * 40,
      });
    }
    return stars;
  }

  _drawStarfield(t) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;

    for (const s of this.starfield) {
      const twinkle = 0.7 + 0.3 * Math.sin(t * s.speed + s.phase);
      const alpha = s.a * twinkle;
      const color = s.sat > 0
        ? `hsla(${s.hue}, ${s.sat}%, 90%, ${alpha})`
        : `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  // ── Coordinate transforms ─────────────────────────────────────────────────

  /** Convert simulation AU coordinates to screen pixels */
  simToScreen(x, y) {
    const { canvas, options } = this;
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;
    return [cx + x * options.scaleAU, cy - y * options.scaleAU];
  }

  /** Convert screen pixels to simulation AU */
  screenToSim(px, py) {
    const { canvas, options } = this;
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;
    return [(px - cx) / options.scaleAU, -(py - cy) / options.scaleAU];
  }

  // ── Limb-darkened disc ────────────────────────────────────────────────────

  /**
   * Draw a limb-darkened stellar disc.
   * @param {number} cx, cy  - screen center
   * @param {number} R       - screen radius (pixels)
   * @param {string} color   - base color (CSS)
   * @param {number} u1, u2  - limb darkening coefficients
   * @param {number} alpha   - overall opacity
   */
  _drawLimbDarkenedDisc(cx, cy, R, color, u1, u2, alpha = 1) {
    const { ctx } = this;
    if (R < 0.5) return;

    // Parse color to RGB
    const rgb = this._parseColor(color);

    // Draw radial gradient approximating limb darkening
    // I(r) = 1 - u1*(1-mu) - u2*(1-mu)² where mu = sqrt(1-(r/R)²)
    // Sample at r=0 (center), r=0.5R, r=0.8R, r=R (edge)
    const samples = [0, 0.3, 0.6, 0.85, 1.0];
    const intensities = samples.map(rn => {
      if (rn >= 1) return 0;
      const mu = Math.sqrt(1 - rn * rn);
      return 1 - u1 * (1 - mu) - u2 * (1 - mu) ** 2;
    });

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    for (let i = 0; i < samples.length; i++) {
      const I = intensities[i];
      const r = Math.min(255, Math.round(rgb[0] * I));
      const g = Math.min(255, Math.round(rgb[1] * I));
      const b = Math.min(255, Math.round(rgb[2] * I));
      grad.addColorStop(samples[i], `rgba(${r},${g},${b},${alpha})`);
    }
    grad.addColorStop(1, `rgba(0,0,0,0)`);

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /**
   * Draw a glow halo around a star.
   */
  _drawGlow(cx, cy, R, color, intensity = 1) {
    const { ctx } = this;
    const rgb = this._parseColor(color);
    const glowR = R * 4;

    const grad = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, glowR);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.4 * intensity})`);
    grad.addColorStop(0.3, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.15 * intensity})`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);

    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /** Parse CSS hex color to [r,g,b] */
  _parseColor(color) {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 6) {
        return [
          parseInt(hex.slice(0,2), 16),
          parseInt(hex.slice(2,4), 16),
          parseInt(hex.slice(4,6), 16),
        ];
      }
    }
    // Fallback: white
    return [255, 255, 255];
  }

  // ── Orbital trails ────────────────────────────────────────────────────────

  updateTrails(state) {
    const positions = [
      [state[0], state[1]],
      [state[6], state[7]],
      [state[12], state[13]],
    ];
    for (let i = 0; i < 3; i++) {
      this.trails[i].push(positions[i]);
      if (this.trails[i].length > this.options.trailLength) {
        this.trails[i].shift();
      }
    }
  }

  _drawTrail(trail, color, alpha = 0.6) {
    const { ctx } = this;
    if (trail.length < 2) return;

    for (let i = 1; i < trail.length; i++) {
      const t = i / trail.length;
      const [x0, y0] = this.simToScreen(trail[i-1][0], trail[i-1][1]);
      const [x1, y1] = this.simToScreen(trail[i][0], trail[i][1]);

      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = color.replace(')', `,${t * alpha})`).replace('rgb', 'rgba');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ── Scale bar ─────────────────────────────────────────────────────────────

  _drawScaleBar() {
    const { ctx, canvas, options } = this;
    const W = canvas.width;
    const H = canvas.height;
    const barAU = 0.5; // 0.5 AU scale bar
    const barPx = barAU * options.scaleAU;
    const x0 = W - barPx - 30;
    const y0 = H - 30;

    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + barPx, y0);
    ctx.moveTo(x0, y0 - 5);
    ctx.lineTo(x0, y0 + 5);
    ctx.moveTo(x0 + barPx, y0 - 5);
    ctx.lineTo(x0 + barPx, y0 + 5);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0.5 AU', x0 + barPx/2, y0 - 8);
  }

  // ── Observer direction ────────────────────────────────────────────────────

  _drawObserverIndicator() {
    const { ctx, canvas } = this;
    const x = 30, y = canvas.height - 50;

    ctx.save();
    ctx.translate(x, y);

    // Arrow pointing toward observer (out of screen = toward us)
    ctx.strokeStyle = 'rgba(100,200,255,0.8)';
    ctx.fillStyle   = 'rgba(100,200,255,0.8)';
    ctx.lineWidth = 1.5;

    // Draw a circle with dot (perspective projection of z-axis)
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Observer', 0, 22);
    ctx.fillText('→ you', 0, 33);

    ctx.restore();
  }

  // ── Exaggeration notice ───────────────────────────────────────────────────

  _drawExaggerationNotice() {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(255,200,100,0.6)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`★ Stellar radii ×${this.EXAGGERATION_STAR}, planet ×${this.EXAGGERATION_PLANET} (orbits to scale)`, 10, this.canvas.height - 10);
  }

  // ── Main render ───────────────────────────────────────────────────────────

  /**
   * Render one frame.
   *
   * @param {number[]} state   - 18-element simulation state
   * @param {object}   starA   - star A parameters
   * @param {object}   starB   - star B parameters
   * @param {object}   planet  - planet parameters
   * @param {number}   t       - simulation time [yr]
   * @param {boolean}  planetRevealed - whether to show planet label
   */
  render(state, starA, starB, planet, t, planetRevealed = false) {
    const { ctx, canvas, options } = this;
    const W = canvas.width, H = canvas.height;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Background gradient
    const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)/2);
    bg.addColorStop(0, '#0a0a1a');
    bg.addColorStop(1, '#000005');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Starfield
    this._drawStarfield(t);

    // Update trails
    if (options.showTrails) {
      this.updateTrails(state);
    }

    // Extract positions and z-depths
    const bodies = [
      { x: state[0],  y: state[1],  z: state[2],  name: starA.name,   color: starA.color,   radius: starA.radius,   luminosity: starA.luminosity, isstar: true,  ld: { u1: 0.40, u2: 0.25 }, exag: this.EXAGGERATION_STAR,   trailIdx: 0 },
      { x: state[6],  y: state[7],  z: state[8],  name: starB.name,   color: starB.color,   radius: starB.radius,   luminosity: starB.luminosity, isstar: true,  ld: { u1: 0.55, u2: 0.20 }, exag: this.EXAGGERATION_STAR,   trailIdx: 1 },
      { x: state[12], y: state[13], z: state[14], name: planet.name,  color: planet.color,  radius: planet.radius,  luminosity: 0,                isstar: false, ld: { u1: 0,    u2: 0    }, exag: this.EXAGGERATION_PLANET, trailIdx: 2 },
    ];

    // Sort by z (ascending = farther from observer drawn first)
    const sorted = [...bodies].sort((a, b) => a.z - b.z);

    // Draw trails first (behind everything)
    if (options.showTrails) {
      const trailColors = [starA.color, starB.color, planet.color];
      const trailAlphas = [0.5, 0.5, 0.3];
      for (let i = 0; i < 3; i++) {
        const c = trailColors[i];
        const rgb = this._parseColor(c);
        this._drawTrail(this.trails[i], `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, trailAlphas[i]);
      }
    }

    // Draw bodies in depth order
    for (const body of sorted) {
      const [sx, sy] = this.simToScreen(body.x, body.y);
      const R = body.radius * options.scaleAU * body.exag;

      if (body.isstar) {
        // Glow
        if (options.showGlow) {
          this._drawGlow(sx, sy, R, body.color, body.luminosity * 5);
        }
        // Limb-darkened disc
        this._drawLimbDarkenedDisc(sx, sy, Math.max(R, 2), body.color, body.ld.u1, body.ld.u2);
      } else {
        // Planet: dark disc with subtle atmosphere glow
        const rgb = this._parseColor(body.color);

        // Atmosphere glow
        const atmGrad = ctx.createRadialGradient(sx, sy, R * 0.8, sx, sy, R * 2.5);
        atmGrad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.15)`);
        atmGrad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
        ctx.beginPath();
        ctx.arc(sx, sy, R * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = atmGrad;
        ctx.fill();

        // Planet disc (dark, with slight color)
        const discGrad = ctx.createRadialGradient(sx - R*0.3, sy - R*0.3, 0, sx, sy, R);
        discGrad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.8)`);
        discGrad.addColorStop(0.7, `rgba(${Math.round(rgb[0]*0.3)},${Math.round(rgb[1]*0.3)},${Math.round(rgb[2]*0.3)},0.9)`);
        discGrad.addColorStop(1, `rgba(10,10,20,0.95)`);
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(R, 1.5), 0, Math.PI * 2);
        ctx.fillStyle = discGrad;
        ctx.fill();
      }

      // Labels
      if (options.showLabels) {
        const labelName = (!body.isstar && !planetRevealed) ? '?' : body.name;
        const labelColor = body.isstar ? 'rgba(255,255,255,0.8)' : (planetRevealed ? 'rgba(100,200,255,0.9)' : 'rgba(255,255,100,0.6)');
        ctx.fillStyle = labelColor;
        ctx.font = body.isstar ? '12px sans-serif' : '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labelName, sx, sy - Math.max(R, 4) - 6);
      }
    }

    // UI overlays
    if (options.showScaleBar) this._drawScaleBar();
    this._drawObserverIndicator();

    // Exaggeration notice
    ctx.fillStyle = 'rgba(255,200,100,0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`★ Stellar radii ×${this.EXAGGERATION_STAR}, planet ×${this.EXAGGERATION_PLANET} (orbits to scale)`, 10, H - 10);

    // Time display
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`t = ${(t * 365.25).toFixed(1)} days`, W - 10, 20);
  }

  /**
   * Resize canvas to match display size.
   */
  resize() {
    const { canvas } = this;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    // Regenerate starfield for new size
    this.starfield = this._generateStarfield();
  }

  clearTrails() {
    this.trails = [[], [], []];
  }
}
