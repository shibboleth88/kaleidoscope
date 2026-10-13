/**
 * Leaves, instanced: one mesh per shape, every body of that shape an instance with its own matrix, colour,
 * transparency and glow. So a system of thousands of things is a handful of draw calls.
 *
 * Three's standard material takes per-instance colour; transparency and glow are added to its shaders here
 * (`instanceAlpha`, `instanceGlow`), so ghosts fade and flashes light up instance by instance.
 */

import * as THREE from 'three';
import { SHAPES, type Shape, geometry } from './style';

interface Batch {
  mesh: THREE.InstancedMesh;
  alpha: THREE.InstancedBufferAttribute;
  glow: THREE.InstancedBufferAttribute;
  keys: string[];
  count: number;
}

function material(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, transparent: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nattribute float instanceGlow;\nvarying float vAlpha;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = instanceAlpha;\nvGlow = instanceGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;\nvarying float vGlow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;');
  };
  return m;
}

export class Instances {
  private batches = new Map<Shape, Batch>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private scene: THREE.Scene) {
    for (const shape of SHAPES) this.batches.set(shape, this.make(shape, 64));
  }

  private make(shape: Shape, capacity: number): Batch {
    const mesh = new THREE.InstancedMesh(geometry(shape), material(), capacity);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    const glow = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    mesh.geometry = mesh.geometry.clone(); // each batch its own attributes on the shared shape
    mesh.geometry.setAttribute('instanceAlpha', alpha);
    mesh.geometry.setAttribute('instanceGlow', glow);
    this.scene.add(mesh);
    return { mesh, alpha, glow, keys: [], count: 0 };
  }

  /** Start a frame: every batch empty. */
  begin() {
    for (const b of this.batches.values()) b.count = 0;
  }

  add(shape: Shape, key: string, at: THREE.Vector3, spin: number, scale: number, color: THREE.Color, alpha: number, glow: number) {
    let b = this.batches.get(shape)!;
    const cap = b.mesh.instanceMatrix.count;
    if (b.count >= cap) {
      // grow: a new batch twice the size, what is there copied over
      const bigger = this.make(shape, cap * 2);
      bigger.mesh.instanceMatrix.array.set(b.mesh.instanceMatrix.array);
      bigger.mesh.instanceColor!.array.set(b.mesh.instanceColor!.array);
      bigger.alpha.array.set(b.alpha.array);
      bigger.glow.array.set(b.glow.array);
      bigger.keys = b.keys;
      bigger.count = b.count;
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.dispose();
      this.batches.set(shape, bigger);
      b = bigger;
    }
    const i = b.count++;
    this.q.setFromAxisAngle(this.up, spin);
    this.m.compose(at, this.q, this.s.setScalar(scale));
    b.mesh.setMatrixAt(i, this.m);
    b.mesh.setColorAt(i, color);
    b.alpha.setX(i, alpha);
    b.glow.setX(i, glow);
    b.keys[i] = key;
  }

  /** End a frame: what was added is what is drawn. */
  end() {
    for (const b of this.batches.values()) {
      b.mesh.count = b.count;
      b.keys.length = b.count;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      b.alpha.needsUpdate = true;
      b.glow.needsUpdate = true;
    }
  }

  /** What a ray meets, nearest first: the body key, and how far. */
  raycast(ray: THREE.Raycaster, skip: (key: string) => boolean): { key: string; distance: number }[] {
    const out: { key: string; distance: number }[] = [];
    for (const b of this.batches.values()) {
      if (!b.count) continue;
      // the instances move: what bounds them is found again
      b.mesh.boundingSphere = null;
      b.mesh.boundingBox = null;
      for (const hit of ray.intersectObject(b.mesh, false)) {
        const key = hit.instanceId !== undefined ? b.keys[hit.instanceId] : undefined;
        if (key && !skip(key)) out.push({ key, distance: hit.distance });
      }
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
}
