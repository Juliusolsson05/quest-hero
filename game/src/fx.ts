import * as THREE from 'three';
import type { TimePhase, WeatherKind } from '../../shared/protocol';
import type { BuiltWorld } from './world';

/**
 * Atmosphere: the sun/sky/fog rig driven by (real) time of day, weather
 * particles, and the small life systems — fireflies, chimney smoke, fountain
 * spray. Everything lerps toward targets so weather/time changes sweep in
 * rather than snapping.
 */

interface SkyStop {
  h: number; sky: number; horizon: number; sun: number; sunInt: number;
  hemiInt: number; fogFar: number;
}
// 24h colour script. Values were eyeballed for "storybook pastel".
const STOPS: SkyStop[] = [
  { h: 0.0, sky: 0x141b33, horizon: 0x2a3352, sun: 0x9db4ff, sunInt: 0.22, hemiInt: 0.38, fogFar: 95 },
  { h: 5.0, sky: 0x1b2340, horizon: 0x3d3a5e, sun: 0xa8b8ff, sunInt: 0.25, hemiInt: 0.42, fogFar: 100 },
  { h: 6.8, sky: 0x8fb4e8, horizon: 0xffc9a8, sun: 0xffb27a, sunInt: 1.9, hemiInt: 0.85, fogFar: 130 },
  { h: 9.0, sky: 0x9fd4f5, horizon: 0xd9ecf5, sun: 0xfff2d8, sunInt: 3.1, hemiInt: 1.05, fogFar: 170 },
  { h: 15.5, sky: 0x9fd4f5, horizon: 0xd9ecf5, sun: 0xfff2d8, sunInt: 3.0, hemiInt: 1.05, fogFar: 170 },
  { h: 18.6, sky: 0x7fa3e0, horizon: 0xffb88a, sun: 0xff9d5c, sunInt: 2.0, hemiInt: 0.8, fogFar: 140 },
  { h: 20.3, sky: 0x2c3054, horizon: 0xd97a8a, sun: 0xff8a7a, sunInt: 0.7, hemiInt: 0.5, fogFar: 110 },
  { h: 21.5, sky: 0x141b33, horizon: 0x2a3352, sun: 0x9db4ff, sunInt: 0.22, hemiInt: 0.38, fogFar: 95 },
  { h: 24.0, sky: 0x141b33, horizon: 0x2a3352, sun: 0x9db4ff, sunInt: 0.22, hemiInt: 0.38, fogFar: 95 },
];

const WEATHER_MOD: Record<WeatherKind, { sun: number; grey: number; fogFar: number }> = {
  clear: { sun: 1, grey: 0, fogFar: 1 },
  clouds: { sun: 0.55, grey: 0.45, fogFar: 0.8 },
  rain: { sun: 0.38, grey: 0.6, fogFar: 0.6 },
  fog: { sun: 0.45, grey: 0.75, fogFar: 0.28 },
  snow: { sun: 0.6, grey: 0.5, fogFar: 0.55 },
  storm: { sun: 0.25, grey: 0.75, fogFar: 0.5 },
};

const CENTER = new THREE.Vector3(24, 2, 24);

export class Atmosphere {
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly skyDome: THREE.Mesh;
  private readonly skyUniforms: { top: { value: THREE.Color }; bottom: { value: THREE.Color } };
  private readonly stars: THREE.Points;

  private rain!: THREE.Points;
  private snow!: THREE.Points;
  private rainVel: number[] = [];

  private fireflies: THREE.Points | null = null;
  private smoke: THREE.Points | null = null;
  private smokeAges: number[] = [];
  private spray: THREE.Points | null = null;
  private lampLights: THREE.PointLight[] = [];
  private lampHeads: THREE.Mesh[] = [];
  private water: BuiltWorld['water'] = null;

  hour = 12;
  phase: TimePhase = 'day';
  weather: WeatherKind = 'clear';
  private weatherBlend = 1; // 0→1 after a change
  private flashT = 0;
  private nextFlash = 8;
  private t = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.hemi = new THREE.HemisphereLight(0xbfd9f5, 0x8a7f6a, 1.0);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -34; cam.right = 34; cam.top = 34; cam.bottom = -34; cam.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.target.position.copy(CENTER);
    scene.add(this.sun, this.sun.target);

