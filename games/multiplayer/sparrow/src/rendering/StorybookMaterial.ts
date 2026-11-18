import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  mix,
  smoothstep,
  clamp,
  pow,
  sin,
  cos,
  dot,
  max,
  abs,
  time,
  screenUV,
  positionLocal,
  positionWorld,
  positionView,
  normalLocal,
  normalWorld,
  normalView,
  positionViewDirection,
  diffuseColor,
  pass,
  mrt,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { PALETTE } from './Palette.ts';

/**
 * Global shader uniforms shared across all storybook cel materials and sky dome
 * so the neighborhood shifts smoothly from crisp sunlit morning to golden hour warmth.
 */
export const storybookUniforms = {
  awakeningFactor: uniform(0.0), // 0.0 morning -> 1.0 Golden Morning Warmth
  sunDirWorld: uniform(new THREE.Vector3(68, 118, 52).normalize()),
  invResolution: uniform(
    new THREE.Vector2(
      1.0 / Math.max(1, typeof window !== 'undefined' ? window.innerWidth : 1280),
      1.0 / Math.max(1, typeof window !== 'undefined' ? window.innerHeight : 720)
    )
  ),
};

/**
 * Crisp Matte Gouache Cel-Shading LightingModel for Three.js WebGPU.
 * Calibrated so sunlit whites/creams preserve distinct 3-step paper-gouache shading without glow or clipping.
 */
export class StorybookCelLightingModel extends THREE.LightingModel {
  private rimStrength: number;

  constructor(rimStrength = 0.075) {
    super();
    this.rimStrength = rimStrength;
  }

  override indirect(builder: THREE.NodeBuilder): void {
    const { ambientOcclusion, reflectedLight } = builder.context as {
      ambientOcclusion: ReturnType<typeof float>;
      reflectedLight: {
        indirectDiffuse: { addAssign: (n: unknown) => void; mulAssign: (n: unknown) => void };
      };
    };

    // Cool cerulean-indigo sky fill above vs warm bounced terracotta-limestone below
    const hemiWeight = clamp(normalWorld.y.mul(0.5).add(0.5), 0.0, 1.0);
    const coolSkyFill = vec3(0.38, 0.44, 0.58);
    const warmBounceFill = vec3(0.38, 0.33, 0.29);
    const baseFill = mix(warmBounceFill, coolSkyFill, hemiWeight);

    const goldenLift = mix(
      vec3(1.0, 1.0, 1.0),
      vec3(1.08, 1.02, 0.94),
      storybookUniforms.awakeningFactor
    );

    // Warm sunlit gouache bounce-light inside the Conservatory Atelier (x: -88..-38, y: 25.8..52, z: 24..80)
    const inAtelierX = smoothstep(float(-89.0), float(-84.5), positionWorld.x).mul(
      float(1.0).sub(smoothstep(float(-40.5), float(-37.2), positionWorld.x))
    );
    const inAtelierY = smoothstep(float(25.2), float(26.8), positionWorld.y).mul(
      float(1.0).sub(smoothstep(float(50.5), float(53.0), positionWorld.y))
    );
    const inAtelierZ = smoothstep(float(23.0), float(26.5), positionWorld.z).mul(
      float(1.0).sub(smoothstep(float(77.5), float(81.0), positionWorld.z))
    );
    const atelierFactor = inAtelierX.mul(inAtelierY).mul(inAtelierZ);
    const atelierBounceLift = vec3(0.24, 0.195, 0.145).mul(atelierFactor);

    reflectedLight.indirectDiffuse.addAssign(
      diffuseColor.rgb.mul(baseFill.add(atelierBounceLift)).mul(goldenLift)
    );
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }

  override direct(lightData: THREE.LightingModelDirectInput): void {
    const lightDir = lightData.lightDirection as unknown as ReturnType<typeof vec3>;
    const lightCol = lightData.lightColor as unknown as ReturnType<typeof vec3>;
    const directDiffuse = lightData.reflectedLight.directDiffuse as unknown as {
      addAssign: (n: unknown) => void;
    };

    const nView = normalView.normalize();
    const dotNL = nView.dot(lightDir);
    const fw = clamp(dotNL.fwidth().mul(0.85), 0.014, 0.065);

    // Three crisp gouache cel bands calibrated to never blow out white/cream pigments
    const midBand = smoothstep(float(-0.06).sub(fw), float(-0.06).add(fw), dotNL);
    const litBand = smoothstep(float(0.24).sub(fw), float(0.24).add(fw), dotNL);
    const hiBand = smoothstep(float(0.68).sub(fw), float(0.68).add(fw), dotNL);

    const celIrradiance = midBand.mul(0.18).add(litBand.mul(0.29)).add(hiBand.mul(0.08));

    // Subtle sunlit grazing rim on lit silhouettes (fast squared falloff instead of transcendental pow)
    const vDir = positionViewDirection.normalize();
    const oneMinusV = float(1.0).sub(clamp(nView.dot(vDir).abs(), 0.0, 1.0));
    const oneMinusV2 = oneMinusV.mul(oneMinusV);
    const rim = oneMinusV2
      .mul(oneMinusV)
      .mul(midBand)
      .mul(float(this.rimStrength));

    const directContribution = diffuseColor.rgb
      .mul(celIrradiance.add(rim))
      .mul(lightCol);

    directDiffuse.addAssign(directContribution);
  }
}

