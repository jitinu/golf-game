import * as THREE from 'three';
import { CLUBS } from '@golf/sim';
import { SurfaceId } from '@golf/course-format';
import { getGraphicsPreset, type GraphicsPreset } from './GraphicsPreset.js';
import { CameraController } from './CameraController.js';
import { Renderer } from '../render/Renderer.js';
import { Environment } from '../render/Environment.js';
import { TerrainMesh } from '../course/TerrainMesh.js';
import { GrassField } from '../course/GrassField.js';
import { Vegetation } from '../course/Vegetation.js';
import { WaterSurface } from '../course/WaterSurface.js';
import { CupAndFlag } from '../course/CupAndFlag.js';
import { Golfer } from '../animation/Golfer.js';
import { BallView } from '../render/BallView.js';
import { CourseDebugView } from '../debug/CourseDebugView.js';
import { GameSession } from '../game/GameSession.js';
import { UI } from '../ui/UI.js';
import { AimDrag } from '../input/AimDrag.js';
import { PowerCharge } from '../input/PowerCharge.js';
import { ImpactEffects } from '../render/ImpactEffects.js';
import { ImpactSound } from '../audio/ImpactSound.js';
import type { ResolvedShot } from '../game/HoleController.js';

const HOLE_COMPLETE_PAUSE_MS = 1800;

interface CourseScene {
  group: THREE.Group;
  grass: GrassField;
  vegetation: Vegetation;
  water: WaterSurface;
  flag: CupAndFlag;
  debug: CourseDebugView;
}

