import { loadCourse, type LoadedCourse } from '@golf/course-format';
import { CLUBS } from '@golf/sim';
import { getGraphicsPreset } from './GraphicsPreset.js';
import { Renderer } from '../render/Renderer.js';
import { Environment } from '../render/Environment.js';
import { TerrainMesh } from '../course/TerrainMesh.js';
import { GrassField } from '../course/GrassField.js';
import { Vegetation } from '../course/Vegetation.js';
import { WaterSurface } from '../course/WaterSurface.js';
import { createCupAndFlag } from '../course/CupAndFlag.js';
import { UI } from '../ui/UI.js';
import { CourseDebugView } from '../debug/CourseDebugView.js';
import { initialGameState, type GameState } from '../game/GameState.js';
import { AimDrag } from '../input/AimDrag.js';
import { PowerCharge } from '../input/PowerCharge.js';

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly ui: UI;
  private readonly state: GameState = initialGameState();
  private renderer: Renderer | undefined;
  private grass: GrassField | undefined;
  private water: WaterSurface | undefined;
  private course: LoadedCourse | undefined;
  private last = performance.now();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game';
    document.body.append(this.canvas);
    this.ui = new UI();
    this.ui.onStart(() => { void this.start(); });
    new AimDrag(this.canvas, (delta) => { this.state.aimYaw += delta; }, () => undefined);
    new PowerCharge(this.canvas, (power) => { this.state.power = power; }, (accuracy) => { this.state.accuracy = accuracy; });
  }

  async start(): Promise<void> {
    this.state.phase = 'aiming';
    this.ui.root.querySelector('.course-select')?.remove();
    this.course = await loadCourse('/courses/pinecrest/');
    const preset = getGraphicsPreset(new URLSearchParams(location.search).get('preset'));
    try {
      this.renderer = new Renderer(this.canvas, preset);
    } catch (error) {
      this.ui.root.insertAdjacentHTML('beforeend', `<div class="panel">WebGL unavailable: ${String(error)}</div>`);
      return;
    }
    const environment = new Environment(this.renderer.scene, this.renderer.camera, this.course.manifest, preset, this.renderer.renderer);
    const terrain = new TerrainMesh(this.course, environment);
    this.renderer.scene.add(terrain.mesh);
    this.grass = new GrassField(this.course, preset);
    this.renderer.scene.add(this.grass.group);
    this.renderer.scene.add(new Vegetation(this.course).group);
    this.water = new WaterSurface(this.course, preset);
    this.renderer.scene.add(this.water.group);
    this.renderer.scene.add(createCupAndFlag(this.course.cupFor(1)));
    const debug = new CourseDebugView(this.course);
    this.renderer.scene.add(debug.group);
    debug.setVisible(false);
    const tee = this.course.manifest.holes[0]?.tees.find((value) => value.id === 'middle')?.position;
    const cup = this.course.cupFor(1).position;
    if (tee) this.renderer.camera.position.set(tee.x, tee.y + 10, tee.z - 18);
    this.renderer.camera.lookAt(cup.x, cup.y, cup.z);
    this.last = performance.now();
    this.animate(environment);
  }

  private animate(environment: Environment): void {
    if (!this.renderer || !this.course) return;
    const now = performance.now();
    this.last = now;
    this.grass?.update(now / 1000);
    this.water?.update(now / 1000);
    environment.update();
    const cup = this.course.cupFor(this.state.hole).position;
    const tee = this.course.manifest.holes[this.state.hole - 1]?.tees[1]?.position ?? cup;
    this.ui.update(this.state, Math.hypot(cup.x - tee.x, cup.z - tee.z), CLUBS[this.state.selectedClub]?.displayName ?? this.state.selectedClub);
    this.renderer.render();
    requestAnimationFrame(() => this.animate(environment));
  }
}
