use anyhow::Result;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tiberius::{Client, Config, AuthMethod, EncryptionLevel, Row};
use tokio::net::TcpStream;
use tokio_util::compat::{TokioAsyncWriteCompatExt, Compat};
use tokio::time::timeout;
use std::time::Duration;
use std::collections::HashMap;
use futures::TryStreamExt;

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
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将DateTime转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<chrono::NaiveDate, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将Date转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<chrono::NaiveTime, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将Time转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<uuid::Uuid, _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将UUID转换为JSON: {}", e))?);
    } else if let Ok(Some(val)) = row.try_get::<&[u8], _>(index) {
        return Ok(serde_json::to_value(val).map_err(|e| format!("无法将二进制数据转换为JSON: {}", e))?);
    } else if let Ok(None) = row.try_get::<&str, _>(index) {
        // 处理NULL值
        return Ok(serde_json::Value::Null);
    }
    // 如果所有尝试都失败，记录信息并返回Null
    Ok(serde_json::Value::Null)
}

// 创建SQL Server连接
pub async fn create_connection(config: &ConnectionConfig) -> Result<Client<Compat<TcpStream>>, DatabaseError> {
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
        TcpStream::connect(format!("{}:{}", config.server, port))
    ).await {
        Ok(Ok(stream)) => {
            stream
        },
        Ok(Err(e)) => {
            let error_msg = format!("TCP连接失败: {}", e);
            println!("{}", error_msg);
            return Err(DatabaseError::ConnectionError(error_msg));
        },
        Err(_) => {
            let error_msg = format!("连接超时 ({}秒)", timeout_duration.as_secs());
            println!("{}", error_msg);
            return Err(DatabaseError::TimeoutError(error_msg));
        },
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
        Client::connect(tiberius_config, tcp.compat_write())
    ).await {
        Ok(Ok(client)) => {
            println!("Tiberius客户端连接成功建立");
            client
        },
        Ok(Err(e)) => {
            let error_msg = format!("Tiberius连接失败: {}", e);
            println!("{}", error_msg);
            return Err(DatabaseError::ConnectionError(error_msg));
        },
        Err(_) => {
            let error_msg = format!("连接超时 ({}秒)", timeout_duration.as_secs());
            println!("{}", error_msg);
            return Err(DatabaseError::TimeoutError(error_msg));
        },
    };
    
    Ok(client)
}

// 执行查询并返回结果
pub async fn execute_query(client: &mut Client<Compat<TcpStream>>, sql: &str) -> Result<QueryResult, DatabaseError> {
    let mut result_sets = Vec::new();
    
    // 分割SQL语句（简单实现，实际可能需要更复杂的解析）
    let statements = sql.split(';').filter(|s| !s.trim().is_empty()).collect::<Vec<_>>();
    
    for statement in statements {
        let result = match client.simple_query(statement).await {
            Ok(result) => result,
            Err(e) => {
                return Err(DatabaseError::QueryError(format!("查询执行失败: {}", e)));
            }
        };
        
        let mut stream = result.into_row_stream();
        let mut columns = Vec::new();
        let mut column_types = Vec::new();
        let mut rows = Vec::new();
        
        // 获取第一行以便提取列名
        match stream.try_next().await {
            Ok(Some(first_row)) => {
                // 处理列名
                let cols = first_row.columns();
                columns = cols.iter().map(|c| c.name().to_string()).collect();
                column_types = cols.iter()
                    .map(|c| format!("{:?}", c.column_type()))
                    .collect();

                
                // 处理第一行数据
                let mut row_data = HashMap::new();
                for (i, col) in cols.iter().enumerate() {
                    let value = match get_value_as_json(&first_row, i) {
                        Ok(val) => val,
                        Err(_) => serde_json::Value::Null,
                    };
                    row_data.insert(col.name().to_string(), value);
                }
                rows.push(row_data);
                
                // 处理剩余行
                while let Ok(Some(row)) = stream.try_next().await {
                    let mut row_data = HashMap::new();
                    for (i, col) in cols.iter().enumerate() {
                        let value = match get_value_as_json(&row, i) {
                            Ok(val) => val,
                            Err(_) => serde_json::Value::Null,
                        };
                        row_data.insert(col.name().to_string(), value);
                    }
                    rows.push(row_data);
                }
            },
            Ok(None) => {
                // 没有返回行，可能是非查询语句
            },
            Err(e) => {
                return Err(DatabaseError::QueryError(format!("读取结果行失败: {}", e)));
            }
        }
        
        // 添加到结果集
        result_sets.push(ResultSet {
            columns,
            column_types,
            rows,
            affected_rows: None,
            error: None,
        });
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
pub async fn execute_non_query(client: &mut Client<Compat<TcpStream>>, sql: &str) -> Result<QueryResult, DatabaseError> {
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