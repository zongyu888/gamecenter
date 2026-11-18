/// <reference types="vite/client" />
import * as THREE from 'three/webgpu';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';
import { PALETTE } from './rendering/Palette.ts';
import {
  createSkyDomeMesh,
  createStorybookRenderPipeline,
  storybookUniforms,
} from './rendering/StorybookMaterial.ts';
import { WorldFX } from './rendering/WorldFX.ts';
import { PhysicsWorld } from './physics/PhysicsWorld.ts';
import { PerchSystem } from './world/PerchSystem.ts';
import { CityBlockBuilder } from './world/CityBlockBuilder.ts';
import { NPCManager } from './entities/NPCManager.ts';
import { SparrowController } from './entities/SparrowController.ts';
import { BirdCamera } from './camera/BirdCamera.ts';
import { AcousticSoundtrack } from './audio/AcousticSoundtrack.ts';
import { VignetteDirector } from './game/VignetteDirector.ts';
import { TutorialOverlay } from './ui/TutorialOverlay.ts';
import { SparrowJournalHUD } from './ui/SparrowJournalHUD.ts';
import {
  MobileTouchControls,
  detectInitialMobileDevice,
} from './ui/MobileTouchControls.ts';
import type { LoadingScreen } from './ui/LoadingScreen.ts';

const isSoftwareGl = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
})();

function computeCappedDpr(w: number, h: number, isMobile = false): number {
  if (isSoftwareGl) return 1;
  const pixelBudget = isMobile ? 1_650_000 : 3_686_400;
  const maxDpr = isMobile ? 1.75 : 2.0;
  const maxDprByBudget = Math.sqrt(pixelBudget / Math.max(1, w * h));
  return Math.max(1, Math.min(window.devicePixelRatio || 1, maxDpr, maxDprByBudget));
}

