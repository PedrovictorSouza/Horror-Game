import test from "node:test";
import assert from "node:assert/strict";
import { Weapon } from "../src/game/weapon.js";

const pistol = () => new Weapon({ clipSize: 8, reserve: 16, fireInterval: 0.4, reloadTime: 1.5 });

test("starts loaded and can fire", () => {
  const weapon = pistol();
  assert.equal(weapon.clip, 8);
  assert.equal(weapon.reserve, 16);
  assert.equal(weapon.canFire, true);
});

test("firing consumes a round and respects the cooldown", () => {
  const weapon = pistol();
  assert.equal(weapon.fire(), "fired");
  assert.equal(weapon.clip, 7);
  assert.equal(weapon.fire(), "cooling");
  weapon.update(0.5);
  assert.equal(weapon.fire(), "fired");
  assert.equal(weapon.clip, 6);
});

test("an empty magazine reports empty instead of firing", () => {
  const weapon = pistol();
  for (let i = 0; i < 8; i++) {
    weapon.fire();
    weapon.update(0.5);
  }
  assert.equal(weapon.clip, 0);
  assert.equal(weapon.fire(), "empty");
});

test("reload takes time and pulls from the reserve", () => {
  const weapon = pistol();
  weapon.fire();
  weapon.update(0.5);
  assert.equal(weapon.startReload(), true);
  assert.equal(weapon.fire(), "reloading");
  weapon.update(1.4);
  assert.equal(weapon.reloading, true);
  weapon.update(0.2);
  assert.equal(weapon.reloading, false);
  assert.equal(weapon.clip, 8);
  assert.equal(weapon.reserve, 15);
});

test("reload is denied when full or out of reserve", () => {
  const full = pistol();
  assert.equal(full.startReload(), false);
  const empty = new Weapon({ clipSize: 8, reserve: 0 });
  empty.clip = 0;
  assert.equal(empty.startReload(), false);
});

test("ammo pickups go to the reserve", () => {
  const weapon = pistol();
  assert.equal(weapon.addAmmo(8), 8);
  assert.equal(weapon.reserve, 24);
  assert.equal(weapon.addAmmo(0), 0);
});

test("finishing a reload with less reserve than needed fills what it can", () => {
  const weapon = new Weapon({ clipSize: 8, reserve: 3 });
  weapon.clip = 0;
  weapon.startReload();
  weapon.update(2);
  assert.equal(weapon.clip, 3);
  assert.equal(weapon.reserve, 0);
});
