import * as THREE from 'three/webgpu';
import { PALETTE } from '../rendering/Palette.ts';
import type { GiantHumanConfig } from '../entities/NPCManager.ts';
import type { BirdSpecies } from '../entities/SparrowMesh.ts';

export interface CompanionBirdSpec {
  id: string;
  species?: BirdSpecies;
  homePos: THREE.Vector3;
  sanctuaryPos: THREE.Vector3;
  crownHex: number;
  voiceIndex: number;
  flockSlot: THREE.Vector3;
  ambientWaypoints?: THREE.Vector3[];
}

export interface PigeonFlockSpec {
  plazaCenter: THREE.Vector3;
  scatterPerches: THREE.Vector3[];
}

/**
 * Declarative manifest for the 18 articulated ~11.2-SU neighborhood citizens across NW, NE, SW, and SE blocks.
 */
export function buildCitizenManifest(): GiantHumanConfig[] {
  return [
    // --- NW Block: Boulangerie & Café Promenade ---
    {
      id: 'chef',
      position: new THREE.Vector3(-31.8, 0.35, 52.0),
      yaw: Math.PI * 0.5,
      seated: false,
      skinHex: PALETTE.skinRosy,
      coatHex: PALETTE.porcelainWhite,
      trouserHex: PALETTE.ironworkPlum,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'chef_toque',
      hairStyle: 'short',
      apron: true,
      heldProp: 'baguette_bag',
      idleActivity: 'tending',
    },
    {
      id: 'sleepy_commuter',
      position: new THREE.Vector3(-26.5, 0.35, 30.3),
      yaw: 0,
      seated: true,
      skinHex: PALETTE.skinWarmTan,
      coatHex: PALETTE.coatPeriwinkle,
      trouserHex: PALETTE.denimSoft,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'fedora',
      hairStyle: 'short',
    },
    {
      id: 'cafe_reader',
      position: new THREE.Vector3(-26.5, 0.35, 65.5),
      yaw: Math.PI,
      seated: true,
      skinHex: PALETTE.skinPeach,
      coatHex: PALETTE.coatRose,
      trouserHex: PALETTE.ironworkPlum,
      hairHex: PALETTE.hairAuburn,
      scarfHex: PALETTE.awningGold,
      hatStyle: 'beret',
      hairStyle: 'bob',
      heldProp: 'book',
      idleActivity: 'reading',
    },
    {
      id: 'stroller_avenue_n',
      position: new THREE.Vector3(-21.6, 0.28, 25.0),
      yaw: 0,
      seated: false,
      skinHex: PALETTE.skinPeach,
      coatHex: PALETTE.coatSlate,
      trouserHex: PALETTE.ironworkPlum,
      hairHex: PALETTE.hairHoney,
      hatStyle: 'newsboy',
      hairStyle: 'short',
      heldProp: 'briefcase',
      idleActivity: 'browsing',
      walkSpeed: 4.8,
      patrolWaypoints: [
        new THREE.Vector3(-21.6, 0.28, 25.0),
        new THREE.Vector3(-21.6, 0.28, 60.0),
        new THREE.Vector3(-21.6, 0.28, 96.0),
        new THREE.Vector3(-21.6, 0.28, 60.0),
      ],
    },
    {
      id: 'stroller_boulangerie',
      position: new THREE.Vector3(-32.0, 0.28, 90.0),
      yaw: -Math.PI * 0.5,
      seated: false,
      skinHex: PALETTE.skinRosy,
      coatHex: PALETTE.coatMustard,
      trouserHex: PALETTE.woodWalnut,
      hairHex: PALETTE.hairEspresso,
      scarfHex: PALETTE.awningCoral,
      hairStyle: 'bun',
      heldProp: 'baguette_bag',
      idleActivity: 'browsing',
      walkSpeed: 4.5,
      patrolWaypoints: [
        new THREE.Vector3(-32.0, 0.28, 90.0),
        new THREE.Vector3(-64.0, 0.28, 90.0),
        new THREE.Vector3(-92.0, 0.28, 90.0),
        new THREE.Vector3(-64.0, 0.28, 90.0),
      ],
    },

    // --- NE Block: Botanical Park, Fountain & Orangerie ---
    {
      id: 'busker',
      position: new THREE.Vector3(33.5, 0.45, 39.5),
      yaw: Math.PI * 0.72,
      seated: true,
      seatHipY: 2.72,
      seatHipRotX: -1.36,
      seatKneeRotX: 1.32,
      skinHex: PALETTE.skinPeach,
      coatHex: PALETTE.coatMustard,
      trouserHex: PALETTE.woodWalnut,
      hairHex: PALETTE.hairAuburn,
      hatStyle: 'beret',
      hairStyle: 'waves',
      guitar: true,
    },
    {
      id: 'bird_feeder',
      position: new THREE.Vector3(65.91, 0.35, 34.3),
      yaw: -Math.PI * 0.75,
      seated: true,
      seatHipY: 2.91,
      seatHipRotX: -1.46,
      seatKneeRotX: 1.46,
      skinHex: PALETTE.skinRosy,
      coatHex: PALETTE.coatSage,
      trouserHex: PALETTE.coatSlate,
      hairHex: PALETTE.hairSilver,
      hatStyle: 'sunhat',
      hairStyle: 'bun',
    },
    {
      id: 'park_sketcher',
      position: new THREE.Vector3(50.0, 0.35, 68.5),
      yaw: Math.PI,
      seated: false,
      skinHex: PALETTE.skinWarmTan,
      coatHex: PALETTE.coatPeriwinkle,
      trouserHex: PALETTE.denimSoft,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'beret',
      hairStyle: 'curls',
      heldProp: 'sketchpad',
      idleActivity: 'sketching',
      walkSpeed: 4.1,
      patrolWaypoints: [
        new THREE.Vector3(50.0, 0.35, 68.5),
        new THREE.Vector3(63.5, 0.35, 55.0),
      ],
    },
    {
      id: 'park_stroller_w',
      position: new THREE.Vector3(24.0, 0.35, 75.0),
      yaw: 0,
      seated: false,
      skinHex: PALETTE.skinPeach,
      coatHex: PALETTE.awningMint,
      trouserHex: PALETTE.coatSlate,
      hairHex: PALETTE.hairHoney,
      scarfHex: PALETTE.porcelainWhite,
      hairStyle: 'waves',
      heldProp: 'coffee_cup',
      idleActivity: 'conversing',
      walkSpeed: 4.6,
      patrolWaypoints: [
        new THREE.Vector3(24.0, 0.35, 75.0),
        new THREE.Vector3(43.0, 0.35, 75.0),
        new THREE.Vector3(46.0, 0.35, 92.0),
        new THREE.Vector3(43.0, 0.35, 75.0),
      ],
    },
    {
      id: 'park_botanist',
      position: new THREE.Vector3(76.0, 0.35, 46.0),
      yaw: -Math.PI * 0.4,
      seated: false,
      skinHex: PALETTE.skinDeepUmber,
      coatHex: PALETTE.coatSage,
      trouserHex: PALETTE.woodWalnut,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'sunhat',
      hairStyle: 'curls',
      heldProp: 'bouquet',
      idleActivity: 'tending',
      walkSpeed: 4.2,
      patrolWaypoints: [
        new THREE.Vector3(76.0, 0.35, 46.0),
        new THREE.Vector3(84.0, 0.35, 60.0),
        new THREE.Vector3(78.0, 0.35, 34.0),
        new THREE.Vector3(84.0, 0.35, 60.0),
      ],
    },

    // --- SW Block: Venetian Canal Quays, Balcony Painter, Gelateria & Florist ---
    {
      id: 'painter',
      position: new THREE.Vector3(-70.5, 25.82, -35.2),
      yaw: 0.45,
      seated: false,
      skinHex: PALETTE.skinPeach,
      coatHex: PALETTE.coatRose,
      trouserHex: PALETTE.denimSoft,
      hairHex: PALETTE.hairHoney,
      hatStyle: 'beret',
      hairStyle: 'waves',
      apron: true,
      heldProp: 'palette_brush',
      idleActivity: 'sketching',
    },
    {
      id: 'florist',
      position: new THREE.Vector3(-83.5, 0.28, -81.8),
      yaw: 0,
      seated: false,
      skinHex: PALETTE.skinDeepUmber,
      coatHex: PALETTE.awningMint,
      trouserHex: PALETTE.woodWalnut,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'sunhat',
      hairStyle: 'bun',
      apron: true,
      heldProp: 'bouquet',
      idleActivity: 'tending',
    },
    {
      id: 'gelato_patron',
      position: new THREE.Vector3(-56.0, 0.28, -84.2),
      yaw: Math.PI * 0.5,
      seated: false,
      skinHex: PALETTE.skinRosy,
      coatHex: PALETTE.coatPeriwinkle,
      trouserHex: PALETTE.denimSoft,
      hairHex: PALETTE.hairAuburn,
      hatStyle: 'newsboy',
      hairStyle: 'short',
      heldProp: 'coffee_cup',
      idleActivity: 'conversing',
      walkSpeed: 4.2,
      patrolWaypoints: [
        new THREE.Vector3(-56.0, 0.28, -84.2),
        new THREE.Vector3(-38.5, 0.28, -84.2),
      ],
    },
    {
      id: 'stroller_quay_s',
      position: new THREE.Vector3(-53.5, 0.35, -72.2),
      yaw: -Math.PI * 0.5,
      seated: false,
      skinHex: PALETTE.skinWarmTan,
      coatHex: PALETTE.coatMustard,
      trouserHex: PALETTE.woodWalnut,
      hairHex: PALETTE.hairAuburn,
      hatStyle: 'sunhat',
      hairStyle: 'bob',
      heldProp: 'sketchpad',
      idleActivity: 'watching_water',
      walkSpeed: 4.4,
      patrolWaypoints: [
        new THREE.Vector3(-53.5, 0.35, -72.2),
        new THREE.Vector3(-70.0, 0.35, -72.2),
        new THREE.Vector3(-86.5, 0.35, -72.2),
        new THREE.Vector3(-70.0, 0.35, -72.2),
      ],
    },
    {
      id: 'canal_watcher_n',
      position: new THREE.Vector3(-54.0, 0.28, -36.4),
      yaw: Math.PI,
      seated: false,
      skinHex: PALETTE.skinPeach,
      coatHex: PALETTE.coatSlate,
      trouserHex: PALETTE.ironworkPlum,
      hairHex: PALETTE.hairSilver,
      hatStyle: 'fedora',
      hairStyle: 'short',
      heldProp: 'book',
      idleActivity: 'watching_water',
      walkSpeed: 4.3,
      patrolWaypoints: [
        new THREE.Vector3(-54.0, 0.28, -36.4),
        new THREE.Vector3(-70.0, 0.28, -36.4),
        new THREE.Vector3(-86.0, 0.28, -36.4),
        new THREE.Vector3(-70.0, 0.28, -36.4),
      ],
    },

    // --- SE Block: Farmers' Market, Buttercup Bookshop & Clocktower Plaza ---
    {
      id: 'market_vendor',
      position: new THREE.Vector3(52.0, 0.35, -73.4),
      yaw: 0,
      seated: false,
      skinHex: PALETTE.skinWarmTan,
      coatHex: PALETTE.awningCoral,
      trouserHex: PALETTE.denimSoft,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'fedora',
      hairStyle: 'short',
      apron: true,
      idleActivity: 'tending',
    },
    {
      id: 'market_shopper',
      position: new THREE.Vector3(43.0, 0.35, -60.5),
      yaw: Math.PI,
      seated: false,
      skinHex: PALETTE.skinRosy,
      coatHex: PALETTE.coatSage,
      trouserHex: PALETTE.woodWalnut,
      hairHex: PALETTE.hairHoney,
      scarfHex: PALETTE.awningGold,
      hairStyle: 'curls',
      heldProp: 'baguette_bag',
      idleActivity: 'browsing',
      walkSpeed: 4.5,
      patrolWaypoints: [
        new THREE.Vector3(43.0, 0.35, -60.5),
        new THREE.Vector3(43.0, 0.35, -79.5),
        new THREE.Vector3(67.0, 0.35, -79.5),
        new THREE.Vector3(43.0, 0.35, -79.5),
      ],
    },
    {
      id: 'bookshop_scholar',
      position: new THREE.Vector3(30.0, 0.28, -52.0),
      yaw: Math.PI * 0.5,
      seated: false,
      skinHex: PALETTE.skinDeepUmber,
      coatHex: PALETTE.coatPeriwinkle,
      trouserHex: PALETTE.ironworkPlum,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'beret',
      hairStyle: 'short',
      heldProp: 'book',
      idleActivity: 'reading',
      walkSpeed: 4.5,
      patrolWaypoints: [
        new THREE.Vector3(30.0, 0.28, -52.0),
        new THREE.Vector3(66.0, 0.28, -52.0),
        new THREE.Vector3(74.0, 0.28, -76.0),
        new THREE.Vector3(66.0, 0.28, -52.0),
      ],
    },
    // --- Outer Side Promenades: NW Bouquiniste, NE Orangerie Walk, SW Artisan Stalls & SE Roastery Lane ---
    {
      id: 'bouquiniste_browser',
      position: new THREE.Vector3(-135.5, 0.28, 88.0),
      yaw: 0,
      seated: false,
      skinHex: PALETTE.skinPeach,
      coatHex: PALETTE.coatRose,
      trouserHex: PALETTE.denimSoft,
      hairHex: PALETTE.hairAuburn,
      hatStyle: 'beret',
      hairStyle: 'bob',
      heldProp: 'book',
      idleActivity: 'browsing',
      walkSpeed: 4.3,
      patrolWaypoints: [
        new THREE.Vector3(-135.5, 0.28, 88.0),
        new THREE.Vector3(-135.5, 0.28, 108.0),
        new THREE.Vector3(-114.0, 0.28, 134.0),
        new THREE.Vector3(-135.5, 0.28, 108.0),
      ],
    },
    {
      id: 'orangerie_gardener',
      position: new THREE.Vector3(134.0, 0.28, 62.0),
      yaw: 0,
      seated: false,
      skinHex: PALETTE.skinWarmTan,
      coatHex: PALETTE.coatSage,
      trouserHex: PALETTE.woodWalnut,
      hairHex: PALETTE.hairHoney,
      hatStyle: 'sunhat',
      hairStyle: 'waves',
      apron: true,
      heldProp: 'bouquet',
      idleActivity: 'tending',
      walkSpeed: 4.2,
      patrolWaypoints: [
        new THREE.Vector3(134.0, 0.28, 62.0),
        new THREE.Vector3(134.0, 0.28, 106.0),
        new THREE.Vector3(133.5, 0.28, 126.0),
        new THREE.Vector3(134.0, 0.28, 106.0),
      ],
    },
    {
      id: 'pottery_artisan',
      position: new THREE.Vector3(-94.0, 0.28, -128.0),
      yaw: Math.PI,
      seated: false,
      skinHex: PALETTE.skinRosy,
      coatHex: PALETTE.coatMustard,
      trouserHex: PALETTE.ironworkPlum,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'fedora',
      hairStyle: 'short',
      apron: true,
      idleActivity: 'tending',
      walkSpeed: 4.3,
      patrolWaypoints: [
        new THREE.Vector3(-94.0, 0.28, -128.0),
        new THREE.Vector3(-73.0, 0.28, -128.0),
        new THREE.Vector3(-52.0, 0.28, -128.0),
        new THREE.Vector3(-73.0, 0.28, -128.0),
      ],
    },
    {
      id: 'roastery_stroller',
      position: new THREE.Vector3(134.0, 0.28, -36.0),
      yaw: Math.PI,
      seated: false,
      skinHex: PALETTE.skinDeepUmber,
      coatHex: PALETTE.coatSlate,
      trouserHex: PALETTE.denimSoft,
      hairHex: PALETTE.hairEspresso,
      hatStyle: 'newsboy',
      hairStyle: 'curls',
      heldProp: 'coffee_cup',
      idleActivity: 'conversing',
      walkSpeed: 4.5,
      patrolWaypoints: [
        new THREE.Vector3(134.0, 0.28, -36.0),
        new THREE.Vector3(134.0, 0.28, -86.0),
        new THREE.Vector3(96.0, 0.28, -126.0),
        new THREE.Vector3(134.0, 0.28, -86.0),
      ],
    },
  ];
}