export interface PastelMaterialOptions {
  color?: number;
  vertexColors?: boolean;
  rimStrength?: number;
  side?: THREE.Side;
  emissiveHex?: number;
  emissiveIntensity?: number;
  fog?: boolean;
}

class CustomStorybookNodeMaterial extends THREE.MeshToonNodeMaterial {
  private lightingModelInstance: StorybookCelLightingModel;

  constructor(rimStrength = 0.075) {
    super();
    this.lightingModelInstance = new StorybookCelLightingModel(rimStrength);
  }

  override setupLightingModel(): THREE.LightingModel {
    return this.lightingModelInstance;
  }
}

const materialCache = new Map<string, THREE.NodeMaterial>();

export function createPastelMaterial(opts: PastelMaterialOptions = {}): THREE.NodeMaterial {
  const vertexColors = opts.vertexColors ?? true;
  const rimStrength = opts.rimStrength ?? 0.075;
  const side = opts.side ?? THREE.FrontSide;
  const fog = opts.fog ?? true;
  const key = `${opts.color ?? 0xffffff}|${vertexColors ? 1 : 0}|${rimStrength}|${side}|${opts.emissiveHex ?? -1}|${opts.emissiveIntensity ?? 0.35}|${fog ? 1 : 0}`;

  const cached = materialCache.get(key);
  if (cached) return cached;

  const mat = new CustomStorybookNodeMaterial(rimStrength);
  const baseCol = new THREE.Color(opts.color ?? 0xffffff);

  mat.vertexColors = vertexColors;
  mat.side = side;
  mat.fog = fog;

  if (opts.color !== undefined && !mat.vertexColors) {
    mat.colorNode = vec4(baseCol.r, baseCol.g, baseCol.b, 1.0);
  } else if (opts.color !== undefined && mat.vertexColors) {
    mat.color = baseCol;
  }

  if (opts.emissiveHex !== undefined) {
    mat.emissive = new THREE.Color(opts.emissiveHex);
    mat.emissiveIntensity = opts.emissiveIntensity ?? 0.35;
  }

  materialCache.set(key, mat);
  return mat;
}

export interface BirdPlumageMaterialSpec {
  crown: number;
  mantle: number;
  scapular: number;
  breast: number;
  belly: number;
  cheek: number;
  bib: number | null;
  faceBlaze: number | null;
  bodyScale: [number, number, number];
  headScale: number;
  isPigeon: boolean;
}

const birdPlumageMatCache = new Map<string, THREE.NodeMaterial>();

function colorVec3(hex: number) {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
}

/**
 * Per-pixel TSL cel material for avian torso hulls: evaluates multi-stop chestnut mantle,
 * toasted-buff shoulder/scapular transitions, belly shading, and throat bib at native screen
 * fragment resolution so close-up views get smooth feather gradients without per-vertex blockiness.
 */
