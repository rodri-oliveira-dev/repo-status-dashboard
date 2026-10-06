import { Pipe, type PipeTransform } from '@angular/core';

export function relativeDate(value: string | null, now = Date.now()): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '—';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

@Pipe({ name: 'relativeDate', standalone: true })
export class RelativeDatePipe implements PipeTransform {
  transform(value: string | null): string {
    return relativeDate(value);
  }
}
