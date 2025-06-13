// Monaco 枚举值的常量替代（避免 SSR 问题）
const COMPLETION_ITEM_KIND = {
  Field: 5,
  Function: 3,
  Module: 9,
  Keyword: 14,
  Text: 1
} as const

// --- 预编译正则表达式常量 (性能优化) ---
// SQL 上下文分析相关
const REGEX_AFTER_UNION = /\bUNION\s*(?:ALL\s*)?$/i
const REGEX_AFTER_EXEC = /\bEXEC\s*$/i
const REGEX_SELECT_PATTERNS = [
  /SELECT\s*$/i,
  /SELECT\s+\w*$/i,
  /SELECT\s+TOP\s+\d+\s*$/i,
  /SELECT\s+TOP\s+\d+\s+\w*$/i,
]
const REGEX_AFTER_COMMA = /,\s*$/
const REGEX_AFTER_COMMA_WITH_WORD = /,\s+\w+\s*$/
const REGEX_AFTER_COMMA_IN_SELECT = /,\s*(?:\w+\s*)?$/
const REGEX_DOT_NOTATION = /(\[?([A-Z0-9_]+)\]?)\.\s*$/i

// 修正：将别名匹配前的 \s+ 改为 [ \t]+，防止跨行匹配
const REGEX_FROM_TABLES = /FROM\s+(?:\[([^\]]+)\]\.\[([^\]]+)\]|([^\s\[.]+)\.([^\s\[.]+)|([^\s\[.]+))(?:[ \t]+(?:AS[ \t]+)?([A-Z0-9_]+))?(?=\s|$|;|,|\)|JOIN|WHERE|ORDER|GROUP|HAVING|UNION|LIMIT)/gi
const REGEX_JOIN_TABLES = /(?:INNER|LEFT|RIGHT|FULL|CROSS)?\s*JOIN\s+(?:\[([^\]]+)\]\.\[([^\]]+)\]|([^\s\[.]+)\.([^\s\[.]+)|([^\s\[.]+))(?:\s+(?:AS\s+)?([A-Z0-9_]+))?(?=\s|$|;|,|\)|ON|WHERE|ORDER|GROUP|HAVING|UNION|LIMIT)/gi
const REGEX_UPDATE_TABLES = /UPDATE\s+(?:\[([^\]]+)\]\.\[([^\]]+)\]|([^\s\[.]+)\.([^\s\[.]+)|([^\s\[.]+))(?:\s+(?:AS\s+)?([A-Z0-9_]+))?(?=\s|$|;|,|\)|SET|WHERE|FROM)/gi

// 动态建议生成相关
const REGEX_TABLE_KEYWORD_MATCH = /.*\b(FROM|JOIN|UPDATE)\s*/i
const REGEX_DIRECTLY_AFTER_TABLE_KEYWORD = /\b(?:FROM|(?:INNER|LEFT|RIGHT|FULL|CROSS\s+)?JOIN|UPDATE)\s*(?:[A-Z0-9_\[\].]*)?$/i
const REGEX_HAS_COMPLETE_TABLE_NAME = /\b(?:FROM|(?:INNER|LEFT|RIGHT|FULL|CROSS\s+)?JOIN|UPDATE)\s+(?:\[[^\]]+\]\.\[[^\]]+\]|\w+\.\w+|\[[^\]]+\]|\w+)\s+\w/i
const REGEX_WHERE_CLAUSE = /WHERE\s+(?:.*?\s+(?:AND|OR)\s+)?$/i
const REGEX_UPDATE_SET = /UPDATE\s+(?:\[([^\]]+)\]?\.)??\[?([^\]]+)\]?\s+SET\s+(?:[\w.]+\s*=\s*[^,]+(?:,\s*)?)*(\w*)$/i
const REGEX_INSERT_INTO = /INSERT\s+INTO\s+(?:\[?([^\]]+)\]?\.)??\[?([^\]]+)\]?\s*\(\s*([^)]*)$/i
const REGEX_UPDATE_TABLE = /UPDATE\s+(\b[A-Z0-9_.]+)\b\s*$/i
const REGEX_INSERT_TABLE = /INSERT\s+INTO\s+(\b[A-Z0-9_.]+)\b\s*$/i
const REGEX_COMPLETE_DOT_NOTATION = /\w+\.\w+/
const REGEX_FALLBACK_FROM_MATCH = /FROM\s+(?:\[?([^\]]+)\]?\.)??\[?([^\]]+)\]?/i

// 文本分块相关
const REGEX_SQL_SEPARATOR = /\n\s*\n/g

// EXEC 检测相关
const REGEX_EXEC_WORD_BOUNDARY = /\s/
// --- 预编译正则表达式常量结束 ---

import { debounce } from 'lodash'
import { search_column_details, search_table_names, search_procedure_suggestionitems } from '@/lib/api'
import { persistentCache } from '@/lib/persistentCache'
import { useToast } from '@/hooks/use-toast'

const { toast } = useToast();

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

// 创建防抖的存储过程搜索缓存
interface ProcedureSuggestionCache {
  [key: string]: {
    promise: Promise<any[]>
    timestamp: number
  }
}

const procedureSuggestionCache: ProcedureSuggestionCache = {}
const PROCEDURE_CACHE_TTL = 60000 // 1分钟缓存

// 创建预加载的存储过程缓存
interface PreloadedProcedureCache {
  [sessionId: string]: {
    procedures: any[]
    timestamp: number
    isLoading: boolean
    lastRefreshAttempt?: number  // 新增：最后一次刷新尝试时间
    autoRefreshEnabled?: boolean // 新增：是否启用自动刷新
  }
}

const preloadedProcedureCache: PreloadedProcedureCache = {}
const PRELOAD_CACHE_TTL = 1800000 // 30分钟缓存（从5分钟延长）
const AUTO_REFRESH_THRESHOLD = 1200000 // 20分钟后开始后台自动刷新
const REFRESH_COOLDOWN = 300000 // 5分钟刷新冷却时间

