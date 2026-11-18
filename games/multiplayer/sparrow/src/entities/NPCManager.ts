import * as THREE from 'three/webgpu';
import type * as CANNON from 'cannon-es';
import { PALETTE } from '../rendering/Palette.ts';
import { createPastelMaterial } from '../rendering/StorybookMaterial.ts';
import {
  rbox,
  rcyl,
  smoothSphere,
  extrudeShape,
  loftOrganicHull,
  type LoftStation,
  transformGeo,
  mergeParts,
  buildAcousticGuitarGeometry,
  buildEyeglassesGeometry,
  buildBaguetteGeometry,
} from '../geometry/Sculptor.ts';
import { createPerchQueryResult, type PerchSystem } from '../world/PerchSystem.ts';
import {
  COLLISION_GROUP_STATIC,
  COLLISION_GROUP_KINEMATIC,
  createGroundRaycastHit,
  type PhysicsWorld,
  type InteractiveProp,
  type PropKind,
} from '../physics/PhysicsWorld.ts';
import type { AcousticSoundtrack } from '../audio/AcousticSoundtrack.ts';
import type { WorldFX } from '../rendering/WorldFX.ts';
import { SparrowMesh } from './SparrowMesh.ts';
import { isInsideAtelier } from '../world/AtelierBounds.ts';
import type { CompanionBirdSpec } from '../world/NPCManifest.ts';

export type HumanHatStyle = 'none' | 'sunhat' | 'chef_toque' | 'beret' | 'fedora' | 'newsboy';
export type HumanHairStyle = 'waves' | 'bob' | 'bun' | 'curls' | 'short';
export type HumanPropKind =
  | 'none'
  | 'briefcase'
  | 'baguette_bag'
  | 'book'
  | 'palette_brush'
  | 'bouquet'
  | 'sketchpad'
  | 'coffee_cup';
export type HumanIdleActivity =
  | 'none'
  | 'reading'
  | 'sketching'
  | 'browsing'
  | 'tending'
  | 'conversing'
  | 'watching_water';

export interface GiantHumanConfig {
  id: string;
  position: THREE.Vector3;
  yaw: number;
  seated: boolean;
  skinHex: number;
  coatHex: number;
  trouserHex: number;
  hairHex: number;
  scarfHex?: number;
  hatStyle?: HumanHatStyle;
  hairStyle?: HumanHairStyle;
  apron?: boolean;
  guitar?: boolean;
  heldProp?: HumanPropKind;
  idleActivity?: HumanIdleActivity;
  walkSpeed?: number;
  patrolWaypoints?: THREE.Vector3[];
  seatHipY?: number;
  seatHipRotX?: number;
  seatKneeRotX?: number;
}

interface HumanArmRig {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  wrist?: THREE.Group;
}

interface HumanLegRig {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
}

interface GiantHumanInstance {
  config: GiantHumanConfig;
  root: THREE.Group;
  yaw: number;
  homePos: THREE.Vector3;
  baseHipY: number;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  armLeft: HumanArmRig;
  armRight: HumanArmRig;
  legLeft: HumanLegRig;
  legRight: HumanLegRig;
  hatAnchor: THREE.Object3D;
  shoulderLeftAnchor: THREE.Object3D;
  shoulderRightAnchor: THREE.Object3D;
  hatWorldPos: THREE.Vector3;
  shoulderLWorldPos: THREE.Vector3;
  shoulderRWorldPos: THREE.Vector3;
  headWorldPos: THREE.Vector3;
  perchDirty: boolean;
  colliderBody: CANNON.Body;
  glassesMesh?: THREE.Mesh;
  guitarPivot?: THREE.Group;
  lookAtTimer: number;
  lookTarget: THREE.Vector3;
  celebrateTimer: number;
  waveTimer: number;
  startleTimer: number;
  curiousTimer: number;
  shooTimer: number;
  chaseTarget: THREE.Vector3;
  hasChaseTarget: boolean;
  stationaryMoving: boolean;
  drowsy: boolean;
  searchingBlindly: boolean;
  strumming: boolean;
  paintingActive: boolean;
  voicePitch: number;
  waypointIdx: number;
  waypointPauseTimer: number;
  gaitPhase: number;
  idlePhase: number;
  seedCooldown: number;
  steerFrameOffset: number;
  cachedSteerDir: THREE.Vector3;
  cachedSteerBlocked: boolean;
  hasCachedSteer: boolean;
}

export interface CompanionBird {
  id: string;
  mesh: SparrowMesh;
  homePos: THREE.Vector3;
  targetPos: THREE.Vector3;
  sanctuaryPos: THREE.Vector3;
  tintHex: number;
  voiceIndex: number;
  echoTimer: number;
  echoIsPlayerReply?: boolean;
  beaconTimer: number;
  chirpAnimTimer?: number;
  flutterGreetTimer?: number;
  jostleCooldown?: number;
  thermalSurfTimer?: number;
  bathTimer?: number;
  bathRippleAccum?: number;
  bathCooldown?: number;
  bathSpot?: THREE.Vector3;
  inspectProp?: InteractiveProp | null;
  inspectTimer?: number;
  inspectChirpDone?: boolean;
  inspectSpot?: THREE.Vector3;
  flocking: boolean;
  flockSlot: THREE.Vector3;
  flockHoverY?: number;
  hasFlownToSquare?: boolean;
  demoHopping?: boolean;
  ambientWaypoints?: THREE.Vector3[];
  ambientWaitTimer?: number;
  ambientWpIdx?: number;
}

interface ParkPigeon {
  mesh: SparrowMesh;
  forageHome: THREE.Vector3;
  forageTarget: THREE.Vector3;
  scatterPerch: THREE.Vector3;
  scatteredTimer: number;
  wanderTimer: number;
  cooTimer: number;
  phase: number;
  foodTargetProp: InteractiveProp | null;
  nibbleTimer: number;
  nibbleCrumbAccum: number;
  bathTimer: number;
  bathRippleAccum: number;
  bathCooldown: number;
  bathSpot: THREE.Vector3;
  jostleCooldown: number;
}

const WALK_RAY_MASK = COLLISION_GROUP_STATIC | COLLISION_GROUP_KINEMATIC;
const STEER_LATERAL_OFFSETS: readonly number[] = [0, -0.68, 0.68];
const STEER_HEIGHT_OFFSETS: readonly number[] = [0.95, 3.15];
const STEER_CANDIDATE_ANGLES: readonly number[] = [0.42, -0.42, 0.84, -0.84, 1.24, -1.24];

const _perchQueryScratch = createPerchQueryResult();

const _down = new THREE.Vector3(0, -1, 0);
const _probeStart = new THREE.Vector3();
const _steerOrigin = new THREE.Vector3();
const _steerCand = new THREE.Vector3();
const _groundProbeOrigin = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _localLook = new THREE.Vector3();
const _fxPos = new THREE.Vector3();
const _tossOrigin = new THREE.Vector3();
const _tossFwd = new THREE.Vector3();
const _pigeonProbe = new THREE.Vector3();
const _toDest = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _companionDesired = new THREE.Vector3();
const _pigeonHeadLook = new THREE.Vector2();
const _companionHeadLook = new THREE.Vector2();
const _dropRaycaster = new THREE.Raycaster();
const _dropRayDir = new THREE.Vector3();
const _dropSegVec = new THREE.Vector3();
const _dropToPt = new THREE.Vector3();
const _dropClosest = new THREE.Vector3();
const _dropHeadCenter = new THREE.Vector3();
const _dropTorsoCenter = new THREE.Vector3();
const _dropSnapOrigin = new THREE.Vector3();
const _dropSnapDir = new THREE.Vector3();
const _dropNormalMat = new THREE.Matrix3();
const _dropIntersects: THREE.Intersection[] = [];

const _snapGroundHit = createGroundRaycastHit();
const _steerHit = createGroundRaycastHit();
const _humanGroundHit = createGroundRaycastHit();
const _pigeonHit = createGroundRaycastHit();

// --- Shared Cached Human Geometry & Material Registry ---
let _sharedHumanMat: THREE.NodeMaterial | null = null;
const _torsoGeoCache = new Map<string, THREE.BufferGeometry>();
const _headGeoCache = new Map<string, THREE.BufferGeometry>();
const _upperArmGeoCache = new Map<string, THREE.BufferGeometry>();
const _foreArmGeoCache = new Map<string, THREE.BufferGeometry>();
const _guitaristSleeveGeoCache = new Map<string, THREE.BufferGeometry>();
const _guitaristHandGeoCache = new Map<string, THREE.BufferGeometry>();
const _thighGeoCache = new Map<number, THREE.BufferGeometry>();
const _shinGeoCache = new Map<number, THREE.BufferGeometry>();
let _shoeGeo: THREE.BufferGeometry | null = null;
let _eyeglassesGeo: THREE.BufferGeometry | null = null;
let _guitarGeo: THREE.BufferGeometry | null = null;

function getSharedHumanMaterial(): THREE.NodeMaterial {
  if (!_sharedHumanMat) {
    _sharedHumanMat = createPastelMaterial({ vertexColors: true, rimStrength: 0.08 });
  }
  return _sharedHumanMat;
}

function getCachedTorsoGeometry(
  coatHex: number,
  scarfHex: number,
  apron: boolean
): THREE.BufferGeometry {
  const key = `${coatHex}_${scarfHex}_${apron ? 1 : 0}`;
  const cached = _torsoGeoCache.get(key);
  if (cached) return cached;

  const coatC = new THREE.Color(coatHex);
  const coatDark = coatC.clone().multiplyScalar(0.84);
  const torsoStations: LoftStation[] = [
    { t: -0.26, rx: 0.04, rPlus: 0.04, rMinus: 0.04 },
    { t: -0.18, rx: 1.02, rPlus: 0.7, rMinus: 0.74 },
    { t: 0.42, rx: 0.98, rPlus: 0.66, rMinus: 0.7 },
    { t: 1.12, rx: 0.86, rPlus: 0.58, rMinus: 0.58, scallopLobes: 4, scallopAmp: 0.02 },
    { t: 2.05, rx: 1.02, rPlus: 0.72, rMinus: 0.64 },
    { t: 2.86, rx: 1.12, rPlus: 0.68, rMinus: 0.64 },
    { t: 3.22, rx: 0.84, rPlus: 0.52, rMinus: 0.52 },
    { t: 3.36, rx: 0.42, rPlus: 0.36, rMinus: 0.36 },
    { t: 3.4, rx: 0.03, rPlus: 0.03, rMinus: 0.03 },
  ];
  const torsoTmp = new THREE.Color();
  const torsoParts: THREE.BufferGeometry[] = [
    loftOrganicHull(
      torsoStations,
      20,
      (pos) => {
        torsoTmp.copy(coatC);
        if (pos.y < 0.35) torsoTmp.lerp(coatDark, 0.35);
        if (pos.z > 0.38 && pos.y > 2.15 && Math.abs(pos.x) < (pos.y - 2.05) * 0.32) {
          return scarfHex;
        }
        return torsoTmp.getHex();
      },
      { axis: 'y' }
    ),
  ];

  torsoParts.push(
    transformGeo(rcyl(0.5, 0.62, 0.42, scarfHex, 18), {
      pos: [0, 3.28, 0.04],
    })
  );
  for (let b = 0; b < 3; b++) {
    torsoParts.push(
      transformGeo(rcyl(0.065, 0.065, 0.05, PALETTE.brassWarm, 10), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [0, 0.78 + b * 0.62, 0.67],
      })
    );
  }

  if (apron) {
    const apronBib = new THREE.Shape();
    apronBib.moveTo(-0.78, 1.35);
    apronBib.lineTo(0.78, 1.35);
    apronBib.quadraticCurveTo(0.92, -0.45, 0.84, -1.45);
    apronBib.lineTo(-0.84, -1.45);
    apronBib.quadraticCurveTo(-0.92, -0.45, -0.78, 1.35);
    torsoParts.push(
      transformGeo(extrudeShape(apronBib, 0.14, 0.04, PALETTE.apronCream, 8), {
        pos: [0, 1.25, 0.66],
      })
    );
  }

  const merged = mergeParts(torsoParts);
  _torsoGeoCache.set(key, merged);
  return merged;
}

function setHatAnchorOffset(hatAnchor: THREE.Object3D, hatStyle: HumanHatStyle): void {
  if (hatStyle === 'sunhat') {
    hatAnchor.position.set(0, 2.22, 0);
  } else if (hatStyle === 'chef_toque') {
    hatAnchor.position.set(0, 2.81, 0);
  } else if (hatStyle === 'beret') {
    hatAnchor.position.set(0.16, 2.07, 0);
  } else if (hatStyle === 'fedora') {
    hatAnchor.position.set(0, 2.26, 0);
  } else if (hatStyle === 'newsboy') {
    hatAnchor.position.set(0, 2.01, 0.02);
  } else {
    hatAnchor.position.set(0, 1.93, -0.02);
  }
}

function getCachedHeadGeometry(
  skinHex: number,
  hairHex: number,
  hairStyle: HumanHairStyle,
  hatStyle: HumanHatStyle
): THREE.BufferGeometry {
  const key = `${skinHex}_${hairHex}_${hairStyle}_${hatStyle}`;
  const cached = _headGeoCache.get(key);
  if (cached) return cached;

  const headParts: THREE.BufferGeometry[] = [];
  headParts.push(
    transformGeo(rcyl(0.27, 0.32, 0.48, skinHex, 14), {
      pos: [0, 0.16, -0.02],
    })
  );

  const skinC = new THREE.Color(skinHex);
  const cheekBlush = new THREE.Color(PALETTE.awningCoral).lerp(skinC, 0.58);
  const headTmp = new THREE.Color();
  const headStations: LoftStation[] = [
    { t: 0.3, rx: 0.05, rPlus: 0.05, rMinus: 0.05, offsetCenter: 0.08 },
    { t: 0.4, rx: 0.44, rPlus: 0.56, rMinus: 0.44, offsetCenter: 0.05, powerPlus: 0.86, powerMinus: 0.86 },
    { t: 0.68, rx: 0.68, rPlus: 0.76, rMinus: 0.68, offsetCenter: 0.02, powerPlus: 0.88, powerMinus: 0.88 },
    { t: 1.02, rx: 0.76, rPlus: 0.8, rMinus: 0.8 },
    { t: 1.38, rx: 0.74, rPlus: 0.78, rMinus: 0.84 },
    { t: 1.68, rx: 0.58, rPlus: 0.66, rMinus: 0.66, offsetCenter: -0.03 },
    { t: 1.84, rx: 0.24, rPlus: 0.28, rMinus: 0.28, offsetCenter: -0.04 },
    { t: 1.88, rx: 0.03, rPlus: 0.03, rMinus: 0.03, offsetCenter: -0.04 },
  ];
  headParts.push(
    loftOrganicHull(
      headStations,
      20,
      (pos) => {
        headTmp.copy(skinC);
        if (pos.z > 0.48 && pos.y > 0.72 && pos.y < 1.06 && Math.abs(pos.x) > 0.26) {
          headTmp.lerp(cheekBlush, 0.52);
        }
        if (pos.y < 0.52) headTmp.multiplyScalar(0.92);
        return headTmp.getHex();
      },
      { axis: 'y' }
    )
  );

  const noseShape = new THREE.Shape();
  noseShape.moveTo(0, 0.2);
  noseShape.lineTo(0.22, -0.1);
  noseShape.quadraticCurveTo(0.06, -0.15, 0, -0.12);
  noseShape.closePath();
  headParts.push(
    transformGeo(extrudeShape(noseShape, 0.13, 0.035, skinHex, 5), {
      rot: [0, -Math.PI * 0.5, 0],
      pos: [0, 1.04, 0.76],
    })
  );

  const browShape = new THREE.Shape();
  browShape.moveTo(-0.14, 0);
  browShape.quadraticCurveTo(0, 0.055, 0.14, 0.01);
  browShape.quadraticCurveTo(0, 0.015, -0.14, -0.025);
  browShape.closePath();

  const earShape = new THREE.Shape();
  earShape.moveTo(0, 0.14);
  earShape.bezierCurveTo(0.11, 0.14, 0.12, -0.12, 0, -0.14);
  earShape.bezierCurveTo(-0.06, -0.1, -0.06, 0.1, 0, 0.14);

  for (const sx of [-1, 1] as const) {
    headParts.push(
      transformGeo(extrudeShape(earShape, 0.05, 0.018, skinHex, 6), {
        rot: [0, sx * 0.28, 0],
        pos: [sx * 0.74, 1.02, -0.02],
      }),
      transformGeo(rbox(0.13, 0.16, 0.09, 0.045, PALETTE.ironworkPlum), {
        pos: [sx * 0.28, 1.12, 0.75],
      }),
      transformGeo(extrudeShape(browShape, 0.04, 0.012, hairHex, 5), {
        scale: [sx, 1, 1],
        rot: [0, sx * 0.18, sx * -0.06],
        pos: [sx * 0.29, 1.28, 0.75],
      })
    );
  }

  const hairCrownStations: LoftStation[] = [
    { t: 0.72, rx: 0.68, rPlus: 0.18, rMinus: 0.84, offsetCenter: -0.12, scallopLobes: 7, scallopAmp: 0.04 },
    { t: 1.14, rx: 0.81, rPlus: 0.56, rMinus: 0.88, offsetCenter: -0.06, scallopLobes: 7, scallopAmp: 0.035 },
    { t: 1.54, rx: 0.78, rPlus: 0.78, rMinus: 0.86, offsetCenter: -0.02, scallopLobes: 6, scallopAmp: 0.03 },
    { t: 1.84, rx: 0.52, rPlus: 0.58, rMinus: 0.58, offsetCenter: -0.02 },
    { t: 1.94, rx: 0.04, rPlus: 0.04, rMinus: 0.04, offsetCenter: -0.02 },
  ];
  headParts.push(loftOrganicHull(hairCrownStations, 18, hairHex, { axis: 'y' }));

  const bangShape = new THREE.Shape();
  bangShape.moveTo(-0.56, 0.08);
  bangShape.quadraticCurveTo(0.05, 0.22, 0.58, 0.04);
  bangShape.quadraticCurveTo(0.18, -0.12, -0.56, 0.08);
  headParts.push(
    transformGeo(extrudeShape(bangShape, 0.18, 0.05, hairHex, 7), {
      rot: [0.28, 0, -0.08],
      pos: [0, 1.54, 0.68],
    })
  );

  if (hairStyle === 'bun') {
    headParts.push(
      transformGeo(rcyl(0.32, 0.36, 0.36, hairHex, 14), {
        rot: [Math.PI * 0.42, 0, 0],
        pos: [0, 1.38, -0.92],
      })
    );
  } else if (hairStyle === 'bob' || hairStyle === 'waves' || hairStyle === 'curls') {
    const lockLen = hairStyle === 'waves' ? 0.62 : hairStyle === 'curls' ? 0.54 : 0.46;
    for (const sx of [-1, 1] as const) {
      headParts.push(
        transformGeo(rbox(0.22, lockLen, 0.52, 0.08, hairHex), {
          rot: [0.06, 0, sx * -0.08],
          pos: [sx * 0.74, 0.86, -0.1],
        })
      );
    }
  }

  if (hatStyle === 'sunhat') {
    headParts.push(
      transformGeo(rcyl(1.48, 1.56, 0.11, PALETTE.croissantButter, 24), { pos: [0, 1.68, 0] }),
      transformGeo(rcyl(0.74, 0.84, 0.52, PALETTE.croissantButter, 20), { pos: [0, 1.96, 0] }),
      transformGeo(rcyl(0.8, 0.83, 0.13, PALETTE.awningCoral, 20), { pos: [0, 1.78, 0] })
    );
  } else if (hatStyle === 'chef_toque') {
    headParts.push(
      transformGeo(rcyl(0.78, 0.75, 0.56, PALETTE.porcelainWhite, 20), { pos: [0, 1.88, 0] }),
      loftOrganicHull(
        [
          { t: 2.08, rx: 0.76, rPlus: 0.76, rMinus: 0.76, scallopLobes: 8, scallopAmp: 0.05 },
          { t: 2.48, rx: 0.98, rPlus: 0.98, rMinus: 0.98, scallopLobes: 8, scallopAmp: 0.07 },
          { t: 2.74, rx: 0.62, rPlus: 0.62, rMinus: 0.62, scallopLobes: 8, scallopAmp: 0.04 },
          { t: 2.82, rx: 0.04, rPlus: 0.04, rMinus: 0.04 },
        ],
        20,
        PALETTE.porcelainWhite,
        { axis: 'y' }
      )
    );
  } else if (hatStyle === 'beret') {
    headParts.push(
      loftOrganicHull(
        [
          { t: 1.68, rx: 0.76, rPlus: 0.76, rMinus: 0.76 },
          { t: 1.84, rx: 1.02, rPlus: 0.98, rMinus: 0.98, xCenter: 0.14 },
          { t: 2.02, rx: 0.56, rPlus: 0.54, rMinus: 0.54, xCenter: 0.18 },
          { t: 2.08, rx: 0.05, rPlus: 0.05, rMinus: 0.05, xCenter: 0.18 },
        ],
        18,
        PALETTE.coatRose,
        { axis: 'y' }
      )
    );
  } else if (hatStyle === 'fedora') {
    headParts.push(
      transformGeo(rcyl(1.18, 1.24, 0.1, PALETTE.coatMustard, 22), { pos: [0, 1.7, 0] }),
      transformGeo(rcyl(0.68, 0.8, 0.56, PALETTE.coatMustard, 20), { pos: [0, 1.98, 0] }),
      transformGeo(rcyl(0.76, 0.79, 0.12, PALETTE.ironworkPlum, 20), { pos: [0, 1.79, 0] })
    );
  } else if (hatStyle === 'newsboy') {
    headParts.push(
      loftOrganicHull(
        [
          { t: 1.62, rx: 0.78, rPlus: 0.84, rMinus: 0.84, offsetCenter: 0.04 },
          { t: 1.82, rx: 0.88, rPlus: 0.92, rMinus: 0.92, offsetCenter: 0.06, scallopLobes: 6, scallopAmp: 0.03 },
          { t: 1.98, rx: 0.34, rPlus: 0.36, rMinus: 0.36, offsetCenter: 0.02 },
          { t: 2.02, rx: 0.05, rPlus: 0.05, rMinus: 0.05 },
        ],
        18,
        PALETTE.coatSlate,
        { axis: 'y' }
      ),
      transformGeo(rbox(0.96, 0.08, 0.46, 0.035, PALETTE.cobbleDark), {
        rot: [0.16, 0, 0],
        pos: [0, 1.64, 0.76],
      })
    );
  }

  const merged = mergeParts(headParts);
  _headGeoCache.set(key, merged);
  return merged;
}

function getCachedEyeglassesGeometry(): THREE.BufferGeometry {
  if (!_eyeglassesGeo) {
    _eyeglassesGeo = transformGeo(buildEyeglassesGeometry(), { scale: [0.95, 0.95, 0.95] });
  }
  return _eyeglassesGeo;
}

