import * as THREE from "three";
import { FixedCamera } from "./FixedCamera.js";
import { RoomCamera } from "./RoomCamera.js";
import { CombatCamera } from "./CombatCamera.js";
import { FollowCamera } from "./FollowCamera.js";
import { trace } from "../ui/trace.js";

const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Camera manager. It owns the active strategy, the policy that picks it and the
 * transition; it never computes a shot itself. A strategy only returns a pose.
 *
 * Policy (auto):
 *   hall / room   -> RoomCamera
 *   corridor      -> FixedCamera
 *   anywhere else -> FollowCamera
 *
 * `V` cycles auto -> fixed -> room -> combat -> follow for inspection.
 */
export class CameraManager {
  constructor(camera, station) {
    this.camera = camera;
    this.station = station;
    this.strategies = {
      fixed: new FixedCamera(station),
      room: new RoomCamera(station),
      combat: new CombatCamera(station),
      follow: new FollowCamera(station),
    };
    this.order = ["auto", "fixed", "room", "combat", "follow"];
    this.mode = "auto";

    this.active = null;
    this.blend = 1;
    this.blendDuration = 0.24;
    this.fromPosition = new THREE.Vector3();
    this.fromQuaternion = new THREE.Quaternion();
    this.fromFov = camera.fov;
    this.time = 0;
    this.tension = 0;
    this._lastFov = camera.fov;
    this._area = null;
  }

  get current() {
    return this.active?.shot ?? null;
  }

  get shots() {
    return this.strategies.fixed.shots;
  }

  setMode(mode) {
    if (mode !== "auto" && !this.strategies[mode]) return;
    this.mode = mode;
  }

  cycleMode() {
    const index = this.order.indexOf(this.mode);
    this.mode = this.order[(index + 1) % this.order.length];
  }

  choose(context) {
    const x = context.position.x;
    const z = context.position.z;

    if (this.mode !== "auto") {
      const manual = this.strategies[this.mode];
      if (manual && manual.covers(x, z)) return manual;
    }

    // Aiming keeps the current gameplay camera on purpose: the over-shoulder
    // combat shot moved the camera, which does not fit the fixed-camera game.
    const area = this.station.areaAt?.(x, z) ?? null;
    if (area === "corridor") return this.strategies.fixed;
    if (area) return this.strategies.room;
    if (this.strategies.room.covers(x, z)) return this.strategies.room;
    if (this.strategies.fixed.covers(x, z)) return this.strategies.fixed;
    return this.strategies.follow;
  }

  update(dt, player, input, extra = {}) {
    this.time += dt;

    if ((input?.consumeCameraMode?.() ?? 0) !== 0) this.cycleMode();

    const context = {
      position: player.root.position,
      yaw: player.root.rotation.y,
      input,
      aiming: Boolean(input?.aiming),
      fear: extra.fear ?? 0,
      elapsed: extra.elapsed ?? this.time,
    };

    const area =
      this.station.areaAt?.(context.position.x, context.position.z) ?? null;
    const areaChanged = this._area !== null && area !== this._area;

    const next = this.choose(context);
    if (next !== this.active) {
      trace(
        "camera",
        `${next?.shot?.id ?? next?.name ?? "?"} area=${area} aim=${context.aiming} blend=${this.blend.toFixed(2)}`,
      );
      if (this.active) {
        this.fromPosition.copy(this.camera.position);
        this.fromQuaternion.copy(this.camera.quaternion);
        this.fromFov = this.camera.fov;
        this.blend = areaChanged ? 1 : 0;
      } else {
        this.blend = 1;
      }
      this.active = next;
      this.active.enter(context);
      this.active.cut = false;
    }
    this._area = area;

    this.active.update(dt, context);

    if (this.active.cut) {
      this.blend = 1;
      this.active.cut = false;
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDuration);
    }
    const t = this.blend >= 1 ? 1 : smoothstep(this.blend);

    if (t >= 1) {
      this.camera.position.copy(this.active.position);
      this.camera.quaternion.copy(this.active.quaternion);
      this.camera.fov = this.active.fov;
    } else {
      this.camera.position.lerpVectors(
        this.fromPosition,
        this.active.position,
        t,
      );
      this.camera.quaternion.slerpQuaternions(
        this.fromQuaternion,
        this.active.quaternion,
        t,
      );
      this.camera.fov = this.fromFov + (this.active.fov - this.fromFov) * t;
    }
    if (this.camera.fov !== this._lastFov) {
      this.camera.updateProjectionMatrix();
      this._lastFov = this.camera.fov;
    }
    this.camera.updateMatrixWorld();
  }

  snapTo(player) {
    const context = {
      position: player.root.position,
      yaw: player.root.rotation.y,
      input: null,
      aiming: false,
      fear: 0,
      elapsed: this.time,
    };
    this.active = this.choose(context);
    this._area =
      this.station.areaAt?.(context.position.x, context.position.z) ?? null;
    this.active.enter(context);
    this.active.cut = false;
    this.active.update(1 / 60, context);
    this.active.cut = false;
    this.blend = 1;
    this.camera.position.copy(this.active.position);
    this.camera.quaternion.copy(this.active.quaternion);
    this.camera.fov = this.active.fov;
    this._lastFov = this.camera.fov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Kept for the game loop and the shooting system; the camera is static now. */
  setTension() {}

  kick() {}

  validate() {
    return this.strategies.fixed.validate();
  }
}
