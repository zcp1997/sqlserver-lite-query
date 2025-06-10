/**
 * 格式化行数显示
 * @param count 行数
 * @returns 格式化后的行数字符串
 */
export const formatRowCount = (count: number): string => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count ? count.toString() : '0';
};

/**
 * 生成简洁的Tab标题提示（优化显示宽度）
 * @param tab Tab数据对象
 * @returns 格式化后的标题
 */
export const generateTabTitle = (tab: any): string => {
  // 根据行数动态调整标题长度
  const rowCount = tab.affectedRows !== undefined ? tab.affectedRows : tab.rowCount;
  const maxTitleLength = rowCount > 100000 ? 12 : rowCount > 10000 ? 16 : rowCount > 1000 ? 18 : 20;
  
  let baseTitle = tab.title;
  
  // 如果标题过长，进行智能截断
  if (baseTitle.length > maxTitleLength) {
    // 优先保留前面的关键信息
    baseTitle = `${baseTitle.substring(0, maxTitleLength - 3)}...`;
  }
  
  if (tab.affectedRows !== undefined) {
    const formattedCount = formatRowCount(tab.affectedRows);
    return `${baseTitle} | ${formattedCount}行受影响`;
  } else {
    const formattedCount = formatRowCount(tab.rowCount);
    return `${baseTitle} | ${formattedCount}行`;
  }
};

/**
 * 格式化文件时间戳
 * @param date 日期对象
 * @returns 格式化后的时间戳字符串
 */
export const formatTimestamp = (date: Date = new Date()): string => {
  return date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(/[\s:]/g, '-');
}; 