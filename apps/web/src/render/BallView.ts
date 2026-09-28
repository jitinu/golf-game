import * as THREE from 'three';
import type { BallState } from '@golf/sim';
import type { Environment } from './Environment.js';
import { createContactBlob } from './ContactShadow.js';
import { TrajectoryPlayback } from '../game/TrajectoryPlayback.js';

const BALL_RADIUS = 0.02135;
/** Minimum on-screen size of the ball marker, as a fraction of viewport height. */
const MIN_SCREEN_FRACTION = 0.011;
const TRAIL_POINTS = 240;
const TRAIL_SAMPLE_M = 0.6;
const TEE_PEG_RADIUS = 0.0022;
const TEE_CUP_RADIUS = 0.0065;

function teePeg(environment?: Environment): THREE.Group {
  const material = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.55, metalness: 0 });
  environment?.setupMaterial(material);
  const peg = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(TEE_PEG_RADIUS, TEE_PEG_RADIUS * 0.6, 1, 10), material);
  shaft.name = 'TeeShaft';
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(TEE_CUP_RADIUS, TEE_PEG_RADIUS, 0.008, 12, 1, true), material);
  cup.name = 'TeeCup';
  cup.material.side = THREE.DoubleSide;
  shaft.castShadow = cup.castShadow = true;
  peg.add(shaft, cup);
  peg.visible = false;
  return peg;
}

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
  private readonly contact = createContactBlob(BALL_RADIUS * 1.9, BALL_RADIUS * 1.9, 0.6);
  private readonly tee: THREE.Group;
  private teeHeight = 0;
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
    this.tee = teePeg(environment);
    this.group.add(this.mesh, this.glint, this.trail, this.contact, this.tee);
  }

  /** Shows a tee peg of the given height under the ball (0 hides it); the ball is expected to be placed on top of it. */
  setTee(height: number): void {
    this.teeHeight = height;
    this.tee.visible = height > 0;
    if (height <= 0) return;
    const shaft = this.tee.getObjectByName('TeeShaft')!;
    const cup = this.tee.getObjectByName('TeeCup')!;
    // The shaft is buried ~2 cm so the peg reads as pushed into the turf; the cup cradles the ball just below its centre.
    const buried = 0.02;
    const visible = Math.max(0.004, height - 0.006);
    shaft.scale.set(1, visible + buried, 1);
    shaft.position.y = (visible - buried) / 2;
    cup.position.y = visible + 0.004;
  }

  place(position: { x: number; y: number; z: number }): void {
    this.mesh.position.set(position.x, position.y, position.z);
    this.glint.position.copy(this.mesh.position);
    const onTee = this.tee.visible;
    this.contact.position.set(position.x, position.y - BALL_RADIUS - (onTee ? this.teeHeight : 0) + 0.003, position.z);
    this.tee.position.set(position.x, position.y - BALL_RADIUS - this.teeHeight, position.z);
    const mode = this.playback.state?.mode;
    this.contact.visible = this.playback.done || mode === 'roll' || mode === 'rest' || mode === 'holed' || mode === undefined;
  }

  start(trajectory: BallState[]): void {
    this.playback.start(trajectory);
    this.tee.visible = false;
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
