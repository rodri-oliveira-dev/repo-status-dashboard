import type { RepositoryStatus } from '../models/repository-status.model';

type FilterableRepository = Pick<
  RepositoryStatus,
  | 'name'
  | 'description'
  | 'language'
  | 'topics'
  | 'archived'
  | 'health'
  | 'projectType'
  | 'deliveryType'
>;

export interface RepositoryFilters {
  readonly query: string;
  readonly health: string;
  readonly type: string;
  readonly technology: string;
  readonly delivery: string;
  readonly showArchived: boolean;
}

export function matchesRepositorySearch(
  repository: Pick<FilterableRepository, 'name' | 'description' | 'language' | 'topics'>,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;

  return [
    repository.name,
    repository.description ?? '',
    repository.language ?? '',
    ...repository.topics,
  ]
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalized);
}

export function filterRepositories<T extends FilterableRepository>(
  repositories: readonly T[],
  filters: RepositoryFilters,
): T[] {
  return repositories.filter(
    (repository) =>
      (filters.showArchived || !repository.archived) &&
      matchesRepositorySearch(repository, filters.query) &&
      (filters.health === 'all' || repository.health === filters.health) &&
      (filters.type === 'all' || repository.projectType === filters.type) &&
      (filters.technology === 'all' || repository.language === filters.technology) &&
      (filters.delivery === 'all' || repository.deliveryType === filters.delivery),
  );
}
