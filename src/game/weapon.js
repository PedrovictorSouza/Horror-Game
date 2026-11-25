/**
 * Weapon state, no rendering and no input.
 *
 * Deliberately tiny and pure so it can be tested with `node --test` and reused
 * by any control scheme: the pistol is a magazine, a reserve and a cooldown.
 */
export class Weapon {
  constructor({
    clipSize = 8,
    reserve = 16,
    fireInterval = 0.42,
    reloadTime = 1.5,
  } = {}) {
    this.clipSize = clipSize;
    this.clip = clipSize;
    this.reserve = reserve;
    this.fireInterval = fireInterval;
    this.reloadTime = reloadTime;
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.reloading = false;
  }

  get isEmpty() {
    return this.clip <= 0;
  }

  get canFire() {
    return !this.reloading && this.cooldown <= 0 && this.clip > 0;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloadTimer = 0;
        this.reloading = false;
        this.finishReload();
      }
    }
  }

  /** "fired" | "empty" | "cooling" | "reloading" */
  fire() {
    if (this.reloading) return "reloading";
    if (this.cooldown > 0) return "cooling";
    if (this.clip <= 0) return "empty";
    this.clip -= 1;
    this.cooldown = this.fireInterval;
    return "fired";
  }

  startReload() {
    if (this.reloading) return false;
    if (this.reserve <= 0 || this.clip >= this.clipSize) return false;
    this.reloading = true;
    this.reloadTimer = this.reloadTime;
    return true;
  }

  finishReload() {
    const need = this.clipSize - this.clip;
    const take = Math.min(need, this.reserve);
    this.clip += take;
    this.reserve -= take;
    return take;
  }

  addAmmo(amount) {
    if (amount <= 0) return 0;
    this.reserve += amount;
    return amount;
  }
}
