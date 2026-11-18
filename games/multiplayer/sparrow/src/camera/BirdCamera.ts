import * as THREE from 'three/webgpu';
import type { PhysicsWorld, StaticCameraHit } from '../physics/PhysicsWorld.ts';
import type {
  BirdMode,
  CageKeepInBounds,
  ClosedWindowBarrier,
} from '../entities/SparrowController.ts';

const _backDir = new THREE.Vector3();
const _heroAnchor = new THREE.Vector3();
const _gameplayAnchor = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _cageClamped = new THREE.Vector3();
const _atelierClamped = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _cutsceneProbeOrigin = new THREE.Vector3();
const _cutsceneProbeDir = new THREE.Vector3();
const _cutscenePosA = new THREE.Vector3();
const _cutscenePosB = new THREE.Vector3();
const _cutsceneLookA = new THREE.Vector3();
const _cutsceneLookB = new THREE.Vector3();

function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Over-the-shoulder third-person bird camera.
 * - Opening hero portrait inside the birdcage -> sparrow chirp -> ~159° (π - 0.36 rad) orbit to player control
 * - Close framing inside the brass birdcage & Conservatory Atelier, clamped to avoid bar/wall clipping
 * - Airspeed-scaled pull-back + FOV expansion when flying outdoors
 * - Static-only asymmetric smoothed obstacle avoidance so tabletop props never yank the camera
 */
export class BirdCamera {
  public readonly camera: THREE.PerspectiveCamera;
  public yaw = 0;
  public pitch = 0.22;

  private currentLookAt = new THREE.Vector3();
  private currentPos = new THREE.Vector3();
  private initialized = false;
  private smoothedDist = 2.02;
  private inCageBlend = 1.0;
  private indoorBlend = 1.0;
  private lastNotifiedFov = 54;

  private pointerLocked = false;
  private isDragging = false;
  private manualLookTimer = 0;
  private mobileMode = false;

  // Opening Hero Look -> Chirp -> Smooth Orbit state
  private introState: 'none' | 'waiting' | 'active' = 'none';
  private introElapsed = 0;
  private introWaitElapsed = 0;
  private introChirpFired = false;
  private introOnChirp?: () => void;
  private introOnComplete?: () => void;

  // Gentle outdoor vignette glance (rotates look direction subtly — never translates camera away from bird)
  private readonly focusTarget = new THREE.Vector3();
  private focusTimer = 0;
  private focusBlend = 0;

  // 12/12 Coronation Cutscene camera choreography (zoom out -> pan up to sky sparkle -> track falling crown -> hero settle)
  private coronationActive = false;
  private coronationElapsed = 0;
  private coronationAzimuth = 0;
  private coronationClearDist = 7.4;
  private readonly coronationStartPos = new THREE.Vector3();
  private readonly coronationStartLook = new THREE.Vector3();
  private readonly coronationSkyPos = new THREE.Vector3();
  private readonly coronationTrackPos = new THREE.Vector3();
  private coronationTrackValid = false;
  private coronationOnComplete?: () => void;

  public onProjectionChanged?: () => void;

