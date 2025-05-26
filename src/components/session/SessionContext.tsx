// components/session/SessionContext.tsx
"use client"

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { QuerySession as Session, ConnectionConfig } from '@/types/database'
import { testConnection } from '@/lib/api'
import { toast } from 'sonner'
import { useConnections } from '@/hooks/useConnections'
import { WorkspaceService } from '@/lib/workspace'

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
      
      // 为新会话创建或加载工作区
      const manager = WorkspaceService.getWorkspaces()
      let workspace = WorkspaceService.findWorkspace(
        manager,
        connection.server,
        connection.database
      )
      
      if (!workspace) {
        // 创建新工作区时使用连接名称作为默认工作区名称
        workspace = WorkspaceService.createWorkspace(
          connection.server,
          connection.database,
          connection.id,
          connection.name,
          `${connection.name} - ${connection.database}` // 使用连接信息作为默认工作区名称
        )
        WorkspaceService.addOrUpdateWorkspace(manager, workspace)
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

      let existingSessions: Session[] = sessions
      const manager = WorkspaceService.getWorkspaces()

      if (connections.length > 0) {
        const newSessions: Session[] = []
        
        // 首先尝试从工作区恢复最后使用的会话
        const lastUsedWorkspace = WorkspaceService.getLastUsedWorkspace(manager)
        let preferredActiveSession: Session | null = null
        
        for (const conn of connections) {
          const result = await testConnection(conn)
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
