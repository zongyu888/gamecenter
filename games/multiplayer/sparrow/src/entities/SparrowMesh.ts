import * as THREE from 'three/webgpu';
import { PALETTE } from '../rendering/Palette.ts';
import {
  createPastelMaterial,
  createBirdTorsoPlumageMaterial,
  createBirdHeadPlumageMaterial,
  createUnlitPastelFXMaterial,
  type BirdPlumageMaterialSpec,
} from '../rendering/StorybookMaterial.ts';
import type { BirdMode } from './SparrowController.ts';
import {
  loftOrganicHull,
  taperedTube,
  tube,
  rcyl,
  smoothSphere,
  extrudeShape,
  transformGeo,
  mergeParts,
} from '../geometry/Sculptor.ts';

export type BirdSpecies =
  | 'sparrow'
  | 'blue_tit'
  | 'robin'
  | 'goldfinch'
  | 'warbler'
  | 'finch'
  | 'pigeon';

export type DizzyPoseState = 'none' | 'falling' | 'grounded' | 'shaking';

export interface SparrowPoseInput {
  dt: number;
  elapsed: number;
  mode: BirdMode;
  isBraking: boolean;
  /** 0..1: >0.55 tucks wings during horizontal passerine flap-bounding ballistic phase */
  wingTuck?: number;
  /** 0..1: startled cute head-shake & feather-ruffle animation after a light bump */
  bonkPhase?: number;
  /** 0..1: active forward beak-peck lunge & bill snap (1 = start of peck, 0 = idle) */
  peckPhase?: number;
  /** 0..1: downward eating dip + rapid 3-bite mandible crunch when eating a breadcrumb */
  eatPhase?: number;
  /** Optional curious head-tilt roll angle during intro hero look / chirp */
  introHeadRoll?: number;
  /** Vertical velocity in SU/s (negative when descending/stooping) */
  verticalVel?: number;
  /** 3-stage wall-knockout state: falling -> belly-flopped grounded -> feather-ruffle shaking */
  dizzyState?: DizzyPoseState;
  dizzyPhase?: number;
  /** 0..1: 0 = flat ledge/cornice toes, 1 = cylindrical rail/wire/branch toe wrap */
  perchGrip?: number;
  /** 1..0: perch approach progress remaining (1 = capture start, 0 = planted on perch) */
  perchArrival?: number;
  /** Signed vertical knee-cushion settle offset in SU after touchdown while feet stay IK-planted */
  perchSettleOffset?: number;
  /** Local lateral (+X right) and forward (+Z) slope of active perch segment */
  perchSlopeX?: number;
  perchSlopeZ?: number;
  hopPhase: number;
  flapTimer: number;
  bankAngle: number;
  pitchAngle: number;
  chirpOpen: number;
  carryingItem: boolean;
  headLookLocal: THREE.Vector2;
}

export interface AvianLegRig {
  hipPivot: THREE.Group;
  hockPivot: THREE.Group;
  footPivot: THREE.Group;
  frontToesPivot: THREE.Group;
  halluxPivot: THREE.Group;
}

interface SpeciesPalette extends BirdPlumageMaterialSpec {
  wingBar: number;
  wingPrimary: number;
  tailMain: number;
  tailOuter: number;
  beakUpper: number;
  beakLower: number;
  leg: number;
}

interface CachedSpeciesAssets {
  mat: THREE.NodeMaterial;
  torsoMat: THREE.NodeMaterial;
  headMat: THREE.NodeMaterial;
  catchlightMat: THREE.NodeMaterial;
  bodyGeo: THREE.BufferGeometry;
  headGeo: THREE.BufferGeometry;
  headDetailsGeo: THREE.BufferGeometry;
  catchlightGeo: THREE.BufferGeometry;
  upperBeakGeo: THREE.BufferGeometry;
  lowerBeakGeo: THREE.BufferGeometry;
  wingLeftInnerGeo: THREE.BufferGeometry;
  wingLeftOuterGeo: THREE.BufferGeometry;
  wingRightInnerGeo: THREE.BufferGeometry;
  wingRightOuterGeo: THREE.BufferGeometry;
  tailFeatherGeos: THREE.BufferGeometry[];
  thighGeo: THREE.BufferGeometry;
  tarsusGeo: THREE.BufferGeometry;
  footSoleGeo: THREE.BufferGeometry;
  leftFrontToesGeo: THREE.BufferGeometry;
  rightFrontToesGeo: THREE.BufferGeometry;
  halluxGeo: THREE.BufferGeometry;
}

interface HopKinematics {
  bodyY: number;
  hipX: number;
  hockX: number;
  footX: number;
  frontToesX: number;
  halluxX: number;
}

interface PigeonLegKinematics {
  hipX: number;
  hockX: number;
  footX: number;
  frontToesX: number;
  halluxX: number;
}

const _speciesAssetCache = new Map<BirdSpecies, CachedSpeciesAssets>();
let _sharedBirdMat: THREE.NodeMaterial | null = null;
let _sharedCatchlightMat: THREE.NodeMaterial | null = null;
let _sharedCrownGeo: THREE.BufferGeometry | null = null;
let _sharedCrownMat: THREE.NodeMaterial | null = null;

function getOrBuildRoyalCrownAssets(): { geo: THREE.BufferGeometry; mat: THREE.NodeMaterial } {
  if (_sharedCrownGeo && _sharedCrownMat) {
    return { geo: _sharedCrownGeo, mat: _sharedCrownMat };
  }
  if (!_sharedCrownMat) {
    _sharedCrownMat = createPastelMaterial({
      vertexColors: true,
      rimStrength: 0.14,
      emissiveHex: 0xffc83c,
      emissiveIntensity: 0.22,
    });
  }

  const parts: THREE.BufferGeometry[] = [];
  const R = 0.074;
  const bandH = 0.034;

  // Hollow golden royal circlet band + bottom beaded rim hugging the crown feathers
  const rimPts: Array<[number, number, number]> = [];
  const topRimPts: Array<[number, number, number]> = [];
  const ringSegs = 24;
  for (let s = 0; s <= ringSegs; s++) {
    const a = (s / ringSegs) * Math.PI * 2;
    rimPts.push([Math.sin(a) * (R + 0.004), 0.005, Math.cos(a) * (R + 0.004)]);
    topRimPts.push([Math.sin(a) * (R + 0.003), bandH, Math.cos(a) * (R + 0.003)]);
  }
  parts.push(
    // Crimson royal velvet cushion inside the circlet
    transformGeo(rcyl(R * 0.92, R * 0.96, bandH * 0.95, PALETTE.tulipCoral, 18), {
      pos: [0, bandH * 0.48, 0],
    }),
    // Outer golden circlet wall
    transformGeo(rcyl(R + 0.002, R + 0.004, bandH, PALETTE.goldGlow, 20), {
      pos: [0, bandH * 0.5, 0],
    }),
    tube(rimPts, 0.0065, PALETTE.brassWarm, 24, 6, true),
    tube(topRimPts, 0.0052, PALETTE.goldGlow, 24, 6, true)
  );

  // 5 sculpted royal points around the circlet (`i = 0` faces forward `+Z`), each tipped with a golden pearl
  const numSpikes = 5;
  for (let i = 0; i < numSpikes; i++) {
    const ang = (i / numSpikes) * Math.PI * 2;
    const isFront = i === 0;
    const spikeH = isFront ? 0.056 : 0.046;
    const sx = Math.sin(ang) * R;
    const sz = Math.cos(ang) * R;
    const outX = Math.sin(ang) * (R + 0.014);
    const outZ = Math.cos(ang) * (R + 0.014);

    parts.push(
      taperedTube(
        [
          [sx, bandH - 0.004, sz],
          [(sx + outX) * 0.5, bandH + spikeH * 0.52, (sz + outZ) * 0.5],
          [outX, bandH + spikeH, outZ],
        ],
        isFront ? 0.022 : 0.019,
        0.0035,
        PALETTE.goldGlow,
        8,
        8
      ),
      transformGeo(smoothSphere(isFront ? 0.0115 : 0.0098, PALETTE.sunCore, 10, 8), {
        pos: [outX, bandH + spikeH + 0.005, outZ],
      })
    );
  }

  // Front cabochon jewels set into the golden circlet band (ruby center, sapphire & emerald flanks)
  const jewelSpecs: Array<[number, number, number]> = [
    [0, PALETTE.tulipCoral, 0.0115],
    [-0.58, PALETTE.birdBlueTit, 0.0092],
    [0.58, PALETTE.awningMint, 0.0092],
  ];
  for (const [jAng, jHex, jRad] of jewelSpecs) {
    parts.push(
      transformGeo(smoothSphere(jRad, jHex, 10, 8, [1.0, 1.0, 0.65]), {
        rot: [0, jAng, 0],
        pos: [Math.sin(jAng) * (R + 0.005), bandH * 0.52, Math.cos(jAng) * (R + 0.005)],
      })
    );
  }

  _sharedCrownGeo = mergeParts(parts);
  _sharedCrownGeo.computeBoundingSphere();
  return { geo: _sharedCrownGeo, mat: _sharedCrownMat };
}

const _hopK: HopKinematics = {
  bodyY: 0,
  hipX: 0,
  hockX: 0,
  footX: 0,
  frontToesX: 0,
  halluxX: 0,
};
const _pigeonLeftK: PigeonLegKinematics = {
  hipX: 0,
  hockX: 0,
  footX: 0,
  frontToesX: 0,
  halluxX: 0,
};
const _pigeonRightK: PigeonLegKinematics = {
  hipX: 0,
  hockX: 0,
  footX: 0,
  frontToesX: 0,
  halluxX: 0,
};

