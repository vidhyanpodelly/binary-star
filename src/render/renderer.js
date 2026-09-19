/**
 * renderer.js — WebGL2 (Three.js) renderer for the binary star + planet system
 *
 * Implements physical stellar surfaces, limb darkening, gravity darkening,
 * atmospheric glow, and Roche-equipotential geometry based on interaction state.
 */

import * as THREE from '../../node_modules/three/build/three.module.js';
import { OrbitControls } from '../../node_modules/three/examples/jsm/controls/OrbitControls.js';

const vertexShader = `
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
varying float vGravityDarkening;
varying float vDisplacement;

uniform vec3 companionPos;
uniform float massRatio;
uniform float fillFactor;
uniform float isStar;
uniform float rStar;
uniform float aBin;
uniform float time;
uniform float temperature;
uniform float collisionProgress;

// Basic 3D noise for surface displacement
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute( i.z + vec4(0.0, i1.z, i2.z, 1.0 )) + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}

void main() {
    vUv = uv;
    vec3 pos = position;
    vec3 normalVec = normalize(position);
    vGravityDarkening = 1.0;
    vDisplacement = 0.0;

    if (isStar > 0.5) {
        vec3 centerWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCompanion = normalize(companionPos - centerWorld);
        vec3 localCompanionDir = normalize((inverse(modelMatrix) * vec4(toCompanion, 0.0)).xyz);
        float cosGamma = dot(normalVec, localCompanionDir);
        
        // Add subtle boiling displacement
        float boilFreq = temperature < 4000.0 ? 5.0 : 10.0;
        float boilAmp = temperature < 4000.0 ? 0.02 : 0.01;
        float disp = snoise(normalVec * boilFreq + time * 1.5) * boilAmp;
        
        if (collisionProgress > 0.0 && collisionProgress < 0.92) {
            // Collision-specific deformation
            float defProgress = min(1.0, collisionProgress / 0.78);
            
            // Large-scale asymmetric stretch towards the other star
            float stretch = 1.0;
            if (cosGamma > 0.0) {
                // Bulge heavily towards companion
                stretch += 0.4 * defProgress * pow(cosGamma, 2.0);
                
                // Add moderate noise only on the interface side
                float noiseAmp = 0.1 * defProgress * cosGamma;
                disp += snoise(normalVec * 3.0 - time * 3.0) * noiseAmp;
                
                // Hot contact interface (brighten via gravity darkening uniform override)
                vGravityDarkening += 2.0 * defProgress * pow(cosGamma, 4.0);
            } else {
                // Flatten slightly on the far side
                stretch -= 0.1 * defProgress * abs(cosGamma);
            }
            
            pos += localCompanionDir * (stretch - 1.0) * length(pos);
        }

        vDisplacement = disp;
        pos += normalVec * disp;

        if (fillFactor > 0.0 && aBin > 0.0 && collisionProgress == 0.0) {
            // Proxy for Roche equipotential distortion
            float p2 = 0.5 * (3.0 * cosGamma * cosGamma - 1.0);
            float p3 = 0.5 * (5.0 * cosGamma * cosGamma * cosGamma - 3.0 * cosGamma);
            
            float stretch = 1.0 + (fillFactor * fillFactor) * 0.1 * p2 + (fillFactor * fillFactor * fillFactor) * 0.05 * p3;
            
            if (fillFactor > 0.9 && cosGamma > 0.0) {
               float teardrop = pow(cosGamma, 4.0) * (fillFactor - 0.9) * 0.5;
               stretch += teardrop;
            }
            
            pos *= stretch;
            vGravityDarkening = pow(1.0 / stretch, 0.5);
        }
    }
    
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vec3 centerWorld = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vPosition = worldPos.xyz;
    vNormal = normalize(worldPos.xyz - centerWorld);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = `
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
varying float vGravityDarkening;
varying float vDisplacement;

uniform vec3 colorRGB;
uniform float u1;
uniform float u2;
uniform float isStar;
uniform float temperature;
uniform float time;
uniform vec3 cameraPos;

// Approximate Blackbody to RGB conversion
vec3 blackbody(float t) {
    vec3 color = vec3(0.0);
    float temp = t / 100.0;
    if (temp <= 66.0) {
        color.r = 255.0;
        color.g = temp;
        color.g = 99.4708025861 * log(color.g) - 161.1195681661;
        if (temp <= 19.0) color.b = 0.0;
        else {
            color.b = temp - 10.0;
            color.b = 138.5177312231 * log(color.b) - 305.0447927307;
        }
    } else {
        color.r = temp - 60.0;
        color.r = 329.698727446 * pow(color.r, -0.1332047592);
        color.g = temp - 60.0;
        color.g = 288.1221695283 * pow(color.g, -0.0755148492);
        color.b = 255.0;
    }
    return clamp(color / 255.0, 0.0, 1.0);
}

