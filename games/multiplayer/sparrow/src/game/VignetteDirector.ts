import * as THREE from 'three/webgpu';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { SparrowController, AttentionTarget } from '../entities/SparrowController.ts';
import type { NPCManager } from '../entities/NPCManager.ts';
import type { AcousticSoundtrack } from '../audio/AcousticSoundtrack.ts';
import type { WorldFX } from '../rendering/WorldFX.ts';
import type { BirdCamera } from '../camera/BirdCamera.ts';
import type { BuiltWorldHandles } from '../world/CityBlockBuilder.ts';
import type { TutorialOverlay } from '../ui/TutorialOverlay.ts';
import type { SparrowJournalHUD, SparrowDeedId } from '../ui/SparrowJournalHUD.ts';
import { SparrowMesh } from '../entities/SparrowMesh.ts';
import { PALETTE } from '../rendering/Palette.ts';
import { createPastelMaterial, storybookUniforms } from '../rendering/StorybookMaterial.ts';

const _boulangerieOrigin = new THREE.Vector3(-33.5, 4.0, 48.0);
const _chefPatrolOrigin = new THREE.Vector3(-32.2, 4.0, 52.0);
const _onboardingBalconyPos = new THREE.Vector3(-34.2, 33.5, 48.0);
const _onboardingCafePos = new THREE.Vector3(-25.5, 6.579, 52.2);
const _fountainFocusPos = new THREE.Vector3(48.0, 14.0, 48.0);
const _ripplePos = new THREE.Vector3();
const _focusPos = new THREE.Vector3();
const _crownTargetPos = new THREE.Vector3();
const _crownTargetQuat = new THREE.Quaternion();
const _crownSpinQuat = new THREE.Quaternion();
const _crownSpinEuler = new THREE.Euler();

function smoothstep01(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function buildSkySparkleGroup(): {
  root: THREE.Group;
  primaryStar: THREE.Group;
  secondaryStar: THREE.Group;
} {
  const root = new THREE.Group();
  const primaryStar = new THREE.Group();
  const secondaryStar = new THREE.Group();

  const goldRayMat = createPastelMaterial({
    color: 0xffec96,
    vertexColors: false,
    emissiveHex: 0xffcc38,
    emissiveIntensity: 0.82,
    fog: false,
  });
  const coreMat = createPastelMaterial({
    color: 0xffffff,
    vertexColors: false,
    emissiveHex: 0xfff6c4,
    emissiveIntensity: 0.96,
    fog: false,
  });

  const longRayGeo = new THREE.OctahedronGeometry(1.0, 0);
  const rayX = new THREE.Mesh(longRayGeo, goldRayMat);
  rayX.scale.set(2.35, 0.24, 0.24);
  const rayY = new THREE.Mesh(longRayGeo, goldRayMat);
  rayY.scale.set(0.24, 2.55, 0.24);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), coreMat);
  primaryStar.add(rayX, rayY, core);

  const diagA = new THREE.Mesh(longRayGeo, goldRayMat);
  diagA.scale.set(1.42, 0.16, 0.16);
  const diagB = new THREE.Mesh(longRayGeo, goldRayMat);
  diagB.scale.set(0.16, 1.42, 0.16);
  secondaryStar.rotation.z = Math.PI * 0.25;
  secondaryStar.add(diagA, diagB);

  root.add(primaryStar, secondaryStar);
  root.visible = false;
  return { root, primaryStar, secondaryStar };
}

/**
 * Orchestrates:
 * - Contextual 6-step Indoor Conservatory Atelier Tutorial (Desktop keycaps + Mobile touch pills)
 * - No fence/wall bonks while inside the indoor tutorial safe zone
 * - 12 Sparrow Mischief & Heartwarming Deeds across all 4 European blocks tracked in SparrowJournalHUD
 * - 12/12 Coronation Cutscene: camera zooms out, pans to a golden sky sparkle, and a tiny royal crown
 *   falls onto the player sparrow's head for the rest of the session
 * - Progressive Golden Morning atmosphere transition
 */
export class VignetteDirector {
  private step0MovedDone = false;
  private step1ChirpDone = false;
  private step2LatchDone = false;
  private step3HasFlown = false;
  private step4WindowUnlatched = false;
  private step5WindowEscaped = false;
  private tutorialChirpBaseline = 0;
  private tutorialEnabledSeen = false;
  private cageHopDistance = 0;
  private chirpPromptElapsed = 0;
  private postUnlatchElapsed = 0;
  private readonly prevBirdPos = new THREE.Vector3();
  private hasPrevBirdPos = false;

  private readonly districtsAwakened = [false, false, false, false, false];

