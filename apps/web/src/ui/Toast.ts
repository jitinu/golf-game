export class Toast {
  readonly root: HTMLDivElement;
  private timer = 0;
  constructor(parent: HTMLElement) { this.root = document.createElement('div'); this.root.className = 'toast'; parent.append(this.root); }
  show(message: string, duration = 1500): void { this.root.textContent = message; this.root.style.display = 'block'; window.clearTimeout(this.timer); this.timer = window.setTimeout(() => { this.root.style.display = 'none'; }, duration); }
}
