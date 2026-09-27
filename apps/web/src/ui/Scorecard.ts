function formatToPar(value: number): string {
  return value === 0 ? 'E' : value > 0 ? `+${value}` : `${value}`;
}

export class Scorecard {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, onContinue: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'modal';
    this.root.innerHTML = '<div class="panel"><h2>Scorecard</h2><div class="scores"></div><button class="button primary">Continue</button></div>';
    this.root.querySelector('button')?.addEventListener('click', onContinue);
    this.root.style.display = 'none';
    parent.append(this.root);
  }

  show(strokes: number[], pars: number[]): void {
    const scores = this.root.querySelector('.scores');
    if (scores) {
      const total = strokes.reduce((a, b) => a + b, 0);
      const parTotal = pars.reduce((a, b) => a + b, 0);
      const cells = (values: Array<number | string>) => values.map((value) => `<td>${value}</td>`).join('');
      scores.innerHTML = `<table><thead><tr><th>Hole</th>${cells(strokes.map((_, index) => index + 1))}<th>Total</th></tr></thead><tbody><tr><th>Par</th>${cells(pars)}<td>${parTotal}</td></tr><tr><th>Score</th>${cells(strokes)}<td><strong>${total}</strong></td></tr><tr><th>±</th>${cells(strokes.map((score, index) => formatToPar(score - (pars[index] ?? 0))))}<td><strong>${formatToPar(total - parTotal)}</strong></td></tr></tbody></table>`;
    }
    this.root.style.display = 'grid';
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
