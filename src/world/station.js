import { StationBuilder } from "./stationBuilder.js";
import { AREAS, DOORS, PORTALS, WALL_HEIGHT } from "./layout.js";
import { createPlanFromAreas, insideArea } from "./plan.js";
import { createNavigation } from "./navigation.js";

/**
 * Station assembly. The builder owns the meshes; the plan and the wall boxes
 * feed navigation. The returned object is the API the game consumes.
 */
export function createStation() {
  const builder = new StationBuilder();
  builder.buildFloor().buildWalls().buildDoor().buildLighting();

  const group = builder.getResult();
  const plan = createPlanFromAreas(AREAS, PORTALS);
  const nav = createNavigation(plan, builder.wallBoxes, WALL_HEIGHT, AREAS, PORTALS);

  const areaAt = (x, z) => {
    for (const area of Object.values(AREAS)) {
      if (insideArea(area, x, z)) return area.id;
    }
    return null;
  };

  return {
    group,
    cols: plan.cols,
    rows: plan.rows,
    cell: plan.cell,
    extent: plan.extent,
    cellX: plan.cellX,
    cellZ: plan.cellZ,
    cellAt: nav.cellAt,
    findPath: nav.findPath,
    farthestCell: nav.farthestCell,
    resolve: nav.resolve,
    blocked: nav.blocked,
    blocked3D: nav.blocked3D,
    rayHit: nav.rayHit,
    heightAt: nav.heightAt,
    areaAt,
    areas: AREAS,
    doors: DOORS,
    portals: PORTALS,
    setDoorOpen: (id, open) => {
      builder.setDoorOpen(id, open);
    },
    layout: {
      areas: AREAS,
      wallHeight: WALL_HEIGHT,
    },
    walkableCells: plan.walkableCells,
  };
}
