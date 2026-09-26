import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { Group, type WebGLRenderer } from 'three';
import { ensurePerformanceCleanup } from './nativePerformance';

afterEach(() => vi.unstubAllGlobals());

describe('native constellation performance compatibility', () => {
  it('preserves a native cleanup implementation and tolerates no performance API', () => {
    const clearMeasures = vi.fn();
    const nativePerformance = { clearMeasures };
    ensurePerformanceCleanup(nativePerformance);
    expect(nativePerformance.clearMeasures).toBe(clearMeasures);
    expect(() => ensurePerformanceCleanup(undefined)).not.toThrow();
  });

  it('commits a real R3F scene with the RN 0.81 legacy performance shape', async () => {
    const now = globalThis.performance.now.bind(globalThis.performance);
    const legacyPerformance = { now, mark: vi.fn(), measure: vi.fn(), clearMeasures: undefined };
    vi.stubGlobal('performance', legacyPerformance);
    vi.stubGlobal('console', { ...console, timeStamp: vi.fn() });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('__REACT_DEVTOOLS_GLOBAL_HOOK__', { supportsFiber: true, inject: () => 1 });
    const { createRoot, extend } = await import('@react-three/fiber');
    ensurePerformanceCleanup(legacyPerformance);
    const clearMeasures = vi.spyOn(globalThis.performance, 'clearMeasures');
    // Exercise the actual reconciler that crashed on iOS. A renderer stub avoids
    // requiring a GPU in unit tests; device verification covers GL presentation.
    const renderer = {
      render: vi.fn(), setSize: vi.fn(), setPixelRatio: vi.fn(),
      xr: { isPresenting: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    } as unknown as WebGLRenderer;
    extend({ Group });
    const root = createRoot({ width: 300, height: 300 } as HTMLCanvasElement);
    await root.configure({ gl: renderer, frameloop: 'never', size: { width: 300, height: 300, top: 0, left: 0 } });
    try {
      const Orbit = () => createElement('group', { name: 'orbit-regression' });
      await act(async () => {
        const store = root.render(createElement(Orbit));
        expect(store.getState().scene.getObjectByName('orbit-regression')).toBeInstanceOf(Group);
      });
      expect(legacyPerformance.measure).toHaveBeenCalled();
      expect(clearMeasures).toHaveBeenCalled();
    } finally {
      await act(async () => { root.unmount(); });
    }
  });
});
