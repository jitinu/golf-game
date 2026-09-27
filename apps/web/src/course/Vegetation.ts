import * as THREE from 'three';
import { Tree, TreePreset } from '@dgreenheck/ez-tree';
import type { LoadedCourse } from '@golf/course-format';
import type { Environment } from '../render/Environment.js';
import type { GraphicsPreset } from '../app/GraphicsPreset.js';

/** Beyond this distance a tree is drawn as a pre-rendered impostor card instead of geometry. */
const BILLBOARD_DISTANCE: Record<GraphicsPreset['treeDetail'], number> = { low: 70, medium: 110, high: 150 };
/** Inside this distance a tree uses full geometry; between here and the billboard distance a reduced mesh. */
const NEAR_DISTANCE: Record<GraphicsPreset['treeDetail'], number> = { low: 25, medium: 35, high: 45 };
const LOD_REFRESH_SECONDS = 0.2;
/** Each impostor atlas holds this many side views of the tree, spaced evenly around Y. */
const IMPOSTOR_VIEWS = 8;
const IMPOSTOR_VIEW_SIZE: Record<GraphicsPreset['treeDetail'], THREE.Vector2> = {
  low: new THREE.Vector2(192, 384),
  medium: new THREE.Vector2(256, 512),
  high: new THREE.Vector2(512, 1024),
};
/** Leaf cards are enlarged and thinned out so foliage reads as solid clumps instead of alpha speckle. */
const LEAF_SIZE_BOOST = 1.45;
const LEAF_COUNT_SCALE = 0.75;
const TEXTURE_WAIT_MS = 15000;

/** ez-tree loads its bundled textures asynchronously and exposes no callback, so poll until the image is present. */
function textureReady(texture: THREE.Texture | null | undefined): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (!texture || texture.image !== undefined || performance.now() - started > TEXTURE_WAIT_MS) resolve();
      else window.setTimeout(check, 50);
    };
    check();
  });
}

interface TreeKind {
  preset: keyof typeof TreePreset;
  /** Metres from base to crown at scale 1. */
  height: number;
  seeds: number[];
}

/** Course `tree.kind` → ez-tree preset (MIT, textured bark + leaf cards). Unknown kinds fall back to pine. */
const TREE_KINDS: Record<string, TreeKind> = {
  pine: { preset: 'Pine Medium', height: 15, seeds: [1201, 1202] },
  oak: { preset: 'Oak Medium', height: 12, seeds: [2101, 2102] },
  ash: { preset: 'Ash Medium', height: 12.5, seeds: [3101, 3102] },
  aspen: { preset: 'Aspen Medium', height: 11, seeds: [4101] },
  bush: { preset: 'Bush 1', height: 2.5, seeds: [5101] },
};

interface Variant {
  branches: THREE.InstancedMesh;
  leaves: THREE.InstancedMesh;
  midBranches: THREE.InstancedMesh;
  midLeaves: THREE.InstancedMesh;
  cards: THREE.InstancedMesh;
  /** Model-space extents at scale 1 after height normalisation. */
  width: number;
  height: number;
  /** Trees using this variant: full transform (scale, rotation, position). */
  members: { matrix: THREE.Matrix4; position: THREE.Vector3; scale: number; tint: THREE.Color }[];
}

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

type MeshDetail = GraphicsPreset['treeDetail'] | 'mid';

function detailScale(detail: MeshDetail): { segments: number; leaves: number; leafSize: number } {
  if (detail === 'mid') return { segments: 0.45, leaves: 0.45, leafSize: 1.25 };
  if (detail === 'low') return { segments: 0.5, leaves: 0.55, leafSize: 1.2 };
  if (detail === 'medium') return { segments: 0.7, leaves: 0.8, leafSize: 1.05 };
  return { segments: 1, leaves: 1, leafSize: 1 };
}

/** Generates one ez-tree at scale 1 (normalised to `height` metres) and returns its raw geometry + textures. */
function generateTree(kind: TreeKind, seed: number, detail: MeshDetail): { tree: Tree; scale: number } {
  const tree = new Tree();
  tree.loadPreset(kind.preset);
  const factor = detailScale(detail);
  const options = tree.options;
  options.seed = seed;
  for (const level of [0, 1, 2, 3] as const) {
    options.branch.segments[level] = Math.max(3, Math.round(options.branch.segments[level] * factor.segments));
  }
  options.leaves.count = Math.max(4, Math.round(options.leaves.count * factor.leaves * LEAF_COUNT_SCALE));
  options.leaves.size *= LEAF_SIZE_BOOST * factor.leafSize;
  tree.generate();
  tree.branchesMesh.geometry.computeBoundingBox();
  tree.leavesMesh.geometry.computeBoundingBox();
  const box = tree.branchesMesh.geometry.boundingBox!.clone();
  if (tree.leavesMesh.geometry.boundingBox) box.union(tree.leavesMesh.geometry.boundingBox);
  return { tree, scale: kind.height / Math.max(1e-3, box.max.y) };
}

