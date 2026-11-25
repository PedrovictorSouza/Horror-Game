import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CombatController } from "../combat.js";

const MODEL_SCALE = 0.21;
const NATIVE_FEET_Y = -7.5;
const WALK_SPEED = 4.2;
const RUN_SPEED = 7.6;
const BACKWARD_FACTOR = 0.55;
// Quicker to answer a command than before, still carrying mass when moving.
const ACCEL = 6.4;
const BRAKE = 5.5;
const TURN_RATE = 2.35; // rad/s (~135°/s)
const TURN_ACCEL = 7.0;
const TURN_BRAKE = 14.0;
const TURN_COUNTER = 9.0;
const DUST_SPEED = 1.3;
const ISLAND_LIMIT = 23.0;

/**
 * Pivots in the model's native space. The character's front is +X, its sides
 * are ±Z and Y is up. The torso pivot sits at the waist so the upper body can
 * lean and twist while the hips stay planted.
 */
const JOINTS = {
  torso: [0, 0.35, 0],
  head: [0, 3.55, 0],
  armPos: { shoulder: [0, 2.55, 1.6], elbow: [0, -0.15, 1.85] },
  armNeg: { shoulder: [0, 2.55, -1.6], elbow: [0, -0.15, -1.85] },
  legPos: { hip: [0, -0.62, 1.12], knee: [0, -3.6, 1.12] },
  legNeg: { hip: [0, -0.62, -1.12], knee: [0, -3.6, -1.12] },
};

// Idle pose captured from the rig editor by the user: holding the pistol with
// both forearms together. Applied verbatim when the player stands still.
const IDLE_HOLD = {
  torso: { x: -4, y: 5, z: 3 },
  head: { x: 3, y: -5, z: -4 },
  armPos: { x: -10, z: 68 },
  elbowPos: { z: 112 },
  armNeg: { x: 16, y: -52, z: 85 },
  elbowNeg: { z: 89 },
  legPos: { z: 7 },
  kneePos: { z: -14 },
  legNeg: { z: -1 },
  kneeNeg: { z: -15 },
  pelvis: { y: 2, z: 0 },
};
// Aim pose captured from the rig editor by the user. The idle and aim captures
// are blended by aimBlend, which is also the raise/lower transition.
const AIM_HOLD = {
  torso: { x: -4, y: 5, z: 2 },
  head: { x: 13, y: 1, z: -11 },
  armPos: { x: 7, z: 75 },
  elbowPos: { z: 30 },
  armNeg: { x: -4, y: -41, z: 67 },
  elbowNeg: { z: 43 },
  legPos: { z: -6 },
  kneePos: { z: -13 },
  legNeg: { z: 32 },
  kneeNeg: { z: -29 },
  pelvis: { y: 2, z: 0 },
};
const deg = (value) => (value * Math.PI) / 180;

function blendCapture(a, b, t) {
  const out = {};
  for (const group of Object.keys(a)) {
    out[group] = {};
    for (const axis of Object.keys(a[group])) {
      out[group][axis] = lerp(
        a[group][axis],
        b[group]?.[axis] ?? a[group][axis],
        t,
      );
    }
  }
  return out;
}

const ZERO = [0, 0, 0];
const HIP_NATIVE = Math.abs(JOINTS.legPos.hip[1]);
const KNEE_NATIVE = Math.abs(JOINTS.legPos.knee[1]);
const FOOT_NATIVE = Math.abs(NATIVE_FEET_Y);
const THIGH_LENGTH = (KNEE_NATIVE - HIP_NATIVE) * MODEL_SCALE;
const SHIN_LENGTH = (FOOT_NATIVE - KNEE_NATIVE) * MODEL_SCALE;
const LEG_LENGTH = (FOOT_NATIVE - HIP_NATIVE) * MODEL_SCALE;
const v = (value) => new THREE.Vector3(...value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));
const lerp = (a, b, t) => a + (b - a) * t;
const gaussian = (value, width) =>
  Math.exp(-0.5 * (value / width) * (value / width));

function createPose() {
  return {
    visualX: 0,
    visualY: 0,
    visualZ: 0,
    visualRX: 0,
    visualRZ: 0,
    pelvisY: 0,
    pelvisZ: 0,
    torsoX: 0,
    torsoY: 0,
    torsoZ: 0,
    torsoPY: 0.35,
    headX: 0,
    headY: 0,
    headZ: 0,
    legPos: 0,
    legNeg: 0,
    kneePos: 0,
    kneeNeg: 0,
    armPosZ: 0,
    armNegZ: 0,
    armNegY: 0,
    armPosX: -0.08,
    armNegX: 0.08,
    elbowPos: 0.45,
    elbowNeg: 0.45,
  };
}

const UPPER_POSE_KEYS = [
  "torsoX",
  "torsoY",
  "torsoZ",
  "headX",
  "headY",
  "headZ",
  "armPosZ",
  "armPosX",
  "elbowPos",
  "armNegZ",
  "armNegY",
  "armNegX",
  "elbowNeg",
];

const LOWER_POSE_KEYS = [
  "legPos",
  "legNeg",
  "kneePos",
  "kneeNeg",
  "pelvisY",
  "pelvisZ",
];

function blendUpper(pose, target, weight) {
  for (const key of UPPER_POSE_KEYS) pose[key] = lerp(pose[key], target[key], weight);
}

function addLower(pose, target, weight) {
  for (const key of LOWER_POSE_KEYS) pose[key] += target[key] * weight;
}

export class Player {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = "player";
    this.visual = new THREE.Group();
    this.visual.name = "player-visual";
    this.root.add(this.visual);

    // Tank movement state: signed forward speed + angular velocity.
    this.speed = 0;
    this.turnVelocity = 0;
    this.yaw = Math.PI;
    this.root.rotation.y = this.yaw;

    // Procedural animation state.
    this.gaitPhase = 0;
    this.turnPhase = 0;
    this.gaitAmp = 0;
    this.turnAmp = 0;
    this.lean = 0;
    this.accel = 0;
    this.turnLean = 0;
    this.armPosAngle = 0;
    this.armNegAngle = 0;
    this.elbowPosAngle = 0.45;
    this.elbowNegAngle = 0.45;

