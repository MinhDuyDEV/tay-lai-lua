'use client';
// The bench's load: the whole class-B yard (yard.ts), a road-traffic proxy, and the ego car driven by
// the replayed sim. Built the way the app builds scenes (R3F, useFrame on refs, no React state, the
// same lights and fog as Scene.tsx), but with frustum culling OFF so the whole yard is drawn every
// frame: an upper bound on a real chase-camera view, which sees a fraction of it. Static pieces are
// merged per exercise (lines) or instanced (curbs, cones), as the course generator would emit them;
// signs, lights and vehicles are separate meshes, the case where draw calls and per-object CPU matter.

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { BenchRun } from '../host/types.ts';
import { buildYard, type Exercise, type Line, type Pt } from './yard.ts';

const Y = 0.02;
const TRAFFIC = 40;
const ROWS = 4;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** All the quads of the lines of one width, as one geometry. */
function stripGeometry(lines: Line[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const { w, pts } of lines) {
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len === 0) continue;
      const nx = (-(z1 - z0) / len) * (w / 2);
      const nz = ((x1 - x0) / len) * (w / 2);
      const base = pos.length / 3;
      pos.push(x0 + nx, Y, z0 + nz, x0 - nx, Y, z0 - nz, x1 - nx, Y, z1 - nz, x1 + nx, Y, z1 + nz);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setIndex(idx);
  return geometry;
}

