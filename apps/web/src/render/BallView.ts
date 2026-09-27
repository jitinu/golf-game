import * as THREE from 'three';
import type { BallState } from '@golf/sim';
import type { Environment } from './Environment.js';
import { TrajectoryPlayback } from '../game/TrajectoryPlayback.js';

const BALL_RADIUS = 0.02135;
/** Minimum on-screen size of the ball marker, as a fraction of viewport height. */
const MIN_SCREEN_FRACTION = 0.011;
const TRAIL_POINTS = 240;
const TRAIL_SAMPLE_M = 0.6;

function glintTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The 4.3 cm ball plus two presentation aids: a distance-scaled glint sprite so the ball stays
 * visible at 200 m, and a fading tracer line along the flight path.
 */
export class BallView {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  readonly group = new THREE.Group();
  readonly playback = new TrajectoryPlayback();
  private readonly glint: THREE.Sprite;
  private readonly trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly trailPositions = new Float32Array(TRAIL_POINTS * 3);
  private readonly trailColors = new Float32Array(TRAIL_POINTS * 3);
  private trailCount = 0;
  private readonly lastTrailPoint = new THREE.Vector3();

  constructor(environment?: Environment) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0 }));
    this.mesh.castShadow = true;
    environment?.setupMaterial(this.mesh.material);
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), transparent: true, depthWrite: false, depthTest: false, opacity: 0.85, toneMapped: false }));
    this.glint.renderOrder = 10;
    this.glint.userData.excludeAO = true;
    this.glint.visible = false;
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));
    trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.trail.frustumCulled = false;
    this.trail.userData.excludeAO = true;
    this.group.add(this.mesh, this.glint, this.trail);
  }

  place(position: { x: number; y: number; z: number }): void {
    this.mesh.position.set(position.x, position.y, position.z);
    this.glint.position.copy(this.mesh.position);
  }

  start(trajectory: BallState[]): void {
    this.playback.start(trajectory);
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
    this.lastTrailPoint.set(Number.NaN, 0, 0);
    this.glint.visible = true;
  }

  update(dtMs: number): void {
    this.playback.update(dtMs);
    this.place(this.playback.position);
    if (this.playback.done) {
      this.glint.visible = false;
      return;
    }
    const state = this.playback.state;
    if (state && state.mode === 'flight' && (Number.isNaN(this.lastTrailPoint.x) || this.lastTrailPoint.distanceTo(this.mesh.position) > TRAIL_SAMPLE_M)) {
      this.pushTrailPoint(this.mesh.position);
    }
  }

  /** Scales the glint so the ball marker never drops below a few pixels; call once per frame with the render camera. */
  frame(camera: THREE.PerspectiveCamera, viewportHeightPx: number): void {
    const distance = camera.position.distanceTo(this.mesh.position);
    const worldPerPixel = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / viewportHeightPx;
    const minSize = worldPerPixel * viewportHeightPx * MIN_SCREEN_FRACTION;
    const size = Math.max(BALL_RADIUS * 2.6, minSize);
    this.glint.scale.set(size, size, 1);
    this.glint.material.opacity = THREE.MathUtils.clamp((distance - 6) / 30, 0, 0.85);
  }

  private pushTrailPoint(point: THREE.Vector3): void {
    if (this.trailCount >= TRAIL_POINTS) {
      this.trailPositions.copyWithin(0, 3);
      this.trailCount = TRAIL_POINTS - 1;
    }
    const offset = this.trailCount * 3;
    this.trailPositions[offset] = point.x;
    this.trailPositions[offset + 1] = point.y;
    this.trailPositions[offset + 2] = point.z;
    this.trailCount += 1;
    this.lastTrailPoint.copy(point);
    for (let index = 0; index < this.trailCount; index += 1) {
      const fade = Math.pow(index / Math.max(1, this.trailCount - 1), 1.5);
      this.trailColors[index * 3] = 0.15 + 0.85 * fade;
      this.trailColors[index * 3 + 1] = 0.2 + 0.8 * fade;
      this.trailColors[index * 3 + 2] = 0.25 + 0.75 * fade;
    }
    const geometry = this.trail.geometry;
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
    geometry.setDrawRange(0, this.trailCount);
  }
}
