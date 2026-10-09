import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TechnologyRadarService } from '../../core/services/technology-radar.service';
import type {
  DetectedVersion,
  LifecycleInformation,
  MigrationUrgency,
  Technology,
  TechnologyCategory,
  TechnologyRadarSnapshot,
} from '../../shared/models/technology-radar.model';
import { TechnologyRadarComponent } from './technology-radar.component';

const longEvidencePath =
  'src/Organizations/ExtremelyLongBusinessCapability/Infrastructure/Adapters/VeryLongProjectName.With.Many.Segments/VeryLongProjectName.With.Many.Segments.csproj';

function lifecycle(
  migrationUrgency: MigrationUrgency,
  phase: LifecycleInformation['lifecycle'] = 'active',
): LifecycleInformation {
  const known = migrationUrgency !== 'unknown';
  return {
    cycle: known ? '1' : null,
    lifecycle: known ? phase : 'unknown',
    lts: known ? 'yes' : 'not-applicable',
    activeSupportEnd: null,
    maintenanceSupportEnd: null,
    eol: known ? '2027-01-01' : null,
    daysRemaining:
      migrationUrgency === 'migration-required'
        ? -10
        : migrationUrgency === 'migration-approaching'
          ? 45
          : migrationUrgency === 'monitor'
            ? 120
            : known
              ? 300
              : null,
    latestStable: known ? '1.2.3' : null,
    migrationUrgency,
    source: known ? { name: 'source', url: 'https://example.test', policyUrl: null } : null,
    sourceUpdatedAt: known ? '2026-01-01' : null,
    stale: false,
  };
}

function technology(
  id: string,
  name: string,
  category: TechnologyCategory,
  urgency: MigrationUrgency,
  evidence: DetectedVersion['evidence'] = [],
): Technology {
  return {
    id,
    name,
    category,
    versions: [
      {
        value: '1.2.3',
        cycle: '1',
        kind: 'resolved',
        confidence: 'high',
        scope: 'production',
        evidence,
        lifecycle: lifecycle(urgency, urgency === 'migration-required' ? 'end-of-life' : 'active'),
      },
    ],
  };
}

const snapshot: TechnologyRadarSnapshot = {
  schemaVersion: 1,
  owner: 'owner',
  generatedAt: '2026-01-01T00:00:00Z',
  lifecycleUpdatedAt: null,
  sources: [],
  urgencyThresholds: { approachingDays: 90, monitorDays: 180 },
  coverage: { repositories: 1, complete: 1, partial: 0, unavailable: 0 },
  repositories: [
    {
      repository: { name: 'app', fullName: 'owner/app', url: 'https://example.test/app' },
      coverage: { status: 'complete', treeTruncated: false, filesInspected: 6, issues: [] },
      technologies: [
        technology('nodejs', 'Node.js', 'runtime', 'migration-required'),
        technology('angular', 'Angular', 'framework', 'migration-approaching'),
        technology('python', 'Python', 'language', 'monitor'),
        technology('terraform', 'Terraform', 'infrastructure', 'no-immediate-action'),
        technology('typescript', 'TypeScript', 'tool', 'unknown', [
          { path: longEvidencePath, kind: 'manifest', detail: 'declared project target' },
          { path: 'package-lock.json', kind: 'lockfile', detail: 'resolved version' },
        ]),
      ],
    },
  ],
};