// 新增：后台自动刷新定时器
let autoRefreshTimer: NodeJS.Timeout | null = null

// 启动后台自动刷新机制
function startAutoRefresh(): void {
  if (autoRefreshTimer) return

  autoRefreshTimer = setInterval(() => {
    const now = Date.now()

    Object.entries(preloadedProcedureCache).forEach(([sessionId, cache]) => {
      // 跳过正在加载或未启用自动刷新的会话
      if (cache.isLoading || !cache.autoRefreshEnabled) return

      const timeSinceLastUpdate = now - cache.timestamp
      const timeSinceLastRefresh = now - (cache.lastRefreshAttempt || 0)

      // 如果缓存快过期（超过20分钟）且距离上次刷新尝试超过5分钟
      if (timeSinceLastUpdate > AUTO_REFRESH_THRESHOLD &&
        timeSinceLastRefresh > REFRESH_COOLDOWN) {
        console.log(`后台自动刷新会话 ${sessionId} 的存储过程缓存`)

        // 记录刷新尝试时间
        cache.lastRefreshAttempt = now

        // 异步刷新，不阻塞
        preloadProcedures(sessionId).catch(error => {
          console.warn(`后台自动刷新失败:`, error)
        })
      }
    })
  }, 60000) // 每分钟检查一次
}

// 停止后台自动刷新机制
function stopAutoRefresh(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
}

// 防抖的存储过程搜索函数
const debouncedProcedureSearch = debounce(
  async (sessionId: string, keyword: string, cacheKey: string): Promise<any[]> => {
    console.log(`防抖搜索存储过程: sessionId=${sessionId}, keyword="${keyword}"`)
    try {
      const result = await search_procedure_suggestionitems(sessionId, keyword)

      // 更新缓存
      procedureSuggestionCache[cacheKey] = {
        promise: Promise.resolve(result),
        timestamp: Date.now()
      }

      return result
    } catch (error) {
      console.error('防抖存储过程搜索失败:', error)
      // 清除失败的缓存
      delete procedureSuggestionCache[cacheKey]
      return []
    }
  },
  500 // 500ms 防抖延迟
)

// 预加载存储过程列表（增强版：支持持久化和增量更新）
export async function preloadProcedures(sessionId: string, forceFullReload = false): Promise<void> {
  const cache = preloadedProcedureCache[sessionId]

  // 如果正在加载，跳过
  if (cache?.isLoading) {
    return
  }

  // 如果缓存仍然有效且不是手动刷新，跳过
  if (!forceFullReload && cache && (Date.now() - cache.timestamp < PRELOAD_CACHE_TTL)) {
    return
  }

  // 标记为正在加载
  preloadedProcedureCache[sessionId] = {
    procedures: cache?.procedures || [],
    timestamp: cache?.timestamp || 0,
    isLoading: true,
    lastRefreshAttempt: Date.now(),
    autoRefreshEnabled: true
  }

  try {
    console.log(`预加载会话 ${sessionId} 的存储过程列表...`)

    // 检查是否有持久化缓存可以使用
    const hasRecentCache = !forceFullReload && await persistentCache.shouldPerformIncrementalUpdate(sessionId)

    if (hasRecentCache) {
      console.log(`会话 ${sessionId} 检测到近期持久化缓存，尝试从IndexedDB恢复...`)

      // 从持久化缓存快速恢复
      const cachedProcedures = await persistentCache.searchProcedures(sessionId, '', 100000)

      if (cachedProcedures.length > 0) {
        console.log(`从IndexedDB恢复了 ${cachedProcedures.length} 个存储过程`)

        // 立即更新内存缓存
        preloadedProcedureCache[sessionId] = {
          procedures: cachedProcedures,
          timestamp: Date.now(),
          isLoading: false,
          lastRefreshAttempt: Date.now(),
          autoRefreshEnabled: true
        }

        // 后台进行增量更新检查
        setTimeout(async () => {
          try {
            console.log(`后台进行增量更新检查: ${sessionId}`)
            await performIncrementalUpdate(sessionId)
          } catch (error) {
            console.warn('后台增量更新失败:', error)
          }
        }, 1000) // 1秒后开始增量更新

        startAutoRefresh()
        return
      }
    }

    // 全量加载（首次或强制刷新）
    console.log(`进行全量预加载: ${sessionId}`)
    const allProcedures = await search_procedure_suggestionitems(sessionId, '')

    // 转换格式并生成校验和（精简版）
    const proceduresWithMetadata = allProcedures.map(proc => ({
      id: `${proc.schema_name}.${proc.name}`,
      name: proc.name,
      schema_name: proc.schema_name,
      full_name: proc.full_name || `[${proc.schema_name}].[${proc.name}]`,
      execute_template: proc.execute_template || '', // 包含所有必要信息
      lastModified: new Date().toISOString(),
      checksum: generateChecksumForProcedure(proc)
    }))

    // 更新内存缓存
    preloadedProcedureCache[sessionId] = {
      procedures: proceduresWithMetadata,
      timestamp: Date.now(),
      isLoading: false,
      lastRefreshAttempt: Date.now(),
      autoRefreshEnabled: true
    }


    // 异步保存到持久化缓存
    setTimeout(async () => {
      try {
        const result = await persistentCache.performIncrementalUpdate(
          sessionId,
          proceduresWithMetadata,
          (progress) => {
            console.log(`持久化进度: ${progress.action} ${progress.current}/${progress.total}`)
          }
        )
        console.log(`持久化完成: 新增${result.added}, 更新${result.updated}, 删除${result.deleted}`)

        console.log(`会话 ${sessionId} 存储过程定义预热完成！`)
      } catch (error) {
        console.warn('持久化保存失败:', error)
      }
    }, 100)

    console.log(`成功预加载 ${proceduresWithMetadata.length} 个存储过程`)
    startAutoRefresh()

  } catch (error) {
    console.error('预加载存储过程失败:', error)
    // 保持旧数据，但标记为未加载状态
    if (preloadedProcedureCache[sessionId]) {
      preloadedProcedureCache[sessionId].isLoading = false
      preloadedProcedureCache[sessionId].lastRefreshAttempt = Date.now()
    }
  }
}

