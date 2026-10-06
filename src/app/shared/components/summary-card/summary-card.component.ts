import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-summary-card',
  template: `<article [class]="'summary ' + tone()">
    <span>{{ label() }}</span
    ><strong>{{ value() }}</strong>
  </article>`,
  styleUrl: './summary-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly tone = input('neutral');
}
