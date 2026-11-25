import { Gamepad } from "./gamepad.js";

const FORWARD_KEYS = new Set(["KeyW"]);
const BACK_KEYS = new Set(["KeyS"]);
const LEFT_KEYS = new Set(["KeyA"]);
const RIGHT_KEYS = new Set(["KeyD"]);
const RUN_KEYS = new Set(["ShiftLeft", "ShiftRight"]);
const AIM_KEYS = new Set(["KeyM"]);
const FIRE_KEYS = new Set(["KeyN"]);
const CAMERA_LEFT_KEYS = new Set(["ArrowLeft"]);
const CAMERA_RIGHT_KEYS = new Set(["ArrowRight"]);
const CAMERA_UP_KEYS = new Set(["ArrowUp"]);
const CAMERA_DOWN_KEYS = new Set(["ArrowDown"]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Player input: keyboard plus a standard gamepad.
 *
 * Keyboard (tank controls):
 *   move  = +1 (W) / -1 (S)
 *   turn  = +1 (A) / -1 (D)
 *   arrows cycle the fixed camera shots, V cycles the camera strategy.
 *   hold M to aim, tap N to fire, R reloads.
 *
 * Gamepad: see src/gamepad.js for the mapping. `poll()` must be called once
 * per frame; the pad state is sampled, and its edges are folded into the same
 * queues the keyboard uses, so the rest of the game sees one input surface.
 */
export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.gamepad = new Gamepad();
    this.firstMove = false;
    this.onFirstMove = null;
    // Arrow presses are edge-triggered: one step per press, not per frame.
    this.cameraStep = 0;
    this.cameraModeQueued = 0;
    // Weapon intent. Fire and reload are edge-triggered; aim is read from the
    // held M key / LT trigger through the `aiming` getter below.
    this.fireQueued = false;
    this.reloadQueued = false;
    this.cancelQueued = false;

    this._onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const code = event.code;
      if (
        FORWARD_KEYS.has(code) ||
        BACK_KEYS.has(code) ||
        LEFT_KEYS.has(code) ||
        RIGHT_KEYS.has(code) ||
        CAMERA_LEFT_KEYS.has(code) ||
        CAMERA_RIGHT_KEYS.has(code) ||
        CAMERA_UP_KEYS.has(code) ||
        CAMERA_DOWN_KEYS.has(code) ||
        code === "Space"
      ) {
        event.preventDefault();
      }

      if (!event.repeat && (code === "ArrowLeft" || code === "ArrowUp")) {
        this.cameraStep += 1;
      }
      if (!event.repeat && (code === "ArrowRight" || code === "ArrowDown")) {
        this.cameraStep -= 1;
      }
      if (!event.repeat && code === "KeyV") {
        this.cameraModeQueued += 1;
      }

      if (!event.repeat && code === "KeyR") {
        this.reloadQueued = true;
      }
      if (!event.repeat && FIRE_KEYS.has(code)) {
        this.fireQueued = true;
      }

      if (!this.keys.has(code)) {
        this.keys.add(code);
        if (this._isMovementKey(code) && !this.firstMove) {
          this.firstMove = true;
          this.onFirstMove?.();
        }
      }
    };

    this._onKeyUp = (event) => {
      this.keys.delete(event.code);
    };

    this._onBlur = () => this.keys.clear();

    target.addEventListener("keydown", this._onKeyDown, { passive: false });
    target.addEventListener("keyup", this._onKeyUp);
    target.addEventListener("blur", this._onBlur);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.keys.clear();
    });
  }

  /** Samples the pad once per frame and folds its edges into the queues. */
  poll() {
    this.gamepad.poll();

    if (this.gamepad.fire) this.fireQueued = true;
    if (this.gamepad.reload) this.reloadQueued = true;
    if (this.gamepad.cameraStep) {
      this.cameraStep += this.gamepad.cameraStep;
    }
    if (this.gamepad.cameraMode) this.cameraModeQueued += 1;
    if (this.gamepad.cancel) this.cancelQueued = true;

    if (!this.firstMove && this.gamepad.isMoving) {
      this.firstMove = true;
      this.onFirstMove?.();
    }
  }

  _isMovementKey(code) {
    return (
      FORWARD_KEYS.has(code) ||
      BACK_KEYS.has(code) ||
      LEFT_KEYS.has(code) ||
      RIGHT_KEYS.has(code)
    );
  }

  _any(codes) {
    for (const code of codes) if (this.keys.has(code)) return true;
    return false;
  }

  _keyboardMove() {
    return (this._any(FORWARD_KEYS) ? 1 : 0) - (this._any(BACK_KEYS) ? 1 : 0);
  }

  _keyboardTurn() {
    return (this._any(LEFT_KEYS) ? 1 : 0) - (this._any(RIGHT_KEYS) ? 1 : 0);
  }

  /** +1 = forward; the stick keeps its analog magnitude. */
  get move() {
    return clamp(this._keyboardMove() + this.gamepad.move, -1, 1);
  }

  /** +1 = turn left; the stick keeps its analog magnitude. */
  get turn() {
    return clamp(this._keyboardTurn() + this.gamepad.turn, -1, 1);
  }

  /** Pistol raised: held M or LT. */
  get aiming() {
    return this._any(AIM_KEYS) || this.gamepad.aiming;
  }

  /** One queued shot per press; holding N / RT does not auto-fire. */
  consumeFire() {
    const queued = this.fireQueued;
    this.fireQueued = false;
    return queued;
  }

  /** One queued reload per press. */
  consumeReload() {
    const queued = this.reloadQueued;
    this.reloadQueued = false;
    return queued;
  }

  /** One strategy cycle per press (auto -> fixed -> room -> combat -> follow). */
  consumeCameraMode() {
    const queued = this.cameraModeQueued;
    this.cameraModeQueued = 0;
    return queued;
  }

  /** Consumes the accumulated camera steps (+1 = previous, -1 = next). */
  consumeCameraStep() {
    const step = this.cameraStep;
    this.cameraStep = 0;
    return step;
  }

  /** Gamepad B / Start while the interface is open. */
  consumeCancel() {
    const queued = this.cancelQueued;
    this.cancelQueued = false;
    return queued;
  }

  get run() {
    return this._any(RUN_KEYS) || this.gamepad.run;
  }

  get isMoving() {
    return this.move !== 0 || this.turn !== 0;
  }
}
