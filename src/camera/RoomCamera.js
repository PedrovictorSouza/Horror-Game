import * as THREE from "three";
import { CameraStrategy } from "./CameraStrategy.js";
import { buildRoomShots } from "./shots.js";

/**
 * One camera per room. It is the same hand-placed language as FixedCamera, but
 * it never splits a room into halves and it only covers the rooms it names.
 */
export class RoomCamera extends CameraStrategy {
  constructor(station) {
    super("room");
    this.station = station;
    this.shots = buildRoomShots(station.layout);
    this.active = null;
    this._position = new THREE.Vector3();
    this._target = new THREE.Vector3();
  }

  enter(context) {
    this.active = this.choose(context.position.x, context.position.z);
    this.cut = true;
    this.sync();
  }

  update(dt, context) {
    const next = this.choose(context.position.x, context.position.z);
    if (next !== this.active) {
      this.active = next;
      this.cut = true;
    }
    this.sync();
  }

  choose(x, z) {
    const area = this.station.areaAt?.(x, z) ?? null;
    if (area === "hall") return this.shots.find((shot) => shot.id === "hall") ?? null;
    if (area === "room")
      return this.shots.find((shot) => shot.id === "room-near") ?? null;
    return this.shots.find((shot) => shot.zone(x, z)) ?? null;
  }

  sync() {
    const shot = this.active;
    if (!shot) return;
    this.shot = shot;
    this._position.set(shot.position[0], shot.position[1], shot.position[2]);
    this._target.set(shot.target[0], shot.target[1], shot.target[2]);
    this.setPose(this._position, this._target, shot.fov);
  }

  snapTo(context) {
    this.active = this.choose(context.position.x, context.position.z);
    this.cut = true;
    this.sync();
  }

  covers(x, z) {
    return this.shots.some((shot) => shot.zone(x, z));
  }
}