  private coinsDelivered = 0;
  private painterHasGlasses = false;
  private pigmentsDelivered = 0;
  private sanctuaryWeaves = 0;

  private airplaneSpawnTimer = 0;
  private airplanesLaunched = 0;
  private chefShooCooldown = 0;

  // 12/12 Missions Coronation Cutscene state & pre-warmed 3D meshes
  private coronationTriggered = false;
  private coronationPendingDelay = -1;
  private coronationActive = false;
  private coronationElapsed = 0;
  private coronationCueStage = 0;
  private coronationLanded = false;
  private coronationGlintTimer = 0;
  private readonly coronationSkyOrigin = new THREE.Vector3();
  private readonly skySparkle: {
    root: THREE.Group;
    primaryStar: THREE.Group;
    secondaryStar: THREE.Group;
  };
  private readonly fallingCrownGroup: THREE.Group;

  private readonly dawnFog = new THREE.Color(PALETTE.fogDawn);
  private readonly goldenFog = new THREE.Color(PALETTE.fogGolden);
  private readonly currentFog = new THREE.Color(PALETTE.fogDawn);

  private readonly attentionTargets: AttentionTarget[] = [];
  private readonly attentionEntry: AttentionTarget = {
    position: new THREE.Vector3(),
    priority: 1.0,
  };

  constructor(
    private scene: THREE.Scene,
    private sunLight: THREE.DirectionalLight,
    private hemiLight: THREE.HemisphereLight,
    private physics: PhysicsWorld,
    private sparrow: SparrowController,
    private npcs: NPCManager,
    private audio: AcousticSoundtrack,
    private fx: WorldFX,
    private birdCam: BirdCamera,
    private world: BuiltWorldHandles,
    private tutorial: TutorialOverlay,
    private journalHud: SparrowJournalHUD
  ) {
    // Pre-add coronation sparkle & falling crown to scene (hidden) so WebGPU compiles their shaders during load
    this.skySparkle = buildSkySparkleGroup();
    this.fallingCrownGroup = SparrowMesh.createStandaloneCrownMesh();
    this.fallingCrownGroup.visible = false;
    this.scene.add(this.skySparkle.root);
    this.scene.add(this.fallingCrownGroup);

    // Initial tutorial state: cage latch halo on, window latch halo off, no prompt, HUD hidden
    this.world.setLatchReady(true);
    this.world.setWindowLatchReady(false);
    this.tutorial.setPrompt(null);
    this.journalHud.setVisible(false);

    this.npcs.setCompanionOnboardingState(
      'starter_tit',
      this.world.atticWindowSillPos,
      true,
      false
    );

    // Seed counter sync
    this.sparrow.onSeedEatenCallback = (_pos, total) => {
      this.journalHud.setSeedsCount(total);
    };

    // Croissant Heist detection + Chef chase
    this.sparrow.onPropPickedUpCallback = (prop) => {
      if (prop.kind === 'croissant') {
        this.recordDeedCompleted('croissant_heist');
        if (this.sparrow.position.distanceTo(_boulangerieOrigin) < 24.0) {
          this.chefShooCooldown = 4.0;
          this.npcs.triggerChefShoo(this.sparrow.position);
        }
      }
    };

    // World & NPC Mischief Event Hooks
    this.world.onCoffeeCupToppled = () => {
      this.recordDeedCompleted('coffee_bowling');
    };
    this.npcs.onPigeonFlockScattered = () => {
      this.recordDeedCompleted('pigeon_scatter');
    };
    this.world.onPicnicBasketRaided = () => {
      this.recordDeedCompleted('picnic_raid');
    };
    this.world.onBicycleBellRung = () => {
      this.recordDeedCompleted('canal_prank');
    };
    this.world.onGelatoToppled = () => {
      this.recordDeedCompleted('canal_prank');
    };
    this.world.onApplePyramidToppled = () => {
      this.recordDeedCompleted('apple_avalanche');
    };
    this.world.onBelfryBellRung = () => {
      this.recordDeedCompleted('belfry_bell');
    };

    // Hook Chirp Greeting detection (ignoring pre-gameplay intro sequence chirps)
    const prevChirpCb = this.sparrow.onChirpCallback;
    this.sparrow.onChirpCallback = (chirpPos) => {
      prevChirpCb?.(chirpPos);
      if (!this.sparrow.inputEnabled) return;
      if (!this.tutorialEnabledSeen) {
        this.tutorialEnabledSeen = true;
        this.tutorialChirpBaseline = Math.max(0, this.sparrow.chirpCount - 1);
      }
      if (!this.step1ChirpDone && this.sparrow.chirpCount > this.tutorialChirpBaseline) {
        this.completeStep1Chirp();
      }
    };

    this.npcs.onStarterBirdAnswered = () => {
      if (
        this.tutorialEnabledSeen &&
        !this.step1ChirpDone &&
        this.sparrow.chirpCount > this.tutorialChirpBaseline
      ) {
        this.completeStep1Chirp();
      }
    };

    this.sparrow.getExtraAttentionTargets = () => this.computeAttentionTargets();
  }

