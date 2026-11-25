import * as THREE from "three";

/** Floor builder: reads only its config, never the walk grid. */

export function createFloor(config) {
  const {
    width,
    depth,
    height = 0,
    thickness = 0.45,
    color = 0x3d4a58,
    panel = 0x71839a,
    panelSize = 1,
  } = config;

  const texture = createPanelTexture(color, panel);
  texture.repeat.set(width / panelSize, depth / panelSize);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(width, thickness, depth),
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.82,
      metalness: 0.22,
    }),
  );
  floor.name = "station-floor";
  floor.position.y = height - thickness / 2;
  floor.receiveShadow = true;
  return floor;
}

/** One panel tile: dark base, lighter seam, repeated once per world unit. */
function createPanelTexture(color, panel) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const hex = (value) => `#${value.toString(16).padStart(6, "0")}`;
  context.fillStyle = hex(color);
  context.fillRect(0, 0, size, size);
  context.strokeStyle = hex(panel);
  context.lineWidth = 4;
  context.strokeRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
