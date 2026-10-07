import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { PortfolioInsights } from '../../shared/utils/portfolio-insights';

@Component({
  selector: 'app-portfolio-insights',
  imports: [DecimalPipe, RouterLink],
  templateUrl: './portfolio-insights.component.html',
  styleUrl: './portfolio-insights.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioInsightsComponent {
  readonly insights = input.required<PortfolioInsights>();
}
