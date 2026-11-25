import * as THREE from "three";
import { createFloor } from "./floor.js";
import {
  AREAS,
  DOORS,
  WALLS,
  WALL_HEIGHT,
  WALL_THICKNESS,
} from "./layout.js";

const FLOOR_COLOR = 0x3d4a58;
const FLOOR_PANEL = 0x71839a;
const STEEL = 0x4b5260;
const CAP = 0x9fe6f2;
const DOOR_METAL = 0x22262e;

/**
 * Station builder. Each step adds one component to the group and returns the
 * builder, so the caller picks the stages:
 *
 *   const room = new StationBuilder()
 *     .buildFloor()
 *     .buildWalls()
 *     .buildDoor()
 *     .buildLighting()
 *     .getResult();
 *
 * The builder also publishes `wallBoxes` (collision) for navigation; it never
 * knows about the player, the enemy or the cameras.
 */
export class StationBuilder {
  constructor(areas = AREAS, wallRuns = WALLS, doors = DOORS) {
    this.areas = areas;
    this.wallRuns = wallRuns;
    this.doors = doors;
    this.group = new THREE.Group();
    this.group.name = "station";
    this.wallBoxes = [];
    this.doorPanels = new Map();
  }

  buildFloor() {
    for (const area of Object.values(this.areas)) {
      const floor = createFloor({
        width: area.w,
        depth: area.d,
        height: 0,
        thickness: 0.45,
        color: FLOOR_COLOR,
        panel: FLOOR_PANEL,
        panelSize: 1,
      });
      floor.name = `floor-${area.id}`;
      floor.position.x = area.x;
      floor.position.z = area.z;
      this.group.add(floor);
    }
    return this;
  }

  buildWalls() {
    const segments = this.wallRuns.map((run) => {
      const alongX = run.axis === "x";
      const length = run.to - run.from;
      return {
        cx: alongX ? (run.from + run.to) / 2 : run.x,
        cz: alongX ? run.z : (run.from + run.to) / 2,
        sx: alongX ? length + WALL_THICKNESS : WALL_THICKNESS,
        sz: alongX ? WALL_THICKNESS : length + WALL_THICKNESS,
        alongX,
      };
    });

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const walls = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: STEEL,
        roughness: 0.74,
        metalness: 0.34,
      }),
      segments.length,
    );
    walls.name = "station-walls";
    walls.castShadow = true;
    walls.receiveShadow = true;

    const caps = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: CAP,
        toneMapped: false,
      }),
      segments.length,
    );
    caps.name = "station-caps";

    const dummy = new THREE.Object3D();
    this.wallBoxes = [];
    segments.forEach((segment, index) => {
      dummy.position.set(segment.cx, (WALL_HEIGHT - 0.5) / 2, segment.cz);
      dummy.scale.set(segment.sx, WALL_HEIGHT + 0.5, segment.sz);
      dummy.updateMatrix();
      walls.setMatrixAt(index, dummy.matrix);
      this.wallBoxes.push({
        minX: segment.cx - segment.sx / 2,
        maxX: segment.cx + segment.sx / 2,
        minZ: segment.cz - segment.sz / 2,
        maxZ: segment.cz + segment.sz / 2,
      });

      dummy.position.set(segment.cx, WALL_HEIGHT + 0.03, segment.cz);
      dummy.scale.set(
        segment.alongX ? segment.sx : 0.2,
        0.07,
        segment.alongX ? 0.2 : segment.sz,
      );
      dummy.updateMatrix();
      caps.setMatrixAt(index, dummy.matrix);
    });
    walls.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;

    this.group.add(walls);
    this.group.add(caps);
    return this;
  }

  buildDoor() {
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: DOOR_METAL,
      roughness: 0.55,
      metalness: 0.55,
    });
    const shutterMaterial = new THREE.MeshStandardMaterial({
      color: 0x2b313b,
      roughness: 0.5,
      metalness: 0.6,
    });
    const lightMaterial = new THREE.MeshBasicMaterial({
      color: 0x9fe6f2,
      toneMapped: false,
    });

    for (const door of this.doors) {
      const group = new THREE.Group();
      group.name = `door-${door.id}`;
      group.position.set(door.x, 0, door.z);

      const half = door.width / 2;
      const headerHeight = WALL_HEIGHT - door.height;

      // Header: closes the wall above the opening.
      const header = new THREE.Mesh(
        new THREE.BoxGeometry(door.width + WALL_THICKNESS, headerHeight, WALL_THICKNESS + 0.06),
        frameMaterial,
      );
      header.position.y = door.height + headerHeight / 2;
      header.castShadow = true;
      group.add(header);

      // Frame posts + lintel.
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.26, door.height, 0.32),
          frameMaterial,
        );
        post.position.set(side * (half + 0.12), door.height / 2, 0);
        post.castShadow = true;
        group.add(post);
      }
      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(door.width + 0.5, 0.16, 0.36),
        frameMaterial,
      );
      lintel.position.y = door.height - 0.08;
      group.add(lintel);

      // The shutter is raised into the header, leaving the doorway open.
      const shutter = new THREE.Mesh(
        new THREE.BoxGeometry(door.width - 0.35, 0.6, 0.14),
        shutterMaterial,
      );
      shutter.position.y = door.height + 0.42;
      group.add(shutter);

      // Full-height leaf, hidden while the doorway is open. The transition
      // shows it behind the Loading screen and hides it on the far side.
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(
          door.width - 0.35,
          door.height - 0.08,
          0.12,
        ),
        shutterMaterial,
      );
      panel.position.y = door.height / 2;
      panel.visible = false;
      group.add(panel);
      this.doorPanels.set(door.id, panel);

      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(door.width - 0.7, 0.05, 0.17),
        lightMaterial,
      );
      strip.position.y = door.height + 0.13;
      group.add(strip);

      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.08, 0.08),
        lightMaterial,
      );
      lamp.position.set(0, door.height - 0.18, WALL_THICKNESS / 2 + 0.04);
      group.add(lamp);

      this.group.add(group);
    }
    return this;
  }

  buildLighting() {
    const panelMaterial = new THREE.MeshBasicMaterial({
      color: 0xd8f4ff,
      toneMapped: false,
    });

    const addPanel = (x, z, w, d) => {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), panelMaterial);
      panel.position.set(x, WALL_HEIGHT - 0.12, z);
      this.group.add(panel);
    };

    addPanel(-3.6, 0, 3.2, 0.7);
    addPanel(3.6, 0, 3.2, 0.7);
    addPanel(-2.33, 11, 0.7, 3);
    addPanel(-2.33, 17, 0.7, 3);
    addPanel(-4.93, 26, 3, 0.7);
    addPanel(0.27, 26, 3, 0.7);

    const addLight = (x, y, z, color, intensity, distance) => {
      const light = new THREE.PointLight(color, intensity, distance, 2);
      light.position.set(x, y, z);
      light.castShadow = false;
      this.group.add(light);
    };

    addLight(0, 3.2, 0, 0xbfe0ff, 18, 18);
    addLight(-2.33, 3.1, 14, 0xa9ccff, 10, 12);
    addLight(-2.33, 3.2, 26, 0xbfe0ff, 14, 16);
    // A red emergency lamp at the far end of the corridor.
    addLight(-2.33, 3.0, 19, 0xff2a3a, 3, 7);

    return this;
  }

  /** Opens/closes a doorway leaf. Game logic; navigation stays static. */
  setDoorOpen(id, open) {
    const panel = this.doorPanels.get(id);
    if (panel) panel.visible = !open;
    return this;
  }

  getResult() {
    return this.group;
  }
}
