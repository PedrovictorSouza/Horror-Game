import * as THREE from "three";

/**
 * Base of every camera strategy. A strategy only computes a pose
 * (position, quaternion, fov) and the shot it is showing; the manager decides
 * when it is active and when to blend or cut.
 */
export class CameraStrategy {
  constructor(name) {
    this.name = name;
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.fov = 50;
    this.shot = null;
    // Set by a strategy when its own shot changes: the manager cuts instead of
    // blending (the classic fixed-camera cut).
    this.cut = false;
    this._matrix = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  enter() {}
  exit() {}
  update() {}
  snap(context) {
    this.enter(context);
    this.update(1 / 60, context);
  }
  covers() {
    return false;
  }
  validate() {
    return [];
  }

  setPose(position, target, fov) {
    this.position.copy(position);
    this._matrix.lookAt(this.position, target, this._up);
    this.quaternion.setFromRotationMatrix(this._matrix);
    this.fov = fov;
  }
}
