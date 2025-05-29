import * as monaco from 'monaco-editor'
import { search_column_details, search_table_names } from '@/lib/api'

// 缓存机制
interface CacheEntry {
  data: any
  timestamp: number
  ttl: number
  sessionId: string
}

class SqlCache {
  private cache = new Map<string, CacheEntry>()
  
  set(key: string, data: any, sessionId: string, ttl: number = 300000): void { // 5分钟TTL
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      sessionId
    })
  }
  
  get(key: string, sessionId: string): any | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    
    // 检查会话是否匹配
    if (entry.sessionId !== sessionId) {
      this.cache.delete(key)
      return null
    }
    
    // 检查是否过期
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key)
      return null
    }
    
    return entry.data
  }
  
  // 删除特定key的缓存
  delete(key: string): boolean {
    return this.cache.delete(key)
  }
  
  clear(): void {
    this.cache.clear()
  }
  
  // 清除特定会话的缓存
  clearSession(sessionId: string): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.sessionId === sessionId) {
        this.cache.delete(key)
      }
    }
  }
  
  // 获取缓存统计信息
  getStats(): { size: number, sessions: Set<string> } {
    const sessions = new Set<string>()
    for (const entry of this.cache.values()) {
      sessions.add(entry.sessionId)
    }
    return {
      size: this.cache.size,
      sessions
    }
  }
}

const sqlCache = new SqlCache()

// 表信息接口
export interface ParsedTable {
  name: string
  schema?: string
  alias?: string
}

// SQL模式匹配结果接口
export interface SqlContext {
  isInSelectStatement: boolean
  isDirectlyAfterSelect: boolean
  isAfterCommaInSelect: boolean
  isAfterSelectOrComma: boolean
  isDotNotation: boolean
  dotTableOrAlias?: string
}

// 建议项创建函数类型
export type CreateCompletionItemFunction = (
  label: string,
  kind: monaco.languages.CompletionItemKind,
  insertText: string,
  range: monaco.IRange,
  detail?: string,
  documentation?: string,
  isSnippet?: boolean,
  priority?: 'high' | 'medium' | 'low'
) => monaco.languages.CompletionItem

