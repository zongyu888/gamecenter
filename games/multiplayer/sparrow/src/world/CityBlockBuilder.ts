import * as THREE from 'three/webgpu';
import * as CANNON from 'cannon-es';
import { PALETTE } from '../rendering/Palette.ts';
import {
  createPastelMaterial,
  createFoliageSwayMaterial,
  createWaterShimmerMaterial,
  createFountainFlowMaterial,
  createUnlitPastelFXMaterial,
} from '../rendering/StorybookMaterial.ts';
import {
  rbox,
  rcyl,
  smoothSphere,
  lathe,
  tube,
  taperedTube,
  transformGeo,
  mergeParts,
  buildOrganicTreeParts,
} from '../geometry/Sculptor.ts';
import type { PhysicsWorld, InteractiveProp, UpdraftZone } from '../physics/PhysicsWorld.ts';
import type { PerchSystem } from './PerchSystem.ts';
import type { WorldFX } from '../rendering/WorldFX.ts';
import type { NPCManager } from '../entities/NPCManager.ts';
import type { AcousticSoundtrack } from '../audio/AcousticSoundtrack.ts';
import type { CageKeepInBounds, ClosedWindowBarrier } from '../entities/SparrowController.ts';
import { PropFactory } from './PropFactory.ts';
import { isInsideAtelier } from './AtelierBounds.ts';
import {
  buildDetailedTownhouse,
  buildPitchedHipRoofGeo,
  type TownhouseSpec,
  type TownhouseBuildContext,
  type InteractiveWindowSpec,
} from './TownhouseBuilder.ts';
import {
  buildCitizenManifest,
  buildParkPigeonFlockManifest,
  buildCompanionBirdManifest,
} from './NPCManifest.ts';

export interface BuiltWorldHandles {
  starterSpawnPos: THREE.Vector3;
  starterSpawnYaw: number;
  cageBounds: CageKeepInBounds;
  windowBarrier: ClosedWindowBarrier;
  cageLatchPos: THREE.Vector3;
  chandelierPerchPos: THREE.Vector3;
  windowLatchPos: THREE.Vector3;
  windowPullRingPos: THREE.Vector3;
  atticWindowSillPos: THREE.Vector3;
  atticWindowExitPos: THREE.Vector3;
  setLatchReady: (ready: boolean) => void;
  isCageUnlatched: () => boolean;
  setWindowLatchReady: (ready: boolean) => void;
  isWindowBarUnlatched: () => boolean;
  isWindowUnlatched: () => boolean;
  tugWindowPullCord: (pullImpulse: number) => { barUnlatched: boolean; progress: number };
  pushWindowSashes: (
    birdPos: THREE.Vector3,
    birdVel: THREE.Vector3,
    isPeck?: boolean
  ) => boolean;
  getWindowOpenAngle: () => number;
  getTramX: () => number;
  getCanalBoats: () => ReadonlyArray<{ xPos: number; baseZ: number }>;
  applyAerodynamicWash: (
    birdPos: THREE.Vector3,
    birdVel: THREE.Vector3,
    strength: number
  ) => void;
  isInsideAttic: (pos: THREE.Vector3) => boolean;
  sleepyMugPos: THREE.Vector3;
  fountainJetUpdraft: UpdraftZone;
  guitarCasePos: THREE.Vector3;
  buskerPos: THREE.Vector3;
  painterEaselPos: THREE.Vector3;
  musicBoxPos: THREE.Vector3;
  skySanctuaryNestPos: THREE.Vector3;
  crownBellPos: THREE.Vector3;
  revealPortraitLayer: (step: number) => void;
  addVisualWeaveToSanctuaryNest: (index: number, hex?: number) => void;
  lightDistrictLantern: (index: number) => void;
  spawnHiddenNewspaperCoin: () => void;
  launchPaperAirplane: () => void;
  updateAnimatedProps: (dt: number, elapsed: number) => void;

  // Mischief & Deed Event Hooks
  onCoffeeCupToppled?: () => void;
  onPicnicBasketRaided?: () => void;
  onBicycleBellRung?: () => void;
  onGelatoToppled?: () => void;
  onApplePyramidToppled?: () => void;
  onBelfryBellRung?: () => void;
}

interface CanalBoatInstance {
  group: THREE.Group;
  body: CANNON.Body;
  baseZ: number;
  phaseOffset: number;
  speed: number;
  dir: number;
  xPos: number;
  yaw: number;
}

interface PinwheelInstance {
  rotor: THREE.Group;
  spinSpeed: number;
}

interface ClockDialRig {
  hourPivot: THREE.Group;
  minutePivot: THREE.Group;
}

type QuadrantKey = 'nw' | 'ne' | 'sw' | 'se';

const _upAxis = new THREE.Vector3(0, 1, 0);
const _boatQuat = new THREE.Quaternion();
const _fountainRipplePos = new THREE.Vector3();
const _tramSparkPos = new THREE.Vector3();
const _lanternOffsetA = new THREE.Vector3();
const _lanternOffsetB = new THREE.Vector3();
const _lanternEuler = new THREE.Euler();

function quadrantOf(x: number, z: number): QuadrantKey {
  if (z >= 0) {
    return x < 0 ? 'nw' : 'ne';
  }
  return x < 0 ? 'sw' : 'se';
}

/**
 * Constructs the Multi-Block European Neighborhood (~330 x 330 SU with 98–136 SU architecture vs ~11.2 SU citizens):
 * - NW Block: 4-Story Boulangerie-Patisserie, Parisian Artist's Conservatory Atelier, Cozy Brass Birdcage,
 *   Overhead Brass Pulley + Pull-Cord + Lift-Bar Hinged French Casement Windows, Pushable/Destructible Ceramics, and Sidewalk Bistro
 * - NE Block: Wrought-Iron Botanical Park, Tiered Limestone Fountain, Scatterable 6-Pigeon Flock,
 *   Copper Gazebo with Raid-able Picnic Basket, Busker, and 12 Botanical Sculpted Trees
 * - SW Block: Sunken Turquoise Canal, 2 Seamless Curved Stone Arch Bridges, 22-SU Cruising Canal Launches,
 *   4-Story Venetian Painter's Townhouse & Balcony, Gelateria, Florist, and Leaned Vintage Bicycles
 * - SE Block: Open-Air Farmers' Market with 6-Apple Pyramid, 4-Story Buttercup Bookshop & Terrace Music-Box,
 *   Roastery Chimney Thermal, and 136-SU Campanile Clocktower with Belfry Bell & Sky Sanctuary Nest
 */
export class CityBlockBuilder {
  private root = new THREE.Group();
  private mat: THREE.NodeMaterial;
  private foliageMat: THREE.NodeMaterial;
  private waterMat: THREE.NodeMaterial;
  private glowGoldMat: THREE.NodeMaterial;
  private lanternOffMat: THREE.NodeMaterial;
  private propFactory: PropFactory;
  private townhouseCtx: TownhouseBuildContext;

  private horizonParts: THREE.BufferGeometry[] = [];

  // Cozy Proportional Brass Birdcage (`center = (-74.5, 34.00, 52.0)`, `cageR = 2.68 SU`, porcelain tray top `y = 34.00`)
  private cageBounds: CageKeepInBounds = {
    center: new THREE.Vector3(-74.5, 34.0, 52.0),
    radius: 2.32,
    floorY: 34.384,
    ceilingY: 39.2,
    locked: true,
  };
  private windowBarrier: ClosedWindowBarrier = {
    xMax: -39.95,
    yMin: 26.0,
    yMax: 52.0,
    zMin: 40.0,
    zMax: 64.0,
    closed: true,
  };

  private cageDoorPivot = new THREE.Group();
  private cageGateSlideGroup = new THREE.Group();
  private cageLatchPivot = new THREE.Group();
  private cageLatchHalo!: THREE.Mesh;
  private cageLatchPecks = 0;
  private cageUnlatched = false;
  private cageDoorAngle = 0;
  private cageGateLiftY = 0;
  private cagePinSlideZ = 0;
  private cageLatchJiggle = 0;
  private cageAnimSettled = false;

  // Physics-Driven Overhead Brass Pulley + Pull-Cord + Lift-Bar + Hinged Casement Sashes
  private windowLeftPivot = new THREE.Group();
  private windowRightPivot = new THREE.Group();
  private windowLiftBarPivot = new THREE.Group();
  private windowPulleyWheel = new THREE.Group();
  private windowHoistPulleyWheel = new THREE.Group();
  private windowPullRingGroup = new THREE.Group();
  private windowPullCordMesh!: THREE.Mesh;
  private windowHoistCordMesh!: THREE.Mesh;
  private windowLatchHalo!: THREE.Mesh;
  private windowPullRingPos = new THREE.Vector3(-40.25, 37.8, 56.4);
  private windowBarUnlatched = false;
  private windowBarAngle = 0;
  private windowBarAngVel = 0;
  private windowBarSettled = false;
  private windowUnlatched = false;
  private windowOpenAngle = 0;
  private windowSashAngVel = 0;
  private windowSashSettled = false;
  private windowCreakCooldown = 0;

  private wallClockPendulum = new THREE.Group();
  private clockDialRigs: ClockDialRig[] = [];
  private sharedClockHourGeo: THREE.BufferGeometry | null = null;
  private sharedClockMinuteGeo: THREE.BufferGeometry | null = null;

  // Heritage Vintage Streetcar / Tram
  private tramGroup = new THREE.Group();
  private tramBody!: CANNON.Body;
  private tramX = -34.0;
  private tramPrevX = -34.0;

  // Animated NE Park Fountain Plume & Splash Ripples
  private fountainPlumeGroup = new THREE.Group();
  private fountainSpoutsGroup = new THREE.Group();
  private fountainRippleTimer = 0.25;
  private fountainPlumeScale = 1.0;
  private fountainUpdraftRef: UpdraftZone | null = null;

  private canalBoats: CanalBoatInstance[] = [];
  private pinwheels: PinwheelInstance[] = [];

  private postcardCarouselPivot = new THREE.Group();
  private postcardSpinVel = 0.65;
  private postcardCoinSpawned = false;

  private swingingSignPivot = new THREE.Group();
  private signAngle = 0;
  private signVel = 0;
  private signSettled = true;
  private signKeyDropped = false;
  private hangingKeyProp: InteractiveProp | null = null;
  private readonly pyramidApples: InteractiveProp[] = [];
  private appleAvalancheCascadeWoken = false;
  private appleAvalancheFired = false;

  private espressoLeverPivot = new THREE.Group();
  private espressoLeverPulled = false;
  private espressoLeverSettled = false;

  private picnicLidPivot = new THREE.Group();
  private picnicBasketOpened = false;
  private picnicLidSettled = true;

  private musicBoxLidPivot = new THREE.Group();
  private musicBoxOpen = false;
  private musicBoxLidSettled = true;

  private bellPivots: Array<{ group: THREE.Group; vel: number; angle: number; settled: boolean }> =
    [];
  private lanternPivots: Array<{
    group: THREE.Group;
    pivotPos: THREE.Vector3;
    angleX: number;
    angleZ: number;
    velX: number;
    velZ: number;
    settled: boolean;
  }> = [];
  private shutterWindows: Array<{
    id: string;
    worldPos: THREE.Vector3;
    flowerboxPos: THREE.Vector3 | null;
    leftHinge: THREE.Group;
    rightHinge: THREE.Group;
    glowPane: THREE.Mesh;
    open: boolean;
    angle: number;
    vel: number;
    settled: boolean;
  }> = [];
  private wireSpanOsc: Array<{
    amp: number;
    vel: number;
    glowTimer: number;
    bulbMesh: THREE.Mesh;
    settled: boolean;
  }> = [];
  private tramBellCooldown = 0;
  private tramCrossroadsCooldown = 2.5;
  private washFoleyCooldown = 0;
  private newspaperFlutter = 0;
  private portraitStrokes: THREE.Mesh[] = [];
  private districtLanternMeshes: THREE.Mesh[] = [];
  private sanctuaryNestSlots = new THREE.Group();

  private newspaperCoinSpawned = false;
  private newspaperMesh: THREE.Mesh | null = null;
  private applesToppledCount = 0;

  private handles!: BuiltWorldHandles;

  private readonly onBasinPropSplash = (prop: InteractiveProp): void => {
    let preserveForQuest = false;
    if (prop.kind === 'eyeglasses' || prop.kind === 'brass_key') {
      preserveForQuest = true;
    } else if (prop.kind === 'sugar_cube') {
      let remaining = 0;
      for (const p of this.physics.props) {
        if (p !== prop && !p.consumed && p.waterRespawnTimer === undefined && p.kind === 'sugar_cube') {
          remaining++;
        }
      }
      preserveForQuest = remaining < 1;
    } else if (prop.kind === 'shiny_coin') {
      let remaining = 0;
      for (const p of this.physics.props) {
        if (p !== prop && !p.consumed && p.waterRespawnTimer === undefined && p.kind === 'shiny_coin') {
          remaining++;
        }
      }
      preserveForQuest = remaining < 3;
    } else if (prop.kind === 'berry' || prop.kind === 'flower_sprig') {
      let remaining = 0;
      for (const p of this.physics.props) {
        if (
          p !== prop &&
          !p.consumed &&
          p.waterRespawnTimer === undefined &&
          (p.kind === 'berry' || p.kind === 'flower_sprig')
        ) {
          remaining++;
        }
      }
      preserveForQuest = remaining < 3;
    } else if (prop.isNestMaterial) {
      let remaining = 0;
      for (const p of this.physics.props) {
        if (p !== prop && !p.consumed && p.waterRespawnTimer === undefined && p.isNestMaterial) {
          remaining++;
        }
      }
      preserveForQuest = remaining < 4;
    }
    this.physics.vanishPropIntoWater(prop, preserveForQuest);
  };

  constructor(
    private scene: THREE.Scene,
    private physics: PhysicsWorld,
    private perches: PerchSystem,
    private fx: WorldFX,
    private npcs: NPCManager,
    private audio: AcousticSoundtrack
  ) {
    this.scene.add(this.root);
    this.mat = createPastelMaterial({ vertexColors: true });
    this.foliageMat = createFoliageSwayMaterial(0.16, 1.55);
    this.waterMat = createWaterShimmerMaterial();
    this.glowGoldMat = createPastelMaterial({
      color: PALETTE.goldGlow,
      vertexColors: false,
      emissiveHex: PALETTE.goldGlow,
      emissiveIntensity: 0.45,
    });
    this.lanternOffMat = createPastelMaterial({
      color: PALETTE.wallLimestone,
      vertexColors: false,
    });

    this.propFactory = new PropFactory(this.root, this.physics, this.mat, this.glowGoldMat);
    this.townhouseCtx = {
      root: this.root,
      mat: this.mat,
      physics: this.physics,
      perches: this.perches,
      createBouncyAwning: (id, center, halfExtents, stripeA, stripeB, bounceSpeed) =>
        this.createBouncyAwning(id, center, halfExtents, stripeA, stripeB, bounceSpeed),
      onFlowerboxSillCreated: (seg, center) => {
        seg.onLand = (_t, speed) => {
          if (speed > 2.6) {
            this.fx.spawnPetalBurst(center, speed > 6.8 ? 9 : 5, 2.9);
          }
        };
      },
      registerInteractiveWindow: (win) => this.registerInteractiveWindow(win),
    };
  }

  public async build(
    onProgress?: (percent: number) => Promise<void>
  ): Promise<BuiltWorldHandles> {
    if (onProgress) await onProgress(18);
    this.buildMultiBlockGroundAndAvenues();
    this.buildMovingVintageTram();

    if (onProgress) await onProgress(36);
    const nw = this.buildNWPatisserieAndIndoorAtticStudio();

    if (onProgress) await onProgress(52);
    const ne = this.buildNEBotanicalParkAndFountain();

    if (onProgress) await onProgress(68);
    const sw = this.buildSWSunkenCanalAndPainterTerrace();

    if (onProgress) await onProgress(82);
    const se = this.buildSEMarketBookshopAndClocktower();

    if (onProgress) await onProgress(88);
    await this.buildPerimeterTownhouseSkylineAndStreetFurniture(onProgress);
    this.buildCatenaryWiresNetwork();

    if (onProgress) await onProgress(94);
    await this.populateCharactersAndGroundedFlock(se.sanctuaryPos, nw.windowSillPos, onProgress);

    this.npcs.spawnSeedBurstAt = (origin, dir, count) => {
      for (let i = 0; i < count; i++) {
        const pos = origin.clone().add(new THREE.Vector3((i - 1) * 0.45, i * 0.18, 0));
        const p = this.propFactory.spawnSeed(pos);
        p.body.velocity.set(
          dir.x * (4.8 + i * 1.1) + (Math.random() - 0.5) * 2.0,
          5.4 + i * 0.8,
          dir.z * (4.8 + i * 1.1) + (Math.random() - 0.5) * 2.0
        );
      }
      this.fx.spawnBreadcrumbCrumbs(origin, 6);
    };

    this.npcs.spawnFlowerGiftAt = (origin) => {
      const p = this.propFactory.spawnPigmentFlower(origin, PALETTE.tulipCoral);
      p.body.velocity.set(3.2, 4.8, 3.2);
      this.fx.spawnBurst(origin, 8, true, 3.5);
    };

    this.handles = {
      starterSpawnPos: nw.spawnPos,
      starterSpawnYaw: Math.PI * 0.5, // Facing +X across the Conservatory Atelier toward the sunlit French window
      cageBounds: this.cageBounds,
      windowBarrier: this.windowBarrier,
      cageLatchPos: nw.latchPos,
      chandelierPerchPos: nw.chandelierPerchPos,
      windowLatchPos: nw.windowLatchPos,
      windowPullRingPos: this.windowPullRingPos,
      atticWindowSillPos: nw.windowSillPos,
      atticWindowExitPos: nw.windowExitPos,
      setLatchReady: (ready: boolean) => {
        this.cageLatchHalo.visible = ready && !this.cageUnlatched;
      },
      isCageUnlatched: () => this.cageUnlatched,
      setWindowLatchReady: (ready: boolean) => {
        this.windowLatchHalo.visible = ready && !this.windowBarUnlatched;
      },
      isWindowBarUnlatched: () => this.windowBarUnlatched,
      isWindowUnlatched: () => this.windowUnlatched,
      tugWindowPullCord: (pullImpulse: number) => this.tugWindowPullCord(pullImpulse),
      pushWindowSashes: (birdPos: THREE.Vector3, birdVel: THREE.Vector3, isPeck = false) =>
        this.pushWindowSashes(birdPos, birdVel, isPeck),
      getWindowOpenAngle: () => this.windowOpenAngle,
      getTramX: () => this.tramX,
      getCanalBoats: () => this.canalBoats,
      applyAerodynamicWash: (birdPos: THREE.Vector3, birdVel: THREE.Vector3, strength: number) =>
        this.applyAerodynamicWash(birdPos, birdVel, strength),
      isInsideAttic: isInsideAtelier,
      sleepyMugPos: nw.sleepyMugPos,
      fountainJetUpdraft: ne.fountainUpdraft,
      guitarCasePos: ne.guitarCasePos,
      buskerPos: ne.buskerPos,
      painterEaselPos: sw.painterEaselPos,
      musicBoxPos: se.musicBoxPos,
      skySanctuaryNestPos: se.sanctuaryPos,
      crownBellPos: se.crownBellPos,
      revealPortraitLayer: (step: number) => {
        for (let i = 0; i < Math.min(this.portraitStrokes.length, step * 3); i++) {
          this.portraitStrokes[i].visible = true;
        }
      },
      addVisualWeaveToSanctuaryNest: (index: number, hex = PALETTE.goldGlow) => {
        const angle = index * 1.45;
        const r = 1.92;
        const ornament = new THREE.Mesh(
          smoothSphere(0.34, hex, 16, 12, [1.4, 0.75, 0.9]),
          this.mat
        );
        ornament.castShadow = true;
        ornament.receiveShadow = true;
        ornament.position.set(Math.cos(angle) * r, 0.48 + (index % 2) * 0.14, Math.sin(angle) * r);
        ornament.rotation.y = -angle;
        this.sanctuaryNestSlots.add(ornament);
      },
      lightDistrictLantern: (index: number) => {
        const m = this.districtLanternMeshes[index];
        if (m) m.material = this.glowGoldMat;
      },
      spawnHiddenNewspaperCoin: () => {
        if (this.newspaperCoinSpawned) return;
        this.newspaperCoinSpawned = true;
        if (this.newspaperMesh) {
          this.newspaperMesh.rotation.z = 0.28;
          this.newspaperMesh.position.y += 0.18;
        }
        const coin = this.propFactory.spawnCoin(new THREE.Vector3(-25.2, 5.85, 31.2));
        coin.body.velocity.set(2.4, 5.2, 1.8);
      },
      launchPaperAirplane: () => {
        this.musicBoxOpen = true;
        this.musicBoxLidSettled = false;
        const launchOrigin = se.musicBoxPos.clone().add(new THREE.Vector3(-1.4, 1.6, 1.4));
        this.propFactory.spawnGlidingPaperAirplane(
          launchOrigin,
          new THREE.Vector3(-10.5, 4.8, 9.2)
        );
      },
      updateAnimatedProps: (dt: number, elapsed: number) => this.updateAnimatedProps(dt, elapsed),
    };

    this.updateAnimatedProps(0.016, 0);
    return this.handles;
  }

  private triggerCageUnlatch(latchPos: THREE.Vector3): void {
    if (this.cageUnlatched) return;
    this.cageLatchPecks++;
    this.cageLatchJiggle = 1.0;
    this.cageAnimSettled = false;

    if (this.cageLatchPecks < 2) {
      // 1st close-range peck slides the brass hairpin halfway out of its keeper loop
      this.audio.playPeckTap('metal');
      this.fx.spawnBurst(latchPos, 5, true, 2.4);
      return;
    }

    this.cageUnlatched = true;
    this.cageBounds.locked = false;
    this.cageLatchHalo.visible = false;
    this.audio.playCageUnlatch();
    this.fx.spawnChirpRing(latchPos, PALETTE.goldGlow, 5.4);
    this.fx.spawnBurst(latchPos, 10, true, 3.4);
  }

  private tugWindowPullCord(pullImpulse: number): { barUnlatched: boolean; progress: number } {
    if (this.windowBarUnlatched) {
      return { barUnlatched: true, progress: 1.0 };
    }

    this.windowBarSettled = false;
    const addedVel = Math.max(0.08, pullImpulse) * 0.34;
    this.windowBarAngVel = Math.min(2.6, this.windowBarAngVel + addedVel);
    this.windowBarAngle = Math.min(0.58, this.windowBarAngle + Math.min(0.18, pullImpulse * 0.078));

    if (this.windowCreakCooldown <= 0) {
      this.windowCreakCooldown = 0.18;
      this.audio.playPulleyCreak(Math.min(1, 0.45 + this.windowBarAngle * 1.4));
    }

    if (this.windowBarAngle >= 0.54) {
      this.windowBarAngle = 0.56;
      this.windowBarAngVel = 0;
      this.windowBarUnlatched = true;
      this.windowLatchHalo.visible = false;
      // Lift-bar clears the sash catch hooks & pops casement sashes ajar
      this.windowOpenAngle = Math.max(this.windowOpenAngle, 0.16);
      this.windowSashAngVel = Math.max(this.windowSashAngVel, 0.55);
      this.windowSashSettled = false;
      this.audio.playCageUnlatch();
      this.audio.triggerCelestaBell(987.77, 0.15);
      this.fx.spawnChirpRing(new THREE.Vector3(-39.0, 39.5, 52.0), PALETTE.goldGlow, 7.2);
      this.fx.spawnBurst(this.windowPullRingPos, 9, true, 3.2);
    }

    return {
      barUnlatched: this.windowBarUnlatched,
      progress: Math.min(1, this.windowBarAngle / 0.55),
    };
  }

  private pushWindowSashes(
    birdPos: THREE.Vector3,
    birdVel: THREE.Vector3,
    isPeck = false
  ): boolean {
    if (!this.windowBarUnlatched || this.windowOpenAngle >= 1.32) return false;
    if (
      birdPos.x < -41.4 ||
      birdPos.x > -36.6 ||
      birdPos.y < 30.6 ||
      birdPos.y > 48.0 ||
      birdPos.z < 43.3 ||
      birdPos.z > 60.7
    ) {
      return false;
    }

    const pushSpeedX = isPeck ? 6.5 : Math.max(0, birdVel.x);
    if (!isPeck && pushSpeedX < 1.35) {
      return false;
    }

    const torqueBoost = isPeck ? 1.85 : Math.min(2.4, 0.35 + pushSpeedX * 0.18);
    this.windowSashAngVel = Math.min(3.6, this.windowSashAngVel + torqueBoost);
    this.windowSashSettled = false;

    if (this.windowCreakCooldown <= 0) {
      this.windowCreakCooldown = 0.22;
      this.audio.playPulleyCreak(0.65);
      if (isPeck) {
        this.fx.spawnBurst(birdPos, 5, false, 2.2);
      }
    }

    if (this.windowOpenAngle >= 0.65 && !this.windowUnlatched) {
      this.completeWindowSwingOpen();
    }
    return true;
  }

  private completeWindowSwingOpen(): void {
    if (this.windowUnlatched) return;
    this.windowUnlatched = true;
    this.windowSashSettled = false;
    this.windowBarrier.closed = false;
    this.windowLatchHalo.visible = false;
    this.audio.triggerCelestaBell(1046.5, 0.16);
    this.fx.spawnChirpRing(new THREE.Vector3(-38.6, 36.2, 52.0), PALETTE.goldGlow, 9.5);
  }

  // ==========================================================================
  // 1. Multi-Block Ground, Cross-Avenues, Tram Tracks & Sunken Canal Cutout
  // ==========================================================================

  private buildMultiBlockGroundAndAvenues(): void {
    // Physics ground slabs arranged cleanly around the SW sunken canal trench (x: -140..-16, z: -68..-40)
    this.physics.addStaticBox(new THREE.Vector3(0, -2.0, 66.0), new THREE.Vector3(174.0, 2.0, 106.0));
    this.physics.addStaticBox(new THREE.Vector3(79.0, -2.0, -106.0), new THREE.Vector3(95.0, 2.0, 66.0));
    this.physics.addStaticBox(new THREE.Vector3(-95.0, -2.0, -120.0), new THREE.Vector3(79.0, 2.0, 52.0));
    this.physics.addStaticBox(new THREE.Vector3(-157.0, -2.0, -54.0), new THREE.Vector3(17.0, 2.0, 14.0));
    // Sunken Canal Bed (`y = -2.2`)
    this.physics.addStaticBox(new THREE.Vector3(-78.0, -3.2, -54.0), new THREE.Vector3(62.0, 1.0, 14.0));

    // Lush rolling green countryside meadow skirt outside the stone city perimeter (`±186 SU`) -> merged into `horizonHillsMesh`
    this.horizonParts.push(
      transformGeo(rbox(920, 0.5, 920, 0.08, PALETTE.grassMeadow, 1), {
        pos: [0, -2.85, 0],
      }),
      transformGeo(rbox(376, 0.45, 376, 0.12, PALETTE.plazaSand, 1), {
        pos: [0, -2.3, 0],
      })
    );

    const quadGround: Record<QuadrantKey, THREE.BufferGeometry[]> = {
      nw: [],
      ne: [],
      sw: [],
      se: [],
    };

    // Asphalt Boulevards (`32 SU` wide, top `y = 0.03`) split into the 4 quadrants without coplanar overlap
    quadGround.sw.push(
      transformGeo(rbox(220, 0.5, 32, 0.08, PALETTE.asphaltLavender, 1), {
        pos: [-110, -0.22, 0],
      })
    );
    quadGround.ne.push(
      transformGeo(rbox(220, 0.5, 32, 0.08, PALETTE.asphaltLavender, 1), {
        pos: [110, -0.22, 0],
      })
    );
    quadGround.nw.push(
      transformGeo(rbox(32, 0.5, 204, 0.08, PALETTE.asphaltLavender, 1), {
        pos: [0, -0.22, 118],
      })
    );
    quadGround.se.push(
      transformGeo(rbox(32, 0.5, 204, 0.08, PALETTE.asphaltLavender, 1), {
        pos: [0, -0.22, -118],
      })
    );

    // NW Café & Boulangerie Sidewalk Plaza (`x: -154..-16, z: 16..154`, top `y = 0.28`) + Raised Rose Stone Terrace (`top = 0.35`)
    quadGround.nw.push(
      transformGeo(rbox(138, 0.56, 138, 0.24, PALETTE.plazaCream, 1), {
        pos: [-85, 0.0, 85],
      }),
      transformGeo(rbox(22, 0.14, 68, 0.06, PALETTE.plazaRoseStone, 1), {
        pos: [-28.5, 0.28, 54],
      }),
      transformGeo(rbox(138, 0.62, 1.2, 0.12, PALETTE.curbStone, 1), { pos: [-85, 0.06, 16.6] }),
      transformGeo(rbox(1.2, 0.62, 136.8, 0.12, PALETTE.curbStone, 1), { pos: [-16.6, 0.06, 85.6] })
    );
    this.physics.addStaticBox(new THREE.Vector3(-85, 0.14, 85), new THREE.Vector3(69, 0.14, 69));
    this.physics.addStaticBox(new THREE.Vector3(-28.5, 0.28, 54), new THREE.Vector3(11, 0.07, 34));
    this.physics.addStaticBox(new THREE.Vector3(-85, 0.06, 16.6), new THREE.Vector3(69, 0.31, 0.6));
    this.physics.addStaticBox(new THREE.Vector3(-16.6, 0.06, 85.6), new THREE.Vector3(0.6, 0.31, 68.4));

    // NE Botanical Park Plaza (`top = 0.28`), Meadow (`top = 0.35`), Diagonal Walk (`top = 0.40`), Stone Plazas (`top = 0.45`)
    quadGround.ne.push(
      transformGeo(rbox(138, 0.56, 138, 0.24, PALETTE.plazaSand, 1), {
        pos: [85, 0.0, 85],
      }),
      transformGeo(rbox(116, 0.14, 116, 0.1, PALETTE.grassMeadow, 1), {
        pos: [84, 0.28, 84],
      }),
      transformGeo(rbox(10.5, 0.14, 62, 0.08, PALETTE.plazaCream, 1), {
        rot: [0, Math.PI * 0.25, 0],
        pos: [68, 0.33, 67],
      }),
      transformGeo(rcyl(19.5, 20.0, 0.18, PALETTE.plazaWarmStone, 28), {
        pos: [48, 0.36, 48],
      }),
      transformGeo(rcyl(16.0, 16.5, 0.18, PALETTE.plazaWarmStone, 24), {
        pos: [88, 0.36, 86],
      }),
      transformGeo(rbox(138, 0.62, 1.2, 0.12, PALETTE.curbStone, 1), { pos: [85, 0.06, 16.6] }),
      transformGeo(rbox(1.2, 0.62, 136.8, 0.12, PALETTE.curbStone, 1), { pos: [16.6, 0.06, 85.6] })
    );
    this.physics.addStaticBox(new THREE.Vector3(85, 0.14, 85), new THREE.Vector3(69, 0.14, 69));
    this.physics.addStaticBox(new THREE.Vector3(84, 0.28, 84), new THREE.Vector3(58, 0.07, 58));
    this.physics.addStaticBox(
      new THREE.Vector3(68, 0.33, 67),
      new THREE.Vector3(5.25, 0.07, 31),
      new THREE.Euler(0, Math.PI * 0.25, 0)
    );
    // Low-segment (8) flat stone plaza inlay colliders for fast raycast narrowphase
    this.physics.addStaticCylinder(new THREE.Vector3(48, 0.36, 48), 19.5, 20.0, 0.18, 8);
    this.physics.addStaticCylinder(new THREE.Vector3(88, 0.36, 86), 16.0, 16.5, 0.18, 8);
    this.physics.addStaticBox(new THREE.Vector3(85, 0.06, 16.6), new THREE.Vector3(69, 0.31, 0.6));
    this.physics.addStaticBox(new THREE.Vector3(16.6, 0.06, 85.6), new THREE.Vector3(0.6, 0.31, 68.4));

    // SW North Quay & South Quay (`top = 0.28`) + Non-Overlapping Cobble Promenade Bands (`top = 0.35`)
    quadGround.sw.push(
      transformGeo(rbox(138, 0.56, 24, 0.22, PALETTE.plazaRoseStone, 1), {
        pos: [-85, 0.0, -28],
      }),
      transformGeo(rbox(138, 0.56, 86, 0.22, PALETTE.plazaCream, 1), {
        pos: [-85, 0.0, -111],
      }),
      transformGeo(rbox(94, 0.14, 12, 0.06, PALETTE.plazaRoseStone, 1), {
        pos: [-84, 0.28, -75.5],
      }),
      transformGeo(rbox(14, 0.14, 76, 0.06, PALETTE.plazaWarmStone, 1), {
        pos: [-25.5, 0.28, -108],
      }),
      transformGeo(rbox(138, 0.62, 1.2, 0.12, PALETTE.curbStone, 1), { pos: [-85, 0.06, -16.6] }),
      transformGeo(rbox(1.2, 0.62, 22.8, 0.12, PALETTE.curbStone, 1), { pos: [-16.6, 0.06, -28.6] }),
      transformGeo(rbox(1.2, 0.62, 86, 0.12, PALETTE.curbStone, 1), { pos: [-16.6, 0.06, -111] }),
      transformGeo(rbox(132, 2.8, 1.6, 0.16, PALETTE.curbStone, 1), {
        pos: [-81, -0.95, -40.2],
      }),
      transformGeo(rbox(132, 2.8, 1.6, 0.16, PALETTE.curbStone, 1), {
        pos: [-81, -0.95, -67.8],
      })
    );
    this.physics.addStaticBox(new THREE.Vector3(-85, 0.14, -28), new THREE.Vector3(69, 0.14, 12));
    this.physics.addStaticBox(new THREE.Vector3(-85, 0.14, -111), new THREE.Vector3(69, 0.14, 43));
    this.physics.addStaticBox(new THREE.Vector3(-84, 0.28, -75.5), new THREE.Vector3(47, 0.07, 6));
    this.physics.addStaticBox(new THREE.Vector3(-25.5, 0.28, -108), new THREE.Vector3(7, 0.07, 38));
    this.physics.addStaticBox(new THREE.Vector3(-81, -0.95, -40.2), new THREE.Vector3(66, 1.4, 0.8));
    this.physics.addStaticBox(new THREE.Vector3(-81, -0.95, -67.8), new THREE.Vector3(66, 1.4, 0.8));
    this.physics.addStaticBox(new THREE.Vector3(-85, 0.06, -16.6), new THREE.Vector3(69, 0.31, 0.6));
    this.physics.addStaticBox(new THREE.Vector3(-16.6, 0.06, -28.6), new THREE.Vector3(0.6, 0.31, 11.4));
    this.physics.addStaticBox(new THREE.Vector3(-16.6, 0.06, -111), new THREE.Vector3(0.6, 0.31, 43));

    // SE Farmers' Market & Clocktower Plaza (`top = 0.28`) + Non-Overlapping Stone Inlays (`top = 0.35` / `0.37`)
    quadGround.se.push(
      transformGeo(rbox(138, 0.56, 138, 0.24, PALETTE.plazaWarmStone, 1), {
        pos: [85, 0.0, -85],
      }),
      transformGeo(rbox(56, 0.14, 54, 0.1, PALETTE.plazaCream, 1), {
        pos: [48, 0.28, -74],
      }),
      transformGeo(rcyl(18.5, 19.0, 0.16, PALETTE.plazaRoseStone, 24), {
        pos: [96, 0.29, -96],
      }),
      transformGeo(rbox(138, 0.62, 1.2, 0.12, PALETTE.curbStone, 1), { pos: [85, 0.06, -16.6] }),
      transformGeo(rbox(1.2, 0.62, 136.8, 0.12, PALETTE.curbStone, 1), { pos: [16.6, 0.06, -85.6] })
    );
    this.physics.addStaticBox(new THREE.Vector3(85, 0.14, -85), new THREE.Vector3(69, 0.14, 69));
    this.physics.addStaticBox(new THREE.Vector3(48, 0.28, -74), new THREE.Vector3(28, 0.07, 27));
    this.physics.addStaticCylinder(new THREE.Vector3(96, 0.29, -96), 18.5, 19.0, 0.16, 8);
    this.physics.addStaticBox(new THREE.Vector3(85, 0.06, -16.6), new THREE.Vector3(69, 0.31, 0.6));
    this.physics.addStaticBox(new THREE.Vector3(16.6, 0.06, -85.6), new THREE.Vector3(0.6, 0.31, 68.4));

    // Zebra Crosswalks (`bottom = 0.04, top = 0.11`, assigned cleanly per quadrant)
    for (let s = -3; s <= 3; s++) {
      quadGround.sw.push(
        transformGeo(rbox(6.2, 0.07, 1.8, 0.03, PALETTE.porcelainWhite, 1), {
          pos: [-23, 0.075, s * 3.6],
        })
      );
      quadGround.ne.push(
        transformGeo(rbox(6.2, 0.07, 1.8, 0.03, PALETTE.porcelainWhite, 1), {
          pos: [23, 0.075, s * 3.6],
        })
      );
      quadGround.nw.push(
        transformGeo(rbox(1.8, 0.07, 6.2, 0.03, PALETTE.porcelainWhite, 1), {
          pos: [s * 3.6, 0.075, 23],
        })
      );
      quadGround.se.push(
        transformGeo(rbox(1.8, 0.07, 6.2, 0.03, PALETTE.porcelainWhite, 1), {
          pos: [s * 3.6, 0.075, -23],
        })
      );
    }

    // Oak Sleepers (`y: 0.04..0.11`) & Raised Steel Tram Rails (`y: 0.12..0.21`) along `z = 0`, split West (`sw`) vs East (`ne`)
    for (let tx = -182; tx <= 182; tx += 4.2) {
      if (Math.abs(tx - 23) < 3.4 || Math.abs(tx + 23) < 3.4) continue;
      const target = tx < 0 ? quadGround.sw : quadGround.ne;
      target.push(
        transformGeo(rbox(0.85, 0.07, 5.6, 0.03, PALETTE.woodWalnut, 1), {
          pos: [tx, 0.075, 0],
        })
      );
    }
    quadGround.sw.push(
      transformGeo(rbox(190, 0.09, 0.26, 0.03, PALETTE.ironworkPlum, 1), { pos: [-95, 0.165, -2.1] }),
      transformGeo(rbox(190, 0.09, 0.26, 0.03, PALETTE.ironworkPlum, 1), { pos: [-95, 0.165, 2.1] })
    );
    quadGround.ne.push(
      transformGeo(rbox(190, 0.09, 0.26, 0.03, PALETTE.ironworkPlum, 1), { pos: [95, 0.165, -2.1] }),
      transformGeo(rbox(190, 0.09, 0.26, 0.03, PALETTE.ironworkPlum, 1), { pos: [95, 0.165, 2.1] })
    );

    for (const qKey of ['nw', 'ne', 'sw', 'se'] as const) {
      const qMesh = new THREE.Mesh(mergeParts(quadGround[qKey]), this.mat);
      qMesh.castShadow = false;
      qMesh.receiveShadow = true;
      qMesh.geometry.computeBoundingSphere();
      this.root.add(qMesh);
    }
  }

  // ==========================================================================
  // 2. Heritage Vintage Streetcar / Tram (`30.0 x 8.6 x 18.8 SU`)
  // ==========================================================================

  private createClockDialRig(
    worldPos: [number, number, number],
    yaw: number,
    dialScale = 1.0
  ): void {
    if (!this.sharedClockHourGeo) {
      this.sharedClockHourGeo = transformGeo(
        rbox(0.42, 2.75, 0.14, 0.05, PALETTE.ironworkPlum, 1),
        { pos: [0, 1.12, 0.04] }
      );
      this.sharedClockHourGeo.computeBoundingSphere();
    }
    if (!this.sharedClockMinuteGeo) {
      this.sharedClockMinuteGeo = transformGeo(
        rbox(0.32, 4.15, 0.14, 0.04, PALETTE.ironworkPlum, 1),
        { pos: [0, 1.72, 0.14] }
      );
      this.sharedClockMinuteGeo.computeBoundingSphere();
    }

    const dialGroup = new THREE.Group();
    dialGroup.position.set(worldPos[0], worldPos[1], worldPos[2]);
    dialGroup.rotation.y = yaw;
    dialGroup.scale.setScalar(dialScale);

    const hourPivot = new THREE.Group();
    const hourMesh = new THREE.Mesh(this.sharedClockHourGeo, this.mat);
    hourMesh.castShadow = false;
    hourMesh.receiveShadow = false;
    hourPivot.add(hourMesh);

    const minutePivot = new THREE.Group();
    const minuteMesh = new THREE.Mesh(this.sharedClockMinuteGeo, this.mat);
    minuteMesh.castShadow = false;
    minuteMesh.receiveShadow = false;
    minutePivot.add(minuteMesh);

    dialGroup.add(hourPivot, minutePivot);
    this.root.add(dialGroup);
    this.clockDialRigs.push({ hourPivot, minutePivot });
  }

  private buildMovingVintageTram(): void {
    const parts: THREE.BufferGeometry[] = [];
    const L = 30.0;
    const W = 8.6;

    // Steel undercarriage, cowcatchers & 4 flanged wheels
    parts.push(
      transformGeo(rbox(L - 1.2, 1.8, W - 0.8, 0.2, PALETTE.ironworkPlum, 2), {
        pos: [0, 1.6, 0],
      }),
      transformGeo(rbox(1.4, 1.1, W - 1.2, 0.15, PALETTE.ironworkPlum, 1), {
        pos: [L * 0.5 + 0.3, 1.0, 0],
      }),
      transformGeo(rbox(1.4, 1.1, W - 1.2, 0.15, PALETTE.ironworkPlum, 1), {
        pos: [-L * 0.5 - 0.3, 1.0, 0],
      })
    );
    for (const wx of [-9.2, -3.6, 3.6, 9.2]) {
      for (const wz of [-2.1, 2.1]) {
        parts.push(
          transformGeo(rcyl(1.15, 1.15, 0.45, PALETTE.ironworkPlum, 18), {
            rot: [Math.PI * 0.5, 0, 0],
            pos: [wx, 1.15, wz],
          }),
          transformGeo(rcyl(0.45, 0.45, 0.52, PALETTE.brassWarm, 12), {
            rot: [Math.PI * 0.5, 0, 0],
            pos: [wx, 1.15, wz],
          })
        );
      }
    }

    // Lower Cherry-Red Rocker Panels & Waist Belt (`y: 2.4 .. 8.8`)
    parts.push(
      transformGeo(rbox(L, 6.4, W, 0.38, PALETTE.awningCoral, 2), {
        pos: [0, 5.6, 0],
      }),
      transformGeo(rbox(L + 0.3, 0.55, W + 0.3, 0.12, PALETTE.brassWarm, 1), {
        pos: [0, 8.85, 0],
      }),
      transformGeo(rbox(L - 4.0, 1.2, 2.2, 0.18, PALETTE.woodOak, 1), {
        pos: [0, 6.8, -2.4],
      }),
      transformGeo(rbox(L - 4.0, 1.2, 2.2, 0.18, PALETTE.woodOak, 1), {
        pos: [0, 6.8, 2.4],
      })
    );

    // Cream Window Pillars (`y: 8.9 .. 16.8`) — 5 wide arched windows per side
    for (let px = -14.2; px <= 14.21; px += 5.68) {
      for (const sz of [-1, 1]) {
        parts.push(
          transformGeo(rbox(1.15, 7.9, 0.75, 0.14, PALETTE.wallCreamTrim, 1), {
            pos: [px, 12.85, sz * (W * 0.5 - 0.38)],
          })
        );
      }
    }
    // End bulkheads + motorman windscreens + glowing brass headlamps
    for (const sx of [-1, 1]) {
      parts.push(
        transformGeo(rbox(1.2, 7.9, W - 0.3, 0.24, PALETTE.wallCreamTrim, 2), {
          pos: [sx * (L * 0.5 - 0.6), 12.85, 0],
        }),
        transformGeo(rbox(1.35, 5.2, W - 2.4, 0.12, PALETTE.windowGlass, 1), {
          pos: [sx * (L * 0.5 - 0.6), 12.9, 0],
        }),
        transformGeo(rcyl(0.75, 0.85, 0.7, PALETTE.brassWarm, 16), {
          rot: [0, 0, Math.PI * 0.5],
          pos: [sx * (L * 0.5 + 0.25), 5.6, 0],
        }),
        transformGeo(smoothSphere(0.55, PALETTE.sunCore, 14, 12), {
          pos: [sx * (L * 0.5 + 0.52), 5.6, 0],
        }),
        transformGeo(rbox(0.8, 1.45, 5.2, 0.12, PALETTE.ironworkPlum, 1), {
          pos: [sx * (L * 0.5 - 0.2), 17.6, 0],
        }),
        transformGeo(rbox(0.88, 0.95, 4.4, 0.06, PALETTE.windowWarmLit, 1), {
          pos: [sx * (L * 0.5 - 0.2), 17.6, 0],
        })
      );
    }

    parts.push(
      transformGeo(rbox(L - 2.4, 6.8, W - 1.3, 0.12, PALETTE.windowGlass, 1), {
        pos: [0, 12.7, 0],
      })
    );

    // Arched Slate Roof (`y = 16.8 .. 18.8`) + Raised Clerestory Monitor (`y = 18.8 .. 20.4`)
    parts.push(
      transformGeo(rbox(L + 0.8, 1.8, W + 0.6, 0.45, PALETTE.roofSlate, 2), {
        pos: [0, 17.7, 0],
      }),
      transformGeo(rbox(L - 6.0, 1.55, W - 3.0, 0.32, PALETTE.awningCoral, 2), {
        pos: [0, 19.35, 0],
      }),
      transformGeo(rbox(L - 5.2, 0.42, W - 2.4, 0.14, PALETTE.wallCreamTrim, 1), {
        pos: [0, 20.2, 0],
      })
    );

    // Brass Diamond Pantograph (`y: 20.4 .. 23.8`)
    parts.push(
      tube(
        [
          [0, 20.4, -1.2],
          [-2.2, 22.1, -1.2],
          [0, 23.75, -1.2],
          [2.2, 22.1, -1.2],
          [0, 20.4, -1.2],
        ],
        0.1,
        PALETTE.brassWarm,
        16,
        6
      ),
      tube(
        [
          [0, 20.4, 1.2],
          [-2.2, 22.1, 1.2],
          [0, 23.75, 1.2],
          [2.2, 22.1, 1.2],
          [0, 20.4, 1.2],
        ],
        0.1,
        PALETTE.brassWarm,
        16,
        6
      ),
      transformGeo(rcyl(0.11, 0.11, 3.6, PALETTE.brassWarm, 10), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [0, 23.75, 0],
      })
    );

    const tramMesh = new THREE.Mesh(mergeParts(parts), this.mat);
    tramMesh.castShadow = true;
    tramMesh.receiveShadow = true;
    tramMesh.geometry.computeBoundingSphere();
    this.tramGroup.add(tramMesh);
    this.tramGroup.position.set(this.tramX, 0.12, 0);
    this.root.add(this.tramGroup);

    this.tramBody = this.physics.addKinematicBox(
      new THREE.Vector3(this.tramX, 9.8, 0),
      new THREE.Vector3(L * 0.5, 9.6, W * 0.5)
    );
    this.physics.setBumpMetadata(this.tramBody, { surface: 'metal', causesDizzy: true });
    this.physics.setBodyAttachTarget(this.tramBody, this.tramGroup);

    for (const [suffix, zOff] of [
      ['n', 2.95],
      ['s', -2.95],
    ] as const) {
      this.perches.addDynamicSegment({
        id: `tram_roof_${suffix}`,
        getApproxCenter: (out) => out.copy(this.tramGroup.position),
        approxHalfSpan: 9.0,
        getEndpoints: (outA, outB) => {
          const tx = this.tramGroup.position.x;
          outA.set(tx - 8.4, 20.53, zOff);
          outB.set(tx + 8.4, 20.53, zOff);
        },
        radius: 0.03,
        surface: 'metal',
        onLand: (_t, speed) => {
          if (speed > 3.2) {
            this.triggerTramBellAndSpark(6);
          }
        },
      });
    }
    for (const [suffix, zOff] of [
      ['n', 4.35],
      ['s', -4.35],
    ] as const) {
      this.perches.addDynamicSegment({
        id: `tram_eave_${suffix}`,
        getApproxCenter: (out) => out.copy(this.tramGroup.position),
        approxHalfSpan: 12.0,
        getEndpoints: (outA, outB) => {
          const tx = this.tramGroup.position.x;
          outA.set(tx - 11.4, 18.72, zOff);
          outB.set(tx + 11.4, 18.72, zOff);
        },
        radius: 0.03,
        surface: 'metal',
      });
    }
    this.perches.addDynamicSegment({
      id: 'tram_pantograph',
      getApproxCenter: (out) => out.copy(this.tramGroup.position),
      approxHalfSpan: 2.0,
      getEndpoints: (outA, outB) => {
        const tx = this.tramGroup.position.x;
        outA.set(tx, 23.98, -1.65);
        outB.set(tx, 23.98, 1.65);
      },
      radius: 0.09,
      surface: 'metal',
      onLand: () => {
        this.triggerTramBellAndSpark(11);
      },
    });
  }

  // ==========================================================================
  // 3. NW Block: 4-Story Boulangerie, Conservatory Atelier & Hinged French Windows
  // ==========================================================================

  private buildNWPatisserieAndIndoorAtticStudio(): {
    spawnPos: THREE.Vector3;
    latchPos: THREE.Vector3;
    chandelierPerchPos: THREE.Vector3;
    windowLatchPos: THREE.Vector3;
    windowSillPos: THREE.Vector3;
    windowExitPos: THREE.Vector3;
    sleepyMugPos: THREE.Vector3;
  } {
    const nwOutdoorParts: THREE.BufferGeometry[] = [];
    const atelierInteriorParts: THREE.BufferGeometry[] = [];
    const foliageParts: THREE.BufferGeometry[] = [];

    // --- A. Ground-Floor Boulangerie-Patisserie (`x: -88..-38, z: 24..80, y: 0.28..25.8`) ---
    nwOutdoorParts.push(
      transformGeo(rbox(50.6, 5.2, 56.6, 0.24, PALETTE.wallLimestone, 1), {
        pos: [-63, 2.88, 52],
      }),
      transformGeo(rbox(50.0, 25.5, 56.0, 0.34, PALETTE.wallApricot, 1, { bottomAO: 0.14 }), {
        pos: [-63, 13.03, 52],
      }),
      transformGeo(rbox(51.8, 1.15, 57.8, 0.18, PALETTE.wallCreamTrim, 1), {
        pos: [-63, 25.75, 52],
      }),
      // Storefront wood-paneled vitrine & double bakery doors facing East (`x = -38`)
      transformGeo(rbox(1.1, 17.4, 44.0, 0.18, PALETTE.parisGreen, 1), {
        pos: [-37.9, 9.0, 52],
      }),
      transformGeo(rbox(1.3, 12.2, 14.5, 0.12, PALETTE.windowWarmLit, 1), {
        pos: [-37.8, 10.2, 37.8],
      }),
      transformGeo(rbox(1.3, 12.2, 14.5, 0.12, PALETTE.windowWarmLit, 1), {
        pos: [-37.8, 10.2, 66.2],
      }),
      transformGeo(rbox(1.35, 15.2, 7.2, 0.14, PALETTE.woodWalnut, 1), {
        pos: [-37.8, 7.9, 52.0],
      }),
      transformGeo(rbox(0.95, 2.6, 38.0, 0.14, PALETTE.parisGreen, 1), {
        pos: [-37.7, 23.0, 52.0],
      }),
      transformGeo(rbox(1.1, 0.38, 38.4, 0.08, PALETTE.brassWarm, 1), {
        pos: [-37.65, 24.35, 52.0],
      })
    );

    const groundBody = this.physics.addStaticBox(
      new THREE.Vector3(-63, 13.0, 52),
      new THREE.Vector3(25.0, 12.8, 28.0)
    );
    this.physics.setBumpMetadata(groundBody, { surface: 'stone', causesDizzy: true });

    // Bouncy Storefront Awning at `y = 20.6 SU` (generous clearance above the 11.2-SU Pastry Chef)
    this.createBouncyAwning(
      'patisserie_main_awning',
      new THREE.Vector3(-33.4, 20.6, 52.0),
      new THREE.Vector3(4.6, 0.58, 23.5),
      PALETTE.awningCoral,
      PALETTE.awningCream,
      18.5
    );

    // Outdoor Marble Pastry Display Counter (`(-34.8, 0.28, 42.5)`, `top y = 5.25`)
    nwOutdoorParts.push(
      transformGeo(rbox(3.4, 4.5, 10.2, 0.18, PALETTE.woodOak, 1), {
        pos: [-34.8, 2.53, 42.5],
      }),
      transformGeo(rbox(3.8, 0.48, 10.6, 0.12, PALETTE.porcelainWhite, 1), {
        pos: [-34.8, 5.01, 42.5],
      })
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-34.8, 2.75, 42.5),
      new THREE.Vector3(1.9, 2.5, 5.3)
    );

    this.propFactory.spawnCroissant(new THREE.Vector3(-34.3, 5.82, 39.8));
    this.propFactory.spawnCroissant(new THREE.Vector3(-34.2, 5.82, 42.6));
    this.propFactory.spawnCroissant(new THREE.Vector3(-34.3, 5.82, 45.2));
    this.propFactory.spawnBaguette(new THREE.Vector3(-35.2, 5.5, 46.8));
    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(-35.4, 5.8, 38.4),
        PALETTE.windowGlass,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(-34.2, 5.34, 41.2),
        PALETTE.porcelainWhite,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(-35.3, 5.68, 44.0),
        PALETTE.porcelainWhite,
        PALETTE.coffeeDark,
        PALETTE.awningGold
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-34.1, 5.55, 46.4),
        PALETTE.porcelainWhite,
        PALETTE.goldGlow
      )
      .body.sleep();

    // --- B. Vaulted 2nd-Story Parisian Artist's Conservatory Atelier (`y: 26.2 .. 51.6, x: -88..-38, z: 24..80`) ---
    atelierInteriorParts.push(
      // Herringbone oak floor slab (`top y = 26.2`) + low-pile multi-border Kilim Atelier carpet (`top y = 26.28`)
      transformGeo(rbox(50.0, 0.8, 56.0, 0.12, PALETTE.woodOak, 1), {
        pos: [-63.0, 25.8, 52.0],
      }),
      transformGeo(rbox(32.5, 0.04, 37.5, 0.02, PALETTE.awningCoral, 1), {
        pos: [-60.0, 26.22, 52.0],
      }),
      transformGeo(rbox(28.0, 0.03, 33.0, 0.015, PALETTE.wallCreamTrim, 1), {
        pos: [-60.0, 26.245, 52.0],
      }),
      transformGeo(rbox(22.5, 0.03, 27.5, 0.015, PALETTE.awningCobalt, 1), {
        pos: [-60.0, 26.26, 52.0],
      }),
      transformGeo(rbox(12.0, 0.03, 16.0, 0.015, PALETTE.awningGold, 1), {
        pos: [-60.0, 26.27, 52.0],
      }),
      // Central diamond medallion on the Kilim rug
      transformGeo(rbox(5.6, 0.025, 5.6, 0.01, PALETTE.porcelainWhite, 1), {
        rot: [0, Math.PI * 0.25, 0],
        pos: [-60.0, 26.28, 52.0],
      })
    );
    // Parquet oak plank strips + cream Kilim fringe tassels
    for (let pIdx = 0; pIdx < 9; pIdx++) {
      atelierInteriorParts.push(
        transformGeo(rbox(47.6, 0.025, 0.35, 0.01, PALETTE.woodWalnut, 1), {
          pos: [-63.0, 26.21, 28.0 + pIdx * 6.0],
        })
      );
    }
    for (let tIdx = 0; tIdx < 11; tIdx++) {
      const txRug = -73.5 + tIdx * 2.7;
      atelierInteriorParts.push(
        transformGeo(rbox(0.28, 0.035, 1.1, 0.015, PALETTE.porcelainWhite, 1), {
          pos: [txRug, 26.22, 32.8],
        }),
        transformGeo(rbox(0.28, 0.035, 1.1, 0.015, PALETTE.porcelainWhite, 1), {
          pos: [txRug, 26.22, 71.2],
        })
      );
    }
    this.physics.addStaticBox(
      new THREE.Vector3(-63.0, 25.8, 52.0),
      new THREE.Vector3(25.0, 0.4, 28.0)
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-60.0, 26.245, 52.0),
      new THREE.Vector3(16.25, 0.05, 18.75)
    );

    // Solid Conservatory Atelier Outer Structural Walls + Ceiling Slab (`nwOutdoorParts`)
    // Visual meshes preserve exact exterior facade lines (`-88..-38`, `24..80`), while physics colliders
    // extend flush to the interior wainscoting/cornices with thick slabs for zero tunneling.
    const wallSpecs: Array<{
      pos: [number, number, number];
      half: [number, number, number];
      colPos: [number, number, number];
      colHalf: [number, number, number];
    }> = [
      {
        pos: [-87.3, 38.9, 52.0],
        half: [0.7, 12.7, 28.0],
        colPos: [-87.0, 38.9, 52.0],
        colHalf: [1.0, 13.1, 28.0],
      }, // West back wall (`inner x = -86.00`)
      {
        pos: [-63.0, 38.9, 79.3],
        half: [25.0, 12.7, 0.7],
        colPos: [-63.0, 38.9, 79.0],
        colHalf: [25.0, 13.1, 1.0],
      }, // North wall (`inner z = 78.00`)
      {
        pos: [-63.0, 38.9, 24.7],
        half: [25.0, 12.7, 0.7],
        colPos: [-63.0, 38.9, 25.0],
        colHalf: [25.0, 13.1, 1.0],
      }, // South wall (`inner z = 26.00`)
      {
        pos: [-38.7, 38.9, 33.7],
        half: [0.7, 12.7, 9.7],
        colPos: [-38.78, 38.9, 33.72],
        colHalf: [0.88, 13.1, 9.72],
      }, // East-South pier (`inner x = -39.66`, `z: 24..43.44`)
      {
        pos: [-38.7, 38.9, 70.3],
        half: [0.7, 12.7, 9.7],
        colPos: [-38.78, 38.9, 70.28],
        colHalf: [0.88, 13.1, 9.72],
      }, // East-North pier (`inner x = -39.66`, `z: 60.56..80`)
      {
        pos: [-38.7, 28.5, 52.0],
        half: [0.7, 2.3, 8.6],
        colPos: [-38.84, 28.55, 52.0],
        colHalf: [0.92, 2.45, 9.0],
      }, // Window sill wall (`inner x = -39.76`, `top y = 31.0`)
      {
        pos: [-38.7, 49.7, 52.0],
        half: [0.7, 1.9, 8.6],
        colPos: [-38.84, 49.85, 52.0],
        colHalf: [0.92, 2.05, 9.0],
      }, // Window lintel (`bottom y = 47.8`)
      {
        pos: [-63.0, 52.1, 52.0],
        half: [25.4, 0.5, 28.4],
        colPos: [-63.0, 52.32, 52.0],
        colHalf: [25.4, 0.8, 28.4],
      }, // Atelier ceiling slab (`bottom y = 51.52`, bridges into `upperCol`)
    ];

    for (const ws of wallSpecs) {
      nwOutdoorParts.push(
        transformGeo(
          rbox(ws.half[0] * 2, ws.half[1] * 2, ws.half[2] * 2, 0.16, PALETTE.wallApricot, 1),
          { pos: ws.pos }
        )
      );
      const b = this.physics.addStaticBox(
        new THREE.Vector3(...ws.colPos),
        new THREE.Vector3(...ws.colHalf)
      );
      this.physics.setBumpMetadata(b, { surface: 'stone', causesDizzy: true });
    }

    // --- Architectural Interior Wall Shells: 4-Wall Cream Wainscoting, Picture Rail, Crown Cornice, Paintings, Drapes & Sconces ---
    atelierInteriorParts.push(
      transformGeo(rbox(0.36, 4.7, 53.2, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-86.44, 28.55, 52.0],
      }),
      transformGeo(rbox(0.52, 0.36, 53.4, 0.08, PALETTE.porcelainWhite, 1), {
        pos: [-86.38, 31.0, 52.0],
      }),
      transformGeo(rbox(0.65, 0.72, 53.6, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-86.32, 51.15, 52.0],
      }),
      transformGeo(rbox(47.2, 4.7, 0.36, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-63.0, 28.55, 25.56],
      }),
      transformGeo(rbox(47.4, 0.36, 0.52, 0.08, PALETTE.porcelainWhite, 1), {
        pos: [-63.0, 31.0, 25.62],
      }),
      transformGeo(rbox(47.6, 0.72, 0.65, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-63.0, 51.15, 25.68],
      }),
      transformGeo(rbox(47.2, 4.7, 0.36, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-63.0, 28.55, 78.44],
      }),
      transformGeo(rbox(47.4, 0.36, 0.52, 0.08, PALETTE.porcelainWhite, 1), {
        pos: [-63.0, 31.0, 78.38],
      }),
      transformGeo(rbox(47.6, 0.72, 0.65, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-63.0, 51.15, 78.32],
      }),
      transformGeo(rbox(0.36, 4.7, 17.8, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-39.56, 28.55, 33.8],
      }),
      transformGeo(rbox(0.52, 0.36, 17.9, 0.08, PALETTE.porcelainWhite, 1), {
        pos: [-39.62, 31.0, 33.8],
      }),
      transformGeo(rbox(0.65, 0.72, 18.0, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-39.68, 51.15, 33.8],
      }),
      transformGeo(rbox(0.36, 4.7, 17.8, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-39.56, 28.55, 70.2],
      }),
      transformGeo(rbox(0.52, 0.36, 17.9, 0.08, PALETTE.porcelainWhite, 1), {
        pos: [-39.62, 31.0, 70.2],
      }),
      transformGeo(rbox(0.65, 0.72, 18.0, 0.1, PALETTE.wallCreamTrim, 1), {
        pos: [-39.68, 51.15, 70.2],
      }),
      transformGeo(rbox(0.32, 0.24, 53.2, 0.06, PALETTE.wallCreamTrim, 1), {
        pos: [-86.42, 46.8, 52.0],
      }),
      transformGeo(rbox(47.2, 0.24, 0.32, 0.06, PALETTE.wallCreamTrim, 1), {
        pos: [-63.0, 46.8, 25.58],
      }),
      transformGeo(rbox(47.2, 0.24, 0.32, 0.06, PALETTE.wallCreamTrim, 1), {
        pos: [-63.0, 46.8, 78.42],
      })
    );
    for (let wp = 0; wp < 7; wp++) {
      atelierInteriorParts.push(
        transformGeo(rbox(0.18, 3.1, 5.8, 0.06, PALETTE.porcelainWhite, 1), {
          pos: [-86.34, 28.55, 31.0 + wp * 7.0],
        })
      );
    }

    // Recessed 4-Molding Framed Gouache Paintings across West, South & East-Pier Walls
    const addFramedPainting = (
      px: number,
      py: number,
      pz: number,
      rotY: number,
      w: number,
      h: number,
      skyHex: number,
      landHex: number,
      accentHex: number
    ): void => {
      const cosR = Math.cos(rotY);
      const sinR = Math.sin(rotY);
      const layer = (depthOff: number, yOff: number, xSide: number, geo: THREE.BufferGeometry) =>
        transformGeo(geo, {
          rot: [0, rotY, 0],
          pos: [
            px + sinR * depthOff + cosR * xSide,
            py + yOff,
            pz + cosR * depthOff - sinR * xSide,
          ],
        });

      const fw = 0.44;
      const fd = 0.28;
      const outerW = w + fw * 1.4;
      const outerH = h + fw * 1.4;
      const canvasW = Math.max(1.2, w - 0.96);
      const canvasH = Math.max(1.2, h - 0.96);
      const landH = canvasH * 0.4;

      atelierInteriorParts.push(
        // 1. Recessed cream passe-partout mat board flush against the wall (`front = +0.08`)
        layer(0.04, 0, 0, rbox(w, h, 0.08, 0.03, PALETTE.porcelainWhite, 1)),
        // 2. Subtle inner gilt rabbet liner around the canvas opening (`front = +0.13`)
        layer(0.085, (canvasH + 0.14) * 0.5, 0, rbox(canvasW + 0.34, 0.11, 0.09, 0.02, PALETTE.goldGlow, 1)),
        layer(0.085, -(canvasH + 0.14) * 0.5, 0, rbox(canvasW + 0.34, 0.11, 0.09, 0.02, PALETTE.goldGlow, 1)),
        layer(0.085, 0, -(canvasW + 0.14) * 0.5, rbox(0.11, canvasH + 0.14, 0.09, 0.02, PALETTE.goldGlow, 1)),
        layer(0.085, 0, (canvasW + 0.14) * 0.5, rbox(0.11, canvasH + 0.14, 0.09, 0.02, PALETTE.goldGlow, 1)),
        // 3. Flat gouache sky, horizon landscape & sun/moon recessed inside the frame well (`front = +0.105 .. +0.125`)
        layer(0.085, 0, 0, rbox(canvasW, canvasH, 0.04, 0.02, skyHex, 1)),
        layer(0.098, -(canvasH - landH) * 0.5, 0, rbox(canvasW, landH, 0.04, 0.02, landHex, 1)),
        layer(
          0.112,
          canvasH * 0.18,
          canvasW * 0.18,
          transformGeo(rcyl(0.54, 0.54, 0.03, accentHex, 14), {
            rot: [Math.PI * 0.5, 0, 0],
          })
        ),
        // 4. Four-rail proud beveled picture frame molding (`front = +0.28`, +0.155 SU proud of canvas)
        layer(fd * 0.5, (outerH - fw) * 0.5, 0, rbox(outerW, fw, fd, 0.06, PALETTE.brassWarm, 1)),
        layer(fd * 0.5, -(outerH - fw) * 0.5, 0, rbox(outerW, fw, fd, 0.06, PALETTE.brassWarm, 1)),
        layer(fd * 0.5, 0, -(outerW - fw) * 0.5, rbox(fw, outerH - fw * 1.85, fd, 0.06, PALETTE.brassWarm, 1)),
        layer(fd * 0.5, 0, (outerW - fw) * 0.5, rbox(fw, outerH - fw * 1.85, fd, 0.06, PALETTE.brassWarm, 1))
      );
    };

    addFramedPainting(-86.6, 43.3, 39.5, Math.PI * 0.5, 5.6, 4.6, PALETTE.skyMidDawn, PALETTE.leafSage, PALETTE.sunHalo);
    addFramedPainting(-86.6, 42.8, 52.0, Math.PI * 0.5, 7.6, 8.2, PALETTE.skyHorizonGolden, PALETTE.awningCobalt, PALETTE.tulipCoral);
    addFramedPainting(-86.6, 42.4, 64.5, Math.PI * 0.5, 5.8, 6.8, PALETTE.ginkgoGold, PALETTE.parisGreen, PALETTE.porcelainWhite);
    addFramedPainting(-74.8, 41.2, 25.4, 0, 5.6, 6.6, PALETTE.lavenderSprig, PALETTE.wallCoral, PALETTE.goldGlow);
    addFramedPainting(-49.8, 42.6, 25.4, 0, 6.2, 5.4, PALETTE.skyMidDawn, PALETTE.roofTerracotta, PALETTE.sunCore);
    addFramedPainting(-39.4, 40.8, 71.2, -Math.PI * 0.5, 5.4, 7.0, PALETTE.awningCream, PALETTE.leafSage, PALETTE.sakuraPink);

    // 4 Warm Glowing Brass Candle Wall Sconces (flush wall backplates, batched into 1 shared flame draw call)
    const sconceSpecs: Array<[number, number, number, number]> = [
      [-86.52, 43.0, 31.8, Math.PI * 0.5],
      [-86.52, 43.0, 72.2, Math.PI * 0.5],
      [-39.48, 42.2, 38.2, -Math.PI * 0.5],
      [-39.48, 42.2, 65.8, -Math.PI * 0.5],
    ];
    const sharedFlameGeo = this.propFactory.getCandleFlameGeometry();
    const atelierFlameParts: THREE.BufferGeometry[] = [];
    for (const [sx, sy, sz, sRot] of sconceSpecs) {
      const nx = Math.sin(sRot);
      const nz = Math.cos(sRot);
      atelierInteriorParts.push(
        transformGeo(rcyl(0.55, 0.55, 0.16, PALETTE.brassWarm, 14), {
          rot: [0, 0, Math.PI * 0.5],
          pos: [sx, sy, sz],
        }),
        tube(
          [
            [sx, sy - 0.1, sz],
            [sx + nx * 0.75, sy - 0.35, sz + nz * 0.75],
            [sx + nx * 1.05, sy + 0.25, sz + nz * 1.05],
          ],
          0.075,
          PALETTE.brassWarm,
          10,
          6
        ),
        transformGeo(rcyl(0.28, 0.16, 0.24, PALETTE.porcelainWhite, 10), {
          pos: [sx + nx * 1.05, sy + 0.45, sz + nz * 1.05],
        })
      );
      atelierFlameParts.push(
        transformGeo(sharedFlameGeo.clone(), {
          pos: [sx + nx * 1.05, sy + 0.78, sz + nz * 1.05],
        })
      );
    }

    // Tall Pleated Velvet Drapes + Wall-Bracketed Brass Curtain Rod Perch (`y = 48.85`) Framing the East French Window
    atelierInteriorParts.push(
      transformGeo(rcyl(0.14, 0.14, 24.4, PALETTE.brassWarm, 12), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-40.18, 48.85, 52.0],
      }),
      transformGeo(rbox(0.95, 0.18, 0.22, 0.04, PALETTE.brassWarm, 1), {
        pos: [-39.78, 48.85, 40.6],
      }),
      transformGeo(rbox(0.95, 0.18, 0.22, 0.04, PALETTE.brassWarm, 1), {
        pos: [-39.78, 48.85, 52.0],
      }),
      transformGeo(rbox(0.95, 0.18, 0.22, 0.04, PALETTE.brassWarm, 1), {
        pos: [-39.78, 48.85, 63.4],
      }),
      transformGeo(smoothSphere(0.34, PALETTE.goldGlow, 12, 10), { pos: [-40.18, 48.85, 39.6] }),
      transformGeo(smoothSphere(0.34, PALETTE.goldGlow, 12, 10), { pos: [-40.18, 48.85, 64.4] })
    );
    this.perches.addStaticSegment(
      'atelier_curtain_rod',
      new THREE.Vector3(-40.18, 48.99, 40.2),
      new THREE.Vector3(-40.18, 48.99, 63.8),
      0.11,
      'metal'
    );
    for (const dSide of [-1, 1] as const) {
      const dzBase = 52.0 + dSide * 9.8;
      for (let pleat = 0; pleat < 4; pleat++) {
        const pzP = dzBase + dSide * (pleat - 1.5) * 0.62;
        const pxP = -39.75 - (pleat % 2) * 0.22;
        atelierInteriorParts.push(
          transformGeo(rcyl(0.24, 0.24, 0.1, PALETTE.goldGlow, 10), {
            rot: [Math.PI * 0.5, 0, 0],
            pos: [-40.18, 48.85, pzP],
          }),
          transformGeo(
            rcyl(0.36, 0.44, 22.5, pleat % 2 === 0 ? PALETTE.coatRose : PALETTE.awningCoral, 12),
            {
              pos: [pxP, 37.5, pzP],
            }
          )
        );
      }
      atelierInteriorParts.push(
        transformGeo(rcyl(0.88, 0.88, 0.28, PALETTE.goldGlow, 14), {
          pos: [-39.8, 34.4, dzBase],
        })
      );
      const drapeCol = this.physics.addStaticBox(
        new THREE.Vector3(-39.68, 37.5, 52.0 + dSide * 10.05),
        new THREE.Vector3(0.42, 11.25, 1.55)
      );
      this.physics.setBumpMetadata(drapeCol, { surface: 'wood', causesDizzy: false });
    }

    // Wall-Mounted Oak Shelves with Pushable/Breakable Studio Clutter
    atelierInteriorParts.push(
      transformGeo(rbox(2.2, 0.44, 7.6, 0.08, PALETTE.woodOak, 1), { pos: [-85.5, 38.6, 39.5] }),
      transformGeo(rbox(1.9, 0.9, 0.28, 0.05, PALETTE.brassWarm, 1), { pos: [-85.65, 38.05, 36.6] }),
      transformGeo(rbox(1.9, 0.9, 0.28, 0.05, PALETTE.brassWarm, 1), { pos: [-85.65, 38.05, 42.4] }),
      transformGeo(rbox(7.8, 0.44, 2.2, 0.08, PALETTE.woodOak, 1), { pos: [-50.0, 36.8, 26.5] }),
      transformGeo(rbox(0.28, 0.9, 1.9, 0.05, PALETTE.brassWarm, 1), { pos: [-53.0, 36.25, 26.35] }),
      transformGeo(rbox(0.28, 0.9, 1.9, 0.05, PALETTE.brassWarm, 1), { pos: [-47.0, 36.25, 26.35] })
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-85.5, 38.6, 39.5),
      new THREE.Vector3(1.1, 0.22, 3.8)
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-50.0, 36.8, 26.5),
      new THREE.Vector3(3.9, 0.22, 1.1)
    );
    this.perches.addStaticSegment(
      'atelier_west_shelf',
      new THREE.Vector3(-84.48, 38.82, 36.0),
      new THREE.Vector3(-84.48, 38.82, 43.0),
      0.03,
      'wood'
    );
    this.perches.addStaticSegment(
      'atelier_south_shelf',
      new THREE.Vector3(-53.5, 37.02, 27.52),
      new THREE.Vector3(-46.5, 37.02, 27.52),
      0.03,
      'wood'
    );

    // Exposed Walnut Ceiling Rafters (`y = 49.4`) with High-Room Perch Beams
    for (const [rIdx, rz] of [
      ['ss', 32.0],
      ['s', 42.0],
      ['n', 62.0],
      ['nn', 72.0],
    ] as const) {
      atelierInteriorParts.push(
        transformGeo(rbox(47.2, 0.95, 1.0, 0.12, PALETTE.woodWalnut, 1), {
          pos: [-63.0, 49.4, rz],
        })
      );
      this.perches.addStaticSegment(
        `atelier_rafter_${rIdx}`,
        new THREE.Vector3(-83.0, 49.875, rz),
        new THREE.Vector3(-42.0, 49.875, rz),
        0.03,
        'wood'
      );
    }

    // Upper 3rd & 4th Architectural Stories + Steep Mansard Slate Roof (`y: 52.6 .. 95.5 SU` -> `nwOutdoorParts`)
    const upperWallH = 22.8;
    nwOutdoorParts.push(
      transformGeo(rbox(51.8, 1.15, 57.8, 0.18, PALETTE.wallCreamTrim, 1), {
        pos: [-63.0, 52.6, 52.0],
      }),
      transformGeo(rbox(50.0, upperWallH, 56.0, 0.32, PALETTE.wallApricot, 1), {
        pos: [-63.0, 52.6 + upperWallH * 0.5, 52.0],
      }),
      transformGeo(rbox(52.2, 1.35, 58.2, 0.18, PALETTE.wallCreamTrim, 1), {
        pos: [-63.0, 75.5, 52.0],
      }),
      transformGeo(buildPitchedHipRoofGeo(51.2, 57.2, 13.8, 0.72, PALETTE.roofSlate), {
        pos: [-63.0, 82.9, 52.0],
      }),
      transformGeo(rbox(37.4, 0.65, 41.8, 0.14, PALETTE.roofCopperPatina, 1), {
        pos: [-63.0, 89.95, 52.0],
      }),
      transformGeo(rbox(3.2, 6.4, 3.2, 0.16, PALETTE.brickTerracotta, 1), {
        pos: [-76.0, 92.8, 36.0],
      }),
      transformGeo(rbox(3.2, 6.4, 3.2, 0.16, PALETTE.brickTerracotta, 1), {
        pos: [-50.0, 92.8, 68.0],
      })
    );
    for (const wz of [34.0, 46.0, 58.0, 70.0]) {
      nwOutdoorParts.push(
        transformGeo(rbox(0.45, 11.2, 4.8, 0.1, PALETTE.wallCreamTrim, 1), {
          pos: [-37.9, 63.8, wz],
        }),
        transformGeo(rbox(0.55, 10.0, 3.8, 0.06, PALETTE.windowGlass, 1), {
          pos: [-37.85, 63.8, wz],
        }),
        transformGeo(rbox(0.32, 10.2, 1.4, 0.06, PALETTE.shutterTeal, 1), {
          pos: [-37.75, 63.8, wz - 2.7],
        }),
        transformGeo(rbox(0.32, 10.2, 1.4, 0.06, PALETTE.shutterTeal, 1), {
          pos: [-37.75, 63.8, wz + 2.7],
        })
      );
    }
    const upperCol = this.physics.addStaticBox(
      new THREE.Vector3(-63.0, 71.2, 52.0),
      new THREE.Vector3(25.0, 18.6, 28.0)
    );
    this.physics.setBumpMetadata(upperCol, { surface: 'stone', causesDizzy: true });

    this.perches.addStaticSegment(
      'boulangerie_roof_eave',
      new THREE.Vector3(-37.0, 76.175, 23.5),
      new THREE.Vector3(-37.0, 76.175, 80.5),
      0.03,
      'stone'
    );
    this.perches.addStaticSegment(
      'boulangerie_roof_eave_s',
      new THREE.Vector3(-88.5, 76.175, 23.1),
      new THREE.Vector3(-37.5, 76.175, 23.1),
      0.03,
      'stone'
    );
    this.perches.addStaticSegment(
      'boulangerie_roof_eave_n',
      new THREE.Vector3(-88.5, 76.175, 80.9),
      new THREE.Vector3(-37.5, 76.175, 80.9),
      0.03,
      'stone'
    );

    // --- C. Rich Conservatory Atelier Furniture, Clutter & Destructible Ceramic Props (`atelierInteriorParts`) ---
    // 1. West Oak Writing Desk (`center (-74.5, 32.95, 52.0)`, `15.5 x 24.5 SU`, `top y = 33.40`)
    atelierInteriorParts.push(
      transformGeo(rbox(15.5, 0.9, 24.5, 0.22, PALETTE.woodOak, 2), {
        pos: [-74.5, 32.95, 52.0],
      }),
      transformGeo(rbox(0.45, 1.65, 22.4, 0.08, PALETTE.woodWalnut, 1), {
        pos: [-67.15, 31.85, 52.0],
      }),
      transformGeo(rbox(0.45, 1.65, 22.4, 0.08, PALETTE.woodWalnut, 1), {
        pos: [-81.65, 31.85, 52.0],
      }),
      transformGeo(rbox(14.6, 1.65, 0.45, 0.08, PALETTE.woodWalnut, 1), {
        pos: [-74.4, 31.85, 41.05],
      }),
      transformGeo(rbox(14.6, 1.65, 0.45, 0.08, PALETTE.woodWalnut, 1), {
        pos: [-74.4, 31.85, 62.95],
      }),
      transformGeo(rcyl(0.16, 0.16, 0.12, PALETTE.brassWarm, 10), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-66.85, 31.85, 45.0],
      }),
      transformGeo(rcyl(0.16, 0.16, 0.12, PALETTE.brassWarm, 10), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-66.85, 31.85, 59.0],
      }),
      transformGeo(rcyl(0.58, 0.42, 6.4, PALETTE.woodWalnut, 14), { pos: [-81.0, 29.4, 41.2] }),
      transformGeo(rcyl(0.58, 0.42, 6.4, PALETTE.woodWalnut, 14), { pos: [-68.0, 29.4, 41.2] }),
      transformGeo(rcyl(0.58, 0.42, 6.4, PALETTE.woodWalnut, 14), { pos: [-81.0, 29.4, 62.8] }),
      transformGeo(rcyl(0.58, 0.42, 6.4, PALETTE.woodWalnut, 14), { pos: [-68.0, 29.4, 62.8] }),
      transformGeo(rbox(6.4, 0.08, 8.2, 0.04, PALETTE.parisGreen, 1), {
        pos: [-70.4, 33.44, 52.0],
      }),
      transformGeo(rbox(2.6, 0.06, 3.4, 0.02, PALETTE.porcelainWhite, 1), {
        rot: [0, 0.18, 0],
        pos: [-69.8, 33.49, 51.4],
      }),
      transformGeo(rcyl(0.38, 0.46, 0.48, PALETTE.ironworkPlum, 14), { pos: [-70.8, 33.64, 48.2] }),
      tube(
        [
          [-70.8, 33.8, 48.2],
          [-70.4, 34.7, 47.9],
          [-69.9, 35.5, 47.5],
        ],
        0.045,
        PALETTE.porcelainWhite,
        10,
        6
      ),
      transformGeo(rcyl(0.85, 1.1, 0.35, PALETTE.brassWarm, 16), { pos: [-78.5, 33.58, 61.5] }),
      transformGeo(rcyl(0.14, 0.18, 3.2, PALETTE.brassWarm, 10), { pos: [-78.5, 35.2, 61.5] }),
      transformGeo(rbox(2.2, 0.95, 1.35, 0.28, PALETTE.parisGreen, 2), { pos: [-78.1, 36.8, 61.5] }),
      // Sculpted Wooden Tabouret Stool beside the desk (`(-64.2, 26.2, 45.2)`)
      transformGeo(rcyl(1.65, 1.65, 0.42, PALETTE.woodOak, 20), { pos: [-64.2, 30.1, 45.2] }),
      transformGeo(rcyl(0.22, 0.16, 3.9, PALETTE.woodWalnut, 10), {
        rot: [0.1, 0, 0.1],
        pos: [-63.3, 28.1, 46.1],
      }),
      transformGeo(rcyl(0.22, 0.16, 3.9, PALETTE.woodWalnut, 10), {
        rot: [-0.1, 0, 0.1],
        pos: [-63.3, 28.1, 44.3],
      }),
      transformGeo(rcyl(0.22, 0.16, 3.9, PALETTE.woodWalnut, 10), {
        rot: [0.1, 0, -0.1],
        pos: [-65.1, 28.1, 46.1],
      }),
      transformGeo(rcyl(0.22, 0.16, 3.9, PALETTE.woodWalnut, 10), {
        rot: [-0.1, 0, -0.1],
        pos: [-65.1, 28.1, 44.3],
      })
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-74.5, 32.95, 52.0),
      new THREE.Vector3(7.75, 0.45, 12.25)
    );
    this.physics.addStaticCylinder(new THREE.Vector3(-64.2, 28.25, 45.2), 1.65, 1.3, 4.1, 12);
    this.perches.addStaticSegment(
      'attic_desk_east_edge',
      new THREE.Vector3(-66.85, 33.4, 40.5),
      new THREE.Vector3(-66.85, 33.4, 63.5),
      0.03,
      'wood'
    );

    // Pushable & Shatterable Desk Clutter
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(-67.8, 33.83, 45.6),
        PALETTE.porcelainWhite,
        PALETTE.coffeeDark,
        PALETTE.awningCobalt
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-68.4, 33.7, 56.6),
        PALETTE.porcelainWhite,
        PALETTE.goldGlow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(-70.6, 33.49, 43.2),
        PALETTE.porcelainWhite,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(-72.2, 33.8, 60.4), PALETTE.birdBlueTit)
      .body.sleep();
    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(-71.8, 33.95, 46.8),
        PALETTE.windowGlass,
        PALETTE.awningMint
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(-80.2, 33.9, 43.8),
        PALETTE.awningCobalt,
        PALETTE.sakuraPink
      )
      .body.sleep();
    this.propFactory
      .spawnStudioBook(new THREE.Vector3(-74.6, 33.58, 61.2), PALETTE.awningCobalt)
      .body.sleep();
    this.propFactory
      .spawnStudioBook(new THREE.Vector3(-74.5, 33.94, 61.1), PALETTE.berryRuby)
      .body.sleep();

    // Shelf Breakables
    this.propFactory
      .spawnBreakableTerracottaPot(new THREE.Vector3(-84.9, 39.29, 38.0), PALETTE.tulipCoral)
      .body.sleep();
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(-84.9, 39.22, 41.0), PALETTE.lavenderSprig)
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(-51.4, 37.45, 26.8),
        PALETTE.awningGold,
        PALETTE.coffeeDark
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-48.4, 37.32, 26.8),
        PALETTE.porcelainWhite,
        PALETTE.awningCoral
      )
      .body.sleep();

    // 2. Centerpiece Hanging Brass & Wrought-Iron Chandelier (`(-57.5, 43.2, 52.0)`) with Solid Disc Collider
    const chanX = -57.5;
    const chanY = 43.2;
    const chanZ = 52.0;
    const chanR = 5.2;
    atelierInteriorParts.push(
      transformGeo(rcyl(1.1, 0.75, 0.5, PALETTE.brassWarm, 18), { pos: [chanX, 51.35, chanZ] }),
      transformGeo(rcyl(0.14, 0.14, 8.0, PALETTE.brassWarm, 10), { pos: [chanX, 47.3, chanZ] }),
      transformGeo(rcyl(0.72, 0.45, 1.4, PALETTE.brassWarm, 16), { pos: [chanX, chanY + 0.2, chanZ] })
    );
    const chanRingPts: Array<[number, number, number]> = [];
    for (let s = 0; s <= 24; s++) {
      const a = (s / 24) * Math.PI * 2;
      chanRingPts.push([chanX + Math.cos(a) * chanR, chanY, chanZ + Math.sin(a) * chanR]);
    }
    atelierInteriorParts.push(tube(chanRingPts, 0.22, PALETTE.ironworkPlum, 32, 8));

    for (let arm = 0; arm < 8; arm++) {
      const a1 = (arm / 8) * Math.PI * 2;
      const aArc0 = ((arm + 0.14) / 8) * Math.PI * 2;
      const aArcMid = ((arm + 0.5) / 8) * Math.PI * 2;
      const aArc1 = ((arm + 0.86) / 8) * Math.PI * 2;
      const cx1 = chanX + Math.cos(a1) * chanR;
      const cz1 = chanZ + Math.sin(a1) * chanR;

      atelierInteriorParts.push(
        tube(
          [
            [chanX, chanY + 0.5, chanZ],
            [
              chanX + Math.cos(a1) * (chanR * 0.55),
              chanY - 0.55,
              chanZ + Math.sin(a1) * (chanR * 0.55),
            ],
            [cx1, chanY, cz1],
          ],
          0.09,
          PALETTE.brassWarm,
          10,
          6
        ),
        transformGeo(rcyl(0.42, 0.26, 0.22, PALETTE.brassWarm, 12), {
          pos: [cx1, chanY + 0.24, cz1],
        }),
        transformGeo(rcyl(0.16, 0.16, 0.85, PALETTE.porcelainWhite, 10), {
          pos: [cx1, chanY + 0.72, cz1],
        }),
        transformGeo(rcyl(0.12, 0.02, 0.36, PALETTE.goldGlow, 8), {
          pos: [cx1, chanY + 1.32, cz1],
        })
      );

      this.perches.addStaticSegment(
        `atelier_chandelier_${arm}`,
        new THREE.Vector3(
          chanX + Math.cos(aArc0) * chanR,
          chanY + 0.22,
          chanZ + Math.sin(aArc0) * chanR
        ),
        new THREE.Vector3(
          chanX + Math.cos(aArcMid) * chanR,
          chanY + 0.22,
          chanZ + Math.sin(aArcMid) * chanR
        ),
        0.12,
        'metal'
      );
      this.perches.addStaticSegment(
        `atelier_chandelier_${arm}_b`,
        new THREE.Vector3(
          chanX + Math.cos(aArcMid) * chanR,
          chanY + 0.22,
          chanZ + Math.sin(aArcMid) * chanR
        ),
        new THREE.Vector3(
          chanX + Math.cos(aArc1) * chanR,
          chanY + 0.22,
          chanZ + Math.sin(aArc1) * chanR
        ),
        0.12,
        'metal'
      );
    }

    // Static chandelier wheel collider (`top y = 43.22`) so chandelier breadcrumbs & coin rest on top
    const chanBody = this.physics.addStaticCylinder(
      new THREE.Vector3(chanX, 43.08, chanZ),
      5.35,
      5.35,
      0.28,
      12
    );
    this.physics.setBumpMetadata(chanBody, { surface: 'metal', causesDizzy: false });

    const chandelierPerchPos = new THREE.Vector3(chanX + chanR * 0.7, chanY + 0.22, chanZ);
    this.propFactory.spawnSeed(new THREE.Vector3(chanX + chanR * 0.85, 43.42, chanZ + 1.2));
    this.propFactory.spawnSeed(new THREE.Vector3(chanX - chanR * 0.85, 43.42, chanZ - 1.2));
    this.propFactory.spawnCoin(new THREE.Vector3(chanX, 43.52, chanZ + chanR * 0.88));

    // 3. Two Ceiling-Hung Botanical Fern Planters (`(-50.5, 44.2, 36.5)` & `(-50.5, 44.2, 67.5)`)
    for (const [fIdx, fz] of [
      [0, 36.5],
      [1, 67.5],
    ] as const) {
      const fxP = -50.5;
      const fyP = 44.2;
      atelierInteriorParts.push(
        transformGeo(rcyl(0.42, 0.52, 0.16, PALETTE.brassWarm, 12), { pos: [fxP, 51.52, fz] }),
        transformGeo(rcyl(0.075, 0.075, 4.9, PALETTE.brassWarm, 8), { pos: [fxP, 49.05, fz] }),
        transformGeo(smoothSphere(0.16, PALETTE.goldGlow, 8, 6), { pos: [fxP, 46.55, fz] }),
        transformGeo(rcyl(1.85, 1.15, 2.1, PALETTE.brickTerracotta, 18), { pos: [fxP, fyP, fz] })
      );
      for (let ch = 0; ch < 3; ch++) {
        const ca = (ch / 3) * Math.PI * 2 + 0.4;
        atelierInteriorParts.push(
          tube(
            [
              [fxP, 46.55, fz],
              [fxP + Math.cos(ca) * 1.72, fyP + 1.02, fz + Math.sin(ca) * 1.72],
            ],
            0.042,
            PALETTE.brassWarm,
            4,
            5
          )
        );
      }
      foliageParts.push(
        transformGeo(rbox(3.4, 1.4, 3.4, 0.55, PALETTE.leafSage, 2), { pos: [fxP, fyP + 1.2, fz] }),
        transformGeo(rbox(2.4, 1.2, 2.4, 0.45, PALETTE.grassSunlit, 2), {
          rot: [0, 0.6, 0],
          pos: [fxP, fyP + 1.9, fz],
        })
      );
      for (let s = 0; s < 8; s++) {
        const a0 = (s / 8) * Math.PI * 2;
        const a1 = ((s + 1) / 8) * Math.PI * 2;
        this.perches.addStaticSegment(
          s === 0 ? `atelier_hanging_fern_${fIdx}` : `atelier_hanging_fern_${fIdx}_${s}`,
          new THREE.Vector3(fxP + Math.cos(a0) * 1.8, fyP + 1.05, fz + Math.sin(a0) * 1.8),
          new THREE.Vector3(fxP + Math.cos(a1) * 1.8, fyP + 1.05, fz + Math.sin(a1) * 1.8),
          0.04,
          'stone'
        );
      }
    }

    // 4. Mid-Room Artist's A-Frame Studio Easel (`(-55.0, 26.2, 35.5)`), Leaning Canvases & Paint Worktable (`(-48.5, 26.2, 34.5)`)
    const easX = -55.0;
    const easZ = 35.5;
    const easYaw = 0.35;
    const easelGeo = this.buildStudioEaselGeometry(1.0, true);
    atelierInteriorParts.push(
      transformGeo(easelGeo, {
        rot: [0, easYaw, 0],
        pos: [easX, 26.2, easZ],
      }),
      transformGeo(rbox(4.4, 5.6, 0.26, 0.06, PALETTE.porcelainWhite, 1), {
        rot: [0.16, 0.04, 0],
        pos: [-44.5, 28.95, 26.14],
      }),
      transformGeo(rbox(3.8, 4.8, 0.26, 0.06, PALETTE.wallButtercup, 1), {
        rot: [0.21, -0.05, 0],
        pos: [-43.8, 28.55, 26.55],
      }),
      transformGeo(rbox(5.8, 0.55, 7.6, 0.14, PALETTE.woodOak, 1), { pos: [-48.5, 30.92, 34.5] }),
      transformGeo(rbox(5.0, 4.6, 6.8, 0.14, PALETTE.woodBirch, 1), { pos: [-48.5, 28.5, 34.5] })
    );
    const atelierEaselColPos = new THREE.Vector3(0, 5.05, -0.82)
      .applyAxisAngle(_upAxis, easYaw)
      .add(new THREE.Vector3(easX, 26.2, easZ));
    const atelierEaselBody = this.physics.addStaticBox(
      atelierEaselColPos,
      new THREE.Vector3(1.72, 5.05, 1.55),
      new THREE.Euler(0, easYaw, 0)
    );
    this.physics.setBumpMetadata(atelierEaselBody, { surface: 'wood', causesDizzy: false });
    this.physics.addStaticBox(
      new THREE.Vector3(-48.5, 28.7, 34.5),
      new THREE.Vector3(2.9, 2.5, 3.8)
    );
    const studioCrestL = new THREE.Vector3(-2.15, 9.48, -0.36)
      .applyAxisAngle(_upAxis, easYaw)
      .add(new THREE.Vector3(easX, 26.2, easZ));
    const studioCrestR = new THREE.Vector3(2.15, 9.48, -0.36)
      .applyAxisAngle(_upAxis, easYaw)
      .add(new THREE.Vector3(easX, 26.2, easZ));
    this.perches.addStaticSegment(
      'atelier_easel_crest',
      studioCrestL,
      studioCrestR,
      0.06,
      'wood'
    );
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(-47.2, 31.6, 36.6), PALETTE.tulipCoral)
      .body.sleep();
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(-48.8, 31.6, 37.2), PALETTE.ginkgoGold)
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(-46.8, 31.63, 33.8),
        PALETTE.awningMint,
        PALETTE.birdBlueTit
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(-50.2, 31.75, 36.2),
        PALETTE.windowGlass,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(-47.4, 31.29, 32.0),
        PALETTE.porcelainWhite,
        PALETTE.awningGold
      )
      .body.sleep();
    this.propFactory.spawnNestItem(
      'ribbon',
      new THREE.Vector3(-49.6, 31.48, 33.0),
      PALETTE.awningCoral
    );
    this.propFactory.spawnSeed(new THREE.Vector3(-48.2, 31.48, 31.8));

    // 5. South Brick Hearth Fireplace, Brass Andirons & Birch Logs, Mantelpiece (`top y = 35.82`) & Pendulum Clock
    atelierInteriorParts.push(
      transformGeo(rbox(11.6, 9.0, 3.4, 0.18, PALETTE.brickTerracotta, 1), {
        pos: [-62.0, 30.7, 27.0],
      }),
      transformGeo(rbox(6.4, 5.6, 2.4, 0.14, PALETTE.ironworkPlum, 1), {
        pos: [-62.0, 29.0, 27.8],
      }),
      transformGeo(rcyl(0.42, 0.38, 3.8, PALETTE.woodBirch, 10), {
        rot: [0, 0.12, Math.PI * 0.5],
        pos: [-62.0, 26.85, 28.1],
      }),
      transformGeo(rcyl(0.36, 0.34, 3.4, PALETTE.woodOak, 10), {
        rot: [0, -0.18, Math.PI * 0.5],
        pos: [-62.0, 27.42, 28.0],
      }),
      transformGeo(rcyl(0.16, 0.22, 1.6, PALETTE.brassWarm, 10), { pos: [-64.1, 27.1, 28.6] }),
      transformGeo(rcyl(0.16, 0.22, 1.6, PALETTE.brassWarm, 10), { pos: [-59.9, 27.1, 28.6] }),
      transformGeo(rbox(3.2, 0.55, 1.1, 0.2, PALETTE.goldGlow, 1), {
        pos: [-62.0, 26.55, 28.0],
      }),
      transformGeo(rbox(13.2, 0.85, 4.2, 0.14, PALETTE.wallCreamTrim, 1), {
        pos: [-62.0, 35.4, 27.2],
      }),
      // Cream plaster chimney breast (`front z = 26.725`) + Parisian Walnut Regulator Clock Case (`z = 26.72 .. 27.45`)
      transformGeo(rbox(11.2, 15.8, 1.35, 0.14, PALETTE.wallCreamTrim, 1), {
        pos: [-62.0, 43.7, 26.05],
      }),
      transformGeo(rbox(3.2, 5.8, 0.48, 0.12, PALETTE.woodWalnut, 1), {
        pos: [-62.0, 41.35, 26.96],
      }),
      transformGeo(rbox(3.65, 0.34, 0.62, 0.07, PALETTE.woodOak, 1), {
        pos: [-62.0, 44.36, 27.01],
      }),
      transformGeo(smoothSphere(0.18, PALETTE.brassWarm, 10, 8), {
        pos: [-62.0, 44.68, 27.05],
      }),
      transformGeo(rbox(3.55, 0.32, 0.58, 0.07, PALETTE.woodOak, 1), {
        pos: [-62.0, 38.34, 27.0],
      }),
      transformGeo(rcyl(0.16, 0.05, 0.36, PALETTE.woodWalnut, 10), {
        pos: [-62.0, 38.02, 27.0],
      }),
      // Recessed dark pendulum well + oak side pilasters framing the swinging brass pendulum
      transformGeo(rbox(2.1, 2.55, 0.12, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [-62.0, 39.88, 27.18],
      }),
      transformGeo(rbox(0.46, 2.65, 0.24, 0.05, PALETTE.woodOak, 1), {
        pos: [-63.28, 39.88, 27.26],
      }),
      transformGeo(rbox(0.46, 2.65, 0.24, 0.05, PALETTE.woodOak, 1), {
        pos: [-60.72, 39.88, 27.26],
      }),
      // Upper Brass Bezel & Porcelain Dial (`center = (-62.0, 42.65, 27.28)`)
      transformGeo(rcyl(1.36, 1.36, 0.26, PALETTE.brassWarm, 20), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-62.0, 42.65, 27.27],
      }),
      transformGeo(rcyl(1.18, 1.18, 0.28, PALETTE.porcelainWhite, 20), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-62.0, 42.65, 27.28],
      }),
      transformGeo(rcyl(0.11, 0.11, 0.36, PALETTE.brassWarm, 10), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-62.0, 42.65, 27.33],
      })
    );
    for (const [mx, my, mw, mh] of [
      [0, 0.94, 0.1, 0.24],
      [0, -0.94, 0.1, 0.24],
      [0.94, 0, 0.24, 0.1],
      [-0.94, 0, 0.24, 0.1],
    ] as const) {
      atelierInteriorParts.push(
        transformGeo(rbox(mw, mh, 0.06, 0.015, PALETTE.brassWarm, 1), {
          pos: [-62.0 + mx, 42.65 + my, 27.44],
        })
      );
    }
    this.createClockDialRig([-62.0, 42.65, 27.44], 0, 0.245);
    this.physics.addStaticBox(
      new THREE.Vector3(-62.0, 31.0, 27.0),
      new THREE.Vector3(6.2, 4.82, 2.0)
    );
    // Solid plaster chimney breast (`front z = 26.82`) & walnut regulator clock case (`front z = 27.50`)
    // above the mantelpiece so walking or flying above `y = 35.8` never clips into the wall or clock
    const chimneyBreastBody = this.physics.addStaticBox(
      new THREE.Vector3(-62.0, 43.75, 26.10),
      new THREE.Vector3(5.72, 7.95, 0.72)
    );
    this.physics.setBumpMetadata(chimneyBreastBody, { surface: 'stone', causesDizzy: true });
    const clockCaseBody = this.physics.addStaticBox(
      new THREE.Vector3(-62.0, 41.35, 27.02),
      new THREE.Vector3(1.92, 3.55, 0.48)
    );
    this.physics.setBumpMetadata(clockCaseBody, { surface: 'wood', causesDizzy: false });
    this.perches.addStaticSegment(
      'atelier_fireplace_mantel',
      new THREE.Vector3(-68.0, 35.825, 29.15),
      new THREE.Vector3(-56.0, 35.825, 29.15),
      0.03,
      'stone'
    );
    this.propFactory.spawnSeed(new THREE.Vector3(-64.2, 36.15, 28.45));
    this.propFactory
      .spawnBreakableTerracottaPot(new THREE.Vector3(-66.4, 36.3, 28.32), PALETTE.tulipYellow)
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-57.6, 36.13, 28.32),
        PALETTE.porcelainWhite,
        PALETTE.awningCobalt
      )
      .body.sleep();

    const pendMesh = new THREE.Mesh(
      mergeParts([
        transformGeo(rcyl(0.065, 0.065, 1.95, PALETTE.brassWarm, 8), { pos: [0, -0.975, 0] }),
        transformGeo(rcyl(0.44, 0.44, 0.14, PALETTE.goldGlow, 18), {
          rot: [Math.PI * 0.5, 0, 0],
          pos: [0, -1.98, 0],
        }),
      ]),
      this.mat
    );
    pendMesh.geometry.computeBoundingSphere();
    this.wallClockPendulum.position.set(-62.0, 41.55, 27.29);
    this.wallClockPendulum.add(pendMesh);
    this.root.add(this.wallClockPendulum);

    // 6. North Tall Walnut Bookcases (`(-61.0, 26.2, 76.8)`, `top cornice y = 44.2`) + Rolling Brass Library Ladder
    atelierInteriorParts.push(
      transformGeo(rbox(22.0, 17.8, 3.4, 0.18, PALETTE.woodWalnut, 1), {
        pos: [-61.0, 35.1, 76.95],
      }),
      transformGeo(rbox(23.0, 0.75, 3.9, 0.12, PALETTE.woodOak, 1), {
        pos: [-61.0, 44.2, 76.75],
      }),
      // Three horizontal oak shelf planks supporting the three tiers of studio reference books
      transformGeo(rbox(21.4, 0.34, 2.5, 0.06, PALETTE.woodOak, 1), {
        pos: [-61.0, 28.42, 75.95],
      }),
      transformGeo(rbox(21.4, 0.34, 2.5, 0.06, PALETTE.woodOak, 1), {
        pos: [-61.0, 33.22, 75.95],
      }),
      transformGeo(rbox(21.4, 0.34, 2.5, 0.06, PALETTE.woodOak, 1), {
        pos: [-61.0, 38.02, 75.95],
      }),
      transformGeo(rcyl(0.09, 0.09, 21.8, PALETTE.brassWarm, 10), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-61.0, 42.6, 74.72],
      })
    );
    for (const bxOff of [-71.4, -64.5, -57.5, -50.6]) {
      atelierInteriorParts.push(
        transformGeo(rbox(0.18, 0.18, 0.58, 0.04, PALETTE.brassWarm, 1), {
          pos: [bxOff, 42.6, 74.98],
        })
      );
    }
    for (const sideX of [-55.4, -53.6]) {
      atelierInteriorParts.push(
        transformGeo(rcyl(0.13, 0.13, 17.1, PALETTE.woodOak, 8), {
          rot: [-0.16, 0, 0],
          pos: [sideX, 34.4, 73.36],
        }),
        tube(
          [
            [sideX, 42.35, 74.63],
            [sideX, 42.78, 74.72],
            [sideX, 42.58, 74.9],
          ],
          0.075,
          PALETTE.brassWarm,
          6,
          6
        )
      );
    }
    for (let rung = 0; rung < 7; rung++) {
      const ry = 28.0 + rung * 2.2;
      const rzL = 72.34 + rung * 0.351;
      atelierInteriorParts.push(
        transformGeo(rcyl(0.08, 0.08, 1.88, PALETTE.brassWarm, 8), {
          rot: [0, 0, Math.PI * 0.5],
          pos: [-54.5, ry, rzL],
        })
      );
      if (rung >= 2) {
        this.perches.addStaticSegment(
          `atelier_ladder_rung_${rung}`,
          new THREE.Vector3(-55.25, ry + 0.08, rzL),
          new THREE.Vector3(-53.75, ry + 0.08, rzL),
          0.08,
          'metal'
        );
      }
    }

    const bookColors = [
      PALETTE.awningCoral,
      PALETTE.awningCobalt,
      PALETTE.awningMint,
      PALETTE.awningGold,
    ];
    for (let row = 0; row < 3; row++) {
      for (let bk = 0; bk < 8; bk++) {
        atelierInteriorParts.push(
          transformGeo(rbox(1.9, 3.2, 1.55, 0.08, bookColors[(row + bk) % 4], 1), {
            pos: [-69.5 + bk * 2.4, 30.2 + row * 4.8, 75.95],
          })
        );
      }
    }
    this.physics.addStaticBox(
      new THREE.Vector3(-61.0, 35.39, 76.75),
      new THREE.Vector3(11.5, 9.19, 1.95)
    );
    this.perches.addStaticSegment(
      'atelier_bookcase_rail_w',
      new THREE.Vector3(-71.6, 42.69, 74.72),
      new THREE.Vector3(-55.7, 42.69, 74.72),
      0.09,
      'metal'
    );
    this.perches.addStaticSegment(
      'atelier_bookcase_rail_e',
      new THREE.Vector3(-53.3, 42.69, 74.72),
      new THREE.Vector3(-50.4, 42.69, 74.72),
      0.09,
      'metal'
    );
    this.perches.addStaticSegment(
      'atelier_bookcase_cornice',
      new THREE.Vector3(-71.5, 44.575, 74.85),
      new THREE.Vector3(-50.5, 44.575, 74.85),
      0.03,
      'wood'
    );
    this.propFactory.spawnNestItem(
      'twig',
      new THREE.Vector3(-56.0, 44.85, 75.6),
      PALETTE.woodBirch
    );
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(-66.5, 45.08, 76.4),
        PALETTE.awningCoral,
        PALETTE.tulipYellow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(-52.5, 44.98, 76.4), PALETTE.lavenderSprig)
      .body.sleep();

    // 7. NW Velvet Wingback Reading Nook (`(-81.2, 26.2, 71.8)`), Gooseneck Floor Lamp & Walnut Tea Table
    atelierInteriorParts.push(
      // Braided circular accent rug beneath the reading nook (`top = 26.25`)
      transformGeo(rcyl(4.3, 4.35, 0.06, PALETTE.wallCreamTrim, 24), { pos: [-80.2, 26.23, 71.2] }),
      transformGeo(rcyl(3.1, 3.15, 0.065, PALETTE.awningCoral, 24), { pos: [-80.2, 26.235, 71.2] }),
      // Plush rose-velvet tufted wingback armchair angled toward the morning window (`rotY = 0.62`)
      transformGeo(rbox(4.6, 1.35, 4.4, 0.34, PALETTE.coatRose, 2), {
        rot: [0, 0.62, 0],
        pos: [-81.2, 27.65, 71.8],
      }),
      transformGeo(rbox(3.7, 0.62, 3.6, 0.24, PALETTE.awningCoral, 2), {
        rot: [0, 0.62, 0],
        pos: [-81.05, 28.45, 71.7],
      }),
      transformGeo(rbox(4.7, 4.8, 1.15, 0.36, PALETTE.coatRose, 2), {
        rot: [-0.1, 0.62, 0],
        pos: [-82.25, 30.35, 73.15],
      }),
      transformGeo(rbox(1.05, 2.25, 4.1, 0.32, PALETTE.coatRose, 2), {
        rot: [0, 0.62, 0],
        pos: [-79.6, 29.05, 72.9],
      }),
      transformGeo(rbox(1.05, 2.25, 4.1, 0.32, PALETTE.coatRose, 2), {
        rot: [0, 0.62, 0],
        pos: [-82.7, 29.05, 70.65],
      }),
      // Gold velvet bolster cushion
      transformGeo(rbox(1.85, 1.25, 0.68, 0.26, PALETTE.awningGold, 2), {
        rot: [0.22, 0.72, 0.08],
        pos: [-81.55, 29.25, 72.35],
      }),
      // Cabriole walnut legs
      transformGeo(rcyl(0.2, 0.12, 0.9, PALETTE.woodWalnut, 8), { pos: [-79.7, 26.65, 70.3] }),
      transformGeo(rcyl(0.2, 0.12, 0.9, PALETTE.woodWalnut, 8), { pos: [-82.7, 26.65, 73.3] }),
      transformGeo(rcyl(0.2, 0.12, 0.9, PALETTE.woodWalnut, 8), { pos: [-79.5, 26.65, 73.1] }),
      transformGeo(rcyl(0.2, 0.12, 0.9, PALETTE.woodWalnut, 8), { pos: [-82.9, 26.65, 70.5] }),
      // Round Walnut Pedestal Tea Table (`(-76.8, 26.2, 73.4)`, `top y = 29.36`)
      transformGeo(rcyl(0.95, 1.18, 0.24, PALETTE.woodWalnut, 16), { pos: [-76.8, 26.32, 73.4] }),
      transformGeo(rcyl(0.22, 0.28, 2.8, PALETTE.woodWalnut, 12), { pos: [-76.8, 27.8, 73.4] }),
      transformGeo(rcyl(1.85, 1.75, 0.28, PALETTE.woodOak, 20), { pos: [-76.8, 29.22, 73.4] }),
      // Tall Arched Brass Gooseneck Floor Lamp (`(-83.6, 26.2, 67.8)`)
      transformGeo(rcyl(1.05, 1.25, 0.28, PALETTE.brassWarm, 18), { pos: [-83.6, 26.34, 67.8] }),
      transformGeo(rcyl(0.11, 0.15, 8.4, PALETTE.brassWarm, 10), { pos: [-83.6, 30.6, 67.8] }),
      tube(
        [
          [-83.6, 34.7, 67.8],
          [-82.7, 36.1, 68.7],
          [-81.4, 36.25, 69.6],
          [-80.7, 35.55, 70.1],
        ],
        0.085,
        PALETTE.brassWarm,
        12,
        8
      ),
      transformGeo(rcyl(0.42, 1.18, 1.15, PALETTE.wallButtercup, 16), {
        pos: [-80.7, 35.05, 70.1],
      })
    );
    atelierFlameParts.push(
      transformGeo(smoothSphere(0.32, PALETTE.goldGlow, 10, 8), { pos: [-80.7, 34.72, 70.1] })
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-81.2, 28.4, 71.8),
      new THREE.Vector3(2.35, 2.2, 2.25),
      new THREE.Euler(0, 0.62, 0)
    );
    this.physics.addStaticCylinder(new THREE.Vector3(-76.8, 27.78, 73.4), 1.85, 1.2, 3.16, 12);
    this.perches.addStaticSegment(
      'atelier_armchair_crest',
      new THREE.Vector3(-83.35, 32.78, 72.35),
      new THREE.Vector3(-81.05, 32.78, 74.0),
      0.1,
      'wood'
    );
    this.perches.addStaticSegment(
      'atelier_floor_lamp_arm',
      new THREE.Vector3(-82.7, 36.18, 68.7),
      new THREE.Vector3(-81.3, 36.32, 69.65),
      0.08,
      'metal'
    );
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-76.3, 29.62, 73.1),
        PALETTE.porcelainWhite,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnStudioBook(new THREE.Vector3(-77.3, 29.54, 73.8), PALETTE.awningMint)
      .body.sleep();

    // 8. SW Sculptor & Cartographer Corner: Terrestrial Globe, Classical Bust Plinth & Flat-File Print Chest
    atelierInteriorParts.push(
      // Turned walnut globe stand (`(-81.4, 26.2, 30.0)`) + celestial-blue terrestrial globe & hollow brass horizon/meridian rings
      transformGeo(rcyl(1.15, 1.38, 0.28, PALETTE.woodWalnut, 16), { pos: [-81.4, 26.34, 30.0] }),
      transformGeo(rcyl(0.2, 0.28, 3.2, PALETTE.woodWalnut, 12), { pos: [-81.4, 28.0, 30.0] }),
      tube(
        Array.from({ length: 25 }, (_, i) => {
          const ga = (i / 24) * Math.PI * 2;
          return [-81.4 + Math.cos(ga) * 1.82, 30.65, 30.0 + Math.sin(ga) * 1.82] as [
            number,
            number,
            number,
          ];
        }),
        0.09,
        PALETTE.brassWarm,
        24,
        6,
        true
      ),
      transformGeo(smoothSphere(1.58, PALETTE.skyMidDawn, 18, 14), {
        rot: [0.38, 0.6, 0],
        pos: [-81.4, 30.65, 30.0],
      }),
      transformGeo(smoothSphere(0.76, PALETTE.leafSage, 12, 10, [1.2, 0.85, 0.55]), {
        rot: [0.25, 0.4, 0.2],
        pos: [-80.55, 31.1, 30.65],
      }),
      transformGeo(smoothSphere(0.68, PALETTE.wallOchre, 12, 10, [1.0, 0.9, 0.5]), {
        rot: [-0.2, -0.5, 0.1],
        pos: [-82.1, 30.35, 29.15],
      }),
      tube(
        [
          [-81.4, 28.88, 30.0],
          [-81.4, 29.55, 31.68],
          [-81.4, 30.65, 31.82],
          [-81.4, 31.95, 31.32],
          [-81.4, 32.45, 30.0],
        ],
        0.075,
        PALETTE.brassWarm,
        14,
        8
      ),
      // Fluted Limestone Plinth (`(-76.2, 26.2, 28.2)`, `top y = 30.9`) + Porcelain Classical Muse Bust
      transformGeo(rbox(2.4, 0.42, 2.4, 0.08, PALETTE.wallCreamTrim, 1), { pos: [-76.2, 26.41, 28.2] }),
      transformGeo(rcyl(0.92, 1.02, 4.1, PALETTE.wallLimestone, 16), { pos: [-76.2, 28.62, 28.2] }),
      transformGeo(rbox(2.3, 0.36, 2.3, 0.08, PALETTE.wallCreamTrim, 1), { pos: [-76.2, 30.72, 28.2] }),
      transformGeo(rcyl(0.55, 0.72, 0.45, PALETTE.porcelainWhite, 14), { pos: [-76.2, 31.12, 28.2] }),
      transformGeo(smoothSphere(0.88, PALETTE.porcelainWhite, 14, 12, [1.18, 0.82, 0.78]), {
        pos: [-76.2, 31.78, 28.2],
      }),
      transformGeo(smoothSphere(0.64, PALETTE.porcelainWhite, 14, 12, [0.92, 1.14, 0.96]), {
        pos: [-76.2, 32.85, 28.25],
      }),
      transformGeo(smoothSphere(0.38, PALETTE.wallCreamTrim, 10, 8), {
        pos: [-76.2, 33.15, 27.68],
      }),
      // Oak 4-Drawer Flat-File Print Chest (`(-82.8, 26.2, 35.0)`, `top y = 29.5`) + Wicker Canvas Roll Basket
      transformGeo(rbox(3.8, 3.3, 4.6, 0.14, PALETTE.woodOak, 1), { pos: [-82.8, 27.85, 35.0] }),
      transformGeo(rbox(4.0, 0.24, 4.8, 0.08, PALETTE.woodWalnut, 1), { pos: [-82.8, 29.52, 35.0] }),
      transformGeo(rcyl(0.95, 0.75, 2.35, PALETTE.woodBirch, 14), { pos: [-78.8, 27.38, 34.4] }),
      transformGeo(rcyl(0.22, 0.22, 3.6, PALETTE.porcelainWhite, 10), {
        rot: [0.16, 0, -0.14],
        pos: [-78.65, 28.6, 34.25],
      }),
      transformGeo(rcyl(0.2, 0.2, 3.9, PALETTE.awningCream, 10), {
        rot: [-0.14, 0, 0.18],
        pos: [-78.95, 28.75, 34.55],
      })
    );
    for (let dr = 0; dr < 3; dr++) {
      atelierInteriorParts.push(
        transformGeo(rbox(0.14, 0.72, 3.8, 0.04, PALETTE.woodBirch, 1), {
          pos: [-80.85, 26.95 + dr * 0.92, 35.0],
        }),
        transformGeo(rbox(0.22, 0.14, 0.65, 0.03, PALETTE.brassWarm, 1), {
          pos: [-80.76, 26.95 + dr * 0.92, 35.0],
        })
      );
    }
    this.physics.addStaticCylinder(new THREE.Vector3(-81.4, 29.3, 30.0), 1.85, 1.35, 6.2, 12);
    this.physics.addStaticBox(new THREE.Vector3(-76.2, 29.8, 28.2), new THREE.Vector3(1.2, 3.6, 1.2));
    this.physics.addStaticBox(new THREE.Vector3(-82.8, 27.92, 35.0), new THREE.Vector3(2.0, 1.72, 2.4));
    this.perches.addStaticSegment(
      'atelier_globe_meridian',
      new THREE.Vector3(-81.4, 32.45, 29.75),
      new THREE.Vector3(-81.4, 32.25, 30.85),
      0.08,
      'metal'
    );
    this.perches.addStaticSegment(
      'atelier_print_chest_edge',
      new THREE.Vector3(-80.88, 29.64, 32.85),
      new THREE.Vector3(-80.88, 29.64, 37.15),
      0.05,
      'wood'
    );

    // 9. NE Indoor Conservatory Botanical Stand, Monstera Floor Tree & Vintage Brass Watering Can
    atelierInteriorParts.push(
      // 3-Tier Wrought-Iron Parisian Conservatory Etagere (`(-42.8, 26.2, 71.4)`)
      transformGeo(rbox(2.8, 0.2, 6.0, 0.06, PALETTE.ironworkPlum, 1), { pos: [-42.8, 27.4, 71.4] }),
      transformGeo(rbox(2.5, 0.2, 5.6, 0.06, PALETTE.ironworkPlum, 1), { pos: [-42.6, 29.8, 71.4] }),
      transformGeo(rbox(2.2, 0.2, 5.2, 0.06, PALETTE.ironworkPlum, 1), { pos: [-42.4, 32.2, 71.4] }),
      transformGeo(rcyl(0.1, 0.1, 6.6, PALETTE.ironworkPlum, 8), { pos: [-43.9, 29.5, 68.6] }),
      transformGeo(rcyl(0.1, 0.1, 6.6, PALETTE.ironworkPlum, 8), { pos: [-43.9, 29.5, 74.2] }),
      transformGeo(rcyl(0.1, 0.1, 6.6, PALETTE.ironworkPlum, 8), { pos: [-41.5, 29.5, 68.6] }),
      transformGeo(rcyl(0.1, 0.1, 6.6, PALETTE.ironworkPlum, 8), { pos: [-41.5, 29.5, 74.2] }),
      // Glazed botanical pots on the 3 shelves
      transformGeo(rcyl(0.68, 0.48, 0.95, PALETTE.awningCobalt, 14), { pos: [-42.8, 27.98, 69.8] }),
      transformGeo(rcyl(0.65, 0.46, 0.92, PALETTE.brickTerracotta, 14), { pos: [-42.8, 27.96, 73.0] }),
      transformGeo(rcyl(0.62, 0.44, 0.88, PALETTE.awningMint, 14), { pos: [-42.6, 30.34, 71.4] }),
      transformGeo(rcyl(0.58, 0.42, 0.84, PALETTE.wallButtercup, 14), { pos: [-42.4, 32.72, 70.1] }),
      transformGeo(rcyl(0.58, 0.42, 0.84, PALETTE.brickTerracotta, 14), { pos: [-42.4, 32.72, 72.7] }),
      // Tall Glazed Cobalt Floor Planter (`(-43.6, 26.2, 65.4)`) + Sculpted Indoor Fiddle-Leaf Trunk
      transformGeo(rcyl(1.45, 1.05, 2.35, PALETTE.awningCobalt, 18), { pos: [-43.6, 27.38, 65.4] }),
      transformGeo(rcyl(1.55, 1.48, 0.28, PALETTE.porcelainWhite, 18), { pos: [-43.6, 28.52, 65.4] }),
      tube(
        [
          [-43.6, 28.5, 65.4],
          [-43.85, 31.1, 65.55],
          [-43.45, 33.6, 65.25],
          [-43.75, 35.4, 65.45],
        ],
        0.22,
        PALETTE.trunkBark,
        12,
        8
      ),
      tube(
        [
          [-43.7, 32.2, 65.4],
          [-44.85, 33.4, 66.2],
          [-45.65, 34.1, 66.75],
        ],
        0.13,
        PALETTE.trunkBark,
        10,
        6
      ),
      // Vintage Long-Spouted Brass Watering Can (`(-45.5, 26.2, 68.2)`)
      transformGeo(rcyl(0.55, 0.62, 1.15, PALETTE.brassWarm, 14), { pos: [-45.5, 26.78, 68.2] }),
      tube(
        [
          [-45.5, 26.6, 68.65],
          [-45.5, 27.35, 69.45],
          [-45.5, 27.85, 69.95],
        ],
        0.075,
        PALETTE.brassWarm,
        8,
        6
      ),
      tube(
        [
          [-45.5, 27.35, 67.7],
          [-45.5, 27.75, 67.35],
          [-45.5, 26.9, 67.45],
        ],
        0.065,
        PALETTE.brassWarm,
        8,
        6
      )
    );
    foliageParts.push(
      transformGeo(rbox(1.9, 1.25, 1.9, 0.45, PALETTE.leafSage, 2), { pos: [-42.8, 28.85, 69.8] }),
      transformGeo(rbox(1.85, 1.2, 1.85, 0.45, PALETTE.grassSunlit, 2), { pos: [-42.8, 28.82, 73.0] }),
      transformGeo(rbox(2.1, 1.35, 2.2, 0.48, PALETTE.leafDeep, 2), { pos: [-42.6, 31.25, 71.4] }),
      transformGeo(rbox(1.75, 1.15, 1.75, 0.42, PALETTE.leafSage, 2), { pos: [-42.4, 33.55, 70.1] }),
      transformGeo(rbox(1.75, 1.15, 1.75, 0.42, PALETTE.tulipCoral, 2), { pos: [-42.4, 33.55, 72.7] }),
      // Lush Fiddle-Leaf / Monstera canopy clusters
      transformGeo(smoothSphere(1.85, PALETTE.leafDeep, 14, 10, [1.15, 0.72, 1.08]), {
        pos: [-43.65, 35.65, 65.4],
      }),
      transformGeo(smoothSphere(1.55, PALETTE.leafSage, 14, 10, [1.1, 0.68, 1.05]), {
        pos: [-42.6, 34.4, 64.55],
      }),
      transformGeo(smoothSphere(1.45, PALETTE.grassSunlit, 14, 10, [1.05, 0.65, 1.05]), {
        pos: [-45.55, 34.35, 66.75],
      })
    );
    this.physics.addStaticBox(new THREE.Vector3(-42.7, 29.6, 71.4), new THREE.Vector3(1.5, 3.4, 3.1));
    this.physics.addStaticCylinder(new THREE.Vector3(-43.6, 27.45, 65.4), 1.55, 1.1, 2.5, 12);
    this.perches.addStaticSegment(
      'atelier_plant_stand_top',
      new THREE.Vector3(-43.5, 32.32, 68.8),
      new THREE.Vector3(-43.5, 32.32, 74.0),
      0.06,
      'metal'
    );
    this.perches.addStaticSegment(
      'atelier_indoor_tree_bough',
      new THREE.Vector3(-43.8, 32.35, 65.45),
      new THREE.Vector3(-45.55, 34.18, 66.7),
      0.09,
      'wood'
    );

    // 10. SE Vintage Brass Horn Gramophone + Fireplace Brass Fender, Firewood Basket & Glowing Embers
    atelierInteriorParts.push(
      // Carved Walnut Gramophone Pedestal (`(-42.6, 26.2, 29.8)`, `top y = 30.15`) + Morning-Glory Brass Horn
      transformGeo(rbox(3.1, 3.7, 3.1, 0.16, PALETTE.woodWalnut, 1), { pos: [-42.6, 28.05, 29.8] }),
      transformGeo(rbox(3.35, 0.3, 3.35, 0.08, PALETTE.woodOak, 1), { pos: [-42.6, 30.0, 29.8] }),
      transformGeo(rcyl(1.08, 1.08, 0.12, PALETTE.ironworkPlum, 18), { pos: [-42.6, 30.21, 29.8] }),
      transformGeo(rcyl(0.32, 0.32, 0.14, PALETTE.awningCoral, 14), { pos: [-42.6, 30.23, 29.8] }),
      tube(
        [
          [-41.8, 30.25, 29.1],
          [-41.7, 31.35, 29.15],
          [-42.45, 32.2, 29.85],
        ],
        0.12,
        PALETTE.brassWarm,
        10,
        8
      ),
      transformGeo(
        lathe(
          [
            [0.14, 0],
            [0.32, 0.65],
            [0.72, 1.25],
            [1.38, 1.75],
          ],
          PALETTE.goldGlow,
          18
        ),
        {
          rot: [0.68, 0, 0.72],
          pos: [-42.45, 32.2, 29.85],
        }
      ),
      // Filigree Brass Fireplace Fender Rail (`(-62.0, 26.2, 29.45)`) & Birch Firewood Basket (`(-67.6, 26.2, 28.5)`)
      transformGeo(rbox(7.8, 0.24, 0.28, 0.06, PALETTE.brassWarm, 1), { pos: [-62.0, 26.32, 29.45] }),
      transformGeo(rbox(7.6, 0.16, 0.18, 0.05, PALETTE.brassWarm, 1), { pos: [-62.0, 27.12, 29.45] }),
      transformGeo(rcyl(0.22, 0.24, 1.15, PALETTE.goldGlow, 10), { pos: [-65.75, 26.78, 29.45] }),
      transformGeo(rcyl(0.22, 0.24, 1.15, PALETTE.goldGlow, 10), { pos: [-58.25, 26.78, 29.45] }),
      transformGeo(rbox(2.4, 1.45, 1.9, 0.2, PALETTE.woodBirch, 1), { pos: [-67.6, 26.92, 28.5] }),
      transformGeo(rcyl(0.32, 0.3, 2.1, PALETTE.woodBirch, 10), {
        rot: [0, 0.15, Math.PI * 0.5],
        pos: [-67.6, 27.78, 28.45],
      }),
      transformGeo(rcyl(0.28, 0.28, 1.95, PALETTE.woodOak, 10), {
        rot: [0, -0.18, Math.PI * 0.5],
        pos: [-67.55, 28.18, 28.6],
      })
    );
    atelierFlameParts.push(
      transformGeo(smoothSphere(0.55, PALETTE.goldGlow, 10, 8, [2.2, 0.55, 0.85]), {
        pos: [-62.0, 26.78, 28.05],
      }),
      transformGeo(sharedFlameGeo.clone(), { pos: [-62.55, 27.55, 28.05] }),
      transformGeo(sharedFlameGeo.clone(), { pos: [-61.45, 27.62, 28.02] })
    );
    this.physics.addStaticBox(new THREE.Vector3(-42.6, 28.18, 29.8), new THREE.Vector3(1.68, 2.0, 1.68));
    this.perches.addStaticSegment(
      'atelier_gramophone_horn',
      new THREE.Vector3(-43.65, 33.48, 30.25),
      new THREE.Vector3(-43.15, 33.52, 31.15),
      0.07,
      'metal'
    );

    // 11. Overhead Warm Edison Fairy-Bulb String Garlands Draped Between Ceiling Rafters (`y = 48.1..49.2`)
    for (const [gx, zPairs] of [
      [-69.5, [[32.0, 42.0], [42.0, 62.0], [62.0, 72.0]]],
      [-46.5, [[32.0, 42.0], [42.0, 62.0], [62.0, 72.0]]],
    ] as const) {
      for (const [z0, z1] of zPairs) {
        const span = z1 - z0;
        const sag = span > 14 ? 1.35 : 0.78;
        const pts: Array<[number, number, number]> = [];
        for (let s = 0; s <= 8; s++) {
          const u = s / 8;
          const zz = z0 + span * u;
          const yy = 49.28 - Math.sin(u * Math.PI) * sag;
          pts.push([gx, yy, zz]);
          if (s > 0 && s < 8 && (span > 14 ? s % 2 === 1 : s === 4)) {
            atelierInteriorParts.push(
              transformGeo(rcyl(0.08, 0.08, 0.18, PALETTE.brassWarm, 8), {
                pos: [gx, yy - 0.1, zz],
              })
            );
            atelierFlameParts.push(
              transformGeo(smoothSphere(0.19, PALETTE.goldGlow, 8, 6, [0.9, 1.25, 0.9]), {
                pos: [gx, yy - 0.3, zz],
              })
            );
          }
        }
        atelierInteriorParts.push(tube(pts, 0.038, PALETTE.ironworkPlum, 12, 6));
      }
    }

    const atelierFlamesMesh = new THREE.Mesh(mergeParts(atelierFlameParts), this.glowGoldMat);
    atelierFlamesMesh.castShadow = false;
    atelierFlamesMesh.receiveShadow = false;
    atelierFlamesMesh.geometry.computeBoundingSphere();
    this.root.add(atelierFlamesMesh);

    // 12. Slanted Golden Morning Volumetric Sunbeam Shafts Streaming Through the East French Window
    const sunbeamParts: THREE.BufferGeometry[] = [];
    for (const [bzOff, beamW, topY] of [
      [-4.6, 4.2, 44.2],
      [0.0, 4.8, 45.4],
      [4.6, 4.2, 44.2],
    ] as const) {
      sunbeamParts.push(
        transformGeo(rcyl(1.85, 3.15, 22.4, PALETTE.sunHalo, 14), {
          rot: [0, 0, -0.74],
          scale: [0.42, 1.0, beamW / 4.2],
          pos: [-48.2, (topY + 26.6) * 0.5, 52.0 + bzOff],
        }),
        // Warm golden sunlight dapple pool across the Kilim carpet
        transformGeo(rcyl(3.2, 3.4, 0.02, PALETTE.sunHalo, 16), {
          scale: [1.35, 1.0, 0.92],
          pos: [-56.4, 26.305, 52.0 + bzOff * 1.06],
        })
      );
    }
    const sunbeamMat = createUnlitPastelFXMaterial(PALETTE.sunHalo, 0.068, true);
    const atelierSunbeamsMesh = new THREE.Mesh(mergeParts(sunbeamParts), sunbeamMat);
    atelierSunbeamsMesh.castShadow = false;
    atelierSunbeamsMesh.receiveShadow = false;
    atelierSunbeamsMesh.renderOrder = 3;
    atelierSunbeamsMesh.geometry.computeBoundingSphere();
    this.root.add(atelierSunbeamsMesh);

    // --- D. Cozy Proportional Brass Birdcage (`center = (-74.5, 34.00, 52.0)`, `cageR = 2.68 SU`, 44 bars) ---
    const cageCx = -74.5;
    const cageCz = 52.0;
    const cageTrayTopY = 34.0;
    const cageR = 2.68;
    const cageWallH = 3.65;
    const cageParts: THREE.BufferGeometry[] = [];

    const cageFloorBody = this.physics.addStaticCylinder(
      new THREE.Vector3(cageCx, 33.7, cageCz),
      cageR + 0.14,
      cageR + 0.24,
      0.6,
      16
    );
    this.physics.setBumpMetadata(cageFloorBody, { surface: 'ceramic', causesDizzy: false });
    this.physics.addStaticCylinder(
      new THREE.Vector3(cageCx + 0.85, cageTrayTopY + 0.12, cageCz - 0.95),
      0.46,
      0.38,
      0.24,
      10
    );

    cageParts.push(
      transformGeo(rcyl(cageR + 0.16, cageR + 0.28, 0.46, PALETTE.brassWarm, 32), {
        pos: [cageCx, 33.63, cageCz],
      }),
      transformGeo(
        rcyl(cageR - 0.04, cageR - 0.04, 0.18, PALETTE.porcelainWhite, 32, { topLift: 0.08 }),
        {
          pos: [cageCx, 33.91, cageCz],
        }
      ),
      transformGeo(rcyl(0.46, 0.36, 0.24, PALETTE.awningMint, 16), {
        pos: [cageCx + 0.85, cageTrayTopY + 0.12, cageCz - 0.95],
      }),
      // Full-span birch perch dowel reaching the front/rear brass bars + brass bar-clasp end caps
      transformGeo(rcyl(0.1, 0.1, 5.28, PALETTE.woodBirch, 10), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [cageCx - 0.5, cageTrayTopY + 1.15, cageCz],
      }),
      transformGeo(rcyl(0.15, 0.15, 0.22, PALETTE.brassWarm, 10), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [cageCx - 0.5, cageTrayTopY + 1.15, cageCz - 2.63],
      }),
      transformGeo(rcyl(0.15, 0.15, 0.22, PALETTE.brassWarm, 10), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [cageCx - 0.5, cageTrayTopY + 1.15, cageCz + 2.63],
      }),
      // Dome-crown-anchored brass bell rod, bell & clapper directly on the central cage axis
      transformGeo(rcyl(0.032, 0.032, 0.88, PALETTE.brassWarm, 8), {
        pos: [cageCx, cageTrayTopY + cageWallH + 1.77, cageCz],
      }),
      transformGeo(rcyl(0.11, 0.26, 0.34, PALETTE.goldGlow, 14), {
        pos: [cageCx, cageTrayTopY + cageWallH + 1.25, cageCz],
      }),
      transformGeo(smoothSphere(0.065, PALETTE.brassWarm, 8, 6), {
        pos: [cageCx, cageTrayTopY + cageWallH + 1.06, cageCz],
      })
    );
    this.perches.addStaticSegment(
      'cage_inner_dowel',
      new THREE.Vector3(cageCx - 0.5, cageTrayTopY + 1.25, cageCz - 1.65),
      new THREE.Vector3(cageCx - 0.5, cageTrayTopY + 1.25, cageCz + 1.65),
      0.09,
      'wood'
    );

    const barCount = 44;
    const doorHalfAngle = 0.34;
    const doorH = 2.65;
    const doorLintelY = cageTrayTopY + 0.08 + doorH;
    for (let i = 0; i < barCount; i++) {
      const ang = (i / barCount) * Math.PI * 2;
      const normAng = Math.atan2(Math.sin(ang), Math.cos(ang));
      const inDoorGap = Math.abs(normAng) < doorHalfAngle;
      const bx = cageCx + Math.cos(ang) * cageR;
      const bz = cageCz + Math.sin(ang) * cageR;

      if (!inDoorGap) {
        cageParts.push(
          transformGeo(rcyl(0.052, 0.052, cageWallH, PALETTE.brassWarm, 6), {
            pos: [bx, cageTrayTopY + cageWallH * 0.5, bz],
          })
        );
      } else {
        // Vertical transom bars above the hinged gate lintel up to the upper dome ring (`36.73 .. 37.65`)
        const transomH = cageTrayTopY + cageWallH - doorLintelY;
        if (transomH > 0.1) {
          cageParts.push(
            transformGeo(rcyl(0.048, 0.048, transomH, PALETTE.brassWarm, 6), {
              pos: [bx, doorLintelY + transomH * 0.5, bz],
            })
          );
        }
      }

      if (i % 2 === 0) {
        const ribPts: Array<[number, number, number]> = [];
        for (let s = 0; s <= 6; s++) {
          const u = s / 6;
          const rr = cageR * Math.cos(u * Math.PI * 0.5);
          const ry = cageTrayTopY + cageWallH + Math.sin(u * Math.PI * 0.5) * 2.15;
          ribPts.push([cageCx + Math.cos(ang) * rr, ry, cageCz + Math.sin(ang) * rr]);
        }
        cageParts.push(tube(ribPts, 0.052, PALETTE.brassWarm, 10, 6));
      }
    }

    // Stout South (hinge) & North (latch) vertical door jamb posts + curved brass door lintel arc
    for (const jSign of [-1, 1] as const) {
      const jAng = jSign * doorHalfAngle;
      cageParts.push(
        transformGeo(rcyl(0.072, 0.072, cageWallH, PALETTE.brassWarm, 8), {
          pos: [
            cageCx + Math.cos(jAng) * cageR,
            cageTrayTopY + cageWallH * 0.5,
            cageCz + Math.sin(jAng) * cageR,
          ],
        })
      );
    }
    const lintelPts: Array<[number, number, number]> = [];
    for (let s = 0; s <= 12; s++) {
      const a = -doorHalfAngle + (s / 12) * (doorHalfAngle * 2);
      lintelPts.push([cageCx + Math.cos(a) * cageR, doorLintelY, cageCz + Math.sin(a) * cageR]);
    }
    cageParts.push(tube(lintelPts, 0.064, PALETTE.brassWarm, 12, 6));

    // Fixed brass keeper staples on the North jamb (`ang = +doorHalfAngle`) holding the hairpin latch captive
    const northJambX = cageCx + Math.cos(doorHalfAngle) * cageR;
    const northJambZ = cageCz + Math.sin(doorHalfAngle) * cageR;
    for (const zKeepOff of [0.06, 0.42]) {
      cageParts.push(
        tube(
          [
            [northJambX - 0.02, cageTrayTopY + 1.35, northJambZ + zKeepOff - 0.06],
            [northJambX + 0.16, cageTrayTopY + 1.35, northJambZ + zKeepOff],
            [northJambX - 0.02, cageTrayTopY + 1.35, northJambZ + zKeepOff + 0.06],
          ],
          0.036,
          PALETTE.brassWarm,
          6,
          6
        )
      );
    }

    for (const bandY of [cageTrayTopY + 1.85, cageTrayTopY + cageWallH]) {
      const ringPts: Array<[number, number, number]> = [];
      for (let s = 0; s <= 40; s++) {
        const a =
          bandY < cageTrayTopY + cageWallH - 0.1
            ? doorHalfAngle + (s / 40) * (Math.PI * 2 - doorHalfAngle * 2)
            : (s / 40) * Math.PI * 2;
        ringPts.push([cageCx + Math.cos(a) * cageR, bandY, cageCz + Math.sin(a) * cageR]);
      }
      cageParts.push(tube(ringPts, 0.068, PALETTE.brassWarm, 40, 6));
    }
    const topRingPts: Array<[number, number, number]> = [];
    for (let s = 0; s <= 18; s++) {
      const a = (s / 18) * Math.PI * 2;
      topRingPts.push([
        cageCx,
        cageTrayTopY + cageWallH + 2.76 + Math.sin(a) * 0.24,
        cageCz + Math.cos(a) * 0.24,
      ]);
    }
    cageParts.push(
      transformGeo(rcyl(0.32, 0.16, 0.48, PALETTE.goldGlow, 12), {
        pos: [cageCx, cageTrayTopY + cageWallH + 2.32, cageCz],
      }),
      tube(topRingPts, 0.052, PALETTE.goldGlow, 18, 6, true)
    );

    const cageMesh = new THREE.Mesh(mergeParts(cageParts), this.mat);
    cageMesh.castShadow = true;
    cageMesh.receiveShadow = true;
    cageMesh.geometry.computeBoundingSphere();
    this.root.add(cageMesh);

    // Outward-swinging curved wire gate hinged on the South jamb (`hingeAngle = -doorHalfAngle`)
    const hingeAngle = -doorHalfAngle;
    const pivotX = cageCx + Math.cos(hingeAngle) * cageR;
    const pivotZ = cageCz + Math.sin(hingeAngle) * cageR;
    const doorEndX = northJambX - pivotX;
    const doorEndZ = northJambZ - pivotZ;
    this.cageDoorPivot.position.set(pivotX, cageTrayTopY + 0.08, pivotZ);

    const doorBotPts: Array<[number, number, number]> = [];
    const doorTopPts: Array<[number, number, number]> = [];
    for (let s = 0; s <= 12; s++) {
      const a = -doorHalfAngle + (s / 12) * (doorHalfAngle * 2);
      const lx = cageCx + Math.cos(a) * cageR - pivotX;
      const lz = cageCz + Math.sin(a) * cageR - pivotZ;
      doorBotPts.push([lx, 0.06, lz]);
      doorTopPts.push([lx, doorH - 0.04, lz]);
    }
    const doorParts: THREE.BufferGeometry[] = [
      transformGeo(rcyl(0.062, 0.062, doorH, PALETTE.brassWarm, 8), {
        pos: [0, doorH * 0.5, 0.05],
      }),
      transformGeo(rcyl(0.062, 0.062, doorH, PALETTE.brassWarm, 8), {
        pos: [doorEndX, doorH * 0.5, doorEndZ - 0.04],
      }),
      // Two brass hinge barrels clasping the South jamb post
      transformGeo(rcyl(0.098, 0.098, 0.24, PALETTE.goldGlow, 10), { pos: [0, 0.44, 0] }),
      transformGeo(rcyl(0.098, 0.098, 0.24, PALETTE.goldGlow, 10), { pos: [0, doorH - 0.42, 0] }),
      // Curved top & bottom gate rails matching `cageR`
      tube(doorBotPts, 0.056, PALETTE.brassWarm, 12, 6),
      tube(doorTopPts, 0.056, PALETTE.brassWarm, 12, 6),
      // Brass latch loop on the gate's North stile aligned with `y = cageTrayTopY + 1.35` (`y_local = 1.27`)
      tube(
        [
          [doorEndX - 0.02, 1.27, doorEndZ - 0.12],
          [doorEndX + 0.16, 1.27, doorEndZ - 0.05],
          [doorEndX - 0.02, 1.27, doorEndZ + 0.01],
        ],
        0.036,
        PALETTE.goldGlow,
        6,
        6
      ),
    ];
    for (let db = 1; db <= 4; db++) {
      const a = -doorHalfAngle + (db / 5) * (doorHalfAngle * 2);
      doorParts.push(
        transformGeo(rcyl(0.045, 0.045, doorH - 0.1, PALETTE.brassWarm, 6), {
          pos: [
            cageCx + Math.cos(a) * cageR - pivotX,
            doorH * 0.5,
            cageCz + Math.sin(a) * cageR - pivotZ,
          ],
        })
      );
    }
    const doorMesh = new THREE.Mesh(mergeParts(doorParts), this.mat);
    doorMesh.castShadow = true;
    doorMesh.geometry.computeBoundingSphere();
    this.cageGateSlideGroup.add(doorMesh);
    this.cageDoorPivot.add(this.cageGateSlideGroup);
    this.root.add(this.cageDoorPivot);

    // Close-Range 2-Peck Brass Hairpin Latch Pin (`latchPos = (-71.88, 35.35, 52.89)`, `radius: 1.55 SU`)
    const latchPos = new THREE.Vector3(northJambX + 0.1, cageTrayTopY + 1.35, northJambZ);
    this.cageLatchPivot.position.copy(latchPos);
    const latchPinMesh = new THREE.Mesh(
      mergeParts([
        transformGeo(rcyl(0.042, 0.042, 0.92, PALETTE.goldGlow, 10), {
          rot: [Math.PI * 0.5, 0, 0],
          pos: [0, 0, 0.2],
        }),
        tube(
          [
            [0, 0, 0.64],
            [0.13, 0.16, 0.79],
            [0, 0.3, 0.65],
            [-0.1, 0.14, 0.58],
          ],
          0.048,
          PALETTE.goldGlow,
          12,
          6,
          true
        ),
      ]),
      this.glowGoldMat
    );
    latchPinMesh.geometry.computeBoundingSphere();
    this.cageLatchPivot.add(latchPinMesh);
    this.root.add(this.cageLatchPivot);

    const cageLatchHaloGeo = new THREE.TorusGeometry(0.24, 0.018, 8, 24);
    cageLatchHaloGeo.deleteAttribute('uv');
    cageLatchHaloGeo.computeBoundingSphere();
    this.cageLatchHalo = new THREE.Mesh(
      cageLatchHaloGeo,
      createUnlitPastelFXMaterial(PALETTE.brassWarm, 0.46, true)
    );
    this.cageLatchHalo.rotation.y = Math.PI * 0.5;
    this.cageLatchHalo.position.copy(latchPos);
    this.cageLatchHalo.visible = false;
    this.root.add(this.cageLatchHalo);

    this.physics.registerPeckSwitch({
      id: 'indoor_cage_latch',
      position: latchPos.clone(),
      radius: 1.55,
      cooldown: 0,
      onPeck: () => this.triggerCageUnlatch(latchPos),
    });

    // Toasted Breadcrumbs inside the cozy Brass Birdcage (`y = 34.15`) & across the oak desk
    this.propFactory.spawnSeed(new THREE.Vector3(cageCx + 0.85, cageTrayTopY + 0.28, cageCz - 0.95));
    this.propFactory.spawnSeed(new THREE.Vector3(cageCx + 0.72, cageTrayTopY + 0.15, cageCz - 0.12));
    this.propFactory.spawnSeed(new THREE.Vector3(cageCx + 1.18, cageTrayTopY + 0.15, cageCz + 0.48));
    this.propFactory.spawnSeed(new THREE.Vector3(cageCx + 0.18, cageTrayTopY + 0.15, cageCz + 0.92));
    this.propFactory.spawnSeed(new THREE.Vector3(cageCx + 1.48, cageTrayTopY + 0.15, cageCz - 0.22));
    this.propFactory.spawnSeed(new THREE.Vector3(-69.2, 33.56, 52.3));
    this.propFactory.spawnSeed(new THREE.Vector3(-67.5, 33.56, 51.6));

    const spawnPos = new THREE.Vector3(cageCx - 0.5, cageTrayTopY + 1.25 + 0.384, cageCz);

    // --- E. Physics Overhead Brass Pulleys + Pull-Cord + Pivoting Lift-Bar + Hinged Casement Windows + Stepped Balcony ---
    // Interior/threshold stone sill (`top y = 31.125`, `x: -40.2..-37.8`) + stepped-down cantilevered Parisian balcony (`deck top y = 29.52`)
    // whose wrought-iron handrail (`top y = 30.98`) sits cleanly below the outward-swinging casement sashes (`bottom y = 31.12`)!
    nwOutdoorParts.push(
      transformGeo(rbox(2.5, 0.65, 18.8, 0.12, PALETTE.wallCreamTrim, 1), {
        pos: [-39.0, 30.8, 52.0],
      }),
      transformGeo(rbox(3.6, 0.64, 19.8, 0.14, PALETTE.wallCreamTrim, 1), {
        pos: [-36.3, 29.2, 52.0],
      }),
      // Top & bottom wrought-iron balcony rails (front + North/South side returns)
      transformGeo(rcyl(0.08, 0.08, 19.0, PALETTE.ironworkPlum, 8), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-34.72, 30.9, 52.0],
      }),
      transformGeo(rcyl(0.065, 0.065, 19.0, PALETTE.ironworkPlum, 8), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-34.72, 29.66, 52.0],
      }),
      transformGeo(rcyl(0.08, 0.08, 3.3, PALETTE.ironworkPlum, 8), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-36.35, 30.9, 42.55],
      }),
      transformGeo(rcyl(0.08, 0.08, 3.3, PALETTE.ironworkPlum, 8), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-36.35, 30.9, 61.45],
      })
    );
    for (const corbZ of [43.4, 49.1, 54.9, 60.6]) {
      nwOutdoorParts.push(
        transformGeo(rbox(2.8, 1.35, 0.68, 0.14, PALETTE.wallCreamTrim, 1), {
          pos: [-36.8, 28.22, corbZ],
        })
      );
    }
    for (let bal = 0; bal <= 14; bal++) {
      const bz = 42.6 + (bal / 14) * 18.8;
      nwOutdoorParts.push(
        transformGeo(rcyl(0.05, 0.05, 1.32, PALETTE.ironworkPlum, 6), {
          pos: [-34.72, 30.26, bz],
        })
      );
    }
    for (const sideZ of [42.55, 61.45]) {
      for (const bx of [-37.3, -36.2, -35.2]) {
        nwOutdoorParts.push(
          transformGeo(rcyl(0.05, 0.05, 1.32, PALETTE.ironworkPlum, 6), {
            pos: [bx, 30.26, sideZ],
          })
        );
      }
    }

    atelierInteriorParts.push(
      // Pier-cantilevered oak pull-cord perch (`(-40.48, 37.35, 55.2..60.6)`) bolted cleanly above the lift-bar into the East-North stone pier
      transformGeo(rcyl(0.11, 0.11, 5.5, PALETTE.woodOak, 10), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-40.48, 37.35, 57.85],
      }),
      transformGeo(rbox(1.25, 0.24, 0.34, 0.05, PALETTE.ironworkPlum, 1), {
        pos: [-39.96, 37.35, 60.58],
      }),
      transformGeo(rbox(0.18, 1.45, 0.48, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [-39.48, 36.9, 60.65],
      }),
      tube(
        [
          [-39.5, 36.3, 60.62],
          [-40.22, 36.8, 60.25],
          [-40.48, 37.27, 59.65],
        ],
        0.055,
        PALETTE.brassWarm,
        8,
        6
      ),
      // Sill-supported turned-brass gallery rail (`(-40.2, 34.8, 50.0..54.0)`) standing vertically on the solid interior stone sill (`y = 31.12`)
      transformGeo(rcyl(0.09, 0.09, 4.3, PALETTE.brassWarm, 10), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-40.2, 34.8, 52.0],
      }),
      transformGeo(rcyl(0.075, 0.095, 3.68, PALETTE.brassWarm, 10), {
        pos: [-40.2, 32.96, 50.05],
      }),
      transformGeo(rcyl(0.075, 0.095, 3.68, PALETTE.brassWarm, 10), {
        pos: [-40.2, 32.96, 53.95],
      }),
      transformGeo(rcyl(0.22, 0.26, 0.14, PALETTE.brassWarm, 12), {
        pos: [-40.2, 31.18, 50.05],
      }),
      transformGeo(rcyl(0.22, 0.26, 0.14, PALETTE.brassWarm, 12), {
        pos: [-40.2, 31.18, 53.95],
      }),
      // Lintel-bolted wrought-iron clevis hangers (`y = 46.85 .. 47.95`) supporting both overhead brass pulleys
      transformGeo(rbox(0.55, 0.22, 0.55, 0.05, PALETTE.ironworkPlum, 1), {
        pos: [-40.25, 47.82, 56.4],
      }),
      transformGeo(rbox(0.38, 1.08, 0.22, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [-40.25, 47.34, 56.4],
      }),
      transformGeo(rbox(1.15, 0.2, 0.24, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [-39.75, 47.72, 56.4],
      }),
      transformGeo(rbox(0.55, 0.22, 0.55, 0.05, PALETTE.ironworkPlum, 1), {
        pos: [-39.08, 47.82, 52.8],
      }),
      transformGeo(rbox(0.36, 1.08, 0.22, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [-39.08, 47.34, 52.8],
      }),
      // Pier-bolted South hinge bracket (`z = 43.35`) & North U-cradle rest keeper (`z = 60.58`) for the oak lift-bar
      transformGeo(rbox(0.75, 0.68, 0.46, 0.06, PALETTE.ironworkPlum, 1), {
        pos: [-39.18, 36.2, 43.36],
      }),
      transformGeo(rbox(0.78, 0.42, 0.52, 0.06, PALETTE.brassWarm, 1), {
        pos: [-39.12, 35.82, 60.58],
      }),
      transformGeo(rbox(0.22, 0.72, 0.48, 0.05, PALETTE.brassWarm, 1), {
        pos: [-39.44, 36.08, 60.58],
      }),
      // Continuous taut golden rope spanning tangent-to-tangent across the top grooves of both pulleys (`y = 47.41`)
      tube(
        [
          [-40.25, 47.41, 56.4],
          [-39.08, 47.41, 52.8],
        ],
        0.052,
        PALETTE.awningGold,
        8,
        6
      )
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-39.0, 30.8, 52.0),
      new THREE.Vector3(1.25, 0.33, 9.4)
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-36.3, 29.2, 52.0),
      new THREE.Vector3(1.8, 0.32, 9.9)
    );
    this.propFactory
      .spawnBreakableTerracottaPot(new THREE.Vector3(-35.6, 30.02, 43.4), PALETTE.tulipCoral)
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(-40.05, 31.63, 59.5),
        PALETTE.awningCobalt,
        PALETTE.tulipYellow
      )
      .body.sleep();

    this.perches.addStaticSegment(
      'atelier_pull_cord_perch',
      new THREE.Vector3(-40.48, 37.46, 55.2),
      new THREE.Vector3(-40.48, 37.46, 59.8),
      0.1,
      'wood'
    );
    this.perches.addStaticSegment(
      'atelier_inner_window_rail',
      new THREE.Vector3(-40.2, 34.89, 50.1),
      new THREE.Vector3(-40.2, 34.89, 53.9),
      0.09,
      'metal'
    );
    this.perches.addStaticSegment(
      'atelier_inner_sill',
      new THREE.Vector3(-40.05, 31.125, 44.3),
      new THREE.Vector3(-40.05, 31.125, 58.3),
      0.03,
      'stone'
    );
    this.perches.addStaticSegment(
      'attic_open_windowsill',
      new THREE.Vector3(-38.0, 31.125, 45.2),
      new THREE.Vector3(-38.0, 31.125, 58.8),
      0.03,
      'stone'
    );
    this.perches.addStaticSegment(
      'attic_outer_iron_rail',
      new THREE.Vector3(-34.72, 30.98, 43.0),
      new THREE.Vector3(-34.72, 30.98, 61.0),
      0.09,
      'metal'
    );

    // Overhead Spoked Brass Pull-Cord Pulley (`(-40.25, 46.85, 56.4)`) + Matching Hoist Guide Pulley (`(-39.08, 46.85, 52.8)`)
    const buildPulleyWheelGeo = (rWheel: number): THREE.BufferGeometry => {
      const parts: THREE.BufferGeometry[] = [
        transformGeo(rcyl(rWheel, rWheel, 0.2, PALETTE.brassWarm, 20), {
          rot: [0, 0, Math.PI * 0.5],
        }),
        transformGeo(rcyl(0.18, 0.18, 0.34, PALETTE.ironworkPlum, 12), {
          rot: [0, 0, Math.PI * 0.5],
        }),
      ];
      for (let sp = 0; sp < 4; sp++) {
        parts.push(
          transformGeo(rbox(0.22, rWheel * 1.82, 0.09, 0.02, PALETTE.goldGlow, 1), {
            rot: [(sp * Math.PI) / 4, 0, 0],
          })
        );
      }
      const g = mergeParts(parts);
      g.computeBoundingSphere();
      return g;
    };

    this.windowPulleyWheel.position.set(-40.25, 46.85, 56.4);
    this.windowPulleyWheel.add(new THREE.Mesh(buildPulleyWheelGeo(0.58), this.mat));
    this.root.add(this.windowPulleyWheel);

    this.windowHoistPulleyWheel.position.set(-39.08, 46.85, 52.8);
    this.windowHoistPulleyWheel.add(new THREE.Mesh(buildPulleyWheelGeo(0.52), this.mat));
    this.root.add(this.windowHoistPulleyWheel);

    // Dynamic Vertical Pull-Cord & Hoist-Cord Meshes
    const pullCordGeo = rcyl(0.052, 0.052, 1.0, PALETTE.awningGold, 8);
    pullCordGeo.computeBoundingSphere();
    this.windowPullCordMesh = new THREE.Mesh(pullCordGeo, this.mat);
    this.root.add(this.windowPullCordMesh);

    const hoistCordGeo = rcyl(0.05, 0.05, 1.0, PALETTE.awningGold, 8);
    hoistCordGeo.computeBoundingSphere();
    this.windowHoistCordMesh = new THREE.Mesh(hoistCordGeo, this.mat);
    this.root.add(this.windowHoistCordMesh);

    // Dangling Braided Tassel & Brass Pull-Ring (`windowPullRingPos = (-40.25, 37.8, 56.4)`)
    this.windowPullRingGroup.position.copy(this.windowPullRingPos);
    const ringPtsPull: Array<[number, number, number]> = [];
    for (let s = 0; s <= 20; s++) {
      const a = (s / 20) * Math.PI * 2;
      ringPtsPull.push([0, Math.sin(a) * 0.44, Math.cos(a) * 0.44]);
    }
    const pullRingMesh = new THREE.Mesh(
      mergeParts([
        transformGeo(rcyl(0.14, 0.22, 0.34, PALETTE.awningCoral, 12), { pos: [0, 0.58, 0] }),
        tube(ringPtsPull, 0.085, PALETTE.goldGlow, 20, 8, true),
      ]),
      this.glowGoldMat
    );
    pullRingMesh.geometry.computeBoundingSphere();
    this.windowPullRingGroup.add(pullRingMesh);
    this.root.add(this.windowPullRingGroup);

    // Pivoting Heavy Oak & Brass Window Lift-Bar (`hinged at (-39.08, 36.2, 43.4)`, spans `17.2 SU`)
    this.windowLiftBarPivot.position.set(-39.08, 36.2, 43.4);
    const liftBarMesh = new THREE.Mesh(
      mergeParts([
        transformGeo(rcyl(0.28, 0.28, 0.52, PALETTE.brassWarm, 14), {
          rot: [0, 0, Math.PI * 0.5],
          pos: [0, 0, 0],
        }),
        transformGeo(rbox(0.42, 0.58, 17.2, 0.09, PALETTE.woodOak, 1), {
          pos: [0, 0, 8.6],
        }),
        transformGeo(rbox(0.48, 0.64, 0.55, 0.06, PALETTE.brassWarm, 1), {
          pos: [0, 0, 9.4],
        }),
        transformGeo(rcyl(0.18, 0.18, 0.12, PALETTE.goldGlow, 12), {
          rot: [0, 0, Math.PI * 0.5],
          pos: [0, 0.42, 9.4],
        }),
        transformGeo(rbox(0.48, 0.64, 0.65, 0.06, PALETTE.brassWarm, 1), {
          pos: [0, 0, 16.9],
        }),
      ]),
      this.mat
    );
    liftBarMesh.geometry.computeBoundingSphere();
    this.windowLiftBarPivot.add(liftBarMesh);
    this.root.add(this.windowLiftBarPivot);

    const windowGlassMat = createUnlitPastelFXMaterial(PALETTE.windowWarmLit, 0.24, false);
    const sashW = 8.45;
    const sashH = 16.68;
    const buildCasementLeaf = (zDir: 1 | -1): THREE.Group => {
      const leaf = new THREE.Group();
      const zMid = zDir * sashW * 0.5;
      const frameParts: THREE.BufferGeometry[] = [
        transformGeo(rbox(0.42, sashH, 0.55, 0.08, PALETTE.shutterTeal, 1), {
          pos: [0, sashH * 0.5, zDir * 0.28],
        }),
        transformGeo(rbox(0.42, sashH, 0.55, 0.08, PALETTE.shutterTeal, 1), {
          pos: [0, sashH * 0.5, zDir * (sashW - 0.28)],
        }),
        transformGeo(rbox(0.42, 0.62, sashW, 0.08, PALETTE.shutterTeal, 1), {
          pos: [0, 0.31, zMid],
        }),
        transformGeo(rbox(0.42, 0.62, sashW, 0.08, PALETTE.shutterTeal, 1), {
          pos: [0, sashH - 0.31, zMid],
        }),
        transformGeo(rbox(0.32, 0.26, sashW - 0.6, 0.05, PALETTE.wallCreamTrim, 1), {
          pos: [0, sashH * 0.28, zMid],
        }),
        transformGeo(rbox(0.32, 0.26, sashW - 0.6, 0.05, PALETTE.wallCreamTrim, 1), {
          pos: [0, sashH * 0.54, zMid],
        }),
        transformGeo(rbox(0.32, 0.26, sashW - 0.6, 0.05, PALETTE.wallCreamTrim, 1), {
          pos: [0, sashH * 0.8, zMid],
        }),
        transformGeo(rbox(0.32, sashH - 0.8, 0.24, 0.05, PALETTE.wallCreamTrim, 1), {
          pos: [0, sashH * 0.5, zMid],
        }),
        // Three brass casement hinge knuckles along the outer jamb (`z = 0`)
        transformGeo(rcyl(0.11, 0.11, 0.52, PALETTE.brassWarm, 10), { pos: [0.16, 1.8, 0] }),
        transformGeo(rcyl(0.11, 0.11, 0.52, PALETTE.brassWarm, 10), {
          pos: [0.16, sashH * 0.5, 0],
        }),
        transformGeo(rcyl(0.11, 0.11, 0.52, PALETTE.brassWarm, 10), {
          pos: [0.16, sashH - 1.8, 0],
        }),
        // Interior brass L-shaped security-bar catch hook (`y_world = 36.2`) engaged by the oak lift-bar when lowered!
        transformGeo(rbox(0.76, 0.2, 0.34, 0.04, PALETTE.brassWarm, 1), {
          pos: [-0.52, 4.72, zDir * (sashW - 1.35)],
        }),
        transformGeo(rbox(0.18, 0.62, 0.34, 0.04, PALETTE.goldGlow, 1), {
          pos: [-0.88, 4.98, zDir * (sashW - 1.35)],
        }),
      ];
      const fMesh = new THREE.Mesh(mergeParts(frameParts), this.mat);
      fMesh.castShadow = true;
      fMesh.geometry.computeBoundingSphere();
      leaf.add(fMesh);

      const paneGeo = transformGeo(
        rbox(0.12, sashH - 1.0, sashW - 0.9, 0.02, PALETTE.windowWarmLit, 1),
        {
          pos: [0, sashH * 0.5, zMid],
        }
      );
      paneGeo.computeBoundingSphere();
      leaf.add(new THREE.Mesh(paneGeo, windowGlassMat));
      return leaf;
    };

    this.windowLeftPivot.position.set(-38.45, 31.12, 43.55);
    this.windowLeftPivot.add(buildCasementLeaf(1));
    this.root.add(this.windowLeftPivot);

    this.windowRightPivot.position.set(-38.45, 31.12, 60.45);
    const rightLeaf = buildCasementLeaf(-1);
    const astragalGeo = transformGeo(rcyl(0.09, 0.09, sashH - 0.8, PALETTE.brassWarm, 10), {
      pos: [-0.28, sashH * 0.5, -(sashW - 0.32)],
    });
    astragalGeo.computeBoundingSphere();
    rightLeaf.add(new THREE.Mesh(astragalGeo, this.mat));
    this.windowRightPivot.add(rightLeaf);
    this.root.add(this.windowRightPivot);

    const windowLatchPos = new THREE.Vector3(-39.0, 36.2, 52.0);
    const windowLatchHaloGeo = new THREE.TorusGeometry(0.54, 0.022, 8, 28);
    windowLatchHaloGeo.deleteAttribute('uv');
    windowLatchHaloGeo.computeBoundingSphere();
    this.windowLatchHalo = new THREE.Mesh(
      windowLatchHaloGeo,
      createUnlitPastelFXMaterial(PALETTE.brassWarm, 0.46, true)
    );
    this.windowLatchHalo.rotation.y = Math.PI * 0.5;
    this.windowLatchHalo.position.copy(this.windowPullRingPos);
    this.windowLatchHalo.visible = false;
    this.root.add(this.windowLatchHalo);

    this.physics.registerPeckSwitch({
      id: 'attic_window_pull_ring',
      position: this.windowPullRingPos,
      radius: 1.85,
      cooldown: 0,
      onPeck: () => {
        this.tugWindowPullCord(2.9);
      },
    });

    const windowSillPos = new THREE.Vector3(-34.72, 31.02, 52.0);
    const windowExitPos = new THREE.Vector3(-33.5, 35.5, 52.0);

    // --- F. Sidewalk Bistro (`top y = 5.14 SU`), Sleepy Commuter & Espresso Cart (`nwOutdoorParts`) ---
    const bistroTables: Array<[number, number]> = [
      [-26.5, 33.4],
      [-25.5, 48.0],
      [-26.5, 62.5],
      [-25.5, 76.0],
    ];
    bistroTables.forEach(([tx, tz], idx) => {
      nwOutdoorParts.push(
        transformGeo(rcyl(1.25, 1.5, 0.3, PALETTE.ironworkPlum, 16), { pos: [tx, 0.48, tz] }),
        transformGeo(rcyl(0.24, 0.3, 4.5, PALETTE.ironworkPlum, 12), { pos: [tx, 2.75, tz] }),
        transformGeo(rcyl(2.85, 2.75, 0.36, PALETTE.porcelainWhite, 24), { pos: [tx, 4.96, tz] }),
        transformGeo(rcyl(2.92, 2.92, 0.14, PALETTE.brassWarm, 24), { pos: [tx, 4.96, tz] })
      );
      this.physics.addStaticCylinder(new THREE.Vector3(tx, 2.74, tz), 2.85, 1.4, 4.8, 12);

      const chZ = idx === 0 ? tz - 3.1 : tz + 3.0;
      const chRot = idx === 0 ? 0 : Math.PI;
      nwOutdoorParts.push(
        transformGeo(rcyl(1.32, 1.32, 0.24, PALETTE.woodWalnut, 16), { pos: [tx, 3.05, chZ] }),
        transformGeo(rbox(2.2, 3.15, 0.24, 0.08, PALETTE.ironworkPlum, 1), {
          pos: [tx, 4.62, chZ + (chRot === 0 ? -1.2 : 1.2)],
        })
      );
      for (const lx of [-0.92, 0.92]) {
        for (const lz of [-0.92, 0.92]) {
          nwOutdoorParts.push(
            transformGeo(rcyl(0.1, 0.08, 2.75, PALETTE.ironworkPlum, 8), {
              pos: [tx + lx, 1.68, chZ + lz],
            })
          );
        }
      }
      this.physics.addStaticBox(
        new THREE.Vector3(tx, 1.72, chZ),
        new THREE.Vector3(1.28, 1.5, 1.28)
      );

      if (idx % 2 === 1) {
        this.createBouncyUmbrella(
          `bistro_umbrella_${idx}`,
          new THREE.Vector3(tx, 0.35, tz),
          13.4,
          5.8,
          idx === 1 ? PALETTE.awningCoral : PALETTE.awningCobalt,
          17.5
        );
      }
    });

    const sleepyMugPos = new THREE.Vector3(-26.5, 5.77, 33.4);
    const mugMesh = new THREE.Mesh(
      this.propFactory.getCeramicCoffeeMugGeometry(PALETTE.awningCoral),
      this.mat
    );
    mugMesh.position.set(-26.5, 5.15, 33.4);
    mugMesh.castShadow = true;
    mugMesh.receiveShadow = true;
    this.root.add(mugMesh);
    for (let s = 0; s < 8; s++) {
      const a0 = (s / 8) * Math.PI * 2;
      const a1 = ((s + 1) / 8) * Math.PI * 2;
      this.perches.addStaticSegment(
        s === 0 ? 'sleepy_mug_rim' : `sleepy_mug_rim_${s}`,
        new THREE.Vector3(-26.5 + Math.cos(a0) * 0.64, 5.77, 33.4 + Math.sin(a0) * 0.64),
        new THREE.Vector3(-26.5 + Math.cos(a1) * 0.64, 5.77, 33.4 + Math.sin(a1) * 0.64),
        0.035,
        'stone'
      );
    }

    const newspaperGeo = rbox(1.85, 0.14, 1.4, 0.04, PALETTE.porcelainWhite, 1);
    newspaperGeo.computeBoundingSphere();
    this.newspaperMesh = new THREE.Mesh(newspaperGeo, this.mat);
    this.newspaperMesh.position.set(-25.0, 5.23, 32.7);
    this.newspaperMesh.rotation.y = 0.35;
    this.newspaperMesh.castShadow = true;
    this.newspaperMesh.receiveShadow = true;
    this.root.add(this.newspaperMesh);

    this.propFactory.spawnSugarCube(new THREE.Vector3(-28.35, 5.36, 34.45));
    this.propFactory.spawnSugarCube(new THREE.Vector3(-25.2, 5.36, 47.4));
    this.propFactory.spawnSugarCube(new THREE.Vector3(-25.8, 5.36, 48.3));

    const cupColors = [
      PALETTE.awningMint,
      PALETTE.awningCoral,
      PALETTE.awningGold,
      PALETTE.awningCobalt,
    ];
    const cupPositions = [
      new THREE.Vector3(-24.2, 5.97, 48.2),
      new THREE.Vector3(-25.2, 5.97, 62.8),
      new THREE.Vector3(-27.4, 5.97, 61.9),
      new THREE.Vector3(-24.3, 5.97, 75.8),
    ];
    cupPositions.forEach((cp, ci) => {
      const cup = this.propFactory.spawnCoffeeCup(cp, cupColors[ci], () => {
        this.audio.playLanding(11.0, 'stone');
        this.npcs.notifyAcousticShock(cp, 'topple');
        this.handles?.onCoffeeCupToppled?.();
      });
      cup.body.sleep();
    });

    // Shatterable Ceramic Mugs, Teacups, Plates, Carafes & Vases across all 4 Bistro Tables (`top y = 5.14`)
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-27.6, 5.45, 32.5),
        PALETTE.porcelainWhite,
        PALETTE.goldGlow,
        () => this.handles?.onCoffeeCupToppled?.()
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(-25.4, 5.24, 34.4),
        PALETTE.porcelainWhite,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(-27.1, 5.58, 47.8),
        PALETTE.porcelainWhite,
        PALETTE.coffeeDark,
        PALETTE.awningCoral,
        () => this.handles?.onCoffeeCupToppled?.()
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(-25.8, 5.69, 49.3),
        PALETTE.windowGlass,
        PALETTE.awningMint
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(-24.6, 5.24, 46.8),
        PALETTE.porcelainWhite,
        PALETTE.awningGold
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-26.2, 5.45, 63.6),
        PALETTE.porcelainWhite,
        PALETTE.goldGlow,
        () => this.handles?.onCoffeeCupToppled?.()
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(-27.6, 5.64, 63.2),
        PALETTE.awningCoral,
        PALETTE.tulipYellow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(-26.4, 5.24, 75.2),
        PALETTE.porcelainWhite,
        PALETTE.awningCobalt
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(-25.9, 5.69, 77.1),
        PALETTE.windowGlass,
        PALETTE.awningCobalt
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(-27.0, 5.58, 76.3),
        PALETTE.awningMint,
        PALETTE.coffeeDark
      )
      .body.sleep();

    // Steaming Copper Espresso Cart (`(-25.8, 0.35, 86.5)`)
    const cartX = -25.8;
    const cartZ = 86.5;
    nwOutdoorParts.push(
      transformGeo(rbox(3.8, 4.4, 6.0, 0.2, PALETTE.woodWalnut, 1), { pos: [cartX, 2.75, cartZ] }),
      transformGeo(rcyl(1.25, 1.25, 3.1, PALETTE.brassWarm, 18), { pos: [cartX, 6.35, cartZ] }),
      transformGeo(rcyl(0.25, 1.25, 0.85, PALETTE.brassWarm, 16), { pos: [cartX, 8.32, cartZ] }),
      transformGeo(rcyl(1.1, 1.1, 0.32, PALETTE.ironworkPlum, 16), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [cartX - 1.95, 1.4, cartZ - 1.7],
      }),
      transformGeo(rcyl(1.1, 1.1, 0.32, PALETTE.ironworkPlum, 16), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [cartX + 1.95, 1.4, cartZ - 1.7],
      })
    );
    this.physics.addStaticBox(
      new THREE.Vector3(cartX, 2.65, cartZ),
      new THREE.Vector3(1.9, 2.3, 3.0)
    );
    this.physics.addStaticCylinder(new THREE.Vector3(cartX, 6.85, cartZ), 1.25, 1.25, 3.8, 12);
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(cartX - 0.6, 5.38, cartZ - 2.15),
        PALETTE.porcelainWhite,
        PALETTE.coffeeDark,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(cartX + 0.6, 5.25, cartZ + 2.15),
        PALETTE.porcelainWhite,
        PALETTE.goldGlow
      )
      .body.sleep();

    const leverPos = new THREE.Vector3(cartX + 1.35, 7.1, cartZ + 0.7);
    this.espressoLeverPivot.position.copy(leverPos);
    const leverMesh = new THREE.Mesh(
      mergeParts([
        transformGeo(rcyl(0.09, 0.09, 1.6, PALETTE.brassWarm, 8), { pos: [0, 0.8, 0] }),
        transformGeo(rcyl(0.22, 0.18, 0.36, PALETTE.awningCoral, 12), { pos: [0, 1.65, 0] }),
      ]),
      this.mat
    );
    leverMesh.geometry.computeBoundingSphere();
    this.espressoLeverPivot.add(leverMesh);
    this.root.add(this.espressoLeverPivot);

    const espressoUpdraft = this.physics.registerUpdraft({
      id: 'espresso_cart_steam',
      x: cartX,
      z: cartZ,
      yMin: 7.5,
      yMax: 84.0,
      radius: 5.8,
      liftAccel: 27.0,
      active: false,
    });

    this.physics.registerPeckSwitch({
      id: 'espresso_steam_lever',
      position: leverPos,
      radius: 1.85,
      cooldown: 0,
      onPeck: () => {
        this.espressoLeverPulled = !this.espressoLeverPulled;
        this.espressoLeverSettled = false;
        espressoUpdraft.active = this.espressoLeverPulled;
        this.audio.playCageUnlatch();
        this.fx.spawnChirpRing(leverPos, PALETTE.porcelainWhite, 6.5);
      },
    });

    const lantern0 = this.createDistrictLantern(new THREE.Vector3(-20.0, 0.28, 22.0));
    this.districtLanternMeshes[0] = lantern0;

    // 4–5 Story Haussmannian Townhouses framing the NW Café Plaza
    buildDetailedTownhouse(
      {
        id: 'nw_corner_haussmann',
        center: [-116, 54],
        widthX: 32,
        depthZ: 50,
        floors: 5,
        wallHex: PALETTE.wallLimestone,
        shutterHex: PALETTE.shutterCobalt,
        roofStyle: 'mansard',
        frontFace: 'east',
        awningHex: PALETTE.awningCobalt,
        addPerches: true,
      },
      this.townhouseCtx,
      nwOutdoorParts
    );
    buildDetailedTownhouse(
      {
        id: 'nw_north_townhouse',
        center: [-64, 116],
        widthX: 52,
        depthZ: 32,
        floors: 4,
        wallHex: PALETTE.wallButtercup,
        shutterHex: PALETTE.shutterOlive,
        roofStyle: 'mansard',
        frontFace: 'south',
        awningHex: PALETTE.awningMint,
        addPerches: true,
      },
      this.townhouseCtx,
      nwOutdoorParts
    );

    const atelierInteriorMesh = new THREE.Mesh(mergeParts(atelierInteriorParts), this.mat);
    atelierInteriorMesh.castShadow = true;
    atelierInteriorMesh.receiveShadow = true;
    atelierInteriorMesh.geometry.computeBoundingSphere();
    this.root.add(atelierInteriorMesh);

    const nwStaticMesh = new THREE.Mesh(mergeParts(nwOutdoorParts), this.mat);
    nwStaticMesh.castShadow = true;
    nwStaticMesh.receiveShadow = true;
    nwStaticMesh.geometry.computeBoundingSphere();
    this.root.add(nwStaticMesh);

    if (foliageParts.length > 0) {
      const nwFoliageMesh = new THREE.Mesh(mergeParts(foliageParts), this.foliageMat);
      nwFoliageMesh.castShadow = true;
      nwFoliageMesh.receiveShadow = true;
      nwFoliageMesh.geometry.computeBoundingSphere();
      this.root.add(nwFoliageMesh);
    }

    return {
      spawnPos,
      latchPos,
      chandelierPerchPos,
      windowLatchPos,
      windowSillPos,
      windowExitPos,
      sleepyMugPos,
    };
  }

  // ==========================================================================
  // 4. NE Block: Wrought-Iron Botanical Park, Fountain, Pigeon Flock & Gazebo
  // ==========================================================================

  private buildNEBotanicalParkAndFountain(): {
    fountainUpdraft: UpdraftZone;
    guitarCasePos: THREE.Vector3;
    buskerPos: THREE.Vector3;
  } {
    const parts: THREE.BufferGeometry[] = [];

    // 1. Ornamental Wrought-Iron Park Fence & Limestone Piers along `x = 18.5` & `z = 18.5`
    const fenceSegments: Array<[number, number, number, number]> = [
      [18.5, 36.0, 18.5, 68.0],
      [18.5, 82.0, 18.5, 132.0],
      [36.0, 18.5, 68.0, 18.5],
      [82.0, 18.5, 132.0, 18.5],
    ];
    fenceSegments.forEach(([x1, z1, x2, z2], idx) => {
      const isX = Math.abs(x1 - x2) < 0.1;
      const len = Math.hypot(x2 - x1, z2 - z1);
      const mx = (x1 + x2) * 0.5;
      const mz = (z1 + z2) * 0.5;

      parts.push(
        transformGeo(
          rbox(isX ? 1.1 : len, 1.4, isX ? len : 1.1, 0.12, PALETTE.wallLimestone, 1),
          { pos: [mx, 0.98, mz] }
        ),
        transformGeo(
          rbox(isX ? 0.35 : len, 0.28, isX ? len : 0.35, 0.06, PALETTE.ironworkPlum, 1),
          { pos: [mx, 6.4, mz] }
        ),
        transformGeo(rbox(2.4, 8.2, 2.4, 0.18, PALETTE.wallLimestone, 1), { pos: [x1, 4.38, z1] }),
        transformGeo(rbox(2.4, 8.2, 2.4, 0.18, PALETTE.wallLimestone, 1), { pos: [x2, 4.38, z2] }),
        transformGeo(smoothSphere(0.75, PALETTE.wallCreamTrim, 12, 10), { pos: [x1, 8.85, z1] }),
        transformGeo(smoothSphere(0.75, PALETTE.wallCreamTrim, 12, 10), { pos: [x2, 8.85, z2] })
      );
      const pickets = Math.floor(len / 1.45);
      for (let p = 1; p < pickets; p++) {
        const u = p / pickets;
        const px = x1 + (x2 - x1) * u;
        const pz = z1 + (z2 - z1) * u;
        parts.push(
          transformGeo(rcyl(0.08, 0.08, 4.8, PALETTE.ironworkPlum, 6), {
            pos: [px, 4.0, pz],
          })
        );
      }

      const fBody = this.physics.addStaticBox(
        new THREE.Vector3(mx, 3.4, mz),
        new THREE.Vector3(isX ? 0.6 : len * 0.5, 3.1, isX ? len * 0.5 : 0.6)
      );
      this.physics.setBumpMetadata(fBody, { surface: 'metal', causesDizzy: true });

      const ux = (x2 - x1) / len;
      const uz = (z2 - z1) / len;
      this.perches.addStaticSegment(
        `park_fence_rail_${idx}`,
        new THREE.Vector3(x1 + ux * 1.45, 6.54, z1 + uz * 1.45),
        new THREE.Vector3(x2 - ux * 1.45, 6.54, z2 - uz * 1.45),
        0.08,
        'metal'
      );
      this.perches.addStaticSegment(
        `park_fence_pier_a_${idx}`,
        new THREE.Vector3(x1 - 0.14, 9.6, z1),
        new THREE.Vector3(x1 + 0.14, 9.6, z1),
        0.07,
        'stone'
      );
      this.perches.addStaticSegment(
        `park_fence_pier_b_${idx}`,
        new THREE.Vector3(x2 - 0.14, 9.6, z2),
        new THREE.Vector3(x2 + 0.14, 9.6, z2),
        0.07,
        'stone'
      );
    });

    // 2. Tiered Limestone Fountain at `(48, 0.28, 48)` (`15.3 SU` tall, hollow carved 3-tier stone bowls)
    const fxPos = 48.0;
    const fzPos = 48.0;
    parts.push(
      // Lower carved limestone basin bowl (rim lip r = 11.75..13.38 at yWorld = 2.40, recessed cavity yWorld = 0.82)
      transformGeo(
        lathe(
          [
            [0.001, 0.0],
            [13.82, 0.0],
            [13.52, 0.55],
            [13.38, 2.12],
            [11.75, 2.12],
            [11.55, 0.54],
            [0.001, 0.54],
          ],
          PALETTE.wallLimestone,
          36
        ),
        { pos: [fxPos, 0.28, fzPos] }
      ),
      transformGeo(rcyl(11.58, 11.58, 0.16, PALETTE.waterDeep, 32, { bottomAO: 0 }), {
        pos: [fxPos, 0.92, fzPos],
      }),
      // Lower fluted column pedestal
      transformGeo(rcyl(2.2, 2.85, 5.8, PALETTE.wallCreamTrim, 20), { pos: [fxPos, 3.85, fzPos] }),
      // Middle carved stone bowl (rim lip r = 5.68..6.42 at yWorld = 8.02, recessed cavity yWorld = 7.12)
      transformGeo(
        lathe(
          [
            [0.001, 0.0],
            [2.35, 0.0],
            [5.85, 0.95],
            [6.42, 1.62],
            [5.68, 1.62],
            [5.48, 0.72],
            [0.001, 0.72],
          ],
          PALETTE.wallLimestone,
          28
        ),
        { pos: [fxPos, 6.4, fzPos] }
      ),
      // Upper fluted column pedestal
      transformGeo(rcyl(1.28, 1.72, 4.6, PALETTE.wallCreamTrim, 18), { pos: [fxPos, 9.55, fzPos] }),
      // Upper carved stone bowl (rim lip r = 2.88..3.42 at yWorld = 12.82, recessed cavity yWorld = 12.12)
      transformGeo(
        lathe(
          [
            [0.001, 0.0],
            [1.25, 0.0],
            [3.05, 0.72],
            [3.42, 1.22],
            [2.88, 1.22],
            [2.72, 0.52],
            [0.001, 0.52],
          ],
          PALETTE.wallLimestone,
          24
        ),
        { pos: [fxPos, 11.6, fzPos] }
      ),
      transformGeo(smoothSphere(1.15, PALETTE.roofCopperPatina, 16, 12, [0.9, 1.35, 0.9]), {
        pos: [fxPos, 13.85, fzPos],
      })
    );
    // Hollow 3-tier fountain colliders: outer stone rim rings + recessed bowl floors below water surfaces
    this.physics.addStaticCylinder(new THREE.Vector3(fxPos, 0.78, fzPos), 11.6, 11.8, 1.0, 16);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.physics.addStaticBox(
        new THREE.Vector3(fxPos + Math.sin(a) * 12.56, 1.34, fzPos + Math.cos(a) * 12.56),
        new THREE.Vector3(2.58, 1.06, 0.85),
        new THREE.Euler(0, a, 0)
      );
    }
    this.physics.addStaticCylinder(new THREE.Vector3(fxPos, 3.85, fzPos), 2.2, 2.85, 5.8, 12);
    this.physics.addStaticCylinder(new THREE.Vector3(fxPos, 6.82, fzPos), 5.6, 3.2, 0.7, 12);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.physics.addStaticBox(
        new THREE.Vector3(fxPos + Math.sin(a) * 6.05, 7.66, fzPos + Math.cos(a) * 6.05),
        new THREE.Vector3(1.68, 0.36, 0.37),
        new THREE.Euler(0, a, 0)
      );
    }
    this.physics.addStaticCylinder(new THREE.Vector3(fxPos, 9.55, fzPos), 1.28, 1.72, 4.6, 10);
    this.physics.addStaticCylinder(new THREE.Vector3(fxPos, 11.88, fzPos), 2.82, 1.8, 0.5, 10);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.physics.addStaticBox(
        new THREE.Vector3(fxPos + Math.sin(a) * 3.15, 12.52, fzPos + Math.cos(a) * 3.15),
        new THREE.Vector3(1.05, 0.30, 0.27),
        new THREE.Euler(0, a, 0)
      );
    }
    this.physics.addStaticCylinder(new THREE.Vector3(fxPos, 13.85, fzPos), 0.85, 1.0, 2.7, 10);

    // 3-tier shimmering water pools openly visible inside all 3 carved stone bowls (radially subdivided for smooth waves)
    const buildFountainDisk = (rOuter: number, yLevel: number, thetaSegs: number, phiSegs: number) => {
      const g = new THREE.RingGeometry(0.02, rOuter, thetaSegs, phiSegs);
      g.deleteAttribute('uv');
      g.rotateX(-Math.PI * 0.5);
      g.translate(fxPos, yLevel, fzPos);
      return g;
    };
    const fWaterGeo = mergeParts([
      buildFountainDisk(11.72, 2.04, 44, 10),
      buildFountainDisk(5.72, 7.82, 32, 7),
      buildFountainDisk(2.94, 12.66, 24, 5),
    ]);
    fWaterGeo.computeBoundingSphere();
    const fWater = new THREE.Mesh(fWaterGeo, this.waterMat);
    fWater.receiveShadow = true;
    this.root.add(fWater);

    // Animated cascading waterfall curtains + parabolic water spouts + top gushing plume
    const fountainFlowRoot = new THREE.Group();
    fountainFlowRoot.position.set(fxPos, 0, fzPos);

    const upperCurtainGeo = new THREE.CylinderGeometry(3.26, 4.02, 4.92, 36, 8, true);
    upperCurtainGeo.deleteAttribute('uv');
    const upperCurtain = new THREE.Mesh(
      upperCurtainGeo,
      createFountainFlowMaterial({ height: 4.92, opacity: 0.72 })
    );
    upperCurtain.position.set(0, 10.28, 0);
    fountainFlowRoot.add(upperCurtain);

    const midCurtainGeo = new THREE.CylinderGeometry(6.24, 7.36, 5.96, 44, 10, true);
    midCurtainGeo.deleteAttribute('uv');
    const midCurtain = new THREE.Mesh(
      midCurtainGeo,
      createFountainFlowMaterial({ height: 5.96, opacity: 0.68 })
    );
    midCurtain.position.set(0, 5.02, 0);
    fountainFlowRoot.add(midCurtain);

    // 8 upper finial parabolic water arcs + 8 lower pedestal parabolic water arcs
    const spoutParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      spoutParts.push(
        taperedTube(
          [
            [ca * 0.82, 4.2, sa * 0.82],
            [ca * 1.48, 5.05, sa * 1.48],
            [ca * 1.92, 3.95, sa * 1.92],
            [ca * 2.12, 2.65, sa * 2.12],
          ],
          0.085,
          0.16,
          PALETTE.waterFoam,
          12,
          6
        )
      );
      const a2 = a + Math.PI / 8;
      const ca2 = Math.cos(a2);
      const sa2 = Math.sin(a2);
      spoutParts.push(
        taperedTube(
          [
            [ca2 * 1.62, -0.65, sa2 * 1.62],
            [ca2 * 3.15, 0.05, sa2 * 3.15],
            [ca2 * 4.35, -0.95, sa2 * 4.35],
            [ca2 * 4.95, -2.18, sa2 * 4.95],
          ],
          0.095,
          0.18,
          PALETTE.waterFoam,
          12,
          6
        )
      );
    }
    const spoutsGeo = mergeParts(spoutParts);
    spoutsGeo.deleteAttribute('color');
    spoutsGeo.computeBoundingSphere();
    const spoutsMesh = new THREE.Mesh(
      spoutsGeo,
      createFountainFlowMaterial({ height: 7.4, opacity: 0.85 })
    );
    this.fountainSpoutsGroup.position.set(0, 10.0, 0);
    this.fountainSpoutsGroup.add(spoutsMesh);
    fountainFlowRoot.add(this.fountainSpoutsGroup);

    // Central bubbling top geyser plume above copper finial
    const plumeColGeo = new THREE.CylinderGeometry(0.68, 0.22, 2.35, 20, 6, true);
    plumeColGeo.deleteAttribute('uv');
    const plumeMat = createFountainFlowMaterial({ height: 2.35, upward: true, opacity: 0.86 });
    const plumeCol = new THREE.Mesh(plumeColGeo, plumeMat);
    plumeCol.position.set(0, 1.15, 0);

    const plumeCapGeo = new THREE.SphereGeometry(0.66, 14, 10);
    plumeCapGeo.deleteAttribute('uv');
    plumeCapGeo.scale(1.15, 0.72, 1.15);
    const plumeCap = new THREE.Mesh(plumeCapGeo, plumeMat);
    plumeCap.position.set(0, 2.25, 0);

    this.fountainPlumeGroup.position.set(0, 15.05, 0);
    this.fountainPlumeGroup.add(plumeCol, plumeCap);
    fountainFlowRoot.add(this.fountainPlumeGroup);
    this.root.add(fountainFlowRoot);

    this.physics.registerBasin({
      id: 'park_fountain_basin',
      center: new THREE.Vector3(fxPos, 2.04, fzPos),
      radius: 11.72,
      innerRadius: 2.25,
      surfaceY: 2.04,
      onPropSplash: this.onBasinPropSplash,
    });
    this.physics.registerBasin({
      id: 'park_fountain_mid_basin',
      center: new THREE.Vector3(fxPos, 7.82, fzPos),
      radius: 5.68,
      innerRadius: 1.35,
      surfaceY: 7.82,
      onPropSplash: this.onBasinPropSplash,
    });
    this.physics.registerBasin({
      id: 'park_fountain_upper_basin',
      center: new THREE.Vector3(fxPos, 12.66, fzPos),
      radius: 2.88,
      innerRadius: 0.85,
      surfaceY: 12.66,
      onPropSplash: this.onBasinPropSplash,
    });

    for (let s = 0; s < 24; s++) {
      if (s === 5 || s === 11) continue; // Clear of breakable pot & vase on rim
      const a1 = (s / 24) * Math.PI * 2;
      const a2 = ((s + 1) / 24) * Math.PI * 2;
      this.perches.addStaticSegment(
        `fountain_rim_${s}`,
        new THREE.Vector3(fxPos + Math.cos(a1) * 12.56, 2.4, fzPos + Math.sin(a1) * 12.56),
        new THREE.Vector3(fxPos + Math.cos(a2) * 12.56, 2.4, fzPos + Math.sin(a2) * 12.56),
        0.03,
        'stone'
      );
    }
    for (let s = 0; s < 16; s++) {
      const a1 = (s / 16) * Math.PI * 2;
      const a2 = ((s + 1) / 16) * Math.PI * 2;
      this.perches.addStaticSegment(
        `fountain_mid_rim_${s}`,
        new THREE.Vector3(fxPos + Math.cos(a1) * 6.05, 8.02, fzPos + Math.sin(a1) * 6.05),
        new THREE.Vector3(fxPos + Math.cos(a2) * 6.05, 8.02, fzPos + Math.sin(a2) * 6.05),
        0.03,
        'stone'
      );
    }
    for (let s = 0; s < 12; s++) {
      const a1 = (s / 12) * Math.PI * 2;
      const a2 = ((s + 1) / 12) * Math.PI * 2;
      this.perches.addStaticSegment(
        `fountain_upper_rim_${s}`,
        new THREE.Vector3(fxPos + Math.cos(a1) * 3.15, 12.82, fzPos + Math.sin(a1) * 3.15),
        new THREE.Vector3(fxPos + Math.cos(a2) * 3.15, 12.82, fzPos + Math.sin(a2) * 3.15),
        0.03,
        'stone'
      );
    }
    this.perches.addStaticSegment(
      'fountain_top_finial',
      new THREE.Vector3(fxPos - 0.22, 15.4, fzPos),
      new THREE.Vector3(fxPos + 0.22, 15.4, fzPos),
      0.08,
      'metal'
    );

    const fountainUpdraft = this.physics.registerUpdraft({
      id: 'fountain_geyser',
      x: fxPos,
      z: fzPos,
      yMin: 8.0,
      yMax: 78.0,
      radius: 7.5,
      liftAccel: 28.0,
      active: false,
    });
    this.fountainUpdraftRef = fountainUpdraft;

    this.propFactory.spawnCoin(new THREE.Vector3(fxPos + 12.2, 2.75, fzPos - 2.4));
    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(fxPos - 12.4, 2.85, fzPos + 2.2),
        PALETTE.tulipCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(fxPos + 2.2, 2.88, fzPos + 12.4),
        PALETTE.awningCobalt,
        PALETTE.tulipYellow
      )
      .body.sleep();

    // 3. Busker Wooden Crate Seat (`(33.5, 1.72, 39.5)`) & Open Red-Velvet Guitar Case (`(37.2, 0.55, 36.8)`)
    const buskerPos = new THREE.Vector3(33.5, 0.45, 39.5);
    const buskerCratePos = new THREE.Vector3(33.5, 1.72, 39.5);
    const guitarCasePos = new THREE.Vector3(37.2, 0.55, 36.8);
    parts.push(
      transformGeo(rbox(2.4, 2.55, 2.4, 0.14, PALETTE.woodOak, 1), {
        rot: [0, 0.72, 0],
        pos: [buskerCratePos.x, buskerCratePos.y, buskerCratePos.z],
      }),
      transformGeo(rbox(3.4, 0.45, 5.2, 0.16, PALETTE.ironworkPlum, 1), {
        rot: [0, 0.45, 0],
        pos: [guitarCasePos.x, 0.52, guitarCasePos.z],
      }),
      transformGeo(rbox(2.9, 0.5, 4.7, 0.12, PALETTE.awningCoral, 1), {
        rot: [0, 0.45, 0],
        pos: [guitarCasePos.x, 0.58, guitarCasePos.z],
      })
    );
    this.physics.addStaticBox(
      buskerCratePos,
      new THREE.Vector3(1.2, 1.28, 1.2),
      new THREE.Euler(0, 0.72, 0)
    );
    this.physics.addStaticBox(
      new THREE.Vector3(guitarCasePos.x, 0.64, guitarCasePos.z),
      new THREE.Vector3(1.7, 0.19, 2.6),
      new THREE.Euler(0, 0.45, 0)
    );
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(31.6, 0.88, 41.2),
        PALETTE.awningGold,
        PALETTE.coffeeDark
      )
      .body.sleep();

    // 4. Copper-Domed Gazebo (`(88, 0.28, 86)`, `25.5 SU` tall, `12.5 SU` radius) + Column & Dome Colliders
    const gx = 88.0;
    const gz = 86.0;
    parts.push(
      transformGeo(rcyl(12.8, 13.6, 1.6, PALETTE.wallLimestone, 16), { pos: [gx, 1.08, gz] }),
      transformGeo(rcyl(11.8, 12.2, 0.45, PALETTE.plazaCream, 16), { pos: [gx, 2.0, gz] }),
      transformGeo(rcyl(12.4, 12.8, 0.85, PALETTE.wallCreamTrim, 16), { pos: [gx, 16.2, gz] }),
      transformGeo(
        lathe(
          [
            [12.4, 0],
            [10.8, 2.4],
            [7.5, 4.8],
            [3.2, 6.5],
            [0.01, 7.1],
          ],
          PALETTE.roofCopperPatina,
          24
        ),
        { pos: [gx, 16.6, gz] }
      ),
      transformGeo(rcyl(1.6, 1.8, 2.2, PALETTE.wallCreamTrim, 14), { pos: [gx, 24.2, gz] }),
      transformGeo(smoothSphere(1.75, PALETTE.roofCopperPatina, 16, 12, [1, 0.8, 1]), {
        pos: [gx, 25.6, gz],
      }),
      transformGeo(rbox(8.4, 0.1, 8.4, 0.06, PALETTE.awningCoral, 1), {
        rot: [0, 0.3, 0],
        pos: [gx, 2.28, gz],
      }),
      transformGeo(rbox(6.4, 0.08, 6.4, 0.05, PALETTE.awningCream, 1), {
        rot: [0, 0.3, 0],
        pos: [gx, 2.38, gz],
      })
    );

    // 8 Limestone Gazebo Columns + Physics Colliders
    for (let c = 0; c < 8; c++) {
      const ca = (c / 8) * Math.PI * 2 + 0.2;
      const colX = gx + Math.cos(ca) * 10.6;
      const colZ = gz + Math.sin(ca) * 10.6;
      parts.push(
        transformGeo(rcyl(0.52, 0.62, 14.0, PALETTE.wallCreamTrim, 12), {
          pos: [colX, 9.0, colZ],
        })
      );
      const colBody = this.physics.addStaticCylinder(
        new THREE.Vector3(colX, 9.0, colZ),
        0.56,
        0.64,
        14.0,
        8
      );
      this.physics.setBumpMetadata(colBody, { surface: 'stone', causesDizzy: true });
    }

    // Gazebo Base, Tiered Copper Dome & Cupola Colliders
    this.physics.addStaticCylinder(new THREE.Vector3(gx, 1.14, gz), 12.8, 13.6, 2.18, 12);
    const gazDomeLow = this.physics.addStaticCylinder(
      new THREE.Vector3(gx, 18.1, gz),
      8.8,
      12.6,
      4.6,
      12
    );
    const gazDomeHigh = this.physics.addStaticCylinder(
      new THREE.Vector3(gx, 22.05, gz),
      2.0,
      8.8,
      3.3,
      12
    );
    const gazCupola = this.physics.addStaticCylinder(
      new THREE.Vector3(gx, 25.3, gz),
      1.5,
      1.8,
      3.2,
      10
    );
    this.physics.setBumpMetadata(gazDomeLow, { surface: 'metal', causesDizzy: true });
    this.physics.setBumpMetadata(gazDomeHigh, { surface: 'metal', causesDizzy: true });
    this.physics.setBumpMetadata(gazCupola, { surface: 'metal', causesDizzy: true });

    this.physics.addStaticBox(
      new THREE.Vector3(gx, 2.32, gz),
      new THREE.Vector3(4.2, 0.1, 4.2),
      new THREE.Euler(0, 0.3, 0)
    );
    this.perches.addStaticSegment(
      'gazebo_cupola_top',
      new THREE.Vector3(gx - 0.24, 27.0, gz),
      new THREE.Vector3(gx + 0.24, 27.0, gz),
      0.07,
      'metal'
    );
    for (let s = 0; s < 16; s++) {
      const a1 = (s / 16) * Math.PI * 2;
      const a2 = ((s + 1) / 16) * Math.PI * 2;
      this.perches.addStaticSegment(
        `gazebo_cornice_${s}`,
        new THREE.Vector3(gx + Math.cos(a1) * 12.45, 16.625, gz + Math.sin(a1) * 12.45),
        new THREE.Vector3(gx + Math.cos(a2) * 12.45, 16.625, gz + Math.sin(a2) * 12.45),
        0.03,
        'stone'
      );
    }

    // Gazebo Picnic Tableware & Stone Rim Breakables
    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(gx - 1.8, 2.97, gz + 1.2),
        PALETTE.windowGlass,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(gx - 1.0, 2.51, gz - 1.6),
        PALETTE.porcelainWhite,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(gx + 1.6, 2.72, gz + 1.4),
        PALETTE.porcelainWhite,
        PALETTE.goldGlow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(gx - 2.4, 2.85, gz - 1.0),
        PALETTE.awningMint,
        PALETTE.coffeeDark
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(gx - 9.2, 2.7, gz - 5.2),
        PALETTE.tulipYellow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(gx + 9.2, 2.7, gz - 5.2),
        PALETTE.sakuraPink
      )
      .body.sleep();

    // Wicker Picnic Basket (`(88.8, 3.1, 85.4)`)
    const basketPos = new THREE.Vector3(gx + 0.8, 3.1, gz - 0.6);
    parts.push(
      transformGeo(rbox(3.0, 1.6, 2.2, 0.2, PALETTE.woodBirch, 1), {
        pos: [basketPos.x, 3.15, basketPos.z],
      }),
      tube(
        [
          [basketPos.x - 1.25, 3.85, basketPos.z],
          [basketPos.x, 4.95, basketPos.z],
          [basketPos.x + 1.25, 3.85, basketPos.z],
        ],
        0.11,
        PALETTE.woodOak,
        14,
        6
      )
    );
    this.physics.addStaticBox(basketPos, new THREE.Vector3(1.5, 0.85, 1.15));
    this.perches.addStaticSegment(
      'gazebo_basket_handle',
      new THREE.Vector3(basketPos.x - 0.42, 5.05, basketPos.z),
      new THREE.Vector3(basketPos.x + 0.42, 5.05, basketPos.z),
      0.08,
      'wood'
    );

    this.picnicLidPivot.position.set(basketPos.x, 3.95, basketPos.z - 1.05);
    const picnicLidGeo = transformGeo(rbox(3.15, 0.26, 2.3, 0.1, PALETTE.woodOak, 1), {
      pos: [0, 0, 1.1],
    });
    picnicLidGeo.computeBoundingSphere();
    this.picnicLidPivot.add(new THREE.Mesh(picnicLidGeo, this.mat));
    this.root.add(this.picnicLidPivot);

    this.physics.registerPeckSwitch({
      id: 'gazebo_picnic_basket',
      position: basketPos.clone(),
      radius: 2.45,
      cooldown: 0,
      onPeck: () => {
        if (this.picnicBasketOpened) return;
        this.picnicBasketOpened = true;
        this.picnicLidSettled = false;
        this.audio.playCageUnlatch();
        this.fx.spawnBurst(basketPos, 12, true, 4.2);

        const b1 = this.propFactory.spawnBerry(
          basketPos.clone().add(new THREE.Vector3(-0.6, 1.5, 0.5)),
          PALETTE.berryRuby
        );
        b1.body.velocity.set(-3.2, 5.5, 2.8);
        const b2 = this.propFactory.spawnBerry(
          basketPos.clone().add(new THREE.Vector3(0.6, 1.6, 0.6)),
          PALETTE.berryBlue
        );
        b2.body.velocity.set(3.4, 5.8, 2.4);
        const rib = this.propFactory.spawnNestItem(
          'ribbon',
          basketPos.clone().add(new THREE.Vector3(0, 1.7, -0.4)),
          PALETTE.awningCoral
        );
        rib.body.velocity.set(1.2, 6.2, -2.8);
        const cr = this.propFactory.spawnCroissant(
          basketPos.clone().add(new THREE.Vector3(0.2, 1.8, 0.2))
        );
        cr.body.velocity.set(-1.8, 5.6, 3.2);

        this.handles?.onPicnicBasketRaided?.();
      },
    });

    // 5. 11.4-SU Park Benches around Fountain & Lawn (`seat top y = 2.85`, crest top rail at `localZ = -1.865`)
    const benches: Array<{ pos: [number, number]; yaw: number }> = [
      { pos: [65.0, 36.0], yaw: -Math.PI * 0.75 },
      { pos: [34.0, 64.0], yaw: Math.PI * 0.25 },
      { pos: [70.0, 64.0], yaw: -Math.PI * 0.75 },
      { pos: [104.0, 68.0], yaw: -Math.PI * 0.5 },
    ];
    const sharedBenchGeo = this.propFactory.getParkBenchGeometry(PALETTE.woodOak);
    benches.forEach((b, idx) => {
      parts.push(
        transformGeo(sharedBenchGeo.clone(), {
          rot: [0, b.yaw, 0],
          pos: [b.pos[0], 0.35, b.pos[1]],
        })
      );

      const cosY = Math.cos(b.yaw);
      const sinY = Math.sin(b.yaw);
      this.physics.addStaticBox(
        new THREE.Vector3(b.pos[0], 1.6, b.pos[1]),
        new THREE.Vector3(5.7, 1.25, 1.85),
        new THREE.Euler(0, b.yaw, 0)
      );
      this.physics.addStaticBox(
        new THREE.Vector3(b.pos[0] - 1.55 * sinY, 4.22, b.pos[1] - 1.55 * cosY),
        new THREE.Vector3(5.7, 1.38, 0.38),
        new THREE.Euler(0, b.yaw, 0)
      );

      // Aligned strictly to `buildParkBenchGeometry` crest top rail (`localZ = -1.865, localY = 5.325` -> `worldY = 5.675`)
      this.perches.addStaticSegment(
        `park_bench_crest_${idx}`,
        new THREE.Vector3(
          b.pos[0] - 5.3 * cosY - 1.865 * sinY,
          5.675,
          b.pos[1] + 5.3 * sinY - 1.865 * cosY
        ),
        new THREE.Vector3(
          b.pos[0] + 5.3 * cosY - 1.865 * sinY,
          5.675,
          b.pos[1] - 5.3 * sinY - 1.865 * cosY
        ),
        0.07,
        'wood'
      );

      const endX = b.pos[0] + 3.6 * cosY + 0.25 * sinY;
      const endZ = b.pos[1] - 3.6 * sinY + 0.25 * cosY;
      if (idx === 1) {
        this.propFactory
          .spawnBreakableCeramicMug(
            new THREE.Vector3(endX, 3.28, endZ),
            PALETTE.porcelainWhite,
            PALETTE.coffeeDark,
            PALETTE.awningCobalt
          )
          .body.sleep();
      } else if (idx === 2) {
        this.propFactory
          .spawnBreakableTeacup(
            new THREE.Vector3(endX, 3.15, endZ),
            PALETTE.porcelainWhite,
            PALETTE.awningCoral
          )
          .body.sleep();
      } else if (idx === 3) {
        this.propFactory
          .spawnBreakableCeramicVase(
            new THREE.Vector3(endX, 3.35, endZ),
            PALETTE.awningMint,
            PALETTE.lavenderSprig
          )
          .body.sleep();
      }
    });

    this.propFactory.spawnCoin(new THREE.Vector3(61.8, 0.75, 34.8));

    // 6. 12 Botanical Sculpted Park Trees (`28–38 SU` tall)
    const treePositions: Array<[number, number, number, number]> = [
      [28, 88, 30, PALETTE.leafSage],
      [48, 108, 35, PALETTE.grassSunlit],
      [74, 116, 33, PALETTE.sakuraPink],
      [112, 112, 36, PALETTE.leafSage],
      [118, 84, 31, PALETTE.ginkgoGold],
      [114, 46, 34, PALETTE.leafSage],
      [88, 34, 29, PALETTE.sakuraBlush],
      [62, 88, 28, PALETTE.leafDeep],
      [104, 100, 31, PALETTE.grassSunlit],
      [34, 118, 33, PALETTE.ginkgoGold],
      [126, 64, 35, PALETTE.leafSage],
      [96, 56, 28, PALETTE.sakuraPink],
    ];
    const neFoliageParts: THREE.BufferGeometry[] = [];
    treePositions.forEach(([tx, tz, th, canopyHex], idx) => {
      this.buildInteractiveParkTree(tx, tz, th, canopyHex, idx, parts, neFoliageParts);
    });

    // 4-Story Park Orangerie Townhouse at North-East edge
    buildDetailedTownhouse(
      {
        id: 'ne_park_orangerie',
        center: [88, 136],
        widthX: 48,
        depthZ: 24,
        floors: 4,
        wallHex: PALETTE.wallSage,
        shutterHex: PALETTE.shutterTeal,
        roofStyle: 'mansard',
        frontFace: 'south',
        addPerches: true,
      },
      this.townhouseCtx,
      parts
    );

    const lantern1 = this.createDistrictLantern(new THREE.Vector3(24.0, 0.28, 24.0));
    this.districtLanternMeshes[1] = lantern1;

    const neMesh = new THREE.Mesh(mergeParts(parts), this.mat);
    neMesh.castShadow = true;
    neMesh.receiveShadow = true;
    neMesh.geometry.computeBoundingSphere();
    this.root.add(neMesh);

    if (neFoliageParts.length > 0) {
      const neFoliageMesh = new THREE.Mesh(mergeParts(neFoliageParts), this.foliageMat);
      neFoliageMesh.castShadow = true;
      neFoliageMesh.receiveShadow = true;
      neFoliageMesh.geometry.computeBoundingSphere();
      this.root.add(neFoliageMesh);
    }

    return { fountainUpdraft, guitarCasePos, buskerPos };
  }

  private buildInteractiveParkTree(
    tx: number,
    tz: number,
    height: number,
    canopyHex: number,
    idx: number,
    woodCollector: THREE.BufferGeometry[],
    foliageCollector: THREE.BufferGeometry[]
  ): void {
    const tree = buildOrganicTreeParts(height, canopyHex, idx + 1);
    const trunkH = height * 0.44;

    woodCollector.push(transformGeo(tree.woodGeo, { pos: [tx, 0.3, tz] }));
    foliageCollector.push(transformGeo(tree.foliageGeo, { pos: [tx, 0.3, tz] }));

    const trunkBody = this.physics.addStaticCylinder(
      new THREE.Vector3(tx, trunkH * 0.5 + 0.3, tz),
      height * 0.032,
      height * 0.048,
      trunkH,
      8
    );
    const canopyBody = this.physics.addStaticCylinder(
      new THREE.Vector3(tx, trunkH + height * 0.24, tz),
      height * 0.25,
      height * 0.21,
      height * 0.36,
      10
    );

    let droppedGift = false;
    const onTreeShake = (hitPt: THREE.Vector3) => {
      this.fx.spawnBurst(hitPt, 8, false, 3.2);
      if (!droppedGift) {
        droppedGift = true;
        const dropOrigin = new THREE.Vector3(tx + 1.6, trunkH * 0.95, tz + 1.5);
        if (idx % 3 === 0) {
          this.propFactory.spawnPinecone(dropOrigin);
        } else if (idx % 3 === 1) {
          this.propFactory.spawnNestItem('twig', dropOrigin, PALETTE.woodOak);
        } else {
          this.propFactory.spawnBerry(dropOrigin, PALETTE.berryRuby);
        }
      }
    };
    this.physics.setBumpMetadata(trunkBody, {
      surface: 'wood',
      causesDizzy: false,
      onBump: onTreeShake,
    });
    this.physics.setBumpMetadata(canopyBody, {
      surface: 'foliage',
      causesDizzy: false,
      onBump: onTreeShake,
    });

    this.perches.addStaticSegment(
      `park_tree_bough_${idx}`,
      tree.boughPerchA.clone().add(new THREE.Vector3(tx, 0.3, tz)),
      tree.boughPerchB.clone().add(new THREE.Vector3(tx, 0.3, tz)),
      0.1,
      'wood'
    );
  }

  // ==========================================================================
  // 5. SW Block: Sunken Canal, Seamless Arch Bridges, Boats, Painter & Bicycles
  // ==========================================================================

  private buildSWSunkenCanalAndPainterTerrace(): {
    painterEaselPos: THREE.Vector3;
  } {
    const parts: THREE.BufferGeometry[] = [];

    // 1. Shimmering Turquoise Canal Water (`x: -140..-16, z: -68..-40, surface y = -0.65`)
    parts.push(
      transformGeo(rbox(126, 0.3, 27.6, 0.05, PALETTE.waterDeep, 1), {
        pos: [-78.0, -1.05, -54.0],
      })
    );
    const canalWaterGeo = new THREE.PlaneGeometry(126, 27.6, 84, 20);
    canalWaterGeo.deleteAttribute('uv');
    canalWaterGeo.rotateX(-Math.PI * 0.5);
    canalWaterGeo.translate(-78.0, -0.65, -54.0);
    canalWaterGeo.computeBoundingSphere();
    const canalWater = new THREE.Mesh(canalWaterGeo, this.waterMat);
    canalWater.receiveShadow = true;
    this.root.add(canalWater);

    this.physics.registerBasin({
      id: 'sw_sunken_canal',
      center: new THREE.Vector3(-78.0, -0.65, -54.0),
      radius: 65.0,
      boxHalfX: 62.0,
      boxHalfZ: 13.8,
      surfaceY: -0.65,
      onPropSplash: this.onBasinPropSplash,
    });

    // Quay mooring bollards & iron canal safety posts
    for (let qx = -132; qx <= -22; qx += 14) {
      if (Math.abs(qx + 44) < 7 || Math.abs(qx + 96) < 7) continue;
      for (const qz of [-39.2, -68.8]) {
        parts.push(
          transformGeo(rcyl(0.42, 0.54, 1.7, PALETTE.ironworkPlum, 10), { pos: [qx, 1.05, qz] }),
          transformGeo(rcyl(0.48, 0.42, 0.45, PALETTE.ironworkPlum, 10), { pos: [qx, 2.0, qz] })
        );
      }
    }

    // 2. Two Seamless Curved 11-Segment Stone Arch Footbridges (`x = -44` and `x = -96`, `z: -74..-34`)
    for (const [bIdx, bx] of [
      [0, -44.0],
      [1, -96.0],
    ] as const) {
      const zCenter = -54.0;
      const halfSpan = 20.0;
      const segs = 11;
      const rise = 7.12;

      for (let i = 0; i < segs; i++) {
        const u = (i - (segs - 1) * 0.5) / ((segs - 1) * 0.5);
        const z = zCenter + u * halfSpan;
        const archFactor = (1.0 + Math.cos(u * Math.PI)) * 0.5;
        const yDeck = 0.28 + rise * archFactor;
        const dyDz = -rise * 0.5 * (Math.PI / halfSpan) * Math.sin(u * Math.PI);
        const pitch = -Math.atan(dyDz);
        const segLen = (halfSpan * 2) / (segs - 1) + 1.15;

        parts.push(
          transformGeo(rbox(10.6, 1.35, segLen, 0.16, PALETTE.wallLimestone, 1), {
            rot: [pitch, 0, 0],
            pos: [bx, yDeck - 0.55, z],
          }),
          transformGeo(rbox(9.2, 0.22, segLen, 0.08, PALETTE.plazaRoseStone, 1), {
            rot: [pitch, 0, 0],
            pos: [bx, yDeck + 0.12, z],
          }),
          transformGeo(rbox(0.85, 2.4, segLen, 0.14, PALETTE.wallCreamTrim, 1), {
            rot: [pitch, 0, 0],
            pos: [bx - 4.85, yDeck + 1.15, z],
          }),
          transformGeo(rbox(0.85, 2.4, segLen, 0.14, PALETTE.wallCreamTrim, 1), {
            rot: [pitch, 0, 0],
            pos: [bx + 4.85, yDeck + 1.15, z],
          })
        );

        this.physics.addStaticBox(
          new THREE.Vector3(bx, yDeck - 0.45, z),
          new THREE.Vector3(4.8, 0.68, segLen * 0.5),
          new THREE.Euler(pitch, 0, 0)
        );
        this.physics.addStaticBox(
          new THREE.Vector3(bx - 4.85, yDeck + 1.15, z),
          new THREE.Vector3(0.44, 1.2, segLen * 0.5),
          new THREE.Euler(pitch, 0, 0)
        );
        this.physics.addStaticBox(
          new THREE.Vector3(bx + 4.85, yDeck + 1.15, z),
          new THREE.Vector3(0.44, 1.2, segLen * 0.5),
          new THREE.Euler(pitch, 0, 0)
        );
      }

      this.propFactory
        .spawnBreakableTerracottaPot(
          new THREE.Vector3(bx + 4.85, 10.22, zCenter - 2.6),
          bIdx === 0 ? PALETTE.tulipCoral : PALETTE.tulipYellow
        )
        .body.sleep();
      this.propFactory
        .spawnBreakableCeramicVase(
          new THREE.Vector3(bx + 4.85, 10.25, zCenter + 2.6),
          bIdx === 0 ? PALETTE.awningCobalt : PALETTE.awningMint,
          PALETTE.tulipCoral
        )
        .body.sleep();

      parts.push(
        transformGeo(rcyl(0.2, 0.26, 7.2, PALETTE.ironworkPlum, 10), {
          pos: [bx - 4.85, 11.2, zCenter],
        }),
        transformGeo(smoothSphere(0.72, PALETTE.windowWarmLit, 12, 10), {
          pos: [bx - 4.85, 15.0, zCenter],
        })
      );

      const sampleParapetTop = (px: number, u: number): THREE.Vector3 => {
        const z = zCenter + u * halfSpan;
        const yDeck = 0.28 + rise * (1.0 + Math.cos(u * Math.PI)) * 0.5;
        const dyDz = -rise * 0.5 * (Math.PI / halfSpan) * Math.sin(u * Math.PI);
        const yTop = yDeck + 1.15 + 1.2 * Math.hypot(1, dyDz) + 0.028;
        return new THREE.Vector3(px, yTop, z);
      };

      // West parapet arch chords (split cleanly around central lamp post at u = 0)
      for (const [spanIdx, uMin, uMax, chords] of [
        [0, -0.96, -0.04, 6],
        [1, 0.04, 0.96, 6],
      ] as const) {
        for (let c = 0; c < chords; c++) {
          const u0 = uMin + ((uMax - uMin) * c) / chords;
          const u1 = uMin + ((uMax - uMin) * (c + 1)) / chords;
          const segId =
            spanIdx === 0 && c === chords - 1
              ? `canal_bridge_parapet_w_${bIdx}`
              : `canal_bridge_parapet_w_${bIdx}_${spanIdx}_${c}`;
          this.perches.addStaticSegment(
            segId,
            sampleParapetTop(bx - 4.85, u0),
            sampleParapetTop(bx - 4.85, u1),
            0.03,
            'stone'
          );
        }
      }

      // East parapet arch chords (split cleanly around terracotta pot & vase at u = ±0.13)
      this.perches.addStaticSegment(
        `canal_bridge_parapet_e_${bIdx}`,
        sampleParapetTop(bx + 4.85, -0.085),
        sampleParapetTop(bx + 4.85, 0.085),
        0.03,
        'stone'
      );
      for (const [spanIdx, uMin, uMax, chords] of [
        [0, -0.96, -0.18, 5],
        [1, 0.18, 0.96, 5],
      ] as const) {
        for (let c = 0; c < chords; c++) {
          const u0 = uMin + ((uMax - uMin) * c) / chords;
          const u1 = uMin + ((uMax - uMin) * (c + 1)) / chords;
          this.perches.addStaticSegment(
            `canal_bridge_parapet_e_${bIdx}_${spanIdx}_${c}`,
            sampleParapetTop(bx + 4.85, u0),
            sampleParapetTop(bx + 4.85, u1),
            0.03,
            'stone'
          );
        }
      }
    }

    // 3. Two 22-SU Wooden Canal Launches cruising smoothly along `z = -48.5` & `z = -59.5`
    const boatConfigs = [
      { x: -32.0, z: -48.5, dir: -1, speed: 3.8, hullHex: PALETTE.parisGreen, phase: 0.0 },
      { x: -108.0, z: -59.5, dir: 1, speed: 3.4, hullHex: PALETTE.awningCobalt, phase: 2.1 },
    ];
    boatConfigs.forEach((bc, idx) => {
      const bg = new THREE.Group();
      const bParts: THREE.BufferGeometry[] = [
        transformGeo(rbox(16.0, 2.2, 6.4, 0.35, bc.hullHex, 2), { pos: [0, 1.1, 0] }),
        transformGeo(rcyl(0.4, 3.2, 4.2, bc.hullHex, 14), {
          rot: [0, 0, -Math.PI * 0.5],
          pos: [9.8, 1.2, 0],
        }),
        transformGeo(rcyl(0.5, 3.1, 3.6, bc.hullHex, 14), {
          rot: [0, 0, Math.PI * 0.5],
          pos: [-9.5, 1.2, 0],
        }),
        transformGeo(rbox(15.2, 0.3, 5.6, 0.1, PALETTE.woodOak, 1), { pos: [0, 2.25, 0] }),
        transformGeo(rbox(8.6, 2.1, 4.6, 0.2, PALETTE.woodBirch, 2), { pos: [-1.2, 3.35, 0] }),
        transformGeo(rbox(9.2, 0.32, 5.0, 0.12, PALETTE.porcelainWhite, 1), {
          pos: [-1.2, 4.5, 0],
        }),
        transformGeo(rcyl(0.14, 0.2, 1.5, PALETTE.brassWarm, 10), { pos: [11.2, 2.4, 0] }),
        transformGeo(rbox(1.8, 1.1, 2.2, 0.1, PALETTE.woodOak, 1), { pos: [5.4, 2.85, -1.0] }),
        transformGeo(rcyl(0.32, 0.28, 0.45, PALETTE.tulipCoral, 10), { pos: [5.4, 3.55, -1.0] }),
      ];
      const bMesh = new THREE.Mesh(mergeParts(bParts), this.mat);
      bMesh.castShadow = true;
      bMesh.receiveShadow = true;
      bMesh.geometry.computeBoundingSphere();
      bg.add(bMesh);

      const initialYaw = bc.dir > 0 ? 0 : Math.PI;
      bg.position.set(bc.x, -0.68, bc.z);
      bg.rotation.y = initialYaw;
      this.root.add(bg);

      const bBody = this.physics.addKinematicBox(
        new THREE.Vector3(bc.x, 1.4, bc.z),
        new THREE.Vector3(10.5, 2.2, 3.2)
      );
      _boatQuat.setFromAxisAngle(_upAxis, initialYaw);
      bBody.quaternion.set(_boatQuat.x, _boatQuat.y, _boatQuat.z, _boatQuat.w);
      bBody.interpolatedQuaternion.copy(bBody.quaternion);
      this.physics.setBumpMetadata(bBody, { surface: 'wood', causesDizzy: false });
      this.physics.setBodyAttachTarget(bBody, bg);

      const boatInst: CanalBoatInstance = {
        group: bg,
        body: bBody,
        baseZ: bc.z,
        phaseOffset: bc.phase,
        speed: bc.speed,
        dir: bc.dir,
        xPos: bc.x,
        yaw: initialYaw,
      };
      this.canalBoats.push(boatInst);

      for (const [sideSuffix, localZ] of [
        ['', -2.35],
        ['_s', 2.35],
      ] as const) {
        this.perches.addDynamicSegment({
          id: `canal_boat_cabin_${idx}${sideSuffix}`,
          getApproxCenter: (out) => out.copy(boatInst.group.position),
          approxHalfSpan: 6.5,
          getEndpoints: (outA, outB) => {
            const pos = boatInst.group.position;
            const yaw = boatInst.group.rotation.y;
            const cosY = Math.cos(yaw);
            const sinY = Math.sin(yaw);
            const topY = pos.y + 4.66;
            outA.set(
              pos.x - 5.5 * cosY + localZ * sinY,
              topY,
              pos.z + 5.5 * sinY + localZ * cosY
            );
            outB.set(
              pos.x + 3.1 * cosY + localZ * sinY,
              topY,
              pos.z - 3.1 * sinY + localZ * cosY
            );
          },
          radius: 0.03,
          surface: 'wood',
        });
      }
    });

    // 4. 4-Story Venetian Painter's Townhouse (`(-70, -25.5)`) + 2nd-Story Balcony (`balY = 25.8`)
    buildDetailedTownhouse(
      {
        id: 'sw_painter_townhouse',
        center: [-70, -25.5],
        widthX: 38,
        depthZ: 15,
        floors: 4,
        wallHex: PALETTE.wallOchre,
        shutterHex: PALETTE.shutterTeal,
        roofStyle: 'terracotta',
        frontFace: 'south',
        addPerches: true,
      },
      this.townhouseCtx,
      parts
    );

    const balX = -70.0;
    const balZ = -36.2;
    const balY = 25.8;
    parts.push(
      transformGeo(rbox(18.0, 0.85, 6.8, 0.18, PALETTE.wallCreamTrim, 1), {
        pos: [balX, balY - 0.42, balZ],
      }),
      transformGeo(rbox(1.1, 2.8, 5.2, 0.14, PALETTE.wallLimestone, 1), {
        pos: [balX - 7.2, balY - 1.9, balZ + 0.8],
      }),
      transformGeo(rbox(1.1, 2.8, 5.2, 0.14, PALETTE.wallLimestone, 1), {
        pos: [balX + 7.2, balY - 1.9, balZ + 0.8],
      }),
      transformGeo(rbox(18.0, 0.25, 0.25, 0.05, PALETTE.ironworkPlum, 1), {
        pos: [balX, balY + 2.8, balZ - 3.2],
      }),
      transformGeo(rbox(0.25, 0.25, 6.6, 0.05, PALETTE.ironworkPlum, 1), {
        pos: [balX - 8.8, balY + 2.8, balZ],
      }),
      transformGeo(rbox(0.25, 0.25, 6.6, 0.05, PALETTE.ironworkPlum, 1), {
        pos: [balX + 8.8, balY + 2.8, balZ],
      })
    );
    for (let rx = -8.0; rx <= 8.0; rx += 1.6) {
      parts.push(
        transformGeo(rcyl(0.08, 0.08, 2.8, PALETTE.ironworkPlum, 6), {
          pos: [balX + rx, balY + 1.4, balZ - 3.2],
        })
      );
    }
    this.physics.addStaticBox(
      new THREE.Vector3(balX, balY - 0.42, balZ),
      new THREE.Vector3(9.0, 0.42, 3.4)
    );
    this.perches.addStaticSegment(
      'painter_balcony_rail',
      new THREE.Vector3(balX - 8.6, balY + 2.925, balZ - 3.2),
      new THREE.Vector3(balX + 8.6, balY + 2.925, balZ - 3.2),
      0.08,
      'metal'
    );
    this.perches.addStaticSegment(
      'painter_balcony_rail_w',
      new THREE.Vector3(balX - 8.8, balY + 2.925, balZ - 3.1),
      new THREE.Vector3(balX - 8.8, balY + 2.925, balZ + 3.0),
      0.08,
      'metal'
    );
    this.perches.addStaticSegment(
      'painter_balcony_rail_e',
      new THREE.Vector3(balX + 8.8, balY + 2.925, balZ - 3.1),
      new THREE.Vector3(balX + 8.8, balY + 2.925, balZ + 3.0),
      0.08,
      'metal'
    );
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(-64.0, balY + 0.4, -37.6), PALETTE.tulipCoral)
      .body.sleep();
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(-63.1, balY + 0.4, -37.2), PALETTE.birdBlueTit)
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(-64.8, balY + 0.43, -38.2),
        PALETTE.awningGold,
        PALETTE.birdBlueTit
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(-77.4, balY + 0.47, -38.2),
        PALETTE.tulipCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(-62.2, balY + 0.5, -38.3),
        PALETTE.awningMint,
        PALETTE.tulipYellow
      )
      .body.sleep();

    // Painter's Wooden A-Frame Easel & Canvas (`painterEaselPos = (-66.2, 30.2, -36.8)`)
    const painterEaselPos = new THREE.Vector3(-66.2, 30.2, -36.8);
    const pScale = 0.76;
    const painterEaselGeo = this.buildStudioEaselGeometry(pScale, false);
    parts.push(
      transformGeo(painterEaselGeo, {
        rot: [0, Math.PI, 0],
        pos: [painterEaselPos.x, balY, painterEaselPos.z],
      })
    );
    const painterEaselBody = this.physics.addStaticBox(
      new THREE.Vector3(painterEaselPos.x, balY + 5.05 * pScale, painterEaselPos.z + 0.82 * pScale),
      new THREE.Vector3(1.72 * pScale, 5.05 * pScale, 1.55 * pScale)
    );
    this.physics.setBumpMetadata(painterEaselBody, { surface: 'wood', causesDizzy: false });
    this.perches.addStaticSegment(
      'painter_easel_top',
      new THREE.Vector3(
        painterEaselPos.x - 2.15 * pScale,
        balY + 9.48 * pScale,
        painterEaselPos.z + 0.36 * pScale
      ),
      new THREE.Vector3(
        painterEaselPos.x + 2.15 * pScale,
        balY + 9.48 * pScale,
        painterEaselPos.z + 0.36 * pScale
      ),
      0.06,
      'wood'
    );

    const strokeColors = [
      PALETTE.skyMidDawn,
      PALETTE.tulipCoral,
      PALETTE.tulipYellow,
      PALETTE.sparrowChestnut,
      PALETTE.leafSage,
      PALETTE.goldGlow,
    ];
    strokeColors.forEach((sc, si) => {
      const sGeo = rbox(1.02, 0.72, 0.1, 0.04, sc, 1);
      sGeo.computeBoundingSphere();
      const sm = new THREE.Mesh(sGeo, this.mat);
      const row = Math.floor(si / 3);
      const localOffY = (row - 0.5) * 1.25;
      sm.rotation.set(0.145, 0, 0);
      sm.position.set(
        painterEaselPos.x - 0.9 + (si % 3) * 0.9,
        balY + 6.55 * pScale + localOffY,
        painterEaselPos.z - (0.04 * pScale + 0.16) + localOffY * Math.sin(0.145)
      );
      sm.visible = false;
      this.portraitStrokes.push(sm);
      this.root.add(sm);
    });

    // Lost Eyeglasses + Breakable Glass Carafe & Teacup on North Quay café table (`(-49.0, 5.14, -28.0)`)
    parts.push(
      transformGeo(rcyl(0.24, 0.32, 4.6, PALETTE.ironworkPlum, 12), { pos: [-49.0, 2.75, -28.0] }),
      transformGeo(rcyl(2.75, 2.65, 0.34, PALETTE.porcelainWhite, 22), {
        pos: [-49.0, 4.97, -28.0],
      })
    );
    this.physics.addStaticCylinder(new THREE.Vector3(-49.0, 2.74, -28.0), 2.75, 1.3, 4.8, 12);
    this.propFactory.spawnEyeglasses(new THREE.Vector3(-49.0, 5.55, -28.0));
    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(-50.6, 5.69, -27.5),
        PALETTE.windowGlass,
        PALETTE.awningCobalt
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-47.5, 5.44, -28.6),
        PALETTE.porcelainWhite,
        PALETTE.awningCobalt
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(-48.4, 5.23, -26.5),
        PALETTE.porcelainWhite,
        PALETTE.awningCoral
      )
      .body.sleep();

    // 5. 4–5 Story Venetian South Quay Rowhouses (`z = -104`) + Gelateria + Florist + Bicycles
    buildDetailedTownhouse(
      {
        id: 'sw_venetian_coral',
        center: [-52, -104],
        widthX: 34,
        depthZ: 28,
        floors: 4,
        wallHex: PALETTE.wallCoral,
        shutterHex: PALETTE.shutterTeal,
        roofStyle: 'terracotta',
        frontFace: 'north',
        awningHex: PALETTE.awningMint,
        addPerches: true,
      },
      this.townhouseCtx,
      parts
    );
    buildDetailedTownhouse(
      {
        id: 'sw_venetian_mint',
        center: [-88, -104],
        widthX: 36,
        depthZ: 28,
        floors: 5,
        wallHex: PALETTE.wallMint,
        shutterHex: PALETTE.shutterCobalt,
        roofStyle: 'terracotta',
        frontFace: 'north',
        awningHex: PALETTE.awningCoral,
        addPerches: true,
      },
      this.townhouseCtx,
      parts
    );
    buildDetailedTownhouse(
      {
        id: 'sw_venetian_lavender',
        center: [-124, -96],
        widthX: 30,
        depthZ: 36,
        floors: 4,
        wallHex: PALETTE.wallLavender,
        shutterHex: PALETTE.shutterOlive,
        roofStyle: 'mansard',
        frontFace: 'east',
        addPerches: true,
      },
      this.townhouseCtx,
      parts
    );

    // Gelateria Sidewalk Counter (`(-56.0, 0.35, -78.0)`, `top y = 5.15`)
    parts.push(
      transformGeo(rbox(8.4, 4.5, 3.6, 0.2, PALETTE.porcelainWhite, 1), {
        pos: [-56.0, 2.6, -78.0],
      }),
      transformGeo(rbox(8.8, 0.42, 4.0, 0.12, PALETTE.awningMint, 1), {
        pos: [-56.0, 4.95, -78.0],
      })
    );
    this.physics.addStaticBox(
      new THREE.Vector3(-56.0, 2.7, -78.0),
      new THREE.Vector3(4.4, 2.45, 2.0)
    );
    this.createBouncyUmbrella(
      'gelateria_umbrella',
      new THREE.Vector3(-56.0, 0.35, -75.0),
      13.8,
      6.0,
      PALETTE.gelatoStrawberry,
      18.0
    );

    const gelatoSpecs: Array<[number, number, number]> = [
      [-58.1, PALETTE.gelatoPistachio, PALETTE.gelatoStrawberry],
      [-56.0, PALETTE.gelatoMango, PALETTE.porcelainWhite],
      [-53.9, PALETTE.gelatoStrawberry, PALETTE.gelatoPistachio],
    ];
    gelatoSpecs.forEach(([gxPos, sA, sB]) => {
      const cone = this.propFactory.spawnGelatoCone(
        new THREE.Vector3(gxPos, 5.88, -78.0),
        sA,
        sB,
        (_, fallPos) => {
          this.fx.spawnBurst(fallPos, 9, false, 3.2);
          this.audio.playWaterPlop();
          this.npcs.notifyAcousticShock(fallPos, 'topple');
          this.handles?.onGelatoToppled?.();
        }
      );
      cone.body.sleep();
    });
    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(-59.6, 5.7, -78.6),
        PALETTE.windowGlass,
        PALETTE.gelatoStrawberry
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(-52.4, 5.25, -78.4),
        PALETTE.porcelainWhite,
        PALETTE.awningMint
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(-59.4, 5.45, -77.1),
        PALETTE.porcelainWhite,
        PALETTE.gelatoPistachio
      )
      .body.sleep();

    // Florist Flower Stand (`(-84.0, 0.35, -77.5)`)
    for (let fb = 0; fb < 4; fb++) {
      const fxB = -88.0 + fb * 2.4;
      const bHex = fb % 2 === 0 ? PALETTE.tulipCoral : PALETTE.tulipYellow;
      parts.push(
        transformGeo(rcyl(0.95, 0.72, 2.4, PALETTE.roofCopperPatina, 12), {
          pos: [fxB, 1.55, -77.5],
        }),
        transformGeo(rbox(1.9, 1.1, 1.9, 0.34, PALETTE.leafSage, 1), { pos: [fxB, 2.95, -77.5] }),
        transformGeo(rcyl(0.32, 0.14, 0.55, bHex, 8), { pos: [fxB - 0.28, 3.65, -77.5] }),
        transformGeo(rcyl(0.32, 0.14, 0.55, bHex, 8), { pos: [fxB + 0.32, 3.58, -77.2] })
      );
      this.physics.addStaticCylinder(new THREE.Vector3(fxB, 1.55, -77.5), 1.0, 0.78, 2.5, 10);
    }
    this.propFactory.spawnPigmentFlower(new THREE.Vector3(-85.0, 0.78, -74.6), PALETTE.tulipCoral);
    this.propFactory.spawnPigmentFlower(
      new THREE.Vector3(-82.2, 0.78, -74.8),
      PALETTE.lavenderSprig
    );
    this.propFactory.spawnPigmentFlower(new THREE.Vector3(-77.2, 0.78, -74.6), PALETTE.tulipYellow);
    this.propFactory.spawnBerry(new THREE.Vector3(-79.5, 0.78, -74.6), PALETTE.berryRuby);
    this.propFactory
      .spawnBreakableTerracottaPot(new THREE.Vector3(-89.8, 0.82, -76.2), PALETTE.tulipCoral)
      .body.sleep();
    this.propFactory
      .spawnBreakableTerracottaPot(new THREE.Vector3(-78.8, 0.82, -76.2), PALETTE.tulipYellow)
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(-86.8, 0.85, -75.6),
        PALETTE.awningCoral,
        PALETTE.tulipYellow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(-81.8, 0.85, -75.6),
        PALETTE.awningMint,
        PALETTE.tulipCoral
      )
      .body.sleep();

    // 3 Leaned Vintage Bicycles (handlebar perches & bell switches transformed by exact lean roll + yaw)
    this.placeVintageBicycle(
      'canal_bike_north',
      new THREE.Vector3(-32.0, 0.28, -37.6),
      0.08,
      1,
      PALETTE.awningMint
    );
    this.placeVintageBicycle(
      'canal_bike_south',
      new THREE.Vector3(-105.5, 0.28, -71.2),
      Math.PI - 0.1,
      1,
      PALETTE.awningCoral
    );
    this.placeVintageBicycle(
      'cafe_bike_east',
      new THREE.Vector3(-18.2, 0.28, 38.0),
      Math.PI * 0.5,
      -1,
      PALETTE.awningCobalt
    );

    const lantern2 = this.createDistrictLantern(new THREE.Vector3(-24.0, 0.28, -24.0));
    this.districtLanternMeshes[2] = lantern2;

    const swMesh = new THREE.Mesh(mergeParts(parts), this.mat);
    swMesh.castShadow = true;
    swMesh.receiveShadow = true;
    swMesh.geometry.computeBoundingSphere();
    this.root.add(swMesh);

    return { painterEaselPos };
  }

  private placeVintageBicycle(
    id: string,
    pos: THREE.Vector3,
    yaw: number,
    leanSign: 1 | -1,
    frameHex: number
  ): void {
    const leanRoll = leanSign * 0.17;
    const bikeEuler = new THREE.Euler(leanRoll, yaw, 0, 'XYZ');

    const bikeMesh = new THREE.Mesh(this.propFactory.getVintageBicycleGeometry(frameHex), this.mat);
    bikeMesh.position.copy(pos);
    bikeMesh.rotation.copy(bikeEuler);
    bikeMesh.castShadow = true;
    bikeMesh.receiveShadow = true;
    this.root.add(bikeMesh);

    const colCenter = new THREE.Vector3(0, 3.0, 0).applyEuler(bikeEuler).add(pos);
    const body = this.physics.addStaticBox(
      colCenter,
      new THREE.Vector3(4.8, 3.0, 1.0),
      bikeEuler
    );
    // Transform exact `buildVintageBicycleGeometry` curved handlebars, grips, saddle & basket by `bikeEuler`
    const hbL0 = new THREE.Vector3(1.92, 6.09, -1.35).applyEuler(bikeEuler).add(pos);
    const hbL1 = new THREE.Vector3(2.28, 6.12, -0.35).applyEuler(bikeEuler).add(pos);
    const hbC1 = new THREE.Vector3(2.28, 6.06, 0.25).applyEuler(bikeEuler).add(pos);
    const hbR0 = new THREE.Vector3(1.98, 6.07, 0.96).applyEuler(bikeEuler).add(pos);
    const hbR1 = new THREE.Vector3(1.92, 6.09, 1.35).applyEuler(bikeEuler).add(pos);
    const saddleA = new THREE.Vector3(-1.45, 5.19, 0).applyEuler(bikeEuler).add(pos);
    const saddleB = new THREE.Vector3(-0.72, 5.19, 0).applyEuler(bikeEuler).add(pos);
    const basketA = new THREE.Vector3(3.02, 5.44, -0.68).applyEuler(bikeEuler).add(pos);
    const basketB = new THREE.Vector3(3.02, 5.44, 0.68).applyEuler(bikeEuler).add(pos);
    const bellWorldPos = new THREE.Vector3(2.2, 6.22, 0.65).applyEuler(bikeEuler).add(pos);

    this.physics.setBumpMetadata(body, {
      surface: 'metal',
      causesDizzy: false,
      onBump: () => {
        this.audio.playBicycleBell(bellWorldPos);
        this.npcs.notifyAcousticShock(bellWorldPos, 'bell');
        this.handles?.onBicycleBellRung?.();
      },
    });

    this.perches.addStaticSegment(`${id}_handlebars_l`, hbL0, hbL1, 0.08, 'metal');
    this.perches.addStaticSegment(`${id}_handlebars`, hbL1, hbC1, 0.08, 'metal');
    this.perches.addStaticSegment(`${id}_handlebars_r`, hbR0, hbR1, 0.08, 'metal');
    this.perches.addStaticSegment(`${id}_saddle`, saddleA, saddleB, 0.04, 'wood');
    this.perches.addStaticSegment(`${id}_basket`, basketA, basketB, 0.05, 'wood');

    this.physics.registerPeckSwitch({
      id: `${id}_bell`,
      position: bellWorldPos,
      radius: 2.2,
      cooldown: 0,
      onPeck: () => {
        this.audio.playBicycleBell(bellWorldPos);
        this.fx.spawnChirpRing(bellWorldPos, PALETTE.goldGlow, 5.8);
        this.npcs.notifyAcousticShock(bellWorldPos, 'bell');
        this.handles?.onBicycleBellRung?.();
      },
    });
  }

  /**
   * Builds a classic French A-frame tripod easel in local `+Z`-facing floor-origin coordinates (`y = 0` on floor):
   * - Wide front left & right oak legs (`±1.46`) converging inward to a top hinge apex (`±0.15` at `y = 9.95`)
   * - Rear 3rd tripod leg hinged from the apex down to `[0, 0.08, -3.35]`
   * - Central vertical mast spine, lower cross-brace, horizontal canvas tray + lip, and top canvas clamp
   */
  private buildStudioEaselGeometry(scale: number, includePainting: boolean): THREE.BufferGeometry {
    const s = scale;
    const tiltX = -0.145;
    const legR = 0.155 * s;
    const parts: THREE.BufferGeometry[] = [
      // Left A-frame front leg (`/`): wide on floor (`-1.46*s`) -> inward at top apex (`-0.15*s`)
      tube(
        [
          [-1.46 * s, 0.08 * s, 0.66 * s],
          [-0.805 * s, 5.015 * s, -0.06 * s],
          [-0.15 * s, 9.95 * s, -0.78 * s],
        ],
        legR,
        PALETTE.woodOak,
        6,
        8
      ),
      // Right A-frame front leg (`\`): wide on floor (`+1.46*s`) -> inward at top apex (`+0.15*s`)
      tube(
        [
          [1.46 * s, 0.08 * s, 0.66 * s],
          [0.805 * s, 5.015 * s, -0.06 * s],
          [0.15 * s, 9.95 * s, -0.78 * s],
        ],
        legR,
        PALETTE.woodOak,
        6,
        8
      ),
      // Rear 3rd tripod support leg hinged from the top apex back to the floor
      tube(
        [
          [0, 9.8 * s, -0.84 * s],
          [0, 4.94 * s, -2.095 * s],
          [0, 0.08 * s, -3.35 * s],
        ],
        legR * 0.95,
        PALETTE.woodOak,
        6,
        8
      ),
      // Central mast spine rising above the top canvas clamp
      tube(
        [
          [0, 1.35 * s, 0.47 * s],
          [0, 6.0 * s, -0.21 * s],
          [0, 10.65 * s, -0.89 * s],
        ],
        legR * 0.9,
        PALETTE.woodWalnut,
        6,
        8
      ),
      // Grounded walnut foot pads on all 3 tripod legs (`y = 0 .. 0.16*s`)
      transformGeo(rcyl(legR * 1.15, legR * 1.25, 0.16 * s, PALETTE.woodWalnut, 8), {
        pos: [-1.46 * s, 0.08 * s, 0.66 * s],
      }),
      transformGeo(rcyl(legR * 1.15, legR * 1.25, 0.16 * s, PALETTE.woodWalnut, 8), {
        pos: [1.46 * s, 0.08 * s, 0.66 * s],
      }),
      transformGeo(rcyl(legR * 1.15, legR * 1.25, 0.16 * s, PALETTE.woodWalnut, 8), {
        pos: [0, 0.08 * s, -3.35 * s],
      }),
      // Top walnut hinge block & brass wingnut clasping the A-frame apex
      transformGeo(rbox(0.72 * s, 0.42 * s, 0.46 * s, 0.08 * s, PALETTE.woodWalnut, 1), {
        rot: [tiltX, 0, 0],
        pos: [0, 9.95 * s, -0.78 * s],
      }),
      transformGeo(smoothSphere(0.14 * s, PALETTE.brassWarm, 8, 6), {
        pos: [0, 9.98 * s, -0.52 * s],
      }),
      // Lower horizontal oak cross-brace tying the two front legs together
      transformGeo(rbox(2.58 * s, 0.24 * s, 0.24 * s, 0.05 * s, PALETTE.woodOak, 1), {
        rot: [tiltX, 0, 0],
        pos: [0, 1.75 * s, 0.41 * s],
      }),
      // Wide horizontal canvas tray shelf + raised front lip supporting the canvas bottom
      transformGeo(rbox(5.3 * s, 0.28 * s, 0.78 * s, 0.06 * s, PALETTE.woodOak, 1), {
        rot: [tiltX, 0, 0],
        pos: [0, 3.52 * s, 0.42 * s],
      }),
      transformGeo(rbox(5.3 * s, 0.36 * s, 0.18 * s, 0.05 * s, PALETTE.woodWalnut, 1), {
        rot: [tiltX, 0, 0],
        pos: [0, 3.66 * s, 0.74 * s],
      }),
      // Stretched white linen canvas resting squarely on the tray & A-frame legs
      transformGeo(rbox(4.8 * s, 5.8 * s, 0.30 * s, 0.07 * s, PALETTE.porcelainWhite, 1), {
        rot: [tiltX, 0, 0],
        pos: [0, 6.55 * s, 0.04 * s],
      }),
      // Sliding oak top clamp gripping the upper edge of the stretched canvas
      transformGeo(rbox(0.96 * s, 0.38 * s, 0.58 * s, 0.07 * s, PALETTE.woodWalnut, 1), {
        rot: [tiltX, 0, 0],
        pos: [0, 9.54 * s, -0.42 * s],
      }),
    ];

    if (includePainting) {
      parts.push(
        transformGeo(rbox(3.95 * s, 4.75 * s, 0.08 * s, 0.03 * s, PALETTE.skyMidDawn, 1), {
          rot: [tiltX, 0, 0],
          pos: [0, 6.55 * s, 0.175 * s],
        }),
        transformGeo(rbox(3.95 * s, 1.85 * s, 0.08 * s, 0.03 * s, PALETTE.leafSage, 1), {
          rot: [tiltX, 0, 0],
          pos: [0, 5.12 * s, 0.39 * s],
        }),
        transformGeo(
          transformGeo(rcyl(0.46 * s, 0.46 * s, 0.05 * s, PALETTE.sunHalo, 14), {
            rot: [Math.PI * 0.5, 0, 0],
          }),
          {
            rot: [tiltX, 0, 0],
            pos: [0.85 * s, 7.65 * s, 0.04 * s],
          }
        )
      );
    }

    return mergeParts(parts);
  }

  // ==========================================================================
  // 6. SE Block: Farmers' Market, 6-Apple Pyramid, Bookshop & 136-SU Clocktower
  // ==========================================================================

  private buildSEMarketBookshopAndClocktower(): {
    musicBoxPos: THREE.Vector3;
    sanctuaryPos: THREE.Vector3;
    crownBellPos: THREE.Vector3;
  } {
    const parts: THREE.BufferGeometry[] = [];

    // 1. 4-Story Buttercup Bookshop (`(44, -29)`, `95.5 SU` tall) + Swinging Key Sign + 2nd-Story Terrace Music-Box
    buildDetailedTownhouse(
      {
        id: 'se_buttercup_bookshop',
        center: [44, -29],
        widthX: 34,
        depthZ: 18,
        floors: 4,
        wallHex: PALETTE.wallButtercup,
        shutterHex: PALETTE.parisGreen,
        roofStyle: 'mansard',
        frontFace: 'south',
        awningHex: PALETTE.parisGreen,
        addPerches: true,
      },
      this.townhouseCtx,
      parts
    );

    const terX = 44.0;
    const terZ = -41.4;
    const terY = 25.8;
    parts.push(
      transformGeo(rbox(18.0, 0.85, 6.8, 0.18, PALETTE.wallCreamTrim, 1), {
        pos: [terX, terY - 0.42, terZ],
      }),
      transformGeo(rbox(18.0, 2.8, 0.26, 0.06, PALETTE.ironworkPlum, 1), {
        pos: [terX, terY + 1.4, terZ - 3.2],
      }),
      transformGeo(rbox(0.26, 2.8, 6.4, 0.06, PALETTE.ironworkPlum, 1), {
        pos: [terX - 8.87, terY + 1.4, terZ],
      }),
      transformGeo(rbox(0.26, 2.8, 6.4, 0.06, PALETTE.ironworkPlum, 1), {
        pos: [terX + 8.87, terY + 1.4, terZ],
      }),
      transformGeo(rcyl(2.2, 2.1, 0.35, PALETTE.woodWalnut, 18), {
        pos: [terX, terY + 2.8, terZ],
      }),
      transformGeo(rcyl(0.3, 0.4, 2.7, PALETTE.ironworkPlum, 10), {
        pos: [terX, terY + 1.4, terZ],
      }),
      transformGeo(rbox(2.2, 1.1, 1.6, 0.12, PALETTE.woodOak, 1), {
        pos: [terX, terY + 3.5, terZ],
      })
    );
    this.physics.addStaticBox(
      new THREE.Vector3(terX, terY - 0.42, terZ),
      new THREE.Vector3(9.0, 0.42, 3.4)
    );
    this.physics.addStaticCylinder(new THREE.Vector3(terX, terY + 1.49, terZ), 2.2, 1.2, 2.98, 12);
    this.perches.addStaticSegment(
      'bookshop_terrace_rail',
      new THREE.Vector3(terX - 8.6, terY + 2.8, terZ - 3.2),
      new THREE.Vector3(terX + 8.6, terY + 2.8, terZ - 3.2),
      0.08,
      'metal'
    );
    this.perches.addStaticSegment(
      'bookshop_terrace_rail_w',
      new THREE.Vector3(terX - 8.87, terY + 2.8, terZ - 3.0),
      new THREE.Vector3(terX - 8.87, terY + 2.8, terZ + 2.9),
      0.08,
      'metal'
    );
    this.perches.addStaticSegment(
      'bookshop_terrace_rail_e',
      new THREE.Vector3(terX + 8.87, terY + 2.8, terZ - 3.0),
      new THREE.Vector3(terX + 8.87, terY + 2.8, terZ + 2.9),
      0.08,
      'metal'
    );
    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(terX - 7.2, terY + 0.47, terZ - 2.0),
        PALETTE.tulipYellow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(terX + 7.2, terY + 0.47, terZ - 2.0),
        PALETTE.tulipCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(terX + 1.45, terY + 3.08, terZ + 0.4),
        PALETTE.porcelainWhite,
        PALETTE.parisGreen
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(terX - 1.45, terY + 3.21, terZ - 0.35),
        PALETTE.awningGold,
        PALETTE.coffeeDark
      )
      .body.sleep();

    const musicBoxPos = new THREE.Vector3(terX, terY + 3.6, terZ);
    this.musicBoxLidPivot.position.set(terX, terY + 4.05, terZ + 0.75);
    const musicLidGeo = transformGeo(rbox(2.25, 0.22, 1.65, 0.08, PALETTE.brassWarm, 1), {
      pos: [0, 0, -0.78],
    });
    musicLidGeo.computeBoundingSphere();
    this.musicBoxLidPivot.add(new THREE.Mesh(musicLidGeo, this.mat));
    this.root.add(this.musicBoxLidPivot);

    // Swinging Wrought-Iron Bookshop Sign (bracket `(25.6, 21.6, -29.0)`, pivot `(24.0, 21.5, -29.0)`) holding the Brass Key on a hook
    parts.push(
      transformGeo(rbox(3.8, 0.32, 0.32, 0.06, PALETTE.ironworkPlum, 1), {
        pos: [25.6, 21.6, -29.0],
      })
    );
    this.swingingSignPivot.position.set(24.0, 21.5, -29.0);
    const signBoardMesh = new THREE.Mesh(
      mergeParts([
        transformGeo(rbox(3.4, 2.6, 0.35, 0.14, PALETTE.parisGreen, 1), { pos: [0, -1.8, 0] }),
        transformGeo(rbox(2.8, 2.0, 0.42, 0.08, PALETTE.goldGlow, 1), { pos: [0, -1.8, 0] }),
        transformGeo(rcyl(0.08, 0.08, 0.32, PALETTE.brassWarm, 8), { pos: [0, -3.05, 0] }),
      ]),
      this.mat
    );
    signBoardMesh.geometry.computeBoundingSphere();
    this.swingingSignPivot.add(signBoardMesh);
    this.root.add(this.swingingSignPivot);

    // Brass Key hangs kinematically on the sign hook (`allowSleep = false`) until pecked down
    this.hangingKeyProp = this.propFactory.spawnBrassKey(new THREE.Vector3(24.0, 18.5, -29.0));
    this.hangingKeyProp.body.type = CANNON.Body.KINEMATIC;
    this.hangingKeyProp.body.allowSleep = false;
    this.hangingKeyProp.body.velocity.set(0, 0, 0);

    this.physics.registerPeckSwitch({
      id: 'bookshop_swinging_sign',
      position: new THREE.Vector3(24.0, 20.55, -29.0),
      radius: 1.55,
      cooldown: 0,
      onPeck: () => {
        this.releaseBookshopHangingKey(true);
      },
    });
    const signBracketSeg = this.perches.addStaticSegment(
      'bookshop_sign_bracket',
      new THREE.Vector3(23.8, 21.76, -29.0),
      new THREE.Vector3(26.8, 21.76, -29.0),
      0.08,
      'metal'
    );
    signBracketSeg.onLand = (_t, speed) => {
      this.signVel += Math.min(4.8, 1.3 + speed * 0.35);
      this.signSettled = false;
      this.audio.playWirePluck(this.swingingSignPivot.position, 0.72);
    };
    signBracketSeg.onLeave = (_t, kickSpeed) => {
      this.signVel -= Math.min(3.8, kickSpeed * 0.32);
      this.signSettled = false;
    };

    // Spinning Wire Postcard Carousel at Bookshop Corner (`(24.5, 0.28, -22.5)`)
    const pcPos = new THREE.Vector3(24.5, 0.28, -22.5);
    parts.push(
      transformGeo(rcyl(1.1, 1.35, 0.32, PALETTE.ironworkPlum, 14), {
        pos: [pcPos.x, 0.44, pcPos.z],
      }),
      transformGeo(rcyl(0.13, 0.15, 6.4, PALETTE.ironworkPlum, 10), {
        pos: [pcPos.x, 3.6, pcPos.z],
      })
    );
    this.postcardCarouselPivot.position.set(pcPos.x, 4.5, pcPos.z);
    const pcParts: THREE.BufferGeometry[] = [];
    const cardCols = [
      PALETTE.tulipCoral,
      PALETTE.skyMidDawn,
      PALETTE.tulipYellow,
      PALETTE.awningMint,
    ];
    for (let side = 0; side < 4; side++) {
      const ca = (side / 4) * Math.PI * 2;
      for (let row = 0; row < 3; row++) {
        pcParts.push(
          transformGeo(rbox(0.95, 1.18, 0.09, 0.03, cardCols[(side + row) % 4], 1), {
            rot: [0, ca, 0],
            pos: [Math.sin(ca) * 0.92, -1.2 + row * 1.32, Math.cos(ca) * 0.92],
          })
        );
      }
    }
    const pcMesh = new THREE.Mesh(mergeParts(pcParts), this.mat);
    pcMesh.geometry.computeBoundingSphere();
    this.postcardCarouselPivot.add(pcMesh);
    this.root.add(this.postcardCarouselPivot);
    this.physics.registerPeckSwitch({
      id: 'postcard_carousel_spin',
      position: new THREE.Vector3(pcPos.x, 4.5, pcPos.z),
      radius: 2.0,
      cooldown: 0,
      onPeck: () => {
        this.postcardSpinVel = 12.0;
        this.audio.playCoinClink();
        if (!this.postcardCoinSpawned) {
          this.postcardCoinSpawned = true;
          const c = this.propFactory.spawnCoin(new THREE.Vector3(pcPos.x - 1.5, 4.5, pcPos.z + 1.2));
          c.body.velocity.set(-3.2, 4.8, 2.8);
        }
      },
    });

    // 2. Open-Air Farmers' Market Stalls (`x: 34..78, z: -92..-58`) + 6-Apple Pyramid
    const stalls: Array<{ pos: [number, number]; stripe: number }> = [
      { pos: [52.0, -68.0], stripe: PALETTE.awningCoral },
      { pos: [34.0, -68.0], stripe: PALETTE.awningGold },
      { pos: [34.0, -88.0], stripe: PALETTE.awningMint },
      { pos: [58.0, -90.0], stripe: PALETTE.awningCobalt },
    ];
    stalls.forEach((st, idx) => {
      const [sx, sz] = st.pos;
      parts.push(
        transformGeo(rbox(11.5, 0.5, 6.2, 0.14, PALETTE.woodOak, 1), { pos: [sx, 4.67, sz] }),
        transformGeo(rbox(10.8, 4.1, 5.4, 0.16, PALETTE.woodBirch, 1), { pos: [sx, 2.35, sz] })
      );
      for (const px of [-5.2, 5.2]) {
        for (const pz of [-2.7, 2.7]) {
          parts.push(
            transformGeo(rcyl(0.22, 0.26, 14.8, PALETTE.woodOak, 8), {
              pos: [sx + px, 7.68, sz + pz],
            })
          );
        }
      }
      this.physics.addStaticBox(
        new THREE.Vector3(sx, 2.6, sz),
        new THREE.Vector3(5.75, 2.32, 3.1)
      );
      this.createBouncyAwning(
        `market_stall_canopy_${idx}`,
        new THREE.Vector3(sx, 15.2, sz),
        new THREE.Vector3(6.8, 0.52, 4.2),
        st.stripe,
        PALETTE.awningCream,
        18.6
      );

      const pwPos = new THREE.Vector3(sx + 5.6, 16.1, sz + 3.0);
      const rotor = new THREE.Group();
      rotor.position.copy(pwPos);
      const blades: THREE.BufferGeometry[] = [];
      for (let b = 0; b < 4; b++) {
        blades.push(
          transformGeo(
            rbox(0.55, 1.4, 0.1, 0.04, b % 2 === 0 ? st.stripe : PALETTE.tulipYellow, 1),
            {
              rot: [0.25, 0, (b * Math.PI) / 2],
              pos: [Math.cos((b * Math.PI) / 2) * 0.65, Math.sin((b * Math.PI) / 2) * 0.65, 0],
            }
          )
        );
      }
      const bladeMesh = new THREE.Mesh(mergeParts(blades), this.mat);
      bladeMesh.geometry.computeBoundingSphere();
      rotor.add(bladeMesh);
      this.root.add(rotor);
      const pwInst: PinwheelInstance = { rotor, spinSpeed: 2.6 };
      this.pinwheels.push(pwInst);
      this.physics.registerPeckSwitch({
        id: `market_pinwheel_${idx}`,
        position: pwPos,
        radius: 1.85,
        cooldown: 0,
        onPeck: () => {
          pwInst.spinSpeed = 18.0;
          this.audio.playWingFlap(0.8);
        },
      });
    });

    // 6-Apple Stacked Pyramid on Stall 0 (`top collider y = 4.92`, sphere `r = 0.38`, contact spacing `0.76 SU`, layer step `0.658 SU`)
    const pyrX = 52.0;
    const pyrZ = -67.5;
    const pyrBaseY = 4.92 + 0.38; // 5.30 SU — flush on stall surface
    const layerStepY = Math.sqrt(0.76 * 0.76 - 0.38 * 0.38); // 0.6582 SU — exact tangent contact
    const appleOffsets: Array<[number, number, number, number]> = [
      [-0.76, pyrBaseY, 0, PALETTE.tulipCoral],
      [0.0, pyrBaseY, 0, PALETTE.berryRuby],
      [0.76, pyrBaseY, 0, PALETTE.tulipCoral],
      [-0.38, pyrBaseY + layerStepY, 0, PALETTE.leafSage],
      [0.38, pyrBaseY + layerStepY, 0, PALETTE.tulipYellow],
      [0.0, pyrBaseY + layerStepY * 2, 0, PALETTE.berryRuby],
    ];
    for (const [ax, ay, az, aHex] of appleOffsets) {
      const ap = this.propFactory.spawnApple(
        new THREE.Vector3(pyrX + ax, ay, pyrZ + az),
        aHex,
        (_, fallPos) => {
          this.applesToppledCount++;
          if (this.applesToppledCount >= 2 && !this.appleAvalancheFired) {
            this.appleAvalancheFired = true;
            this.npcs.triggerVendorShoo(fallPos);
            this.npcs.notifyAcousticShock(fallPos, 'topple');
            this.handles?.onApplePyramidToppled?.();
          }
        }
      );
      ap.body.sleep();
      this.pyramidApples.push(ap);
    }

    // Extra market goodies + breakable glassware, jam jars, vases & crockery
    this.propFactory.spawnBaguette(new THREE.Vector3(33.2, 5.12, -68.0));
    this.propFactory.spawnBaguette(new THREE.Vector3(35.0, 5.12, -67.6));
    this.propFactory.spawnNestItem(
      'velvet_down',
      new THREE.Vector3(34.0, 5.32, -88.0),
      PALETTE.porcelainWhite
    );
    this.propFactory.spawnNestItem(
      'ribbon',
      new THREE.Vector3(58.0, 5.32, -90.0),
      PALETTE.awningGold
    );
    this.propFactory.spawnCoin(new THREE.Vector3(36.2, 5.32, -87.4));

    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(47.8, 5.47, -68.2),
        PALETTE.windowGlass,
        PALETTE.awningCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(56.2, 5.32, -67.6), PALETTE.berryRuby)
      .body.sleep();
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(55.2, 5.32, -68.8), PALETTE.ginkgoGold)
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(48.8, 5.01, -69.4),
        PALETTE.porcelainWhite,
        PALETTE.awningCoral
      )
      .body.sleep();

    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(29.8, 5.42, -68.4),
        PALETTE.awningGold,
        PALETTE.tulipCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicMug(
        new THREE.Vector3(37.8, 5.35, -68.2),
        PALETTE.porcelainWhite,
        PALETTE.coffeeDark,
        PALETTE.awningGold
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(31.2, 5.01, -66.8),
        PALETTE.porcelainWhite,
        PALETTE.awningGold
      )
      .body.sleep();

    this.propFactory
      .spawnBreakableGlassCarafe(
        new THREE.Vector3(30.2, 5.47, -88.2),
        PALETTE.windowGlass,
        PALETTE.awningMint
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(38.0, 5.42, -88.4),
        PALETTE.awningMint,
        PALETTE.tulipYellow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTerracottaPot(new THREE.Vector3(31.6, 5.39, -86.6), PALETTE.tulipCoral)
      .body.sleep();

    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(54.0, 5.42, -90.2),
        PALETTE.awningCobalt,
        PALETTE.tulipYellow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakablePigmentJar(new THREE.Vector3(61.8, 5.32, -89.8), PALETTE.birdBlueTit)
      .body.sleep();
    this.propFactory
      .spawnBreakablePlate(
        new THREE.Vector3(55.8, 5.01, -88.8),
        PALETTE.porcelainWhite,
        PALETTE.awningCobalt
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTeacup(
        new THREE.Vector3(60.4, 5.22, -91.0),
        PALETTE.porcelainWhite,
        PALETTE.awningCobalt
      )
      .body.sleep();

    // 3. 4-Story Brick Roastery Townhouse (`(116, -46)`) with High-Altitude Chimney Thermal (`y: 36..136`)
    buildDetailedTownhouse(
      {
        id: 'se_brick_roastery',
        center: [116, -46],
        widthX: 30,
        depthZ: 34,
        floors: 4,
        wallHex: PALETTE.brickTerracotta,
        shutterHex: PALETTE.wallCreamTrim,
        roofStyle: 'mansard',
        frontFace: 'west',
        awningHex: PALETTE.awningGold,
        addPerches: true,
      },
      this.townhouseCtx,
      parts
    );
    const chimneyX = 104.0;
    const chimneyZ = -58.0;
    parts.push(
      transformGeo(rcyl(2.2, 3.0, 46.0, PALETTE.brickTerracotta, 16), {
        pos: [chimneyX, 23.2, chimneyZ],
      }),
      transformGeo(rcyl(2.6, 2.3, 1.5, PALETTE.ironworkPlum, 16), {
        pos: [chimneyX, 46.6, chimneyZ],
      })
    );
    this.physics.addStaticCylinder(
      new THREE.Vector3(chimneyX, 23.2, chimneyZ),
      2.3,
      3.0,
      46.0,
      12
    );
    this.physics.registerUpdraft({
      id: 'roastery_chimney_thermal',
      x: chimneyX,
      z: chimneyZ,
      yMin: 36.0,
      yMax: 136.0,
      radius: 9.0,
      liftAccel: 29.0,
      active: true,
    });

    // 4. Renaissance Campanile Clocktower (`(96, -96)`, total height `136.5 SU`)
    const tx = 96.0;
    const tz = -96.0;
    parts.push(
      transformGeo(rbox(24.0, 6.0, 24.0, 0.24, PALETTE.curbStone, 1), { pos: [tx, 3.28, tz] }),
      transformGeo(rbox(22.2, 45.8, 22.2, 0.32, PALETTE.wallLimestone, 1), {
        pos: [tx, 23.18, tz],
      }),
      transformGeo(rbox(24.6, 1.5, 24.6, 0.2, PALETTE.wallCreamTrim, 1), {
        pos: [tx, 46.15, tz],
      }),
      transformGeo(rbox(19.8, 28.0, 19.8, 0.3, PALETTE.wallLimestone, 1), { pos: [tx, 60.0, tz] }),
      transformGeo(rbox(22.4, 1.5, 22.4, 0.2, PALETTE.wallCreamTrim, 1), {
        pos: [tx, 74.15, tz],
      }),
      transformGeo(rbox(18.8, 21.0, 18.8, 0.28, PALETTE.wallCreamTrim, 1), {
        pos: [tx, 84.5, tz],
      }),
      transformGeo(rbox(21.6, 1.6, 21.6, 0.2, PALETTE.wallLimestone, 1), { pos: [tx, 95.15, tz] })
    );

    // 4 Illuminated Porcelain & Brass Clock Dials at `y = 84.6 SU` with Live-Ticking Hands
    for (const [nx, nz, rotY] of [
      [0, 1, 0],
      [0, -1, Math.PI],
      [1, 0, Math.PI * 0.5],
      [-1, 0, -Math.PI * 0.5],
    ] as const) {
      const dx = nx * 9.55;
      const dz = nz * 9.55;
      const cylRot: [number, number, number] =
        nx !== 0 ? [0, 0, Math.PI * 0.5] : [Math.PI * 0.5, 0, 0];
      parts.push(
        transformGeo(rcyl(5.6, 5.6, 0.48, PALETTE.brassWarm, 24), {
          rot: cylRot,
          pos: [tx + dx, 84.6, tz + dz],
        }),
        transformGeo(rcyl(4.95, 4.95, 0.58, PALETTE.porcelainWhite, 24), {
          rot: cylRot,
          pos: [tx + dx, 84.6, tz + dz],
        }),
        transformGeo(rcyl(0.44, 0.44, 0.78, PALETTE.brassWarm, 14), {
          rot: cylRot,
          pos: [tx + dx, 84.6, tz + dz],
        })
      );
      // 12 / 3 / 6 / 9 brass cardinal hour markers flush on each porcelain face
      for (const [mRight, mUp, mw, mh] of [
        [0, 4.05, 0.34, 0.92],
        [0, -4.05, 0.34, 0.92],
        [4.05, 0, 0.92, 0.34],
        [-4.05, 0, 0.92, 0.34],
      ] as const) {
        const rightX = Math.cos(rotY);
        const rightZ = -Math.sin(rotY);
        parts.push(
          transformGeo(rbox(mw, mh, 0.14, 0.03, PALETTE.brassWarm, 1), {
            rot: [0, rotY, 0],
            pos: [
              tx + nx * 9.86 + rightX * mRight,
              84.6 + mUp,
              tz + nz * 9.86 + rightZ * mRight,
            ],
          })
        );
      }
      this.createClockDialRig([tx + nx * 9.86, 84.6, tz + nz * 9.86], rotY, 1.0);
    }

    const towerShaftBody = this.physics.addStaticBox(
      new THREE.Vector3(tx, 47.9, tz),
      new THREE.Vector3(10.5, 47.9, 10.5)
    );
    this.physics.setBumpMetadata(towerShaftBody, { surface: 'stone', causesDizzy: true });
    this.physics.addStaticBox(new THREE.Vector3(tx, 3.28, tz), new THREE.Vector3(12.0, 3.0, 12.0));
    this.physics.addStaticBox(
      new THREE.Vector3(tx, 46.15, tz),
      new THREE.Vector3(12.3, 0.75, 12.3)
    );
    this.physics.addStaticBox(
      new THREE.Vector3(tx, 74.15, tz),
      new THREE.Vector3(11.2, 0.75, 11.2)
    );
    this.physics.addStaticBox(new THREE.Vector3(tx, 95.15, tz), new THREE.Vector3(10.8, 0.8, 10.8));

    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(tx - 11.2, 6.75, tz + 11.2),
        PALETTE.tulipCoral
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(tx + 11.2, 6.75, tz + 11.2),
        PALETTE.tulipYellow
      )
      .body.sleep();

    for (const [ledgeY, halfW] of [
      [46.9, 12.05],
      [74.9, 10.95],
      [95.95, 10.55],
    ] as const) {
      this.perches.addStaticSegment(
        `clocktower_ledge_n_${ledgeY}`,
        new THREE.Vector3(tx - halfW, ledgeY, tz + halfW),
        new THREE.Vector3(tx + halfW, ledgeY, tz + halfW),
        0.03,
        'stone'
      );
      this.perches.addStaticSegment(
        `clocktower_ledge_s_${ledgeY}`,
        new THREE.Vector3(tx - halfW, ledgeY, tz - halfW),
        new THREE.Vector3(tx + halfW, ledgeY, tz - halfW),
        0.03,
        'stone'
      );
      this.perches.addStaticSegment(
        `clocktower_ledge_w_${ledgeY}`,
        new THREE.Vector3(tx - halfW, ledgeY, tz - halfW),
        new THREE.Vector3(tx - halfW, ledgeY, tz + halfW),
        0.03,
        'stone'
      );
      this.perches.addStaticSegment(
        `clocktower_ledge_e_${ledgeY}`,
        new THREE.Vector3(tx + halfW, ledgeY, tz - halfW),
        new THREE.Vector3(tx + halfW, ledgeY, tz + halfW),
        0.03,
        'stone'
      );
    }

    // Open Belfry Corner Piers (`y: 95.8 .. 113.4`)
    for (const px of [-7.6, 7.6]) {
      for (const pz of [-7.6, 7.6]) {
        parts.push(
          transformGeo(rbox(3.2, 17.6, 3.2, 0.2, PALETTE.wallLimestone, 1), {
            pos: [tx + px, 104.6, tz + pz],
          })
        );
        const pierBody = this.physics.addStaticBox(
          new THREE.Vector3(tx + px, 104.6, tz + pz),
          new THREE.Vector3(1.6, 8.8, 1.6)
        );
        this.physics.setBumpMetadata(pierBody, { surface: 'stone', causesDizzy: true });
      }
    }

    // Crown Terrace Slab (`y = 113.5`), Nest Balustrade Corbel (`z = -86.8`), & Octagonal Copper Spire (`top y = 136.5 SU`)
    parts.push(
      transformGeo(rbox(20.8, 1.6, 20.8, 0.22, PALETTE.wallCreamTrim, 1), {
        pos: [tx, 113.5, tz],
      }),
      // Sculpted limestone corbel balcony supporting the forward-shifted Sky Sanctuary Nest at `z = -86.8`
      transformGeo(rcyl(2.95, 2.1, 1.6, PALETTE.wallCreamTrim, 16), {
        pos: [tx, 113.5, -86.8],
      }),
      transformGeo(rcyl(0.38, 6.2, 20.8, PALETTE.roofCopperPatina, 12), {
        pos: [tx, 124.7, tz],
      }),
      transformGeo(
        lathe(
          [
            [0.01, -0.95],
            [0.68, -0.35],
            [0.82, 0.1],
            [0.52, 0.65],
            [0.01, 1.05],
          ],
          PALETTE.goldGlow,
          16
        ),
        { pos: [tx, 135.6, tz] }
      )
    );
    this.physics.addStaticBox(
      new THREE.Vector3(tx, 113.5, tz),
      new THREE.Vector3(10.4, 0.8, 10.4)
    );
    this.physics.addStaticCylinder(new THREE.Vector3(tx, 113.5, -86.8), 2.95, 2.3, 1.6, 12);

    // Tiered Static Cylinder Colliders for the Clocktower Spire Cone (`(96, y, -96)`)
    const spireLow = this.physics.addStaticCylinder(
      new THREE.Vector3(tx, 117.8, tz),
      4.2,
      6.15,
      7.0,
      10
    );
    const spireMid = this.physics.addStaticCylinder(
      new THREE.Vector3(tx, 124.8, tz),
      2.25,
      4.2,
      7.0,
      10
    );
    const spireHigh = this.physics.addStaticCylinder(
      new THREE.Vector3(tx, 132.45, tz),
      0.45,
      2.25,
      8.3,
      8
    );
    this.physics.setBumpMetadata(spireLow, { surface: 'metal', causesDizzy: true });
    this.physics.setBumpMetadata(spireMid, { surface: 'metal', causesDizzy: true });
    this.physics.setBumpMetadata(spireHigh, { surface: 'metal', causesDizzy: true });

    this.propFactory
      .spawnBreakableTerracottaPot(
        new THREE.Vector3(tx - 9.2, 114.77, tz - 9.2),
        PALETTE.tulipYellow
      )
      .body.sleep();
    this.propFactory
      .spawnBreakableCeramicVase(
        new THREE.Vector3(tx + 9.2, 114.8, tz - 9.2),
        PALETTE.awningGold,
        PALETTE.tulipCoral
      )
      .body.sleep();

    for (const [sideId, ax, az, bx, bz] of [
      ['n_w', -10.1, 10.1, -3.2, 10.1],
      ['n_e', 3.2, 10.1, 10.1, 10.1],
      ['s', -8.0, -10.1, 8.0, -10.1],
      ['w', -10.1, -8.0, -10.1, 10.1],
      ['e', 10.1, -8.0, 10.1, 10.1],
    ] as const) {
      this.perches.addStaticSegment(
        `clocktower_crown_${sideId}`,
        new THREE.Vector3(tx + ax, 114.3, tz + az),
        new THREE.Vector3(tx + bx, 114.3, tz + bz),
        0.03,
        'stone'
      );
    }

    // Swinging Bronze Belfry Bell (`crownBellPos = (96, 105.5, -96)`) + Interior Oak Belfry Cross-Beams (`y = 103.85`)
    parts.push(
      transformGeo(rbox(14.6, 0.56, 0.56, 0.1, PALETTE.woodOak, 1), {
        pos: [tx, 103.6, tz - 3.6],
      }),
      transformGeo(rbox(14.6, 0.56, 0.56, 0.1, PALETTE.woodOak, 1), {
        pos: [tx, 103.6, tz + 3.6],
      })
    );
    this.perches.addStaticSegment(
      'clocktower_belfry_beam_s',
      new THREE.Vector3(tx - 5.8, 103.88, tz - 3.6),
      new THREE.Vector3(tx + 5.8, 103.88, tz - 3.6),
      0.08,
      'wood'
    );
    this.perches.addStaticSegment(
      'clocktower_belfry_beam_n',
      new THREE.Vector3(tx - 5.8, 103.88, tz + 3.6),
      new THREE.Vector3(tx + 5.8, 103.88, tz + 3.6),
      0.08,
      'wood'
    );

    const crownBellPos = new THREE.Vector3(tx, 105.5, tz);
    const bellGroup = new THREE.Group();
    bellGroup.position.set(tx, 112.0, tz);
    const bellGeo = mergeParts([
      transformGeo(
        lathe(
          [
            [0.001, -0.55],
            [0.35, -0.55],
            [1.65, -2.8],
            [2.65, -5.4],
            [3.2, -5.4],
            [3.0, -4.9],
            [2.1, -2.9],
            [1.55, -0.7],
            [0.45, 0],
            [0.001, 0],
          ],
          PALETTE.brassWarm,
          24
        ),
        { pos: [0, -0.4, 0] }
      ),
      transformGeo(rcyl(0.46, 0.54, 0.9, PALETTE.goldGlow, 14), { pos: [0, -5.5, 0] }),
    ]);
    bellGeo.computeBoundingSphere();
    bellGroup.add(new THREE.Mesh(bellGeo, this.mat));
    this.root.add(bellGroup);
    const bellState = { group: bellGroup, vel: 0, angle: 0, settled: true };
    this.bellPivots.push(bellState);

    let lastBellRingTime = -10;
    const ringBelfryBell = () => {
      const nowS = performance.now() * 0.001;
      if (nowS - lastBellRingTime < 0.35) return;
      lastBellRingTime = nowS;
      bellState.vel += 6.5;
      bellState.settled = false;
      this.audio.playBellTowerBong(crownBellPos);
      this.fx.spawnChirpRing(crownBellPos, PALETTE.goldGlow, 18.0);
      this.npcs.notifyAcousticShock(crownBellPos, 'bell');
      this.handles?.onBelfryBellRung?.();
    };

    const bellColBody = this.physics.addStaticCylinder(
      new THREE.Vector3(tx, 108.4, tz),
      1.6,
      2.75,
      5.2,
      12
    );
    this.physics.setBumpMetadata(bellColBody, {
      surface: 'metal',
      causesDizzy: false,
      onBump: ringBelfryBell,
    });

    this.physics.registerPeckSwitch({
      id: 'clocktower_belfry_bell',
      position: crownBellPos,
      radius: 3.65,
      cooldown: 0,
      onPeck: ringBelfryBell,
    });

    // Sky Sanctuary Woven Nest (`r = 2.45`, forward on open balustrade `z = -86.8` with +0.55 SU clearance from spire)
    const sanctuaryPos = new THREE.Vector3(tx, 114.32, -86.8);
    const sancNestMesh = this.buildWovenNestMesh(2.45);
    sancNestMesh.position.copy(sanctuaryPos);
    this.root.add(sancNestMesh);
    this.sanctuaryNestSlots.position.copy(sanctuaryPos);
    this.root.add(this.sanctuaryNestSlots);

    const lantern3 = this.createDistrictLantern(new THREE.Vector3(24.0, 0.28, -16.5));
    const lantern4 = this.createDistrictLantern(new THREE.Vector3(82.0, 0.28, -82.0));
    this.districtLanternMeshes[3] = lantern3;
    this.districtLanternMeshes[4] = lantern4;

    const seMesh = new THREE.Mesh(mergeParts(parts), this.mat);
    seMesh.castShadow = true;
    seMesh.receiveShadow = true;
    seMesh.geometry.computeBoundingSphere();
    this.root.add(seMesh);

    return { musicBoxPos, sanctuaryPos, crownBellPos };
  }

  // ==========================================================================
  // 7. Perimeter 4–5 Story Townhouse Skyline & Quadrant-Split Street Furniture
  // ==========================================================================

  private async buildPerimeterTownhouseSkylineAndStreetFurniture(
    onProgress?: (percent: number) => Promise<void>
  ): Promise<void> {
    // Continuous 5–6 Story Physical Perimeter Townhouses, Corner Cupola Palazzos & Boulevard Galleria/Depot Gatehouses
    // Every facade meets edge-to-edge along `±152 SU` with colliders extending to `y = 172` (replacing artificial invisible walls).
    const perimeterHouses: Array<Omit<TownhouseSpec, 'id'>> = [
      // 4 Grand 6-Story Corner Haussmann Palazzos (`±166, ±166`, `32 x 32` -> `±150..±182`)
      { center: [-166, 166], widthX: 32, depthZ: 32, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'south', visibleFaces: { south: true, east: true } },
      { center: [166, 166], widthX: 32, depthZ: 32, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.parisGreen, roofStyle: 'mansard', frontFace: 'south', visibleFaces: { south: true, west: true } },
      { center: [-166, -166], widthX: 32, depthZ: 32, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallCoral, shutterHex: PALETTE.shutterTeal, roofStyle: 'terracotta', frontFace: 'north', visibleFaces: { north: true, east: true } },
      { center: [166, -166], widthX: 32, depthZ: 32, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallButtercup, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'north', visibleFaces: { north: true, west: true } },

      // North Rim (`z = 166`, inner facade `z = 152`, continuous `x: -150..+150`)
      { center: [-129, 166], widthX: 42, depthZ: 28, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallApricot, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'south', visibleFaces: { south: true } },
      { center: [-86, 166], widthX: 44, depthZ: 28, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallCoral, shutterHex: PALETTE.shutterTeal, roofStyle: 'terracotta', frontFace: 'south', visibleFaces: { south: true } },
      { center: [-43, 166], widthX: 42, depthZ: 28, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.shutterOlive, roofStyle: 'mansard', frontFace: 'south', visibleFaces: { south: true } },
      { center: [0, 166], widthX: 44, depthZ: 28, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.parisGreen, roofStyle: 'mansard', frontFace: 'south', visibleFaces: { south: true } },
      { center: [43, 166], widthX: 42, depthZ: 28, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallButtercup, shutterHex: PALETTE.parisGreen, roofStyle: 'mansard', frontFace: 'south', visibleFaces: { south: true } },
      { center: [86, 166], widthX: 44, depthZ: 28, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallSage, shutterHex: PALETTE.shutterTeal, roofStyle: 'mansard', frontFace: 'south', visibleFaces: { south: true } },
      { center: [129, 166], widthX: 42, depthZ: 28, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallApricot, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'south', visibleFaces: { south: true } },

      // South Rim (`z = -166`, inner facade `z = -152`, continuous `x: -150..+150`)
      { center: [-129, -166], widthX: 42, depthZ: 28, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLavender, shutterHex: PALETTE.shutterTeal, roofStyle: 'mansard', frontFace: 'north', visibleFaces: { north: true } },
      { center: [-86, -166], widthX: 44, depthZ: 28, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallOchre, shutterHex: PALETTE.shutterOlive, roofStyle: 'terracotta', frontFace: 'north', visibleFaces: { north: true } },
      { center: [-43, -166], widthX: 42, depthZ: 28, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.shutterTeal, roofStyle: 'mansard', frontFace: 'north', visibleFaces: { north: true } },
      { center: [0, -166], widthX: 44, depthZ: 28, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'north', visibleFaces: { north: true } },
      { center: [43, -166], widthX: 42, depthZ: 28, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallSage, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'north', visibleFaces: { north: true } },
      { center: [86, -166], widthX: 44, depthZ: 28, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallCoral, shutterHex: PALETTE.wallCreamTrim, roofStyle: 'terracotta', frontFace: 'north', visibleFaces: { north: true } },
      { center: [129, -166], widthX: 42, depthZ: 28, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallButtercup, shutterHex: PALETTE.parisGreen, roofStyle: 'mansard', frontFace: 'north', visibleFaces: { north: true } },

      // West Rim (`x = -166`, inner facade `x = -152`, continuous `z: -150..+150` together with Canal Watergate Palazzo)
      { center: [-166, 129], widthX: 28, depthZ: 42, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallApricot, shutterHex: PALETTE.shutterOlive, roofStyle: 'mansard', frontFace: 'east', visibleFaces: { east: true } },
      { center: [-166, 86], widthX: 28, depthZ: 44, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallButtercup, shutterHex: PALETTE.shutterTeal, roofStyle: 'mansard', frontFace: 'east', visibleFaces: { east: true } },
      { center: [-166, 43], widthX: 28, depthZ: 42, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallCoral, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'east', visibleFaces: { east: true } },
      { center: [-166, 0], widthX: 28, depthZ: 44, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.parisGreen, roofStyle: 'mansard', frontFace: 'east', visibleFaces: { east: true } },
      { center: [-166, -29], widthX: 28, depthZ: 14, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallOchre, shutterHex: PALETTE.shutterTeal, roofStyle: 'terracotta', frontFace: 'east', visibleFaces: { east: true } },
      { center: [-166, -91.5], widthX: 28, depthZ: 39, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.parisGreen, roofStyle: 'terracotta', frontFace: 'east', visibleFaces: { east: true } },
      { center: [-166, -130.5], widthX: 28, depthZ: 39, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallMint, shutterHex: PALETTE.shutterCobalt, roofStyle: 'terracotta', frontFace: 'east', visibleFaces: { east: true } },

      // East Rim (`x = 166`, inner facade `x = 152`, continuous `z: -150..+150`)
      { center: [166, 129], widthX: 28, depthZ: 42, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallCoral, shutterHex: PALETTE.shutterTeal, roofStyle: 'mansard', frontFace: 'west', visibleFaces: { west: true } },
      { center: [166, 86], widthX: 28, depthZ: 44, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.shutterOlive, roofStyle: 'mansard', frontFace: 'west', visibleFaces: { west: true } },
      { center: [166, 43], widthX: 28, depthZ: 42, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallApricot, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'west', visibleFaces: { west: true } },
      { center: [166, 0], widthX: 28, depthZ: 44, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.parisGreen, roofStyle: 'mansard', frontFace: 'west', visibleFaces: { west: true } },
      { center: [166, -43], widthX: 28, depthZ: 42, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallLimestone, shutterHex: PALETTE.parisGreen, roofStyle: 'mansard', frontFace: 'west', visibleFaces: { west: true } },
      { center: [166, -86], widthX: 28, depthZ: 44, floors: 6, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallButtercup, shutterHex: PALETTE.shutterTeal, roofStyle: 'terracotta', frontFace: 'west', visibleFaces: { west: true } },
      { center: [166, -129], widthX: 28, depthZ: 42, floors: 5, minColliderTopY: 172, addPerches: true, wallHex: PALETTE.wallSage, shutterHex: PALETTE.shutterCobalt, roofStyle: 'mansard', frontFace: 'west', visibleFaces: { west: true } },
    ];
    const quadStreet: Record<QuadrantKey, THREE.BufferGeometry[]> = {
      nw: [],
      ne: [],
      sw: [],
      se: [],
    };
    const quadFoliage: Record<QuadrantKey, THREE.BufferGeometry[]> = {
      nw: [],
      ne: [],
      sw: [],
      se: [],
    };
    const horizonFoliageParts: THREE.BufferGeometry[] = [];

    perimeterHouses.forEach((ph, i) => {
      buildDetailedTownhouse(
        {
          ...ph,
          id: `perimeter_house_${i}`,
        },
        this.townhouseCtx,
        quadStreet[quadrantOf(ph.center[0], ph.center[1])]
      );
    });

    // 4 Cylindrical Haussmann Corner Rotunda Towers & Copper Cupolas (`(±152.5, ±152.5)`, `top y = 144 SU`)
    for (const [ci, cx, cz, qKey] of [
      [0, -152.5, 152.5, 'nw'],
      [1, 152.5, 152.5, 'ne'],
      [2, -152.5, -152.5, 'sw'],
      [3, 152.5, -152.5, 'se'],
    ] as const) {
      quadStreet[qKey].push(
        transformGeo(rcyl(7.8, 8.2, 114.0, PALETTE.wallLimestone, 18), { pos: [cx, 57.0, cz] }),
        transformGeo(rcyl(8.4, 8.4, 1.5, PALETTE.wallCreamTrim, 18), { pos: [cx, 114.6, cz] }),
        transformGeo(
          lathe(
            [
              [8.1, 0],
              [7.2, 6.2],
              [4.6, 12.8],
              [1.8, 17.2],
              [0.01, 18.6],
            ],
            PALETTE.roofCopperPatina,
            18
          ),
          { pos: [cx, 115.2, cz] }
        ),
        transformGeo(rcyl(1.6, 1.8, 5.2, PALETTE.wallCreamTrim, 12), { pos: [cx, 136.0, cz] }),
        transformGeo(rcyl(0.25, 1.95, 2.8, PALETTE.roofCopperPatina, 12), { pos: [cx, 140.0, cz] }),
        transformGeo(rcyl(0.18, 0.35, 3.6, PALETTE.goldGlow, 8), { pos: [cx, 143.0, cz] })
      );
      const rotundaCol = this.physics.addStaticCylinder(new THREE.Vector3(cx, 86.0, cz), 8.2, 8.4, 172.0, 12);
      this.physics.setBumpMetadata(rotundaCol, { surface: 'stone', causesDizzy: true });
      this.perches.addStaticSegment(
        `corner_cupola_ring_${ci}`,
        new THREE.Vector3(cx - 5.4, 115.5, cz),
        new THREE.Vector3(cx + 5.4, 115.5, cz),
        0.12,
        'stone'
      );
    }

    // 4 Beaux-Arts Boulevard Galleria & Tramway Carbarn Facade Portals (`(0, ±151.6)` & `(±151.6, 0)`)
    const portalTermini: Array<[number, number, number, QuadrantKey, boolean]> = [
      [0, 151.6, 0, 'nw', false],
      [0, -151.6, Math.PI, 'se', false],
      [-151.6, 0, Math.PI * 0.5, 'sw', true],
      [151.6, 0, -Math.PI * 0.5, 'ne', true],
    ];
    portalTermini.forEach(([px, pz, rotY, qKey, isTramDepot], pIdx) => {
      const alongZ = Math.abs(px) > 10;
      const inwardSign = alongZ ? -Math.sign(px) : -Math.sign(pz);
      const marqueeX = alongZ ? px + inwardSign * 2.8 : px;
      const marqueeZ = alongZ ? pz : pz + inwardSign * 2.8;
      quadStreet[qKey].push(
        // Twin rusticated stone portal pilasters + grand arched iron-and-glass carbarn/galleria bays
        transformGeo(rbox(26.0, 26.5, 2.6, 0.18, PALETTE.wallCreamTrim, 1), {
          rot: [0, rotY, 0],
          pos: [px, 13.4, pz],
        }),
        transformGeo(rbox(9.6, 22.0, 2.9, 0.12, PALETTE.ironworkPlum, 1), {
          rot: [0, rotY, 0],
          pos: [alongZ ? px : px - 5.8, 11.2, alongZ ? pz - 5.8 : pz],
        }),
        transformGeo(rbox(9.6, 22.0, 2.9, 0.12, PALETTE.ironworkPlum, 1), {
          rot: [0, rotY, 0],
          pos: [alongZ ? px : px + 5.8, 11.2, alongZ ? pz + 5.8 : pz],
        }),
        transformGeo(rbox(8.2, 19.6, 3.1, 0.08, isTramDepot ? PALETTE.windowWarmLit : PALETTE.windowGlass, 1), {
          rot: [0, rotY, 0],
          pos: [alongZ ? px : px - 5.8, 11.4, alongZ ? pz - 5.8 : pz],
        }),
        transformGeo(rbox(8.2, 19.6, 3.1, 0.08, isTramDepot ? PALETTE.windowWarmLit : PALETTE.windowGlass, 1), {
          rot: [0, rotY, 0],
          pos: [alongZ ? px : px + 5.8, 11.4, alongZ ? pz + 5.8 : pz],
        }),
        // Overhanging wrought-iron & copper glass marquee canopy (`y = 23.2`) + gilded station medallion
        transformGeo(
          rbox(alongZ ? 6.2 : 28.4, 0.85, alongZ ? 28.4 : 6.2, 0.14, PALETTE.roofCopperPatina, 1),
          { pos: [marqueeX, 23.2, marqueeZ] }
        ),
        transformGeo(rcyl(2.8, 2.8, 0.9, PALETTE.goldGlow, 18), {
          rot: [alongZ ? 0 : Math.PI * 0.5, 0, alongZ ? Math.PI * 0.5 : 0],
          pos: [alongZ ? px + inwardSign * 1.45 : px, 29.8, alongZ ? pz : pz + inwardSign * 1.45],
        }),
        transformGeo(rcyl(2.2, 2.2, 1.05, PALETTE.porcelainWhite, 18), {
          rot: [alongZ ? 0 : Math.PI * 0.5, 0, alongZ ? Math.PI * 0.5 : 0],
          pos: [alongZ ? px + inwardSign * 1.48 : px, 29.8, alongZ ? pz : pz + inwardSign * 1.48],
        })
      );
      this.physics.addStaticBox(
        new THREE.Vector3(marqueeX, 23.2, marqueeZ),
        new THREE.Vector3(alongZ ? 3.1 : 14.2, 0.45, alongZ ? 14.2 : 3.1)
      );
      this.perches.addStaticSegment(
        `boulevard_galleria_marquee_${pIdx}`,
        new THREE.Vector3(
          alongZ ? marqueeX + inwardSign * 2.9 : marqueeX - 13.2,
          23.68,
          alongZ ? marqueeZ - 13.2 : marqueeZ + inwardSign * 2.9
        ),
        new THREE.Vector3(
          alongZ ? marqueeX + inwardSign * 2.9 : marqueeX + 13.2,
          23.68,
          alongZ ? marqueeZ + 13.2 : marqueeZ + inwardSign * 2.9
        ),
        0.1,
        'metal'
      );
    });

    if (onProgress) await onProgress(92);

    // 6-Story Venetian Canal Western Watergate Palazzo (`x: -166..-146, z: -72..-36`, `top y = 128 SU`) + Portcullis Grille
    quadStreet.sw.push(
      transformGeo(rbox(20, 28, 8.5, 0.22, PALETTE.wallLimestone, 1), {
        pos: [-156, 13.5, -39.5],
      }),
      transformGeo(rbox(20, 28, 8.5, 0.22, PALETTE.wallLimestone, 1), {
        pos: [-156, 13.5, -68.5],
      }),
      // Ornate wrought-iron Venetian watergate portcullis crossbeams above the water
      transformGeo(rbox(0.55, 0.65, 24.0, 0.08, PALETTE.ironworkPlum, 1), {
        pos: [-146.6, 6.2, -54.0],
      }),
      transformGeo(rbox(0.55, 0.65, 24.0, 0.08, PALETTE.ironworkPlum, 1), {
        pos: [-146.6, 16.5, -54.0],
      }),
      transformGeo(rbox(19.6, 86.0, 36.4, 0.28, PALETTE.wallOchre, 1), { pos: [-156, 67.0, -54.0] }),
      transformGeo(rbox(21.0, 1.5, 37.8, 0.18, PALETTE.wallCreamTrim, 1), {
        pos: [-156, 110.6, -54.0],
      }),
      transformGeo(buildPitchedHipRoofGeo(21.4, 38.2, 13.5, 0.35, PALETTE.roofTerracotta), {
        pos: [-156, 118.0, -54.0],
      })
    );
    for (let barZ = -63.5; barZ <= -44.5; barZ += 3.8) {
      quadStreet.sw.push(
        transformGeo(rcyl(0.18, 0.18, 26.5, PALETTE.ironworkPlum, 8), {
          pos: [-146.6, 11.2, barZ],
        })
      );
    }
    for (const wy of [34.0, 52.0, 70.0, 88.0, 102.0]) {
      for (const wz of [-63, -54, -45]) {
        quadStreet.sw.push(
          transformGeo(rbox(0.5, 9.2, 4.4, 0.1, PALETTE.wallCreamTrim, 1), {
            pos: [-146.1, wy, wz],
          }),
          transformGeo(rbox(0.6, 8.0, 3.4, 0.08, PALETTE.windowWarmLit, 1), {
            pos: [-146.0, wy, wz],
          })
        );
      }
    }
    const wgSolidBody = this.physics.addStaticBox(
      new THREE.Vector3(-156, 85.0, -54.0),
      new THREE.Vector3(10.0, 87.0, 18.2)
    );
    this.physics.setBumpMetadata(wgSolidBody, { surface: 'stone', causesDizzy: true });
    this.perches.addStaticSegment(
      'watergate_cornice_eave',
      new THREE.Vector3(-145.4, 111.38, -72.2),
      new THREE.Vector3(-145.4, 111.38, -35.8),
      0.08,
      'stone'
    );

    // 18 Rolling Sunlit European Parkland Hills & Tapered Cypress Groves (`r = 248..304 SU`) -> `horizonHillsMesh` (`castShadow = false`)
    for (let h = 0; h < 18; h++) {
      const ha = (h / 18) * Math.PI * 2 + 0.17;
      const hx = Math.cos(ha) * (248 + (h % 3) * 28);
      const hz = Math.sin(ha) * (248 + (h % 3) * 28);
      const hillR = 38 + (h % 4) * 11;
      const hillH = 18 + (h % 3) * 8;
      const hillHex = h % 2 === 0 ? PALETTE.grassMeadow : PALETTE.leafSage;

      this.horizonParts.push(
        transformGeo(
          smoothSphere(1.0, hillHex, 18, 12, [hillR, hillH, hillR * 0.88], {
            bottomAO: 0.14,
            topLift: 0.08,
          }),
          {
            rot: [0, -ha, 0],
            pos: [hx, hillH * 0.32 - 3.0, hz],
          }
        )
      );

      for (const cOff of [-8.5, 7.5]) {
        const tx = hx + Math.sin(ha) * cOff;
        const tz = hz - Math.cos(ha) * cOff;
        const baseHillTop = hillH * 0.82 - 2.0;
        const treeCol = h % 3 === 0 ? PALETTE.ginkgoGold : PALETTE.leafDeep;
        this.horizonParts.push(
          transformGeo(rcyl(0.5, 0.75, 4.5, PALETTE.trunkBark, 8), {
            pos: [tx, baseHillTop + 1.8, tz],
          })
        );
        horizonFoliageParts.push(
          transformGeo(
            lathe(
              [
                [0.01, 0],
                [2.4, 2.2],
                [3.1, 6.5],
                [2.3, 12.8],
                [1.1, 17.5],
                [0.01, 20.4],
              ],
              treeCol,
              12,
              Math.PI * 2,
              { bottomAO: 0.18, topLift: 0.1 }
            ),
            { pos: [tx, baseHillTop + 3.2, tz] }
          )
        );
      }
    }

    const horizonHillsMesh = new THREE.Mesh(mergeParts(this.horizonParts), this.mat);
    horizonHillsMesh.castShadow = false;
    horizonHillsMesh.receiveShadow = true;
    horizonHillsMesh.geometry.computeBoundingSphere();
    this.root.add(horizonHillsMesh);

    if (horizonFoliageParts.length > 0) {
      const horizonCypressMesh = new THREE.Mesh(mergeParts(horizonFoliageParts), this.foliageMat);
      horizonCypressMesh.castShadow = false;
      horizonCypressMesh.receiveShadow = true;
      horizonCypressMesh.geometry.computeBoundingSphere();
      this.root.add(horizonCypressMesh);
    }

    // --- Enrich Outer Side Promenades Across NW, NE, SW & SE (`|x|, |z| = 96..146 SU`) ---
    const addOuterBench = (id: string, bx: number, bz: number, rotY: number): void => {
      const qKey = quadrantOf(bx, bz);
      const cR = Math.cos(rotY);
      const sR = Math.sin(rotY);
      quadStreet[qKey].push(
        transformGeo(rbox(5.6, 0.36, 1.85, 0.1, PALETTE.woodOak, 1), {
          rot: [0, rotY, 0],
          pos: [bx, 1.95, bz],
        }),
        transformGeo(rbox(5.6, 1.75, 0.3, 0.08, PALETTE.woodOak, 1), {
          rot: [-0.14, rotY, 0],
          pos: [bx - sR * 0.82, 2.95, bz - cR * 0.82],
        }),
        transformGeo(rbox(0.32, 1.85, 1.85, 0.06, PALETTE.ironworkPlum, 1), {
          rot: [0, rotY, 0],
          pos: [bx - cR * 2.35, 1.18, bz + sR * 2.35],
        }),
        transformGeo(rbox(0.32, 1.85, 1.85, 0.06, PALETTE.ironworkPlum, 1), {
          rot: [0, rotY, 0],
          pos: [bx + cR * 2.35, 1.18, bz - sR * 2.35],
        })
      );
      this.physics.addStaticBox(
        new THREE.Vector3(bx, 1.85, bz),
        new THREE.Vector3(2.85, 1.55, 1.05),
        new THREE.Euler(0, rotY, 0)
      );
      this.perches.addStaticSegment(
        `outer_bench_${id}`,
        new THREE.Vector3(bx - cR * 2.6 - sR * 0.9, 3.84, bz + sR * 2.6 - cR * 0.9),
        new THREE.Vector3(bx + cR * 2.6 - sR * 0.9, 3.84, bz - sR * 2.6 - cR * 0.9),
        0.08,
        'wood'
      );
    };

    const addFestiveGarland = (
      id: string,
      p0: [number, number, number],
      p1: [number, number, number],
      sag: number
    ): void => {
      const qKey = quadrantOf((p0[0] + p1[0]) * 0.5, (p0[2] + p1[2]) * 0.5);
      const pts: Array<[number, number, number]> = [];
      const colors = [PALETTE.awningCoral, PALETTE.awningGold, PALETTE.awningMint, PALETTE.awningCobalt];
      for (let s = 0; s <= 10; s++) {
        const u = s / 10;
        const gx = p0[0] + (p1[0] - p0[0]) * u;
        const gz = p0[2] + (p1[2] - p0[2]) * u;
        const gy = p0[1] + (p1[1] - p0[1]) * u - Math.sin(u * Math.PI) * sag;
        pts.push([gx, gy, gz]);
        if (s > 0 && s < 10) {
          quadStreet[qKey].push(
            transformGeo(rcyl(0.06, 0.42, 0.85, colors[s % 4], 4), {
              rot: [Math.PI, 0, 0],
              pos: [gx, gy - 0.45, gz],
            })
          );
        }
      }
      quadStreet[qKey].push(tube(pts, 0.055, PALETTE.ironworkPlum, 16, 6));
      this.perches.addStaticSegment(
        `outer_garland_${id}`,
        new THREE.Vector3(pts[2][0], pts[2][1] + 0.06, pts[2][2]),
        new THREE.Vector3(pts[8][0], pts[8][1] + 0.06, pts[8][2]),
        0.06,
        'wood'
      );
    };

    // 1. NW Outer West & North Bouquiniste Stalls, Flower Kiosk, Wallace Fountain & Sidewalk Bistro
    for (const [bi, bx, bz, rotY] of [
      [0, -140.5, 98.0, Math.PI * 0.5],
      [1, -114.0, 141.5, 0],
    ] as const) {
      const cR = Math.cos(rotY);
      const sR = Math.sin(rotY);
      quadStreet.nw.push(
        transformGeo(rbox(7.8, 3.4, 2.8, 0.14, PALETTE.parisGreen, 1), {
          rot: [0, rotY, 0],
          pos: [bx, 1.98, bz],
        }),
        transformGeo(rbox(8.1, 0.28, 3.0, 0.08, PALETTE.woodOak, 1), {
          rot: [0, rotY, 0],
          pos: [bx, 3.78, bz],
        }),
        transformGeo(rbox(7.9, 2.6, 0.24, 0.08, PALETTE.parisGreen, 1), {
          rot: [-0.42, rotY, 0],
          pos: [bx - sR * 1.15, 4.95, bz - cR * 1.15],
        }),
        transformGeo(rbox(1.9, 1.6, 0.16, 0.04, PALETTE.awningCoral, 1), {
          rot: [-0.42, rotY, 0],
          pos: [bx - cR * 2.1 - sR * 0.98, 4.95, bz + sR * 2.1 - cR * 0.98],
        }),
        transformGeo(rbox(1.9, 1.6, 0.16, 0.04, PALETTE.awningGold, 1), {
          rot: [-0.42, rotY, 0],
          pos: [bx - sR * 0.98, 4.95, bz - cR * 0.98],
        }),
        transformGeo(rbox(1.9, 1.6, 0.16, 0.04, PALETTE.skyMidDawn, 1), {
          rot: [-0.42, rotY, 0],
          pos: [bx + cR * 2.1 - sR * 0.98, 4.95, bz - sR * 2.1 - cR * 0.98],
        })
      );
      this.physics.addStaticBox(
        new THREE.Vector3(bx, 2.1, bz),
        new THREE.Vector3(4.05, 1.85, 1.55),
        new THREE.Euler(0, rotY, 0)
      );
      this.perches.addStaticSegment(
        `nw_bouquiniste_lid_${bi}`,
        new THREE.Vector3(bx - cR * 3.6 - sR * 1.65, 6.18, bz + sR * 3.6 - cR * 1.65),
        new THREE.Vector3(bx + cR * 3.6 - sR * 1.65, 6.18, bz - sR * 3.6 - cR * 1.65),
        0.07,
        'wood'
      );
    }

    // NW Flower & Pastry Kiosk (`(-122, 0.28, 114)`) with Bouncy Striped Awning + Wallace Fountain (`(-104, 0.28, 95)`)
    quadStreet.nw.push(
      transformGeo(rbox(8.8, 3.8, 4.6, 0.16, PALETTE.woodOak, 1), { pos: [-122.0, 2.18, 114.0] }),
      transformGeo(rbox(9.2, 0.36, 5.0, 0.1, PALETTE.porcelainWhite, 1), { pos: [-122.0, 4.24, 114.0] }),
      transformGeo(rcyl(0.14, 0.14, 4.6, PALETTE.ironworkPlum, 8), { pos: [-126.1, 6.5, 112.0] }),
      transformGeo(rcyl(0.14, 0.14, 4.6, PALETTE.ironworkPlum, 8), { pos: [-117.9, 6.5, 112.0] }),
      transformGeo(rcyl(0.14, 0.14, 4.6, PALETTE.ironworkPlum, 8), { pos: [-126.1, 6.5, 116.0] }),
      transformGeo(rcyl(0.14, 0.14, 4.6, PALETTE.ironworkPlum, 8), { pos: [-117.9, 6.5, 116.0] }),
      // Cast-iron Wallace drinking fountain (`(-104, 0.28, 95)`)
      transformGeo(rcyl(1.45, 1.75, 2.8, PALETTE.parisGreen, 14), { pos: [-104.0, 1.68, 95.0] }),
      transformGeo(rcyl(1.15, 1.15, 2.4, PALETTE.ironworkPlum, 12), { pos: [-104.0, 4.2, 95.0] }),
      transformGeo(smoothSphere(1.38, PALETTE.parisGreen, 14, 10, [1.0, 0.9, 1.0]), {
        pos: [-104.0, 5.75, 95.0],
      }),
      transformGeo(rcyl(0.14, 0.28, 1.1, PALETTE.goldGlow, 8), { pos: [-104.0, 7.2, 95.0] }),
      // Baker's wooden barrel handcart (`(-139, 0.28, 126)`)
      transformGeo(rbox(4.4, 0.45, 6.2, 0.1, PALETTE.woodOak, 1), { pos: [-139.0, 1.85, 126.0] }),
      transformGeo(rcyl(1.35, 1.35, 0.28, PALETTE.woodWalnut, 16), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-141.35, 1.63, 126.0],
      }),
      transformGeo(rcyl(1.35, 1.35, 0.28, PALETTE.woodWalnut, 16), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-136.65, 1.63, 126.0],
      }),
      transformGeo(rcyl(1.05, 0.95, 2.4, PALETTE.woodBirch, 14), { pos: [-139.0, 3.25, 124.7] }),
      transformGeo(rcyl(1.05, 0.95, 2.4, PALETTE.woodOak, 14), { pos: [-139.0, 3.25, 127.3] })
    );
    quadFoliage.nw.push(
      transformGeo(smoothSphere(1.1, PALETTE.tulipCoral, 10, 8), { pos: [-124.8, 5.1, 113.8] }),
      transformGeo(smoothSphere(1.05, PALETTE.tulipYellow, 10, 8), { pos: [-119.2, 5.05, 114.2] })
    );
    this.physics.addStaticBox(new THREE.Vector3(-122.0, 2.35, 114.0), new THREE.Vector3(4.6, 2.08, 2.5));
    this.physics.addStaticCylinder(new THREE.Vector3(-104.0, 3.6, 95.0), 1.45, 1.75, 6.8, 10);
    this.physics.addStaticBox(new THREE.Vector3(-139.0, 2.55, 126.0), new THREE.Vector3(2.4, 1.9, 3.1));
    this.createBouncyAwning(
      'nw_outer_flower_kiosk_awning',
      new THREE.Vector3(-122.0, 8.95, 114.0),
      new THREE.Vector3(5.2, 0.42, 3.2),
      PALETTE.awningCoral,
      PALETTE.awningCream,
      17.5
    );
    this.propFactory.spawnCroissant(new THREE.Vector3(-121.4, 4.78, 113.2));
    this.propFactory.spawnSeed(new THREE.Vector3(-122.8, 4.58, 113.5));
    this.propFactory.spawnCoin(new THREE.Vector3(-104.0, 7.9, 95.0));

    for (const [ti, tx, tz] of [
      [0, -140.5, 48.0],
      [1, -140.5, 68.0],
      [2, -64.0, 141.0],
    ] as const) {
      quadStreet.nw.push(
        transformGeo(rcyl(1.15, 1.4, 0.28, PALETTE.ironworkPlum, 14), { pos: [tx, 0.42, tz] }),
        transformGeo(rcyl(0.22, 0.28, 4.2, PALETTE.ironworkPlum, 10), { pos: [tx, 2.55, tz] }),
        transformGeo(rcyl(2.6, 2.5, 0.32, PALETTE.porcelainWhite, 20), { pos: [tx, 4.72, tz] })
      );
      this.physics.addStaticCylinder(new THREE.Vector3(tx, 2.58, tz), 2.6, 1.35, 4.6, 10);
      if (ti === 1) {
        this.createBouncyUmbrella(
          'nw_outer_cafe_umbrella',
          new THREE.Vector3(tx, 0.28, tz),
          10.6,
          4.8,
          PALETTE.awningCobalt,
          17.5
        );
      }
      this.propFactory
        .spawnBreakableCeramicMug(
          new THREE.Vector3(tx + 0.6, 5.22, tz - 0.4),
          PALETTE.porcelainWhite,
          PALETTE.coffeeDark,
          PALETTE.awningCoral
        )
        .body.sleep();
    }
    addOuterBench('nw_w', -142.0, 112.0, Math.PI * 0.5);
    addOuterBench('nw_n', -82.0, 142.5, 0);
    addFestiveGarland('nw_promenade', [-132.0, 15.2, 86.0], [-92.0, 15.2, 99.5], 1.8);

    // 2. NE Outer Botanical Rose Pergola Arches, Stone Sundial Dovecote & Orangerie Cold-Frames
    for (const [pi, px, pz, rotY] of [
      [0, 42.0, 136.0, 0],
      [1, 137.0, 92.0, Math.PI * 0.5],
    ] as const) {
      const cR = Math.cos(rotY);
      const sR = Math.sin(rotY);
      for (const side of [-4.6, 4.6]) {
        const postX = px + cR * side;
        const postZ = pz - sR * side;
        quadStreet.ne.push(
          transformGeo(rbox(0.85, 9.6, 2.8, 0.1, PALETTE.ironworkPlum, 1), {
            rot: [0, rotY, 0],
            pos: [postX, 5.08, postZ],
          })
        );
        quadFoliage.ne.push(
          transformGeo(rbox(1.9, 6.8, 3.4, 0.48, PALETTE.leafSage, 2), {
            rot: [0, rotY, 0],
            pos: [postX, 5.2, postZ],
          }),
          transformGeo(smoothSphere(0.65, PALETTE.sakuraPink, 8, 6), {
            pos: [postX + 0.4, 6.8, postZ + 0.3],
          })
        );
        this.physics.addStaticBox(
          new THREE.Vector3(postX, 5.08, postZ),
          new THREE.Vector3(0.55, 4.8, 1.45),
          new THREE.Euler(0, rotY, 0)
        );
      }
      quadStreet.ne.push(
        transformGeo(rbox(11.4, 0.55, 3.4, 0.1, PALETTE.ironworkPlum, 1), {
          rot: [0, rotY, 0],
          pos: [px, 10.1, pz],
        })
      );
      quadFoliage.ne.push(
        transformGeo(rbox(10.8, 1.45, 3.8, 0.48, PALETTE.leafSage, 2), {
          rot: [0, rotY, 0],
          pos: [px, 10.75, pz],
        }),
        transformGeo(smoothSphere(0.75, PALETTE.tulipCoral, 8, 6), { pos: [px, 11.45, pz] })
      );
      this.physics.addStaticBox(
        new THREE.Vector3(px, 10.35, pz),
        new THREE.Vector3(5.7, 0.55, 1.7),
        new THREE.Euler(0, rotY, 0)
      );
      this.perches.addStaticSegment(
        `ne_rose_pergola_${pi}`,
        new THREE.Vector3(px - cR * 5.2, 10.95, pz + sR * 5.2),
        new THREE.Vector3(px + cR * 5.2, 10.95, pz - sR * 5.2),
        0.1,
        'metal'
      );
    }

    // Botanical Stone Sundial & Wooden Dovecote Pillar (`(137.5, 0.28, 54.0)`) + Orangerie Citrus Tubs (`(124, 136)` & `(56, 136)`)
    quadStreet.ne.push(
      transformGeo(rcyl(2.1, 2.4, 0.65, PALETTE.wallLimestone, 8), { pos: [137.5, 0.6, 54.0] }),
      transformGeo(rcyl(0.95, 1.2, 5.4, PALETTE.wallCreamTrim, 8), { pos: [137.5, 3.6, 54.0] }),
      transformGeo(rcyl(1.65, 1.35, 0.42, PALETTE.brassWarm, 16), { pos: [137.5, 6.45, 54.0] }),
      transformGeo(rcyl(0.28, 0.32, 2.6, PALETTE.woodOak, 8), { pos: [137.5, 7.9, 54.0] }),
      transformGeo(rbox(2.4, 2.2, 2.4, 0.14, PALETTE.porcelainWhite, 1), { pos: [137.5, 9.9, 54.0] }),
      transformGeo(buildPitchedHipRoofGeo(2.9, 2.9, 1.5, 0.25, PALETTE.roofCopperPatina), {
        pos: [137.5, 11.55, 54.0],
      }),
      // Orangerie wooden potting bench (`(138.5, 0.28, 128.0)`)
      transformGeo(rbox(3.4, 3.2, 7.2, 0.14, PALETTE.woodOak, 1), { pos: [138.5, 1.88, 128.0] }),
      transformGeo(rbox(3.7, 0.3, 7.6, 0.08, PALETTE.woodWalnut, 1), { pos: [138.5, 3.58, 128.0] })
    );
    this.physics.addStaticCylinder(new THREE.Vector3(137.5, 5.8, 54.0), 1.65, 2.2, 11.2, 8);
    this.physics.addStaticBox(new THREE.Vector3(138.5, 2.0, 128.0), new THREE.Vector3(1.85, 1.75, 3.8));
    this.perches.addStaticSegment(
      'ne_dovecote_perch',
      new THREE.Vector3(136.0, 9.15, 54.0),
      new THREE.Vector3(139.0, 9.15, 54.0),
      0.08,
      'wood'
    );
    this.propFactory.spawnSeed(new THREE.Vector3(136.3, 9.25, 54.0));
    this.propFactory
      .spawnBreakableTerracottaPot(new THREE.Vector3(138.4, 4.18, 126.4), PALETTE.tulipCoral)
      .body.sleep();
    this.propFactory
      .spawnBreakableTerracottaPot(new THREE.Vector3(138.5, 4.18, 129.6), PALETTE.tulipYellow)
      .body.sleep();

    for (const [cx, cz] of [
      [123.0, 136.0],
      [56.0, 136.0],
    ] as const) {
      quadStreet.ne.push(
        transformGeo(rbox(3.2, 2.8, 3.2, 0.14, PALETTE.porcelainWhite, 1), { pos: [cx, 1.68, cz] }),
        transformGeo(rcyl(0.32, 0.42, 4.2, PALETTE.trunkBark, 8), { pos: [cx, 4.8, cz] })
      );
      quadFoliage.ne.push(
        transformGeo(smoothSphere(2.45, PALETTE.leafDeep, 14, 10), { pos: [cx, 7.6, cz] }),
        transformGeo(smoothSphere(0.38, PALETTE.awningGold, 8, 6), { pos: [cx + 1.4, 7.9, cz + 1.1] }),
        transformGeo(smoothSphere(0.38, PALETTE.awningGold, 8, 6), { pos: [cx - 1.3, 7.3, cz - 1.2] })
      );
      this.physics.addStaticBox(new THREE.Vector3(cx, 1.7, cz), new THREE.Vector3(1.65, 1.45, 1.65));
    }
    addOuterBench('ne_e1', 141.0, 38.0, -Math.PI * 0.5);
    addOuterBench('ne_e2', 141.0, 74.0, -Math.PI * 0.5);
    addOuterBench('ne_n1', 28.0, 142.0, 0);

    // 3. SW Outer Venetian Courtyard Wellhead (`Vera da Pozzo`), Artisan Stalls & Wine-Barrel Quay Cart
    quadStreet.sw.push(
      // Octagonal Istrian Stone Venetian Wellhead (`(-126.0, 0.28, -132.0)`) + Wrought-Iron Bucket Arch
      transformGeo(rcyl(3.8, 4.1, 0.55, PALETTE.wallCreamTrim, 8), { pos: [-126.0, 0.55, -132.0] }),
      transformGeo(rcyl(2.65, 2.9, 3.1, PALETTE.wallLimestone, 8), { pos: [-126.0, 2.35, -132.0] }),
      transformGeo(rcyl(2.95, 2.8, 0.45, PALETTE.porcelainWhite, 8), { pos: [-126.0, 4.05, -132.0] }),
      transformGeo(rcyl(2.05, 2.05, 0.25, PALETTE.ironworkPlum, 8), { pos: [-126.0, 4.18, -132.0] }),
      tube(
        [
          [-128.4, 4.2, -132.0],
          [-128.1, 7.1, -132.0],
          [-126.0, 8.25, -132.0],
          [-123.9, 7.1, -132.0],
          [-123.6, 4.2, -132.0],
        ],
        0.11,
        PALETTE.ironworkPlum,
        14,
        8
      ),
      transformGeo(rcyl(0.52, 0.42, 0.95, PALETTE.woodOak, 10), { pos: [-126.0, 6.35, -132.0] }),
      // Quayside Vintner's Wine-Barrel Cart (`(-126.0, 0.28, -28.0)`) & Cast-Iron Mooring Bollards
      transformGeo(rbox(6.4, 0.48, 4.2, 0.1, PALETTE.woodWalnut, 1), { pos: [-126.0, 1.85, -28.0] }),
      transformGeo(rcyl(1.35, 1.35, 0.28, PALETTE.woodOak, 16), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-126.0, 1.63, -30.25],
      }),
      transformGeo(rcyl(1.35, 1.35, 0.28, PALETTE.woodOak, 16), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [-126.0, 1.63, -25.75],
      }),
      transformGeo(rcyl(1.1, 1.1, 2.8, PALETTE.woodBirch, 14), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-127.4, 3.15, -28.0],
      }),
      transformGeo(rcyl(1.1, 1.1, 2.8, PALETTE.woodOak, 14), {
        rot: [0, 0, Math.PI * 0.5],
        pos: [-124.5, 3.15, -28.0],
      }),
      transformGeo(rcyl(0.55, 0.72, 1.9, PALETTE.ironworkPlum, 10), { pos: [-134.0, 1.2, -37.8] }),
      transformGeo(rcyl(0.55, 0.72, 1.9, PALETTE.ironworkPlum, 10), { pos: [-116.0, 1.2, -37.8] })
    );
    this.physics.addStaticCylinder(new THREE.Vector3(-126.0, 2.35, -132.0), 2.95, 3.8, 4.1, 8);
    this.physics.addStaticBox(new THREE.Vector3(-126.0, 2.65, -28.0), new THREE.Vector3(3.3, 1.9, 2.3));
    this.perches.addStaticSegment(
      'sw_venetian_well_arch',
      new THREE.Vector3(-127.4, 7.95, -132.0),
      new THREE.Vector3(-124.6, 7.95, -132.0),
      0.09,
      'metal'
    );
    this.propFactory.spawnCoin(new THREE.Vector3(-126.0, 4.48, -130.0));

    for (const [si, sx, sz, stripeA] of [
      [0, -94.0, -135.5, PALETTE.awningCoral],
      [1, -52.0, -135.5, PALETTE.awningMint],
    ] as const) {
      quadStreet.sw.push(
        transformGeo(rbox(9.2, 3.6, 4.4, 0.14, PALETTE.woodOak, 1), { pos: [sx, 2.08, sz] }),
        transformGeo(rbox(9.6, 0.34, 4.8, 0.1, PALETTE.wallCreamTrim, 1), { pos: [sx, 4.02, sz] }),
        transformGeo(rcyl(0.13, 0.13, 4.5, PALETTE.woodWalnut, 8), { pos: [sx - 4.3, 6.3, sz - 1.9] }),
        transformGeo(rcyl(0.13, 0.13, 4.5, PALETTE.woodWalnut, 8), { pos: [sx + 4.3, 6.3, sz - 1.9] }),
        transformGeo(rcyl(0.13, 0.13, 4.5, PALETTE.woodWalnut, 8), { pos: [sx - 4.3, 6.3, sz + 1.9] }),
        transformGeo(rcyl(0.13, 0.13, 4.5, PALETTE.woodWalnut, 8), { pos: [sx + 4.3, 6.3, sz + 1.9] })
      );
      this.physics.addStaticBox(new THREE.Vector3(sx, 2.25, sz), new THREE.Vector3(4.8, 2.0, 2.4));
      this.createBouncyAwning(
        `sw_outer_artisan_stall_${si}`,
        new THREE.Vector3(sx, 8.75, sz),
        new THREE.Vector3(5.3, 0.42, 3.0),
        stripeA,
        PALETTE.awningCream,
        17.5
      );
      this.propFactory
        .spawnBreakableCeramicVase(
          new THREE.Vector3(sx - 1.8, 4.72, sz),
          PALETTE.awningCobalt,
          PALETTE.tulipCoral
        )
        .body.sleep();
      this.propFactory
        .spawnBreakableTerracottaPot(new THREE.Vector3(sx + 1.9, 4.66, sz), PALETTE.tulipYellow)
        .body.sleep();
      this.propFactory.spawnSeed(new THREE.Vector3(sx, 4.35, sz + 0.9));
    }
    addOuterBench('sw_w1', -142.0, -96.0, Math.PI * 0.5);
    addOuterBench('sw_s1', -112.0, -142.5, Math.PI);
    addOuterBench('sw_s2', -73.0, -142.5, Math.PI);
    addFestiveGarland('sw_venetian_banners', [-139.0, 15.6, -121.0], [-106.0, 15.6, -121.0], 1.7);

    // 4. SE Outer Antique Book Kiosk, Roastery Barrel Patio, Chestnut Cart & Pocket Courtyard Planter
    quadStreet.se.push(
      // Antique Book & Print Kiosk (`(46.0, 0.28, -128.0)`)
      transformGeo(rbox(8.8, 3.8, 4.6, 0.16, PALETTE.woodWalnut, 1), { pos: [46.0, 2.18, -128.0] }),
      transformGeo(rbox(9.2, 0.34, 5.0, 0.1, PALETTE.woodOak, 1), { pos: [46.0, 4.22, -128.0] }),
      transformGeo(rcyl(0.14, 0.14, 4.5, PALETTE.brassWarm, 8), { pos: [41.9, 6.45, -130.0] }),
      transformGeo(rcyl(0.14, 0.14, 4.5, PALETTE.brassWarm, 8), { pos: [50.1, 6.45, -130.0] }),
      transformGeo(rcyl(0.14, 0.14, 4.5, PALETTE.brassWarm, 8), { pos: [41.9, 6.45, -126.0] }),
      transformGeo(rcyl(0.14, 0.14, 4.5, PALETTE.brassWarm, 8), { pos: [50.1, 6.45, -126.0] }),
      // Roasted Chestnut Copper Brazier Cart (`(88.0, 0.28, -132.0)`)
      transformGeo(rbox(5.6, 3.1, 3.4, 0.14, PALETTE.parisGreen, 1), { pos: [88.0, 2.25, -132.0] }),
      transformGeo(rcyl(1.45, 1.25, 0.85, PALETTE.roofCopperPatina, 16), { pos: [88.0, 4.18, -132.0] }),
      transformGeo(rcyl(0.32, 0.42, 2.8, PALETTE.ironworkPlum, 10), { pos: [89.4, 5.8, -132.0] }),
      transformGeo(rcyl(1.35, 1.35, 0.26, PALETTE.woodOak, 16), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [88.0, 1.62, -133.85],
      }),
      transformGeo(rcyl(1.35, 1.35, 0.26, PALETTE.woodOak, 16), {
        rot: [Math.PI * 0.5, 0, 0],
        pos: [88.0, 1.62, -130.15],
      }),
      // Roastery Side-Lane Coffee-Sack & Oak Barrel Stack (`(138.0, 0.28, -46.0)`)
      transformGeo(rcyl(1.15, 1.05, 2.7, PALETTE.woodOak, 14), { pos: [137.4, 1.63, -44.8] }),
      transformGeo(rcyl(1.15, 1.05, 2.7, PALETTE.woodWalnut, 14), { pos: [139.6, 1.63, -46.4] }),
      transformGeo(rbox(2.3, 1.4, 1.8, 0.42, PALETTE.plazaSand, 2), {
        rot: [0, 0.35, 0],
        pos: [137.8, 3.55, -45.4],
      }),
      // SE Pocket Courtyard Tiered Octagonal Stone Planter Centerpiece (`(126.0, 0.28, -118.0)`)
      transformGeo(rcyl(5.4, 5.8, 1.65, PALETTE.wallLimestone, 8), { pos: [126.0, 1.1, -118.0] }),
      transformGeo(rcyl(5.75, 5.6, 0.36, PALETTE.wallCreamTrim, 8), { pos: [126.0, 2.02, -118.0] }),
      transformGeo(rcyl(2.6, 2.9, 2.1, PALETTE.plazaWarmStone, 8), {
        pos: [126.0, 3.15, -118.0],
      }),
      transformGeo(rcyl(1.15, 0.65, 1.4, PALETTE.brickTerracotta, 12), { pos: [126.0, 4.75, -118.0] })
    );
    quadFoliage.se.push(
      transformGeo(smoothSphere(4.4, PALETTE.leafSage, 14, 10, [1.0, 0.36, 1.0]), {
        pos: [126.0, 2.45, -118.0],
      }),
      transformGeo(smoothSphere(2.2, PALETTE.grassSunlit, 12, 8, [1.0, 0.52, 1.0]), {
        pos: [126.0, 4.35, -118.0],
      }),
      transformGeo(smoothSphere(1.25, PALETTE.tulipCoral, 10, 8), { pos: [126.0, 5.75, -118.0] })
    );
    this.physics.addStaticBox(new THREE.Vector3(46.0, 2.35, -128.0), new THREE.Vector3(4.6, 2.08, 2.5));
    this.physics.addStaticBox(new THREE.Vector3(88.0, 2.55, -132.0), new THREE.Vector3(2.9, 2.25, 1.9));
    this.physics.addStaticBox(new THREE.Vector3(138.5, 2.1, -45.6), new THREE.Vector3(2.3, 1.9, 2.1));
    this.physics.addStaticCylinder(new THREE.Vector3(126.0, 2.4, -118.0), 5.6, 5.8, 4.4, 8);
    this.createBouncyAwning(
      'se_outer_book_kiosk_awning',
      new THREE.Vector3(46.0, 8.9, -128.0),
      new THREE.Vector3(5.2, 0.42, 3.2),
      PALETTE.parisGreen,
      PALETTE.awningGold,
      17.5
    );
    this.perches.addStaticSegment(
      'se_courtyard_planter_rim',
      new THREE.Vector3(121.2, 2.22, -118.0),
      new THREE.Vector3(121.2, 2.22, -114.5),
      0.08,
      'stone'
    );
    this.propFactory
      .spawnStudioBook(new THREE.Vector3(44.2, 4.58, -128.2), PALETTE.awningCobalt)
      .body.sleep();
    this.propFactory
      .spawnStudioBook(new THREE.Vector3(47.6, 4.58, -127.8), PALETTE.berryRuby)
      .body.sleep();
    this.propFactory.spawnCoin(new THREE.Vector3(86.4, 3.98, -132.0));
    this.propFactory.spawnSeed(new THREE.Vector3(126.0, 6.95, -118.0));

    for (const [tx, tz] of [
      [138.5, -62.0],
      [138.5, -76.0],
    ] as const) {
      quadStreet.se.push(
        transformGeo(rcyl(1.15, 1.4, 0.28, PALETTE.ironworkPlum, 14), { pos: [tx, 0.42, tz] }),
        transformGeo(rcyl(0.22, 0.28, 4.2, PALETTE.ironworkPlum, 10), { pos: [tx, 2.55, tz] }),
        transformGeo(rcyl(2.5, 2.4, 0.32, PALETTE.woodOak, 20), { pos: [tx, 4.72, tz] })
      );
      this.physics.addStaticCylinder(new THREE.Vector3(tx, 2.58, tz), 2.5, 1.35, 4.6, 10);
      this.propFactory
        .spawnBreakableCeramicMug(
          new THREE.Vector3(tx - 0.5, 5.22, tz + 0.3),
          PALETTE.porcelainWhite,
          PALETTE.coffeeDark,
          PALETTE.awningGold
        )
        .body.sleep();
    }
    addOuterBench('se_c1', 115.5, -118.0, Math.PI * 0.5);
    addOuterBench('se_c2', 136.5, -118.0, -Math.PI * 0.5);
    addOuterBench('se_s1', 126.0, -131.5, Math.PI);
    addFestiveGarland('se_market_lane', [64.0, 15.0, -122.0], [98.0, 15.0, -122.0], 1.65);

    // Botanical Sculpted Boulevard & Outer-Perimeter Trees bucketed into 4 quadrant trunk & foliage meshes
    const boulevardTrees: Array<[number, number, number]> = [
      [-48, 21.5, PALETTE.leafSage],
      [-86, 21.5, PALETTE.ginkgoGold],
      [-122, 21.5, PALETTE.leafSage],
      [-21.5, 116, PALETTE.sakuraPink],
      [-21.5, -92, PALETTE.leafSage],
      [-21.5, -128, PALETTE.ginkgoGold],
      [-114, -21.5, PALETTE.leafSage],
      [21.5, -34, PALETTE.sakuraBlush],
      [21.5, -88, PALETTE.leafSage],
      [21.5, -124, PALETTE.ginkgoGold],
      [76, -21.5, PALETTE.leafSage],
      [118, -21.5, PALETTE.grassSunlit],
      // Outer-perimeter neighborhood avenue trees across NW, NE, SW & SE
      [-142, 32, PALETTE.leafSage],
      [-142, 84, PALETTE.ginkgoGold],
      [-142, 139, PALETTE.sakuraPink],
      [-98, 142, PALETTE.leafSage],
      [-46, 142, PALETTE.ginkgoGold],
      [142, 28, PALETTE.leafSage],
      [142, 112, PALETTE.sakuraBlush],
      [142, 142, PALETTE.ginkgoGold],
      [118, 143, PALETTE.leafSage],
      [-141, -26, PALETTE.ginkgoGold],
      [-142, -82, PALETTE.leafSage],
      [-142, -140, PALETTE.sakuraBlush],
      [-32, -139, PALETTE.leafSage],
      [142, -28, PALETTE.leafSage],
      [142, -92, PALETTE.ginkgoGold],
      [142, -140, PALETTE.grassSunlit],
      [108, -141, PALETTE.leafSage],
      [68, -141, PALETTE.sakuraBlush],
      [28, -139, PALETTE.ginkgoGold],
    ];
    boulevardTrees.forEach(([btx, btz, bCol], bIdx) => {
      const th = 25.0 + (bIdx % 3) * 2.5;
      const trunkH = th * 0.44;
      const tree = buildOrganicTreeParts(th, bCol, bIdx + 20);
      const qKey = quadrantOf(btx, btz);

      quadStreet[qKey].push(
        transformGeo(rbox(4.6, 0.36, 4.6, 0.1, PALETTE.curbStone, 1), { pos: [btx, 0.42, btz] }),
        transformGeo(rbox(3.8, 0.4, 3.8, 0.08, PALETTE.ironworkPlum, 1), { pos: [btx, 0.44, btz] }),
        transformGeo(tree.woodGeo, { pos: [btx, 0.3, btz] })
      );
      quadFoliage[qKey].push(transformGeo(tree.foliageGeo, { pos: [btx, 0.3, btz] }));

      this.physics.addStaticBox(
        new THREE.Vector3(btx, 0.43, btz),
        new THREE.Vector3(2.3, 0.21, 2.3)
      );
      const tBody = this.physics.addStaticCylinder(
        new THREE.Vector3(btx, trunkH * 0.5 + 0.3, btz),
        0.68,
        0.98,
        trunkH,
        8
      );
      this.physics.setBumpMetadata(tBody, { surface: 'wood', causesDizzy: false });
      this.perches.addStaticSegment(
        `boulevard_tree_crown_${bIdx}`,
        tree.boughPerchA.clone().add(new THREE.Vector3(btx, 0.3, btz)),
        tree.boughPerchB.clone().add(new THREE.Vector3(btx, 0.3, btz)),
        0.09,
        'wood'
      );
    });

    // Terracotta Clipped-Boxwood & Tulip Sidewalk Planters bucketed per quadrant (including outer streets)
    const planterCoords: Array<[number, number, number]> = [
      [-18.8, 28.0, PALETTE.tulipCoral],
      [-18.8, 46.0, PALETTE.tulipYellow],
      [-18.8, 66.0, PALETTE.tulipCoral],
      [-43.0, -88.2, PALETTE.tulipCoral],
      [-68.0, -88.2, PALETTE.tulipYellow],
      [30.0, -20.5, PALETTE.tulipCoral],
      [56.0, -20.5, PALETTE.tulipYellow],
      [-146.5, 58.0, PALETTE.tulipCoral],
      [-146.5, 118.0, PALETTE.tulipYellow],
      [-72.0, 146.5, PALETTE.tulipCoral],
      [146.5, 46.0, PALETTE.tulipYellow],
      [146.5, 104.0, PALETTE.tulipCoral],
      [-146.5, -108.0, PALETTE.tulipYellow],
      [-84.0, -146.5, PALETTE.tulipCoral],
      [146.5, -54.0, PALETTE.tulipCoral],
      [146.5, -104.0, PALETTE.tulipYellow],
      [58.0, -146.5, PALETTE.tulipCoral],
    ];
    for (const [px, pz, flCol] of planterCoords) {
      const qKey = quadrantOf(px, pz);
      quadStreet[qKey].push(
        transformGeo(rbox(2.2, 1.8, 4.4, 0.16, PALETTE.brickTerracotta, 1), {
          pos: [px, 1.18, pz],
        }),
        transformGeo(rbox(2.4, 0.3, 4.6, 0.08, PALETTE.wallCreamTrim, 1), { pos: [px, 2.0, pz] })
      );
      for (const zOff of [-1.25, 0, 1.25]) {
        quadFoliage[qKey].push(
          transformGeo(rbox(1.65, 1.12, 1.32, 0.36, PALETTE.leafSage, 1), {
            pos: [px, 2.62, pz + zOff],
          }),
          transformGeo(rcyl(0.28, 0.14, 0.44, flCol, 6), {
            pos: [px + 0.18, 3.32, pz + zOff],
          })
        );
      }
      const pBody = this.physics.addStaticBox(
        new THREE.Vector3(px, 1.4, pz),
        new THREE.Vector3(1.2, 1.2, 2.3)
      );
      this.physics.setBumpMetadata(pBody, { surface: 'stone', causesDizzy: false });
    }

    // Cast-Iron Parisian Hexagonal Avenue Streetlamps (`18.4 SU` tall) bucketed per quadrant (central + outer avenues)
    const lampCoords: Array<[number, number]> = [
      [-18, 18],
      [18, 18],
      [-18, -18],
      [18, -18],
      [-58, 18],
      [-98, 18],
      [-136, 18],
      [58, 18],
      [98, 18],
      [136, 18],
      [-58, -18],
      [-98, -18],
      [-136, -18],
      [58, -18],
      [98, -18],
      [136, -18],
      [-18, 62],
      [-18, 104],
      [-18, 138],
      [18, 62],
      [18, 104],
      [18, 138],
      [-18, -82],
      [-18, -136],
      [18, -62],
      [18, -104],
      [18, -138],
      [-135, 76],
      [-128, 136],
      [135, 66],
      [135, 120],
      [-135, -118],
      [-64, -138],
      [135, -84],
      [104, -134],
    ];
    lampCoords.forEach(([lx, lz], idx) => {
      const qKey = quadrantOf(lx, lz);
      quadStreet[qKey].push(
        transformGeo(rcyl(0.7, 0.98, 2.4, PALETTE.ironworkPlum, 10), { pos: [lx, 1.4, lz] }),
        transformGeo(rcyl(0.22, 0.38, 14.6, PALETTE.ironworkPlum, 8), { pos: [lx, 9.7, lz] }),
        transformGeo(rbox(2.7, 0.2, 0.2, 0.05, PALETTE.ironworkPlum, 1), { pos: [lx, 15.8, lz] }),
        transformGeo(rcyl(0.82, 0.52, 1.55, PALETTE.windowWarmLit, 6), {
          pos: [lx, 17.65, lz],
        }),
        transformGeo(rcyl(0.14, 0.94, 0.65, PALETTE.roofCopperPatina, 6), {
          pos: [lx, 18.72, lz],
        })
      );
      this.physics.addStaticCylinder(new THREE.Vector3(lx, 8.9, lz), 0.36, 0.8, 17.4, 8);
      this.perches.addStaticSegment(
        `streetlamp_crossbar_w_${idx}`,
        new THREE.Vector3(lx - 1.28, 15.9, lz),
        new THREE.Vector3(lx - 0.38, 15.9, lz),
        0.08,
        'metal'
      );
      this.perches.addStaticSegment(
        `streetlamp_crossbar_e_${idx}`,
        new THREE.Vector3(lx + 0.38, 15.9, lz),
        new THREE.Vector3(lx + 1.28, 15.9, lz),
        0.08,
        'metal'
      );
    });

    // Parisian Morris Poster Columns bucketed per quadrant (central + outer promenades)
    for (const [mi, mx, mz] of [
      [0, -34.0, 84.0],
      [1, 22.0, -48.0],
      [2, -32.0, -74.0],
      [3, -134.0, 24.0],
      [4, 24.0, 128.0],
      [5, 134.0, -24.0],
    ] as const) {
      const qKey = quadrantOf(mx, mz);
      quadStreet[qKey].push(
        transformGeo(rcyl(2.3, 2.45, 1.4, PALETTE.ironworkPlum, 18), { pos: [mx, 0.98, mz] }),
        transformGeo(rcyl(2.05, 2.05, 10.8, PALETTE.awningGold, 20), { pos: [mx, 7.0, mz] }),
        transformGeo(rcyl(2.09, 2.09, 4.2, PALETTE.awningCoral, 20), { pos: [mx, 7.4, mz] }),
        transformGeo(rcyl(2.4, 2.15, 0.8, PALETTE.parisGreen, 20), { pos: [mx, 12.7, mz] }),
        transformGeo(
          lathe(
            [
              [2.4, 0],
              [1.95, 1.35],
              [0.98, 2.5],
              [0.01, 3.1],
            ],
            PALETTE.roofCopperPatina,
            18
          ),
          { pos: [mx, 13.1, mz] }
        ),
        transformGeo(rcyl(0.12, 0.18, 1.5, PALETTE.brassWarm, 8), { pos: [mx, 16.8, mz] })
      );
      const mBody = this.physics.addStaticCylinder(
        new THREE.Vector3(mx, 8.0, mz),
        2.25,
        2.35,
        15.4,
        12
      );
      this.physics.setBumpMetadata(mBody, { surface: 'metal', causesDizzy: true });
      this.perches.addStaticSegment(
        `morris_column_cap_${mi}`,
        new THREE.Vector3(mx - 0.12, 17.55, mz),
        new THREE.Vector3(mx + 0.12, 17.55, mz),
        0.08,
        'metal'
      );
    }

    for (const qKey of ['nw', 'ne', 'sw', 'se'] as const) {
      if (quadStreet[qKey].length > 0) {
        const streetQuadMesh = new THREE.Mesh(mergeParts(quadStreet[qKey]), this.mat);
        streetQuadMesh.castShadow = true;
        streetQuadMesh.receiveShadow = true;
        streetQuadMesh.geometry.computeBoundingSphere();
        this.root.add(streetQuadMesh);
      }
      if (quadFoliage[qKey].length > 0) {
        const foliageQuadMesh = new THREE.Mesh(mergeParts(quadFoliage[qKey]), this.foliageMat);
        foliageQuadMesh.castShadow = true;
        foliageQuadMesh.receiveShadow = true;
        foliageQuadMesh.geometry.computeBoundingSphere();
        this.root.add(foliageQuadMesh);
      }
    }
  }

  private createDistrictLantern(basePos: THREE.Vector3): THREE.Mesh {
    const idx = this.lanternPivots.length;
    const armSign = basePos.x >= 0 ? -1 : 1;
    const armOut = 1.45 * armSign;
    const pedestalGeo = mergeParts([
      transformGeo(rcyl(0.8, 1.05, 1.8, PALETTE.ironworkPlum, 12), { pos: [0, 0.9, 0] }),
      transformGeo(rcyl(0.2, 0.34, 12.1, PALETTE.ironworkPlum, 10), { pos: [0, 7.6, 0] }),
      transformGeo(rcyl(0.08, 0.24, 0.62, PALETTE.brassWarm, 8), { pos: [0, 13.9, 0] }),
      transformGeo(
        tube(
          [
            [0, 12.6, 0],
            [armOut * 0.42, 13.78, 0],
            [armOut * 0.85, 13.86, 0],
            [armOut, 13.45, 0],
          ],
          0.085,
          PALETTE.ironworkPlum,
          10,
          6
        ),
        {}
      ),
      transformGeo(rcyl(0.14, 0.14, 0.16, PALETTE.brassWarm, 8), {
        pos: [armOut, 13.42, 0],
      }),
    ]);
    pedestalGeo.computeBoundingSphere();
    const pedestal = new THREE.Mesh(pedestalGeo, this.mat);
    pedestal.position.copy(basePos);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    this.root.add(pedestal);
    this.physics.addStaticCylinder(
      new THREE.Vector3(basePos.x, basePos.y + 6.9, basePos.z),
      0.28,
      0.85,
      13.6,
      8
    );

    const pivotPos = new THREE.Vector3(basePos.x + armOut, basePos.y + 13.38, basePos.z);
    const pivotGroup = new THREE.Group();
    pivotGroup.position.copy(pivotPos);

    const capGeo = mergeParts([
      transformGeo(rcyl(0.055, 0.055, 0.85, PALETTE.ironworkPlum, 6), { pos: [0, -0.42, 0] }),
      transformGeo(rcyl(0.16, 0.16, 0.16, PALETTE.brassWarm, 8), { pos: [0, -0.82, 0] }),
      transformGeo(rcyl(0.18, 1.08, 0.56, PALETTE.roofCopperPatina, 8), { pos: [0, -1.12, 0] }),
      transformGeo(rcyl(0.28, 0.12, 0.28, PALETTE.ironworkPlum, 8), { pos: [0, -3.12, 0] }),
    ]);
    capGeo.computeBoundingSphere();
    const capMesh = new THREE.Mesh(capGeo, this.mat);
    capMesh.castShadow = true;
    pivotGroup.add(capMesh);

    const globeGeo = rcyl(0.95, 0.62, 1.65, PALETTE.wallLimestone, 8);
    globeGeo.computeBoundingSphere();
    const globe = new THREE.Mesh(globeGeo, this.lanternOffMat);
    globe.position.set(0, -2.18, 0);
    globe.castShadow = true;
    pivotGroup.add(globe);
    this.root.add(pivotGroup);

    const state = {
      group: pivotGroup,
      pivotPos,
      angleX: 0,
      angleZ: 0,
      velX: 0,
      velZ: 0,
      settled: true,
    };
    this.lanternPivots.push(state);

    this.perches.addDynamicSegment({
      id: `district_lantern_cap_${idx}`,
      getApproxCenter: (out) => out.copy(pivotPos).setY(pivotPos.y - 0.85),
      approxHalfSpan: 1.5,
      getEndpoints: (outA, outB) => {
        _lanternEuler.set(state.angleX, 0, state.angleZ, 'XYZ');
        _lanternOffsetA.set(-0.36, -0.82, 0).applyEuler(_lanternEuler).add(pivotPos);
        _lanternOffsetB.set(0.36, -0.82, 0).applyEuler(_lanternEuler).add(pivotPos);
        outA.copy(_lanternOffsetA);
        outB.copy(_lanternOffsetB);
      },
      radius: 0.08,
      surface: 'metal',
      onLand: (_t, speed) => {
        const sign = Math.random() < 0.5 ? 1 : -1;
        state.velZ += sign * Math.min(3.5, 0.95 + speed * 0.28);
        state.velX += (Math.random() - 0.5) * 1.5;
        state.settled = false;
        this.audio.playWirePluck(pivotPos, 0.78);
        this.audio.playIronCreak(pivotPos, 0.55);
      },
      onLeave: (_t, kickSpeed) => {
        const pushSign = Math.abs(state.angleZ) > 0.02 ? -Math.sign(state.angleZ) : 1;
        state.velZ += pushSign * Math.min(2.8, kickSpeed * 0.34);
        state.settled = false;
        this.audio.playWirePluck(pivotPos, 0.86);
      },
    });

    this.physics.registerPeckSwitch({
      id: `district_lantern_swing_${idx}`,
      position: new THREE.Vector3(pivotPos.x, pivotPos.y - 2.15, pivotPos.z),
      radius: 1.85,
      cooldown: 0,
      onPeck: () => {
        state.velZ += (state.angleZ >= 0 ? -1 : 1) * 3.8;
        state.velX += (Math.random() - 0.5) * 2.0;
        state.settled = false;
        this.audio.playWirePluck(pivotPos, 0.84);
        this.audio.playIronCreak(pivotPos, 0.72);
      },
    });

    return globe;
  }

  // ==========================================================================
  // 8. Overhead Catenary Tram Wire & 6-Chord Festive Bistro String-Lights
  // ==========================================================================

  private buildCatenaryWiresNetwork(): void {
    const parts: THREE.BufferGeometry[] = [];

    // Helper: wrought-iron wall-mount rosette plate, diagonal scroll brace & brass insulator ring
    const addWallBracket = (
      wallX: number,
      wallY: number,
      wallZ: number,
      outX: number,
      outZ: number
    ): THREE.Vector3 => {
      const yaw = Math.atan2(outX, outZ);
      parts.push(
        transformGeo(rbox(0.88, 1.08, 0.18, 0.05, PALETTE.ironworkPlum, 1), {
          rot: [0, yaw, 0],
          pos: [wallX + outX * 0.05, wallY, wallZ + outZ * 0.05],
        }),
        transformGeo(rbox(0.14, 0.14, 0.52, 0.04, PALETTE.ironworkPlum, 1), {
          rot: [0, yaw, 0],
          pos: [wallX + outX * 0.24, wallY, wallZ + outZ * 0.24],
        }),
        transformGeo(rbox(0.11, 0.11, 0.62, 0.03, PALETTE.ironworkPlum, 1), {
          rot: [0.62, yaw, 0],
          pos: [wallX + outX * 0.22, wallY + 0.24, wallZ + outZ * 0.22],
        }),
        transformGeo(rcyl(0.14, 0.14, 0.18, PALETTE.brassWarm, 10), {
          pos: [wallX + outX * 0.45, wallY, wallZ + outZ * 0.45],
        })
      );
      return new THREE.Vector3(wallX + outX * 0.45, wallY, wallZ + outZ * 0.45);
    };

    // Helper: Parisian cast-iron sidewalk mast with octagonal plinth, collar rings, brass finial & collider
    const addCastIronMast = (
      id: string,
      mx: number,
      mz: number,
      wireAttachY: number
    ): THREE.Vector3 => {
      const baseY = 0.28;
      const topY = wireAttachY + 1.05;
      const shaftH = topY - (baseY + 2.2);
      parts.push(
        transformGeo(rcyl(0.68, 0.96, 2.3, PALETTE.ironworkPlum, 10), {
          pos: [mx, baseY + 1.12, mz],
        }),
        transformGeo(rcyl(0.46, 0.54, 0.36, PALETTE.brassWarm, 10), {
          pos: [mx, baseY + 2.32, mz],
        }),
        transformGeo(rcyl(0.19, 0.35, shaftH, PALETTE.ironworkPlum, 10), {
          pos: [mx, baseY + 2.2 + shaftH * 0.5, mz],
        }),
        transformGeo(rcyl(0.30, 0.30, 0.28, PALETTE.brassWarm, 10), {
          pos: [mx, wireAttachY, mz],
        }),
        transformGeo(rcyl(0.08, 0.28, 0.72, PALETTE.brassWarm, 10), {
          pos: [mx, topY + 0.34, mz],
        })
      );
      const mBody = this.physics.addStaticCylinder(
        new THREE.Vector3(mx, baseY + (topY - baseY) * 0.5, mz),
        0.24,
        0.78,
        topY - baseY,
        8
      );
      this.physics.setBumpMetadata(mBody, { surface: 'metal', causesDizzy: true });
      this.perches.addStaticSegment(
        id,
        new THREE.Vector3(mx - 0.14, topY + 0.7, mz),
        new THREE.Vector3(mx + 0.14, topY + 0.7, mz),
        0.07,
        'metal'
      );
      return new THREE.Vector3(mx, wireAttachY, mz);
    };

    // 1. Main Boulevard Tramway Catenary Contact Wire (`x: -186 .. +186`), 8 Boulevard Masts & Archway Anchors
    parts.push(
      tube(
        [
          [-186.0, 23.92, 0],
          [-134.0, 23.92, 0],
          [-68.0, 23.92, 0],
          [0.0, 23.92, 0],
          [68.0, 23.92, 0],
          [134.0, 23.92, 0],
          [186.0, 23.92, 0],
        ],
        0.07,
        PALETTE.ironworkPlum,
        48,
        6
      )
    );

    this.perches.addStaticSegment(
      'tram_catenary_main',
      new THREE.Vector3(-185.0, 23.99, 0),
      new THREE.Vector3(185.0, 23.99, 0),
      0.07,
      'metal'
    );

    // West & East Beaux-Arts Triumphal Archway portal cross-spans (`x = ±186.0`, inner stone piers at `z = ±8.75`)
    for (const [aIdx, archX] of [
      [0, -186.0],
      [1, 186.0],
    ] as const) {
      const southAnchor = addWallBracket(archX, 24.6, -8.75, 0, 1);
      const northAnchor = addWallBracket(archX, 24.6, 8.75, 0, -1);
      parts.push(
        tube(
          [
            [southAnchor.x, southAnchor.y, southAnchor.z],
            [archX, 24.48, 0],
            [northAnchor.x, northAnchor.y, northAnchor.z],
          ],
          0.055,
          PALETTE.ironworkPlum,
          10,
          6
        ),
        // Central vertical insulator hanger drop clasping top of tram contact wire (strictly above pantograph `y = 23.87`)
        transformGeo(rcyl(0.05, 0.05, 0.54, PALETTE.ironworkPlum, 6), {
          pos: [archX, 24.22, 0],
        }),
        transformGeo(rcyl(0.13, 0.13, 0.16, PALETTE.brassWarm, 8), {
          pos: [archX, 24.02, 0],
        })
      );
      this.perches.addStaticSegment(
        `tram_arch_span_${aIdx}`,
        new THREE.Vector3(southAnchor.x, 24.64, southAnchor.z),
        new THREE.Vector3(northAnchor.x, 24.64, northAnchor.z),
        0.055,
        'metal'
      );
    }

    // 4 Pairs of Boulevard Tramway Catenary Support Masts (`x = -134, -68, +68, +134`, `z = ±18.0`)
    const tramMastXs = [-134.0, -68.0, 68.0, 134.0];
    tramMastXs.forEach((mx, mIdx) => {
      const southTop = addCastIronMast(`tram_mast_s_${mIdx}`, mx, -18.0, 24.75);
      const northTop = addCastIronMast(`tram_mast_n_${mIdx}`, mx, 18.0, 24.75);
      parts.push(
        tube(
          [
            [mx, southTop.y, southTop.z],
            [mx, 24.58, -9.0],
            [mx, 24.50, 0.0],
            [mx, 24.58, 9.0],
            [mx, northTop.y, northTop.z],
          ],
          0.05,
          PALETTE.ironworkPlum,
          14,
          6
        ),
        transformGeo(rcyl(0.045, 0.045, 0.56, PALETTE.ironworkPlum, 6), {
          pos: [mx, 24.23, 0],
        }),
        transformGeo(rcyl(0.12, 0.12, 0.15, PALETTE.brassWarm, 8), {
          pos: [mx, 24.02, 0],
        })
      );
      this.perches.addStaticSegment(
        `tram_cross_span_${mIdx}`,
        new THREE.Vector3(mx, 24.68, -17.8),
        new THREE.Vector3(mx, 24.68, 17.8),
        0.05,
        'metal'
      );
    });

    // 2. Physical Endpoints for Every Festive Bistro String-Light Catenary Span
    // NW Starter Building East stone piers (`x = -38.0`, `z = 32.0` & `z = 68.0`) -> NE Botanical Park Festoon Masts (`x = 19.6`)
    const nwWallSouth = addWallBracket(-38.0, 27.6, 32.0, 1, 0);
    const nwWallNorth = addWallBracket(-38.0, 27.6, 68.0, 1, 0);
    const neParkMastSouth = addCastIronMast('ne_bistro_mast_s', 19.6, 32.0, 25.5);
    const neParkMastNorth = addCastIronMast('ne_bistro_mast_n', 19.6, 68.0, 25.5);

    // SW Canal opposing masonry facades (`sw_painter_townhouse` South wall `z = -33.0` -> `sw_venetian_coral` North wall `z = -90.0`)
    const swPainterWall = addWallBracket(-53.0, 28.0, -33.0, 0, -1);
    const swCoralWall = addWallBracket(-52.0, 28.0, -90.0, 0, 1);

    // SE Bookshop South wall (`z = -38.0`) -> Market Stall 0 NW oak post wrought-iron riser (`(46.8, 16.8, -65.3)`)
    const seBookshopWest = addWallBracket(29.5, 27.5, -38.0, 0, -1);
    const stallPostX = 46.8;
    const stallPostZ = -65.3;
    parts.push(
      transformGeo(rcyl(0.28, 0.30, 0.34, PALETTE.ironworkPlum, 10), {
        pos: [stallPostX, 14.95, stallPostZ],
      }),
      transformGeo(rcyl(0.13, 0.18, 2.4, PALETTE.ironworkPlum, 8), {
        pos: [stallPostX, 16.2, stallPostZ],
      }),
      transformGeo(rcyl(0.16, 0.16, 0.2, PALETTE.brassWarm, 8), {
        pos: [stallPostX, 16.8, stallPostZ],
      }),
      transformGeo(rcyl(0.06, 0.18, 0.44, PALETTE.brassWarm, 8), {
        pos: [stallPostX, 17.55, stallPostZ],
      })
    );
    const seMarketPostAnchor = new THREE.Vector3(stallPostX, 16.8, stallPostZ);

    // SE Bookshop South wall (`z = -38.0`) -> Clocktower West limestone facade (`x = 84.9, z = -86.2`)
    const seBookshopEast = addWallBracket(58.5, 27.5, -38.0, 0, -1);
    const seClocktowerWall = addWallBracket(84.9, 45.2, -86.2, -1, 0);

    const spans: Array<[THREE.Vector3, THREE.Vector3, number]> = [
      [nwWallSouth, neParkMastSouth, 2.4],
      [nwWallNorth, neParkMastNorth, 2.6],
      [neParkMastSouth, neParkMastNorth, 1.9],
      [swPainterWall, swCoralWall, 2.3],
      [seBookshopWest, seMarketPostAnchor, 1.8],
      [seBookshopEast, seClocktowerWall, 2.5],
    ];

    spans.forEach(([pA, pB, sag], idx) => {
      const curvePts: Array<[number, number, number]> = [];
      const bulbParts: THREE.BufferGeometry[] = [];
      for (let s = 0; s <= 12; s++) {
        const u = s / 12;
        const x = pA.x + (pB.x - pA.x) * u;
        const z = pA.z + (pB.z - pA.z) * u;
        const y = pA.y + (pB.y - pA.y) * u - Math.sin(u * Math.PI) * sag;
        curvePts.push([x, y, z]);
        if (s > 0 && s < 12 && s % 2 === 0) {
          bulbParts.push(
            transformGeo(rcyl(0.2, 0.14, 0.42, PALETTE.windowWarmLit, 8), {
              pos: [x, y - 0.25, z],
            })
          );
        }
      }
      parts.push(tube(curvePts, 0.065, PALETTE.ironworkPlum, 20, 6));

      const bulbGeo = mergeParts(bulbParts);
      bulbGeo.computeBoundingSphere();
      const bulbMesh = new THREE.Mesh(bulbGeo, this.mat);
      bulbMesh.castShadow = false;
      this.root.add(bulbMesh);

      const wireState = {
        amp: 0,
        vel: 0,
        glowTimer: 0,
        bulbMesh,
        settled: true,
      };
      this.wireSpanOsc.push(wireState);

      const midPos = new THREE.Vector3(
        (pA.x + pB.x) * 0.5,
        (pA.y + pB.y) * 0.5 - sag,
        (pA.z + pB.z) * 0.5
      );

      // Subdivide each sagged catenary span into 6 exact top-of-wire chord PerchSegments
      const chordCount = 6;
      for (let c = 0; c < chordCount; c++) {
        const u0 = c / chordCount;
        const u1 = (c + 1) / chordCount;
        const segA = new THREE.Vector3(
          pA.x + (pB.x - pA.x) * u0,
          pA.y + (pB.y - pA.y) * u0 - Math.sin(u0 * Math.PI) * sag + 0.065,
          pA.z + (pB.z - pA.z) * u0
        );
        const segB = new THREE.Vector3(
          pA.x + (pB.x - pA.x) * u1,
          pA.y + (pB.y - pA.y) * u1 - Math.sin(u1 * Math.PI) * sag + 0.065,
          pA.z + (pB.z - pA.z) * u1
        );
        const wireSeg = this.perches.addStaticSegment(
          `catenary_wire_${idx}_${c}`,
          segA,
          segB,
          0.065,
          'metal'
        );
        wireSeg.onLand = (_t, speed) => {
          wireState.vel -= Math.min(5.2, 1.35 + speed * 0.38);
          wireState.glowTimer = 1.9;
          wireState.settled = false;
          bulbMesh.material = this.glowGoldMat;
          this.audio.playWirePluck(midPos, 0.9 + idx * 0.06);
        };
        wireSeg.onLeave = (_t, kickSpeed) => {
          wireState.vel += Math.min(4.4, kickSpeed * 0.45);
          wireState.glowTimer = Math.max(wireState.glowTimer, 1.4);
          wireState.settled = false;
          bulbMesh.material = this.glowGoldMat;
          this.audio.playWirePluck(midPos, 1.02 + idx * 0.06);
        };
        wireSeg.getVerticalOffset = (t) => {
          if (wireState.settled) return 0;
          const u = (c + t) / chordCount;
          return wireState.amp * Math.sin(u * Math.PI);
        };
      }
    });

    const wireMesh = new THREE.Mesh(mergeParts(parts), this.mat);
    wireMesh.castShadow = true;
    wireMesh.receiveShadow = true;
    wireMesh.geometry.computeBoundingSphere();
    this.root.add(wireMesh);
  }

  // ==========================================================================
  // 9. Populate ~11.2-SU Citizens, Multi-Species Companions & Park Pigeon Flock
  // ==========================================================================

  private async populateCharactersAndGroundedFlock(
    sanctuaryPos: THREE.Vector3,
    atticWindowSillPos: THREE.Vector3,
    onProgress?: (percent: number) => Promise<void>
  ): Promise<void> {
    const citizens = buildCitizenManifest();
    for (let i = 0; i < citizens.length; i++) {
      this.npcs.addGiantHuman(citizens[i]);
      if (i === 9 && onProgress) {
        await onProgress(96);
      }
    }

    const pigeonFlock = buildParkPigeonFlockManifest();
    this.npcs.addPigeonFlock(pigeonFlock.plazaCenter, pigeonFlock.scatterPerches);

    const companions = buildCompanionBirdManifest(sanctuaryPos, atticWindowSillPos);
    for (let i = 0; i < companions.length; i++) {
      this.npcs.addCompanionBird(companions[i]);
    }
  }

  // ==========================================================================
  // 10. Reusable Nest, Awning & Umbrella Helpers + Dynamic Animation Update
  // ==========================================================================

  private buildWovenNestMesh(radius: number): THREE.Mesh {
    const parts: THREE.BufferGeometry[] = [
      lathe(
        [
          [0.01, 0.02],
          [radius * 0.72, 0.02],
          [radius * 0.96, 0.24],
          [radius * 1.0, 0.48],
          [radius * 0.84, 0.5],
          [radius * 0.68, 0.2],
          [0.01, 0.18],
        ],
        PALETTE.woodOak,
        28,
        Math.PI * 2,
        { bottomAO: 0.18 }
      ),
      transformGeo(rcyl(radius * 0.7, radius * 0.58, 0.14, PALETTE.grassMeadow, 22), {
        pos: [0, 0.2, 0],
      }),
      transformGeo(smoothSphere(radius * 0.46, PALETTE.wallCreamTrim, 16, 12, [1.0, 0.25, 1.0]), {
        pos: [0, 0.24, 0],
      }),
    ];

    for (let tier = 0; tier < 3; tier++) {
      const pts: Array<[number, number, number]> = [];
      const steps = 22;
      const baseR = radius * (0.88 + tier * 0.04);
      const baseY = 0.18 + tier * 0.13;
      for (let k = 0; k <= steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const r = baseR + Math.sin(a * 5 + tier * 2.1) * (radius * 0.045);
        const y = baseY + Math.cos(a * 5 + tier * 1.7) * 0.035;
        pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
      }
      parts.push(
        tube(
          pts,
          0.06 * Math.max(0.85, radius * 0.65),
          tier % 2 === 0 ? PALETTE.woodWalnut : PALETTE.woodBirch,
          28,
          6
        )
      );
    }

    const m = new THREE.Mesh(mergeParts(parts), this.mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.geometry.computeBoundingSphere();
    return m;
  }

  private createBouncyAwning(
    id: string,
    center: THREE.Vector3,
    halfExtents: THREE.Vector3,
    stripeA: number,
    stripeB: number,
    bounceSpeed: number
  ): void {
    const alongX = halfExtents.x >= halfExtents.z;
    const stripeCount = 7;
    const span = (alongX ? halfExtents.x : halfExtents.z) * 2;
    const stripeW = span / stripeCount;
    const parts: THREE.BufferGeometry[] = [];

    for (let i = 0; i < stripeCount; i++) {
      const col = i % 2 === 0 ? stripeA : stripeB;
      const off = -span * 0.5 + stripeW * (i + 0.5);
      parts.push(
        transformGeo(
          rbox(
            alongX ? stripeW * 1.02 : halfExtents.x * 2,
            halfExtents.y * 2,
            alongX ? halfExtents.z * 2 : stripeW * 1.02,
            0.14,
            col,
            1
          ),
          { pos: [alongX ? off : 0, 0, alongX ? 0 : off] }
        )
      );
    }
    const mesh = new THREE.Mesh(mergeParts(parts), this.mat);
    mesh.position.copy(center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.geometry.computeBoundingSphere();
    this.root.add(mesh);

    const b = this.physics.addStaticBox(center, halfExtents, undefined, true);
    this.physics.setBumpMetadata(b, { surface: 'wood', causesDizzy: false });
    this.physics.registerTrampoline({
      id,
      center: center.clone(),
      halfExtents: halfExtents.clone(),
      bounceSpeed,
      meshToSquash: mesh,
    });
  }

  private createBouncyUmbrella(
    id: string,
    groundBase: THREE.Vector3,
    canopyY: number,
    radius: number,
    canopyHex: number,
    bounceSpeed: number
  ): void {
    const pole = new THREE.Mesh(this.propFactory.getCafeUmbrellaPoleGeometry(canopyY), this.mat);
    pole.position.set(groundBase.x, canopyY * 0.5, groundBase.z);
    pole.castShadow = true;
    pole.receiveShadow = true;
    this.root.add(pole);

    const canopyMesh = new THREE.Mesh(
      this.propFactory.getCafeUmbrellaCanopyGeometry(radius, canopyHex),
      this.mat
    );
    canopyMesh.position.set(groundBase.x, canopyY, groundBase.z);
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;
    this.root.add(canopyMesh);

    const center = new THREE.Vector3(groundBase.x, canopyY, groundBase.z);
    const halfExt = new THREE.Vector3(radius * 0.82, 0.9, radius * 0.82);
    const b = this.physics.addStaticBox(center, halfExt, undefined, true);
    this.physics.setBumpMetadata(b, { surface: 'wood', causesDizzy: false });
    this.physics.registerTrampoline({
      id,
      center,
      halfExtents: halfExt,
      bounceSpeed,
      meshToSquash: canopyMesh,
    });
  }

  private updateAnimatedProps(dt: number, elapsed: number): void {
    const clamped = Math.min(0.05, dt);
    if (this.windowCreakCooldown > 0) {
      this.windowCreakCooldown = Math.max(0, this.windowCreakCooldown - clamped);
    }
    if (this.washFoleyCooldown > 0) {
      this.washFoleyCooldown = Math.max(0, this.washFoleyCooldown - clamped);
    }

    // If player grabbed the hanging Brass Key directly off the hook before pecking the sign, promote it to DYNAMIC
    if (!this.signKeyDropped && this.hangingKeyProp?.carried) {
      this.signKeyDropped = true;
      this.hangingKeyProp.body.type = CANNON.Body.DYNAMIC;
      this.hangingKeyProp.body.allowSleep = true;
      this.hangingKeyProp.body.mass = 0.08;
      this.hangingKeyProp.body.updateMassProperties();
    }

    // Wake the stacked 6-apple pyramid in unison when any pyramid apple is snatched or bumped
    if (!this.appleAvalancheCascadeWoken && this.pyramidApples.length > 0) {
      let disturbed = false;
      for (let i = 0; i < this.pyramidApples.length; i++) {
        const ap = this.pyramidApples[i];
        if (ap.consumed || ap.carried || ap.body.sleepState !== CANNON.Body.SLEEPING) {
          disturbed = true;
          break;
        }
      }
      if (disturbed) {
        this.appleAvalancheCascadeWoken = true;
        for (let i = 0; i < this.pyramidApples.length; i++) {
          const ap = this.pyramidApples[i];
          if (ap.consumed || ap.carried) continue;
          ap.body.wakeUp();
          ap.syncedWhileSleeping = false;
          const spread = (i - 2.5) * 0.65;
          ap.body.velocity.x += spread;
          ap.body.velocity.z += (i % 2 === 0 ? 1 : -1) * 1.35;
        }
      }
    }
    if (!this.appleAvalancheFired && this.pyramidApples.length > 0) {
      let displacedCount = 0;
      let refPos: THREE.Vector3 | null = null;
      for (let i = 0; i < this.pyramidApples.length; i++) {
        const ap = this.pyramidApples[i];
        if (ap.consumed || ap.carried || ap.toppled) {
          displacedCount++;
          refPos = ap.mesh.position;
        }
      }
      if (displacedCount >= 2 && refPos) {
        this.appleAvalancheFired = true;
        this.npcs.triggerVendorShoo(refPos);
        this.npcs.notifyAcousticShock(refPos, 'topple');
        this.handles?.onApplePyramidToppled?.();
      }
    }

    // 1A. Cozy Brass Birdcage: 2-Peck Captive Hairpin Slide + Outward-Swinging Hinged Wire Gate (with settled early-out)
    if (!this.cageAnimSettled) {
      const basePinZ = 52.0 + Math.sin(0.34) * 2.68;
      const targetPinSlideZ = this.cageUnlatched ? 0.5 : this.cageLatchPecks >= 1 ? 0.24 : 0.0;
      if (this.cageLatchJiggle > 0) {
        this.cageLatchJiggle = Math.max(0, this.cageLatchJiggle - clamped * 3.5);
      }
      const targetLatchRot = this.cageUnlatched
        ? 0.22
        : (this.cageLatchPecks >= 1 ? 0.08 : 0) +
          Math.sin(elapsed * 28.0) * 0.22 * this.cageLatchJiggle;
      const targetGateLift = this.cageUnlatched ? 0.04 : this.cageLatchPecks >= 1 ? 0.025 : 0.0;
      const targetCageDoor = this.cageUnlatched ? 1.92 : 0.0;

      const pinDelta = targetPinSlideZ - this.cagePinSlideZ;
      const latchDelta = targetLatchRot - this.cageLatchPivot.rotation.z;
      const gateDelta = targetGateLift - this.cageGateLiftY;
      const doorDelta = targetCageDoor - this.cageDoorAngle;

      if (
        this.cageLatchJiggle < 1e-4 &&
        Math.abs(pinDelta) < 1e-4 &&
        Math.abs(latchDelta) < 1e-4 &&
        Math.abs(gateDelta) < 1e-4 &&
        Math.abs(doorDelta) < 1e-4
      ) {
        this.cagePinSlideZ = targetPinSlideZ;
        this.cageGateLiftY = targetGateLift;
        this.cageDoorAngle = targetCageDoor;
        this.cageLatchPivot.position.z = basePinZ + targetPinSlideZ;
        this.cageLatchPivot.rotation.z = targetLatchRot;
        this.cageGateSlideGroup.position.y = targetGateLift;
        this.cageDoorPivot.rotation.y = targetCageDoor;
        this.cageAnimSettled = true;
      } else {
        this.cagePinSlideZ += pinDelta * Math.min(1, clamped * 12.0);
        this.cageLatchPivot.position.z = basePinZ + this.cagePinSlideZ;
        this.cageLatchPivot.rotation.z += latchDelta * Math.min(1, clamped * 12.0);
        this.cageGateLiftY += gateDelta * Math.min(1, clamped * 6.5);
        this.cageGateSlideGroup.position.y = this.cageGateLiftY;
        this.cageDoorAngle += doorDelta * Math.min(1, clamped * 5.2);
        this.cageDoorPivot.rotation.y = this.cageDoorAngle;
      }
    }

    if (this.cageLatchHalo.visible) {
      this.cageLatchHalo.scale.setScalar(1.0 + Math.sin(elapsed * 4.5) * 0.15);
    }

    // 1B. Physics Overhead Brass Pulleys + Pull-Cord + Pivoting Oak/Brass Window Lift-Bar (with settled early-out)
    if (!this.windowBarSettled) {
      if (!this.windowBarUnlatched) {
        this.windowBarAngVel -= 0.78 * clamped;
        this.windowBarAngVel *= Math.pow(0.28, clamped);
        this.windowBarAngle = Math.max(
          0,
          Math.min(0.56, this.windowBarAngle + this.windowBarAngVel * clamped)
        );
        if (this.windowBarAngle >= 0.54) {
          this.tugWindowPullCord(0.5);
        } else if (this.windowBarAngle < 1e-4 && Math.abs(this.windowBarAngVel) < 1e-4) {
          this.windowBarAngle = 0;
          this.windowBarAngVel = 0;
          this.windowBarSettled = true;
        } else if (this.windowBarAngle <= 0.001 && this.windowBarAngVel < 0) {
          this.windowBarAngle = 0;
          this.windowBarAngVel = 0;
          this.windowBarSettled = true;
        }
      } else {
        const barDelta = 0.56 - this.windowBarAngle;
        if (Math.abs(barDelta) < 1e-4) {
          this.windowBarAngle = 0.56;
          this.windowBarSettled = true;
        } else {
          this.windowBarAngle += barDelta * Math.min(1, clamped * 9.0);
        }
      }

      this.windowLiftBarPivot.rotation.x = -this.windowBarAngle;

      const pullProgress = Math.min(1, this.windowBarAngle / 0.56);
      this.windowPullRingPos.set(-40.25, 37.8 - pullProgress * 3.4, 56.4);
      this.windowPullRingGroup.position.copy(this.windowPullRingPos);
      this.windowLatchHalo.position.copy(this.windowPullRingPos);
      this.windowPulleyWheel.rotation.x = this.windowBarAngle * 7.5;
      this.windowHoistPulleyWheel.rotation.x = -this.windowBarAngle * 7.5;

      const pullTopY = 46.85;
      const pullBotY = this.windowPullRingPos.y + 0.55;
      const pullLen = Math.max(0.2, pullTopY - pullBotY);
      this.windowPullCordMesh.position.set(-40.25, (pullTopY + pullBotY) * 0.5, 56.4);
      this.windowPullCordMesh.scale.set(1, pullLen, 1);

      const cosB = Math.cos(this.windowBarAngle);
      const sinB = Math.sin(this.windowBarAngle);
      const eyeY = 36.2 + 0.42 * cosB + 9.4 * sinB;
      const eyeZ = 43.4 - 0.42 * sinB + 9.4 * cosB;
      const hoistDy = 46.85 - eyeY;
      const hoistDz = 52.8 - eyeZ;
      const hoistLen = Math.max(0.2, Math.hypot(hoistDy, hoistDz));
      this.windowHoistCordMesh.position.set(-39.08, (46.85 + eyeY) * 0.5, (52.8 + eyeZ) * 0.5);
      this.windowHoistCordMesh.rotation.set(Math.atan2(hoistDz, hoistDy), 0, 0);
      this.windowHoistCordMesh.scale.set(1, hoistLen, 1);
    }

    // 1C. Physics Hinged French Casement Sashes (with settled early-out)
    if (this.windowBarUnlatched && !this.windowSashSettled) {
      this.windowOpenAngle += this.windowSashAngVel * clamped;
      if (this.windowOpenAngle >= 0.65 && !this.windowUnlatched) {
        this.completeWindowSwingOpen();
      }
      if (this.windowUnlatched) {
        this.windowSashAngVel += (1.34 - this.windowOpenAngle) * 3.2 * clamped;
      }
      this.windowSashAngVel *= Math.pow(0.18, clamped);
      this.windowOpenAngle = Math.max(0.16, Math.min(1.36, this.windowOpenAngle));

      const targetSash = this.windowUnlatched ? 1.34 : this.windowOpenAngle;
      if (
        Math.abs(this.windowSashAngVel) < 1e-4 &&
        (!this.windowUnlatched || Math.abs(targetSash - this.windowOpenAngle) < 1e-4)
      ) {
        if (this.windowUnlatched) {
          this.windowOpenAngle = 1.34;
        }
        this.windowSashAngVel = 0;
        this.windowSashSettled = true;
      }

      this.windowLeftPivot.rotation.y = this.windowOpenAngle;
      this.windowRightPivot.rotation.y = -this.windowOpenAngle;
    }

    if (this.windowLatchHalo.visible) {
      this.windowLatchHalo.scale.setScalar(1.0 + Math.sin(elapsed * 4.8) * 0.16);
    }

    this.wallClockPendulum.rotation.z = Math.sin(elapsed * Math.PI) * 0.18;

    const wholeSec = Math.floor(elapsed);
    const fracSec = elapsed - wholeSec;
    const tickStep = wholeSec + Math.min(1, fracSec * 6.5);
    const clockMinutes = 9 * 60 + 10 + tickStep * 0.5;
    const minuteAngle = ((clockMinutes % 60) / 60) * Math.PI * 2;
    const hourAngle = (((clockMinutes / 60) % 12) / 12) * Math.PI * 2;
    for (let i = 0; i < this.clockDialRigs.length; i++) {
      const rig = this.clockDialRigs[i];
      rig.hourPivot.rotation.z = -hourAngle;
      rig.minutePivot.rotation.z = -minuteAngle;
    }

    // 2. Heritage Vintage Tram along `z = 0` (`x: -108 .. +108`) + Kinematic AABB sync
    this.tramPrevX = this.tramX;
    this.tramX = Math.sin(elapsed * 0.095 - 0.32) * 108.0;
    const tramVx = (this.tramX - this.tramPrevX) / Math.max(0.001, clamped);
    this.tramGroup.position.set(this.tramX, 0.19, 0);
    this.tramBody.position.set(this.tramX, 9.9, 0);
    this.tramBody.interpolatedPosition.copy(this.tramBody.position);
    this.tramBody.velocity.set(tramVx, 0, 0);
    this.tramBody.aabbNeedsUpdate = true;

    if (this.tramBellCooldown > 0) {
      this.tramBellCooldown = Math.max(0, this.tramBellCooldown - clamped);
    }
    if (this.tramCrossroadsCooldown > 0) {
      this.tramCrossroadsCooldown = Math.max(0, this.tramCrossroadsCooldown - clamped);
    } else if (Math.abs(this.tramPrevX) >= 22.0 && Math.abs(this.tramX) < 22.0) {
      this.tramCrossroadsCooldown = 11.0;
      this.triggerTramBellAndSpark(8);
    }

    // 2B. Animated NE Park Fountain Geyser Plume, Spouts & Expanding Basin Splash Ripples
    const geyserTarget = this.fountainUpdraftRef?.active ? 2.15 : 1.0;
    this.fountainPlumeScale += (geyserTarget - this.fountainPlumeScale) * Math.min(1, clamped * 2.5);
    const pulseY = 1.0 + Math.sin(elapsed * 6.2) * 0.085 + Math.cos(elapsed * 9.7) * 0.045;
    const pulseXZ = 1.0 + Math.cos(elapsed * 5.8) * 0.05;
    this.fountainPlumeGroup.scale.set(pulseXZ, this.fountainPlumeScale * pulseY, pulseXZ);
    this.fountainPlumeGroup.rotation.y = elapsed * 1.35;
    this.fountainSpoutsGroup.scale.set(
      1.0 + Math.sin(elapsed * 5.1) * 0.018,
      1.0 + Math.cos(elapsed * 6.4) * 0.024,
      1.0 + Math.sin(elapsed * 5.1) * 0.018
    );

    this.fountainRippleTimer -= clamped;
    if (this.fountainRippleTimer <= 0) {
      this.fountainRippleTimer = 0.28 + Math.random() * 0.22;
      const ang = Math.random() * Math.PI * 2;
      if (Math.random() < 0.68) {
        const r = 6.9 + Math.random() * 1.1;
        _fountainRipplePos.set(48.0 + Math.cos(ang) * r, 1.96, 48.0 + Math.sin(ang) * r);
        this.fx.spawnWaterRipple(_fountainRipplePos, 1.85 + Math.random() * 0.9);
      } else {
        const r = 3.7 + Math.random() * 0.6;
        _fountainRipplePos.set(48.0 + Math.cos(ang) * r, 7.90, 48.0 + Math.sin(ang) * r);
        this.fx.spawnWaterRipple(_fountainRipplePos, 1.25 + Math.random() * 0.5);
      }
    }

    // 3. Cruising 22-SU Wooden Canal Launches (`x: -124 .. -28`) with smooth yaw turns & Kinematic AABB sync
    for (const boat of this.canalBoats) {
      boat.xPos += boat.dir * boat.speed * clamped;
      if (boat.xPos > -28.0) {
        boat.xPos = -28.0;
        boat.dir = -1;
      } else if (boat.xPos < -124.0) {
        boat.xPos = -124.0;
        boat.dir = 1;
      }

      // Turn inward toward canal centerline (`z = -54`) so bows never graze north/south quay walls
      const targetYaw = boat.dir > 0 ? 0 : boat.baseZ > -54.0 ? Math.PI : -Math.PI;
      const yawDelta = targetYaw - boat.yaw;
      if (Math.abs(yawDelta) > 1e-4) {
        boat.yaw += yawDelta * Math.min(1, clamped * 3.2);
      } else {
        boat.yaw = targetYaw;
      }

      const bobY = -0.68 + Math.sin(elapsed * 2.0 + boat.phaseOffset) * 0.07;
      const rollX = Math.sin(elapsed * 1.5 + boat.phaseOffset) * 0.03;
      boat.group.position.set(boat.xPos, bobY, boat.baseZ);
      boat.group.rotation.set(rollX, boat.yaw, 0);

      boat.body.position.set(boat.xPos, bobY + 2.0, boat.baseZ);
      boat.body.interpolatedPosition.copy(boat.body.position);
      _boatQuat.setFromAxisAngle(_upAxis, boat.yaw);
      boat.body.quaternion.set(_boatQuat.x, _boatQuat.y, _boatQuat.z, _boatQuat.w);
      boat.body.interpolatedQuaternion.copy(boat.body.quaternion);
      boat.body.velocity.set(boat.dir * boat.speed, 0, 0);
      boat.body.aabbNeedsUpdate = true;
    }

    // 4. Spinning Market Pinwheels
    for (const pw of this.pinwheels) {
      pw.spinSpeed = Math.max(2.4, pw.spinSpeed * Math.pow(0.55, clamped));
      pw.rotor.rotation.z += pw.spinSpeed * clamped;
    }

    // 5. Postcard Carousel & Swinging Bookshop Sign (settled early-out)
    this.postcardSpinVel = Math.max(0.45, this.postcardSpinVel * Math.pow(0.42, clamped));
    this.postcardCarouselPivot.rotation.y += this.postcardSpinVel * clamped;

    // Ensure grabbing the hanging brass key directly into the beak unhooks it from KINEMATIC to DYNAMIC
    if (!this.signKeyDropped && this.hangingKeyProp?.carried) {
      this.releaseBookshopHangingKey(false);
    }

    if (!this.signSettled) {
      const signForce = -this.signAngle * 22.0 - this.signVel * 2.8;
      this.signVel += signForce * clamped;
      this.signAngle += this.signVel * clamped;
      if (Math.abs(this.signAngle) < 1e-4 && Math.abs(this.signVel) < 1e-4) {
        this.signAngle = 0;
        this.signVel = 0;
        this.swingingSignPivot.rotation.z = 0;
        this.signSettled = true;
      } else {
        this.swingingSignPivot.rotation.z = this.signAngle;
      }
    }

    // 6. Espresso Steam Lever, Picnic Basket Lid & Music-Box Lid (settled early-outs)
    if (!this.espressoLeverSettled) {
      const targetLever = this.espressoLeverPulled ? 0.68 : -0.15;
      const leverDelta = targetLever - this.espressoLeverPivot.rotation.x;
      if (Math.abs(leverDelta) < 1e-4) {
        this.espressoLeverPivot.rotation.x = targetLever;
        this.espressoLeverSettled = true;
      } else {
        this.espressoLeverPivot.rotation.x += leverDelta * Math.min(1, clamped * 8.0);
      }
    }

    if (!this.picnicLidSettled) {
      const targetPicnic = this.picnicBasketOpened ? -1.45 : 0;
      const picnicDelta = targetPicnic - this.picnicLidPivot.rotation.x;
      if (Math.abs(picnicDelta) < 1e-4) {
        this.picnicLidPivot.rotation.x = targetPicnic;
        this.picnicLidSettled = true;
      } else {
        this.picnicLidPivot.rotation.x += picnicDelta * Math.min(1, clamped * 7.0);
      }
    }

    if (!this.musicBoxLidSettled) {
      const targetLid = this.musicBoxOpen ? 1.15 : 0;
      const lidDelta = targetLid - this.musicBoxLidPivot.rotation.x;
      if (Math.abs(lidDelta) < 1e-4) {
        this.musicBoxLidPivot.rotation.x = targetLid;
        this.musicBoxLidSettled = true;
      } else {
        this.musicBoxLidPivot.rotation.x += lidDelta * Math.min(1, clamped * 5.0);
      }
    }

    // 7. Clocktower Bronze Belfry Bell pendulum (settled early-out)
    for (const b of this.bellPivots) {
      if (b.settled) continue;
      const f = -b.angle * 24.0 - b.vel * 2.0;
      b.vel += f * clamped;
      b.angle += b.vel * clamped;
      if (Math.abs(b.angle) < 1e-4 && Math.abs(b.vel) < 1e-4) {
        b.angle = 0;
        b.vel = 0;
        b.group.rotation.z = 0;
        b.settled = true;
      } else {
        b.group.rotation.z = b.angle;
      }
    }

    // 8. Hanging Shepherd's-Crook District Lanterns (settled early-outs)
    for (const lp of this.lanternPivots) {
      if (lp.settled) continue;
      const fx = -lp.angleX * 19.0 - lp.velX * 2.3;
      const fz = -lp.angleZ * 19.0 - lp.velZ * 2.3;
      lp.velX += fx * clamped;
      lp.velZ += fz * clamped;
      lp.angleX = Math.max(-0.55, Math.min(0.55, lp.angleX + lp.velX * clamped));
      lp.angleZ = Math.max(-0.55, Math.min(0.55, lp.angleZ + lp.velZ * clamped));
      if (
        Math.abs(lp.angleX) < 1e-4 &&
        Math.abs(lp.angleZ) < 1e-4 &&
        Math.abs(lp.velX) < 1e-4 &&
        Math.abs(lp.velZ) < 1e-4
      ) {
        lp.angleX = 0;
        lp.angleZ = 0;
        lp.velX = 0;
        lp.velZ = 0;
        lp.group.rotation.set(0, 0, 0);
        lp.settled = true;
      } else {
        lp.group.rotation.set(lp.angleX, 0, lp.angleZ);
      }
    }

    // 9. Hinged Townhouse Shutters (settled early-outs)
    for (const sw of this.shutterWindows) {
      if (sw.settled) continue;
      const targetAngle = sw.open ? 0.16 : 2.86;
      const spring = (targetAngle - sw.angle) * 26.0 - sw.vel * 4.8;
      sw.vel += spring * clamped;
      sw.angle = Math.max(0.02, Math.min(3.02, sw.angle + sw.vel * clamped));
      if (Math.abs(targetAngle - sw.angle) < 1e-3 && Math.abs(sw.vel) < 1e-3) {
        sw.angle = targetAngle;
        sw.vel = 0;
        sw.settled = true;
      }
      sw.leftHinge.rotation.y = sw.angle;
      sw.rightHinge.rotation.y = -sw.angle;
      sw.glowPane.visible = sw.angle < 2.25;
    }

    // 10. Elastic Catenary String-Light Pluck & Twinkle Wave (settled early-outs)
    for (const ws of this.wireSpanOsc) {
      if (ws.settled) continue;
      const f = -ws.amp * 46.0 - ws.vel * 4.2;
      ws.vel += f * clamped;
      ws.amp = Math.max(-0.65, Math.min(0.65, ws.amp + ws.vel * clamped));
      ws.bulbMesh.position.y = ws.amp * 0.72;
      if (ws.glowTimer > 0) {
        ws.glowTimer = Math.max(0, ws.glowTimer - clamped);
        // Gentle shimmer flicker before settling back to warm lit
        ws.bulbMesh.material =
          ws.glowTimer > 0.35 || Math.sin(elapsed * 28.0) > -0.2 ? this.glowGoldMat : this.mat;
      } else {
        ws.bulbMesh.material = this.mat;
      }
      if (ws.glowTimer <= 0 && Math.abs(ws.amp) < 1e-3 && Math.abs(ws.vel) < 1e-3) {
        ws.amp = 0;
        ws.vel = 0;
        ws.bulbMesh.position.y = 0;
        ws.bulbMesh.material = this.mat;
        ws.settled = true;
      }
    }

    // 11. Bistro Newspaper Wing-Wash Rustle (settled early-out)
    if (this.newspaperFlutter > 1e-3 && this.newspaperMesh) {
      this.newspaperFlutter *= Math.pow(0.08, clamped);
      this.newspaperMesh.rotation.x = Math.sin(elapsed * 34.0) * 0.14 * this.newspaperFlutter;
      if (!this.newspaperCoinSpawned) {
        this.newspaperMesh.rotation.z = Math.cos(elapsed * 27.0) * 0.11 * this.newspaperFlutter;
      }
      if (this.newspaperFlutter <= 1e-3) {
        this.newspaperFlutter = 0;
        this.newspaperMesh.rotation.x = 0;
        if (!this.newspaperCoinSpawned) {
          this.newspaperMesh.rotation.z = 0;
        }
      }
    }
  }

  private registerInteractiveWindow(win: InteractiveWindowSpec): void {
    const winGroup = new THREE.Group();
    winGroup.position.set(win.wx, win.wy, win.wz);
    winGroup.rotation.y = win.rotY;

    const glowGeo = rbox(3.74, 10.05, 0.04, 0.02, PALETTE.goldGlow, 1);
    glowGeo.computeBoundingSphere();
    const glowPane = new THREE.Mesh(glowGeo, this.glowGoldMat);
    glowPane.position.set(0, 0, 0.275);
    glowPane.visible = false;
    winGroup.add(glowPane);

    const leftHinge = new THREE.Group();
    leftHinge.position.set(-2.02, 1.35, 0.34);
    const leftLeafGeo = transformGeo(rbox(1.45, 7.6, 0.26, 0.06, win.shutterHex, 1), {
      pos: [-0.73, 0, 0],
    });
    leftLeafGeo.computeBoundingSphere();
    const leftMesh = new THREE.Mesh(leftLeafGeo, this.mat);
    leftMesh.castShadow = true;
    leftHinge.add(leftMesh);
    winGroup.add(leftHinge);

    const rightHinge = new THREE.Group();
    rightHinge.position.set(2.02, 1.35, 0.34);
    const rightLeafGeo = transformGeo(rbox(1.45, 7.6, 0.26, 0.06, win.shutterHex, 1), {
      pos: [0.73, 0, 0],
    });
    rightLeafGeo.computeBoundingSphere();
    const rightMesh = new THREE.Mesh(rightLeafGeo, this.mat);
    rightMesh.castShadow = true;
    rightHinge.add(rightMesh);
    winGroup.add(rightHinge);

    const startClosedAngle = 2.86;
    leftHinge.rotation.y = startClosedAngle;
    rightHinge.rotation.y = -startClosedAngle;
    this.root.add(winGroup);

    const outX = win.axis === 'x' ? win.sign : 0;
    const outZ = win.axis === 'z' ? win.sign : 0;
    const worldPos = new THREE.Vector3(win.wx + outX * 0.6, win.wy - 2.2, win.wz + outZ * 0.6);
    const flowerboxPos = win.isFlowerbox
      ? new THREE.Vector3(win.wx + outX * 0.72, win.wy - 3.9, win.wz + outZ * 0.72)
      : null;

    const state = {
      id: win.id,
      worldPos,
      flowerboxPos,
      leftHinge,
      rightHinge,
      glowPane,
      open: false,
      angle: startClosedAngle,
      vel: 0,
      settled: true,
    };
    this.shutterWindows.push(state);

    const toggleShutters = (impulseBoost = 1.0): void => {
      state.open = !state.open;
      state.vel += (state.open ? -4.8 : 4.8) * impulseBoost;
      state.settled = false;
      this.audio.playShutterCreak(worldPos);
      if (flowerboxPos) {
        this.fx.spawnPetalBurst(flowerboxPos, 6, 2.7);
      }
    };

    const prevOnLand = win.sillPerch.onLand;
    win.sillPerch.onLand = (t, speed) => {
      prevOnLand?.(t, speed);
      if (speed > 5.4 && !state.open) {
        toggleShutters(0.9);
      } else if (speed > 3.2) {
        state.vel += state.open ? 2.4 : -2.8;
        state.settled = false;
      }
    };

    this.physics.registerPeckSwitch({
      id: `${win.id}_shutters`,
      position: worldPos,
      radius: 2.85,
      cooldown: 0,
      onPeck: () => {
        toggleShutters(1.1);
      },
    });
  }

  private triggerTramBellAndSpark(sparkCount = 8): void {
    _tramSparkPos.set(this.tramX, 23.92, 0);
    this.fx.spawnBurst(_tramSparkPos, sparkCount, true, 3.8);
    if (this.tramBellCooldown <= 0) {
      this.tramBellCooldown = 1.1;
      _tramSparkPos.set(this.tramX, 19.5, 0);
      this.audio.playTramBell(_tramSparkPos);
      this.npcs.notifyAcousticShock(_tramSparkPos, 'bell');
    }
  }

  private releaseBookshopHangingKey(applyDropThrow: boolean): void {
    this.signVel += applyDropThrow ? 7.5 : 4.2;
    this.signSettled = false;
    this.audio.playCageUnlatch();
    if (!this.signKeyDropped && this.hangingKeyProp) {
      this.signKeyDropped = true;
      this.hangingKeyProp.body.type = CANNON.Body.DYNAMIC;
      this.hangingKeyProp.body.allowSleep = true;
      this.hangingKeyProp.body.mass = 0.08;
      this.hangingKeyProp.body.updateMassProperties();
      if (applyDropThrow && !this.hangingKeyProp.carried) {
        this.hangingKeyProp.body.wakeUp();
        this.hangingKeyProp.body.velocity.set(-3.2, 2.5, 2.2);
      } else if (this.hangingKeyProp.carried) {
        this.hangingKeyProp.body.sleep();
      }
    }
  }

  private applyAerodynamicWash(
    birdPos: THREE.Vector3,
    birdVel: THREE.Vector3,
    strength: number
  ): void {
    // 1. Market Stall Pinwheels
    for (let i = 0; i < this.pinwheels.length; i++) {
      const pw = this.pinwheels[i];
      if (pw.rotor.position.distanceToSquared(birdPos) < 72.0) {
        const targetSpin = 7.5 + strength * 12.5;
        if (this.washFoleyCooldown <= 0 && pw.spinSpeed < 6.5) {
          this.washFoleyCooldown = 0.55;
          this.audio.playPinwheelWhir(pw.rotor.position, targetSpin);
        }
        pw.spinSpeed = Math.max(pw.spinSpeed, targetSpin);
      }
    }

    // 2. Wire Postcard Carousel
    if (this.postcardCarouselPivot.position.distanceToSquared(birdPos) < 56.0) {
      if (this.washFoleyCooldown <= 0 && this.postcardSpinVel < 3.0) {
        this.washFoleyCooldown = 0.55;
        this.audio.playIronCreak(this.postcardCarouselPivot.position, 0.45);
      }
      this.postcardSpinVel = Math.max(this.postcardSpinVel, 4.2 + strength * 7.8);
    }

    // 3. Swinging Bookshop Sign
    const signDx = birdPos.x - 24.0;
    const signDy = birdPos.y - 19.8;
    const signDz = birdPos.z + 29.0;
    if (signDx * signDx + signDy * signDy + signDz * signDz < 49.0) {
      if (this.washFoleyCooldown <= 0 && Math.abs(this.signVel) < 1.2) {
        this.washFoleyCooldown = 0.65;
        this.audio.playIronCreak({ x: 24.0, y: 19.8, z: -29.0 }, 0.72);
      }
      this.signVel += Math.sign(birdVel.x || 1) * strength * 2.2;
      this.signSettled = false;
    }

    // 4. Hanging Shepherd's-Crook District Lanterns
    for (let i = 0; i < this.lanternPivots.length; i++) {
      const lp = this.lanternPivots[i];
      if (lp.pivotPos.distanceToSquared(birdPos) < 49.0) {
        if (this.washFoleyCooldown <= 0 && lp.settled) {
          this.washFoleyCooldown = 0.6;
          this.audio.playIronCreak(lp.pivotPos, 0.5);
        }
        lp.velX += birdVel.z * 0.055 * strength;
        lp.velZ -= birdVel.x * 0.055 * strength;
        lp.settled = false;
      }
    }

    // 5. Sidewalk Bistro Newspaper Rustle
    if (this.newspaperMesh && this.newspaperMesh.position.distanceToSquared(birdPos) < 38.0) {
      this.newspaperFlutter = Math.max(this.newspaperFlutter, Math.min(1.0, strength * 0.95));
    }

    // 6. Hinged Townhouse Shutters & Flowerboxes on close high-speed brush
    if (strength > 0.65) {
      for (let i = 0; i < this.shutterWindows.length; i++) {
        const sw = this.shutterWindows[i];
        if (sw.worldPos.distanceToSquared(birdPos) < 30.0) {
          sw.vel += (sw.open ? 1.8 : -2.2) * strength;
          sw.settled = false;
          if (sw.flowerboxPos && Math.random() < 0.35) {
            this.fx.spawnPetalBurst(sw.flowerboxPos, 4, 2.4);
          }
        }
      }
    }

    // 7. Streetcar Pantograph Flyby Ding & Spark
    if (
      strength > 0.72 &&
      Math.abs(birdPos.x - this.tramX) < 9.0 &&
      Math.abs(birdPos.z) < 5.5 &&
      birdPos.y > 14.0 &&
      birdPos.y < 26.5
    ) {
      this.triggerTramBellAndSpark(6);
    }
  }
}
