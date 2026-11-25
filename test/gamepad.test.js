import test from "node:test";
import assert from "node:assert/strict";
import { Gamepad } from "../src/gamepad.js";

const pad = ({ axes = [0, 0, 0, 0], buttons = {} } = {}) => {
  const list = Array.from({ length: 16 }, () => ({
    pressed: false,
    value: 0,
  }));
  for (const [index, value] of Object.entries(buttons)) {
    list[index] =
      typeof value === "number"
        ? { pressed: value > 0.5, value }
        : { pressed: Boolean(value), value: value ? 1 : 0 };
  }
  return { connected: true, index: 2, axes, buttons: list };
};

const make = (getPads) => new Gamepad({ getPads });

test("stick and D-pad drive move and turn", () => {
  let state = pad({ axes: [0, -1, 0, 0] });
  const gamepad = make(() => [state]);
  gamepad.poll();
  assert.equal(gamepad.move, 1);
  assert.equal(gamepad.turn, 0);

  state = pad({ axes: [1, 0, 0, 0] });
  gamepad.poll();
  assert.equal(gamepad.turn, -1);

  state = pad({ axes: [0, -0.5, 0, 0] });
  gamepad.poll();
  assert.equal(gamepad.move, 0.5);

  state = pad({ axes: [0, -0.1, 0, 0] });
  gamepad.poll();
  assert.equal(gamepad.move, 0);

  state = pad({ buttons: { 12: true, 14: true } });
  gamepad.poll();
  assert.equal(gamepad.move, 1);
  assert.equal(gamepad.turn, 1);

  state = pad({ axes: [0, 0, 1, 0] });
  gamepad.poll();
  assert.equal(gamepad.turn, -1);
});

test("LT aims, RT and A fire once per press", () => {
  let state = pad({ buttons: { 6: 1 } });
  const gamepad = make(() => [state]);
  gamepad.poll();
  assert.equal(gamepad.aiming, true);
  assert.equal(gamepad.fire, false);

  state = pad({ buttons: { 7: 1 } });
  gamepad.poll();
  assert.equal(gamepad.fire, true);

  gamepad.poll();
  assert.equal(gamepad.fire, false);

  state = pad({ buttons: {} });
  gamepad.poll();
  state = pad({ buttons: { 7: 1 } });
  gamepad.poll();
  assert.equal(gamepad.fire, true);

  state = pad({ buttons: {} });
  gamepad.poll();
  state = pad({ buttons: { 0: true } });
  gamepad.poll();
  assert.equal(gamepad.fire, true);
});

test("reload, camera, strategy and cancel are edge-triggered", () => {
  let state = pad({ buttons: { 2: true } });
  const gamepad = make(() => [state]);
  gamepad.poll();
  assert.equal(gamepad.reload, true);
  gamepad.poll();
  assert.equal(gamepad.reload, false);

  state = pad({ buttons: { 4: true } });
  gamepad.poll();
  assert.equal(gamepad.cameraStep, 1);
  gamepad.poll();
  assert.equal(gamepad.cameraStep, 0);

  state = pad({ buttons: { 5: true } });
  gamepad.poll();
  assert.equal(gamepad.cameraStep, -1);

  state = pad({ buttons: { 3: true } });
  gamepad.poll();
  assert.equal(gamepad.cameraMode, true);
  gamepad.poll();
  assert.equal(gamepad.cameraMode, false);

  state = pad({ buttons: { 1: true } });
  gamepad.poll();
  assert.equal(gamepad.cancel, true);
  gamepad.poll();
  assert.equal(gamepad.cancel, false);

  state = pad({ buttons: {} });
  gamepad.poll();
  state = pad({ buttons: { 9: true } });
  gamepad.poll();
  assert.equal(gamepad.cancel, true);

  state = pad({ buttons: { 10: true } });
  gamepad.poll();
  assert.equal(gamepad.run, true);
});

test("no pad clears the state", () => {
  let found = [pad({ axes: [0, -1, 0, 0], buttons: { 7: 1 } })];
  const gamepad = make(() => found);
  gamepad.poll();
  assert.equal(gamepad.connected, true);
  assert.equal(gamepad.move, 1);

  found = [null, { connected: false }];
  gamepad.poll();
  assert.equal(gamepad.connected, false);
  assert.equal(gamepad.move, 0);
  assert.equal(gamepad.turn, 0);
  assert.equal(gamepad.fire, false);
  assert.equal(gamepad.isMoving, false);
});
