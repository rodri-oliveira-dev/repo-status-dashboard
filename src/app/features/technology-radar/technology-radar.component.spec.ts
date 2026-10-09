import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TechnologyRadarService } from '../../core/services/technology-radar.service';
import type { TechnologyRadarSnapshot } from '../../shared/models/technology-radar.model';
import { TechnologyRadarComponent } from './technology-radar.component';

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
      coverage: { status: 'complete', treeTruncated: false, filesInspected: 1, issues: [] },
      technologies: [
        {
          id: 'typescript',
          name: 'TypeScript',
          category: 'tool',
          versions: [
            {
              value: '6.0.2',
              cycle: '6',
              kind: 'resolved',
              confidence: 'high',
              scope: 'test',
              evidence: [
                { path: 'package-lock.json', kind: 'lockfile', detail: 'resolved version' },
              ],
              lifecycle: {
                cycle: '6',
                lifecycle: 'unknown',
                lts: 'not-applicable',
                activeSupportEnd: null,
                maintenanceSupportEnd: null,
                eol: null,
                daysRemaining: null,
                latestStable: null,
                migrationUrgency: 'unknown',
                source: null,
                sourceUpdatedAt: null,
                stale: false,
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('TechnologyRadarComponent', () => {
  const scrollIntoView = vi.fn();

  beforeEach(async () => {
    scrollIntoView.mockReset();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
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
            snapshot: signal<TechnologyRadarSnapshot | null>(snapshot),
            loading: signal(false),
            error: signal<string | null>(null),
            load: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();
  });

  it('selects a keyboard-accessible radar marker and scrolls to rendered evidence', () => {
    const fixture = TestBed.createComponent(TechnologyRadarComponent);
    fixture.detectChanges();
    const marker = fixture.nativeElement.querySelector('.marker') as SVGGElement;
    expect(marker.getAttribute('role')).toBe('button');
    marker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.details')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.details').textContent).toContain('6.0.2');
    expect(fixture.nativeElement.querySelector('.details').textContent).toContain(
      'package-lock.json',
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
