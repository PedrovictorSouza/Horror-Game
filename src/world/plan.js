/**
 * Plan: the walkable grid for the hand-modelled areas.
 *
 * It is only data for navigation (BFS, collision clamp, camera validation);
 * it no longer knows how the floor or the walls look.
 */
const CELL = 1;
const EXTENT = 32;

export function insideArea(area, x, z) {
  const corners = area.corners;
  if (!corners || corners.length < 3) {
    return (
      Math.abs(x - area.x) <= area.w / 2 &&
      Math.abs(z - area.z) <= area.d / 2
    );
  }
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

export function createPlanFromAreas(areas, portals = []) {
  const cols = Math.round((EXTENT * 2) / CELL);
  const rows = cols;
  const originX = -EXTENT;
  const originZ = -EXTENT;
  const walk = new Uint8Array(cols * rows);

  const cellX = (i) => originX + (i + 0.5) * CELL;
  const cellZ = (j) => originZ + (j + 0.5) * CELL;
  const indexAt = (i, j) => j * cols + i;
  const inside = (i, j) => i >= 0 && i < cols && j >= 0 && j < rows;

  const list = Object.values(areas);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = cellX(i);
      const z = cellZ(j);
      for (const area of list) {
        if (insideArea(area, x, z)) {
          walk[indexAt(i, j)] = 1;
          break;
        }
      }
      if (!walk[indexAt(i, j)] && portals.some((p) => insidePortal(p, x, z))) {
        walk[indexAt(i, j)] = 1;
      }
    }
  }

  const walkableCells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (walk[i + j * cols]) walkableCells.push({ x: cellX(i), z: cellZ(j) });
    }
  }

  return {
    cols,
    rows,
    cell: CELL,
    extent: EXTENT,
    originX,
    originZ,
    walk,
    cellX,
    cellZ,
    indexAt,
    inside,
    walkableCells,
  };
}