    // Idle attention: glances change on their own schedule instead of a
    // continuous sine, which would read as a screensaver.
    this.glanceTimer = 1.2;
    this.glanceIndex = 0;
    this.glanceYaw = 0;
    this.glancePitch = 0;
    this.glanceYawTarget = 0;
    this.glancePitchTarget = 0;

    // Combat is an animation layer, not an input system or a damage model.
    this.combat = new CombatController();
    this._combatSample = this.combat.sample();

    this.radius = 0.36;
    this.colliders = [];
    // When the maze is present it owns collision: walls are AABBs, not circles.
    this.maze = null;
    this.groundHeightAt = null;
    this.dust = new Dust(scene);

    // 0 = calm, 1 = something is close. Only affects the body's shiver.
    this.fear = 0;
    // Raised pistol: roots the gait in the input adapter and feeds the aim
    // layer below.
    this.aiming = false;

    // Layered animation weights. The aim arrives in four stages (shoulders,
    // gun, support hand, knees) and the shot is an impulse on top of it.
    this.aimBlend = 0;
    this.carryBlend = 1;
    this.holdBlend = 0;
    this.aimSettle = 0;
    this.aimSupport = 0;
    this.aimBrace = 0;
    this.recoil = 0;
    this.stopInertia = 0;
    this.runBlend = 0;
    this._lastInput = 0;