function smoothBand(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function resolveSpeciesPalette(species: BirdSpecies): SpeciesPalette {
  switch (species) {
    case 'blue_tit':
      return {
        crown: PALETTE.birdBlueTit,
        mantle: 0x5c8c58,
        scapular: 0x4a789e,
        breast: 0xf2cb46,
        belly: 0xf7e58e,
        cheek: 0xfaf7f0,
        bib: 0x242836,
        faceBlaze: null,
        wingBar: 0xfaf7f0,
        wingPrimary: 0x2d4866,
        tailMain: 0x355c82,
        tailOuter: 0xf0ece4,
        beakUpper: 0x26262e,
        beakLower: 0x363640,
        leg: 0x627082,
        bodyScale: [0.94, 0.95, 0.92],
        headScale: 0.98,
        isPigeon: false,
      };
    case 'robin':
      return {
        crown: 0x6e563f,
        mantle: 0x785e46,
        scapular: 0x6b523c,
        breast: PALETTE.birdRobinBreast,
        belly: 0xede5d8,
        cheek: 0x8a7d70,
        bib: PALETTE.birdRobinBreast,
        faceBlaze: PALETTE.birdRobinBreast,
        wingBar: 0xd9bfa0,
        wingPrimary: 0x3b2f26,
        tailMain: 0x4f3e31,
        tailOuter: 0x6e563f,
        beakUpper: 0x2b2526,
        beakLower: 0x3d3332,
        leg: 0x8f6852,
        bodyScale: [1.02, 1.02, 0.96],
        headScale: 1.0,
        isPigeon: false,
      };
    case 'goldfinch':
      return {
        crown: 0x262326,
        mantle: 0x8f6848,
        scapular: 0x7d583b,
        breast: 0xebe1d1,
        belly: 0xf7f2e8,
        cheek: 0xfaf6ee,
        bib: null,
        faceBlaze: 0xc93438,
        wingBar: PALETTE.birdGoldfinch,
        wingPrimary: 0x211f24,
        tailMain: 0x211f24,
        tailOuter: 0xf5efe6,
        beakUpper: 0xd9c6b0,
        beakLower: 0xc4b099,
        leg: 0xa67c63,
        bodyScale: [0.96, 0.96, 0.98],
        headScale: 0.97,
        isPigeon: false,
      };
    case 'warbler':
      return {
        crown: PALETTE.birdMintWarbler,
        mantle: 0x55875a,
        scapular: 0x4a784f,
        breast: 0xebe6b5,
        belly: 0xf5f2dc,
        cheek: 0xe6e0aa,
        bib: null,
        faceBlaze: null,
        wingBar: 0xe8e2be,
        wingPrimary: 0x334736,
        tailMain: 0x3a523d,
        tailOuter: 0x5c8c62,
        beakUpper: 0x36332e,
        beakLower: 0x595043,
        leg: 0x8c7056,
        bodyScale: [0.94, 0.94, 0.96],
        headScale: 0.96,
        isPigeon: false,
      };
    case 'finch':
      return {
        crown: PALETTE.birdRoseFinch,
        mantle: 0x94525d,
        scapular: 0x854650,
        breast: 0xe39aa4,
        belly: 0xf2dce0,
        cheek: 0xebadb6,
        bib: null,
        faceBlaze: PALETTE.birdRoseFinch,
        wingBar: 0xf5e1e4,
        wingPrimary: 0x3b282d,
        tailMain: 0x3b282d,
        tailOuter: 0x94525d,
        beakUpper: 0x473b3e,
        beakLower: 0x5e4f52,
        leg: 0x996e68,
        bodyScale: [0.98, 0.98, 0.98],
        headScale: 0.98,
        isPigeon: false,
      };
    case 'pigeon':
      return {
        crown: PALETTE.pigeonSlate,
        mantle: PALETTE.pigeonWing,
        scapular: PALETTE.pigeonWing,
        breast: 0x788294,
        belly: 0x8d98aa,
        cheek: PALETTE.pigeonSlate,
        bib: PALETTE.pigeonNeckPlum,
        faceBlaze: null,
        wingBar: 0x262930,
        wingPrimary: 0x3e4452,
        tailMain: 0x4c5463,
        tailOuter: 0x292d36,
        beakUpper: 0x383a42,
        beakLower: 0x484b54,
        leg: PALETTE.pigeonFoot,
        bodyScale: [1.32, 1.26, 1.30],
        headScale: 1.04,
        isPigeon: true,
      };
    case 'sparrow':
    default:
      return {
        crown: PALETTE.sparrowChestnut,
        mantle: PALETTE.sparrowWarmBack,
        scapular: PALETTE.sparrowCinnamon,
        breast: PALETTE.sparrowBreast,
        belly: PALETTE.sparrowCheek,
        cheek: PALETTE.sparrowCheek,
        bib: PALETTE.sparrowBib,
        faceBlaze: null,
        wingBar: PALETTE.sparrowWingBar,
        wingPrimary: PALETTE.sparrowWingTip,
        tailMain: PALETTE.sparrowWingTip,
        tailOuter: PALETTE.sparrowWarmBack,
        beakUpper: PALETTE.sparrowBeak,
        beakLower: 0x473e3c,
        leg: PALETTE.sparrowLeg,
        bodyScale: [1, 1, 1],
        headScale: 1.0,
        isPigeon: false,
      };
  }
}

function buildWingGeometriesForSide(
  side: -1 | 1,
  pal: SpeciesPalette
): { innerGeo: THREE.BufferGeometry; outerGeo: THREE.BufferGeometry } {
  const bs = pal.bodyScale;
  const innerParts: THREE.BufferGeometry[] = [];

  const covertShape = new THREE.Shape();
  covertShape.moveTo(0, 0.032);
  covertShape.bezierCurveTo(side * 0.13, 0.042, side * 0.23, 0.022, side * 0.265, -0.034);
  covertShape.bezierCurveTo(side * 0.23, -0.125, side * 0.11, -0.152, 0, -0.125);
  covertShape.closePath();

  innerParts.push(
    transformGeo(
      extrudeShape(covertShape, 0.012, 0.005, pal.mantle, 10, { topLift: 0.06 }),
      {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [0, 0.004, 0],
      }
    )
  );

  const lesserShape = new THREE.Shape();
  lesserShape.moveTo(0, 0.030);
  lesserShape.bezierCurveTo(side * 0.09, 0.036, side * 0.17, 0.018, side * 0.18, -0.016);
  lesserShape.bezierCurveTo(side * 0.14, -0.055, side * 0.07, -0.064, 0, -0.042);
  lesserShape.closePath();
  innerParts.push(
    transformGeo(
      extrudeShape(lesserShape, 0.010, 0.004, pal.scapular, 8, { topLift: 0.07 }),
      {
        rot: [Math.PI * 0.5 - 0.04, 0, 0],
        pos: [side * 0.018, 0.012, 0.008],
      }
    )
  );

  const barFeatherShape = new THREE.Shape();
  barFeatherShape.moveTo(0, 0.024);
  barFeatherShape.bezierCurveTo(0.020, 0.012, 0.020, -0.028, 0, -0.042);
  barFeatherShape.bezierCurveTo(-0.020, -0.028, -0.020, 0.012, 0, 0.024);

  for (let b = 0; b < 5; b++) {
    innerParts.push(
      transformGeo(
        extrudeShape(barFeatherShape, 0.007, 0.003, pal.wingBar, 6, { bottomAO: 0.04, topLift: 0.09 }),
        {
          rot: [Math.PI * 0.5, 0, side * 0.18],
          pos: [side * (0.044 + b * 0.038), 0.013, -0.024 - b * 0.008],
        }
      )
    );
    if (pal.isPigeon && b < 4) {
      innerParts.push(
        transformGeo(
          extrudeShape(barFeatherShape, 0.007, 0.003, pal.wingBar, 6),
          {
            rot: [Math.PI * 0.5, 0, side * 0.18],
            pos: [side * (0.064 + b * 0.040), 0.011, -0.076 - b * 0.008],
          }
        )
      );
    }
  }

  const innerGeo = transformGeo(mergeParts(innerParts), { scale: [bs[0], 1, bs[2]] });

  const primaryShape = new THREE.Shape();
  primaryShape.moveTo(0, 0.038);
  primaryShape.bezierCurveTo(side * 0.16, 0.045, side * 0.34, 0.020, side * 0.41, -0.020);
  primaryShape.bezierCurveTo(side * 0.35, -0.078, side * 0.16, -0.092, 0, -0.062);
  primaryShape.closePath();

  const outerParts: THREE.BufferGeometry[] = [];
  for (let f = 0; f < 7; f++) {
    const col = f % 2 === 1 ? pal.scapular : pal.wingPrimary;
    const scaleLen = (1.0 - f * 0.085) * (pal.isPigeon ? 1.18 : 1.0);
    const feather = extrudeShape(primaryShape, 0.0075, 0.003, col, 8, { topLift: 0.05 });
    transformGeo(feather, {
      scale: [scaleLen, scaleLen, 1],
      rot: [Math.PI * 0.5, 0, side * f * 0.078],
      pos: [side * (0.034 - f * 0.012), -f * 0.0025, -0.006 - f * 0.033],
    });
    outerParts.push(feather);
  }

  const outerGeo = mergeParts(outerParts);
  return { innerGeo, outerGeo };
}

function buildFootSoleGeo(legHex: number): THREE.BufferGeometry {
  return smoothSphere(0.015, legHex, 10, 8, [1.15, 0.75, 1.2]);
}

function buildFrontToesGeo(side: -1 | 1, legHex: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const digitSpecs: ReadonlyArray<{ angle: number; len: number }> = [
    { angle: -0.38 + side * 0.015, len: 0.092 },
    { angle: side * 0.01, len: 0.116 },
    { angle: 0.38 + side * 0.015, len: 0.092 },
  ];
  for (let i = 0; i < digitSpecs.length; i++) {
    const d = digitSpecs[i];
    const sx = Math.sin(d.angle);
    const cz = Math.cos(d.angle);
    parts.push(
      taperedTube(
        [
          [0, 0, 0],
          [sx * d.len * 0.48, 0.003, cz * d.len * 0.48],
          [sx * d.len, -0.003, cz * d.len],
        ],
        0.0092,
        0.0062,
        legHex,
        8,
        6
      ),
      taperedTube(
        [
          [sx * d.len, -0.003, cz * d.len],
          [sx * (d.len + 0.015), -0.005, cz * (d.len + 0.015)],
          [sx * (d.len + 0.024), -0.008, cz * (d.len + 0.024)],
        ],
        0.0056,
        0.0018,
        0x242024,
        6,
        6
      )
    );
  }
  return mergeParts(parts);
}

function buildHalluxGeo(legHex: number): THREE.BufferGeometry {
  return mergeParts([
    taperedTube(
      [
        [0, 0, 0],
        [0, 0.002, -0.036],
        [0, -0.003, -0.068],
      ],
      0.009,
      0.006,
      legHex,
      8,
      6
    ),
    taperedTube(
      [
        [0, -0.003, -0.068],
        [0, -0.005, -0.081],
        [0, -0.008, -0.090],
      ],
      0.0054,
      0.0018,
      0x242024,
      6,
      6
    ),
  ]);
}

function buildSpeciesAssets(pal: SpeciesPalette): CachedSpeciesAssets {
  if (!_sharedBirdMat) {
    _sharedBirdMat = createPastelMaterial({ vertexColors: true, rimStrength: 0.095 });
  }
  if (!_sharedCatchlightMat) {
    _sharedCatchlightMat = createUnlitPastelFXMaterial(0xffffff, 0.95, false);
  }

  const torsoMat = createBirdTorsoPlumageMaterial(pal);
  const headMat = createBirdHeadPlumageMaterial(pal);

  // --- 1. Smooth C1 Torso Hull (plumage gradient evaluated per-pixel in torsoMat) ---
  const torsoHull = loftOrganicHull(
    [
      { t: -0.43, offsetCenter: 0.042, rx: 0.022, rPlus: 0.018, rMinus: 0.018 },
      { t: -0.35, offsetCenter: 0.036, rx: 0.094, rPlus: 0.070, rMinus: 0.074, powerPlus: 0.90 },
      { t: -0.23, offsetCenter: 0.028, rx: 0.178, rPlus: 0.128, rMinus: 0.150, powerPlus: 0.88, powerMinus: 1.02 },
      { t: -0.09, offsetCenter: 0.030, rx: 0.240, rPlus: 0.160, rMinus: 0.210, powerPlus: 0.86, powerMinus: 1.06 },
      { t: 0.05, offsetCenter: 0.044, rx: 0.252, rPlus: 0.170, rMinus: 0.232, powerPlus: 0.88, powerMinus: 1.08 },
      { t: 0.16, offsetCenter: 0.078, rx: 0.216, rPlus: 0.154, rMinus: 0.184, powerPlus: 0.90, powerMinus: 1.04 },
      { t: 0.235, offsetCenter: 0.146, rx: 0.150, rPlus: 0.120, rMinus: 0.114 },
      { t: 0.268, offsetCenter: 0.186, rx: 0.064, rPlus: 0.054, rMinus: 0.050 },
    ],
    64,
    pal.breast,
    { subdivideAxial: 7, bottomAO: 0, topLift: 0 }
  );
  torsoHull.deleteAttribute('color');
  const bodyGeo = transformGeo(torsoHull, { scale: pal.bodyScale });

  // --- 2. Smooth C1 Avian Skull Loft (per-pixel headMat) + Separate Eye/Cere Detail Mesh ---
  const hs = pal.headScale;
  const skullHull = loftOrganicHull(
    [
      { t: -0.192 * hs, offsetCenter: -0.016 * hs, rx: 0.046 * hs, rPlus: 0.046 * hs, rMinus: 0.046 * hs },
      { t: -0.140 * hs, offsetCenter: -0.008 * hs, rx: 0.138 * hs, rPlus: 0.134 * hs, rMinus: 0.126 * hs, powerPlus: 0.88 },
      { t: -0.048 * hs, offsetCenter: 0.005 * hs, rx: 0.176 * hs, rPlus: 0.168 * hs, rMinus: 0.156 * hs, powerPlus: 0.86 },
      { t: 0.046 * hs, offsetCenter: 0.006 * hs, rx: 0.164 * hs, rPlus: 0.154 * hs, rMinus: 0.142 * hs, powerPlus: 0.88 },
      { t: 0.124 * hs, offsetCenter: -0.002 * hs, rx: 0.118 * hs, rPlus: 0.108 * hs, rMinus: 0.098 * hs },
      { t: 0.178 * hs, offsetCenter: -0.004 * hs, rx: 0.048 * hs, rPlus: 0.044 * hs, rMinus: 0.038 * hs },
    ],
    64,
    pal.breast,
    { subdivideAxial: 7, bottomAO: 0, topLift: 0 }
  );
  skullHull.deleteAttribute('color');
  const headGeo = skullHull;

  const headDetailParts: THREE.BufferGeometry[] = [];
  const eyeRadius = (pal.isPigeon ? 0.033 : 0.034) * hs;
  const catchlightParts: THREE.BufferGeometry[] = [];

  for (const sx of [-1, 1] as const) {
    const eyeYaw = -sx * 0.40;
    const eyeRoll = -sx * 0.10;
    const eyePos: [number, number, number] = [sx * 0.129 * hs, 0.034 * hs, 0.068 * hs];

    headDetailParts.push(
      transformGeo(
        smoothSphere(
          eyeRadius * 1.09,
          pal.isPigeon ? 0xe88b38 : 0x2a1f1c,
          24,
          18,
          [0.72, 1.0, 1.0],
          { bottomAO: 0, topLift: 0.03 }
        ),
        {
          rot: [0, eyeYaw, eyeRoll],
          pos: [sx * 0.125 * hs, 0.034 * hs, 0.066 * hs],
        }
      ),
      transformGeo(
        smoothSphere(
          eyeRadius * 1.02,
          pal.isPigeon ? 0xf2a144 : 0x462b1c,
          24,
          18,
          [0.82, 1.0, 1.0],
          { bottomAO: 0, topLift: 0.04 }
        ),
        {
          rot: [0, eyeYaw, eyeRoll],
          pos: [sx * 0.127 * hs, 0.034 * hs, 0.067 * hs],
        }
      ),
      transformGeo(
        smoothSphere(
          eyeRadius,
          0x121016,
          26,
          20,
          [0.90, 1.0, 1.0],
          { bottomAO: 0, topLift: 0.0 }
        ),
        {
          rot: [0, eyeYaw, eyeRoll],
          pos: eyePos,
        }
      )
    );

    const rxC = eyeRadius * 0.90;
    const u1Len = Math.hypot(0.84, 0.40, 0.36);
    const u1x = (sx * 0.84) / u1Len;
    const u1y = 0.40 / u1Len;
    const u1z = 0.36 / u1Len;

    const u2Len = Math.hypot(0.88, -0.26, -0.34);
    const u2x = (sx * 0.88) / u2Len;
    const u2y = -0.26 / u2Len;
    const u2z = -0.34 / u2Len;

    const localCatchlights = mergeParts([
      transformGeo(
        smoothSphere(eyeRadius * 0.22, 0xffffff, 14, 10, [0.32, 0.94, 0.94]),
        {
          pos: [u1x * rxC * 0.99, u1y * eyeRadius * 0.99, u1z * eyeRadius * 0.99],
        }
      ),
      transformGeo(
        smoothSphere(eyeRadius * 0.10, 0xffffff, 10, 8, [0.32, 0.92, 0.92]),
        {
          pos: [u2x * rxC * 0.99, u2y * eyeRadius * 0.99, u2z * eyeRadius * 0.99],
        }
      ),
    ]);

    catchlightParts.push(
      transformGeo(localCatchlights, {
        rot: [0, eyeYaw, eyeRoll],
        pos: eyePos,
      })
    );
  }

  if (pal.isPigeon) {
    headDetailParts.push(
      loftOrganicHull(
        [
          { t: 0.152 * hs, offsetCenter: 0.024 * hs, rx: 0.034 * hs, rPlus: 0.024 * hs, rMinus: 0.010 * hs },
          { t: 0.182 * hs, offsetCenter: 0.022 * hs, rx: 0.032 * hs, rPlus: 0.022 * hs, rMinus: 0.008 * hs },
          { t: 0.205 * hs, offsetCenter: 0.016 * hs, rx: 0.012 * hs, rPlus: 0.010 * hs, rMinus: 0.005 * hs },
        ],
        20,
        0xf4f0e8,
        { subdivideAxial: 2, topLift: 0.08 }
      )
    );
  }

  const headDetailsGeo = mergeParts(headDetailParts);
  const catchlightGeo = mergeParts(catchlightParts);

  const bL = pal.isPigeon ? 0.158 * hs : 0.132 * hs;
  const bW = pal.isPigeon ? 0.030 * hs : 0.044 * hs;
  const bH = pal.isPigeon ? 0.026 * hs : 0.038 * hs;
  const cBeakUpper = new THREE.Color(pal.beakUpper);
  const cBeakLower = new THREE.Color(pal.beakLower);
  const cHornBase = new THREE.Color(0x9a8570);

  const upperBeakGeo = loftOrganicHull(
    [
      { t: 0.0, offsetCenter: 0.0, rx: bW, rPlus: bH, rMinus: 0.004 * hs, powerPlus: 1.12 },
      { t: bL * 0.44, offsetCenter: -0.002 * hs, rx: bW * 0.70, rPlus: bH * 0.72, rMinus: 0.003 * hs, powerPlus: 1.16 },
      { t: bL * 0.80, offsetCenter: -0.008 * hs, rx: bW * 0.32, rPlus: bH * 0.34, rMinus: 0.002 * hs, powerPlus: 1.20 },
      { t: bL, offsetCenter: -0.013 * hs, rx: 0.003 * hs, rPlus: 0.003 * hs, rMinus: 0.002 * hs },
    ],
    26,
    (pos, _n, u, out) => {
      out.copy(cBeakUpper);
      if (!pal.isPigeon) {
        const baseHorn = (1.0 - smoothBand(0.05, 0.45, u)) * smoothBand(0.014 * hs, -0.002 * hs, pos.y);
        if (baseHorn > 0.001) out.lerp(cHornBase, baseHorn * 0.55);
      }
      return out;
    },
    { subdivideAxial: 3, bottomAO: 0.07, topLift: 0.08 }
  );

  const lowerBeakGeo = loftOrganicHull(
    [
      { t: 0.0, offsetCenter: 0.0, rx: bW * 0.84, rPlus: 0.003 * hs, rMinus: bH * 0.68, powerMinus: 1.12 },
      { t: bL * 0.42, offsetCenter: 0.002 * hs, rx: bW * 0.56, rPlus: 0.002 * hs, rMinus: bH * 0.48, powerMinus: 1.15 },
      { t: bL * 0.84, offsetCenter: 0.003 * hs, rx: 0.003 * hs, rPlus: 0.002 * hs, rMinus: 0.003 * hs },
    ],
    24,
    (_pos, _n, u, out) => {
      out.copy(cBeakLower);
      if (!pal.isPigeon) {
        const baseHorn = 1.0 - smoothBand(0.08, 0.58, u);
        if (baseHorn > 0.001) out.lerp(cHornBase, baseHorn * 0.62);
      }
      return out;
    },
    { subdivideAxial: 3, bottomAO: 0.12 }
  );

  // --- 3. Wings ---
  const leftWings = buildWingGeometriesForSide(-1, pal);
  const rightWings = buildWingGeometriesForSide(1, pal);

  // --- 4. 7-Feather Notched Tail ---
  const tailFeatherShape = new THREE.Shape();
  tailFeatherShape.moveTo(0, 0.02);
  tailFeatherShape.bezierCurveTo(0.046, -0.08, 0.052, -0.30, 0.025, -0.45);
  tailFeatherShape.bezierCurveTo(0.0, -0.47, -0.0, -0.47, -0.025, -0.45);
  tailFeatherShape.bezierCurveTo(-0.052, -0.30, -0.046, -0.08, 0, 0.02);

  const tailFeatherGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const norm = i - 3.0;
    const absNorm = Math.abs(norm);
    const isOuter = absNorm >= 2.0;
    const col = isOuter ? pal.tailOuter : pal.tailMain;
    const lenScale = (0.94 + absNorm * 0.028) * (pal.isPigeon ? 1.15 : 1.0);
    const fg = transformGeo(
      extrudeShape(tailFeatherShape, 0.012, 0.0055, col, 8, { topLift: 0.06 }),
      {
        scale: [1.0, lenScale, 1.0],
        rot: [Math.PI * 0.5, 0, 0],
        pos: [0, 0, -0.02],
      }
    );
    tailFeatherGeos.push(fg);
  }

  // --- 5. Hindlimbs & Merged Left/Right Foot Geometries ---
  const thighGeo = loftOrganicHull(
    [
      { t: 0.020, offsetCenter: 0.004, rx: 0.034, rPlus: 0.036, rMinus: 0.034 },
      { t: -0.038, offsetCenter: -0.010, rx: 0.029, rPlus: 0.031, rMinus: 0.030 },
      { t: -0.092, offsetCenter: -0.028, rx: 0.021, rPlus: 0.022, rMinus: 0.022 },
      { t: -0.132, offsetCenter: -0.046, rx: 0.014, rPlus: 0.015, rMinus: 0.015 },
    ],
    16,
    (pos) => (pos.y < -0.088 ? pal.leg : pal.breast),
    { axis: 'y', bottomAO: 0.20, topLift: 0.0 }
  );

  const tarsusGeo = mergeParts([
    smoothSphere(0.016, pal.leg, 10, 8),
    taperedTube(
      [
        [0, 0, 0],
        [0, -0.072, 0.036],
        [0, -0.142, 0.070],
      ],
      0.0145,
      0.0115,
      pal.leg,
      10,
      8,
      { bottomAO: 0.10 }
    ),
  ]);

  const footSoleGeo = buildFootSoleGeo(pal.leg);
  const leftFrontToesGeo = buildFrontToesGeo(-1, pal.leg);
  const rightFrontToesGeo = buildFrontToesGeo(1, pal.leg);
  const halluxGeo = buildHalluxGeo(pal.leg);

  return {
    mat: _sharedBirdMat,
    torsoMat,
    headMat,
    catchlightMat: _sharedCatchlightMat,
    bodyGeo,
    headGeo,
    headDetailsGeo,
    catchlightGeo,
    upperBeakGeo,
    lowerBeakGeo,
    wingLeftInnerGeo: leftWings.innerGeo,
    wingLeftOuterGeo: leftWings.outerGeo,
    wingRightInnerGeo: rightWings.innerGeo,
    wingRightOuterGeo: rightWings.outerGeo,
    tailFeatherGeos,
    thighGeo,
    tarsusGeo,
    footSoleGeo,
    leftFrontToesGeo,
    rightFrontToesGeo,
    halluxGeo,
  };
}

