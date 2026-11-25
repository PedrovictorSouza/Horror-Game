const ATTACK_DURATION = 0.74;
const HIT_SPRING = 140;
const HIT_DAMPING = 20;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInCubic = (t) => t ** 3;

const UPPER_KEYS = [
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
  "armNegX",
  "elbowNeg",
];

const LOWER_KEYS = ["legPos", "legNeg", "kneePos", "kneeNeg", "pelvisY", "pelvisZ"];

/**
 * The character's neutral guard. It is intentionally bladed and asymmetric:
 * one foot forward, weight low, hands between the body and the threat.
 */
const GUARD = {
  upper: {
    torsoX: -0.09,
    torsoY: 0.16,
    torsoZ: 0.015,
    headX: 0.035,
    headY: -0.11,
    headZ: 0,
    // Hands forward and in front of the chest: rotate the shoulders forward
    // and keep the elbows folded instead of splaying the arms sideways.
    armPosZ: 0.86,
    armPosX: 0.38,
    elbowPos: 1.48,
    armNegZ: 0.58,
    armNegX: -0.38,
    elbowNeg: 1.28,
  },
  lower: {
    legPos: 0.06,
    legNeg: -0.055,
    kneePos: -0.18,
    kneeNeg: -0.23,
    pelvisY: -0.1,
    pelvisZ: 0.015,
  },
  crouch: 0.035,
};

/**
 * A committed physical strike. The keys are not a sine loop: the wind-up
 * loads the torso, the strike accelerates through a very short segment, and
 * the recovery is deliberately longer than the hit itself.
 *
 * p = 0.00 guard
 * p = 0.17 coil / weight back
 * p = 0.31 impact (snap)
 * p = 0.45 follow-through / over-rotation
 * p = 0.70 recovery
 * p = 1.00 guard
 */
const ATTACK_KEYS = [
  {
    p: 0,
    ease: "smooth",
    upper: GUARD.upper,
    lower: GUARD.lower,
    lunge: 0,
    crouch: GUARD.crouch,
  },
  {
    p: 0.17,
    ease: "out",
    upper: {
      torsoX: -0.035,
      torsoY: 0.38,
      torsoZ: -0.025,
      headX: 0.03,
      headY: 0.055,
      headZ: 0,
      armPosZ: 0.92,
      armPosX: 0.34,
      elbowPos: 1.56,
      armNegZ: -0.55,
      armNegX: -0.18,
      elbowNeg: 1.7,
    },
    lower: {
      legPos: 0.018,
      legNeg: -0.13,
      kneePos: -0.15,
      kneeNeg: -0.21,
      pelvisY: 0.08,
      pelvisZ: -0.02,
    },
    lunge: -0.055,
    crouch: 0.035,
  },
  {
    p: 0.31,
    ease: "in",
    upper: {
      torsoX: -0.245,
      torsoY: -0.48,
      torsoZ: 0.05,
      headX: -0.02,
      headY: -0.2,
      headZ: 0.012,
      armPosZ: 0.26,
      armPosX: 0.3,
      elbowPos: 1.44,
      armNegZ: 1.3,
      armNegX: 0.0,
      elbowNeg: 0.2,
    },
    lower: {
      legPos: 0.1,
      legNeg: -0.17,
      kneePos: -0.24,
      kneeNeg: -0.18,
      pelvisY: -0.24,
      pelvisZ: 0.03,
    },
    lunge: 0.22,
    crouch: 0.045,
  },
  {
    p: 0.45,
    ease: "out",
    upper: {
      torsoX: -0.19,
      torsoY: -0.57,
      torsoZ: 0.04,
      headX: -0.005,
      headY: -0.16,
      headZ: 0,
      armPosZ: 0.38,
      armPosX: 0.32,
      elbowPos: 1.3,
      armNegZ: 1.18,
      armNegX: -0.05,
      elbowNeg: 0.45,
    },
    lower: {
      legPos: 0.08,
      legNeg: -0.14,
      kneePos: -0.2,
      kneeNeg: -0.16,
      pelvisY: -0.22,
      pelvisZ: 0.02,
    },
    lunge: 0.18,
    crouch: 0.03,
  },
  {
    p: 0.7,
    ease: "smooth",
    upper: {
      torsoX: -0.105,
      torsoY: -0.18,
      torsoZ: 0.02,
      headX: 0.0,
      headY: -0.1,
      headZ: 0,
      armPosZ: 0.6,
      armPosX: 0.36,
      elbowPos: 1.4,
      armNegZ: 0.62,
      armNegX: -0.22,
      elbowNeg: 0.95,
    },
    lower: {
      legPos: 0.06,
      legNeg: -0.06,
      kneePos: -0.12,
      kneeNeg: -0.16,
      pelvisY: -0.12,
      pelvisZ: 0,
    },
    lunge: 0.06,
    crouch: 0.02,
  },
  {
    p: 1,
    ease: "smooth",
    upper: GUARD.upper,
    lower: GUARD.lower,
    lunge: 0,
    crouch: GUARD.crouch,
  },
];