  public isCoronationCutsceneActive(): boolean {
    return this.coronationActive;
  }

  public hasTriggeredCoronation(): boolean {
    return this.coronationTriggered;
  }

  private recordDeedCompleted(id: SparrowDeedId, playDefaultChime = true): boolean {
    if (playDefaultChime) {
      this.audio.addChaosImpulse(0.68);
    }
    const newlyCompleted = this.journalHud.completeDeed(id);
    if (!newlyCompleted) return false;

    if (playDefaultChime) {
      this.audio.triggerCelestaBell(523.25, 0.09);
    }

    if (
      !this.coronationTriggered &&
      this.coronationPendingDelay < 0 &&
      this.journalHud.getCompletedCount() >= this.journalHud.getTotalCount()
    ) {
      this.coronationPendingDelay = 0.55;
    }
    return true;
  }

  private startCoronationCutscene(): void {
    if (this.coronationTriggered) return;
    this.coronationTriggered = true;
    this.coronationPendingDelay = -1;
    this.coronationActive = true;
    this.coronationElapsed = 0;
    this.coronationCueStage = 0;
    this.coronationLanded = false;
    this.coronationGlintTimer = 0;

    this.sparrow.setCutsceneFrozen(true);
    this.sparrow.sparrowMesh.root.updateMatrixWorld(true);
    this.sparrow.sparrowMesh.crownGroup.getWorldPosition(_crownTargetPos);

    this.coronationSkyOrigin.set(
      _crownTargetPos.x,
      Math.min(123.5, _crownTargetPos.y + 15.5),
      _crownTargetPos.z
    );

    this.skySparkle.root.position.copy(this.coronationSkyOrigin);
    this.skySparkle.root.scale.setScalar(0.01);
    this.skySparkle.root.visible = false;
    this.fallingCrownGroup.position.copy(this.coronationSkyOrigin);
    this.fallingCrownGroup.visible = false;

    this.sparrow.setIntroLookTarget(this.birdCam.camera.position);

    this.birdCam.beginCoronationCutscene(
      this.sparrow.position,
      this.sparrow.yaw,
      this.coronationSkyOrigin,
      this.physics,
      () => {
        this.finishCoronationCutscene();
      }
    );
  }

  private finishCoronationCutscene(): void {
    this.coronationActive = false;
    this.skySparkle.root.visible = false;
    this.fallingCrownGroup.visible = false;
    this.birdCam.setCoronationCrownWorldPos(null);
    this.sparrow.sparrowMesh.setCrownScale(1.0);
    this.sparrow.sparrowMesh.setCrownEquipped(true);
    this.sparrow.setIntroLookTarget(null);
    this.sparrow.setCutsceneFrozen(false);
  }

