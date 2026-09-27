export class StatsOverlay {
  readonly root: HTMLDivElement;
  private frames = 0;
  private accumulatedMs = 0;
  private fps = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'debug-stats';
    this.root.style.display = 'none';
    parent.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  update(drawCalls: number, triangles: number, frameMs: number): void {
    if (this.root.style.display === 'none') return;
    this.frames += 1;
    this.accumulatedMs += frameMs;
    if (this.accumulatedMs >= 500) {
      this.fps = (this.frames * 1000) / this.accumulatedMs;
      this.frames = 0;
      this.accumulatedMs = 0;
    }
    this.root.textContent = `${this.fps.toFixed(0)} fps\ndraw calls ${drawCalls}\ntriangles ${(triangles / 1e6).toFixed(2)} M`;
  }
}