function getCachedGuitarGeometry(): THREE.BufferGeometry {
  if (!_guitarGeo) {
    _guitarGeo = buildAcousticGuitarGeometry();
  }
  return _guitarGeo;
}

function getCachedUpperArmGeometry(side: -1 | 1, sleeveHex: number): THREE.BufferGeometry {
  const key = `${side}_${sleeveHex}`;
  const cached = _upperArmGeoCache.get(key);
  if (cached) return cached;

  const upperParts: THREE.BufferGeometry[] = [
    transformGeo(rcyl(0.28, 0.3, 0.34, sleeveHex, 14), {
      pos: [0, -0.06, 0],
    }),
    transformGeo(rcyl(0.28, 0.24, 1.24, sleeveHex, 14), {
      rot: [0, 0, side * -0.05],
      pos: [side * 0.04, -0.64, 0],
    }),
  ];
  const merged = mergeParts(upperParts);
  _upperArmGeoCache.set(key, merged);
  return merged;
}

function getEffectiveHandProp(side: -1 | 1, heldProp: HumanPropKind): HumanPropKind {
  if (side === 1) {
    if (heldProp === 'briefcase' || heldProp === 'palette_brush' || heldProp === 'coffee_cup') {
      return heldProp;
    }
    return 'none';
  }
  if (
    heldProp === 'baguette_bag' ||
    heldProp === 'book' ||
    heldProp === 'sketchpad' ||
    heldProp === 'palette_brush' ||
    heldProp === 'bouquet'
  ) {
    return heldProp;
  }
  return 'none';
}

function getCachedGuitaristSleeveGeometry(sleeveHex: number): THREE.BufferGeometry {
  const key = `${sleeveHex}`;
  const cached = _guitaristSleeveGeoCache.get(key);
  if (cached) return cached;

  const parts: THREE.BufferGeometry[] = [
    transformGeo(rcyl(0.22, 0.22, 0.24, sleeveHex, 14), { pos: [0, -0.02, 0] }),
    transformGeo(rcyl(0.22, 0.152, 1.06, sleeveHex, 14), { pos: [0, -0.53, 0.02] }),
    transformGeo(rcyl(0.158, 0.158, 0.1, PALETTE.wallCreamTrim, 12), { pos: [0, -1.04, 0.02] }),
  ];
  const merged = mergeParts(parts);
  _guitaristSleeveGeoCache.set(key, merged);
  return merged;
}

function getCachedGuitaristHandGeometry(side: -1 | 1, skinHex: number): THREE.BufferGeometry {
  const key = `${side}_${skinHex}`;
  const cached = _guitaristHandGeoCache.get(key);
  if (cached) return cached;

  // Cozy, compact, finger-less storybook mitten/palm matching the townsfolk art style
  const handParts: THREE.BufferGeometry[] = [
    transformGeo(smoothSphere(0.125, skinHex, 12, 10, [0.84, 1.18, 0.68]), {
      rot: [-0.28, 0, 0],
      pos: [0, -0.12, 0.035],
    }),
    transformGeo(smoothSphere(0.056, skinHex, 8, 6, [0.88, 1.15, 0.85]), {
      rot: [0.22, 0, -side * 0.28],
      pos: [-side * 0.082, -0.085, 0.055],
    }),
  ];

  const merged = mergeParts(handParts);
  _guitaristHandGeoCache.set(key, merged);
  return merged;
}

function getCachedForeArmGeometry(
  side: -1 | 1,
  sleeveHex: number,
  skinHex: number,
  heldProp: HumanPropKind
): THREE.BufferGeometry {
  const effectiveProp = getEffectiveHandProp(side, heldProp);
  const key = `${side}_${sleeveHex}_${skinHex}_${effectiveProp}`;
  const cached = _foreArmGeoCache.get(key);
  if (cached) return cached;

  const foreParts: THREE.BufferGeometry[] = [
    transformGeo(rcyl(0.23, 0.23, 0.24, sleeveHex, 14), { pos: [0, -0.02, 0] }),
    transformGeo(rcyl(0.23, 0.19, 1.08, sleeveHex, 14), {
      pos: [0, -0.54, 0.02],
    }),
    transformGeo(rcyl(0.2, 0.2, 0.12, PALETTE.wallCreamTrim, 12), {
      pos: [0, -1.06, 0.02],
    }),
    transformGeo(rbox(0.24, 0.34, 0.3, 0.09, skinHex), {
      pos: [0, -1.26, 0.05],
    }),
    transformGeo(rbox(0.11, 0.18, 0.14, 0.045, skinHex), {
      rot: [0.35, 0, side * -0.35],
      pos: [-side * 0.09, -1.2, 0.18],
    }),
  ];

  if (side === 1 && effectiveProp === 'briefcase') {
    foreParts.push(
      transformGeo(rbox(0.42, 1.38, 1.82, 0.12, PALETTE.woodWalnut), {
        pos: [0.22, -2.02, 0.08],
      }),
      transformGeo(rbox(0.14, 0.26, 0.56, 0.05, PALETTE.brassWarm), {
        pos: [0.22, -1.28, 0.08],
      })
    );
  } else if (side === -1 && effectiveProp === 'baguette_bag') {
    foreParts.push(
      transformGeo(rbox(0.58, 1.18, 0.72, 0.1, PALETTE.woodBirch), {
        pos: [-0.14, -1.68, 0.14],
      }),
      transformGeo(buildBaguetteGeometry(), {
        scale: [0.58, 0.58, 0.58],
        rot: [1.32, 0.15, 0.18],
        pos: [-0.12, -1.02, 0.2],
      })
    );
  } else if (side === -1 && (effectiveProp === 'book' || effectiveProp === 'sketchpad')) {
    const coverHex = effectiveProp === 'book' ? PALETTE.berryRuby : PALETTE.woodWalnut;
    foreParts.push(
      transformGeo(rbox(0.92, 0.14, 0.74, 0.04, coverHex), {
        rot: [0.28, -0.22, 0.12],
        pos: [0.28, -1.32, 0.34],
      }),
      transformGeo(rbox(0.84, 0.11, 0.68, 0.03, PALETTE.porcelainWhite), {
        rot: [0.28, -0.22, 0.12],
        pos: [0.28, -1.27, 0.34],
      })
    );
  } else if (effectiveProp === 'palette_brush') {
    if (side === -1) {
      foreParts.push(
        transformGeo(rcyl(0.56, 0.56, 0.07, PALETTE.woodOak, 16), {
          scale: [1.22, 1, 0.88],
          rot: [0.24, 0, -0.18],
          pos: [0.24, -1.28, 0.32],
        }),
        transformGeo(rcyl(0.11, 0.13, 0.06, PALETTE.awningCoral, 10), { pos: [0.42, -1.22, 0.44] }),
        transformGeo(rcyl(0.11, 0.13, 0.06, PALETTE.birdBlueTit, 10), { pos: [0.16, -1.24, 0.52] }),
        transformGeo(rcyl(0.11, 0.13, 0.06, PALETTE.goldGlow, 10), { pos: [0.02, -1.26, 0.32] })
      );
    } else {
      foreParts.push(
        transformGeo(rcyl(0.03, 0.045, 0.96, PALETTE.woodWalnut, 8), {
          rot: [Math.PI * 0.45, 0, 0],
          pos: [0, -1.32, 0.42],
        }),
        transformGeo(rcyl(0.01, 0.05, 0.22, PALETTE.awningCoral, 8), {
          rot: [Math.PI * 0.45, 0, 0],
          pos: [0, -1.36, 0.94],
        })
      );
    }
  } else if (side === -1 && effectiveProp === 'bouquet') {
    foreParts.push(
      transformGeo(rcyl(0.42, 0.1, 0.92, PALETTE.apronCream, 14), {
        rot: [0.55, 0, -0.25],
        pos: [0.16, -1.16, 0.34],
      }),
      transformGeo(rcyl(0.22, 0.12, 0.28, PALETTE.sakuraBlush, 10), {
        rot: [0.45, 0, -0.2],
        pos: [0.22, -0.84, 0.58],
      }),
      transformGeo(rcyl(0.2, 0.11, 0.26, PALETTE.lavenderSprig, 10), {
        rot: [0.5, 0, -0.3],
        pos: [0.06, -0.88, 0.52],
      }),
      transformGeo(rcyl(0.19, 0.1, 0.25, PALETTE.goldGlow, 10), {
        rot: [0.4, 0, -0.15],
        pos: [0.28, -0.92, 0.42],
      })
    );
  } else if (side === 1 && effectiveProp === 'coffee_cup') {
    foreParts.push(
      transformGeo(rcyl(0.22, 0.17, 0.42, PALETTE.porcelainWhite, 14), {
        pos: [-0.06, -1.28, 0.26],
      })
    );
  }

  const merged = mergeParts(foreParts);
  _foreArmGeoCache.set(key, merged);
  return merged;
}

function getCachedThighGeometry(trouserHex: number): THREE.BufferGeometry {
  const cached = _thighGeoCache.get(trouserHex);
  if (cached) return cached;

  const thighParts: THREE.BufferGeometry[] = [
    transformGeo(rcyl(0.38, 0.38, 0.32, trouserHex, 14), {
      pos: [0, -0.06, 0],
    }),
    transformGeo(rcyl(0.38, 0.3, 2.28, trouserHex, 14), {
      pos: [0, -1.16, 0],
    }),
  ];
  const merged = mergeParts(thighParts);
  _thighGeoCache.set(trouserHex, merged);
  return merged;
}

function getCachedShinGeometry(trouserHex: number): THREE.BufferGeometry {
  const cached = _shinGeoCache.get(trouserHex);
  if (cached) return cached;

  const shinStations: LoftStation[] = [
    { t: -2.2, rx: 0.2, rPlus: 0.21, rMinus: 0.21 },
    { t: -1.65, rx: 0.24, rPlus: 0.25, rMinus: 0.25, offsetCenter: -0.02 },
    { t: -0.78, rx: 0.31, rPlus: 0.28, rMinus: 0.38, offsetCenter: -0.03 },
    { t: -0.12, rx: 0.29, rPlus: 0.3, rMinus: 0.3 },
    { t: 0.1, rx: 0.27, rPlus: 0.28, rMinus: 0.28 },
    { t: 0.16, rx: 0.04, rPlus: 0.04, rMinus: 0.04 },
  ];
  const geo = loftOrganicHull(shinStations, 14, trouserHex, { axis: 'y' });
  _shinGeoCache.set(trouserHex, geo);
  return geo;
}

function getCachedShoeGeometry(): THREE.BufferGeometry {
  if (!_shoeGeo) {
    const shoeStations: LoftStation[] = [
      { t: -0.34, rx: 0.04, rPlus: 0.04, rMinus: 0.04, offsetCenter: -0.22 },
      { t: -0.28, rx: 0.25, rPlus: 0.22, rMinus: 0.22, offsetCenter: -0.21, powerPlus: 0.68, powerMinus: 0.68 },
      { t: 0.06, rx: 0.27, rPlus: 0.23, rMinus: 0.23, offsetCenter: -0.2, powerPlus: 0.68, powerMinus: 0.68 },
      { t: 0.48, rx: 0.29, rPlus: 0.18, rMinus: 0.18, offsetCenter: -0.25, powerPlus: 0.68, powerMinus: 0.68 },
      { t: 0.82, rx: 0.22, rPlus: 0.13, rMinus: 0.13, offsetCenter: -0.29, powerPlus: 0.72, powerMinus: 0.72 },
      { t: 0.9, rx: 0.04, rPlus: 0.04, rMinus: 0.04, offsetCenter: -0.31 },
    ];
    _shoeGeo = loftOrganicHull(
      shoeStations,
      14,
      (pos) => (pos.y < -0.33 ? PALETTE.cobbleDark : PALETTE.ironworkPlum),
      { axis: 'z' }
    );
  }
  return _shoeGeo;
}

function poseHumanLeg(leg: HumanLegRig, phi: number): void {
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  leg.hip.rotation.x = s >= 0 ? -0.46 * s : -0.38 * s;

  const swingPeak = Math.max(0, c);
  const pushOffBend = Math.max(0, -s) * Math.max(0, c + 0.35);
  const stanceCushion = Math.max(0, -c) * 0.11;
  leg.knee.rotation.x = 0.06 + Math.pow(swingPeak, 1.35) * 0.84 + pushOffBend * 0.22 + stanceCushion;

  const heelStrike = Math.max(0, s);
  const toeOff = Math.max(0, -s);
  leg.ankle.rotation.x = -0.24 * Math.pow(heelStrike, 1.6) + 0.3 * Math.pow(toeOff, 1.4);
}

/**
 * Manages sculpted (~11.2 SU tall) multi-joint European citizens with:
 * - Non-spherical lofted heads, jawlines, wedge noses, sculpted hairstyles, tailored coats & shoes
 * - Full 3-joint legs (`hip -> knee -> ankle`) & 2-joint arms (`shoulder -> elbow -> hand`)
 * - Biomechanical inverted-pendulum walk cycles (stance/swing knee flexion, heel-strike/toe-off, pelvis bounce)
 * - Rich idle activities (reading, sketching, browsing stalls, tending flowers, watching canal boats)
 * - Player reactions (flyby startle-duck, vendor shoo, petting/curiosity crouch, hat/shoulder perch freeze-delight, chirp wave/seed-toss, peck shoo + gust)
 * - Multi-species companion songbirds & scatterable Park Pigeon Flock
 */
export class NPCManager {
  private group = new THREE.Group();
  private mat: THREE.NodeMaterial;
  public humans: Map<string, GiantHumanInstance> = new Map();
  public companions: CompanionBird[] = [];
  private pigeons: ParkPigeon[] = [];
  private pigeonScatterSeedCooldown = 0;
  private pigeonFoodScanTimer = 0;
  private buskerGrooveTimer = 0;
  private frameCounter = 0;
  public flockModeActive = false;

  public onStarterBirdAnswered?: () => void;
  public onPigeonFlockScattered?: () => void;
  public spawnSeedBurstAt?: (origin: THREE.Vector3, dir: THREE.Vector3, count: number) => void;
  public spawnFlowerGiftAt?: (origin: THREE.Vector3) => void;
  private floristGifted = false;
  private colliderToHuman = new WeakMap<CANNON.Body, GiantHumanInstance>();

  constructor(
    scene: THREE.Scene,
    private perches: PerchSystem,
    private physics: PhysicsWorld,
    private audio: AcousticSoundtrack,
    private fx: WorldFX
  ) {
    scene.add(this.group);
    this.mat = getSharedHumanMaterial();
  }

  public isBuskerGrooving(): boolean {
    return this.buskerGrooveTimer > 0;
  }

  /**
   * Guarantees NPC songbirds never float in mid-air: snaps target to nearest PerchSegment or raycast ground.
   */
  public snapBirdPositionToSurface(
    rawPos: THREE.Vector3,
    groundClearance = 0.384,
    out?: THREE.Vector3
  ): THREE.Vector3 {
    const res = out ? out.copy(rawPos) : rawPos.clone();
    const perchHit = this.perches.findNearestPerch(res, 2.8, undefined, false, _perchQueryScratch);
    if (perchHit) {
      res.copy(perchHit.worldPoint);
      res.y += groundClearance;
      return res;
    }

    _probeStart.set(res.x, res.y + 3.0, res.z);
    const groundHit = this.physics.raycastGround(
      _probeStart,
      _down,
      28.0,
      undefined,
      _snapGroundHit,
      WALK_RAY_MASK
    );
    if (groundHit.hit && groundHit.normal.y > 0.5 && groundHit.point.y >= -0.45) {
      res.y = groundHit.point.y + groundClearance;
    } else {
      const widePerch = this.perches.findNearestPerch(res, 7.5, undefined, false, _perchQueryScratch);
      if (widePerch) {
        res.copy(widePerch.worldPoint);
        res.y += groundClearance;
      }
    }
    return res;
  }

  /**
   * Snaps grounded foraging pigeons strictly to static ground surfaces (`COLLISION_GROUP_STATIC`),
   * ignoring perches so walking pigeons never levitate onto fountain rims or benches.
   */
  private snapPigeonGroundY(x: number, y: number, z: number, groundClearance = 0.408): number {
    _pigeonProbe.set(x, y + 3.0, z);
    const gHit = this.physics.raycastGround(
      _pigeonProbe,
      _down,
      28.0,
      undefined,
      _pigeonHit,
      COLLISION_GROUP_STATIC
    );
    if (gHit.hit && gHit.normal.y > 0.5) {
      return gHit.point.y + groundClearance;
    }
    return y;
  }

  private refreshHumanWorldAnchors(h: GiantHumanInstance): void {
    if (!h.perchDirty) return;
    h.root.rotation.y = h.yaw;
    h.root.updateMatrixWorld(true);
    h.hatWorldPos.setFromMatrixPosition(h.hatAnchor.matrixWorld);
    h.shoulderLWorldPos.setFromMatrixPosition(h.shoulderLeftAnchor.matrixWorld);
    h.shoulderRWorldPos.setFromMatrixPosition(h.shoulderRightAnchor.matrixWorld);
    h.headWorldPos.setFromMatrixPosition(h.headPivot.matrixWorld);
    h.perchDirty = false;
  }

  private syncHumanCollider(h: GiantHumanInstance): void {
    const colY = h.root.position.y + (h.config.seated ? 4.0 : 5.3);
    h.colliderBody.position.set(h.root.position.x, colY, h.root.position.z);
    h.colliderBody.interpolatedPosition.copy(h.colliderBody.position);
    h.colliderBody.aabbNeedsUpdate = true;
  }

