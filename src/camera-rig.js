import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;

/** Orbit + pan + zoom rig tuned for a top-down game camera. */
export class TopDownRig {
  constructor(camera, dom, options = {}) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 6, 0);
    this.goalTarget = this.target.clone();
    this.radius = options.radius ?? 150;
    this.goalRadius = this.radius;
    this.yaw = Math.PI * 0.22;
    this.goalYaw = this.yaw;
    this.pitch = THREE.MathUtils.degToRad(options.pitch ?? 62);
    this.goalPitch = this.pitch;
    this.minRadius = 26;
    this.maxRadius = 460;
    this.minPitch = THREE.MathUtils.degToRad(8);
    this.maxPitch = THREE.MathUtils.degToRad(89.5);
    this.keys = new Set();
    this.drag = null;
    this.enabled = true;

    const pos = new THREE.Vector3();
    this.onPointerDown = (e) => {
      dom.setPointerCapture?.(e.pointerId);
      this.drag = { mode: e.button === 2 || e.shiftKey ? 'pan' : 'orbit', x: e.clientX, y: e.clientY, id: e.pointerId };
      dom.style.cursor = this.drag.mode === 'pan' ? 'grabbing' : 'crosshair';
    };
    this.onPointerMove = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.mode === 'orbit') {
        this.goalYaw -= dx * 0.005;
        this.goalPitch = clamp(this.goalPitch + dy * 0.004, this.minPitch, this.maxPitch);
      } else {
        this.pan(dx, dy);
      }
    };
    this.onPointerUp = (e) => {
      this.drag = null;
      dom.style.cursor = 'grab';
      dom.releasePointerCapture?.(e.pointerId);
      void e;
    };
    this.onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0011);
      this.goalRadius = clamp(this.goalRadius * factor, this.minRadius, this.maxRadius);
    };
    this.onContext = (e) => e.preventDefault();
    this.onKeyDown = (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);

    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    dom.style.cursor = 'grab';
    void pos;
  }

  pan(dx, dy) {
    const k = this.radius * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.goalTarget.addScaledVector(right, -dx * k);
    this.goalTarget.addScaledVector(forward, -dy * k);
    this.clampTarget();
  }

  clampTarget() {
    this.goalTarget.x = clamp(this.goalTarget.x, -280, 280);
    this.goalTarget.z = clamp(this.goalTarget.z, -280, 280);
    this.goalTarget.y = clamp(this.goalTarget.y, 0, 60);
  }

  focus(point, radius = null) {
    this.goalTarget.copy(point);
    this.clampTarget();
    if (radius !== null) this.goalRadius = clamp(radius, this.minRadius, this.maxRadius);
  }

  setPitch(deg) {
    this.goalPitch = clamp(THREE.MathUtils.degToRad(deg), this.minPitch, this.maxPitch);
  }

  setZoom(radius) {
    this.goalRadius = clamp(radius, this.minRadius, this.maxRadius);
  }

  update(dt) {
    const speed = this.enabled ? 1 : 0;
    const k = 1 - Math.exp(-9 * dt);
    const move = new THREE.Vector3();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) move.z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) move.z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) move.x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) move.x += 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(this.radius * 0.6 * dt * speed);
      move.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.goalTarget.add(move);
      this.clampTarget();
    }
    if (this.keys.has('KeyQ')) this.goalYaw += dt * 1.1 * speed;
    if (this.keys.has('KeyE')) this.goalYaw -= dt * 1.1 * speed;
    if (this.keys.has('Equal') || this.keys.has('NumpadAdd')) this.goalRadius = clamp(this.goalRadius * (1 - dt * 0.9), this.minRadius, this.maxRadius);
    if (this.keys.has('Minus') || this.keys.has('NumpadSubtract')) this.goalRadius = clamp(this.goalRadius * (1 + dt * 0.9), this.minRadius, this.maxRadius);

    this.target.lerp(this.goalTarget, k);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.radius += (this.goalRadius - this.radius) * k;

    const cosP = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cosP * this.radius,
      this.target.y + Math.sin(this.pitch) * this.radius,
      this.target.z + Math.cos(this.yaw) * cosP * this.radius,
    );
    this.camera.lookAt(this.target);
    return { pitchDeg: THREE.MathUtils.radToDeg(this.pitch), radius: this.radius, yaw: this.yaw };
  }

  dispose() {
    const dom = this.dom;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointercancel', this.onPointerUp);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
