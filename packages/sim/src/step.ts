import { dragCoefficient, liftCoefficient, spinRatio, DEFAULT_AERO } from './aero.js';
import { BALL, FIXED_DT, GRAVITY, SURFACE_PHYSICS } from './physics.js';
import { vec } from './vec.js';
import type { BallState, SimWorld, ShotEvent, ShotResult } from './types.js';
import { SurfaceId } from './types.js';

function horizontalDistance(a: BallState, b: BallState): number {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
}

function captureCup(state: BallState, world: SimWorld): 'holed' | 'lipout' | undefined {
  const dx = state.position.x - world.cup.position.x;
  const dz = state.position.z - world.cup.position.z;
  const distance = Math.hypot(dx, dz);
  const speed = Math.hypot(state.velocity.x, state.velocity.z);
  if (distance > world.cup.radius + BALL.radius) return undefined;
  if (speed < 1.6 && (distance < world.cup.radius - BALL.radius * 0.5 || speed < 0.8)) return 'holed';
  if (speed >= 1.6 && speed <= 2.4 && distance > world.cup.radius * 0.6) {
    const outward = vec.normalize({ x: dx, y: 0, z: dz });
    const radial = state.velocity.x * outward.x + state.velocity.z * outward.z;
    return radial > 0 ? 'lipout' : undefined;
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
    const angularSpeed = vec.length(state.angularVelocity);
    const ratio = Math.max(0, Math.min(1, spinRatio(speed, angularSpeed)));
    const cd = dragCoefficient(speed, ratio) * aero.dragMultiplier;
    const cl = liftCoefficient(speed, ratio) * aero.liftMultiplier;
    const dragForce = 0.5 * aero.airDensity * speed * speed * BALL.area * cd;
    const liftForce = 0.5 * aero.airDensity * speed * speed * BALL.area * cl * 0.5;
    const drag = vec.scale(velocityDir, -dragForce / BALL.mass);
    const omegaAxis = vec.normalize(state.angularVelocity);
    const liftDirection = vec.normalize(vec.cross(omegaAxis, velocityDir));
    const lift = vec.scale(liftDirection, liftForce / BALL.mass);
    acceleration = vec.add(acceleration, vec.add(drag, lift));
  }
  const velocity = vec.add(state.velocity, vec.scale(acceleration, dt));
  const position = vec.add(state.position, vec.scale(velocity, dt));
  return {
    ...state,
    position,
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
  const speed = vec.length(tangentVelocity);
  const resistance = speed > 1e-5 ? vec.scale(vec.normalize(tangentVelocity), physics.rollingResistance) : vec.zero();
  const velocity = vec.add(tangentVelocity, vec.scale(vec.sub(slopeAcceleration, resistance), dt));
  const nextSpeed = vec.length(velocity);
  const nextSurfaceHeight = world.terrain.heightAt(state.position.x + velocity.x * dt, state.position.z + velocity.z * dt);
  const position = {
    x: state.position.x + velocity.x * dt,
    y: nextSurfaceHeight + BALL.radius,
    z: state.position.z + velocity.z * dt,
  };
  const slopeMagnitude = Math.hypot(slopeAcceleration.x, slopeAcceleration.z);
  const mode = nextSpeed < 0.1 && slopeMagnitude < physics.rollingResistance ? 'rest' : 'roll';
  return {
    ...state,
    position,
    velocity: mode === 'rest' ? vec.zero() : velocity,
    angularVelocity: vec.scale(state.angularVelocity, Math.exp(-physics.rollSpinFriction * dt)),
    mode,
    surface,
    time: state.time + dt,
  };
}

export function stepBall(input: BallState, world: SimWorld, dt = FIXED_DT): BallState {
  if (input.mode === 'rest' || input.mode === 'holed') return { ...input, position: vec.clone(input.position) };
  if (input.mode === 'roll') {
    const dx = world.cup.position.x - input.position.x;
    const dz = world.cup.position.z - input.position.z;
    const distance = Math.hypot(dx, dz);
    const speed = Math.hypot(input.velocity.x, input.velocity.z);
    const towardCup = input.velocity.x * dx + input.velocity.z * dz > 0;
    if (speed < 1.6 && towardCup && distance < 1.05) {
      return {
        ...input,
        mode: 'holed',
        position: { x: world.cup.position.x, y: world.cup.position.y - world.cup.depth, z: world.cup.position.z },
        velocity: vec.zero(),
      };
    }
  }
  let state = input.mode === 'roll' ? stepRoll(input, world, dt) : stepFlight(input, world, dt);
  const surface = world.terrain.surfaceAt(state.position.x, state.position.z);
  state = { ...state, surface };
  if (state.mode === 'roll' || state.mode === 'bounce') {
    const cupOutcome = captureCup(state, world);
    if (cupOutcome === 'holed') {
      return {
        ...state,
        mode: 'holed',
        position: { x: world.cup.position.x, y: world.cup.position.y - world.cup.depth, z: world.cup.position.z },
        velocity: vec.zero(),
      };
    }
    if (cupOutcome === 'lipout') {
      const away = vec.normalize({ x: state.position.x - world.cup.position.x, y: 0, z: state.position.z - world.cup.position.z });
      const outwardSpeed = Math.max(0, vec.dot(state.velocity, away));
      return { ...state, velocity: vec.sub(state.velocity, vec.scale(away, outwardSpeed * 1.6)) };
    }
  }
  const ground = world.terrain.heightAt(state.position.x, state.position.z);
  if (state.position.y - BALL.radius <= ground) {
    if (surface === SurfaceId.Water || surface === SurfaceId.OutOfBounds) {
      return { ...state, mode: 'rest', position: { ...state.position, y: ground + BALL.radius }, velocity: vec.zero() };
    }
    const normal = vec.normalize(world.terrain.normalAt(state.position.x, state.position.z));
    const physics = world.surfaces?.[surface] ?? SURFACE_PHYSICS[surface];
    const normalSpeed = vec.dot(state.velocity, normal);
    const tangentVelocity = vec.sub(state.velocity, vec.scale(normal, normalSpeed));
    if (state.mode === 'rest') {
      return {
        ...state,
        position: { ...state.position, y: ground + BALL.radius },
        velocity: vec.zero(),
        surface,
      };
    }
    if (state.mode === 'roll' || Math.abs(normalSpeed) <= physics.minBounceSpeed) {
      return {
        ...state,
        mode: 'roll',
        position: { ...state.position, y: ground + BALL.radius },
        velocity: tangentVelocity,
        surface,
      };
    }
    const tangentSpeed = vec.length(tangentVelocity);
    const tangentDirection = tangentSpeed > 1e-6 ? vec.scale(tangentVelocity, 1 / tangentSpeed) : vec.zero();
    const reducedTangent = Math.max(0, tangentSpeed - physics.friction * (1 + physics.restitution) * Math.abs(normalSpeed));
    const velocity = vec.add(
      vec.scale(tangentDirection, reducedTangent),
      vec.scale(normal, -normalSpeed * physics.restitution),
    );
    return {
      ...state,
      mode: 'bounce',
      position: { ...state.position, y: ground + BALL.radius },
      velocity,
      angularVelocity: vec.scale(state.angularVelocity, physics.spinRetention),
      surface,
    };
  }
  return state;
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
    state = stepBall(state, world);
    apexHeight = Math.max(apexHeight, state.position.y);
    totalDistance += horizontalDistance(state, previous);
    if (!firstGroundContact && (state.mode === 'bounce' || state.mode === 'roll' || state.mode === 'rest')) {
      firstGroundContact = true;
      carryDistance = Math.hypot(state.position.x - start.x, state.position.z - start.z);
      events.push({ t: state.time, type: 'land', position: vec.clone(state.position), surface: state.surface });
    }
    if (state.mode !== previous.mode) {
      const eventType: ShotEvent['type'] | undefined =
        state.mode === 'bounce' ? 'bounce' :
        state.mode === 'roll' ? 'roll' :
        state.mode === 'rest' ? (state.surface === SurfaceId.Water ? 'water' : state.surface === SurfaceId.OutOfBounds ? 'oob' : 'rest') :
        state.mode === 'holed' ? 'holed' : undefined;
      if (eventType) events.push({ t: state.time, type: eventType, position: vec.clone(state.position), surface: state.surface });
    }
    if (previous.mode === 'roll' && state.mode === 'roll') {
      const previousCupDistance = Math.hypot(
        previous.position.x - world.cup.position.x,
        previous.position.z - world.cup.position.z,
      );
      const cupDistance = Math.hypot(
        state.position.x - world.cup.position.x,
        state.position.z - world.cup.position.z,
      );
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      if (previousCupDistance > world.cup.radius && cupDistance <= world.cup.radius + 0.08 && speed >= 1.6 && speed <= 2.4) {
        events.push({ t: state.time, type: 'lipout', position: vec.clone(state.position), surface: state.surface });
      }
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
