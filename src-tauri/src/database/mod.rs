use anyhow::Result;
use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use thiserror::Error;
use tiberius::{AuthMethod, Client, Config, EncryptionLevel, Row, QueryItem};
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

#[derive(Debug, Serialize, Deserialize, Clone)]
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

// 新增：用于自动完成的存储过程建议项
#[derive(Debug, Serialize, Deserialize)]
pub struct ProcedureSuggestionItem {
    pub name: String,
    pub schema_name: String,
    pub full_name: String,
    pub parameters: Vec<ParameterInfo>,
    pub execute_template: String, // 执行模板脚本
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
    let start_time = std::time::Instant::now();
    let mut result_sets: Vec<ResultSet> = Vec::new();
    let mut current_result_set: Option<ResultSet> = None;

    match client.simple_query(sql).await {
        Ok(mut stream) => {
            while let Some(item) = stream.try_next().await.map_err(|e| DatabaseError::QueryError(e.to_string()))? {
                match item {
                    QueryItem::Metadata(meta) => {
                        // 当我们收到元数据时，意味着一个新的结果集开始了。
                        // 如果之前已经有一个结果集正在处理，我们就先保存它。
                        if let Some(finished_result_set) = current_result_set.take() {
                            result_sets.push(finished_result_set);
                        }

                        // 从元数据中提取列名和类型
                        let mut unnamed_count = 0;
                        let columns: Vec<String> = meta.columns().iter().enumerate().map(|(i, c)| {
                            let name = c.name();
                            if name.is_empty() {
                                unnamed_count += 1;
                                format!("Column_{}", unnamed_count)
                            } else {
                                // 基础的重名处理
                                if meta.columns().iter().filter(|c2| c2.name() == name).count() > 1 {
                                    format!("{}_{}", name, i)
                                } else {
                                    name.to_string()
                                }
                            }
                        }).collect();

                        let column_types: Vec<String> = meta
                            .columns()
                            .iter()
                            .map(|c| format!("{:?}", c.column_type()))
                            .collect();
                        
                        // 初始化新的结果集
                        current_result_set = Some(ResultSet {
                            columns,
                            column_types,
                            rows: Vec::new(),
                            affected_rows: None, // 行数将在处理完行后更新
                            error: None,
                        });
                    }
                    QueryItem::Row(row) => {
                        // 如果收到一行数据，它属于当前的结果集
                        if let Some(ref mut rs) = current_result_set {
                            let mut row_data = HashMap::new();
                            for (i, col_name) in rs.columns.iter().enumerate() {
                                let value = match get_value_as_json(&row, i) {
                                    Ok(val) => val,
                                    Err(_) => serde_json::Value::Null,
                                };
                                row_data.insert(col_name.clone(), value);
                            }
                            rs.rows.push(row_data);
                        }
                    }
                }
            }

            // 处理最后一个结果集
            if let Some(mut last_result_set) = current_result_set.take() {
                let affected_rows_count = last_result_set.rows.len() as u64;
                last_result_set.affected_rows = Some(affected_rows_count);
                result_sets.push(last_result_set);
            }
        }
        Err(e) => {
             // 对于INSERT, UPDATE, DELETE等没有返回结果集的语句
             // 它们可能会在ExecuteResult中返回受影响的行数
            if let Some(rows_affected) = e.code() {
                 // 这里只是一个示例，根据您的具体错误处理逻辑调整
                 // e.rows_affected() 似乎不存在，但可以通过错误码判断
                 // 通常，您可能需要检查具体的错误类型
                result_sets.push(ResultSet {
                    columns: Vec::new(),
                    column_types: Vec::new(),
                    rows: Vec::new(),
                    affected_rows: Some(rows_affected as u64),
                    error: Some(e.to_string()),
                });

            } else {
                return Err(DatabaseError::QueryError(format!("{}", e)));
            }
        }
    }
    
    // 如果执行了非查询语句（如UPDATE, INSERT）而没有任何返回，
    // a `simple_query` call might not produce any result sets.
    // In such cases, you might want to return a default result set indicating rows affected if that info is available.
    // Note: `client.simple_query` is more for SELECT. For INSERT/UPDATE/DELETE, `client.execute` might be more appropriate
    // as it returns an `ExecuteResult` with `rows_affected()`.
    // If you stick with `simple_query`, you might need to handle the absence of result sets like this.
    if result_sets.is_empty() {
        result_sets.push(ResultSet {
            columns: Vec::new(),
            column_types: Vec::new(),
            rows: Vec::new(),
            affected_rows: Some(0), // 或者从其他地方获取
            error: None,
        });
    }

    let execution_time = start_time.elapsed().as_secs_f64();

