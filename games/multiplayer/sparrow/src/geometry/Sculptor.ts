import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../rendering/Palette.ts';

export interface PaintOptions {
  /** Subtle darkening near bottom of geometry bounding box (analytic contact AO, 0..0.35) */
  bottomAO?: number;
  /** Slight warm highlight toward top of bounding box (0..0.18) */
  topLift?: number;
  /** Optional per-part micro-variation (-0.06..0.06) */
  hueJitter?: number;
}

export interface LoftStation {
  /** Axial position along the spine (`z` when axis='z', `y` when axis='y') */
  t: number;
  /** Lateral X center offset of this cross-section */
  xCenter?: number;
  /** Transverse center offset (`y` when axis='z', `z` when axis='y') */
  offsetCenter?: number;
  /** Half-width along X */
  rx: number;
  /** Upper/dorsal radius (+Y when axis='z', +Z when axis='y') */
  rPlus: number;
  /** Lower/ventral radius (-Y when axis='z', -Z when axis='y') */
  rMinus: number;
  /** Superellipse shaping exponent for upper half (1 = ellipse, <1 = squarer shoulder, >1 = keeled ridge) */
  powerPlus?: number;
  /** Superellipse shaping exponent for lower half */
  powerMinus?: number;
  /** Optional radial scalloping lobe count (e.g. 7..9 for botanical foliage pads / cumulus clouds) */
  scallopLobes?: number;
  /** Optional radial scalloping amplitude (0..0.25) */
  scallopAmp?: number;
  /** Optional radial scalloping angular phase */
  scallopPhase?: number;
}

export type LoftColorResolver =
  | number
  | ((
      pos: THREE.Vector3,
      norm: THREE.Vector3,
      stationU: number,
      outColor: THREE.Color
    ) => number | THREE.Color);

interface PaintMeta {
  baseR: number;
  baseG: number;
  baseB: number;
  bottomAO: number;
  topLift: number;
}

interface IndexedGeoTemplate {
  posArr: Float32Array;
  normArr: Float32Array;
  indexArr: Uint16Array | Uint32Array;
  minY: number;
  ySpan: number;
}

const _tmpColor = new THREE.Color();
const _baseColor = new THREE.Color();
const _mixColorA = new THREE.Color();
const _mixColorB = new THREE.Color();
const _aoTint = new THREE.Color(0x525b78);
const _topTint = new THREE.Color(0xfff9eb);
const _tmpPos = new THREE.Vector3();
const _tmpNorm = new THREE.Vector3();

const _rboxTemplateCache = new Map<string, IndexedGeoTemplate>();
const _rcylTemplateCache = new Map<string, IndexedGeoTemplate>();
const _sphereTemplateCache = new Map<string, IndexedGeoTemplate>();

function signedPow(val: number, exp: number): number {
  if (exp === 1 || val === 0) return val;
  return Math.sign(val) * Math.pow(Math.abs(val), exp);
}

function evalNonUniformHermite(
  stations: LoftStation[],
  getter: (s: LoftStation) => number,
  i: number,
  f: number
): number {
  const n = stations.length;
  const v1 = getter(stations[i]);
  const v2 = getter(stations[i + 1]);
  const dt = stations[i + 1].t - stations[i].t;
  if (Math.abs(dt) < 1e-6) {
    return v1 + (v2 - v1) * f;
  }

  const slopeAt = (idx: number): number => {
    if (idx <= 0) {
      const d = stations[1].t - stations[0].t;
      return Math.abs(d) > 1e-6 ? (getter(stations[1]) - getter(stations[0])) / d : 0;
    }
    if (idx >= n - 1) {
      const d = stations[n - 1].t - stations[n - 2].t;
      return Math.abs(d) > 1e-6 ? (getter(stations[n - 1]) - getter(stations[n - 2])) / d : 0;
    }
    const dt0 = stations[idx].t - stations[idx - 1].t;
    const dt1 = stations[idx + 1].t - stations[idx].t;
    if (Math.abs(dt0) < 1e-6 || Math.abs(dt1) < 1e-6 || Math.abs(dt0 + dt1) < 1e-6) {
      return 0;
    }
    const d0 = (getter(stations[idx]) - getter(stations[idx - 1])) / dt0;
    const d1 = (getter(stations[idx + 1]) - getter(stations[idx])) / dt1;
    return (d0 * dt1 + d1 * dt0) / (dt0 + dt1);
  };

  const m1 = slopeAt(i) * dt;
  const m2 = slopeAt(i + 1) * dt;
  const f2 = f * f;
  const f3 = f2 * f;
  const h00 = 2 * f3 - 3 * f2 + 1;
  const h10 = f3 - 2 * f2 + f;
  const h01 = -2 * f3 + 3 * f2;
  const h11 = f3 - f2;
  return h00 * v1 + h10 * m1 + h01 * v2 + h11 * m2;
}

function subdivideLoftStations(stations: LoftStation[], subdiv: number): LoftStation[] {
  if (subdiv <= 1 || stations.length < 2) return stations;
  const n = stations.length;
  const out: LoftStation[] = [];
  for (let i = 0; i < n - 1; i++) {
    const s1 = stations[i];
    const s2 = stations[i + 1];
    for (let k = 0; k < subdiv; k++) {
      if (k === 0) {
        out.push(s1);
        continue;
      }
      const f = k / subdiv;
      // Non-uniform C1 cubic Hermite along true axial coordinate t prevents normal creases across unequal intervals
      const t = s1.t + (s2.t - s1.t) * f;
      const rx = Math.max(0.0005, evalNonUniformHermite(stations, (s) => s.rx, i, f));
      const rPlus = Math.max(0.0005, evalNonUniformHermite(stations, (s) => s.rPlus, i, f));
      const rMinus = Math.max(0.0005, evalNonUniformHermite(stations, (s) => s.rMinus, i, f));
      const xCenter = evalNonUniformHermite(stations, (s) => s.xCenter ?? 0, i, f);
      const offsetCenter = evalNonUniformHermite(stations, (s) => s.offsetCenter ?? 0, i, f);
      const powerPlus = Math.max(
        0.35,
        evalNonUniformHermite(stations, (s) => s.powerPlus ?? 1, i, f)
      );
      const powerMinus = Math.max(
        0.35,
        evalNonUniformHermite(stations, (s) => s.powerMinus ?? 1, i, f)
      );
      out.push({
        t,
        rx,
        rPlus,
        rMinus,
        xCenter,
        offsetCenter,
        powerPlus,
        powerMinus,
        scallopLobes: s1.scallopLobes ?? s2.scallopLobes,
        scallopAmp: (s1.scallopAmp ?? 0) * (1 - f) + (s2.scallopAmp ?? 0) * f,
        scallopPhase: (s1.scallopPhase ?? 0) * (1 - f) + (s2.scallopPhase ?? 0) * f,
      });
    }
  }
  out.push(stations[n - 1]);
  return out;
}

function computeYBounds(posArr: ArrayLike<number>, count: number): { minY: number; ySpan: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = posArr[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minY)) {
    return { minY: 0, ySpan: 1 };
  }
  return { minY, ySpan: Math.max(0.001, maxY - minY) };
}

function bakeUniformColorsFromMeta(
  geom: THREE.BufferGeometry,
  meta: PaintMeta,
  knownMinY?: number,
  knownYSpan?: number
): void {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const norm = geom.getAttribute('normal') as THREE.BufferAttribute;
  const count = pos.count;
  const posArr = pos.array as ArrayLike<number>;
  const normArr = norm.array as ArrayLike<number>;

  let minY = knownMinY;
  let ySpan = knownYSpan;
  if (minY === undefined || ySpan === undefined) {
    const bounds = computeYBounds(posArr, count);
    minY = bounds.minY;
    ySpan = bounds.ySpan;
  }

  let colorAttr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
  let colors: Float32Array;
  if (colorAttr && colorAttr.count === count) {
    colors = colorAttr.array as Float32Array;
  } else {
    colors = new Float32Array(count * 3);
    colorAttr = new THREE.BufferAttribute(colors, 3);
    geom.setAttribute('color', colorAttr);
  }

  const { baseR, baseG, baseB, bottomAO, topLift } = meta;
  const aoR = _aoTint.r;
  const aoG = _aoTint.g;
  const aoB = _aoTint.b;
  const topR = _topTint.r;
  const topG = _topTint.g;
  const topB = _topTint.b;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const y = posArr[i3 + 1];
    const ny = normArr[i3 + 1];
    const tY = (y - minY) / ySpan;

    let r = baseR;
    let g = baseG;
    let b = baseB;

    if (bottomAO > 0) {
      const aoFactor = Math.min(
        0.32,
        (1.0 - Math.min(1.0, tY * 1.55)) * bottomAO + Math.max(0, -ny) * (bottomAO * 0.38)
      );
      r += (aoR - r) * aoFactor;
      g += (aoG - g) * aoFactor;
      b += (aoB - b) * aoFactor;
    }

    if (topLift > 0) {
      const lift = Math.min(1.0, Math.max(0, tY - 0.45) * 1.8 * topLift);
      r += (topR - r) * lift;
      g += (topG - g) * lift;
      b += (topB - b) * lift;
    }

    colors[i3] = r;
    colors[i3 + 1] = g;
    colors[i3 + 2] = b;
  }

  colorAttr.needsUpdate = true;
}

function paintIndexedInPlace(
  geom: THREE.BufferGeometry,
  hexColor: number,
  opts: PaintOptions = {},
  knownMinY?: number,
  knownYSpan?: number
): THREE.BufferGeometry {
  _baseColor.setHex(hexColor);
  if (opts.hueJitter) {
    _baseColor.offsetHSL(opts.hueJitter * 0.25, opts.hueJitter * 0.35, opts.hueJitter * 0.5);
  }
  const meta: PaintMeta = {
    baseR: _baseColor.r,
    baseG: _baseColor.g,
    baseB: _baseColor.b,
    bottomAO: opts.bottomAO ?? 0.13,
    topLift: opts.topLift ?? 0.05,
  };
  geom.userData.paintMeta = meta;
  bakeUniformColorsFromMeta(geom, meta, knownMinY, knownYSpan);
  return geom;
}

