'use client';
// The bài 1 course and the car, as boxes and planes. Every dimension comes from the ruleset the
// scorer uses (content/rulesets/tt108-2026.json, handed in as a prop), so the picture and the
// scoring can never disagree about where the line is.
//
// Mapping from the sim's plane to three's: the sim's +x is forward, +y is lateral. Here x maps to
// x and y maps to -z, so a heading of 0 points down +x and `rotation.y = heading` turns it the same
// way the core turns the car. Ground is y = 0.
//
// Bài 3 adds a slope: height is three's y. The core measures x along the road, so on the slope a
// metre of x is `cos` of a metre on the ground: `roadToWorld` does that one conversion for the
// course, the car and the camera. The car's height and pitch come from the core's snapshot (road
// height under the car, grade), the slope and the stop line from the ruleset's `hill` block, so the
// picture is drawn from the numbers the scorer uses.
//
// Nothing here is React state: the run's loop owns the numbers and `useFrame` copies them onto refs.

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Exercise } from '../exercise.ts';
import { hillOf, type Ruleset } from '../ruleset.ts';
import type { Run } from '../run.ts';

const Y = 0.02; // planes sit just above the ground to avoid z-fighting

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * The sim's x (metres along the road) to three's x (metres on the ground). Identity in bài 1; in
 * bài 3 the slope's 15 m of road span `cos` times that on the ground and what follows shifts back.
 */
type RoadToWorld = (x: number) => number;

function roadToWorldFor(exercise: Exercise, ruleset: Ruleset): RoadToWorld {
  if (exercise.lesson !== 3) return (x) => x;
  const { foot_x_m: foot, slope_length_m: length, grade } = hillOf(ruleset);
  const cos = 1 / Math.sqrt(1 + grade * grade);
  return (x) => (x <= foot ? x : x <= foot + length ? foot + (x - foot) * cos : x - length * (1 - cos));
}

/** Planes on the ground: one material, drawn as a single geometry per line. */
function Strip({
  x,
  z,
  width,
  length,
  colour,
  opacity = 1,
  y = Y,
}: {
  x: number;
  z: number;
  width: number;
  length: number;
  colour: string;
  opacity?: number;
  y?: number;
}) {
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
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
        width={course.lane_width_m}
        length={course.start_line_width_m}
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
        width={course.lane_width_m}
        length={0.12}
        colour="#5fd18a"
      />
    </group>
  );
}

/** A pole with a plate on it, the plate facing the car as it comes up the road (normal toward -x). */
function Sign({ x, y, z, children }: { x: number; y: number; z: number; children: React.ReactNode }) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 1.05, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 2.1, 6]} />
        <meshStandardMaterial color="#9aa0a6" />
      </mesh>
      <group position={[0, 2.3, 0]} rotation={[0, -Math.PI / 2, 0]}>
        {children}
      </group>
    </group>
  );
}

/** "Dừng lại": a red octagon with a white bar, no lettering. */
function StopFace() {
  return (
    <>
      <mesh rotation={[0, 0, Math.PI / 8]}>
        <circleGeometry args={[0.45, 8]} />
        <meshBasicMaterial color="#c8102e" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[0.62, 0.12]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/** "Dốc lên nguy hiểm": a red-edged triangle with a black wedge rising to the right. */
function UphillFace() {
  const wedge = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.22, -0.2);
    shape.lineTo(0.22, -0.2);
    shape.lineTo(0.22, 0.06);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  return (
    <>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <circleGeometry args={[0.6, 3]} />
        <meshBasicMaterial color="#c8102e" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.01]} rotation={[0, 0, Math.PI / 2]}>
        <circleGeometry args={[0.4, 3]} />
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.02, 0.02]} geometry={wedge}>
        <meshBasicMaterial color="#111111" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

/**
 * Bài 3: the flat before the foot, the slope, the level top, the stop line across the lane with
 * the 500 mm window before it, and the two signs of the figure. The downhill drawn after the top in
 * the law's figure is not scored and not drawn here.
 */
