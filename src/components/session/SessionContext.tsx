// components/session/SessionContext.tsx
"use client"

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { QuerySession as Session, ConnectionConfig } from '@/types/database'
import { testConnection } from '@/lib/api'
import { toast } from 'sonner'
import { useConnections } from '@/hooks/useConnections'

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
  const [activeSession, setActiveSession] = useState<Session | null>(null)
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
      setActiveSession(existingSession); // 使用公共的 setActiveSession 来激活会话
      toast.success(`Connected to ${connection.name} - ${connection.database}`);
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
        isActive: true // 新会话默认激活
      };

      // 把其他 session 的 isActive 设置为 false
      const updatedSessions = sessions.map(s => ({
        ...s,
        isActive: false
      }));

      const newSessionsList = [...updatedSessions, newSession];

      setSessions(newSessionsList);
      setActiveSession(newSession);
      return newSession;
    } catch (err) {
      const errorMsg = `Connection error: ${err instanceof Error ? err.message : String(err)}`;
      toast.error(errorMsg);
      return null;
    }
  }

  const closeSession = (sessionId: string) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId))
    setActiveSession(prev => (prev?.id === sessionId ? null : prev))
  }

  const closeSessionByConnectionId = (connectionId: string) => {
    setSessions(prev => prev.filter(s => s.connectionId !== connectionId))
    setActiveSession(prev => (prev?.id === connectionId ? null : prev))
  }

  // ✅ 初始化 sessions 的 useEffect
  useEffect(() => {
    const initSessions = async () => {
      if (typeof window === 'undefined' || connectionsLoading) return

      console.log('开始初始化会话....')
      setIsInitializing(true);

      let existingSessions: Session[] = sessions

      if (connections.length > 0) {
        const newSessions: Session[] = []
        for (const conn of connections) {
          const result = await testConnection(conn)
          if (result.success && result.session_id) {
            newSessions.push({
              id: result.session_id,
              connectionId: conn.id,
              connectionName: conn.name,
              server: conn.server,
              database: conn.database,
              isActive: false
            })
          }
        }

        const active = existingSessions.find(s => s.isActive) || newSessions[0] || null
        const withFlags = newSessions.map(s => ({ ...s, isActive: s.id === active?.id }))

        setSessions(withFlags)
        setActiveSession(active)
      } else if (existingSessions.length > 0) {
        const active = existingSessions.find(s => s.isActive) || existingSessions[0]
        setSessions(existingSessions)
        setActiveSession(active)
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