// 解析SQL中的表和别名 - 暴力解析所有表
export function parseTablesAndAliases(sql: string): ParsedTable[] {
  const tables: ParsedTable[] = []
  const addedTables = new Set<string>() // 避免重复表
  
  console.log('暴力解析所有SQL中的表:', sql)
  
  // 直接在完整SQL中查找所有表，不分语句
  const upperSql = sql.toUpperCase()
  
  // 匹配所有 FROM 子句中的表
  const fromMatches = upperSql.matchAll(/FROM\s+(?:\[([^\]]+)\]\.\[([^\]]+)\]|([^\s\[.]+)\.([^\s\[.]+)|([^\s\[.]+))(?:\s+(?:AS\s+)?([A-Z0-9_]+))?/gi)
  for (const match of fromMatches) {
    const table = parseTableMatch(match)
    if (table) {
      const tableKey = `${table.schema || ''}.${table.name}`
      if (!addedTables.has(tableKey)) {
        addedTables.add(tableKey)
        tables.push(table)
      }
    }
  }
  
  // 匹配所有 JOIN 子句中的表
  const joinMatches = upperSql.matchAll(/(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\s+(?:\[([^\]]+)\]\.\[([^\]]+)\]|([^\s\[.]+)\.([^\s\[.]+)|([^\s\[.]+))(?:\s+(?:AS\s+)?([A-Z0-9_]+))?/gi)
  for (const match of joinMatches) {
    const table = parseTableMatch(match)
    if (table) {
      const tableKey = `${table.schema || ''}.${table.name}`
      if (!addedTables.has(tableKey)) {
        addedTables.add(tableKey)
        tables.push(table)
      }
    }
  }
  
  // 匹配所有 UPDATE 语句中的表
  const updateMatches = upperSql.matchAll(/UPDATE\s+(?:\[([^\]]+)\]\.\[([^\]]+)\]|([^\s\[.]+)\.([^\s\[.]+)|([^\s\[.]+))(?:\s+(?:AS\s+)?([A-Z0-9_]+))?/gi)
  for (const match of updateMatches) {
    const table = parseTableMatch(match)
    if (table) {
      const tableKey = `${table.schema || ''}.${table.name}`
      if (!addedTables.has(tableKey)) {
        addedTables.add(tableKey)
        tables.push(table)
      }
    }
  }
  
  console.log('解析到的所有表:', tables)
  return tables
}

// 解析单个表匹配结果
function parseTableMatch(match: RegExpMatchArray): ParsedTable | null {
  let schema: string | undefined
  let tableName: string
  let alias: string | undefined = match[6] // 别名总是在最后
  
  if (match[1] && match[2]) {
    // [schema].[table] 格式
    schema = match[1]
    tableName = match[2]
  } else if (match[3] && match[4]) {
    // schema.table 格式  
    schema = match[3]
    tableName = match[4]
  } else if (match[5]) {
    // 只有表名，没有schema
    tableName = match[5]
  } else {
    return null // 跳过无效匹配
  }
  
  console.log('Table match details:', {
    fullMatch: match[0],
    parsed: { schema, tableName, alias }
  })
  
  return {
    schema,
    name: tableName,
    alias
  }
}

// 分析SQL上下文 - 简化逻辑
export function analyzeSqlContext(textBeforeCursor: string): SqlContext {
  console.log('分析SQL上下文, textBeforeCursor末尾50字符:', textBeforeCursor.slice(-50))
  
  // 简单检测是否在SELECT语句中
  const isInSelectStatement = textBeforeCursor.toUpperCase().includes('SELECT')
  
  // 检测是否在 SELECT 后面（包含 TOP 语法支持）
  const selectPatterns = [
    /SELECT\s*$/i,                           // SELECT 后直接
    /SELECT\s+\w*$/i,                        // SELECT 后有部分单词
    /SELECT\s+(?:[^,]+,\s*)+$/i,             // SELECT 后有多个字段，最后以逗号结尾
    /SELECT\s+(?:[^,]+,\s*)*\w*$/i,          // SELECT 后有字段列表，最后可能有部分单词
    // SQL Server TOP 语法支持
    /SELECT\s+TOP\s+\d+\s*$/i,               // SELECT TOP 10 后直接
    /SELECT\s+TOP\s+\d+\s+\w*$/i,            // SELECT TOP 10 后有部分单词
    /SELECT\s+TOP\s+\d+\s+(?:[^,]+,\s*)+$/i, // SELECT TOP 10 后有多个字段，最后以逗号结尾
    /SELECT\s+TOP\s+\d+\s+(?:[^,]+,\s*)*\w*$/i, // SELECT TOP 10 后有字段列表，最后可能有部分单词
  ]
  
  // 检测逗号后的情况
  const isAfterCommaInSelect = isInSelectStatement && (
    /,\s*$/i.test(textBeforeCursor) ||          // 以逗号结尾
    /,\s+\w*$/i.test(textBeforeCursor) ||       // 逗号后有空格和可能的单词
    /SELECT\s+[^,]*,\s*\w*$/i.test(textBeforeCursor) // SELECT后有字段，然后逗号
  )
  
  const isDirectlyAfterSelect = selectPatterns.some(pattern => pattern.test(textBeforeCursor))
  const isAfterSelectOrComma = isDirectlyAfterSelect || isAfterCommaInSelect
  
  // 检测点号后的情况
  const dotMatch = textBeforeCursor.match(/(\[?([A-Z0-9_]+)\]?)\.\s*$/i)
  const isDotNotation = !!dotMatch
  const dotTableOrAlias = dotMatch ? dotMatch[2] : undefined
  
  console.log('SQL上下文分析结果:', {
    isInSelectStatement,
    isDirectlyAfterSelect,
    isAfterCommaInSelect,
    isAfterSelectOrComma,
    isDotNotation,
    dotTableOrAlias
  })
  
  return {
    isInSelectStatement,
    isDirectlyAfterSelect,
    isAfterCommaInSelect,
    isAfterSelectOrComma,
    isDotNotation,
    dotTableOrAlias
  }
}

// 获取列建议 - 在建议项中显示表名信息
export async function getColumnSuggestions(
  sessionId: string,
  tableOrAlias: string,
  context: string,
  schemaName?: string,
  createCompletionItem?: CreateCompletionItemFunction,
  range?: monaco.IRange,
  tableDisplayName?: string // 新增：用于在建议项中显示的表名
): Promise<monaco.languages.CompletionItem[]> {
  const suggestions: monaco.languages.CompletionItem[] = []
  const addedColumns = new Set<string>()
  
  // 生成缓存key：sessionId + tableName + schema
  const cacheKey = `columns_${sessionId}_${tableOrAlias}_${schemaName || 'default'}`
  
  try {
    // 首先检查缓存
    console.log(`检查缓存: ${cacheKey}`)
    const cachedColumns = sqlCache.get(cacheKey, sessionId)
    
    let columns = cachedColumns
    if (cachedColumns) {
      console.log(`缓存命中! 表 ${tableOrAlias} 的列信息来自缓存 (${context})`)
      columns = cachedColumns
    } else {
      console.log(`缓存未命中，正在获取表 ${tableOrAlias} 的列建议 (${context}), schema: ${schemaName}, sessionId: ${sessionId}`)
      columns = await search_column_details(sessionId, tableOrAlias, schemaName)
      
      // 将结果存入缓存
      if (columns && columns.length > 0) {
        sqlCache.set(cacheKey, columns, sessionId, 300000) // 5分钟缓存
        console.log(`已缓存表 ${tableOrAlias} 的 ${columns.length} 个列信息`)
      }
    }
    
    // 生成建议项 - 显示表名信息
    if (columns && Array.isArray(columns)) {
      const displayTableName = tableDisplayName || tableOrAlias
      columns.forEach(col => {
        if (col && col.name && !addedColumns.has(col.name) && createCompletionItem && range) {
          addedColumns.add(col.name)
          
          // 优化显示文本，避免过长被截断
          const shortTableName = displayTableName.length > 20 ? 
            displayTableName.split('.').pop()?.replace(/[\[\]]/g, '') || displayTableName : 
            displayTableName.replace(/[\[\]]/g, '')
            
          suggestions.push(createCompletionItem(
            col.name,
            monaco.languages.CompletionItemKind.Field,
            col.name,
            range,
            `${shortTableName}`, // 简化的detail，只显示表名
            `Column: ${col.name}\nTable: ${displayTableName}\nType: ${col.data_type || 'unknown'}`, // 详细信息放到documentation
            false,
            'high'
          ))
        }
      })
      
      console.log(`为表 ${tableOrAlias} 生成了 ${suggestions.length} 个列建议 (${context})`)
    }
  } catch (error) {
    console.error(`Error fetching columns for ${tableOrAlias} in ${context}:`, error)
    // 如果API调用失败，清除可能的错误缓存
    sqlCache.delete(cacheKey)
  }
  
  return suggestions
}

// 获取表建议
export async function getTableSuggestions(
  sessionId: string,
  createCompletionItem: CreateCompletionItemFunction,
  range: monaco.IRange
): Promise<monaco.languages.CompletionItem[]> {
  const suggestions: monaco.languages.CompletionItem[] = []
  
  // 生成表建议的缓存key
  const cacheKey = `tables_${sessionId}`
  
  try {
    // 检查缓存
    console.log(`检查表建议缓存: ${cacheKey}`)
    const cachedTables = sqlCache.get(cacheKey, sessionId)
    
    let tables = cachedTables
    if (cachedTables) {
      console.log(`表建议缓存命中! 来自缓存`)
      tables = cachedTables
    } else {
      console.log(`表建议缓存未命中，正在获取表列表`)
      tables = await search_table_names(sessionId, "")
      
      // 缓存表建议，使用较短的TTL（2分钟），因为表结构变化相对频繁
      if (tables && tables.length > 0) {
        sqlCache.set(cacheKey, tables, sessionId, 120000) // 2分钟缓存
        console.log(`已缓存 ${tables.length} 个表建议`)
      }
    }
    
    const addedTables = new Set<string>()
    
    if (tables && Array.isArray(tables)) {
      tables.forEach(table => {
        if (table && table.name) {
          const label = table.schema ? `[${table.schema}].[${table.name}]` : `[${table.name}]`
          //const label = `${table.name}`
          if (!addedTables.has(label)) {
            addedTables.add(label)
            
            // 优化表建议显示
            const shortLabel = table.name // 只显示表名作为主要标签
            const fullLabel = label // 完整标签用于插入
            
            suggestions.push(createCompletionItem(
              shortLabel,
              monaco.languages.CompletionItemKind.Module,
              fullLabel + ' ',
              range,
              table.schema ? `${table.schema}` : 'Table', // detail显示schema
              `Table: ${fullLabel}${table.schema ? `\nSchema: ${table.schema}` : ''}`, // documentation显示完整信息
              false,
              'high'
            ))
          }
        }
      })
    }
  } catch (error) {
    console.error("Error fetching tables:", error)
    // 清除可能的错误缓存
    sqlCache.delete(cacheKey)
  }
  
  return suggestions
}

// 生成动态建议 - 暴力加载所有表的列
export async function generateDynamicSuggestions(
  sessionId: string,
  textBeforeCursor: string,
  fullText: string,
  sqlContext: SqlContext,
  tablesAndAliases: ParsedTable[],
  createCompletionItem: CreateCompletionItemFunction,
  range: monaco.IRange
): Promise<monaco.languages.CompletionItem[]> {
  const dynamicSuggestions: monaco.languages.CompletionItem[] = []
  
  // 暴力解析所有表
  const allTables = parseTablesAndAliases(fullText)
  console.log('暴力解析到的所有表:', allTables)
  
  // 1. 表建议（在 FROM, JOIN, UPDATE 后）
  const lastToken = (textBeforeCursor.match(/([A-Z_]+)\s*$/) || [])[1] || ''
  const secondLastToken = (textBeforeCursor.match(/([A-Z_]+)\s+([A-Z_]+)\s*$/) || [])[1] || ''
  const tableKeywords = ['FROM', 'JOIN', 'UPDATE']
  
  if (tableKeywords.includes(lastToken) || (tableKeywords.includes(secondLastToken))) {
    const tableSuggestions = await getTableSuggestions(sessionId, createCompletionItem, range)
    dynamicSuggestions.push(...tableSuggestions)
    return dynamicSuggestions // 只返回表建议
  }
  
  // 2. 点号后的列建议 - 只显示该表的列
  if (sqlContext.isDotNotation && sqlContext.dotTableOrAlias) {
    console.log(`点号表示法检测，只加载表 ${sqlContext.dotTableOrAlias} 的列`)
    
    const matchedTable = allTables.find(t => 
      t.alias === sqlContext.dotTableOrAlias || t.name === sqlContext.dotTableOrAlias
    )
    
    if (matchedTable) {
      console.log(`点号匹配到表:`, matchedTable)
      const tableDisplayName = matchedTable.schema ? `[${matchedTable.schema}].[${matchedTable.name}]` : matchedTable.name
      const columnSuggestions = await getColumnSuggestions(
        sessionId,
        matchedTable.name,
        'dot notation',
        matchedTable.schema,
        createCompletionItem,
        range,
        tableDisplayName
      )
      return columnSuggestions
    } else {
      console.log(`点号未匹配到表，直接查询:`, sqlContext.dotTableOrAlias)
      const columnSuggestions = await getColumnSuggestions(
        sessionId,
        sqlContext.dotTableOrAlias,
        'dot notation (direct)',
        undefined,
        createCompletionItem,
        range,
        sqlContext.dotTableOrAlias
      )
      return columnSuggestions
    }
  }
  
  // 3. SELECT 子句中的列建议 - 暴力加载所有表的列
  if (sqlContext.isAfterSelectOrComma) {
    console.log('SELECT子句检测，暴力加载所有表的列建议')
    
    // 添加 * 选项
    dynamicSuggestions.push(createCompletionItem(
      '*',
      monaco.languages.CompletionItemKind.Field,
      '* ',
      range,
      'Select all columns',
      'Select all columns from all tables',
      false,
      'high'
    ))
    
    if (allTables.length > 0) {
      console.log(`为 ${allTables.length} 个表加载所有列建议`)
      
      // 遍历所有表，加载每个表的列建议
      for (const table of allTables) {
        const tableDisplayName = table.schema ? `[${table.schema}].[${table.name}]` : table.name
        console.log(`加载表 ${tableDisplayName} 的列建议`)
        
        const columnSuggestions = await getColumnSuggestions(
          sessionId,
          table.name,
          'SELECT clause',
          table.schema,
          createCompletionItem,
          range,
          tableDisplayName
        )
        dynamicSuggestions.push(...columnSuggestions)
      }
      
      console.log(`SELECT子句: 总共加载了 ${dynamicSuggestions.length - 1} 个列建议 (除去*)`)
    } else {
      // Fallback：从textBeforeCursor中解析表名
      console.log('Fallback: 直接从文本解析表名')
      const partialFromMatch = textBeforeCursor.match(/FROM\s+(?:\[?([^\]]+)\]?\.)??\[?([^\]]+)\]?/i)
      if (partialFromMatch) {
        const tableName = partialFromMatch[2] || partialFromMatch[1]
        const schemaName = partialFromMatch[1] && partialFromMatch[2] ? partialFromMatch[1] : undefined
        const tableDisplayName = schemaName ? `[${schemaName}].[${tableName}]` : tableName
        console.log(`Fallback解析到表: ${tableDisplayName}`)
        const columnSuggestions = await getColumnSuggestions(
          sessionId,
          tableName,
          'SELECT clause (fallback)',
          schemaName,
          createCompletionItem,
          range,
          tableDisplayName
        )
        dynamicSuggestions.push(...columnSuggestions)
      }
    }
    
    return dynamicSuggestions
  }
  
  // 4. WHERE 子句 - 暴力加载所有表的列
  const whereClauseMatch = textBeforeCursor.match(/WHERE\s+(?:.*?\s+(?:AND|OR)\s+)?$/i)
  if (whereClauseMatch && allTables.length > 0) {
    console.log('WHERE子句检测，暴力加载所有表的列')
    
    for (const table of allTables) {
      const tableDisplayName = table.schema ? `[${table.schema}].[${table.name}]` : table.name
      console.log(`加载表 ${tableDisplayName} 的列建议 (WHERE)`)
      
      const columnSuggestions = await getColumnSuggestions(
        sessionId,
        table.name,
        'WHERE clause',
        table.schema,
        createCompletionItem,
        range,
        tableDisplayName
      )
      dynamicSuggestions.push(...columnSuggestions)
    }
    
    return dynamicSuggestions
  }
  
  // 5. UPDATE SET 子句 - 只返回被更新表的列
  const updateSetMatch = textBeforeCursor.match(/UPDATE\s+(?:\[?([^\]]+)\]?\.)??\[?([^\]]+)\]?\s+SET\s+(?:[\w.]+\s*=\s*[^,]+(?:,\s*)?)*(\w*)$/i)
  if (updateSetMatch) {
    console.log('UPDATE SET子句检测，只加载被更新表的列')
    const tableName = updateSetMatch[2] || updateSetMatch[1]
    const schemaName = updateSetMatch[1] && updateSetMatch[2] ? updateSetMatch[1] : undefined
    const tableDisplayName = schemaName ? `[${schemaName}].[${tableName}]` : tableName
    const columnSuggestions = await getColumnSuggestions(
      sessionId,
      tableName,
      'UPDATE SET',
      schemaName,
      createCompletionItem,
      range,
      tableDisplayName
    )
    // 为每个列添加 " = " 后缀
    columnSuggestions.forEach(suggestion => {
      suggestion.insertText = suggestion.label + ' = '
    })
    return columnSuggestions
  }
  
  // 6. INSERT INTO 子句 - 只返回插入表的列
  const insertColumnsMatch = textBeforeCursor.match(/INSERT\s+INTO\s+(?:\[?([^\]]+)\]?\.)??\[?([^\]]+)\]?\s*\(\s*([^)]*)$/i)
  if (insertColumnsMatch) {
    console.log('INSERT INTO子句检测，只加载插入表的列')
    const tableName = insertColumnsMatch[2] || insertColumnsMatch[1]
    const schemaName = insertColumnsMatch[1] && insertColumnsMatch[2] ? insertColumnsMatch[1] : undefined
    const existingColsText = insertColumnsMatch[3]
    
    if (!existingColsText.includes(')')) {
      const tableDisplayName = schemaName ? `[${schemaName}].[${tableName}]` : tableName
      const columnSuggestions = await getColumnSuggestions(
        sessionId,
        tableName,
        'INSERT INTO',
        schemaName,
        createCompletionItem,
        range,
        tableDisplayName
      )
      return columnSuggestions
    }
  }
  
  // 7. UPDATE 后的 SET 建议
  const updateTableMatch = textBeforeCursor.match(/UPDATE\s+(\b[A-Z0-9_.]+)\b\s*$/i)
  if (updateTableMatch) {
    dynamicSuggestions.push(createCompletionItem(
      'SET',
      monaco.languages.CompletionItemKind.Keyword,
      'SET ',
      range,
      'SQL SET keyword',
      undefined,
      false,
      'high'
    ))
    return dynamicSuggestions
  }
  
  // 8. INSERT INTO 后的建议
  const insertTableMatch = textBeforeCursor.match(/INSERT\s+INTO\s+(\b[A-Z0-9_.]+)\b\s*$/i)
  if (insertTableMatch) {
    dynamicSuggestions.push(
      createCompletionItem(
        '(',
        monaco.languages.CompletionItemKind.Text,
        '(',
        range,
        'Specify columns',
        undefined,
        false,
        'high'
      ),
      createCompletionItem(
        'VALUES',
        monaco.languages.CompletionItemKind.Keyword,
        'VALUES ',
        range,
        'Specify values',
        undefined,
        false,
        'high'
      )
    )
    return dynamicSuggestions
  }
  
  console.log(`动态建议生成完成, 总数: ${dynamicSuggestions.length}`)
  
  return dynamicSuggestions
}

