/**
 * How a node looks: a function of its type and its attributes.
 *
 * A type's `style` may say:
 *   color: '#hex'            shape: 'sphere' | 'icosahedron' | 'octahedron' | 'dodecahedron' | 'tetrahedron' | 'box' | 'torus' | 'cone'
 *   size: number             sizeBy: '<attr>'   (scales with that numeric attribute)
 *   colorBy: '<attr>'        (hue follows that numeric attribute, 0..1 → around the wheel)
 *   container: boolean       (drawn as a translucent place others stand in)
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
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

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
    const v = num(attrs.get(st.colorBy));
    if (v !== null) color.setHSL(((v % 1) + 1) % 1, 0.7, 0.56);
  }
  let size = typeof st.size === 'number' ? st.size : 1;
  if (typeof st.sizeBy === 'string') {
    const v = num(attrs.get(st.sizeBy));
    if (v !== null) size *= Math.max(0.2, Math.cbrt(Math.abs(v)));
  }
  const shape = (SHAPES as readonly string[]).includes(st.shape as string) ? (st.shape as Shape) : SHAPES[hash(t.name) % 6];
  return { color, shape, size, container: typeof st.container === 'boolean' ? st.container : undefined };
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
