type PerformanceCleanup = { clearMeasures?: (measureName?: string) => void };

/**
 * React Native 0.81's legacy Performance fallback provides no-op mark/measure
 * methods, but no clearMeasures. R3F's development reconciler calls it after
 * every profiled commit. Nothing is recorded by that fallback, so cleanup is
 * also a no-op. Keep the real implementation when the native API is present.
 */
export function ensurePerformanceCleanup(performance: PerformanceCleanup | undefined) {
  if (performance && typeof performance.clearMeasures !== 'function') {
    performance.clearMeasures = () => {};
  }
}

ensurePerformanceCleanup(globalThis.performance);
