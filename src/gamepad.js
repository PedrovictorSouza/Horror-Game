/**
 * Standard-mapping gamepad (Xbox / PlayStation / most USB pads).
 *
 *   left stick / D-pad   move (Y) and turn (X)
 *   LT                   aim (hold)
 *   RT / A               fire (edge); near the console it opens the interface
 *   X                    reload
 *   LB / RB              previous / next fixed camera shot
 *   Y                    cycle the camera strategy
 *   L3 / R3              run (hold)
 *   B / Start            close the interface
 *
 * Analog values are preserved for move/turn; the player scales the walk speed
 * by the stick magnitude. Everything else is edge-triggered by the Input.
 */
const DEADZONE = 0.24;
const TRIGGER = 0.35;
const FIRE = 0.45;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class Gamepad {
  constructor({ getPads } = {}) {
    this._getPads =
      getPads ??
      (() => {
        if (typeof navigator === "undefined" || !navigator.getGamepads) {
          return [];
        }
        return navigator.getGamepads();
      });

    this.connected = false;
    this.index = null;
    this.move = 0;
    this.turn = 0;
    this.run = false;
    this.aiming = false;
    this.fire = false;
    this.reload = false;
    this.cameraStep = 0;
    this.cameraMode = false;
    this.cancel = false;
    this._prev = this._blank();
  }

  _blank() {
    return {
      fire: false,
      reload: false,
      camLeft: false,
      camRight: false,
      mode: false,
      cancel: false,
    };
  }

  poll() {
    const pads = this._getPads() ?? [];
    let pad = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }

    if (!pad) {
      this.connected = false;
      this.index = null;
      this.move = 0;
      this.turn = 0;
      this.run = false;
      this.aiming = false;
      this.fire = false;
      this.reload = false;
      this.cameraStep = 0;
      this.cameraMode = false;
      this.cancel = false;
      this._prev = this._blank();
      return;
    }

    this.connected = true;
    this.index = pad.index ?? 0;

    const buttons = pad.buttons ?? [];
    const pressed = (i) => Boolean(buttons[i]?.pressed);
    const value = (i) =>
      buttons[i]?.value ?? (pressed(i) ? 1 : 0);
    const axis = (i) => {
      const v = pad.axes?.[i] ?? 0;
      return Math.abs(v) < DEADZONE ? 0 : v;
    };

    const lx = axis(0);
    const ly = axis(1);
    const rx = axis(2);
    const dpadX = (pressed(14) ? 1 : 0) - (pressed(15) ? 1 : 0);
    const dpadY = (pressed(12) ? 1 : 0) - (pressed(13) ? 1 : 0);

    // Up is negative on the stick; the game's move is +1 forward.
    this.move = clamp(-ly + dpadY, -1, 1);
    // Right is positive on the stick; the game's turn is +1 to the left.
    const stickTurn = Math.abs(lx) >= Math.abs(rx) ? -lx : -rx;
    this.turn = clamp(stickTurn + dpadX, -1, 1);

    this.run = pressed(10) || pressed(11); // L3 / R3
    this.aiming = value(6) > TRIGGER || pressed(6); // LT

    const fireDown = value(7) > FIRE || pressed(7) || pressed(0); // RT / A
    const reloadDown = pressed(2); // X
    const camLeft = pressed(4); // LB
    const camRight = pressed(5); // RB
    const modeDown = pressed(3); // Y
    const cancelDown = pressed(1) || pressed(9); // B / Start

    this.fire = fireDown && !this._prev.fire;
    this.reload = reloadDown && !this._prev.reload;
    this.cameraStep =
      (camLeft && !this._prev.camLeft ? 1 : 0) +
      (camRight && !this._prev.camRight ? -1 : 0);
    this.cameraMode = modeDown && !this._prev.mode;
    this.cancel = cancelDown && !this._prev.cancel;

    this._prev = {
      fire: fireDown,
      reload: reloadDown,
      camLeft,
      camRight,
      mode: modeDown,
      cancel: cancelDown,
    };
  }

  get isMoving() {
    return this.move !== 0 || this.turn !== 0;
  }
}