  private isHumanPathClear(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    dist: number,
    ignoreBody: CANNON.Body
  ): boolean {
    const perpX = -dir.z;
    const perpZ = dir.x;
    for (let i = 0; i < STEER_LATERAL_OFFSETS.length; i++) {
      const lat = STEER_LATERAL_OFFSETS[i];
      const ox = origin.x + perpX * lat;
      const oz = origin.z + perpZ * lat;
      for (let j = 0; j < STEER_HEIGHT_OFFSETS.length; j++) {
        _steerOrigin.set(ox, origin.y + STEER_HEIGHT_OFFSETS[j], oz);
        const hit = this.physics.raycastGround(
          _steerOrigin,
          dir,
          dist,
          ignoreBody,
          _steerHit,
          WALK_RAY_MASK
        );
        if (hit.hit && hit.body && hit.body.mass === 0 && hit.normal.y < 0.55) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Multi-height whisker obstacle detection (shin/chair/planter height y+0.95 & table/stall height y+3.15)
   * using non-allocating masked raycasts so walking or shooing citizens steer around obstacles.
   */
  private steerHumanAroundObstacles(
    origin: THREE.Vector3,
    desiredDir: THREE.Vector3,
    lookAhead: number,
    ignoreBody: CANNON.Body,
    outDir: THREE.Vector3
  ): boolean {
    if (this.isHumanPathClear(origin, desiredDir, lookAhead, ignoreBody)) {
      outDir.copy(desiredDir);
      return false;
    }

    for (let i = 0; i < STEER_CANDIDATE_ANGLES.length; i++) {
      const ang = STEER_CANDIDATE_ANGLES[i];
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      _steerCand.set(
        desiredDir.x * c - desiredDir.z * s,
        0,
        desiredDir.x * s + desiredDir.z * c
      ).normalize();
      if (this.isHumanPathClear(origin, _steerCand, lookAhead * 0.92, ignoreBody)) {
        outDir.copy(_steerCand);
        return false;
      }
    }

    outDir.copy(desiredDir);
    return true;
  }

  private resolveWalkerSteer(
    h: GiantHumanInstance,
    desiredDir: THREE.Vector3,
    lookAhead: number,
    playerIndoors: boolean,
    horizDistSq: number
  ): void {
    if (playerIndoors) {
      h.cachedSteerDir.copy(desiredDir);
      h.cachedSteerBlocked = false;
      return;
    }

    if (
      horizDistSq > 55 * 55 &&
      h.hasCachedSteer &&
      (this.frameCounter + h.steerFrameOffset) % 3 !== 0
    ) {
      return;
    }

    h.cachedSteerBlocked = this.steerHumanAroundObstacles(
      h.root.position,
      desiredDir,
      lookAhead,
      h.colliderBody,
      h.cachedSteerDir
    );
    h.hasCachedSteer = true;
  }

  public addGiantHuman(cfg: GiantHumanConfig): GiantHumanInstance {
    const spawnPos = cfg.position.clone();
    if (!cfg.seated) {
      _groundProbeOrigin.set(spawnPos.x, spawnPos.y + 2.4, spawnPos.z);
      const gHit = this.physics.raycastGround(
        _groundProbeOrigin,
        _down,
        5.5,
        undefined,
        _humanGroundHit,
        WALK_RAY_MASK
      );
      if (gHit.hit && gHit.body && gHit.body.mass === 0 && gHit.normal.y > 0.65) {
        spawnPos.y = gHit.point.y;
      }
    }

    const root = new THREE.Group();
    root.position.copy(spawnPos);
    root.rotation.y = cfg.yaw;
    this.group.add(root);

    const baseHipY = cfg.seatHipY ?? (cfg.seated ? 2.98 : 4.95);

    const torsoPivot = new THREE.Group();
    torsoPivot.position.set(0, baseHipY, 0);
    root.add(torsoPivot);

    const scarfHex = cfg.scarfHex ?? PALETTE.wallCreamTrim;
    const torsoMesh = new THREE.Mesh(
      getCachedTorsoGeometry(cfg.coatHex, scarfHex, Boolean(cfg.apron)),
      this.mat
    );
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    torsoPivot.add(torsoMesh);

    const shoulderLeftAnchor = new THREE.Object3D();
    shoulderLeftAnchor.position.set(-0.96, 3.16, 0.04);
    const shoulderRightAnchor = new THREE.Object3D();
    shoulderRightAnchor.position.set(0.96, 3.16, 0.04);
    torsoPivot.add(shoulderLeftAnchor, shoulderRightAnchor);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 3.48, 0.04);
    torsoPivot.add(headPivot);

    const hairStyle: HumanHairStyle =
      cfg.hairStyle ??
      (cfg.id.includes('florist') || cfg.id.includes('reader') || cfg.id.includes('stroller_b')
        ? 'bun'
        : cfg.id.includes('feeder') || cfg.id.includes('browser')
          ? 'bob'
          : cfg.id.includes('painter') || cfg.id.includes('busker')
            ? 'waves'
            : 'short');

    const hatStyle = cfg.hatStyle ?? 'none';
    const hatAnchor = new THREE.Object3D();
    setHatAnchorOffset(hatAnchor, hatStyle);
    headPivot.add(hatAnchor);

    const headMesh = new THREE.Mesh(
      getCachedHeadGeometry(cfg.skinHex, cfg.hairHex, hairStyle, hatStyle),
      this.mat
    );
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    headPivot.add(headMesh);

    let glassesMesh: THREE.Mesh | undefined;
    if (cfg.id === 'painter') {
      glassesMesh = new THREE.Mesh(getCachedEyeglassesGeometry(), this.mat);
      glassesMesh.position.set(0, 1.12, 0.82);
      glassesMesh.visible = false;
      headPivot.add(glassesMesh);
    }

    const resolvedProp: HumanPropKind = cfg.heldProp ?? 'none';

    const isGuitarist = Boolean(cfg.guitar);
    const armLeft = this.buildArticulatedArm(-1, cfg.coatHex, cfg.skinHex, resolvedProp, isGuitarist);
    const armRight = this.buildArticulatedArm(1, cfg.coatHex, cfg.skinHex, resolvedProp, isGuitarist);
    torsoPivot.add(armLeft.shoulder, armRight.shoulder);

    let guitarPivot: THREE.Group | undefined;
    if (cfg.guitar) {
      guitarPivot = new THREE.Group();
      // Rest lower bout on right thigh, soundhole in front of chest, neck angled toward left fretting hand (-X)
      guitarPivot.position.set(0.04, 1.4, 0.76);
      guitarPivot.rotation.set(-0.08, 0.15, 1.1);
      const guitarMesh = new THREE.Mesh(getCachedGuitarGeometry(), this.mat);
      guitarMesh.castShadow = true;
      guitarMesh.receiveShadow = true;
      guitarPivot.add(guitarMesh);
      torsoPivot.add(guitarPivot);

      // Initialize collision-free seated guitarist arm + wrist pose from frame 0
      armLeft.shoulder.rotation.set(0, 0.22, -0.26);
      armLeft.elbow.rotation.set(-1.6, -0.76, -0.22);
      armLeft.wrist?.rotation.set(0.18, 0.35, 1.05);

      armRight.shoulder.rotation.set(-1.11, -0.4, -0.06);
      armRight.elbow.rotation.set(-0.43, -0.4, -1.1);
      armRight.wrist?.rotation.set(0.04, 0, -0.4);
    }

    const seatHipRot = cfg.seatHipRotX ?? -1.42;
    const seatKneeRot = cfg.seatKneeRotX ?? 1.42;
    const legLeft = this.buildArticulatedLeg(
      -1,
      cfg.trouserHex,
      baseHipY,
      cfg.seated,
      seatHipRot,
      seatKneeRot
    );
    const legRight = this.buildArticulatedLeg(
      1,
      cfg.trouserHex,
      baseHipY,
      cfg.seated,
      seatHipRot,
      seatKneeRot
    );
    root.add(legLeft.hip, legRight.hip);

    const colHeight = cfg.seated ? 8.0 : 10.6;
    const colY = spawnPos.y + (cfg.seated ? 4.0 : 5.3);
    const colliderPos = new THREE.Vector3(spawnPos.x, colY, spawnPos.z);
    const colliderBody = !cfg.seated
      ? this.physics.addKinematicCylinder(colliderPos, 1.06, 1.18, colHeight, 12)
      : this.physics.addStaticCylinder(colliderPos, 1.06, 1.18, colHeight, 12);
    colliderBody.interpolatedPosition.copy(colliderBody.position);
    colliderBody.aabbNeedsUpdate = true;

    const seedHash = cfg.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    const inst: GiantHumanInstance = {
      config: cfg,
      root,
      yaw: cfg.yaw,
      homePos: spawnPos.clone(),
      baseHipY,
      torsoPivot,
      headPivot,
      armLeft,
      armRight,
      legLeft,
      legRight,
      hatAnchor,
      shoulderLeftAnchor,
      shoulderRightAnchor,
      hatWorldPos: new THREE.Vector3(),
      shoulderLWorldPos: new THREE.Vector3(),
      shoulderRWorldPos: new THREE.Vector3(),
      headWorldPos: new THREE.Vector3(),
      perchDirty: true,
      colliderBody,
      glassesMesh,
      guitarPivot,
      lookAtTimer: 0,
      lookTarget: new THREE.Vector3(),
      celebrateTimer: 0,
      waveTimer: 0,
      startleTimer: 0,
      curiousTimer: 0,
      shooTimer: 0,
      chaseTarget: new THREE.Vector3(),
      hasChaseTarget: false,
      stationaryMoving: false,
      drowsy: cfg.id === 'sleepy_commuter',
      searchingBlindly: cfg.id === 'painter',
      strumming: Boolean(cfg.guitar),
      paintingActive: false,
      voicePitch:
        cfg.id === 'chef'
          ? 0.82
          : cfg.id === 'busker'
            ? 0.94
            : 0.78 + (seedHash % 20) * 0.03,
      waypointIdx: 0,
      waypointPauseTimer: 0,
      gaitPhase: (seedHash % 17) * 0.37,
      idlePhase: (seedHash % 13) * 0.51,
      seedCooldown: 0,
      steerFrameOffset: seedHash % 3,
      cachedSteerDir: new THREE.Vector3(Math.sin(cfg.yaw), 0, Math.cos(cfg.yaw)),
      cachedSteerBlocked: false,
      hasCachedSteer: false,
    };

    this.refreshHumanWorldAnchors(inst);
    this.physics.setBodyAttachTarget(colliderBody, torsoPivot);
    this.colliderToHuman.set(colliderBody, inst);

    this.physics.setBumpMetadata(colliderBody, {
      surface: 'human',
      causesDizzy: false,
      onBump: (hitPoint) => {
        inst.lookAtTimer = 3.5;
        inst.lookTarget.copy(hitPoint);
        inst.celebrateTimer = 1.6;
        inst.waveTimer = 1.6;
        const st = this.getSocialState(cfg.id);
        if (st.voiceCooldown <= 0) {
          st.voiceCooldown = 1.25;
          this.audio.playHumanGrunt(inst.headWorldPos, inst.voicePitch, 'oof');
        }
        if (inst.seedCooldown <= 0) {
          inst.seedCooldown = 5.0;
          this.triggerBirdFeederToss(inst, 2);
        }
      },
    });

    this.perches.addDynamicSegment({
      id: `npc_hat_${cfg.id}`,
      getApproxCenter: (out) => {
        out.copy(inst.root.position);
      },
      approxHalfSpan: 2.2,
      getEndpoints: (outA, outB) => {
        const rx = Math.cos(inst.yaw) * 0.28;
        const rz = -Math.sin(inst.yaw) * 0.28;
        outA.set(inst.hatWorldPos.x - rx, inst.hatWorldPos.y, inst.hatWorldPos.z - rz);
        outB.set(inst.hatWorldPos.x + rx, inst.hatWorldPos.y, inst.hatWorldPos.z + rz);
      },
      radius: 0.05,
      surface: 'fabric',
      onLand: () => {
        inst.celebrateTimer = 1.8;
        if (cfg.id === 'busker') {
          this.buskerGrooveTimer = 6.8;
          inst.strumming = true;
          this.audio.playBuskerGrooveFlourish(inst.root.position);
        } else if (cfg.heldProp === 'bouquet') {
          this.triggerBouquetPetalToss(inst);
        }
        if (inst.seedCooldown <= 0) {
          inst.seedCooldown = 4.5;
          this.triggerBirdFeederToss(inst, cfg.id === 'bird_feeder' ? 3 : 2);
        }
      },
    });

    this.perches.addDynamicSegment({
      id: `npc_shoulder_l_${cfg.id}`,
      getApproxCenter: (out) => {
        out.copy(inst.root.position);
      },
      approxHalfSpan: 2.2,
      getEndpoints: (outA, outB) => {
        const rx = Math.cos(inst.yaw) * 0.16;
        const rz = -Math.sin(inst.yaw) * 0.16;
        outA.set(inst.shoulderLWorldPos.x - rx, inst.shoulderLWorldPos.y, inst.shoulderLWorldPos.z - rz);
        outB.set(inst.shoulderLWorldPos.x + rx, inst.shoulderLWorldPos.y, inst.shoulderLWorldPos.z + rz);
      },
      radius: 0.05,
      surface: 'fabric',
      onLand: () => {
        inst.celebrateTimer = 1.5;
        if (cfg.id === 'busker') {
          this.buskerGrooveTimer = 6.8;
          inst.strumming = true;
          this.audio.playBuskerGrooveFlourish(inst.root.position);
        } else if (cfg.heldProp === 'bouquet') {
          this.triggerBouquetPetalToss(inst);
        }
      },
    });

    this.perches.addDynamicSegment({
      id: `npc_shoulder_r_${cfg.id}`,
      getApproxCenter: (out) => {
        out.copy(inst.root.position);
      },
      approxHalfSpan: 2.2,
      getEndpoints: (outA, outB) => {
        const rx = Math.cos(inst.yaw) * 0.16;
        const rz = -Math.sin(inst.yaw) * 0.16;
        outA.set(inst.shoulderRWorldPos.x - rx, inst.shoulderRWorldPos.y, inst.shoulderRWorldPos.z - rz);
        outB.set(inst.shoulderRWorldPos.x + rx, inst.shoulderRWorldPos.y, inst.shoulderRWorldPos.z + rz);
      },
      radius: 0.05,
      surface: 'fabric',
      onLand: () => {
        inst.celebrateTimer = 1.5;
        if (cfg.id === 'busker') {
          this.buskerGrooveTimer = 6.8;
          inst.strumming = true;
          this.audio.playBuskerGrooveFlourish(inst.root.position);
        } else if (cfg.heldProp === 'bouquet') {
          this.triggerBouquetPetalToss(inst);
        }
      },
    });

    this.humans.set(cfg.id, inst);
    return inst;
  }

  private buildArticulatedArm(
    side: -1 | 1,
    sleeveHex: number,
    skinHex: number,
    heldProp: HumanPropKind,
    isGuitarist = false
  ): HumanArmRig {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 1.08, 3.04, 0.02);

    const upperMesh = new THREE.Mesh(getCachedUpperArmGeometry(side, sleeveHex), this.mat);
    upperMesh.castShadow = true;
    shoulder.add(upperMesh);

    const elbow = new THREE.Group();
    elbow.position.set(side * 0.07, -1.24, 0);
    shoulder.add(elbow);

    if (isGuitarist) {
      const sleeveMesh = new THREE.Mesh(getCachedGuitaristSleeveGeometry(sleeveHex), this.mat);
      sleeveMesh.castShadow = true;
      elbow.add(sleeveMesh);

      const wrist = new THREE.Group();
      wrist.position.set(0, -1.08, 0.02);
      elbow.add(wrist);

      const handMesh = new THREE.Mesh(getCachedGuitaristHandGeometry(side, skinHex), this.mat);
      handMesh.castShadow = true;
      wrist.add(handMesh);

      return { shoulder, elbow, wrist };
    }

    const foreMesh = new THREE.Mesh(
      getCachedForeArmGeometry(side, sleeveHex, skinHex, heldProp),
      this.mat
    );
    foreMesh.castShadow = true;
    elbow.add(foreMesh);

    return { shoulder, elbow };
  }

  private buildArticulatedLeg(
    side: -1 | 1,
    trouserHex: number,
    hipY: number,
    seated: boolean,
    seatHipRotX = -1.42,
    seatKneeRotX = 1.42
  ): HumanLegRig {
    const hip = new THREE.Group();
    hip.position.set(side * 0.46, hipY, seated ? 0.14 : 0);

    const thighMesh = new THREE.Mesh(getCachedThighGeometry(trouserHex), this.mat);
    thighMesh.castShadow = true;
    hip.add(thighMesh);

    const knee = new THREE.Group();
    knee.position.set(0, -2.32, 0);
    hip.add(knee);

    const shinMesh = new THREE.Mesh(getCachedShinGeometry(trouserHex), this.mat);
    shinMesh.castShadow = true;
    knee.add(shinMesh);

    const ankle = new THREE.Group();
    ankle.position.set(0, -2.2, 0);
    knee.add(ankle);

    const shoeMesh = new THREE.Mesh(getCachedShoeGeometry(), this.mat);
    shoeMesh.castShadow = true;
    ankle.add(shoeMesh);

    if (seated) {
      hip.rotation.x = seatHipRotX;
      knee.rotation.x = seatKneeRotX;
      ankle.rotation.x = 0.0;
    }

    return { hip, knee, ankle };
  }

  /**
   * Applies biomechanical inverted-pendulum human gait with stance/swing knee flexion,
   * heel-strike dorsiflexion, toe-off plantarflexion, double-frequency pelvis vault, and arm swing.
   */
  private applyWalkingGait(h: GiantHumanInstance, phase: number, propKind: HumanPropKind): void {
    poseHumanLeg(h.legLeft, phase);
    poseHumanLeg(h.legRight, phase + Math.PI);

    const pelvisVault = (Math.cos(phase * 2) + 1.0) * 0.5 * 0.18;
    h.torsoPivot.position.y = h.baseHipY + pelvisVault;
    h.torsoPivot.rotation.z = Math.sin(phase) * 0.042;
    h.torsoPivot.rotation.y = -Math.sin(phase) * 0.065;
    h.torsoPivot.rotation.x = 0.055;

    const swingVal = Math.sin(phase);
    if (
      propKind === 'baguette_bag' ||
      propKind === 'bouquet' ||
      propKind === 'book' ||
      propKind === 'sketchpad'
    ) {
      h.armLeft.shoulder.rotation.x = -0.36 + swingVal * 0.08;
      h.armLeft.elbow.rotation.x = -0.95 + Math.cos(phase * 2) * 0.05;
    } else {
      h.armLeft.shoulder.rotation.x = swingVal * 0.38;
      h.armLeft.elbow.rotation.x = -0.22 - Math.max(0, -swingVal) * 0.36;
    }

    if (propKind === 'briefcase') {
      h.armRight.shoulder.rotation.x = -swingVal * 0.18;
      h.armRight.elbow.rotation.x = -0.18;
    } else if (propKind === 'coffee_cup') {
      h.armRight.shoulder.rotation.x = -0.45 - swingVal * 0.06;
      h.armRight.elbow.rotation.x = -1.05;
    } else {
      h.armRight.shoulder.rotation.x = -swingVal * 0.38;
      h.armRight.elbow.rotation.x = -0.22 - Math.max(0, swingVal) * 0.36;
    }
  }

  public addCompanionBird(opts: CompanionBirdSpec): CompanionBird {
    const snappedHome = this.resolveNonOverlappingBirdSpot(
      this.snapBirdPositionToSurface(opts.homePos),
      opts.id
    );
    const snappedSanc = this.resolveNonOverlappingBirdSpot(
      this.snapBirdPositionToSurface(opts.sanctuaryPos),
      opts.id
    );
    const snappedWaypoints = opts.ambientWaypoints?.map((wp) =>
      this.resolveNonOverlappingBirdSpot(this.snapBirdPositionToSurface(wp), opts.id)
    );

    const species = opts.species ?? 'sparrow';
    const mesh = new SparrowMesh(species);
    mesh.root.position.copy(snappedHome);
    this.group.add(mesh.root);

    const bird: CompanionBird = {
      id: opts.id,
      mesh,
      homePos: snappedHome.clone(),
      targetPos: snappedHome.clone(),
      sanctuaryPos: snappedSanc,
      tintHex: opts.crownHex,
      voiceIndex: opts.voiceIndex,
      echoTimer: 0,
      echoIsPlayerReply: false,
      beaconTimer:
        opts.id === 'starter_tit'
          ? 3.6
          : 9.0 + (opts.voiceIndex % 8) * 5.2 + Math.random() * 6.5,
      chirpAnimTimer: 0,
      flutterGreetTimer: 0,
      jostleCooldown: 0,
      thermalSurfTimer: 0,
      bathTimer: 0,
      bathRippleAccum: 0,
      bathCooldown: 14.0 + Math.random() * 20.0,
      bathSpot: new THREE.Vector3(48.0, 8.4, 48.0),
      inspectProp: null,
      inspectTimer: 0,
      inspectChirpDone: false,
      inspectSpot: new THREE.Vector3(),
      flocking: false,
      flockSlot: opts.flockSlot.clone(),
      flockHoverY: snappedHome.y,
      demoHopping: false,
      ambientWaypoints: snappedWaypoints,
      ambientWaitTimer: 3.0 + Math.random() * 5.0,
      ambientWpIdx: 0,
    };
    this.companions.push(bird);
    return bird;
  }

  /**
   * Spawns a waddling, alternating-step flock of 6 plump Park Pigeons around a plaza center
   * that burst into feathery flight when swooped through or chirped at.
   */
  public addPigeonFlock(plazaCenter: THREE.Vector3, scatterPerches: THREE.Vector3[]): void {
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.3;
      const rad = 2.6 + (i % 2) * 1.4;
      const hx = plazaCenter.x + Math.cos(ang) * rad;
      const hz = plazaCenter.z + Math.sin(ang) * rad;
      const hy = this.snapPigeonGroundY(hx, plazaCenter.y + 0.4, hz, 0.408);
      const home = new THREE.Vector3(hx, hy, hz);
      const fallbackScatter = new THREE.Vector3(plazaCenter.x, plazaCenter.y + 12, plazaCenter.z);
      const scatter = this.snapBirdPositionToSurface(
        scatterPerches[i % scatterPerches.length] ?? fallbackScatter,
        0.408
      );

      const mesh = new SparrowMesh('pigeon');
      mesh.root.position.copy(home);
      mesh.root.rotation.y = ang + Math.PI * 0.6;
      this.group.add(mesh.root);

      this.pigeons.push({
        mesh,
        forageHome: home,
        forageTarget: home.clone(),
        scatterPerch: scatter,
        scatteredTimer: 0,
        wanderTimer: 1.5 + i * 0.7,
        cooTimer: 10.0 + i * 7.5 + Math.random() * 8.0,
        phase: i * 1.15,
        foodTargetProp: null,
        nibbleTimer: 0,
        nibbleCrumbAccum: 0,
        bathTimer: 0,
        bathRippleAccum: 0,
        bathCooldown: 12.0 + i * 5.5 + Math.random() * 10.0,
        bathSpot: new THREE.Vector3(48.0, 2.8, 60.5),
        jostleCooldown: 0,
      });
    }
  }

  private scatterPigeonFlock(triggerOrigin: THREE.Vector3): void {
    let anyForaging = false;
    for (let i = 0; i < this.pigeons.length; i++) {
      const p = this.pigeons[i];
      if (p.scatteredTimer <= 0) {
        anyForaging = true;
        p.scatteredTimer = 13.0 + Math.random() * 3.0;
        this.fx.spawnFeatherBurst(p.mesh.root.position, 5, 3.2);
      }
    }
    if (!anyForaging) return;

    this.audio.playPigeonFlutter(triggerOrigin);
    this.onPigeonFlockScattered?.();

    if (this.pigeonScatterSeedCooldown <= 0) {
      this.pigeonScatterSeedCooldown = 14.0;
      _tossOrigin.set(triggerOrigin.x, triggerOrigin.y + 0.8, triggerOrigin.z);
      _tossFwd.set(0.4, 0.7, 0.4);
      this.spawnSeedBurstAt?.(_tossOrigin, _tossFwd, 3);
    }
  }

