import { clamp } from "./math.js";
import { trace } from "../ui/trace.js";

/**
 * Navigation: collision, line of sight and pathfinding. Depends on the plan and
 * on the wall boxes, and exposes an API only (no meshes, no scene).
 */

function inPolygon(x, z, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i].x;
    const zi = corners[i].z;
    const xj = corners[j].x;
    const zj = corners[j].z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function insidePortal(portal, x, z) {
  return (
    Math.abs(x - portal.x) <= portal.w / 2 &&
    Math.abs(z - portal.z) <= portal.d / 2
  );
}

export function createNavigation(
  plan,
  wallBoxes,
  wallHeight,
  areas = {},
  portals = [],
) {
  const { cols, rows, cell, extent, originX, originZ, walk, cellX, cellZ, indexAt, inside } = plan;
  const boxes = wallBoxes;
  const wallBottom = -0.5;

  // The first deck is flat at y = 0.
  const heightAt = () => 0;

  const nearestWalkable = (i, j) => {
    if (inside(i, j) && walk[indexAt(i, j)]) return { i, j };
    for (let r = 1; r <= 4; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (inside(ni, nj) && walk[indexAt(ni, nj)]) return { i: ni, j: nj };
        }
      }
    }
    return { i, j };
  };

  const cellAt = (x, z) => {
    const i = clamp(Math.floor((x - originX) / cell), 0, cols - 1);
    const j = clamp(Math.floor((z - originZ) / cell), 0, rows - 1);
    return nearestWalkable(i, j);
  };

  function findPath(fromX, fromZ, toX, toZ) {
    const start = cellAt(fromX, fromZ);
    const goal = cellAt(toX, toZ);
    const startIndex = indexAt(start.i, start.j);
    const goalIndex = indexAt(goal.i, goal.j);
    if (startIndex === goalIndex) return [];

    const came = new Int32Array(cols * rows).fill(-1);
    const seen = new Uint8Array(cols * rows);
    const queue = new Int32Array(cols * rows);
    let head = 0;
    let tail = 0;
    seen[startIndex] = 1;
    queue[tail++] = startIndex;

    while (head < tail) {
      const k = queue[head++];
      if (k === goalIndex) break;
      const i = k % cols;
      const j = (k / cols) | 0;
      if (i > 0 && walk[k - 1] && !seen[k - 1]) {
        seen[k - 1] = 1;
        came[k - 1] = k;
        queue[tail++] = k - 1;
      }
      if (i < cols - 1 && walk[k + 1] && !seen[k + 1]) {
        seen[k + 1] = 1;
        came[k + 1] = k;
        queue[tail++] = k + 1;
      }
      if (j > 0 && walk[k - cols] && !seen[k - cols]) {
        seen[k - cols] = 1;
        came[k - cols] = k;
        queue[tail++] = k - cols;
      }
      if (j < rows - 1 && walk[k + cols] && !seen[k + cols]) {
        seen[k + cols] = 1;
        came[k + cols] = k;
        queue[tail++] = k + cols;
      }
    }

    if (!seen[goalIndex]) return [];
    const path = [];
    let k = goalIndex;
    while (k !== startIndex && k !== -1) {
      const i = k % cols;
      const j = (k / cols) | 0;
      path.push({ x: cellX(i), z: cellZ(j) });
      k = came[k];
    }
    path.reverse();
    return path;
  }

  function farthestCell(fromX, fromZ) {
    const start = cellAt(fromX, fromZ);
    const startIndex = indexAt(start.i, start.j);
    const dist = new Int32Array(cols * rows).fill(-1);
    const queue = new Int32Array(cols * rows);
    let head = 0;
    let tail = 0;
    dist[startIndex] = 0;
    queue[tail++] = startIndex;
    let bestIndex = startIndex;
    let bestDistance = 0;

    while (head < tail) {
      const k = queue[head++];
      const d = dist[k];
      if (d > bestDistance) {
        bestDistance = d;
        bestIndex = k;
      }
      const i = k % cols;
      const j = (k / cols) | 0;
      if (i > 0 && walk[k - 1] && dist[k - 1] === -1) {
        dist[k - 1] = d + 1;
        queue[tail++] = k - 1;
      }
      if (i < cols - 1 && walk[k + 1] && dist[k + 1] === -1) {
        dist[k + 1] = d + 1;
        queue[tail++] = k + 1;
      }
      if (j > 0 && walk[k - cols] && dist[k - cols] === -1) {
        dist[k - cols] = d + 1;
        queue[tail++] = k - cols;
      }
      if (j < rows - 1 && walk[k + cols] && dist[k + cols] === -1) {
        dist[k + cols] = d + 1;
        queue[tail++] = k + cols;
      }
    }

    const i = bestIndex % cols;
    const j = (bestIndex / cols) | 0;
    return { x: cellX(i), z: cellZ(j), distance: bestDistance };
  }

  // Keep the player's center inside the union of the editor area polygons.
  // Keep the player's center inside the union of the editor area polygons,
  // inset by its radius. Outside: nearest edge + inward normal. Inside but
  // within the radius of an edge: push inward.
  const DOOR_BRIDGES = [
    { minX: -4.44, maxX: -0.22, minZ: 7, maxZ: 9.6 },
    { minX: -4.44, maxX: -0.22, minZ: 20.4, maxZ: 23.2 },
  ];
  const inDoorBridge = (x, z) =>
    DOOR_BRIDGES.some(
      (b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ,
    );

  function clampToAreas(position, radius) {
    // Inside a door portal the area collision is off: the player crosses.
    if (portals.some((portal) => insidePortal(portal, position.x, position.z))) {
      return;
    }
    const list = Object.values(areas);
    if (!list.length) return;
    let insideAny = false;
    for (const area of list) {
      if (area.corners && inPolygon(position.x, position.z, area.corners)) {
        insideAny = true;
        break;
      }
    }
    if (inDoorBridge(position.x, position.z)) insideAny = true;
    let best = null;
    let bestDist = Infinity;
    for (const area of list) {
      const corners = area.corners;
      if (!corners) continue;
      for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
        const a = corners[j];
        const b = corners[i];
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const len = Math.hypot(ex, ez) || 1;
        const t = clamp(
          ((position.x - a.x) * ex + (position.z - a.z) * ez) /
            (len * len),
          0,
          1,
        );
        const px = a.x + ex * t;
        const pz = a.z + ez * t;
        const dist = Math.hypot(position.x - px, position.z - pz);
        if (dist < bestDist) {
          bestDist = dist;
          // Left normal for the CCW corner order used by the editor.
          best = { x: px, z: pz, nx: -ez / len, nz: ex / len };
        }
      }
    }
    if (!best) return;
    if (!insideAny || bestDist < radius) {
      position.x = best.x + best.nx * radius;
      position.z = best.z + best.nz * radius;
    }
  }

  function resolve(position, radius) {
    if (portals.some((portal) => insidePortal(portal, position.x, position.z))) {
      return;
    }
    const beforeX = position.x;
    const beforeZ = position.z;
    for (let pass = 0; pass < 2; pass++) {
      for (const box of boxes) {
        const closestX = clamp(position.x, box.minX, box.maxX);
        const closestZ = clamp(position.z, box.minZ, box.maxZ);
        const dx = position.x - closestX;
        const dz = position.z - closestZ;
        const distSq = dx * dx + dz * dz;
        if (distSq >= radius * radius) continue;

        if (distSq > 1e-9) {
          const dist = Math.sqrt(distSq);
          const push = (radius - dist) / dist;
          position.x += dx * push;
          position.z += dz * push;
        } else {
          const left = position.x - box.minX;
          const right = box.maxX - position.x;
          const up = position.z - box.minZ;
          const down = box.maxZ - position.z;
          const min = Math.min(left, right, up, down);
          if (min === left) position.x = box.minX - radius;
          else if (min === right) position.x = box.maxX + radius;
          else if (min === up) position.z = box.minZ - radius;
          else position.z = box.maxZ + radius;
        }
      }
    }

    clampToAreas(position, radius);
    if (
      Math.abs(position.x - beforeX) > 1e-4 ||
      Math.abs(position.z - beforeZ) > 1e-4
    ) {
      trace(
        "nav:clamp",
        `(${beforeX.toFixed(2)},${beforeZ.toFixed(2)}) -> (${position.x.toFixed(2)},${position.z.toFixed(2)})`,
      );
    }

    const limit = extent - radius;
    position.x = clamp(position.x, -limit, limit);
    position.z = clamp(position.z, -limit, limit);
  }

  /** True when a wall stands between two 3D points (walls have height). */
  function blocked3D(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    for (const box of boxes) {
      let tmin = 0;
      let tmax = 1;

      if (Math.abs(dx) < 1e-9) {
        if (ax < box.minX || ax > box.maxX) continue;
      } else {
        let t1 = (box.minX - ax) / dx;
        let t2 = (box.maxX - ax) / dx;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dy) < 1e-9) {
        if (ay < wallBottom || ay > wallHeight) continue;
      } else {
        let t1 = (wallBottom - ay) / dy;
        let t2 = (wallHeight - ay) / dy;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dz) < 1e-9) {
        if (az < box.minZ || az > box.maxZ) continue;
      } else {
        let t1 = (box.minZ - az) / dz;
        let t2 = (box.maxZ - az) / dz;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (tmax >= 0 && tmin <= 1) return true;
    }
    return false;
  }

  /** Nearest wall along a 2D segment, as a fraction 0..1 (1 = clear). */
  function rayHit(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    let best = 1;
    for (const box of boxes) {
      let tmin = 0;
      let tmax = 1;

      if (Math.abs(dx) < 1e-9) {
        if (ax < box.minX || ax > box.maxX) continue;
      } else {
        let t1 = (box.minX - ax) / dx;
        let t2 = (box.maxX - ax) / dx;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dz) < 1e-9) {
        if (az < box.minZ || az > box.maxZ) continue;
      } else {
        let t1 = (box.minZ - az) / dz;
        let t2 = (box.maxZ - az) / dz;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (tmax >= 0 && tmin <= 1) best = Math.min(best, Math.max(0, tmin));
    }
    return best;
  }

  function blocked(ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    for (const box of boxes) {
      let tmin = 0;
      let tmax = 1;

      if (Math.abs(dx) < 1e-9) {
        if (ax < box.minX || ax > box.maxX) continue;
      } else {
        let t1 = (box.minX - ax) / dx;
        let t2 = (box.maxX - ax) / dx;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (Math.abs(dz) < 1e-9) {
        if (az < box.minZ || az > box.maxZ) continue;
      } else {
        let t1 = (box.minZ - az) / dz;
        let t2 = (box.maxZ - az) / dz;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }

      if (tmax >= 0 && tmin <= 1) return true;
    }
    return false;
  }

  return { cellAt, findPath, farthestCell, resolve, blocked, blocked3D, rayHit, heightAt };
}