    this.rig = null;
    this.loaded = false;
    // Dev pose mode: the rig editor owns the joints and _animate stops
    // overwriting them, so a hand-made pose can be copied out.
    this.manualPose = false;
  }

  /** Called every frame with the enemy's proximity (0…1). */
  setFear(value) {
    this.fear = clamp(value, 0, 1);
  }

  /** Raised pistol: roots the gait in the input adapter and overrides the arm. */
  setAiming(value) {
    this.aiming = Boolean(value);
    if (this.pistol) this.pistol.visible = true;
  }

  /**
   * The real shot event, called by the shooting system the moment a round
   * leaves the barrel. It only queues an impulse: the pose resolves it over
   * the next frames, so consecutive shots connect instead of resetting.
   */
  applyRecoil(strength = 1) {
    this.recoil = Math.min(1, this.recoil + 0.85 * strength);
  }

  /** Supplies the maze height field so the root follows the terrain. */
  setGroundHeight(heightAt) {
    this.groundHeightAt = typeof heightAt === "function" ? heightAt : null;
    if (this.groundHeightAt) {
      this.root.position.y = this.groundHeightAt(
        this.root.position.x,
        this.root.position.z,
      );
    }
  }

  /** A low-poly picoCAD-ish pistol, held in the right hand. */
  _attachPistol() {
    if (!this.rig || this.pistol) return;
    const group = new THREE.Group();
    group.name = "pistol";
    const metal = new THREE.MeshStandardMaterial({
      color: 0x1b1f27,
      roughness: 0.5,
      metalness: 0.65,
      flatShading: true,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x101319,
      roughness: 0.85,
      metalness: 0.2,
      flatShading: true,
    });

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.5, 0.38), metal);
    slide.position.set(0, -0.72, 0);
    slide.castShadow = true;
    group.add(slide);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.85, 0.72), dark);
    grip.position.set(0, 0.06, 0.38);
    grip.rotation.x = 0.28;
    grip.castShadow = true;
    group.add(grip);

    // Wrist pivot, like the Hand_R attachment in the unnamed_horror reference:
    // the pistol lives at the end of the forearm but gets its own local
    // rotation, so it can cant, kick and settle without moving the whole arm.
    const wrist = new THREE.Group();
    wrist.name = "wrist";
    wrist.position.set(0, -4.25, 0);
    this.rig.elbowPos.add(wrist);

    group.position.set(0, 0, 0);
    group.rotation.y = 0.12;
    wrist.add(group);
    this.wrist = wrist;
    this.pistol = group;
  }

  /**
   * A black copy of the player's own rig: the thing that follows you is you.
   * Cloning the holder keeps the scale, the rotation and the feet offset, so
   * the shadow stands on the floor exactly like the player does.
   */
  createShadow() {
    if (!this.holder) return null;
    const clone = this.holder.clone(true);
    const material = new THREE.MeshStandardMaterial({
      color: 0x05060a,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    clone.traverse((node) => {
      if (!node.isMesh) return;
      node.material = material;
      // A shadow does not cast a shadow — and on this renderer the clone's
      // depth pass alone was costing ~95 ms per frame.
      node.castShadow = false;
      node.receiveShadow = false;
      node.frustumCulled = false;
    });
    return clone;
  }

  /* ----------------------- combat animation API ----------------------- */

  /** Enters the bladed, hands-up guard stance. */
  setCombatReady(value = true) {
    this.combat.setReady(value);
  }

  /** Triggers one committed strike. Returns false if a hit interrupts it. */
  playAttack(side = "right") {
    return this.combat.startAttack(side);
  }

  /** Adds a physical flinch without changing position or facing. */
  takeHit(strength = 1, direction = null) {
    return this.combat.startHit(strength, direction);
  }

  /** Clears attack/hit/guard state (used on the caught reset). */
  resetCombat() {
    this.combat.reset();
  }

  async load(url, onProgress) {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url, (event) => {
      if (!event.total) return;
      onProgress?.(Math.min(1, event.loaded / event.total));
    });

    const model = gltf.scene;
    model.name = "character";

    const meshes = [];
    model.traverse((node) => {
      if (!node.isMesh) return;
      meshes.push(node);
      node.castShadow = true;
      node.receiveShadow = false;
      node.frustumCulled = false;

      const material = node.material;
      if (material) {
        material.roughness = 0.92;
        material.metalness = 0;
        material.side = THREE.FrontSide;
        const map = material.map;
        if (map) {
          map.colorSpace = THREE.SRGBColorSpace;
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.LinearMipmapLinearFilter;
          map.anisotropy = 4;
          map.needsUpdate = true;
          // Keep the tiny palette readable when the low sun is behind.
          material.emissive = new THREE.Color(0xffffff);
          material.emissiveMap = map;
          material.emissiveIntensity = 0.16;
        }
        material.needsUpdate = true;
      }
    });

    if (meshes.length < 14) {
      console.warn(`[player] esperava 14 partes, encontrei ${meshes.length}`);
    }

    this.rig = buildRig(model, meshes);

    const holder = new THREE.Group();
    holder.name = "player-model";
    holder.add(model);
    holder.scale.setScalar(MODEL_SCALE);
    holder.position.y = -NATIVE_FEET_Y * MODEL_SCALE;
    // The picoCAD export points the character along +X; face three.js' -Z.
    holder.rotation.y = Math.PI / 2;
    this.visual.add(holder);

    this.holder = holder;
    this.model = model;
    this._attachPistol();
    this.loaded = true;
    return this;
  }

  /**
   * Tank controls: W/S move along the body's facing, A/D rotate the body.
   * The camera only follows the player's position, never its rotation.
   */
  update(dt, input, elapsed) {
    if (!this.loaded) return;

    // Combat owns only animation timing. It can slow the character down while
    // a strike is committed or a hit lands, but never moves or turns the root.
    this.combat.update(dt);
    const combat = this.combat.sample();
    this._combatSample = combat;

    const maxForward = input.run ? RUN_SPEED : WALK_SPEED;
    const maxBackward = maxForward * BACKWARD_FACTOR;
    const inputSpeed =
      input.move > 0
        ? maxForward * clamp(input.move, 0, 1)
        : input.move < 0
          ? -maxBackward * clamp(-input.move, 0, 1)
          : 0;
    const targetSpeed = inputSpeed * combat.control;

    const previousSpeed = this.speed;
    // Releasing the input at speed leaves forward weight behind: remember it
    // once, so the body can pay for the stop instead of freezing upright.
    if (inputSpeed === 0 && this._lastInput !== 0 && Math.abs(previousSpeed) > 1.0) {
      this.stopInertia = Math.min(1, Math.abs(previousSpeed) / RUN_SPEED);
    }
    this._lastInput = inputSpeed;
    const speedingUp = Math.abs(targetSpeed) > Math.abs(this.speed);
    this.speed = damp(
      this.speed,
      targetSpeed,
      speedingUp ? ACCEL : BRAKE,
      dt,
    );
    if (Math.abs(this.speed) < 0.02) this.speed = 0;

    const rawAcceleration = (this.speed - previousSpeed) / Math.max(dt, 1e-4);
    this.accel = damp(this.accel, rawAcceleration, 8, dt);

    const targetTurn = input.turn * TURN_RATE * combat.turnControl;
    let turnLambda = TURN_ACCEL;
    if (input.turn === 0) {
      // Brake harder than we accelerate so the body doesn't keep rotating
      // too far after releasing A/D.
      turnLambda = TURN_BRAKE;
    } else if (
      this.turnVelocity !== 0 &&
      Math.sign(targetTurn) !== Math.sign(this.turnVelocity)
    ) {
      turnLambda = TURN_COUNTER;
    }
    this.turnVelocity = damp(this.turnVelocity, targetTurn, turnLambda, dt);
    if (Math.abs(this.turnVelocity) < 0.008) this.turnVelocity = 0;

    this.yaw += this.turnVelocity * dt;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.root.rotation.y = this.yaw;

    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    this.root.position.x += forwardX * this.speed * dt;
    this.root.position.z += forwardZ * this.speed * dt;

    this._resolveCollisions();

    if (this.groundHeightAt) {
      this.root.position.y = this.groundHeightAt(
        this.root.position.x,
        this.root.position.z,
      );
    }

    this._animate(dt, elapsed);

    this.dust.update(dt);
    if (
      Math.abs(this.speed) > DUST_SPEED &&
      Math.random() < dt * 11
    ) {
      this.dust.spawn(this.root.position, this.yaw, Math.abs(this.speed));
    }
  }

  _resolveCollisions() {
    const position = this.root.position;

    if (this.maze) {
      this.maze.resolve(position, this.radius);
      return;
    }

    for (const collider of this.colliders) {
      const dx = position.x - collider.x;
      const dz = position.z - collider.z;
      const minDist = collider.radius + this.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist || distSq < 1e-6) continue;
      const dist = Math.sqrt(distSq);
      const push = (minDist - dist) / dist;
      position.x += dx * push;
      position.z += dz * push;
    }

    const distanceFromCenter = Math.hypot(position.x, position.z);
    if (distanceFromCenter > ISLAND_LIMIT) {
      const scale = ISLAND_LIMIT / distanceFromCenter;
      position.x *= scale;
      position.z *= scale;
    }
  }

  _animate(dt, elapsed) {
    if (this.manualPose) return;
    const rig = this.rig;
    const combat = this._combatSample;
    const absSpeed = Math.abs(this.speed);
    const isBackward = this.speed < -0.05;
    const speedRatio = clamp(absSpeed / WALK_SPEED, 0, 1.8);
    const runFactor = clamp(
      (absSpeed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED),
      0,
      1,
    );

    this.holdBlend = damp(
      this.holdBlend,
      !this.aiming && absSpeed < 0.2 && this.turnAmp < 0.2 ? 1 : 0,
      6,
      dt,
    );
    if (this.holdBlend > 0.998) this.holdBlend = 1;
    else if (this.holdBlend < 0.002) this.holdBlend = 0;
    this.gaitAmp = damp(this.gaitAmp, Math.min(1, speedRatio), 7, dt);
    this.runBlend = damp(this.runBlend, runFactor, 4.5, dt);
    this.stopInertia = damp(this.stopInertia, 0, 3.4, dt);
    this.turnAmp = damp(
      this.turnAmp,
      clamp(Math.abs(this.turnVelocity) / TURN_RATE, 0, 1),
      6,
      dt,
    );

    // Aim staging: shoulders first, gun next, support hand after it, knees
    // last. On release the support lets go first and the gun follows down.
    const aimTarget = this.aiming ? 1 : 0;
    this.aimSettle = damp(this.aimSettle, aimTarget, this.aiming ? 9 : 5.5, dt);
    this.aimBlend = damp(this.aimBlend, aimTarget, this.aiming ? 6.2 : 5.0, dt);
    if (this.aimBlend > 0.998) this.aimBlend = 1;
    else if (this.aimBlend < 0.002) this.aimBlend = 0;
    this.aimSupport = damp(
      this.aimSupport,
      this.aiming && this.aimBlend > 0.28 ? 1 : 0,
      this.aiming ? 8 : 11,
      dt,
    );
    this.aimBrace = damp(
      this.aimBrace,
      this.aiming && this.aimBlend > 0.55 ? 1 : 0,
      this.aiming ? 7 : 4.5,
      dt,
    );
    this.recoil *= Math.exp(-7 * dt);
    if (this.recoil < 0.001) this.recoil = 0;

    const gaitWeight = Math.min(1, this.gaitAmp);
    const turnShuffle = this.turnAmp * Math.max(0, 1 - gaitWeight * 0.8);
    const idleWeight = Math.max(0, 1 - gaitWeight - turnShuffle * 0.6);

    // Cadence from stride length, so the planted foot tracks the ground.
    const baseStride = isBackward ? 0.25 : 0.3 + 0.3 * runFactor;
    const gaitDirection = isBackward ? -1 : 1;
    if (absSpeed > 0.12) {
      // Foot target reach (half stride). dtheta/dt = speed / reach keeps the
      // stance foot close to stationary instead of skating.
      const footReach = LEG_LENGTH * Math.sin(Math.max(0.05, baseStride));
      this.gaitPhase +=
        (dt * absSpeed) / Math.max(0.2, footReach) * gaitDirection;
    }
    if (this.turnAmp > 0.02) {
      this.turnPhase +=
        dt *
        (2.4 + this.turnAmp * 4.2) *
        (this.turnVelocity >= 0 ? 1 : -1);
    }

    const theta = this.gaitPhase;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const tSin = Math.sin(this.turnPhase);
    const tCos = Math.cos(this.turnPhase);

    // Attention has its own schedule: hold a glance for a few seconds, then
    // move to the next one. This is quieter than a constant look-around sine.
    this.glanceTimer -= dt;
    if (this.glanceTimer <= 0) {
      const glances = [
        { yaw: 0.09, pitch: -0.015 },
        { yaw: -0.06, pitch: 0.008 },
        { yaw: 0.02, pitch: -0.02 },
        { yaw: -0.11, pitch: -0.006 },
        { yaw: 0.0, pitch: 0.014 },
        { yaw: 0.07, pitch: 0.004 },
      ];
      const next = glances[this.glanceIndex % glances.length];
      this.glanceYawTarget = next.yaw;
      this.glancePitchTarget = next.pitch;
      this.glanceIndex += 1;
      this.glanceTimer = 2.4 + (this.glanceIndex % 3) * 0.85;
    }
    this.glanceYaw = damp(this.glanceYaw, this.glanceYawTarget, 2.2, dt);
    this.glancePitch = damp(
      this.glancePitch,
      this.glancePitchTarget,
      2.6,
      dt,
    );

    const breath =
      Math.sin(elapsed * 1.25) * 0.65 +
      Math.sin(elapsed * 0.43 + 1.7) * 0.35;
    const idleShift = Math.sin(elapsed * 0.37);
    const brace = Math.sin(elapsed * 0.19 + 0.6);

    const pose = createPose();

    // ---- alert idle: asymmetric weight, low guard, small posture drift ----
    pose.legPos += idleWeight * (0.07 + idleShift * 0.022);
    pose.legNeg += idleWeight * (-0.05 - idleShift * 0.008);
    pose.kneePos -= idleWeight * (0.14 + Math.max(0, idleShift) * 0.03);
    pose.kneeNeg -= idleWeight * (0.19 + Math.max(0, -idleShift) * 0.03);
    pose.pelvisY += idleWeight * 0.03;
    pose.pelvisZ += idleWeight * -0.007 * idleShift;
    pose.torsoX += idleWeight * (-0.065 + 0.004 * breath);
    pose.torsoY += idleWeight * (0.035 + 0.008 * brace);
    pose.torsoPY -= idleWeight * 0.01;
    pose.torsoZ += idleWeight * 0.006 * idleShift;
    pose.visualX += idleWeight * 0.018 * idleShift;
    pose.visualY += idleWeight * 0.006 * breath;
    pose.torsoPY += idleWeight * 0.004 * breath;
    pose.headX += idleWeight * 0.004 * breath;
    pose.headZ += idleWeight * (0.007 * idleShift + 0.004 * this.glanceYaw);

    // ---- legs ----
    // ---- legs: two-bone IK with a foot target path ----
    // Reference: unnamed_horror animation_config.json (Hip -> Knee -> Ankle
    // with a foot target), adapted to the picoCAD rig. The swing foot lifts,
    // the stance foot is a real target instead of a sine.
    const stepReach = LEG_LENGTH * Math.sin(Math.max(0.05, baseStride));
    const strideX = stepReach * this.gaitAmp;
    const footLift = (0.09 + 0.06 * runFactor) * this.gaitAmp;

    const solveLeg = (phase) => {
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      const footX = strideX * c;
      const lift = Math.max(0, -s) * footLift;
      const dy = Math.max(0.1, LEG_LENGTH - lift);
      const d = clamp(
        Math.hypot(footX, dy),
        Math.abs(THIGH_LENGTH - SHIN_LENGTH) + 0.001,
        THIGH_LENGTH + SHIN_LENGTH - 0.001,
      );
      const interior = Math.acos(
        clamp(
          (THIGH_LENGTH ** 2 + SHIN_LENGTH ** 2 - d ** 2) /
            (2 * THIGH_LENGTH * SHIN_LENGTH),
          -1,
          1,
        ),
      );
      const hipOffset = Math.acos(
        clamp(
          (THIGH_LENGTH ** 2 + d ** 2 - SHIN_LENGTH ** 2) /
            (2 * THIGH_LENGTH * d),
          -1,
          1,
        ),
      );
      return {
        thigh: Math.atan2(footX, dy) + hipOffset,
        knee: -(Math.PI - interior),
      };
    };

    const posLeg = solveLeg(theta);
    const negLeg = solveLeg(theta + Math.PI);

    let legPos = posLeg.thigh;
    let legNeg = negLeg.thigh;
    let kneePos = posLeg.knee;
    let kneeNeg = negLeg.knee;

    legPos += tSin * 0.17 * turnShuffle;
    legNeg -= tSin * 0.17 * turnShuffle;
    kneePos -= Math.max(0, tCos) * 0.34 * turnShuffle;
    kneeNeg -= Math.max(0, -tCos) * 0.34 * turnShuffle;

    // Contact pulses: two hard beats per cycle. They give the step weight and
    // make the shoulders and head react to the ground.
    const wrapPi = (value) => Math.atan2(Math.sin(value), Math.cos(value));
    const contactL =
      gaussian(wrapPi(theta - Math.PI / 2), 0.3) * this.gaitAmp;
    const contactR =
      gaussian(wrapPi(theta - (3 * Math.PI) / 2), 0.3) * this.gaitAmp;
    const impact = contactL + contactR;
    const impactSide = (contactL - contactR) * (0.6 + runFactor);

    kneePos -= contactL * (0.018 + 0.022 * runFactor);
    kneeNeg -= contactR * (0.018 + 0.022 * runFactor);

    pose.legPos += legPos;
    pose.legNeg += legNeg;
    pose.kneePos += kneePos;
    pose.kneeNeg += kneeNeg;

    // ---- hips and body weight ----
    pose.pelvisY +=
      sin * (0.04 + 0.025 * runFactor) * this.gaitAmp +
      this.turnVelocity * 0.026;
    pose.pelvisZ += -sin * 0.014 * this.gaitAmp;

    const contactSettle = Math.abs(Math.sin(theta + 0.18));
    pose.visualY -=
      contactSettle * (0.105 + 0.055 * runFactor) * this.gaitAmp;
    pose.visualY += Math.abs(cos) * 0.012 * runFactor * this.gaitAmp;
    pose.visualY -= impact * (0.024 + 0.04 * runFactor);
    pose.visualX +=
      sin * (0.028 + 0.02 * runFactor) * this.gaitAmp;

    const shoulderTwist =
      -sin * (0.075 + 0.11 * runFactor) * this.gaitAmp +
      this.turnVelocity * 0.02;
    pose.torsoY += shoulderTwist;
    pose.torsoX += -impact * (0.012 + 0.018 * runFactor);
    pose.torsoZ +=
      -sin * (0.024 + 0.02 * runFactor) * this.gaitAmp +
      impactSide * (0.016 + 0.018 * runFactor) +
      idleWeight * 0.006 * brace;

    // Lean from the ankles and the waist. Running tips the whole silhouette.
    const leanBase = isBackward
      ? 0.06 * Math.min(1, speedRatio)
      : -(0.055 + 0.3 * this.runBlend + 0.02 * speedRatio) *
        Math.min(1, speedRatio);
    const accelLean = -clamp(this.accel * 0.009, -0.06, 0.06);
    this.lean = damp(
      this.lean,
      leanBase + accelLean - this.stopInertia * 0.08,
      6,
      dt,
    );
    // The tilt is shared by the whole silhouette, the waist and the hips, so
    // the run reads as one body committing forward instead of a nodding head.
    pose.visualRX += this.lean * 0.58;
    pose.torsoX += this.lean * 0.42;
    pose.torsoPY -= Math.abs(this.lean) * 0.05;
    pose.visualY += this.lean * 0.03;
    pose.visualZ -= this.stopInertia * 0.05;
    pose.visualY -= this.stopInertia * 0.02;
    pose.kneePos -= this.stopInertia * 0.05;
    pose.kneeNeg -= this.stopInertia * 0.04;
    pose.torsoX += this.stopInertia * 0.015;

    const turnLeanTarget =
      clamp(this.turnVelocity / TURN_RATE, -1, 1) *
      (0.078 + 0.035 * runFactor);
    this.turnLean = damp(this.turnLean, turnLeanTarget, 7, dt);
    pose.visualRZ += this.turnLean;
    pose.torsoZ += this.turnLean * 0.3;

    // ---- arms: contained in the walk, driving in the run ----
    const armSwing = (0.2 + 0.5 * runFactor) * this.gaitAmp;
    const armBias =
      0.055 +
      0.14 * idleWeight +
      0.07 * this.gaitAmp +
      0.08 * runFactor * this.gaitAmp;
    const armLag = Math.sin(theta + 0.16);
    const idleSway = Math.sin(elapsed * 1.15) * 0.012 * (1 - gaitWeight);

    let targetArmPos =
      armBias + 0.05 * idleWeight - armLag * armSwing + idleSway - tSin * 0.055 * turnShuffle;
    let targetArmNeg =
      armBias - 0.02 * idleWeight + armLag * armSwing - idleSway + tSin * 0.055 * turnShuffle;

    this.armPosAngle = damp(this.armPosAngle, targetArmPos, 18, dt);
    this.armNegAngle = damp(this.armNegAngle, targetArmNeg, 18, dt);

    const armOut =
      0.075 +
      0.025 * idleWeight +
      0.03 * runFactor +
      this.turnAmp * 0.05 +
      turnShuffle * 0.02;
    pose.armPosZ += this.armPosAngle;
    pose.armNegZ += this.armNegAngle;
    pose.armPosX = -armOut;
    pose.armNegX = armOut;

    const elbowBase = 0.7 + 0.42 * runFactor;
    const elbowExtra = 0.26 + 0.3 * runFactor;
    const targetElbowPos = clamp(
      elbowBase +
        0.08 * idleWeight +
        Math.max(0, this.armPosAngle) * elbowExtra +
        Math.max(0, -sin) * 0.06 * this.gaitAmp,
      0.2,
      1.55,
    );
    const targetElbowNeg = clamp(
      elbowBase +
        Math.max(0, this.armNegAngle) * elbowExtra +
        Math.max(0, sin) * 0.06 * this.gaitAmp,
      0.2,
      1.55,
    );
    this.elbowPosAngle = damp(this.elbowPosAngle, targetElbowPos, 10, dt);
    this.elbowNegAngle = damp(this.elbowNegAngle, targetElbowNeg, 10, dt);
    pose.elbowPos = this.elbowPosAngle;
    pose.elbowNeg = this.elbowNegAngle;

    // ---- head: stabilize the gaze, then let attention drift ----
    const glanceWeight =
      (idleWeight + 0.08 * this.gaitAmp) * (1 - 0.85 * combat.readyWeight);
    pose.headX +=
      -this.lean * 0.62 +
      Math.sin(theta * 2) * 0.02 * this.gaitAmp +
      this.glancePitch * glanceWeight;
    pose.headY +=
      -shoulderTwist * 0.7 +
      this.glanceYaw * glanceWeight +
      this.turnVelocity * 0.045;
    pose.headZ +=
      -pose.torsoZ * 0.45 +
      idleWeight * 0.006 * idleShift +
      impactSide * 0.006;

    // ---- pistol carry: two-handed grip, forearms together ----
    // The gun forearm is bent near 90° and the support forearm leans in to
    // meet it: both hands stay on the pistol, the elbows are close and bent,
    // not hanging at a fixed 35°. Reference: two-handed pistol hold.
    const carryTarget = this.aiming ? 0 : 1;
    this.carryBlend = damp(this.carryBlend, carryTarget, 7, dt);
    if (this.carryBlend > 0.001) {
      const carry = this.carryBlend;
      // Values captured from the rig editor by hand: gun forearm at ~112°,
      // support forearm leaning across at ~123°.
      pose.armPosZ = lerp(pose.armPosZ, 1.187, carry);
      pose.armPosX = lerp(pose.armPosX, -0.175, carry);
      pose.elbowPos = lerp(pose.elbowPos, 1.955, carry);
      // The support arm keeps the captured idle pose while walking. The old
      // carry angles pulled the elbow up and showed the armpit.
      pose.armNegZ = lerp(pose.armNegZ, deg(IDLE_HOLD.armNeg.z), carry);
      pose.armNegY = lerp(pose.armNegY, deg(IDLE_HOLD.armNeg.y), carry);
      pose.armNegX = lerp(pose.armNegX, deg(IDLE_HOLD.armNeg.x), carry);
      pose.elbowNeg = lerp(pose.elbowNeg, deg(IDLE_HOLD.elbowNeg.z), carry);
      pose.torsoX += 0 * carry;
      pose.torsoY += 0.052 * carry;
      pose.torsoZ += 0.035 * carry;
      pose.headX += 0.052 * carry;
      pose.headY += -0.035 * carry;
      pose.headZ += -0.07 * carry;
    }

    // ---- combat layer ----
    const readyWeight = combat.readyWeight;
    if (readyWeight > 0.001) {
      blendUpper(pose, combat.guard.upper, readyWeight);
      addLower(pose, combat.guard.lower, readyWeight);
      pose.visualY -= combat.guard.crouch * readyWeight;
    }

    // ---- pistol aim: staged raise, support hand, low center of gravity ----
    if (this.aimBlend > 0.001 || this.aimSettle > 0.001) {
      const raise = this.aimBlend;
      const settle = this.aimSettle;
      const support = this.aimSupport;
      const brace = this.aimBrace;

      // Shoulders and torso lead: the body decides before the arm moves.
      pose.torsoY += -0.12 * settle;
      pose.torsoX += -0.03 * settle;
      pose.torsoZ += 0.015 * settle;
      pose.headY += 0.08 * settle;
      pose.headX += 0.03 * settle;

      // Dominant arm: upper arm forward, forearm raised near 90° so the gun
      // sits at chest/face height instead of pointing down at 35°.
      pose.armPosZ = lerp(pose.armPosZ, 0.95, raise);
      pose.armPosX = lerp(pose.armPosX, -0.3, raise);
      pose.elbowPos = lerp(pose.elbowPos, 1.5, raise);

      // Support forearm leans in to meet the gun hand: same close two-handed
      // triangle as the photo, not a parallel second arm.
      pose.armNegZ = lerp(pose.armNegZ, 0.95, support);
      pose.armNegX = lerp(pose.armNegX, 0.92, support);
      pose.elbowNeg = lerp(pose.elbowNeg, 1.3, support);

      // Weight settles last: knees soften and the left foot steps in.
      pose.pelvisY += -0.02 * brace;
      pose.kneePos -= 0.06 * brace;
      pose.kneeNeg -= 0.045 * brace;
      pose.visualY -= 0.02 * brace;
      pose.legNeg += 0.055 * brace;
      pose.legPos -= 0.03 * brace;
    }

    if (combat.attack && combat.attackWeight > 0.001) {
      const weight = combat.attackWeight;
      blendUpper(pose, combat.attack.upper, weight);
      addLower(pose, combat.attack.lower, weight);
      pose.visualZ -= combat.attack.lunge * weight;
      pose.visualY -= combat.attack.crouch * weight;
    }

    const hitWeight = combat.hitWeight;
    if (hitWeight > 0.001) {
      const sign = combat.hitSign;
      const back = combat.hitOffset;
      pose.torsoX += back * 0.36;
      pose.torsoY += hitWeight * 0.3 * sign;
      pose.torsoZ += hitWeight * 0.13 * sign;
      pose.headX += hitWeight * 0.4;
      pose.headY += hitWeight * 0.26 * sign;
      pose.headZ += hitWeight * 0.15 * sign;
      // The hands snap up to protect the head instead of staying at the
      // sides, so the impact reads even when the player was not guarding.
      pose.armPosZ += hitWeight * 0.3;
      pose.armNegZ += hitWeight * 0.24;
      pose.armPosX -= hitWeight * 0.22;
      pose.armNegX += hitWeight * 0.22;
      pose.elbowPos += hitWeight * 0.65;
      pose.elbowNeg += hitWeight * 0.58;
      pose.kneePos -= hitWeight * 0.32;
      pose.kneeNeg -= hitWeight * 0.24;
      pose.legPos += hitWeight * 0.08;
      pose.legNeg -= hitWeight * 0.06;
      pose.visualZ += back * 0.32;
      pose.visualX += hitWeight * 0.08 * sign;
      pose.visualRZ += hitWeight * 0.1 * sign;
      pose.torsoPY -= hitWeight * 0.025;
    }

    // Fear still sits on top of everything: the gait keeps working, the body
    // just starts to betray it as the enemy closes in.
    if (this.fear > 0.001) {
      const shiver = elapsed * 27;
      pose.visualX += Math.sin(shiver * 1.31) * 0.02 * this.fear;
      pose.visualZ += Math.sin(shiver * 1.87) * 0.015 * this.fear;
      pose.visualY += Math.sin(shiver * 2.3) * 0.006 * this.fear;
      pose.visualRZ += Math.sin(shiver * 0.91) * 0.035 * this.fear;
      pose.headZ += Math.sin(shiver * 1.7) * 0.022 * this.fear;
      pose.torsoX += Math.sin(shiver * 1.1) * 0.012 * this.fear;
    }

    // ---- commit the pose ----
    this.visual.position.set(pose.visualX, pose.visualY, pose.visualZ);
    this.visual.rotation.set(pose.visualRX, 0, pose.visualRZ);

    rig.pelvis.rotation.set(0, pose.pelvisY, pose.pelvisZ);
    rig.torso.position.y = pose.torsoPY;
    rig.torso.rotation.set(pose.torsoX, pose.torsoY, pose.torsoZ);
    rig.head.rotation.set(pose.headX, pose.headY, pose.headZ);

    rig.legPos.rotation.z = pose.legPos;
    rig.legNeg.rotation.z = pose.legNeg;
    rig.kneePos.rotation.z = pose.kneePos;
    rig.kneeNeg.rotation.z = pose.kneeNeg;

    rig.armPos.rotation.set(pose.armPosX, 0, pose.armPosZ);
    rig.armNeg.rotation.set(
      pose.armNegX,
      pose.armNegY ?? 0,
      pose.armNegZ,
    );
    rig.elbowPos.rotation.z = pose.elbowPos;
    rig.elbowNeg.rotation.z = pose.elbowNeg;

    // The wrist follows the shot instead of the elbow absorbing everything.
    if (this.wrist) {
      const aimCant = 0.12 + 0.1 * this.aimBlend;
      this.wrist.rotation.set(
        this.recoil * 0.32,
        aimCant,
        this.recoil * 0.1,
      );
    }

    if (this.holder) {
      this.holder.rotation.y =
        Math.PI / 2 + Math.sin(theta) * 0.02 * this.gaitAmp;
    }

    // The support arm is already part of the captured idle/aim and of the
    // carry pose. Do not run the IK while walking: it pulled the elbow out
    // into the armpit.

    const capturedWeight = Math.max(this.holdBlend, this.aimBlend);
    if (capturedWeight > 0.001) {
      const pose =
        this.aimBlend > 0.001
          ? blendCapture(IDLE_HOLD, AIM_HOLD, this.aimBlend)
          : IDLE_HOLD;
      this._applyCapture(pose, capturedWeight, elapsed);
    }

    this._applyRecoil();
  }

  /**
   * Shot recoil as an additive offset on the current pose. Applied after the
   * captured idle/aim, so the kick is visible instead of being overwritten.
   */
  _applyRecoil() {
    const rig = this.rig;
    const r = this.recoil;
    if (!rig || r <= 0.001) return;
    rig.armPos.rotation.z -= r * 0.22;
    rig.armPos.rotation.x += r * 0.05;
    rig.elbowPos.rotation.z += r * 0.16;
    rig.armNeg.rotation.z -= r * 0.06;
    rig.armNeg.rotation.x -= r * 0.03;
    rig.elbowNeg.rotation.z += r * 0.08;
    rig.torso.rotation.x += r * 0.1;
    rig.torso.rotation.y += r * 0.03;
    rig.head.rotation.x += r * 0.07;
    rig.head.rotation.z -= r * 0.02;
    rig.kneePos.rotation.z -= r * 0.03;
    rig.kneeNeg.rotation.z -= r * 0.03;
  }

  /** Blends a captured pose over the animated rig with a slow breath. */
  _applyCapture(pose, weight, elapsed = 0) {
    const rig = this.rig;
    if (!rig) return;
    // Smooth idle life instead of the high-frequency procedural noise: one
    // slow sine split across torso, head and gun arm.
    const breath = Math.sin(elapsed * 1.15) * weight;
    const blend = (group, target, axes) => {
      for (const axis of axes) {
        let targetDeg = target[axis] ?? 0;
        if (axis === "x" && group === rig.torso) targetDeg += breath * 0.5;
        if (axis === "x" && group === rig.head) targetDeg += breath * 0.35;
        if (axis === "z" && group === rig.armPos) targetDeg += breath * 0.3;
        group.rotation[axis] = lerp(
          group.rotation[axis],
          deg(targetDeg),
          weight,
        );
      }
    };
    blend(rig.torso, pose.torso, ["x", "y", "z"]);
    blend(rig.head, pose.head, ["x", "y", "z"]);
    blend(rig.armPos, pose.armPos, ["x", "z"]);
    blend(rig.elbowPos, pose.elbowPos, ["z"]);
    blend(rig.armNeg, pose.armNeg, ["x", "y", "z"]);
    blend(rig.elbowNeg, pose.elbowNeg, ["z"]);
    blend(rig.legPos, pose.legPos, ["z"]);
    blend(rig.kneePos, pose.kneePos, ["z"]);
    blend(rig.legNeg, pose.legNeg, ["z"]);
    blend(rig.kneeNeg, pose.kneeNeg, ["z"]);
    blend(rig.pelvis, pose.pelvis, ["y", "z"]);
  }

  /**
   * Two-bone IK for the support arm, in the torso's local space. The target is
   * the pistol hand (the end of the dominant forearm); the support elbow is
   * pushed outward so the forearm crosses instead of collapsing into the body.
   */
  _solveSupportHand() {
    const rig = this.rig;
    if (!rig) return;
    const gun = new THREE.Vector3(0, -4.25, 0);
    rig.elbowPos.localToWorld(gun);
    const target = rig.torso.worldToLocal(gun.clone());
    const shoulder = rig.armNeg.position.clone();
    const upperRest = rig.elbowNeg.position.clone();
    const L1 = upperRest.length();
    const L2 = 4.25;
    const toTarget = target.clone().sub(shoulder);
    const d = clamp(
      toTarget.length(),
      Math.abs(L1 - L2) + 0.01,
      L1 + L2 - 0.01,
    );
    const dir = toTarget.normalize();
    const pole = new THREE.Vector3(0, 0, -1);
    const normal = new THREE.Vector3().crossVectors(dir, pole);
    if (normal.lengthSq() < 1e-5) normal.set(0, 1, 0);
    normal.normalize();
    const alpha = Math.acos(
      clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1),
    );
    const upperDir = dir.clone().applyAxisAngle(normal, alpha).normalize();
    const elbow = shoulder.clone().addScaledVector(upperDir, L1);
    const lowerDir = target.clone().sub(elbow).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(
      upperRest.clone().normalize(),
      upperDir,
    );
    rig.armNeg.quaternion.copy(quat);
    const lowerLocal = lowerDir.clone().applyQuaternion(quat.clone().invert());
    rig.elbowNeg.rotation.z = Math.atan2(lowerLocal.x, -lowerLocal.y);
  }
}

