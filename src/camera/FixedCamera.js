import * as THREE from "three";
import { CameraStrategy } from "./CameraStrategy.js";
import { buildFixedShots } from "./shots.js";

/**
 * Classic survival-horror direction: a table of framed shots with trigger
 * zones. Walking out of the current zone hard-cuts to the next shot; the
 * arrows cycle the shots of the current group.
 */
export class FixedCamera extends CameraStrategy {
  constructor(station) {
    super("fixed");
    this.station = station;
    this.shots = buildFixedShots(station.layout);
    this.active = null;
    this.manual = null;
    this._position = new THREE.Vector3();
    this._target = new THREE.Vector3();
  }

  enter(context) {
    this.manual = null;
    this.active = this.choose(context.position.x, context.position.z);
    this.cut = true;
    this.sync();
  }

  update(dt, context) {
    const step = context.input?.consumeCameraStep?.() ?? 0;
    for (let i = 0; i < Math.abs(step); i++) this.cycle(Math.sign(step));

    const next = this.choose(context.position.x, context.position.z);
    if (next !== this.active) {
      this.active = next;
      this.cut = true;
    }
    this.sync();
  }

  choose(x, z) {
    const area = this.station.areaAt?.(x, z) ?? null;
    if (area === "corridor") {
      const group = this.shots.filter((shot) => shot.group === "corridor");
      return (
        group.find((shot) => shot.zone(x, z)) ??
        (z < 14 ? group[0] : group[1]) ??
        group[0] ??
        null
      );
    }
    if (this.manual) {
      const stillInGroup = this.shots.some(
        (shot) => shot.group === this.manual.group && shot.zone(x, z),
      );
      if (stillInGroup) return this.manual;
      this.manual = null;
    }
    if (this.active && this.active.zone(x, z)) return this.active;

    let best = null;
    for (const shot of this.shots) {
      if (!shot.zone(x, z)) continue;
      if (!best || shot.priority > best.priority) best = shot;
    }
    if (best) return best;

    // No zone claims this point: fall back to the closest framing.
    let bestDistance = Infinity;
    for (const shot of this.shots) {
      const dx = shot.anchor[0] - x;
      const dz = shot.anchor[1] - z;
      const d = dx * dx + dz * dz;
      if (d < bestDistance) {
        bestDistance = d;
        best = shot;
      }
    }
    return best;
  }

  cycle(step) {
    if (!this.active) return;
    const group = this.shots.filter((shot) => shot.group === this.active.group);
    if (group.length < 2) return;
    const index = group.indexOf(this.active);
    const next =
      group[(index + (step > 0 ? 1 : group.length - 1)) % group.length];
    this.manual = next;
    this.active = next;
    this.cut = true;
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
    this.manual = null;
    this.active = this.choose(context.position.x, context.position.z);
    this.cut = true;
    this.sync();
  }

  covers(x, z) {
    return this.station.areaAt?.(x, z) === "corridor";
  }

  /**
   * Every 3D fixed shot must see its own zone. The hall is a pre-rendered
   * backdrop, so wall occlusion does not apply there.
   */
  validate() {
    const cells = this.station.walkableCells;
    return this.shots.map((shot) => {
      if (shot.backdrop) return { id: shot.id, cells: 0, visibility: 1 };
      const inside = cells.filter((cell) => shot.zone(cell.x, cell.z));
      const stride = Math.max(1, Math.floor(inside.length / 36));
      let visible = 0;
      let samples = 0;
      for (let i = 0; i < inside.length; i += stride) {
        const cell = inside[i];
        samples += 1;
        if (
          !this.station.blocked3D(
            shot.position[0],
            shot.position[1],
            shot.position[2],
            cell.x,
            1.2,
            cell.z,
          )
        ) {
          visible += 1;
        }
      }
      return {
        id: shot.id,
        cells: inside.length,
        visibility: samples ? visible / samples : 0,
      };
    });
  }
}
