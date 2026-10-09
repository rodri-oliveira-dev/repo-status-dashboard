import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { TechnologyRadarSnapshot } from '../../shared/models/technology-radar.model';

@Injectable({ providedIn: 'root' })
export class TechnologyRadarService {
  private readonly http = inject(HttpClient);
  private readonly snapshotState = signal<TechnologyRadarSnapshot | null>(null);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly snapshot = this.snapshotState.asReadonly();
  readonly repositories = computed(() => this.snapshotState()?.repositories ?? []);

  async load(force = false): Promise<void> {
    if (!force && (this.snapshotState() || this.loading())) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const snapshot = await firstValueFrom(
        this.http.get<TechnologyRadarSnapshot>('data/technology-radar.json'),
      );
      if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.repositories)) {
        throw new Error('The Technology Radar snapshot has an unsupported format.');
      }
      this.snapshotState.set(snapshot);
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Could not load technology data.');
    } finally {
      this.loading.set(false);
    }
  }

  findByRepository(name: string) {
    return this.repositories().find(
      (item) => item.repository.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
  }
}