// 增量更新函数
async function performIncrementalUpdate(sessionId: string): Promise<void> {
  try {
    console.log(`开始增量更新: ${sessionId}`)

    // 获取最新的存储过程列表
    const latestProcedures = await search_procedure_suggestionitems(sessionId, '')

    // 转换格式（精简版）
    const proceduresWithMetadata = latestProcedures.map(proc => ({
      id: `${proc.schema_name}.${proc.name}`,
      name: proc.name,
      schema_name: proc.schema_name,
      full_name: proc.full_name || `[${proc.schema_name}].[${proc.name}]`,
      execute_template: proc.execute_template || '', // 包含所有必要信息
      lastModified: new Date().toISOString(),
      checksum: generateChecksumForProcedure(proc)
    }))

    // 执行增量更新
    const result = await persistentCache.performIncrementalUpdate(
      sessionId,
      proceduresWithMetadata,
      (progress) => {
        console.log(`增量更新进度: ${progress.action} ${progress.current}/${progress.total}`)
      }
    )

    console.log(`增量更新完成: 新增${result.added}, 更新${result.updated}, 删除${result.deleted}`)
    //toast.success(`存储过程缓存增量更新完成: 新增${result.added}, 更新${result.updated}, 删除${result.deleted}`)

    // 如果有变化，更新内存缓存
    if (result.added > 0 || result.updated > 0 || result.deleted > 0) {
      preloadedProcedureCache[sessionId] = {
        procedures: proceduresWithMetadata,
        timestamp: Date.now(),
        isLoading: false,
        lastRefreshAttempt: Date.now(),
        autoRefreshEnabled: true
      }

      console.log(`内存缓存已更新，共 ${proceduresWithMetadata.length} 个存储过程`)
    }

  } catch (error) {
    console.error('增量更新失败:', error)
  }
}

// 生成存储过程校验和
function generateChecksumForProcedure(proc: any): string {
  const content = `${proc.name}${proc.schema_name}${proc.execute_template || ''}${JSON.stringify(proc.parameters || [])}`
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(36)
}

// 同步过滤存储过程建议（优化缓存过期处理）
function filterProceduresSynchronously(sessionId: string, keyword: string): any[] {
  const cache = preloadedProcedureCache[sessionId]

  if (!cache || cache.isLoading) {
    // 如果缓存不存在或正在加载，触发预加载但返回空结果
    if (!cache?.isLoading) {
      // 使用setTimeout确保完全异步，不阻塞当前调用栈
      setTimeout(() => {
        preloadProcedures(sessionId).catch(console.error)
      }, 0)
    }
    return []
  }

  const now = Date.now()
  const timeSinceLastUpdate = now - cache.timestamp

  // 检查缓存是否即将过期（提前5分钟开始后台刷新）
  if (timeSinceLastUpdate > (PRELOAD_CACHE_TTL - 300000)) {
    // 后台刷新缓存，但继续返回当前数据
    const timeSinceLastRefresh = now - (cache.lastRefreshAttempt || 0)
    if (timeSinceLastRefresh > REFRESH_COOLDOWN) {
      console.log('缓存即将过期，触发后台刷新')
      // 使用setTimeout确保完全异步，不阻塞当前调用栈
      setTimeout(() => {
        preloadProcedures(sessionId).catch(console.error)
      }, 0)
    }
  }

  const procedures = cache.procedures || []

  if (!keyword.trim()) {
    return procedures
  }

  // 同步过滤：先按名称精确匹配，再按名称模糊匹配，最后按schema匹配
  const exactNameMatches = procedures.filter(proc =>
    proc.name.toLowerCase().startsWith(keyword.toLowerCase())
  )

  const fuzzyNameMatches = procedures.filter(proc =>
    !proc.name.toLowerCase().startsWith(keyword.toLowerCase()) &&
    proc.name.toLowerCase().includes(keyword.toLowerCase())
  )

  const schemaMatches = procedures.filter(proc =>
    !proc.name.toLowerCase().includes(keyword.toLowerCase()) &&
    proc.schema_name.toLowerCase().includes(keyword.toLowerCase())
  )

  // 合并结果
  const allMatches = [...exactNameMatches, ...fuzzyNameMatches, ...schemaMatches]
  return allMatches
}

// 获取存储过程建议的统一函数（改为同步过滤 + 异步预加载）
async function getProcedureSuggestions(sessionId: string, keyword: string): Promise<any[]> {
  // 首先尝试同步过滤
  const syncResults = filterProceduresSynchronously(sessionId, keyword)

  // 如果同步过滤有结果，直接返回
  if (syncResults.length > 0) {
    console.log(`同步返回 ${syncResults.length} 个存储过程建议: ${keyword}`)
    return syncResults
  }

  // 如果同步过滤没有结果，检查是否需要触发预加载
  const cache = preloadedProcedureCache[sessionId]
  if (!cache || (!cache.isLoading && Date.now() - cache.timestamp > PRELOAD_CACHE_TTL)) {
    // 触发预加载，但不等待结果（避免阻塞UI）
    setTimeout(() => {
      preloadProcedures(sessionId).then(() => {
        console.log('预加载完成，下次输入将显示建议')
      }).catch(console.error)
    }, 0)
  }

  // 如果确实没有缓存数据且有具体搜索词，回退到原来的异步搜索
  if (keyword.trim() && (!cache || cache.procedures.length === 0)) {
    console.log(`回退到异步搜索: ${keyword}`)
    const cacheKey = `${sessionId}_${keyword}`

    try {
      // 使用原来的防抖搜索作为回退
      const cached = procedureSuggestionCache[cacheKey]
      if (cached && (Date.now() - cached.timestamp) < PROCEDURE_CACHE_TTL) {
        return await cached.promise
      }

      const searchPromise = search_procedure_suggestionitems(sessionId, keyword)
      procedureSuggestionCache[cacheKey] = {
        promise: searchPromise,
        timestamp: Date.now()
      }

      return await searchPromise
    } catch (error) {
      console.error('异步搜索失败:', error)
      return []
    }
  }

  return []
}

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

