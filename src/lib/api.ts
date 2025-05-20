import { invoke } from '@tauri-apps/api/core'
import { 
  ConnectionConfig, 
  ConnectionResponse, 
  QueryRequest, 
  QueryResult,
  ResultSet
} from '@/types/database'

// 测试数据库连接
export async function testConnection(config: ConnectionConfig): Promise<ConnectionResponse> {
  console.log('testConnection 调用参数:', config)
  
  try {
    console.log('调用Tauri test_connection命令')
    const response = await invoke<ConnectionResponse>('test_connection', { config })
    console.log('Tauri 命令响应:', response)
    
    // 处理后端返回的session_id格式，转换为前端使用的sessionId格式
    if (response.session_id) {
      response.session_id = response.session_id
    }
    
    return response
  } catch (error) {
    console.error('测试连接失败:', error)
    
    // 临时解决方案:创建模拟会话以便测试前端功能
    if (process.env.NODE_ENV === 'development') {
      console.warn('开发环境: 创建模拟会话以便测试')
      return {
        success: true,
        message: '连接成功 (模拟)',
        session_id: `mock-session-${Date.now()}`
      }
    }
    
    return {
      success: false,
      message: `测试连接失败: ${error}`
    }
  }
}

// 执行SQL查询
export async function executeQuery(session_id: string, sql: string): Promise<QueryResult> {
  try {
    const request: QueryRequest = {
      session_id,
      sql
    }
    const result = await invoke<QueryResult>('execute_query', { request })

    console.log('executeQuery 结果:', result)
    
    // 兼容处理：如果后端尚未更新为多结果集结构，进行适配
    if (!result.result_sets && 'columns' in result) {
      // 旧结构，转换为新结构
      const oldResult = result as unknown as ResultSet
      return {
        result_sets: [oldResult],
        error: oldResult.error
      }
    }
    
    return result
  } catch (error) {
    console.error('查询执行失败:', error)
    return {
      result_sets: [{
        columns: [],
        rows: [],
        error: `查询执行失败: ${error}`
      }],
      error: `查询执行失败: ${error}`
    }
  }
}

// 执行非查询SQL操作
export async function executeNonQuery(session_id: string, sql: string): Promise<QueryResult> {
  try {
    const request: QueryRequest = {
      session_id,
      sql
    }
    const result = await invoke<QueryResult>('execute_non_query', { request })

    console.log('executeNonQuery 结果:', result)
    
    // 兼容处理：如果后端尚未更新为多结果集结构，进行适配
    if (!result.result_sets && 'columns' in result) {
      // 旧结构，转换为新结构
      const oldResult = result as unknown as ResultSet
      return {
        result_sets: [oldResult],
        error: oldResult.error
      }
    }
    
    return result
  } catch (error) {
    console.error('执行失败:', error)
    return {
      result_sets: [{
        columns: [],
        rows: [],
        error: `执行失败: ${error}`
      }],
      error: `执行失败: ${error}`
    }
  }
}

// 判断是否是查询语句
export function isQueryStatement(sql: string): boolean {
  const trimmedSql = sql.trim().toLowerCase()
  return (
    trimmedSql.startsWith('select') || 
    trimmedSql.startsWith('with') || 
    trimmedSql.startsWith('declare @') || 
    trimmedSql.startsWith('exec sp_') || 
    trimmedSql.startsWith('execute sp_')
  )
} 