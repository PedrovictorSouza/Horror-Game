import * as THREE from "three";

/**
 * A pre-rendered backdrop for one fixed camera, the 90s adventure way: the
 * room is a flat image and only the characters are 3D. The plane is pinned in
 * front of the camera, at a distance behind the characters, and sized to fill
 * the frame. The image is fitted with `cover` so it never letterboxes the CRT.
 */
const DISTANCE = 26;

export function createBackdrop(scene, url) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = "backdrop";
  mesh.visible = false;
  mesh.renderOrder = -1;
  scene.add(mesh);

  const texture = new THREE.TextureLoader().load(url, (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    loaded.anisotropy = 4;
    material.map = loaded;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  });

  // The station lights are hidden with the station, so the characters need
  // their own key light to sit on the image.
  const light = new THREE.PointLight(0xbfe0ff, 12, 24, 2);
  light.position.set(0, 3.2, 0);
  light.visible = false;
  scene.add(light);

  // Contact shadow: the floor is baked into the image, so the character needs
  // a 3D blob at its feet to keep from floating.
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.55)");
  gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.25)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const shadowTexture = new THREE.CanvasTexture(canvas);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 0.6),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  blob.visible = false;
  scene.add(blob);

  const forward = new THREE.Vector3();

  return {
    setActive(active) {
      mesh.visible = active;
      light.visible = active;
      blob.visible = active;
    },
    update(camera, aspect, target) {
      if (target) blob.position.set(target.x, 0.03, target.z);
      camera.getWorldDirection(forward);
      mesh.position.copy(camera.position).addScaledVector(forward, DISTANCE);
      mesh.quaternion.copy(camera.quaternion);

      const height =
        2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const width = height * aspect;
      mesh.scale.set(width, height, 1);

      const image = texture.image;
      if (image && image.width && image.height) {
        const imageAspect = image.width / image.height;
        if (imageAspect > aspect) {
          const ratio = aspect / imageAspect;
          texture.repeat.set(ratio, 1);
          texture.offset.set((1 - ratio) / 2, 0);
        } else {
          const ratio = imageAspect / aspect;
          texture.repeat.set(1, ratio);
          texture.offset.set(0, (1 - ratio) / 2);
        }
      }
    },
  };
}
