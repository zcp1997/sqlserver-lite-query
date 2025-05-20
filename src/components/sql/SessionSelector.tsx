"use client"

import { useState } from 'react'
import { useQuerySessions } from '@/hooks/useQuerySessions'
import { useConnections } from '@/hooks/useConnections'
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
import { DatabaseIcon, PlusIcon, XIcon } from 'lucide-react'
import ConnectionList from '@/components/connection/ConnectionList'
import { ConnectionConfig } from '@/types/database'

export default function SessionSelector() {
  const { sessions, activeSessionId, setActiveSession, closeSession, createSession } = useQuerySessions()
  const { connections } = useConnections()
  
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // 处理会话切换
  const handleSessionChange = (session_id: string) => {
    setActiveSession(session_id)
  }
  
  // 处理会话关闭
  const handleSessionClose = (session_id: string) => {
    closeSession(session_id)
  }
  
  // 处理连接选择
  const handleConnect = async (connection: ConnectionConfig) => {
    try {
      setIsConnecting(true)
      setError(null)
      
      const session = await createSession(connection)
      
      if (session) {
        setIsNewSessionOpen(false)
      }
    } catch (err) {
      setError(`创建会话失败: ${err}`)
    } finally {
      setIsConnecting(false)
    }
  }
  
  return (
    <div className="flex items-center gap-2">
      {sessions.length > 0 ? (
        <>
          <Select value={activeSessionId || ''} onValueChange={handleSessionChange}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="选择会话" />
            </SelectTrigger>
            <SelectContent>
              {sessions.map((session) => (
                <SelectItem key={session.id} value={session.id}>
                  <div className="flex items-center">
                    <DatabaseIcon className="h-4 w-4 mr-2" />
                    <span>
                      {session.connectionName} - {session.database}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {activeSessionId && (
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => activeSessionId && handleSessionClose(activeSessionId)}
              title="关闭会话"
            >
              <XIcon className="h-4 w-4" />
            </Button>
          )}
        </>
      ) : (
        <div className="text-sm text-muted-foreground">没有可用的数据库会话</div>
      )}
      
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => setIsNewSessionOpen(true)}
      >
        <PlusIcon className="h-4 w-4 mr-1" />
        新建会话
      </Button>
      
      <Dialog open={isNewSessionOpen} onOpenChange={setIsNewSessionOpen}>
        <DialogContent className="sm:max-w-[800px]">
          <DialogHeader>
            <DialogTitle>创建新会话</DialogTitle>
            <DialogDescription>
              选择要连接的数据库
            </DialogDescription>
          </DialogHeader>
          
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700">
              {error}
            </div>
          )}
          
          {isConnecting ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              <span className="ml-3">连接中...</span>
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