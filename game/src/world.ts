import * as THREE from 'three';

/** Builds the static scene. Geometry is primitive on purpose — the interesting
 *  part of this project is the NPC agents, and a hand-modelled town would eat
 *  the whole day without making them any smarter. */
export function buildWorld(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x0b0e14);
  scene.fog = new THREE.Fog(0x0b0e14, 18, 60);

  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x241a12, 1.1));
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.5);
  sun.position.set(8, 14, 5);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3d, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  scene.add(new THREE.GridHelper(60, 60, 0x3a4256, 0x232838));

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3b4256, roughness: .9 });
  const buildings: [number, number, number, number, number][] = [
    [-10, 3, -10, 6, 6], [10, 4, -8, 7, 5], [-12, 2.5, 8, 5, 7], [11, 3.5, 10, 6, 6],
  ];
  for (const [x, h, z, w, d] of buildings) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, h / 2, z);
    scene.add(m);
  }

  const fire = new THREE.PointLight(0xff7b3a, 12, 14, 2);
  fire.position.set(0, 1.4, -3);
  scene.add(fire);
  const forge = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.1, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x241d1a, emissive: 0x5a1e08, emissiveIntensity: .5 }),
  );
  forge.position.set(0, .55, -3);
  scene.add(forge);
}