function HillCourse({ ruleset }: { ruleset: Ruleset }) {
  const hill = hillOf(ruleset);
  const laneW = ruleset.course.lane_width_m;
  const half = laneW / 2;
  const theta = Math.atan(hill.grade);
  // Lengths in the hill block are along the road: on the slope they are the tilted frame's x.
  const slopeLen = hill.slope_length_m;
  const run = slopeLen * Math.cos(theta); // the slope's footprint on the ground
  const topH = slopeLen * Math.sin(theta);
  const stopLocal = hill.stop_line_from_foot_m;
  const foot = hill.foot_x_m;
  const topStart = foot + run;
  const from = foot + hill.start_front_bumper_from_foot_m - 8;
  const to = topStart + hill.flat_top_m + 4;
  const wedge = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(run, topH);
    shape.lineTo(run, 0);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: laneW + 6, bevelEnabled: false });
    geometry.translate(0, 0, -(laneW + 6) / 2);
    return geometry;
  }, [run, topH, laneW]);
  const stopHeight = stopLocal * Math.sin(theta);

  return (
    <group>
      {/* The flat road under everything. */}
      <mesh position={[(from + to) / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[to - from, laneW + 6]} />
        <meshStandardMaterial color="#3b3f45" roughness={1} />
      </mesh>
      <Strip x={(from + foot) / 2} z={-half} width={0.1} length={foot - from} colour="#e8e8e8" />
      <Strip x={(from + foot) / 2} z={half} width={0.1} length={foot - from} colour="#e8e8e8" />

      {/* The slope: a wedge, with its markings in a frame tilted to lie on its surface. */}
      <mesh geometry={wedge} position={[foot, 0, 0]}>
        <meshStandardMaterial color="#4a5058" roughness={1} />
      </mesh>
      <group position={[foot, 0, 0]} rotation={[0, 0, theta]}>
        <Strip x={slopeLen / 2} z={-half} width={0.1} length={slopeLen} colour="#e8e8e8" />
        <Strip x={slopeLen / 2} z={half} width={0.1} length={slopeLen} colour="#e8e8e8" />
        {/* The foot, so the change of slope reads. */}
        <Strip x={0} z={0} width={laneW} length={0.08} colour="#d0d0d0" opacity={0.6} />
        {/* The window the front bumper must stop in, ending at the line. */}
        <Strip
          x={stopLocal - hill.max_a_m / 2}
          z={0}
          width={laneW - 0.3}
          length={hill.max_a_m}
          colour="#5fd18a"
          opacity={0.35}
        />
        {/* "Vạch dừng xe". */}
        <Strip x={stopLocal} z={0} width={laneW} length={ruleset.course.start_line_width_m} colour="#ffffff" />
      </group>

      {/* The level top. */}
      <mesh position={[topStart + hill.flat_top_m / 2, topH / 2, 0]}>
        <boxGeometry args={[hill.flat_top_m, topH, laneW + 6]} />
        <meshStandardMaterial color="#3b3f45" roughness={1} />
      </mesh>
      <Strip x={topStart + hill.flat_top_m / 2} z={-half} width={0.1} length={hill.flat_top_m} colour="#e8e8e8" y={topH + Y} />
      <Strip x={topStart + hill.flat_top_m / 2} z={half} width={0.1} length={hill.flat_top_m} colour="#e8e8e8" y={topH + Y} />

      <Sign x={foot - 1.5} y={0} z={half + 0.7}>
        <UphillFace />
      </Sign>
      <Sign x={foot + stopLocal * Math.cos(theta)} y={stopHeight} z={half + 0.7}>
        <StopFace />
      </Sign>
    </group>
  );
}

/**
 * Bài 4 and bài 6: the figure, drawn from the core's own polylines (`sim_course`). Nothing here
 * recomputes the QCVN formulas — the picture is the same set of points the scoring walks, so the
 * line a learner sees and the line that charges DE_VACH are one object.
 *
 * The sim's +y is lateral; here it maps to -z, as everywhere else in this file.
 */
