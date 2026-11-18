import * as THREE from 'three/webgpu';
import { PALETTE } from './Palette.ts';
import { createUnlitPastelFXMaterial, createPastelMaterial } from './StorybookMaterial.ts';
import {
  extrudeShape,
  buildCloudClusterGeometry,
  buildCeramicShardGeometry,
  buildDroppingProjectileGeometry,
  buildDroppingSplatGeometry,
} from '../geometry/Sculptor.ts';

const RING_POOL_SIZE = 24;
const SHARD_POOL_SIZE = 24;
const WING_TRAIL_POOL_SIZE = 56;
const PETAL_COUNT = 95;
const SPLAT_RING_BUFFER_SIZE = 64;

const _fxScratch = new THREE.Vector3();
const _mat4Scratch = new THREE.Matrix4();
const _posScratch = new THREE.Vector3();
const _quatScratch = new THREE.Quaternion();
const _quatSpin = new THREE.Quaternion();
const _parentInvQuat = new THREE.Quaternion();
const _parentWorldScale = new THREE.Vector3();
const _eulerScratch = new THREE.Euler();
const _scaleScratch = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _zeroMat4 = new THREE.Matrix4().makeScale(0, 0, 0);

interface RingPulse {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicNodeMaterial;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
  baseOpacity: number;
  active: boolean;
}

interface InstancedParticleSlot {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  baseScale: number;
  gravity: number;
  spin: number;
  active: boolean;
}

interface InstancedParticlePool {
  inst: THREE.InstancedMesh;
  slots: InstancedParticleSlot[];
  cursor: number;
  activeCount: number;
  dirty: boolean;
}

interface ShardParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  baseScale: number;
  gravity: number;
  spin: number;
  active: boolean;
}

interface BonkHalo {
  group: THREE.Group;
  stars: THREE.Mesh[];
  age: number;
  maxAge: number;
  followGetter: () => THREE.Vector3;
}

interface DriftingPetal {
  pos: THREE.Vector3;
  rotX: number;
  rotY: number;
  phase: number;
  fallSpeed: number;
  swayRadius: number;
}

interface DriftingCloud {
  inst: THREE.InstancedMesh;
  instanceIdx: number;
  orbitRadius: number;
  orbitAngle: number;
  angularSpeed: number;
  baseY: number;
  phase: number;
}

interface WingTrailSlot {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  age: number;
  active: boolean;
}

/**
 * Untextured gouache visual effects across the multi-block neighborhood:
 * - GPU-instanced high-altitude cumulus clouds, sakura petals, wingtip trails & particle bursts
 * - Expanding 3D Chirp Sound Rings & Water Ripples
 * - Head-tracking Orbiting Golden Dizzy Stars during wall-hit fall & ground recovery
 * - Persistent 64-slot gouache splat ring buffer capable of riding on moving vehicles & citizens
 */
export class WorldFX {
  private group = new THREE.Group();
  private rings: RingPulse[] = [];
  private shards: ShardParticle[] = [];
  private bonkHalos: BonkHalo[] = [];
  private petals: DriftingPetal[] = [];
  private clouds: DriftingCloud[] = [];
  private cloudInstMeshes: THREE.InstancedMesh[] = [];
  private petalInst!: THREE.InstancedMesh;
  private wingTrailInst!: THREE.InstancedMesh;
  private wingTrailSlots: WingTrailSlot[] = [];
  private wingTrailActiveCount = 0;

  private dustPuffPool!: InstancedParticlePool;
  private goldPuffPool!: InstancedParticlePool;
  private crumbCrustPool!: InstancedParticlePool;
  private crumbSoftPool!: InstancedParticlePool;
  private featherPool!: InstancedParticlePool;
  private petalBurstPool!: InstancedParticlePool;
  private waterDropPool!: InstancedParticlePool;

  private petalsActive = false;
  private activePlayerDizzyHalo: BonkHalo | null = null;

  private torusGeo: THREE.BufferGeometry;
  private flatRingGeo: THREE.BufferGeometry;
  private puffGeo: THREE.BufferGeometry;
  private featherGeo: THREE.BufferGeometry;
  private starGeo: THREE.BufferGeometry;
  private dizzyOrbitRingGeo: THREE.BufferGeometry;
  private droppingProjGeo: THREE.BufferGeometry;
  private splatGeo: THREE.BufferGeometry;

  private puffMatGold: THREE.NodeMaterial;
  private puffMatDust: THREE.NodeMaterial;
  private featherMat: THREE.NodeMaterial;
  private splatMat: THREE.NodeMaterial;
  private cloudMat: THREE.NodeMaterial;
  private dizzyOrbitRingMat: THREE.MeshBasicNodeMaterial;
  private crumbCrustMat: THREE.NodeMaterial;
  private crumbSoftMat: THREE.NodeMaterial;

  private ringCursor = 0;
  private shardCursor = 0;
  private wingTrailCursor = 0;
  private shardGeoCache = new Map<string, THREE.BufferGeometry>();