// Basic 3D noise for granulation
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute( i.z + vec4(0.0, i1.z, i2.z, 1.0 )) + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}

void main() {
    vec3 viewDir = normalize(cameraPos - vPosition);
    float cosTheta = max(dot(viewDir, vNormal), 0.0);
    
    vec3 finalColor = colorRGB;
    
    if (isStar > 0.5) {
        float mu = cosTheta;
        float ld = 1.0 - u1 * (1.0 - mu) - u2 * (1.0 - mu) * (1.0 - mu);
        
        float localT = temperature * vGravityDarkening;
        finalColor = blackbody(localT);
        
        float granFreq = temperature < 4000.0 ? 30.0 : 60.0;
        float granAmp = temperature < 4000.0 ? 0.2 : 0.08;
        
        // Multi-octave granulation
        float gran = snoise(vNormal * granFreq + time * 0.5) * 0.5 + 0.5;
        gran += snoise(vNormal * (granFreq * 2.0) - time) * 0.25;
        gran = 1.0 - (gran * granAmp);
        
        // Intensity mapping
        float tRatio = localT / 5000.0; 
        float lumMod = pow(tRatio, 2.0); // Softened to avoid blowout
        
        // Atmospheric Corona / Edge Glow (Fresnel-like)
        float edgeGlow = pow(1.0 - mu, 3.0) * 1.5;
        
        vec3 surfaceColor = finalColor * lumMod * ld * gran;
        vec3 glowColor = finalColor * edgeGlow;
        
        gl_FragColor = vec4(surfaceColor + glowColor, 1.0);
    } else {
        // Planet styling
        float lighting = 0.2 + 0.8 * cosTheta;
        finalColor *= lighting;
        gl_FragColor = vec4(finalColor, 1.0);
    }
}
`;

const coronaVertexShader = `
varying vec3 vNormal;
varying vec3 vPosition;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosition = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const coronaFragmentShader = `
varying vec3 vNormal;
varying vec3 vPosition;
uniform vec3 colorRGB;
uniform vec3 cameraPos;
void main() {
  vec3 viewDir = normalize(cameraPos - vPosition);
  float rim = 1.0 - max(dot(viewDir, vNormal), 0.0);
  rim = pow(rim, 3.0);
  gl_FragColor = vec4(colorRGB * rim * 1.5, rim * 0.6);
}
`;