function buildIndexedTemplate(raw: THREE.BufferGeometry): IndexedGeoTemplate {
  if (!raw.getAttribute('normal')) {
    raw.computeVertexNormals();
  }
  let indexed: THREE.BufferGeometry;
  if (raw.index) {
    indexed = raw;
  } else {
    const stripped = new THREE.BufferGeometry();
    stripped.setAttribute('position', raw.getAttribute('position'));
    stripped.setAttribute('normal', raw.getAttribute('normal'));
    indexed = mergeVertices(stripped, 1e-4);
  }
  const posAttr = indexed.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = indexed.getAttribute('normal') as THREE.BufferAttribute;
  const idxAttr = indexed.getIndex()!;
  const posArr = new Float32Array(posAttr.array as ArrayLike<number>);
  const normArr = new Float32Array(normAttr.array as ArrayLike<number>);
  const rawIdx = idxAttr.array;
  const indexArr =
    rawIdx instanceof Uint32Array ? new Uint32Array(rawIdx) : new Uint16Array(rawIdx as ArrayLike<number>);
  const { minY, ySpan } = computeYBounds(posArr, posAttr.count);
  if (indexed !== raw) {
    indexed.dispose();
  }
  raw.dispose();
  return { posArr, normArr, indexArr, minY, ySpan };
}

function instantiateFromTemplate(
  tpl: IndexedGeoTemplate,
  hexColor: number,
  paintOpts?: PaintOptions
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tpl.posArr), 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(tpl.normArr), 3));
  geom.setIndex(new THREE.BufferAttribute(tpl.indexArr, 1));
  return paintIndexedInPlace(geom, hexColor, paintOpts, tpl.minY, tpl.ySpan);
}

/**
 * Normalizes any BufferGeometry to an indexed `{ position, normal, color }` geometry
 * (stripping unused UVs before indexing since the game uses zero textures) and bakes
 * gouache base color + vertical AO/lift.
 */
export function paintGeometry(
  source: THREE.BufferGeometry,
  hexColor: number,
  opts: PaintOptions = {}
): THREE.BufferGeometry {
  if (!source.getAttribute('normal')) {
    source.computeVertexNormals();
  }

  let geom: THREE.BufferGeometry;
  if (source.index) {
    geom = new THREE.BufferGeometry();
    geom.setAttribute('position', (source.getAttribute('position') as THREE.BufferAttribute).clone());
    geom.setAttribute('normal', (source.getAttribute('normal') as THREE.BufferAttribute).clone());
    geom.setIndex(source.index.clone());
  } else {
    const stripped = new THREE.BufferGeometry();
    stripped.setAttribute('position', source.getAttribute('position'));
    stripped.setAttribute('normal', source.getAttribute('normal'));
    geom = mergeVertices(stripped, 1e-4);
  }

  return paintIndexedInPlace(geom, hexColor, opts);
}

/**
 * Asymmetric cross-section hull lofter: builds a single smooth-normal indexed mesh from ordered
 * spine stations (bird bodies and bills, garments, limbs, foliage pads, clouds) without
 * sphere-intersection seams.
 */
export function loftOrganicHull(
  rawStations: LoftStation[],
  radialSegments = 28,
  colorResolver: LoftColorResolver = 0xffffff,
  opts: PaintOptions & {
    axis?: 'z' | 'y';
    subdivideAxial?: number;
    closeEnd?: boolean;
  } = {}
): THREE.BufferGeometry {
  const axis = opts.axis ?? 'z';
  const closeEnd = opts.closeEnd ?? true;
  const stations = subdivideLoftStations(rawStations, opts.subdivideAxial ?? 1);
  const rings = stations.length;
  const cols = radialSegments;
  const vertCount = rings * cols;

  const positions = new Float32Array(vertCount * 3);
  const stationUs = new Float32Array(vertCount);

  for (let r = 0; r < rings; r++) {
    const st = stations[r];
    const u = rings > 1 ? r / (rings - 1) : 0.5;
    const xc = st.xCenter ?? 0;
    const oc = st.offsetCenter ?? 0;
    const pPlus = st.powerPlus ?? 1.0;
    const pMinus = st.powerMinus ?? 1.0;
    const lobes = st.scallopLobes ?? 0;
    const amp = st.scallopAmp ?? 0;
    const phase = st.scallopPhase ?? 0;

    for (let c = 0; c < cols; c++) {
      const theta = (c / cols) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const scallop = lobes > 0 ? 1.0 + amp * Math.sin(lobes * theta + phase) : 1.0;
      const isPlus = sinT >= 0;
      const exp = isPlus ? pPlus : pMinus;
      const radOrtho = isPlus ? st.rPlus : st.rMinus;

      const lx = xc + signedPow(cosT, exp) * st.rx * scallop;
      const lo = oc + signedPow(sinT, exp) * radOrtho * scallop;

      const idx = r * cols + c;
      if (axis === 'z') {
        positions[idx * 3] = lx;
        positions[idx * 3 + 1] = lo;
        positions[idx * 3 + 2] = st.t;
      } else {
        positions[idx * 3] = lx;
        positions[idx * 3 + 1] = st.t;
        positions[idx * 3 + 2] = lo;
      }
      stationUs[idx] = u;
    }
  }

  const s0 = stations[0];
  const sN = stations[rings - 1];
  const windZPos = (axis === 'z') === sN.t >= s0.t;

  const indices: number[] = [];
  for (let r = 0; r < rings - 1; r++) {
    const rowA = r * cols;
    const rowB = (r + 1) * cols;
    for (let c = 0; c < cols; c++) {
      const cn = (c + 1) % cols;
      const a = rowA + c;
      const b = rowA + cn;
      const d = rowB + c;
      const e = rowB + cn;

      if (windZPos) {
        indices.push(a, b, d);
        indices.push(b, e, d);
      } else {
        indices.push(a, d, b);
        indices.push(b, d, e);
      }
    }
  }

  const extraCaps = closeEnd ? 2 : 1;
  const fullPositions = new Float32Array((vertCount + extraCaps) * 3);
  fullPositions.set(positions, 0);

  const startCapIdx = vertCount;
  if (axis === 'z') {
    fullPositions[startCapIdx * 3] = s0.xCenter ?? 0;
    fullPositions[startCapIdx * 3 + 1] = s0.offsetCenter ?? 0;
    fullPositions[startCapIdx * 3 + 2] = s0.t;
  } else {
    fullPositions[startCapIdx * 3] = s0.xCenter ?? 0;
    fullPositions[startCapIdx * 3 + 1] = s0.t;
    fullPositions[startCapIdx * 3 + 2] = s0.offsetCenter ?? 0;
  }
  for (let c = 0; c < cols; c++) {
    const cn = (c + 1) % cols;
    if (windZPos) {
      indices.push(startCapIdx, cn, c);
    } else {
      indices.push(startCapIdx, c, cn);
    }
  }

  if (closeEnd) {
    const endCapIdx = vertCount + 1;
    if (axis === 'z') {
      fullPositions[endCapIdx * 3] = sN.xCenter ?? 0;
      fullPositions[endCapIdx * 3 + 1] = sN.offsetCenter ?? 0;
      fullPositions[endCapIdx * 3 + 2] = sN.t;
    } else {
      fullPositions[endCapIdx * 3] = sN.xCenter ?? 0;
      fullPositions[endCapIdx * 3 + 1] = sN.t;
      fullPositions[endCapIdx * 3 + 2] = sN.offsetCenter ?? 0;
    }
    const lastRow = (rings - 1) * cols;
    for (let c = 0; c < cols; c++) {
      const cn = (c + 1) % cols;
      if (windZPos) {
        indices.push(endCapIdx, lastRow + c, lastRow + cn);
      } else {
        indices.push(endCapIdx, lastRow + cn, lastRow + c);
      }
    }
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(fullPositions, 3));
  indexed.setIndex(indices);
  indexed.computeVertexNormals();

  if (typeof colorResolver === 'number') {
    return paintIndexedInPlace(indexed, colorResolver, opts);
  }

  const posAttr = indexed.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = indexed.getAttribute('normal') as THREE.BufferAttribute;
  const totalV = posAttr.count;
  const { minY, ySpan } = computeYBounds(posAttr.array as ArrayLike<number>, totalV);
  const bottomAO = opts.bottomAO ?? 0.11;
  const topLift = opts.topLift ?? 0.05;
  const colors = new Float32Array(totalV * 3);

  for (let i = 0; i < totalV; i++) {
    _tmpPos.fromBufferAttribute(posAttr, i);
    _tmpNorm.fromBufferAttribute(normAttr, i);
    const u = i < vertCount ? stationUs[i] : i === startCapIdx ? 0.0 : 1.0;

    const resolved = colorResolver(_tmpPos, _tmpNorm, u, _tmpColor);
    if (typeof resolved === 'number') {
      _tmpColor.setHex(resolved);
    } else if (resolved !== _tmpColor) {
      _tmpColor.copy(resolved);
    }

    const tY = (_tmpPos.y - minY) / ySpan;
    if (bottomAO > 0) {
      const aoFactor =
        (1.0 - Math.min(1.0, tY * 1.55)) * bottomAO + Math.max(0, -_tmpNorm.y) * (bottomAO * 0.36);
      _tmpColor.lerp(_aoTint, Math.min(0.30, aoFactor));
    }
    if (topLift > 0) {
      const lift = Math.max(0, tY - 0.48) * 1.75 * topLift;
      _tmpColor.lerp(_topTint, lift);
    }

    colors[i * 3] = _tmpColor.r;
    colors[i * 3 + 1] = _tmpColor.g;
    colors[i * 3 + 2] = _tmpColor.b;
  }

  indexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return indexed;
}

export function transformGeo(
  geom: THREE.BufferGeometry,
  opts: {
    pos?: [number, number, number];
    rot?: [number, number, number];
    scale?: [number, number, number];
  }
): THREE.BufferGeometry {
  if (opts.scale) {
    const [sx, sy, sz] = opts.scale;
    geom.scale(sx, sy, sz);
    if (sx * sy * sz < 0) {
      const idx = geom.getIndex();
      if (idx) {
        const src = idx.array;
        const copy =
          src instanceof Uint32Array
            ? new Uint32Array(src)
            : new Uint16Array(src as ArrayLike<number>);
        for (let i = 0; i + 2 < copy.length; i += 3) {
          const tmp = copy[i + 1];
          copy[i + 1] = copy[i + 2];
          copy[i + 2] = tmp;
        }
        geom.setIndex(new THREE.BufferAttribute(copy, 1));
      } else {
        for (const attrName of Object.keys(geom.attributes)) {
          const attr = geom.getAttribute(attrName) as THREE.BufferAttribute;
          const itemSize = attr.itemSize;
          const arr = attr.array as Float32Array;
          for (let v = 0; v + 2 < attr.count; v += 3) {
            const o1 = (v + 1) * itemSize;
            const o2 = (v + 2) * itemSize;
            for (let k = 0; k < itemSize; k++) {
              const tmp = arr[o1 + k];
              arr[o1 + k] = arr[o2 + k];
              arr[o2 + k] = tmp;
            }
          }
          attr.needsUpdate = true;
        }
      }
    }
  }
  if (opts.rot) {
    if (opts.rot[0]) geom.rotateX(opts.rot[0]);
    if (opts.rot[1]) geom.rotateY(opts.rot[1]);
    if (opts.rot[2]) geom.rotateZ(opts.rot[2]);
    // Re-bake vertical AO/lift along post-rotation Y when X or Z tilt redirected the local up axis
    if (
      (Math.abs(opts.rot[0]) > 0.01 || Math.abs(opts.rot[2]) > 0.01) &&
      geom.userData?.paintMeta
    ) {
      bakeUniformColorsFromMeta(geom, geom.userData.paintMeta as PaintMeta);
    }
  }
  if (opts.pos) {
    geom.translate(opts.pos[0], opts.pos[1], opts.pos[2]);
  }
  return geom;
}

