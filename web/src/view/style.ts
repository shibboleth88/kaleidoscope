/**
 * How a node looks: a function of its type and its attributes.
 *
 * A type's `style` may say:
 *   color: '#hex'            shape: 'sphere' | 'icosahedron' | 'octahedron' | 'dodecahedron' | 'tetrahedron' | 'box' | 'torus' | 'cone'
 *   size: number             sizeBy: '<attr>'   (scales with that numeric attribute)
 *   colorBy: '<attr>'        (hue follows that numeric attribute, 0..1 → around the wheel)
 *   container: boolean       (drawn as a translucent place others stand in)
 *   position: "x y z"        (placed by those attributes, in its place's frame, rather than by the layout)
 *   scale: number            (world units per unit of position, radius and ellipsoid; default 0.15)
 *   radiusBy: '<attr>'       (its radius is that attribute, times scale)
 *   ellipsoid: [a, b, c]     (a place of fixed shape: those semi-axes, times scale)
 *   colorBy: '<attr>'        (numeric: hue around the wheel; text: a hue of its own for each value)
 *   asLink: boolean          (drawn as a curve between the things its ports join, not as a body)
 *   label: '<attr>'          (named by that attribute alone)
 *   opacity: number          (0..1: see-through, so what is inside or behind shows)
 * Anything unsaid is derived: the hue from the type's root supertype (so subtypes are kin), the shape from its name.
 */

import * as THREE from 'three';
import type { Scalar } from '../engine/carrier';
import type { Signature, TypeDecl } from '../engine/signature';

export const SHAPES = ['icosahedron', 'octahedron', 'dodecahedron', 'tetrahedron', 'sphere', 'box', 'torus', 'cone'] as const;
export type Shape = (typeof SHAPES)[number];

export interface Visual {
  color: THREE.Color;
  shape: Shape;
  size: number;
  container: boolean | undefined;
  /** Whether the type chose its shape (a container then keeps it; otherwise it is a sphere). */
  shaped: boolean;
  /** Where its attributes place it, in its place's frame. */
  pos?: THREE.Vector3;
  /** Its radius, from an attribute, in world units. */
  radius?: number;
  /** A place of fixed shape: semi-axes in world units. */
  ellipsoid?: THREE.Vector3;
  asLink: boolean;
  /** How opaque it is (a style's `opacity`): crowds of things drawn see-through so what joins them shows. */
  opacity: number;
  /** What names it, where an attribute does. */
  label?: string;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const toText = (s: Scalar) => ('int' in s ? s.int : 'float' in s ? s.float : 'text' in s ? s.text : s.bool);

const num = (s: Scalar | undefined): number | null =>
  s === undefined ? null : 'int' in s ? s.int : 'float' in s ? s.float : 'bool' in s ? (s.bool ? 1 : 0) : null;

function rootOf(sig: Signature, t: TypeDecl): TypeDecl {
  let cur = t;
  for (let i = 0; i < 32 && cur.supers.length; i++) cur = sig.get(cur.supers[0]);
  return cur;
}

export function visualOf(sig: Signature, type: number, attrs: Map<string, Scalar>): Visual {
  const t = sig.get(type);
  // a type looks like its supertypes, but for what it says itself
  const chain: TypeDecl[] = [];
  for (let cur: TypeDecl | undefined = t; cur && chain.length < 32; cur = cur.supers.length ? sig.get(cur.supers[0]) : undefined) chain.unshift(cur);
  const st = Object.assign({}, ...chain.map((c) => c.style ?? {})) as Record<string, unknown>;
  const root = rootOf(sig, t);
  const h = hash(root.name);
  const depth = t === root ? 0 : 1 + (hash(t.name) % 3);
  const color = typeof st.color === 'string' ? new THREE.Color(st.color) : new THREE.Color().setHSL((h % 360) / 360, 0.62, 0.58 - depth * 0.07);
  if (typeof st.colorBy === 'string') {
    const a = attrs.get(st.colorBy);
    const v = num(a);
    if (v !== null) color.setHSL(((v % 1) + 1) % 1, 0.7, 0.56);
    // text: hues spread by the golden angle, so a few values land far apart
    else if (a && 'text' in a) color.setHSL(((hash(a.text) % 997) * 0.618034) % 1, 0.65, 0.6);
  }
  let size = typeof st.size === 'number' ? st.size : 1;
  if (typeof st.sizeBy === 'string') {
    const v = num(attrs.get(st.sizeBy));
    if (v !== null) size *= Math.max(0.2, Math.cbrt(Math.abs(v)));
  }
  const shaped = (SHAPES as readonly string[]).includes(st.shape as string);
  const shape = shaped ? (st.shape as Shape) : SHAPES[hash(t.name) % 6];
  const scale = typeof st.scale === 'number' ? st.scale : 0.15;
  let pos: THREE.Vector3 | undefined;
  if (typeof st.position === 'string') {
    const xyz = st.position.split(/\s+/).map((k) => num(attrs.get(k)));
    if (xyz.length === 3 && xyz.every((v) => v !== null)) pos = new THREE.Vector3(...(xyz as number[])).multiplyScalar(scale);
  }
  const rv = typeof st.radiusBy === 'string' ? num(attrs.get(st.radiusBy)) : null;
  const ell = Array.isArray(st.ellipsoid) && st.ellipsoid.length === 3 ? new THREE.Vector3(...(st.ellipsoid as number[])).multiplyScalar(scale) : undefined;
  const lab = typeof st.label === 'string' ? attrs.get(st.label) : undefined;
  return {
    color,
    shape,
    size,
    container: typeof st.container === 'boolean' ? st.container : undefined,
    shaped,
    pos,
    radius: rv !== null ? Math.abs(rv) * scale : undefined,
    ellipsoid: ell,
    asLink: st.asLink === true,
    opacity: typeof st.opacity === 'number' ? Math.min(1, Math.max(0.05, st.opacity)) : 0.95,
    label: lab ? ('text' in lab ? lab.text : `${toText(lab)}`) : undefined,
  };
}

const geoCache = new Map<string, THREE.BufferGeometry>();
export function geometry(shape: Shape): THREE.BufferGeometry {
  let g = geoCache.get(shape);
  if (g) return g;
  switch (shape) {
    case 'icosahedron': g = new THREE.IcosahedronGeometry(1, 0); break;
    case 'octahedron': g = new THREE.OctahedronGeometry(1, 0); break;
    case 'dodecahedron': g = new THREE.DodecahedronGeometry(1, 0); break;
    case 'tetrahedron': g = new THREE.TetrahedronGeometry(1.15, 0); break;
    case 'box': g = new THREE.BoxGeometry(1.3, 1.3, 1.3); break;
    case 'torus': g = new THREE.TorusGeometry(0.75, 0.3, 12, 32); break;
    case 'cone': g = new THREE.ConeGeometry(0.9, 1.6, 24); break;
    default: g = new THREE.SphereGeometry(1, 32, 16);
  }
  geoCache.set(shape, g);
  return g;
}