function getOrBuildSpeciesAssets(pal: SpeciesPalette, species: BirdSpecies): CachedSpeciesAssets {
  let cached = _speciesAssetCache.get(species);
  if (!cached) {
    cached = buildSpeciesAssets(pal);
    _speciesAssetCache.set(species, cached);
  }
  return cached;
}

const THIGH_LEN = Math.hypot(0.13, 0.046);
const THIGH_PHI = Math.atan2(-0.046, 0.13);
const TARSUS_LEN = Math.hypot(0.142, 0.07);
const TARSUS_PHI = Math.atan2(0.07, 0.142);

interface SolvedLegIK {
  hipX: number;
  hockX: number;
  footX: number;
}

const _ikScratchL: SolvedLegIK = { hipX: 0, hockX: 0, footX: 0 };
const _ikScratchR: SolvedLegIK = { hipX: 0, hockX: 0, footX: 0 };

/**
 * Songbird & city pigeon character rig:
 * - Per-species cache of shared `BufferGeometry` & per-pixel TSL plumage `NodeMaterial`s
 * - Asymmetric cross-section lofted keeled sternum, dorsal mantle, S-curved neck & tapered pygostyle
 * - Lofted avian skull with curved culmen/gonys bill & 2 eyes with 2 catchlights each
 * - Analytic 2-bone hindlimb IK keeps feet planted during idle breathing, crouching & pecking
 */
