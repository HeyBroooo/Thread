import { describe, expect, it } from 'vitest';
import { analyzeFixture, FIXTURE_ROOT } from './helpers.js';

describe('parser', () => {
  const analyzed = analyzeFixture();

  it('discovers source files and detects the framework + aliases', () => {
    expect(analyzed.files.length).toBeGreaterThanOrEqual(10);
    expect(analyzed.config.frameworks.react).toBe(true);
    expect(analyzed.config.frameworks.nextjs).toBe(true);
    expect(analyzed.config.aliases.some((a) => a.pattern === '@/*')).toBe(true);
    expect(analyzed.config.dependencies['axios']).toBeDefined();
  });

  it('classifies symbols deterministically', () => {
    const discharge = analyzed.byPath.get('src/components/patient/DischargeButton.tsx');
    expect(discharge).toBeDefined();
    const component = discharge!.symbols.find((s) => s.name === 'DischargeButton');
    expect(component?.kind).toBe('component');
    expect(component?.exported).toBe(true);
    expect(component?.hasJsx).toBe(true);

    const hook = analyzed.byPath.get('src/hooks/usePatient.ts')!.symbols.find((s) => s.name === 'usePatient');
    expect(hook?.kind).toBe('hook');
    expect(hook?.hookCalls).toEqual(expect.arrayContaining(['useEffect', 'useState']));
  });

  it('resolves path-alias imports to real files', () => {
    const button = analyzed.byPath.get('src/components/patient/DischargeButton.tsx')!;
    const utils = button.imports.find((i) => i.moduleSpecifier === '@/lib/utils');
    expect(utils?.resolvedFilePath).toBe('src/lib/utils.ts');
    expect(utils?.resolution).toBe('alias');

    const service = button.imports.find((i) => i.moduleSpecifier === '@/services/patientService');
    expect(service?.resolvedFilePath).toBe('src/services/patientService.ts');
  });

  it('extracts HTTP call targets with method and URL', () => {
    const api = analyzed.byPath.get('src/api/patient.ts')!;
    const targets = api.frameworks.httpCallTargets;
    expect(targets.length).toBeGreaterThanOrEqual(2);
    const discharge = targets.find((t) => t.url.includes('discharge'));
    // `apiClient` is a configured axios instance, so it is classified as a custom client.
    expect(['custom', 'axios']).toContain(discharge?.client);
    expect(discharge?.method).toBe('POST');
    expect(discharge?.url).toContain('/patient/');
  });

  it('detects Next.js route handlers and page routes', () => {
    const route = analyzed.byPath.get('app/api/patient/[id]/discharge/route.ts')!;
    expect(route.frameworks.routeHandlerExports).toContain('POST');
    const page = analyzed.byPath.get('app/patients/[id]/page.tsx')!;
    expect(page.symbols.some((s) => s.kind === 'component')).toBe(true);
  });

  it('reports zero syntactic parse errors for valid sources', () => {
    expect(analyzed.stats.parseErrors).toBe(0);
  });

  it('honours the fixture root', () => {
    expect(analyzed.root.replace(/\\/g, '/')).toContain('tests/fixtures/react-app');
  });
});
