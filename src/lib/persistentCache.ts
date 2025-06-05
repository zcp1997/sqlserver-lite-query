// 持久化缓存管理器 - IndexedDB + 增量更新
interface StoredProcedure {
  id: string // schema.name 作为唯一标识
  name: string
  schema_name: string
  parameters?: any[]
  description?: string
  definition?: string // 存储过程定义
  lastModified?: string // 最后修改时间
  checksum?: string // 内容校验和
}

interface SessionMetadata {
  sessionId: string
  server: string
  database: string
  lastFullSync: number
  lastIncrementalSync: number
  lastAccessed: number // 新增：最后访问时间（用于LRU）
  estimatedSizeMB: number // 新增：估算的数据大小（MB）
  version: string
  totalCount: number
  checksum: string
}

interface PersistentCacheStats {
  totalProcedures: number
  sessions: number
  dbSizeMB: number
  maxSizeMB: number
  usagePercentage: number
  lastUpdated: Date
  sessionDetails: Array<{
    sessionId: string
    sizeMB: number
    lastAccessed: Date
    procedureCount: number
  }>
}

class PersistentCacheManager {
  private dbName = 'SqlCacheDB'
  private dbVersion = 2
  private db: IDBDatabase | null = null
  private readonly MAX_CACHE_SIZE_MB = 100 // 最大缓存大小（MB）
  
