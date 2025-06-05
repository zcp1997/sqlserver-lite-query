// components/session/SessionContext.tsx
"use client"

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { QuerySession as Session, ConnectionConfig } from '@/types/database'
import { testConnection } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { useConnections } from '@/hooks/useConnections'
import { WorkspaceService } from '@/lib/workspace'
import { SqlCacheManager } from '@/lib/sqlparse'

// 定义 context 类型
interface SessionContextType {
  sessions: Session[]
  activeSession: Session | null
  createSession: (connection: ConnectionConfig) => Promise<Session | null>
  setActiveSession: (session: Session) => void
  closeSession: (sessionId: string) => void
  closeSessionByConnectionId: (connectionId: string) => void
  isInitializing: boolean
}

const SessionContext = createContext<SessionContextType | undefined>(undefined)

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSessionState] = useState<Session | null>(null)
  const { connections, isLoading: connectionsLoading } = useConnections()
  const [isInitializing, setIsInitializing] = useState(false)

  const createSession = async (connection: ConnectionConfig) => {
    if (!connection.id) {
      console.error('Connection ID is missing');
      return null;
    }

    const existingSession = sessions.find(session =>
      session.connectionId === connection.id &&
      session.database === connection.database
    );

    if (existingSession) {
      console.log('Using existing session:', existingSession);
      setActiveSessionState(existingSession);
      toast.success(`成功连接到 ${connection.name} - ${connection.database}`);
      return existingSession;
    }

    try {
      const result = await testConnection(connection);

      if (!result.success || !result.session_id) {
        const errorMsg = `Failed to connect: ${result.message || 'Unknown error'}`;
        toast.error(errorMsg);
        return null;
      }

      const newSession: Session = {
        id: result.session_id,
        connectionId: connection.id,
        connectionName: connection.name,
        server: connection.server,
        database: connection.database,
        isActive: true
      };

      // 把其他 session 的 isActive 设置为 false
      const updatedSessions = sessions.map(s => ({
        ...s,
        isActive: false
      }));

      const newSessionsList = [...updatedSessions, newSession];

      setSessions(newSessionsList);
      setActiveSessionState(newSession);
      
      // 后台预加载存储过程（提高自动补全性能）
      toast.promise(
        SqlCacheManager.preloadProceduresForSession(newSession.id),
        {
          loading: '正在预加载存储过程信息...',
          success: '存储过程预加载完成，自动补全性能已优化',
          error: '存储过程预加载失败，将在使用时动态加载'
        }
      )
      
      // 处理工作区绑定
      const manager = WorkspaceService.getWorkspaces()
      
      // 检查是否有当前活动的工作区
      const currentWorkspace = manager.workspaces.find(ws => ws.id === manager.activeWorkspaceId)
      
      if (currentWorkspace) {
        // 如果有当前工作区，将新会话绑定到当前工作区
        console.log('Binding new session to current workspace:', currentWorkspace.workspaceName)
        WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
          server: connection.server,
          database: connection.database,
          connectionId: connection.id,
          connectionName: connection.name,
          lastUsed: Date.now()
        })
        toast.success(`会话已绑定到工作区: ${currentWorkspace.workspaceName}`)
      } else {
        // 如果没有当前工作区，检查是否已存在匹配的工作区
        let workspace = WorkspaceService.findWorkspace(
          manager,
          connection.server,
          connection.database
        )
        
        if (!workspace) {
          // 只有在没有匹配工作区时才创建新工作区
          workspace = WorkspaceService.createWorkspace(
            connection.server,
            connection.database,
            connection.id,
            connection.name,
            `${connection.name} - ${connection.database}` // 使用连接信息作为默认工作区名称
          )
          WorkspaceService.addOrUpdateWorkspace(manager, workspace)
          console.log('Created new workspace for session:', workspace.workspaceName)
        } else {
          // 更新现有工作区的连接信息
          WorkspaceService.updateWorkspace(manager, workspace.id, {
            connectionId: connection.id,
            connectionName: connection.name,
            lastUsed: Date.now()
          })
          console.log('Updated existing workspace for session:', workspace.workspaceName)
        }
      }
      
      return newSession;
    } catch (err) {
      const errorMsg = `Connection error: ${err instanceof Error ? err.message : String(err)}`;
      toast.error(errorMsg);
      return null;
    }
  }

  const closeSession = (sessionId: string) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    setActiveSessionState(prev => (prev?.id === sessionId ? null : prev))
  }

  const closeSessionByConnectionId = (connectionId: string) => {
    setSessions(prev => prev.filter(s => s.connectionId !== connectionId))
    setActiveSessionState(prev => (prev?.id === connectionId ? null : prev))
  }

  const setActiveSession = (session: Session) => {
    // 更新会话状态
    const updatedSessions = sessions.map(s => ({
      ...s,
      isActive: s.id === session.id
    }))
    setSessions(updatedSessions)
    setActiveSessionState(session)

    // 确保新活动会话的存储过程已预加载（按需加载，提高响应速度）
    const status = SqlCacheManager.getPreloadStatus(session.id)
    if (!status.isLoaded && !status.isLoading) {
      console.log(`为新活动会话 ${session.connectionName} 触发存储过程预加载`)
      // 静默预加载，避免频繁切换时的toast干扰
      SqlCacheManager.warmupActiveSession(session.id).then((success) => {
        if (success) {
          console.log(`会话 ${session.connectionName} 预加载完成`)
          // 仅在成功时显示小提示
          toast.success(`${session.connectionName} 自动补全已就绪`, { duration: 2000 })
        } else {
          console.warn(`会话 ${session.connectionName} 预加载失败`)
          toast.warning(`${session.connectionName} 自动补全加载失败，将在输入时动态加载`, { duration: 2500 })
        }
      }).catch(console.error)
    } else if (status.isLoaded) {
      // 如果已经有缓存，检查是否需要后台刷新
      const now = Date.now()
      const lastUpdate = status.lastUpdate?.getTime() || 0
      const cacheAge = now - lastUpdate
      
      // 如果缓存超过20分钟，触发后台刷新
      if (cacheAge > 1200000) {
        console.log(`会话 ${session.connectionName} 缓存较旧，触发后台刷新`)
        SqlCacheManager.preloadProceduresForSession(session.id).catch(console.error)
      }
    }

    // 更新当前工作区的连接信息
    const manager = WorkspaceService.getWorkspaces()
    const currentWorkspace = manager.workspaces.find(ws => ws.id === manager.activeWorkspaceId)
    
    if (currentWorkspace) {
      // 只更新连接相关的信息，保持工作区名称不变
      WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
        server: session.server,
        database: session.database,
        connectionId: session.connectionId,
        lastUsed: Date.now()
      })
    }
  }

  // ✅ 初始化 sessions 的 useEffect，考虑工作区
  useEffect(() => {
    const initSessions = async () => {
      if (typeof window === 'undefined' || connectionsLoading) return

      console.log('开始初始化会话....')
      setIsInitializing(true);
      
      // 清除任何可能残留的toast（防护机制）
      toast.dismiss()

      let existingSessions: Session[] = sessions
      const manager = WorkspaceService.getWorkspaces()

      if (connections.length > 0) {
        const newSessions: Session[] = []
        
        // 首先尝试从工作区恢复最后使用的会话
        const lastUsedWorkspace = WorkspaceService.getLastUsedWorkspace(manager)
        let preferredActiveSession: Session | null = null
        
        // 创建带超时的 testConnection 函数
        const testConnectionWithTimeout = (conn: ConnectionConfig): Promise<{ success: boolean; session_id?: string; message?: string }> => {
          return Promise.race([
            testConnection(conn),
            new Promise<{ success: boolean; session_id?: string; message?: string }>((_, reject) => 
              setTimeout(() => reject(new Error('Connection timeout after 3 seconds')), 3000)
            )
          ]).catch(error => ({
            success: false,
            message: error.message || 'Connection failed'
          }))
        }
        
        // 并行处理所有连接，每个连接最多等待3秒
        const connectionPromises = connections.map(async (conn) => {
          try {
            const result = await testConnectionWithTimeout(conn)
            return { conn, result }
          } catch (error) {
            return { 
              conn, 
              result: { 
                success: false, 
                message: error instanceof Error ? error.message : 'Unknown error'
              }
            }
          }
        })
        
        // 等待所有连接尝试完成（无论成功还是失败）
        const connectionResults = await Promise.allSettled(connectionPromises)
        
        // 处理结果，只保留成功的连接
        for (const promiseResult of connectionResults) {
          if (promiseResult.status === 'fulfilled') {
            const { conn, result } = promiseResult.value
            
            if (result.success && result.session_id) {
              const session: Session = {
                id: result.session_id,
                connectionId: conn.id,
                connectionName: conn.name,
                server: conn.server,
                database: conn.database,
                isActive: false
              }
              
              newSessions.push(session)
              
              // 如果这个连接对应最后使用的工作区，将其设为首选的活动会话
              if (lastUsedWorkspace && 
                  lastUsedWorkspace.server === conn.server && 
                  lastUsedWorkspace.database === conn.database) {
                preferredActiveSession = session
              }
            } else {
              // 连接失败，输出日志但不阻塞其他连接
              console.warn(`连接失败 [${conn.name}]: ${result.message}`)
            }
          } else {
            // Promise 被拒绝
            console.warn('连接处理失败:', promiseResult.reason)
          }
        }

        // 确定活动会话：优先使用最后使用的工作区对应的会话，否则使用第一个
        const active = preferredActiveSession || 
                     existingSessions.find(s => s.isActive) || 
                     newSessions[0] || 
                     null
                     
        const withFlags = newSessions.map(s => ({ ...s, isActive: s.id === active?.id }))

        setSessions(withFlags)
        setActiveSessionState(active)
        
        // 优化：仅为活动会话预加载存储过程，提高启动速度
        if (active) {
          console.log(`为活动会话 ${active.connectionName} 预热缓存`)
          // 静默预热活动会话，不显示toast（避免干扰用户）
          SqlCacheManager.warmupActiveSession(active.id).then((success) => {
            if (success) {
              console.log(`活动会话 ${active.connectionName} 预热完成`)
            } else {
              console.warn(`活动会话 ${active.connectionName} 预热失败`)
            }
          }).catch(console.error)
        }
        
        // 如果有活动会话，确保其对应的工作区存在
        if (active) {
          let workspace = WorkspaceService.findWorkspace(
            manager,
            active.server,
            active.database
          )
          
          if (!workspace) {
            workspace = WorkspaceService.createWorkspace(
              active.server,
              active.database,
              active.connectionId || active.id,
              active.connectionName,
              `${active.connectionName} - ${active.database}`
            )
            WorkspaceService.addOrUpdateWorkspace(manager, workspace)
          } else {
            // 更新现有工作区的连接信息
            WorkspaceService.updateWorkspace(manager, workspace.id, {
              connectionId: active.connectionId || active.id,
              connectionName: active.connectionName
            })
          }
        }
        
        // 显示连接结果摘要
        const successCount = newSessions.length
        const totalCount = connections.length
        if (successCount > 0) {
          console.log(`成功建立 ${successCount}/${totalCount} 个数据库连接`)
        } else if (totalCount > 0) {
          console.warn('所有数据库连接都失败了')
        }
        
      } else if (existingSessions.length > 0) {
        // 如果没有新连接但有现有会话，尝试从工作区恢复
        const lastUsedWorkspace = WorkspaceService.getLastUsedWorkspace(manager)
        let active = existingSessions.find(s => s.isActive)
        
        if (!active && lastUsedWorkspace) {
          // 尝试找到对应最后使用工作区的会话
          active = existingSessions.find(s => 
            s.server === lastUsedWorkspace.server && 
            s.database === lastUsedWorkspace.database
          )
        }
        
        active = active || existingSessions[0]
        setSessions(existingSessions)
        setActiveSessionState(active)
      }

      setIsInitializing(false);
    }

    initSessions()
  }, [connections, connectionsLoading])

  return (
    <SessionContext.Provider
      value={{
        sessions,
        activeSession,
        createSession,
        setActiveSession,
        closeSession,
        closeSessionByConnectionId,
        isInitializing,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export const useSession = () => {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used within a SessionProvider')
  return context
}
