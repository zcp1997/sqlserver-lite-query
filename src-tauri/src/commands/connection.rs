use crate::database::{ConnectionConfig, create_connection, execute_query as db_execute_query, execute_non_query as db_execute_non_query, QueryResult, search_stored_procedures, StoredProcedureInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::Mutex;
use uuid::Uuid;
use once_cell::sync::Lazy;

// 保存活动连接的映射，键为会话ID，值为连接客户端
type ClientType = tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>;
static ACTIVE_CONNECTIONS: Lazy<Mutex<HashMap<String, ClientType>>> = Lazy::new(|| Mutex::new(HashMap::new()));

// 测试连接响应
#[derive(Debug, Serialize)]
pub struct ConnectionResponse {
    pub success: bool,
    pub message: String,
    pub session_id: Option<String>,
}

// 查询请求
#[derive(Debug, Deserialize)]
pub struct QueryRequest {
    pub session_id: String,
    pub sql: String,
}


// 查询请求
#[derive(Debug, Deserialize)]
pub struct ProcedureQueryRequest {
    pub session_id: String,
    pub keyword: String,
}

// 测试连接
#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> ConnectionResponse {
    println!("测试连接请求，服务器: {}, 数据库: {}", config.server, config.database);
    
    match create_connection(&config).await {
        Ok(client) => {
            // 生成会话ID
            let session_id = Uuid::new_v4().to_string();
            println!("连接成功，生成会话ID: {}", session_id);
            
            // 存储连接
            let mut connections = ACTIVE_CONNECTIONS.lock().await;
            connections.insert(session_id.clone(), client);
            println!("会话已存储，当前活动会话数: {}", connections.len());
            
            ConnectionResponse {
                success: true,
                message: "连接成功".to_string(),
                session_id: Some(session_id),
            }
        },
        Err(err) => {
            println!("连接失败: {}", err);
            ConnectionResponse {
                success: false,
                message: format!("连接失败: {}", err),
                session_id: None,
            }
        },
    }
}

// 执行查询
#[tauri::command]
pub async fn execute_query(request: QueryRequest) -> Result<QueryResult, String> {
    println!("执行查询请求，会话ID: {}", request.session_id);
    println!("SQL: {}", request.sql);
    
    let mut connections = ACTIVE_CONNECTIONS.lock().await;
    
    if let Some(client) = connections.get_mut(&request.session_id) {
        match db_execute_query(client, &request.sql).await {
            Ok(result) => {
                println!("查询执行成功，结果集数量: {}", result.result_sets.len());
                
                // 检查结果集是否为空
                if result.result_sets.is_empty() {
                    println!("警告: 返回的结果集为空，添加一个空结果集");
                    let mut result_with_empty = result;
                    result_with_empty.result_sets.push(crate::database::ResultSet {
                        columns: Vec::new(),
                        column_types: Vec::new(),
                        rows: Vec::new(),
                        affected_rows: Some(0),
                        error: None,
                    });
                    Ok(result_with_empty)
                } else {
                    Ok(result)
                }
            },
            Err(err) => {
                let error_msg = format!("查询执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            },
        }
    } else {
        let error_msg = format!("会话不存在或已过期，请重新连接，会话ID: {}", request.session_id);
        println!("{}", error_msg);
        Err(error_msg)
    }
}

// 执行非查询操作
#[tauri::command]
pub async fn execute_non_query(request: QueryRequest) -> Result<QueryResult, String> {
    println!("执行非查询请求，会话ID: {}", request.session_id);
    println!("SQL: {}", request.sql);
    
    let mut connections = ACTIVE_CONNECTIONS.lock().await;
    
    if let Some(client) = connections.get_mut(&request.session_id) {
        println!("找到会话，开始执行非查询操作");
        match db_execute_non_query(client, &request.sql).await {
            Ok(result) => {
                println!("非查询操作执行成功");
                Ok(result)
            },
            Err(err) => {
                let error_msg = format!("执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            },
        }
    } else {
        let error_msg = format!("会话不存在或已过期，请重新连接，会话ID: {}", request.session_id);
        println!("{}", error_msg);
        Err(error_msg)
    }
} 

// 执行关键字查询存储过程
#[tauri::command]
pub async fn execute_procedure_query(request: ProcedureQueryRequest) -> Result<Vec<StoredProcedureInfo>, String> {
    println!("执行存储过程查询，会话ID: {}", request.session_id);
    println!("keyword: {}", request.keyword);
    
    let mut connections = ACTIVE_CONNECTIONS.lock().await;
    
    if let Some(client) = connections.get_mut(&request.session_id) {
        println!("找到会话，开始执行执行存储过程查询");
        match search_stored_procedures(client, &request.keyword).await {
            Ok(result) => {
                println!("执行存储过程查询成功");
                Ok(result)
            },
            Err(err) => {
                let error_msg = format!("执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            },
        }
    } else {
        let error_msg = format!("会话不存在或已过期，请重新连接，会话ID: {}", request.session_id);
        println!("{}", error_msg);
        Err(error_msg)
    }
} 