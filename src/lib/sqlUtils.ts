/**
 * 获取默认值
 */
const getDefaultValue = (columnType: string): any => {
  switch (columnType) {
    case 'Datetime':
    case 'Datetimen':
      return 'GETDATE()';
    case 'Bit':
      return false;
    case 'NVarchar':
    case 'Varchar':
    case 'NChar':
    case 'Char':
    case 'NText':
    case 'Text':
      return '';
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
      return 0;
    default:
      return null;
  }
};

/**
 * 格式化SQL Server值
 */
export const formatSqlServerValue = (value: any, columnType: string): string => {
  if (value === null || value === undefined) {
    if (columnType === 'Datetime' || columnType === 'Datetimen') {
      return 'GETDATE()';
    }
    return 'NULL';
  }

  switch (columnType) {
    case 'Datetime':
    case 'Datetimen':
      return 'GETDATE()';

    case 'Bit':
      const boolValue = value === true || value === 'true' || value === 1 || value === '1';
      return boolValue ? '1' : '0';

    case 'NVarchar':
    case 'Varchar':
    case 'NChar':
    case 'Char':
    case 'NText':
    case 'Text':
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
      return String(value);

    default:
      if (typeof value === 'string') {
        const stringVal = value.replace(/'/g, "''");
        return `'${stringVal}'`;
      }
      return String(value);
  }
};

/**
 * 生成SQL Server INSERT语句
 */
export const generateSqlServerInsertToClipboard = async (
  tableName: string = 'Table',
  columns: string[],
  columnTypes: string[],
  rowData: Record<string, any> = {}
): Promise<boolean> => {
  const columnList = columns.map(col => `[${col}]`).join(', ');

  const values = columns.map((columnName, index) => {
    const columnType = columnTypes[index] || '';
    const rawValue = rowData[columnName];

    // 如果 rowData 没提供该字段，则填默认值
    const finalValue = rawValue !== undefined && rawValue !== null ? rawValue : getDefaultValue(columnType);
    return formatSqlServerValue(finalValue, columnType);
  }).join(', ');

  const text = `INSERT INTO [${tableName}] (${columnList}) VALUES\n(${values});`;
  const success = await copyToClipboard(text);
  return success;
};


/**
 * 复制文本到剪贴板
 * @param text 要复制的文本
 * @returns Promise<boolean> 复制是否成功
 */
const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}; 