  async init(): Promise<void> {
    if (this.db) return
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        
        // 存储过程表
        if (!db.objectStoreNames.contains('procedures')) {
          const procedureStore = db.createObjectStore('procedures', { keyPath: ['sessionId', 'id'] })
          procedureStore.createIndex('sessionId', 'sessionId', { unique: false })
          procedureStore.createIndex('name', 'name', { unique: false })
          procedureStore.createIndex('schema', 'schema_name', { unique: false })
          procedureStore.createIndex('lastModified', 'lastModified', { unique: false })
        }
        
        // 会话元数据表
        if (!db.objectStoreNames.contains('sessionMetadata')) {
          const metadataStore = db.createObjectStore('sessionMetadata', { keyPath: 'sessionId' })
          metadataStore.createIndex('server', 'server', { unique: false })
          metadataStore.createIndex('database', 'database', { unique: false })
        }
      }
    })
  }
  
  private generateChecksum(content: string): string {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString(36)
  }
  
  // 获取会话元数据
  async getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
    await this.init()
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessionMetadata'], 'readonly')
      const store = transaction.objectStore('sessionMetadata')
      const request = store.get(sessionId)
      
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }
  
  // 搜索存储过程（优化大数据量场景 + LRU更新）
  async searchProcedures(sessionId: string, keyword: string, limit = 100): Promise<StoredProcedure[]> {
    await this.init()
    
    // 更新访问时间（LRU）
    await this.updateSessionAccess(sessionId)
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['procedures'], 'readonly')
      const store = transaction.objectStore('procedures')
      const index = store.index('sessionId')
      const request = index.openCursor(IDBKeyRange.only(sessionId))
      
      const results: StoredProcedure[] = []
      const lowerKeyword = keyword.toLowerCase()
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor && results.length < limit) {
          const procedure = cursor.value
          const nameMatch = procedure.name.toLowerCase().includes(lowerKeyword)
          const schemaMatch = procedure.schema_name.toLowerCase().includes(lowerKeyword)
          
          if (nameMatch || schemaMatch) {
            results.push(procedure)
          }
          cursor.continue()
        } else {
          resolve(results)
        }
      }
      
      request.onerror = () => reject(request.error)
    })
  }
  
  // 估算数据大小（MB）
  private estimateDataSize(procedures: StoredProcedure[]): number {
    let totalBytes = 0
    procedures.forEach(proc => {
      // 估算每个字段的字节数
      totalBytes += (proc.id?.length || 0) * 2 // UTF-16编码
      totalBytes += (proc.name?.length || 0) * 2
      totalBytes += (proc.schema_name?.length || 0) * 2
      totalBytes += (proc.description?.length || 0) * 2
      totalBytes += (proc.definition?.length || 0) * 2
      totalBytes += (proc.lastModified?.length || 0) * 2
      totalBytes += (proc.checksum?.length || 0) * 2
      totalBytes += JSON.stringify(proc.parameters || []).length * 2
      totalBytes += 200 // 索引和其他开销
    })
    return totalBytes / (1024 * 1024) // 转换为MB
  }

  // 获取当前总缓存大小
  async getCurrentCacheSize(): Promise<number> {
    await this.init()
    
    const allMetadata = await new Promise<SessionMetadata[]>((resolve, reject) => {
      const transaction = this.db!.transaction(['sessionMetadata'], 'readonly')
      const store = transaction.objectStore('sessionMetadata')
      const request = store.getAll()
      
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    return allMetadata.reduce((total, meta) => total + (meta.estimatedSizeMB || 0), 0)
  }

  // LRU清理：删除最久未使用的会话
  async cleanupLRUSessions(requiredSpaceMB: number): Promise<string[]> {
    await this.init()
    
    const allMetadata = await new Promise<SessionMetadata[]>((resolve, reject) => {
      const transaction = this.db!.transaction(['sessionMetadata'], 'readonly')
      const store = transaction.objectStore('sessionMetadata')
      const request = store.getAll()
      
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    // 按最后访问时间排序（最久未使用的在前）
    allMetadata.sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0))
    
    const removedSessions: string[] = []
    let freedSpace = 0
    
    for (const metadata of allMetadata) {
      if (freedSpace >= requiredSpaceMB) break
      
      console.log(`LRU清理：删除会话 ${metadata.sessionId} (${metadata.estimatedSizeMB}MB)`)
      await this.clearSession(metadata.sessionId)
      
      freedSpace += metadata.estimatedSizeMB || 0
      removedSessions.push(metadata.sessionId)
    }
    
    return removedSessions
  }

  // 更新会话访问时间
  async updateSessionAccess(sessionId: string): Promise<void> {
    const metadata = await this.getSessionMetadata(sessionId)
    if (metadata) {
      metadata.lastAccessed = Date.now()
      await this.saveSessionMetadata(metadata)
    }
  }

  // 检查容量并清理（在保存前调用）
  async ensureCacheCapacity(sessionId: string, newDataSizeMB: number): Promise<void> {
    const currentSize = await this.getCurrentCacheSize()
    const existingSessionMeta = await this.getSessionMetadata(sessionId)
    const existingSize = existingSessionMeta?.estimatedSizeMB || 0
    
    // 计算需要的总空间（减去现有会话的空间）
    const requiredSpace = currentSize - existingSize + newDataSizeMB
    
    if (requiredSpace > this.MAX_CACHE_SIZE_MB) {
      const needToFree = requiredSpace - this.MAX_CACHE_SIZE_MB
      console.log(`缓存容量不足，需要释放 ${needToFree.toFixed(2)}MB 空间`)
      
      const removedSessions = await this.cleanupLRUSessions(needToFree)
      if (removedSessions.length > 0) {
        console.log(`LRU清理完成，删除了会话: ${removedSessions.join(', ')}`)
      }
    }
  }

  // 增量更新核心方法（增强版：支持容量管理）
  async performIncrementalUpdate(
    sessionId: string,
    newProcedures: StoredProcedure[],
    progressCallback?: (progress: { current: number, total: number, action: string }) => void
  ): Promise<{ added: number, updated: number, deleted: number }> {
    await this.init()
    
    // 检查容量并进行LRU清理
    const newDataSize = this.estimateDataSize(newProcedures)
    await this.ensureCacheCapacity(sessionId, newDataSize)
    
    // 获取现有存储过程
    const existingProcedures = await this.getAllProcedures(sessionId)
    const existingMap = new Map(existingProcedures.map(p => [p.id, p]))
    const newMap = new Map(newProcedures.map(p => [
      p.id, 
      { 
        ...p, 
        checksum: this.generateChecksum(`${p.name}${p.schema_name}${p.definition || ''}`) 
      }
    ]))
    
    let added = 0, updated = 0, deleted = 0
    const batchSize = 200 // 增加批次大小以提高性能
    
    // 处理新增和更新
    const toProcess = Array.from(newMap.entries())
    for (let i = 0; i < toProcess.length; i += batchSize) {
      const batch = toProcess.slice(i, i + batchSize)
      
      progressCallback?.({
        current: i,
        total: toProcess.length,
        action: `处理存储过程 ${i + 1}-${Math.min(i + batchSize, toProcess.length)}`
      })
      
      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction(['procedures'], 'readwrite')
        const store = transaction.objectStore('procedures')
        let completed = 0
        
        batch.forEach(([id, newProc]) => {
          const existing = existingMap.get(id)
          const procWithSession = { ...newProc, sessionId }
          
          if (!existing) {
            added++
          } else if (existing.checksum !== newProc.checksum) {
            updated++
          }
          
          const request = store.put(procWithSession)
          request.onsuccess = () => {
            completed++
            if (completed === batch.length) resolve()
          }
          request.onerror = () => reject(request.error)
        })
      })
      
      // 让出控制权
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    
    // 处理删除
    const toDelete = existingProcedures.filter(p => !newMap.has(p.id))
    deleted = toDelete.length
    
    if (toDelete.length > 0) {
      progressCallback?.({
        current: 0,
        total: toDelete.length,
        action: '清理已删除的存储过程'
      })
      
      for (let i = 0; i < toDelete.length; i += batchSize) {
        const batch = toDelete.slice(i, i + batchSize)
        
        await new Promise<void>((resolve, reject) => {
          const transaction = this.db!.transaction(['procedures'], 'readwrite')
          const store = transaction.objectStore('procedures')
          let completed = 0
          
          batch.forEach(proc => {
            const request = store.delete([sessionId, proc.id])
            request.onsuccess = () => {
              completed++
              if (completed === batch.length) resolve()
            }
            request.onerror = () => reject(request.error)
          })
        })
        
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }
    
    // 更新元数据
    const estimatedSize = this.estimateDataSize(newProcedures)
    const metadata: SessionMetadata = {
      sessionId,
      server: '',
      database: '',
      lastFullSync: Date.now(),
      lastIncrementalSync: Date.now(),
      lastAccessed: Date.now(),
      estimatedSizeMB: estimatedSize,
      version: '1.0',
      totalCount: newProcedures.length,
      checksum: this.generateChecksum(JSON.stringify(newProcedures.map(p => p.id).sort()))
    }
    
    await this.saveSessionMetadata(metadata)
    
    return { added, updated, deleted }
  }
  
  private async getAllProcedures(sessionId: string): Promise<StoredProcedure[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['procedures'], 'readonly')
      const store = transaction.objectStore('procedures')
      const index = store.index('sessionId')
      const request = index.getAll(sessionId)
      
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  
  private async saveSessionMetadata(metadata: SessionMetadata): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessionMetadata'], 'readwrite')
      const store = transaction.objectStore('sessionMetadata')
      const request = store.put(metadata)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
  
  // 检查是否需要增量更新
  async shouldPerformIncrementalUpdate(sessionId: string): Promise<boolean> {
    const metadata = await this.getSessionMetadata(sessionId)
    if (!metadata) return false // 如果没有元数据，说明是首次使用，应该返回false来触发持久化缓存查找
    
    const now = Date.now()
    const lastSync = metadata.lastIncrementalSync || metadata.lastFullSync
    const syncInterval = 6 * 60 * 60 * 1000 // 6小时检查一次
    
    return (now - lastSync) < syncInterval // 如果在间隔内，可以使用增量更新
  }
  
  // 获取缓存统计（增强版：包含容量和LRU信息）
  async getStats(): Promise<PersistentCacheStats> {
    await this.init()
    
    const procCount = await new Promise<number>((resolve, reject) => {
      const transaction = this.db!.transaction(['procedures'], 'readonly')
      const store = transaction.objectStore('procedures')
      const request = store.count()
      
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    const allMetadata = await new Promise<SessionMetadata[]>((resolve, reject) => {
      const transaction = this.db!.transaction(['sessionMetadata'], 'readonly')
      const store = transaction.objectStore('sessionMetadata')
      const request = store.getAll()
      
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    
    // 计算实际使用的空间
    const totalSize = allMetadata.reduce((sum, meta) => sum + (meta.estimatedSizeMB || 0), 0)
    const usagePercentage = (totalSize / this.MAX_CACHE_SIZE_MB) * 100
    
    // 会话详情
    const sessionDetails = allMetadata.map(meta => ({
      sessionId: meta.sessionId,
      sizeMB: meta.estimatedSizeMB || 0,
      lastAccessed: new Date(meta.lastAccessed || meta.lastFullSync),
      procedureCount: meta.totalCount || 0
    }))
    
    // 按最后访问时间排序
    sessionDetails.sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())
    
    return {
      totalProcedures: procCount,
      sessions: allMetadata.length,
      dbSizeMB: Math.round(totalSize * 100) / 100, // 精确到小数点后2位
      maxSizeMB: this.MAX_CACHE_SIZE_MB,
      usagePercentage: Math.round(usagePercentage * 100) / 100,
      lastUpdated: new Date(),
      sessionDetails
    }
  }
  
  // 清除会话数据
  async clearSession(sessionId: string): Promise<void> {
    await this.init()
    
    // 清除存储过程
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(['procedures'], 'readwrite')
      const store = transaction.objectStore('procedures')
      const index = store.index('sessionId')
      const request = index.openKeyCursor(IDBKeyRange.only(sessionId))
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          store.delete(cursor.primaryKey)
          cursor.continue()
        } else {
          resolve()
        }
      }
      
      request.onerror = () => reject(request.error)
    })
    
    // 清除元数据
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(['sessionMetadata'], 'readwrite')
      const store = transaction.objectStore('sessionMetadata')
      const request = store.delete(sessionId)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

export const persistentCache = new PersistentCacheManager() 