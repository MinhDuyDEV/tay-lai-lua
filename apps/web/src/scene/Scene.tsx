'use client';
// The bài 1 course and the car, as boxes and planes. Every dimension comes from the ruleset the
// scorer uses (content/rulesets/tt108-2026.json, handed in as a prop), so the picture and the
// scoring can never disagree about where the line is.
//
// Mapping from the sim's plane to three's: the sim's +x is forward, +y is lateral. Here x maps to
// x and y maps to -z, so a heading of 0 points down +x and `rotation.y = heading` turns it the same
// way the core turns the car. Ground is y = 0.
//
// Nothing here is React state: the run's loop owns the numbers and `useFrame` copies them onto refs.

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Ruleset } from '../ruleset.ts';
import type { Run } from '../run.ts';

const Y = 0.02; // planes sit just above the ground to avoid z-fighting

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Planes on the ground: one material, drawn as a single geometry per line. */
function Strip({
  x,
  z,
  width,
  length,
  colour,
  opacity = 1,
}: {
  x: number;
  z: number;
  width: number;
  length: number;
  colour: string;
  opacity?: number;
}) {
  return (
    <mesh position={[x, Y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[length, width]} />
      <meshBasicMaterial color={colour} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Course({ ruleset }: { ruleset: Ruleset }) {
  const { course } = ruleset;
  const laneHalf = course.lane_width_m / 2;
  const from = course.start_line_x_m - 6;
  const to = course.exercise_end_m + 4;
  const span = to - from;
  const mid = (from + to) / 2;
  const windowStart = course.start_line_x_m + course.signal_off_early_m;
  const windowEnd = course.start_line_x_m + course.signal_off_late_m;

  return (
    <group>
      {/* Asphalt. */}
      <mesh position={[mid, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[span, course.lane_width_m + 6]} />
        <meshStandardMaterial color="#3b3f45" roughness={1} />
      </mesh>
      {/* Lane edges: the 3.5 m minimum from QCVN 15 mục 2.1.7. */}
      <Strip x={mid} z={-laneHalf} width={0.1} length={span} colour="#e8e8e8" />
      <Strip x={mid} z={laneHalf} width={0.1} length={span} colour="#e8e8e8" />
      {/* The start line: QCVN 15 mục 2.1.15.1, 0.2 m wide. */}
      <Strip
        x={course.start_line_x_m}
        z={0}
        width={course.start_line_width_m}
        length={course.lane_width_m}
        colour="#ffffff"
      />
      {/* "XUẤT PHÁT" written in front of the line, as the drawn figure has it. */}
      <mesh position={[course.start_line_x_m + 1.4, Y, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
        <planeGeometry args={[2.4, 0.9]} />
        <meshBasicMaterial color="#f2f2f2" transparent opacity={0.35} />
      </mesh>
      {/* The 4–6 m window for switching the left signal off, with the 5 m marker from the ruleset. */}
      <Strip x={mid} z={-laneHalf - 0.5} width={0.08} length={span} colour="#1f2a33" opacity={0.35} />
      <SliceMark x={windowStart} z={-laneHalf - 0.5} colour="#f0c419" />
      <SliceMark x={course.start_line_x_m + course.signal_off_m} z={-laneHalf - 0.9} colour="#f0c419" tall />
      <SliceMark x={windowEnd} z={-laneHalf - 0.5} colour="#f0c419" />
      {/* End of the exercise: the mark the phase change is measured at. */}
      <Strip
        x={course.exercise_end_m}
        z={0}
        width={0.12}
        length={course.lane_width_m}
        colour="#5fd18a"
      />
    </group>
  );
}

/** A small tick across the lane used to mark a metre on the course. */
function SliceMark({ x, z, colour, tall = false }: { x: number; z: number; colour: string; tall?: boolean }) {
  return <Strip x={x} z={z} width={tall ? 0.5 : 0.24} length={tall ? 0.16 : 0.1} colour={colour} />;
}

/** Wheel positions from the vehicle's own dimensions, so a change in the ruleset moves the wheels. */
function wheelLayout(ruleset: Ruleset) {
  const { length_m, width_m, wheelbase_m, wheel_radius_m } = ruleset.vehicle;
  const axleOffset = wheelbase_m / 2;
  const trackHalf = width_m / 2 - 0.12;
  return {
    radius: wheel_radius_m,
    positions: [
      [axleOffset, trackHalf],
      [axleOffset, -trackHalf],
      [-axleOffset, trackHalf],
      [-axleOffset, -trackHalf],
    ] as const,
    length: length_m,
    width: width_m,
    frontAxle: axleOffset,
  };
}

function Car({ run, ruleset }: { run: Run; ruleset: Ruleset }) {
  const body = useRef<THREE.Group>(null);
  const frontLeft = useRef<THREE.Group>(null);
  const frontRight = useRef<THREE.Group>(null);
  const leftLamp = useRef<THREE.Mesh>(null);
  const layout = useMemo(() => wheelLayout(ruleset), [ruleset]);

  useFrame(({ clock }) => {
    const { state, previous, alpha } = run;
    const t = alpha;
    const x = lerp(previous.carX, state.carX, t);
    const y = lerp(previous.carY, state.carY, t);
    const heading = lerp(previous.heading, state.heading, t);
    const steer = lerp(previous.steerRad, state.steerRad, t);

    if (body.current) {
      body.current.position.set(x, 0, -y);
      body.current.rotation.y = heading;
    }
    // Steered front wheels turn about their own vertical axis.
    if (frontLeft.current) frontLeft.current.rotation.y = steer;
    if (frontRight.current) frontRight.current.rotation.y = steer;

    // The left indicator blinks only while the core consumes the left signal on.
    if (leftLamp.current) {
      const on = state.signal === 'left';
      const material = leftLamp.current.material as THREE.MeshBasicMaterial;
      material.color.set(on && Math.floor(clock.elapsedTime * 3) % 2 === 0 ? '#ffb020' : '#5b4a2a');
    }
  });

  const wheel = (i: number, front: boolean) => {
    const [dx, dz] = layout.positions[i];
    const spin = <Wheel radius={layout.radius} width={0.22} />;
    return front ? (
      <group key={i} position={[dx, layout.radius, dz]} ref={i === 0 ? frontLeft : frontRight}>
        {spin}
      </group>
    ) : (
      <group key={i} position={[dx, layout.radius, dz]}>
        {spin}
      </group>
    );
  };

  return (
    <group ref={body}>
      {/* Body shell. */}
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[layout.length, 0.62, layout.width]} />
        <meshStandardMaterial color="#cdd3da" metalness={0.35} roughness={0.45} />
      </mesh>
      {/* Cabin, a second box so the front of the car is readable at a glance. */}
      <mesh position={[-0.35, 1.12, 0]} castShadow>
        <boxGeometry args={[layout.length * 0.45, 0.55, layout.width * 0.86]} />
        <meshStandardMaterial color="#8d99a6" metalness={0.2} roughness={0.6} />
      </mesh>
      {/* Headlights at the bumper the law measures to. */}
      <mesh position={[layout.length / 2 - 0.02, 0.62, layout.width / 2 - 0.25]}>
        <boxGeometry args={[0.04, 0.16, 0.3]} />
        <meshBasicMaterial color="#f7f3d0" />
      </mesh>
      <mesh position={[layout.length / 2 - 0.02, 0.62, -layout.width / 2 + 0.25]}>
        <boxGeometry args={[0.04, 0.16, 0.3]} />
        <meshBasicMaterial color="#f7f3d0" />
      </mesh>
      {/* Left indicator: amber when the core has the left signal on. */}
      <mesh ref={leftLamp} position={[-layout.length / 2 + 0.06, 0.68, layout.width / 2 - 0.2]}>
        <boxGeometry args={[0.05, 0.12, 0.18]} />
        <meshBasicMaterial color="#5b4a2a" />
      </mesh>
      {wheel(0, true)}
      {wheel(1, true)}
      {wheel(2, false)}
      {wheel(3, false)}
    </group>
  );
}

function Wheel({ radius, width }: { radius: number; width: number }) {
  return (
    <mesh rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[radius, radius, width, 12]} />
      <meshStandardMaterial color="#23262a" roughness={0.9} />
    </mesh>
  );
}

/** Chase camera: behind and above the car, easing toward its heading. */
function ChaseCamera({ run }: { run: Run }) {
  const desired = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const { state } = run;
    const behind = 9;
    const height = 4.4;
    desired.set(state.carX - behind * Math.cos(state.heading), height, -(state.carY - behind * Math.sin(state.heading)));
    camera.position.lerp(desired, 0.12);
    look.set(state.carX + 3 * Math.cos(state.heading), 0.8, -(state.carY + 3 * Math.sin(state.heading)));
    camera.lookAt(look);
  });
  return null;
}

export default function Scene({ run, ruleset }: { run: Run; ruleset: Ruleset }) {
  return (
    <>
      <color attach="background" args={['#9ec4d8']} />
      <fog attach="fog" args={['#9ec4d8', 30, 70]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[8, 14, 6]} intensity={1.6} />
      <ChaseCamera run={run} />
      <Course ruleset={ruleset} />
      <Car run={run} ruleset={ruleset} />
    </>
  );
}