export function createBirdTorsoPlumageMaterial(spec: BirdPlumageMaterialSpec): THREE.NodeMaterial {
  const key = `torso|${spec.crown}|${spec.mantle}|${spec.scapular}|${spec.breast}|${spec.belly}|${spec.bib ?? -1}|${spec.faceBlaze ?? -1}|${spec.bodyScale.join(',')}|${spec.isPigeon ? 1 : 0}`;
  const cached = birdPlumageMatCache.get(key);
  if (cached) return cached;

  const mat = new CustomStorybookNodeMaterial(0.095);

  const [bsX, bsY, bsZ] = spec.bodyScale;
  const isRobin = spec.bib !== null && spec.faceBlaze === spec.bib;

  const cBreast = colorVec3(spec.breast);
  const cBelly = colorVec3(spec.belly);
  const cMantle = colorVec3(spec.mantle);
  const cCrown = colorVec3(spec.crown);
  const cScapular = colorVec3(spec.scapular);
  const buffCol = new THREE.Color(spec.breast).lerp(new THREE.Color(spec.scapular), 0.54);
  const cBuffEdge = vec3(buffCol.r, buffCol.g, buffCol.b);
  const cBib = colorVec3(spec.bib ?? spec.breast);
  const cPigeonGreen = colorVec3(PALETTE.pigeonNeckGreen);
  const cPigeonPlum = colorVec3(PALETTE.pigeonNeckPlum);
  const cAoTint = colorVec3(0x525b78);
  const cTopTint = colorVec3(0xfff9eb);

  const torsoColor = Fn(() => {
    const px = positionLocal.x.div(bsX);
    const py = positionLocal.y.div(bsY);
    const pz = positionLocal.z.div(bsZ);
    const ax = abs(px);
    const ny = normalLocal.y;

    const col = cBreast.toVar();

    // 1. Soft lower-belly feather shade
    const bellyY = float(1.0).sub(smoothstep(float(-0.125), float(-0.02), py));
    const bellyZ = float(1.0).sub(smoothstep(float(-0.07), float(0.045), pz));
    col.assign(mix(col, cBelly, bellyY.mul(bellyZ)));

    // 2. Multi-stop dorsal mantle, buff shoulder margin & scapular feather gradient
    const neckWrapZ = pz.sub(max(float(0.0), py.sub(0.048)).mul(0.88));
    const frontWrap = float(1.0).sub(smoothstep(float(0.015), float(0.168), neckWrapZ));
    const backArch = py.add(pz.mul(0.135)).sub(ax.mul(ax).mul(0.42));

    const haloRise = smoothstep(float(-0.032), float(0.068), backArch);
    const haloNorm = smoothstep(float(-0.04), float(0.54), ny);
    const haloUnion = float(1.0).sub(
      float(1.0).sub(haloRise).mul(float(1.0).sub(haloNorm.mul(0.72)))
    );
    col.assign(mix(col, cBuffEdge, frontWrap.mul(haloUnion).mul(spec.isPigeon ? 0.3 : 0.72)));

    const dorsalH = smoothstep(float(0.014), float(0.102), backArch);
    const dorsalN = smoothstep(float(0.24), float(0.74), ny).mul(
      float(1.0).sub(smoothstep(float(-0.02), float(0.078), neckWrapZ))
    );
    const dorsalCore = float(1.0).sub(float(1.0).sub(dorsalH).mul(float(1.0).sub(dorsalN)));
    const mantleW = frontWrap.mul(dorsalCore);

    if (spec.isPigeon) {
      const upperNeckBlend = smoothstep(float(0.06), float(0.13), pz);
      const pigeonBack = mix(cMantle, cCrown, upperNeckBlend);
      col.assign(mix(col, pigeonBack, mantleW));

      const collarZ = smoothstep(float(0.075), float(0.14), pz);
      const collarY = smoothstep(float(0.055), float(0.12), py);
      const collarW = collarZ.mul(collarY);
      const greenW = smoothstep(float(0.13), float(0.18), py);
      col.assign(mix(col, cPigeonPlum, collarW.mul(float(1.0).sub(greenW))));
      col.assign(mix(col, cPigeonGreen, collarW.mul(greenW)));
    } else {
      // Rich chestnut mantle + warm scapular feather band + deeper central saddle + subtle covert wave
      const scapX = smoothstep(float(0.052), float(0.115), ax).mul(
        float(1.0).sub(smoothstep(float(0.138), float(0.21), ax))
      );
      const scapZ = smoothstep(float(-0.24), float(-0.05), pz).mul(
        float(1.0).sub(smoothstep(float(0.025), float(0.125), pz))
      );
      const ridgeW = smoothstep(float(0.078), float(0.158), backArch).mul(
        float(1.0).sub(smoothstep(float(0.02), float(0.12), ax))
      );
      const covertWave = sin(pz.mul(64.0).add(ax.mul(18.0))).mul(0.5).add(0.5);

      const richBack = mix(cMantle, cScapular, scapX.mul(scapZ).mul(0.44).add(covertWave.mul(0.08)));
      const neckNapeFade = float(1.0).sub(smoothstep(float(0.08), float(0.18), pz));
      const shadedBack = mix(richBack, cCrown, ridgeW.mul(neckNapeFade).mul(0.48));
      col.assign(mix(col, shadedBack, mantleW));
    }

    // 3. Per-pixel Robin breast or Passerine throat bib
    if (spec.bib !== null && !spec.isPigeon) {
      if (isRobin) {
        const rz = smoothstep(float(0.005), float(0.075), pz);
        const ry = smoothstep(float(-0.12), float(-0.045), py);
        const rx = float(1.0).sub(smoothstep(float(0.145), float(0.215), ax));
        col.assign(mix(col, cBib, rz.mul(ry).mul(rx)));
      } else {
        const bz = smoothstep(float(0.095), float(0.165), pz);
        const by = smoothstep(float(-0.03), float(0.05), py);
        const bx = float(1.0).sub(smoothstep(float(0.052), float(0.112), ax));
        col.assign(mix(col, cBib, bz.mul(by).mul(bx)));
      }
    }

    // 4. Match Sculptor.ts vertical soft ambient-occlusion & sunlit crown lift
    const tY = clamp(py.add(0.188).div(0.385), 0.0, 1.0);
    const aoFactor = clamp(
      float(1.0).sub(clamp(tY.mul(1.55), 0.0, 1.0)).mul(0.11).add(max(float(0.0), ny.negate()).mul(0.04)),
      0.0,
      0.28
    );
    col.assign(mix(col, cAoTint, aoFactor));
    const liftFactor = max(float(0.0), tY.sub(0.48)).mul(1.75 * 0.055);
    col.assign(mix(col, cTopTint, liftFactor));

    return vec4(col, 1.0);
  });

  mat.colorNode = torsoColor();
  birdPlumageMatCache.set(key, mat);
  return mat;
}

/**
 * Per-pixel TSL cel material for avian skull hulls: renders crisp yet velvety cheek patches,
 * chestnut/azure crowns, eye lores, and chin bibs without vertex-interpolation stair-stepping,
 * while feathering the lower nape smoothly into the torso mantle and shoulder buff.
 */
