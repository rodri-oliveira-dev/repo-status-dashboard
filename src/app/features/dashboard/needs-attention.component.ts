import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FullDatePipe } from '../../shared/pipes/full-date.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import type { AttentionItem } from '../../shared/utils/needs-attention';

@Component({
  selector: 'app-needs-attention',
  imports: [RouterLink, FullDatePipe, RelativeDatePipe],
  templateUrl: './needs-attention.component.html',
  styleUrl: './needs-attention.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NeedsAttentionComponent {
  readonly items = input.required<readonly AttentionItem[]>();
}
