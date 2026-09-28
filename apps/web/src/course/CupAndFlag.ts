import * as THREE from 'three';
import type { Cup, Vec3 } from '@golf/sim';
import type { Environment } from '../render/Environment.js';

/** Beyond this range the flagstick grows with distance so it stays a readable landmark from the tee. */
const STICK_REFERENCE_M = 110;
const STICK_MAX_SCALE = 3.2;

export class CupAndFlag extends THREE.Group {
  private readonly flag: THREE.Mesh;
  private readonly stick = new THREE.Group();
  constructor(private cup: Cup, environment?: Environment) {
    super();
    this.flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.45, 8, 2),
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { time: { value: 0 } },
        vertexShader: 'uniform float time; varying vec2 vUv; void main(){vUv=uv; vec3 p=position; p.z += sin(time*2.0+uv.y*4.0+uv.x*5.0)*0.04*uv.x; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}',
        // Sun-lit cloth: brighter toward the free edge, a shaded band near the pole so it reads as fabric, not a decal.
        fragmentShader: 'varying vec2 vUv; void main(){float shade = 0.72 + 0.28 * smoothstep(0.0, 0.6, vUv.x) - 0.1 * abs(sin(vUv.x * 9.0)); gl_FragColor=vec4(vec3(0.92,0.13,0.1) * shade,1.0);}',
      }),
    );
    this.flag.position.set(0.4, 2.75, 0);
    this.flag.castShadow = true;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(cup.radius, cup.radius, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 1 }));
    hole.position.y = 0.006;
    this.add(hole);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.6 }));
    pole.position.y = 1.6;
    pole.castShadow = true;
    // Yellow tournament-style band at the top makes the stick read against both sky and tree line.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.35, 8), new THREE.MeshStandardMaterial({ color: 0xf7c53d, roughness: 0.6 }));
    band.position.y = 2.4;
    this.stick.add(pole, band, this.flag);
    this.add(this.stick);
    environment?.setupMaterial(hole.material);
    environment?.setupMaterial(pole.material);
    environment?.setupMaterial(band.material);
    this.setCup(cup);
  }
  setCup(cup: Cup): void {
    this.cup = cup;
    this.position.set(cup.position.x, cup.position.y, cup.position.z);
  }
  /** Cloth streams downwind; in still air it turns broadside to the camera so the pin never reads edge-on. */
  update(time: number, cameraPosition?: THREE.Vector3, wind?: Vec3): void {
    if (cameraPosition) {
      const distance = cameraPosition.distanceTo(this.position);
      const scale = Math.min(STICK_MAX_SCALE, Math.max(1, distance / STICK_REFERENCE_M));
      this.stick.scale.setScalar(scale);
    }
    const windSpeed = wind ? Math.hypot(wind.x, wind.z) : 0;
    if (wind && windSpeed > 0.5) {
      this.stick.rotation.y = Math.atan2(-wind.z, wind.x);
    } else if (cameraPosition) {
      this.stick.rotation.y = Math.atan2(cameraPosition.x - this.position.x, cameraPosition.z - this.position.z);
    }
    const material = this.flag.material;
    if (material instanceof THREE.ShaderMaterial) {
      const timeUniform = material.uniforms.time;
      if (timeUniform) timeUniform.value = time;
    }
  }
}

export function createCupAndFlag(cup: Cup, color = 0xf5f1db): CupAndFlag {
  void color;
  return new CupAndFlag(cup);
}
