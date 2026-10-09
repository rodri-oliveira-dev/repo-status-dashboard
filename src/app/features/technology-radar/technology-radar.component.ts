import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TechnologyRadarService } from '../../core/services/technology-radar.service';
import { SummaryCardComponent } from '../../shared/components/summary-card/summary-card.component';
import type {
  LifecyclePhase,
  MigrationUrgency,
  TechnologyCategory,
  TechnologyInventoryRow,
} from '../../shared/models/technology-radar.model';
import { FullDatePipe } from '../../shared/pipes/full-date.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import {
  buildTechnologyInventory,
  filterTechnologyInventory,
  migrationWatch,
  technologyRadarMetrics,
} from '../../shared/utils/technology-radar';

@Component({
  selector: 'app-technology-radar',
  imports: [
    FormsModule,
    RouterLink,
    SummaryCardComponent,
    DatePipe,
    FullDatePipe,
    RelativeDatePipe,
  ],
  templateUrl: './technology-radar.component.html',
  styleUrl: './technology-radar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TechnologyRadarComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  protected readonly store = inject(TechnologyRadarService);
  protected readonly categories: readonly (TechnologyCategory | 'all')[] = [
    'all',
    'runtime',
    'framework',
    'tool',
    'language',
    'infrastructure',
  ];
  protected readonly lifecycles: readonly (LifecyclePhase | 'all')[] = [
    'all',
    'active',
    'maintenance',
    'end-of-life',
    'unknown',
  ];
  protected readonly urgencies: readonly (MigrationUrgency | 'all')[] = [
    'all',
    'migration-required',
    'migration-approaching',
    'monitor',
    'no-immediate-action',
    'unknown',
  ];
  protected readonly query = signal('');
  protected readonly category = signal<TechnologyCategory | 'all'>('all');
  protected readonly lifecycle = signal<LifecyclePhase | 'all'>('all');
  protected readonly urgency = signal<MigrationUrgency | 'all'>('all');
  protected readonly sort = signal<'technology' | 'eol' | 'repositories'>('technology');
  protected readonly direction = signal<'asc' | 'desc'>('asc');
  protected readonly selectedKey = signal<string | null>(null);
  protected readonly rows = computed(() => buildTechnologyInventory(this.store.snapshot()));
  protected readonly metrics = computed(() => technologyRadarMetrics(this.store.snapshot()));
  protected readonly staleRows = computed(
    () => this.rows().filter((row) => row.lifecycle.stale).length,
  );
  protected readonly filteredRows = computed(() =>
    filterTechnologyInventory(this.rows(), {
      query: this.query(),
      category: this.category(),
      lifecycle: this.lifecycle(),
      urgency: this.urgency(),
      sort: this.sort(),
      direction: this.direction(),
    }),
  );
  protected readonly selected = computed(
    () => this.rows().find((row) => row.key === this.selectedKey()) ?? null,
  );
  protected readonly watch = computed(() => migrationWatch(this.rows()));
  protected readonly calendar = computed(() =>
    this.rows()
      .filter((row) => row.lifecycle.eol)
      .sort((left, right) => Date.parse(left.lifecycle.eol!) - Date.parse(right.lifecycle.eol!)),
  );

  ngOnInit(): void {
    const technology = this.route.snapshot.queryParamMap.get('technology');
    if (technology) this.query.set(technology);
    void this.store.load();
  }

  protected select(row: TechnologyInventoryRow): void {
    this.selectedKey.set(row.key);
  }

  protected sortBy(column: 'technology' | 'eol' | 'repositories'): void {
    if (this.sort() === column)
      this.direction.update((value) => (value === 'asc' ? 'desc' : 'asc'));
    else {
      this.sort.set(column);
      this.direction.set(column === 'repositories' ? 'desc' : 'asc');
    }
  }

  protected sortLabel(column: 'technology' | 'eol' | 'repositories'): string {
    return this.sort() === column ? (this.direction() === 'asc' ? '▲' : '▼') : '';
  }

  protected label(value: string): string {
    if (value === 'not-applicable') return 'N/A';
    return value
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  protected remaining(days: number | null): string {
    if (days === null) return 'Unknown';
    if (days < 0) return `${Math.abs(days)} days ago`;
    if (days === 0) return 'Today';
    return `${days} days`;
  }
}