export async function startGameApp(loadingScreen: LoadingScreen): Promise<void> {
  await loadingScreen.advance(8);

  const container = document.getElementById('app');
  if (!container) return;

  const initW = Math.max(1, window.innerWidth);
  const initH = Math.max(1, window.innerHeight);
  let isMobile = detectInitialMobileDevice();

  const renderer = new THREE.WebGPURenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(computeCappedDpr(initW, initH, isMobile));
  renderer.setSize(initW, initH);
  renderer.toneMappingExposure = 0.98;

  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  container.replaceChildren(renderer.domElement);
  const tutorialOverlay = new TutorialOverlay(container);
  const journalHud = new SparrowJournalHUD(container);
  const mobileControls = new MobileTouchControls(container);
  isMobile = mobileControls.isMobile();
  document.body.classList.toggle('is-mobile', isMobile);
  tutorialOverlay.setMobileMode(isMobile);
  journalHud.setMobileMode(isMobile);

  await renderer.init();

  const drawSize = new THREE.Vector2();
  const syncDrawingBufferResolution = (): void => {
    renderer.getDrawingBufferSize(drawSize);
    storybookUniforms.invResolution.value.set(
      1.0 / Math.max(1, drawSize.x),
      1.0 / Math.max(1, drawSize.y)
    );
  };
  syncDrawingBufferResolution();

  await loadingScreen.advance(14);

  // Morning scene + procedural TSL sky dome + light atmospheric haze
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyHorizonDawn);
  scene.fog = new THREE.FogExp2(PALETTE.fogDawn, 0.00046);

  const skyDome = createSkyDomeMesh();
  scene.add(skyDome);

  // Sky-to-limestone hemisphere fill + directional sun with 3-cascade CSM shadows
  const hemiLight = new THREE.HemisphereLight(PALETTE.skyMidDawn, PALETTE.plazaWarmStone, 0.56);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff2da, 1.08);
  sunLight.position.set(68, 118, 52);
  sunLight.target.position.set(0, 0, 0);
  sunLight.castShadow = !isSoftwareGl;
  const shadowRes = isMobile ? 1024 : 2048;
  sunLight.shadow.mapSize.set(shadowRes, shadowRes);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 2400;
  sunLight.shadow.bias = -0.000046;
  sunLight.shadow.normalBias = 0.028;
  sunLight.shadow.radius = 1.8;

  const csmNode = new CSMShadowNode(sunLight, {
    cascades: 3,
    maxFar: 640,
    mode: 'custom',
    lightMargin: 320,
    customSplitsCallback: (_cascades: number, _near: number, _far: number, breaks: number[]) => {
      breaks.push(0.032, 0.17, 1.0);
    },
  });
  csmNode.fade = false;
  if (!isSoftwareGl) {
    (
      sunLight.shadow as THREE.DirectionalLightShadow & { shadowNode?: CSMShadowNode }
    ).shadowNode = csmNode;
  }

  scene.add(sunLight);
  scene.add(sunLight.target);
  sunLight.updateMatrixWorld();
  sunLight.target.updateMatrixWorld();

  // Warm multi-layered morning fill inside the vaulted Conservatory Atelier (static, never toggled at runtime)
  const atticWindowFill = new THREE.PointLight(0xfff1d6, 5.6, 62.0, 1.25);
  atticWindowFill.position.set(-44.0, 40.5, 52.0);
  scene.add(atticWindowFill);

  const atticStudioWarmFill = new THREE.PointLight(0xffdfba, 4.8, 48.0, 1.32);
  atticStudioWarmFill.position.set(-67.5, 41.5, 50.0);
  scene.add(atticStudioWarmFill);

  // Core Subsystems
  const audio = new AcousticSoundtrack();
  const audioPreloadPromise = audio.preload();
  journalHud.onToggleMute = () => audio.toggleMute();

  const fx = new WorldFX(scene);
  const physics = new PhysicsWorld();
  const perches = new PerchSystem();
  const npcs = new NPCManager(scene, perches, physics, audio, fx);

  // Build the 4-block neighborhood & conservatory atelier, reporting loading progress
  const cityBuilder = new CityBlockBuilder(scene, physics, perches, fx, npcs, audio);
  const worldHandles = await cityBuilder.build((pct) => loadingScreen.advance(pct));

  const wakeAudio = () => {
    try {
      audio.unlock();
    } catch (err) {
      console.error('Audio unlock failed:', err);
    }
  };

  const birdCam = new BirdCamera(initW / initH, renderer.domElement, wakeAudio);
  birdCam.setMobileMode(isMobile);
  birdCam.onProjectionChanged = () => {
    if (csmNode.mainFrustum) {
      csmNode.updateFrustums();
    }
  };

  const sparrow = new SparrowController(
    scene,
    renderer.domElement,
    worldHandles.starterSpawnPos,
    worldHandles.starterSpawnYaw,
    perches,
    physics,
    audio,
    fx,
    wakeAudio
  );
  sparrow.cageBounds = worldHandles.cageBounds;
  sparrow.windowBarrier = worldHandles.windowBarrier;
  sparrow.npcs = npcs;
  sparrow.worldHandles = worldHandles;
  sparrow.attachMobileControls(mobileControls);
  sparrow.inputEnabled = false;

  mobileControls.onMobileModeChange = (mobile) => {
    isMobile = mobile;
    document.body.classList.toggle('is-mobile', mobile);
    tutorialOverlay.setMobileMode(mobile);
    journalHud.setMobileMode(mobile);
    birdCam.setMobileMode(mobile);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(computeCappedDpr(w, h, mobile));
    syncDrawingBufferResolution();
  };

  // Prop shatter: ceramic / pigment-jar / terracotta debris, spatial shatter audio, acoustic shock & mischief chirp
  physics.onPropShatter = (_prop, pos, shardHex) => {
    fx.spawnShatterDebris(pos, shardHex);
    audio.playCeramicShatter(pos);
    npcs.notifyAcousticShock(pos, 'shatter');
    sparrow.triggerMischiefChirp();
  };

  // Material-specific 3D physics prop bounce/clatter SFX & deep water splosh on fountain/river plunge
  physics.onPropImpact = (prop, pos, speed) => {
    audio.playPropImpact(prop.kind, pos, speed);
    if (speed > 7.5) {
      npcs.notifyAcousticShock(pos, 'topple');
    }
  };
  physics.onPropWaterSplosh = (_prop, pos, speed) => {
    const scale = Math.max(0.75, Math.min(1.65, 0.72 + speed * 0.08));
    fx.spawnWaterSplash(pos, scale);
    audio.playWaterSplosh(pos, scale);
  };

  birdCam.setIntroWaitingPose(sparrow.position, sparrow.yaw);
  sparrow.setIntroLookTarget(birdCam.camera.position);

  sparrow.onChirpCallback = (chirpPos) => {
    npcs.handlePlayerChirp(chirpPos);
  };
  sparrow.onPropDroppedCallback = (prop) => {
    npcs.notifyPropDropped(prop);
  };

  const director = new VignetteDirector(
    scene,
    sunLight,
    hemiLight,
    physics,
    sparrow,
    npcs,
    audio,
    fx,
    birdCam,
    worldHandles,
    tutorialOverlay,
    journalHud
  );

  // WebGPU post-processing pipeline (GTAO + ink contours + highlight roll-off + gouache grade)
  await loadingScreen.advance(95);
  let renderPipeline: THREE.RenderPipeline | null = null;
  let compilePassesAsync: (() => Promise<void>) | null = null;
  if (!isSoftwareGl) {
    try {
      const built = createStorybookRenderPipeline(renderer, scene, birdCam.camera, { isMobile });
      renderPipeline = built.renderPipeline;
      compilePassesAsync = built.compilePassesAsync;
    } catch {
      renderPipeline = null;
    }
  }
  renderer.toneMapping = renderPipeline ? THREE.NoToneMapping : THREE.NeutralToneMapping;

  // Pre-warm all WebGPU pipelines (all 4 city quadrants, water shimmer, foliage sway, NPCs, pooled FX,
  // prePass MRT, 4x MSAA scenePass, 3 CSM shadow cascades, GTAO & composite) + audio preload before showing START
  await loadingScreen.advance(97);
  if (!isSoftwareGl) {
    const savedStates: Array<{ obj: THREE.Object3D; visible: boolean; frustumCulled: boolean }> = [];
    scene.traverse((obj) => {
      savedStates.push({ obj, visible: obj.visible, frustumCulled: obj.frustumCulled });
      obj.visible = true;
      obj.frustumCulled = false;
    });
    scene.updateMatrixWorld(true);

    try {
      if (compilePassesAsync) {
        await compilePassesAsync();
      } else {
        await renderer.compileAsync(scene, birdCam.camera);
      }
      if (renderPipeline) {
        renderPipeline.render();
      } else {
        renderer.render(scene, birdCam.camera);
      }
    } finally {
      for (let i = 0; i < savedStates.length; i++) {
        const s = savedStates[i];
        s.obj.visible = s.visible;
        s.obj.frustumCulled = s.frustumCulled;
      }
    }
  }

  await audioPreloadPromise;

  // Render clean waiting portrait frame before revealing START
  if (renderPipeline) {
    renderPipeline.render();
  } else {
    renderer.render(scene, birdCam.camera);
  }

  // Local-only telemetry handle for deterministic verification
  const allowLocalTelemetry =
    import.meta.env.DEV ||
    ((window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
      new URLSearchParams(window.location.search).get('telemetry') === '1');
  if (allowLocalTelemetry) {
    (window as unknown as Record<string, unknown>).__SPARROW_DEBUG__ = {
      sparrow,
      birdCam,
      worldHandles,
      director,
      tutorialOverlay,
      journalHud,
      mobileControls,
      loadingScreen,
      physics,
      npcs,
      fx,
      audio,
      csmNode,
      scene,
      renderer,
      renderPipeline,
    };
  }

  window.addEventListener('resize', () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    birdCam.camera.aspect = w / h;
    birdCam.camera.updateProjectionMatrix();
    if (csmNode.mainFrustum) {
      csmNode.updateFrustums();
    }
    renderer.setPixelRatio(computeCappedDpr(w, h, isMobile));
    renderer.setSize(w, h);
    syncDrawingBufferResolution();
  });

  let lastTime = performance.now();
  let elapsed = 0;
  const fwdTmp = new THREE.Vector3();
  const camFwdTmp = new THREE.Vector3();
  const camUpTmp = new THREE.Vector3();

  void loadingScreen.waitForStart().then(() => {
    wakeAudio();
    sparrow.clearQueuedInputs();
    birdCam.beginIntroSequence(
      () => {
        sparrow.triggerIntroChirp();
      },
      () => {
        sparrow.setIntroLookTarget(null);
        sparrow.clearQueuedInputs();
        sparrow.inputEnabled = true;
      }
    );
  });

  const stepFrame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
    lastTime = now;
    elapsed += dt;

    // 1. Physics & Animated World Props
    physics.update(dt, (ripplePos, scale) => {
      fx.spawnWaterRipple(ripplePos, scale);
      audio.playWaterPlop(ripplePos);
    });
    worldHandles.updateAnimatedProps(dt, elapsed);

    // Indoor flag (camera + audio only). Lights stay constant across indoor/outdoor transitions:
    // changing light.visible invalidates the WebGPU LightsNode and recompiles all lit shaders.
    const isIndoors = worldHandles.isInsideAttic(sparrow.position);

    // 2. Bird Controller & Over-the-Shoulder Camera
    if (birdCam.isIntroActive()) {
      sparrow.setIntroLookTarget(birdCam.camera.position);
    }
    sparrow.update(dt, elapsed, birdCam.yaw);
    sparrow.getForwardVector(fwdTmp);
    const stickState = sparrow.getMobileStick();
    const isMoving =
      (stickState?.active === true && stickState.magnitude > 0.16) ||
      Math.hypot(sparrow.velocity.x, sparrow.velocity.z) > 0.45;
    birdCam.update({
      dt,
      birdPos: sparrow.position,
      birdForward: fwdTmp,
      birdYaw: sparrow.yaw,
      mode: sparrow.mode,
      airspeed: sparrow.getAirspeed(),
      verticalVel: sparrow.velocity.y,
      bankAngle: sparrow.getBankAngle(),
      physics,
      cageBounds: sparrow.cageBounds,
      windowBarrier: sparrow.windowBarrier,
      isIndoors,
      isMoving,
      moveStickX: stickState?.active ? stickState.x : 0,
      moveStickY: stickState?.active ? stickState.y : 0,
    });

    // Keep Sky Dome centered horizontally on camera (CSMShadowNode updates its 3 shadow cascades itself)
    skyDome.position.set(birdCam.camera.position.x, 0, birdCam.camera.position.z);

    // 3. NPCs, Companion Songbirds, Pigeon Flock, Deeds & Spatial Soundscape
    npcs.update(
      dt,
      elapsed,
      sparrow.position,
      sparrow.velocity,
      sparrow.yaw,
      sparrow.activePerchId,
      sparrow.mode,
      sparrow.carriedProp?.kind ?? null,
      worldHandles.getTramX(),
      worldHandles.getCanalBoats()
    );
    director.update(dt);
    fx.update(dt, elapsed);

    const buskerDist = sparrow.position.distanceTo(worldHandles.buskerPos);
    const buskerProx = Math.max(0, 1 - buskerDist / 34);
    birdCam.camera.getWorldDirection(camFwdTmp);
    camUpTmp.copy(birdCam.camera.up).applyQuaternion(birdCam.camera.quaternion);

    audio.updateTelemetry({
      dt,
      isFlying: sparrow.mode === 'flying',
      isHopping: sparrow.mode !== 'flying' && sparrow.velocity.lengthSq() > 1.2,
      airspeed: sparrow.getAirspeed(),
      verticalVel: sparrow.velocity.y,
      altitude: sparrow.position.y,
      buskerProximity: buskerProx,
      buskerGroove: npcs.isBuskerGrooving(),
      bankAngle: sparrow.getBankAngle(),
      thermalLift: sparrow.mode === 'flying' ? physics.sampleUpdraftLift(sparrow.position) : 0,
      isIndoors,
      windowOpenRatio: Math.min(1, worldHandles.getWindowOpenAngle() / 1.34),
      tramX: worldHandles.getTramX(),
      birdPos: sparrow.position,
      camPos: birdCam.camera.position,
      camFwd: camFwdTmp,
      camUp: camUpTmp,
    });

    // 4. Render via WebGPU Storybook Pipeline
    if (renderPipeline) {
      renderPipeline.render();
    } else {
      renderer.render(scene, birdCam.camera);
    }
  };

  if (isSoftwareGl) {
    const gl = (renderer.backend as unknown as { gl?: WebGL2RenderingContext })?.gl;
    const afterDraw = (cb: () => void) => {
      if (!gl || typeof gl.fenceSync !== 'function') {
        window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          window.setTimeout(cb, 80);
        }
      };
      window.setTimeout(poll, 5);
    };
    const tickSoftware = () => {
      stepFrame();
      afterDraw(tickSoftware);
    };
    afterDraw(tickSoftware);
  } else {
    renderer.setAnimationLoop(stepFrame);
  }
}