function segmentEase(ease, t) {
  if (ease === "in") return easeInCubic(t);
  if (ease === "out") return easeOutCubic(t);
  return t * t * (3 - 2 * t);
}

function sampleKeys(keys, p) {
  const clamped = clamp(p, 0, 1);
  let index = 0;
  while (index < keys.length - 2 && clamped > keys[index + 1].p) index += 1;
  const from = keys[index];
  const to = keys[index + 1];
  const span = Math.max(0.0001, to.p - from.p);
  const t = segmentEase(to.ease, clamp((clamped - from.p) / span, 0, 1));

  const upper = {};
  for (const key of UPPER_KEYS) upper[key] = lerp(from.upper[key], to.upper[key], t);
  const lower = {};
  for (const key of LOWER_KEYS) lower[key] = lerp(from.lower[key], to.lower[key], t);

  return {
    upper,
    lower,
    lunge: lerp(from.lunge, to.lunge, t),
    crouch: lerp(from.crouch, to.crouch, t),
  };
}

function mirrorPose(sample) {
  const mirrored = {
    upper: { ...sample.upper },
    lower: { ...sample.lower },
    lunge: sample.lunge,
    crouch: sample.crouch,
  };

  for (const key of UPPER_KEYS) {
    if (key === "torsoY" || key === "torsoZ" || key === "headY" || key === "headZ") {
      mirrored.upper[key] = -sample.upper[key];
    }
  }
  for (const key of LOWER_KEYS) {
    if (key === "pelvisY" || key === "pelvisZ") mirrored.lower[key] = -sample.lower[key];
  }

  // Swap the two arms.
  mirrored.upper.armPosZ = sample.upper.armNegZ;
  mirrored.upper.armPosX = -sample.upper.armNegX;
  mirrored.upper.elbowPos = sample.upper.elbowNeg;
  mirrored.upper.armNegZ = sample.upper.armPosZ;
  mirrored.upper.armNegX = -sample.upper.armPosX;
  mirrored.upper.elbowNeg = sample.upper.elbowPos;

  mirrored.lower.legPos = sample.lower.legNeg;
  mirrored.lower.legNeg = sample.lower.legPos;

  return mirrored;
}

/**
 * Tank-friendly combat animation layer.
 *
 * It owns only the animation/timing state. It does not move the character,
 * deal damage, consume input or know about weapons. Player.update() reads its
 * sample and blends the result over the procedural locomotion pose.
 */
export class CombatController {
  constructor() {
    this.ready = false;
    this.readyWeight = 0;
    this.attack = null;
    this.hit = null;
    this.attackWeight = 0;
    this.hitWeight = 0;
    this.hitOffset = 0;
    this.hitSign = 1;
    this.hitCount = 0;
    this.control = 1;
    this.turnControl = 1;
    this._sample = null;
  }

  setReady(value = true) {
    this.ready = Boolean(value);
  }

  /**
   * Starts a strike. The previous strike can only be chained after the
   * follow-through, which keeps the commitment.
   */
  startAttack(side = "right") {
    if (this.hit) return false;
    if (this.attack && this.attack.time < ATTACK_DURATION * 0.62) return false;
    this.attack = {
      time: 0,
      duration: ATTACK_DURATION,
      side: side === "left" ? "left" : "right",
    };
    return true;
  }