describe('TechnologyRadarComponent', () => {
  const scrollIntoView = vi.fn();
  let snapshotSignal: ReturnType<typeof signal<TechnologyRadarSnapshot | null>>;

  beforeEach(async () => {
    scrollIntoView.mockReset();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    snapshotSignal = signal<TechnologyRadarSnapshot | null>(snapshot);
    await TestBed.configureTestingModule({
      imports: [TechnologyRadarComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
        {
          provide: TechnologyRadarService,
          useValue: {
            snapshot: snapshotSignal,
            loading: signal(false),
            error: signal<string | null>(null),
            load: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders readable technologies in each landscape category with version and urgency', () => {
    const fixture = TestBed.createComponent(TechnologyRadarComponent);
    fixture.detectChanges();

    const groups = [...fixture.nativeElement.querySelectorAll('.landscape-group h3')].map(
      (heading: Element) => heading.textContent?.trim(),
    );
    expect(groups).toEqual(['Platforms', 'Frameworks', 'Languages & tools', 'Infrastructure']);

    const items = [...fixture.nativeElement.querySelectorAll('.landscape-item')] as HTMLElement[];
    expect(items).toHaveLength(5);
    expect(items.find((item) => item.textContent?.includes('Angular'))?.textContent).toContain(
      'Migration Approaching',
    );
    expect(items.find((item) => item.textContent?.includes('TypeScript'))?.textContent).toContain(
      'Unknown',
    );
    expect(items.every((item) => item.querySelector('code')?.textContent?.trim() === '1')).toBe(
      true,
    );
    expect(items.every((item) => item.textContent?.includes('1 repository'))).toBe(true);
  });

  it('uses native buttons to select technologies and scroll to evidence', () => {
    const fixture = TestBed.createComponent(TechnologyRadarComponent);
    fixture.detectChanges();
    const items = [
      ...fixture.nativeElement.querySelectorAll('.landscape-item'),
    ] as HTMLButtonElement[];
    const typescript = items.find((item) => item.textContent?.includes('TypeScript'))!;

    expect(typescript.tagName).toBe('BUTTON');
    expect(typescript.getAttribute('aria-label')).toContain('Tool category');
    typescript.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.details')).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    const node = items.find((item) => item.textContent?.includes('Node.js'))!;
    node.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.details h2').textContent).toContain('Node.js');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('preserves long paths and every evidence occurrence, and closes the details', () => {
    const fixture = TestBed.createComponent(TechnologyRadarComponent);
    fixture.detectChanges();
    const typescript = [...fixture.nativeElement.querySelectorAll('.landscape-item')].find(
      (item: Element) => item.textContent?.includes('TypeScript'),
    ) as HTMLButtonElement;
    typescript.click();
    fixture.detectChanges();

    const paths = [...fixture.nativeElement.querySelectorAll('.evidence-path')].map(
      (path: Element) => path.textContent?.trim(),
    );
    expect(paths).toEqual([longEvidencePath, 'package-lock.json']);
    expect(fixture.nativeElement.querySelector('.details').textContent).toContain(
      'declared project target',
    );

    (
      fixture.nativeElement.querySelector('[aria-label="Close technology details"]') as HTMLElement
    ).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.details')).toBeNull();
  });

  it('renders Migration Watch classifications on scoped badges', () => {
    const fixture = TestBed.createComponent(TechnologyRadarComponent);
    fixture.detectChanges();
    const badges = [...fixture.nativeElement.querySelectorAll('.migration-badge')] as HTMLElement[];

    expect(badges.map((badge) => badge.textContent?.trim())).toEqual([
      'Migration Required',
      'Migration Approaching',
      'Monitor',
    ]);
    expect(badges.map((badge) => badge.dataset['tone'])).toEqual([
      'migration-required',
      'migration-approaching',
      'monitor',
    ]);
    expect(getComputedStyle(badges[0]).display).toBe('inline-flex');
    expect(getComputedStyle(badges[0]).alignItems).toBe('center');
    expect(getComputedStyle(badges[0]).justifyContent).toBe('center');
  });

  it('applies filters to both the matrix and table and renders an empty state', async () => {
    const fixture = TestBed.createComponent(TechnologyRadarComponent);
    fixture.detectChanges();
    const category = fixture.nativeElement.querySelector('.filters select') as HTMLSelectElement;
    category.value = 'framework';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.landscape-item')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.landscape-item').textContent).toContain('Angular');
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);

    const search = fixture.nativeElement.querySelector('.search input') as HTMLInputElement;
    search.value = 'does-not-exist';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.landscape-empty')?.textContent).toContain(
      'No technologies found',
    );
    expect(fixture.nativeElement.querySelector('.workspace .empty')?.textContent).toContain(
      'No technologies found',
    );
  });

  it('renders a large filtered inventory without dropping landscape items', () => {
    const extraTechnologies = Array.from({ length: 40 }, (_, index) =>
      technology(`tool-${index}`, `Build Tool ${index}`, 'tool', 'unknown'),
    );
    snapshotSignal.set({
      ...snapshot,
      repositories: [
        {
          ...snapshot.repositories[0],
          technologies: [...snapshot.repositories[0].technologies, ...extraTechnologies],
        },
      ],
    });
    const fixture = TestBed.createComponent(TechnologyRadarComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.landscape-item')).toHaveLength(45);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(45);
  });
});
