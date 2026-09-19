import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class NewBlackHoleRenderer {
  constructor(container) {
    this.container = container;
    this.running = false;
    this.phase = 0;
    this.lastTime = 0;

    // Canvas setup
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width: 100%; height: 100%; display: block;';
    this.container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    
    // Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020205);
    
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.position.set(0, 3, 15);
    this.camera.lookAt(0, 0, 0);

    // Controls State
    this.azimuth = 0;
    this.elevation = 0.2;
    this.distance = 35; // default side/oblique distance
    
    this.targetAzimuth = this.azimuth;
    this.targetElevation = this.elevation;
    this.targetDistance = this.distance;

    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };
    
    this._bindEvents();
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    this.scene.add(ambientLight);
    this.pointLight = new THREE.PointLight(0xffeedd, 2.0, 50);
    this.scene.add(this.pointLight);

    // Build Sequence Elements
    this.stars = new THREE.Group();
    this.scene.add(this.stars);

    this.starA = this._createStar(0xffb347, 1.2);
    this.starB = this._createStar(0xff6b35, 0.8);
    this.stars.add(this.starA);
    this.stars.add(this.starB);

    this.tidalParticles = this._createTidalParticles();
    this.scene.add(this.tidalParticles);

    this.flash = this._createFlash();
    this.scene.add(this.flash);

    this.accretionSystem = this._createAccretionSystem();
    this.scene.add(this.accretionSystem);
    
    this.jets = this._createJets();
    this.scene.add(this.jets);

    // Load GLB (used for the core if available)
    this.glbGroup = new THREE.Group();
    this.scene.add(this.glbGroup);
    this.glbGroup.visible = false;
    
    const loader = new GLTFLoader();
    loader.load('Untitled.glb', (gltf) => {
      // Normalize scale and center
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const scale = 4.0 / maxDim; // Fit within core area
        gltf.scene.scale.set(scale, scale, scale);
      }
      
      const center = new THREE.Vector3();
      box.getCenter(center);
      gltf.scene.position.sub(center.multiplyScalar(gltf.scene.scale.x));
      
      this.glbGroup.add(gltf.scene);
    }, undefined, (error) => {
      console.error('Error loading Untitled.glb:', error);
    });

    this._createUI();
    this._resize();
  }

  _createUI() {
    this.uiContainer = document.createElement('div');
    this.uiContainer.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 100;
      pointer-events: auto;
    `;

    const createBtn = (text, onClick) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.style.cssText = `
        background: rgba(20, 20, 25, 0.8);
        color: #fff;
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 6px 12px;
        border-radius: 4px;
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        cursor: pointer;
        transition: background 0.2s, border-color 0.2s;
        text-transform: uppercase;
      `;
      btn.onmouseover = () => { btn.style.background = 'rgba(255, 107, 53, 0.3)'; btn.style.borderColor = 'rgba(255, 107, 53, 0.8)'; };
      btn.onmouseout = () => { btn.style.background = 'rgba(20, 20, 25, 0.8)'; btn.style.borderColor = 'rgba(255, 255, 255, 0.2)'; };
      btn.onclick = onClick;
      this.uiContainer.appendChild(btn);
    };

    createBtn('Top View', () => { this.targetElevation = Math.PI / 2 - 0.05; });
    createBtn('Side / Oblique View', () => { this.targetElevation = 0.2; });
    createBtn('Reset View', () => { this.targetAzimuth = 0; this.targetElevation = 0.2; this.targetDistance = 35; });
    createBtn('Zoom In', () => { this.targetDistance = Math.max(3, this.targetDistance * 0.7); });
    createBtn('Zoom Out', () => { this.targetDistance = Math.min(60, this.targetDistance * 1.4); });

    this.container.appendChild(this.uiContainer);

    // Overlay Canvas for scientific framing disclaimer
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.zIndex = '90';
    this.container.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d');
  }

  _bindEvents() {
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);

    this.canvas.addEventListener('pointerdown', e => {
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    
    this.canvas.addEventListener('pointermove', e => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      
      this.targetAzimuth -= dx * 0.005;
      this.targetElevation += dy * 0.005;
      this.targetElevation = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, this.targetElevation));
    });

    this.canvas.addEventListener('pointerup', e => {
      this.isDragging = false;
      this.canvas.releasePointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.targetDistance *= e.deltaY > 0 ? 1.1 : 0.9;
      this.targetDistance = Math.max(3, Math.min(60, this.targetDistance));
    }, { passive: false });
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight || this.container.clientWidth; // fallback if height 0
    this.canvas.width = w * window.devicePixelRatio;
    this.canvas.height = h * window.devicePixelRatio;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;
  }

  _createStar(color, size) {
    const group = new THREE.Group();
    const geo = new THREE.SphereGeometry(size, 32, 32);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    const glowGeo = new THREE.SphereGeometry(size * 1.5, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    group.add(new THREE.Mesh(glowGeo, glowMat));
    return group;
  }

  _createTidalParticles() {
    const geo = new THREE.BufferGeometry();
    const count = 3000;
    const pos = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = Math.random();
      uvs[i * 2 + 1] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const mat = new THREE.PointsMaterial({
      color: 0xffddaa, size: 0.15,
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    return pts;
  }

  _createFlash() {
    const geo = new THREE.PlaneGeometry(100, 100);
    const mat = new THREE.ShaderMaterial({
      uniforms: { intensity: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float intensity; varying vec2 vUv; void main() {
        float d = distance(vUv, vec2(0.5));
        float g = clamp((0.02 / (d*d + 0.001)) * intensity, 0.0, 1.0);
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * g, g);
      }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    return mesh;
  }

  _createAccretionSystem() {
    const group = new THREE.Group();

    // 1. Central Black Hole Shadow (Pure Black)
    const bhGeo = new THREE.SphereGeometry(2.5, 64, 64);
    const bhMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.bhShadow = new THREE.Mesh(bhGeo, bhMat);
    group.add(this.bhShadow);

    // 2. Photon Ring (Bright Inner Glow)
    const ringGeo = new THREE.TorusGeometry(2.65, 0.08, 16, 120);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffeedd, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
    this.photonRing = new THREE.Mesh(ringGeo, ringMat);
    this.photonRing.rotation.x = Math.PI / 2;
    group.add(this.photonRing);

    // 3. Lensed Inner Disk
    // Uses a custom shader to bend the rear of the disk upward/downward based on view angle.
    const lensedGeo = new THREE.BufferGeometry();
    const lCount = 120000; // Massive density for solid bright disk
    const lPos = new Float32Array(lCount * 3);
    const lUv = new Float32Array(lCount * 2);
    for (let i = 0; i < lCount; i++) {
      // radius from 2.6 to 18.0
      const r = 2.6 + Math.pow(Math.random(), 1.5) * 15.4;
      const theta = Math.random() * Math.PI * 2;
      lUv[i * 2] = r;
      lUv[i * 2 + 1] = theta;
      lPos[i * 3] = r * Math.cos(theta);
      // Very thin vertical thickness for a sharp lensed halo
      lPos[i * 3 + 1] = (Math.random() - 0.5) * 0.15;
      lPos[i * 3 + 2] = r * Math.sin(theta);
    }
    lensedGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
    lensedGeo.setAttribute('uv', new THREE.BufferAttribute(lUv, 2));

    this.lensedMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `
        uniform float time;
        varying vec3 vPos;
        varying float vTemp;
        
        void main() {
          float r = uv.x;
          // Differential rotation: faster inner
          float theta = uv.y - time * (15.0 / pow(r, 1.2));
          
          float turb = sin(theta * 6.0 + time) * 0.1;
          vec3 p = vec3(r * cos(theta), position.y + turb, r * sin(theta));
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          
          // Gravitational lensing warp (Interstellar-style approximation)
          // Find the center of the black hole in eye space
          vec4 bhPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          // dz > 0 means the point is behind the black hole relative to the camera
          float dz = bhPos.z - mvPos.z; 
          
          if (dz > 0.0) {
            // Bend the light from the back of the disk up and down to form the halo
            // The effect is strongest near the black hole (small r)
            float bendFactor = (dz * 15.0) / (r * r * r);
            float ySign = sign(position.y);
            if(ySign == 0.0) ySign = 1.0;
            mvPos.y += bendFactor * ySign;
          }
          
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = clamp(6.0 - r*0.2, 1.5, 4.0);
          
          vTemp = pow(r / 3.0, -1.0); // Hotter inside
          vPos = p;
        }
      `,
      fragmentShader: `
        varying vec3 vPos;
        varying float vTemp;
        void main() {
          float r = length(vPos.xz);
          // Color gradient: white/yellow (inner) -> intense orange -> red/dark
          vec3 col = mix(vec3(0.9, 0.3, 0.0), vec3(1.0, 0.9, 0.6), vTemp);
          float alpha = smoothstep(18.0, 10.0, r) * smoothstep(2.4, 2.7, r);
          gl_FragColor = vec4(col, alpha * 1.2 * vTemp);
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.innerDisk = new THREE.Points(lensedGeo, this.lensedMat);
    group.add(this.innerDisk);

    // 4. Extended Gas Environment (Zones 3 & 4)
    // Massive flowing volumetric wispy gas structures
    const extGeo = new THREE.BufferGeometry();
    const eCount = 100000;
    const ePos = new Float32Array(eCount * 3);
    const eUv = new Float32Array(eCount * 2);
    for (let i = 0; i < eCount; i++) {
      // Extended radius out to 60.0
      const r = 10.0 + Math.pow(Math.random(), 1.5) * 50.0;
      const theta = Math.random() * Math.PI * 2;
      eUv[i * 2] = r;
      eUv[i * 2 + 1] = theta;
      
      // Turbulence and filament offsets (sweeping spiral arms)
      const filament = Math.sin(theta * 3.0 + r * 0.5) * (r * 0.2);
      ePos[i * 3] = (r + filament) * Math.cos(theta);
      
      // Thick voluminous cloud surrounding the disk
      const thickness = 2.0 + r * 0.2;
      ePos[i * 3 + 1] = (Math.random() - 0.5) * thickness * (Math.random() > 0.5 ? 1 : -1) * Math.pow(Math.random(), 0.5);
      
      ePos[i * 3 + 2] = (r + filament) * Math.sin(theta);
    }
    extGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    extGeo.setAttribute('uv', new THREE.BufferAttribute(eUv, 2));

    this.extMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, opacityMod: { value: 1.0 } },
      vertexShader: `
        uniform float time;
        varying vec3 vPos;
        varying float vAlphaModifier;

        // Simple noise function
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main() {
          float r = uv.x;
          float theta0 = uv.y;
          
          // Slow inward spiral and differential rotation
          float angSpeed = 6.0 / pow(r, 1.2);
          float theta = theta0 - time * angSpeed;
          float rAnim = r - mod(time * 0.2 * (60.0/r), r - 10.0); // spiral in slower
          if(rAnim < 10.0) rAnim = r; // reset

          // Intense procedural turbulent displacement
          float noise = hash(vec2(theta0 * 20.0, r * 2.0));
          float turbY = sin(time*0.5 + rAnim + theta * 4.0) * (rAnim * 0.1);

          vec3 p = vec3(rAnim * cos(theta), position.y + turbY, rAnim * sin(theta));
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(40.0 / length(gl_Position.xyz), 1.0, 6.0); // size perspective
          
          vPos = p;
          // Alpha modified by noise for wispy look
          vAlphaModifier = noise;
        }
      `,
      fragmentShader: `
        uniform float opacityMod;
        varying vec3 vPos;
        varying float vAlphaModifier;
        void main() {
          float r = length(vPos.xz);
          // Very rich deep red/orange gas
          vec3 col = mix(vec3(0.2, 0.01, 0.0), vec3(0.9, 0.3, 0.0), clamp(1.0 - r/60.0, 0.0, 1.0));
          
          // Fade out at edges and inner boundary
          float alpha = smoothstep(60.0, 30.0, r) * smoothstep(8.0, 15.0, r);
          
          // Wispy filament look
          float wisp = smoothstep(0.4, 1.0, vAlphaModifier);
          
          gl_FragColor = vec4(col, alpha * wisp * 0.35 * opacityMod);
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.extGas = new THREE.Points(extGeo, this.extMat);
    group.add(this.extGas);

    group.visible = false;
    return group;
  }

  _createJets() {
    // Bipolar Jets / Outflow streams
    const geo = new THREE.BufferGeometry();
    const count = 15000;
    const pos = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = Math.random(); // t offset
      uvs[i * 2 + 1] = Math.random(); // r base
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    this.jetMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `
        uniform float time;
        varying float vAlpha;
        varying float vTemp;
        void main() {
          float tOff = uv.x;
          float rBase = uv.y;
          
          // Particles move outward along Y axis
          float speed = 2.0 + rBase * 4.0;
          float cycle = fract(time * 0.1 * speed + tOff);
          
          // Bipolar
          float sign = mod(float(gl_VertexID), 2.0) == 0.0 ? 1.0 : -1.0;
          float y = cycle * 60.0 * sign; // Tall polar outflow
          
          // Expanding cone with turbulence - extremely narrow origin
          float expansion = 0.02 + abs(y) * 0.03;
          float angle = tOff * 100.0 + time * 3.0 + y * 0.2; // spiral twist
          
          vec3 p = vec3(expansion * rBase * cos(angle), y, expansion * rBase * sin(angle));
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(15.0 / gl_Position.z, 1.0, 4.0);
          
          // Significantly dimmer and more diffuse
          vAlpha = (1.0 - cycle) * smoothstep(0.0, 0.1, cycle) * 0.15;
          vTemp = clamp(1.0 - abs(y)/60.0, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAlpha; 
        varying float vTemp;
        void main() { 
          // Blue/white plasma outflow
          vec3 col = mix(vec3(0.05, 0.2, 0.8), vec3(0.8, 0.95, 1.0), vTemp);
          gl_FragColor = vec4(col, vAlpha * 0.5); 
        }
      `,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const pts = new THREE.Points(geo, this.jetMat);
    pts.visible = false;
    return pts;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.phase = 0;
    this.lastTime = performance.now();
    
    // Ensure UI resets
    this.targetAzimuth = 0;
    this.targetElevation = 0.2;
    this.targetDistance = 25;
    this.azimuth = this.targetAzimuth;
    this.elevation = this.targetElevation;
    this.distance = this.targetDistance;
    if (this.uiContainer) this.uiContainer.style.display = 'flex';

    this._resize();
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.uiContainer) this.uiContainer.style.display = 'none';
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.container.innerHTML = '';
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000.0, 0.1);
    this.lastTime = now;

    // Timeline advances 1.0 unit over 30 seconds
    if (this.phase < 1.0) {
      this.phase += dt / 30.0;
    }
    if (this.phase > 1.0) this.phase = 1.0;

    this._updateCamera(dt);
    this._updatePhysics(this.phase, now);
    this._renderOverlay(this.phase);

    this.renderer.render(this.scene, this.camera);
  }

  _updatePhysics(p, now) {
    const t = now / 1000.0;

    // Visibility mapping
    this.stars.visible = p < 0.55;
    this.tidalParticles.visible = p > 0.25 && p < 0.6;
    this.flash.visible = p > 0.45 && p < 0.65;
    this.accretionSystem.visible = p > 0.6;
    this.jets.visible = p > 0.7;
    this.glbGroup.visible = p > 0.7;

    // Binary Inspiral
    let sep = 8.0;
    let angVel = 2.0;

    if (p < 0.45) {
      const norm = p / 0.45;
      sep = 8.0 * (1.0 - Math.pow(norm, 2.0));
      angVel = 2.0 + 20.0 * Math.pow(norm, 2.0);
    } else {
      sep = 0;
      angVel = 25.0;
    }

    const angle = t * angVel;
    const xA = (sep/2) * Math.cos(angle);
    const zA = (sep/2) * Math.sin(angle);
    this.starA.position.set(xA, 0, zA);
    this.starB.position.set(-xA, 0, -zA);

    if (this.tidalParticles.visible) {
      let t_tidal = (p - 0.25) / 0.35;
      const positions = this.tidalParticles.geometry.attributes.position.array;
      const uvs = this.tidalParticles.geometry.attributes.uv.array;
      const streamLen = 10.0 * t_tidal + sep;
      for(let i=0; i<positions.length/3; i++) {
        const sign = i % 2 === 0 ? 1 : -1;
        const rStream = sign * uvs[i*2]*uvs[i*2] * streamLen;
        const lag = Math.abs(rStream)*0.2;
        const cx = Math.cos(angle - lag);
        const cz = Math.sin(angle - lag);
        positions[i*3] = rStream * cx;
        positions[i*3+1] = (uvs[i*2+1]-0.5) * (1.0-t_tidal);
        positions[i*3+2] = rStream * cz;
      }
      this.tidalParticles.geometry.attributes.position.needsUpdate = true;
    }

    if (this.flash.visible) {
      let fNorm = (p - 0.45) / 0.2;
      let intensity = Math.exp(-Math.pow((fNorm - 0.5)*5, 2)) * 6.0;
      this.flash.material.uniforms.intensity.value = intensity;
      this.flash.lookAt(this.camera.position);
    }

    if (this.accretionSystem.visible) {
      this.lensedMat.uniforms.time.value = t;
      this.extMat.uniforms.time.value = t;
      let scale = Math.min(1.0, (p - 0.6)/0.15);
      this.accretionSystem.scale.set(scale, scale, scale);

      // Camera distance LOD (fade outer gas when zoomed in very close)
      // distance ranges from 3 to 60.
      const lodOpacity = Math.min(1.0, Math.max(0.2, (this.distance - 3.0) / 7.0));
      this.extMat.uniforms.opacityMod.value = lodOpacity;
    }

    if (this.jets.visible) {
      this.jetMat.uniforms.time.value = t;
    }

    if (this.glbGroup.visible) {
      this.glbGroup.rotation.y = t * 0.5; 
      let opacity = Math.min(1.0, (p - 0.7) / 0.2);
      let gScale = 0.5 + 0.5 * opacity;
      this.glbGroup.scale.setScalar(gScale);
    }
  }

  _updateCamera(dt) {
    // Smooth interpolation for cinematic controls
    const lerpFactor = 1.0 - Math.pow(0.01, dt);
    this.azimuth += (this.targetAzimuth - this.azimuth) * lerpFactor;
    this.elevation += (this.targetElevation - this.elevation) * lerpFactor;
    this.distance += (this.targetDistance - this.distance) * lerpFactor;

    const cx = this.distance * Math.sin(this.azimuth) * Math.cos(this.elevation);
    const cy = this.distance * Math.sin(this.elevation);
    const cz = this.distance * Math.cos(this.azimuth) * Math.cos(this.elevation);
    
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(0, 0, 0);
  }

  _renderOverlay(p) {
    const ctx = this.overlayCtx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Disclaimer
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px var(--font-mono, monospace)';
    ctx.textAlign = 'right';
    ctx.fillText('Relativistic-inspired cinematic visualization (approximation)', w - 20, h - 35);
    ctx.fillText('Not a full general-relativistic hydrodynamic simulation', w - 20, h - 20);

    // Timeline Bar
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(20, h - 25, 200, 4);
    ctx.fillStyle = 'rgba(255, 107, 53, 0.9)'; 
    ctx.fillRect(20, h - 25, 200 * p, 4);

    // Phase Label
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'left';
    ctx.font = '14px var(--font-sans, sans-serif)';
    let phaseText = 'BINARY ORBIT';
    if (p > 0.15) phaseText = 'INSPIRAL';
    if (p > 0.3) phaseText = 'TIDAL DEFORMATION';
    if (p > 0.45) phaseText = 'COLLAPSE / MERGER';
    if (p > 0.6) phaseText = 'COMPACT REMNANT';
    if (p > 0.75) phaseText = 'ACCRETION DISK';
    if (p > 0.9) phaseText = 'SUPERMASSIVE OUTFLOW';
    
    ctx.fillText(phaseText, 20, h - 35);
  }
}
