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
import { Database, Plus, X } from 'lucide-react'
import ConnectionList from '@/components/connection/ConnectionList'
import { ConnectionConfig } from '@/types/database'
import { useToast } from '@/hooks/use-toast'

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