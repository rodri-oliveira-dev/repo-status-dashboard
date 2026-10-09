import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RepositoryStatusService } from '../../core/services/repository-status.service';
import { TechnologyRadarService } from '../../core/services/technology-radar.service';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';
import { FullDatePipe } from '../../shared/pipes/full-date.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import type { HealthReasonCode } from '../../shared/models/repository-status.model';

const REASON_LABELS: Record<HealthReasonCode, string> = {
  REPOSITORY_ARCHIVED: 'Repository is archived.',
  CI_FAILING: 'Primary CI is failing.',
  DELIVERY_FAILING: 'Latest delivery failed.',
  ACTIVITY_STALE: 'No significant activity in the last 90 days.',
  CI_RUNNING: 'Primary CI is currently running.',
  CI_QUEUED: 'Primary CI is queued.',
  CI_CANCELLED: 'Latest primary CI run was cancelled.',
  CI_UNKNOWN: 'No primary CI result could be determined.',
  DELIVERY_IN_PROGRESS: 'Delivery is pending or in progress.',
  NO_DELIVERY_EVIDENCE: 'No delivery evidence was found.',
  COLLECTION_PARTIAL: 'Some optional signals could not be collected.',
  COLLECTION_UNAVAILABLE: 'Repository signals are unavailable.',
};

@Component({
  selector: 'app-repository-details',
  imports: [RouterLink, StatusBadgeComponent, FullDatePipe, RelativeDatePipe],
  templateUrl: './repository-details.component.html',
  styleUrl: './repository-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryDetailsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  protected readonly store = inject(RepositoryStatusService);
  protected readonly technologyStore = inject(TechnologyRadarService);
  protected readonly repository = computed(() =>
    this.store.findByName(this.route.snapshot.paramMap.get('name') ?? ''),
  );
  protected readonly technologyStack = computed(() =>
    this.technologyStore.findByRepository(this.route.snapshot.paramMap.get('name') ?? ''),
  );

  ngOnInit(): void {
    void this.store.load();
    void this.technologyStore.load();
  }

  protected reasonLabel(code: HealthReasonCode): string {
    return REASON_LABELS[code];
  }

  protected signalLabel(status: string): string {
    return status.replaceAll('_', ' ');
  }

  protected technologyLabel(value: string): string {
    if (value === 'not-applicable') return 'N/A';
    return value.replaceAll('-', ' ');
  }
}