export class SparrowMesh {
  public readonly root = new THREE.Group();
  public readonly bodyPivot = new THREE.Group();
  public readonly headPivot = new THREE.Group();
  public readonly upperBeakPivot = new THREE.Group();
  public readonly lowerBeakPivot = new THREE.Group();
  public readonly beakHoldAnchor = new THREE.Object3D();

  public readonly wingLeftInner = new THREE.Group();
  public readonly wingLeftOuter = new THREE.Group();
  public readonly wingRightInner = new THREE.Group();
  public readonly wingRightOuter = new THREE.Group();
  public readonly wingTipLeft = new THREE.Object3D();
  public readonly wingTipRight = new THREE.Object3D();

  public readonly tailPivot = new THREE.Group();
  public readonly tailFeathers: THREE.Mesh[] = [];

  public readonly leftLegRig: AvianLegRig;
  public readonly rightLegRig: AvianLegRig;
  public readonly crownGroup = new THREE.Group();

  private readonly palette: SpeciesPalette;
  private readonly bodyMesh: THREE.Mesh;
  private mat: THREE.NodeMaterial;
  private crownEquipped = false;

  constructor(species: BirdSpecies) {
    this.palette = resolveSpeciesPalette(species);
    const pal = this.palette;
    const assets = getOrBuildSpeciesAssets(pal, species);
    this.mat = assets.mat;

    this.root.add(this.bodyPivot);

    // 1. Torso (per-pixel TSL plumage shader)
    this.bodyMesh = new THREE.Mesh(assets.bodyGeo, assets.torsoMat);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyPivot.add(this.bodyMesh);

    // 2. Head, Eyes, Catchlights & Beak
    const headBaseY = pal.isPigeon ? 0.295 : 0.208 * pal.bodyScale[1];
    const headBaseZ = pal.isPigeon ? 0.224 : 0.184 * pal.bodyScale[2];
    this.headPivot.position.set(0, headBaseY, headBaseZ);
    this.bodyPivot.add(this.headPivot);

    const headMesh = new THREE.Mesh(assets.headGeo, assets.headMat);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    this.headPivot.add(headMesh);

    const headDetailsMesh = new THREE.Mesh(assets.headDetailsGeo, this.mat);
    this.headPivot.add(headDetailsMesh);

    const catchlightMesh = new THREE.Mesh(assets.catchlightGeo, assets.catchlightMat);
    this.headPivot.add(catchlightMesh);

    const hs = pal.headScale;
    this.upperBeakPivot.position.set(0, 0.007 * hs, 0.158 * hs);
    this.lowerBeakPivot.position.set(0, -0.007 * hs, 0.153 * hs);
    this.headPivot.add(this.upperBeakPivot, this.lowerBeakPivot);

    const upperBeakMesh = new THREE.Mesh(assets.upperBeakGeo, this.mat);
    upperBeakMesh.castShadow = true;
    const lowerBeakMesh = new THREE.Mesh(assets.lowerBeakGeo, this.mat);
    lowerBeakMesh.castShadow = false;
    this.upperBeakPivot.add(upperBeakMesh);
    this.lowerBeakPivot.add(lowerBeakMesh);

    this.beakHoldAnchor.position.set(0, -0.006, 0.28 * hs);
    this.headPivot.add(this.beakHoldAnchor);

    // Tiny golden coronation crown seated snugly atop the skull crest (hidden until 12/12 deeds complete)
    if (species === 'sparrow') {
      const crownAssets = getOrBuildRoyalCrownAssets();
      const crownMesh = new THREE.Mesh(crownAssets.geo, crownAssets.mat);
      crownMesh.castShadow = true;
      crownMesh.receiveShadow = false;
      this.crownGroup.position.set(0, 0.150 * hs, -0.006 * hs);
      this.crownGroup.rotation.set(0.085, 0, 0);
      this.crownGroup.visible = false;
      this.crownGroup.add(crownMesh);
      this.headPivot.add(this.crownGroup);
    }

    // 3. Wings
    this.attachWing(
      -1,
      this.wingLeftInner,
      this.wingLeftOuter,
      this.wingTipLeft,
      assets.wingLeftInnerGeo,
      assets.wingLeftOuterGeo
    );
    this.attachWing(
      1,
      this.wingRightInner,
      this.wingRightOuter,
      this.wingTipRight,
      assets.wingRightInnerGeo,
      assets.wingRightOuterGeo
    );

    // 4. Tail
    this.tailPivot.position.set(0, 0.042 * pal.bodyScale[1], -0.355 * pal.bodyScale[2]);
    this.bodyPivot.add(this.tailPivot);

    for (let i = 0; i < 7; i++) {
      const norm = i - 3.0;
      const absNorm = Math.abs(norm);
      const fm = new THREE.Mesh(assets.tailFeatherGeos[i], this.mat);
      fm.castShadow = i % 2 === 1;
      fm.rotation.y = norm * 0.042;
      fm.position.y = -absNorm * 0.003;
      this.tailPivot.add(fm);
      this.tailFeathers.push(fm);
    }

    // 5. Articulated Legs + Sole, Front Toes & Opposing Hallux Pivots
    this.leftLegRig = this.attachArticulatedLeg(-1, new THREE.Group(), assets, assets.leftFrontToesGeo);
    this.rightLegRig = this.attachArticulatedLeg(1, new THREE.Group(), assets, assets.rightFrontToesGeo);
  }