export function rbox(
  w: number,
  h: number,
  d: number,
  radius: number,
  hex: number,
  segments = 3,
  paintOpts?: PaintOptions
): THREE.BufferGeometry {
  const safeR = Math.min(radius, w * 0.48, h * 0.48, d * 0.48);
  const key = `${w.toFixed(4)}_${h.toFixed(4)}_${d.toFixed(4)}_${safeR.toFixed(4)}_${segments}`;
  let tpl = _rboxTemplateCache.get(key);
  if (!tpl) {
    tpl = buildIndexedTemplate(new RoundedBoxGeometry(w, h, d, segments, safeR));
    _rboxTemplateCache.set(key, tpl);
  }
  return instantiateFromTemplate(tpl, hex, paintOpts);
}

export function rcyl(
  rTop: number,
  rBottom: number,
  height: number,
  hex: number,
  radialSegments = 16,
  paintOpts?: PaintOptions
): THREE.BufferGeometry {
  const key = `${rTop.toFixed(4)}_${rBottom.toFixed(4)}_${height.toFixed(4)}_${radialSegments}`;
  let tpl = _rcylTemplateCache.get(key);
  if (!tpl) {
    tpl = buildIndexedTemplate(new THREE.CylinderGeometry(rTop, rBottom, height, radialSegments, 1));
    _rcylTemplateCache.set(key, tpl);
  }
  return instantiateFromTemplate(tpl, hex, paintOpts);
}

export function smoothSphere(
  radius: number,
  hex: number,
  widthSegments = 26,
  heightSegments = 18,
  scale?: [number, number, number],
  paintOpts?: PaintOptions
): THREE.BufferGeometry {
  if (!scale) {
    const key = `${radius.toFixed(4)}_${widthSegments}_${heightSegments}`;
    let tpl = _sphereTemplateCache.get(key);
    if (!tpl) {
      tpl = buildIndexedTemplate(new THREE.SphereGeometry(radius, widthSegments, heightSegments));
      _sphereTemplateCache.set(key, tpl);
    }
    return instantiateFromTemplate(tpl, hex, paintOpts);
  }

  const raw = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  const [sx, sy, sz] = scale;
  const pos = raw.getAttribute('position') as THREE.BufferAttribute;
  const norm = raw.getAttribute('normal') as THREE.BufferAttribute;
  const invX = (1 / Math.max(1e-5, Math.abs(sx))) * Math.sign(sx || 1);
  const invY = (1 / Math.max(1e-5, Math.abs(sy))) * Math.sign(sy || 1);
  const invZ = (1 / Math.max(1e-5, Math.abs(sz))) * Math.sign(sz || 1);
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * sx, pos.getY(i) * sy, pos.getZ(i) * sz);
    const nx = norm.getX(i) * invX;
    const ny = norm.getY(i) * invY;
    const nz = norm.getZ(i) * invZ;
    const len = Math.hypot(nx, ny, nz) || 1;
    norm.setXYZ(i, nx / len, ny / len, nz / len);
  }
  pos.needsUpdate = true;
  norm.needsUpdate = true;
  const painted = paintGeometry(raw, hex, paintOpts);
  raw.dispose();
  return painted;
}

export function lathe(
  profile: Array<[number, number]>,
  hex: number,
  segments = 22,
  phiLength = Math.PI * 2,
  paintOpts?: PaintOptions
): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
  const raw = new THREE.LatheGeometry(pts, segments, 0, phiLength);
  raw.computeVertexNormals();
  const painted = paintGeometry(raw, hex, paintOpts);
  raw.dispose();
  return painted;
}

export function extrudeShape(
  shape: THREE.Shape,
  depth: number,
  bevelSize: number,
  hex: number,
  curveSegments = 10,
  paintOpts?: PaintOptions
): THREE.BufferGeometry {
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevelSize > 0,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 3,
    curveSegments,
  });
  raw.center();
  const painted = paintGeometry(raw, hex, paintOpts);
  raw.dispose();
  return painted;
}

export function tube(
  points: Array<[number, number, number]>,
  radius: number,
  hex: number,
  tubularSegments = 20,
  radialSegments = 8,
  closed = false,
  paintOpts?: PaintOptions
): THREE.BufferGeometry {
  let cleanPts = points;
  if (closed && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (
      Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) < 1e-4
    ) {
      cleanPts = points.slice(0, -1);
    }
  }
  const curve = new THREE.CatmullRomCurve3(
    cleanPts.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    closed
  );
  const raw = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, closed);
  const painted = paintGeometry(raw, hex, paintOpts);
  raw.dispose();
  return painted;
}

/**
 * Tapered curved organic branch/limb builder along a 3D Catmull-Rom path.
 */
export function taperedTube(
  points: Array<[number, number, number]>,
  rStart: number,
  rEnd: number,
  hex: number,
  tubularSegments = 16,
  radialSegments = 8,
  paintOpts?: PaintOptions
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const vertCount = (tubularSegments + 1) * radialSegments;
  const positions = new Float32Array(vertCount * 3);
  const pt = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    const rad = rStart + (rEnd - rStart) * u;
    curve.getPointAt(u, pt);
    const N = frames.normals[i];
    const B = frames.binormals[i];

    for (let j = 0; j < radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cosV = -Math.cos(v);
      const sinV = Math.sin(v);
      normal.set(
        cosV * N.x + sinV * B.x,
        cosV * N.y + sinV * B.y,
        cosV * N.z + sinV * B.z
      );
      const idx = i * radialSegments + j;
      positions[idx * 3] = pt.x + rad * normal.x;
      positions[idx * 3 + 1] = pt.y + rad * normal.y;
      positions[idx * 3 + 2] = pt.z + rad * normal.z;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < tubularSegments; i++) {
    const rA = i * radialSegments;
    const rB = (i + 1) * radialSegments;
    for (let j = 0; j < radialSegments; j++) {
      const jn = (j + 1) % radialSegments;
      indices.push(rA + j, rB + j, rA + jn);
      indices.push(rA + jn, rB + j, rB + jn);
    }
  }

  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  raw.setIndex(indices);
  raw.computeVertexNormals();
  const painted = paintGeometry(raw, hex, paintOpts);
  raw.dispose();
  return painted;
}

export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 0) {
    return rbox(0.1, 0.1, 0.1, 0.02, 0xffffff);
  }
  if (parts.length === 1) {
    return parts[0];
  }
  const normalized = parts.map((p) => (p.index ? p : mergeVertices(p, 1e-4)));
  const merged = mergeGeometries(normalized, false);
  for (let i = 0; i < parts.length; i++) {
    if (normalized[i] !== parts[i]) normalized[i].dispose();
    parts[i].dispose();
  }
  if (!merged) {
    throw new Error('Failed to merge sculpted geometry parts');
  }
  return merged;
}

// ============================================================================
// Trees & Scalloped Foliage Pads
// ============================================================================

export function buildScallopedFoliagePadGeometry(
  rx: number,
  ry: number,
  rz: number,
  hex: number,
  lobes = 7,
  phase = 0,
  paintOpts?: Pick<PaintOptions, 'bottomAO' | 'topLift'>
): THREE.BufferGeometry {
  return loftOrganicHull(
    [
      { t: -ry * 0.42, rx: rx * 0.12, rPlus: rz * 0.12, rMinus: rz * 0.12, scallopLobes: lobes, scallopAmp: 0.05, scallopPhase: phase },
      { t: -ry * 0.30, rx: rx * 0.72, rPlus: rz * 0.70, rMinus: rz * 0.74, scallopLobes: lobes, scallopAmp: 0.13, scallopPhase: phase },
      { t: -ry * 0.06, rx: rx * 1.00, rPlus: rz * 1.02, rMinus: rz * 0.98, scallopLobes: lobes, scallopAmp: 0.15, scallopPhase: phase + 0.2 },
      { t: ry * 0.28, rx: rx * 0.88, rPlus: rz * 0.88, rMinus: rz * 0.86, scallopLobes: lobes, scallopAmp: 0.14, scallopPhase: phase + 0.4 },
      { t: ry * 0.62, rx: rx * 0.56, rPlus: rz * 0.58, rMinus: rz * 0.54, scallopLobes: lobes, scallopAmp: 0.11, scallopPhase: phase + 0.6 },
      { t: ry * 0.86, rx: rx * 0.14, rPlus: rz * 0.14, rMinus: rz * 0.14, scallopLobes: lobes, scallopAmp: 0.04, scallopPhase: phase + 0.8 },
    ],
    26,
    hex,
    { axis: 'y', bottomAO: paintOpts?.bottomAO ?? 0.13, topLift: paintOpts?.topLift ?? 0.10 }
  );
}

/**
 * Builds an articulated-looking botanical European park/boulevard tree with flared root buttresses,
 * curved primary trunk, 4 diverging forked limbs, and layered scalloped foliage canopies.
 * Local origin at ground `(0, 0, 0)`.
 */
