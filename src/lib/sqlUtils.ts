/**
 * 格式化SQL Server值
 * @param value 原始值
 * @param columnType 列类型
 * @returns 格式化后的SQL值
 */
export const formatSqlServerValue = (value: any, columnType: string): string => {
  // 处理NULL值
  if (value === null || value === undefined) {
    return 'NULL';
  }

  // 根据列类型格式化值
  switch (columnType) {
    case 'Datetime':
    case 'Datetimen':
      return 'GETDATE()';
    
    case 'Bit':
      // 布尔值根据实际值决定，但如果用户要求默认false则使用以下逻辑
      const boolValue = value === true || value === 'true' || value === 1 || value === '1';
      return boolValue ? '1' : '0';
    
    case 'NVarchar':
    case 'Varchar':
    case 'NChar':
    case 'Char':
    case 'NText':
    case 'Text':
      // 字符串类型，转义单引号
      const stringValue = String(value).replace(/'/g, "''");
      return `N'${stringValue}'`;
    
    case 'Int4':
    case 'Int':
    case 'BigInt':
    case 'SmallInt':
    case 'TinyInt':
    case 'Decimal':
    case 'Numeric':
    case 'Float':
    case 'Real':
    case 'Money':
    case 'SmallMoney':
      // 数值类型
      return String(value);
    
    default:
      // 默认当作字符串处理
      if (typeof value === 'string') {
        const stringValue = String(value).replace(/'/g, "''");
        return `'${stringValue}'`;
      } else {
        return String(value);
      }
  }
};

/**
 * 生成SQL Server INSERT语句
 * @param tableName 表名（可选，默认为[Table]）
 * @param columns 列名数组
 * @param columnTypes 列类型数组
 * @param rowData 行数据对象
 * @returns 生成的INSERT语句
 */
export const generateSqlServerInsert = (
  tableName: string = 'Table',
  columns: string[],
  columnTypes: string[],
  rowData: Record<string, any>
): string => {
  // 格式化列名（用方括号包裹）
  const columnList = columns.map(col => `[${col}]`).join(', ');

  // 格式化值
  const values = columns.map((columnName, index) => {
    const value = rowData[columnName];
    const columnType = columnTypes[index] || '';
    return formatSqlServerValue(value, columnType);
  }).join(', ');

  // 生成完整的INSERT语句
  return `INSERT INTO [${tableName}] (${columnList}) VALUES\n(${values});`;
};

/**
 * 复制文本到剪贴板
 * @param text 要复制的文本
 * @returns Promise<boolean> 复制是否成功
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    console.log('Text to copy:', text);
    return false;
  }
}; 