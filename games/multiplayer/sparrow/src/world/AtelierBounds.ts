import type * as THREE from 'three/webgpu';

/** True when `pos` is inside the attic Conservatory Atelier interior volume. */
export function isInsideAtelier(pos: THREE.Vector3): boolean {
  return (
    pos.x >= -86.6 &&
    pos.x <= -39.4 &&
    pos.y >= 26.2 &&
    pos.y <= 51.6 &&
    pos.z >= 25.4 &&
    pos.z <= 78.6
  );
}
