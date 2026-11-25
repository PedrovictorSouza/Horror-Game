import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * Tube warp, line-sync slip and the RGB mask misalignment.
 *
 * The reference for this look is an SVG filter chain, but a displacement map
 * plus three blurs plus two animated turbulences costs ~50ms per frame at
 * 720×540 (9 fps on an M1). The same geometry is free in a fragment shader, so
 * the tape artifacts that do not need per-pixel geometry (grain, scanlines,
 * tracking band, dropouts) stay in CSS and only the warp lives here.
 */
const CRTShader = {
  name: "CRTShader",
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAmount: { value: 1 },
    uWarp: { value: 0.085 },
    uChroma: { value: 0.0016 },
    uJitter: { value: 0.0011 },
    uAspect: { value: 4 / 3 },
    uHostile: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAmount;
    uniform float uWarp;
    uniform float uChroma;
    uniform float uJitter;
    uniform float uAspect;
    uniform float uHostile;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 center = vUv - 0.5;

      // Aspect-corrected radius so the barrel stays round on a 4:3 tube.
      vec2 p = center * vec2(uAspect, 1.0);
      float r2 = dot(p, p);

      // The further from the centre, the harder the glass pulls the image.
      vec2 uv = vUv + center * r2 * uWarp * uAmount;

      // Line sync: a few horizontal bands slip for a frame, then settle.
      float band = floor(uv.y * 220.0);
      float slip = hash(vec2(band, floor(uTime * 10.0)) + 17.0) - 0.5;
      uv.x += slip * uJitter * uAmount;

      // Chroma: the mask never lines up perfectly, and the edges split worst.
      vec2 edge = normalize(center + vec2(1e-5));
      vec2 split = edge * (uChroma * (0.55 + r2 * 1.8)) * uAmount;

      vec3 color;
      color.r = texture2D(tDiffuse, uv + split).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - split).b;

      // Same-room threat: one flat red filter over the whole signal, no
      // spatial gradient. uHostile only fades it in and out.
      vec3 hostile = vec3(1.0, 0.4, 0.34);
      color.rgb *= mix(vec3(1.0), hostile, uHostile);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

/**
 * Builds the render chain: scene → tube warp → tone mapping / sRGB.
 * `setEnabled(false)` bypasses the warp and renders straight to the canvas,
 * which is the escape hatch for slow machines.
 */
export function createCrt(renderer, scene, camera, width, height, options = {}) {
  const samples = Math.max(0, options.samples ?? 4);
  const targetType = options.type ?? THREE.HalfFloatType;
  // 4× MSAA + HalfFloat is the single most expensive thing in this frame:
  // measured at ~16 ms on software/ANGLE, versus ~7 ms with samples: 0. The
  // tube shader, scanlines and the low 720p signal hide the jaggies well
  // enough, so the default is 0 and `?crtSamples=4` still exists for capable
  // machines that want the extra resolve.
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: targetType,
    samples,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setSize(width, height);

  const pass = new ShaderPass(CRTShader);
  pass.uniforms.uAspect.value = width / height;

  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(pass);
  composer.addPass(new OutputPass());

  let enabled = true;

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(value) {
      enabled = Boolean(value);
    },
    setHostile(value) {
      pass.uniforms.uHostile.value = Math.min(1, Math.max(0, value));
    },
    render(elapsed) {
      if (!enabled) {
        renderer.render(scene, camera);
        return;
      }
      pass.uniforms.uTime.value = elapsed;
      composer.render();
    },
  };
}
