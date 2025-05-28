use anyhow::Result;
use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use thiserror::Error;
use tiberius::{AuthMethod, Client, Config, EncryptionLevel, Row};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};
use rust_decimal::Decimal;

pub mod sql_parser;
pub use sql_parser::{SqlParser, SqlStatementType};

// 连接配置
#[derive(Debug, Serialize, Deserialize, Clone, Eq, Hash)]
pub struct ConnectionConfig {
    pub id: Option<String>,
    pub name: String,
    pub server: String,
    pub port: Option<u16>,
    pub database: String,
    pub username: String,
    pub password: String,
    pub trust_server_certificate: Option<bool>,
    pub connection_timeout: Option<u64>,
    pub encrypt: Option<bool>,
}

impl PartialEq for ConnectionConfig {
    fn eq(&self, other: &Self) -> bool {
        self.server == other.server &&
        self.port == other.port &&
        self.database == other.database &&
        self.username == other.username &&
        self.password == other.password &&
        self.trust_server_certificate == other.trust_server_certificate &&
        self.encrypt == other.encrypt
    }
}

// 查询结果
#[derive(Debug, Serialize)]
pub struct ResultSet {
    pub columns: Vec<String>,
    pub column_types: Vec<String>,
    pub rows: Vec<HashMap<String, serde_json::Value>>,
    pub affected_rows: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct QueryResult {
    pub result_sets: Vec<ResultSet>,
    pub error: Option<String>,
    pub execution_time: Option<f64>,
}

// 错误类型
#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("连接错误: {0}")]
    ConnectionError(String),

    #[error("查询错误: {0}")]
    QueryError(String),

