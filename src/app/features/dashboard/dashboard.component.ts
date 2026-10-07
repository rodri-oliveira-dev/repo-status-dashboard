import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RepositoryStatusService } from '../../core/services/repository-status.service';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';
import { SummaryCardComponent } from '../../shared/components/summary-card/summary-card.component';
import {
  DELIVERY_TYPES,
  HEALTH_STATUSES,
  PROJECT_TYPES,
  type HealthStatus,
  type RepositoryStatus,
} from '../../shared/models/repository-status.model';
import { FullDatePipe } from '../../shared/pipes/full-date.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { filterRepositories } from '../../shared/utils/repository-filter';
import { rankNeedsAttention } from '../../shared/utils/needs-attention';
import { calculatePortfolioInsights } from '../../shared/utils/portfolio-insights';
import { NeedsAttentionComponent } from './needs-attention.component';
import { PortfolioInsightsComponent } from './portfolio-insights.component';

type SortColumn = 'repository' | 'updated' | 'health';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-dashboard',
  imports: [
    FormsModule,
    RouterLink,
    StatusBadgeComponent,
    SummaryCardComponent,
    RelativeDatePipe,
    FullDatePipe,
    NeedsAttentionComponent,
    PortfolioInsightsComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {
  protected readonly store = inject(RepositoryStatusService);
  protected readonly healthStatuses = HEALTH_STATUSES.filter((status) => status !== 'archived');
  protected readonly projectTypes = PROJECT_TYPES;
  protected readonly deliveryTypes = DELIVERY_TYPES;

  protected readonly query = signal('');
  protected readonly healthFilter = signal<HealthStatus | 'all'>('all');
  protected readonly typeFilter = signal('all');
  protected readonly technologyFilter = signal('all');
  protected readonly deliveryFilter = signal('all');
  protected readonly sortColumn = signal<SortColumn>('updated');
  protected readonly sortDirection = signal<SortDirection>('desc');

  protected readonly stats = computed(() => {
    const repositories = this.store.repositories();
    const count = (health: HealthStatus) =>
      repositories.filter((repository) => repository.health === health).length;
    return {
      total: repositories.length,
      healthy: count('healthy'),
      warning: count('warning'),
      failed: count('failed'),
      stale: count('stale'),
    };
  });
  protected readonly attentionItems = computed(() => rankNeedsAttention(this.store.repositories()));
  protected readonly portfolioInsights = computed(() =>
    calculatePortfolioInsights(
      this.store.repositories(),
      this.store.dataset()?.generatedAt ?? '1970-01-01T00:00:00Z',
    ),
  );

  protected readonly technologies = computed(() =>
    [
      ...new Set(
        this.store
          .repositories()
          .map((repository) => repository.language)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort(),
  );

  protected readonly filteredRepositories = computed(() => {
    const healthRank: Record<HealthStatus, number> = {
      failed: 0,
      warning: 1,
      stale: 2,
      unknown: 3,
      healthy: 4,
      archived: 5,
    };
    const filtered = filterRepositories(this.store.repositories(), {
      query: this.query(),
      health: this.healthFilter(),
      type: this.typeFilter(),
      technology: this.technologyFilter(),
      delivery: this.deliveryFilter(),
      showArchived: false,
    });
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    return [...filtered].sort((left, right) => {
      let result: number;
      switch (this.sortColumn()) {
        case 'repository':
          result = left.name.localeCompare(right.name);
          break;
        case 'health':
          result = healthRank[left.health] - healthRank[right.health];
          break;
        case 'updated':
          result =
            Date.parse(left.lastCommitDate ?? left.updatedAt) -
            Date.parse(right.lastCommitDate ?? right.updatedAt);
          break;
      }
      return result * direction;
    });
  });

  ngOnInit(): void {
    void this.store.load();
  }

  protected setHealthFilter(status: HealthStatus | 'all'): void {
    this.healthFilter.set(status);
  }

  protected sortBy(column: SortColumn): void {
    if (this.sortColumn() === column)
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortColumn.set(column);
      this.sortDirection.set(column === 'repository' ? 'asc' : 'desc');
    }
  }

  protected sortLabel(column: SortColumn): string {
    return this.sortColumn() === column ? (this.sortDirection() === 'asc' ? '▲' : '▼') : '';
  }

  protected trackRepository(_: number, repository: RepositoryStatus): string {
    return repository.fullName;
  }
}
