// 数据库连接配置
export interface ConnectionConfig {
  id?: string
  name: string
  server: string
  port?: number
  database: string
  username: string
  password: string
  trustServerCertificate?: boolean
  connectionTimeout?: number
  encrypt?: boolean
}

// 测试连接响应
export interface ConnectionResponse {
  success: boolean
  message: string
  session_id?: string  // 兼容后端返回的下划线格式
}

// 查询请求
export interface QueryRequest {
  session_id: string
  sql: string
}

// 查询请求
export interface DBObjectInfoRequest {
  session_id: string
  keyword: string
}
// 查询请求
export interface TableQueryRequest {
  session_id: string
  keyword: string
}

export interface TableInfo {
  name: string
  schema?: string
}

// 查询请求
export interface ColumnQueryRequest {
  session_id: string
  table_name: string
  schema_name?: string
}

export interface ColumnInfo {
  name: string
  data_type: string
  table_name: String,
}

// 单个结果集
export interface ResultSet {
  columns: string[]
  column_types?: string[]
  rows: Record<string, any>[]
  affected_rows?: number
  error?: string
}

// 查询结果 - 支持多结果集
export interface QueryResult {
  result_sets: ResultSet[]
  error?: string
}

// 查询会话
export interface QuerySession {
  id: string
  connectionId?: string
  connectionName: string
  server: string
  database: string
  isActive: boolean
}

// 查询历史
export interface QueryHistory {
  id: string
  session_id: string
  connectionName: string
  database: string
  sql: string
  executedAt: string
  duration: number
  success: boolean
  errorMessage?: string
}

// SQL脚本
export interface SqlScript {
  id: string
  name: string
  groupName: string
  content: string
  description?: string
  createdAt: string
  updatedAt: string
}

// 数据库对象类型
export enum DatabaseObjectType {
  StoredProcedure = 'PROCEDURE',
  Function = 'FUNCTION',
  View = 'VIEW',
}

export interface DatabaseObjectInfo {
  name: string,
  schema_name: string,
  full_name: string,
  definition: string,
}