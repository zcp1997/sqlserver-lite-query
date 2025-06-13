import { persistentCache } from '@/lib/persistentCache'
import { search_procedure_suggestionitems } from '@/lib/api';
import { debounce } from 'lodash'

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
  },

  // 获取存储过程建议（优先从缓存获取）
  getProcedureSuggestions
} 

// 导出 getProcedureSuggestions 函数
export { getProcedureSuggestions }