  private resolveNonOverlappingBirdSpot(
    candidate: THREE.Vector3,
    selfId?: string,
    snapAfterOffset = true
  ): THREE.Vector3 {
    const minDist = 1.68;
    const minDistSq = minDist * minDist;
    const out = candidate.clone();
    for (let pass = 0; pass < 4; pass++) {
      let overlapOther: CompanionBird | null = null;
      for (let i = 0; i < this.companions.length; i++) {
        const other = this.companions[i];
        if (other.id === selfId) continue;
        if (
          other.targetPos.distanceToSquared(out) < minDistSq ||
          other.mesh.root.position.distanceToSquared(out) < minDistSq
        ) {
          overlapOther = other;
          break;
        }
      }
      if (!overlapOther) break;
      let dx = out.x - overlapOther.targetPos.x;
      let dz = out.z - overlapOther.targetPos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.02) {
        dx /= len;
        dz /= len;
      } else {
        const ang = (pass + 1) * 1.35;
        dx = Math.cos(ang);
        dz = Math.sin(ang);
      }
      out.x = overlapOther.targetPos.x + dx * (minDist + 0.25);
      out.z = overlapOther.targetPos.z + dz * (minDist + 0.25);
      if (snapAfterOffset) {
        this.snapBirdPositionToSurface(out, 0.384, out);
      }
    }
    return out;
  }

  public setCompanionOnboardingState(
    birdId: string,
    targetPos: THREE.Vector3,
    demoHopping: boolean,
    flownOut = false,
    exactPosition = false
  ): void {
    const b = this.companions.find((c) => c.id === birdId);
    if (!b) return;
    const baseTarget = exactPosition ? targetPos.clone() : this.snapBirdPositionToSurface(targetPos);
    b.targetPos.copy(this.resolveNonOverlappingBirdSpot(baseTarget, birdId, !exactPosition));
    b.demoHopping = demoHopping;
    if (flownOut) b.hasFlownToSquare = true;
  }

  public sendCompanionToSanctuary(birdId: string): void {
    const b = this.companions.find((c) => c.id === birdId);
    if (b) {
      b.demoHopping = false;
      b.ambientWaypoints = undefined;
      b.targetPos.copy(b.sanctuaryPos);
      this.fx.spawnChirpRing(b.mesh.root.position, b.tintHex, 7.0);
    }
  }

  public handlePlayerChirp(chirpPos: THREE.Vector3): void {
    for (let i = 0; i < this.companions.length; i++) {
      const c = this.companions[i];
      const dist = c.mesh.root.position.distanceTo(chirpPos);
      if (dist < 56.0) {
        c.echoTimer =
          (c.thermalSurfTimer ?? 0) > 0
            ? 0.14 + (i % 3) * 0.11
            : 0.26 + Math.min(0.45, dist * 0.01);
        c.echoIsPlayerReply = true;
        if (c.id === 'starter_tit' && dist < 44.0) {
          this.onStarterBirdAnswered?.();
        }
      }
    }

    for (let i = 0; i < this.pigeons.length; i++) {
      const p = this.pigeons[i];
      if (p.scatteredTimer <= 0 && p.mesh.root.position.distanceTo(chirpPos) < 11.5) {
        this.scatterPigeonFlock(p.forageHome);
        break;
      }
    }

    for (const h of this.humans.values()) {
      const dist = h.headWorldPos.distanceTo(chirpPos);
      if (dist < 26.0) {
        h.lookAtTimer = 3.5;
        h.lookTarget.copy(chirpPos);
        if (!h.drowsy && h.shooTimer <= 0) {
          h.waveTimer = Math.max(h.waveTimer, 1.75);
        }

        if (h.config.id === 'bird_feeder' && h.seedCooldown <= 0) {
          h.seedCooldown = 4.2;
          h.celebrateTimer = 1.6;
          this.triggerBirdFeederToss(h, 3);
        } else if (h.config.id === 'chef' && dist < 16.0 && h.seedCooldown <= 0 && h.shooTimer <= 0) {
          h.seedCooldown = 6.0;
          h.celebrateTimer = 1.4;
          _tossOrigin.set(h.root.position.x, h.root.position.y + 6.2, h.root.position.z + 1.8);
          _tossFwd.set(Math.sin(h.yaw), 0.35, Math.cos(h.yaw));
          this.spawnSeedBurstAt?.(_tossOrigin, _tossFwd, 2);
        } else if (h.config.id === 'florist' && dist < 18.0) {
          h.celebrateTimer = 2.0;
          if (!this.floristGifted) {
            this.floristGifted = true;
            _tossOrigin.set(h.root.position.x + 1.0, h.root.position.y + 6.0, h.root.position.z + 1.6);
            this.spawnFlowerGiftAt?.(_tossOrigin);
          }
          this.triggerBouquetPetalToss(h);
        } else if (h.config.heldProp === 'bouquet' && dist < 16.5) {
          h.celebrateTimer = 1.7;
          this.triggerBouquetPetalToss(h);
        } else if (h.config.id === 'busker' && dist < 22.0) {
          h.celebrateTimer = 1.6;
          h.strumming = true;
          this.buskerGrooveTimer = 6.8;
          this.audio.playBuskerGrooveFlourish(h.root.position);
        } else if (!h.drowsy && dist < 12.5 && h.seedCooldown <= 0 && h.shooTimer <= 0) {
          h.seedCooldown = 8.5;
          h.celebrateTimer = 1.3;
          this.triggerBirdFeederToss(h, 1);
        }
      }
    }

    if (this.flockModeActive) {
      for (let i = 0; i < this.companions.length; i++) {
        const c = this.companions[i];
        if (!c.ambientWaypoints) {
          if (!c.flocking) {
            c.flockHoverY = c.mesh.root.position.y;
          }
          c.flocking = true;
        }
      }
    }
  }

  private humanSocialState = new Map<
    string,
    {
      pettingTimer: number;
      petCooldown: number;
      peckedTimer: number;
      gustCooldown: number;
      poopedTimer: number;
      gaspTimer: number;
      guardPlateTimer: number;
      pointAtBirdTimer: number;
      yieldWatchTimer: number;
      yieldLingerAccum: number;
      museSketchTimer: number;
      musePoseAccum: number;
      transitSaluteCooldown: number;
      petalTossCooldown: number;
      voiceCooldown: number;
    }
  >();

  private getSocialState(id: string) {
    let st = this.humanSocialState.get(id);
    if (!st) {
      st = {
        pettingTimer: 0,
        petCooldown: 0,
        peckedTimer: 0,
        gustCooldown: 0,
        poopedTimer: 0,
        gaspTimer: 0,
        guardPlateTimer: 0,
        pointAtBirdTimer: 0,
        yieldWatchTimer: 0,
        yieldLingerAccum: 0,
        museSketchTimer: 0,
        musePoseAccum: 0,
        transitSaluteCooldown: 1.5 + Math.random() * 4.0,
        petalTossCooldown: 0,
        voiceCooldown: 0,
      };
      this.humanSocialState.set(id, st);
    }
    return st;
  }

  private triggerBouquetPetalToss(h: GiantHumanInstance): void {
    const st = this.getSocialState(h.config.id);
    if (st.petalTossCooldown > 0) return;
    st.petalTossCooldown = 3.2;
    const sy = Math.sin(h.yaw);
    const cy = Math.cos(h.yaw);
    _fxPos.set(
      h.root.position.x + sy * 1.35 - cy * 0.65,
      h.root.position.y + 6.3,
      h.root.position.z + cy * 1.35 + sy * 0.65
    );
    this.fx.spawnPetalBurst(_fxPos, 11, 3.35);
    this.audio.playHumanPetCoo(h.headWorldPos, h.voicePitch);
  }

  /**
   * Broadcasts an acoustic shockwave (ceramic shatter, tabletop topple, bicycle/tram/clocktower bell)
   * so nearby citizens gasp or shake a fist, foraging pigeons scatter, and perched songbirds ripple
   * a distance-staggered call-and-response chorus across the district.
   */
  public notifyAcousticShock(
    origin: THREE.Vector3,
    kind: 'shatter' | 'topple' | 'bell'
  ): void {
    const shockIndoors = isInsideAtelier(origin);

    // 1. Human reactions: startled cheek-gasp from bystanders + angry vendor fist-shake
    if (!shockIndoors) {
      let bestGaspHuman: GiantHumanInstance | null = null;
      let bestGaspDistSq = Infinity;
      for (const h of this.humans.values()) {
        const dx = origin.x - h.root.position.x;
        const dz = origin.z - h.root.position.z;
        const horizSq = dx * dx + dz * dz;
        const dy = Math.abs(origin.y - (h.root.position.y + 5.0));

        if (kind === 'shatter' || kind === 'topple') {
          if (horizSq < 21.0 * 21.0 && dy < 14.0 && !h.drowsy) {
            const st = this.getSocialState(h.config.id);
            h.lookAtTimer = 3.4;
            h.lookTarget.copy(origin);
            if (h.config.id === 'chef' || h.config.id === 'market_vendor') {
              if (h.shooTimer <= 0) {
                h.shooTimer = 2.6;
                h.chaseTarget.copy(origin);
                h.hasChaseTarget = true;
                if (h.config.id === 'chef') {
                  this.audio.playChefShout(h.headWorldPos, h.voicePitch);
                } else {
                  this.audio.playHumanYell(h.headWorldPos, h.voicePitch, 'hey');
                }
              }
            } else if (st.poopedTimer <= 0) {
              st.gaspTimer = 1.65;
              h.celebrateTimer = 0;
              h.waveTimer = 0;
              if (horizSq < bestGaspDistSq) {
                bestGaspDistSq = horizSq;
                bestGaspHuman = h;
              }
            }
          }
        } else if (horizSq < 24.0 * 24.0 && !h.drowsy) {
          h.lookAtTimer = Math.max(h.lookAtTimer, 2.4);
          h.lookTarget.copy(origin);
        }
      }
      if (bestGaspHuman) {
        this.audio.playHumanGasp(bestGaspHuman.headWorldPos, bestGaspHuman.voicePitch);
      }
    }

    // 2. Grounded pigeon startle-scatter
    if (!shockIndoors) {
      for (let i = 0; i < this.pigeons.length; i++) {
        const p = this.pigeons[i];
        if (p.scatteredTimer <= 0 && p.mesh.root.position.distanceToSquared(origin) < 34.0 * 34.0) {
          this.scatterPigeonFlock(p.forageHome);
          break;
        }
      }
    }

    // 3. Distance-staggered rooftop songbird chorus wave
    for (let i = 0; i < this.companions.length; i++) {
      const c = this.companions[i];
      if (c.flocking) continue;
      const birdIndoors = isInsideAtelier(c.mesh.root.position);
      if (birdIndoors !== shockIndoors) continue;
      const dist = c.mesh.root.position.distanceTo(origin);
      if (dist < 66.0 && c.echoTimer <= 0) {
        c.echoTimer = Math.min(0.95, 0.16 + dist * 0.012);
        c.echoIsPlayerReply = false;
        c.flutterGreetTimer = Math.max(c.flutterGreetTimer ?? 0, 0.55);
      }
    }
  }

  /**
   * Notifies seated café/bench patrons when the Sparrow pecks near their table or lap,
   * prompting a protective cup/plate-shielding forearm posture.
   */
  public notifyTablePeck(beakPos: THREE.Vector3): void {
    for (const h of this.humans.values()) {
      if (!h.config.seated || h.drowsy) continue;
      const dx = beakPos.x - h.root.position.x;
      const dz = beakPos.z - h.root.position.z;
      const relY = beakPos.y - h.root.position.y;
      if (dx * dx + dz * dz < 4.9 * 4.9 && relY >= 1.4 && relY <= 6.2) {
        const st = this.getSocialState(h.config.id);
        if (st.poopedTimer <= 0) {
          st.guardPlateTimer = 1.95;
          h.lookAtTimer = 2.8;
          h.lookTarget.copy(beakPos);
          if (st.petCooldown <= 0) {
            st.petCooldown = 3.2;
            this.audio.playHumanGrunt(h.headWorldPos, h.voicePitch, 'hmph');
          }
        }
      }
    }
  }

  /**
   * Notifies nearby birds when the Sparrow drops a prop:
   * - Glinting treasures (`shiny_coin`, `brass_key`, `ribbon`, `flower_sprig`) invite an idle
   *   ambient songbird to flutter down beside the item and cock its head curiously.
   * - Bakery/food morsels trigger an immediate pigeon food-scramble scan.
   */
  public notifyPropDropped(prop: InteractiveProp): void {
    _fxPos.set(prop.body.position.x, prop.body.position.y, prop.body.position.z);
    if (isInsideAtelier(_fxPos)) return;

    if (
      prop.kind === 'seed' ||
      prop.kind === 'croissant' ||
      prop.kind === 'baguette' ||
      prop.kind === 'berry'
    ) {
      this.pigeonFoodScanTimer = 0;
    }

    if (
      prop.kind === 'shiny_coin' ||
      prop.kind === 'brass_key' ||
      prop.kind === 'ribbon' ||
      prop.kind === 'flower_sprig'
    ) {
      let bestBird: CompanionBird | null = null;
      let bestDistSq = 34.0 * 34.0;
      for (let i = 0; i < this.companions.length; i++) {
        const c = this.companions[i];
        if (!c.ambientWaypoints || c.flocking) continue;
        const dSq = c.mesh.root.position.distanceToSquared(_fxPos);
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestBird = c;
        }
      }
      if (bestBird) {
        bestBird.inspectProp = prop;
        bestBird.inspectTimer = 5.8;
        bestBird.inspectChirpDone = false;
      }
    }
  }

  public isHumanCollider(body: CANNON.Body | null | undefined): boolean {
    return body ? this.colliderToHuman.has(body) : false;
  }

  private resolveHumanAttachParent(hitObj: THREE.Object3D, h: GiantHumanInstance): THREE.Object3D {
    let cur: THREE.Object3D | null = hitObj;
    while (cur) {
      if (cur === h.headPivot) return h.headPivot;
      if (cur === h.torsoPivot) return h.torsoPivot;
      cur = cur.parent;
    }
    return h.torsoPivot;
  }

  private triggerHumanPoopedState(h: GiantHumanInstance, birdPos: THREE.Vector3): void {
    const st = this.getSocialState(h.config.id);
    st.poopedTimer = 4.2;
    st.pettingTimer = 0;
    st.petCooldown = 8.5;
    h.celebrateTimer = 0;
    h.waveTimer = 0;
    h.curiousTimer = 0;
    h.shooTimer = 0;
    h.startleTimer = 0.48;
    h.lookAtTimer = 4.5;
    h.lookTarget.copy(birdPos);
    this.audio.playHumanPoopedReaction(h.headWorldPos, h.voicePitch);
  }

  /**
   * Tests a falling dropping segment against all articulated citizens (exact visual mesh raycast
   * with generous head/hat & shoulder surface-snap forgiveness) and triggers their reaction on hit.
   */
  public checkFallingDroppingHit(
    prevPos: THREE.Vector3,
    nextPos: THREE.Vector3,
    birdPos: THREE.Vector3
  ): {
    hit: boolean;
    distance: number;
    point: THREE.Vector3;
    normal: THREE.Vector3;
    attachParent?: THREE.Object3D;
  } | null {
    _dropSegVec.subVectors(nextPos, prevPos);
    const segLen = _dropSegVec.length();
    if (segLen < 1e-5) return null;
    _dropRayDir.copy(_dropSegVec).divideScalar(segLen);

    const minSegY = Math.min(prevPos.y, nextPos.y) - 1.25;
    const maxSegY = Math.max(prevPos.y, nextPos.y) + 1.25;

    let bestHuman: GiantHumanInstance | null = null;
    let bestDist = Infinity;
    const bestPoint = new THREE.Vector3();
    const bestNormal = new THREE.Vector3(0, 1, 0);
    let bestParent: THREE.Object3D | undefined;

    for (const h of this.humans.values()) {
      const rootY = h.root.position.y;
      const topY = rootY + (h.config.seated ? 9.6 : 12.2);
      if (maxSegY < rootY - 0.2 || minSegY > topY) continue;

      const midX = (prevPos.x + nextPos.x) * 0.5 - h.root.position.x;
      const midZ = (prevPos.z + nextPos.z) * 0.5 - h.root.position.z;
      const reachR = 2.45 + segLen * 0.5;
      if (midX * midX + midZ * midZ > reachR * reachR) continue;

      h.root.updateMatrixWorld(true);

      // 1. Direct raycast against the citizen's sculpted head/hat, torso, and legs
      _dropRaycaster.set(prevPos, _dropRayDir);
      _dropRaycaster.near = 0;
      _dropRaycaster.far = segLen + 0.08;
      _dropIntersects.length = 0;
      _dropRaycaster.intersectObjects(
        [h.headPivot, h.torsoPivot, h.legLeft.hip, h.legRight.hip],
        true,
        _dropIntersects
      );

      if (_dropIntersects.length > 0) {
        const hit = _dropIntersects[0];
        if (hit.distance < bestDist) {
          bestDist = hit.distance;
          bestHuman = h;
          bestPoint.copy(hit.point);
          if (hit.face) {
            _dropNormalMat.getNormalMatrix(hit.object.matrixWorld);
            bestNormal.copy(hit.face.normal).applyMatrix3(_dropNormalMat).normalize();
          } else {
            bestNormal.set(0, 1, 0);
          }
          bestParent = this.resolveHumanAttachParent(hit.object, h);
        }
        continue;
      }

      // 2. Generous arcade forgiveness on hats/crowns (`r = 1.15 SU`) & shoulders (`r = 1.20 SU`),
      //    snapped cleanly onto the citizen's actual 3D surface mesh so decals never float.
      _dropHeadCenter.lerpVectors(h.headWorldPos, h.hatWorldPos, 0.55);
      _dropToPt.subVectors(_dropHeadCenter, prevPos);
      const tHead = Math.max(0, Math.min(segLen, _dropToPt.dot(_dropRayDir)));
      _dropClosest.copy(prevPos).addScaledVector(_dropRayDir, tHead);
      const headDistSq = _dropClosest.distanceToSquared(_dropHeadCenter);

      _dropTorsoCenter.set(
        h.root.position.x,
        Math.max(rootY + 2.2, Math.min(h.headWorldPos.y - 0.35, _dropClosest.y)),
        h.root.position.z
      );
      const tTorso = Math.max(
        0,
        Math.min(segLen, _dropToPt.subVectors(_dropTorsoCenter, prevPos).dot(_dropRayDir))
      );
      _dropClosest.copy(prevPos).addScaledVector(_dropRayDir, tTorso);
      const torsoDistSq = _dropClosest.distanceToSquared(_dropTorsoCenter);

      const hitHeadSphere = headDistSq <= 1.15 * 1.15;
      const hitTorsoSphere = !hitHeadSphere && torsoDistSq <= 1.18 * 1.18;
      if (!hitHeadSphere && !hitTorsoSphere) continue;

      const targetCenter = hitHeadSphere ? _dropHeadCenter : _dropTorsoCenter;
      const tApprox = hitHeadSphere ? tHead : tTorso;
      if (tApprox >= bestDist) continue;

      _dropClosest.copy(prevPos).addScaledVector(_dropRayDir, tApprox);
      _dropSnapOrigin.set(
        (_dropClosest.x + targetCenter.x) * 0.5,
        Math.max(_dropClosest.y, targetCenter.y) + 2.4,
        (_dropClosest.z + targetCenter.z) * 0.5
      );
      _dropSnapDir.subVectors(targetCenter, _dropSnapOrigin).normalize();

      _dropRaycaster.set(_dropSnapOrigin, _dropSnapDir);
      _dropRaycaster.near = 0;
      _dropRaycaster.far = 4.6;
      _dropIntersects.length = 0;
      _dropRaycaster.intersectObjects(
        hitHeadSphere ? [h.headPivot, h.torsoPivot] : [h.torsoPivot, h.headPivot],
        true,
        _dropIntersects
      );

      if (_dropIntersects.length > 0) {
        const snapHit = _dropIntersects[0];
        bestDist = tApprox;
        bestHuman = h;
        bestPoint.copy(snapHit.point);
        if (snapHit.face) {
          _dropNormalMat.getNormalMatrix(snapHit.object.matrixWorld);
          bestNormal.copy(snapHit.face.normal).applyMatrix3(_dropNormalMat).normalize();
        } else {
          bestNormal.set(0, 1, 0);
        }
        bestParent = this.resolveHumanAttachParent(snapHit.object, h);
      }
    }

    if (!bestHuman) return null;

    this.triggerHumanPoopedState(bestHuman, birdPos);
    return {
      hit: true,
      distance: bestDist,
      point: bestPoint,
      normal: bestNormal,
      attachParent: bestParent,
    };
  }

  /**
   * Handles direct close-range player beak pecks on citizens, park pigeons, or companion birds.
   * Pecking a citizen startles them into a shooing reaction and returns a shoo-gust impulse.
   */
  public handlePlayerPeck(
    beakPos: THREE.Vector3,
    birdPos: THREE.Vector3
  ): { hit: boolean; shooImpulse?: THREE.Vector3 } {
    for (const h of this.humans.values()) {
      const dx = beakPos.x - h.root.position.x;
      const dz = beakPos.z - h.root.position.z;
      const horizDist = Math.hypot(dx, dz);
      const maxH = h.config.seated ? 8.8 : 11.4;
      const relY = beakPos.y - h.root.position.y;
      if (horizDist <= 2.35 && relY >= -0.4 && relY <= maxH) {
        const st = this.getSocialState(h.config.id);
        st.peckedTimer = 0.65;
        st.pettingTimer = 0;
        st.petCooldown = 6.0;
        st.gustCooldown = 0.45;

        h.drowsy = false;
        h.celebrateTimer = 0;
        h.waveTimer = 0;
        h.curiousTimer = 0;
        h.startleTimer = 0.36;
        h.shooTimer = 3.2;
        h.chaseTarget.copy(birdPos);
        h.hasChaseTarget = true;
        h.lookAtTimer = 3.6;
        h.lookTarget.copy(birdPos);

        this.audio.playHumanGrunt(h.headWorldPos, h.voicePitch, 'oof');
        if (h.config.id === 'chef') {
          this.audio.playChefShout(h.headWorldPos, h.voicePitch);
        } else {
          this.audio.playHumanYell(h.headWorldPos, h.voicePitch, 'hey');
        }
        this.fx.spawnBurst(beakPos, 7, false, 3.2);

        if (h.seedCooldown <= 0) {
          h.seedCooldown = 5.5;
          this.triggerBirdFeederToss(h, 1);
        }

        const outX = birdPos.x - h.root.position.x;
        const outZ = birdPos.z - h.root.position.z;
        const outLen = Math.hypot(outX, outZ);
        const nx = outLen >= 0.03 ? outX / outLen : 0;
        const nz = outLen >= 0.03 ? outZ / outLen : 1;
        const shooImpulse = new THREE.Vector3(nx * 8.6, 3.8, nz * 8.6);
        return { hit: true, shooImpulse };
      }
    }

    for (let i = 0; i < this.pigeons.length; i++) {
      const p = this.pigeons[i];
      if (p.mesh.root.position.distanceTo(beakPos) <= 2.15) {
        this.scatterPigeonFlock(p.forageHome);
        return { hit: true };
      }
    }

    for (let i = 0; i < this.companions.length; i++) {
      const c = this.companions[i];
      if (c.mesh.root.position.distanceTo(beakPos) <= 1.85) {
        c.echoTimer = 0.06;
        c.echoIsPlayerReply = true;
        this.fx.spawnBurst(c.mesh.root.position, 4, true, 2.0);
        return { hit: true };
      }
    }

    return { hit: false };
  }

  /**
   * Samples close-range physical air-gust impulses from actively shooing citizens,
   * pushing the Sparrow back or knocking it off a hat/shoulder/table perch.
   */
  public sampleShooGust(playerPos: THREE.Vector3): THREE.Vector3 | null {
    for (const h of this.humans.values()) {
      if (h.shooTimer <= 0) continue;
      const st = this.getSocialState(h.config.id);
      if (st.gustCooldown > 0) continue;

      const dx = playerPos.x - h.root.position.x;
      const dz = playerPos.z - h.root.position.z;
      const horiz = Math.hypot(dx, dz);
      const relY = playerPos.y - h.root.position.y;
      const maxH = h.config.seated ? 8.8 : 11.6;
      if (horiz < 4.5 && relY >= -0.4 && relY <= maxH) {
        st.gustCooldown = 0.52;
        const nx = horiz > 0.01 ? dx / horiz : Math.sin(h.yaw);
        const nz = horiz > 0.01 ? dz / horiz : Math.cos(h.yaw);
        this.fx.spawnBurst(playerPos, 5, false, 2.6);
        return new THREE.Vector3(nx * 8.4, 3.4, nz * 8.4);
      }
    }
    return null;
  }

  private triggerBirdFeederToss(h: GiantHumanInstance, count = 3): void {
    const sy = Math.sin(h.yaw);
    const cy = Math.cos(h.yaw);
    _tossFwd.set(sy, 0.38, cy);
    _tossOrigin.set(
      h.root.position.x + sy * 2.0,
      h.root.position.y + 4.8 + 0.38 * 2.0,
      h.root.position.z + cy * 2.0
    );
    this.spawnSeedBurstAt?.(_tossOrigin, _tossFwd, count);
  }

  public wakeSleepyCommuter(): void {
    const h = this.humans.get('sleepy_commuter');
    if (!h) return;
    h.drowsy = false;
    h.celebrateTimer = 2.8;
    h.waveTimer = 2.4;
    this.audio.playHumanGrunt(h.headWorldPos, h.voicePitch, 'huh');
  }

  public awakenBusker(): void {
    const h = this.humans.get('busker');
    if (!h) return;
    h.strumming = true;
    this.buskerGrooveTimer = Math.max(this.buskerGrooveTimer, 9.0);
    h.celebrateTimer = 3.0;
    this.audio.playBuskerGrooveFlourish(h.root.position);
  }

  public givePainterGlasses(): void {
    const h = this.humans.get('painter');
    if (!h) return;
    h.searchingBlindly = false;
    if (h.glassesMesh) h.glassesMesh.visible = true;
    h.celebrateTimer = 2.8;
    this.audio.playHumanChuckle(h.headWorldPos, h.voicePitch);
  }

  public triggerPainterStroke(): void {
    const h = this.humans.get('painter');
    if (!h) return;
    h.paintingActive = true;
    h.celebrateTimer = 2.4;
  }

  public triggerChefShoo(thiefPos?: THREE.Vector3): void {
    const h = this.humans.get('chef');
    if (!h) return;
    h.shooTimer = 2.8;
    if (thiefPos) {
      h.chaseTarget.copy(thiefPos);
      h.hasChaseTarget = true;
      h.lookAtTimer = 3.0;
      h.lookTarget.copy(thiefPos);
    }
    this.audio.playChefShout(h.headWorldPos, h.voicePitch);
  }

  public triggerVendorShoo(eventPos?: THREE.Vector3): void {
    const h = this.humans.get('market_vendor');
    if (!h) return;
    h.shooTimer = 2.6;
    if (eventPos) {
      h.chaseTarget.copy(eventPos);
      h.hasChaseTarget = true;
      h.lookAtTimer = 3.2;
      h.lookTarget.copy(eventPos);
    }
    this.audio.playHumanShoo(h.headWorldPos, h.voicePitch);
  }

  public update(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    playerYaw: number,
    activePerchId = '',
    playerMode: 'grounded' | 'perched' | 'flying' = 'grounded',
    carriedPropKind: PropKind | null = null,
    tramX = 999,
    canalBoats?: ReadonlyArray<{ xPos: number; baseZ: number }>
  ): void {
    this.frameCounter++;
    const clampedDt = Math.min(0.05, dt);
    const playerSpeedSq = playerVel.lengthSq();
    const playerSpeed = Math.sqrt(playerSpeedSq);
    if (this.pigeonScatterSeedCooldown > 0) this.pigeonScatterSeedCooldown -= clampedDt;
    if (this.buskerGrooveTimer > 0) {
      this.buskerGrooveTimer = Math.max(0, this.buskerGrooveTimer - clampedDt);
    }

    const playerIndoors = isInsideAtelier(playerPos);
    const buskerHuman = this.humans.get('busker');
    const isCarryingFood =
      carriedPropKind === 'baguette' ||
      carriedPropKind === 'croissant' ||
      carriedPropKind === 'gelato_cone' ||
      carriedPropKind === 'apple' ||
      carriedPropKind === 'berry';
    const isCarryingBigPastry =
      carriedPropKind === 'baguette' ||
      carriedPropKind === 'croissant' ||
      carriedPropKind === 'gelato_cone';
    const isCarryingShiny =
      carriedPropKind === 'shiny_coin' ||
      carriedPropKind === 'brass_key' ||
      carriedPropKind === 'eyeglasses';
    const playerOnTram = activePerchId.startsWith('tram_');
    const playerOnBoat = activePerchId.startsWith('canal_boat_');

    // 1. Update Articulated ~11.2-SU Citizens + Biomechanical Gait + Petting / Shooing / Peck Reactions
    for (const h of this.humans.values()) {
      const st = this.getSocialState(h.config.id);
      if (st.pettingTimer > 0) st.pettingTimer = Math.max(0, st.pettingTimer - clampedDt);
      if (st.petCooldown > 0) st.petCooldown = Math.max(0, st.petCooldown - clampedDt);
      if (st.peckedTimer > 0) st.peckedTimer = Math.max(0, st.peckedTimer - clampedDt);
      if (st.gustCooldown > 0) st.gustCooldown = Math.max(0, st.gustCooldown - clampedDt);
      if (st.gaspTimer > 0) st.gaspTimer = Math.max(0, st.gaspTimer - clampedDt);
      if (st.guardPlateTimer > 0) st.guardPlateTimer = Math.max(0, st.guardPlateTimer - clampedDt);
      if (st.pointAtBirdTimer > 0) {
        st.pointAtBirdTimer = Math.max(0, st.pointAtBirdTimer - clampedDt);
      }
      if (st.yieldWatchTimer > 0) st.yieldWatchTimer = Math.max(0, st.yieldWatchTimer - clampedDt);
      if (st.museSketchTimer > 0) st.museSketchTimer = Math.max(0, st.museSketchTimer - clampedDt);
      if (st.transitSaluteCooldown > 0) {
        st.transitSaluteCooldown = Math.max(0, st.transitSaluteCooldown - clampedDt);
      }
      if (st.petalTossCooldown > 0) {
        st.petalTossCooldown = Math.max(0, st.petalTossCooldown - clampedDt);
      }
      if (st.voiceCooldown > 0) {
        st.voiceCooldown = Math.max(0, st.voiceCooldown - clampedDt);
      }
      if (st.poopedTimer > 0) {
        st.poopedTimer = Math.max(0, st.poopedTimer - clampedDt);
        h.lookTarget.copy(playerPos);
        h.lookAtTimer = Math.max(h.lookAtTimer, 0.35);
      }

      if (h.seedCooldown > 0) h.seedCooldown -= clampedDt;
      if (h.lookAtTimer > 0) h.lookAtTimer -= clampedDt;
      if (h.celebrateTimer > 0) h.celebrateTimer -= clampedDt;
      if (h.waveTimer > 0) h.waveTimer -= clampedDt;
      if (h.startleTimer > 0) h.startleTimer -= clampedDt;
      if (h.curiousTimer > 0) h.curiousTimer -= clampedDt;
      if (h.shooTimer > 0) h.shooTimer -= clampedDt;
      if (h.waypointPauseTimer > 0) h.waypointPauseTimer -= clampedDt;

      const propKind: HumanPropKind = h.config.heldProp ?? 'none';

      const isGuardVendor = h.config.id === 'chef' || h.config.id === 'market_vendor';
      const isPerchedOnMe =
        activePerchId === `npc_hat_${h.config.id}` ||
        activePerchId === `npc_shoulder_l_${h.config.id}` ||
        activePerchId === `npc_shoulder_r_${h.config.id}`;

      const distToHeadSq = h.headWorldPos.distanceToSquared(playerPos);
      const dxPlayer = playerPos.x - h.root.position.x;
      const dzPlayer = playerPos.z - h.root.position.z;
      const horizDistSq = dxPlayer * dxPlayer + dzPlayer * dzPlayer;
      const horizDist = Math.sqrt(horizDistSq);
      const relBirdY = playerPos.y - h.root.position.y;

      // Reaction 1: Close high-speed head flyby -> Startle duck, protective arm raise & startled yell!
      if (!h.drowsy && !isPerchedOnMe && distToHeadSq < 16.0 && playerSpeed > 9.5) {
        if (h.startleTimer <= 0 && st.voiceCooldown <= 0) {
          st.voiceCooldown = 2.4;
          this.audio.playHumanYell(h.headWorldPos, h.voicePitch, 'oi');
        }
        h.startleTimer = 1.15;
        h.lookAtTimer = 2.8;
        h.lookTarget.copy(playerPos);
      }

      // Reaction 2: Protective Stall Vendors ('chef', 'market_vendor') shoo close-in trespassers (wider aggro when carrying stolen food!)
      const vendorAggroRadius = isCarryingFood ? 6.8 : 3.4;
      const vendorMaxRelY = isCarryingFood ? 6.8 : 4.6;
      if (
        isGuardVendor &&
        h.shooTimer <= 0 &&
        st.petCooldown <= 0 &&
        horizDist < vendorAggroRadius &&
        Math.abs(relBirdY - 4.2) < vendorMaxRelY
      ) {
        st.petCooldown = 5.0;
        h.shooTimer = 2.5;
        h.chaseTarget.copy(playerPos);
        h.hasChaseTarget = true;
        h.lookAtTimer = 3.0;
        h.lookTarget.copy(playerPos);
        if (h.config.id === 'chef') {
          this.audio.playChefShout(h.headWorldPos, h.voicePitch);
        } else {
          this.audio.playHumanShoo(h.headWorldPos, h.voicePitch);
        }
      }

      // Reaction 2B: Seated Café & Bench Patron Hospitality vs Tabletop Crash Shielding
      if (
        h.config.seated &&
        !h.drowsy &&
        h.shooTimer <= 0 &&
        st.poopedTimer <= 0 &&
        horizDist < 5.0 &&
        relBirdY >= 1.6 &&
        relBirdY <= 5.8
      ) {
        if (playerSpeed > 7.2) {
          if (st.guardPlateTimer <= 0 && st.voiceCooldown <= 0) {
            st.voiceCooldown = 2.2;
            this.audio.playHumanGrunt(h.headWorldPos, h.voicePitch, 'hmph');
          }
          st.guardPlateTimer = 1.85;
          h.lookAtTimer = 2.6;
          h.lookTarget.copy(playerPos);
        } else if (
          (playerMode === 'grounded' || playerMode === 'perched') &&
          playerSpeed < 3.4 &&
          h.seedCooldown <= 0
        ) {
          h.seedCooldown = 7.2;
          h.curiousTimer = 1.25;
          h.lookAtTimer = Math.max(h.lookAtTimer, 2.2);
          h.lookTarget.copy(playerPos);
          this.triggerBirdFeederToss(h, 1);
        }
      }

      // Reaction 2C: Context-Aware Citizen Reactions to Carried Contraband
      if (
        !isGuardVendor &&
        !h.drowsy &&
        !playerIndoors &&
        st.poopedTimer <= 0 &&
        h.shooTimer <= 0 &&
        horizDist < 11.5 &&
        Math.abs(relBirdY - 4.2) < 7.5
      ) {
        if (isCarryingBigPastry) {
          if (!h.config.guitar) {
            st.pointAtBirdTimer = Math.max(st.pointAtBirdTimer, 1.35);
            h.celebrateTimer = Math.max(h.celebrateTimer, 1.0);
          }
          h.lookAtTimer = Math.max(h.lookAtTimer, 1.8);
          h.lookTarget.copy(playerPos);
          if (st.petCooldown <= 0) {
            st.petCooldown = 7.0;
            this.audio.playHumanChuckle(h.headWorldPos, h.voicePitch);
          }
        } else if (isCarryingShiny) {
          if (h.curiousTimer <= 0 && st.voiceCooldown <= 0) {
            st.voiceCooldown = 4.2;
            this.audio.playHumanGrunt(h.headWorldPos, h.voicePitch, 'huh');
          }
          if (!h.config.guitar) {
            h.curiousTimer = Math.max(h.curiousTimer, 1.15);
          }
          h.lookAtTimer = Math.max(h.lookAtTimer, 1.8);
          h.lookTarget.copy(playerPos);
        }
      }

      // Reaction 2D: Plein-Air Sketchers & Artists Live Bird-Muse Tracking
      const isArtist =
        h.config.id === 'park_sketcher' ||
        h.config.id === 'stroller_quay_s' ||
        (h.config.id === 'painter' && !h.searchingBlindly);
      if (
        isArtist &&
        !isPerchedOnMe &&
        st.poopedTimer <= 0 &&
        h.shooTimer <= 0 &&
        (playerMode === 'perched' || playerMode === 'grounded') &&
        playerSpeed < 1.35 &&
        horizDist < 9.8 &&
        Math.abs(relBirdY - 3.4) < 6.8
      ) {
        st.museSketchTimer = 0.85;
        st.musePoseAccum += clampedDt;
        h.lookAtTimer = Math.max(h.lookAtTimer, 1.4);
        h.lookTarget.copy(playerPos);
        if (st.musePoseAccum >= 2.4) {
          st.musePoseAccum = 0;
          if (h.seedCooldown <= 0) {
            h.seedCooldown = 8.5;
            this.audio.playHumanPetCoo(h.headWorldPos, h.voicePitch);
            this.triggerBirdFeederToss(h, 2);
          }
        }
      } else if (st.musePoseAccum > 0) {
        st.musePoseAccum = Math.max(0, st.musePoseAccum - clampedDt * 0.5);
      }

      // Reaction 2E: Streetcar & Canal Launch Passing Salutes (+ Rooftop Rider Double-Take)
      if (
        !playerIndoors &&
        st.transitSaluteCooldown <= 0 &&
        !h.drowsy &&
        !h.config.guitar &&
        h.shooTimer <= 0 &&
        st.poopedTimer <= 0
      ) {
        if (Math.abs(h.root.position.z) < 25.5 && Math.abs(h.root.position.x - tramX) < 15.5) {
          st.transitSaluteCooldown = 14.0;
          h.lookAtTimer = 2.8;
          h.lookTarget.set(tramX, playerOnTram ? 20.8 : 13.5, 0);
          if (playerOnTram) {
            st.pointAtBirdTimer = 2.5;
            h.celebrateTimer = 2.2;
            if (horizDist < 18.0) {
              this.audio.playHumanChuckle(h.headWorldPos, h.voicePitch);
            }
          } else {
            h.waveTimer = Math.max(h.waveTimer, 1.9);
          }
        } else if (canalBoats && h.root.position.z < -26.0 && h.root.position.z > -86.0) {
          for (let bIdx = 0; bIdx < canalBoats.length; bIdx++) {
            const boat = canalBoats[bIdx];
            if (
              Math.abs(h.root.position.x - boat.xPos) < 16.0 &&
              Math.abs(h.root.position.z - boat.baseZ) < 22.0
            ) {
              st.transitSaluteCooldown = 14.0;
              h.lookAtTimer = 2.8;
              h.lookTarget.set(boat.xPos, 2.5, boat.baseZ);
              if (playerOnBoat) {
                st.pointAtBirdTimer = 2.5;
                h.celebrateTimer = 2.2;
                if (horizDist < 18.0) {
                  this.audio.playHumanChuckle(h.headWorldPos, h.voicePitch);
                }
              } else {
                h.waveTimer = Math.max(h.waveTimer, 1.9);
              }
              break;
            }
          }
        }
      }

      // Reaction 3: Gentle Petting Behavior — Friendly citizens crouch/lean & extend a hand to pet a calm Sparrow
      if (
        !isGuardVendor &&
        !h.drowsy &&
        h.startleTimer <= 0 &&
        h.shooTimer <= 0 &&
        st.peckedTimer <= 0 &&
        st.poopedTimer <= 0 &&
        st.guardPlateTimer <= 0 &&
        ((horizDist < 4.5 && Math.abs(playerPos.y - h.root.position.y) < 5.8 && playerSpeed < 6.5) ||
          isPerchedOnMe)
      ) {
        if (!h.config.guitar) {
          h.curiousTimer = 0.75;
          st.pettingTimer = 0.95;
        }
        h.lookAtTimer = Math.max(h.lookAtTimer, 1.5);
        h.lookTarget.copy(playerPos);

        if (st.petCooldown <= 0) {
          st.petCooldown = 5.8;
          this.audio.playHumanPetCoo(h.headWorldPos, h.voicePitch);
          _fxPos.set(playerPos.x, playerPos.y + 0.32, playerPos.z);
          this.fx.spawnBurst(_fxPos, 6, true, 2.2);
          if (h.seedCooldown <= 0 && !h.config.guitar) {
            h.seedCooldown = 6.5;
            this.triggerBirdFeederToss(h, 2);
          }
        }
      }

      let isActivelyWalking = false;

      // Active Shooing Step-Forward / Return Home + Yaw Restoration for all non-seated, non-patrolling standing NPCs
      const wps = h.config.patrolWaypoints;
      const isStandingStationary = !h.config.seated && (!wps || wps.length < 2);
      if (isStandingStationary) {
        const maxRadiusFromHome = h.config.id === 'chef' ? 6.8 : 3.2;

        if (h.shooTimer > 0 && h.hasChaseTarget) {
          _delta.set(
            h.chaseTarget.x - h.root.position.x,
            0,
            h.chaseTarget.z - h.root.position.z
          );
          const dist = _delta.length();
          const distFromHome = Math.hypot(
            h.root.position.x - h.homePos.x,
            h.root.position.z - h.homePos.z
          );
          const wantChase =
            !isPerchedOnMe &&
            (h.stationaryMoving
              ? dist > 0.95 && distFromHome < maxRadiusFromHome
              : dist > 1.35 && distFromHome < maxRadiusFromHome - 0.35);

          let steppedOut = false;
          if (wantChase && dist > 0.001) {
            _delta.divideScalar(dist);
            const clearAhead =
              playerIndoors ||
              this.isHumanPathClear(h.root.position, _delta, 2.55, h.colliderBody);
            if (clearAhead) {
              steppedOut = true;
              h.stationaryMoving = true;
              isActivelyWalking = true;
              const speed = 4.8;
              const step = Math.min(Math.max(0, dist - 0.85), speed * clampedDt);
              if (step > 0) {
                h.root.position.addScaledVector(_delta, step);
              }
              if (!playerIndoors) {
                _groundProbeOrigin.set(
                  h.root.position.x,
                  h.root.position.y + 2.8,
                  h.root.position.z
                );
                const groundCheck = this.physics.raycastGround(
                  _groundProbeOrigin,
                  _down,
                  5.8,
                  h.colliderBody,
                  _humanGroundHit,
                  WALK_RAY_MASK
                );
                if (
                  groundCheck.hit &&
                  groundCheck.body &&
                  groundCheck.body.mass === 0 &&
                  groundCheck.normal.y > 0.65
                ) {
                  h.root.position.y = groundCheck.point.y;
                }
              }
              this.syncHumanCollider(h);
              const desiredYaw = Math.atan2(_delta.x, _delta.z);
              let dY = desiredYaw - h.yaw;
              while (dY > Math.PI) dY -= Math.PI * 2;
              while (dY < -Math.PI) dY += Math.PI * 2;
              h.yaw += dY * Math.min(1, clampedDt * 6.5);
              h.root.rotation.y = h.yaw;
              h.gaitPhase += clampedDt * (speed * 1.45);
              this.applyWalkingGait(h, h.gaitPhase, propKind);
            }
          }

          if (!steppedOut) {
            h.stationaryMoving = false;
            if (horizDistSq > 0.04) {
              const desiredYaw = Math.atan2(dxPlayer, dzPlayer);
              let dY = desiredYaw - h.yaw;
              while (dY > Math.PI) dY -= Math.PI * 2;
              while (dY < -Math.PI) dY += Math.PI * 2;
              h.yaw += dY * Math.min(1, clampedDt * 6.5);
              h.root.rotation.y = h.yaw;
            }
          }
        } else {
          _delta.set(
            h.homePos.x - h.root.position.x,
            0,
            h.homePos.z - h.root.position.z
          );
          const distHome = _delta.length();
          const shouldReturn =
            !isPerchedOnMe &&
            (h.stationaryMoving ? distHome > 0.1 : distHome > 0.24);

          if (shouldReturn && distHome > 0.001) {
            h.stationaryMoving = true;
            isActivelyWalking = true;
            _delta.divideScalar(distHome);
            const speed = 3.4;
            const step = Math.min(distHome, speed * clampedDt);
            h.root.position.addScaledVector(_delta, step);
            if (!playerIndoors) {
              _groundProbeOrigin.set(
                h.root.position.x,
                h.root.position.y + 2.8,
                h.root.position.z
              );
              const groundCheck = this.physics.raycastGround(
                _groundProbeOrigin,
                _down,
                5.8,
                h.colliderBody,
                _humanGroundHit,
                WALK_RAY_MASK
              );
              if (
                groundCheck.hit &&
                groundCheck.body &&
                groundCheck.body.mass === 0 &&
                groundCheck.normal.y > 0.65
              ) {
                h.root.position.y = groundCheck.point.y;
              }
            }
            this.syncHumanCollider(h);
            const desiredYaw = Math.atan2(_delta.x, _delta.z);
            let dY = desiredYaw - h.yaw;
            while (dY > Math.PI) dY -= Math.PI * 2;
            while (dY < -Math.PI) dY += Math.PI * 2;
            h.yaw += dY * Math.min(1, clampedDt * 6.5);
            h.root.rotation.y = h.yaw;
            h.gaitPhase += clampedDt * (speed * 1.45);
            this.applyWalkingGait(h, h.gaitPhase, propKind);
          } else {
            h.stationaryMoving = false;
            if (!isPerchedOnMe && distHome > 0.0005) {
              h.root.position.x = h.homePos.x;
              h.root.position.z = h.homePos.z;
              this.syncHumanCollider(h);
            }
            if (h.shooTimer > 0 && horizDistSq > 0.04) {
              const desiredYaw = Math.atan2(dxPlayer, dzPlayer);
              let dY = desiredYaw - h.yaw;
              while (dY > Math.PI) dY -= Math.PI * 2;
              while (dY < -Math.PI) dY += Math.PI * 2;
              h.yaw += dY * Math.min(1, clampedDt * 6.5);
              h.root.rotation.y = h.yaw;
            } else if (
              st.pettingTimer <= 0 &&
              st.museSketchTimer <= 0 &&
              st.pointAtBirdTimer <= 0 &&
              !isPerchedOnMe
            ) {
              let dy = h.config.yaw - h.yaw;
              while (dy > Math.PI) dy -= Math.PI * 2;
              while (dy < -Math.PI) dy += Math.PI * 2;
              if (Math.abs(dy) > 0.0005) {
                h.yaw += dy * Math.min(1, clampedDt * 4.5);
                h.root.rotation.y = h.yaw;
              } else if (h.yaw !== h.config.yaw) {
                h.yaw = h.config.yaw;
                h.root.rotation.y = h.yaw;
              }
            }
          }
        }
      }

      // Neighborhood Strollers: Multi-waypoint patrol with polite flock-yielding & whisker steering
      if (wps && wps.length > 1) {
        const target = wps[h.waypointIdx];
        _delta.set(target.x - h.root.position.x, 0, target.z - h.root.position.z);
        const dist = _delta.length();

        // Conversational Stroller Yielding & Sidewalk Flock-Watching (#3)
        let birdBlockingFootpath = false;
        let detourAroundBird = false;
        if (!playerIndoors && h.shooTimer <= 0 && st.poopedTimer <= 0 && dist > 1.1) {
          const fwdX = Math.sin(h.yaw);
          const fwdZ = Math.cos(h.yaw);
          if (relBirdY < 1.85 && horizDist > 0.25 && horizDist < 4.2) {
            const dot = (dxPlayer * fwdX + dzPlayer * fwdZ) / horizDist;
            if (dot > 0.42) {
              birdBlockingFootpath = true;
              h.lookAtTimer = Math.max(h.lookAtTimer, 1.2);
              h.lookTarget.copy(playerPos);
            }
          }
          if (!birdBlockingFootpath) {
            for (let pIdx = 0; pIdx < this.pigeons.length; pIdx++) {
              const pg = this.pigeons[pIdx];
              if (pg.scatteredTimer > 0 || pg.bathTimer > 0) continue;
              const pdx = pg.mesh.root.position.x - h.root.position.x;
              const pdz = pg.mesh.root.position.z - h.root.position.z;
              const pdSq = pdx * pdx + pdz * pdz;
              if (pdSq > 0.09 && pdSq < 4.0 * 4.0) {
                const pd = Math.sqrt(pdSq);
                if ((pdx * fwdX + pdz * fwdZ) / pd > 0.42) {
                  birdBlockingFootpath = true;
                  h.lookAtTimer = Math.max(h.lookAtTimer, 1.2);
                  h.lookTarget.copy(pg.mesh.root.position);
                  break;
                }
              }
            }
          }
          if (birdBlockingFootpath) {
            if (st.yieldLingerAccum < 2.6) {
              st.yieldWatchTimer = 0.45;
              st.yieldLingerAccum += clampedDt;
            } else {
              detourAroundBird = true;
            }
          } else if (st.yieldLingerAccum > 0) {
            st.yieldLingerAccum = Math.max(0, st.yieldLingerAccum - clampedDt);
          }
        }

        const pauseForInteraction =
          isPerchedOnMe ||
          st.poopedTimer > 0 ||
          st.gaspTimer > 0.1 ||
          st.pointAtBirdTimer > 0.1 ||
          st.yieldWatchTimer > 0.05 ||
          st.museSketchTimer > 0.05 ||
          h.shooTimer > 0 ||
          st.pettingTimer > 0.1 ||
          h.startleTimer > 0.2 ||
          h.curiousTimer > 0.1 ||
          h.celebrateTimer > 0.2 ||
          h.waypointPauseTimer > 0;

        if (h.shooTimer > 0) {
          if (horizDistSq > 0.04) {
            const desiredYaw = Math.atan2(dxPlayer, dzPlayer);
            let dY = desiredYaw - h.yaw;
            while (dY > Math.PI) dY -= Math.PI * 2;
            while (dY < -Math.PI) dY += Math.PI * 2;
            h.yaw += dY * Math.min(1, clampedDt * 6.5);
            h.root.rotation.y = h.yaw;
          }
        } else if (dist < 1.1) {
          h.waypointIdx = (h.waypointIdx + 1) % wps.length;
          h.waypointPauseTimer = 0.8 + (h.waypointIdx % 2) * 0.7;
          h.hasCachedSteer = false;
        } else if (!pauseForInteraction) {
          _delta.divideScalar(dist);
          if (detourAroundBird) {
            const c = Math.cos(0.68);
            const s = Math.sin(0.68);
            const rx = _delta.x * c - _delta.z * s;
            const rz = _delta.x * s + _delta.z * c;
            _delta.set(rx, 0, rz).normalize();
            h.hasCachedSteer = false;
          }
          this.resolveWalkerSteer(h, _delta, 3.25, playerIndoors, horizDistSq);
          if (h.cachedSteerBlocked) {
            h.waypointIdx = (h.waypointIdx + 1) % wps.length;
            h.waypointPauseTimer = 0.65;
            h.hasCachedSteer = false;
          } else {
            isActivelyWalking = true;
            const moveDir = h.cachedSteerDir;
            const walkSpeed = h.config.walkSpeed ?? 3.85;
            h.root.position.addScaledVector(moveDir, walkSpeed * clampedDt);
            if (
              !playerIndoors &&
              (horizDistSq <= 55 * 55 || (this.frameCounter + h.steerFrameOffset) % 3 === 0)
            ) {
              _groundProbeOrigin.set(
                h.root.position.x,
                h.root.position.y + 2.8,
                h.root.position.z
              );
              const groundCheck = this.physics.raycastGround(
                _groundProbeOrigin,
                _down,
                5.8,
                h.colliderBody,
                _humanGroundHit,
                WALK_RAY_MASK
              );
              if (
                groundCheck.hit &&
                groundCheck.body &&
                groundCheck.body.mass === 0 &&
                groundCheck.normal.y > 0.65
              ) {
                h.root.position.y = groundCheck.point.y;
              }
            }

            this.syncHumanCollider(h);

            const desiredYaw = Math.atan2(moveDir.x, moveDir.z);
            let dY = desiredYaw - h.yaw;
            while (dY > Math.PI) dY -= Math.PI * 2;
            while (dY < -Math.PI) dY += Math.PI * 2;
            h.yaw += dY * Math.min(1, clampedDt * 5.8);
            h.root.rotation.y = h.yaw;

            h.gaitPhase += clampedDt * (walkSpeed * 1.48);
            this.applyWalkingGait(h, h.gaitPhase, propKind);
          }
        }
      }

      const inBuskerGroove =
        this.buskerGrooveTimer > 0 &&
        !h.drowsy &&
        h.shooTimer <= 0 &&
        st.poopedTimer <= 0 &&
        buskerHuman !== undefined &&
        h.root.position.distanceToSquared(buskerHuman.root.position) < 30.0 * 30.0;

      const hasActiveHumanReaction =
        isPerchedOnMe ||
        inBuskerGroove ||
        st.poopedTimer > 0 ||
        st.gaspTimer > 0 ||
        st.guardPlateTimer > 0 ||
        st.pointAtBirdTimer > 0 ||
        st.yieldWatchTimer > 0 ||
        st.museSketchTimer > 0 ||
        st.pettingTimer > 0 ||
        st.peckedTimer > 0 ||
        h.startleTimer > 0 ||
        h.shooTimer > 0 ||
        h.celebrateTimer > 0 ||
        h.waveTimer > 0 ||
        h.curiousTimer > 0 ||
        h.lookAtTimer > 0 ||
        h.searchingBlindly ||
        h.paintingActive ||
        h.strumming;

      if (
        !isActivelyWalking &&
        !hasActiveHumanReaction &&
        horizDistSq > 110 * 110 &&
        (this.frameCounter + h.steerFrameOffset) % 2 !== 0
      ) {
        continue;
      }

      const animDt =
        !isActivelyWalking && !hasActiveHumanReaction && horizDistSq > 110 * 110
          ? clampedDt * 2
          : clampedDt;

      // Smoothly settle legs when stationary or seated
      if (!isActivelyWalking) {
        if (h.config.seated) {
          const isGuitarist = Boolean(h.config.guitar || h.strumming);
          const grooveBoost = isGuitarist && (this.buskerGrooveTimer > 0 || h.celebrateTimer > 0 || isPerchedOnMe);
          const footTap = grooveBoost
            ? Math.max(0, Math.sin(elapsed * 7.4)) * 0.22
            : inBuskerGroove
              ? Math.sin(elapsed * 7.2 + h.idlePhase) * 0.15
              : isGuitarist
                ? Math.max(0, Math.sin(elapsed * 4.2)) * 0.14
                : h.config.idleActivity === 'reading'
                  ? Math.sin(elapsed * 3.6 + h.idlePhase) * 0.08
                  : 0;
          const seatHipRot = h.config.seatHipRotX ?? -1.42;
          const seatKneeRot = h.config.seatKneeRotX ?? 1.42;
          h.legLeft.hip.rotation.x = seatHipRot;
          h.legLeft.hip.rotation.z = isGuitarist ? -0.15 : 0;
          h.legLeft.knee.rotation.x = seatKneeRot;
          h.legLeft.ankle.rotation.x = isGuitarist ? 0.04 : footTap;
          h.legRight.hip.rotation.x = isGuitarist ? seatHipRot - 0.06 : seatHipRot;
          h.legRight.hip.rotation.z = isGuitarist ? 0.18 : 0;
          h.legRight.knee.rotation.x =
            h.config.seatKneeRotX !== undefined ? seatKneeRot : seatKneeRot - 0.02;
          h.legRight.ankle.rotation.x = isGuitarist ? -footTap : -footTap * 0.5;
          h.torsoPivot.position.y =
            h.baseHipY +
            Math.sin((grooveBoost || inBuskerGroove ? 7.2 : isGuitarist ? 4.2 : 1.8) * elapsed + h.idlePhase) *
              (grooveBoost || inBuskerGroove ? 0.055 : isGuitarist ? 0.035 : 0.025);
        } else {
          const lowBirdFactor = Math.max(0, Math.min(1, 1 - (playerPos.y - h.root.position.y) / 5.0));
          const poopedHop =
            st.poopedTimer > 3.75
              ? Math.sin(((4.2 - st.poopedTimer) / 0.45) * Math.PI) * 0.28
              : 0;
          const crouchAmt =
            st.poopedTimer > 3.65
              ? 0.34
              : h.startleTimer > 0
                ? Math.min(1, h.startleTimer * 2.5) * 0.36
                : st.pettingTimer > 0
                  ? Math.min(1, st.pettingTimer * 2.5) * (0.22 + lowBirdFactor * 0.34)
                  : st.yieldWatchTimer > 0
                    ? Math.min(1, st.yieldWatchTimer * 3.2) * 0.24
                    : h.curiousTimer > 0
                      ? Math.min(1, h.curiousTimer * 3.0) * 0.36
                      : 0;
          const grooveTap = inBuskerGroove ? Math.max(0, Math.sin(elapsed * 7.2 + h.idlePhase)) * 0.14 : 0;
          const targetHip = -crouchAmt * 0.58;
          const targetKnee = 0.04 + crouchAmt * 1.12 + grooveTap * 0.35;
          const targetAnkle = -crouchAmt * 0.48 - grooveTap;

          const legBlend = Math.min(1, animDt * 8);
          h.legLeft.hip.rotation.x += (targetHip - h.legLeft.hip.rotation.x) * legBlend;
          h.legRight.hip.rotation.x += (targetHip - h.legRight.hip.rotation.x) * legBlend;
          h.legLeft.knee.rotation.x += (targetKnee - h.legLeft.knee.rotation.x) * legBlend;
          h.legRight.knee.rotation.x += (0.04 + crouchAmt * 1.12 - h.legRight.knee.rotation.x) * legBlend;
          h.legLeft.ankle.rotation.x += (targetAnkle - h.legLeft.ankle.rotation.x) * legBlend;
          h.legRight.ankle.rotation.x += (-crouchAmt * 0.48 - h.legRight.ankle.rotation.x) * legBlend;

          const standDrop = crouchAmt * 0.72 - poopedHop;
          const breath =
            Math.sin((inBuskerGroove ? 7.2 : 1.9) * elapsed + h.idlePhase) *
            (inBuskerGroove ? 0.06 : 0.035);
          h.torsoPivot.position.y +=
            (h.baseHipY - standDrop + breath - h.torsoPivot.position.y) * legBlend;
          if (inBuskerGroove) {
            h.torsoPivot.rotation.z = Math.sin(elapsed * 3.6 + h.idlePhase) * 0.065;
          } else {
            h.torsoPivot.rotation.z *= 0.9;
          }
          h.torsoPivot.rotation.y +=
            (Math.sin(elapsed * 0.9 + h.idlePhase) * 0.04 - h.torsoPivot.rotation.y) *
            Math.min(1, animDt * 4);
        }
      }

      // Torso & Upper-Body Expressive States (Petting, Shooing, Pecked Flinch, Gasp, Guard, Point, Muse, Idle)
      const activity = h.config.idleActivity ?? 'none';
      if (st.poopedTimer > 0) {
        const poopedElapsed = 4.2 - st.poopedTimer;
        if (!h.config.seated && poopedElapsed > 1.75 && horizDistSq > 0.09) {
          const targetYaw = Math.atan2(dxPlayer, dzPlayer);
          let dy = targetYaw - h.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          h.yaw += dy * Math.min(1, animDt * 6.5);
          h.root.rotation.y = h.yaw;
        }
        if (poopedElapsed < 0.52) {
          // Stage 1: Startled freeze & hunch
          const jolt = Math.min(1, poopedElapsed * 6.0);
          h.torsoPivot.rotation.x = 0.24 * jolt;
          h.torsoPivot.rotation.z = Math.sin(poopedElapsed * 34.0) * 0.08;
          h.armLeft.shoulder.rotation.x = -1.45 * jolt;
          h.armLeft.shoulder.rotation.z = 0.32 * jolt;
          h.armLeft.elbow.rotation.x = -1.1 * jolt;
          h.armRight.shoulder.rotation.x = -1.55 * jolt;
          h.armRight.shoulder.rotation.z = -0.32 * jolt;
          h.armRight.elbow.rotation.x = -1.15 * jolt;
        } else if (poopedElapsed < 2.05) {
          // Stage 2: Disgusted reach up & scrub crown / hat brim
          const scrub = Math.sin(poopedElapsed * 15.5);
          const scrubCos = Math.cos(poopedElapsed * 15.5);
          const b8 = Math.min(1, animDt * 9);
          h.torsoPivot.rotation.x += (0.14 - h.torsoPivot.rotation.x) * b8;
          h.torsoPivot.rotation.z = scrub * 0.05;
          h.armRight.shoulder.rotation.x += (-2.42 - h.armRight.shoulder.rotation.x) * b8;
          h.armRight.shoulder.rotation.z = -0.26 + scrub * 0.22;
          h.armRight.elbow.rotation.x += (-1.58 + scrubCos * 0.18 - h.armRight.elbow.rotation.x) * b8;
          h.armRight.elbow.rotation.z = scrub * 0.16;
          h.armLeft.shoulder.rotation.x += (-0.75 - h.armLeft.shoulder.rotation.x) * b8;
          h.armLeft.shoulder.rotation.z *= 0.85;
          h.armLeft.elbow.rotation.x += (-0.95 - h.armLeft.elbow.rotation.x) * b8;
          h.headPivot.rotation.x = 0.26 + scrubCos * 0.05;
          h.headPivot.rotation.y = scrub * 0.14;
        } else {
          // Stage 3: Crane neck skyward glaring at the sparrow while shaking raised fist
          const shake = Math.sin(poopedElapsed * 14.5);
          const shakeCos = Math.cos(poopedElapsed * 14.5);
          const b7 = Math.min(1, animDt * 7.5);
          h.torsoPivot.rotation.x += (-0.12 - h.torsoPivot.rotation.x) * b7;
          h.torsoPivot.rotation.z = shake * 0.04;
          h.armRight.shoulder.rotation.x = -2.26 + shake * 0.28;
          h.armRight.shoulder.rotation.z = -0.18 + shakeCos * 0.14;
          h.armRight.elbow.rotation.x = -0.58 + shakeCos * 0.24;
          h.armRight.elbow.rotation.z = shake * 0.18;
          h.armLeft.shoulder.rotation.x += (-0.42 - h.armLeft.shoulder.rotation.x) * b7;
          h.armLeft.shoulder.rotation.z *= 0.85;
          h.armLeft.elbow.rotation.x += (-0.85 - h.armLeft.elbow.rotation.x) * b7;
        }
      } else if (h.drowsy) {
        h.torsoPivot.rotation.x = 0.24 + Math.sin(elapsed * 1.4) * 0.04;
        h.headPivot.rotation.x = 0.42 + Math.sin(elapsed * 1.4) * 0.08;
        h.armLeft.shoulder.rotation.x = -0.55;
        h.armLeft.elbow.rotation.x = -0.85;
        h.armRight.shoulder.rotation.x = -0.55;
        h.armRight.elbow.rotation.x = -0.85;
      } else if (h.config.guitar || h.strumming) {
        // Collision-verified seated acoustic guitarist kinematics (shoulder + elbow + articulated wrist):
        // - Left forearm drops cleanly underneath the neck (`gx < -0.32`) while wrist curls 4 fingers onto the strings
        // - Right forearm arches over the upper-right bass bout while wrist sweeps parallel to the spruce soundboard
        const grooveBoost = this.buskerGrooveTimer > 0 || h.celebrateTimer > 0 || isPerchedOnMe;
        const beatPhase = elapsed * (grooveBoost ? 7.4 : 4.2);
        const barIdx = Math.floor(elapsed * (grooveBoost ? 0.92 : 0.525));
        const isStrumSection = grooveBoost || Math.floor(barIdx / 4) % 2 === 1;
        const chordSlideOffsets = [0.0, -0.07, 0.08, 0.03];
        const targetChordShift = chordSlideOffsets[barIdx % 4];
        const bArm = Math.min(1, animDt * 9.5);
        const peckJolt = st.peckedTimer > 0 ? Math.sin(elapsed * 28.0) * 0.06 * Math.min(1, st.peckedTimer * 2.0) : 0;

        const gBreathX = Math.sin(beatPhase * 0.5) * 0.016;
        const gBreathY = Math.cos(beatPhase * 0.25) * 0.018;
        const gSwayZ =
          Math.sin(beatPhase * (grooveBoost ? 1.0 : 0.5)) * (grooveBoost ? 0.032 : 0.018);

        h.torsoPivot.rotation.x +=
          ((grooveBoost ? 0.1 : 0.08) + Math.sin(beatPhase * 0.5) * 0.03 - Math.abs(peckJolt) - h.torsoPivot.rotation.x) *
          bArm;
        h.torsoPivot.rotation.z =
          Math.sin(beatPhase * 0.5) * (grooveBoost ? 0.065 : 0.038) + peckJolt;
        h.torsoPivot.rotation.y = -0.06 + Math.cos(beatPhase * 0.25) * 0.035;

        if (h.guitarPivot) {
          h.guitarPivot.rotation.x = -0.08 + gBreathX;
          h.guitarPivot.rotation.y = 0.15 + gBreathY;
          h.guitarPivot.rotation.z = 1.1 + gSwayZ;
        }

        // Left Arm + Cozy Finger-less Fretting Mitten cradling underneath the mahogany neck
        const vibrato = Math.sin(elapsed * 16.5) * (grooveBoost ? 0.032 : 0.02);
        const fretDance = Math.sin(elapsed * 11.2) * 0.04;
        const targetLeftShX = 0.0 + targetChordShift * 0.1 + gBreathX * 0.4;
        const targetLeftShY = 0.22 + targetChordShift * 0.14;
        const targetLeftShZ = -0.26 + targetChordShift * 0.18 + gSwayZ * 0.35;
        const targetLeftElX = -1.6 - targetChordShift * 0.08;
        const targetLeftElY = -0.76 + vibrato * 0.35;
        const targetLeftElZ = -0.22;
        const targetLeftWrX = 0.18 + fretDance * 0.25;
        const targetLeftWrY = 0.35 + vibrato * 0.8;
        const targetLeftWrZ = 1.05;

        h.armLeft.shoulder.rotation.x += (targetLeftShX - h.armLeft.shoulder.rotation.x) * bArm;
        h.armLeft.shoulder.rotation.y += (targetLeftShY - h.armLeft.shoulder.rotation.y) * bArm;
        h.armLeft.shoulder.rotation.z += (targetLeftShZ - h.armLeft.shoulder.rotation.z) * bArm;
        h.armLeft.elbow.rotation.x += (targetLeftElX - h.armLeft.elbow.rotation.x) * bArm;
        h.armLeft.elbow.rotation.y += (targetLeftElY - h.armLeft.elbow.rotation.y) * bArm;
        h.armLeft.elbow.rotation.z += (targetLeftElZ - h.armLeft.elbow.rotation.z) * bArm;
        if (h.armLeft.wrist) {
          h.armLeft.wrist.rotation.x += (targetLeftWrX - h.armLeft.wrist.rotation.x) * bArm;
          h.armLeft.wrist.rotation.y += (targetLeftWrY - h.armLeft.wrist.rotation.y) * bArm;
          h.armLeft.wrist.rotation.z += (targetLeftWrZ - h.armLeft.wrist.rotation.z) * bArm;
        }

        // Right Arm + Articulated Strumming/Picking Wrist (sweeping parallel to the spruce soundboard)
        let strumSweep = 0;
        let pickPulse = 0;
        if (isStrumSection) {
          const sWave = Math.sin(beatPhase * 2.0);
          const sHarm = Math.sin(beatPhase * 4.0) * 0.28;
          strumSweep = (sWave + sHarm) * (grooveBoost ? 0.22 : 0.16);
          pickPulse = Math.cos(beatPhase * 2.0) * (grooveBoost ? 0.07 : 0.05);
        } else {
          strumSweep = Math.sin(elapsed * 13.2) * 0.055 + Math.cos(elapsed * 6.6) * 0.04;
          pickPulse = Math.sin(elapsed * 17.5) * 0.05;
        }

        const targetRightShX = -1.11 + gBreathX * 0.4;
        const targetRightShY = -0.4;
        const targetRightShZ = -0.06 + gSwayZ * 0.25;
        const targetRightElX = -0.43 + strumSweep * 0.08;
        const targetRightElY = -0.4;
        const targetRightElZ = -1.1 - strumSweep * 0.4;
        const targetRightWrX = 0.04 + pickPulse * 0.16;
        const targetRightWrY = strumSweep * 0.2;
        const targetRightWrZ = -0.4 - strumSweep * 0.56;

        h.armRight.shoulder.rotation.x += (targetRightShX - h.armRight.shoulder.rotation.x) * bArm;
        h.armRight.shoulder.rotation.y += (targetRightShY - h.armRight.shoulder.rotation.y) * bArm;
        h.armRight.shoulder.rotation.z += (targetRightShZ - h.armRight.shoulder.rotation.z) * bArm;
        h.armRight.elbow.rotation.x += (targetRightElX - h.armRight.elbow.rotation.x) * bArm;
        h.armRight.elbow.rotation.y += (targetRightElY - h.armRight.elbow.rotation.y) * bArm;
        h.armRight.elbow.rotation.z += (targetRightElZ - h.armRight.elbow.rotation.z) * bArm;
        if (h.armRight.wrist) {
          h.armRight.wrist.rotation.x += (targetRightWrX - h.armRight.wrist.rotation.x) * bArm;
          h.armRight.wrist.rotation.y += (targetRightWrY - h.armRight.wrist.rotation.y) * bArm;
          h.armRight.wrist.rotation.z += (targetRightWrZ - h.armRight.wrist.rotation.z) * bArm;
        }

        if (h.lookAtTimer <= 0) {
          const lookAtFrets =
            Math.sin(elapsed * 0.65) > -0.15 ? -0.36 - targetChordShift * 0.3 : 0.12;
          const headNod = Math.sin(beatPhase) * (grooveBoost ? 0.1 : 0.055);
          const bHead = Math.min(1, animDt * 4.5);
          h.headPivot.rotation.y += (lookAtFrets - h.headPivot.rotation.y) * bHead;
          h.headPivot.rotation.x += (0.2 + headNod - h.headPivot.rotation.x) * bHead;
          h.headPivot.rotation.z +=
            ((grooveBoost ? 0.1 : 0.07) * Math.sin(beatPhase * 0.5) - h.headPivot.rotation.z) *
            bHead;
        }
      } else if (st.peckedTimer > 0) {
        const pk = Math.min(1, st.peckedTimer * 2.4);
        h.torsoPivot.rotation.x = -0.22 * pk;
        h.torsoPivot.rotation.z = Math.sin(elapsed * 32) * 0.09 * pk;
        h.armLeft.shoulder.rotation.x = -1.75 * pk;
        h.armLeft.elbow.rotation.x = -1.25 * pk;
        h.armRight.shoulder.rotation.x = -1.85 * pk;
        h.armRight.elbow.rotation.x = -1.2 * pk;
      } else if (st.gaspTimer > 0) {
        // #11 Startled Hands-to-Cheeks Bystander Gasp
        const gp = Math.min(1, st.gaspTimer * 3.0);
        const b8 = Math.min(1, animDt * 9);
        h.torsoPivot.rotation.x += (-0.14 * gp - h.torsoPivot.rotation.x) * b8;
        h.armLeft.shoulder.rotation.x += (-1.78 * gp - h.armLeft.shoulder.rotation.x) * b8;
        h.armLeft.shoulder.rotation.z = -0.22 * gp;
        h.armLeft.elbow.rotation.x += (-1.48 * gp - h.armLeft.elbow.rotation.x) * b8;
        h.armRight.shoulder.rotation.x += (-1.78 * gp - h.armRight.shoulder.rotation.x) * b8;
        h.armRight.shoulder.rotation.z = 0.22 * gp;
        h.armRight.elbow.rotation.x += (-1.48 * gp - h.armRight.elbow.rotation.x) * b8;
      } else if (st.guardPlateTimer > 0) {
        // #1 Seated Patron Protective Cup/Plate Shielding
        const gd = Math.min(1, st.guardPlateTimer * 3.0);
        const b8 = Math.min(1, animDt * 8.5);
        h.torsoPivot.rotation.x += (0.24 * gd - h.torsoPivot.rotation.x) * b8;
        h.armLeft.shoulder.rotation.x += (-0.95 * gd - h.armLeft.shoulder.rotation.x) * b8;
        h.armLeft.shoulder.rotation.z = -0.32 * gd;
        h.armLeft.elbow.rotation.x += (-1.22 * gd - h.armLeft.elbow.rotation.x) * b8;
        h.armRight.shoulder.rotation.x += (-0.95 * gd - h.armRight.shoulder.rotation.x) * b8;
        h.armRight.shoulder.rotation.z = 0.32 * gd;
        h.armRight.elbow.rotation.x += (-1.22 * gd - h.armRight.elbow.rotation.x) * b8;
      } else if (h.startleTimer > 0) {
        const stAmt = Math.min(1, h.startleTimer * 2.2);
        h.torsoPivot.rotation.x = 0.26 * stAmt;
        h.armLeft.shoulder.rotation.x = -1.55 * stAmt;
        h.armLeft.elbow.rotation.x = -1.15 * stAmt;
        h.armRight.shoulder.rotation.x = -1.62 * stAmt;
        h.armRight.elbow.rotation.x = -1.1 * stAmt;
      } else if (h.shooTimer > 0) {
        h.torsoPivot.rotation.x = 0.16;
        const sweep = Math.sin(elapsed * 19.0);
        const sweepCos = Math.cos(elapsed * 19.0);
        h.armRight.shoulder.rotation.x = -1.95 + sweep * 0.52;
        h.armRight.shoulder.rotation.z = -0.25 + sweepCos * 0.28;
        h.armRight.elbow.rotation.x = -0.42 + sweepCos * 0.32;
        h.armLeft.shoulder.rotation.x = -1.85 - sweep * 0.52;
        h.armLeft.shoulder.rotation.z = 0.25 - sweepCos * 0.28;
        h.armLeft.elbow.rotation.x = -0.42 - sweepCos * 0.32;
      } else if (st.pointAtBirdTimer > 0) {
        // #2 & #13 Point-and-Cheer at Contraband Thief or Rooftop Transit Rider
        if (!h.config.seated && horizDistSq > 0.25) {
          const targetYaw = Math.atan2(
            h.lookTarget.x - h.root.position.x,
            h.lookTarget.z - h.root.position.z
          );
          let dy = targetYaw - h.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          h.yaw += dy * Math.min(1, animDt * 5.5);
          h.root.rotation.y = h.yaw;
        }
        const elev = Math.max(-0.5, Math.min(0.65, (h.lookTarget.y - (h.root.position.y + 6.5)) * 0.05));
        const b7 = Math.min(1, animDt * 7.5);
        h.torsoPivot.rotation.x += (-0.08 - h.torsoPivot.rotation.x) * b7;
        h.armRight.shoulder.rotation.x += (-1.52 - elev - h.armRight.shoulder.rotation.x) * b7;
        h.armRight.shoulder.rotation.z *= 0.85;
        h.armRight.elbow.rotation.x += (-0.14 - h.armRight.elbow.rotation.x) * b7;
        h.armLeft.shoulder.rotation.x = -1.78;
        h.armLeft.elbow.rotation.x = -0.75 + Math.sin(elapsed * 12.5) * 0.32;
      } else if (st.museSketchTimer > 0) {
        // #12 Plein-Air Sketcher / Artist Live Bird-Muse Sketching
        if (!h.config.seated && horizDistSq > 0.25) {
          const targetYaw = Math.atan2(dxPlayer, dzPlayer);
          let dy = targetYaw - h.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          h.yaw += dy * Math.min(1, animDt * 5.2);
          h.root.rotation.y = h.yaw;
        }
        h.torsoPivot.rotation.x = 0.1;
        h.armLeft.shoulder.rotation.x = -0.62;
        h.armLeft.elbow.rotation.x = -1.08;
        h.armRight.shoulder.rotation.x = -0.82 + Math.sin(elapsed * 11.8) * 0.18;
        h.armRight.elbow.rotation.x = -0.94 + Math.cos(elapsed * 11.8) * 0.22;
        if (Math.sin(elapsed * 3.4 + h.idlePhase) > 0.15) {
          h.lookAtTimer = 0; // Glance down at sketchpad/canvas half the beat
          h.headPivot.rotation.x = 0.32;
        }
      } else if (st.pettingTimer > 0) {
        h.armLeft.shoulder.rotation.z *= 0.85;
        h.armRight.shoulder.rotation.z *= 0.85;
        const pt = Math.min(1, st.pettingTimer * 2.4);
        const stroke = Math.sin(elapsed * 7.8) * 0.14;
        if (!h.config.seated && !isPerchedOnMe && horizDistSq > 0.25) {
          const targetYaw = Math.atan2(dxPlayer, dzPlayer);
          let dy = targetYaw - h.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          h.yaw += dy * Math.min(1, clampedDt * 4.5);
          h.root.rotation.y = h.yaw;
        }
        const reachShoulder = isPerchedOnMe
          ? -1.55
          : Math.max(-1.65, Math.min(-0.72, -0.78 - (relBirdY - 2.0) * 0.14));
        const reachElbow = isPerchedOnMe ? -1.18 + stroke : -0.42 + stroke;
        h.torsoPivot.rotation.x +=
          ((isPerchedOnMe ? -0.05 : 0.3 * pt) - h.torsoPivot.rotation.x) * Math.min(1, clampedDt * 7);
        h.armRight.shoulder.rotation.x +=
          (reachShoulder * pt - h.armRight.shoulder.rotation.x) * Math.min(1, clampedDt * 8);
        h.armRight.elbow.rotation.x +=
          (reachElbow * pt - h.armRight.elbow.rotation.x) * Math.min(1, clampedDt * 8);
        h.armRight.elbow.rotation.z = Math.cos(elapsed * 7.8) * 0.1 * pt;
      } else if (isPerchedOnMe) {
        const b6 = Math.min(1, clampedDt * 6);
        h.torsoPivot.rotation.x += (-0.08 - h.torsoPivot.rotation.x) * b6;
        h.armLeft.shoulder.rotation.x += (-1.05 - h.armLeft.shoulder.rotation.x) * b6;
        h.armLeft.elbow.rotation.x += (-1.15 - h.armLeft.elbow.rotation.x) * b6;
        h.armRight.shoulder.rotation.x += (-1.05 - h.armRight.shoulder.rotation.x) * b6;
        h.armRight.elbow.rotation.x += (-1.15 - h.armRight.elbow.rotation.x) * b6;
      } else if (h.celebrateTimer > 0 || h.waveTimer > 0) {
        h.torsoPivot.rotation.x *= 0.9;
        h.armRight.shoulder.rotation.x = -1.95;
        h.armRight.elbow.rotation.x = -0.78 + Math.sin(elapsed * 13.5) * 0.42;
        h.armRight.elbow.rotation.z = Math.sin(elapsed * 13.5) * 0.28;
        if (h.celebrateTimer > 0.6) {
          h.armLeft.shoulder.rotation.x = -1.85;
          h.armLeft.elbow.rotation.x = -0.75 - Math.sin(elapsed * 13.5) * 0.35;
        }
      } else if (!isActivelyWalking) {
        h.armLeft.shoulder.rotation.z *= 0.85;
        h.armRight.shoulder.rotation.z *= 0.85;
        h.armRight.elbow.rotation.z *= 0.85;
        if (h.curiousTimer > 0 || st.yieldWatchTimer > 0) {
          const ct = Math.min(1, Math.max(h.curiousTimer, st.yieldWatchTimer) * 2.8);
          const b6 = Math.min(1, clampedDt * 6);
          h.torsoPivot.rotation.x += (0.28 * ct - h.torsoPivot.rotation.x) * b6;
          h.armRight.shoulder.rotation.x += (-0.98 * ct - h.armRight.shoulder.rotation.x) * b6;
          h.armRight.elbow.rotation.x += (-0.46 * ct - h.armRight.elbow.rotation.x) * b6;
        } else if (h.searchingBlindly) {
          h.torsoPivot.rotation.x = 0.14;
          h.headPivot.rotation.y = Math.sin(elapsed * 1.8) * 0.55;
          h.armLeft.shoulder.rotation.x = -0.68 + Math.sin(elapsed * 2.6) * 0.18;
          h.armLeft.elbow.rotation.x = -0.75;
          h.armRight.shoulder.rotation.x = -0.68 - Math.sin(elapsed * 2.6) * 0.18;
          h.armRight.elbow.rotation.x = -0.75;
        } else if (h.paintingActive) {
          h.torsoPivot.rotation.x = 0.04;
          h.armLeft.shoulder.rotation.x = -0.52;
          h.armLeft.elbow.rotation.x = -0.95;
          h.armRight.shoulder.rotation.x = -1.08 + Math.sin(elapsed * 4.2) * 0.32;
          h.armRight.elbow.rotation.x = -0.62 + Math.cos(elapsed * 4.2) * 0.26;
        } else if (activity === 'reading') {
          h.torsoPivot.rotation.x = 0.08;
          h.armLeft.shoulder.rotation.x = -0.62;
          h.armLeft.elbow.rotation.x = -1.02;
          h.armRight.shoulder.rotation.x = -0.58 + Math.max(0, Math.sin(elapsed * 0.9 + h.idlePhase)) * -0.18;
          h.armRight.elbow.rotation.x = -0.98;
          if (h.lookAtTimer <= 0) {
            h.headPivot.rotation.x = 0.26 + Math.sin(elapsed * 1.1 + h.idlePhase) * 0.04;
            h.headPivot.rotation.y = Math.sin(elapsed * 0.8 + h.idlePhase) * 0.14;
          }
        } else if (activity === 'sketching') {
          h.torsoPivot.rotation.x = 0.12;
          h.armLeft.shoulder.rotation.x = -0.58;
          h.armLeft.elbow.rotation.x = -1.05;
          h.armRight.shoulder.rotation.x = -0.66 + Math.sin(elapsed * 5.2 + h.idlePhase) * 0.12;
          h.armRight.elbow.rotation.x = -0.96 + Math.cos(elapsed * 5.2 + h.idlePhase) * 0.14;
          if (h.lookAtTimer <= 0) {
            h.headPivot.rotation.x = 0.18 + Math.sin(elapsed * 1.4 + h.idlePhase) * 0.12;
          }
        } else if (activity === 'browsing' || activity === 'tending') {
          h.torsoPivot.rotation.x = 0.09 + Math.sin(elapsed * 1.5 + h.idlePhase) * 0.04;
          h.armLeft.shoulder.rotation.x = -0.42 + Math.sin(elapsed * 2.1 + h.idlePhase) * 0.16;
          h.armLeft.elbow.rotation.x = -0.78;
          h.armRight.shoulder.rotation.x = -0.54 - Math.sin(elapsed * 2.1 + h.idlePhase) * 0.22;
          h.armRight.elbow.rotation.x = -0.84 + Math.cos(elapsed * 2.1 + h.idlePhase) * 0.18;
          if (h.lookAtTimer <= 0) {
            h.headPivot.rotation.y = Math.sin(elapsed * 1.1 + h.idlePhase) * 0.28;
            h.headPivot.rotation.x = 0.14;
          }
        } else if (activity === 'conversing') {
          h.torsoPivot.rotation.x = 0.03;
          const g1 = Math.sin(elapsed * 2.8 + h.idlePhase);
          h.armLeft.shoulder.rotation.x = -0.35 + g1 * 0.22;
          h.armLeft.elbow.rotation.x = -0.72 + g1 * 0.18;
          h.armRight.shoulder.rotation.x = -0.42 - g1 * 0.24;
          h.armRight.elbow.rotation.x = -0.78 - g1 * 0.16;
        } else if (activity === 'watching_water') {
          h.torsoPivot.rotation.x = 0.16;
          h.armLeft.shoulder.rotation.x = -0.48;
          h.armLeft.elbow.rotation.x = -0.86;
          h.armRight.shoulder.rotation.x = -0.48;
          h.armRight.elbow.rotation.x = -0.86;
          if (h.lookAtTimer <= 0) {
            h.headPivot.rotation.x = 0.22;
            h.headPivot.rotation.y = Math.sin(elapsed * 0.7 + h.idlePhase) * 0.32;
          }
        } else {
          h.torsoPivot.rotation.x *= 0.9;
          const restShoulderL = propKind === 'bouquet' || propKind === 'baguette_bag' ? -0.38 : -0.08;
          const restElbowL = propKind === 'bouquet' || propKind === 'baguette_bag' ? -0.92 : -0.22;
          const restShoulderR = propKind === 'coffee_cup' ? -0.45 : -0.08;
          const restElbowR = propKind === 'coffee_cup' ? -1.02 : -0.22;
          const b5 = Math.min(1, clampedDt * 5);
          h.armLeft.shoulder.rotation.x +=
            (restShoulderL + Math.sin(elapsed * 1.6 + h.idlePhase) * 0.04 - h.armLeft.shoulder.rotation.x) *
            b5;
          h.armLeft.elbow.rotation.x += (restElbowL - h.armLeft.elbow.rotation.x) * b5;
          h.armRight.shoulder.rotation.x +=
            (restShoulderR - Math.sin(elapsed * 1.6 + h.idlePhase) * 0.04 - h.armRight.shoulder.rotation.x) *
            b5;
          h.armRight.elbow.rotation.x += (restElbowR - h.armRight.elbow.rotation.x) * b5;
        }
      }

      const inPoopedGlare = st.poopedTimer > 0 && st.poopedTimer <= 2.15;
      if (h.lookAtTimer > 0 && (!h.drowsy || inPoopedGlare) && st.poopedTimer <= 2.15) {
        _localLook.copy(h.lookTarget);
        h.torsoPivot.worldToLocal(_localLook);
        const yaw = Math.max(-0.88, Math.min(0.88, Math.atan2(_localLook.x, Math.max(0.45, _localLook.z))));
        const minPitch = inPoopedGlare ? -0.88 : -0.62;
        const pitch = Math.max(
          minPitch,
          Math.min(0.55, -Math.atan2(_localLook.y - 4.2, Math.hypot(_localLook.x, _localLook.z)))
        );
        const bLook = Math.min(1, animDt * 6.5);
        h.headPivot.rotation.y += (yaw - h.headPivot.rotation.y) * bLook;
        h.headPivot.rotation.x += (pitch - h.headPivot.rotation.x) * bLook;
        h.headPivot.rotation.z +=
          ((h.curiousTimer > 0 ? 0.14 : isPerchedOnMe ? -0.1 : 0) - h.headPivot.rotation.z) *
          Math.min(1, animDt * 6);
      } else if (
        !h.drowsy &&
        st.poopedTimer <= 0 &&
        !h.searchingBlindly &&
        activity === 'none' &&
        !h.config.guitar &&
        !h.strumming
      ) {
        h.headPivot.rotation.y *= 0.92;
        h.headPivot.rotation.x *= 0.92;
        h.headPivot.rotation.z *= 0.9;
      }

      // Refresh cached hat/shoulder/head world anchors once per frame per human
      h.perchDirty = true;
      this.refreshHumanWorldAnchors(h);
    }

    // 2. Update Scatterable Park Pigeon Flock (Food Scramble #8, Ledge Jostling #9, Fountain Birdbath #18)
    this.pigeonFoodScanTimer -= clampedDt;
    if (this.pigeonFoodScanTimer <= 0) {
      this.pigeonFoodScanTimer = 0.22;
      for (let i = 0; i < this.pigeons.length; i++) {
        const p = this.pigeons[i];
        if (p.scatteredTimer > 0 || p.bathTimer > 0) {
          p.foodTargetProp = null;
          continue;
        }
        let bestProp: InteractiveProp | null = null;
        let bestDistSq = 24.0 * 24.0;
        for (let k = 0; k < this.physics.props.length; k++) {
          const pr = this.physics.props[k];
          if (pr.consumed || pr.carried || pr.inWater) continue;
          if (
            pr.kind !== 'seed' &&
            pr.kind !== 'croissant' &&
            pr.kind !== 'baguette' &&
            pr.kind !== 'berry'
          ) {
            continue;
          }
          const px = pr.body.position.x;
          const py = pr.body.position.y;
          const pz = pr.body.position.z;
          if (px < -36.0 || py > 2.2) continue;
          const dxPlaza = px - 54.0;
          const dzPlaza = pz - 33.0;
          if (dxPlaza * dxPlaza + dzPlaza * dzPlaza > 28.0 * 28.0) continue;

          const dxP = px - p.mesh.root.position.x;
          const dzP = pz - p.mesh.root.position.z;
          const dSq = dxP * dxP + dzP * dzP;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestProp = pr;
          }
        }

        if (bestProp) {
          if (p.foodTargetProp !== bestProp) {
            p.foodTargetProp = bestProp;
            p.nibbleTimer = 0;
            p.nibbleCrumbAccum = 0;
          }
          const ang = (i / 6) * Math.PI * 2 + p.phase * 0.35;
          const fx = bestProp.body.position.x + Math.cos(ang) * 0.48;
          const fz = bestProp.body.position.z + Math.sin(ang) * 0.48;
          const fy = this.snapPigeonGroundY(fx, p.forageHome.y, fz, 0.408);
          p.forageTarget.set(fx, fy, fz);
          p.wanderTimer = 1.2;
        } else if (p.foodTargetProp) {
          p.foodTargetProp = null;
          p.nibbleTimer = 0;
          p.nibbleCrumbAccum = 0;
        }
      }
    }

    for (let i = 0; i < this.pigeons.length; i++) {
      const p = this.pigeons[i];
      if (p.jostleCooldown > 0) {
        p.jostleCooldown = Math.max(0, p.jostleCooldown - clampedDt);
      }

      if (
        p.foodTargetProp &&
        (p.foodTargetProp.consumed ||
          p.foodTargetProp.carried ||
          p.foodTargetProp.inWater ||
          p.foodTargetProp.body.position.y > 2.5 ||
          p.scatteredTimer > 0 ||
          p.bathTimer > 0)
      ) {
        p.foodTargetProp = null;
        p.nibbleTimer = 0;
        p.nibbleCrumbAccum = 0;
      }

      if (p.scatteredTimer <= 0) {
        const distSqToPlayer = p.mesh.root.position.distanceToSquared(playerPos);
        if (
          (distSqToPlayer < 38.0 && playerSpeed > 6.0) ||
          (distSqToPlayer < 11.5 && playerSpeed > 2.4)
        ) {
          this.scatterPigeonFlock(p.forageHome);
        }
        p.cooTimer -= clampedDt;
        if (p.cooTimer <= 0) {
          p.cooTimer = 32.0 + Math.random() * 44.0;
          if (!playerIndoors && p.mesh.root.position.distanceToSquared(playerPos) < 40.0 * 40.0) {
            this.audio.playPigeonCoo(p.mesh.root.position);
          }
        }
      } else {
        p.scatteredTimer = Math.max(0, p.scatteredTimer - clampedDt);
        p.bathTimer = 0;
      }

      // Fountain Rim Birdbath (#18): occasional cool-down splash on the lower fountain rim
      if (p.scatteredTimer <= 0 && !p.foodTargetProp) {
        if (p.bathTimer > 0) {
          p.bathTimer = Math.max(0, p.bathTimer - clampedDt);
        } else if (i % 2 === 0) {
          p.bathCooldown -= clampedDt;
          if (p.bathCooldown <= 0) {
            p.bathCooldown = 28.0 + Math.random() * 20.0;
            if (!playerIndoors && playerPos.distanceToSquared(p.forageHome) < 85.0 * 85.0) {
              const a = Math.random() * Math.PI * 2;
              p.bathSpot.set(48.0 + Math.cos(a) * 12.55, 2.82, 48.0 + Math.sin(a) * 12.55);
              p.bathTimer = 4.8;
              p.bathRippleAccum = 0.25;
            }
          }
        }
      }

      let dest = p.scatterPerch;
      if (p.scatteredTimer <= 0) {
        if (p.bathTimer > 0) {
          dest = p.bathSpot;
        } else if (p.foodTargetProp) {
          dest = p.forageTarget;
        } else {
          p.wanderTimer -= clampedDt;
          if (p.wanderTimer <= 0) {
            p.wanderTimer = 2.4 + Math.random() * 3.0;
            const a = Math.random() * Math.PI * 2;
            const r = 0.8 + Math.random() * 2.4;
            const tx = p.forageHome.x + Math.cos(a) * r;
            const tz = p.forageHome.z + Math.sin(a) * r;
            const ty = this.snapPigeonGroundY(tx, p.forageHome.y, tz, 0.408);
            p.forageTarget.set(tx, ty, tz);
          }
          dest = p.forageTarget;
        }
      }

      _toDest.subVectors(dest, p.mesh.root.position);
      const dist = _toDest.length();
      const isFlying =
        dist > 0.32 &&
        (p.scatteredTimer > 0 ||
          p.bathTimer > 0 ||
          Math.abs(p.mesh.root.position.y - dest.y) > 0.6);
      const isWalking = !isFlying && p.scatteredTimer <= 0 && p.bathTimer <= 0 && dist > 0.14;

      if (isFlying) {
        const spd = Math.min(19.0, Math.max(8.5, dist * 2.4));
        _toDest.divideScalar(dist);
        p.mesh.root.position.addScaledVector(_toDest, Math.min(dist, spd * clampedDt));
        if (dist > 3.0) p.mesh.root.position.y += 2.2 * clampedDt;
        p.mesh.root.rotation.y = Math.atan2(_toDest.x, _toDest.z);
      } else if (isWalking) {
        const walkSpd = p.foodTargetProp ? 3.85 : 2.2;
        _toDest.y = 0;
        const hLenSq = _toDest.lengthSq();
        if (hLenSq > 0.001) _toDest.divideScalar(Math.sqrt(hLenSq));
        p.mesh.root.position.addScaledVector(_toDest, Math.min(dist, walkSpd * clampedDt));
        const stepGroundY = this.snapPigeonGroundY(
          p.mesh.root.position.x,
          p.mesh.root.position.y,
          p.mesh.root.position.z,
          0.408
        );
        p.mesh.root.position.y += (stepGroundY - p.mesh.root.position.y) * Math.min(1, clampedDt * 14);
        p.mesh.root.rotation.y = Math.atan2(_toDest.x, _toDest.z);
      } else {
        p.mesh.root.position.copy(dest);
      }

      // Territorial Ledge Jostling (#9): grumbling coo & sideways shuffle when Sparrow crowds scatter ledge
      if (
        p.scatteredTimer > 0 &&
        !isFlying &&
        !playerIndoors &&
        playerMode === 'perched' &&
        p.jostleCooldown <= 0 &&
        p.mesh.root.position.distanceToSquared(playerPos) < 1.65 * 1.65
      ) {
        p.jostleCooldown = 4.5;
        this.audio.playPigeonCoo(p.mesh.root.position);
        this.fx.spawnFeatherBurst(p.mesh.root.position, 3, 1.8);
        let awayX = p.scatterPerch.x - playerPos.x;
        let awayZ = p.scatterPerch.z - playerPos.z;
        const awayLen = Math.hypot(awayX, awayZ);
        if (awayLen > 0.01) {
          awayX /= awayLen;
          awayZ /= awayLen;
        } else {
          awayX = Math.cos(p.phase);
          awayZ = Math.sin(p.phase);
        }
        _fxPos.set(
          p.scatterPerch.x + awayX * 0.75,
          p.scatterPerch.y,
          p.scatterPerch.z + awayZ * 0.75
        );
        this.snapBirdPositionToSurface(_fxPos, 0.408, _fxPos);
        if (Math.abs(_fxPos.y - p.scatterPerch.y) < 0.42) {
          p.scatterPerch.copy(_fxPos);
        }
      }

      // Active Food Nibbling (#8)
      const isNibbling = Boolean(p.foodTargetProp) && !isFlying && dist < 0.85;
      if (isNibbling && p.foodTargetProp) {
        const fdx = p.foodTargetProp.body.position.x - p.mesh.root.position.x;
        const fdz = p.foodTargetProp.body.position.z - p.mesh.root.position.z;
        if (fdx * fdx + fdz * fdz > 0.0004) {
          p.mesh.root.rotation.y = Math.atan2(fdx, fdz);
        }
        p.nibbleTimer += clampedDt;
        p.nibbleCrumbAccum += clampedDt;
        if (p.nibbleCrumbAccum >= 1.05) {
          p.nibbleCrumbAccum = 0;
          _fxPos.set(
            p.foodTargetProp.body.position.x,
            p.foodTargetProp.body.position.y + 0.12,
            p.foodTargetProp.body.position.z
          );
          this.fx.spawnBreadcrumbCrumbs(_fxPos);
        }
        if (p.foodTargetProp.kind === 'seed' && p.nibbleTimer >= 3.6) {
          const eaten = p.foodTargetProp;
          p.foodTargetProp = null;
          p.nibbleTimer = 0;
          this.physics.removeProp(eaten);
        }
      }

      // Settled Fountain Rim Birdbath (#18)
      const isBathingSettled = p.bathTimer > 0 && !isFlying;
      if (isBathingSettled) {
        p.mesh.root.rotation.y = Math.atan2(
          48.0 - p.mesh.root.position.x,
          48.0 - p.mesh.root.position.z
        );
        p.bathRippleAccum -= clampedDt;
        if (p.bathRippleAccum <= 0) {
          p.bathRippleAccum = 0.78;
          const ba = Math.atan2(p.bathSpot.z - 48.0, p.bathSpot.x - 48.0);
          _fxPos.set(48.0 + Math.cos(ba) * 11.2, 1.96, 48.0 + Math.sin(ba) * 11.2);
          this.fx.spawnWaterRipple(_fxPos, 0.55);
        }
      }

      const hopPhase = isWalking
        ? (elapsed * (p.foodTargetProp ? 4.1 : 2.6) + p.phase) % 1.0
        : 0;
      const peckLook = isBathingSettled
        ? Math.sin(elapsed * 7.5 + p.phase) > 0
          ? 0.46
          : 0.18
        : isNibbling
          ? Math.sin(elapsed * 11.5 + p.phase) > -0.1
            ? 0.48
            : 0.08
          : !isFlying && !isWalking && Math.sin(elapsed * 3.5 + p.phase) > 0.5
            ? 0.35
            : 0;
      _pigeonHeadLook.set(0, peckLook);

      const pigeonFarIdle =
        !isFlying &&
        !isWalking &&
        !isNibbling &&
        !isBathingSettled &&
        p.mesh.root.position.distanceToSquared(playerPos) > 95.0 * 95.0;
      if (pigeonFarIdle && (this.frameCounter + i) % 3 !== 0) {
        continue;
      }

      p.mesh.updatePose({
        dt: pigeonFarIdle ? clampedDt * 3 : clampedDt,
        elapsed: elapsed + p.phase,
        mode:
          isFlying
            ? 'flying'
            : p.scatteredTimer <= 0 && p.bathTimer <= 0
              ? 'grounded'
              : 'perched',
        isBraking: false,
        wingTuck: 0,
        bonkPhase: 0,
        dizzyState: 'none',
        perchGrip: 0.75,
        hopPhase,
        flapTimer:
          isFlying ? 0.6 : isBathingSettled || p.jostleCooldown > 3.8 ? 0.65 : 0,
        bankAngle: 0,
        pitchAngle: isFlying ? -0.18 : 0,
        chirpOpen: 0,
        carryingItem: false,
        headLookLocal: _pigeonHeadLook,
      });
    }

    // 3. Update Companion & Ambient District Songbirds (#9 Ledge Jostling, #10 Thermal Duets, #18 Birdbath, #19 Treasure Curiosity)
    const sinY = Math.sin(playerYaw);
    const cosY = Math.cos(playerYaw);
    const playerThermalLift =
      !playerIndoors && playerMode === 'flying' ? this.physics.sampleUpdraftLift(playerPos) : 0;
    if (playerThermalLift > 0) {
      let activeSurfers = 0;
      for (let i = 0; i < this.companions.length; i++) {
        if ((this.companions[i].thermalSurfTimer ?? 0) > 0.5) activeSurfers++;
      }
      if (activeSurfers < 2) {
        for (let i = 0; i < this.companions.length && activeSurfers < 2; i++) {
          const c = this.companions[i];
          if (!c.ambientWaypoints || c.flocking || (c.thermalSurfTimer ?? 0) > 0.5) continue;
          const dxT = c.mesh.root.position.x - playerPos.x;
          const dzT = c.mesh.root.position.z - playerPos.z;
          if (dxT * dxT + dzT * dzT < 56.0 * 56.0) {
            c.thermalSurfTimer = 5.2;
            activeSurfers++;
          }
        }
      }
    }

    for (let i = 0; i < this.companions.length; i++) {
      const c = this.companions[i];
      if (c.chirpAnimTimer && c.chirpAnimTimer > 0) {
        c.chirpAnimTimer = Math.max(0, c.chirpAnimTimer - clampedDt);
      }
      if (c.flutterGreetTimer && c.flutterGreetTimer > 0) {
        c.flutterGreetTimer = Math.max(0, c.flutterGreetTimer - clampedDt);
      }
      if (c.jostleCooldown && c.jostleCooldown > 0) {
        c.jostleCooldown = Math.max(0, c.jostleCooldown - clampedDt);
      }
      if (c.thermalSurfTimer && c.thermalSurfTimer > 0) {
        c.thermalSurfTimer = Math.max(0, c.thermalSurfTimer - clampedDt);
      }
      if (c.bathTimer && c.bathTimer > 0) {
        c.bathTimer = Math.max(0, c.bathTimer - clampedDt);
      }
      if (c.inspectTimer && c.inspectTimer > 0) {
        c.inspectTimer = Math.max(0, c.inspectTimer - clampedDt);
        if (c.inspectTimer <= 0) {
          c.inspectProp = null;
        }
      }

      // Upper Fountain Rim Birdbath (#18)
      const dxFountain = c.homePos.x - 48.0;
      const dzFountain = c.homePos.z - 48.0;
      const canUseFountainBath =
        !c.flocking &&
        (c.inspectTimer ?? 0) <= 0 &&
        (c.thermalSurfTimer ?? 0) <= 0 &&
        (c.id === 'fountain_robin' ||
          (Boolean(c.ambientWaypoints) && dxFountain * dxFountain + dzFountain * dzFountain < 62.0 * 62.0));
      if (canUseFountainBath && (c.bathTimer ?? 0) <= 0) {
        c.bathCooldown = (c.bathCooldown ?? 20.0) - clampedDt;
        if (c.bathCooldown <= 0) {
          c.bathCooldown = 30.0 + Math.random() * 22.0;
          if (!playerIndoors && playerPos.distanceToSquared(c.mesh.root.position) < 82.0 * 82.0) {
            const a = Math.random() * Math.PI * 2;
            if (!c.bathSpot) c.bathSpot = new THREE.Vector3();
            c.bathSpot.set(48.0 + Math.cos(a) * 6.05, 8.4, 48.0 + Math.sin(a) * 6.05);
            c.bathTimer = 4.3;
            c.bathRippleAccum = 0.2;
          }
        }
      }

      c.beaconTimer -= clampedDt;
      if (c.beaconTimer <= 0) {
        const isStarterBeacon = c.id === 'starter_tit' && !c.hasFlownToSquare && playerIndoors;
        const fullCooldown = isStarterBeacon
          ? 8.5 + Math.random() * 5.5
          : c.flocking
            ? 20.0 + Math.random() * 24.0
            : 22.0 + Math.random() * 26.0;

        const distSqToPlayer = c.mesh.root.position.distanceToSquared(playerPos);
        if (isStarterBeacon || distSqToPlayer < 72.0 * 72.0) {
          const muffleOutdoor = playerIndoors && c.mesh.root.position.x > -39.4;
          const played = this.audio.playCompanionChirp(
            c.voiceIndex,
            c.mesh.root.position,
            muffleOutdoor,
            false,
            false
          );
          if (played) {
            c.beaconTimer = fullCooldown;
            c.chirpAnimTimer = 0.28;

            if (isStarterBeacon || distSqToPlayer < 36.0 * 36.0) {
              _fxPos.set(
                c.mesh.root.position.x,
                c.mesh.root.position.y + 0.25,
                c.mesh.root.position.z
              );
              this.fx.spawnChirpRing(_fxPos, c.tintHex, isStarterBeacon ? 4.8 : 4.2);
            }

            // Rare gentle neighbor call-and-response after a conversational pause
            for (let j = 0; j < this.companions.length; j++) {
              if (j === i) continue;
              const other = this.companions[j];
              if (
                other.echoTimer <= 0 &&
                other.mesh.root.position.distanceToSquared(c.mesh.root.position) < 26.0 * 26.0 &&
                Math.random() < 0.08
              ) {
                other.echoTimer = 4.65 + Math.random() * 1.35;
                other.echoIsPlayerReply = false;
                break;
              }
            }
          } else {
            c.beaconTimer = 3.8 + Math.random() * 4.4;
          }
        } else {
          c.beaconTimer = fullCooldown;
        }
      }

      if (
        c.ambientWaypoints &&
        c.ambientWaypoints.length > 1 &&
        (c.bathTimer ?? 0) <= 0 &&
        (c.inspectTimer ?? 0) <= 0 &&
        (c.thermalSurfTimer ?? 0) <= 0
      ) {
        const playerNear =
          playerMode !== 'perched' && c.mesh.root.position.distanceToSquared(playerPos) < 2.8 * 2.8;
        c.ambientWaitTimer = (c.ambientWaitTimer ?? 3.0) - clampedDt;
        if (playerNear || c.ambientWaitTimer <= 0) {
          let nextIdx = ((c.ambientWpIdx ?? 0) + 1) % c.ambientWaypoints.length;
          for (let tryStep = 0; tryStep < c.ambientWaypoints.length; tryStep++) {
            const cand = c.ambientWaypoints[(nextIdx + tryStep) % c.ambientWaypoints.length];
            let occupied = false;
            for (let j = 0; j < this.companions.length; j++) {
              if (j === i) continue;
              const other = this.companions[j];
              if (
                other.targetPos.distanceToSquared(cand) < 1.75 * 1.75 ||
                other.mesh.root.position.distanceToSquared(cand) < 1.75 * 1.75
              ) {
                occupied = true;
                break;
              }
            }
            if (!occupied) {
              nextIdx = (nextIdx + tryStep) % c.ambientWaypoints.length;
              break;
            }
          }
          c.ambientWpIdx = nextIdx;
          c.targetPos.copy(
            this.resolveNonOverlappingBirdSpot(c.ambientWaypoints[c.ambientWpIdx], c.id)
          );
          c.ambientWaitTimer = 5.0 + Math.random() * 6.5;
          if (playerNear) {
            c.echoTimer = 0.12;
            c.echoIsPlayerReply = false;
          }
        }
      }

      if (c.echoTimer > 0) {
        c.echoTimer -= clampedDt;
        if (c.echoTimer <= 0) {
          const isPlayerReply = Boolean(c.echoIsPlayerReply);
          c.echoIsPlayerReply = false;
          const muffleOutdoor = playerIndoors && c.mesh.root.position.x > -39.4;
          const played = this.audio.playCompanionChirp(
            c.voiceIndex,
            c.mesh.root.position,
            muffleOutdoor,
            false,
            isPlayerReply
          );
          if (played) {
            c.chirpAnimTimer = 0.3;
            _fxPos.set(
              c.mesh.root.position.x,
              c.mesh.root.position.y + 0.25,
              c.mesh.root.position.z
            );
            this.fx.spawnChirpRing(_fxPos, c.tintHex, 6.2);
          }
        }
      }

      const isInspectingProp =
        !c.flocking &&
        (c.inspectTimer ?? 0) > 0 &&
        Boolean(c.inspectProp) &&
        !c.inspectProp!.consumed &&
        !c.inspectProp!.carried &&
        !c.inspectProp!.inWater;
      const isThermalSurfing = !c.flocking && !isInspectingProp && (c.thermalSurfTimer ?? 0) > 0;
      const isBathingBird =
        !c.flocking && !isInspectingProp && !isThermalSurfing && (c.bathTimer ?? 0) > 0 && Boolean(c.bathSpot);

      if (c.flocking) {
        if (c.flockHoverY === undefined) {
          c.flockHoverY = c.mesh.root.position.y;
        }
        if (playerSpeedSq > 9.0) {
          const slotY = playerPos.y + c.flockSlot.y;
          c.flockHoverY += (slotY - c.flockHoverY) * Math.min(1, clampedDt * 6.0);
          _companionDesired.set(
            playerPos.x - c.flockSlot.x * cosY + c.flockSlot.z * sinY,
            c.flockHoverY,
            playerPos.z + c.flockSlot.x * sinY + c.flockSlot.z * cosY
          );
        } else {
          const orbitAngle = elapsed * 1.15 + c.voiceIndex * 1.25;
          const orbitRadius = 2.6 + (c.voiceIndex % 3) * 0.75;
          const hoverTargetY =
            playerPos.y + 1.85 + Math.sin(elapsed * 1.7 + c.voiceIndex) * 0.45;
          c.flockHoverY += (hoverTargetY - c.flockHoverY) * Math.min(1, clampedDt * 2.4);
          _companionDesired.set(
            playerPos.x + Math.cos(orbitAngle) * orbitRadius,
            c.flockHoverY,
            playerPos.z + Math.sin(orbitAngle) * orbitRadius
          );
        }
      } else if (isInspectingProp && c.inspectProp) {
        c.flockHoverY = c.mesh.root.position.y;
        if (!c.inspectSpot) c.inspectSpot = new THREE.Vector3();
        const ia = c.voiceIndex * 1.9 + 0.5;
        _fxPos.set(
          c.inspectProp.body.position.x + Math.cos(ia) * 1.35,
          c.inspectProp.body.position.y + 0.35,
          c.inspectProp.body.position.z + Math.sin(ia) * 1.35
        );
        this.snapBirdPositionToSurface(_fxPos, 0.384, c.inspectSpot);
        _companionDesired.copy(c.inspectSpot);
      } else if (isThermalSurfing) {
        c.flockHoverY = c.mesh.root.position.y;
        const orbitAngle = elapsed * 1.65 + i * 2.1;
        const orbitRadius = 3.5 + (i % 2) * 1.2;
        const targetY = Math.max(10.0, playerPos.y + 1.2 + Math.sin(elapsed * 2.0 + i) * 1.3);
        _companionDesired.set(
          playerPos.x + Math.cos(orbitAngle) * orbitRadius,
          targetY,
          playerPos.z + Math.sin(orbitAngle) * orbitRadius
        );
      } else if (isBathingBird && c.bathSpot) {
        c.flockHoverY = c.mesh.root.position.y;
        _companionDesired.copy(c.bathSpot);
      } else {
        c.flockHoverY = c.mesh.root.position.y;
        _companionDesired.copy(c.targetPos);
      }

      _toDest.subVectors(_companionDesired, c.mesh.root.position);
      const dist = _toDest.length();
      const isFlying = dist > 0.25;

      // Friendly Ledge Jostling & Greeting (#9)
      if (
        !isFlying &&
        !c.flocking &&
        !isInspectingProp &&
        !isBathingBird &&
        c.id !== 'starter_tit' &&
        playerMode === 'perched' &&
        (c.jostleCooldown ?? 0) <= 0 &&
        c.mesh.root.position.distanceToSquared(playerPos) < 1.55 * 1.55
      ) {
        c.jostleCooldown = 4.5;
        c.flutterGreetTimer = 0.78;
        if (c.echoTimer <= 0) {
          c.echoTimer = 0.14;
          c.echoIsPlayerReply = true;
        }
        let awayX = c.targetPos.x - playerPos.x;
        let awayZ = c.targetPos.z - playerPos.z;
        const awayLen = Math.hypot(awayX, awayZ);
        if (awayLen > 0.01) {
          awayX /= awayLen;
          awayZ /= awayLen;
        } else {
          awayX = Math.cos(c.voiceIndex);
          awayZ = Math.sin(c.voiceIndex);
        }
        _fxPos.set(
          c.targetPos.x + awayX * 0.62,
          c.targetPos.y,
          c.targetPos.z + awayZ * 0.62
        );
        this.snapBirdPositionToSurface(_fxPos, 0.384, _fxPos);
        if (Math.abs(_fxPos.y - c.targetPos.y) < 0.36) {
          c.targetPos.copy(_fxPos);
          _companionDesired.copy(_fxPos);
        }
      }

      if (isFlying) {
        const speed = Math.min(18.5, Math.max(6.4, dist * 2.2));
        _toDest.divideScalar(dist);
        const arcBoost = !c.flocking && !isThermalSurfing && dist > 2.5 ? 0.25 : 0;
        c.mesh.root.position.addScaledVector(_toDest, Math.min(dist, speed * clampedDt));
        if (arcBoost > 0) {
          c.mesh.root.position.y += arcBoost * clampedDt * 4.0;
        }
        // Prevent flying companion birds from ever dipping through the Atelier hardwood floor or outdoor plaza slabs
        if (isInsideAtelier(c.mesh.root.position)) {
          if (c.mesh.root.position.y < 26.2 + 0.384) {
            c.mesh.root.position.y = 26.2 + 0.384;
          }
        } else {
          const inCanalTrench =
            c.mesh.root.position.x > -142 &&
            c.mesh.root.position.x < -15 &&
            c.mesh.root.position.z > -69 &&
            c.mesh.root.position.z < -39;
          const minOutdoorY = inCanalTrench ? -0.5 + 0.384 : 0.28 + 0.384;
          if (c.mesh.root.position.y < minOutdoorY) {
            c.mesh.root.position.y = minOutdoorY;
          }
        }
        c.mesh.root.rotation.y = Math.atan2(_toDest.x, _toDest.z);
      } else {
        if (isInspectingProp && c.inspectProp) {
          const tdx = c.inspectProp.body.position.x - _companionDesired.x;
          const tdz = c.inspectProp.body.position.z - _companionDesired.z;
          if (tdx * tdx + tdz * tdz > 0.0004) {
            c.mesh.root.rotation.y = Math.atan2(tdx, tdz);
          }
          if (!c.inspectChirpDone) {
            c.inspectChirpDone = true;
            if (c.echoTimer <= 0) {
              c.echoTimer = 0.12;
              c.echoIsPlayerReply = false;
            }
          }
        } else if (isBathingBird && c.bathSpot) {
          c.mesh.root.rotation.y = Math.atan2(
            48.0 - _companionDesired.x,
            48.0 - _companionDesired.z
          );
          c.bathRippleAccum = (c.bathRippleAccum ?? 0) - clampedDt;
          if (c.bathRippleAccum <= 0) {
            c.bathRippleAccum = 0.75;
            const ba = Math.atan2(c.bathSpot.z - 48.0, c.bathSpot.x - 48.0);
            _fxPos.set(48.0 + Math.cos(ba) * 5.1, 7.9, 48.0 + Math.sin(ba) * 5.1);
            this.fx.spawnWaterRipple(_fxPos, 0.45);
          }
        } else {
          _toPlayer.subVectors(playerPos, _companionDesired);
          if (_toPlayer.lengthSq() < 196) {
            c.mesh.root.rotation.y = Math.atan2(_toPlayer.x, _toPlayer.z);
          }
        }
        const yaw = c.mesh.root.rotation.y;
        c.mesh.root.position.set(
          _companionDesired.x - Math.sin(yaw) * 0.095,
          _companionDesired.y,
          _companionDesired.z - Math.cos(yaw) * 0.095
        );
      }

      const boundWave = (elapsed * 2.3 + c.voiceIndex * 0.37) % 1.0;
      const isBoundingTuck = isFlying && !isThermalSurfing && boundWave > 0.58;
      const activeHop =
        !isFlying &&
        (c.echoTimer > 0 ||
          (c.chirpAnimTimer ?? 0) > 0 ||
          (c.flutterGreetTimer ?? 0) > 0 ||
          isInspectingProp ||
          c.demoHopping)
          ? (elapsed * 3.8) % 1.0
          : 0;
      if (!isFlying && isInspectingProp) {
        _companionHeadLook.set(Math.sin(elapsed * 4.5 + c.voiceIndex) * 0.38, 0.34);
      } else if (!isFlying && isBathingBird) {
        _companionHeadLook.set(0, Math.sin(elapsed * 8.0 + c.voiceIndex) > 0 ? 0.44 : 0.16);
      } else {
        const peckLook =
          !isFlying && c.ambientWaypoints && Math.sin(elapsed * 4.2 + c.voiceIndex) > 0.55
            ? 0.38
            : 0;
        _companionHeadLook.set(0, peckLook);
      }

      const compChirpActive =
        c.echoTimer > 0 ||
        (c.chirpAnimTimer ?? 0) > 0 ||
        (c.flutterGreetTimer ?? 0) > 0 ||
        isInspectingProp ||
        isBathingBird ||
        Boolean(c.demoHopping);
      const compFarIdle =
        !isFlying &&
        !compChirpActive &&
        c.mesh.root.position.distanceToSquared(playerPos) > 95.0 * 95.0;
      if (compFarIdle && (this.frameCounter + i) % 3 !== 0) {
        continue;
      }

      c.mesh.updatePose({
        dt: compFarIdle ? clampedDt * 3 : clampedDt,
        elapsed: elapsed + c.voiceIndex * 1.3,
        mode: isFlying ? 'flying' : 'perched',
        isBraking: false,
        wingTuck: isBoundingTuck ? 1.0 : 0.0,
        bonkPhase: 0,
        dizzyState: 'none',
        perchGrip: 0.85,
        hopPhase: activeHop,
        flapTimer:
          isFlying && !isBoundingTuck
            ? isThermalSurfing
              ? 0.22
              : 0.5
            : !isFlying && (isBathingBird || (c.flutterGreetTimer ?? 0) > 0)
              ? 0.65
              : 0,
        bankAngle: isFlying && isThermalSurfing ? -0.36 : 0,
        pitchAngle: isFlying ? -0.15 : 0,
        chirpOpen: c.echoTimer > 0 || (c.chirpAnimTimer ?? 0) > 0 ? 1.0 : 0,
        carryingItem: false,
        headLookLocal: _companionHeadLook,
      });
    }
  }
}
