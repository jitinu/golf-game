import { dragCoefficient, liftCoefficient, spinRatio, DEFAULT_AERO } from './aero.js';
import { BALL, FIXED_DT, GRAVITY, SURFACE_PHYSICS } from './physics.js';
import { vec } from './vec.js';
import type { BallState, SimWorld, ShotEvent, ShotResult } from './types.js';
import { SurfaceId } from './types.js';

export interface StepResult {
  state: BallState;
  event?: ShotEvent['type'];
}

function horizontalDistance(a: BallState, b: BallState): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

function captureCup(state: BallState, world: SimWorld): StepResult | undefined {
  const dx = state.position.x - world.cup.position.x;
  const dz = state.position.z - world.cup.position.z;
  const distance = Math.hypot(dx, dz);
  const rimHeight = world.cup.position.y;
  if (distance > world.cup.radius || state.position.y - BALL.radius > rimHeight + 0.02) return undefined;

  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  const offset = distance / world.cup.radius;
  if ((speed < 1.6 && (offset < 0.75 || speed < 0.8)) || (speed >= 2.4 && speed <= 3 && offset < 0.25)) {
    return {
      state: {
        ...state,
        mode: 'holed',
        position: { x: world.cup.position.x, y: rimHeight - world.cup.depth, z: world.cup.position.z },
        velocity: vec.zero(),
      },
      event: 'holed',
    };
  }
  if (speed >= 1.6 && speed <= 2.4 && offset >= 0.6) {
    const outward = vec.normalize({ x: dx, y: 0, z: dz });
    const radialSpeed = vec.dot(state.velocity, outward);
    const tangential = vec.sub(state.velocity, vec.scale(outward, radialSpeed));
    const reflectedRadial = radialSpeed < 0 ? -radialSpeed * 0.5 : radialSpeed;
    return {
      state: {
        ...state,
        mode: 'roll',
        velocity: vec.add(vec.scale(outward, reflectedRadial), vec.scale(tangential, 0.7)),
      },
      event: 'lipout',
    };
  }
  return undefined;
}

function stepFlight(state: BallState, world: SimWorld, dt: number): BallState {
  const aero = { ...DEFAULT_AERO, ...world.aero };
  const airVelocity = vec.sub(state.velocity, world.wind ?? vec.zero());
  const speed = vec.length(airVelocity);
  let acceleration = { x: 0, y: -GRAVITY, z: 0 };
  if (speed > 1e-4) {
    const velocityDir = vec.scale(airVelocity, 1 / speed);
    const ratio = spinRatio(speed, vec.length(state.angularVelocity));
    const cd = dragCoefficient(speed, ratio) * aero.dragMultiplier;
    const cl = liftCoefficient(speed, ratio) * aero.liftMultiplier;
    const dragForce = 0.5 * aero.airDensity * speed * speed * BALL.area * cd;
    const liftForce = 0.5 * aero.airDensity * speed * speed * BALL.area * cl;
    const drag = vec.scale(velocityDir, -dragForce / BALL.mass);
    const liftDirection = vec.normalize(vec.cross(vec.normalize(state.angularVelocity), velocityDir));
    const lift = vec.scale(liftDirection, liftForce / BALL.mass);
    acceleration = vec.add(acceleration, vec.add(drag, lift));
  }
  const velocity = vec.add(state.velocity, vec.scale(acceleration, dt));
  return {
    ...state,
    position: vec.add(state.position, vec.scale(velocity, dt)),
    velocity,
    angularVelocity: vec.scale(state.angularVelocity, Math.exp(-aero.spinDecayPerSecond * dt)),
    time: state.time + dt,
  };
}

function stepRoll(state: BallState, world: SimWorld, dt: number): BallState {
  const surface = world.terrain.surfaceAt(state.position.x, state.position.z);
  const normal = vec.normalize(world.terrain.normalAt(state.position.x, state.position.z));
  const physics = world.surfaces?.[surface] ?? SURFACE_PHYSICS[surface];
  const gravity = { x: 0, y: -GRAVITY, z: 0 };
  const slopeAcceleration = vec.sub(gravity, vec.scale(normal, vec.dot(gravity, normal)));
  const tangentVelocity = vec.sub(state.velocity, vec.scale(normal, vec.dot(state.velocity, normal)));
  const previousSpeed = vec.length(tangentVelocity);
  const slopeMagnitude = Math.hypot(slopeAcceleration.x, slopeAcceleration.z);
  const resistance = previousSpeed > 1e-5 ? vec.scale(vec.normalize(tangentVelocity), physics.rollingResistance) : vec.zero();
  const velocity = vec.add(tangentVelocity, vec.scale(vec.sub(slopeAcceleration, resistance), dt));
  const speed = vec.length(velocity);
  if (previousSpeed < 0.05 && speed < 0.05 && slopeMagnitude < physics.rollingResistance) {
    return { ...state, mode: 'rest', velocity: vec.zero(), surface, time: state.time + dt };
  }
  const x = state.position.x + velocity.x * dt;
  const z = state.position.z + velocity.z * dt;
  return {
    ...state,
    position: { x, y: world.terrain.heightAt(x, z) + BALL.radius, z },
    velocity,
    angularVelocity: vec.scale(state.angularVelocity, Math.exp(-physics.rollSpinFriction * dt)),
    mode: 'roll',
    surface,
    time: state.time + dt,
  };
}

