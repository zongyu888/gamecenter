import * as THREE from 'three/webgpu';

export interface PerchSegment {
  id: string;
  /** World-space start and end points (updated dynamically for trams, boats and NPC hats/shoulders) */
  getEndpoints: (outA: THREE.Vector3, outB: THREE.Vector3) => void;
  /** Optional fast XZ bounding center & half-span pre-filter to avoid expensive skeleton queries when far away */
  getApproxCenter?: (outCenter: THREE.Vector3) => void;
  approxHalfSpan?: number;
  /** Radius of the perch surface so feet rest cleanly on top */
  radius: number;
  /** Surface sound category */
  surface: 'wood' | 'metal' | 'stone' | 'foliage' | 'fabric';
  /** Optional callback when bird lands (e.g. NPC hat/shoulder, lantern, wire, or shutter reaction) */
  onLand?: (t: number, speed: number) => void;
  /** Optional callback when bird kicks off from the perch */
  onLeave?: (t: number, kickSpeed: number) => void;
  /** Optional dynamic vertical sag/bounce offset along `t` (e.g. plucked catenary wires) */
  getVerticalOffset?: (t: number) => number;
}

export interface PerchQueryResult {
  segment: PerchSegment;
  t: number;
  worldPoint: THREE.Vector3;
}

/** Allocates a reusable `out` target for findNearestPerch (placeholder segment until the first hit). */
export function createPerchQueryResult(): PerchQueryResult {
  return {
    segment: { id: '', getEndpoints: () => {}, radius: 0.1, surface: 'wood' },
    t: 0.5,
    worldPoint: new THREE.Vector3(),
  };
}

interface StaticPerchEntry {
  seg: PerchSegment;
  a: THREE.Vector3;
  ab: THREE.Vector3;
  lenSq: number;
  marginT: number;
  visitStamp: number;
}

const GRID_CELL_SIZE = 16.0;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _approxCenter = new THREE.Vector3();
const _bestPt = new THREE.Vector3();

/**
 * Spatial-hashed perch registry across the multi-block European neighborhood:
 * - O(1) 2D spatial grid lookup for static railings, eaves, catenary wires, benches & ledges
 * - Bounded pre-filtered dynamic perches for moving trams, canal boats, and citizen hats/shoulders
 */
export class PerchSystem {
  private readonly staticGrid = new Map<number, StaticPerchEntry[]>();
  private readonly dynamicSegments: PerchSegment[] = [];
  private queryStamp = 0;

  private packCellKey(cx: number, cz: number): number {
    return ((cx + 512) << 12) | ((cz + 512) & 0xfff);
  }

