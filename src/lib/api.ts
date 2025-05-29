import { invoke } from '@tauri-apps/api/core'
import {
  ConnectionConfig,
  ConnectionResponse,
  QueryRequest,
  QueryResult,
  DBObjectInfoRequest,
  TableQueryRequest,
  ColumnQueryRequest,
  ColumnInfo,
  TableInfo,
  DatabaseObjectInfo,
  DatabaseObjectType
} from '@/types/database'

import { useToast } from '@/hooks/use-toast'

const { toast } = useToast();

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
    const result = await invoke<QueryResult>('execute_single_query', { request })

    console.log('executeQuery 结果:', result)

    toast.success("查询完成", { description: "数据库语句执行成功", duration: 1500 })
    return result

  } catch (error) {
    toast.error("查询执行失败", { description: "数据库语句执行失败", duration: 1500 })
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

    toast.success("执行成功", { description: "数据库语句执行成功", duration: 1500 })
    return result
  } catch (error) {
    toast.error("执行失败", { description: "数据库语句执行失败", duration: 1500 })
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

// 关键字查询存储过程
export async function search_dbobject_info(session_id: string, keyword: string, databaseObjectType: DatabaseObjectType): Promise<DatabaseObjectInfo[]> {
  if (session_id.trim() === "") {
    return []
  }
  try {
    const request: DBObjectInfoRequest = {
      session_id,
      keyword
    }
    if (databaseObjectType === DatabaseObjectType.StoredProcedure) {
      const result = await invoke<DatabaseObjectInfo[]>('execute_procedure_query', { request })
      console.log('execute_procedure_query 结果:', result)
      return result
    }
    else if (databaseObjectType === DatabaseObjectType.View) {
      const result = await invoke<DatabaseObjectInfo[]>('execute_view_query', { request })
      console.log('execute_view_query 结果:', result)
      return result
    }
    else if (databaseObjectType === DatabaseObjectType.Function) {
      const result = await invoke<DatabaseObjectInfo[]>('execute_function_query', { request })
      console.log('execute_function_query 结果:', result)
      return result
    }
    else {
      return []
    }
  } catch (error) {
    console.error('执行失败:', error)
    return []
  }
}

// 关键字查询表
export async function search_table_names(session_id: string, keyword: string): Promise<TableInfo[]> {
  if (session_id === "") {
    console.log('session_id 为空')
    return []
  }

  console.log('调用Tauri get_all_tables命令')
  try {
    const request: TableQueryRequest = {
      session_id,
      keyword
    }
    const result = await invoke<TableInfo[]>('get_all_tables', { request });

    console.log('get_all_tables 结果:', result)

    return result
  } catch (error) {
    console.error('执行失败:', error)
    return []
  }
}


// 关键字查询列
export async function search_column_details(session_id: string, table_name: string, schema_name?: string): Promise<ColumnInfo[]> {
  console.log('search_column_details 调用参数:', session_id, table_name, schema_name)
  if (session_id === "") {
    console.log('session_id 为空')
    return []
  }

  try {
    const request: ColumnQueryRequest = {
      session_id,
      table_name,
      schema_name
    }
    const result = await invoke<ColumnInfo[]>('get_columns_for_table', { request })

    console.log('get_columns_for_table 结果:', result)

    return result
  } catch (error) {
    console.error('执行失败:', error)
    return []
  }
}