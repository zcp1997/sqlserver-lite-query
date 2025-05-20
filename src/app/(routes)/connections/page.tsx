"use client"

import { useState } from 'react'
import ConnectionList from '@/components/connection/ConnectionList'
import { ConnectionConfig } from '@/types/database'
import { useQuerySessions } from '@/hooks/useQuerySessions'

export default function HomePage() {
  const { createSession } = useQuerySessions()
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  // 处理连接数据库
  const handleConnect = async (connection: ConnectionConfig) => {
    console.log('begin handleConnect', connection)
    
    if (!connection.id) {
      console.error('连接ID为空，无法创建会话')
      setConnectionError('连接配置错误：缺少ID')
      return
    }
    
    try {
      setIsConnecting(true)
      setConnectionError(null)
      
      console.log('开始创建会话', connection)
      const session = await createSession(connection)
      console.log('创建会话结果', session)
      
      if (session) {
        // 连接成功，导航到查询页面
        // 这里可以实现导航逻辑
        console.log('连接成功，会话ID:', session.id)
      } else {
        console.error('会话创建失败，返回null')
        setConnectionError('会话创建失败，请检查连接参数或网络')
      }
    } catch (error) {
      console.error('连接失败:', error)
      setConnectionError(`连接失败: ${error}`)
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-6">SQL Server 轻量查询工具</h1>
      
      {/* 连接错误提示 */}
      {connectionError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700">
          {connectionError}
        </div>
      )}
      
      {/* 加载状态 */}
      {isConnecting && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-blue-700">
          正在连接数据库，请稍候...
        </div>
      )}
      
      {/* 连接列表 */}
      <ConnectionList onConnect={handleConnect} />
    </div>
  )
}