function buildRig(model, meshes) {
  const torsoPivot = v(JOINTS.torso);
  const headPivot = v(JOINTS.head);
  const jointMaterial = new THREE.MeshStandardMaterial({
    color: 0x1d2b53,
    roughness: 0.9,
    metalness: 0.05,
    flatShading: true,
  });

  const addJointCap = (parent, radius) => {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 8, 6),
      jointMaterial,
    );
    cap.castShadow = true;
    cap.receiveShadow = false;
    parent.add(cap);
    return cap;
  };

  // Pelvis group: the hips and both legs twist together.
  const pelvis = new THREE.Group();
  pelvis.name = "pelvis-pivot";
  model.add(pelvis);
  meshes[9].position.set(0, 0, 0);
  pelvis.add(meshes[9]);

  // Waist group: torso, shoulder pads and neck follow it.
  const torso = new THREE.Group();
  torso.name = "torso-pivot";
  torso.position.copy(torsoPivot);
  model.add(torso);

  for (const index of [3, 2, 4, 1]) {
    const mesh = meshes[index];
    mesh.position.copy(torsoPivot).negate();
    torso.add(mesh);
  }

  // Head/neck joint so the head can lag, nod and look around.
  const head = new THREE.Group();
  head.name = "head-pivot";
  head.position.copy(headPivot).sub(torsoPivot);
  torso.add(head);
  meshes[0].position.copy(headPivot).negate();
  head.add(meshes[0]);

  const armPos = limb(
    torso,
    [meshes[10], meshes[5]],
    JOINTS.armPos.shoulder,
    JOINTS.armPos.elbow,
    torsoPivot,
  );
  const armNeg = limb(
    torso,
    [meshes[11], meshes[8]],
    JOINTS.armNeg.shoulder,
    JOINTS.armNeg.elbow,
    torsoPivot,
  );
  const legPos = limb(
    pelvis,
    [meshes[12], meshes[6]],
    JOINTS.legPos.hip,
    JOINTS.legPos.knee,
  );
  const legNeg = limb(
    pelvis,
    [meshes[13], meshes[7]],
    JOINTS.legNeg.hip,
    JOINTS.legNeg.knee,
  );

  // Names survive cloning: the shadow body finds these to walk on its own.
  armPos.root.name = "arm-pos";
  armPos.joint.name = "elbow-pos";
  armNeg.root.name = "arm-neg";
  armNeg.joint.name = "elbow-neg";
  legPos.root.name = "leg-pos";
  legPos.joint.name = "knee-pos";
  legNeg.root.name = "leg-neg";
  legNeg.joint.name = "knee-neg";

  // Low-poly ball joints bridge the gaps in the picoCAD parts, so the hips,
  // knees, shoulders and elbows stay connected while the limbs move.
  addJointCap(armPos.root, 0.46);
  addJointCap(armNeg.root, 0.46);
  addJointCap(armPos.joint, 0.32);
  addJointCap(armNeg.joint, 0.32);
  addJointCap(legPos.root, 0.62);
  addJointCap(legNeg.root, 0.62);
  addJointCap(legPos.joint, 0.44);
  addJointCap(legNeg.joint, 0.44);

  return {
    pelvis,
    torso,
    head,
    armPos: armPos.root,
    elbowPos: armPos.joint,
    armNeg: armNeg.root,
    elbowNeg: armNeg.joint,
    legPos: legPos.root,
    kneePos: legPos.joint,
    legNeg: legNeg.root,
    kneeNeg: legNeg.joint,
  };
}

