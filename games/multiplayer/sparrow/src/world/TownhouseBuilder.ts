import * as THREE from 'three/webgpu';
import { PALETTE } from '../rendering/Palette.ts';
import {
  paintGeometry,
  rbox,
  rcyl,
  transformGeo,
  mergeParts,
} from '../geometry/Sculptor.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { PerchSegment, PerchSystem } from './PerchSystem.ts';

export interface InteractiveWindowSpec {
  id: string;
  wx: number;
  wy: number;
  wz: number;
  rotY: number;
  axis: 'x' | 'z';
  sign: 1 | -1;
  shutterHex: number;
  isFlowerbox: boolean;
  sillPerch: PerchSegment;
}

export interface TownhouseVisibleFaces {
  north?: boolean;
  south?: boolean;
  east?: boolean;
  west?: boolean;
}

export interface TownhouseSpec {
  id: string;
  center: [number, number];
  widthX: number;
  depthZ: number;
  floors: number;
  wallHex: number;
  shutterHex: number;
  roofStyle: 'mansard' | 'terracotta';
  frontFace: 'east' | 'west' | 'north' | 'south';
  awningHex?: number;
  addPerches?: boolean;
  visibleFaces?: TownhouseVisibleFaces;
  minColliderTopY?: number;
}

export interface TownhouseBuildContext {
  root: THREE.Object3D;
  mat: THREE.Material;
  physics: PhysicsWorld;
  perches: PerchSystem;
  createBouncyAwning: (
    id: string,
    center: THREE.Vector3,
    halfExtents: THREE.Vector3,
    stripeA: number,
    stripeB: number,
    bounceSpeed: number
  ) => void;
  onFlowerboxSillCreated?: (seg: PerchSegment, center: THREE.Vector3) => void;
  registerInteractiveWindow?: (win: InteractiveWindowSpec) => void;
}

/**
 * Builds an indexed pitched mansard or hip roof geometry.
 */
export function buildPitchedHipRoofGeo(
  w: number,
  d: number,
  h: number,
  topRatio: number,
  hex: number
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(topRatio, 1.0, h, 4, 1);
  g.rotateY(Math.PI * 0.25);
  g.scale(w / Math.SQRT2, 1.0, d / Math.SQRT2);
  g.computeVertexNormals();
  const painted = paintGeometry(g, hex, { bottomAO: 0.13, topLift: 0.08 });
  g.dispose();
  return painted;
}

/**
 * Reusable Haussmannian / Mediterranean Townhouse Generator:
 * - When `spec.visibleFaces` is set, faces it omits skip window/shutter/flowerbox, dormer and eave-perch geometry
 * - Adds architectural moldings + 4 clean vertical corner pilaster strips + story accent blocks
 * - Computes tight bounding spheres for frustum culling
 */
