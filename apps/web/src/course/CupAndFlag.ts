import * as THREE from 'three';
import type { Cup } from '@golf/sim';
import type { Environment } from '../render/Environment.js';

export class CupAndFlag extends THREE.Group {
  private readonly flag: THREE.Mesh;
  constructor(private cup: Cup, environment?: Environment) {
    super();
    this.flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 0.45, 8, 2),
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { time: { value: 0 } },
        vertexShader: 'uniform float time; varying vec2 vUv; void main(){vUv=uv; vec3 p=position; p.z += sin(time*2.0+uv.y*4.0+uv.x*5.0)*0.04*uv.x; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}',
        fragmentShader: 'varying vec2 vUv; void main(){gl_FragColor=vec4(0.95,0.15,0.12,1.0);}',
      }),
    );
    this.flag.position.set(0.35, 2.75, 0);
    this.flag.rotation.y = Math.PI / 2;
    this.flag.castShadow = true;
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(cup.radius, cup.radius, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 1 }));
    hole.position.y = 0.006;
    this.add(hole);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0xe8e6dc, roughness: 0.8 }));
    pole.position.y = 1.6;
    pole.castShadow = true;
    this.add(pole, this.flag);
    environment?.setupMaterial(hole.material);
    environment?.setupMaterial(pole.material);
    this.setCup(cup);
  }
  setCup(cup: Cup): void {
    this.cup = cup;
    this.position.set(cup.position.x, cup.position.y, cup.position.z);
  }
  update(time: number): void {
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