  public static createStandaloneCrownMesh(): THREE.Group {
    const group = new THREE.Group();
    const crownAssets = getOrBuildRoyalCrownAssets();
    const mesh = new THREE.Mesh(crownAssets.geo, crownAssets.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
    return group;
  }

  public setCrownEquipped(equipped: boolean): void {
    this.crownEquipped = equipped;
    this.crownGroup.visible = equipped;
  }

  public isCrownEquipped(): boolean {
    return this.crownEquipped;
  }

  public setCrownScale(scale: number): void {
    this.crownGroup.scale.setScalar(scale);
  }

  private attachWing(
    side: -1 | 1,
    innerGroup: THREE.Group,
    outerGroup: THREE.Group,
    tipAnchor: THREE.Object3D,
    innerGeo: THREE.BufferGeometry,
    outerGeo: THREE.BufferGeometry
  ): void {
    const pal = this.palette;
    const bs = pal.bodyScale;
    innerGroup.rotation.order = 'YXZ';
    innerGroup.position.set(side * 0.136 * bs[0], 0.068 * bs[1], 0.028 * bs[2]);
    this.bodyPivot.add(innerGroup);

    const innerMesh = new THREE.Mesh(innerGeo, this.mat);
    innerMesh.castShadow = true;
    innerGroup.add(innerMesh);

    outerGroup.position.set(side * 0.22 * bs[0], 0, -0.016 * bs[2]);
    innerGroup.add(outerGroup);

    const outerMesh = new THREE.Mesh(outerGeo, this.mat);
    outerMesh.castShadow = true;
    outerGroup.add(outerMesh);

    tipAnchor.position.set(side * 0.40 * (pal.isPigeon ? 1.18 : 1.0), 0, -0.05);
    outerGroup.add(tipAnchor);
  }

  private attachArticulatedLeg(
    side: -1 | 1,
    hipPivot: THREE.Group,
    assets: CachedSpeciesAssets,
    frontToesGeo: THREE.BufferGeometry
  ): AvianLegRig {
    const bs = this.palette.bodyScale;

    hipPivot.position.set(side * 0.088 * bs[0], -0.095 * bs[1], -0.026 * bs[2]);
    this.bodyPivot.add(hipPivot);

    const thighMesh = new THREE.Mesh(assets.thighGeo, this.mat);
    thighMesh.castShadow = false;
    hipPivot.add(thighMesh);

    const hockPivot = new THREE.Group();
    hockPivot.position.set(0, -0.130, -0.046);
    hipPivot.add(hockPivot);

    const tarsusMesh = new THREE.Mesh(assets.tarsusGeo, this.mat);
    tarsusMesh.castShadow = false;
    hockPivot.add(tarsusMesh);

    const footPivot = new THREE.Group();
    footPivot.position.set(0, -0.142, 0.070);
    hockPivot.add(footPivot);

    const soleMesh = new THREE.Mesh(assets.footSoleGeo, this.mat);
    soleMesh.castShadow = false;
    footPivot.add(soleMesh);

    const frontToesPivot = new THREE.Group();
    frontToesPivot.position.set(0, -0.004, 0.008);
    footPivot.add(frontToesPivot);

    const frontToesMesh = new THREE.Mesh(frontToesGeo, this.mat);
    frontToesMesh.castShadow = false;
    frontToesPivot.add(frontToesMesh);

    const halluxPivot = new THREE.Group();
    halluxPivot.position.set(0, -0.004, -0.008);
    footPivot.add(halluxPivot);

    const halluxMesh = new THREE.Mesh(assets.halluxGeo, this.mat);
    halluxMesh.castShadow = false;
    halluxPivot.add(halluxMesh);

    return { hipPivot, hockPivot, footPivot, frontToesPivot, halluxPivot };
  }

  private applyLegJointPose(
    rig: AvianLegRig,
    dt: number,
    rate: number,
    hipX: number,
    hockX: number,
    footX: number,
    frontToesX: number,
    halluxX: number,
    hipZ = 0
  ): void {
    const a = Math.min(1, dt * rate);
    const baseHipY = -0.095 * this.palette.bodyScale[1];
    rig.hipPivot.position.y += (baseHipY - rig.hipPivot.position.y) * a;
    rig.hipPivot.rotation.x += (hipX - rig.hipPivot.rotation.x) * a;
    rig.hipPivot.rotation.z += (hipZ - rig.hipPivot.rotation.z) * a;
    rig.hockPivot.rotation.x += (hockX - rig.hockPivot.rotation.x) * a;
    rig.footPivot.rotation.x += (footX - rig.footPivot.rotation.x) * a;
    rig.footPivot.rotation.z -= rig.footPivot.rotation.z * a;
    rig.frontToesPivot.rotation.x += (frontToesX - rig.frontToesPivot.rotation.x) * a;
    rig.halluxPivot.rotation.x += (halluxX - rig.halluxPivot.rotation.x) * a;
  }

  /**
   * Solves exact analytical 2-bone avian hindlimb IK (intertarsal hock bending backward `-Z`)
   * so `footPivot` remains locked at `(targetFootY, targetFootZ)` in `root` space while
   * `bodyPivot` breathes, dips, crouches, pecks, eats, or cushions a landing.
   */
  private solvePlantedLegIK(
    rig: AvianLegRig,
    targetFootY: number,
    targetFootZ: number,
    hipLiftY: number,
    slopeZ: number,
    out: SolvedLegIK
  ): SolvedLegIK {
    const baseHipY = -0.095 * this.palette.bodyScale[1];
    const localHipX = rig.hipPivot.position.x * this.bodyPivot.scale.x;
    const localHipY = (baseHipY + hipLiftY) * this.bodyPivot.scale.y;
    const localHipZ = rig.hipPivot.position.z * this.bodyPivot.scale.z;

    const rz = this.bodyPivot.rotation.z;
    const rx = this.bodyPivot.rotation.x;
    const hyAfterZ = localHipX * Math.sin(rz) + localHipY * Math.cos(rz);
    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);

    const hipRootY = this.bodyPivot.position.y + hyAfterZ * cosX - localHipZ * sinX;
    const hipRootZ = this.bodyPivot.position.z + hyAfterZ * sinX + localHipZ * cosX;

    const u = targetFootZ - hipRootZ;
    const v = hipRootY - targetFootY;
    const minD = Math.abs(THIGH_LEN - TARSUS_LEN) + 0.002;
    const maxD = THIGH_LEN + TARSUS_LEN - 0.0008;
    const d = Math.max(minD, Math.min(maxD, Math.hypot(u, v)));

    const gamma = Math.atan2(u, v);
    const cosBeta1 = Math.max(
      -1,
      Math.min(1, (THIGH_LEN * THIGH_LEN + d * d - TARSUS_LEN * TARSUS_LEN) / (2 * THIGH_LEN * d))
    );
    const cosBeta12 = Math.max(
      -1,
      Math.min(
        1,
        (THIGH_LEN * THIGH_LEN + TARSUS_LEN * TARSUS_LEN - d * d) / (2 * THIGH_LEN * TARSUS_LEN)
      )
    );

    const alpha1 = gamma - Math.acos(cosBeta1);
    const alpha2 = alpha1 + (Math.PI - Math.acos(cosBeta12));
    const theta1 = THIGH_PHI - alpha1;
    const theta2 = TARSUS_PHI - alpha2;

    out.hipX = theta1 - rx;
    out.hockX = theta2 - theta1;
    out.footX = -theta2 - Math.atan(slopeZ);
    return out;
  }

  private applyPlantedLegIKImmediate(
    rig: AvianLegRig,
    ik: SolvedLegIK,
    dt: number,
    frontToesX: number,
    halluxX: number,
    footZ: number,
    hipLiftY: number
  ): void {
    const baseHipY = -0.095 * this.palette.bodyScale[1];
    rig.hipPivot.position.y = baseHipY + hipLiftY;
    rig.hipPivot.rotation.x = ik.hipX;
    rig.hipPivot.rotation.z = 0;
    rig.hockPivot.rotation.x = ik.hockX;
    rig.footPivot.rotation.x = ik.footX;
    rig.footPivot.rotation.z = footZ;
    const toeLerp = Math.min(1, dt * 32);
    rig.frontToesPivot.rotation.x += (frontToesX - rig.frontToesPivot.rotation.x) * toeLerp;
    rig.halluxPivot.rotation.x += (halluxX - rig.halluxPivot.rotation.x) * toeLerp;
  }

  /**
   * Computes 5-stage passerine hop kinematics for `hopPhase` in `0..1`
   * into the caller-provided `out` struct (avoids per-frame allocation).
   */
  private computeHopKinematics(phase: number, out: HopKinematics): HopKinematics {
    if (phase <= 0.005) {
      out.bodyY = 0;
      out.hipX = 0.0;
      out.hockX = 0.0;
      out.footX = 0.0;
      out.frontToesX = 0.0;
      out.halluxX = 0.0;
      return out;
    }

    if (phase < 0.18) {
      const u = Math.sin((phase / 0.18) * Math.PI * 0.5);
      const hip = -0.22 * u;
      const hock = -0.36 * u;
      out.bodyY = -0.016 * u;
      out.hipX = hip;
      out.hockX = hock;
      out.footX = -(hip + hock) + 0.06 * u;
      out.frontToesX = -0.04 * u;
      out.halluxX = 0.03 * u;
      return out;
    }

    if (phase < 0.36) {
      const u = (phase - 0.18) / 0.18;
      out.bodyY = -0.016 * (1 - u) + 0.19 * u;
      out.hipX = -0.22 * (1 - u) + 0.36 * u;
      out.hockX = -0.36 * (1 - u) + 0.42 * u;
      out.footX = 0.64 * (1 - u) + 0.46 * u;
      out.frontToesX = 0.32 * u;
      out.halluxX = -0.24 * u;
      return out;
    }

    if (phase < 0.68) {
      const u = Math.sin(((phase - 0.36) / 0.32) * Math.PI);
      const lin = (phase - 0.36) / 0.32;
      out.bodyY = 0.19 + 0.065 * u - 0.04 * lin;
      out.hipX = 0.36 * (1 - lin) - 0.48 * lin;
      out.hockX = 0.42 * (1 - u) - 0.62 * u;
      out.footX = 0.46 * (1 - u) + 0.52 * u;
      out.frontToesX = 0.32 + 0.50 * u;
      out.halluxX = -0.24 - 0.48 * u;
      return out;
    }

    if (phase < 0.88) {
      const u = (phase - 0.68) / 0.20;
      out.bodyY = 0.15 * (1 - u) + 0.01 * u;
      out.hipX = -0.48 * (1 - u) - 0.34 * u;
      out.hockX = -0.25 * (1 - u) + 0.16 * u;
      out.footX = 0.32 * (1 - u) + 0.12 * u;
      out.frontToesX = 0.40 * (1 - u) - 0.30 * u;
      out.halluxX = -0.35 * (1 - u) + 0.18 * u;
      return out;
    }

    const u = (phase - 0.88) / 0.12;
    const cushion = Math.sin(u * Math.PI);
    const hip = -0.30 * (1 - u) - 0.10 * cushion;
    const hock = 0.14 * (1 - u) - 0.20 * cushion;
    out.bodyY = -0.012 * cushion;
    out.hipX = hip;
    out.hockX = hock;
    out.footX = -(hip + hock) * u + 0.06 * u;
    out.frontToesX = -0.24 * (1 - u);
    out.halluxX = 0.14 * (1 - u);
    return out;
  }