  private updateCoronationCutscene(dt: number): void {
    this.coronationElapsed += dt;
    const t = this.coronationElapsed;

    // Gentle ascending celesta prelude during camera zoom-out (`0.00s .. 1.25s`)
    if (this.coronationCueStage === 0 && t >= 0.14) {
      this.coronationCueStage = 1;
      this.audio.triggerCelestaBell(523.25, 0.085);
    } else if (this.coronationCueStage === 1 && t >= 0.54) {
      this.coronationCueStage = 2;
      this.audio.triggerCelestaBell(659.25, 0.09);
    } else if (this.coronationCueStage === 2 && t >= 0.94) {
      this.coronationCueStage = 3;
      this.audio.triggerCelestaBell(783.99, 0.095);
    }

    // Sparrow tilts head upward as the camera pans to the sky
    if (t >= 1.18 && t < 4.02) {
      this.sparrow.setIntroLookTarget(this.coronationSkyOrigin);
    } else if (t >= 4.02) {
      this.sparrow.setIntroLookTarget(this.birdCam.camera.position);
    }

    // Sky Sparkle bloom (`1.45s .. 2.65s`)
    if (t >= 1.45 && t < 2.65) {
      if (this.coronationCueStage === 3) {
        this.coronationCueStage = 4;
        this.audio.triggerCelestaBell(1567.98, 0.12);
        this.audio.triggerCelestaBell(2093.0, 0.10);
        this.fx.spawnBurst(this.coronationSkyOrigin, 16, true, 5.6);
        this.fx.spawnChirpRing(this.coronationSkyOrigin, PALETTE.goldGlow, 9.5);
      }
      this.skySparkle.root.visible = true;
      this.skySparkle.root.lookAt(this.birdCam.camera.position);

      let s: number;
      if (t < 1.82) {
        const uIn = smoothstep01((t - 1.45) / (1.82 - 1.45));
        s = 0.1 + uIn * 1.95;
      } else {
        const uOut = smoothstep01((t - 1.82) / (2.65 - 1.82));
        s = 2.05 * (1 - uOut);
      }
      const pulse = 1.0 + Math.sin(t * 22.0) * 0.12;
      this.skySparkle.root.scale.setScalar(Math.max(0.01, s * pulse));
      this.skySparkle.primaryStar.rotation.z = (t - 1.45) * 1.4;
      this.skySparkle.secondaryStar.rotation.z = Math.PI * 0.25 - (t - 1.45) * 2.1;
    } else {
      this.skySparkle.root.visible = false;
    }

    // Tiny Golden Crown falls from the sky sparkle onto the sparrow's head (`1.92s .. 4.02s`)
    const fallStart = 1.92;
    const fallEnd = 4.02;
    if (t >= fallStart && t < fallEnd) {
      const u = Math.max(0, Math.min(1, (t - fallStart) / (fallEnd - fallStart)));
      // Gravity-assisted fall with a soft storybook cushion right above the sparrow's crest
      const dropProgress =
        u < 0.78
          ? Math.pow(u / 0.78, 1.58) * 0.86
          : 0.86 + smoothstep01((u - 0.78) / 0.22) * 0.14;

      this.sparrow.sparrowMesh.root.updateMatrixWorld(true);
      this.sparrow.sparrowMesh.crownGroup.getWorldPosition(_crownTargetPos);
      this.sparrow.sparrowMesh.crownGroup.getWorldQuaternion(_crownTargetQuat);

      this.fallingCrownGroup.visible = true;
      this.fallingCrownGroup.position
        .copy(this.coronationSkyOrigin)
        .lerp(_crownTargetPos, dropProgress);

      // Slightly larger silhouette high in the sky so the tiny crown reads clearly from 18 SU away,
      // converging to exact 1.0x scale as it lands on the sparrow's head
      const skyReadabilityScale = THREE.MathUtils.lerp(2.35, 1.0, smoothstep01(u));
      this.fallingCrownGroup.scale.setScalar(skyReadabilityScale);

      const spinWeight = 1 - smoothstep01(Math.max(0, (u - 0.68) / 0.32));
      _crownSpinEuler.set(
        Math.sin(u * Math.PI * 3.0) * 0.22 * spinWeight,
        (1 - u) * Math.PI * 4.0,
        Math.cos(u * Math.PI * 2.5) * 0.18 * spinWeight
      );
      _crownSpinQuat.setFromEuler(_crownSpinEuler);
      this.fallingCrownGroup.quaternion.copy(_crownTargetQuat).multiply(_crownSpinQuat);

      this.birdCam.setCoronationCrownWorldPos(this.fallingCrownGroup.position);

      this.coronationGlintTimer -= dt;
      if (this.coronationGlintTimer <= 0) {
        this.coronationGlintTimer = 0.12;
        this.fx.spawnBurst(this.fallingCrownGroup.position, 2, true, 1.35);
      }
    } else if (t >= fallEnd) {
      if (!this.coronationLanded) {
        this.coronationLanded = true;
        this.fallingCrownGroup.visible = false;
        this.birdCam.setCoronationCrownWorldPos(null);

        this.sparrow.sparrowMesh.setCrownEquipped(true);
        this.sparrow.sparrowMesh.setCrownScale(1.28);
        this.sparrow.sparrowMesh.root.updateMatrixWorld(true);
        this.sparrow.sparrowMesh.crownGroup.getWorldPosition(_crownTargetPos);

        this.sparrow.triggerIntroChirp();
        this.audio.playVignetteBloom();
        this.audio.triggerCelestaBell(1046.5, 0.13);
        this.audio.triggerCelestaBell(1318.51, 0.11);
        this.fx.spawnBurst(_crownTargetPos, 16, true, 4.0);
        this.fx.spawnChirpRing(this.sparrow.position, PALETTE.goldGlow, 13.5);
        this.journalHud.spawnCoronationToast();
      }

      // Elastic crown-settle pop (`4.02s .. 4.38s`)
      if (t < 4.38) {
        const popU = (t - 4.02) / 0.36;
        const dampedBounce = 1.0 + Math.cos(popU * Math.PI * 2.0) * (1 - popU) * 0.26;
        this.sparrow.sparrowMesh.setCrownScale(dampedBounce);
      } else {
        this.sparrow.sparrowMesh.setCrownScale(1.0);
      }
    }

    if (t >= 5.25 && this.coronationActive) {
      this.finishCoronationCutscene();
    }
  }