    this.skyUniforms = { top: { value: new THREE.Color(0x9fd4f5) }, bottom: { value: new THREE.Color(0xd9ecf5) } };
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(190, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: this.skyUniforms as unknown as Record<string, THREE.IUniform>,
        vertexShader: `varying float vY; void main(){ vY = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float vY;
          void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.5, vY)), 1.0); }`,
      }),
    );
    this.skyDome.position.copy(CENTER);
    scene.add(this.skyDome);

    // Stars: only visible at night (opacity animated).
    const starGeo = new THREE.BufferGeometry();
    const sp: number[] = [];
    for (let i = 0; i < 320; i++) {
      const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.3;
      const r = 175;
      sp.push(CENTER.x + Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, CENTER.z + Math.sin(a) * Math.cos(e) * r);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xfff8e0, size: 0.7, transparent: true, opacity: 0, fog: false, sizeAttenuation: false,
    }));
    (this.stars.material as THREE.PointsMaterial).size = 1.6;
    scene.add(this.stars);

    scene.fog = new THREE.Fog(0xd9ecf5, 24, 170);
    this.buildPrecip();
  }

  private buildPrecip(): void {
    const mk = (n: number, size: number, color: number, opacity: number) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 34;
        pos[i * 3 + 1] = Math.random() * 18;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 34;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color, size, transparent: true, opacity, depthWrite: false,
      }));
      pts.visible = false;
      pts.frustumCulled = false;
      this.scene.add(pts);
      return pts;
    };
    this.rain = mk(1500, 0.085, 0xa8c8e8, 0.55);
    this.snow = mk(850, 0.16, 0xffffff, 0.85);
    this.rainVel = Array.from({ length: 1500 }, () => 14 + Math.random() * 8);
  }

  attachWorld(built: BuiltWorld): void {
    this.water = built.water;

    // Lamp glow heads + a few real lights (physical lights are pricey — cap them).
    for (const [i, p] of built.lamps.entries()) {
      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.26, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x6a614f }),
      );
      head.position.copy(p);
      this.scene.add(head);
      this.lampHeads.push(head);
      if (i < 5) {
        const l = new THREE.PointLight(0xffc97a, 0, 11, 2);
        l.position.copy(p).add(new THREE.Vector3(0, -0.1, 0));
        this.scene.add(l);
        this.lampLights.push(l);
      }
    }
    for (const g of built.glows) {
      const l = new THREE.PointLight(g.color, g.strength, 9, 2);
      l.position.copy(g.pos);
      this.scene.add(l);
    }

    // Fireflies around flower/hill-ish anchors: reuse lamp+fountain anchors too.
    const anchors = [...built.fountains, ...built.lamps];
    if (anchors.length) {
      const n = 70;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = anchors[i % anchors.length];
        pos[i * 3] = a.x + (Math.random() - 0.5) * 9;
        pos[i * 3 + 1] = a.y - 0.5 + Math.random() * 1.6;
        pos[i * 3 + 2] = a.z + (Math.random() - 0.5) * 9;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xd8ffa0, size: 0.12, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.fireflies.frustumCulled = false;
      this.scene.add(this.fireflies);
    }

    // Chimney smoke: pooled puffs per anchor.
    if (built.smoke.length) {
      const per = 16, n = built.smoke.length * per;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      this.smokeAges = [];
      for (let i = 0; i < n; i++) {
        const a = built.smoke[Math.floor(i / per)];
        pos[i * 3] = a.x; pos[i * 3 + 1] = a.y; pos[i * 3 + 2] = a.z;
        this.smokeAges.push(Math.random() * 3);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      (geo as unknown as { anchors: THREE.Vector3[] }).anchors = built.smoke;
      this.smoke = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xcfd4dd, size: 0.42, transparent: true, opacity: 0.28, depthWrite: false,
      }));
      this.smoke.frustumCulled = false;
      this.scene.add(this.smoke);
    }

    // Fountain spray.
    if (built.fountains.length) {
      const per = 46, n = built.fountains.length * per;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      (geo as unknown as { anchors: THREE.Vector3[] }).anchors = built.fountains;
      this.spray = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xdff3ff, size: 0.075, transparent: true, opacity: 0.8, depthWrite: false,
      }));
      this.spray.frustumCulled = false;
      this.scene.add(this.spray);
    }
  }

  setTime(hour: number, phase: TimePhase): void { this.hour = hour; this.phase = phase; }
  setWeather(kind: WeatherKind): void {
    if (kind !== this.weather) { this.weather = kind; this.weatherBlend = 0; }
  }

  private stopAt(h: number): SkyStop {
    let a = STOPS[0], b = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (h >= STOPS[i].h && h <= STOPS[i + 1].h) { a = STOPS[i]; b = STOPS[i + 1]; break; }
    }
    const t = (h - a.h) / Math.max(0.001, b.h - a.h);
    const lc = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), t);
    return {
      h, sky: lc(a.sky, b.sky).getHex(), horizon: lc(a.horizon, b.horizon).getHex(),
      sun: lc(a.sun, b.sun).getHex(), sunInt: THREE.MathUtils.lerp(a.sunInt, b.sunInt, t),
      hemiInt: THREE.MathUtils.lerp(a.hemiInt, b.hemiInt, t),
      fogFar: THREE.MathUtils.lerp(a.fogFar, b.fogFar, t),
    };
  }

  update(dt: number, camera: THREE.Camera): void {
    this.t += dt;
    this.weatherBlend = Math.min(1, this.weatherBlend + dt / 3);
    const s = this.stopAt(this.hour);
    const mod = WEATHER_MOD[this.weather];
    const grey = new THREE.Color(0x9aa4ad);
    const mix = (hex: number, g: number) => new THREE.Color(hex).lerp(grey, g * this.weatherBlend);

    const sky = mix(s.sky, mod.grey);
    const horizon = mix(s.horizon, mod.grey * 0.9);
    this.skyUniforms.top.value.copy(sky);
    this.skyUniforms.bottom.value.copy(horizon);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(horizon);
    fog.far += ((s.fogFar * THREE.MathUtils.lerp(1, mod.fogFar, this.weatherBlend)) - fog.far) * Math.min(1, dt * 2);
    fog.near = fog.far * (this.weather === 'fog' ? 0.06 : 0.16);

    // Sun arc: 6h→18h across the sky; below horizon it becomes the "moon".
    const dayT = (this.hour - 6) / 12;
    const ang = dayT * Math.PI;
    const elev = Math.sin(ang), az = Math.cos(ang);
    const night = elev <= 0.02;
    const dir = night
      ? new THREE.Vector3(0.35, 0.75, -0.4)
      : new THREE.Vector3(az * 0.9, Math.max(0.08, elev), 0.35 - dayT * 0.2);
    this.sun.position.copy(CENTER).addScaledVector(dir.normalize(), 70);
    this.sun.color.set(s.sun);
    this.sun.intensity = s.sunInt * THREE.MathUtils.lerp(1, mod.sun, this.weatherBlend);
    this.hemi.intensity = s.hemiInt * THREE.MathUtils.lerp(1, (mod.sun + 1) / 2, this.weatherBlend);
    this.hemi.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.set(0x8a7f6a);

    // Storm flash.
    if (this.weather === 'storm') {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.flashT = 0.22; this.nextFlash = 5 + Math.random() * 9; }
      if (this.flashT > 0) {
        this.flashT -= dt;
        this.hemi.intensity += 3.2 * (this.flashT / 0.22);
        this.skyUniforms.top.value.lerp(new THREE.Color(0xffffff), this.flashT * 2);
      }
    }

    // Night dressing.
    const darkness = THREE.MathUtils.clamp((0.12 - elev) * 4, 0, 1);
    (this.stars.material as THREE.PointsMaterial).opacity = darkness * (this.weather === 'clear' ? 0.9 : 0.25);
    for (const l of this.lampLights) l.intensity = darkness * 14;
    for (const h of this.lampHeads) {
      (h.material as THREE.MeshBasicMaterial).color.set(darkness > 0.4 ? 0xffd98a : 0x6a614f);
    }
    if (this.fireflies) {
      (this.fireflies.material as THREE.PointsMaterial).opacity =
        darkness * (0.55 + Math.sin(this.t * 2.4) * 0.35);
      this.fireflies.rotation.y = Math.sin(this.t * 0.11) * 0.06;
    }

    // Precipitation follows the camera.
    this.rain.visible = this.weather === 'rain' || this.weather === 'storm';
    this.snow.visible = this.weather === 'snow';
    const camPos = (camera as THREE.PerspectiveCamera).position;
    if (this.rain.visible) {
      const p = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - this.rainVel[i] * dt;
        if (y < -1) y += 18;
        p.setY(i, y);
      }
      p.needsUpdate = true;
      this.rain.position.set(camPos.x, camPos.y - 6, camPos.z);
    }
    if (this.snow.visible) {
      const p = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - 1.6 * dt;
        if (y < -1) y += 18;
        p.setY(i, y);
        p.setX(i, p.getX(i) + Math.sin(this.t * 1.3 + i) * dt * 0.5);
      }
      p.needsUpdate = true;
      this.snow.position.set(camPos.x, camPos.y - 6, camPos.z);
    }

    // Smoke & spray life.
    if (this.smoke) {
      const p = this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute;
      const anchors = (this.smoke.geometry as unknown as { anchors: THREE.Vector3[] }).anchors;
      const per = p.count / anchors.length;
      for (let i = 0; i < p.count; i++) {
        this.smokeAges[i] += dt;
        if (this.smokeAges[i] > 3) this.smokeAges[i] = 0;
        const a = anchors[Math.floor(i / per)];
        const age = this.smokeAges[i];
        p.setXYZ(i,
          a.x + Math.sin(age * 1.8 + i) * 0.22 + age * 0.18,
          a.y + age * 0.55,
          a.z + Math.cos(age * 1.4 + i) * 0.18);
      }
      p.needsUpdate = true;
    }
    if (this.spray) {
      const p = this.spray.geometry.getAttribute('position') as THREE.BufferAttribute;
      const anchors = (this.spray.geometry as unknown as { anchors: THREE.Vector3[] }).anchors;
      const per = p.count / anchors.length;
      for (let i = 0; i < p.count; i++) {
        const a = anchors[Math.floor(i / per)];
        const phase = (this.t * 1.1 + (i % per) / per) % 1;
        const ang2 = ((i * 2.4) % (Math.PI * 2));
        const r = 0.15 + phase * 0.55;
        p.setXYZ(i,
          a.x + Math.cos(ang2) * r,
          a.y + Math.sin(phase * Math.PI) * 0.9 - phase * 0.25,
          a.z + Math.sin(ang2) * r);
      }
      p.needsUpdate = true;
    }

    if (this.water) this.water.position.y = Math.sin(this.t * 1.1) * 0.045;
    this.skyDome.position.set(camPos.x, CENTER.y, camPos.z);
  }
}