  constructor(aspect: number, canvas: HTMLCanvasElement, onFirstInteract: () => void) {
    this.camera = new THREE.PerspectiveCamera(54, aspect, 0.22, 880);

    canvas.addEventListener('mousedown', (e) => {
      onFirstInteract();
      if (this.mobileMode || this.introState !== 'none' || this.coronationActive) return;
      const lockActive = this.pointerLocked || document.pointerLockElement === canvas;
      if (!lockActive) {
        if (e.button === 0) {
          this.isDragging = true;
        }
        try {
          const lockReq = canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
          lockReq?.catch?.(() => {});
        } catch {
          // Fall back to drag look
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('blur', () => {
      this.isDragging = false;
    });

    document.addEventListener('visibilitychange', () => {
      this.isDragging = false;
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      if (this.pointerLocked) {
        this.isDragging = false;
      }
      document.body.classList.toggle('pointer-locked', this.pointerLocked);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.mobileMode || this.introState !== 'none' || this.coronationActive) return;
      if (!this.pointerLocked && !this.isDragging) return;
      const sensitivity = 0.0024;
      this.yaw -= e.movementX * sensitivity;
      this.pitch = Math.max(-0.68, Math.min(1.08, this.pitch + e.movementY * sensitivity));
      this.manualLookTimer = 1.6;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private computeTargetFov(isFlying: boolean, speedNorm: number, indoorBlend: number): number {
    if (!this.mobileMode) {
      const outdoorDesktop = isFlying ? 56 + speedNorm * 9 : 54;
      const indoorDesktop = isFlying ? 54.5 + speedNorm * 2.5 : 54;
      return THREE.MathUtils.lerp(outdoorDesktop, indoorDesktop, indoorBlend);
    }
    const isPortrait = this.camera.aspect < 1.0;
    const narrowAspectBoost = isPortrait
      ? THREE.MathUtils.clamp((0.82 - this.camera.aspect) * 16.0, 0, 7.5)
      : 0;
    const baseMobile = isPortrait ? 72.0 + narrowAspectBoost : 66.0;
    const outdoorMobile = isFlying ? baseMobile + 3.0 + speedNorm * 8.5 : baseMobile;
    const indoorMobile = isFlying ? baseMobile + 1.5 + speedNorm * 2.5 : baseMobile;
    return THREE.MathUtils.lerp(outdoorMobile, indoorMobile, indoorBlend);
  }

  private applyImmediateFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) > 0.02) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.lastNotifiedFov = fov;
      this.onProjectionChanged?.();
    }
  }

  public setMobileMode(enabled: boolean): void {
    this.mobileMode = enabled;
    if (enabled) {
      this.isDragging = false;
      this.manualLookTimer = 0;
      if (this.pointerLocked) {
        try {
          document.exitPointerLock?.();
        } catch {
          // Ignore pointer-lock exit errors
        }
      }
    }
    this.applyImmediateFov(this.computeTargetFov(false, 0, this.indoorBlend));
  }

  public isMobileMode(): boolean {
    return this.mobileMode;
  }

  public isIntroActive(): boolean {
    return this.introState !== 'none';
  }

  public isCutsceneActive(): boolean {
    return this.coronationActive;
  }

  public beginCoronationCutscene(
    birdPos: THREE.Vector3,
    birdYaw: number,
    skyPos: THREE.Vector3,
    physics: PhysicsWorld,
    onComplete?: () => void
  ): void {
    this.coronationActive = true;
    this.coronationElapsed = 0;
    this.coronationStartPos.copy(this.currentPos);
    this.coronationStartLook.copy(this.currentLookAt);
    this.coronationSkyPos.copy(skyPos);
    this.coronationTrackValid = false;
    this.coronationOnComplete = onComplete;

    // Pick the cleanest unobstructed azimuth around the sparrow for the wide zoom-out & sky pan
    _cutsceneProbeOrigin.set(birdPos.x, birdPos.y + 1.15, birdPos.z);
    const baseAz = birdYaw + Math.PI * 0.76;
    const offsets = [0, -0.58, 0.58, -1.18, 1.18, Math.PI];
    let bestAz = baseAz;
    let bestClear = 2.6;
    for (let i = 0; i < offsets.length; i++) {
      const az = baseAz + offsets[i];
      _cutsceneProbeDir.set(Math.sin(az), 0.16, Math.cos(az)).normalize();
      const hit = physics.raycastStaticCameraObstacle(_cutsceneProbeOrigin, _cutsceneProbeDir, 8.2);
      const allowed = hit.hit ? Math.max(2.4, hit.distance - 0.55) : 7.6;
      if (allowed > bestClear) {
        bestClear = allowed;
        bestAz = az;
        if (allowed >= 7.2) break;
      }
    }
    this.coronationAzimuth = bestAz;
    this.coronationClearDist = bestClear;
  }

  public setCoronationCrownWorldPos(pos: THREE.Vector3 | null): void {
    if (pos) {
      this.coronationTrackPos.copy(pos);
      this.coronationTrackValid = true;
    } else {
      this.coronationTrackValid = false;
    }
  }

  /**
   * Positions the camera inside the birdcage looking directly at the sunlit Sparrow
   * while waiting on the Start screen.
   */
  public setIntroWaitingPose(birdPos: THREE.Vector3, birdYaw: number): void {
    this.introState = 'waiting';
    this.introElapsed = 0;
    this.introWaitElapsed = 0;
    this.introChirpFired = false;
    this.inCageBlend = 1.0;
    this.indoorBlend = 1.0;

    const isPortrait = this.camera.aspect < 1.0;
    const heroYaw = birdYaw + Math.PI - 0.36;
    const heroPitch = 0.1;
    const heroDist = this.mobileMode ? (isPortrait ? 1.52 : 1.40) : 1.68;

    this.yaw = heroYaw;
    this.pitch = heroPitch;
    this.smoothedDist = heroDist;

    this.currentLookAt.set(birdPos.x, birdPos.y + 0.19, birdPos.z);
    const cosP = Math.cos(heroPitch);
    const sinP = Math.sin(heroPitch);
    _backDir.set(-Math.sin(heroYaw) * cosP, sinP, -Math.cos(heroYaw) * cosP).normalize();

    this.currentPos.copy(this.currentLookAt).addScaledVector(_backDir, heroDist);
    this.applyImmediateFov(this.computeTargetFov(false, 0, this.indoorBlend));
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    this.initialized = true;
  }

  /**
   * Starts the post-"Start" hero presentation:
   * 1. Close look at the Sparrow (0.00s - 0.50s)
   * 2. Sparrow chirps & tilts head (chirp fires at 0.50s)
   * 3. Smooth ~159° (π - 0.36 rad) orbit behind the Sparrow into gameplay control (0.96s - 2.02s)
   */
  public beginIntroSequence(onChirp: () => void, onComplete: () => void): void {
    this.introState = 'active';
    this.introElapsed = 0;
    this.introChirpFired = false;
    this.introOnChirp = onChirp;
    this.introOnComplete = onComplete;
  }

  public setInitialFraming(birdPos: THREE.Vector3, birdYaw: number): void {
    const isPortrait = this.camera.aspect < 1.0;
    const initDist = this.mobileMode ? (isPortrait ? 1.72 : 1.56) : 2.02;
    const initLookY = this.mobileMode ? 0.56 : 0.68;
    this.yaw = birdYaw;
    this.pitch = 0.22;
    this.smoothedDist = initDist;
    this.currentLookAt.set(birdPos.x, birdPos.y + initLookY, birdPos.z);
    this.currentPos.set(
      birdPos.x - Math.sin(this.yaw) * initDist,
      birdPos.y + (this.mobileMode ? 0.88 : 1.08),
      birdPos.z - Math.cos(this.yaw) * initDist
    );
    this.applyImmediateFov(this.computeTargetFov(false, 0, this.indoorBlend));
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
    this.initialized = true;
  }

  public triggerMomentaryFocus(targetWorldPos: THREE.Vector3, duration = 2.1): void {
    this.focusTarget.copy(targetWorldPos);
    this.focusTimer = duration;
  }

  private clampPositionInsideCage(
    pos: THREE.Vector3,
    birdPos: THREE.Vector3,
    cb: CageKeepInBounds,
    out: THREE.Vector3
  ): THREE.Vector3 {
    out.copy(pos);
    const birdHorizDist = Math.hypot(out.x - birdPos.x, out.z - birdPos.z);
    if (birdHorizDist < 1.1) {
      out.y += (1.1 - birdHorizDist) * 0.45;
    }
    out.y = Math.max(cb.floorY - 0.05, Math.min(Math.min(cb.ceilingY - 0.35, 37.5), out.y));

    const domeFactor =
      out.y > 37.05
        ? Math.cos(Math.min(1.05, ((out.y - 37.05) / 2.3) * Math.PI * 0.5))
        : 1.0;
    const maxR = Math.max(1.2, 2.34 * domeFactor); // Inside the 2.68 SU brass cage bars & upper dome
    const dx = out.x - cb.center.x;
    const dz = out.z - cb.center.z;
    const r = Math.hypot(dx, dz);
    if (r > maxR && r > 0.0001) {
      out.x = cb.center.x + (dx / r) * maxR;
      out.z = cb.center.z + (dz / r) * maxR;
    }
    return out;
  }

  public update(params: {
    dt: number;
    birdPos: THREE.Vector3;
    birdForward: THREE.Vector3;
    birdYaw: number;
    mode: BirdMode;
    airspeed: number;
    verticalVel?: number;
    bankAngle: number;
    physics: PhysicsWorld;
    cageBounds?: CageKeepInBounds | null;
    windowBarrier?: ClosedWindowBarrier | null;
    isIndoors?: boolean;
    isMoving?: boolean;
    moveStickX?: number;
    moveStickY?: number;
  }): void {
    const dt = Math.min(0.05, params.dt);
    const isPortrait = this.camera.aspect < 1.0;
    if (!this.initialized) {
      this.setInitialFraming(params.birdPos, params.birdYaw);
    }

    // --- Opening Hero Look -> Chirp -> Smooth Orbit Sequence ---
    if (this.introState === 'waiting' || this.introState === 'active') {
      const heroBaseYaw = params.birdYaw + Math.PI - 0.36;
      const mobileHeroDist = isPortrait ? 1.52 : 1.40;

      if (this.introState === 'waiting') {
        this.introWaitElapsed += dt;
        const gentleSway = Math.sin(this.introWaitElapsed * 1.1) * 0.03;
        this.yaw = heroBaseYaw + gentleSway;
        this.pitch = 0.1;
        const heroDist = this.mobileMode ? mobileHeroDist : 1.68;

        this.currentLookAt.set(params.birdPos.x, params.birdPos.y + 0.19, params.birdPos.z);
        const cosP = Math.cos(this.pitch);
        const sinP = Math.sin(this.pitch);
        _backDir.set(-Math.sin(this.yaw) * cosP, sinP, -Math.cos(this.yaw) * cosP).normalize();
        this.currentPos.copy(this.currentLookAt).addScaledVector(_backDir, heroDist);
        if (params.cageBounds) {
          this.clampPositionInsideCage(this.currentPos, params.birdPos, params.cageBounds, this.currentPos);
        }
        this.camera.position.copy(this.currentPos);
        this.camera.lookAt(this.currentLookAt);
        return;
      }

      // Active post-Start intro sequence
      this.introElapsed += dt;
      if (this.introElapsed >= 0.5 && !this.introChirpFired) {
        this.introChirpFired = true;
        this.introOnChirp?.();
      }

      const orbitStart = 0.96;
      const orbitDur = 1.06;
      const rawT = Math.max(0, Math.min(1, (this.introElapsed - orbitStart) / orbitDur));
      // Quintic smootherstep (C2-continuous) for an eased start & gameplay handoff
      const ease = rawT * rawT * rawT * (rawT * (rawT * 6 - 15) + 10);

      const preOrbitPush = Math.min(1, this.introElapsed / orbitStart);
      const startDist = this.mobileMode
        ? THREE.MathUtils.lerp(mobileHeroDist, mobileHeroDist - 0.06, preOrbitPush)
        : THREE.MathUtils.lerp(1.68, 1.62, preOrbitPush);
      const endDist = this.mobileMode ? (isPortrait ? 1.72 : 1.56) : 2.02;
      const curDist = THREE.MathUtils.lerp(startDist, endDist, ease);

      this.yaw = heroBaseYaw - (Math.PI - 0.36) * ease;
      this.pitch = THREE.MathUtils.lerp(0.1, 0.22, ease);
      this.smoothedDist = curDist;

      const endSinY = Math.sin(params.birdYaw);
      const endCosY = Math.cos(params.birdYaw);
      const endRightX = -endCosY;
      const endRightZ = endSinY;
      const endShoulder = this.mobileMode ? (isPortrait ? 0.06 : 0.09) : 0.16;
      const endHeight = this.mobileMode ? 0.56 : 0.68;

      _heroAnchor.set(params.birdPos.x, params.birdPos.y + 0.19, params.birdPos.z);
      _gameplayAnchor.set(
        params.birdPos.x + endRightX * endShoulder + endSinY * 0.04,
        params.birdPos.y + endHeight,
        params.birdPos.z + endRightZ * endShoulder + endCosY * 0.04
      );
      this.currentLookAt.copy(_heroAnchor).lerp(_gameplayAnchor, ease);

      const cosP = Math.cos(this.pitch);
      const sinP = Math.sin(this.pitch);
      _backDir.set(-Math.sin(this.yaw) * cosP, sinP, -Math.cos(this.yaw) * cosP).normalize();

      this.currentPos.copy(this.currentLookAt).addScaledVector(_backDir, curDist);
      if (params.cageBounds) {
        this.clampPositionInsideCage(this.currentPos, params.birdPos, params.cageBounds, this.currentPos);
      }

      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);

      if (this.introElapsed >= orbitStart + orbitDur) {
        this.introState = 'none';
        this.yaw = params.birdYaw;
        this.pitch = 0.22;
        this.smoothedDist = endDist;
        this.manualLookTimer = 0;
        const done = this.introOnComplete;
        this.introOnComplete = undefined;
        this.introOnChirp = undefined;
        done?.();
      }
      return;
    }

    // --- 12/12 Missions Coronation Cutscene ---
    if (this.coronationActive) {
      this.coronationElapsed += dt;
      const t = this.coronationElapsed;
      const totalDur = 5.15;
      const sinAz = Math.sin(this.coronationAzimuth);
      const cosAz = Math.cos(this.coronationAzimuth);
      const wideDist = this.coronationClearDist;
      const heroCloseDist = Math.min(wideDist, this.mobileMode ? 2.25 : 2.55);

      const birdFocusY = params.birdPos.y + 0.34;
      const widePosX = params.birdPos.x + sinAz * wideDist;
      const widePosY = Math.max(0.85, params.birdPos.y + 1.75);
      const widePosZ = params.birdPos.z + cosAz * wideDist;

      const skyCamPosX = params.birdPos.x + sinAz * (wideDist * 1.04);
      const skyCamPosY = Math.max(0.75, params.birdPos.y + 1.05);
      const skyCamPosZ = params.birdPos.z + cosAz * (wideDist * 1.04);

      const heroPosX = params.birdPos.x + sinAz * heroCloseDist;
      const heroPosY = Math.max(0.75, params.birdPos.y + 0.68);
      const heroPosZ = params.birdPos.z + cosAz * heroCloseDist;

      if (t < 1.25) {
        // Phase 1: Smooth zoom-out framing the sparrow in the sunlit square
        const u = smoothstep01(t / 1.25);
        _cutscenePosA.set(widePosX, widePosY, widePosZ);
        _cutsceneLookA.set(params.birdPos.x, birdFocusY, params.birdPos.z);
        this.currentPos.copy(this.coronationStartPos).lerp(_cutscenePosA, u);
        this.currentLookAt.copy(this.coronationStartLook).lerp(_cutsceneLookA, u);
      } else if (t < 2.25) {
        // Phase 2: Pan upward toward the sunlit sky where the golden sparkle blooms
        const u = smoothstep01((t - 1.25) / 1.0);
        _cutscenePosA.set(widePosX, widePosY, widePosZ);
        _cutscenePosB.set(skyCamPosX, skyCamPosY, skyCamPosZ);
        _cutsceneLookA.set(params.birdPos.x, birdFocusY, params.birdPos.z);
        this.currentPos.copy(_cutscenePosA).lerp(_cutscenePosB, u);
        this.currentLookAt.copy(_cutsceneLookA).lerp(this.coronationSkyPos, u);
      } else if (t < 4.02) {
        // Phase 3: Track the tiny golden crown falling from the sky down onto the sparrow's head
        const u = smoothstep01((t - 2.25) / (4.02 - 2.25));
        _cutscenePosA.set(skyCamPosX, skyCamPosY, skyCamPosZ);
        _cutscenePosB.set(heroPosX, heroPosY, heroPosZ);
        this.currentPos.copy(_cutscenePosA).lerp(_cutscenePosB, u);
        if (this.coronationTrackValid) {
          this.currentLookAt.lerp(this.coronationTrackPos, Math.min(1, dt * 14.0));
        } else {
          _cutsceneLookB.set(params.birdPos.x, birdFocusY, params.birdPos.z);
          this.currentLookAt.copy(this.coronationSkyPos).lerp(_cutsceneLookB, u);
        }
      } else if (t < 4.55) {
        // Phase 4A: Hold close hero shot on the newly crowned sparrow
        _cutscenePosB.set(heroPosX, heroPosY, heroPosZ);
        _cutsceneLookB.set(params.birdPos.x, params.birdPos.y + 0.30, params.birdPos.z);
        this.currentPos.lerp(_cutscenePosB, Math.min(1, dt * 10.0));
        this.currentLookAt.lerp(_cutsceneLookB, Math.min(1, dt * 12.0));
      } else {
        // Phase 4B: Smoothly ease from hero coronation shot back to gameplay framing behind birdYaw
        const u = smoothstep01((t - 4.55) / (totalDur - 4.55));
        const mobileScale = this.mobileMode ? (isPortrait ? 0.72 : 0.65) : 1.0;
        const endDist = (params.mode === 'flying' ? 5.5 : 4.25) * mobileScale;
        const endPitch = 0.22;
        const endSinY = Math.sin(params.birdYaw);
        const endCosY = Math.cos(params.birdYaw);
        const endCosP = Math.cos(endPitch);
        const endSinP = Math.sin(endPitch);
        const endHeight = (params.mode === 'flying' ? 1.14 : 0.96) * (this.mobileMode ? 0.8 : 1.0);
        _gameplayAnchor.set(params.birdPos.x, params.birdPos.y + endHeight, params.birdPos.z);
        _backDir.set(-endSinY * endCosP, endSinP, -endCosY * endCosP).normalize();
        _cutscenePosB.copy(_gameplayAnchor).addScaledVector(_backDir, endDist);
        _cutscenePosA.set(heroPosX, heroPosY, heroPosZ);
        _cutsceneLookA.set(params.birdPos.x, params.birdPos.y + 0.30, params.birdPos.z);

        this.currentPos.copy(_cutscenePosA).lerp(_cutscenePosB, u);
        this.currentLookAt.copy(_cutsceneLookA).lerp(_gameplayAnchor, u);

        if (t >= totalDur) {
          this.coronationActive = false;
          this.yaw = params.birdYaw;
          this.pitch = endPitch;
          this.smoothedDist = endDist;
          this.manualLookTimer = 0;
          const cbDone = this.coronationOnComplete;
          this.coronationOnComplete = undefined;
          cbDone?.();
        }
      }

      const cutsceneFov = this.computeTargetFov(false, 0, this.indoorBlend);
      if (Math.abs(this.camera.fov - cutsceneFov) > 0.05) {
        this.camera.fov += (cutsceneFov - this.camera.fov) * Math.min(1, dt * 4.5);
        this.camera.updateProjectionMatrix();
        if (Math.abs(this.camera.fov - this.lastNotifiedFov) >= 0.12) {
          this.lastNotifiedFov = this.camera.fov;
          this.onProjectionChanged?.();
        }
      }
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLookAt);
      return;
    }

    // --- Normal Gameplay Third-Person Framing ---
    const isFlying = params.mode === 'flying';
    const isIndoors = Boolean(params.isIndoors);
    const cb = params.cageBounds ?? null;
    let birdInCage = false;
    if (cb) {
      if (cb.locked) {
        birdInCage = true;
      } else if (
        params.birdPos.y >= cb.floorY - 0.6 &&
        params.birdPos.y <= cb.ceilingY + 0.4
      ) {
        const c = cb.center;
        let maxR = 2.55;
        if (params.birdPos.y > c.y + 3.3) {
          const domeU = Math.min(1, (params.birdPos.y - (c.y + 3.3)) / 2.25);
          maxR = 2.55 * Math.sqrt(Math.max(0.06, 1 - domeU * domeU));
        }
        birdInCage = Math.hypot(params.birdPos.x - c.x, params.birdPos.z - c.z) < maxR;
      }
    }

    this.inCageBlend += ((birdInCage ? 1 : 0) - this.inCageBlend) * (1 - Math.exp(-dt * 4.5));
    this.indoorBlend += ((isIndoors ? 1 : 0) - this.indoorBlend) * (1 - Math.exp(-dt * 3.8));

    if (this.mobileMode) {
      // Automatic camera follow & pitch adjustment on mobile (no manual camera look)
      this.manualLookTimer = 0;
      if (isFlying) {
        let diff = params.birdYaw - this.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.yaw += diff * Math.min(1, dt * (isIndoors ? 2.6 : 3.25));

        const vVel = params.verticalVel ?? 0;
        const targetFlightPitch = THREE.MathUtils.clamp(0.21 - vVel * 0.012, 0.10, 0.38);
        this.pitch += (targetFlightPitch - this.pitch) * Math.min(1, dt * 3.2);
      } else {
        const sx = params.moveStickX ?? 0;
        const sy = params.moveStickY ?? 0;
        const backingStraightUp = sy < -0.45 && Math.abs(sx) < 0.35;
        if (params.isMoving && !backingStraightUp) {
          let diff = params.birdYaw - this.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turnFollowRate = sy >= -0.05 ? 2.45 : 1.25;
          this.yaw += diff * Math.min(1, dt * turnFollowRate);
        }
        const targetGroundPitch = isIndoors ? 0.23 : 0.21;
        this.pitch += (targetGroundPitch - this.pitch) * Math.min(1, dt * 2.8);
      }
    } else if (this.manualLookTimer > 0) {
      this.manualLookTimer = Math.max(0, this.manualLookTimer - dt);
    } else if (isFlying) {
      // Auto-follow behind the flight heading only in flying mode, so grounded WASD hopping does not swing the camera
      let diff = params.birdYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, dt * (isIndoors ? 1.85 : 2.35));
    }

