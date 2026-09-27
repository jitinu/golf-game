import { validatePlayerName, PLAYER_NAME_MAX } from '@golf/protocol';

export class NameEntry {
  readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLDivElement;
  private readonly submit: HTMLButtonElement;

  constructor(parent: HTMLElement, onSubmit: (name: string) => void) {
    this.root = document.createElement('div');
    this.root.className = 'modal';
    this.root.innerHTML = `<div class="panel"><h2>Save your round</h2><p>Enter a name for the leaderboard (1–${PLAYER_NAME_MAX} characters).</p><form><input maxlength="${PLAYER_NAME_MAX + 4}" placeholder="Your name" autocomplete="off"><div class="error"></div><button type="submit" class="button primary">Submit score</button></form></div>`;
    this.input = this.root.querySelector('input') as HTMLInputElement;
    this.error = this.root.querySelector('.error') as HTMLDivElement;
    this.submit = this.root.querySelector('button') as HTMLButtonElement;
    this.input.addEventListener('input', () => this.validate());
    this.root.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const result = this.validate();
      if (result) onSubmit(result);
    });
    this.root.style.display = 'none';
    parent.append(this.root);
  }

  private validate(): string | undefined {
    const result = validatePlayerName(this.input.value);
    this.error.textContent = result.ok || this.input.value.length === 0 ? '' : result.reason;
    this.submit.disabled = !result.ok;
    return result.ok ? result.name : undefined;
  }

  setError(message: string): void {
    this.error.textContent = message;
  }

  setBusy(busy: boolean): void {
    this.submit.disabled = busy;
    this.submit.textContent = busy ? 'Saving…' : 'Submit score';
  }

  show(): void {
    this.root.style.display = 'grid';
    this.input.value = '';
    this.validate();
    this.input.focus();
  }

  hide(): void {
    this.root.style.display = 'none';
  }
}
