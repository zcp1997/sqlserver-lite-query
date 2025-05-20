import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { ConnectionConfig } from '@/types/database'
import { testConnection } from '@/lib/api'
const STORAGE_KEY = 'sqlserver-connections'

export function useConnections() {
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 加载保存的连接
  useEffect(() => {
    try {
      const savedConnections = localStorage.getItem(STORAGE_KEY)
      if (savedConnections) {
        setConnections(JSON.parse(savedConnections))
      }
    } catch (err) {
      setError('加载连接信息失败')
      console.error('加载连接错误:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 保存连接到本地存储
  const saveConnections = (conns: ConnectionConfig[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conns))
    } catch (err) {
      console.error('保存连接错误:', err)
      setError('保存连接信息失败')
    }
  }

  // 添加连接
  const addConnection = (connection: ConnectionConfig) => {
    const newConnection = {
      ...connection,
      id: uuidv4()
    }

    const updatedConnections = [...connections, newConnection]
    setConnections(updatedConnections)
    saveConnections(updatedConnections)
    return newConnection
  }

  // 更新连接
  const updateConnection = (connection: ConnectionConfig) => {
    if (!connection.id) return null

    const updatedConnections = connections.map(conn =>
      conn.id === connection.id ? connection : conn
    )

    setConnections(updatedConnections)
    saveConnections(updatedConnections)
    return connection
  }

  // 删除连接
  const deleteConnection = (id: string) => {
    const updatedConnections = connections.filter(conn => conn.id !== id)
    setConnections(updatedConnections)
    saveConnections(updatedConnections)
  }

  // 测试连接
  const testConnectionById = async (id: string) => {
    const connection = connections.find(conn => conn.id === id)
    if (!connection) {
      return {
        success: false,
        message: '未找到连接配置'
      }
    }

    return await testConnection(connection)
  }

  return {
    connections,
    isLoading,
    error,
    addConnection,
    updateConnection,
    deleteConnection,
    testConnectionById
  }
} 