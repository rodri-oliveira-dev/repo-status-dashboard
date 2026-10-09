import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <header class="app-header">
      <a
        class="brand"
        href="https://rodri-oliveira-dev.github.io/"
        title="Rodrigo de Oliveira — personal site"
      >
        <span class="brand-mark" aria-hidden="true">RC</span>
        <span>
          <strong>Repo Control Center</strong>
          <small>GitHub operations overview</small>
        </span>
      </a>
      <nav aria-label="Main navigation">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
          >Repositories</a
        >
        <a routerLink="/technology-radar" routerLinkActive="active">Technology Radar</a>
      </nav>
      <button
        class="theme-toggle"
        type="button"
        (click)="theme.toggle()"
        [attr.aria-label]="theme.theme() === 'dark' ? 'Use light theme' : 'Use dark theme'"
      >
        <span aria-hidden="true">{{ theme.theme() === 'dark' ? '☀' : '◐' }}</span>
        <span class="theme-label">{{ theme.theme() === 'dark' ? 'Light' : 'Dark' }}</span>
      </button>
    </header>
    <main><router-outlet /></main>
    <footer>Generated from GitHub data · Read-only dashboard</footer>
  `,
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  protected readonly theme = inject(ThemeService);
}