function FigureCourse({ run }: { run: Run }) {
  const drawing = useMemo(() => {
    const asphalt = new THREE.Shape();
    const belts: { kind: number; points: readonly (readonly [number, number])[] }[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const record of run.course) {
      for (const [x, y] of record.points) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      if (record.kind === 1) belts.push({ kind: 1, points: record.points });
      else if (record.kind === 2) belts.push({ kind: 2, points: record.points });
      else if (record.kind === 3) belts.push({ kind: 3, points: record.points });
    }
    // The asphalt: the outer limit line's own outline, padded, so the road reads as one surface
    // without re-deriving the lane from the ruleset.
    const pad = 1.6;
    asphalt.moveTo(minX - pad, -(minY - pad));
    asphalt.lineTo(maxX + pad, -(minY - pad));
    asphalt.lineTo(maxX + pad, -(maxY + pad));
    asphalt.lineTo(minX - pad, -(maxY + pad));
    asphalt.closePath();
    return { asphalt, belts, minX, maxX, minY, maxY };
  }, [run.course]);

  return (
    <group>
      <mesh position={[(drawing.minX + drawing.maxX) / 2, -0.02, -(drawing.minY + drawing.maxY) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[drawing.maxX - drawing.minX + 8, drawing.maxY - drawing.minY + 8]} />
        <meshStandardMaterial color="#3b3f45" roughness={1} />
      </mesh>
      {drawing.belts.map((belt, i) => (
        <Polyline
          key={i}
          points={belt.points}
          colour={belt.kind === 2 ? '#8a7a52' : belt.kind === 3 ? '#f0c419' : '#e8e8e8'}
          width={belt.kind === 2 ? 0.15 : 0.1}
          y={belt.kind === 2 ? 0.06 : Y}
        />
      ))}
      {run.course
        .filter((r) => r.kind === 4)
        .map((gate, i) => (
          <Polyline key={`gate-${i}`} points={gate.points} colour="#5fd18a" width={0.12} y={Y} />
        ))}
    </group>
  );
}

/** A painted polyline as a flat ribbon on the road: one geometry for the whole run of points. */
function Polyline({
  points,
  colour,
  width,
  y = Y,
}: {
  points: readonly (readonly [number, number])[];
  colour: string;
  width: number;
  y?: number;
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const half = width / 2;
    for (let i = 1; i < points.length; i += 1) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular in the sim's plane; three's z is -y.
      const nx = (-dy / len) * half;
      const ny = (dx / len) * half;
      const quad = [
        [x0 + nx, -(y0 + ny)],
        [x1 + nx, -(y1 + ny)],
        [x1 - nx, -(y1 - ny)],
        [x0 - nx, -(y0 - ny)],
      ];
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
        for (const k of [a, b, c]) positions.push(quad[k][0], 0, quad[k][1]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }, [points, width]);
  return (
    <mesh geometry={geometry} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshBasicMaterial color={colour} side={THREE.DoubleSide} />
    </mesh>
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

function Car({ run, ruleset, toWorld }: { run: Run; ruleset: Ruleset; toWorld: RoadToWorld }) {
  const body = useRef<THREE.Group>(null);
  const frontLeft = useRef<THREE.Group>(null);
  const frontRight = useRef<THREE.Group>(null);
  const leftLamp = useRef<THREE.Mesh>(null);
  const layout = useMemo(() => wheelLayout(ruleset), [ruleset]);

  useFrame(({ clock }) => {
    const { state, previous, alpha } = run;
    const t = alpha;
    const x = lerp(toWorld(previous.carX), toWorld(state.carX), t);
    const y = lerp(previous.carY, state.carY, t);
    const heading = lerp(previous.heading, state.heading, t);
    const steer = lerp(previous.steerRad, state.steerRad, t);

    if (body.current) {
      // Yaw first, then pitch about the car's own side axis: nose up on the grade.
      body.current.rotation.order = 'YZX';
      body.current.position.set(x, lerp(previous.elevationM, state.elevationM, t), -y);
      body.current.rotation.set(0, heading, Math.atan(lerp(previous.grade, state.grade, t)));
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
function ChaseCamera({ run, toWorld }: { run: Run; toWorld: RoadToWorld }) {
  const desired = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const { state } = run;
    const behind = 9;
    const height = 4.4;
    desired.set(
      toWorld(state.carX) - behind * Math.cos(state.heading),
      state.elevationM + height,
      -(state.carY - behind * Math.sin(state.heading)),
    );
    camera.position.lerp(desired, 0.12);
    look.set(
      toWorld(state.carX) + 3 * Math.cos(state.heading),
      state.elevationM + 0.8 + 3 * state.grade,
      -(state.carY + 3 * Math.sin(state.heading)),
    );
    camera.lookAt(look);
  });
  return null;
}

export default function Scene({ run, ruleset, exercise }: { run: Run; ruleset: Ruleset; exercise: Exercise }) {
  const toWorld = useMemo(() => roadToWorldFor(exercise, ruleset), [exercise, ruleset]);
  return (
    <>
      <color attach="background" args={['#9ec4d8']} />
      <fog attach="fog" args={['#9ec4d8', 30, 70]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[8, 14, 6]} intensity={1.6} />
      <ChaseCamera run={run} toWorld={toWorld} />
      {exercise.lesson === 3 ? (
        <HillCourse ruleset={ruleset} />
      ) : exercise.lesson === 4 || exercise.lesson === 6 ? (
        <FigureCourse run={run} />
      ) : (
        <Course ruleset={ruleset} />
      )}
      <Car run={run} ruleset={ruleset} toWorld={toWorld} />
    </>
  );
}
