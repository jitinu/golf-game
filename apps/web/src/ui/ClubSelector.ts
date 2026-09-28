import { CLUBS } from '@golf/sim';

const CATEGORIES = ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'] as const;
const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  driver: 'Driver',
  wood: 'Woods',
  hybrid: 'Hybrids',
  iron: 'Irons',
  wedge: 'Wedges',
  putter: 'Putter',
};

export class ClubSelector {
  readonly root: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement, onSelect: (id: string) => void) {
    this.root = document.createElement('div');
    this.root.className = 'panel club-selector';
    const title = document.createElement('strong');
    title.textContent = 'Clubs';
    this.root.append(title);
    CATEGORIES.forEach((category) => {
      const clubs = Object.values(CLUBS).filter((club) => club.category === category);
      if (!clubs.length) return;
      const section = document.createElement('div');
      section.className = 'club-group';
      const categoryLabel = document.createElement('div');
      categoryLabel.className = 'club-category';
      categoryLabel.textContent = CATEGORY_LABELS[category];
      const grid = document.createElement('div');
      grid.className = 'club-grid';
      clubs.forEach((club) => {
        const button = document.createElement('button');
        button.className = 'button club';
        button.innerHTML = `<span class="club-name">${club.displayName}</span><span class="club-carry">${club.maxCarryHintM}<small> m</small></span>`;
        button.title = `${club.displayName} · loft ${club.loftDeg}°`;
        button.onclick = () => {
          onSelect(club.id);
          this.select(club.id);
        };
        this.buttons.set(club.id, button);
        grid.append(button);
      });
      section.append(categoryLabel, grid);
      this.root.append(section);
    });
    parent.append(this.root);
  }

  select(id: string): void {
    this.buttons.forEach((button, key) => button.classList.toggle('active', key === id));
  }

  setEnabled(enabled: boolean): void {
    this.buttons.forEach((button) => {
      button.disabled = !enabled;
    });
  }
}
