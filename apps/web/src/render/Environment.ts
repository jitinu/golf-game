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

const SKY_DOME_RADIUS = 900;

/**
 * Sky dome drawn from the HDRI with a little grading: the zenith is deepened and cooled, the horizon dissolves into
 * the fog colour, and a small saturation lift keeps the blue from reading as washed-out haze.
 */
function createSkyDome(texture: THREE.Texture, fog: THREE.FogExp2): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      sky: { value: texture },
      fogColor: { value: fog.color },
      intensity: { value: 0.78 },
    },
    vertexShader: `
      varying vec3 vWorldDirection;
      void main() {
        vWorldDirection = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: `
      #include <common>
      uniform sampler2D sky;
      uniform vec3 fogColor;
      uniform float intensity;
      varying vec3 vWorldDirection;
      void main() {
        vec3 direction = normalize(vWorldDirection);
        vec2 uv = vec2(atan(direction.z, direction.x) * RECIPROCAL_PI2 + 0.5, asin(clamp(direction.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5);
        vec3 color = texture2D(sky, uv).rgb * intensity;
        float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luminance), color, 1.22);
        // Deeper, cooler zenith for dynamic range against the sunlit turf.
        float zenith = smoothstep(0.08, 0.7, direction.y);
        color *= mix(1.0, 0.74, zenith);
        color *= mix(vec3(1.0), vec3(0.9, 0.96, 1.08), zenith);
        // Atmospheric haze pools at the horizon and matches the scene fog so distant trees dissolve into the same tone.
        float haze = 1.0 - smoothstep(-0.02, 0.16, direction.y);
        color = mix(color, fogColor * 1.05, haze * 0.55);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_DOME_RADIUS, 48, 24), material);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  return dome;
}

export class Environment {
  readonly csm: CSM;
  /** Unit vector pointing from the scene toward the sun. */
  readonly sunDirection: THREE.Vector3;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly patched = new WeakSet<THREE.Material>();
  private readonly fog: THREE.FogExp2;
  private skyDome?: THREE.Mesh;

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
      lightIntensity: 4.2,
      lightDirection: this.sunDirection.clone().negate(),
      parent: scene,
    });
    for (const light of this.csm.lights) {
      // Warm late-afternoon sun; the cool sky hemisphere below supplies the shadow tint.
      light.color.set(0xffe7c8);
      light.shadow.normalBias = 0.03;
      light.shadow.bias = -0.00015;
      light.shadow.radius = 2;
    }
    this.fog = new THREE.FogExp2(0xbfd0e0, 0.0005);
    scene.fog = this.fog;
    this.hemisphere = new THREE.HemisphereLight(0xa4c4ea, 0x5b7540, 0.6);
    scene.add(this.hemisphere);
    void this.loadSky(manifest, preset);
  }

  update(): void {
    this.camera.updateMatrixWorld();
    if (this.skyDome) this.skyDome.position.setFromMatrixPosition(this.camera.matrixWorld);
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
      this.scene.environmentIntensity = 0.3;
      this.skyDome = createSkyDome(texture, this.fog);
      this.scene.add(this.skyDome);
      // Image-based light replaces most of the ambient fill; cool sky bounce keeps shadow cores from going flat and warm.
      this.hemisphere.intensity = 0.2;
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
