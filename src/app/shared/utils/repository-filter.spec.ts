import { filterRepositories, matchesRepositorySearch } from './repository-filter';

const repository = {
  name: 'Repo2C4',
  description: 'Architecture analysis command line',
  language: 'C#',
  topics: ['cli', 'architecture'],
};

const filters = {
  query: '',
  health: 'all',
  type: 'all',
  technology: 'all',
  delivery: 'all',
  showArchived: false,
};

describe('matchesRepositorySearch', () => {
  it.each(['repo2', 'analysis', 'c#', 'ARCHITECTURE', ''])(
    'matches searchable content for %s',
    (query) => {
      expect(matchesRepositorySearch(repository, query)).toBe(true);
    },
  );

  it('does not match unrelated content', () =>
    expect(matchesRepositorySearch(repository, 'angular')).toBe(false));
});

describe('filterRepositories', () => {
  const repositories = [
    {
      ...repository,
      archived: false,
      health: 'healthy' as const,
      projectType: 'CLI' as const,
      deliveryType: 'NuGet' as const,
    },
    {
      ...repository,
      name: 'old-docs',
      archived: true,
      health: 'archived' as const,
      projectType: 'Documentation' as const,
      deliveryType: 'None' as const,
    },
  ];

  it('hides archived repositories by default', () => {
    expect(filterRepositories(repositories, filters).map((item) => item.name)).toEqual(['Repo2C4']);
  });

  it('shows archived repositories on request', () => {
    expect(filterRepositories(repositories, { ...filters, showArchived: true })).toHaveLength(2);
  });

  it('combines status, type, technology and delivery filters', () => {
    expect(
      filterRepositories(repositories, {
        ...filters,
        health: 'healthy',
        type: 'CLI',
        technology: 'C#',
        delivery: 'NuGet',
      }),
    ).toHaveLength(1);
  });
});
