import { useState } from 'react'
import { QueryResult } from '@/types/database'
import { executeQuery, executeNonQuery, isQueryStatement } from '@/lib/api'
import { useQueryHistory } from '@/hooks/useQueryHistory'
import { QuerySession as Session } from '@/types/database'

export function useSqlExecution() {
  const { addQueryToHistory } = useQueryHistory()
  const [isExecuting, setIsExecuting] = useState(false)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 执行查询函数
  const executeCurrentQuery = async (
    activeSession: Session | null,
    queryText: string
  ) => {
    if (!queryText || !queryText.trim() || !activeSession) {
      return;
    }

    setIsExecuting(true)
    setError(null)
    setQueryResult(null)

    const startTime = Date.now()

    try {
      const isQuery = isQueryStatement(queryText)

      const result = isQuery
        ? await executeQuery(activeSession.id, queryText)
        : await executeNonQuery(activeSession.id, queryText)

      const duration = Date.now() - startTime

      if (result.error) {
        setError(result.error)

        if (activeSession) {
          addQueryToHistory(
            activeSession,
            queryText,
            duration,
            false,
            result.error
          )
        }
      } else {
        setQueryResult(result)

        if (activeSession) {
          addQueryToHistory(
            activeSession,
            queryText,
            duration,
            true
          )
        }
      }
    } catch (err) {
      setError(`查询执行失败: ${err}`)

      if (activeSession) {
        addQueryToHistory(
          activeSession,
          queryText,
          Date.now() - startTime,
          false,
          String(err)
        )
      }
    } finally {
      setIsExecuting(false)
    }
  }

  // 停止执行
  const stopExecution = () => {
    if (isExecuting) {
      setIsExecuting(false)
      setError('查询已手动停止')
    }
  }

  return {
    isExecuting,
    queryResult,
    error,
    executeCurrentQuery,
    stopExecution,
    setError,
    setQueryResult
  };
}