// 导出缓存管理功能
export const SqlCacheManager = {
  // 清除所有缓存
  clearAll(): void {
    sqlCache.clear()
    console.log('已清除所有SQL缓存')
  },
  
  // 清除特定会话的缓存
  clearSession(sessionId: string): void {
    sqlCache.clearSession(sessionId)
    console.log(`已清除会话 ${sessionId} 的缓存`)
  },
  
  // 获取缓存统计信息
  getStats(): { size: number, sessions: Set<string> } {
    return sqlCache.getStats()
  },
  
  // 手动设置列缓存
  setColumnCache(sessionId: string, tableName: string, schemaName: string | undefined, columns: any[], ttl: number = 300000): void {
    const cacheKey = `columns_${sessionId}_${tableName}_${schemaName || 'default'}`
    sqlCache.set(cacheKey, columns, sessionId, ttl)
    console.log(`手动设置了表 ${tableName} 的列缓存`)
  },
  
  // 删除特定表的列缓存
  deleteColumnCache(sessionId: string, tableName: string, schemaName?: string): void {
    const cacheKey = `columns_${sessionId}_${tableName}_${schemaName || 'default'}`
    sqlCache.delete(cacheKey)
    console.log(`已删除表 ${tableName} 的列缓存`)
  },
  
  // 删除表建议缓存
  deleteTableCache(sessionId: string): void {
    const cacheKey = `tables_${sessionId}`
    sqlCache.delete(cacheKey)
    console.log(`已删除会话 ${sessionId} 的表建议缓存`)
  }
} 