  /**
   * Alternating bipedal gait kinematics for walking City Pigeons (`legPhase` in `0..1`)
   * into the caller-provided `out` struct (avoids per-frame allocation).
   */
  private computePigeonWalkLeg(legPhase: number, out: PigeonLegKinematics): PigeonLegKinematics {
    const p = ((legPhase % 1) + 1) % 1;
    if (p < 0.52) {
      const u = p / 0.52;
      const hip = -0.34 + u * 0.68;
      const hock = 0.12 * Math.sin(u * Math.PI);
      out.hipX = hip;
      out.hockX = hock;
      out.footX = -(hip + hock) + (u > 0.72 ? (u - 0.72) * 1.1 : 0);
      out.frontToesX = u > 0.75 ? 0.25 : 0.0;
      out.halluxX = 0.0;
      return out;
    }
    const u = (p - 0.52) / 0.48;
    const lift = Math.sin(u * Math.PI);
    const curl = u < 0.65 ? Math.sin((u / 0.65) * Math.PI) * 0.68 : -(u - 0.65) * 0.65;
    out.hipX = 0.34 * (1 - u) - 0.34 * u - 0.18 * lift;
    out.hockX = -0.58 * lift;
    out.footX = 0.42 * lift;
    out.frontToesX = curl;
    out.halluxX = -curl * 0.75;
    return out;
  }

