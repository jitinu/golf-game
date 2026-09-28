import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CourseManifest } from '@golf/course-format';
import type { GraphicsPreset } from '../app/GraphicsPreset.js';

function computeSunDirection(manifest: CourseManifest): THREE.Vector3 {
  const environment = manifest.environment;
  const azimuth = THREE.MathUtils.degToRad(environment?.sunAzimuthDeg ?? 135);
  const elevation = THREE.MathUtils.degToRad(environment?.sunElevationDeg ?? 45);
  return new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)).normalize();
}

export class Environment {
  readonly csm: CSM;
  /** Unit vector pointing from the scene toward the sun. */
  readonly sunDirection: THREE.Vector3;
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
    this.sunDirection = computeSunDirection(manifest);
    // CSM wants the direction light travels, i.e. from the sun down into the scene.
    this.csm = new CSM({
      camera,
      cascades: preset.cascades,
      shadowMapSize: 2048,
      mode: 'practical',
      maxFar: 350,
      lightIntensity: 3.4,
      lightDirection: this.sunDirection.clone().negate(),
      parent: scene,
    });
    for (const light of this.csm.lights) {
      light.color.set(0xfff3e3);
      light.shadow.normalBias = 0.03;
      light.shadow.bias = -0.00015;
      light.shadow.radius = 3;
    }
    scene.fog = new THREE.FogExp2(0xc3d0d8, 0.0004);
    this.hemisphere = new THREE.HemisphereLight(0xc6dbe6, 0x4f6a3c, 0.6);
    scene.add(this.hemisphere);
    void this.loadSky(manifest, preset);
  }

  update(): void {
    this.camera.updateMatrixWorld();
    this.csm.update();
    for (const light of this.csm.lights) {
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
      light.shadow.updateMatrices(light);
    }
  }

  /** The tightest cascade; its shadow map covers roughly the first 60 m in front of the camera. */
  nearShadowLight(): THREE.DirectionalLight | undefined {
    return this.csm.lights[0];
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
      this.scene.environmentIntensity = 0.38;
      this.scene.background = texture;
      this.scene.backgroundIntensity = 0.9;
      this.scene.backgroundBlurriness = 0;
      // Image-based light replaces most of the ambient fill; a little sky/ground bounce keeps shadows from going flat.
      this.hemisphere.intensity = 0.18;
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