export function createBirdHeadPlumageMaterial(spec: BirdPlumageMaterialSpec): THREE.NodeMaterial {
  const key = `head|${spec.crown}|${spec.mantle}|${spec.scapular}|${spec.breast}|${spec.cheek}|${spec.bib ?? -1}|${spec.faceBlaze ?? -1}|${spec.headScale}|${spec.isPigeon ? 1 : 0}`;
  const cached = birdPlumageMatCache.get(key);
  if (cached) return cached;

  const mat = new CustomStorybookNodeMaterial(0.095);

  const hs = spec.headScale;
  const cBase = colorVec3(spec.isPigeon ? spec.crown : spec.breast);
  const cCheek = colorVec3(spec.cheek);
  const cCrown = colorVec3(spec.crown);
  const cMantle = colorVec3(spec.mantle);
  const templeMix = new THREE.Color(spec.cheek).lerp(new THREE.Color(spec.scapular), 0.52);
  const cTempleBuff = vec3(templeMix.r, templeMix.g, templeMix.b);
  const cLore = colorVec3(0x2b2322);
  const cBib = colorVec3(spec.bib ?? spec.breast);
  const cBlaze = colorVec3(spec.faceBlaze ?? spec.breast);
  const cAoTint = colorVec3(0x525b78);
  const cTopTint = colorVec3(0xfff9eb);

  const headColor = Fn(() => {
    const px = positionLocal.x.div(hs);
    const py = positionLocal.y.div(hs);
    const pz = positionLocal.z.div(hs);
    const ax = abs(px);
    const ny = normalLocal.y;

    const col = cBase.toVar();

    if (!spec.isPigeon) {
      const cx = smoothstep(float(0.052), float(0.114), ax);
      const cy = float(1.0).sub(smoothstep(float(-0.012), float(0.046), py));
      const czBack = smoothstep(float(-0.105), float(-0.012), pz);
      const czFront = float(1.0).sub(smoothstep(float(0.048), float(0.12), pz));
      col.assign(mix(col, cCheek, cx.mul(cy).mul(czBack).mul(czFront)));
    }

    const crownField = py.add(pz.mul(0.2)).sub(ax.mul(ax).mul(0.35));
    const templeHalo = smoothstep(float(-0.012), float(0.048), crownField);
    if (!spec.isPigeon) {
      col.assign(mix(col, cTempleBuff, templeHalo.mul(0.58)));
    }

    const crownTopW = smoothstep(float(0.016), float(0.072), crownField);
    // Keep nape plumage above the lower lateral neck tuck and blend lower dorsal nape into mantle
    const napeBackZ = float(1.0).sub(smoothstep(float(-0.118), float(-0.036), pz.add(py.mul(0.28))));
    const napeStayAboveCollar = smoothstep(float(-0.118), float(-0.028), py.sub(pz.mul(0.22)));
    const crownNapeW = napeBackZ.mul(napeStayAboveCollar);
    const crownW = float(1.0).sub(float(1.0).sub(crownTopW).mul(float(1.0).sub(crownNapeW)));

    const upperCrownToneW = smoothstep(float(-0.065), float(0.032), py.add(pz.mul(0.18)));
    const headDorsalCol = spec.isPigeon
      ? cCrown
      : mix(cMantle, cCrown, upperCrownToneW);
    col.assign(mix(col, headDorsalCol, crownW));

    if (spec.bib !== null && !spec.isPigeon && spec.faceBlaze === null) {
      const lz = smoothstep(float(0.048), float(0.098), pz);
      const lyLow = smoothstep(float(-0.01), float(0.022), py);
      const lyHigh = float(1.0).sub(smoothstep(float(0.022), float(0.058), py));
      const lx = smoothstep(float(0.06), float(0.114), ax);
      col.assign(mix(col, cLore, lz.mul(lyLow).mul(lyHigh).mul(lx).mul(0.78)));

      const chinZ = smoothstep(float(-0.018), float(0.072), pz);
      const chinY = float(1.0).sub(smoothstep(float(-0.062), float(-0.018), py));
      const chinX = float(1.0).sub(smoothstep(float(0.04), float(0.084), ax));
      col.assign(mix(col, cBib, chinZ.mul(chinY).mul(chinX)));
    }

    if (spec.faceBlaze !== null) {
      const fz = smoothstep(float(0.02), float(0.068), pz);
      const fyLow = smoothstep(float(-0.096), float(-0.048), py);
      const fyHigh = float(1.0).sub(smoothstep(float(0.068), float(0.116), py));
      col.assign(mix(col, cBlaze, fz.mul(fyLow).mul(fyHigh)));
    }

    const tY = clamp(py.add(0.155).div(0.325), 0.0, 1.0);
    const aoFactor = clamp(
      float(1.0).sub(clamp(tY.mul(1.85), 0.0, 1.0)).mul(0.035).add(max(float(0.0), ny.negate()).mul(0.015)),
      0.0,
      0.12
    );
    col.assign(mix(col, cAoTint, aoFactor));
    const liftFactor = max(float(0.0), tY.sub(0.48)).mul(1.75 * 0.065);
    col.assign(mix(col, cTopTint, liftFactor));

    return vec4(col, 1.0);
  });

  mat.colorNode = headColor();
  birdPlumageMatCache.set(key, mat);
  return mat;
}