/** Short boxes laid along the outlines, one InstancedMesh per exercise. */
function curbMesh(curbs: Pt[][], material: THREE.Material): THREE.InstancedMesh | null {
  const spots: Array<[number, number, number, number]> = [];
  for (const outline of curbs) {
    for (let i = 0; i + 1 < outline.length; i += 1) {
      const [x0, z0] = outline[i];
      const [x1, z1] = outline[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const pieces = Math.max(1, Math.ceil(len / 1.5));
      for (let k = 0; k < pieces; k += 1) {
        const t = (k + 0.5) / pieces;
        spots.push([lerp(x0, x1, t), lerp(z0, z1, t), -Math.atan2(z1 - z0, x1 - x0), len / pieces]);
      }
    }
  }
  if (spots.length === 0) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.15, 0.2), material, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach(([x, z, yaw, length], i) => {
    q.setFromAxisAngle(up, yaw);
    m.compose(new THREE.Vector3(x, 0.075, z), q, new THREE.Vector3(length, 1, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function Materials() {
  return useMemo(
    () => ({
      line: new THREE.MeshBasicMaterial({ color: '#f4f4f0' }),
      ground: new THREE.MeshBasicMaterial({ color: '#4b5057' }),
      curb: new THREE.MeshStandardMaterial({ color: '#b9b9b3', roughness: 0.9 }),
      pole: new THREE.MeshStandardMaterial({ color: '#8a8f94' }),
      bodies: ['#c0392b', '#2e86c1', '#d4ac0d', '#7d8a93', '#27ae60'].map((color) => new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 })),
      glass: new THREE.MeshStandardMaterial({ color: '#8d99a6', roughness: 0.6 }),
      tyre: new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.9 }),
      lamps: ['#d33', '#e8b020', '#3a3'].map((color) => new THREE.MeshBasicMaterial({ color })),
    }),
    [],
  );
}

type Mats = ReturnType<typeof Materials>;

function Exercise({ exercise, mats }: { exercise: Exercise; mats: Mats }) {
  // One merged geometry per line width in this exercise.
  const strips = useMemo(() => {
    const byWidth = new Map<number, Line[]>();
    for (const line of exercise.lines) byWidth.set(line.w, [...(byWidth.get(line.w) ?? []), line]);
    return [...byWidth.values()].map(stripGeometry);
  }, [exercise]);
  const curbs = useMemo(() => curbMesh(exercise.curbs, mats.curb), [exercise, mats]);
  return (
    <>
      {strips.map((geometry, i) => (
        <mesh key={i} geometry={geometry} material={mats.line} />
      ))}
      {curbs ? <primitive object={curbs} /> : null}
      {exercise.signs.map((sign, i) => (
        <group key={`s${i}`} position={[sign.at[0], 0, sign.at[1]]}>
          <mesh position={[0, 1.1, 0]} material={mats.pole}>
            <cylinderGeometry args={[0.04, 0.04, 2.2, 8]} />
          </mesh>
          <mesh position={[0, 2.2, 0]}>
            <boxGeometry args={[0.6, 0.6, 0.03]} />
            <meshStandardMaterial color={sign.colour} />
          </mesh>
        </group>
      ))}
      {exercise.lights.map((at, i) => (
        <group key={`l${i}`} position={[at[0], 0, at[1]]}>
          <mesh position={[0, 1.6, 0]} material={mats.pole}>
            <cylinderGeometry args={[0.05, 0.05, 3.2, 8]} />
          </mesh>
          {mats.lamps.map((lamp, k) => (
            <mesh key={k} position={[0.1, 3.4 - k * 0.3, 0]} material={lamp}>
              <sphereGeometry args={[0.12, 12, 8]} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

/** Cọc chuẩn from every exercise: one instanced mesh. */
function Cones({ yard }: { yard: Exercise[] }) {
  const mesh = useMemo(() => {
    const at = yard.flatMap((e) => e.cones);
    const cones = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.0125, 0.0125, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: '#e0e0e0' }),
      Math.max(1, at.length),
    );
    const m = new THREE.Matrix4();
    at.forEach(([x, z], i) => cones.setMatrixAt(i, m.makeTranslation(x, 0.8, z)));
    cones.instanceMatrix.needsUpdate = true;
    return cones;
  }, [yard]);
  return <primitive object={mesh} />;
}

/** 40 vehicles of two boxes each, moved by JS every frame along the yard's roads: the xe nền proxy. */
function Traffic({ run, mats }: { run: BenchRun; mats: Mats }) {
  const group = useRef<THREE.Group>(null);
  const cars = useMemo(
    () =>
      Array.from({ length: TRAFFIC }, (_, i) => ({
        row: i % ROWS,
        dir: i % 2 === 0 ? 1 : -1,
        speed: 6 + (i % 5) * 1.5,
        x0: (i * 37) % 330,
        body: mats.bodies[i % mats.bodies.length],
      })),
    [mats],
  );
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // From the sim tick, not a clock, so both hosts draw the same picture.
    const t = run.tick / 60;
    cars.forEach((car, i) => {
      const x = -10 + ((((car.x0 + car.dir * car.speed * t) % 330) + 330) % 330);
      const v = g.children[i];
      v.position.set(x, 0, car.row * 40 + car.dir * -1.75);
      v.rotation.y = car.dir > 0 ? 0 : Math.PI;
    });
  });
  return (
    <group ref={group}>
      {cars.map((car, i) => (
        <group key={i}>
          <mesh position={[0, 0.6, 0]} material={car.body}>
            <boxGeometry args={[4.2, 0.6, 1.7]} />
          </mesh>
          <mesh position={[-0.3, 1.15, 0]} material={mats.glass}>
            <boxGeometry args={[2.0, 0.5, 1.5]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The replayed car: body, cabin and four wheels, placed from the sim's snapshots. */
function Ego({ run, mats }: { run: BenchRun; mats: Mats }) {
  const body = useRef<THREE.Group>(null);
  useFrame(() => {
    const { state, previous, alpha } = run;
    body.current?.position.set(lerp(previous.carX, state.carX, alpha), 0, -lerp(previous.carY, state.carY, alpha));
    if (body.current) body.current.rotation.y = lerp(previous.heading, state.heading, alpha);
  });
  return (
    <group ref={body}>
      <mesh position={[0, 0.62, 0]} material={mats.bodies[4]}>
        <boxGeometry args={[4.2, 0.62, 1.7]} />
      </mesh>
      <mesh position={[-0.35, 1.12, 0]} material={mats.glass}>
        <boxGeometry args={[1.9, 0.55, 1.45]} />
      </mesh>
      {[[1.3, 0.8], [1.3, -0.8], [-1.3, 0.8], [-1.3, -0.8]].map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.3, z]} rotation={[0, 0, Math.PI / 2]} material={mats.tyre}>
          <cylinderGeometry args={[0.3, 0.3, 0.22, 12]} />
        </mesh>
      ))}
    </group>
  );
}

/** Chase camera, as Scene.tsx: behind and above the car, easing toward its heading. */
function ChaseCamera({ run }: { run: BenchRun }) {
  const desired = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const { state } = run;
    desired.set(state.carX - 9 * Math.cos(state.heading), 4.4, -(state.carY - 9 * Math.sin(state.heading)));
    camera.position.lerp(desired, 0.12);
    look.set(state.carX + 3 * Math.cos(state.heading), 0.8, -(state.carY + 3 * Math.sin(state.heading)));
    camera.lookAt(look);
  });
  return null;
}

export default function BenchScene({ run }: { run: BenchRun }) {
  const yard = useMemo(buildYard, []);
  const mats = Materials();
  const root = useRef<THREE.Group>(null);
  // The whole yard is drawn every frame: no frustum culling anywhere.
  useLayoutEffect(() => root.current?.traverse((o) => (o.frustumCulled = false)), []);
  return (
    <>
      <color attach="background" args={['#9ec4d8']} />
      <fog attach="fog" args={['#9ec4d8', 30, 70]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[8, 14, 6]} intensity={1.6} />
      <ChaseCamera run={run} />
      <group ref={root}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[160, 0, 70]} material={mats.ground}>
          <planeGeometry args={[400, 220]} />
        </mesh>
        {yard.map((exercise) => (
          <Exercise key={exercise.name} exercise={exercise} mats={mats} />
        ))}
        <Cones yard={yard} />
        <Traffic run={run} mats={mats} />
        <Ego run={run} mats={mats} />
      </group>
    </>
  );
}