// 建议项创建函数类型 - 更新为可选的 monaco 类型
export type CreateCompletionItemFunction = (
  label: string,
  kind: any, // 使用 any 替代具体的 monaco 类型以避免 SSR 问题
  insertText: string,
  range: any, // 使用 any 替代具体的 monaco 类型
  detail?: string,
  documentation?: string,
  isSnippet?: boolean,
  priority?: 'high' | 'medium' | 'low'
) => any // 返回类型也使用 any

// 解析SQL中的表和别名 - 暴力解析所有表
export function parseTablesAndAliases(sql: string): ParsedTable[] {
  const tables: ParsedTable[] = []
  const addedTables = new Set<string>() // 避免重复表

  console.log('暴力解析所有SQL中的表:', sql.length > 200 ? sql.substring(0, 200) + '...' : sql)

  // 性能保护：限制SQL长度
  if (sql.length > 50000) {
    console.warn(`SQL过长 (${sql.length} 字符)，限制为前50000字符`)
    sql = sql.substring(0, 50000)
  }

  // 直接在完整SQL中查找所有表，不分语句
  const upperSql = sql.toUpperCase()

  // SQL关键字列表，用于避免误识别
  const sqlKeywords = new Set([
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS',
    'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'LIKE', 'BETWEEN', 'ORDER', 'BY',
    'GROUP', 'HAVING', 'UNION', 'ALL', 'DISTINCT', 'TOP', 'CASE', 'WHEN', 'THEN',
    'ELSE', 'END', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP',
    'VALUES', 'SET', 'AS', 'LIMIT', 'OFFSET', 'WITH', 'CTE'
  ])

  try {
    // 使用预编译的正则表达式进行表解析（性能优化）
    // 注意：matchAll 需要重置正则表达式的 lastIndex
    REGEX_FROM_TABLES.lastIndex = 0
    const fromMatches = upperSql.matchAll(REGEX_FROM_TABLES)
    // 在 parseTablesAndAliases 函数的 for 循环中
    for (const match of fromMatches) {
      // --- 在这里添加或修改日志 ---
      console.log('--- 开始处理一个新匹配 ---');
      const table = parseTableMatch(match, sqlKeywords)

      // 1. 打印 parseTableMatch 的直接返回值
      console.log('DEBUG [1/3]: parseTableMatch 返回的对象是:', table);

      if (table) {
        const tableKey = `${table.schema || ''}.${table.name}`

        // 2. 打印生成的 tableKey 和检查结果
        console.log(`DEBUG [2/3]: 生成的 tableKey 是 "${tableKey}". addedTables 中是否已存在?`, addedTables.has(tableKey));

        if (!addedTables.has(tableKey)) {
          // 3. 打印即将添加的信息
          console.log('DEBUG [3/3]: tableKey 不存在，准备添加到 suggestions 数组中。');
          addedTables.add(tableKey)
          tables.push(table)
        } else {
          console.log('DEBUG [x/3]: tableKey 已存在，跳过添加。');
        }
      } else {
        console.log('DEBUG [x/3]: parseTableMatch 返回了 null，跳过。');
      }
    }

    // 匹配所有 JOIN 子句中的表
    REGEX_JOIN_TABLES.lastIndex = 0
    const joinMatches = upperSql.matchAll(REGEX_JOIN_TABLES)
    for (const match of joinMatches) {
      const table = parseTableMatch(match, sqlKeywords)
      if (table) {
        const tableKey = `${table.schema || ''}.${table.name}`
        if (!addedTables.has(tableKey)) {
          addedTables.add(tableKey)
          tables.push(table)
        }
      }
    }

    // 匹配所有 UPDATE 语句中的表
    REGEX_UPDATE_TABLES.lastIndex = 0
    const updateMatches = upperSql.matchAll(REGEX_UPDATE_TABLES)
    for (const match of updateMatches) {
      const table = parseTableMatch(match, sqlKeywords)
      if (table) {
        const tableKey = `${table.schema || ''}.${table.name}`
        if (!addedTables.has(tableKey)) {
          addedTables.add(tableKey)
          tables.push(table)
        }
      }
    }

  } catch (error) {
    console.error('表解析过程中发生错误:', error)
    // 继续执行，返回已解析的表
  }

  console.log('解析到的所有表:', tables.length > 10 ? `${tables.length}个表` : tables)
  return tables
}