/**
 * Foliage cel material with gentle TSL vertex breeze sway.
 */
export function createFoliageSwayMaterial(amplitude = 0.16, frequency = 1.6): THREE.NodeMaterial {
  const mat = new CustomStorybookNodeMaterial(0.09);
  mat.vertexColors = true;

  const swayPosition = Fn(() => {
    const pos = positionLocal.toVar();
    const wPos = positionWorld;
    const heightMask = clamp(pos.y.mul(0.18).add(0.4), 0.0, 1.0);
    const phase = time
      .mul(frequency)
      .add(wPos.x.mul(0.31))
      .add(wPos.z.mul(0.27));
    const offset = sin(phase).mul(amplitude).mul(heightMask);
    const offsetZ = cos(phase.mul(0.83))
      .mul(amplitude * 0.65)
      .mul(heightMask);
    pos.x.addAssign(offset);
    pos.z.addAssign(offsetZ);
    return pos;
  });

  mat.positionNode = swayPosition();
  return mat;
}

/**
 * Shimmering canal & fountain water cel material with concentric fountain rings,
 * briskly flowing eastward canal current ribbons, cascading wavelets, and cel-foam crests.
 */
export function createWaterShimmerMaterial(): THREE.NodeMaterial {
  const mat = new CustomStorybookNodeMaterial(0.12);

  const deepC = new THREE.Color(PALETTE.waterDeep);
  const midC = new THREE.Color(PALETTE.waterPool);
  const foamC = new THREE.Color(PALETTE.waterFoam);

  const waterDisplace = Fn(() => {
    const pos = positionLocal.toVar();
    const w = positionWorld;
    const dx = w.x.sub(48.0);
    const dz = w.z.sub(48.0);
    const rF = pow(dx.mul(dx).add(dz.mul(dz)).add(0.04), 0.5);
    const inFountain = float(1.0).sub(smoothstep(float(12.2), float(14.5), rF));
    const radialWave = sin(rF.mul(3.4).sub(time.mul(5.8))).mul(0.032);
    // Brisk eastward (+X) travelling river waves matching fountain energy
    const canalPrimary = sin(w.x.mul(1.15).sub(time.mul(5.6)).add(sin(w.z.mul(0.65)).mul(0.9)));
    const canalSecondary = cos(w.x.mul(2.1).sub(time.mul(7.4)).sub(w.z.mul(0.85)));
    const canalWave = canalPrimary.mul(0.026).add(canalSecondary.mul(0.014));
    pos.y.addAssign(mix(canalWave, radialWave, inFountain));
    return pos;
  });

  const waterColor = Fn(() => {
    const w = positionWorld;
    const dx = w.x.sub(48.0);
    const dz = w.z.sub(48.0);
    const rF = pow(dx.mul(dx).add(dz.mul(dz)).add(0.04), 0.5);
    const inFountain = float(1.0).sub(smoothstep(float(12.2), float(14.5), rF));

    // Outward-travelling concentric fountain ripples + splash rings at tier radii (r ~ 2.0, 4.1, 7.4)
    const fRing1 = sin(rF.mul(3.8).sub(time.mul(6.4)));
    const fRing2 = cos(rF.mul(6.2).sub(time.mul(8.6)).add(sin(w.x.mul(1.9).add(w.z.mul(1.7)))));
    const fCombined = fRing1.mul(0.62).add(fRing2.mul(0.38));

    // Splash foam bands where upper/middle waterfall curtains plunge into the pools
    const ringSplashA = float(1.0).sub(smoothstep(float(0.0), float(0.65), abs(rF.sub(7.35))));
    const ringSplashB = float(1.0).sub(smoothstep(float(0.0), float(0.52), abs(rF.sub(4.02))));
    const ringSplashC = float(1.0).sub(smoothstep(float(0.0), float(0.48), abs(rF.sub(1.95))));
    const splashZone = clamp(ringSplashA.add(ringSplashB).add(ringSplashC), 0.0, 1.0);

    // Brisk eastward (+X) flowing river ribbons + cascading current wavelets (matching fountain flow style)
    const cRibbonA = sin(
      w.z.mul(0.92).add(sin(w.x.mul(0.34).sub(time.mul(4.6))).mul(0.75))
    );
    const cRibbonB = cos(
      w.z.mul(1.68).sub(cos(w.x.mul(0.52).sub(time.mul(5.8))).mul(0.62))
    );
    const cRibbonMask = cRibbonA.mul(0.58).add(cRibbonB.mul(0.42));
    const cCascade = sin(w.x.mul(1.65).sub(time.mul(7.2)).add(cRibbonA.mul(1.95)));
    const cCombined = cRibbonMask.mul(0.56).add(cCascade.mul(0.44));

    // Canal stone quay-wall lap foam (z near -40.2 or -67.8) & stone arch-bridge wake eddies (x = -44, -96)
    const quayEdgeDist = abs(abs(w.z.add(54.0)).sub(13.5));
    const quayFoam = float(1.0).sub(smoothstep(float(0.0), float(1.35), quayEdgeDist));
    const bridgeWakeA = float(1.0).sub(smoothstep(float(0.0), float(2.8), abs(w.x.add(44.0))));
    const bridgeWakeB = float(1.0).sub(smoothstep(float(0.0), float(2.8), abs(w.x.add(96.0))));
    const canalTurbZone = clamp(
      quayFoam.mul(0.72).add(bridgeWakeA.add(bridgeWakeB).mul(0.52)),
      0.0,
      1.0
    );

    const combined = mix(cCombined, fCombined, inFountain);
    const base = mix(
      vec3(deepC.r, deepC.g, deepC.b),
      vec3(midC.r, midC.g, midC.b),
      clamp(combined.mul(0.54).add(0.56), 0.0, 1.0)
    );
    const fountainCausticFoam = smoothstep(float(0.48), float(0.80), fCombined).mul(0.65);
    const canalRibbonFoam = smoothstep(float(0.26), float(0.74), cCombined).mul(0.74);
    const ribbonFoam = mix(canalRibbonFoam, fountainCausticFoam, inFountain);

    const fountainSplashTurb = splashZone
      .mul(inFountain)
      .mul(float(0.68).add(sin(time.mul(9.2).add(rF.mul(7.0))).mul(0.24)));
    const canalSplashTurb = canalTurbZone
      .mul(float(1.0).sub(inFountain))
      .mul(float(0.58).add(sin(w.x.mul(2.4).sub(time.mul(8.6))).mul(0.28)));

    const foamAmt = clamp(
      ribbonFoam.add(fountainSplashTurb).add(canalSplashTurb),
      0.0,
      0.92
    );
    const col = mix(base, vec3(foamC.r, foamC.g, foamC.b), foamAmt);
    return vec4(col, 1.0);
  });

  mat.positionNode = waterDisplace();
  mat.colorNode = waterColor();
  return mat;
}

