import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CollectionStatus,
  RepositoryDataset,
  RepositoryStatus,
} from '../../shared/models/repository-status.model';

function withoutArchivedRepositories(dataset: RepositoryDataset): RepositoryDataset {
  const repositories = dataset.repositories.filter((repository) => !repository.archived);
  const count = (status: CollectionStatus) =>
    repositories.filter((repository) => repository.collection.status === status).length;

  return {
    ...dataset,
    repositories,
    collection: {
      total: repositories.length,
      complete: count('complete'),
      partial: count('partial'),
      unavailable: count('unavailable'),
    },
  };
}

@Injectable({ providedIn: 'root' })
export class RepositoryStatusService {
  private readonly http = inject(HttpClient);
  private readonly datasetState = signal<RepositoryDataset | null>(null);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly dataset = this.datasetState.asReadonly();
  readonly repositories = computed(() => this.datasetState()?.repositories ?? []);

  async load(force = false): Promise<void> {
    if (!force && (this.datasetState() || this.loading())) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      const dataset = await firstValueFrom(
        this.http.get<RepositoryDataset>('data/repositories.json'),
      );
      if (dataset.schemaVersion !== 2 || !Array.isArray(dataset.repositories)) {
        throw new Error('The repository dataset has an unsupported format.');
      }
      this.datasetState.set(withoutArchivedRepositories(dataset));
    } catch (error: unknown) {
      this.error.set(error instanceof Error ? error.message : 'Could not load repository data.');
    } finally {
      this.loading.set(false);
    }
  }

  findByName(name: string): RepositoryStatus | undefined {
    return this.repositories().find(
      (repository) => repository.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
  }
}