export function buildOrganicTreeParts(
  height: number,
  canopyHex: number,
  seed = 0
): {
  woodGeo: THREE.BufferGeometry;
  foliageGeo: THREE.BufferGeometry;
  boughPerchA: THREE.Vector3;
  boughPerchB: THREE.Vector3;
} {
  const woodParts: THREE.BufferGeometry[] = [];
  const foliageParts: THREE.BufferGeometry[] = [];

  const trunkForkY = height * 0.44;
  const leanX = Math.sin(seed * 1.7 + 0.4) * (height * 0.032);
  const leanZ = Math.cos(seed * 1.3 + 0.8) * (height * 0.032);

  // 1. Flared root buttresses + curved organic trunk
  const rBase = Math.max(0.65, height * 0.044);
  const rMid = rBase * 0.68;
  woodParts.push(
    taperedTube(
      [
        [0, 0.0, 0],
        [leanX * 0.35, trunkForkY * 0.38, leanZ * 0.35],
        [leanX * 0.8, trunkForkY * 0.75, leanZ * 0.8],
        [leanX, trunkForkY, leanZ],
      ],
      rBase * 1.18,
      rMid,
      PALETTE.trunkBark,
      14,
      10,
      { bottomAO: 0.22 }
    )
  );

  // 3 root buttress flares hugging the soil
  for (let r = 0; r < 3; r++) {
    const ra = seed * 0.9 + (r / 3) * Math.PI * 2;
    woodParts.push(
      taperedTube(
        [
          [Math.cos(ra) * rBase * 1.65, 0.05, Math.sin(ra) * rBase * 1.65],
          [Math.cos(ra) * rBase * 0.85, height * 0.06, Math.sin(ra) * rBase * 0.85],
          [leanX * 0.15, height * 0.14, leanZ * 0.15],
        ],
        rBase * 0.42,
        rBase * 0.20,
        PALETTE.trunkBark,
        8,
        7,
        { bottomAO: 0.25 }
      )
    );
  }

  // Shade variants for under-canopy depth vs sunlit crown tips
  const underShade = new THREE.Color(canopyHex).offsetHSL(0.0, 0.0, -0.035).getHex();
  const crownSunlit = new THREE.Color(canopyHex).offsetHSL(-0.01, 0.03, 0.07).getHex();

  // 2. Four primary curved limbs + secondary forks + tiered scalloped leaf cushions
  const boughPerchA = new THREE.Vector3();
  const boughPerchB = new THREE.Vector3();

  const limbCount = 4;
  for (let b = 0; b < limbCount; b++) {
    const ba = seed * 1.1 + (b / limbCount) * Math.PI * 2 + (b % 2) * 0.24;
    const reach = height * (b === 0 ? 0.25 : 0.21 + (b % 2) * 0.03);
    const endY = trunkForkY + height * (0.17 + (b % 3) * 0.055);
    const midX = leanX + Math.cos(ba) * reach * 0.55;
    const midZ = leanZ - Math.sin(ba) * reach * 0.55;
    const endX = leanX + Math.cos(ba) * reach;
    const endZ = leanZ - Math.sin(ba) * reach;

    const boughP0 = new THREE.Vector3(leanX, trunkForkY - 0.5, leanZ);
    const boughP1 = new THREE.Vector3(midX, trunkForkY + (endY - trunkForkY) * 0.52, midZ);
    const boughP2 = new THREE.Vector3(endX, endY, endZ);

    woodParts.push(
      taperedTube(
        [
          [boughP0.x, boughP0.y, boughP0.z],
          [boughP1.x, boughP1.y, boughP1.z],
          [boughP2.x, boughP2.y, boughP2.z],
        ],
        rMid * 0.64,
        rMid * 0.24,
        PALETTE.trunkBark,
        12,
        8,
        { bottomAO: 0.16 }
      )
    );

    if (b === 0) {
      const boughCurve = new THREE.CatmullRomCurve3([boughP0, boughP1, boughP2]);
      boughCurve.getPoint(0.28, boughPerchA);
      boughPerchA.y += rMid * THREE.MathUtils.lerp(0.64, 0.24, 0.28);
      boughCurve.getPoint(0.84, boughPerchB);
      boughPerchB.y += rMid * THREE.MathUtils.lerp(0.64, 0.24, 0.84);
    }

    // Secondary upward twig fork into upper canopy
    const subA = ba + (b % 2 === 0 ? 0.45 : -0.45);
    const subX = midX + Math.cos(subA) * (reach * 0.48);
    const subZ = midZ - Math.sin(subA) * (reach * 0.48);
    const subY = endY + height * 0.11;
    woodParts.push(
      taperedTube(
        [
          [midX, trunkForkY + (endY - trunkForkY) * 0.52, midZ],
          [subX, subY, subZ],
        ],
        rMid * 0.36,
        rMid * 0.14,
        PALETTE.trunkBark,
        8,
        6
      )
    );

    // Lower shaded bough foliage pad + upper mid-tone bough foliage pad
    const padR = height * (0.155 + (b % 2) * 0.02);
    const padH = height * 0.105;
    foliageParts.push(
      transformGeo(
        buildScallopedFoliagePadGeometry(padR * 1.08, padH, padR * 0.98, underShade, 7, ba),
        {
          rot: [Math.sin(ba) * 0.08, ba * 0.5, -Math.cos(ba) * 0.08],
          pos: [endX, endY + padH * 0.15, endZ],
        }
      ),
      transformGeo(
        buildScallopedFoliagePadGeometry(padR * 0.92, padH * 0.95, padR * 0.90, canopyHex, 8, ba + 0.9),
        {
          rot: [0, -ba * 0.4, 0],
          pos: [subX * 0.92, subY + padH * 0.18, subZ * 0.92],
        }
      )
    );
  }

  // 3. Central leader limb & multi-tiered sunlit crown domes
  const crownLeaderY = trunkForkY + height * 0.36;
  woodParts.push(
    taperedTube(
      [
        [leanX, trunkForkY - 0.3, leanZ],
        [leanX * 1.15, trunkForkY + height * 0.18, leanZ * 1.15],
        [leanX * 0.8, crownLeaderY, leanZ * 0.8],
      ],
      rMid * 0.62,
      rMid * 0.18,
      PALETTE.trunkBark,
      10,
      7
    )
  );

  foliageParts.push(
    transformGeo(
      buildScallopedFoliagePadGeometry(height * 0.22, height * 0.13, height * 0.21, canopyHex, 9, seed),
      {
        pos: [leanX * 0.9, trunkForkY + height * 0.24, leanZ * 0.9],
      }
    ),
    transformGeo(
      buildScallopedFoliagePadGeometry(
        height * 0.165,
        height * 0.115,
        height * 0.16,
        crownSunlit,
        7,
        seed + 1.2,
        { bottomAO: 0.12, topLift: 0.14 }
      ),
      {
        pos: [leanX * 0.6 + 0.35, trunkForkY + height * 0.39, leanZ * 0.6 - 0.25],
      }
    ),
    transformGeo(
      buildScallopedFoliagePadGeometry(
        height * 0.105,
        height * 0.085,
        height * 0.10,
        crownSunlit,
        6,
        seed + 2.4,
        { bottomAO: 0.08, topLift: 0.16 }
      ),
      {
        pos: [leanX * 0.5 - 0.45, trunkForkY + height * 0.48, leanZ * 0.5 + 0.3],
      }
    )
  );

  return {
    woodGeo: mergeParts(woodParts),
    foliageGeo: mergeParts(foliageParts),
    boughPerchA,
    boughPerchB,
  };
}

// ============================================================================
// Prop Geometries (scaled to ~11.2-SU humans)
// ============================================================================

export function buildToGoCoffeeCupGeometry(
  cupHex: number = PALETTE.porcelainWhite
): THREE.BufferGeometry {
  const cupBody = lathe(
    [
      [0.001, -0.86],
      [0.39, -0.86],
      [0.41, -0.80],
      [0.55, 0.58],
      [0.58, 0.63],
      [0.53, 0.65],
      [0.001, 0.63],
    ],
    cupHex,
    24,
    Math.PI * 2,
    { bottomAO: 0.18 }
  );

  const sleeve = lathe(
    [
      [0.445, -0.38],
      [0.465, -0.37],
      [0.525, 0.27],
      [0.505, 0.28],
    ],
    PALETTE.woodOak,
    24,
    Math.PI * 2,
    { bottomAO: 0.12 }
  );

  const lid = lathe(
    [
      [0.51, 0.63],
      [0.60, 0.65],
      [0.60, 0.72],
      [0.54, 0.75],
      [0.50, 0.85],
      [0.43, 0.87],
      [0.39, 0.80],
      [0.001, 0.79],
    ],
    PALETTE.wallCreamTrim,
    24,
    Math.PI * 2,
    { bottomAO: 0.08, topLift: 0.07 }
  );

  const sipSpout = transformGeo(rbox(0.17, 0.08, 0.15, 0.03, PALETTE.ironworkPlum), {
    pos: [0, 0.85, 0.44],
  });

  return mergeParts([cupBody, sleeve, lid, sipSpout]);
}

export function buildCeramicCoffeeMugGeometry(mugHex: number = PALETTE.awningCoral): THREE.BufferGeometry {
  const mug = lathe(
    [
      [0.001, -0.68],
      [0.48, -0.68],
      [0.60, -0.36],
      [0.66, 0.36],
      [0.68, 0.60],
      [0.60, 0.62],
      [0.57, 0.44],
      [0.001, 0.42],
    ],
    mugHex,
    24,
    Math.PI * 2,
    { bottomAO: 0.18 }
  );

  const coffeeSurface = transformGeo(rcyl(0.58, 0.58, 0.06, PALETTE.coffeeDark, 22, { bottomAO: 0 }), {
    pos: [0, 0.45, 0],
  });
  const cremaRing = transformGeo(rcyl(0.39, 0.39, 0.07, PALETTE.coffeeCrema, 20, { bottomAO: 0 }), {
    pos: [0.04, 0.455, 0.02],
  });

  const handle = tube(
    [
      [0.60, 0.38, 0],
      [0.92, 0.34, 0],
      [0.96, -0.05, 0],
      [0.85, -0.38, 0],
      [0.54, -0.40, 0],
    ],
    0.095,
    mugHex,
    16,
    8,
    false
  );

  return mergeParts([mug, coffeeSurface, cremaRing, handle]);
}