/**
 * Animated translucent cel-water material for flowing fountain waterfall curtains,
 * parabolic spouts, and gushing geyser plumes.
 */
export function createFountainFlowMaterial(opts: {
  height: number;
  upward?: boolean;
  opacity?: number;
}): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;

  const h = Math.max(0.25, opts.height);
  const flowSign = opts.upward ? -1.0 : 1.0;
  const baseOpacity = opts.opacity ?? 0.7;

  const deepC = new THREE.Color(PALETTE.waterDeep);
  const midC = new THREE.Color(PALETTE.waterPool);
  const foamC = new THREE.Color(PALETTE.waterFoam);

  const flowDisplace = Fn(() => {
    const pos = positionLocal.toVar();
    // vNorm: 0 at bottom (-h/2), 1 at top (+h/2)
    const vNorm = clamp(pos.y.div(h).add(0.5), 0.0, 1.0);
    const freeMask = opts.upward ? vNorm : float(1.0).sub(vNorm);
    const ripple = sin(
      pos.y
        .mul(3.4)
        .add(time.mul(10.5 * flowSign))
        .add(sin(pos.x.mul(3.1).add(pos.z.mul(2.7))).mul(1.6))
    )
      .mul(0.055)
      .mul(freeMask);

    const radLen = pow(pos.x.mul(pos.x).add(pos.z.mul(pos.z)).add(0.001), 0.5);
    pos.x.addAssign(pos.x.div(radLen).mul(ripple));
    pos.z.addAssign(pos.z.div(radLen).mul(ripple));
    return pos;
  });

  const flowColor = Fn(() => {
    const p = positionLocal;
    const vNorm = clamp(p.y.div(h).add(0.5), 0.0, 1.0);
    const radLen = pow(p.x.mul(p.x).add(p.z.mul(p.z)).add(0.0004), 0.5);
    const nx = p.x.div(radLen);
    const nz = p.z.div(radLen);

    // Seamless circumferential vertical water ribbons (unit circle harmonics: no seam, tall vertical columns)
    const vertRibbonA = sin(nx.mul(9.0).add(nz.mul(7.0)).add(sin(p.y.mul(0.85).add(time.mul(4.5 * flowSign))).mul(0.45)));
    const vertRibbonB = cos(nx.mul(13.0).sub(nz.mul(11.0)).sub(cos(p.y.mul(1.15).add(time.mul(6.2 * flowSign))).mul(0.4)));
    const ribbonMask = vertRibbonA.mul(0.58).add(vertRibbonB.mul(0.42));

    // Rapid downward/upward cascading droplets travelling along the vertical ribbons
    const cascade = sin(p.y.mul(3.2).add(time.mul(13.8 * flowSign)).add(vertRibbonA.mul(2.4)));
    const streamStrength = clamp(ribbonMask.mul(0.65).add(cascade.mul(0.35)), -1.0, 1.0);

    const lipFoam = smoothstep(float(0.80), float(1.0), vNorm);
    const plungeFoam = smoothstep(float(0.24), float(0.0), vNorm);
    const ribbonFoam = smoothstep(float(0.26), float(0.76), streamStrength);
    const foamMix = clamp(ribbonFoam.mul(0.72).add(lipFoam.mul(0.8)).add(plungeFoam.mul(0.92)), 0.0, 1.0);

    const aquaBase = mix(
      vec3(deepC.r, deepC.g, deepC.b),
      vec3(midC.r, midC.g, midC.b),
      clamp(vNorm.mul(0.55).add(0.38), 0.0, 1.0)
    );
    const col = mix(aquaBase, vec3(foamC.r, foamC.g, foamC.b), foamMix);

    // Airy translucent gaps between vertical water streams + crisp opaque whitewater crests
    const veilFactor = smoothstep(float(-0.55), float(0.45), ribbonMask);
    const alpha = clamp(
      float(baseOpacity).mul(float(0.32).add(veilFactor.mul(0.48)).add(foamMix.mul(0.42))),
      0.18,
      0.92
    );
    return vec4(col, alpha);
  });

  mat.positionNode = flowDisplace();
  mat.colorNode = flowColor();
  return mat;
}