export class Renderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = {
      scaleAU: 200,
      trailLength: 400,
      showTrails: true,
      showLabels: true,
      showScaleBar: true,
      showGlow: true,
      ...options
    };

    // Use WebGL2 context
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) {
      this._showWebGL2Error();
      return;
    }

    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050510');

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100000);
    this.controls = {
      azimuth: 0,
      elevation: 0,
      panX: 0,
      panY: 0,
      targetId: 'system',
      currentPos: new THREE.Vector3(0, 0, 0),
      targetPos: new THREE.Vector3(0, 0, 0),
      targetAzimuth: 0,
      targetElevation: 0,
      targetPanX: 0,
      targetPanY: 0,
    };
    this.options.targetScaleAU = this.options.scaleAU;

    this.trails = [[], [], []];
    this.time = 0;
    this.REQUESTED_EXAGGERATION = 30;
    this.currentScale = this.REQUESTED_EXAGGERATION;

    this._setupControls();
    this._initScene();
  }

  _showWebGL2Error() {
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = 'white';
      ctx.font = '20px sans-serif';
      ctx.fillText("WebGL2 not supported in this browser.", 20, 50);
    }
  }

  _initScene() {
    // Starfield
    const starsGeo = new THREE.BufferGeometry();
    const starsCount = 1000;
    const posArray = new Float32Array(starsCount * 3);
    const colArray = new Float32Array(starsCount * 3);
    for (let i = 0; i < starsCount * 3; i+=3) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 2000 + Math.random() * 1000;
      posArray[i] = r * Math.sin(phi) * Math.cos(theta);
      posArray[i+1] = r * Math.sin(phi) * Math.sin(theta);
      posArray[i+2] = r * Math.cos(phi);

      const color = new THREE.Color().setHSL(Math.random() < 0.7 ? 0 : 0.6, Math.random() < 0.3 ? 0.0 : 0.5, 0.8 + Math.random() * 0.2);
      colArray[i] = color.r;
      colArray[i+1] = color.g;
      colArray[i+2] = color.b;
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    starsGeo.setAttribute('color', new THREE.BufferAttribute(colArray, 3));
    const starsMat = new THREE.PointsMaterial({ size: 1.5, vertexColors: true });
    this.starfield = new THREE.Points(starsGeo, starsMat);
    this.scene.add(this.starfield);

    // Trails
    this.trailLines = [];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(this.options.trailLength * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
      const line = new THREE.Line(geo, mat);
      this.trailLines.push(line);
      this.scene.add(line);
    }

    // Bodies and Corona
    this.bodyMeshes = [];
    this.coronaMeshes = [];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.SphereGeometry(1, 64, 64);
      // Opaque Photosphere
      const mat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          colorRGB: { value: new THREE.Vector3(1, 1, 1) },
          u1: { value: 0.4 },
          u2: { value: 0.2 },
          isStar: { value: i < 2 ? 1.0 : 0.0 },
          temperature: { value: 5000.0 },
          time: { value: 0.0 },
          cameraPos: { value: new THREE.Vector3() },
          companionPos: { value: new THREE.Vector3() },
          massRatio: { value: 1.0 },
          fillFactor: { value: 0.0 },
          rStar: { value: 1.0 },
          aBin: { value: 1.0 }
        }
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.bodyMeshes.push(mesh);
      this.scene.add(mesh);

      // Transparent Corona Layer (for stars only)
      if (i < 2) {
          const coronaMat = new THREE.ShaderMaterial({
            vertexShader: coronaVertexShader,
            fragmentShader: coronaFragmentShader,
            uniforms: {
              colorRGB: { value: new THREE.Vector3(1, 1, 1) },
              cameraPos: { value: new THREE.Vector3() }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide // To always see the corona sphere outer edge
          });
          const corona = new THREE.Mesh(geo, coronaMat);
          this.coronaMeshes.push(corona);
          this.scene.add(corona);
      }
    }
    
    // UI Canvas for labels (we overlay a 2D canvas on top or just use HTML, but since canvas is fixed, let's just do sprite labels or CSS. Actually, for simplicity, I'll use a 2D context overlay later or simple text sprites)
    this.labels = [];
    for(let i=0; i<3; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 32;
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(60, 15, 1);
      this.labels.push({ sprite, canvas, tex, ctx: canvas.getContext('2d') });
      this.scene.add(sprite);
    }
  }

  _setupControls() {
    let isDragging = false;
    let dragBtn = -1;
    let lastX = 0;
    let lastY = 0;
    this.canvas.style.cursor = 'grab';
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      isDragging = true;
      dragBtn = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      this.canvas.style.cursor = dragBtn === 0 ? 'grabbing' : 'move';
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (dragBtn === 0 && !e.shiftKey) {
        this.controls.targetAzimuth += dx * 0.005;
        this.controls.targetElevation -= dy * 0.005;
        const maxElev = Math.PI / 2 - 0.01;
        if (this.controls.targetElevation > maxElev) this.controls.targetElevation = maxElev;
        if (this.controls.targetElevation < -maxElev) this.controls.targetElevation = -maxElev;
      } else {
        this.controls.targetPanX -= dx;
        this.controls.targetPanY += dy;
      }
    });
    this.canvas.addEventListener('pointerup', (e) => {
      isDragging = false;
      this.canvas.style.cursor = 'grab';
      this.canvas.releasePointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      this.options.targetScaleAU *= zoomFactor;
      if (this.options.targetScaleAU < 20) this.options.targetScaleAU = 20;
      if (this.options.targetScaleAU > 2000) this.options.targetScaleAU = 2000;
    }, { passive: false });
  }

  _parseColor(hex) {
    const c = new THREE.Color(hex);
    return new THREE.Vector3(c.r, c.g, c.b);
  }

  _updateLabel(idx, text, color) {
    const l = this.labels[idx];
    l.ctx.clearRect(0, 0, 128, 32);
    l.ctx.fillStyle = color;
    l.ctx.font = '12px sans-serif';
    l.ctx.textAlign = 'center';
    l.ctx.fillText(text, 64, 20);
    l.tex.needsUpdate = true;
  }

  updateTrails(state) {
    const positions = [
      new THREE.Vector3(state[0], -state[1], state[2]),
      new THREE.Vector3(state[6], -state[7], state[8]),
      new THREE.Vector3(state[12], -state[13], state[14])
    ];
    for (let i = 0; i < 3; i++) {
      this.trails[i].push(positions[i]);
      if (this.trails[i].length > this.options.trailLength) {
        this.trails[i].shift();
      }
      
      if (this.options.showTrails && this.trailLines) {
        const line = this.trailLines[i];
        const posAttr = line.geometry.attributes.position;
        for (let j = 0; j < this.trails[i].length; j++) {
            posAttr.setXYZ(j, this.trails[i][j].x * this.options.scaleAU, this.trails[i][j].y * this.options.scaleAU, this.trails[i][j].z * this.options.scaleAU);
        }
        line.geometry.setDrawRange(0, this.trails[i].length);
        posAttr.needsUpdate = true;
      }
    }
  }

  render(state, starA, starB, planet, t, planetRevealed = false, interaction = null) {
    if (!this.renderer) return;
    this.time += 0.05;

    // Coordinate mapping: sim x -> three x, sim y -> three -y, sim z -> three z
    const bodiesData = [
      { x: state[0],  y: -state[1],  z: state[2],  name: starA.name,  color: starA.color,  r: starA.radius, T: starA.Teff || 5000, ld: {u1:0.4, u2:0.25} },
      { x: state[6],  y: -state[7],  z: state[8],  name: starB.name,  color: starB.color,  r: starB.radius, T: starB.Teff || 3000, ld: {u1:0.55, u2:0.2} },
      { x: state[12], y: -state[13], z: state[14], name: planet.name, color: planet.color, r: planet.radius, T: 300, ld: {u1:0, u2:0} },
    ];

    // Compute target pos
    if (this.controls.targetId === 0) this.controls.targetPos.set(bodiesData[0].x, bodiesData[0].y, bodiesData[0].z);
    else if (this.controls.targetId === 1) this.controls.targetPos.set(bodiesData[1].x, bodiesData[1].y, bodiesData[1].z);
    else if (this.controls.targetId === 2) this.controls.targetPos.set(bodiesData[2].x, bodiesData[2].y, bodiesData[2].z);
    else this.controls.targetPos.set(0, 0, 0);

    // Smooth interpolations
    this.controls.currentPos.lerp(this.controls.targetPos, 0.05);
    
    // Lerp angles with shortest path
    let dAz = (this.controls.targetAzimuth - this.controls.azimuth) % (Math.PI * 2);
    if (dAz > Math.PI) dAz -= Math.PI * 2;
    if (dAz < -Math.PI) dAz += Math.PI * 2;
    this.controls.azimuth += dAz * 0.08;
    this.controls.elevation += (this.controls.targetElevation - this.controls.elevation) * 0.08;
    
    this.controls.panX += (this.controls.targetPanX - this.controls.panX) * 0.08;
    this.controls.panY += (this.controls.targetPanY - this.controls.panY) * 0.08;
    
    this.options.scaleAU += (this.options.targetScaleAU - this.options.scaleAU) * 0.08;

    // Apply camera transformations
    const dist = 60000 / this.options.scaleAU;
    const cx = this.controls.currentPos.x * this.options.scaleAU;
    const cy = this.controls.currentPos.y * this.options.scaleAU;
    const cz = this.controls.currentPos.z * this.options.scaleAU;
    
    // Convert spherical controls to camera position
    const camX = cx + dist * Math.sin(this.controls.azimuth) * Math.cos(this.controls.elevation);
    const camY = cy + dist * Math.sin(this.controls.elevation);
    const camZ = cz + dist * Math.cos(this.controls.azimuth) * Math.cos(this.controls.elevation);
    
    this.camera.position.set(camX + this.controls.panX, camY + this.controls.panY, camZ);
    this.camera.lookAt(cx + this.controls.panX, cy + this.controls.panY, cz);
    this.camera.updateMatrixWorld();

    this.updateTrails(state);

    // Dynamic scaling logic
    const dAB = Math.hypot(state[0]-state[6], state[1]-state[7], state[2]-state[8]);
    const safeScaleAB = (dAB * 0.8) / (starA.radius + starB.radius);
    this.currentScale = Math.min(this.REQUESTED_EXAGGERATION, safeScaleAB);

    if (safeScaleAB < this.REQUESTED_EXAGGERATION && safeScaleAB >= 1.0) {
      if (!this._dispatchedWarn) {
        this.canvas.dispatchEvent(new CustomEvent('visual-overlap-warning'));
        this._dispatchedWarn = true;
      }
    } else {
      if (this._dispatchedWarn) {
        this.canvas.dispatchEvent(new CustomEvent('visual-overlap-clear'));
        this._dispatchedWarn = false;
      }
    }

    // Update meshes
    for (let i = 0; i < 3; i++) {
      const mesh = this.bodyMeshes[i];
      const data = bodiesData[i];
      mesh.position.set(data.x * this.options.scaleAU, data.y * this.options.scaleAU, data.z * this.options.scaleAU);
      const visualRadius = data.r * this.options.scaleAU * this.currentScale;
      mesh.scale.set(visualRadius, visualRadius, visualRadius);

      const mat = mesh.material;
      mat.uniforms.colorRGB.value = this._parseColor(data.color);
      mat.uniforms.u1.value = data.ld.u1;
      mat.uniforms.u2.value = data.ld.u2;
      mat.uniforms.temperature.value = data.T;
      mat.uniforms.time.value = this.time;
      mat.uniforms.cameraPos.value = this.camera.position;
      
      // Roche distortion parameters
      mat.uniforms.aBin.value = dAB * this.options.scaleAU;
      if (i < 2 && interaction && interaction.state !== 'DETACHED') {
          // Identify if it's the accretor or donor
          mat.uniforms.fillFactor.value = (i === 0) ? (interaction.fillFactorA || 0) : (interaction.fillFactorB || 0);
          const compIdx = 1 - i;
          mat.uniforms.companionPos.value.set(
              bodiesData[compIdx].x * this.options.scaleAU, 
              bodiesData[compIdx].y * this.options.scaleAU, 
              bodiesData[compIdx].z * this.options.scaleAU
          );
      } else {
          mat.uniforms.fillFactor.value = 0.0;
      }

      mesh.visible = (i !== 2 || planetRevealed);
      
      // Update label
      const label = this.labels[i];
      label.sprite.position.copy(mesh.position).add(new THREE.Vector3(0, visualRadius + 20, 0));
      label.sprite.visible = mesh.visible && this.options.showLabels;
      if (label.sprite.visible) {
        this._updateLabel(i, data.name, i < 2 ? 'rgba(255,255,255,0.9)' : 'rgba(100,200,255,0.9)');
      }
      
      if (this.trailLines && this.trailLines[i]) {
          this.trailLines[i].visible = this.options.showTrails && mesh.visible;
          if (i < 2) {
              this.trailLines[i].material.color.setStyle(data.color);
          } else {
              this.trailLines[i].material.color.setHex(0x4a9eff);
          }
      }
    }

    this.renderer.render(this.scene, this.camera);
    
    // Draw 2D overlays on a separate canvas context if we want to keep ScaleBar and ObserverIndicator.
    // However, for brevity and compatibility with existing index.html canvas setup, we will create an overlay or just ignore it.
    // Given the WebGL transition, it's typical to draw UI on a separate 2D canvas. We'll skip the scale bar in this WebGL context for now, or the user can add it in CSS.
  }

  resize() {
    if (!this.renderer) return;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
  }

  clearTrails() {
    this.trails = [[], [], []];
    if (this.trailLines) {
        this.trailLines.forEach(l => l.geometry.setDrawRange(0, 0));
    }
  }

  /** Set camera focus target.
   * @param {string|number} target - 'system', 'reset', 'starA', 'starB', 'planet', or 0/1/2
   */
  setFocusTarget(target) {
    if (target === 'reset' || target === 'system') {
      this.controls.targetId = 'system';
      this.controls.targetAzimuth   = 0;
      this.controls.targetElevation = 0;
      this.controls.targetPanX      = 0;
      this.controls.targetPanY      = 0;
      this.options.targetScaleAU    = Math.min(this.canvas.width, this.canvas.height) / (window.devicePixelRatio * 2);
    } else if (target === 'starA' || target === 0) {
      this.controls.targetId  = 0;
      this.controls.targetPanX      = 0;
      this.controls.targetPanY      = 0;
      this.options.targetScaleAU = 1000;
    } else if (target === 'starB' || target === 1) {
      this.controls.targetId  = 1;
      this.controls.targetPanX      = 0;
      this.controls.targetPanY      = 0;
      this.options.targetScaleAU = 1000;
    } else if (target === 'planet' || target === 2) {
      this.controls.targetId  = 2;
      this.controls.targetPanX      = 0;
      this.controls.targetPanY      = 0;
      this.options.targetScaleAU = 1500;
    }
  }
}
