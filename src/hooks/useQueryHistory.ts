import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { QueryHistory, QuerySession } from '@/types/database'

const STORAGE_KEY = 'sqlserver-query-history'
const MAX_HISTORY_ITEMS = 100 // 最大历史记录数量

export function useQueryHistory() {
  const [history, setHistory] = useState<QueryHistory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 加载历史记录
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem(STORAGE_KEY)
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory))
      }
    } catch (err) {
      setError('加载历史记录失败')
      console.error('加载历史记录错误:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // 保存历史记录
  const saveHistory = (historyList: QueryHistory[]) => {
    try {
      // 限制历史记录数量
      const limitedHistory = historyList.slice(0, MAX_HISTORY_ITEMS)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(limitedHistory))
    } catch (err) {
      console.error('保存历史记录错误:', err)
      setError('保存历史记录失败')
    }
  }

  // 添加历史记录
  const addQueryToHistory = (
    session: QuerySession,
    sql: string,
    duration: number,
    success: boolean,
    errorMessage?: string
  ) => {
    const newHistoryItem: QueryHistory = {
      id: uuidv4(),
      session_id: session.id,
      connectionName: session.connectionName,
      database: session.database,
      sql,
      executedAt: new Date().toISOString(),
      duration,
      success,
      errorMessage
    }

    // 添加到历史记录开头
    const updatedHistory = [newHistoryItem, ...history]
    setHistory(updatedHistory)
    saveHistory(updatedHistory)

    return newHistoryItem
  }

  // 清除历史记录
  const clearHistory = () => {
    setHistory([])
    saveHistory([])
  }

  // 按会话ID获取历史记录
  const getHistoryBySessionId = (session_id: string) => {
    return history.filter(item => item.session_id === session_id)
  }

  return {
    history,
    isLoading,
    error,
    addQueryToHistory,
    clearHistory,
    getHistoryBySessionId
  }
} 