  private splatRing: THREE.Mesh[] = [];
  private splatCursor = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);

    this.torusGeo = new THREE.TorusGeometry(1.0, 0.045, 8, 28);
    this.torusGeo.deleteAttribute('uv');

    this.flatRingGeo = new THREE.RingGeometry(0.82, 1.0, 28);
    this.flatRingGeo.rotateX(-Math.PI * 0.5);
    this.flatRingGeo.deleteAttribute('uv');

    this.puffGeo = new THREE.SphereGeometry(0.17, 10, 8);
    this.puffGeo.deleteAttribute('uv');

    const fShape = new THREE.Shape();
    fShape.moveTo(0, 0.16);
    fShape.bezierCurveTo(0.08, 0.1, 0.08, -0.08, 0, -0.16);
    fShape.bezierCurveTo(-0.08, -0.08, -0.08, 0.1, 0, 0.16);
    this.featherGeo = extrudeShape(fShape, 0.012, 0.005, PALETTE.sparrowCheek, 5);

    this.starGeo = new THREE.OctahedronGeometry(0.15, 0);
    this.starGeo.deleteAttribute('uv');

    this.dizzyOrbitRingGeo = new THREE.TorusGeometry(0.46, 0.015, 6, 24);
    this.dizzyOrbitRingGeo.deleteAttribute('uv');

    this.droppingProjGeo = buildDroppingProjectileGeometry();
    this.droppingProjGeo.computeBoundingSphere();

    this.splatGeo = buildDroppingSplatGeometry();
    this.splatGeo.computeBoundingSphere();

    this.puffMatGold = createPastelMaterial({
      color: PALETTE.goldGlow,
      vertexColors: false,
      emissiveHex: PALETTE.goldGlow,
      emissiveIntensity: 0.36,
    });
    this.puffMatDust = createPastelMaterial({
      color: PALETTE.wallCreamTrim,
      vertexColors: false,
    });
    this.crumbCrustMat = createPastelMaterial({
      color: PALETTE.croissantGold,
      vertexColors: false,
    });
    this.crumbSoftMat = createPastelMaterial({
      color: 0xf4e1b8,
      vertexColors: false,
    });
    this.featherMat = createPastelMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.splatMat = createPastelMaterial({ vertexColors: true });
    this.cloudMat = createPastelMaterial({
      vertexColors: true,
      rimStrength: 0.10,
      fog: false,
    });
    this.dizzyOrbitRingMat = createUnlitPastelFXMaterial(PALETTE.goldGlow, 0.5, true);

    // Pre-allocate pooled RingPulse slots (covering both torusGeo and flatRingGeo for shader pre-warm)
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const mat = createUnlitPastelFXMaterial(PALETTE.goldGlow, 0.76, true);
      const mesh = new THREE.Mesh(i < 18 ? this.torusGeo : this.flatRingGeo, mat);
      mesh.visible = false;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.rings.push({
        mesh,
        mat,
        age: 0,
        maxAge: 0.85,
        startScale: 0.25,
        endScale: 1.0,
        baseOpacity: 0.76,
        active: false,
      });
    }

    // Instanced particle pools (6 draw calls max instead of 140 separate scene-graph meshes)
    this.dustPuffPool = this.createInstancedPool(this.puffGeo, this.puffMatDust, 48);
    this.goldPuffPool = this.createInstancedPool(this.puffGeo, this.puffMatGold, 36);
    this.crumbCrustPool = this.createInstancedPool(this.starGeo, this.crumbCrustMat, 24);
    this.crumbSoftPool = this.createInstancedPool(this.starGeo, this.crumbSoftMat, 24);
    this.featherPool = this.createInstancedPool(this.featherGeo, this.featherMat, 32);
    const waterDropMat = createPastelMaterial({
      color: PALETTE.waterFoam,
      vertexColors: false,
      emissiveHex: PALETTE.waterFoam,
      emissiveIntensity: 0.24,
    });
    this.waterDropPool = this.createInstancedPool(this.puffGeo, waterDropMat, 36);

    // Compact ceramic shatter shard pool (since shattered pots carry per-prop glazed vertex colors)
    const warmShardGeo = buildCeramicShardGeometry(PALETTE.porcelainWhite, 0);
    this.shardGeoCache.set(`${PALETTE.porcelainWhite}_0`, warmShardGeo);
    for (let i = 0; i < SHARD_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(warmShardGeo, this.featherMat);
      mesh.visible = false;
      mesh.castShadow = false;
      this.group.add(mesh);
      this.shards.push({
        mesh,
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 1.35,
        baseScale: 1.0,
        gravity: 21.0,
        spin: 9.5,
        active: false,
      });
    }

    // Hidden warmup instances for dizzy orbit ring & star pipelines
    const warmOrbitRing = new THREE.Mesh(this.dizzyOrbitRingGeo, this.dizzyOrbitRingMat);
    warmOrbitRing.visible = false;
    const warmStar = new THREE.Mesh(this.starGeo, this.puffMatGold);
    warmStar.visible = false;
    this.group.add(warmOrbitRing, warmStar);

    // Instanced wingtip trails (1 InstancedMesh instead of 56 separate scene-graph meshes)
    const trailGeo = new THREE.BoxGeometry(0.06, 0.025, 0.52);
    trailGeo.deleteAttribute('uv');
    const trailMat = createUnlitPastelFXMaterial(PALETTE.porcelainWhite, 0.38, false);
    this.wingTrailInst = new THREE.InstancedMesh(trailGeo, trailMat, WING_TRAIL_POOL_SIZE);
    this.wingTrailInst.frustumCulled = false;
    this.wingTrailInst.castShadow = false;
    this.wingTrailInst.receiveShadow = false;
    for (let i = 0; i < WING_TRAIL_POOL_SIZE; i++) {
      this.wingTrailInst.setMatrixAt(i, _zeroMat4);
      this.wingTrailSlots.push({
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        age: 99,
        active: false,
      });
    }
    this.wingTrailInst.instanceMatrix.needsUpdate = true;
    this.group.add(this.wingTrailInst);

    // Persistent 64-slot gouache splat ring buffer (supports parenting to moving hats/heads/vehicles)
    for (let i = 0; i < SPLAT_RING_BUFFER_SIZE; i++) {
      const sm = new THREE.Mesh(this.splatGeo, this.splatMat);
      sm.visible = false;
      sm.castShadow = false;
      sm.receiveShadow = true;
      this.group.add(sm);
      this.splatRing.push(sm);
    }

    this.initSkyClouds();
    this.initSakuraPetals();
  }

  private createInstancedPool(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    capacity: number
  ): InstancedParticlePool {
    const inst = new THREE.InstancedMesh(geo, mat, capacity);
    inst.frustumCulled = false;
    inst.castShadow = false;
    inst.receiveShadow = false;
    const slots: InstancedParticleSlot[] = [];
    for (let i = 0; i < capacity; i++) {
      inst.setMatrixAt(i, _zeroMat4);
      slots.push({
        pos: new THREE.Vector3(),
        rot: new THREE.Euler(),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.5,
        baseScale: 1.0,
        gravity: 9.5,
        spin: 0,
        active: false,
      });
    }
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    return {
      inst,
      slots,
      cursor: 0,
      activeCount: 0,
      dirty: false,
    };
  }

  private acquirePoolSlot(pool: InstancedParticlePool): InstancedParticleSlot {
    const len = pool.slots.length;
    for (let step = 0; step < len; step++) {
      const idx = (pool.cursor + step) % len;
      const slot = pool.slots[idx];
      if (!slot.active) {
        pool.cursor = (idx + 1) % len;
        slot.active = true;
        pool.activeCount++;
        pool.dirty = true;
        return slot;
      }
    }
    const fallback = pool.slots[pool.cursor];
    pool.cursor = (pool.cursor + 1) % len;
    if (!fallback.active) {
      fallback.active = true;
      pool.activeCount++;
    }
    pool.dirty = true;
    return fallback;
  }

  private acquireRingSlot(): RingPulse {
    const len = this.rings.length;
    for (let step = 0; step < len; step++) {
      const idx = (this.ringCursor + step) % len;
      const slot = this.rings[idx];
      if (!slot.active) {
        this.ringCursor = (idx + 1) % len;
        return slot;
      }
    }
    const fallback = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % len;
    return fallback;
  }

  private acquireShardSlot(): ShardParticle {
    const len = this.shards.length;
    for (let step = 0; step < len; step++) {
      const idx = (this.shardCursor + step) % len;
      const slot = this.shards[idx];
      if (!slot.active) {
        this.shardCursor = (idx + 1) % len;
        return slot;
      }
    }
    const fallback = this.shards[this.shardCursor];
    this.shardCursor = (this.shardCursor + 1) % len;
    return fallback;
  }

  public createDroppingProjectileMesh(): THREE.Mesh {
    const m = new THREE.Mesh(this.droppingProjGeo, this.splatMat);
    m.visible = false;
    m.castShadow = false;
    m.receiveShadow = false;
    this.group.add(m);
    return m;
  }

  public placeDroppingSplat(
    worldPoint: THREE.Vector3,
    worldNormal: THREE.Vector3,
    attachParent?: THREE.Object3D
  ): void {
    const mesh = this.splatRing[this.splatCursor];
    this.splatCursor = (this.splatCursor + 1) % this.splatRing.length;

    _posScratch.copy(worldPoint).addScaledVector(worldNormal, 0.018);
    _quatScratch.setFromUnitVectors(_upVec, worldNormal);
    _quatSpin.setFromAxisAngle(_upVec, Math.random() * Math.PI * 2);
    _quatScratch.multiply(_quatSpin);

    const splatScale = 0.88 + Math.random() * 0.28;

    const targetParent = attachParent ?? this.group;
    if (mesh.parent !== targetParent) {
      targetParent.add(mesh);
    }

    if (attachParent) {
      attachParent.updateWorldMatrix(true, false);
      attachParent.getWorldQuaternion(_parentInvQuat);
      _parentInvQuat.invert();
      attachParent.getWorldScale(_parentWorldScale);

      mesh.position.copy(_posScratch);
      attachParent.worldToLocal(mesh.position);
      mesh.quaternion.copy(_parentInvQuat).multiply(_quatScratch);
      mesh.scale.set(
        splatScale / Math.max(0.01, _parentWorldScale.x),
        splatScale / Math.max(0.01, _parentWorldScale.y),
        splatScale / Math.max(0.01, _parentWorldScale.z)
      );
    } else {
      mesh.position.copy(_posScratch);
      mesh.quaternion.copy(_quatScratch);
      mesh.scale.setScalar(splatScale);
    }
    mesh.visible = true;

    // Subtle 4-fleck gouache splash droplets along surface normal
    for (let i = 0; i < 4; i++) {
      const slot = this.acquirePoolSlot(this.dustPuffPool);
      slot.pos.copy(_posScratch);
      slot.rot.set(0, 0, 0);
      const a = (i / 4) * Math.PI * 2 + Math.random() * 0.7;
      const spread = 1.2 + Math.random() * 1.4;
      slot.vel.set(
        worldNormal.x * 2.1 + Math.cos(a) * spread,
        Math.max(1.2, worldNormal.y * 2.4) + Math.random() * 1.1,
        worldNormal.z * 2.1 + Math.sin(a) * spread
      );
      slot.baseScale = 0.36 + Math.random() * 0.22;
      slot.age = 0;
      slot.maxAge = 0.28 + Math.random() * 0.08;
      slot.gravity = 16.0;
      slot.spin = 0;
    }
  }

  private initSkyClouds(): void {
    const cloudGeoA = buildCloudClusterGeometry(3.2);
    const cloudGeoB = buildCloudClusterGeometry(4.4);
    const cloudGeoC = buildCloudClusterGeometry(5.4);

    const specsA: Array< Omit<DriftingCloud, 'inst' | 'instanceIdx'> > = [];
    const specsB: Array< Omit<DriftingCloud, 'inst' | 'instanceIdx'> > = [];
    const specsC: Array< Omit<DriftingCloud, 'inst' | 'instanceIdx'> > = [];

    // Ring 1: 18 Sculpted Outer-Horizon Cumulus Clouds (`r = 350..464 SU`, `y = 152..192 SU`)
    for (let i = 0; i < 18; i++) {
      const bucket = i % 3 === 0 ? specsC : i % 2 === 0 ? specsB : specsA;
      bucket.push({
        orbitRadius: 350 + (i % 4) * 38,
        orbitAngle: (i / 18) * Math.PI * 2 + (i % 3) * 0.14,
        angularSpeed: 0.0042 + (i % 3) * 0.0014,
        baseY: 152 + (i % 5) * 10,
        phase: i * 0.8,
      });
    }

    // Ring 2: 10 High-Zenith Sky Clouds (`y = 206..254 SU`, `r = 105..261 SU`) above all spires.
    for (let j = 0; j < 10; j++) {
      const bucket = j % 2 === 0 ? specsA : specsB;
      bucket.push({
        orbitRadius: 105 + (j % 4) * 52,
        orbitAngle: (j / 10) * Math.PI * 2 + 0.37,
        angularSpeed: 0.0058 + (j % 3) * 0.0018,
        baseY: 206 + (j % 4) * 16,
        phase: 2.4 + j * 0.9,
      });
    }

    const buildCloudBatch = (
      geo: THREE.BufferGeometry,
      list: Array<Omit<DriftingCloud, 'inst' | 'instanceIdx'>>
    ) => {
      const inst = new THREE.InstancedMesh(geo, this.cloudMat, list.length);
      inst.frustumCulled = false;
      inst.castShadow = false;
      inst.receiveShadow = false;
      _scaleScratch.set(1, 1, 1);
      list.forEach((s, idx) => {
        _posScratch.set(
          Math.cos(s.orbitAngle) * s.orbitRadius,
          s.baseY,
          Math.sin(s.orbitAngle) * s.orbitRadius
        );
        _eulerScratch.set(0, -s.orbitAngle + Math.PI * 0.5, 0);
        _quatScratch.setFromEuler(_eulerScratch);
        _mat4Scratch.compose(_posScratch, _quatScratch, _scaleScratch);
        inst.setMatrixAt(idx, _mat4Scratch);
        this.clouds.push({ ...s, inst, instanceIdx: idx });
      });
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
      this.cloudInstMeshes.push(inst);
    };

    buildCloudBatch(cloudGeoA, specsA);
    buildCloudBatch(cloudGeoB, specsB);
    buildCloudBatch(cloudGeoC, specsC);
  }

  private initSakuraPetals(): void {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.18);
    shape.bezierCurveTo(0.15, 0.13, 0.15, -0.09, 0, -0.18);
    shape.bezierCurveTo(-0.15, -0.09, -0.15, 0.13, 0, 0.18);
    const petalGeo = extrudeShape(shape, 0.015, 0.008, PALETTE.sakuraBlush, 6);
    const petalMat = createPastelMaterial({ vertexColors: true, side: THREE.DoubleSide });

    this.petalInst = new THREE.InstancedMesh(petalGeo, petalMat, PETAL_COUNT);
    this.petalInst.frustumCulled = false;
    this.petalInst.castShadow = false;
    this.petalInst.receiveShadow = false;
    this.petalInst.visible = false;
    _scaleScratch.set(1, 1, 1);

    for (let i = 0; i < PETAL_COUNT; i++) {
      const pos = new THREE.Vector3(
        (Math.random() - 0.5) * 240,
        8 + Math.random() * 92,
        (Math.random() - 0.5) * 240
      );
      _eulerScratch.set(0, 0, 0);
      _quatScratch.setFromEuler(_eulerScratch);
      _mat4Scratch.compose(pos, _quatScratch, _scaleScratch);
      this.petalInst.setMatrixAt(i, _mat4Scratch);
      this.petals.push({
        pos,
        rotX: 0,
        rotY: 0,
        phase: Math.random() * Math.PI * 2,
        fallSpeed: 1.6 + Math.random() * 1.4,
        swayRadius: 1.2 + Math.random() * 1.8,
      });
    }
    this.petalInst.instanceMatrix.needsUpdate = true;
    this.group.add(this.petalInst);
    this.petalBurstPool = this.createInstancedPool(petalGeo, petalMat, 36);
  }

  public spawnPetalBurst(origin: THREE.Vector3, count = 8, speed = 3.1): void {
    for (let i = 0; i < count; i++) {
      const slot = this.acquirePoolSlot(this.petalBurstPool);
      slot.pos.set(
        origin.x + (Math.random() - 0.5) * 0.65,
        origin.y + 0.12 + Math.random() * 0.45,
        origin.z + (Math.random() - 0.5) * 0.65
      );
      slot.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      slot.vel.set(
        Math.cos(a) * speed * (0.45 + Math.random() * 0.65),
        1.6 + Math.random() * speed * 0.75,
        Math.sin(a) * speed * (0.45 + Math.random() * 0.65)
      );
      slot.age = 0;
      slot.maxAge = 1.45 + Math.random() * 0.4;
      slot.baseScale = 1.15 + Math.random() * 0.35;
      slot.gravity = 2.6;
      slot.spin = 5.2;
    }
  }

  public setGoldenBloomPetals(enabled: boolean): void {
    this.petalsActive = enabled;
    this.petalInst.visible = enabled;
  }

  public spawnChirpRing(
    origin: THREE.Vector3,
    hexColor: number = PALETTE.goldGlow,
    maxScale = 7.5
  ): void {
    const slot = this.acquireRingSlot();
    slot.mesh.geometry = this.torusGeo;
    slot.mesh.position.copy(origin);
    slot.mesh.rotation.set(
      Math.PI * 0.5 + (Math.random() - 0.5) * 0.35,
      (Math.random() - 0.5) * 0.35,
      0
    );
    slot.mesh.scale.setScalar(0.25);
    slot.mat.color.setHex(hexColor);
    slot.mat.opacity = 0.76;
    slot.age = 0;
    slot.maxAge = 0.85;
    slot.startScale = 0.25;
    slot.endScale = maxScale;
    slot.baseOpacity = 0.76;
    slot.active = true;
    slot.mesh.visible = true;
  }

  public spawnWaterRipple(
    pos: THREE.Vector3,
    maxScale = 3.2,
    hexColor: number = PALETTE.waterFoam
  ): void {
    for (let i = 0; i < 2; i++) {
      const slot = this.acquireRingSlot();
      const baseOp = 0.74 - i * 0.18;
      slot.mesh.geometry = this.flatRingGeo;
      slot.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
      slot.mesh.rotation.set(0, 0, 0);
      slot.mesh.scale.setScalar(0.18);
      slot.mat.color.setHex(hexColor);
      slot.mat.opacity = baseOp;
      slot.age = -i * 0.14;
      slot.maxAge = 0.95;
      slot.startScale = 0.18;
      slot.endScale = maxScale * (1 - i * 0.25);
      slot.baseOpacity = baseOp;
      slot.active = true;
      slot.mesh.visible = i === 0;
    }
  }

  /**
   * Crowning whitewater splash burst (3 concentric ripples + upward-arcing foam droplets)
   * when props splosh into the fountain or canal or when the Sparrow skips across water.
   */
  public spawnWaterSplash(pos: THREE.Vector3, scale = 1.0): void {
    const clampedScale = Math.max(0.55, Math.min(2.2, scale));
    for (let i = 0; i < 3; i++) {
      const slot = this.acquireRingSlot();
      const baseOp = 0.84 - i * 0.18;
      slot.mesh.geometry = this.flatRingGeo;
      slot.mesh.position.set(pos.x, pos.y + 0.055, pos.z);
      slot.mesh.rotation.set(0, 0, 0);
      slot.mesh.scale.setScalar(0.22);
      slot.mat.color.setHex(PALETTE.waterFoam);
      slot.mat.opacity = baseOp;
      slot.age = -i * 0.13;
      slot.maxAge = 1.08;
      slot.startScale = 0.22;
      slot.endScale = 3.6 * clampedScale * (1 - i * 0.22);
      slot.baseOpacity = baseOp;
      slot.active = true;
      slot.mesh.visible = i === 0;
    }

    const dropCount = Math.round(8 + clampedScale * 4);
    for (let i = 0; i < dropCount; i++) {
      const slot = this.acquirePoolSlot(this.waterDropPool);
      const ang = (i / dropCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
      const rad = 0.08 + Math.random() * 0.24 * clampedScale;
      slot.pos.set(pos.x + Math.cos(ang) * rad, pos.y + 0.08, pos.z + Math.sin(ang) * rad);
      slot.rot.set(0, 0, 0);
      const horiz = (1.1 + Math.random() * 2.1) * clampedScale;
      const up = (3.8 + Math.random() * 3.6) * clampedScale;
      slot.vel.set(Math.cos(ang) * horiz, up, Math.sin(ang) * horiz);
      slot.baseScale = (0.55 + Math.random() * 0.5) * Math.min(1.35, clampedScale);
      slot.age = 0;
      slot.maxAge = 0.52 + Math.random() * 0.24;
      slot.gravity = 19.5;
      slot.spin = 0;
    }
  }

  public spawnBurst(origin: THREE.Vector3, count = 6, golden = false, speed = 3.5): void {
    const pool = golden ? this.goldPuffPool : this.dustPuffPool;
    for (let i = 0; i < count; i++) {
      const slot = this.acquirePoolSlot(pool);
      slot.pos.copy(origin);
      slot.rot.set(0, 0, 0);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const horiz = (0.4 + Math.random() * 0.6) * speed;
      slot.vel.set(
        Math.cos(angle) * horiz,
        (0.5 + Math.random() * 0.7) * speed,
        Math.sin(angle) * horiz
      );
      slot.baseScale = golden ? 0.95 + Math.random() * 0.6 : 0.6 + Math.random() * 0.4;
      slot.age = 0;
      slot.maxAge = golden ? 0.7 : 0.42;
      slot.gravity = 9.5;
      slot.spin = 0;
    }
  }

  /**
   * Scatters tiny toasted crust & butter-crumb flecks when the Sparrow crunches a breadcrumb.
   */
  public spawnBreadcrumbCrumbs(origin: THREE.Vector3, count = 9): void {
    for (let i = 0; i < count; i++) {
      const pool = i % 2 === 0 ? this.crumbCrustPool : this.crumbSoftPool;
      const slot = this.acquirePoolSlot(pool);
      slot.pos.set(
        origin.x + (Math.random() - 0.5) * 0.16,
        origin.y + 0.04 + Math.random() * 0.08,
        origin.z + (Math.random() - 0.5) * 0.16
      );
      slot.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.55;
      const horiz = 0.8 + Math.random() * 1.65;
      slot.vel.set(
        Math.cos(angle) * horiz,
        1.5 + Math.random() * 1.9,
        Math.sin(angle) * horiz
      );
      slot.baseScale = 0.28 + Math.random() * 0.22;
      slot.age = 0;
      slot.maxAge = 0.48 + Math.random() * 0.14;
      slot.gravity = 13.5;
      slot.spin = 8.5;
    }
  }

  /**
   * Fluttering down-feathers when tumbling, shaking off dizziness, or scattering pigeons.
   */
  public spawnFeatherBurst(origin: THREE.Vector3, count = 8, speed = 3.4): void {
    for (let i = 0; i < count; i++) {
      const slot = this.acquirePoolSlot(this.featherPool);
      slot.pos.set(
        origin.x + (Math.random() - 0.5) * 0.5,
        origin.y + 0.1 + Math.random() * 0.4,
        origin.z + (Math.random() - 0.5) * 0.5
      );
      slot.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      slot.vel.set(
        Math.cos(a) * speed * (0.5 + Math.random() * 0.6),
        1.4 + Math.random() * speed * 0.65,
        Math.sin(a) * speed * (0.5 + Math.random() * 0.6)
      );
      slot.age = 0;
      slot.maxAge = 1.15;
      slot.baseScale = 1.1;
      slot.gravity = 3.4;
      slot.spin = 6.2;
    }
  }

  /**
   * Spawns tumbling 3D glazed ceramic / terracotta / glass shards + a dry dust burst.
   */
  public spawnShatterDebris(origin: THREE.Vector3, shardHex: number): void {
    for (let i = 0; i < 10; i++) {
      const variant = i % 3;
      const cacheKey = `${shardHex}_${variant}`;
      let geo = this.shardGeoCache.get(cacheKey);
      if (!geo) {
        geo = buildCeramicShardGeometry(shardHex, variant);
        this.shardGeoCache.set(cacheKey, geo);
      }

      const slot = this.acquireShardSlot();
      slot.mesh.geometry = geo;
      slot.mesh.material = this.featherMat;
      slot.mesh.position.set(
        origin.x + (Math.random() - 0.5) * 0.35,
        origin.y + 0.08 + Math.random() * 0.25,
        origin.z + (Math.random() - 0.5) * 0.35
      );
      slot.mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      const baseScale = 0.85 + Math.random() * 0.55;
      slot.mesh.scale.setScalar(baseScale);

      const angle = (i / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.55;
      const speedXZ = 2.2 + Math.random() * 4.2;
      slot.vel.set(
        Math.cos(angle) * speedXZ,
        2.4 + Math.random() * 3.8,
        Math.sin(angle) * speedXZ
      );

      slot.mesh.visible = true;
      slot.age = 0;
      slot.maxAge = 1.35 + Math.random() * 0.35;
      slot.baseScale = baseScale;
      slot.gravity = 21.0;
      slot.spin = 9.5 + Math.random() * 5.0;
      slot.active = true;
    }

    this.spawnBurst(origin, 5, false, 2.8);
  }

  /**
   * Attaches a head-tracking halo of 5 orbiting golden stars that follows the dizzy sparrow down to the ground.
   */
  public attachDizzyStars(followGetter: () => THREE.Vector3, maxDuration = 4.5): void {
    this.clearDizzyStars();
    _fxScratch.copy(followGetter());
    const haloGroup = new THREE.Group();
    haloGroup.position.set(_fxScratch.x, _fxScratch.y + 0.52, _fxScratch.z);

    const orbitRing = new THREE.Mesh(this.dizzyOrbitRingGeo, this.dizzyOrbitRingMat);
    orbitRing.rotation.x = Math.PI * 0.5;
    haloGroup.add(orbitRing);

    const stars: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const star = new THREE.Mesh(this.starGeo, this.puffMatGold);
      const a = (i / 5) * Math.PI * 2;
      star.position.set(Math.cos(a) * 0.46, (i % 2) * 0.06, Math.sin(a) * 0.46);
      haloGroup.add(star);
      stars.push(star);
    }
    this.group.add(haloGroup);

    const halo: BonkHalo = {
      group: haloGroup,
      stars,
      age: 0,
      maxAge: maxDuration,
      followGetter,
    };
    this.activePlayerDizzyHalo = halo;
    this.bonkHalos.push(halo);
    this.spawnFeatherBurst(_fxScratch, 7, 3.2);
  }

  public clearDizzyStars(): void {
    if (!this.activePlayerDizzyHalo) return;
    this.activePlayerDizzyHalo.age = this.activePlayerDizzyHalo.maxAge - 0.18;
    this.activePlayerDizzyHalo = null;
  }

  public spawnWingtipCrumb(
    leftTip: THREE.Vector3,
    rightTip: THREE.Vector3,
    quat: THREE.Quaternion
  ): void {
    for (let side = 0; side < 2; side++) {
      const tip = side === 0 ? leftTip : rightTip;
      const idx = this.wingTrailCursor;
      this.wingTrailCursor = (this.wingTrailCursor + 1) % this.wingTrailSlots.length;
      const slot = this.wingTrailSlots[idx];
      slot.pos.copy(tip);
      slot.quat.copy(quat);
      slot.age = 0;
      if (!slot.active) {
        slot.active = true;
        this.wingTrailActiveCount++;
      }
      _scaleScratch.set(1, 1, 1);
      _mat4Scratch.compose(slot.pos, slot.quat, _scaleScratch);
      this.wingTrailInst.setMatrixAt(idx, _mat4Scratch);
    }
    this.wingTrailInst.instanceMatrix.needsUpdate = true;
  }

  private updateInstancedPool(pool: InstancedParticlePool, dt: number): void {
    if (pool.activeCount === 0 && !pool.dirty) return;
    let remaining = 0;
    for (let i = 0; i < pool.slots.length; i++) {
      const p = pool.slots[i];
      if (!p.active) continue;
      p.age += dt;
      const t = p.age / p.maxAge;
      if (t >= 1) {
        p.active = false;
        pool.inst.setMatrixAt(i, _zeroMat4);
        continue;
      }
      remaining++;
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.spin > 0) {
        p.rot.x += p.spin * dt;
        p.rot.z += p.spin * 0.8 * dt;
      }
      _quatScratch.setFromEuler(p.rot);
      _scaleScratch.setScalar(p.baseScale * (1 - t * 0.7));
      _mat4Scratch.compose(p.pos, _quatScratch, _scaleScratch);
      pool.inst.setMatrixAt(i, _mat4Scratch);
    }
    pool.activeCount = remaining;
    pool.dirty = false;
    pool.inst.instanceMatrix.needsUpdate = true;
  }

  public update(dt: number, elapsed: number): void {
    // 1. Instanced sky cumulus clouds orbiting above the 136-SU Clocktower & skyline
    _scaleScratch.set(1, 1, 1);
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.orbitAngle += c.angularSpeed * dt;
      _posScratch.set(
        Math.cos(c.orbitAngle) * c.orbitRadius,
        c.baseY + Math.sin(elapsed * 0.25 + c.phase) * 0.9,
        Math.sin(c.orbitAngle) * c.orbitRadius
      );
      _eulerScratch.set(0, -c.orbitAngle + Math.PI * 0.5, 0);
      _quatScratch.setFromEuler(_eulerScratch);
      _mat4Scratch.compose(_posScratch, _quatScratch, _scaleScratch);
      c.inst.setMatrixAt(c.instanceIdx, _mat4Scratch);
    }
    for (let i = 0; i < this.cloudInstMeshes.length; i++) {
      this.cloudInstMeshes[i].instanceMatrix.needsUpdate = true;
    }

    // 2. Pooled chirp & water ripple rings
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.active) continue;
      r.age += dt;
      if (r.age < 0) {
        r.mesh.visible = false;
        continue;
      }
      const t = r.age / r.maxAge;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      r.mesh.visible = true;
      const eased = 1 - Math.pow(1 - t, 2.4);
      const s = r.startScale + (r.endScale - r.startScale) * eased;
      r.mesh.scale.setScalar(s);
      r.mat.opacity = (1 - t) * r.baseOpacity;
    }

    // 3. Instanced particle pools (early-out when idle)
    this.updateInstancedPool(this.dustPuffPool, dt);
    this.updateInstancedPool(this.goldPuffPool, dt);
    this.updateInstancedPool(this.crumbCrustPool, dt);
    this.updateInstancedPool(this.crumbSoftPool, dt);
    this.updateInstancedPool(this.featherPool, dt);
    this.updateInstancedPool(this.petalBurstPool, dt);
    this.updateInstancedPool(this.waterDropPool, dt);

    // 4. Ceramic shatter shards
    for (let i = 0; i < this.shards.length; i++) {
      const p = this.shards[i];
      if (!p.active) continue;
      p.age += dt;
      const t = p.age / p.maxAge;
      if (t >= 1) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.z += p.spin * 0.8 * dt;
      p.mesh.scale.setScalar(p.baseScale * (1 - t * 0.7));
    }

    // 5. Dizzy bonk star halos
    for (let i = this.bonkHalos.length - 1; i >= 0; i--) {
      const bh = this.bonkHalos[i];
      bh.age += dt;
      const t = bh.age / bh.maxAge;
      if (t >= 1) {
        if (this.activePlayerDizzyHalo === bh) {
          this.activePlayerDizzyHalo = null;
        }
        this.group.remove(bh.group);
        this.bonkHalos.splice(i, 1);
        continue;
      }
      const target = bh.followGetter();
      bh.group.position.set(target.x, target.y + 0.54, target.z);
      bh.group.rotation.z = Math.sin(elapsed * 5.0) * 0.18;
      bh.group.rotation.y += dt * 7.8;
      const fadeIn = Math.min(1.0, bh.age * 7.0);
      const fadeOut = Math.min(1.0, (bh.maxAge - bh.age) * 5.0);
      const scale = fadeIn * fadeOut * 1.1;
      for (const s of bh.stars) {
        s.scale.setScalar(scale);
        s.rotation.y += dt * 6.5;
      }
    }

    // 6. Instanced wingtip trails (early-out when no trails active)
    if (this.wingTrailActiveCount > 0) {
      let activeLeft = 0;
      for (let i = 0; i < this.wingTrailSlots.length; i++) {
        const seg = this.wingTrailSlots[i];
        if (!seg.active) continue;
        seg.age += dt;
        const t = seg.age / 0.28;
        if (t >= 1) {
          seg.active = false;
          this.wingTrailInst.setMatrixAt(i, _zeroMat4);
        } else {
          activeLeft++;
          _scaleScratch.set(1 - t, 1 - t, 1);
          _mat4Scratch.compose(seg.pos, seg.quat, _scaleScratch);
          this.wingTrailInst.setMatrixAt(i, _mat4Scratch);
        }
      }
      this.wingTrailActiveCount = activeLeft;
      this.wingTrailInst.instanceMatrix.needsUpdate = true;
    }

    // 7. Instanced sakura petals during Golden Bloom
    if (this.petalsActive) {
      _scaleScratch.set(1, 1, 1);
      for (let i = 0; i < this.petals.length; i++) {
        const p = this.petals[i];
        p.pos.y -= p.fallSpeed * dt;
        p.pos.x += Math.sin(elapsed * 1.1 + p.phase) * p.swayRadius * dt;
        p.pos.z += Math.cos(elapsed * 0.9 + p.phase) * p.swayRadius * dt;
        p.rotX += dt * 1.4;
        p.rotY += dt * 1.9;
        if (p.pos.y < 0.3) {
          p.pos.y = 88 + Math.random() * 24;
        }
        _eulerScratch.set(p.rotX, p.rotY, 0);
        _quatScratch.setFromEuler(_eulerScratch);
        _mat4Scratch.compose(p.pos, _quatScratch, _scaleScratch);
        this.petalInst.setMatrixAt(i, _mat4Scratch);
      }
      this.petalInst.instanceMatrix.needsUpdate = true;
    }
  }
}
