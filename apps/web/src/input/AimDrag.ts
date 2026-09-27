const YAW_PER_PIXEL = 0.004;
const KEY_YAW_PER_SECOND = 0.9;

/** Horizontal drag on the canvas (or arrow keys) rotates the aim yaw. */
export class AimDrag {
  enabled = true;
  private active = false;
  private lastX = 0;
  private keyDirection = 0;

  constructor(
    element: HTMLElement,
    private readonly onYaw: (delta: number) => void,
  ) {
    element.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      this.active = true;
      this.lastX = event.clientX;
      element.setPointerCapture(event.pointerId);
    });
    element.addEventListener('pointermove', (event) => {
      if (!this.active) return;
      this.onYaw((event.clientX - this.lastX) * YAW_PER_PIXEL);
      this.lastX = event.clientX;
    });
    const stop = () => {
      this.active = false;
    };
    element.addEventListener('pointerup', stop);
    element.addEventListener('pointercancel', stop);
    window.addEventListener('keydown', (event) => {
      if (event.code === 'ArrowLeft') this.keyDirection = -1;
      if (event.code === 'ArrowRight') this.keyDirection = 1;
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') this.keyDirection = 0;
    });
  }

  update(dtSeconds: number): void {
    if (this.enabled && this.keyDirection !== 0) this.onYaw(this.keyDirection * KEY_YAW_PER_SECOND * dtSeconds);
  }
}