export function buildCroissantGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const segSpecs = [
    { angle: 0, r: 0.26, w: 0.36, col: PALETTE.croissantGold },
    { angle: -0.52, r: 0.22, w: 0.30, col: PALETTE.croissantButter },
    { angle: 0.52, r: 0.22, w: 0.30, col: PALETTE.croissantButter },
    { angle: -1.02, r: 0.16, w: 0.25, col: PALETTE.croissantGold },
    { angle: 1.02, r: 0.16, w: 0.25, col: PALETTE.croissantGold },
    { angle: -1.42, r: 0.10, w: 0.19, col: PALETTE.woodOak },
    { angle: 1.42, r: 0.10, w: 0.19, col: PALETTE.woodOak },
  ];
  const arcR = 0.41;
  for (const s of segSpecs) {
    const seg = loftOrganicHull(
      [
        { t: -0.22, rx: s.w * 0.4, rPlus: s.r * 0.5, rMinus: s.r * 0.35 },
        { t: 0.0, rx: s.w, rPlus: s.r * 0.92, rMinus: s.r * 0.62 },
        { t: 0.22, rx: s.w * 0.4, rPlus: s.r * 0.5, rMinus: s.r * 0.35 },
      ],
      16,
      s.col,
      { bottomAO: 0.16, topLift: 0.1 }
    );
    transformGeo(seg, {
      rot: [0, -s.angle, 0],
      pos: [Math.sin(s.angle) * arcR, 0, (Math.cos(s.angle) - 0.65) * arcR],
    });
    parts.push(seg);
  }
  return mergeParts(parts);
}

export function buildBaguetteGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    loftOrganicHull(
      [
        { t: -1.32, rx: 0.06, rPlus: 0.06, rMinus: 0.04 },
        { t: -1.05, rx: 0.24, rPlus: 0.21, rMinus: 0.13 },
        { t: -0.45, rx: 0.29, rPlus: 0.25, rMinus: 0.14 },
        { t: 0.45, rx: 0.29, rPlus: 0.25, rMinus: 0.14 },
        { t: 1.05, rx: 0.24, rPlus: 0.21, rMinus: 0.13 },
        { t: 1.32, rx: 0.06, rPlus: 0.06, rMinus: 0.04 },
      ],
      18,
      PALETTE.croissantGold,
      { bottomAO: 0.18, topLift: 0.08 }
    ),
  ];
  for (const z of [-0.7, -0.22, 0.26, 0.74]) {
    parts.push(
      transformGeo(rbox(0.32, 0.08, 0.18, 0.03, PALETTE.croissantButter, 1), {
        rot: [0, 0.45, 0],
        pos: [0, 0.21, z],
      })
    );
  }
  return mergeParts(parts);
}

export function buildGelatoConeGeometry(
  scoopA: number = PALETTE.gelatoStrawberry,
  scoopB: number = PALETTE.gelatoPistachio
): THREE.BufferGeometry {
  const cone = transformGeo(rcyl(0.32, 0.03, 0.92, PALETTE.croissantGold, 16, { bottomAO: 0.2 }), {
    pos: [0, -0.18, 0],
  });
  const s1 = transformGeo(
    buildScallopedFoliagePadGeometry(0.35, 0.34, 0.35, scoopA, 6, 0.2, { topLift: 0.08 }),
    { pos: [0, 0.34, 0] }
  );
  const s2 = transformGeo(
    buildScallopedFoliagePadGeometry(0.28, 0.29, 0.28, scoopB, 6, 0.9, { topLift: 0.1 }),
    { pos: [0.04, 0.68, -0.02] }
  );
  const wafer = transformGeo(rbox(0.18, 0.26, 0.04, 0.01, PALETTE.croissantButter, 1), {
    rot: [0.2, 0, -0.35],
    pos: [-0.14, 0.86, 0],
  });
  return mergeParts([cone, s1, s2, wafer]);
}

/**
 * Vintage Parisian City Bicycle (~9.8 SU long, ~6.1 SU tall at handlebars; scaled to ~11.2-SU humans).
 * Origin at ground level `y = 0`, wheels along `X` axis.
 */
export function buildVintageBicycleGeometry(frameHex: number = PALETTE.awningMint): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const wheelR = 2.12;
  for (const wx of [-3.05, 3.05]) {
    const tirePts: Array<[number, number, number]> = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      tirePts.push([wx + Math.cos(a) * wheelR, wheelR + Math.sin(a) * wheelR, 0]);
    }
    parts.push(tube(tirePts, 0.18, PALETTE.ironworkPlum, 24, 8, true));
    parts.push(tube(tirePts, 0.11, PALETTE.wallCreamTrim, 24, 6, true));
    parts.push(
      transformGeo(rcyl(0.21, 0.21, 0.34, PALETTE.brassWarm, 12), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [wx, wheelR, 0],
      })
    );
    for (let s = 0; s < 4; s++) {
      parts.push(
        transformGeo(rcyl(0.032, 0.032, wheelR * 1.9, PALETTE.wallLimestone, 6), {
          rot: [0, 0, (s / 4) * Math.PI],
          pos: [wx, wheelR, 0],
        })
      );
    }
  }

  parts.push(
    tube([[-3.05, wheelR, 0], [-0.9, 4.05, 0], [2.3, 4.35, 0]], 0.125, frameHex, 14, 7),
    tube([[-3.05, wheelR, 0], [0.15, 2.02, 0], [2.45, 4.65, 0]], 0.125, frameHex, 14, 7),
    tube([[0.15, 2.02, 0], [-1.02, 4.82, 0]], 0.125, frameHex, 10, 7),
    tube([[3.05, wheelR, 0], [2.28, 5.75, 0]], 0.125, frameHex, 12, 7),
    tube(
      [
        [1.95, 5.95, -1.25],
        [2.28, 6.02, -0.42],
        [2.28, 5.88, 0],
        [2.28, 6.02, 0.42],
        [1.95, 5.95, 1.25],
      ],
      0.10,
      PALETTE.wallCreamTrim,
      16,
      7
    ),
    transformGeo(rcyl(0.14, 0.14, 0.48, PALETTE.woodWalnut, 10), {
      rot: [Math.PI * 0.5, 0, 0],
      pos: [1.92, 5.95, -1.18],
    }),
    transformGeo(rcyl(0.14, 0.14, 0.48, PALETTE.woodWalnut, 10), {
      rot: [Math.PI * 0.5, 0, 0],
      pos: [1.92, 5.95, 1.18],
    }),
    transformGeo(smoothSphere(0.22, PALETTE.goldGlow, 14, 10, [1.0, 0.72, 1.0]), {
      pos: [2.20, 6.22, 0.65],
    }),
    transformGeo(rbox(1.18, 0.34, 0.82, 0.14, PALETTE.woodWalnut, 2), {
      pos: [-1.08, 5.02, 0],
    }),
    transformGeo(rbox(1.25, 1.18, 1.62, 0.16, PALETTE.woodBirch, 2), {
      pos: [3.02, 4.85, 0],
    })
  );

  return mergeParts(parts);
}

/**
 * Flat-bottomed cumulus cloud:
 * lofted deck with a flattened, cool AO-shaded underside and two scalloped upper turrets.
 */
export function buildCloudClusterGeometry(scale = 1.0): THREE.BufferGeometry {
  const mainDeck = loftOrganicHull(
    [
      { t: -8.0 * scale, offsetCenter: -0.25 * scale, rx: 0.9 * scale, rPlus: 0.7 * scale, rMinus: 0.22 * scale, scallopLobes: 6, scallopAmp: 0.04 },
      { t: -6.4 * scale, offsetCenter: -0.15 * scale, rx: 3.4 * scale, rPlus: 2.0 * scale, rMinus: 0.42 * scale, scallopLobes: 6, scallopAmp: 0.06 },
      { t: -4.2 * scale, offsetCenter: -0.05 * scale, rx: 5.3 * scale, rPlus: 3.3 * scale, rMinus: 0.56 * scale, scallopLobes: 6, scallopAmp: 0.07 },
      { t: -1.8 * scale, offsetCenter: 0.06 * scale, rx: 6.3 * scale, rPlus: 4.3 * scale, rMinus: 0.64 * scale, scallopLobes: 6, scallopAmp: 0.08 },
      { t: 0.4 * scale, offsetCenter: 0.08 * scale, rx: 6.5 * scale, rPlus: 4.5 * scale, rMinus: 0.65 * scale, scallopLobes: 6, scallopAmp: 0.08 },
      { t: 2.6 * scale, offsetCenter: 0.02 * scale, rx: 5.8 * scale, rPlus: 3.8 * scale, rMinus: 0.60 * scale, scallopLobes: 6, scallopAmp: 0.07 },
      { t: 4.8 * scale, offsetCenter: -0.08 * scale, rx: 4.7 * scale, rPlus: 2.9 * scale, rMinus: 0.50 * scale, scallopLobes: 6, scallopAmp: 0.06 },
      { t: 6.8 * scale, offsetCenter: -0.18 * scale, rx: 2.9 * scale, rPlus: 1.8 * scale, rMinus: 0.36 * scale, scallopLobes: 6, scallopAmp: 0.05 },
      { t: 8.2 * scale, offsetCenter: -0.26 * scale, rx: 0.9 * scale, rPlus: 0.7 * scale, rMinus: 0.22 * scale, scallopLobes: 6, scallopAmp: 0.04 },
    ],
    32,
    PALETTE.cloudWarmTop,
    { bottomAO: 0.22, topLift: 0.10 }
  );

  const turretA = transformGeo(
    buildScallopedFoliagePadGeometry(
      3.9 * scale,
      3.5 * scale,
      3.6 * scale,
      PALETTE.cloudWarmTop,
      6,
      0.0,
      { bottomAO: 0.18, topLift: 0.12 }
    ),
    { pos: [-1.4 * scale, 2.1 * scale, -0.9 * scale] }
  );

  const turretB = transformGeo(
    buildScallopedFoliagePadGeometry(
      3.2 * scale,
      2.9 * scale,
      3.0 * scale,
      PALETTE.cloudWarmTop,
      6,
      0.0,
      { bottomAO: 0.16, topLift: 0.12 }
    ),
    { pos: [2.0 * scale, 1.75 * scale, 1.3 * scale] }
  );

  return mergeParts([mainDeck, turretA, turretB]);
}

/**
 * Cast-Iron & Rounded Oak Park Bench (`width = 11.4 SU, seatY = 2.37 SU, crestY = 5.14 SU`).
 * Origin at ground level `y = 0`. Scaled to `11.2-SU` humans.
 */