    Ok(QueryResult {
        result_sets,
        error: None,
        execution_time: Some(execution_time),
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

    // 优化的表查询 - 搜索表名称和Schema名称，避免重复
    let table_query = r#"
        WITH TableMatches AS (
            -- 按表名称搜索
            SELECT DISTINCT
                t.object_id,
                SCHEMA_NAME(t.schema_id) as schema_name,
                t.name as table_name,
                CASE
                    WHEN t.name LIKE @P1 THEN 1
                    ELSE 2
                END as match_priority
            FROM sys.tables t
            WHERE t.name LIKE @P1 OR SCHEMA_NAME(t.schema_id) LIKE @P1
        )
        SELECT DISTINCT
            tm.schema_name,
            tm.table_name,
            tm.match_priority
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

#[allow(dead_code)]
// 新增：搜索存储过程建议项（用于自动完成）
pub async fn search_procedure_suggestions(
    client: &mut Client<Compat<TcpStream>>,
    keyword: &str,
) -> Result<Vec<ProcedureSuggestionItem>, DatabaseError> {
    let mut results = Vec::new();

    // 使用一条SQL语句同时查询存储过程和参数信息
    let combined_query = r#"
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
        ),
        TopProcedures AS (
            SELECT TOP 30
                pm.object_id,
                pm.schema_name,
                pm.procedure_name,
                pm.match_priority
            FROM ProcedureMatches pm
            ORDER BY pm.match_priority, pm.schema_name, pm.procedure_name
        )
        -- 主查询：存储过程信息
        SELECT 
            tp.object_id,
            tp.schema_name,
            tp.procedure_name,
            tp.match_priority,
            NULL as parameter_name,
            NULL as data_type,
            NULL as max_length,
            NULL as is_output,
            NULL as has_default_value,
            1 as result_type -- 1表示存储过程信息
        FROM TopProcedures tp

        UNION ALL

        -- 参数信息
        SELECT 
            tp.object_id,
            tp.schema_name,
            tp.procedure_name,
            tp.match_priority,
            param.name as parameter_name,
            TYPE_NAME(param.user_type_id) as data_type,
            param.max_length,
            param.is_output,
            param.has_default_value,
            2 as result_type -- 2表示参数信息
        FROM TopProcedures tp
        INNER JOIN sys.parameters param ON tp.object_id = param.object_id
        WHERE param.name IS NOT NULL AND param.name != ''

        ORDER BY object_id, result_type, 
                 CASE WHEN result_type = 2 THEN param.parameter_id ELSE 0 END;
    "#;

    let search_pattern = format!("{}%", keyword);

    // 执行合并查询
    let mut stream = client
        .query(combined_query, &[&search_pattern])
        .await
        .map_err(|e| DatabaseError::QueryError(format!("查询存储过程失败: {}", e)))?;

    // 用于组织数据的临时结构
    let mut procedures_map: std::collections::HashMap<i32, (String, String)> = std::collections::HashMap::new();
    let mut parameters_map: std::collections::HashMap<i32, Vec<ParameterInfo>> = std::collections::HashMap::new();

    // 处理查询结果
    while let Ok(Some(query_item)) = stream.try_next().await {
        if let Some(row) = query_item.into_row() {
            let object_id: i32 = row.get("object_id").unwrap_or(0);
            let schema_name: &str = row.get("schema_name").unwrap_or("");
            let procedure_name: &str = row.get("procedure_name").unwrap_or("");
            let result_type: i32 = row.get("result_type").unwrap_or(1);

            if result_type == 1 {
                // 存储过程基本信息
                procedures_map.insert(object_id, (schema_name.to_string(), procedure_name.to_string()));
            } else if result_type == 2 {
                // 参数信息
                let param_name: &str = row.get("parameter_name").unwrap_or("");
                let data_type: &str = row.get("data_type").unwrap_or("");
                let max_length: Option<i16> = row.get("max_length");
                let is_output: bool = row.get("is_output").unwrap_or(false);
                let has_default: bool = row.get("has_default_value").unwrap_or(false);

                if !param_name.is_empty() {
                    let param_info = ParameterInfo {
                        name: param_name.to_string(),
                        data_type: data_type.to_string(),
                        max_length: max_length.filter(|&len| len > 0),
                        is_output,
                        has_default,
                    };

                    parameters_map.entry(object_id)
                        .or_insert_with(Vec::new)
                        .push(param_info);
                }
            }
        }
    }

    // 组装最终结果
    for (object_id, (schema_name, procedure_name)) in procedures_map {
        let parameters = parameters_map.get(&object_id).cloned().unwrap_or_default();
        
        // 生成执行模板
        let execute_template = generate_execute_template(&schema_name, &procedure_name, &parameters);

        let suggestion_item = ProcedureSuggestionItem {
            name: procedure_name.clone(),
            schema_name: schema_name.clone(),
            full_name: format!("[{}].[{}]", schema_name, procedure_name),
            parameters,
            execute_template,
        };

        results.push(suggestion_item);
    }

    // 按照原来的排序逻辑排序结果
    results.sort_by(|a, b| {
        a.schema_name.cmp(&b.schema_name)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(results)
}

// 新增：搜索存储过程建议项（高级版本）- 使用 simple_query 支持临时表和多结果集
pub async fn search_procedure_suggestions_advanced(
    client: &mut Client<Compat<TcpStream>>,
    keyword: &str,
) -> Result<Vec<ProcedureSuggestionItem>, DatabaseError> {
    let mut results = Vec::new();

    // 使用临时表和多结果集的高级SQL查询
    let advanced_query = format!(r#"
        -- 创建临时表存储匹配的存储过程
        CREATE TABLE #ProcedureMatches (
            object_id INT PRIMARY KEY, -- 添加主键以提高性能并确保唯一性
            schema_name NVARCHAR(128),
            procedure_name NVARCHAR(128),
            match_priority INT
        );

        -- 插入匹配的存储过程（按名称搜索）
        -- 移除了 DISTINCT，因为 object_id 已经是唯一的
        INSERT INTO #ProcedureMatches (object_id, schema_name, procedure_name, match_priority)
        SELECT
            p.object_id,
            SCHEMA_NAME(p.schema_id) as schema_name,
            p.name as procedure_name,
            1 as match_priority
        FROM sys.procedures p
        WHERE p.name LIKE N'{}%'
        ORDER BY p.name;

        -- 插入匹配的存储过程（按Schema搜索，排除重复）
        -- 优化了 Schema 搜索，并使用 NOT EXISTS
        INSERT INTO #ProcedureMatches (object_id, schema_name, procedure_name, match_priority)
        SELECT
            p.object_id,
            s.name as schema_name, --直接从 sys.schemas 获取
            p.name as procedure_name,
            2 as match_priority
        FROM sys.procedures p
        INNER JOIN sys.schemas s ON p.schema_id = s.schema_id -- JOIN sys.schemas
        WHERE s.name LIKE N'{}%'
            AND NOT EXISTS (SELECT 1 FROM #ProcedureMatches pm WHERE pm.object_id = p.object_id) -- 使用 NOT EXISTS
        ORDER BY s.name, p.name;

        -- 结果集1：存储过程基本信息
        SELECT 
            pm.object_id,
            pm.schema_name,
            pm.procedure_name,
            pm.match_priority,
            COUNT(param.parameter_id) as parameter_count -- COUNT(column_name) 忽略 NULLs，对于 LEFT JOIN 行为正确
        FROM #ProcedureMatches pm
        LEFT JOIN sys.parameters param ON pm.object_id = param.object_id
            AND param.name IS NOT NULL AND param.name != '' -- 确保只统计有效命名的参数
        GROUP BY pm.object_id, pm.schema_name, pm.procedure_name, pm.match_priority
        ORDER BY pm.match_priority, pm.schema_name, pm.procedure_name;

        -- 结果集2：参数详细信息
        SELECT 
            pm.object_id,
            param.name as parameter_name,
            TYPE_NAME(param.user_type_id) as data_type,
            param.max_length,
            param.precision,
            param.scale,
            param.is_output,
            param.has_default_value,
            param.parameter_id -- 保持原始 parameter_id 用于排序或识别
        FROM #ProcedureMatches pm
        INNER JOIN sys.parameters param ON pm.object_id = param.object_id
        WHERE param.name IS NOT NULL AND param.name != '' -- 确保只选择有效命名的参数
        ORDER BY pm.object_id, param.parameter_id; -- 按 object_id 后按参数原始顺序排序

        -- 清理临时表
        DROP TABLE #ProcedureMatches;
    "#, keyword, keyword);

    // 使用 simple_query 执行多结果集查询
    match client.simple_query(&advanced_query).await {
        Ok(query_result) => {
            match query_result.into_results().await {
                Ok(result_sets) => {
                    if result_sets.len() >= 2 {
                        // 处理第一个结果集：存储过程基本信息
                        let mut procedures_info: std::collections::HashMap<i32, (String, String, i32)> = 
                            std::collections::HashMap::new();
                        
                        for row in &result_sets[0] {
                            let object_id: i32 = row.get("object_id").unwrap_or(0);
                            let schema_name: String = row.get::<&str, _>("schema_name").unwrap_or("").to_string();
                            let procedure_name: String = row.get::<&str, _>("procedure_name").unwrap_or("").to_string();
                            let parameter_count: i32 = row.get("parameter_count").unwrap_or(0);
                            
                            procedures_info.insert(object_id, (schema_name, procedure_name, parameter_count));
                        }

                        // 处理第二个结果集：参数详细信息
                        let mut parameters_map: std::collections::HashMap<i32, Vec<ParameterInfo>> = 
                            std::collections::HashMap::new();
                        
                        for row in &result_sets[1] {
                            let object_id: i32 = row.get("object_id").unwrap_or(0);
                            let param_name: String = row.get::<&str, _>("parameter_name").unwrap_or("").to_string();
                            let data_type: String = row.get::<&str, _>("data_type").unwrap_or("").to_string();
                            let max_length: i16 = row.get("max_length").unwrap_or(0);
                            let precision: u8 = row.get("precision").unwrap_or(0);
                            let scale: u8 = row.get("scale").unwrap_or(0);
                            let is_output: bool = row.get("is_output").unwrap_or(false);
                            let has_default: bool = row.get("has_default_value").unwrap_or(false);

                            if !param_name.is_empty() {
                                // 格式化数据类型显示
                                let formatted_data_type = match data_type.to_lowercase().as_str() {
                                    "varchar" | "nvarchar" | "char" | "nchar" => {
                                        if max_length > 0 && max_length != -1 {
                                            format!("{}({})", data_type, max_length)
                                        } else if max_length == -1 {
                                            format!("{}(MAX)", data_type)
                                        } else {
                                            data_type.clone()
                                        }
                                    }
                                    "decimal" | "numeric" => {
                                        if precision > 0 {
                                            if scale > 0 {
                                                format!("{}({},{})", data_type, precision, scale)
                                            } else {
                                                format!("{}({})", data_type, precision)
                                            }
                                        } else {
                                            data_type.clone()
                                        }
                                    }
                                    _ => data_type.clone(),
                                };

                                let param_info = ParameterInfo {
                                    name: param_name,
                                    data_type: formatted_data_type,
                                    max_length: if max_length > 0 { Some(max_length) } else { None },
                                    is_output,
                                    has_default,
                                };

                                parameters_map.entry(object_id)
                                    .or_insert_with(Vec::new)
                                    .push(param_info);
                            }
                        }

                        // 组装最终结果
                        for (object_id, (schema_name, procedure_name, _parameter_count)) in procedures_info {
                            let parameters = parameters_map.get(&object_id).cloned().unwrap_or_default();
                            
                            // 生成执行模板
                            let execute_template = generate_execute_template(&schema_name, &procedure_name, &parameters);

                            let suggestion_item = ProcedureSuggestionItem {
                                name: procedure_name.clone(),
                                schema_name: schema_name.clone(),
                                full_name: format!("[{}].[{}]", schema_name, procedure_name),
                                parameters,
                                execute_template,
                            };

                            results.push(suggestion_item);
                        }
                    }
                }
                Err(e) => {
                    return Err(DatabaseError::QueryError(format!("处理多结果集失败: {}", e)));
                }
            }
        }
        Err(e) => {
            return Err(DatabaseError::QueryError(format!("执行高级查询失败: {}", e)));
        }
    }

    // 按照优先级和名称排序
    results.sort_by(|a, b| {
        a.schema_name.cmp(&b.schema_name)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(results)
}

// 生成存储过程执行模板
fn generate_execute_template(
    schema_name: &str,
    procedure_name: &str,
    parameters: &[ParameterInfo],
) -> String {
    let mut template = String::new();
    
    if parameters.is_empty() {
        // 无参数的存储过程
        template.push_str(&format!("[{}].[{}]", schema_name, procedure_name));
    } else {
        // 有参数的存储过程
        template.push_str(&format!(" [{}].[{}]\n", schema_name, procedure_name));
        
        for (index, param) in parameters.iter().enumerate() {
            let param_line = if param.is_output {
                // 输出参数
                if param.has_default {
                    format!("    {} = NULL OUTPUT", param.name)
                } else {
                    format!("    {} = @{} OUTPUT", param.name, param.name.trim_start_matches('@'))
                }
            } else {
                // 输入参数
                if param.has_default {
                    format!("    {} = NULL", param.name)
                } else {
                    // 根据数据类型提供默认值示例
                    let default_value = match param.data_type.to_lowercase().as_str() {
                        "int" | "bigint" | "smallint" | "tinyint" => "0",
                        "decimal" | "numeric" | "float" | "real" | "money" | "smallmoney" => "0.0",
                        "bit" => "0",
                        "varchar" | "nvarchar" | "char" | "nchar" | "text" | "ntext" => "''",
                        "datetime" | "datetime2" | "smalldatetime" | "date" | "time" => "GETDATE()",
                        "uniqueidentifier" => "NEWID()",
                        _ => "NULL",
                    };
                    format!("    {} = {}", param.name, default_value)
                }
            };
            
            // 添加逗号（除了最后一个参数）
            if index < parameters.len() - 1 {
                template.push_str(&format!("{},\n", param_line));
            } else {
                template.push_str(&param_line);
            }
        }
    }
    
    template
}