  /**
   * @param {number} strength 0…1.2
   * @param {number|null} direction radians relative to the character's front
   *   (0 = from the front, ±π/2 = from the sides, π = from behind)
   */
  startHit(strength = 1, direction = null) {
    const amount = clamp(strength, 0, 1.2);
    if (amount <= 0) return false;

    this.attack = null;
    this.hitCount += 1;
    this.hit = { offset: amount, velocity: 0 };
    this.hitSign =
      direction === null
        ? this.hitCount % 2 === 0
          ? 1
          : -1
        : Math.sin(direction) >= 0
          ? 1
          : -1;
    return true;
  }

  reset() {
    this.ready = false;
    this.readyWeight = 0;
    this.attack = null;
    this.attackWeight = 0;
    this.hit = null;
    this.hitWeight = 0;
    this.hitOffset = 0;
    this.control = 1;
    this.turnControl = 1;
    this._sample = null;
  }

  update(dt) {
    if (dt <= 0) return;

    this.readyWeight = damp(this.readyWeight, this.ready ? 1 : 0, 7, dt);

    if (this.attack) {
      this.attack.time += dt;
      if (this.attack.time >= this.attack.duration) this.attack = null;
    }

    if (this.hit) {
      // Damped spring, sub-stepped so the impact is stable even on a long
      // frame. This is the physical hit response, not a looping sine.
      let remaining = dt;
      while (remaining > 0) {
        const step = Math.min(remaining, 1 / 120);
        const acceleration =
          -HIT_SPRING * this.hit.offset - HIT_DAMPING * this.hit.velocity;
        this.hit.velocity += acceleration * step;
        this.hit.offset += this.hit.velocity * step;
        remaining -= step;
      }
      if (
        Math.abs(this.hit.offset) < 0.003 &&
        Math.abs(this.hit.velocity) < 0.03
      ) {
        this.hit = null;
      }
    }

    let attackWeight = 0;
    let attackCommit = 0;
    let attackSample = null;

    if (this.attack) {
      const p = clamp(this.attack.time / this.attack.duration, 0, 1);
      attackWeight =
        smoothstep(0, 0.05, p) * (1 - smoothstep(0.82, 1, p));
      attackCommit =
        smoothstep(0.06, 0.24, p) * (1 - smoothstep(0.58, 0.92, p));

      const sampled = sampleKeys(ATTACK_KEYS, p);
      attackSample =
        this.attack.side === "left" ? mirrorPose(sampled) : sampled;
    }

    this.attackWeight = attackWeight;
    this.hitOffset = this.hit ? this.hit.offset : 0;
    this.hitWeight = Math.min(1.2, Math.abs(this.hitOffset));

    const hitControl = 1 - 0.55 * Math.min(1, this.hitWeight);
    this.control = clamp((1 - 0.4 * attackCommit) * hitControl, 0.25, 1);
    this.turnControl = clamp(
      (1 - 0.24 * attackCommit) * (1 - 0.35 * Math.min(1, this.hitWeight)),
      0.3,
      1,
    );

    this._sample = {
      readyWeight: this.readyWeight,
      attackWeight,
      attack: attackSample,
      hitOffset: this.hitOffset,
      hitWeight: this.hitWeight,
      hitSign: this.hitSign,
      control: this.control,
      turnControl: this.turnControl,
      guard: GUARD,
    };
  }

  sample() {
    return this._sample ?? {
      readyWeight: 0,
      attackWeight: 0,
      attack: null,
      hitOffset: 0,
      hitWeight: 0,
      hitSign: 1,
      control: 1,
      turnControl: 1,
      guard: GUARD,
    };
  }

  getState() {
    const p = this.attack
      ? clamp(this.attack.time / this.attack.duration, 0, 1)
      : 0;
    return {
      ready: this.ready,
      readyWeight: this.readyWeight,
      attacking: Boolean(this.attack),
      attackSide: this.attack?.side ?? null,
      attackPhase: p,
      hit: Boolean(this.hit),
      hitWeight: this.hitWeight,
      control: this.control,
    };
  }
}
