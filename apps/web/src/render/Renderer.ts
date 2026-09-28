import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { GraphicsPreset } from '../app/GraphicsPreset.js';

/** Objects flagged with `userData.excludeAO` (alpha-tested grass, sprites) are skipped in the AO normal/depth pre-pass, which ignores alpha discard. */
class SceneGTAOPass extends GTAOPass {
  override overrideVisibility(): void {
    super.overrideVisibility();
    this.scene.traverse((object) => {
      if (object.userData.excludeAO === true) object.visible = false;
    });
  }
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly gtao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly smaa: SMAAPass;

  constructor(canvas: HTMLCanvasElement, preset: GraphicsPreset) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatioCap));

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new SceneGTAOPass(this.scene, this.camera);
    this.gtao.enabled = preset.gtao;
    // Wider, stronger occlusion so feet, club, ball and terrain folds read as grounded instead of floating.
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.2, thickness: 1.2, scale: 1.5, samples: 16, distanceFallOff: 1 });
    this.gtao.blendIntensity = 1;
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.1, 0.4, 0.9);
    this.bloom.enabled = preset.bloom;
    this.composer.addPass(this.bloom);
    this.smaa = new SMAAPass(window.innerWidth, window.innerHeight);
    this.smaa.enabled = true;
    this.composer.addPass(this.smaa);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  }

  render(): void {
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.composer.render();
  }
}