/**
 * Declarative manifest for the scatterable 6-pigeon plaza flock in the NE Botanical Park.
 */
export function buildParkPigeonFlockManifest(): PigeonFlockSpec {
  return {
    plazaCenter: new THREE.Vector3(54.0, 0.32, 33.0),
    scatterPerches: [
      new THREE.Vector3(48.0, 15.4, 48.0),
      new THREE.Vector3(36.0, 6.6, 18.5),
      new THREE.Vector3(58.0, 6.6, 18.5),
      new THREE.Vector3(88.0, 27.1, 86.0),
      new THREE.Vector3(48.0, 2.5, 60.5),
      new THREE.Vector3(60.5, 2.5, 48.0),
    ],
  };
}

/**
 * Declarative manifest for the 5 multi-species companion songbirds and 3 ambient district birds.
 */
export function buildCompanionBirdManifest(
  sanctuaryPos: THREE.Vector3,
  atticWindowSillPos: THREE.Vector3
): CompanionBirdSpec[] {
  const namedCompanions: CompanionBirdSpec[] = [
    {
      id: 'starter_tit',
      species: 'blue_tit',
      homePos: atticWindowSillPos,
      sanctuaryPos: sanctuaryPos.clone().add(new THREE.Vector3(-2.2, 0.45, 0.6)),
      crownHex: PALETTE.birdBlueTit,
      voiceIndex: 1,
      flockSlot: new THREE.Vector3(-2.8, 0.6, -4.0),
    },
    {
      id: 'fountain_robin',
      species: 'robin',
      homePos: new THREE.Vector3(48.0, 15.40, 48.0),
      sanctuaryPos: sanctuaryPos.clone().add(new THREE.Vector3(-1.2, 0.45, -1.35)),
      crownHex: PALETTE.sparrowWarmBack,
      voiceIndex: 0,
      flockSlot: new THREE.Vector3(2.8, 0.6, -4.0),
    },
    {
      id: 'painter_goldfinch',
      species: 'goldfinch',
      homePos: new THREE.Vector3(-62.5, 28.725, -39.4),
      sanctuaryPos: sanctuaryPos.clone().add(new THREE.Vector3(1.2, 0.45, -1.35)),
      crownHex: PALETTE.birdGoldfinch,
      voiceIndex: 2,
      flockSlot: new THREE.Vector3(-4.6, 1.0, -6.2),
    },
    {
      id: 'bookshop_warbler',
      species: 'warbler',
      homePos: new THREE.Vector3(38.0, 28.60, -44.6),
      sanctuaryPos: sanctuaryPos.clone().add(new THREE.Vector3(2.2, 0.45, 0.6)),
      crownHex: PALETTE.birdMintWarbler,
      voiceIndex: 6,
      flockSlot: new THREE.Vector3(4.6, 1.0, -6.2),
    },
    {
      id: 'clocktower_finch',
      species: 'finch',
      homePos: new THREE.Vector3(86.2, 114.30, -86.2),
      sanctuaryPos: sanctuaryPos.clone().add(new THREE.Vector3(0, 0.55, 1.9)),
      crownHex: PALETTE.birdRoseFinch,
      voiceIndex: 4,
      flockSlot: new THREE.Vector3(0, 1.4, -7.2),
    },
  ];

  const ambientSpecs: Array<{
    species: 'sparrow' | 'goldfinch' | 'blue_tit';
    voiceIndex: number;
    wps: THREE.Vector3[];
  }> = [
    {
      species: 'sparrow',
      voiceIndex: 7,
      wps: [
        new THREE.Vector3(-20.4, 0.68, 39.5),
        new THREE.Vector3(-20.6, 0.68, 58.2),
        new THREE.Vector3(-21.2, 0.68, 73.5),
      ],
    },
    {
      species: 'goldfinch',
      voiceIndex: 10,
      wps: [
        new THREE.Vector3(-48.8, 9.75, -54.0),
        new THREE.Vector3(-56.0, 0.68, -73.0),
        new THREE.Vector3(-82.0, 0.68, -73.0),
      ],
    },
    {
      species: 'blue_tit',
      voiceIndex: 11,
      wps: [
        new THREE.Vector3(42.0, 0.68, -76.0),
        new THREE.Vector3(62.0, 0.68, -76.0),
        new THREE.Vector3(44.0, 28.60, -44.6),
      ],
    },
  ];

  const ambientBirds: CompanionBirdSpec[] = ambientSpecs.map((as, idx) => ({
    id: `ambient_bird_${idx}`,
    species: as.species,
    homePos: as.wps[0],
    sanctuaryPos: sanctuaryPos.clone().add(new THREE.Vector3((idx - 1) * 1.25, 0.45, 2.0)),
    crownHex: PALETTE.sparrowChestnut,
    voiceIndex: as.voiceIndex,
    flockSlot: new THREE.Vector3((idx - 1) * 2.4, 1.2, -6.8),
    ambientWaypoints: as.wps,
  }));

  return [...namedCompanions, ...ambientBirds];
}