    const speedNorm = Math.min(1, params.airspeed / 26);
    const mobileDistScale = this.mobileMode ? (isPortrait ? 0.72 : 0.65) : 1.0;

    const outDist = (isFlying ? 5.5 + speedNorm * 1.65 : 4.25) * mobileDistScale;
    const inDist = (isFlying ? 3.6 + speedNorm * 0.45 : 3.1) * mobileDistScale;
    const cageDist = this.mobileMode ? (isPortrait ? 1.72 : 1.56) : 2.02;
    const baseDist = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(outDist, inDist, this.indoorBlend),
      cageDist,
      this.inCageBlend
    );

    const shoulderScale = this.mobileMode ? (isPortrait ? 0.38 : 0.55) : 1.0;
    const outShoulder = (isFlying ? 0.26 - params.bankAngle * 0.34 : 0.34) * shoulderScale;
    const inShoulder = (isFlying ? 0.18 - params.bankAngle * 0.18 : 0.22) * shoulderScale;
    const shoulderRight = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(outShoulder, inShoulder, this.indoorBlend),
      0.16 * shoulderScale,
      this.inCageBlend
    );

    const heightScale = this.mobileMode ? 0.80 : 1.0;
    const outHeight = (isFlying ? 1.14 : 0.96) * heightScale;
    const inHeight = (isFlying ? 0.82 : 0.76) * heightScale;
    const heightOffset = THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(outHeight, inHeight, this.indoorBlend),
      this.mobileMode ? 0.56 : 0.68,
      this.inCageBlend
    );

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);

    const rightX = -cosY;
    const rightZ = sinY;

    // Grounded/perched uses camera forward so hopping S/A/D never flips the camera anchor
    const leadX = isFlying ? params.birdForward.x * 0.38 : sinY * 0.04;
    const leadZ = isFlying ? params.birdForward.z * 0.38 : cosY * 0.04;

    _anchor.set(
      params.birdPos.x + rightX * shoulderRight + leadX,
      params.birdPos.y + heightOffset,
      params.birdPos.z + rightZ * shoulderRight + leadZ
    );

    _backDir.set(-sinY * cosP, sinP, -cosY * cosP).normalize();

    // Static-only collision check (ignores dynamic tabletop props) + asymmetric exponential distance damper
    let rawAllowedDist = baseDist;
    if (this.inCageBlend < 0.75) {
      const _camObstacleHit: StaticCameraHit = params.physics.raycastStaticCameraObstacle(
        _anchor,
        _backDir,
        baseDist + 0.45
      );
      if (_camObstacleHit.hit && _camObstacleHit.distance < baseDist + 0.35) {
        rawAllowedDist = Math.max(this.mobileMode ? 0.78 : 0.95, _camObstacleHit.distance - 0.34);
      }
    }

    const distRate = rawAllowedDist < this.smoothedDist ? 18.0 : 4.2;
    this.smoothedDist += (rawAllowedDist - this.smoothedDist) * (1 - Math.exp(-dt * distRate));

    _desiredPos.copy(_anchor).addScaledVector(_backDir, this.smoothedDist);
    _desiredPos.y = Math.max(0.55, _desiredPos.y);

    // Smooth cylindrical keep-in inside the brass birdcage so cage bars never cross behind the camera
    if (cb && this.inCageBlend > 0.01) {
      this.clampPositionInsideCage(_desiredPos, params.birdPos, cb, _cageClamped);
      _desiredPos.lerp(_cageClamped, this.inCageBlend);
    }

    // Smooth interior bounds clamp across the Conservatory Atelier & East French window threshold [-40.4, -38.8]
    const inAtelierTransition =
      isIndoors ||
      (params.birdPos.x >= -86.6 &&
        params.birdPos.x < -38.8 &&
        params.birdPos.y >= 26.2 &&
        params.birdPos.y <= 51.6 &&
        params.birdPos.z >= 25.4 &&
        params.birdPos.z <= 78.6);
    if (inAtelierTransition && params.birdPos.x < -38.8) {
      const exitT = THREE.MathUtils.clamp((params.birdPos.x - -40.4) / (-38.8 - -40.4), 0, 1);
      const clampWeight = 1 - exitT * exitT * (3 - 2 * exitT);

      _atelierClamped.copy(_desiredPos);
      _atelierClamped.x = Math.max(-85.32, _atelierClamped.x);
      _atelierClamped.z = Math.max(26.68, Math.min(77.32, _atelierClamped.z));
      _atelierClamped.y = Math.max(26.85, Math.min(50.55, _atelierClamped.y));

      // Keep camera outside the plaster chimney breast (`front z = 26.725`) & regulator clock (`front z = 27.45`)
      if (
        _atelierClamped.y >= 35.35 &&
        _atelierClamped.x > -68.1 &&
        _atelierClamped.x < -55.9 &&
        _atelierClamped.z < 27.68
      ) {
        _atelierClamped.z = 27.68;
      }
      if (
        _atelierClamped.y >= 37.3 &&
        _atelierClamped.y <= 45.3 &&
        _atelierClamped.x > -64.3 &&
        _atelierClamped.x < -59.7 &&
        _atelierClamped.z < 28.18
      ) {
        _atelierClamped.z = 28.18;
      }

      const inOpenWindowAperture =
        !params.windowBarrier?.closed &&
        _atelierClamped.z >= 44.2 &&
        _atelierClamped.z <= 59.8 &&
        _atelierClamped.y >= 31.4 &&
        _atelierClamped.y <= 47.7;
      if (!inOpenWindowAperture) {
        _atelierClamped.x = Math.min(-40.42, _atelierClamped.x);
      }

      _desiredPos.lerp(_atelierClamped, clampWeight);
    }

    // Outdoor look-only glance when a neighborhood vignette blooms (camera position is unchanged)
    _lookTarget.copy(_anchor);
    if (!isIndoors && this.focusTimer > 0) {
      this.focusTimer -= dt;
      this.focusBlend += (0.18 - this.focusBlend) * Math.min(1, dt * 3.5);
    } else {
      this.focusBlend += (0 - this.focusBlend) * Math.min(1, dt * 3.0);
    }
    if (this.focusBlend > 0.005) {
      _lookTarget.lerp(this.focusTarget, this.focusBlend);
    }

    const posFollowXZ = 1 - Math.exp(-dt * (isFlying ? 11.5 : 13.5));
    const cageGroundSoftY = !isFlying ? this.inCageBlend : 0;
    const posFollowY =
      1 - Math.exp(-dt * (isFlying ? 11.5 : THREE.MathUtils.lerp(13.0, 6.8, cageGroundSoftY)));
    const lookFollowXZ = 1 - Math.exp(-dt * 16.0);
    const lookFollowY =
      1 - Math.exp(-dt * THREE.MathUtils.lerp(16.0, 8.2, cageGroundSoftY));

    this.currentPos.x += (_desiredPos.x - this.currentPos.x) * posFollowXZ;
    this.currentPos.y += (_desiredPos.y - this.currentPos.y) * posFollowY;
    this.currentPos.z += (_desiredPos.z - this.currentPos.z) * posFollowXZ;
    this.currentLookAt.x += (_lookTarget.x - this.currentLookAt.x) * lookFollowXZ;
    this.currentLookAt.y += (_lookTarget.y - this.currentLookAt.y) * lookFollowY;
    this.currentLookAt.z += (_lookTarget.z - this.currentLookAt.z) * lookFollowXZ;

    // Steady FOV indoors; airspeed-scaled expansion outdoors + wide mobile field of view
    const targetFov = this.computeTargetFov(isFlying, speedNorm, this.indoorBlend);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 4.5);
      this.camera.updateProjectionMatrix();
      if (Math.abs(this.camera.fov - this.lastNotifiedFov) >= 0.12) {
        this.lastNotifiedFov = this.camera.fov;
        this.onProjectionChanged?.();
      }
    }

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}
