import * as THREE from 'three';

let gradient: THREE.Texture | undefined;

/** Soft radial falloff used by every contact blob; alpha 1 at the centre, 0 at the rim. */
function gradientTexture(): THREE.Texture {
  if (gradient) return gradient;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const fill = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    fill.addColorStop(0, 'rgba(0,0,0,1)');
    fill.addColorStop(0.35, 'rgba(0,0,0,0.75)');
    fill.addColorStop(0.7, 'rgba(0,0,0,0.25)');
    fill.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = fill;
    context.fillRect(0, 0, size, size);
  }
  gradient = new THREE.CanvasTexture(canvas);
  gradient.colorSpace = THREE.NoColorSpace;
  return gradient;
}

/**
 * Cheap ambient-occlusion "contact" blob: a flat, multiplicative disc that sits a few millimetres above the
 * ground under feet, club heads and the ball, darkening the turf where shadow maps are too coarse to.
 */
export function createContactBlob(radiusX: number, radiusZ: number, opacity: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const material = new THREE.MeshBasicMaterial({
    map: gradientTexture(),
    color: 0x0c1a08,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
  });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  blob.rotation.x = -Math.PI / 2;
  blob.scale.set(radiusX * 2, radiusZ * 2, 1);
  blob.position.y = 0.004;
  blob.renderOrder = 2;
  blob.userData.excludeAO = true;
  blob.receiveShadow = false;
  blob.castShadow = false;
  return blob;
}
