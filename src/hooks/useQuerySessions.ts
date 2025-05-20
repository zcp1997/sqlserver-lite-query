import { useState, useEffect } from 'react'
import { QuerySession, ConnectionConfig } from '@/types/database'
import { testConnection } from '@/lib/api'
import { useConnections } from './useConnections'
import { useToast } from './use-toast'

const STORAGE_KEY = 'sqlserver-sessions'

// 调试函数，直接从localStorage读取数据
export function debugReadSessions(): QuerySession[] | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return null
    return JSON.parse(data)
  } catch (err) {
    console.error('直接读取会话数据失败:', err)
    return null
  }
}

export function useQuerySessions() {
  const [sessions, setSessions] = useState<QuerySession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { connections } = useConnections()
  const { toast } = useToast()

  // 加载保存的会话，或者自动创建新会话
  useEffect(() => {
    // 确保只在客户端执行
    if (typeof window === 'undefined') {
      console.log('服务器端渲染，跳过localStorage读取')
      return
    }
    
    const initSessions = async () => {
      try {
        console.log('初始化会话...')
        setIsLoading(true)
        
        // 清空旧会话，因为后端已经关闭连接
        console.log('清空旧会话...')
        localStorage.removeItem(STORAGE_KEY)
        setSessions([])
        setActiveSessionId(null)
        
        // 如果有可用的连接配置，自动创建新会话
        if (connections.length > 0) {
          console.log('找到可用连接，自动创建会话')
          // 使用最近使用的连接（假设是第一个）
          const recentConnection = connections[0]
          
          try {
            await createSession(recentConnection)
            console.log('自动创建会话成功')
          } catch (err) {
            console.error('自动创建会话失败:', err)
            setError(`自动创建会话失败: ${err}`)
          }
        } else {
          console.log('没有找到可用连接，无法自动创建会话')
        }
      } catch (err) {
        console.error('初始化会话错误:', err)
        setError(`初始化会话失败: ${err}`)
      } finally {
        setIsLoading(false)
      }
    }
    
    initSessions()
  }, [connections]) // 当连接列表变化时重新初始化

  // 保存会话到本地存储
  const saveSessions = (sessionList: QuerySession[]) => {
    // 确保只在客户端执行
    if (typeof window === 'undefined') {
      console.warn('服务器端渲染，跳过localStorage保存')
      return
    }
    
    console.log('正在保存会话到localStorage', sessionList)
    try {
      const jsonString = JSON.stringify(sessionList)
      console.log('序列化后的JSON:', jsonString)
      window.localStorage.setItem(STORAGE_KEY, jsonString)
      console.log('会话保存成功')
    } catch (err) {
      console.error('保存会话错误:', err)
      setError('保存会话信息失败')
    }
  }

  // 检查是否已存在相同数据库连接的会话
  const findExistingSession = (connection: ConnectionConfig): QuerySession | undefined => {
    return sessions.find(session => 
      session.server === connection.server && 
      session.database === connection.database
    )
  }

  // 创建新会话
  const createSession = async (connection: ConnectionConfig): Promise<QuerySession | null> => {
    console.log('createSession入参', connection)
    if (!connection.id) {
      console.error('Connection ID is null or undefined')
      return null
    }
    
    // 检查是否已存在相同数据库连接的会话
    const existingSession = findExistingSession(connection)
    if (existingSession) {
      console.log('已存在相同数据库连接的会话:', existingSession)
      // 激活已存在的会话
      setActiveSession(existingSession.id)
      toast.success(`已激活 ${connection.name} - ${connection.database} 的现有会话`)
      return existingSession
    }
    
    // 测试连接并获取会话ID
    console.log('开始测试连接...')
    const result = await testConnection(connection)
    console.log('测试连接结果', result)
    
    const session_id = result.session_id
    
    if (!result.success || !session_id) {
      const errorMsg = `创建会话失败: ${result.message}`
      console.error(errorMsg)
      setError(errorMsg)
      return null
    }
    
    // 取消其他会话的活动状态
    const updatedSessions = sessions.map(session => ({
      ...session,
      isActive: false
    }))
    
    // 创建新会话
    const newSession: QuerySession = {
      id: session_id,
      connectionId: connection.id,
      connectionName: connection.name,
      server: connection.server,
      database: connection.database,
      isActive: true
    }
    
    console.log('新创建的会话', newSession)
    const newSessions = [...updatedSessions, newSession]
    setSessions(newSessions)
    setActiveSessionId(newSession.id)
    
    // 保存到localStorage
    console.log('保存会话到localStorage', newSessions)
    saveSessions(newSessions)
    
    return newSession
  }

  // 设置活动会话
  const setActiveSession = (session_id: string) => {
    const updatedSessions = sessions.map(session => ({
      ...session,
      isActive: session.id === session_id
    }))
    
    setSessions(updatedSessions)
    setActiveSessionId(session_id)
    saveSessions(updatedSessions)
  }

  // 关闭会话
  const closeSession = (session_id: string) => {
    const sessionIndex = sessions.findIndex(s => s.id === session_id)
    if (sessionIndex === -1) return
    
    const updatedSessions = sessions.filter(s => s.id !== session_id)
    
    // 如果关闭的是活动会话，则设置新的活动会话
    if (session_id === activeSessionId && updatedSessions.length > 0) {
      // 尝试激活下一个或前一个会话
      const newActiveIndex = Math.min(sessionIndex, updatedSessions.length - 1)
      updatedSessions[newActiveIndex].isActive = true
      setActiveSessionId(updatedSessions[newActiveIndex].id)
    } else if (updatedSessions.length === 0) {
      setActiveSessionId(null)
    }
    
    setSessions(updatedSessions)
    saveSessions(updatedSessions)
  }

  // 获取活动会话
  const getActiveSession = (): QuerySession | null => {
    if (!activeSessionId) return null
    return sessions.find(s => s.id === activeSessionId) || null
  }

  return {
    sessions,
    activeSessionId,
    isLoading,
    error,
    createSession,
    setActiveSession,
    closeSession,
    getActiveSession
  }
} 