export class App {
  readonly session = new GameSession();
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: UI;
  private readonly aimDrag: AimDrag;
  private readonly powerCharge: PowerCharge;
  private readonly impactEffects = new ImpactEffects();
  private readonly impactSound = new ImpactSound();
  private readonly preset: GraphicsPreset;
  private readonly query = new URLSearchParams(location.search);
  private renderer: Renderer | undefined;
  private environment: Environment | undefined;
  private camera: CameraController | undefined;
  private ball: BallView | undefined;
  private golfer: Golfer | undefined;
  private aimLine: THREE.Line | undefined;
  private courseScene: CourseScene | undefined;
  private activeShot: ResolvedShot | undefined;
  private animating = false;
  private last = performance.now();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game';
    document.body.append(this.canvas);
    this.preset = getGraphicsPreset(this.query.get('preset') ?? localStorage.getItem('golf-preset'));
    this.ui = new UI(this.session, (path) => {
      void this.start(path);
    });
    this.aimDrag = new AimDrag(this.canvas, (delta) => {
      if (this.session.state.phase === 'aiming') this.session.setAim(this.session.aimYaw + delta);
    });
    this.powerCharge = new PowerCharge(
      this.ui.hud.swingButton,
      (power) => this.session.setCharge(power),
      (accuracy) => this.session.setCharge(this.session.state.power, accuracy),
      () => {
        void this.hit();
      },
    );
    window.addEventListener('pointerdown', () => this.impactSound.unlock(), { once: true });
    window.addEventListener('keydown', () => this.impactSound.unlock(), { once: true });
    this.session.onChange((state) => {
      const ready = state.phase === 'aiming';
      this.powerCharge.enabled = ready;
      this.aimDrag.enabled = ready;
      this.ui.hud.setSwingEnabled(ready);
      if (this.golfer && this.session.course) {
        this.golfer.setClub(CLUBS[state.selectedClub] ?? CLUBS.driver!);
        if (ready) {
          this.golfer.faceAim(this.session.ballPosition, this.session.aimYaw);
          this.placeBall();
        }
      }
      this.updateAimLine();
    });
  }

  async start(coursePath = '/courses/pinecrest/'): Promise<void> {
    try {
      await this.session.start(coursePath);
      this.ui.hideCourseSelect();
      if (!this.session.course || !this.session.holeController) return;
      this.ensureRenderer();
      if (!this.renderer || !this.environment) return;
      this.disposeCourseScene();
      const group = new THREE.Group();
      const terrain = new TerrainMesh(this.session.course, this.environment);
      group.add(terrain.mesh);
      const grass = new GrassField(this.session.course, this.preset, this.renderer.scene.fog instanceof THREE.FogExp2 ? this.renderer.scene.fog : undefined, this.environment.sunDirection);
      group.add(grass.group);
      const vegetation = new Vegetation(this.session.course, this.preset, this.environment, this.renderer.renderer);
      group.add(vegetation.group);
      const water = new WaterSurface(this.session.course, this.preset, this.environment.sunDirection);
      group.add(water.group);
      const flag = new CupAndFlag(this.session.holeController.cup(), this.environment);
      group.add(flag);
      const debug = new CourseDebugView(this.session.course);
      debug.setVisible(localStorage.getItem('golf-debug') === 'true' || this.query.get('debug') === '1');
      group.add(debug.group);
      this.renderer.scene.add(group);
      this.courseScene = { group, grass, vegetation, water, flag, debug };
      this.placeHole();
      if (this.query.get('autoshot') === '1') {
        window.setTimeout(() => {
          this.session.setCharge(1, 0);
          void this.hit(true);
        }, 2000);
      }
      if (!this.animating) {
        this.animating = true;
        this.last = performance.now();
        this.animate();
      }
    } catch (error) {
      console.error(error);
      this.ui.toast.show(`Unable to start course: ${String(error)}`, 8000);
      this.ui.showCourseSelect();
    }
  }

  private ensureRenderer(): void {
    if (this.renderer || !this.session.course) return;
    this.renderer = new Renderer(this.canvas, this.preset);
    if (this.query.get('debug') === '1') Object.assign(window, { golfScene: this.renderer.scene, golfCamera: this.renderer.camera, golfRenderer: this.renderer.renderer, golfApp: this });
    this.environment = new Environment(this.renderer.scene, this.renderer.camera, this.session.course.manifest, this.preset, this.renderer.renderer);
    this.ball = new BallView(this.environment);
    this.renderer.scene.add(this.ball.group);
    this.golfer = new Golfer(this.renderer.renderer, this.environment);
    this.golfer.onSwingStart = (_type, impactIn) => {
      this.impactSound.swoosh(Math.max(0, impactIn - 0.22));
    };
    this.renderer.scene.add(this.golfer.group);
    this.renderer.scene.add(this.impactEffects.group);
    this.camera = new CameraController(this.renderer.camera, (x, z) => this.session.course?.sampler.heightAt(x, z) ?? 0);
    this.aimLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xe8fff0, dashSize: 0.6, gapSize: 0.4 }));
    this.renderer.scene.add(this.aimLine);
    this.ui.stats.setVisible(localStorage.getItem('golf-stats') === 'true' || this.query.get('stats') === '1');
  }

  private disposeCourseScene(): void {
    if (!this.courseScene || !this.renderer) return;
    this.renderer.scene.remove(this.courseScene.group);
    this.courseScene.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.courseScene.debug.dispose();
    this.courseScene.vegetation.dispose();
    this.courseScene = undefined;
  }

  private placeBall(): void {
    if (!this.ball) return;
    this.ball.setTee(this.session.teeHeight());
    this.ball.place(this.session.shotStart());
  }

  private placeHole(): void {
    if (!this.session.holeController || !this.ball || !this.golfer || !this.courseScene) return;
    this.placeBall();
    this.golfer.placeForBall(this.session.ballPosition, this.session.aimYaw);
    this.golfer.setClub(CLUBS[this.session.selectedClub] ?? CLUBS.driver!);
    this.courseScene.flag.setCup(this.session.holeController.cup());
    if (this.camera) this.camera.snapToAim(this.session.ballPosition, this.session.holeController.cup().position, this.session.aimYaw);
    this.powerCharge.reset();
    this.updateAimLine();
  }

  private updateAimLine(): void {
    if (!this.aimLine) return;
    const start = this.session.ballPosition;
    const visible = this.session.state.phase === 'aiming';
    this.aimLine.visible = visible;
    if (!visible) return;
    const club = CLUBS[this.session.selectedClub];
    const length = Math.min(club?.maxCarryHintM ?? 20, Math.max(4, this.session.state.distanceToPin)) * 0.25;
    const direction = new THREE.Vector3(Math.sin(this.session.aimYaw), 0, -Math.cos(this.session.aimYaw));
    const points: THREE.Vector3[] = [];
    for (let step = 0; step <= 16; step += 1) {
      const point = new THREE.Vector3(start.x, 0, start.z).addScaledVector(direction, 0.6 + (length * step) / 16);
      point.y = (this.session.course?.sampler.heightAt(point.x, point.z) ?? start.y) + 0.05;
      points.push(point);
    }
    this.aimLine.geometry.setFromPoints(points);
    this.aimLine.computeLineDistances();
  }

  private async hit(skipAnimation = false): Promise<void> {
    if (!this.golfer || !this.camera || !this.ball || this.session.state.phase !== 'aiming') return;
    const resolved = await this.session.hit(this.golfer, skipAnimation);
    if (!resolved) return;
    this.activeShot = resolved;
    const start = resolved.trajectory[0];
    if (start) {
      const speed = Math.hypot(start.velocity.x, start.velocity.y, start.velocity.z);
      const surface = this.session.course?.sampler.surfaceAt(start.position.x, start.position.z) ?? SurfaceId.Fairway;
      const direction = new THREE.Vector3(Math.sin(this.session.aimYaw), 0, -Math.cos(this.session.aimYaw));
      this.impactEffects.trigger(new THREE.Vector3(start.position.x, start.position.y, start.position.z), direction, surface, speed);
      const club = CLUBS[this.session.selectedClub] ?? CLUBS.driver;
      if (club) this.impactSound.impact(club.category, speed);
    }
    this.ball.start(resolved.trajectory);
    this.camera.beginShot(resolved.trajectory, this.session.aimYaw);
  }

  private onShotFinished(shot: ResolvedShot): void {
    this.session.completeShot(shot);
    if (!this.golfer || !this.ball || !this.camera) return;
    if (this.session.state.phase === 'holeComplete') {
      this.golfer.celebrate();
      window.setTimeout(() => {
        if (this.session.nextHole()) this.placeHole();
      }, HOLE_COMPLETE_PAUSE_MS);
      return;
    }
    this.placeBall();
    this.golfer.placeForBall(this.session.ballPosition, this.session.aimYaw);
    this.camera.endShot();
    this.camera.mode = 'aim';
    this.powerCharge.reset();
    this.updateAimLine();
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    if (!this.renderer || !this.camera) return;
    const now = performance.now();
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    try {
      this.aimDrag.update(dt);
      this.powerCharge.update(now);
      this.golfer?.update(dt);
      this.impactEffects.update(dt);
      if (this.ball && this.activeShot) {
        this.ball.update(dtMs);
        if (this.ball.playback.done) {
          const shot = this.activeShot;
          this.activeShot = undefined;
          this.onShotFinished(shot);
        }
      }
      const pin = this.session.holeController?.cup().position ?? this.session.ballPosition;
      const ballPosition = this.ball?.mesh.position ?? this.session.ballPosition;
      this.camera.update({ x: ballPosition.x, y: ballPosition.y, z: ballPosition.z }, pin, this.session.aimYaw, dt);
      this.ball?.frame(this.renderer.camera, this.canvas.clientHeight || window.innerHeight);
      this.environment?.update();
      if (this.courseScene) {
        this.courseScene.grass.update(this.renderer.camera.position, now / 1000, this.environment?.nearShadowLight());
        this.courseScene.vegetation.update(this.renderer.camera.position, dt);
        this.courseScene.water.update(now / 1000);
        this.courseScene.flag.update(now / 1000, this.renderer.camera.position, this.session.holeController?.wind);
        if (this.session.course && this.courseScene.debug.group.visible) {
          this.courseScene.debug.updateReadout(this.session.course, new THREE.Vector3(ballPosition.x, ballPosition.y, ballPosition.z));
        }
      }
      this.renderer.render();
      this.ui.stats.update(this.renderer.renderer.info.render.calls, this.renderer.renderer.info.render.triangles, dtMs);
    } catch (error) {
      console.error('Frame failed', error);
    }
  }
}