  private completeStep1Chirp(): void {
    if (this.step1ChirpDone) return;
    this.step1ChirpDone = true;
    this.world.setLatchReady(true);
    this.audio.triggerCelestaBell(440.0, 0.08);
    this.fx.spawnChirpRing(this.world.atticWindowSillPos, PALETTE.birdBlueTit, 7.5);
  }

  private setSingleAttentionTarget(pos: THREE.Vector3, priority: number): AttentionTarget[] {
    this.attentionEntry.position.copy(pos);
    this.attentionEntry.priority = priority;
    this.attentionTargets[0] = this.attentionEntry;
    this.attentionTargets.length = 1;
    return this.attentionTargets;
  }

  private computeAttentionTargets(): AttentionTarget[] {
    this.attentionTargets.length = 0;

    if (!this.step0MovedDone) {
      let nearestSeed: THREE.Vector3 | null = null;
      let bestDist = Infinity;
      const props = this.physics.props;
      const cageCenter = this.world.cageBounds.center;
      for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        if (
          !prop.consumed &&
          prop.kind === 'seed' &&
          prop.mesh.position.distanceToSquared(cageCenter) < 7.5 * 7.5
        ) {
          const d = prop.mesh.position.distanceToSquared(this.sparrow.position);
          if (d < bestDist) {
            bestDist = d;
            nearestSeed = prop.mesh.position;
          }
        }
      }
      if (nearestSeed) {
        return this.setSingleAttentionTarget(nearestSeed, 2.6);
      }
      return this.attentionTargets;
    }

    if (!this.step2LatchDone) {
      return this.setSingleAttentionTarget(this.world.cageLatchPos, 2.8);
    }

    if (!this.step3HasFlown) {
      return this.setSingleAttentionTarget(this.world.chandelierPerchPos, 2.7);
    }

    if (!this.step4WindowUnlatched) {
      return this.setSingleAttentionTarget(this.world.windowPullRingPos, 2.95);
    }

    if (!this.step5WindowEscaped) {
      return this.setSingleAttentionTarget(
        this.world.isWindowUnlatched()
          ? this.world.atticWindowExitPos
          : this.world.windowLatchPos,
        2.8
      );
    }

    const held = this.sparrow.carriedProp;
    if (!held) return this.attentionTargets;

    if (held.kind === 'sugar_cube' && !this.districtsAwakened[0]) {
      return this.setSingleAttentionTarget(this.world.sleepyMugPos, 2.2);
    }
    if (held.kind === 'shiny_coin' && !this.districtsAwakened[1]) {
      return this.setSingleAttentionTarget(this.world.guitarCasePos, 2.2);
    }
    if (
      (held.kind === 'eyeglasses' || held.kind === 'berry' || held.kind === 'flower_sprig') &&
      !this.districtsAwakened[2]
    ) {
      return this.setSingleAttentionTarget(this.world.painterEaselPos, 2.2);
    }
    if (held.kind === 'brass_key' && !this.districtsAwakened[3]) {
      return this.setSingleAttentionTarget(this.world.musicBoxPos, 2.2);
    }
    if (held.isNestMaterial || (held.kind === 'shiny_coin' && this.districtsAwakened[1])) {
      return this.setSingleAttentionTarget(this.world.skySanctuaryNestPos, 1.9);
    }

