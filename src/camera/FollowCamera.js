import * as THREE from "three";
import { CameraStrategy } from "./CameraStrategy.js";

/**
 * Follow camera: sits behind the player's back and damps toward the new
 * position. Not the default of the game, but the fallback and a manual mode.
 */
export class FollowCamera extends CameraStrategy {
  constructor(station) {
    super("follow");
    this.station = station;
    this.distance = 6.5;
    this.height = 3.2;
    this.lookHeight = 1.1;
    this.initialized = false;
    this._look = new THREE.Vector3();
    this._target = new THREE.Vector3();
  }

  enter() {
    this.initialized = false;
    this.cut = true;
  }

  update(dt, context) {
    const p = context.position;
    const yaw = context.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const tx = p.x - fx * this.distance;
    const tz = p.z - fz * this.distance;

    if (!this.initialized) {
      this.position.set(tx, p.y + this.height, tz);
      this.initialized = true;
    } else {
      const lambda = 1 - Math.exp(-5 * dt);
      this.position.x += (tx - this.position.x) * lambda;
      this.position.y += (p.y + this.height - this.position.y) * lambda;
      this.position.z += (tz - this.position.z) * lambda;
    }

    // Do not sit inside a wall.
    this.station.resolve(this.position, 0.25);

    this._look.set(p.x, p.y + this.lookHeight, p.z);
    this.setPose(this.position, this._look, 52);
    this.shot = { id: "follow", group: null };
    this.cut = false;
  }

  covers() {
    return true;
  }
}
