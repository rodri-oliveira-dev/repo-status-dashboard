import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { RepositoryStatusService } from '../../core/services/repository-status.service';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';
import { FullDatePipe } from '../../shared/pipes/full-date.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';

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
  protected readonly repository = computed(() =>
    this.store.findByName(this.route.snapshot.paramMap.get('name') ?? ''),
  );

  ngOnInit(): void {
    void this.store.load();
  }
}