    #[error("超时错误: {0}")]
    TimeoutError(String),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredProcedureInfo {
    pub name: String,
    pub schema_name: String,
    pub full_name: String,
    pub definition: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParameterInfo {
    pub name: String,
    pub data_type: String,
    pub max_length: Option<i16>,
    pub is_output: bool,
    pub has_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcedureExecutionInfo {
    pub name: String,
    pub schema_name: String,
    pub parameters: Vec<ParameterInfo>,
    pub execute_snippet: String,
}

#[derive(serde::Serialize, Debug)]
pub struct TableInfo {
    name: String,
    schema: Option<String>, // Optional: if you want to show schema.table
}

#[derive(serde::Serialize, Debug)]
pub struct ColumnInfo {
    name: String,
    data_type: String,
    table_name: String,
}

// New structs for other database objects
#[derive(Debug, Serialize, Deserialize)]
pub struct StoredTableInfo {
    pub name: String,
    pub schema_name: String,
    pub full_name: String,
    pub table_type: String,
    pub row_count: i64,
    pub created_date: String,
    pub modified_date: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredViewInfo {
    pub name: String,
    pub schema_name: String,
    pub full_name: String,
    pub definition: String,
    pub created_date: String,
    pub modified_date: String,
    pub is_updatable: bool,
    pub check_option: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoredFunctionInfo {
    pub name: String,
    pub schema_name: String,
    pub full_name: String,
    pub definition: String,
    pub function_type: String,
    pub return_type: String,
    pub created_date: String,
    pub modified_date: String,
}

// 辅助函数：从Row中提取值并转换为JSON
fn get_value_as_json(row: &Row, index: usize) -> Result<serde_json::Value, String> {
    // 尝试各种不同的类型，根据SQL Server常见数据类型
    if let Ok(Some(val)) = row.try_get::<&str, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将字符串转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<i32, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将i32转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<i64, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将i64转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<f32, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将f32转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<f64, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将f64转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<bool, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将bool转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<tiberius::numeric::Numeric, _>(index) {
        // 处理 SQL Server 的 decimal/numeric 类型
        let decimal_val = Decimal::from_i128_with_scale(val.value(), val.scale() as u32);
        return Ok(serde_json::to_value(decimal_val).map_err(|e| format!("无法将Numeric转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<chrono::NaiveDateTime, _>(index) {
        return Ok(
            serde_json::to_value(val).map_err(|e| format!("无法将DateTime转换为JSON: {}", e))?
        );
    } else if let Ok(Some(val)) = row.try_get::<chrono::NaiveDate, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将Date转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<chrono::NaiveTime, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将Time转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<uuid::Uuid, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将UUID转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<&[u8], _>(index) {
        return Ok(
            serde_json::to_value(val).map_err(|e| format!("无法将二进制数据转换为JSON: {}", e))?
        );
    } else if let Ok(None) = row.try_get::<&str, _>(index) {
        // 处理NULL值
        return Ok(serde_json::Value::Null);
    }
    // 如果所有尝试都失败，记录信息并返回Null
    //println!("警告: 列索引 {} 的数据类型未能识别，返回 NULL", index);
    Ok(serde_json::Value::Null)
}

// 创建SQL Server连接
pub async fn create_connection(
    config: &ConnectionConfig,
) -> Result<Client<Compat<TcpStream>>, DatabaseError> {
    println!("开始创建数据库连接，配置: {:?}", config);

    let mut tiberius_config = Config::new();
    tiberius_config.host(&config.server);
    let port = config.port.unwrap_or(1433);
    tiberius_config.port(port);
    tiberius_config.database(&config.database);
    tiberius_config.authentication(AuthMethod::sql_server(&config.username, &config.password));

    let trust_cert = config.trust_server_certificate.unwrap_or(false);
    if trust_cert {
        tiberius_config.trust_cert();
    }

    let encrypt = config.encrypt.unwrap_or(false);
    if encrypt {
        tiberius_config.encryption(EncryptionLevel::Required);
    } else {
        tiberius_config.encryption(EncryptionLevel::NotSupported);
    }

    let timeout_duration = Duration::from_secs(config.connection_timeout.unwrap_or(30));
    let tcp = match timeout(
        timeout_duration,
        TcpStream::connect(format!("{}:{}", config.server, port)),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => {
            let error_msg = format!("TCP连接失败: {}", e);
            println!("{}", error_msg);
            return Err(DatabaseError::ConnectionError(error_msg));
        }
        Err(_) => {
            let error_msg = format!("连接超时 ({}秒)", timeout_duration.as_secs());
            println!("{}", error_msg);
            return Err(DatabaseError::TimeoutError(error_msg));
        }
    };

    match tcp.set_nodelay(true) {
        Ok(_) => println!("TCP no_delay设置成功"),
        Err(e) => {
            let error_msg = format!("设置TCP no_delay失败: {}", e);
            println!("{}", error_msg);
            return Err(DatabaseError::ConnectionError(error_msg));
        }
    }

    let client = match timeout(
        timeout_duration,
        Client::connect(tiberius_config, tcp.compat_write()),
    )
    .await
    {
        Ok(Ok(client)) => {
            println!("Tiberius客户端连接成功建立");
            client
        }
        Ok(Err(e)) => {
            let error_msg = format!("Tiberius连接失败: {}", e);
            println!("{}", error_msg);
            return Err(DatabaseError::ConnectionError(error_msg));
        }
        Err(_) => {
            let error_msg = format!("连接超时 ({}秒)", timeout_duration.as_secs());
            println!("{}", error_msg);
            return Err(DatabaseError::TimeoutError(error_msg));
        }
    };

    Ok(client)
}

// 执行查询并返回结果
pub async fn execute_query(
    client: &mut Client<Compat<TcpStream>>,
    sql: &str,
) -> Result<QueryResult, DatabaseError> {
    let mut result_sets = Vec::new();
    let start_time = std::time::Instant::now();

    // 不分割SQL，直接执行整个查询
    match client.simple_query(sql).await {
        Ok(result) => {
            // 获取所有结果集
            match result.into_results().await {
                Ok(all_result_sets) => {

                    // 处理每个结果集
                    for result_rows in all_result_sets {
                        let mut columns = Vec::new();
                        let mut column_types = Vec::new();
                        let mut processed_rows = Vec::new();

                        if !result_rows.is_empty() {
                            // 获取列信息 - 只借用第一行来获取列信息
                            let cols = result_rows[0].columns();
                            let mut unnamed_count = 0;
                            let mut column_name_map = HashMap::new();

                            column_types = cols
                                .iter()
                                .map(|c| format!("{:?}", c.column_type()))
                                .collect();

                            // 处理列名
                            for (i, c) in cols.iter().enumerate() {
                                let name = c.name();
                                if name.is_empty() {
                                    unnamed_count += 1;
                                    let generated_name = format!("Column_{}", unnamed_count);
                                    column_name_map.insert(i, generated_name);
                                } else {
                                    if column_name_map.values().any(|v| v == name) {
                                        let unique_name = format!("{}_{}", name, i);
                                        column_name_map.insert(i, unique_name);
                                    } else {
                                        column_name_map.insert(i, name.to_string());
                                    }
                                }
                            }

                            // 处理所有行 - 使用引用迭代
                            for row in &result_rows {
                                let mut row_data = HashMap::new();
                                for (i, _) in cols.iter().enumerate() {
                                    let column_name = column_name_map.get(&i).unwrap();
                                    let value = match get_value_as_json(row, i) {
                                        Ok(val) => val,
                                        Err(_) => serde_json::Value::Null,
                                    };
                                    row_data.insert(column_name.clone(), value);
                                }
                                processed_rows.push(row_data);
                            }

                            // 更新列名列表
                            let mut column_entries: Vec<(&usize, &String)> =
                                column_name_map.iter().collect();
                            column_entries.sort_by_key(|&(idx, _)| *idx);
                            columns = column_entries
                                .into_iter()
                                .map(|(_, name)| name.clone())
                                .collect();
                        }

                        let affected_rows_count = Some(processed_rows.len() as u64);

                        // 添加到结果集
                        result_sets.push(ResultSet {
                            columns,
                            column_types,
                            rows: processed_rows,
                            affected_rows: affected_rows_count,
                            error: None,
                        });
                    }
                }
                Err(e) => {
                    return Err(DatabaseError::QueryError(format!("处理结果集失败: {}", e)));
                }
            }
        }
        Err(e) => {
            return Err(DatabaseError::QueryError(format!("查询执行失败: {}", e)));
        }
    }

    // 如果没有任何结果集，添加一个空的
    if result_sets.is_empty() {
        result_sets.push(ResultSet {
            columns: Vec::new(),
            column_types: Vec::new(),
            rows: Vec::new(),
            affected_rows: Some(0),
            error: None,
        });
    }

    let execution_time = start_time.elapsed();
    let execution_time_secs = execution_time.as_secs_f64();

    Ok(QueryResult {
        result_sets,
        error: None,
        execution_time: Some(execution_time_secs),
    })
}

// 执行非查询操作
pub async fn execute_non_query(
    client: &mut Client<Compat<TcpStream>>,
    sql: &str,
) -> Result<QueryResult, DatabaseError> {
    let result = match client.execute(sql, &[]).await {
        Ok(result) => result,
        Err(e) => return Err(DatabaseError::QueryError(format!("执行失败: {}", e))),
    };

    // Extract the rows_affected as a single u64 value
    let affected = match result.rows_affected().first() {
        Some(&count) => Some(count),
        None => Some(0), // Default to 0 if no affected rows info available
    };

    let result_set = ResultSet {
        columns: Vec::new(),
        column_types: Vec::new(),
        rows: Vec::new(),
        affected_rows: affected,
        error: None,
    };

    Ok(QueryResult {
        result_sets: vec![result_set],
        error: None,
        execution_time: None,
    })
}

/// 智能执行SQL - 自动解析SQL类型并选择合适的执行方法
pub async fn execute_sql_smart(
    client: &mut Client<Compat<TcpStream>>,
    sql: &str,
) -> Result<QueryResult, DatabaseError> {
    let parser = SqlParser::new();
    let start_time = std::time::Instant::now();
    
    // 解析SQL语句
    let parsed_statements = match parser.parse_sql(sql) {
        Ok(statements) => statements,
        Err(e) => {
            println!("SQL解析失败，回退到简单执行: {}", e);
            // 如果解析失败，默认使用查询方式执行
            return execute_query(client, sql).await;
        }
    };

    println!("parsed_statements: {:?}", parsed_statements);

    let mut all_result_sets = Vec::new();
    let mut error_message: Option<String> = None;

    // 逐个执行解析出的SQL语句
    for (index, parsed_stmt) in parsed_statements.iter().enumerate() {
        println!("执行第{}个语句: {} (类型: {:?})", index + 1, parsed_stmt.sql, parsed_stmt.statement_type);
        
        let result = match parsed_stmt.statement_type {
            SqlStatementType::Query => {
                execute_query(client, &parsed_stmt.sql).await
            }
            SqlStatementType::NonQuery => {
                execute_non_query(client, &parsed_stmt.sql).await
            }
            SqlStatementType::Unknown => {
                // 对于未知类型，尝试查询方式，如果失败再尝试非查询方式
                match execute_query(client, &parsed_stmt.sql).await {
                    Ok(result) => Ok(result),
                    Err(_) => {
                        println!("查询方式失败，尝试非查询方式");
                        execute_non_query(client, &parsed_stmt.sql).await
                    }
                }
            }
        };

        match result {
            Ok(mut query_result) => {
                // 为每个结果集添加语句信息
                for result_set in &mut query_result.result_sets {
                    if result_set.error.is_none() {
                        // 可以在这里添加语句索引或其他元信息
                    }
                }
                all_result_sets.extend(query_result.result_sets);
            }
            Err(e) => {
                let current_error = format!("语句 {} 执行失败: {}", index + 1, e);
                error_message = Some(current_error.clone());
                println!("{}", current_error);
                
                // 添加错误结果集
                all_result_sets.push(ResultSet {
                    columns: Vec::new(),
                    column_types: Vec::new(),
                    rows: Vec::new(),
                    affected_rows: None,
                    error: Some(current_error),
                });
                
                // 可以选择继续执行后续语句或者停止
                // 这里选择继续执行
                continue;
            }
        }
    }

    // 如果没有任何结果集，添加一个空的
    if all_result_sets.is_empty() {
        all_result_sets.push(ResultSet {
            columns: Vec::new(),
            column_types: Vec::new(),
            rows: Vec::new(),
            affected_rows: None,
            error: error_message.clone(),
        });
    }

    let execution_time = start_time.elapsed();
    let execution_time_secs = execution_time.as_secs_f64();

    Ok(QueryResult {
        result_sets: all_result_sets,
        error: error_message,
        execution_time: Some(execution_time_secs),
    })
}

pub async fn search_stored_procedures(
    client: &mut Client<Compat<TcpStream>>,
    keyword: &str,
) -> Result<Vec<StoredProcedureInfo>, DatabaseError> {
    let mut results = Vec::new();

    // 优化后的查询 - 使用 UNION 分别处理不同搜索条件
    let sp_query = r#"
            ;WITH ProcedureMatches AS (
                -- 按存储过程名称搜索
                SELECT DISTINCT
                    p.object_id,
                    SCHEMA_NAME(p.schema_id) as schema_name,
                    p.name as procedure_name,
                    1 as match_priority
                FROM sys.procedures p
                WHERE p.name LIKE @P1
                
                UNION
                
                -- 按 Schema 名称搜索
                SELECT DISTINCT
                    p.object_id,
                    SCHEMA_NAME(p.schema_id) as schema_name,
                    p.name as procedure_name,
                    2 as match_priority
                FROM sys.procedures p
                WHERE SCHEMA_NAME(p.schema_id) LIKE @P1
            )
            SELECT TOP 50
                pm.schema_name,
                pm.procedure_name,
                m.definition,
                pm.match_priority
            FROM ProcedureMatches pm
            INNER JOIN sys.sql_modules m ON pm.object_id = m.object_id
            ORDER BY pm.match_priority, pm.schema_name, pm.procedure_name
        "#;

    let search_pattern = format!("%{}%", keyword);

    // Execute the query and handle the stream
    let mut stream = client
        .query(sp_query, &[&search_pattern])
        .await
        .map_err(|e| DatabaseError::QueryError(format!("查询存储过程失败: {}", e)))?;

    while let Ok(Some(query_item)) = stream.try_next().await {
        // Extract a single row from QueryItem
        if let Some(row) = query_item.into_row() {
            let schema_name: &str = row.get("schema_name").unwrap_or("");
            let procedure_name: &str = row.get("procedure_name").unwrap_or("");
            let definition: &str = row.get("definition").unwrap_or("");

            let sp_info = StoredProcedureInfo {
                name: procedure_name.to_string(),
                schema_name: schema_name.to_string(),
                full_name: format!("[{}].[{}]", schema_name, procedure_name),
                definition: definition.to_string(),
            };

            results.push(sp_info);
        }
    }

    Ok(results)
}

pub async fn search_tables(
    client: &mut Client<Compat<TcpStream>>,
    keyword: &str,
) -> Result<Vec<TableInfo>, DatabaseError> {
    let mut results = Vec::new();

    // 优化的表查询 - 搜索表名称和Schema名称
    let table_query = r#"
        WITH TableMatches AS (
            -- 按表名称搜索
            SELECT DISTINCT
                t.object_id,
                SCHEMA_NAME(t.schema_id) as schema_name,
                t.name as table_name,
                1 as match_priority
            FROM sys.tables t
            WHERE t.name LIKE @P1
            
            UNION
            
            -- 按Schema名称搜索
            SELECT DISTINCT
                t.object_id,
                SCHEMA_NAME(t.schema_id) as schema_name,
                t.name as table_name,
                2 as match_priority
            FROM sys.tables t
            WHERE SCHEMA_NAME(t.schema_id) LIKE @P1
        )
        SELECT
            tm.schema_name,
            tm.table_name
        FROM TableMatches tm
        ORDER BY tm.match_priority, tm.schema_name, tm.table_name
    "#;

    let search_pattern = if keyword.is_empty() {
        "%".to_string() // 如果关键字为空，返回所有表
    } else {
        format!("%{}%", keyword)
    };

    // 执行查询并处理结果流
    let mut stream = client
        .query(table_query, &[&search_pattern])
        .await
        .map_err(|e| DatabaseError::QueryError(format!("查询表失败: {}", e)))?;

    while let Ok(Some(query_item)) = stream.try_next().await {
        // 从QueryItem中提取单行
        if let Some(row) = query_item.into_row() {
            let schema_name: &str = row.get("schema_name").unwrap_or("");
            let table_name: &str = row.get("table_name").unwrap_or("");

            let table_info = TableInfo {
                name: table_name.to_string(),
                schema: Some(schema_name.to_string()),
            };

            results.push(table_info);
        }
    }

    Ok(results)
}

pub async fn search_table_columns(
    client: &mut Client<Compat<TcpStream>>,
    table_name: &str,
    schema_name: Option<&str>,
) -> Result<Vec<ColumnInfo>, DatabaseError> {
    let mut results = Vec::new();

    // 查询指定表的所有列
    let column_query = match schema_name {
        // 如果提供了schema名称，则使用完全限定表名
        Some(_schema) => {
            r#"
            SELECT 
                c.name as column_name,
                t.name as data_type,
                CASE WHEN t.name IN ('varchar', 'nvarchar', 'char', 'nchar') AND c.max_length <> -1
                    THEN t.name + '(' + 
                         CASE WHEN t.name IN ('nvarchar', 'nchar') 
                              THEN CAST(c.max_length/2 AS VARCHAR) 
                              ELSE CAST(c.max_length AS VARCHAR) 
                         END + ')'
                    WHEN t.name IN ('varchar', 'nvarchar') AND c.max_length = -1
                    THEN t.name + '(MAX)'
                    WHEN t.name IN ('decimal', 'numeric')
                    THEN t.name + '(' + CAST(c.precision AS VARCHAR) + ',' + CAST(c.scale AS VARCHAR) + ')'
                    ELSE t.name
                END as detailed_type,
                tbl.name as table_name
            FROM sys.columns c
            JOIN sys.tables tbl ON c.object_id = tbl.object_id
            JOIN sys.schemas s ON tbl.schema_id = s.schema_id
            JOIN sys.types t ON c.user_type_id = t.user_type_id
            WHERE tbl.name = @P1 AND s.name = @P2
            ORDER BY c.column_id
        "#
        }
        // 如果没有提供schema名称，则只按表名查询
        None => {
            r#"
            SELECT 
                c.name as column_name,
                t.name as data_type,
                CASE WHEN t.name IN ('varchar', 'nvarchar', 'char', 'nchar') AND c.max_length <> -1
                    THEN t.name + '(' + 
                         CASE WHEN t.name IN ('nvarchar', 'nchar') 
                              THEN CAST(c.max_length/2 AS VARCHAR) 
                              ELSE CAST(c.max_length AS VARCHAR) 
                         END + ')'
                    WHEN t.name IN ('varchar', 'nvarchar') AND c.max_length = -1
                    THEN t.name + '(MAX)'
                    WHEN t.name IN ('decimal', 'numeric')
                    THEN t.name + '(' + CAST(c.precision AS VARCHAR) + ',' + CAST(c.scale AS VARCHAR) + ')'
                    ELSE t.name
                END as detailed_type,
                tbl.name as table_name
            FROM sys.columns c
            JOIN sys.tables tbl ON c.object_id = tbl.object_id
            JOIN sys.types t ON c.user_type_id = t.user_type_id
            WHERE tbl.name = @P1
            ORDER BY c.column_id
        "#
        }
    };

    // 执行查询并处理结果流
    let mut stream = match schema_name {
        Some(schema) => client
            .query(column_query, &[&table_name, &schema])
            .await
            .map_err(|e| DatabaseError::QueryError(format!("查询列失败: {}", e)))?,
        None => client
            .query(column_query, &[&table_name])
            .await
            .map_err(|e| DatabaseError::QueryError(format!("查询列失败: {}", e)))?,
    };

    while let Ok(Some(query_item)) = stream.try_next().await {
        // 从QueryItem中提取单行
        if let Some(row) = query_item.into_row() {
            let column_name: &str = row.get("column_name").unwrap_or("");
            let data_type: &str = row.get("detailed_type").unwrap_or(""); // 使用详细类型
            let table_name: &str = row.get("table_name").unwrap_or("");

            let column_info = ColumnInfo {
                name: column_name.to_string(),
                data_type: data_type.to_string(),
                table_name: table_name.to_string(),
            };

            results.push(column_info);
        }
    }

    Ok(results)
}

// Search tables with metadata and column information
// pub async fn search_stored_tables(
//     client: &mut Client<Compat<TcpStream>>,
//     keyword: &str,
// ) -> Result<Vec<StoredTableInfo>, DatabaseError> {
//     let mut basic_results = Vec::new();

//     let table_query = r#"
//         ;WITH TableMatches AS (
//             -- 按表名搜索
//             SELECT DISTINCT
//                 t.object_id,
//                 SCHEMA_NAME(t.schema_id) as schema_name,
//                 t.name as table_name,
//                 t.type_desc as table_type,
//                 t.create_date,
//                 t.modify_date,
//                 1 as match_priority
//             FROM sys.tables t
//             WHERE t.name LIKE @P1

//             UNION

//             -- 按 Schema 名称搜索
//             SELECT DISTINCT
//                 t.object_id,
//                 SCHEMA_NAME(t.schema_id) as schema_name,
//                 t.name as table_name,
//                 t.type_desc as table_type,
//                 t.create_date,
//                 t.modify_date,
//                 2 as match_priority
//             FROM sys.tables t
//             WHERE SCHEMA_NAME(t.schema_id) LIKE @P1
//         )
//         SELECT TOP 50
//             tm.schema_name,
//             tm.table_name,
//             tm.table_type,
//             tm.create_date,
//             tm.modify_date,
//             ISNULL(ddps.row_count, 0) as row_count,
//             tm.match_priority
//         FROM TableMatches tm
//         LEFT JOIN sys.dm_db_partition_stats ddps ON tm.object_id = ddps.object_id AND ddps.index_id < 2
//         ORDER BY tm.match_priority, tm.schema_name, tm.table_name
//     "#;

//     let search_pattern = format!("%{}%", keyword);
//     let mut stream = client
//         .query(table_query, &[&search_pattern])
//         .await
//         .map_err(|e| DatabaseError::QueryError(format!("查询表失败: {}", e)))?;

//     while let Ok(Some(query_item)) = stream.try_next().await {
//         if let Some(row) = query_item.into_row() {
//             let schema_name: &str = row.get("schema_name").unwrap_or("");
//             let table_name: &str = row.get("table_name").unwrap_or("");
//             let table_type: &str = row.get("table_type").unwrap_or("");
//             let row_count: i64 = row.get("row_count").unwrap_or(0);
//             let create_date: chrono::NaiveDateTime = row.get("create_date").unwrap_or_default();
//             let modify_date: chrono::NaiveDateTime = row.get("modify_date").unwrap_or_default();

//             basic_results.push((
//                 schema_name.to_string(),
//                 table_name.to_string(),
//                 table_type.to_string(),
//                 row_count,
//                 create_date.format("%Y-%m-%d %H:%M:%S").to_string(),
//                 modify_date.format("%Y-%m-%d %H:%M:%S").to_string(),
//             ));
//         }
//     }

//     //drop(stream);

//     let mut results = Vec::new();
//     for (schema_name, table_name, table_type, row_count, created_date, modified_date) in
//         basic_results
//     {
//         // let mut columns = Vec::new();

//         // let column_query = r#"
//         //     SELECT
//         //         c.name as column_name,
//         //         t.name as data_type,
//         //         c.max_length,
//         //         c.precision,
//         //         c.scale,
//         //         c.is_nullable,
//         //         c.is_identity,
//         //         CASE WHEN pk.column_name IS NOT NULL THEN 1 ELSE 0 END as is_primary_key
//         //     FROM sys.columns c
//         //     INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
//         //     LEFT JOIN (
//         //         SELECT ku.column_name
//         //         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
//         //         INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.constraint_name = ku.constraint_name
//         //         WHERE tc.constraint_type = 'PRIMARY KEY'
//         //         AND tc.table_schema = @P1
//         //         AND tc.table_name = @P2
//         //     ) pk ON c.name = pk.column_name
//         //     WHERE c.object_id = OBJECT_ID(@P1 + '.' + @P2)
//         //     ORDER BY c.column_id
//         // "#;

//         // let mut stream = client
//         //     .query(column_query, &[&schema_name, &table_name])
//         //     .await
//         //     .map_err(|e| DatabaseError::QueryError(format!("查询列信息失败: {}", e)))?;

//         // while let Ok(Some(query_item)) = stream.try_next().await {
//         //     if let Some(row) = query_item.into_row() {
//         //         let column_info = StoredColumnInfo {
//         //             name: row.get::<&str, _>("column_name").unwrap_or("").to_string(),
//         //             data_type: row.get::<&str, _>("data_type").unwrap_or("").to_string(),
//         //             max_length: row.get("max_length").unwrap_or(0),
//         //             precision: row.get("precision").unwrap_or(0),
//         //             scale: row.get("scale").unwrap_or(0),
//         //             is_nullable: row.get("is_nullable").unwrap_or(false),
//         //             is_identity: row.get("is_identity").unwrap_or(false),
//         //             is_primary_key: row.get::<i32, _>("is_primary_key").unwrap_or(0) == 1,
//         //         };
//         //         columns.push(column_info);
//         //     }
//         // }

//         let table_info = StoredTableInfo {
//             name: table_name.clone(),
//             schema_name: schema_name.clone(),
//             full_name: format!("[{}].[{}]", schema_name, table_name),
//             table_type,
//             row_count,
//             created_date,
//             modified_date
//         };
//         results.push(table_info);
//     }

//     Ok(results)
// }

// Search views with definition and metadata
pub async fn search_stored_views(
    client: &mut Client<Compat<TcpStream>>,
    keyword: &str,
) -> Result<Vec<StoredViewInfo>, DatabaseError> {
    let mut results = Vec::new();

    let view_query = r#"
        ;WITH ViewMatches AS (
            -- 按视图名称搜索
            SELECT DISTINCT
                v.object_id,
                SCHEMA_NAME(v.schema_id) as schema_name,
                v.name as view_name,
                v.create_date,
                v.modify_date,
                1 as match_priority
            FROM sys.views v
            WHERE v.name LIKE @P1
            
            UNION
            
            -- 按 Schema 名称搜索
            SELECT DISTINCT
                v.object_id,
                SCHEMA_NAME(v.schema_id) as schema_name,
                v.name as view_name,
                v.create_date,
                v.modify_date,
                2 as match_priority
            FROM sys.views v
            WHERE SCHEMA_NAME(v.schema_id) LIKE @P1
        )
        SELECT TOP 50
            vm.schema_name,
            vm.view_name,
            vm.create_date,
            vm.modify_date,
            m.definition,
            ISNULL(iv.is_updatable, 'NO') as is_updatable,
            ISNULL(iv.check_option, 'NONE') as check_option,
            vm.match_priority
        FROM ViewMatches vm
        INNER JOIN sys.sql_modules m ON vm.object_id = m.object_id
        LEFT JOIN INFORMATION_SCHEMA.VIEWS iv ON vm.schema_name = iv.table_schema AND vm.view_name = iv.table_name
        ORDER BY vm.match_priority, vm.schema_name, vm.view_name
    "#;

    let search_pattern = format!("%{}%", keyword);
    let mut stream = client
        .query(view_query, &[&search_pattern])
        .await
        .map_err(|e| DatabaseError::QueryError(format!("查询视图失败: {}", e)))?;

    while let Ok(Some(query_item)) = stream.try_next().await {
        if let Some(row) = query_item.into_row() {
            let schema_name: &str = row.get("schema_name").unwrap_or("");
            let view_name: &str = row.get("view_name").unwrap_or("");
            let definition: &str = row.get("definition").unwrap_or("");
            let is_updatable: &str = row.get("is_updatable").unwrap_or("NO");
            let check_option: &str = row.get("check_option").unwrap_or("NONE");
            let create_date: chrono::NaiveDateTime = row.get("create_date").unwrap_or_default();
            let modify_date: chrono::NaiveDateTime = row.get("modify_date").unwrap_or_default();

            let view_info = StoredViewInfo {
                name: view_name.to_string(),
                schema_name: schema_name.to_string(),
                full_name: format!("[{}].[{}]", schema_name, view_name),
                definition: definition.to_string(),
                created_date: create_date.format("%Y-%m-%d %H:%M:%S").to_string(),
                modified_date: modify_date.format("%Y-%m-%d %H:%M:%S").to_string(),
                is_updatable: is_updatable == "YES",
                check_option: check_option.to_string(),
            };
            results.push(view_info);
        }
    }
    Ok(results)
}

// Search functions with parameters and metadata
pub async fn search_stored_functions(
    client: &mut Client<Compat<TcpStream>>,
    keyword: &str,
) -> Result<Vec<StoredFunctionInfo>, DatabaseError> {
    let mut basic_results = Vec::new();

    let function_query = r#"
        ;WITH FunctionMatches AS (
            SELECT DISTINCT
                o.object_id,
                SCHEMA_NAME(o.schema_id) as schema_name,
                o.name as function_name,
                o.type_desc as function_type,
                o.create_date,
                o.modify_date,
                1 as match_priority
            FROM sys.objects o
            WHERE o.type IN ('FN', 'IF', 'TF', 'FS', 'FT') 
              AND o.name LIKE @P1
            
            UNION
            
            SELECT DISTINCT
                o.object_id,
                SCHEMA_NAME(o.schema_id) as schema_name,
                o.name as function_name,
                o.type_desc as function_type,
                o.create_date,
                o.modify_date,
                2 as match_priority
            FROM sys.objects o
            WHERE o.type IN ('FN', 'IF', 'TF', 'FS', 'FT') 
              AND SCHEMA_NAME(o.schema_id) LIKE @P1
        )
        SELECT TOP 50
            fm.schema_name,
            fm.function_name,
            fm.function_type,
            fm.create_date,
            fm.modify_date,
            m.definition,
            ISNULL(rt.name, 'TABLE') as return_type,
            fm.match_priority
        FROM FunctionMatches fm
        INNER JOIN sys.sql_modules m ON fm.object_id = m.object_id
        LEFT JOIN sys.parameters p ON fm.object_id = p.object_id AND p.parameter_id = 0
        LEFT JOIN sys.types rt ON p.user_type_id = rt.user_type_id
        ORDER BY fm.match_priority, fm.schema_name, fm.function_name
    "#;

    let search_pattern = format!("%{}%", keyword);
    let mut stream = client
        .query(function_query, &[&search_pattern])
        .await
        .map_err(|e| DatabaseError::QueryError(format!("查询函数失败: {}", e)))?;

    while let Ok(Some(query_item)) = stream.try_next().await {
        if let Some(row) = query_item.into_row() {
            let schema_name: &str = row.get("schema_name").unwrap_or("");
            let function_name: &str = row.get("function_name").unwrap_or("");
            let function_type: &str = row.get("function_type").unwrap_or("");
            let definition: &str = row.get("definition").unwrap_or("");
            let return_type: &str = row.get("return_type").unwrap_or("");
            let create_date: chrono::NaiveDateTime = row.get("create_date").unwrap_or_default();
            let modify_date: chrono::NaiveDateTime = row.get("modify_date").unwrap_or_default();

            basic_results.push((
                schema_name.to_string(),
                function_name.to_string(),
                function_type.to_string(),
                definition.to_string(),
                return_type.to_string(),
                create_date.format("%Y-%m-%d %H:%M:%S").to_string(),
                modify_date.format("%Y-%m-%d %H:%M:%S").to_string(),
            ));
        }
    }

    let mut results = Vec::new();

    for (
        schema_name,
        function_name,
        function_type,
        definition,
        return_type,
        created_date,
        modified_date,
    ) in basic_results
    {
        let function_info = StoredFunctionInfo {
            name: function_name.clone(),
            schema_name: schema_name.clone(),
            full_name: format!("[{}].[{}]", schema_name, function_name),
            definition,
            function_type,
            return_type,
            created_date,
            modified_date,
        };

        results.push(function_info);
    }

    Ok(results)
}
