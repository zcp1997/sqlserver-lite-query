/**
 * 性能监控工具
 */
export const performanceMonitor = {
  /**
   * 测量渲染时间
   * @param label 测量标签
   * @returns 结束测量的函数
   */
  measureRenderTime: (label: string) => {
    const startMark = `${label}-start`;
    const endMark = `${label}-end`;
    performance.mark(startMark);

    return () => {
      performance.mark(endMark);
      performance.measure(label, startMark, endMark);

      const measure = performance.getEntriesByName(label)[0];
      if (measure) {
        console.log(`${label}: ${measure.duration.toFixed(2)}ms`);
        if (measure.duration > 1000) {
          console.warn(`${label} is slow (${measure.duration.toFixed(2)}ms), consider optimization`);
        }
      }
    };
  },

  /**
   * 测量函数执行时间
   * @param label 测量标签
   * @param fn 要测量的函数
   * @returns 函数执行结果
   */
  measureFunction: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const endMeasure = performanceMonitor.measureRenderTime(label);
    try {
      const result = await fn();
      return result;
    } finally {
      endMeasure();
    }
  },

  /**
   * 批量处理，避免阻塞主线程
   * @param items 要处理的项目数组
   * @param batchSize 批处理大小
   * @param processBatch 批处理函数
   */
  processBatches: async <T>(
    items: T[],
    batchSize: number,
    processBatch: (batch: T[], startIndex: number) => Promise<void>
  ): Promise<void> => {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await new Promise(resolve => requestAnimationFrame(resolve));
      await processBatch(batch, i);
    }
  }
}; 