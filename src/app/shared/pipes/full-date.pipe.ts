import { Pipe, type PipeTransform } from '@angular/core';

@Pipe({ name: 'fullDate', standalone: true })
export class FullDatePipe implements PipeTransform {
  transform(value: string | null): string {
    if (!value) return 'Not available';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      date,
    );
  }
}