export function buildParkBenchGeometry(woodHex: number = PALETTE.woodOak): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const width = 11.4;

  for (const x of [-4.8, 0, 4.8]) {
    parts.push(
      tube(
        [
          [x, 0.08, 1.72],
          [x, 1.21, 1.56],
          [x, 2.26, 1.42],
        ],
        0.19,
        PALETTE.parisGreen,
        12,
        8
      ),
      tube(
        [
          [x, 0.08, -1.45],
          [x, 1.32, -1.26],
          [x, 2.30, -1.14],
          [x, 3.82, -1.48],
          [x, 5.14, -1.82],
        ],
        0.19,
        PALETTE.parisGreen,
        16,
        8
      ),
      tube(
        [
          [x, 2.18, 1.76],
          [x, 2.18, 0.15],
          [x, 2.26, -1.18],
        ],
        0.16,
        PALETTE.parisGreen,
        10,
        8
      ),
      tube(
        [
          [x, 0.96, 1.45],
          [x, 1.42, 0.3],
          [x, 1.18, -0.72],
          [x, 0.86, -1.26],
        ],
        0.11,
        PALETTE.parisGreen,
        14,
        7
      ),
      transformGeo(rcyl(0.28, 0.34, 0.18, PALETTE.ironworkPlum, 12), { pos: [x, 0.09, 1.72] }),
      transformGeo(rcyl(0.28, 0.34, 0.18, PALETTE.ironworkPlum, 12), { pos: [x, 0.09, -1.45] })
    );
  }

  for (const x of [-4.8, 4.8]) {
    parts.push(
      tube(
        [
          [x, 2.30, 1.60],
          [x, 3.40, 1.68],
          [x, 3.58, 0.50],
          [x, 3.54, -1.34],
        ],
        0.17,
        PALETTE.parisGreen,
        16,
        8
      ),
      transformGeo(smoothSphere(0.26, PALETTE.brassWarm, 14, 10), { pos: [x, 3.28, 1.72] })
    );
  }

  const slatZ = [1.58, 1.06, 0.54, 0.03, -0.48, -0.98];
  for (let i = 0; i < slatZ.length; i++) {
    const shade = i % 2 === 0 ? woodHex : PALETTE.woodBirch;
    const slat = rbox(width, 0.25, 0.42, 0.08, shade, 2, {
      bottomAO: 0.15,
      hueJitter: (i - 2.5) * 0.012,
    });
    transformGeo(slat, {
      rot: [i === 0 ? 0.18 : 0, 0, 0],
      pos: [0, i === 0 ? 2.30 : 2.37, slatZ[i]],
    });
    parts.push(slat);
  }

  const backSteps = [
    { y: 2.98, z: -1.28 },
    { y: 3.52, z: -1.41 },
    { y: 4.06, z: -1.54 },
    { y: 4.60, z: -1.67 },
    { y: 5.14, z: -1.82 },
  ];
  backSteps.forEach((b, idx) => {
    const isCrest = idx === backSteps.length - 1;
    const slat = rbox(
      width + (isCrest ? 0.3 : 0),
      isCrest ? 0.38 : 0.35,
      0.24,
      0.08,
      isCrest ? woodHex : idx % 2 === 0 ? PALETTE.woodBirch : woodHex,
      2,
      { bottomAO: 0.12 }
    );
    transformGeo(slat, {
      rot: [-0.24, 0, 0],
      pos: [0, b.y, b.z],
    });
    parts.push(slat);
  });

  parts.push(
    transformGeo(rcyl(0.36, 0.36, 0.28, PALETTE.brassWarm, 16), {
      rot: [Math.PI * 0.5 - 0.24, 0, 0],
      pos: [0, 5.20, -1.84],
    })
  );

  return mergeParts(parts);
}

export function buildEyeglassesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-0.34, 0.34]) {
    const rimPts: Array<[number, number, number]> = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      rimPts.push([sx + Math.cos(a) * 0.24, Math.sin(a) * 0.22, 0]);
    }
    parts.push(tube(rimPts, 0.038, PALETTE.brassWarm, 20, 7, true));
    parts.push(
      transformGeo(rcyl(0.21, 0.21, 0.03, PALETTE.windowGlass, 16), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [sx, 0, 0],
      })
    );
    parts.push(
      tube(
        [
          [sx + Math.sign(sx) * 0.24, 0.04, 0],
          [sx + Math.sign(sx) * 0.25, 0.04, -0.45],
          [sx + Math.sign(sx) * 0.18, -0.08, -0.58],
        ],
        0.032,
        PALETTE.brassWarm,
        10,
        6
      )
    );
  }
  parts.push(
    tube(
      [
        [-0.10, 0.04, 0.02],
        [0, 0.10, 0.05],
        [0.10, 0.04, 0.02],
      ],
      0.035,
      PALETTE.brassWarm,
      8,
      6
    )
  );
  return mergeParts(parts);
}

export function buildBrassKeyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bowPts: Array<[number, number, number]> = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    bowPts.push([-0.36 + Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18]);
  }
  parts.push(tube(bowPts, 0.048, PALETTE.goldGlow, 20, 8, true));
  parts.push(
    transformGeo(rcyl(0.05, 0.05, 0.68, PALETTE.brassWarm, 12), {
      rot: [0, 0, Math.PI * 0.5],
      pos: [0.14, 0, 0],
    }),
    transformGeo(rcyl(0.085, 0.085, 0.07, PALETTE.goldGlow, 12), {
      rot: [0, 0, Math.PI * 0.5],
      pos: [-0.14, 0, 0],
    }),
    transformGeo(rbox(0.18, 0.07, 0.18, 0.02, PALETTE.brassWarm), { pos: [0.34, 0, 0.11] }),
    transformGeo(rbox(0.07, 0.07, 0.14, 0.02, PALETTE.goldGlow), { pos: [0.43, 0, 0.09] })
  );
  return mergeParts(parts);
}

export function buildPaperAirplaneGeometry(hex: number = PALETTE.porcelainWhite): THREE.BufferGeometry {
  const leftWing = new THREE.Shape();
  leftWing.moveTo(0, 0.75);
  leftWing.lineTo(-0.58, -0.62);
  leftWing.lineTo(-0.06, -0.48);
  leftWing.closePath();

  const rightWing = new THREE.Shape();
  rightWing.moveTo(0, 0.75);
  rightWing.lineTo(0.06, -0.48);
  rightWing.lineTo(0.58, -0.62);
  rightWing.closePath();

  const wL = transformGeo(extrudeShape(leftWing, 0.03, 0.012, hex, 4), {
    rot: [-Math.PI * 0.5, 0, 0.16],
    pos: [-0.16, 0.05, 0],
  });
  const wR = transformGeo(extrudeShape(rightWing, 0.03, 0.012, hex, 4), {
    rot: [-Math.PI * 0.5, 0, -0.16],
    pos: [0.16, 0.05, 0],
  });
  const fin = transformGeo(rbox(0.05, 0.24, 1.25, 0.018, PALETTE.wallCreamTrim), {
    pos: [0, -0.08, 0.02],
  });

  return mergeParts([wL, wR, fin]);
}

/**
 * Concert Acoustic Guitar (~3.25 SU long, scaled to the ~11.2-SU busker):
 * Sculpted spruce soundboard, mahogany back & ribs, cream binding, inlaid rosette around
 * recessed soundhole, rosewood bridge & bone saddle, tortoiseshell pickguard, fretted
 * rosewood fingerboard, 6 taut strings, and angled mahogany headstock with brass tuners.
 */
export function buildAcousticGuitarGeometry(): THREE.BufferGeometry {
  const s = 0.78;
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(0, -1.16 * s);
  bodyShape.bezierCurveTo(0.92 * s, -1.16 * s, 0.99 * s, -0.34 * s, 0.52 * s, -0.04 * s);
  bodyShape.bezierCurveTo(0.36 * s, 0.08 * s, 0.41 * s, 0.26 * s, 0.66 * s, 0.46 * s);
  bodyShape.bezierCurveTo(0.79 * s, 0.70 * s, 0.58 * s, 1.04 * s, 0, 1.04 * s);
  bodyShape.bezierCurveTo(-0.58 * s, 1.04 * s, -0.79 * s, 0.70 * s, -0.66 * s, 0.46 * s);
  bodyShape.bezierCurveTo(-0.41 * s, 0.26 * s, -0.36 * s, 0.08 * s, -0.52 * s, -0.04 * s);
  bodyShape.bezierCurveTo(-0.99 * s, -0.34 * s, -0.92 * s, -1.16 * s, 0, -1.16 * s);

  const parts: THREE.BufferGeometry[] = [];

  // Mahogany back/ribs + warm Sitka spruce soundboard top
  parts.push(
    transformGeo(
      extrudeShape(bodyShape, 0.22, 0.03, PALETTE.woodWalnut, 16, { bottomAO: 0.2 }),
      { pos: [0, 0, 0] }
    ),
    transformGeo(
      extrudeShape(bodyShape, 0.08, 0.025, PALETTE.croissantGold, 16, { topLift: 0.1 }),
      { pos: [0, 0, 0.21] }
    )
  );

  // Decorative marquetry rosette & dark recessed soundhole cavity
  parts.push(
    transformGeo(rcyl(0.255, 0.255, 0.02, PALETTE.woodWalnut, 20), {
      rot: [Math.PI * 0.5, 0, 0],
      pos: [0, 0.18, 0.305],
    }),
    transformGeo(rcyl(0.235, 0.235, 0.024, PALETTE.goldGlow, 20), {
      rot: [Math.PI * 0.5, 0, 0],
      pos: [0, 0.18, 0.307],
    }),
    transformGeo(rcyl(0.20, 0.20, 0.06, PALETTE.cobbleDark, 20), {
      rot: [Math.PI * 0.5, 0, 0],
      pos: [0, 0.18, 0.295],
    })
  );

  // Teardrop tortoiseshell pickguard below/right of soundhole
  parts.push(
    transformGeo(rcyl(0.16, 0.16, 0.016, PALETTE.brickTerracotta, 12), {
      scale: [0.85, 1.45, 1.0],
      rot: [Math.PI * 0.5, 0, -0.25],
      pos: [0.24, -0.02, 0.308],
    })
  );

  // Carved rosewood bridge + angled bone saddle
  parts.push(
    transformGeo(rbox(0.48, 0.11, 0.05, 0.018, PALETTE.ironworkPlum), {
      pos: [0, -0.36, 0.312],
    }),
    transformGeo(rbox(0.32, 0.024, 0.036, 0.008, PALETTE.porcelainWhite), {
      rot: [0, 0, -0.05],
      pos: [0, -0.34, 0.335],
    })
  );

  // Mahogany neck heel + neck shaft + rosewood fingerboard + bone nut
  parts.push(
    transformGeo(rcyl(0.11, 0.16, 0.24, PALETTE.woodWalnut, 10), {
      pos: [0, 0.76, 0.15],
    }),
    transformGeo(rbox(0.19, 1.42, 0.11, 0.035, PALETTE.woodWalnut), {
      pos: [0, 1.38, 0.22],
    }),
    transformGeo(rbox(0.205, 1.56, 0.036, 0.01, PALETTE.ironworkPlum), {
      pos: [0, 1.32, 0.292],
    }),
    transformGeo(rbox(0.21, 0.028, 0.042, 0.008, PALETTE.porcelainWhite), {
      pos: [0, 2.09, 0.312],
    })
  );

  // Silver-nickel fretwire bars + pearloid position dot inlays along fingerboard
  for (let f = 0; f < 8; f++) {
    const fy = 0.72 + f * 0.175;
    parts.push(
      transformGeo(rbox(0.20, 0.014, 0.016, 0.004, PALETTE.wallCreamTrim, 1), {
        pos: [0, fy, 0.314],
      })
    );
    if (f === 2 || f === 4 || f === 6) {
      parts.push(
        transformGeo(rcyl(0.022, 0.022, 0.012, PALETTE.porcelainWhite, 8), {
          rot: [Math.PI * 0.5, 0, 0],
          pos: [0, fy - 0.085, 0.312],
        })
      );
    }
  }

  // Angled slotted/solid headstock + 6 brass tuning pegs
  parts.push(
    transformGeo(rbox(0.26, 0.44, 0.075, 0.024, PALETTE.woodWalnut), {
      rot: [-0.20, 0, 0],
      pos: [0, 2.29, 0.255],
    }),
    transformGeo(rbox(0.12, 0.05, 0.02, 0.006, PALETTE.brassWarm, 1), {
      rot: [-0.20, 0, 0],
      pos: [0, 2.45, 0.28],
    })
  );
  for (let p = 0; p < 3; p++) {
    const py = 2.18 + p * 0.105;
    const pz = 0.27 - p * 0.021;
    for (const side of [-1, 1]) {
      parts.push(
        transformGeo(rcyl(0.018, 0.018, 0.08, PALETTE.brassWarm, 8), {
          rot: [0, 0, Math.PI * 0.5],
          pos: [side * 0.155, py, pz],
        }),
        transformGeo(rbox(0.032, 0.052, 0.018, 0.006, PALETTE.brassWarm, 1), {
          pos: [side * 0.195, py, pz],
        })
      );
    }
  }

  // 6 taut bronze/steel acoustic strings spanning bridge saddle to nut
  for (let st = 0; st < 6; st++) {
    const sx = -0.078 + st * 0.031;
    const rStr = st < 3 ? 0.0075 : 0.0055;
    const strHex = st < 3 ? PALETTE.brassWarm : PALETTE.porcelainWhite;
    parts.push(
      transformGeo(rcyl(rStr, rStr, 2.43, strHex, 6), {
        pos: [sx, 0.875, 0.332],
      })
    );
  }

  return mergeParts(parts);
}

