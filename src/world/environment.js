import * as THREE from "three";
import { TAU } from "./math.js";

/** Night sky, cold moon and the three lights the station is read by. */

export function createSky() {
  const geometry = new THREE.SphereGeometry(240, 32, 20);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x010205) },
      midColor: { value: new THREE.Color(0x04060c) },
      lowColor: { value: new THREE.Color(0x0a0e15) },
      sunColor: { value: new THREE.Color(0x5d7396) },
      sunDirection: { value: new THREE.Vector3(-0.42, 0.13, -0.88).normalize() },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(worldPosition.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 lowColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform float time;
      varying vec3 vWorldDirection;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
      }

      void main() {
        vec3 dir = normalize(vWorldDirection);
        float height = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);

        vec3 color = mix(lowColor, midColor, smoothstep(0.46, 0.6, height));
        color = mix(color, topColor, smoothstep(0.58, 0.95, height));

        // A cold, wide halo around the moon. No sun, no warmth.
        float facing = max(dot(dir, normalize(sunDirection)), 0.0);
        color += sunColor * pow(facing, 24.0) * 0.18;
        color += sunColor * pow(facing, 4.0) * 0.035;

        // Sparse stars, only above the fog line, twinkling very slowly.
        vec3 p = dir * 320.0;
        vec3 id = floor(p);
        vec3 offset = fract(p) - 0.5;
        float star = hash(id);
        float twinkle = 0.65 + 0.35 * sin(time * 1.7 + star * 40.0);
        float dot_ = smoothstep(0.34, 0.02, length(offset));
        float visible = step(0.9955, star) * smoothstep(0.53, 0.72, height);
        color += vec3(0.6, 0.65, 0.75) * dot_ * visible * twinkle * 0.9;

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const sky = new THREE.Mesh(geometry, material);
  sky.name = "sky";
  sky.frustumCulled = false;
  return sky;
}

export function createLights(scene) {
  // Almost no ambient: the sky gives a faint blue wash, the ground swallows it.
  const hemisphere = new THREE.HemisphereLight(0x33435f, 0x030407, 1.3);
  hemisphere.name = "hemi";
  scene.add(hemisphere);

  // The moon. Cold, low and weak, but it still throws long hard shadows —
  // those shadows are most of the scare budget.
  const sun = new THREE.DirectionalLight(0xa8bce0, 1.65);
  sun.name = "sun";
  sun.position.set(-22, 30, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(768, 768);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0016;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);
  scene.add(sun.target);

  // A cold fill from the opposite side so silhouettes stay readable.
  const fill = new THREE.DirectionalLight(0x5c6f95, 0.28);
  fill.position.set(14, 13, 24);
  scene.add(fill);
  scene.add(fill.target);

  // Sickly red bounce from below, as if something is down there.
  const under = new THREE.DirectionalLight(0x8d1030, 0.18);
  under.position.set(0, -18, 6);
  scene.add(under);

  return { hemisphere, sun, fill, under };
}

export function createMoon() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(228, 236, 250, 0.95)");
  gradient.addColorStop(0.11, "rgba(186, 200, 226, 0.55)");
  gradient.addColorStop(0.34, "rgba(126, 148, 188, 0.14)");
  gradient.addColorStop(1, "rgba(70, 92, 132, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  // Take a bite out of it. A moon with a missing piece reads as "wrong"
  // before the player can say why.
  context.globalCompositeOperation = "destination-out";
  context.beginPath();
  context.arc(size * 0.56, size * 0.4, size * 0.19, 0, TAU);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  sprite.name = "moon-disc";
  sprite.scale.setScalar(28);
  sprite.position
    .set(-0.42, 0.13, -0.88)
    .normalize()
    .multiplyScalar(180);
  return sprite;
}