/**
 * Camera-facing card whose size and yaw come from the instance matrix. The fragment samples the atlas column whose
 * baked view best matches the direction the camera sees this tree from, so silhouettes change as the camera orbits.
 */
function impostorMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.35, side: THREE.DoubleSide, transparent: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nconst float IMPOSTOR_VIEWS = ${IMPOSTOR_VIEWS}.0;`)
      .replace(
        '#include <project_vertex>',
        `vec3 instPos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 toCamera = cameraPosition - instPos;
      toCamera.y = 0.0;
      toCamera = normalize(toCamera + vec3(0.0, 0.0, 1e-4));
      vec3 right = vec3(toCamera.z, 0.0, -toCamera.x);
      float cardWidth = length(instanceMatrix[0].xyz);
      float cardHeight = length(instanceMatrix[1].xyz);
      transformed = instPos + right * position.x * cardWidth + vec3(0.0, position.y * cardHeight, 0.0);
      vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      float treeYaw = atan(-instanceMatrix[0].z, instanceMatrix[0].x);
      float viewYaw = atan(toCamera.x, toCamera.z) - treeYaw;
      float slot = mod(floor(viewYaw / (PI2 / IMPOSTOR_VIEWS) + 0.5), IMPOSTOR_VIEWS);
      vMapUv.x = (vMapUv.x + slot) / IMPOSTOR_VIEWS;`,
      );
  };
  material.customProgramCacheKey = () => 'tree-impostor';
  return material;
}

export class Vegetation {
  readonly group = new THREE.Group();
  private readonly variants = new Map<string, Variant>();
  private readonly windUniform = { value: 0 };
  private readonly billboardDistance: number;
  private readonly nearDistance: number;
  private readonly impostorViewSize: THREE.Vector2;
  private readonly lastCamera = new THREE.Vector3(Number.NaN, 0, 0);
  private lodClock = 0;
  private readonly impostorScene = new THREE.Scene();
  private readonly impostorCamera = new THREE.OrthographicCamera();

  constructor(course: LoadedCourse, preset: GraphicsPreset, environment?: Environment, renderer?: THREE.WebGLRenderer) {
    this.billboardDistance = BILLBOARD_DISTANCE[preset.treeDetail];
    this.nearDistance = NEAR_DISTANCE[preset.treeDetail];
    const maxTexture = renderer?.capabilities.maxTextureSize ?? 2048;
    this.impostorViewSize = IMPOSTOR_VIEW_SIZE[preset.treeDetail].clone();
    while (this.impostorViewSize.x * IMPOSTOR_VIEWS > maxTexture) this.impostorViewSize.multiplyScalar(0.5);
    const cardGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const trees = course.manifest.features.trees;

    // Bucket trees per (kind, seed) variant so each variant is one instanced draw for branches, one for leaves, one for cards.
    const buckets = new Map<string, { kind: TreeKind; seed: number; members: Variant['members'] }>();
    trees.forEach((tree, index) => {
      const kind = TREE_KINDS[tree.kind] ?? TREE_KINDS.pine!;
      const seed = kind.seeds[Math.floor(hash(index * 5.31) * kind.seeds.length)] ?? kind.seeds[0]!;
      const key = `${tree.kind}:${seed}`;
      const bucket = buckets.get(key) ?? { kind, seed, members: [] };
      buckets.set(key, bucket);
      const position = new THREE.Vector3(tree.position.x, course.sampler.heightAt(tree.position.x, tree.position.z) - 0.05, tree.position.z);
      const scale = tree.scale;
      const matrix = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tree.rotation), new THREE.Vector3(scale, scale, scale));
      const tint = new THREE.Color(0.86 + hash(index * 2.17) * 0.28, 0.9 + hash(index * 3.91) * 0.2, 0.86 + hash(index * 7.13) * 0.2);
      bucket.members.push({ matrix, position, scale, tint });
    });

    for (const [key, bucket] of buckets) {
      const { tree, scale } = generateTree(bucket.kind, bucket.seed, preset.treeDetail);
      const branchesGeometry = tree.branchesMesh.geometry.clone().scale(scale, scale, scale);
      const leavesGeometry = tree.leavesMesh.geometry.clone().scale(scale, scale, scale);
      const mid = generateTree(bucket.kind, bucket.seed, 'mid');
      const midBranchesGeometry = mid.tree.branchesMesh.geometry.clone().scale(scale, scale, scale);
      const midLeavesGeometry = mid.tree.leavesMesh.geometry.clone().scale(scale, scale, scale);
      mid.tree.branchesMesh.geometry.dispose();
      mid.tree.leavesMesh.geometry.dispose();
      branchesGeometry.computeBoundingBox();
      leavesGeometry.computeBoundingBox();
      const box = branchesGeometry.boundingBox!.clone().union(leavesGeometry.boundingBox!);
      const source = tree.branchesMesh.material as THREE.MeshPhongMaterial;
      const leafSource = tree.leavesMesh.material as THREE.MeshPhongMaterial;
      const maxAnisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 1;
      for (const texture of [source.map, source.normalMap, source.aoMap, leafSource.map]) {
        if (texture) texture.anisotropy = maxAnisotropy;
      }
      const barkMaterial = new THREE.MeshStandardMaterial({ map: source.map, normalMap: source.normalMap, aoMap: source.aoMap, roughness: 0.95, metalness: 0, color: source.color });
      if (barkMaterial.aoMap) barkMaterial.aoMap.channel = 0;
      const leafMaterial = new THREE.MeshStandardMaterial({ map: leafSource.map, color: leafSource.color, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
      const wind = this.windUniform;
      leafMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uWindTime = wind;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWindTime;').replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec3 instRoot = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float phase = dot(instRoot.xz, vec2(0.13, 0.17)) + uWindTime;
            float sway = clamp(transformed.y * 0.08, 0.0, 1.0);
            transformed += vec3(sin(phase * 1.7) * 0.5 + sin(phase * 3.1) * 0.25, 0.0, cos(phase * 1.3) * 0.4) * 0.35 * sway;
          }`,
        );
      };
      leafMaterial.customProgramCacheKey = () => 'tree-leaves-wind';
      environment?.setupMaterial(barkMaterial);
      environment?.setupMaterial(leafMaterial);

      const count = bucket.members.length;
      const branches = new THREE.InstancedMesh(branchesGeometry, barkMaterial, count);
      const leaves = new THREE.InstancedMesh(leavesGeometry, leafMaterial, count);
      const midBranches = new THREE.InstancedMesh(midBranchesGeometry, barkMaterial, count);
      const midLeaves = new THREE.InstancedMesh(midLeavesGeometry, leafMaterial, count);
      for (const mesh of [branches, midBranches]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
      }
      for (const mesh of [leaves, midLeaves]) {
        mesh.castShadow = true;
        mesh.userData.excludeAO = true;
        mesh.frustumCulled = false;
      }

      const cards = new THREE.InstancedMesh(cardGeometry, new THREE.MeshBasicMaterial({ visible: false }), count);
      cards.userData.excludeAO = true;
      cards.frustumCulled = false;
      this.group.add(branches, leaves, midBranches, midLeaves, cards);
      this.variants.set(key, { branches, leaves, midBranches, midLeaves, cards, width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z), height: box.max.y, members: bucket.members });
      tree.branchesMesh.geometry.dispose();
      tree.leavesMesh.geometry.dispose();
      if (renderer) {
        void Promise.all([textureReady(source.map), textureReady(leafSource.map)]).then(() => {
          if (this.disposed) return;
          const baked = this.bakeImpostor(renderer, branchesGeometry, leavesGeometry, source, leafSource, box, environment);
          cards.material = impostorMaterial(baked);
        });
      }
    }
    this.refreshLod(new THREE.Vector3(0, 0, 0), true);
  }

  private disposed = false;

  dispose(): void {
    this.disposed = true;
    for (const variant of this.variants.values()) {
      variant.branches.dispose();
      variant.leaves.dispose();
      variant.midBranches.dispose();
      variant.midLeaves.dispose();
      variant.cards.dispose();
    }
  }

  /** Re-buckets instances into near geometry / far cards when the camera has moved. */
  update(camera: THREE.Vector3, dtSeconds: number): void {
    this.windUniform.value += dtSeconds;
    this.lodClock += dtSeconds;
    if (this.lodClock < LOD_REFRESH_SECONDS) return;
    this.lodClock = 0;
    this.refreshLod(camera, false);
  }

  private refreshLod(camera: THREE.Vector3, force: boolean): void {
    if (!force && this.lastCamera.distanceToSquared(camera) < 1) return;
    this.lastCamera.copy(camera);
    const cardMatrix = new THREE.Matrix4();
    const cardScale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const far2 = this.billboardDistance * this.billboardDistance;
    const near2 = this.nearDistance * this.nearDistance;
    for (const variant of this.variants.values()) {
      let near = 0;
      let mid = 0;
      let far = 0;
      for (const member of variant.members) {
        const dx = member.position.x - camera.x;
        const dz = member.position.z - camera.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < near2) {
          variant.branches.setMatrixAt(near, member.matrix);
          variant.leaves.setMatrixAt(near, member.matrix);
          variant.leaves.setColorAt(near, member.tint);
          near += 1;
        } else if (d2 < far2) {
          variant.midBranches.setMatrixAt(mid, member.matrix);
          variant.midLeaves.setMatrixAt(mid, member.matrix);
          variant.midLeaves.setColorAt(mid, member.tint);
          mid += 1;
        } else {
          cardScale.set(variant.width * member.scale, variant.height * member.scale, 1);
          cardMatrix.compose(member.position, rotation.setFromRotationMatrix(member.matrix), cardScale);
          variant.cards.setMatrixAt(far, cardMatrix);
          far += 1;
        }
      }
      variant.branches.count = near;
      variant.leaves.count = near;
      variant.midBranches.count = mid;
      variant.midLeaves.count = mid;
      variant.cards.count = far;
      for (const mesh of [variant.branches, variant.leaves, variant.midBranches, variant.midLeaves, variant.cards]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /**
   * Renders the tree from IMPOSTOR_VIEWS directions around Y into one half-float atlas, lit to match the course
   * (same sun direction and sky/ground tints) so far cards blend with the geometry they replace.
   */
  private bakeImpostor(
    renderer: THREE.WebGLRenderer,
    branchesGeometry: THREE.BufferGeometry,
    leavesGeometry: THREE.BufferGeometry,
    barkSource: THREE.MeshPhongMaterial,
    leafSource: THREE.MeshPhongMaterial,
    box: THREE.Box3,
    environment?: Environment,
  ): THREE.Texture {
    const viewSize = this.impostorViewSize;
    const target = new THREE.WebGLRenderTarget(viewSize.x * IMPOSTOR_VIEWS, viewSize.y, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      anisotropy: renderer.capabilities.getMaxAnisotropy(),
    });
    const bark = new THREE.MeshStandardMaterial({ map: barkSource.map, normalMap: barkSource.normalMap, aoMap: barkSource.aoMap, color: barkSource.color, roughness: 0.95, metalness: 0 });
    const leaves = new THREE.MeshStandardMaterial({ map: leafSource.map, color: leafSource.color, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    const scene = this.impostorScene;
    scene.clear();
    const model = new THREE.Group();
    model.add(new THREE.Mesh(branchesGeometry, bark), new THREE.Mesh(leavesGeometry, leaves));
    scene.add(model);
    scene.add(new THREE.HemisphereLight(0xbfd6df, 0x50603f, 1.3));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.copy(environment?.sunDirection ?? new THREE.Vector3(0.4, 0.8, 0.45)).multiplyScalar(50);
    scene.add(sun);
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const camera = this.impostorCamera;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = box.max.y;
    camera.bottom = 0;
    camera.near = -width * 2;
    camera.far = width * 2;

    const previousTarget = renderer.getRenderTarget();
    const previousClear = new THREE.Color();
    renderer.getClearColor(previousClear);
    const previousAlpha = renderer.getClearAlpha();
    const previousShadows = renderer.shadowMap.enabled;
    const previousAutoClear = renderer.autoClear;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(target);
    // Transparent texels keep the foliage colour so mip blending at the silhouette does not darken to black.
    renderer.setClearColor(leafSource.color, 0);
    renderer.clear();
    renderer.autoClear = false;
    for (let view = 0; view < IMPOSTOR_VIEWS; view++) {
      const yaw = (view / IMPOSTOR_VIEWS) * Math.PI * 2;
      camera.position.set(Math.sin(yaw) * width, 0, Math.cos(yaw) * width);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      target.viewport.set(view * viewSize.x, 0, viewSize.x, viewSize.y);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    }
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    renderer.shadowMap.enabled = previousShadows;
    scene.clear();
    bark.dispose();
    leaves.dispose();
    return target.texture;
  }
}
