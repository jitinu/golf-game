import * as THREE from 'three';
import { SurfaceId } from '@golf/course-format';

interface Particle {
  age: number;
  life: number;
  velocity: THREE.Vector3;
  active: boolean;
}

const MAX_PARTICLES = 96;
const GRAVITY = 9.8;

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function particleColors(surface: SurfaceId): THREE.Color[] {
  if (surface === SurfaceId.Bunker) return [new THREE.Color(0xd9c69a), new THREE.Color(0xefe2bd)];
  if (surface === SurfaceId.Path || surface === SurfaceId.Dirt) return [new THREE.Color(0x5b4630), new THREE.Color(0x8b8575)];
  return [
    new THREE.Color(0x4f7a2a),
    new THREE.Color(0x7da441),
    new THREE.Color(0x5b4630),
  ];
}

function puffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.35, 'rgba(230,220,190,0.42)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ImpactEffects {
  readonly group = new THREE.Group();
  private readonly points: THREE.Points;
  private readonly pointMaterial: THREE.PointsMaterial;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 3);
  private readonly particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    age: 1,
    life: 1,
    velocity: new THREE.Vector3(),
    active: false,
  }));
  private readonly puff: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private puffAge = 1;
  private puffLife = 0.25;

  constructor() {
    this.pointMaterial = new THREE.PointsMaterial({
      size: 0.035,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geometry, this.pointMaterial);
    this.points.frustumCulled = false;
    this.points.castShadow = false;
    this.points.userData.excludeAO = true;
    this.group.add(this.points);

    this.puff = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: puffTexture(),
        color: 0xe8d9b7,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        side: THREE.DoubleSide,
      }),
    );
    this.puff.rotation.x = -Math.PI / 2;
    this.puff.frustumCulled = false;
    this.puff.castShadow = false;
    this.puff.userData.excludeAO = true;
    this.group.add(this.puff);
  }

  trigger(position: THREE.Vector3, direction: THREE.Vector3, surface: SurfaceId, launchSpeed: number): void {
    if (launchSpeed < 6 || surface === SurfaceId.Water) return;
    const colors = particleColors(surface);
    const isGreen = surface === SurfaceId.Green;
    const isBunker = surface === SurfaceId.Bunker;
    const count = Math.min(MAX_PARTICLES, Math.max(10, Math.round(launchSpeed * 1.2 * (isBunker ? 1.6 : isGreen ? 0.5 : 1))));
    const normalDirection = direction.clone().setY(0).normalize();
    const lateral = new THREE.Vector3(-normalDirection.z, 0, normalDirection.x);
    let spawned = 0;
    for (const particle of this.particles) {
      if (spawned >= count) break;
      const seed = spawned + launchSpeed * 0.31;
      const spread = 0.04 + hash(seed * 1.7) * 0.04;
      const speed = 1.5 + hash(seed * 2.1) * 2.5;
      const motionScale = isBunker ? 0.65 : 1;
      particle.age = 0;
      particle.life = 0.5 + hash(seed * 2.9) * 0.4;
      particle.active = true;
      particle.velocity.copy(normalDirection).multiplyScalar(speed)
        .addScaledVector(lateral, (hash(seed * 3.3) - 0.5) * 1.2)
        .add(new THREE.Vector3(0, 1.5 + hash(seed * 4.1) * 2, 0));
      particle.velocity.multiplyScalar(motionScale);
      const index = spawned * 3;
      this.positions[index] = position.x + normalDirection.x * spread;
      this.positions[index + 1] = position.y + 0.01 + hash(seed * 5.3) * 0.025;
      this.positions[index + 2] = position.z + normalDirection.z * spread;
      const color = colors[Math.floor(hash(seed * 6.7) * colors.length)] ?? colors[0]!;
      this.colors[index] = color.r;
      this.colors[index + 1] = color.g;
      this.colors[index + 2] = color.b;
      spawned += 1;
    }
    for (let index = spawned; index < MAX_PARTICLES; index += 1) this.particles[index]!.active = false;
    this.pointMaterial.opacity = 0.95;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    this.puff.position.copy(position);
    this.puff.scale.setScalar(0.05);
    this.puffAge = 0;
    this.puffLife = isBunker ? 0.32 : 0.25;
    this.puff.material.opacity = 0.55;
  }

  update(dt: number): void {
    let active = 0;
    let opacity = 0;
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index]!;
      if (!particle.active) continue;
      particle.age += Math.max(0, dt);
      if (particle.age >= particle.life) {
        particle.active = false;
        continue;
      }
      particle.velocity.y -= GRAVITY * Math.max(0, dt);
      const offset = index * 3;
      this.positions[offset] = (this.positions[offset] ?? 0) + particle.velocity.x * dt;
      this.positions[offset + 1] = (this.positions[offset + 1] ?? 0) + particle.velocity.y * dt;
      this.positions[offset + 2] = (this.positions[offset + 2] ?? 0) + particle.velocity.z * dt;
      const fade = particle.age > particle.life * 0.6
        ? 1 - (particle.age - particle.life * 0.6) / (particle.life * 0.4)
        : 1;
      opacity += fade;
      active += 1;
    }
    this.pointMaterial.opacity = active > 0 ? opacity / active : 0;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = active > 0;

    if (this.puffAge < this.puffLife) {
      this.puffAge += Math.max(0, dt);
      const progress = THREE.MathUtils.clamp(this.puffAge / this.puffLife, 0, 1);
      this.puff.scale.setScalar(0.05 + progress * 0.4);
      this.puff.material.opacity = 0.55 * (1 - progress);
    } else {
      this.puff.material.opacity = 0;
    }
  }
}