export function stepBallWithEvents(input: BallState, world: SimWorld, dt = FIXED_DT): StepResult {
  if (input.mode === 'rest' || input.mode === 'holed') {
    return { state: { ...input, position: vec.clone(input.position) } };
  }
  let state = input.mode === 'roll' ? stepRoll(input, world, dt) : stepFlight(input, world, dt);
  state = { ...state, surface: world.terrain.surfaceAt(state.position.x, state.position.z) };
  if (state.mode === 'roll' || state.mode === 'bounce') {
    const cupResult = captureCup(state, world);
    if (cupResult) return cupResult;
  }
  const ground = world.terrain.heightAt(state.position.x, state.position.z);
  if (state.position.y - BALL.radius <= ground) {
    if (input.mode === 'flight' && input.position.y - BALL.radius > ground) {
      const fraction = Math.max(
        0,
        Math.min(1, (input.position.y - BALL.radius - ground) / (input.position.y - state.position.y)),
      );
      state = {
        ...state,
        position: {
          x: input.position.x + (state.position.x - input.position.x) * fraction,
          y: ground + BALL.radius,
          z: input.position.z + (state.position.z - input.position.z) * fraction,
        },
      };
    }
    if (state.surface === SurfaceId.Water || state.surface === SurfaceId.OutOfBounds) {
      return {
        state: {
          ...state,
          mode: 'rest',
          position: { ...state.position, y: ground + BALL.radius },
          velocity: vec.zero(),
        },
      };
    }
    const normal = vec.normalize(world.terrain.normalAt(state.position.x, state.position.z));
    const physics = world.surfaces?.[state.surface] ?? SURFACE_PHYSICS[state.surface];
    const normalSpeed = vec.dot(state.velocity, normal);
    const tangentVelocity = vec.sub(state.velocity, vec.scale(normal, normalSpeed));
    if (state.mode === 'rest') {
      return { state: { ...state, position: { ...state.position, y: ground + BALL.radius }, velocity: vec.zero() } };
    }
    if (state.mode === 'roll' || Math.abs(normalSpeed) <= physics.minBounceSpeed) {
      return {
        state: {
          ...state,
          mode: 'roll',
          position: { ...state.position, y: ground + BALL.radius },
          velocity: tangentVelocity,
        },
      };
    }
    const tangentSpeed = vec.length(tangentVelocity);
    const tangentDirection = tangentSpeed > 1e-6 ? vec.scale(tangentVelocity, 1 / tangentSpeed) : vec.zero();
    const reducedTangent = Math.max(
      0,
      tangentSpeed - physics.friction * (1 + physics.restitution) * Math.abs(normalSpeed),
    );
    return {
      state: {
        ...state,
        mode: 'bounce',
        position: { ...state.position, y: ground + BALL.radius },
        velocity: vec.add(
          vec.scale(tangentDirection, reducedTangent),
          vec.scale(normal, -normalSpeed * physics.restitution),
        ),
        angularVelocity: vec.scale(state.angularVelocity, physics.spinRetention),
      },
    };
  }
  return { state };
}

export function stepBall(input: BallState, world: SimWorld, dt = FIXED_DT): BallState {
  return stepBallWithEvents(input, world, dt).state;
}

export function simulateShot(
  initial: BallState,
  world: SimWorld,
  opts: { maxTime?: number; record?: boolean } = {},
): ShotResult {
  const maxTime = opts.maxTime ?? 60;
  const record = opts.record ?? false;
  const trajectory: BallState[] = [initial];
  const events: ShotEvent[] = [];
  let state = initial;
  let previous = initial;
  let carryDistance = 0;
  let apexHeight = initial.position.y;
  let totalDistance = 0;
  let firstGroundContact = false;
  let lastRecorded = 0;
  const start = initial.position;
  while (state.time < maxTime && state.mode !== 'rest' && state.mode !== 'holed') {
    const result = stepBallWithEvents(state, world);
    state = result.state;
    apexHeight = Math.max(apexHeight, state.position.y);
    totalDistance += horizontalDistance(state, previous);
    if (result.event) {
      events.push({ t: state.time, type: result.event, position: vec.clone(state.position), surface: state.surface });
    }
    if (!firstGroundContact && previous.mode === 'flight' && (state.mode === 'bounce' || state.mode === 'roll' || state.mode === 'rest')) {
      firstGroundContact = true;
      carryDistance = Math.hypot(state.position.x - start.x, state.position.z - start.z);
      events.push({ t: state.time, type: 'land', position: vec.clone(state.position), surface: state.surface });
    }
    if (state.mode === 'rest' && previous.mode !== 'rest') {
      const type: ShotEvent['type'] = state.surface === SurfaceId.Water
        ? 'water'
        : state.surface === SurfaceId.OutOfBounds ? 'oob' : 'rest';
      events.push({ t: state.time, type, position: vec.clone(state.position), surface: state.surface });
    }
    if (record || state.time - lastRecorded >= 1 / 30) {
      trajectory.push(state);
      lastRecorded = state.time;
    }
    previous = state;
  }
  if (trajectory[trajectory.length - 1] !== state) trajectory.push(state);
  return {
    final: state,
    trajectory,
    carryDistance,
    apexHeight,
    totalDistance,
    flightTime: state.time,
    holed: state.mode === 'holed',
    events,
  };
}
