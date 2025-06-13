"use client"

import { useState, useCallback } from 'react'
import { useSession } from '@/components/session/SessionContext'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Database, Plus, X, RefreshCw } from 'lucide-react'
import ConnectionList from '@/components/connection/ConnectionList'
import { ConnectionConfig } from '@/types/database'
import { useToast } from '@/hooks/use-toast'
import { SqlCacheManager } from '@/lib/sqlcache-manager'

export default function SessionSelector() {
  const {
    sessions,
    activeSession,
    createSession,
    setActiveSession,
    closeSession,
    isInitializing,
  } = useSession()
  const { toast } = useToast()

  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPreloadStatus, setShowPreloadStatus] = useState(false)

  // 处理会话切换
  const handleSessionChange = useCallback((session_id: string) => {
    setError(null)

    if (!session_id) {
      console.warn('Empty session ID provided to handleSessionChange')
      return
    }

    // 验证会话ID存在
    const sessionExists = sessions.some(s => s.id === session_id)
    if (!sessionExists) {
      console.error('Attempted to switch to non-existent session:', session_id)
      setError(`Cannot switch to session: Session does not exist`)
      return
    }

    // 查找选定的会话
    const selectedSession = sessions.find(s => s.id === session_id)
    if (selectedSession) {
      setActiveSession(selectedSession)
      toast.success(`已切换到会话: ${selectedSession.connectionName} - ${selectedSession.database}`)
    }
  }, [sessions, setActiveSession, toast])

  // 处理会话关闭
  const handleSessionClose = useCallback((sessionId: string) => {
    if (!sessionId) {
      console.warn('Empty session ID provided to handleSessionClose')
      return
    }
    closeSession(sessionId)
  }, [closeSession])

  // 处理连接选择
  const handleConnect = useCallback(async (connection: ConnectionConfig) => {
    if (!connection || !connection.id) {
      setError('Invalid connection configuration')
      return
    }

    try {
      setIsConnecting(true)
      setError(null)

      const session = await createSession(connection)

      if (session) {
        setIsNewSessionOpen(false)
      } else {
        setError('Failed to create session')
      }
    } catch (err) {
      console.error('Create session error:', err)
      setError(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsConnecting(false)
    }
  }, [createSession])

  // 获取当前活动会话的显示名称
  const getActiveSessionDisplay = useCallback(() => {
    if (!activeSession) return '选择数据库会话'
    return `${activeSession.connectionName} - ${activeSession.database}`
  }, [activeSession])

  // 新增：检查预加载状态（增强版 + 持久化统计）
  const checkPreloadStatus = useCallback(async () => {
    if (!activeSession) return

    const status = SqlCacheManager.getPreloadStatus(activeSession.id)
    const stats = await SqlCacheManager.getStats()

    // 格式化时间
    const formatTime = (ms: number) => {
      if (ms < 60000) return `${Math.round(ms / 1000)}秒`
      if (ms < 3600000) return `${Math.round(ms / 60000)}分钟`
      return `${Math.round(ms / 3600000)}小时`
    }

    // 格式化文件大小
    const formatSize = (sizeMB: number) => {
      if (sizeMB < 1) return `${Math.round(sizeMB * 1024)}KB`
      if (sizeMB < 1024) return `${Math.round(sizeMB)}MB`
      return `${Math.round(sizeMB / 1024 * 10) / 10}GB`
    }

    const statusText = status.isLoaded ? '已完成' : (status.isLoading ? '加载中' : '未加载')
    const cacheAgeText = status.lastUpdate ? `缓存时长: ${formatTime(status.cacheAge)}` : ''
    const expireText = status.willExpireIn > 0 ? `将在 ${formatTime(status.willExpireIn)} 后过期` : ''
    const autoRefreshText = status.autoRefreshEnabled ? '自动刷新: 开启' : '自动刷新: 关闭'
    const persistentText = `IndexedDB: ${stats.persistent.totalProcedures}个存储过程 (${formatSize(stats.persistent.dbSizeMB)})`
    const capacityText = `容量: ${stats.persistent.usagePercentage}% (${formatSize(stats.persistent.dbSizeMB)}/${formatSize(stats.persistent.maxSizeMB)})`
    const sessionsText = `${stats.persistent.sessions}个会话缓存`

    toast.success(
      `预加载状态: ${statusText}`,
      { 
        description: [
          `内存: ${status.procedureCount}个存储过程`,
          persistentText,
          capacityText,
          sessionsText,
          cacheAgeText,
          expireText,
          autoRefreshText
        ].filter(Boolean).join(' | '),
        duration: 6000
      }
    )
  }, [activeSession, toast])

  // 新增：手动刷新预加载
  const refreshPreload = useCallback(async () => {
    if (!activeSession) return

    toast.info('正在刷新存储过程预加载...')
    const success = await SqlCacheManager.refreshPreloadCache(activeSession.id)

    if (success) {
      console.log('存储过程预加载刷新成功')
    } else {
      console.error('存储过程预加载刷新失败')
    }
  }, [activeSession, toast])

  // 新增：显示容量管理信息
  const showCapacityInfo = useCallback(async () => {
    const stats = await SqlCacheManager.getStats()
    const sessions = stats.persistent.sessionDetails

    if (sessions.length === 0) {
      toast.info('当前没有缓存的会话')
      return
    }

    // 格式化时间
    const formatDate = (date: Date) => {
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      const days = Math.floor(diff / (24 * 60 * 60 * 1000))
      const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
      
      if (days > 0) return `${days}天前`
      if (hours > 0) return `${hours}小时前`
      return '刚刚访问'
    }

    const sessionInfo = sessions.map(s => 
      `${s.sessionId}: ${s.sizeMB.toFixed(1)}MB (${s.procedureCount}个SP, ${formatDate(s.lastAccessed)})`
    ).join('\n')

    toast.info(
      `缓存容量管理 (${stats.persistent.usagePercentage}%已使用)`,
      { 
        description: `最大${stats.persistent.maxSizeMB}MB, 已用${stats.persistent.dbSizeMB.toFixed(1)}MB\n\n会话详情:\n${sessionInfo}`,
        duration: 8000
      }
    )
  }, [toast])

  if (isInitializing) {
    return (
      <div className="flex items-center space-x-2">
        <div className="text-sm text-muted-foreground">正在初始化数据库会话...</div>
      </div>
    )
  }

  return (
    <div className="flex items-center space-x-2">
      {sessions.length > 0 ? (
        <>
          <Select
            value={activeSession?.id || undefined}
            onValueChange={handleSessionChange}
          >
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="选择数据库会话">
                {getActiveSessionDisplay()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {sessions.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  <div className="flex items-center">
                    <Database className="h-4 w-4 mr-2" />
                    <span>
                      {session.connectionName} - {session.database}
                      {activeSession?.id === session.id ? ' (当前连接)' : ''}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 关闭会话按钮 */}
          {/* {activeSession?.id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => activeSession?.id && handleSessionClose(activeSession?.id)}
              title="关闭会话"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <X className="h-4 w-4"/>
            </Button>
          )} */}
        </>
      ) : (
        <div className="text-sm text-muted-foreground">没有可用的数据库会话</div>
      )}

      {/* 新建会话按钮 */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsNewSessionOpen(true)}
        title="创建新会话"
      >
        <Plus className="h-4 w-4" />
      </Button>

      {/* <Button
        variant="outline"
        size="sm"
        onClick={checkPreloadStatus}
        title="检查预加载状态"
      >
        <Database className="h-3 w-3" />
      </Button> */}
      <Button
        variant="outline"
        size="sm"
        onClick={refreshPreload}
        title="手动刷新缓存存储过程"
      >
        <RefreshCw className="h-3 w-3" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={showCapacityInfo}
        title="容量管理信息"
      >
        <span className="text-xs">💾</span>
      </Button>



      <Dialog open={isNewSessionOpen} onOpenChange={setIsNewSessionOpen}>
        <DialogContent className="sm:max-w-[800px]">
          <DialogHeader>
            <DialogTitle>创建新会话</DialogTitle>
            <DialogDescription>
              选择一个数据库连接来创建新会话
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded text-destructive text-sm">
              {error}
            </div>
          )}

          {isConnecting ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              <span className="ml-3">正在连接...</span>
            </div>
          ) : (
            <ConnectionList onConnect={handleConnect} />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewSessionOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}