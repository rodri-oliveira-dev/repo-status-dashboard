import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type {
  BuildStatus,
  DeliveryStatus,
  HealthStatus,
} from '../../models/repository-status.model';

type BadgeStatus = BuildStatus | DeliveryStatus | HealthStatus;

@Component({
  selector: 'app-status-badge',
  template: `<span class="badge" [class]="'badge ' + tone()"
    ><span class="dot" aria-hidden="true"></span>{{ label() }}</span
  >`,
  styleUrl: './status-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadgeComponent {
  readonly status = input.required<BadgeStatus>();
  readonly label = computed(() => this.status().charAt(0).toUpperCase() + this.status().slice(1));
  readonly tone = computed(() => {
    const status = this.status();
    if (status === 'healthy' || status === 'passing' || status === 'success') return 'success';
    if (status === 'failed' || status === 'failing' || status === 'failure') return 'danger';
    if (status === 'warning' || status === 'running' || status === 'queued') return 'warning';
    return 'neutral';
  });
}