/**
 * Unlit translucent FX material (chirp rings, glass window panes, water ripples).
 */
export function createUnlitPastelFXMaterial(
  hexColor: number,
  opacity = 0.65,
  doubleSided = true
): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.color = new THREE.Color(hexColor);
  mat.transparent = true;
  mat.opacity = opacity;
  mat.depthWrite = false;
  mat.side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  return mat;
}

/**
 * Procedural Painterly Sky Dome (`radius = 740 SU` enclosing high cumulus clouds & horizon ring).
 */
export function createSkyDomeMesh(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(740, 32, 24);
  geo.deleteAttribute('uv');

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.side = THREE.BackSide;
  mat.depthWrite = false;
  mat.fog = false;

  const zenDawn = new THREE.Color(PALETTE.skyZenithDawn);
  const midDawn = new THREE.Color(PALETTE.skyMidDawn);
  const horDawn = new THREE.Color(PALETTE.skyHorizonDawn);
  const zenGold = new THREE.Color(PALETTE.skyZenithGolden);
  const midGold = new THREE.Color(PALETTE.skyMidGolden);
  const horGold = new THREE.Color(PALETTE.skyHorizonGolden);
  const sunCoreC = new THREE.Color(PALETTE.sunCore);
  const sunHaloC = new THREE.Color(PALETTE.sunHalo);

  const skyShader = Fn(() => {
    const dir = positionLocal.normalize();
    const h = clamp(dir.y, 0.0, 1.0);
    const awaken = storybookUniforms.awakeningFactor;

    const zen = mix(
      vec3(zenDawn.r, zenDawn.g, zenDawn.b),
      vec3(zenGold.r, zenGold.g, zenGold.b),
      awaken
    );
    const mid = mix(
      vec3(midDawn.r, midDawn.g, midDawn.b),
      vec3(midGold.r, midGold.g, midGold.b),
      awaken
    );
    const hor = mix(
      vec3(horDawn.r, horDawn.g, horDawn.b),
      vec3(horGold.r, horGold.g, horGold.b),
      awaken
    );

    const lowBlend = smoothstep(float(0.0), float(0.28), h);
    const highBlend = smoothstep(float(0.24), float(0.82), h);
    const grad = mix(mix(hor, mid, lowBlend), zen, highBlend);

    // Warm morning sun disc + subtle atmospheric halo (matte gouache, non-blooming)
    const sunDot = clamp(dot(dir, storybookUniforms.sunDirWorld), 0.0, 1.0);
    const aureole = pow(sunDot, float(8.0)).mul(0.22);
    const sunDisc = smoothstep(float(0.9968), float(0.9988), sunDot);

    const withHalo = grad.add(vec3(sunHaloC.r, sunHaloC.g, sunHaloC.b).mul(aureole));
    const finalCol = mix(withHalo, vec3(sunCoreC.r, sunCoreC.g, sunCoreC.b).mul(0.94), sunDisc);
    return vec4(finalCol, 1.0);
  });

  mat.colorNode = skyShader();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

/**
 * Sets up the Three.js r186 WebGPU RenderPipeline (no bloom; matte paper-gouache look):
 * 1. Opaque-only `{ samples: 0 }` view-normal + linear-depth MRT prePass (translucent FX excluded)
 * 2. 4x MSAA primary color `scenePass`
 * 3. Half-resolution `GTAONode` grounded indigo-slate ambient occlusion
 * 4. Fine Bande-Dessinée Storybook Ink Contour pass (fading cleanly at skyline distance)
 * 5. Gouache Vibrance, Soft Paper-White Highlight Shoulder Roll-Off & Warm Sunlit Vignette
 */
export function createStorybookRenderPipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  opts?: { isMobile?: boolean }
): {
  renderPipeline: THREE.RenderPipeline;
  compilePassesAsync: () => Promise<void>;
} {
  const renderPipeline = new THREE.RenderPipeline(renderer);
  const isMobile = Boolean(opts?.isMobile);

  // Pack signed normalView.xyz + normalized linear view-depth (0..1 over 460 SU) into RGBA HalfFloat prePass.
  const linearDepth = clamp(positionView.z.negate().div(460.0), 0.0, 1.0);
  const prePass = pass(scene, camera, { samples: 0 });
  prePass.transparent = false;
  prePass.setMRT(
    mrt({
      output: vec4(normalView, linearDepth),
    })
  );

  const prePassNormalDepth = prePass.getTextureNode('output');
  const prePassDepth = prePass.getTextureNode('depth');

  // Primary 4x MSAA color scene pass
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');

  // Half-resolution GTAO for lush contact shadows under benches, cups, curbs & eaves
  const aoPass = ao(prePassDepth, prePassNormalDepth, camera);
  aoPass.resolutionScale = isMobile ? 0.4 : 0.5;
  aoPass.radius.value = 1.95;
  aoPass.thickness.value = 2.2;
  aoPass.scale.value = 1.18;
  aoPass.samples.value = isMobile ? 6 : 12;
  const aoTex = aoPass.getTextureNode();

  const composite = Fn(() => {
    const uvCoord = screenUV;
    // Exact integer 1-texel physical buffer offset prevents bilinear blending across depth edges
    const px = storybookUniforms.invResolution;

    // 1. Sample base MSAA color + GTAO (no bloom)
    const base = sceneColor;
    const rawAO = clamp(aoTex.r, 0.0, 1.0);
    const aoStrength = mix(float(1.0), rawAO, float(0.54));
    const aoCreaseColor = base.rgb.mul(vec3(0.52, 0.55, 0.67));
    const aoShaded = mix(aoCreaseColor, base.rgb, aoStrength);

    // 2. Crisp Bande-Dessinée / Storybook Ink Contours from Normal + Linear Depth neighbors
    const centerND = prePassNormalDepth.sample(uvCoord);
    const centerDepth = centerND.a;
    const ndL = prePassNormalDepth.sample(uvCoord.sub(vec2(px.x, 0.0)));
    const ndR = prePassNormalDepth.sample(uvCoord.add(vec2(px.x, 0.0)));
    const ndD = prePassNormalDepth.sample(uvCoord.sub(vec2(0.0, px.y)));
    const ndU = prePassNormalDepth.sample(uvCoord.add(vec2(0.0, px.y)));

    const depthGrad = abs(ndR.a.sub(ndL.a)).add(abs(ndU.a.sub(ndD.a)));
    const depthEdge = smoothstep(float(0.011), float(0.036), depthGrad);

    const normDiffH = float(1.0).sub(clamp(dot(ndR.rgb.normalize(), ndL.rgb.normalize()), -1.0, 1.0));
    const normDiffV = float(1.0).sub(clamp(dot(ndU.rgb.normalize(), ndD.rgb.normalize()), -1.0, 1.0));
    const normEdge = smoothstep(float(0.46), float(0.90), normDiffH.add(normDiffV)).mul(0.68);

    const distFade = float(1.0).sub(smoothstep(float(0.55), float(0.93), centerDepth));
    const edgeFactor = clamp(max(depthEdge, normEdge).mul(distFade).mul(0.56), 0.0, 0.56);
    const inkColor = aoShaded.mul(vec3(0.25, 0.20, 0.29));
    const inked = mix(aoShaded, inkColor, edgeFactor);

    // 3. Matte Gouache Vibrance + Soft Paper-White Highlight Shoulder Roll-Off (no glowing whites)
    const luma = dot(inked, vec3(0.2126, 0.7152, 0.0722));
    const chroma = inked.sub(vec3(luma));
    const satLevel = clamp(abs(chroma.r).add(abs(chroma.g)).add(abs(chroma.b)), 0.0, 1.0);
    const vibranceGain = float(1.26).sub(satLevel.mul(0.14));
    const vibrant = max(vec3(0.0), vec3(luma).add(chroma.mul(vibranceGain)));

    // Gentle mid-tone gouache contrast + hyperbolic shoulder compression so whites stay creamy & detailed
    const midContrast = max(vec3(0.0), vibrant.sub(0.42).mul(1.06).add(0.425));
    const rolledOff = midContrast.div(vec3(1.0).add(midContrast.mul(0.17)));
    const paperTinted = clamp(rolledOff.mul(1.09), 0.0, 0.96);

    // Subtle sunlit frame vignette
    const centeredUV = uvCoord.sub(0.5).mul(vec2(1.15, 1.0));
    const vigDist = dot(centeredUV, centeredUV);
    const vig = float(1.0).sub(clamp(vigDist.mul(0.26), 0.0, 0.15));

    return vec4(paperTinted.mul(vig), base.a);
  });

  renderPipeline.outputNode = composite();

  const compilePassesAsync = async (): Promise<void> => {
    const passPre = prePass as unknown as { compileAsync?: (r: THREE.WebGPURenderer) => Promise<void> };
    const passColor = scenePass as unknown as { compileAsync?: (r: THREE.WebGPURenderer) => Promise<void> };
    if (passPre.compileAsync) {
      await passPre.compileAsync(renderer);
    }
    if (passColor.compileAsync) {
      await passColor.compileAsync(renderer);
    }
  };

  return { renderPipeline, compilePassesAsync };
}