  public updatePose(p: SparrowPoseInput): void {
    const dt = Math.min(0.05, p.dt);
    const bonk = p.bonkPhase ?? 0;
    const dizzyState = p.dizzyState ?? 'none';
    const dizzyPhase = p.dizzyPhase ?? 0;

    // --- Special 3-Stage Dizzy Knockout Pose Machine ---
    if (dizzyState !== 'none') {
      this.bodyMesh.scale.set(1, 1, 1);
      this.bodyPivot.position.z = 0;
      this.headPivot.position.set(0, 0.17, 0.25);

      if (dizzyState === 'falling') {
        this.upperBeakPivot.rotation.x = -0.28;
        this.lowerBeakPivot.rotation.x = 0.34;
        this.bodyPivot.scale.set(1.04, 1.04, 0.96);
        this.bodyPivot.position.y = 0;
        this.bodyPivot.rotation.z = Math.sin(p.elapsed * 19.0) * 0.62;
        this.bodyPivot.rotation.x +=
          (-0.34 + Math.cos(p.elapsed * 14.0) * 0.22 - this.bodyPivot.rotation.x) * Math.min(1, dt * 10);

        this.headPivot.rotation.set(
          Math.sin(p.elapsed * 14.0) * 0.28,
          Math.cos(p.elapsed * 11.0) * 0.36,
          Math.sin(p.elapsed * 16.0) * 0.42
        );

        const flailL = 0.35 + Math.sin(p.elapsed * 26.0) * 0.62;
        const flailR = 0.35 + Math.cos(p.elapsed * 24.0) * 0.62;
        this.wingLeftInner.rotation.set(0.32, -0.18, -flailL);
        this.wingRightInner.rotation.set(0.32, 0.18, flailR);
        this.wingLeftOuter.rotation.set(0, 0, -0.22);
        this.wingRightOuter.rotation.set(0, 0, 0.22);

        this.tailPivot.rotation.set(-0.36, 0, Math.sin(p.elapsed * 18) * 0.22);
        for (let idx = 0; idx < this.tailFeathers.length; idx++) {
          this.tailFeathers[idx].rotation.y = (idx - 3.0) * 0.15;
        }

        const kick = Math.sin(p.elapsed * 28.0);
        this.applyLegJointPose(this.leftLegRig, dt, 24, 0.15 + kick * 0.45, -0.35 + kick * 0.3, 0.2, 0.45, -0.35);
        this.applyLegJointPose(this.rightLegRig, dt, 24, 0.15 - kick * 0.45, -0.35 - kick * 0.3, 0.2, 0.45, -0.35);
        return;
      }

      if (dizzyState === 'grounded') {
        this.upperBeakPivot.rotation.x = -0.18;
        this.lowerBeakPivot.rotation.x = 0.24;

        this.bodyPivot.position.y += (-0.11 - this.bodyPivot.position.y) * Math.min(1, dt * 16);
        this.bodyPivot.scale.set(1.12, 0.88, 1.05);
        this.bodyPivot.rotation.x += (-0.12 - this.bodyPivot.rotation.x) * Math.min(1, dt * 14);
        this.bodyPivot.rotation.z +=
          (0.24 + Math.sin(p.elapsed * 4.5) * 0.10 - this.bodyPivot.rotation.z) * Math.min(1, dt * 14);

        const lollA = p.elapsed * 6.2;
        this.headPivot.rotation.set(
          -0.08 + Math.cos(lollA) * 0.22,
          Math.sin(lollA) * 0.38,
          Math.sin(lollA) * 0.44
        );

        this.wingLeftInner.rotation.set(0.18, -0.78, -0.26);
        this.wingRightInner.rotation.set(0.18, 0.78, 0.26);
        this.wingLeftOuter.rotation.set(0, -0.14, -0.08);
        this.wingRightOuter.rotation.set(0, 0.14, 0.08);

        this.tailPivot.rotation.set(0.12, 0, 0);
        for (let idx = 0; idx < this.tailFeathers.length; idx++) {
          this.tailFeathers[idx].rotation.y = (idx - 3.0) * 0.14;
        }

        this.applyLegJointPose(this.leftLegRig, dt, 18, -0.45, -0.55, 0.65, 0.35, -0.25, -0.28);
        this.applyLegJointPose(this.rightLegRig, dt, 18, -0.38, -0.48, 0.55, 0.35, -0.25, 0.28);
        return;
      }

      if (dizzyState === 'shaking') {
        const env = Math.sin(dizzyPhase * Math.PI);
        const puff = 0.24 * env;
        this.bodyPivot.scale.set(1 + puff, 1 + puff * 0.7, 1 - puff * 0.35);
        this.bodyPivot.position.y = env * 0.06;
        this.bodyPivot.rotation.x = -0.08;
        this.bodyPivot.rotation.z = Math.sin(p.elapsed * 56.0) * 0.34 * env;

        this.headPivot.rotation.set(
          -0.08,
          Math.sin(p.elapsed * 52.0) * 0.48 * env,
          Math.cos(p.elapsed * 58.0) * 0.58 * env
        );

        const flick = Math.abs(Math.sin(p.elapsed * 48.0)) * 0.55 * env;
        this.wingLeftInner.rotation.set(0.12, -1.25 + flick, 0.18 - flick);
        this.wingRightInner.rotation.set(0.12, 1.25 - flick, -0.18 + flick);
        this.wingLeftOuter.rotation.set(0, -0.22, 0.05);
        this.wingRightOuter.rotation.set(0, 0.22, -0.05);

        this.tailPivot.rotation.set(0.24 + env * 0.22, 0, Math.sin(p.elapsed * 46.0) * 0.2 * env);
        for (let idx = 0; idx < this.tailFeathers.length; idx++) {
          this.tailFeathers[idx].rotation.y = (idx - 3.0) * (0.05 + env * 0.15);
        }

        this.applyLegJointPose(this.leftLegRig, dt, 20, -0.10, -0.15, 0.25, 0.0, 0.0, -0.08);
        this.applyLegJointPose(this.rightLegRig, dt, 20, -0.10, -0.15, 0.25, 0.0, 0.0, 0.08);
        return;
      }
    }

    // --- Normal Songbird / Pigeon Articulation ---
    const peck = Math.max(0, Math.min(1, p.peckPhase ?? 0));
    const peckU = 1.0 - peck;
    const peckStrike =
      peck > 0.001
        ? peckU < 0.36
          ? Math.sin((peckU / 0.36) * Math.PI * 0.5)
          : Math.max(0, Math.cos(((peckU - 0.36) / 0.64) * Math.PI * 0.5))
        : 0;
    const peckBillOpen =
      peck > 0.001 && peckU < 0.32 ? Math.sin((peckU / 0.32) * Math.PI) * 0.55 : 0;

    // Breadcrumb eating sequence: scale down deep dip when carrying a prop so held items never clip floor
    const eat = Math.max(0, Math.min(1, p.eatPhase ?? 0));
    const eatU = 1.0 - eat;
    const dipScale = p.carryingItem ? 0.18 : 1.0;
    const eatDip =
      (eat > 0.001
        ? eatU < 0.52
          ? Math.sin((eatU / 0.52) * Math.PI)
          : Math.sin(((eatU - 0.52) / 0.48) * Math.PI) * 0.28
        : 0) * dipScale;
    const eatChew =
      eat > 0.001 ? Math.abs(Math.sin(eatU * Math.PI * 5.8)) * (1.0 - eatU * 0.35) * 0.52 : 0;

    const beakGap = Math.max(
      p.chirpOpen * 0.44,
      peckBillOpen,
      eatChew,
      bonk * 0.32,
      p.carryingItem ? 0.18 : 0.0
    );
    this.upperBeakPivot.rotation.x = -beakGap * 0.62;
    this.lowerBeakPivot.rotation.x = beakGap * 0.84;

    const vy = p.verticalVel ?? 0;
    const descent =
      p.mode === 'flying' && !p.isBraking
        ? Math.max(
            0,
            Math.min(1, Math.max((-vy - 0.35) / 10.5, Math.max(0, p.pitchAngle - 0.05) * 1.1))
          )
        : 0;

    const idleTilt =
      p.mode !== 'flying' ? Math.sin(p.elapsed * 2.4) * 0.06 + Math.sin(p.elapsed * 6.1) * 0.02 : 0;
    const bonkYawShake = bonk > 0 ? Math.sin(bonk * Math.PI * 6.0) * 0.42 * bonk : 0;
    const bonkRollShake = bonk > 0 ? Math.cos(bonk * Math.PI * 7.0) * 0.48 * bonk : 0;

    const pigeonBobZ =
      this.palette.isPigeon && p.mode !== 'flying' && p.hopPhase > 0.005
        ? Math.sin(p.hopPhase * Math.PI * 4.0) * 0.058
        : 0;
    const baseHeadZ = this.palette.isPigeon ? 0.224 : 0.184 * this.palette.bodyScale[2];
    const baseHeadY = this.palette.isPigeon ? 0.295 : 0.208 * this.palette.bodyScale[1];
    this.headPivot.position.x = 0;
    this.headPivot.position.z = baseHeadZ + pigeonBobZ + peckStrike * 0.092 + eatDip * 0.105;
    this.headPivot.position.y = baseHeadY - peckStrike * 0.032 - eatDip * 0.072;

    const descentHeadStabilize = -descent * 0.34;
    const targetHeadPitch =
      p.headLookLocal.y - bonk * 0.18 + descentHeadStabilize + peckStrike * 0.32 + eatDip * 0.58;

    this.headPivot.rotation.y +=
      (p.headLookLocal.x + bonkYawShake - this.headPivot.rotation.y) * Math.min(1, dt * 14);
    this.headPivot.rotation.x +=
      (targetHeadPitch - this.headPivot.rotation.x) *
      Math.min(1, dt * (peck > 0.01 || eat > 0.01 ? 30 : 14));
    this.headPivot.rotation.z =
      idleTilt + p.bankAngle * 0.22 + bonkRollShake + (p.introHeadRoll ?? 0);

    // Keep bodyPivot scale strictly (1, 1, 1) so child leg/wing bones never stretch; puff torso mesh only
    this.bodyPivot.scale.set(1, 1, 1);
    if (bonk > 0.001) {
      const puff = Math.sin(bonk * Math.PI) * 0.18;
      this.bodyMesh.scale.set(1 + puff, 1 + puff * 0.55, 1 - puff * 0.65);
    } else {
      this.bodyMesh.scale.set(1, 1, 1);
    }

    if (p.mode === 'flying') {
      this.bodyPivot.rotation.z += (p.bankAngle * 0.68 - this.bodyPivot.rotation.z) * Math.min(1, dt * 10);
      const targetPitch =
        bonk > 0.1
          ? -0.38 * bonk
          : p.isBraking
            ? -0.46
            : p.pitchAngle * 0.78 + descent * 0.16 + peckStrike * 0.26;
      this.bodyPivot.rotation.x += (targetPitch - this.bodyPivot.rotation.x) * Math.min(1, dt * 11);
      this.bodyPivot.position.y = 0;
      this.bodyPivot.position.z = peckStrike * 0.085;

      const tuck = bonk > 0.05 ? 0 : (p.wingTuck ?? 0);
      const wingLerp = Math.min(1, dt * 18);

      if (tuck > 0.55 && !p.isBraking && descent < 0.18 && p.flapTimer <= 0) {
        const boundRipple = Math.sin(p.elapsed * 22.0) * 0.035;
        this.wingLeftInner.rotation.x += (-0.44 - this.wingLeftInner.rotation.x) * wingLerp;
        this.wingLeftInner.rotation.y += (-1.38 + boundRipple - this.wingLeftInner.rotation.y) * wingLerp;
        this.wingLeftInner.rotation.z += (0.15 - this.wingLeftInner.rotation.z) * wingLerp;

        this.wingRightInner.rotation.x += (-0.44 - this.wingRightInner.rotation.x) * wingLerp;
        this.wingRightInner.rotation.y += (1.38 - boundRipple - this.wingRightInner.rotation.y) * wingLerp;
        this.wingRightInner.rotation.z += (-0.15 - this.wingRightInner.rotation.z) * wingLerp;

        this.wingLeftOuter.rotation.set(0, -0.22, 0.04);
        this.wingRightOuter.rotation.set(0, 0.22, -0.04);
      } else {
        let stroke = 0;
        let outerFlex = 0;
        let sweepBack = 0;
        let outerSweep = 0;
        let wingPitch = 0.07;

        if (bonk > 0.05) {
          stroke = 0.45 + Math.sin(bonk * Math.PI * 8.0) * 0.52;
          outerFlex = 0.28;
          wingPitch = 0.48;
        } else if (p.flapTimer > 0) {
          const flutterHz = p.elapsed * Math.PI * 2.0 * 15.2;
          stroke = Math.sin(flutterHz) * 0.94;
          outerFlex = Math.cos(flutterHz) * 0.44;
          sweepBack = descent * 0.22;
        } else if (p.isBraking) {
          stroke = 0.32 + Math.sin(p.elapsed * 32) * 0.48;
          outerFlex = 0.26;
          wingPitch = 0.48;
        } else if (descent > 0.04) {
          const windHz = 24.0 + descent * 14.0;
          const windFlutter =
            Math.sin(p.elapsed * windHz) * (0.068 + descent * 0.125) +
            Math.sin(p.elapsed * 41.0) * (0.032 * descent);
          stroke = 0.18 + descent * 0.36 + windFlutter;
          outerFlex =
            -0.06 +
            descent * 0.24 +
            Math.cos(p.elapsed * windHz) * (0.085 + descent * 0.14);
          sweepBack = descent * 0.74;
          outerSweep = descent * 0.44;
          wingPitch = 0.06 - descent * 0.22;
        } else {
          const soarWave = Math.sin(p.elapsed * 12.5) * 0.055;
          stroke = 0.14 + soarWave;
          outerFlex = -0.08 + Math.cos(p.elapsed * 12.5) * 0.05;
        }

        this.wingLeftInner.rotation.set(wingPitch, 0.05 - sweepBack, -stroke);
        this.wingRightInner.rotation.set(wingPitch, -0.05 + sweepBack, stroke);
        this.wingLeftOuter.rotation.set(0, -outerSweep, -outerFlex);
        this.wingRightOuter.rotation.set(0, outerSweep, outerFlex);
      }

      const fanSpread =
        bonk > 0.05
          ? 0.17
          : p.isBraking
            ? 0.14
            : descent > 0.08
              ? 0.072 + descent * 0.065 + Math.abs(p.bankAngle) * 0.04
              : tuck > 0.55
                ? 0.028
                : 0.065 + Math.abs(p.bankAngle) * 0.04;
      const tailWindTrim = descent > 0.05 ? Math.sin(p.elapsed * 29.0) * 0.05 * descent : 0;
      this.tailPivot.rotation.x =
        p.isBraking || bonk > 0.1
          ? -0.44
          : -0.05 - p.pitchAngle * 0.26 - descent * 0.20 + tailWindTrim;
      this.tailPivot.rotation.z = -p.bankAngle * 0.28;
      for (let idx = 0; idx < this.tailFeathers.length; idx++) {
        this.tailFeathers[idx].rotation.y = (idx - 3.0) * fanSpread;
      }

      if (p.isBraking || bonk > 0.15) {
        this.applyLegJointPose(this.leftLegRig, dt, 16, -0.42, 0.22, 0.10, -0.34, 0.22, -0.08);
        this.applyLegJointPose(this.rightLegRig, dt, 16, -0.42, 0.22, 0.10, -0.34, 0.22, 0.08);
      } else {
        this.applyLegJointPose(this.leftLegRig, dt, 15, -0.58, -1.08, 1.15, 0.92, -0.82, 0.04);
        this.applyLegJointPose(this.rightLegRig, dt, 15, -0.58, -1.08, 1.15, 0.92, -0.82, -0.04);
      }
      return;
    }

    // --- Grounded Hop / Pigeon Walk / Perched Grip + Exact 2-Bone Planted Leg IK ---
    const bs = this.palette.bodyScale;
    const breathe = Math.sin(p.elapsed * 3.4) * 0.015 + Math.sin(p.elapsed * 1.7) * 0.004;
    const settleOffset = p.perchSettleOffset ?? 0;
    const arrival = Math.max(0, Math.min(1, p.perchArrival ?? 0));
    const bonkHop = bonk > 0 ? Math.sin(bonk * Math.PI) * 0.032 : 0;
    const peckPitch = peckStrike * 0.38 + eatDip * 0.52;
    this.bodyPivot.position.z = peckStrike * 0.095 + eatDip * 0.085;

    if (this.palette.isPigeon && p.hopPhase > 0.005) {
      const bob = Math.abs(Math.sin(p.hopPhase * Math.PI * 2.0)) * 0.032;
      this.bodyPivot.position.y = bob + breathe + bonkHop - peckStrike * 0.025 - eatDip * 0.038;
      this.bodyPivot.rotation.z = Math.sin(p.hopPhase * Math.PI * 2.0) * 0.065;
      this.bodyPivot.rotation.x = -0.06 - bonk * 0.15 + peckPitch;

      const leftK = this.computePigeonWalkLeg(p.hopPhase, _pigeonLeftK);
      const rightK = this.computePigeonWalkLeg((p.hopPhase + 0.5) % 1.0, _pigeonRightK);
      this.applyLegJointPose(
        this.leftLegRig,
        dt,
        24,
        leftK.hipX,
        leftK.hockX,
        leftK.footX,
        leftK.frontToesX,
        leftK.halluxX
      );
      this.applyLegJointPose(
        this.rightLegRig,
        dt,
        24,
        rightK.hipX,
        rightK.hockX,
        rightK.footX,
        rightK.frontToesX,
        rightK.halluxX
      );
    } else if (p.hopPhase > 0.005) {
      const hopK = this.computeHopKinematics(p.hopPhase, _hopK);
      this.bodyPivot.position.y = hopK.bodyY + breathe + bonkHop - peckStrike * 0.025 - eatDip * 0.042;
      this.bodyPivot.rotation.z *= 0.82;
      const pitchShift =
        p.hopPhase < 0.2
          ? 0.08
          : p.hopPhase < 0.65
            ? -0.18
            : 0.05;
      this.bodyPivot.rotation.x +=
        (-0.08 + pitchShift - bonk * 0.18 + peckPitch - this.bodyPivot.rotation.x) *
        Math.min(1, dt * (eat > 0.01 ? 26 : 18));

      this.applyLegJointPose(
        this.leftLegRig,
        dt,
        28,
        hopK.hipX,
        hopK.hockX,
        hopK.footX,
        hopK.frontToesX,
        hopK.halluxX,
        -0.03
      );
      this.applyLegJointPose(
        this.rightLegRig,
        dt,
        28,
        hopK.hipX * 0.97,
        hopK.hockX * 0.97,
        hopK.footX,
        hopK.frontToesX,
        hopK.halluxX,
        0.03
      );
    } else if (p.mode === 'perched') {
      const slopeX = p.perchSlopeX ?? 0;
      const slopeZ = p.perchSlopeZ ?? 0;
      const latSpan = 0.088 * bs[0];
      const liftR = Math.max(-0.056, Math.min(0.056, latSpan * slopeX));
      const footRollZ = Math.atan(slopeX);
      const grip = Math.max(0, Math.min(1, p.perchGrip ?? 0.85));
      const frontCurl = 0.08 + grip * 0.56;
      const halluxCurl = -0.05 - grip * 0.54;
      const perchedFootYBase = -0.095 * bs[1] - 0.250;
      const perchedFootZ = -0.026 * bs[2] + 0.114 + grip * 0.017;

      const targetBodyY = -0.026 + breathe + settleOffset + bonkHop - peckStrike * 0.026 - eatDip * 0.036;
      if (arrival > 0.001) {
        const u = 1.0 - arrival;
        const settleIn = smoothBand(0.15, 1.0, u);
        this.bodyPivot.position.y = targetBodyY * settleIn;
        this.bodyPivot.rotation.z = p.bankAngle * 0.62 * (1.0 - settleIn);
        const flarePitch = p.pitchAngle * 0.72 * (1.0 - settleIn) + (-0.09 + peckPitch) * settleIn;
        this.bodyPivot.rotation.x += (flarePitch - this.bodyPivot.rotation.x) * Math.min(1, dt * 26);

        const ikL = this.solvePlantedLegIK(
          this.leftLegRig,
          perchedFootYBase - liftR,
          perchedFootZ,
          -liftR,
          slopeZ,
          _ikScratchL
        );
        const ikR = this.solvePlantedLegIK(
          this.rightLegRig,
          perchedFootYBase + liftR,
          perchedFootZ,
          liftR,
          slopeZ,
          _ikScratchR
        );

        const plantW = smoothBand(0.44, 0.96, u);
        const gripW = smoothBand(0.56, 1.0, u);
        const reachHipX = -0.52;
        const reachHockX = 0.24;
        const reachFootX = 0.16;
        const curFront = -0.32 * (1.0 - gripW) + frontCurl * gripW;
        const curHallux = 0.24 * (1.0 - gripW) + halluxCurl * gripW;

        const baseHipY = -0.095 * bs[1];
        this.leftLegRig.hipPivot.position.y = baseHipY - liftR * plantW;
        this.leftLegRig.hipPivot.rotation.x = reachHipX * (1.0 - plantW) + ikL.hipX * plantW;
        this.leftLegRig.hipPivot.rotation.z = -0.06 * (1.0 - plantW);
        this.leftLegRig.hockPivot.rotation.x = reachHockX * (1.0 - plantW) + ikL.hockX * plantW;
        this.leftLegRig.footPivot.rotation.x = reachFootX * (1.0 - plantW) + ikL.footX * plantW;
        this.leftLegRig.footPivot.rotation.z = footRollZ * plantW;
        this.leftLegRig.frontToesPivot.rotation.x = curFront;
        this.leftLegRig.halluxPivot.rotation.x = curHallux;

        this.rightLegRig.hipPivot.position.y = baseHipY + liftR * plantW;
        this.rightLegRig.hipPivot.rotation.x = reachHipX * (1.0 - plantW) + ikR.hipX * plantW;
        this.rightLegRig.hipPivot.rotation.z = 0.06 * (1.0 - plantW);
        this.rightLegRig.hockPivot.rotation.x = reachHockX * (1.0 - plantW) + ikR.hockX * plantW;
        this.rightLegRig.footPivot.rotation.x = reachFootX * (1.0 - plantW) + ikR.footX * plantW;
        this.rightLegRig.footPivot.rotation.z = footRollZ * plantW;
        this.rightLegRig.frontToesPivot.rotation.x = curFront;
        this.rightLegRig.halluxPivot.rotation.x = curHallux;
      } else {
        this.bodyPivot.position.y += (targetBodyY - this.bodyPivot.position.y) * Math.min(1, dt * 24);
        this.bodyPivot.rotation.z = 0;
        this.bodyPivot.rotation.x +=
          (-0.09 - bonk * 0.18 + peckPitch - this.bodyPivot.rotation.x) *
          Math.min(1, dt * (peck > 0.01 || eat > 0.01 ? 30 : 22));

        const ikL = this.solvePlantedLegIK(
          this.leftLegRig,
          perchedFootYBase - liftR,
          perchedFootZ,
          -liftR,
          slopeZ,
          _ikScratchL
        );
        const ikR = this.solvePlantedLegIK(
          this.rightLegRig,
          perchedFootYBase + liftR,
          perchedFootZ,
          liftR,
          slopeZ,
          _ikScratchR
        );
        this.applyPlantedLegIKImmediate(
          this.leftLegRig,
          ikL,
          dt,
          frontCurl,
          halluxCurl,
          footRollZ,
          -liftR
        );
        this.applyPlantedLegIKImmediate(
          this.rightLegRig,
          ikR,
          dt,
          frontCurl,
          halluxCurl,
          footRollZ,
          liftR
        );
      }
    } else {
      const targetBodyY = -0.018 + breathe + settleOffset + bonkHop - peckStrike * 0.024 - eatDip * 0.045;
      this.bodyPivot.position.y += (targetBodyY - this.bodyPivot.position.y) * Math.min(1, dt * 20);
      this.bodyPivot.rotation.z = 0;
      this.bodyPivot.rotation.x +=
        (-0.07 - bonk * 0.18 + peckPitch - this.bodyPivot.rotation.x) *
        Math.min(1, dt * (peck > 0.01 || eat > 0.01 ? 26 : 14));

      const groundedFootY = -0.095 * bs[1] - 0.262;
      const groundedFootZ = -0.026 * bs[2] + 0.072;
      const ikL = this.solvePlantedLegIK(
        this.leftLegRig,
        groundedFootY,
        groundedFootZ,
        0,
        0,
        _ikScratchL
      );
      const ikR = this.solvePlantedLegIK(
        this.rightLegRig,
        groundedFootY,
        groundedFootZ,
        0,
        0,
        _ikScratchR
      );
      this.applyPlantedLegIKImmediate(this.leftLegRig, ikL, dt, 0.0, 0.0, 0.0, 0.0);
      this.applyPlantedLegIKImmediate(this.rightLegRig, ikR, dt, 0.0, 0.0, 0.0, 0.0);
    }

    const hopArc = Math.sin(p.hopPhase * Math.PI);
    const hopFlick = hopArc * 0.16 + bonk * 0.52 + peckStrike * 0.28 + eatDip * 0.22;
    const foldX = -0.48 + hopFlick * 0.35;
    const foldYL = -1.46 + hopFlick;
    const foldZL = 0.16 - hopFlick * 0.5;

    const flareW =
      p.mode === 'perched' && arrival > 0.001
        ? 1.0 - smoothBand(0.14, 0.92, 1.0 - arrival)
        : 0.0;
    if (flareW > 0.001) {
      const flareStroke = 0.34 + Math.sin(p.elapsed * 30.0) * 0.36;
      const flareOuter = 0.22;
      this.wingLeftInner.rotation.set(
        0.44 * flareW + foldX * (1.0 - flareW),
        0.06 * flareW + foldYL * (1.0 - flareW),
        -flareStroke * flareW + foldZL * (1.0 - flareW)
      );
      this.wingRightInner.rotation.set(
        0.44 * flareW + foldX * (1.0 - flareW),
        -0.06 * flareW - foldYL * (1.0 - flareW),
        flareStroke * flareW - foldZL * (1.0 - flareW)
      );
      this.wingLeftOuter.rotation.set(0, -0.22 * (1.0 - flareW), -flareOuter * flareW + 0.04 * (1.0 - flareW));
      this.wingRightOuter.rotation.set(0, 0.22 * (1.0 - flareW), flareOuter * flareW - 0.04 * (1.0 - flareW));
    } else {
      this.wingLeftInner.rotation.set(foldX, foldYL, foldZL);
      this.wingRightInner.rotation.set(foldX, -foldYL, -foldZL);
      this.wingLeftOuter.rotation.set(0, -0.22, 0.04);
      this.wingRightOuter.rotation.set(0, 0.22, -0.04);
    }

    const tailBob =
      Math.sin(p.elapsed * 4.4) * 0.042 + hopArc * 0.24 + bonk * 0.35 + peckStrike * 0.28 + eatDip * 0.32;
    const perchedTailX = 0.20 + tailBob;
    this.tailPivot.rotation.x = -0.38 * flareW + perchedTailX * (1.0 - flareW);
    this.tailPivot.rotation.z = -p.bankAngle * 0.24 * flareW;
    const fan = 0.040 + flareW * 0.105 + bonk * 0.13 + peckStrike * 0.06 + eatDip * 0.05;
    for (let idx = 0; idx < this.tailFeathers.length; idx++) {
      this.tailFeathers[idx].rotation.y = (idx - 3.0) * fan;
    }
  }
}