/**
 * Bistro / Atelier Ceramic Mug (~0.88 SU tall; pushable & shatterable by the sparrow).
 */
export function buildCeramicMugGeometry(
  bodyHex: number = PALETTE.porcelainWhite,
  liquidHex: number = 0x4a2f22,
  stripeHex?: number
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    // Hollow glazed barrel body (outer wall + lip + inward upper liner so coffee meniscus is visible)
    lathe(
      [
        [0.001, 0.0],
        [0.36, 0.0],
        [0.42, 0.83],
        [0.375, 0.84],
        [0.36, 0.72],
        [0.001, 0.72],
      ],
      bodyHex,
      22,
      Math.PI * 2,
      { bottomAO: 0.18, topLift: 0.07 }
    ),
    // Rounded glazed lip torus ring
    tube(
      Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2;
        return [Math.cos(a) * 0.405, 0.83, Math.sin(a) * 0.405] as [number, number, number];
      }),
      0.036,
      bodyHex,
      22,
      8,
      true
    ),
    // Dark coffee / brush-rinse liquid surface inside rim
    transformGeo(rcyl(0.365, 0.365, 0.06, liquidHex, 20, { bottomAO: 0.05, topLift: 0.08 }), {
      pos: [0, 0.74, 0],
    }),
    // Curved C-handle
    tube(
      [
        [0.37, 0.68, 0],
        [0.58, 0.64, 0],
        [0.62, 0.44, 0],
        [0.56, 0.24, 0],
        [0.35, 0.20, 0],
      ],
      0.048,
      bodyHex,
      14,
      8
    ),
  ];

  if (stripeHex !== undefined) {
    parts.push(
      transformGeo(rcyl(0.415, 0.402, 0.14, stripeHex, 22, { bottomAO: 0.06 }), {
        pos: [0, 0.56, 0],
      })
    );
  }

  return mergeParts(parts);
}

/**
 * Delicate French Porcelain Teacup (~0.58 SU tall).
 */
export function buildPorcelainTeacupGeometry(
  cupHex: number = PALETTE.porcelainWhite,
  trimHex: number = PALETTE.goldGlow
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    // Pedestal foot
    transformGeo(rcyl(0.22, 0.25, 0.10, trimHex, 18), { pos: [0, 0.05, 0] }),
    // Open-rimmed flared bowl + inward porcelain upper liner so warm amber tea meniscus is visible
    loftOrganicHull(
      [
        { t: 0.08, rx: 0.18, rPlus: 0.18, rMinus: 0.18 },
        { t: 0.24, rx: 0.31, rPlus: 0.31, rMinus: 0.31 },
        { t: 0.44, rx: 0.39, rPlus: 0.39, rMinus: 0.39 },
        { t: 0.56, rx: 0.43, rPlus: 0.43, rMinus: 0.43 },
      ],
      22,
      cupHex,
      { axis: 'y', subdivideAxial: 2, closeEnd: false, bottomAO: 0.15, topLift: 0.08 }
    ),
    lathe(
      [
        [0.425, 0.56],
        [0.365, 0.45],
        [0.001, 0.45],
      ],
      cupHex,
      20,
      Math.PI * 2,
      { bottomAO: 0.12, topLift: 0.06 }
    ),
    // Gold gilt rim
    tube(
      Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2;
        return [Math.cos(a) * 0.425, 0.56, Math.sin(a) * 0.425] as [number, number, number];
      }),
      0.024,
      trimHex,
      20,
      7,
      true
    ),
    // Warm amber tea meniscus
    transformGeo(rcyl(0.37, 0.37, 0.04, 0x9b5a2c, 18), { pos: [0, 0.47, 0] }),
    // Dainty ear handle
    tube(
      [
        [0.38, 0.48, 0],
        [0.55, 0.50, 0],
        [0.54, 0.32, 0],
        [0.33, 0.22, 0],
      ],
      0.032,
      trimHex,
      12,
      7
    ),
  ];
  return mergeParts(parts);
}

/**
 * Porcelain Saucer / Bistro Plate (~0.92 SU radius, 0.16 SU tall).
 */
export function buildPorcelainPlateGeometry(
  plateHex: number = PALETTE.porcelainWhite,
  rimHex: number = PALETTE.awningCobalt
): THREE.BufferGeometry {
  return mergeParts([
    transformGeo(rcyl(0.68, 0.54, 0.07, plateHex, 24), { pos: [0, 0.035, 0] }),
    transformGeo(rcyl(0.92, 0.68, 0.08, plateHex, 24, { topLift: 0.08 }), { pos: [0, 0.10, 0] }),
    tube(
      Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        return [Math.cos(a) * 0.89, 0.145, Math.sin(a) * 0.89] as [number, number, number];
      }),
      0.026,
      rimHex,
      24,
      7,
      true
    ),
  ]);
}

/**
 * Atelier Glass / Ceramic Pigment Jar (~0.78 SU tall — filled with ultramarine/vermilion/ochre gouache).
 */
export function buildPigmentJarGeometry(
  pigmentHex: number = 0x2f5fb8
): THREE.BufferGeometry {
  const glassTint = _mixColorA.setHex(pigmentHex).lerp(_mixColorB.setHex(0xeef6fb), 0.28).getHex();
  return mergeParts([
    // Rounded glass belly showing rich gouache pigment inside
    loftOrganicHull(
      [
        { t: 0.0, rx: 0.28, rPlus: 0.28, rMinus: 0.28 },
        { t: 0.14, rx: 0.35, rPlus: 0.35, rMinus: 0.35 },
        { t: 0.44, rx: 0.36, rPlus: 0.36, rMinus: 0.36 },
        { t: 0.58, rx: 0.25, rPlus: 0.25, rMinus: 0.25 },
        { t: 0.66, rx: 0.26, rPlus: 0.26, rMinus: 0.26 },
      ],
      20,
      (_pos, _norm, u) => (u < 0.72 ? pigmentHex : glassTint),
      { axis: 'y', subdivideAxial: 2, bottomAO: 0.16, topLift: 0.09 }
    ),
    // Ribbed brass / cork stopper cap
    transformGeo(rcyl(0.28, 0.27, 0.13, PALETTE.brassWarm, 18, { topLift: 0.09 }), { pos: [0, 0.72, 0] }),
  ]);
}

/**
 * Small Pushable & Breakable Terracotta Flower Pot (~0.96 SU tall).
 */
export function buildSmallTerracottaPotGeometry(
  bloomHex: number = PALETTE.tulipCoral
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    transformGeo(rcyl(0.38, 0.26, 0.56, PALETTE.roofTerracotta, 18, { bottomAO: 0.2 }), {
      pos: [0, 0.28, 0],
    }),
    transformGeo(rcyl(0.42, 0.40, 0.11, PALETTE.wallCoral, 18), {
      pos: [0, 0.55, 0],
    }),
    transformGeo(smoothSphere(0.32, PALETTE.soilWarm, 14, 10, [1.0, 0.38, 1.0]), {
      pos: [0, 0.56, 0],
    }),
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const bx = Math.cos(a) * 0.14;
    const bz = Math.sin(a) * 0.14;
    const topY = 0.84 + (i % 2) * 0.08;
    parts.push(
      tube(
        [
          [bx * 0.4, 0.56, bz * 0.4],
          [bx, topY, bz],
        ],
        0.028,
        PALETTE.leafSage,
        6,
        6
      ),
      transformGeo(smoothSphere(0.11, bloomHex, 12, 10, [1.1, 0.75, 1.1]), {
        pos: [bx, topY + 0.04, bz],
      }),
      transformGeo(smoothSphere(0.045, PALETTE.goldGlow, 8, 8), {
        pos: [bx, topY + 0.09, bz],
      })
    );
  }
  return mergeParts(parts);
}

/**
 * Bistro / Market Glass Carafe Bottle (~1.08 SU tall, cork stopper & cream paper label).
 */
