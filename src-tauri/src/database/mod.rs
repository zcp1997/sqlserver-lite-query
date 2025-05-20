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

// 连接配置
#[derive(Debug, Serialize, Deserialize, Clone)]
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
                            let mut column_entries: Vec<(&usize, &String)> = column_name_map.iter().collect();
                            column_entries.sort_by_key(|&(idx, _)| *idx);
                            columns = column_entries
                                .into_iter()
                                .map(|(_, name)| name.clone())
                                .collect();
                        }

                        let affected_rows_count =  Some(processed_rows.len() as u64);
                        
                        // 添加到结果集
                        result_sets.push(ResultSet {
                            columns,
                            column_types,
                            rows: processed_rows,
                            affected_rows: affected_rows_count,
                            error: None,
                        });
                    }
                },
                Err(e) => {
                    return Err(DatabaseError::QueryError(format!("处理结果集失败: {}", e)));
                }
            }
        },
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
            affected_rows: None,
            error: None,
        });
    }

    Ok(QueryResult {
        result_sets,
        error: None,
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