    return this.attentionTargets;
  }

  private countAwakenedDistricts(): number {
    let count = 0;
    for (let i = 0; i < this.districtsAwakened.length; i++) {
      if (this.districtsAwakened[i]) count++;
    }
    return count;
  }

  public update(dt: number): void {
    const clamped = Math.min(0.05, dt);
    if (this.chefShooCooldown > 0) this.chefShooCooldown -= clamped;

    // --- 12/12 Missions Coronation Cutscene Trigger & Progression ---
    if (this.coronationPendingDelay >= 0 && !this.coronationTriggered) {
      this.coronationPendingDelay -= clamped;
      if (this.coronationPendingDelay <= 0 && this.sparrow.dizzyState === 'none') {
        this.startCoronationCutscene();
      }
    }
    if (this.coronationActive) {
      this.updateCoronationCutscene(clamped);
    }

    // --- Contextual Conservatory Atelier Tutorial (Desktop Keycaps & Mobile Touch Pills) ---
    if (!this.step5WindowEscaped) {
      if (!this.sparrow.inputEnabled) {
        this.tutorial.setPrompt(null);
      } else {
        if (!this.tutorialEnabledSeen) {
          this.tutorialEnabledSeen = true;
          this.tutorialChirpBaseline = this.sparrow.chirpCount;
        }

        const birdPos = this.sparrow.position;
        if (this.hasPrevBirdPos) {
          const dx = birdPos.x - this.prevBirdPos.x;
          const dz = birdPos.z - this.prevBirdPos.z;
          this.cageHopDistance += Math.hypot(dx, dz);
        } else {
          this.hasPrevBirdPos = true;
        }
        this.prevBirdPos.copy(birdPos);

        if (!this.step0MovedDone && this.cageHopDistance >= 1.25) {
          this.step0MovedDone = true;
          this.audio.triggerCelestaBell(392.0, 0.075);
        }

        const hasPlayerChirped = this.sparrow.chirpCount > this.tutorialChirpBaseline;
        if (!this.step1ChirpDone && hasPlayerChirped) {
          this.completeStep1Chirp();
        } else if (
          !this.step1ChirpDone &&
          this.step0MovedDone &&
          this.sparrow.isMobileInputActive()
        ) {
          this.chirpPromptElapsed += clamped;
          if (this.chirpPromptElapsed >= 0.45) {
            this.sparrow.triggerChirp();
          }
        }

        if (!this.step2LatchDone && this.world.isCageUnlatched()) {
          this.step2LatchDone = true;
          this.world.setWindowLatchReady(true);
        }

        if (this.step2LatchDone && !this.step3HasFlown) {
          this.postUnlatchElapsed += clamped;
          if (this.sparrow.mode === 'flying' || birdPos.x > -66.0) {
            this.step3HasFlown = true;
            this.world.setWindowLatchReady(true);
          }
        }

        if (!this.step4WindowUnlatched && this.world.isWindowBarUnlatched()) {
          this.step4WindowUnlatched = true;
          this.npcs.setCompanionOnboardingState(
            'starter_tit',
            _onboardingBalconyPos,
            true,
            false
          );
        }

        if (!this.world.isInsideAttic(birdPos)) {
          this.step5WindowEscaped = true;
          this.sparrow.tutorialSafeZone = false;
          this.tutorial.complete();
          this.journalHud.setSeedsCount(this.sparrow.seedsGathered);
          this.journalHud.setVisible(true);
          this.audio.playVignetteBloom();
          this.fx.spawnChirpRing(birdPos, PALETTE.goldGlow, 12.0);
          // Place the Blue Tit cleanly on the bistro chair backrest without registering chair perches
          this.npcs.setCompanionOnboardingState(
            'starter_tit',
            _onboardingCafePos,
            false,
            true,
            true
          );
        } else if (this.sparrow.isMobileInputActive()) {
          // Mobile contextual touch prompts (`[DRAG Move] [TAP Hop]`, `[DRAG To Cage Door]`, `[DOUBLE-TAP Fly]`, `[FLY To Window]`)
          const distToCageLatch = birdPos.distanceTo(this.world.cageLatchPos);
          if (!this.step0MovedDone) {
            this.tutorial.setPrompt('WASD');
          } else if (!this.step2LatchDone) {
            this.tutorial.setPrompt(distToCageLatch >= 1.95 ? 'MOBILE_DOOR' : null);
          } else if (!this.step3HasFlown) {
            this.tutorial.setPrompt(this.postUnlatchElapsed >= 0.28 ? 'SPACE' : null);
          } else {
            this.tutorial.setPrompt('MOBILE_WINDOW');
          }
        } else {
          // Desktop contextual single-keycap prompts
          const distToCageLatch = birdPos.distanceTo(this.world.cageLatchPos);
          const distToPullRing = birdPos.distanceTo(this.world.windowPullRingPos);
          const winPos = this.world.windowLatchPos;

          if (!this.step2LatchDone) {
            const canClickPreemptChirp = hasPlayerChirped || this.world.isCageUnlatched();
            if (!this.step0MovedDone) {
              if (canClickPreemptChirp && distToCageLatch < 2.65) {
                this.tutorial.setPrompt('CLICK');
              } else {
                this.tutorial.setPrompt('WASD');
              }
            } else if (
              !canClickPreemptChirp &&
              !this.step1ChirpDone &&
              this.chirpPromptElapsed < 3.4
            ) {
              this.chirpPromptElapsed += clamped;
              this.tutorial.setPrompt('Q');
            } else if (distToCageLatch < 2.65) {
              this.tutorial.setPrompt('CLICK');
            } else {
              this.tutorial.setPrompt(null);
            }
          } else if (!this.step3HasFlown) {
            this.tutorial.setPrompt(this.postUnlatchElapsed >= 0.28 ? 'SPACE' : null);
          } else if (!this.step4WindowUnlatched) {
            this.tutorial.setPrompt(distToPullRing < 5.2 ? 'CLICK' : null);
          } else {
            const nearFrenchWindow =
              Math.abs(birdPos.x - winPos.x) < 4.3 &&
              Math.abs(birdPos.z - winPos.z) < 9.5 &&
              birdPos.y > 29.0 &&
              birdPos.y < 47.5;
            if (
              this.world.isWindowBarUnlatched() &&
              !this.world.isWindowUnlatched() &&
              nearFrenchWindow
            ) {
              this.tutorial.setPrompt('CLICK');
            } else {
              this.tutorial.setPrompt(null);
            }
          }
        }
      }
    }

    // Ongoing Pastry Chef chase if flying past the Boulangerie with a stolen croissant
    if (
      this.sparrow.carriedProp?.kind === 'croissant' &&
      this.chefShooCooldown <= 0 &&
      this.sparrow.position.distanceTo(_chefPatrolOrigin) < 16.0
    ) {
      this.chefShooCooldown = 4.2;
      this.npcs.triggerChefShoo(this.sparrow.position);
    }

    // --- Scan Props for Multi-Block Vignette Deliveries (Carried or Dropped) ---
    const props = this.physics.props;
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      if (prop.consumed || prop.waterRespawnTimer !== undefined) continue;
      const pos = prop.mesh.position;

      // 1. NW Café Quarter: Sugar Cube into Sleepy Commuter's Steaming Coffee Mug
      if (prop.kind === 'sugar_cube' && pos.distanceTo(this.world.sleepyMugPos) < 1.55) {
        this.sparrow.consumeCarriedProp(prop);
        this.physics.removeProp(prop);
        this.audio.playWaterPlop(this.world.sleepyMugPos);
        _ripplePos.set(
          this.world.sleepyMugPos.x,
          this.world.sleepyMugPos.y + 0.04,
          this.world.sleepyMugPos.z
        );
        this.fx.spawnWaterRipple(_ripplePos, 1.2, PALETTE.porcelainWhite);
        this.fx.spawnBurst(this.world.sleepyMugPos, 10, true, 4.0);
        this.npcs.wakeSleepyCommuter();
        this.world.spawnHiddenNewspaperCoin();
        this.recordDeedCompleted('sleepy_sugar', false);
        _focusPos.set(
          this.world.sleepyMugPos.x,
          this.world.sleepyMugPos.y + 0.9,
          this.world.sleepyMugPos.z
        );
        this.awakenDistrict(0, 'starter_tit', _focusPos);
        continue;
      }

      // 2. NE Botanical Park: Shiny Coins into Fountain Busker's Open Velvet Guitar Case
      if (
        !this.districtsAwakened[1] &&
        prop.kind === 'shiny_coin' &&
        pos.distanceTo(this.world.guitarCasePos) < 2.35
      ) {
        this.sparrow.consumeCarriedProp(prop);
        this.physics.removeProp(prop);
        this.coinsDelivered++;
        this.audio.playCoinClink(this.world.guitarCasePos);
        this.fx.spawnBurst(this.world.guitarCasePos, 9, true, 3.8);

        if (this.coinsDelivered >= 3) {
          this.npcs.awakenBusker();
          this.world.fountainJetUpdraft.active = true;
          this.recordDeedCompleted('busker_coins', false);
          this.awakenDistrict(1, 'fountain_robin', _fountainFocusPos);
        }
        continue;
      }

      // 3. SW Sunken Canal: Eyeglasses & Pigment Flowers/Berries to Canal Balcony Painter's Easel
      if (prop.kind === 'eyeglasses' && pos.distanceTo(this.world.painterEaselPos) < 2.85) {
        this.sparrow.consumeCarriedProp(prop);
        this.physics.removeProp(prop);
        this.painterHasGlasses = true;
        this.npcs.givePainterGlasses();
        this.audio.playCoinClink(this.world.painterEaselPos);
        this.fx.spawnBurst(this.world.painterEaselPos, 10, true, 4.2);
        if (this.pigmentsDelivered > 0) {
          this.world.revealPortraitLayer(this.pigmentsDelivered);
        }
        this.checkPainterCompletion();
        continue;
      }

      if (
        (prop.kind === 'berry' || prop.kind === 'flower_sprig') &&
        pos.distanceTo(this.world.painterEaselPos) < 2.85 &&
        !this.districtsAwakened[2]
      ) {
        this.sparrow.consumeCarriedProp(prop);
        this.physics.removeProp(prop);
        this.pigmentsDelivered++;
        this.npcs.triggerPainterStroke();
        this.audio.triggerCelestaBell(880 + this.pigmentsDelivered * 220, 0.14);
        this.fx.spawnBurst(this.world.painterEaselPos, 10, true, 4.2);
        if (this.painterHasGlasses) {
          this.world.revealPortraitLayer(this.pigmentsDelivered);
        }
        this.checkPainterCompletion();
        continue;
      }

      // 4. SE Bookshop Terrace: Brass Key into Clockwork Music-Box
      if (prop.kind === 'brass_key' && pos.distanceTo(this.world.musicBoxPos) < 2.45) {
        this.sparrow.consumeCarriedProp(prop);
        this.physics.removeProp(prop);
        this.world.launchPaperAirplane();
        this.airplanesLaunched = 1;
        this.recordDeedCompleted('music_box', false);
        this.awakenDistrict(3, 'bookshop_warbler', this.world.musicBoxPos);
        continue;
      }

      // 5. SE Clocktower: Weaving Treasures into the Sky Sanctuary Nest
      if (
        (prop.isNestMaterial || (prop.kind === 'shiny_coin' && this.districtsAwakened[1])) &&
        pos.distanceTo(this.world.skySanctuaryNestPos) < 2.85
      ) {
        const tint = prop.tintHex ?? PALETTE.goldGlow;
        this.sparrow.consumeCarriedProp(prop);
        this.physics.removeProp(prop);
        this.world.addVisualWeaveToSanctuaryNest(this.sanctuaryWeaves, tint);
        this.sanctuaryWeaves++;
        this.audio.triggerCelestaBell(1046.5 + this.sanctuaryWeaves * 110, 0.15);
        this.fx.spawnBurst(this.world.skySanctuaryNestPos, 12, true, 4.8);

        if (this.sanctuaryWeaves >= 4 && !this.districtsAwakened[4]) {
          this.recordDeedCompleted('sky_sanctuary', false);
          this.awakenDistrict(4, 'clocktower_finch', this.world.skySanctuaryNestPos);
        }
      }
    }

    if (this.districtsAwakened[3] && this.airplanesLaunched < 5) {
      this.airplaneSpawnTimer += clamped;
      if (this.airplaneSpawnTimer >= 16.0) {
        this.airplaneSpawnTimer = 0;
        this.airplanesLaunched++;
        this.world.launchPaperAirplane();
      }
    }

    // Smoothly shift world lighting & luminous sunlit fog toward Golden Morning Bloom
    const awakenedCount = this.countAwakenedDistricts();
    const targetAwakening = Math.min(
      1.0,
      awakenedCount * 0.16 + Math.min(0.2, this.sanctuaryWeaves * 0.05)
    );
    const curVal = storybookUniforms.awakeningFactor.value as number;
    const nextVal = curVal + (targetAwakening - curVal) * Math.min(1, clamped * 1.2);
    storybookUniforms.awakeningFactor.value = nextVal;

    this.currentFog.copy(this.dawnFog).lerp(this.goldenFog, nextVal);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(this.currentFog);
    }
    this.sunLight.intensity = 1.08 + nextVal * 0.14;
    this.hemiLight.intensity = 0.56 + nextVal * 0.08;
  }

  private checkPainterCompletion(): void {
    if (this.painterHasGlasses && this.pigmentsDelivered >= 2 && !this.districtsAwakened[2]) {
      this.world.revealPortraitLayer(2);
      this.recordDeedCompleted('painter_muse', false);
      this.awakenDistrict(2, 'painter_goldfinch', this.world.painterEaselPos);
    }
  }

  private awakenDistrict(index: number, companionId: string, focusPos: THREE.Vector3): void {
    if (this.districtsAwakened[index]) return;
    this.districtsAwakened[index] = true;

    this.audio.setVignetteLayer(index);
    this.audio.playVignetteBloom();
    this.world.lightDistrictLantern(index);
    this.npcs.sendCompanionToSanctuary(companionId);
    this.fx.spawnChirpRing(focusPos, PALETTE.goldGlow, 12.0);
    this.birdCam.triggerMomentaryFocus(focusPos, 2.0);

    const totalAwakened = this.countAwakenedDistricts();
    if (totalAwakened >= 4 || index === 4) {
      this.fx.setGoldenBloomPetals(true);
      this.npcs.flockModeActive = true;
    }
  }
}
