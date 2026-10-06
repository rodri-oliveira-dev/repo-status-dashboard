import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(
        (module) => module.DashboardComponent,
      ),
    title: 'Repo Control Center',
  },
  {
    path: 'repository/:name',
    loadComponent: () =>
      import('./features/repository-details/repository-details.component').then(
        (module) => module.RepositoryDetailsComponent,
      ),
    title: 'Repository details · Repo Control Center',
  },
  { path: '**', redirectTo: '' },
];