/**
 * Wraps two picoCAD parts (upper + lower) into nested pivots so they can swing
 * and bend. The geometry is baked in model space, so every mesh receives an
 * offset that cancels its pivot translation.
 */
function limb(parent, parts, rootPos, jointPos, parentPos = ZERO) {
  const rootVector = v(rootPos);
  const parentOffset = v(parentPos);

  const root = new THREE.Group();
  root.name = "limb";
  root.position.copy(rootVector).sub(parentOffset);
  parent.add(root);

  const [upper, lower] = parts;
  upper.position.copy(rootVector).negate();
  root.add(upper);

  const joint = new THREE.Group();
  joint.position.copy(v(jointPos)).sub(rootVector);
  root.add(joint);

  lower.position.copy(v(jointPos)).negate();
  joint.add(lower);

  return { root, joint };
}

const DUST_COUNT = 26;

class Dust {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = "dust";
    scene.add(this.group);

    const geometry = new THREE.CircleGeometry(0.17, 5);
    this.particles = Array.from({ length: DUST_COUNT }, () => {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffe3c9,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.group.add(mesh);
      return {
        mesh,
        life: 0,
        duration: 0,
        velocity: new THREE.Vector3(),
        spin: 0,
        speed: 0,
      };
    });
    this.cursor = 0;
  }

  spawn(position, yaw, speed) {
    const particle = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.particles.length;

    const lateral = (Math.random() - 0.5) * 0.8;
    const backward = Math.random() * 0.5;
    const offset = new THREE.Vector3(
      Math.sin(yaw) * backward + Math.cos(yaw) * lateral,
      0.055 + Math.random() * 0.05,
      Math.cos(yaw) * backward - Math.sin(yaw) * lateral,
    );

    particle.mesh.position.copy(position).add(offset);
    particle.mesh.rotation.z = Math.random() * Math.PI;
    particle.mesh.scale.setScalar(0.45 + Math.random() * 0.5);
    particle.mesh.visible = true;
    particle.mesh.material.opacity = 0.42;
    particle.life = 0;
    particle.duration = 0.55 + Math.random() * 0.35;
    particle.spin = (Math.random() - 0.5) * 2;
    particle.velocity.set(
      (Math.random() - 0.5) * 0.5,
      0.5 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.5,
    );
    particle.speed = speed;
  }

  update(dt) {
    for (const particle of this.particles) {
      if (!particle.mesh.visible) continue;
      particle.life += dt;
      const t = particle.life / particle.duration;
      if (t >= 1) {
        particle.mesh.visible = false;
        particle.mesh.material.opacity = 0;
        continue;
      }
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.rotation.z += particle.spin * dt;
      particle.mesh.scale.setScalar(
        (0.5 + t * 1.5) * (0.7 + particle.speed * 0.03),
      );
      particle.mesh.material.opacity = 0.4 * (1 - t) ** 1.6;
    }
  }
}
