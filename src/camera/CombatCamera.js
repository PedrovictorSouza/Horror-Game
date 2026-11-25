import * as THREE from "three";
import { CameraStrategy } from "./CameraStrategy.js";

/**
 * Combat framing: over the player's right shoulder, tighter lens, looking
 * along the aim. Used while the pistol is raised.
 */
export class CombatCamera extends CameraStrategy {
  constructor(station) {
    super("combat");
    this.station = station;
    this._look = new THREE.Vector3();
  }

  enter() {
    this.cut = true;
  }

  update(dt, context) {
    const p = context.position;
    const yaw = context.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    this.position.set(
      p.x + rx * 0.9 - fx * 3.8,
      p.y + 2.0,
      p.z + rz * 0.9 - fz * 3.8,
    );
    this.station.resolve(this.position, 0.25);

    this._look.set(p.x + fx * 7, p.y + 1.3, p.z + fz * 7);
    this.setPose(this.position, this._look, 55);
    this.shot = { id: "combat", group: null };
    this.cut = false;
  }

  covers() {
    return true;
  }
}
