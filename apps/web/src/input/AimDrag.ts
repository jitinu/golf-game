export class AimDrag {
  private active = false;
  private lastX = 0;
  constructor(private readonly element: HTMLElement, private readonly onYaw: (delta: number) => void, private readonly onPitch: (delta: number) => void) {
    element.addEventListener('pointerdown', (event) => { this.active = true; this.lastX = event.clientX; element.setPointerCapture(event.pointerId); });
    element.addEventListener('pointermove', (event) => { if (this.active) { this.onYaw((event.clientX - this.lastX) * 0.004); this.lastX = event.clientX; } });
    element.addEventListener('pointerup', () => { this.active = false; });
    element.addEventListener('wheel', (event) => { event.preventDefault(); this.onPitch(event.deltaY * 0.002); }, { passive: false });
  }
}