export function buildGlassCarafeGeometry(
  glassHex: number = 0x7cb89e,
  labelHex: number = PALETTE.awningCream
): THREE.BufferGeometry {
  const paleNeck = _mixColorA.setHex(glassHex).lerp(_mixColorB.setHex(0xf0f8fc), 0.38).getHex();
  return mergeParts([
    loftOrganicHull(
      [
        { t: 0.0, rx: 0.25, rPlus: 0.25, rMinus: 0.25 },
        { t: 0.12, rx: 0.29, rPlus: 0.29, rMinus: 0.29 },
        { t: 0.48, rx: 0.29, rPlus: 0.29, rMinus: 0.29 },
        { t: 0.68, rx: 0.15, rPlus: 0.15, rMinus: 0.15 },
        { t: 0.92, rx: 0.11, rPlus: 0.11, rMinus: 0.11 },
        { t: 0.98, rx: 0.14, rPlus: 0.14, rMinus: 0.14 },
      ],
      20,
      (_p, _n, u) => (u < 0.62 ? glassHex : paleNeck),
      { axis: 'y', subdivideAxial: 2, bottomAO: 0.16, topLift: 0.10 }
    ),
    transformGeo(rcyl(0.296, 0.296, 0.20, labelHex, 20), { pos: [0, 0.30, 0] }),
    transformGeo(rcyl(0.095, 0.082, 0.12, PALETTE.woodOak, 12, { topLift: 0.08 }), {
      pos: [0, 1.02, 0],
    }),
  ]);
}

/**
 * Hand-Thrown Glazed Ceramic Bud Vase (~0.98 SU tall, painted accent band & twin flower stems).
 */
export function buildCeramicVaseGeometry(
  vaseHex: number = PALETTE.awningCobalt,
  bandHex: number = PALETTE.goldGlow,
  bloomHex: number = PALETTE.tulipCoral
): THREE.BufferGeometry {
  return mergeParts([
    // Glazed pedestal foot closing the lower hull opening when tipped over
    transformGeo(rcyl(0.20, 0.21, 0.06, bandHex, 18), { pos: [0, 0.03, 0] }),
    loftOrganicHull(
      [
        { t: 0.0, rx: 0.20, rPlus: 0.20, rMinus: 0.20 },
        { t: 0.16, rx: 0.34, rPlus: 0.34, rMinus: 0.34 },
        { t: 0.42, rx: 0.36, rPlus: 0.36, rMinus: 0.36 },
        { t: 0.64, rx: 0.16, rPlus: 0.16, rMinus: 0.16 },
        { t: 0.78, rx: 0.23, rPlus: 0.23, rMinus: 0.23 },
      ],
      22,
      vaseHex,
      { axis: 'y', subdivideAxial: 2, closeEnd: false, bottomAO: 0.18, topLift: 0.09 }
    ),
    lathe(
      [
        [0.226, 0.78],
        [0.155, 0.66],
        [0.001, 0.66],
      ],
      vaseHex,
      18,
      Math.PI * 2,
      { bottomAO: 0.15 }
    ),
    transformGeo(rcyl(0.152, 0.152, 0.03, 0x89c7da, 16), { pos: [0, 0.68, 0] }),
    transformGeo(rcyl(0.364, 0.354, 0.09, bandHex, 22), { pos: [0, 0.36, 0] }),
    tube(
      [
        [0.02, 0.68, 0.0],
        [0.09, 0.90, 0.04],
      ],
      0.024,
      PALETTE.leafSage,
      6,
      6
    ),
    transformGeo(smoothSphere(0.10, bloomHex, 12, 10, [1.1, 0.78, 1.1]), {
      pos: [0.10, 0.94, 0.04],
    }),
    tube(
      [
        [-0.02, 0.68, 0.0],
        [-0.08, 0.86, -0.04],
      ],
      0.022,
      PALETTE.leafSage,
      6,
      6
    ),
    transformGeo(smoothSphere(0.085, PALETTE.tulipYellow, 10, 8, [1.1, 0.78, 1.1]), {
      pos: [-0.09, 0.90, -0.04],
    }),
  ]);
}

/**
 * Angular Glazed Ceramic / Terracotta Shard Chunk for physical shatter debris.
 */
export function buildCeramicShardGeometry(hex: number, variant = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  if (variant % 3 === 0) {
    shape.moveTo(-0.14, -0.10);
    shape.lineTo(0.16, -0.06);
    shape.lineTo(0.08, 0.15);
    shape.lineTo(-0.11, 0.09);
  } else if (variant % 3 === 1) {
    shape.moveTo(-0.16, -0.05);
    shape.lineTo(0.12, -0.12);
    shape.lineTo(0.15, 0.11);
    shape.lineTo(-0.04, 0.14);
  } else {
    shape.moveTo(-0.11, -0.13);
    shape.lineTo(0.14, -0.02);
    shape.lineTo(-0.02, 0.16);
  }
  shape.closePath();
  return transformGeo(extrudeShape(shape, 0.045, 0.012, hex, 4, { bottomAO: 0.15, topLift: 0.09 }), {
    rot: [Math.PI * 0.5, 0, 0],
  });
}

/**
 * Breadcrumb cluster (~0.30 SU across):
 * golden-brown crust on one side, cream interior crumb facets, and 2 small companion crumbs.
 */
export function buildBreadcrumbGeometry(variant = 0): THREE.BufferGeometry {
  const crustHex = 0xc47b31;
  const toastedRimHex = 0xdd9f52;
  const softCrumbHex = 0xf4e1b8;
  const pocketCrumbHex = 0xe6ca94;

  const rotOff = (variant % 4) * 1.15;

  // Main torn crusty morsel: golden crust cap + irregular soft interior crumb facets
  const mainCrumb = loftOrganicHull(
    [
      { t: -0.13, offsetCenter: -0.01, rx: 0.055, rPlus: 0.048, rMinus: 0.032, scallopLobes: 5, scallopAmp: 0.12 },
      { t: -0.06, offsetCenter: 0.01, rx: 0.118, rPlus: 0.095, rMinus: 0.058, scallopLobes: 5, scallopAmp: 0.16 },
      { t: 0.02, offsetCenter: 0.015, rx: 0.126, rPlus: 0.102, rMinus: 0.062, scallopLobes: 5, scallopAmp: 0.15 },
      { t: 0.09, offsetCenter: 0.0, rx: 0.092, rPlus: 0.076, rMinus: 0.048, scallopLobes: 5, scallopAmp: 0.14 },
      { t: 0.14, offsetCenter: -0.01, rx: 0.042, rPlus: 0.038, rMinus: 0.026, scallopLobes: 5, scallopAmp: 0.10 },
    ],
    14,
    (pos, norm) => {
      // Curved baked outer crust on the upper-back ridge; torn airy cream interior on front/side facets
      if (norm.y > 0.42 && pos.z < 0.02) return crustHex;
      if (pos.z < -0.045 || (norm.y > 0.65 && pos.x < 0.0)) return toastedRimHex;
      return pos.x + pos.z > 0.03 ? softCrumbHex : pocketCrumbHex;
    },
    { bottomAO: 0.18, topLift: 0.08 }
  );
  transformGeo(mainCrumb, {
    rot: [0.12, rotOff, -0.08],
    pos: [-0.02, 0.02, 0.0],
  });

  // Crisp torn crust flake perched on one edge of the morsel
  const crustEdge = transformGeo(
    rbox(0.13, 0.075, 0.095, 0.022, crustHex, 1, { bottomAO: 0.16, topLift: 0.08 }),
    {
      rot: [0.24, rotOff + 0.45, 0.18],
      pos: [-0.055, 0.048, -0.035],
    }
  );

  // Two small sub-crumbs beside the main morsel so the cluster reads as breadcrumbs
  const subA = transformGeo(
    rbox(0.078, 0.052, 0.068, 0.016, variant % 2 === 0 ? softCrumbHex : toastedRimHex, 1, {
      bottomAO: 0.15,
    }),
    {
      rot: [0.1, rotOff + 0.9, -0.15],
      pos: [0.135, -0.022, 0.065],
    }
  );
  const subB = transformGeo(
    rbox(0.062, 0.045, 0.058, 0.014, crustHex, 1, { bottomAO: 0.15 }),
    {
      rot: [-0.14, rotOff - 0.7, 0.2],
      pos: [0.065, -0.026, -0.125],
    }
  );

  return mergeParts([mainCrumb, crustEdge, subA, subB]);
}

export function buildDroppingProjectileGeometry(): THREE.BufferGeometry {
  const drop = lathe(
    [
      [0.002, -0.095],
      [0.056, -0.055],
      [0.062, -0.01],
      [0.042, 0.055],
      [0.016, 0.115],
      [0.002, 0.14],
    ],
    0xf6f3ea,
    10,
    Math.PI * 2,
    { bottomAO: 0.12, topLift: 0.08 }
  );
  const speck = transformGeo(smoothSphere(0.032, 0x626046, 8, 6, [1.0, 0.85, 1.0]), {
    pos: [0.008, -0.052, 0.01],
  });
  return mergeParts([drop, speck]);
}

export function buildDroppingSplatGeometry(): THREE.BufferGeometry {
  const creamHex = 0xf6f3ea;
  const oliveHex = 0x626046;
  const shape = new THREE.Shape();
  const lobes = 9;
  for (let i = 0; i <= lobes * 3; i++) {
    const a = (i / (lobes * 3)) * Math.PI * 2;
    const wave =
      1.0 +
      0.24 * Math.sin(a * 5.0 + 0.4) +
      0.14 * Math.cos(a * 3.0 - 0.8) +
      0.09 * Math.sin(a * 7.0);
    const r = 0.25 * wave;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const mainPuddle = transformGeo(
    extrudeShape(shape, 0.016, 0.007, creamHex, 2, { bottomAO: 0.06, topLift: 0.08 }),
    {
      rot: [-Math.PI * 0.5, 0, 0],
      pos: [0, 0.009, 0],
    }
  );
  const dotA = transformGeo(rcyl(0.052, 0.062, 0.015, creamHex, 8), {
    pos: [0.33, 0.008, 0.11],
  });
  const dotB = transformGeo(rcyl(0.038, 0.046, 0.014, creamHex, 7), {
    pos: [-0.29, 0.007, -0.16],
  });
  const centerFleck = transformGeo(rcyl(0.082, 0.096, 0.019, oliveHex, 9), {
    pos: [0.025, 0.013, -0.02],
  });

  return mergeParts([mainPuddle, dotA, dotB, centerFleck]);
}