  public addStaticSegment(
    id: string,
    a: THREE.Vector3,
    b: THREE.Vector3,
    radius = 0.14,
    surface: PerchSegment['surface'] = 'wood'
  ): PerchSegment {
    const aCopy = a.clone();
    const bCopy = b.clone();
    const ab = bCopy.clone().sub(aCopy);
    const lenSq = ab.lengthSq();
    const len = Math.sqrt(Math.max(1e-6, lenSq));
    const marginT = Math.min(0.35, 0.24 / len);

    const seg: PerchSegment = {
      id,
      getEndpoints: (outA, outB) => {
        outA.copy(aCopy);
        outB.copy(bCopy);
      },
      radius,
      surface,
    };

    if (lenSq >= 0.0001) {
      const entry: StaticPerchEntry = {
        seg,
        a: aCopy,
        ab,
        lenSq,
        marginT,
        visitStamp: 0,
      };
      const minCx = Math.floor(Math.min(aCopy.x, bCopy.x) / GRID_CELL_SIZE);
      const maxCx = Math.floor(Math.max(aCopy.x, bCopy.x) / GRID_CELL_SIZE);
      const minCz = Math.floor(Math.min(aCopy.z, bCopy.z) / GRID_CELL_SIZE);
      const maxCz = Math.floor(Math.max(aCopy.z, bCopy.z) / GRID_CELL_SIZE);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const key = this.packCellKey(cx, cz);
          let bucket = this.staticGrid.get(key);
          if (!bucket) {
            bucket = [];
            this.staticGrid.set(key, bucket);
          }
          bucket.push(entry);
        }
      }
    }

    return seg;
  }

  public addDynamicSegment(seg: PerchSegment): PerchSegment {
    this.dynamicSegments.push(seg);
    return seg;
  }

  /**
   * Finds the closest perch candidate within `maxRadius` of `birdPos` without heap allocations on a miss.
   */
  public findNearestPerch(
    birdPos: THREE.Vector3,
    maxRadius: number,
    ignoreId?: string,
    ignoreCooldownActive = false,
    out?: PerchQueryResult
  ): PerchQueryResult | null {
    const maxSq = maxRadius * maxRadius;
    let bestDistSq = maxSq;
    let bestSeg: PerchSegment | null = null;
    let bestT = 0.5;

    const stamp = ++this.queryStamp;
    const minCx = Math.floor((birdPos.x - maxRadius) / GRID_CELL_SIZE);
    const maxCx = Math.floor((birdPos.x + maxRadius) / GRID_CELL_SIZE);
    const minCz = Math.floor((birdPos.z - maxRadius) / GRID_CELL_SIZE);
    const maxCz = Math.floor((birdPos.z + maxRadius) / GRID_CELL_SIZE);

    // 1. Check nearby static segments via 2D spatial grid
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.staticGrid.get(this.packCellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const entry = bucket[i];
          if (entry.visitStamp === stamp) continue;
          entry.visitStamp = stamp;

          const seg = entry.seg;
          if (ignoreCooldownActive && seg.id === ignoreId) continue;

          _ap.subVectors(birdPos, entry.a);
          const rawT = _ap.dot(entry.ab) / entry.lenSq;
          const t = Math.max(entry.marginT, Math.min(1.0 - entry.marginT, rawT));
          _closest.copy(entry.a).addScaledVector(entry.ab, t);

          const dSq = _closest.distanceToSquared(birdPos);
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestSeg = seg;
            bestT = t;
            _bestPt.copy(_closest);
          }
        }
      }
    }

    // 2. Check pre-filtered dynamic segments (vehicles, citizen hats & shoulders)
    for (let i = 0; i < this.dynamicSegments.length; i++) {
      const seg = this.dynamicSegments[i];
      if (ignoreCooldownActive && seg.id === ignoreId) continue;

      if (seg.getApproxCenter) {
        seg.getApproxCenter(_approxCenter);
        const reach = maxRadius + (seg.approxHalfSpan ?? 3.0);
        const dx = birdPos.x - _approxCenter.x;
        const dz = birdPos.z - _approxCenter.z;
        if (dx * dx + dz * dz > reach * reach) continue;
      }

      seg.getEndpoints(_a, _b);
      _ab.subVectors(_b, _a);
      const lenSq = _ab.lengthSq();
      if (lenSq < 0.0001) continue;

      const segLen = Math.sqrt(lenSq);
      const marginT = Math.min(0.35, 0.24 / segLen);
      _ap.subVectors(birdPos, _a);
      const t = Math.max(marginT, Math.min(1.0 - marginT, _ap.dot(_ab) / lenSq));
      _closest.copy(_a).addScaledVector(_ab, t);

      const dSq = _closest.distanceToSquared(birdPos);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestSeg = seg;
        bestT = t;
        _bestPt.copy(_closest);
      }
    }

    if (!bestSeg) return null;

    if (out) {
      out.segment = bestSeg;
      out.t = bestT;
      out.worldPoint.copy(_bestPt);
      return out;
    }

    return {
      segment: bestSeg,
      t: bestT,
      worldPoint: _bestPt.clone(),
    };
  }
}
