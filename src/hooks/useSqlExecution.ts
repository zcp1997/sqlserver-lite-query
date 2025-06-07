import { useState } from 'react'
import { QueryResult } from '@/types/database'
import { executeQuery } from '@/lib/api'
import { useQueryHistory } from '@/hooks/useQueryHistory'
import { QuerySession as Session } from '@/types/database'

export function useSqlExecution() {
  const { addQueryToHistory } = useQueryHistory()
  const [isExecuting, setIsExecuting] = useState(false)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)

  // 执行查询函数
  const executeCurrentQuery = async (
    activeSession: Session | null,
    queryText: string
  ) => {
    if (!queryText || !queryText.trim() || !activeSession) {
      return;
    }

    setIsExecuting(true)
    setQueryResult(null)

    const startTime = Date.now()

    try {
      const result = await executeQuery(activeSession.id, queryText)

      const duration = Date.now() - startTime

      setQueryResult(result)

      if (activeSession) {
        addQueryToHistory(
          activeSession,
          queryText,
          duration,
          result.result_sets.length > 0 && result.result_sets.map(rs => rs.error).filter(error => error !== undefined && error !== null && error !== '').length === 0,
          result.result_sets.length > 0 && result.result_sets.map(rs => rs.error).filter(error => error !== undefined && error !== null && error !== '').length > 0 ? result.result_sets.map(rs => rs.error).join('\n') : ''
        )
      }
    } catch (err) {

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
    }
  }

  return {
    isExecuting,
    queryResult,
    executeCurrentQuery,
    stopExecution,
    setQueryResult
  };
}