// 解析单个表匹配结果 - 添加SQL关键字检查
function parseTableMatch(match: RegExpMatchArray, sqlKeywords: Set<string>): ParsedTable | null {
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

  // 检查表名是否为SQL关键字，如果是则跳过
  if (sqlKeywords.has(tableName.toUpperCase())) {
    console.log(`跳过SQL关键字: ${tableName}`)
    return null
  }

  // 检查别名是否为SQL关键字，如果是则清除别名
  if (alias && sqlKeywords.has(alias.toUpperCase())) {
    console.log(`清除SQL关键字别名: ${alias}`)
    alias = undefined
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

// 辅助函数：根据光标位置找到当前的SQL语句块
function findCurrentSqlStatementBlock(fullText: string, cursorPosition: number): string {
  if (!fullText) return "";

  const normalizedFullText = fullText.replace(/\r\n/g, '\n');
  // 使用预编译的正则表达式匹配一个或多个空行（性能优化）
  // 分隔符是两个或多个换行符，中间可能只有空格/制表符
  const separators = [];
  REGEX_SQL_SEPARATOR.lastIndex = 0; // 重置全局正则的状态
  let match;
  while ((match = REGEX_SQL_SEPARATOR.exec(normalizedFullText)) !== null) {
    separators.push({ index: match.index, length: match[0].length });
  }

  let startOffset = 0;
  for (const sep of separators) {
    const endOffset = sep.index;
    // 如果光标在这个块内 (从startOffset到块的末尾)
    if (cursorPosition >= startOffset && cursorPosition <= endOffset) {
      return normalizedFullText.substring(startOffset, endOffset);
    }
    // 如果光标恰好在分隔符内，通常认为它属于前一个块的末尾或下一个块的开头
    // 为了简化，我们将其归于前一个块，或者可以根据具体编辑器行为调整
    if (cursorPosition > endOffset && cursorPosition < (sep.index + sep.length)) {
      return normalizedFullText.substring(startOffset, endOffset); // 光标在分隔符中，取前一个块
    }
    startOffset = sep.index + sep.length; // 下一个块的开始
  }

  // 如果光标在最后一个块中，或者没有分隔符（整个文本是一个块）
  if (cursorPosition >= startOffset && cursorPosition <= normalizedFullText.length) {
    return normalizedFullText.substring(startOffset);
  }

  // 如果光标位置异常 (例如 > fullText.length)，或者文本为空但光标位置为0
  // 返回整个文本作为最后的保障，尽管这可能意味着块定位逻辑需要审查特定边缘案例
  console.warn("findCurrentSqlStatementBlock: Cursor position might be out of typical range or block logic needs review for this case. Falling back to full text for block.");
  return normalizedFullText;
}

// 分析SQL上下文 - 简化逻辑
export function analyzeSqlContext(textBeforeCursor: string): SqlContext {
  console.log('分析SQL上下文, textBeforeCursor末尾50字符:', textBeforeCursor.slice(-50))

  // 性能保护：限制分析的文本长度
  if (textBeforeCursor.length > 10000) {
    console.warn('文本过长，只分析最后10000字符')
    textBeforeCursor = textBeforeCursor.slice(-10000)
  }

  // 简单检测是否在SELECT语句中
  const isInSelectStatement = textBeforeCursor.toUpperCase().includes('SELECT')

  // 检测是否在UNION后 - 特殊处理
  const isAfterUnion = REGEX_AFTER_UNION.test(textBeforeCursor)
  if (isAfterUnion) {
    console.log('检测到在UNION后，返回特殊上下文')
    return {
      isInSelectStatement: true,
      isDirectlyAfterSelect: true, // UNION后类似于SELECT后
      isAfterCommaInSelect: false,
      isAfterSelectOrComma: true,
      isDotNotation: false,
      dotTableOrAlias: undefined
    }
  }

  // 检测是否在EXEC后 - 特殊处理
  const isAfterExec = REGEX_AFTER_EXEC.test(textBeforeCursor)
  if (isAfterExec) {
    console.log('检测到在EXEC后，返回特殊上下文')
    return {
      isInSelectStatement: false,
      isDirectlyAfterSelect: false,
      isAfterCommaInSelect: false,
      isAfterSelectOrComma: false,
      isDotNotation: false,
      dotTableOrAlias: undefined
    }
  }

  // 使用更安全的正则表达式，避免回溯爆炸
  const selectPatterns = REGEX_SELECT_PATTERNS

  // 改进的逗号检测逻辑：检测用户是否可能在SELECT字段列表中的逗号后
  let isAfterCommaInSelect = false
  if (isInSelectStatement) {
    // 检查SELECT字段列表中是否包含逗号
    const selectClauseMatch = textBeforeCursor.match(/SELECT\s+(.*?)(?:\s+FROM\s+|\s+WHERE\s+|\s+GROUP\s+|\s+ORDER\s+|\s+HAVING\s+|$)/i)

    if (selectClauseMatch) {
      const selectFieldsPart = selectClauseMatch[1]

      // 如果SELECT字段部分包含逗号，认为用户可能在字段列表中
      if (selectFieldsPart.includes(',')) {
        isAfterCommaInSelect = true
        console.log('检测到SELECT字段列表中的逗号:', { selectFieldsPart })
      }
    }
  }

  // 简化的SELECT后检测
  const isDirectlyAfterSelect = selectPatterns.some(pattern => {
    try {
      return pattern.test(textBeforeCursor)
    } catch (error) {
      console.warn('正则表达式执行错误:', error)
      return false
    }
  })

  const isAfterSelectOrComma = isDirectlyAfterSelect || isAfterCommaInSelect

  // 检测点号后的情况
  const dotMatch = textBeforeCursor.match(REGEX_DOT_NOTATION)
  const isDotNotation = !!dotMatch
  const dotTableOrAlias = dotMatch ? dotMatch[2] : undefined

  console.log('SQL上下文分析结果:', {
    isInSelectStatement,
    isDirectlyAfterSelect,
    isAfterCommaInSelect,
    isAfterSelectOrComma,
    isDotNotation,
    dotTableOrAlias,
    isAfterUnion,
    textEnd: textBeforeCursor.slice(-50) // 显示最后50个字符用于调试
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
  range?: any, // 使用 any 替代具体的 monaco 类型
  tableDisplayName?: string // 新增：用于在建议项中显示的表名
): Promise<any[]> {
  const suggestions: any[] = []
  const addedColumns = new Set<string>()

  // 生成缓存key：sessionId + tableName + schema
  const cacheKey = `columns_${sessionId}_${tableOrAlias}_${schemaName || 'default'}`

  try {
    // --- 新增日志 ---
    console.log(`🔷 [A] getColumnSuggestions 开始执行，上下文: ${context}, 表: ${tableOrAlias}, 缓存Key: ${cacheKey}`)
    const cachedColumns = sqlCache.get(cacheKey, sessionId)

    let columns = cachedColumns
    if (cachedColumns) {
      console.log(`缓存命中! 表 ${tableOrAlias} 的列信息来自缓存 (${context})`)
      columns = cachedColumns
    } else {
      console.log(`缓存未命中，准备调用 API: search_column_details`) // 已有日志
      columns = await search_column_details(sessionId, tableOrAlias, schemaName)
      console.log(`🔷 [B] API search_column_details 返回结果:`, columns)
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
            COMPLETION_ITEM_KIND.Field,
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
    console.error(`❌ [C] getColumnSuggestions 内部发生严重错误:`, error)
    // 如果API调用失败，清除可能的错误缓存
    sqlCache.delete(cacheKey)
  }

  return suggestions
}

// 获取表建议
export async function getTableSuggestions(
  sessionId: string,
  createCompletionItem: CreateCompletionItemFunction,
  range: any // 使用 any 替代具体的 monaco 类型
): Promise<any[]> {
  const suggestions: any[] = []

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
              COMPLETION_ITEM_KIND.Module,
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
  range: any // 使用 any 替代具体的 monaco 类型
): Promise<any[]> {
  const dynamicSuggestions: any[] = []

  // 性能保护：限制处理的文本长度，防止超大SQL文件导致性能问题
  const maxTextLength = 50000 // 50KB 限制
  if (fullText.length > maxTextLength) {
    console.warn(`SQL文本过长 (${fullText.length} 字符)，限制为前 ${maxTextLength} 字符`)
    fullText = fullText.substring(0, maxTextLength)
  }

  // 性能保护：添加超时控制
  const startTime = Date.now()
  const maxProcessingTime = 5000 // 5秒超时

  const checkTimeout = () => {
    if (Date.now() - startTime > maxProcessingTime) {
      console.warn('动态建议生成超时，停止处理')
      throw new Error('Completion generation timeout')
    }
  }

  try {
    // 暴力解析所有表
    checkTimeout()
    const allTables = parseTablesAndAliases(fullText)
    console.log('暴力解析到的所有表:', allTables)

    // 性能保护：限制表的数量
    const maxTables = 20 // 最多处理20个表
    if (allTables.length > maxTables) {
      console.warn(`表数量过多 (${allTables.length})，限制为前 ${maxTables} 个表`)
      allTables.splice(maxTables)
    }

    checkTimeout()

    // 找到最后一个EXEC关键字，支持多个EXEC语句的情况
    const upperTextBeforeCursor = textBeforeCursor.toUpperCase()
    const lastExecIndex = upperTextBeforeCursor.lastIndexOf('EXEC')

    if (lastExecIndex !== -1) {
      // 确保是一个完整的EXEC关键字（前后是边界）
      const beforeExec = lastExecIndex > 0 ? upperTextBeforeCursor.charAt(lastExecIndex - 1) : ' '
      const afterExecKeyword = lastExecIndex + 4 < upperTextBeforeCursor.length ?
        upperTextBeforeCursor.charAt(lastExecIndex + 4) : ' '

      const isWordBoundary = REGEX_EXEC_WORD_BOUNDARY.test(beforeExec) && (REGEX_EXEC_WORD_BOUNDARY.test(afterExecKeyword) || lastExecIndex + 4 === upperTextBeforeCursor.length)

      if (isWordBoundary) {
        const afterExec = textBeforeCursor.substring(lastExecIndex + 4).trim()

        console.log('检测到 EXEC 关键字，提供存储过程建议', {
          lastExecIndex,
          afterExec,
          textEnd: textBeforeCursor.slice(-30)
        })
        const keywordAfterExec = afterExec

        try {
          const procedureSuggestions = await getProcedureSuggestions(sessionId, keywordAfterExec)
          console.log(`获取到 ${procedureSuggestions.length} 个存储过程建议`)

          // 生成存储过程建议项
          procedureSuggestions.forEach(proc => {
            if (proc && proc.name && createCompletionItem && range) {
              const insertText = proc.execute_template

              // 构建详细的documentation（兼容持久化缓存数据）
              let documentation = `存储过程: ${proc.full_name || proc.name}\n`

              // 检查是否有parameters字段（API数据有，持久化缓存数据没有）
              if (proc.parameters && Array.isArray(proc.parameters)) {
                if (proc.parameters.length > 0) {
                  documentation += `\n参数:\n`
                  proc.parameters.forEach((param: any) => {
                    const outputLabel = param.is_output ? ' (OUTPUT)' : ''
                    const defaultLabel = param.has_default ? ' (可选)' : ' (必需)'
                    documentation += `  ${param.name}: ${param.data_type}${outputLabel}${defaultLabel}\n`
                  })
                } else {
                  documentation += `\n无参数`
                }
              } else {
                // 持久化缓存数据，参数信息已包含在execute_template中
                documentation += `\n参数信息包含在执行模板中`
              }

              dynamicSuggestions.push(createCompletionItem(
                proc.name,
                COMPLETION_ITEM_KIND.Function,
                insertText,
                range,
                `${proc.schema_name}`, // detail显示schema
                documentation,
                true, // 这是一个snippet
                'high'
              ))
            }
          })

          // 如果找到存储过程建议，直接返回，不继续其他建议逻辑
          if (dynamicSuggestions.length > 0) {
            console.log(`EXEC: 返回 ${dynamicSuggestions.length} 个存储过程建议`)
            return dynamicSuggestions
          }
        } catch (error) {
          console.error('获取存储过程建议失败:', error)
          // 继续执行其他建议逻辑
        }
      }
    }

    // 1. 表建议（在 FROM, JOIN, UPDATE 后）

    // 检测是否在UNION后 - 特殊处理，不返回表建议
    const isAfterUnion = REGEX_AFTER_UNION.test(textBeforeCursor)
    if (!isAfterUnion) {
      // 重要修复：如果在SELECT语句的逗号后，优先列建议而不是表建议
      const isAfterCommaInSelectContext = sqlContext.isInSelectStatement && (
        REGEX_AFTER_COMMA.test(textBeforeCursor) ||
        REGEX_AFTER_COMMA_WITH_WORD.test(textBeforeCursor)
      )

      if (/\b(FROM|JOIN|UPDATE)\s*$/.test(upperTextBeforeCursor)) {
        // 如果文本以 FROM/JOIN/UPDATE 结尾（允许没有末尾空格）
        // 直接提供表建议
        const tableSuggestions = await getTableSuggestions(sessionId, createCompletionItem, range);
        return tableSuggestions;
      }

      // 更精确的表建议检测：只在真正需要表名的位置触发，且不在逗号后
      // 匹配：FROM table_name, JOIN table_name, UPDATE table_name 等模式
      const isDirectlyAfterTableKeyword = REGEX_DIRECTLY_AFTER_TABLE_KEYWORD.test(textBeforeCursor)

      if (isDirectlyAfterTableKeyword && !isAfterCommaInSelectContext) {
        // 检查是否已经有完整的表名（排除已完成的表名输入）
        const hasCompleteTableName = REGEX_HAS_COMPLETE_TABLE_NAME.test(textBeforeCursor)

        if (!hasCompleteTableName) {
          console.log('触发表建议 (精确匹配):', {
            textEnd: textBeforeCursor.slice(-50),
            isDirectlyAfterTableKeyword,
            hasCompleteTableName,
            isAfterCommaInSelectContext
          })
          const tableSuggestions = await getTableSuggestions(sessionId, createCompletionItem, range)
          dynamicSuggestions.push(...tableSuggestions)
          return dynamicSuggestions // 只返回表建议
        }
      }
    }

    // 1.5. UNION后的SELECT建议 - 添加SELECT关键字建议
    if (isAfterUnion) {
      console.log('检测到UNION后，添加SELECT建议')
      dynamicSuggestions.push(createCompletionItem(
        'SELECT',
        COMPLETION_ITEM_KIND.Keyword,
        'SELECT ',
        range,
        'SQL SELECT keyword',
        'Start a new SELECT statement after UNION',
        false,
        'high'
      ))
      // 不返回，继续处理其他可能的建议
    }

    checkTimeout()

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

    checkTimeout()

    // 3. SELECT 子句中的列建议 - 暴力加载所有表的列
    if (sqlContext.isAfterSelectOrComma) {
      console.log('✅ [1/4] 进入 SELECT/Comma 子句处理分支。')

      // 添加 * 选项
      dynamicSuggestions.push(createCompletionItem(
        '*',
        COMPLETION_ITEM_KIND.Field,
        '* ',
        range,
        'Select all columns',
        'Select all columns from all tables',
        false,
        'high'
      ))

      if (allTables.length > 0) {// --- 新增日志 ---
        console.log(`[2/4] 检测到 ${allTables.length} 个表，准备循环获取列。`, allTables)

        // 遍历所有表，加载每个表的列建议
        for (let i = 0; i < allTables.length; i++) {
          checkTimeout() // 每个表处理前检查超时

          const table = allTables[i]
          const tableDisplayName = table.schema ? `[${table.schema}].[${table.name}]` : table.name
          console.log(`[3/4] 正在为表: ${tableDisplayName} 调用 getColumnSuggestions...`)

          const columnSuggestions = await getColumnSuggestions(
            sessionId,
            table.name,
            'SELECT clause',
            table.schema,
            createCompletionItem,
            range,
            tableDisplayName
          )
          // --- 新增日志 ---
          console.log(`[4/4] 表 ${tableDisplayName} 返回了 ${columnSuggestions.length} 个建议。`)
          dynamicSuggestions.push(...columnSuggestions)
        }

        console.log(`SELECT子句: 总共加载了 ${dynamicSuggestions.length - 1} 个列建议 (除去*)`)
      } else {
        // --- 新增日志 ---
        console.log('❌ 未检测到任何表，尝试 Fallback 逻辑。')
        const partialFromMatch = textBeforeCursor.match(REGEX_FALLBACK_FROM_MATCH)
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

    checkTimeout()

    // 4. WHERE 子句 - 暴力加载所有表的列
    const whereClauseMatch = textBeforeCursor.match(REGEX_WHERE_CLAUSE)
    if (whereClauseMatch && allTables.length > 0) {
      console.log('WHERE子句检测，暴力加载所有表的列')

      for (let i = 0; i < allTables.length; i++) {
        checkTimeout() // 每个表处理前检查超时

        const table = allTables[i]
        const tableDisplayName = table.schema ? `[${table.schema}].[${table.name}]` : table.name
        console.log(`加载表 ${tableDisplayName} 的列建议 (WHERE) (${i + 1}/${allTables.length})`)

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
    const updateSetMatch = textBeforeCursor.match(REGEX_UPDATE_SET)
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
    checkTimeout()
    const insertColumnsMatch = textBeforeCursor.match(REGEX_INSERT_INTO)
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
    checkTimeout()
    const updateTableMatch = textBeforeCursor.match(REGEX_UPDATE_TABLE)
    if (updateTableMatch) {
      dynamicSuggestions.push(createCompletionItem(
        'SET',
        COMPLETION_ITEM_KIND.Keyword,
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
    checkTimeout()
    const insertTableMatch = textBeforeCursor.match(REGEX_INSERT_TABLE)
    if (insertTableMatch) {
      dynamicSuggestions.push(
        createCompletionItem(
          '(',
          COMPLETION_ITEM_KIND.Text,
          '(',
          range,
          'Specify columns',
          undefined,
          false,
          'high'
        ),
        createCompletionItem(
          'VALUES',
          COMPLETION_ITEM_KIND.Keyword,
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
  } catch (error) {
    console.error("Error generating dynamic suggestions:", error)
    return []
  }
}

// 导出缓存管理功能
export const SqlCacheManager = {
  // 清除所有缓存
  clearAll(): void {
    sqlCache.clear()
    // 清除存储过程建议缓存
    Object.keys(procedureSuggestionCache).forEach(key => {
      delete procedureSuggestionCache[key]
    })
    // 清除预加载缓存
    Object.keys(preloadedProcedureCache).forEach(key => {
      delete preloadedProcedureCache[key]
    })
    // 停止自动刷新
    stopAutoRefresh()
    console.log('已清除所有SQL缓存、存储过程建议缓存和预加载缓存')
  },

  // 清除特定会话的缓存
  clearSession(sessionId: string): void {
    sqlCache.clearSession(sessionId)
    // 清除特定会话的存储过程建议缓存
    Object.keys(procedureSuggestionCache).forEach(key => {
      if (key.startsWith(`${sessionId}_`)) {
        delete procedureSuggestionCache[key]
      }
    })
    // 清除特定会话的预加载缓存
    if (preloadedProcedureCache[sessionId]) {
      delete preloadedProcedureCache[sessionId]
    }
    console.log(`已清除会话 ${sessionId} 的所有缓存`)
  },

  // 获取缓存统计信息（增强版：包含持久化统计）
  async getStats(): Promise<{
    size: number,
    sessions: Set<string>,
    procedureCacheSize: number,
    preloadedSessions: string[],
    preloadedTotal: number,
    autoRefreshActive: boolean,
    persistent: {
      totalProcedures: number,
      sessions: number,
      dbSizeMB: number,
      maxSizeMB: number,
      usagePercentage: number,
      lastUpdated: Date,
      sessionDetails: Array<{
        sessionId: string,
        sizeMB: number,
        lastAccessed: Date,
        procedureCount: number
      }>
    }
  }> {
    const stats = sqlCache.getStats()
    const preloadedSessions = Object.keys(preloadedProcedureCache)
    const preloadedTotal = Object.values(preloadedProcedureCache)
      .reduce((total, cache) => total + cache.procedures.length, 0)

    // 获取持久化缓存统计
    let persistentStats
    try {
      persistentStats = await persistentCache.getStats()
    } catch (error) {
      console.warn('获取持久化缓存统计失败:', error)
      persistentStats = {
        totalProcedures: 0,
        sessions: 0,
        dbSizeMB: 0,
        maxSizeMB: 100,
        usagePercentage: 0,
        lastUpdated: new Date(),
        sessionDetails: []
      }
    }

    return {
      ...stats,
      procedureCacheSize: Object.keys(procedureSuggestionCache).length,
      preloadedSessions,
      preloadedTotal,
      autoRefreshActive: autoRefreshTimer !== null,
      persistent: persistentStats
    }
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
  },

  // 清除存储过程建议缓存
  clearProcedureCache(): void {
    Object.keys(procedureSuggestionCache).forEach(key => {
      delete procedureSuggestionCache[key]
    })
    console.log('已清除所有存储过程建议缓存')
  },

  // 取消防抖，立即执行挂起的搜索
  flushProcedureSearch(): void {
    debouncedProcedureSearch.flush()
    console.log('已强制执行挂起的存储过程搜索')
  },

  // 新增：手动触发预加载存储过程
  async preloadProceduresForSession(sessionId: string): Promise<boolean> {
    try {
      await preloadProcedures(sessionId)
      return true
    } catch (error) {
      console.error(`预加载会话 ${sessionId} 的存储过程失败:`, error)
      return false
    }
  },

  // 新增：清除预加载缓存
  clearPreloadCache(sessionId?: string): void {
    if (sessionId) {
      if (preloadedProcedureCache[sessionId]) {
        delete preloadedProcedureCache[sessionId]
        console.log(`已清除会话 ${sessionId} 的预加载缓存`)
      }
    } else {
      Object.keys(preloadedProcedureCache).forEach(key => {
        delete preloadedProcedureCache[key]
      })
      stopAutoRefresh()
      console.log('已清除所有预加载缓存并停止自动刷新')
    }
  },

  // 新增：检查预加载状态（增强版）
  getPreloadStatus(sessionId: string): {
    isLoaded: boolean,
    isLoading: boolean,
    procedureCount: number,
    lastUpdate: Date | null,
    cacheAge: number,
    willExpireIn: number,
    autoRefreshEnabled: boolean
  } {
    const cache = preloadedProcedureCache[sessionId]
    if (!cache) {
      return {
        isLoaded: false,
        isLoading: false,
        procedureCount: 0,
        lastUpdate: null,
        cacheAge: 0,
        willExpireIn: 0,
        autoRefreshEnabled: false
      }
    }

    const now = Date.now()
    const cacheAge = now - cache.timestamp
    const willExpireIn = Math.max(0, PRELOAD_CACHE_TTL - cacheAge)

    return {
      isLoaded: !cache.isLoading && cache.procedures.length > 0,
      isLoading: cache.isLoading,
      procedureCount: cache.procedures.length,
      lastUpdate: cache.timestamp > 0 ? new Date(cache.timestamp) : null,
      cacheAge,
      willExpireIn,
      autoRefreshEnabled: cache.autoRefreshEnabled || false
    }
  },

  // 新增：强制刷新预加载缓存（增强版）
  async refreshPreloadCache(sessionId: string): Promise<boolean> {
    // 禁用自动刷新
    if (preloadedProcedureCache[sessionId]) {
      preloadedProcedureCache[sessionId].autoRefreshEnabled = false
    }

    // 清除现有缓存
    if (preloadedProcedureCache[sessionId]) {
      delete preloadedProcedureCache[sessionId]
    }

    // 重新预加载
    const success = await this.preloadProceduresForSession(sessionId)

    // 重新启用自动刷新
    if (preloadedProcedureCache[sessionId]) {
      preloadedProcedureCache[sessionId].autoRefreshEnabled = true
    }

    return success
  },

  // 新增：启用/禁用自动刷新
  setAutoRefresh(sessionId: string, enabled: boolean): void {
    if (preloadedProcedureCache[sessionId]) {
      preloadedProcedureCache[sessionId].autoRefreshEnabled = enabled
      console.log(`会话 ${sessionId} 的自动刷新已${enabled ? '启用' : '禁用'}`)

      if (enabled) {
        startAutoRefresh()
      }
    }
  },

  // 新增：预热缓存（仅为活动会话预加载）
  async warmupActiveSession(sessionId: string): Promise<boolean> {
    console.log(`预热活动会话缓存: ${sessionId}`)
    return await this.preloadProceduresForSession(sessionId)
  }
} 