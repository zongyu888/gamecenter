import * as THREE from 'three/webgpu';
import * as CANNON from 'cannon-es';
import { PALETTE } from '../rendering/Palette.ts';
import {
  rbox,
  rcyl,
  smoothSphere,
  tube,
  transformGeo,
  mergeParts,
  buildToGoCoffeeCupGeometry,
  buildCeramicCoffeeMugGeometry,
  buildCeramicMugGeometry,
  buildPorcelainTeacupGeometry,
  buildPorcelainPlateGeometry,
  buildPigmentJarGeometry,
  buildSmallTerracottaPotGeometry,
  buildGlassCarafeGeometry,
  buildCeramicVaseGeometry,
  buildCroissantGeometry,
  buildBaguetteGeometry,
  buildGelatoConeGeometry,
  buildVintageBicycleGeometry,
  buildParkBenchGeometry,
  buildEyeglassesGeometry,
  buildBrassKeyGeometry,
  buildPaperAirplaneGeometry,
  buildBreadcrumbGeometry,
} from '../geometry/Sculptor.ts';
import type { PhysicsWorld, InteractiveProp } from '../physics/PhysicsWorld.ts';

export type ToppleCallback = (prop: InteractiveProp, pos: THREE.Vector3) => void;

/**
 * Centralized dynamic prop spawner & shared BufferGeometry cache.
 * Marks every cached geometry with `userData.sharedCached = true` so `PhysicsWorld.disposePropVisual`
 * preserves GPU buffers across consumed/shattered props while detaching meshes from the scene graph.
 */
