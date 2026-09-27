import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CourseManifest } from '@golf/course-format';
import type { GraphicsPreset } from '../app/GraphicsPreset.js';

export class Environment {
  readonly csm: CSM;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly patched = new WeakSet<THREE.Material>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    manifest: CourseManifest,
    preset: GraphicsPreset,
    renderer?: THREE.WebGLRenderer,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer ?? new THREE.WebGLRenderer({ antialias: false }));
    // CSM wants the direction light travels, i.e. from the sun down into the scene.
    this.csm = new CSM({
      camera,
      cascades: preset.cascades,
      shadowMapSize: 2048,
      mode: 'practical',
      maxFar: 350,
      lightIntensity: 3.2,
      lightDirection: this.sunDirection(manifest).negate(),
      parent: scene,
    });
    for (const light of this.csm.lights) {
      light.color.set(0xfff1dc);
      light.shadow.normalBias = 0.04;
      light.shadow.bias = -0.0002;
    }
    scene.fog = new THREE.FogExp2(0xc7d6de, 0.0011);
    this.hemisphere = new THREE.HemisphereLight(0xbfd6df, 0x50603f, 1.1);
    scene.add(this.hemisphere);
    void this.loadSky(manifest, preset);
  }

  update(): void {
    this.csm.update();
  }

  setupMaterial(material: THREE.Material): void {
    if (this.patched.has(material)) return;
    this.patched.add(material);
    const customCompile = material.onBeforeCompile;
    this.csm.setupMaterial(material);
    const csmCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      csmCompile(shader, renderer);
      customCompile(shader, renderer);
    };
  }

  private sunDirection(manifest: CourseManifest): THREE.Vector3 {
    const environment = manifest.environment;
    const azimuth = THREE.MathUtils.degToRad(environment?.sunAzimuthDeg ?? 135);
    const elevation = THREE.MathUtils.degToRad(environment?.sunElevationDeg ?? 45);
    return new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)).normalize();
  }

  private async loadSky(manifest: CourseManifest, preset: GraphicsPreset): Promise<void> {
    const path = `/hdri/limpopo_golf_course_${preset.hdriRes}.hdr`;
    try {
      // The dev server answers missing files with index.html, so verify the asset before parsing.
      const head = await fetch(path, { method: 'HEAD' });
      if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`HDRI missing: ${path}`);
      const texture = await new RGBELoader().loadAsync(path);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const generated = this.pmrem.fromEquirectangular(texture).texture;
      this.scene.environment = generated;
      this.scene.environmentIntensity = 0.55;
      this.scene.background = texture;
      this.scene.backgroundIntensity = 0.9;
      this.scene.backgroundBlurriness = 0;
      // Image-based light replaces most of the ambient fill.
      this.hemisphere.intensity = 0.25;
    } catch {
      const environment = new RoomEnvironment();
      const generated = this.pmrem.fromScene(environment).texture;
      this.scene.environment = generated;
      this.scene.background = new THREE.Color(0x9bb5c4);
      environment.dispose();
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(500, 32, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          uniforms: { top: { value: new THREE.Color(0x5f89b0) }, bottom: { value: new THREE.Color(0xd6e4e7) } },
          vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
          fragmentShader: 'varying vec3 vPosition; uniform vec3 top; uniform vec3 bottom; void main(){float h=clamp(vPosition.y/500.0+0.5,0.0,1.0);gl_FragColor=vec4(mix(bottom,top,h),1.0);}',
        }),
      );
      this.scene.add(sky);
    }
  }
}