export function buildDetailedTownhouse(
  spec: TownhouseSpec,
  ctx: TownhouseBuildContext,
  collectInto?: THREE.BufferGeometry[]
): THREE.Mesh | null {
  const [cx, cz] = spec.center;
  const w = spec.widthX;
  const d = spec.depthZ;
  const trim = PALETTE.wallCreamTrim;
  const groundH = 25.5;
  const upperFloorH = 18.2;
  const wallH = groundH + (spec.floors - 1) * upperFloorH;
  const baseY = 0.28;

  // When `visibleFaces` is given, only the listed faces get detail; without it, all four do.
  const vis = spec.visibleFaces;
  const faces = {
    north: vis ? vis.north === true : true,
    south: vis ? vis.south === true : true,
    east: vis ? vis.east === true : true,
    west: vis ? vis.west === true : true,
  };

  const parts: THREE.BufferGeometry[] = [];

  // 1. Rusticated Limestone Ground Plinth + Upper Plaster Massing (~98–118 SU tall vs 11.2-SU humans)
  parts.push(
    transformGeo(rbox(w + 0.6, 5.6, d + 0.6, 0.24, PALETTE.wallLimestone, 1), {
      pos: [cx, baseY + 2.8, cz],
    }),
    transformGeo(rbox(w, wallH, d, 0.34, spec.wallHex, 1, { bottomAO: 0.14 }), {
      pos: [cx, baseY + wallH * 0.5, cz],
    })
  );

  // 2. Molded Stone Belt Cornices between every floor + Dentil Eave Cornice
  for (let f = 1; f <= spec.floors; f++) {
    const cy = f === spec.floors ? baseY + wallH : baseY + groundH + (f - 1) * upperFloorH;
    const overhang = f === spec.floors ? 1.65 : 0.88;
    parts.push(
      transformGeo(
        rbox(w + overhang, f === spec.floors ? 1.38 : 0.84, d + overhang, 0.16, trim, 1),
        { pos: [cx, cy, cz] }
      )
    );
  }

  // 3. Clean Vertical Corner Pilaster Strips + Story-Height Rusticated Accent Blocks (skipping fully unseen perimeter back corners)
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const cornerVisible =
        (sx > 0 ? faces.east : faces.west) || (sz > 0 ? faces.north : faces.south);
      if (!cornerVisible) continue;
      const px = cx + sx * (w * 0.5 - 0.38);
      const pz = cz + sz * (d * 0.5 - 0.38);
      parts.push(
        transformGeo(rbox(1.18, wallH - 0.4, 1.18, 0.08, trim, 1), {
          pos: [px, baseY + wallH * 0.5, pz],
        })
      );
      for (let f = 0; f < spec.floors; f++) {
        const ay =
          f === 0 ? baseY + 12.6 : baseY + groundH + (f - 1) * upperFloorH + upperFloorH * 0.5;
        parts.push(
          transformGeo(rbox(1.52, 2.6, 1.52, 0.08, trim, 1), {
            pos: [px, ay, pz],
          })
        );
      }
    }
  }

  // 4. Multi-Pane French Windows, Shutters, Flowerboxes & Juliet Balconies on visible facades only
  const addFacadeOpenings = (axis: 'x' | 'z', sign: -1 | 1, isFront: boolean): void => {
    const span = axis === 'x' ? d : w;
    const normalDist = (axis === 'x' ? w : d) * 0.5;
    const cols = Math.max(2, Math.floor((span - 4.4) / 9.8));
    const spacing = (span - 5.4) / Math.max(1, cols);

    // Ground-floor arched shopfront vitrines & carriage/entrance portal on front face
    for (let c = 0; c < cols; c++) {
      const offset = -((cols - 1) * spacing) * 0.5 + c * spacing;
      const isDoor = isFront && c === Math.floor(cols * 0.5);
      const gx = axis === 'x' ? cx + sign * (normalDist + 0.08) : cx + offset;
      const gz = axis === 'z' ? cz + sign * (normalDist + 0.08) : cz + offset;
      const rotY =
        axis === 'x' ? (sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) : sign > 0 ? 0 : Math.PI;

      if (isDoor) {
        parts.push(
          transformGeo(rbox(5.6, 16.8, 0.58, 0.12, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 8.4, gz],
          }),
          transformGeo(rbox(4.4, 15.4, 0.68, 0.1, PALETTE.woodWalnut, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 7.8, gz],
          }),
          transformGeo(rcyl(2.2, 2.2, 0.72, PALETTE.windowWarmLit, 12), {
            rot: axis === 'x' ? [0, 0, Math.PI * 0.5] : [Math.PI * 0.5, 0, 0],
            pos: [gx, baseY + 15.4, gz],
          })
        );
      } else {
        parts.push(
          transformGeo(rbox(6.0, 14.2, 0.5, 0.12, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 11.4, gz],
          }),
          transformGeo(rbox(4.9, 12.8, 0.6, 0.08, PALETTE.windowDeep, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 11.4, gz],
          }),
          transformGeo(rbox(5.0, 0.3, 0.7, 0.05, trim, 1), {
            rot: [0, rotY, 0],
            pos: [gx, baseY + 11.8, gz],
          })
        );
      }
    }

    // Ground-floor striped storefront awning if specified
    if (isFront && spec.awningHex) {
      const awDepth = 5.6;
      const awW = Math.min(span - 3.0, cols * spacing + 3.4);
      const awY = baseY + 21.8;
      const awX = axis === 'x' ? cx + sign * (normalDist + awDepth * 0.5) : cx;
      const awZ = axis === 'z' ? cz + sign * (normalDist + awDepth * 0.5) : cz;
      const halfExt =
        axis === 'x'
          ? new THREE.Vector3(awDepth * 0.5, 0.58, awW * 0.5)
          : new THREE.Vector3(awW * 0.5, 0.58, awDepth * 0.5);
      ctx.createBouncyAwning(
        `${spec.id}_awning`,
        new THREE.Vector3(awX, awY, awZ),
        halfExt,
        spec.awningHex,
        PALETTE.awningCream,
        17.5
      );
    }

    // Tall Haussmannian upper-story French windows + shutters + flowerboxes / Juliet balconies
    for (let f = 1; f < spec.floors; f++) {
      const wy = baseY + groundH + (f - 1) * upperFloorH + 8.8;
      for (let c = 0; c < cols; c++) {
        const offset = -((cols - 1) * spacing) * 0.5 + c * spacing;
        const wx = axis === 'x' ? cx + sign * (normalDist + 0.08) : cx + offset;
        const wz = axis === 'z' ? cz + sign * (normalDist + 0.08) : cz + offset;
        const rotY =
          axis === 'x' ? (sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) : sign > 0 ? 0 : Math.PI;
        const warmLit = (f + c) % 3 === 0;
        const glassCol = warmLit ? PALETTE.windowWarmLit : PALETTE.windowGlass;

        // Window frame, lintel crest, recessed glass, horizontal transoms & vertical mullion
        parts.push(
          transformGeo(rbox(4.8, 11.4, 0.44, 0.1, trim, 1), {
            rot: [0, rotY, 0],
            pos: [wx, wy, wz],
          }),
          transformGeo(rbox(5.3, 0.48, 0.72, 0.06, trim, 1), {
            rot: [0, rotY, 0],
            pos: [wx, wy + 5.85, wz],
          }),
          transformGeo(rbox(3.8, 10.2, 0.54, 0.06, glassCol, 1), {
            rot: [0, rotY, 0],
            pos: [wx, wy, wz],
          }),
          transformGeo(rbox(3.9, 0.24, 0.62, 0.04, trim, 1), {
            rot: [0, rotY, 0],
            pos: [wx, wy + 1.0, wz],
          }),
          transformGeo(rbox(3.9, 0.22, 0.62, 0.04, trim, 1), {
            rot: [0, rotY, 0],
            pos: [wx, wy - 2.2, wz],
          }),
          transformGeo(rbox(0.24, 10.2, 0.62, 0.04, trim, 1), {
            rot: [0, rotY, 0],
            pos: [wx, wy, wz],
          })
        );

        const useInteractiveShutters = Boolean(
          spec.addPerches && isFront && f === 1 && !warmLit && ctx.registerInteractiveWindow
        );

        // Paired louvered shutters (static unless promoted to hinged interactive shutters)
        if (!useInteractiveShutters) {
          for (const sSide of [-1, 1] as const) {
            const shOff = sSide * 2.75;
            const shX = axis === 'x' ? wx + sign * 0.16 : wx + shOff;
            const shZ = axis === 'z' ? wz + sign * 0.16 : wz + shOff;
            parts.push(
              transformGeo(rbox(1.45, 10.4, 0.3, 0.06, spec.shutterHex, 1), {
                rot: [0, rotY, 0],
                pos: [shX, wy, shZ],
              })
            );
          }
        }

        // Projecting windowsill + terracotta flowerbox OR wrought-iron Juliet balcony
        const sillOut = 0.78;
        const sxPos = axis === 'x' ? cx + sign * (normalDist + sillOut) : wx;
        const szPos = axis === 'z' ? cz + sign * (normalDist + sillOut) : wz;
        parts.push(
          transformGeo(rbox(5.2, 0.6, 1.45, 0.08, trim, 1), {
            rot: [0, rotY, 0],
            pos: [sxPos, wy - 5.8, szPos],
          })
        );

        const isFlowerbox = (f + c) % 2 === 0;
        if (isFlowerbox) {
          const bloomHex = (f + c) % 4 === 0 ? PALETTE.tulipCoral : PALETTE.tulipYellow;
          parts.push(
            transformGeo(rbox(4.2, 1.15, 1.12, 0.1, PALETTE.brickTerracotta, 1), {
              rot: [0, rotY, 0],
              pos: [sxPos, wy - 4.95, szPos],
            }),
            transformGeo(rbox(3.8, 0.72, 0.88, 0.18, PALETTE.leafSage, 1), {
              rot: [0, rotY, 0],
              pos: [
                axis === 'x' ? sxPos - sign * 0.08 : sxPos,
                wy - 4.2,
                axis === 'z' ? szPos - sign * 0.08 : szPos,
              ],
            })
          );
          for (const bOff of [-1.2, 0, 1.2]) {
            const bx = axis === 'x' ? sxPos - sign * 0.08 : sxPos + bOff;
            const bz = axis === 'z' ? szPos - sign * 0.08 : szPos + bOff;
            parts.push(
              transformGeo(rcyl(0.24, 0.12, 0.42, bloomHex, 6), {
                pos: [bx, wy - 3.75, bz],
              })
            );
          }
        } else {
          parts.push(
            transformGeo(rbox(4.8, 2.8, 0.24, 0.05, PALETTE.ironworkPlum, 1), {
              rot: [0, rotY, 0],
              pos: [
                axis === 'x' ? sxPos + sign * 0.48 : sxPos,
                wy - 4.1,
                axis === 'z' ? szPos + sign * 0.48 : szPos,
              ],
            })
          );
        }

        if (spec.addPerches) {
          const faceTag = `${axis}${sign > 0 ? 'p' : 'n'}`;
          const perchY = isFlowerbox ? wy - 4.38 : wy - 2.70;
          const outOff = isFlowerbox ? 0.50 : 0.48;
          const halfSpan = isFlowerbox ? 1.85 : 2.15;
          const pA =
            axis === 'x'
              ? new THREE.Vector3(sxPos + sign * outOff, perchY, szPos - halfSpan)
              : new THREE.Vector3(sxPos - halfSpan, perchY, szPos + sign * outOff);
          const pB =
            axis === 'x'
              ? new THREE.Vector3(sxPos + sign * outOff, perchY, szPos + halfSpan)
              : new THREE.Vector3(sxPos + halfSpan, perchY, szPos + sign * outOff);
          const sillSeg = ctx.perches.addStaticSegment(
            `${spec.id}_${faceTag}_sill_${f}_${c}`,
            pA,
            pB,
            isFlowerbox ? 0.04 : 0.09,
            isFlowerbox ? 'stone' : 'metal'
          );
          if (isFlowerbox) {
            ctx.onFlowerboxSillCreated?.(sillSeg, new THREE.Vector3(sxPos, wy - 3.9, szPos));
          }
          if (useInteractiveShutters) {
            ctx.registerInteractiveWindow?.({
              id: `${spec.id}_${faceTag}_win_${f}_${c}`,
              wx,
              wy,
              wz,
              rotY,
              axis,
              sign,
              shutterHex: spec.shutterHex,
              isFlowerbox,
              sillPerch: sillSeg,
            });
          }
        }
      }
    }
  };

  if (faces.east) addFacadeOpenings('x', 1, spec.frontFace === 'east');
  if (faces.west) addFacadeOpenings('x', -1, spec.frontFace === 'west');
  if (faces.north) addFacadeOpenings('z', 1, spec.frontFace === 'north');
  if (faces.south) addFacadeOpenings('z', -1, spec.frontFace === 'south');

  // 5. Steep Pitched Parisian Mansard Slate Roof OR Mediterranean Terracotta Hip Roof + Dormers + Chimneys
  const roofBaseY = baseY + wallH + 0.55;
  const isMansard = spec.roofStyle === 'mansard';
  const roofH = isMansard ? 13.4 : 10.6;
  const roofHex = isMansard ? PALETTE.roofSlate : PALETTE.roofTerracotta;
  const topRatio = isMansard ? 0.72 : 0.34;

  parts.push(
    transformGeo(buildPitchedHipRoofGeo(w + 1.1, d + 1.1, roofH, topRatio, roofHex), {
      pos: [cx, roofBaseY + roofH * 0.5, cz],
    }),
    transformGeo(
      rbox(w * topRatio + 0.45, 0.65, d * topRatio + 0.45, 0.12, PALETTE.roofCopperPatina, 1),
      { pos: [cx, roofBaseY + roofH + 0.18, cz] }
    )
  );

  if (isMansard) {
    const cw = w * topRatio;
    const cd = d * topRatio;
    parts.push(
      transformGeo(rbox(cw, 1.35, 0.2, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [cx, roofBaseY + roofH + 1.05, cz + cd * 0.48],
      }),
      transformGeo(rbox(cw, 1.35, 0.2, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [cx, roofBaseY + roofH + 1.05, cz - cd * 0.48],
      }),
      transformGeo(rbox(0.2, 1.35, cd, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [cx + cw * 0.48, roofBaseY + roofH + 1.05, cz],
      }),
      transformGeo(rbox(0.2, 1.35, cd, 0.04, PALETTE.ironworkPlum, 1), {
        pos: [cx - cw * 0.48, roofBaseY + roofH + 1.05, cz],
      })
    );

    if (spec.addPerches) {
      const mansardRailY = roofBaseY + roofH + 1.725;
      const hw = cw * 0.46;
      const hd = cd * 0.46;
      ctx.perches.addStaticSegment(
        `${spec.id}_mansard_rail_n`,
        new THREE.Vector3(cx - hw, mansardRailY, cz + cd * 0.48),
        new THREE.Vector3(cx + hw, mansardRailY, cz + cd * 0.48),
        0.08,
        'metal'
      );
      ctx.perches.addStaticSegment(
        `${spec.id}_mansard_rail_s`,
        new THREE.Vector3(cx - hw, mansardRailY, cz - cd * 0.48),
        new THREE.Vector3(cx + hw, mansardRailY, cz - cd * 0.48),
        0.08,
        'metal'
      );
      ctx.perches.addStaticSegment(
        `${spec.id}_mansard_rail_e`,
        new THREE.Vector3(cx + cw * 0.48, mansardRailY, cz - hd),
        new THREE.Vector3(cx + cw * 0.48, mansardRailY, cz + hd),
        0.08,
        'metal'
      );
      ctx.perches.addStaticSegment(
        `${spec.id}_mansard_rail_w`,
        new THREE.Vector3(cx - cw * 0.48, mansardRailY, cz - hd),
        new THREE.Vector3(cx - cw * 0.48, mansardRailY, cz + hd),
        0.08,
        'metal'
      );
    }

    const addRoofDormers = (axis: 'x' | 'z', sign: -1 | 1): void => {
      const span = axis === 'x' ? d : w;
      const slopeDist = (axis === 'x' ? w : d) * 0.44;
      const dCount = Math.max(1, Math.floor((span - 8.0) / 11.5));
      const dSpacing = (span - 9.0) / Math.max(1, dCount);
      const rotY =
        axis === 'x' ? (sign > 0 ? Math.PI * 0.5 : -Math.PI * 0.5) : sign > 0 ? 0 : Math.PI;
      for (let k = 0; k < dCount; k++) {
        const off = dCount === 1 ? 0 : -((dCount - 1) * dSpacing) * 0.5 + k * dSpacing;
        const dx = axis === 'x' ? cx + sign * slopeDist : cx + off;
        const dz = axis === 'z' ? cz + sign * slopeDist : cz + off;
        const dy = roofBaseY + 4.8;
        parts.push(
          transformGeo(rbox(3.5, 5.8, 3.2, 0.1, trim, 1), {
            rot: [0, rotY, 0],
            pos: [dx, dy, dz],
          }),
          transformGeo(rbox(2.4, 4.4, 0.48, 0.05, PALETTE.windowGlass, 1), {
            rot: [0, rotY, 0],
            pos: [
              axis === 'x' ? dx + sign * 1.42 : dx,
              dy - 0.1,
              axis === 'z' ? dz + sign * 1.42 : dz,
            ],
          }),
          transformGeo(buildPitchedHipRoofGeo(4.0, 3.7, 1.95, 0.18, PALETTE.roofCopperPatina), {
            pos: [dx, dy + 3.8, dz],
          })
        );
      }
    };

    if (faces.east) addRoofDormers('x', 1);
    if (faces.west) addRoofDormers('x', -1);
    if (faces.north) addRoofDormers('z', 1);
    if (faces.south) addRoofDormers('z', -1);
  }

  // Brick chimneys with terracotta chimney pots
  for (const side of [-1, 1] as const) {
    const chX = cx + side * (w * 0.28);
    const chZ = cz - d * 0.18;
    parts.push(
      transformGeo(rbox(2.8, 6.4, 2.8, 0.14, PALETTE.brickTerracotta, 1), {
        pos: [chX, roofBaseY + roofH + 1.8, chZ],
      }),
      transformGeo(rbox(3.3, 0.58, 3.3, 0.08, trim, 1), {
        pos: [chX, roofBaseY + roofH + 5.0, chZ],
      }),
      transformGeo(rcyl(0.46, 0.54, 1.65, PALETTE.roofTerracotta, 8), {
        pos: [chX - 0.58, roofBaseY + roofH + 6.0, chZ],
      }),
      transformGeo(rcyl(0.46, 0.54, 1.65, PALETTE.roofTerracotta, 8), {
        pos: [chX + 0.58, roofBaseY + roofH + 6.0, chZ],
      })
    );
  }

  let houseMesh: THREE.Mesh | null = null;
  if (collectInto) {
    for (let i = 0; i < parts.length; i++) {
      collectInto.push(parts[i]);
    }
  } else {
    houseMesh = new THREE.Mesh(mergeParts(parts), ctx.mat);
    houseMesh.castShadow = true;
    houseMesh.receiveShadow = true;
    houseMesh.geometry.computeBoundingSphere();
    ctx.root.add(houseMesh);
  }

  const naturalColH = wallH + roofH * 0.72;
  const totalColH =
    spec.minColliderTopY !== undefined
      ? Math.max(naturalColH, spec.minColliderTopY - baseY)
      : naturalColH;
  const body = ctx.physics.addStaticBox(
    new THREE.Vector3(cx, baseY + totalColH * 0.5, cz),
    new THREE.Vector3(w * 0.5, totalColH * 0.5, d * 0.5)
  );
  ctx.physics.setBumpMetadata(body, { surface: 'stone', causesDizzy: true });

  if (spec.addPerches) {
    const eaveY = baseY + wallH + 0.69;
    if (faces.east) {
      const ex = cx + w * 0.5 + 0.62;
      ctx.perches.addStaticSegment(
        `${spec.id}_roof_eave_e`,
        new THREE.Vector3(ex, eaveY, cz - d * 0.45),
        new THREE.Vector3(ex, eaveY, cz + d * 0.45),
        0.03,
        'stone'
      );
    }
    if (faces.west) {
      const ex = cx - w * 0.5 - 0.62;
      ctx.perches.addStaticSegment(
        `${spec.id}_roof_eave_w`,
        new THREE.Vector3(ex, eaveY, cz - d * 0.45),
        new THREE.Vector3(ex, eaveY, cz + d * 0.45),
        0.03,
        'stone'
      );
    }
    if (faces.north) {
      const ez = cz + d * 0.5 + 0.62;
      ctx.perches.addStaticSegment(
        `${spec.id}_roof_eave_n`,
        new THREE.Vector3(cx - w * 0.45, eaveY, ez),
        new THREE.Vector3(cx + w * 0.45, eaveY, ez),
        0.03,
        'stone'
      );
    }
    if (faces.south) {
      const ez = cz - d * 0.5 - 0.62;
      ctx.perches.addStaticSegment(
        `${spec.id}_roof_eave_s`,
        new THREE.Vector3(cx - w * 0.45, eaveY, ez),
        new THREE.Vector3(cx + w * 0.45, eaveY, ez),
        0.03,
        'stone'
      );
    }
  }

  return houseMesh;
}