export class PropFactory {
  private readonly geoCache = new Map<string, THREE.BufferGeometry>();
  private propCounter = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly physics: PhysicsWorld,
    private readonly mat: THREE.Material,
    private readonly glowGoldMat: THREE.Material
  ) {}

  private nextPropId(prefix: string): string {
    return `${prefix}_${++this.propCounter}`;
  }

  private getOrCreateGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geo = this.geoCache.get(key);
    if (!geo) {
      geo = build();
      geo.computeBoundingSphere();
      geo.userData.sharedCached = true;
      this.geoCache.set(key, geo);
    }
    return geo;
  }

  private createPropMesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material = this.mat,
    castShadow = true
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.parent.add(mesh);
    return mesh;
  }

  // ==========================================================================
  // Cached Street Furniture & Fixture Geometry Helpers
  // ==========================================================================

  public getParkBenchGeometry(woodHex: number = PALETTE.woodOak): THREE.BufferGeometry {
    return this.getOrCreateGeo(`park_bench_${woodHex}`, () => buildParkBenchGeometry(woodHex));
  }

  public getVintageBicycleGeometry(frameHex: number = PALETTE.awningMint): THREE.BufferGeometry {
    return this.getOrCreateGeo(`vintage_bicycle_${frameHex}`, () =>
      buildVintageBicycleGeometry(frameHex)
    );
  }

  public getCafeUmbrellaPoleGeometry(canopyY: number): THREE.BufferGeometry {
    return this.getOrCreateGeo(`umbrella_pole_${canopyY.toFixed(2)}`, () =>
      rcyl(0.18, 0.22, canopyY, PALETTE.woodOak, 12)
    );
  }

  public getCafeUmbrellaCanopyGeometry(radius: number, canopyHex: number): THREE.BufferGeometry {
    return this.getOrCreateGeo(`umbrella_canopy_${radius.toFixed(2)}_${canopyHex}`, () =>
      mergeParts([
        rcyl(0.35, radius, 1.85, canopyHex, 16, { topLift: 0.1 }),
        transformGeo(smoothSphere(0.32, PALETTE.goldGlow, 12, 10), { pos: [0, 1.08, 0] }),
      ])
    );
  }

  public getCandleFlameGeometry(): THREE.BufferGeometry {
    return this.getOrCreateGeo('candle_flame', () =>
      smoothSphere(0.22, PALETTE.goldGlow, 10, 8, [0.85, 1.45, 0.85])
    );
  }

  public getCeramicCoffeeMugGeometry(mugHex: number = PALETTE.awningCoral): THREE.BufferGeometry {
    return this.getOrCreateGeo(`static_coffee_mug_${mugHex}`, () =>
      buildCeramicCoffeeMugGeometry(mugHex)
    );
  }

  // ==========================================================================
  // Dynamic Interactive & Destructible Prop Spawners
  // ==========================================================================

  public spawnSeed(pos: THREE.Vector3): InteractiveProp {
    const id = this.nextPropId('seed');
    const variant = this.propCounter % 4;
    const geo = this.getOrCreateGeo(`seed_${variant}`, () => buildBreadcrumbGeometry(variant));
    const mesh = this.createPropMesh(geo, this.mat, false);
    mesh.rotation.y = (this.propCounter * 1.93) % (Math.PI * 2);
    return this.physics.spawnProp({
      id,
      kind: 'seed',
      mesh,
      position: pos,
      shape: new CANNON.Sphere(0.14),
      mass: 0.14,
      beakWeight: 0.04,
    });
  }

  public spawnSugarCube(pos: THREE.Vector3): InteractiveProp {
    const geo = this.getOrCreateGeo('sugar_cube', () =>
      rbox(0.42, 0.42, 0.42, 0.07, PALETTE.sugarWhite, 2)
    );
    const mesh = this.createPropMesh(geo, this.mat, false);
    return this.physics.spawnProp({
      id: this.nextPropId('sugar'),
      kind: 'sugar_cube',
      mesh,
      position: pos,
      shape: new CANNON.Box(new CANNON.Vec3(0.21, 0.21, 0.21)),
      mass: 0.22,
      beakWeight: 0.12,
    });
  }

  public spawnCoffeeCup(
    pos: THREE.Vector3,
    cupHex: number,
    onTopple?: ToppleCallback
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`coffee_cup_${cupHex}`, () =>
      buildToGoCoffeeCupGeometry(cupHex)
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('boulder_cup'),
      kind: 'coffee_cup',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.54, 0.38, 1.64, 12),
      mass: 0.95,
      grabbable: false,
      onTopple,
    });
  }

  public spawnCroissant(pos: THREE.Vector3): InteractiveProp {
    const geo = this.getOrCreateGeo('croissant', () => buildCroissantGeometry());
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('croissant'),
      kind: 'croissant',
      mesh,
      position: pos,
      shape: new CANNON.Box(new CANNON.Vec3(0.48, 0.22, 0.32)),
      mass: 0.45,
      beakWeight: 0.48,
      buoyant: true,
      carryOffset: new THREE.Vector3(0, -0.08, 0.32),
    });
  }

  public spawnBaguette(pos: THREE.Vector3): InteractiveProp {
    const geo = this.getOrCreateGeo('baguette', () => buildBaguetteGeometry());
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('baguette'),
      kind: 'baguette',
      mesh,
      position: pos,
      shape: new CANNON.Box(new CANNON.Vec3(0.26, 0.19, 1.25)),
      mass: 0.48,
      beakWeight: 0.52,
      buoyant: true,
      carryOffset: new THREE.Vector3(0, -0.06, 0.34),
    });
  }

  public spawnGelatoCone(
    pos: THREE.Vector3,
    scoopA: number,
    scoopB: number,
    onTopple?: ToppleCallback
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`gelato_cone_${scoopA}_${scoopB}`, () =>
      buildGelatoConeGeometry(scoopA, scoopB)
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('gelato'),
      kind: 'gelato_cone',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.42, 0.28, 1.45, 10),
      mass: 0.65,
      grabbable: true,
      beakWeight: 0.42,
      carryOffset: new THREE.Vector3(0, -0.25, 0.3),
      onTopple,
    });
  }

  public spawnCoin(pos: THREE.Vector3): InteractiveProp {
    const geo = this.getOrCreateGeo('shiny_coin', () =>
      rcyl(0.32, 0.32, 0.1, PALETTE.goldGlow, 18, { topLift: 0.12 })
    );
    const mesh = this.createPropMesh(geo, this.glowGoldMat, false);
    return this.physics.spawnProp({
      id: this.nextPropId('coin'),
      kind: 'shiny_coin',
      mesh,
      position: pos,
      shape: new CANNON.Sphere(0.28),
      mass: 0.28,
      beakWeight: 0.22,
      isNestMaterial: false,
    });
  }

  public spawnEyeglasses(pos: THREE.Vector3): InteractiveProp {
    const geo = this.getOrCreateGeo('eyeglasses', () => buildEyeglassesGeometry());
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('eyeglasses'),
      kind: 'eyeglasses',
      mesh,
      position: pos,
      shape: new CANNON.Box(new CANNON.Vec3(0.55, 0.22, 0.32)),
      mass: 0.55,
      beakWeight: 0.58,
      carryOffset: new THREE.Vector3(0, -0.1, 0.34),
    });
  }

  public spawnBrassKey(pos: THREE.Vector3): InteractiveProp {
    const geo = this.getOrCreateGeo('brass_key', () => buildBrassKeyGeometry());
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('brass_key'),
      kind: 'brass_key',
      mesh,
      position: pos,
      shape: new CANNON.Box(new CANNON.Vec3(0.52, 0.14, 0.22)),
      mass: 0.42,
      beakWeight: 0.45,
      carryOffset: new THREE.Vector3(0.18, -0.05, 0.28),
    });
  }

  public spawnBerry(pos: THREE.Vector3, hex: number): InteractiveProp {
    const geo = this.getOrCreateGeo(`berry_${hex}`, () =>
      mergeParts([
        smoothSphere(0.26, hex, 14, 10),
        transformGeo(rcyl(0.04, 0.04, 0.18, PALETTE.leafDeep, 8), { pos: [0, 0.25, 0] }),
      ])
    );
    const mesh = this.createPropMesh(geo, this.mat, false);
    return this.physics.spawnProp({
      id: this.nextPropId('berry'),
      kind: 'berry',
      mesh,
      position: pos,
      shape: new CANNON.Sphere(0.26),
      mass: 0.2,
      beakWeight: 0.15,
      buoyant: true,
      tintHex: hex,
    });
  }

  public spawnApple(pos: THREE.Vector3, hex: number, onTopple?: ToppleCallback): InteractiveProp {
    const geo = this.getOrCreateGeo(`apple_${hex}`, () =>
      mergeParts([
        smoothSphere(0.38, hex, 16, 12, [1.05, 0.92, 1.05]),
        transformGeo(rcyl(0.04, 0.03, 0.24, PALETTE.woodWalnut, 8), { pos: [0, 0.36, 0] }),
        transformGeo(smoothSphere(0.14, PALETTE.leafSage, 10, 8, [1.6, 0.4, 0.8]), {
          pos: [0.14, 0.38, 0],
        }),
      ])
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('apple'),
      kind: 'apple',
      mesh,
      position: pos,
      shape: new CANNON.Sphere(0.38),
      mass: 0.35,
      beakWeight: 0.32,
      buoyant: true,
      tintHex: hex,
      onTopple,
    });
  }

  public spawnPinecone(pos: THREE.Vector3): InteractiveProp {
    const geo = this.getOrCreateGeo('pinecone', () =>
      smoothSphere(0.32, PALETTE.woodWalnut, 14, 10, [0.85, 1.35, 0.85])
    );
    const mesh = this.createPropMesh(geo, this.mat, false);
    return this.physics.spawnProp({
      id: this.nextPropId('pinecone'),
      kind: 'pinecone',
      mesh,
      position: pos,
      shape: new CANNON.Sphere(0.32),
      mass: 0.24,
      beakWeight: 0.2,
      buoyant: true,
      isNestMaterial: true,
      tintHex: PALETTE.woodOak,
    });
  }

  public spawnPigmentFlower(pos: THREE.Vector3, hex: number): InteractiveProp {
    const geo = this.getOrCreateGeo(`flower_sprig_${hex}`, () =>
      mergeParts([
        smoothSphere(0.28, hex, 14, 10, [1.1, 0.85, 1.1]),
        transformGeo(rcyl(0.04, 0.04, 0.55, PALETTE.leafSage, 8), {
          rot: [0, 0, Math.PI * 0.5],
          pos: [-0.28, 0, 0],
        }),
      ])
    );
    const mesh = this.createPropMesh(geo, this.mat, false);
    return this.physics.spawnProp({
      id: this.nextPropId('flower_sprig'),
      kind: 'flower_sprig',
      mesh,
      position: pos,
      shape: new CANNON.Sphere(0.28),
      mass: 0.18,
      beakWeight: 0.1,
      buoyant: true,
      tintHex: hex,
      isNestMaterial: true,
    });
  }

  public spawnNestItem(
    kind: 'twig' | 'ribbon' | 'velvet_down',
    pos: THREE.Vector3,
    hex: number
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`nest_${kind}_${hex}`, () => {
      if (kind === 'twig') {
        return mergeParts([
          transformGeo(rcyl(0.055, 0.045, 1.25, hex, 8), { rot: [0, 0, Math.PI * 0.5] }),
          transformGeo(smoothSphere(0.12, PALETTE.leafSage, 10, 8), { pos: [0.42, 0.09, 0] }),
        ]);
      }
      if (kind === 'ribbon') {
        return tube(
          [
            [-0.45, 0, 0.15],
            [-0.15, 0.08, -0.18],
            [0.18, 0.08, 0.18],
            [0.48, 0, -0.12],
          ],
          0.075,
          hex,
          16,
          6
        );
      }
      return smoothSphere(0.28, hex, 14, 10, [1.15, 0.85, 1.05]);
    });
    const mesh = this.createPropMesh(geo, this.mat, false);
    return this.physics.spawnProp({
      id: this.nextPropId(kind),
      kind,
      mesh,
      position: pos,
      shape: new CANNON.Sphere(0.28),
      mass: 0.18,
      beakWeight: 0.1,
      buoyant: kind === 'twig',
      tintHex: hex,
      isNestMaterial: true,
    });
  }

  public spawnGlidingPaperAirplane(
    pos: THREE.Vector3,
    initialVel: THREE.Vector3
  ): InteractiveProp {
    const geo = this.getOrCreateGeo('paper_airplane', () =>
      buildPaperAirplaneGeometry(PALETTE.porcelainWhite)
    );
    const mesh = this.createPropMesh(geo);
    const p = this.physics.spawnProp({
      id: this.nextPropId('paper_airplane'),
      kind: 'paper_airplane',
      mesh,
      position: pos,
      shape: new CANNON.Box(new CANNON.Vec3(0.55, 0.15, 0.65)),
      mass: 0.2,
      beakWeight: 0.18,
      linearDamping: 0.08,
      glideLift: true,
      buoyant: true,
    });
    p.body.velocity.set(initialVel.x, initialVel.y, initialVel.z);
    return p;
  }

  public spawnStudioBook(pos: THREE.Vector3, coverHex: number): InteractiveProp {
    const geo = this.getOrCreateGeo(`studio_book_${coverHex}`, () =>
      mergeParts([
        rbox(1.65, 0.34, 1.22, 0.05, coverHex, 1),
        transformGeo(rbox(1.56, 0.26, 1.16, 0.02, PALETTE.porcelainWhite, 1), {
          pos: [0.04, 0, 0],
        }),
        transformGeo(rbox(0.14, 0.35, 1.23, 0.03, PALETTE.goldGlow, 1), {
          pos: [-0.74, 0, 0],
        }),
      ])
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('studio_book'),
      kind: 'studio_book',
      mesh,
      position: pos,
      shape: new CANNON.Box(new CANNON.Vec3(0.825, 0.17, 0.61)),
      mass: 0.52,
      pushRadius: 0.72,
      grabbable: false,
    });
  }

  public spawnBreakableCeramicMug(
    pos: THREE.Vector3,
    bodyHex: number = PALETTE.porcelainWhite,
    liquidHex: number = PALETTE.coffeeDark,
    stripeHex?: number,
    onTopple?: ToppleCallback
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(
      `ceramic_mug_${bodyHex}_${liquidHex}_${stripeHex ?? 'none'}`,
      () =>
        transformGeo(buildCeramicMugGeometry(bodyHex, liquidHex, stripeHex), {
          pos: [0, -0.42, 0],
        })
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('ceramic_mug'),
      kind: 'ceramic_mug',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.41, 0.36, 0.84, 12),
      mass: 0.42,
      pushRadius: 0.54,
      grabbable: false,
      onTopple,
      breakable: {
        impactSpeedThreshold: 6.0,
        peckHitsToBreak: 2,
        shardHex: bodyHex,
        onBreak: onTopple,
      },
    });
  }

  public spawnBreakableTeacup(
    pos: THREE.Vector3,
    cupHex: number = PALETTE.porcelainWhite,
    trimHex: number = PALETTE.goldGlow,
    onTopple?: ToppleCallback
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`teacup_${cupHex}_${trimHex}`, () =>
      transformGeo(buildPorcelainTeacupGeometry(cupHex, trimHex), {
        pos: [0, -0.29, 0],
      })
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('teacup'),
      kind: 'teacup',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.42, 0.25, 0.58, 12),
      mass: 0.26,
      pushRadius: 0.48,
      grabbable: false,
      onTopple,
      breakable: {
        impactSpeedThreshold: 5.2,
        peckHitsToBreak: 2,
        shardHex: cupHex,
        onBreak: onTopple,
      },
    });
  }

  public spawnBreakablePlate(
    pos: THREE.Vector3,
    plateHex: number = PALETTE.porcelainWhite,
    rimHex: number = PALETTE.awningCobalt
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`porcelain_plate_${plateHex}_${rimHex}`, () =>
      transformGeo(buildPorcelainPlateGeometry(plateHex, rimHex), {
        pos: [0, -0.08, 0],
      })
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('porcelain_plate'),
      kind: 'porcelain_plate',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.88, 0.56, 0.16, 14),
      mass: 0.34,
      pushRadius: 0.86,
      grabbable: false,
      breakable: {
        impactSpeedThreshold: 5.5,
        peckHitsToBreak: 2,
        shardHex: plateHex,
      },
    });
  }

  public spawnBreakablePigmentJar(
    pos: THREE.Vector3,
    pigmentHex: number = PALETTE.birdBlueTit
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`pigment_jar_${pigmentHex}`, () =>
      transformGeo(buildPigmentJarGeometry(pigmentHex), {
        pos: [0, -0.39, 0],
      })
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('pigment_jar'),
      kind: 'pigment_jar',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.32, 0.32, 0.78, 12),
      mass: 0.32,
      pushRadius: 0.46,
      grabbable: false,
      breakable: {
        impactSpeedThreshold: 5.4,
        peckHitsToBreak: 2,
        shardHex: pigmentHex,
      },
    });
  }

  public spawnBreakableTerracottaPot(
    pos: THREE.Vector3,
    bloomHex: number = PALETTE.tulipCoral
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`terracotta_pot_${bloomHex}`, () =>
      transformGeo(buildSmallTerracottaPotGeometry(bloomHex), {
        pos: [0, -0.46, 0],
      })
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('terracotta_pot'),
      kind: 'terracotta_pot',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.4, 0.27, 0.92, 12),
      mass: 0.48,
      pushRadius: 0.52,
      grabbable: false,
      breakable: {
        impactSpeedThreshold: 5.8,
        peckHitsToBreak: 2,
        shardHex: PALETTE.roofTerracotta,
      },
    });
  }

  public spawnBreakableGlassCarafe(
    pos: THREE.Vector3,
    glassHex: number = PALETTE.windowGlass,
    accentHex: number = PALETTE.awningMint
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`glass_carafe_${glassHex}_${accentHex}`, () =>
      transformGeo(buildGlassCarafeGeometry(glassHex, accentHex), {
        pos: [0, -0.54, 0],
      })
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('glass_carafe'),
      kind: 'glass_carafe',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.3, 0.36, 1.08, 12),
      mass: 0.38,
      pushRadius: 0.5,
      grabbable: false,
      breakable: {
        impactSpeedThreshold: 5.0,
        peckHitsToBreak: 2,
        shardHex: glassHex,
      },
    });
  }

  public spawnBreakableCeramicVase(
    pos: THREE.Vector3,
    vaseHex: number = PALETTE.awningCobalt,
    bloomHex: number = PALETTE.tulipYellow
  ): InteractiveProp {
    const geo = this.getOrCreateGeo(`ceramic_vase_${vaseHex}_${bloomHex}`, () =>
      transformGeo(buildCeramicVaseGeometry(vaseHex, PALETTE.goldGlow, bloomHex), {
        pos: [0, -0.49, 0],
      })
    );
    const mesh = this.createPropMesh(geo);
    return this.physics.spawnProp({
      id: this.nextPropId('ceramic_vase'),
      kind: 'ceramic_vase',
      mesh,
      position: pos,
      shape: new CANNON.Cylinder(0.34, 0.25, 0.98, 12),
      mass: 0.4,
      pushRadius: 0.5,
      grabbable: false,
      breakable: {
        impactSpeedThreshold: 5.4,
        peckHitsToBreak: 2,
        shardHex: vaseHex,
      },
    });
  }
}
