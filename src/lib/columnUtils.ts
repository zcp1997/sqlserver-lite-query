// 列宽计算配置接口
export interface ColumnWidthConfig {
  minWidth: number;
  maxWidth: number;
  baseCharWidth: number;
  chineseCharWidth: number;
  padding: number;
  sampleSize: number;
}

// 默认配置
export const DEFAULT_COLUMN_CONFIG: ColumnWidthConfig = {
  minWidth: 80,
  maxWidth: 500,
  baseCharWidth: 9,
  chineseCharWidth: 18,
  padding: 32,
  sampleSize: 100
};

/**
 * 计算文本宽度
 * @param text 文本内容
 * @param config 配置参数
 * @returns 计算出的文本宽度
 */
export const calculateTextWidth = (text: string, config: ColumnWidthConfig): number => {
  if (!text || typeof text !== 'string') return 0;
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef\u3000-\u303f]/.test(char)) {
      width += config.chineseCharWidth;
    } else if (/[A-Z]/.test(char)) {
      width += config.baseCharWidth * 1.1;
    } else if (/\d/.test(char)) {
      width += config.baseCharWidth * 0.9;
    } else {
      width += config.baseCharWidth;
    }
  }
  return Math.ceil(width);
};

/**
 * 计算列宽度
 * @param columnName 列名
 * @param columnData 列数据
 * @param columnType 列类型
 * @param config 配置参数
 * @returns 计算出的列宽度
 */
export const calculateColumnWidth = (
  columnName: string,
  columnData: any[],
  columnType: string = '',
  config: ColumnWidthConfig = DEFAULT_COLUMN_CONFIG
): number => {
  // 计算列名宽度
  const columnNameWidth = calculateTextWidth(columnName, config);

  // 计算类型标签宽度（包括背景、padding、rounded等样式空间）
  const columnTypeWidth = columnType ? calculateTextWidth(columnType, config) + 24 : 0; // 24px for padding + background

  // 计算标签间的间距（gap-2 = 8px）
  const gapWidth = columnType ? 8 : 0;

  // AG-Grid UI 元素空间（排序图标、过滤器图标等）
  const agGridUISpace = 50;

  // 总的列头宽度
  const headerTotalWidth = columnNameWidth + columnTypeWidth + gapWidth + agGridUISpace;

  if (!columnData || columnData.length === 0) {
    return Math.max(config.minWidth, Math.min(headerTotalWidth, config.maxWidth));
  }

  const sampleData = columnData.length > config.sampleSize
    ? [
      ...columnData.slice(0, Math.floor(config.sampleSize * 0.7)),
      ...columnData.slice(-Math.floor(config.sampleSize * 0.3))
    ]
    : columnData;

  let maxContentWidth = 0;
  for (const value of sampleData) {
    if (value === null || value === undefined) {
      const nullWidth = calculateTextWidth('NULL', config);
      maxContentWidth = Math.max(maxContentWidth, nullWidth);
      continue;
    }
    const textValue = String(value);
    const contentWidth = calculateTextWidth(textValue, config);
    maxContentWidth = Math.max(maxContentWidth, contentWidth);
  }

  const contentTotalWidth = maxContentWidth + config.padding;
  const finalWidth = Math.max(headerTotalWidth, contentTotalWidth);
  return Math.max(config.minWidth, Math.min(finalWidth, config.maxWidth));
};

/**
 * 异步计算列宽度（带缓存）
 * @param config 配置参数
 * @returns 异步列宽计算函数
 */
export const createAsyncColumnWidthCalculator = (config: ColumnWidthConfig = DEFAULT_COLUMN_CONFIG) => {
  const widthCache = new Map<string, number>();

  return async (
    columnName: string,
    columnData: any[],
    columnType: string = ''
  ): Promise<number> => {
    const cacheKey = `${columnName}-${columnType}-${columnData.length}-${JSON.stringify(config)}`;
    if (widthCache.has(cacheKey)) {
      return widthCache.get(cacheKey)!;
    }

    return new Promise((resolve) => {
      const calculate = () => {
        const width = calculateColumnWidth(columnName, columnData, columnType, config);
        widthCache.set(cacheKey, width);
        resolve(width);
      };

      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(calculate);
      } else {
        setTimeout(calculate, 0);
      }
    });
  };
}; 