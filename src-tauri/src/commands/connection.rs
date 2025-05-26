use crate::database::{
    create_connection, execute_non_query as db_execute_non_query,
    execute_query as db_execute_query, execute_sql_smart, search_stored_functions, search_stored_procedures,
    search_stored_views, search_table_columns, search_tables, ColumnInfo, ConnectionConfig,
    QueryResult, StoredFunctionInfo, StoredProcedureInfo, StoredViewInfo, TableInfo,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::Mutex;
use uuid::Uuid;

// 保存活动连接的映射，键为会话ID，值为连接客户端
type ClientType = tiberius::Client<tokio_util::compat::Compat<tokio::net::TcpStream>>;
static ACTIVE_CONNECTIONS: Lazy<Mutex<HashMap<String, ClientType>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// 保存连接配置的映射，键为会话ID，值为连接配置
static CONNECTION_CONFIGS: Lazy<Mutex<HashMap<String, ConnectionConfig>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

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
pub struct KeywordQueryRequest {
    pub session_id: String,
    pub keyword: String,
}

#[derive(Debug, Deserialize)]
pub struct TableQueryRequest {
    pub session_id: String,
    pub keyword: String, // Optional search keyword for filtering tables
}

#[derive(Debug, Deserialize)]
pub struct ColumnQueryRequest {
    session_id: String,
    table_name: String,
    schema_name: Option<String>, // Optional schema name for fully qualified table
}

// 测试连接
#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> ConnectionResponse {
    println!(
        "测试连接请求，服务器: {}, 数据库: {}",
        config.server, config.database
    );

    // 检查是否已存在相同配置的连接
    let configs = CONNECTION_CONFIGS.lock().await;
    for (session_id, existing_config) in configs.iter() {
        if existing_config == &config {
            println!("找到已存在的相同配置连接，会话ID: {}", session_id);
            return ConnectionResponse {
                success: true,
                message: "使用已存在的连接".to_string(),
                session_id: Some(session_id.clone()),
            };
        }
    }
    drop(configs); // 释放锁

    match create_connection(&config).await {
        Ok(client) => {
            // 生成会话ID
            let session_id = Uuid::new_v4().to_string();
            println!("连接成功，生成会话ID: {}", session_id);

            // 存储连接和配置
            let mut connections = ACTIVE_CONNECTIONS.lock().await;
            let mut configs = CONNECTION_CONFIGS.lock().await;
            connections.insert(session_id.clone(), client);
            configs.insert(session_id.clone(), config);
            println!("会话已存储，当前活动会话数: {}", connections.len());

            ConnectionResponse {
                success: true,
                message: "连接成功".to_string(),
                session_id: Some(session_id),
            }
        }
        Err(err) => {
            println!("连接失败: {}", err);
            ConnectionResponse {
                success: false,
                message: format!("连接失败: {}", err),
                session_id: None,
            }
        }
    }
}

// 执行查询
#[tauri::command]
pub async fn execute_query(request: QueryRequest) -> Result<QueryResult, String> {
    println!("执行查询请求，会话ID: {}", request.session_id);
    println!("SQL: {}", request.sql);

    let mut connections = ACTIVE_CONNECTIONS.lock().await;

    if let Some(client) = connections.get_mut(&request.session_id) {
        match execute_sql_smart(client, &request.sql).await {
            Ok(result) => {
                println!("智能SQL执行成功，结果集数量: {}", result.result_sets.len());

                // 检查结果集是否为空
                if result.result_sets.is_empty() {
                    println!("警告: 返回的结果集为空，添加一个空结果集");
                    let mut result_with_empty = result;
                    result_with_empty
                        .result_sets
                        .push(crate::database::ResultSet {
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
            }
            Err(err) => {
                let error_msg = format!("智能SQL执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!(
            "会话不存在或已过期，请重新连接，会话ID: {}",
            request.session_id
        );
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
            }
            Err(err) => {
                let error_msg = format!("执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!(
            "会话不存在或已过期，请重新连接，会话ID: {}",
            request.session_id
        );
        println!("{}", error_msg);
        Err(error_msg)
    }
}

// // 执行关键字查询表结构
// #[tauri::command]
// pub async fn execute_table_metadata_query(
//     request: KeywordQueryRequest,
// ) -> Result<Vec<StoredTableInfo>, String> {
//     println!("执行存储过程查询，会话ID: {}", request.session_id);
//     println!("keyword: {}", request.keyword);

//     let mut connections = ACTIVE_CONNECTIONS.lock().await;

//     if let Some(client) = connections.get_mut(&request.session_id) {
//         println!("找到会话，开始执行执行存储过程查询");
//         match search_stored_tables(client, &request.keyword).await {
//             Ok(result) => {
//                 println!("执行存储过程查询成功");
//                 Ok(result)
//             }
//             Err(err) => {
//                 let error_msg = format!("执行错误: {}", err);
//                 println!("{}", error_msg);
//                 Err(error_msg)
//             }
//         }
//     } else {
//         let error_msg = format!(
//             "会话不存在或已过期，请重新连接，会话ID: {}",
//             request.session_id
//         );
//         println!("{}", error_msg);
//         Err(error_msg)
//     }
// }

// 执行关键字查询存储过程
#[tauri::command]
pub async fn execute_procedure_query(
    request: KeywordQueryRequest,
) -> Result<Vec<StoredProcedureInfo>, String> {
    println!("执行存储过程查询，会话ID: {}", request.session_id);
    println!("keyword: {}", request.keyword);

    let mut connections = ACTIVE_CONNECTIONS.lock().await;

    if let Some(client) = connections.get_mut(&request.session_id) {
        println!("找到会话，开始执行执行存储过程查询");
        match search_stored_procedures(client, &request.keyword).await {
            Ok(result) => {
                println!("执行存储过程查询成功");
                Ok(result)
            }
            Err(err) => {
                let error_msg = format!("执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!(
            "会话不存在或已过期，请重新连接，会话ID: {}",
            request.session_id
        );
        println!("{}", error_msg);
        Err(error_msg)
    }
}

// 执行关键字查询视图
#[tauri::command]
pub async fn execute_view_query(
    request: KeywordQueryRequest,
) -> Result<Vec<StoredViewInfo>, String> {
    println!("执行视图查询，会话ID: {}", request.session_id);
    println!("keyword: {}", request.keyword);

    let mut connections = ACTIVE_CONNECTIONS.lock().await;

    if let Some(client) = connections.get_mut(&request.session_id) {
        println!("找到会话，开始执行执行视图查询");
        match search_stored_views(client, &request.keyword).await {
            Ok(result) => {
                println!("执行视图查询成功");
                Ok(result)
            }
            Err(err) => {
                let error_msg = format!("执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!(
            "会话不存在或已过期，请重新连接，会话ID: {}",
            request.session_id
        );
        println!("{}", error_msg);
        Err(error_msg)
    }
}

// 执行关键字查询函数
#[tauri::command]
pub async fn execute_function_query(
    request: KeywordQueryRequest,
) -> Result<Vec<StoredFunctionInfo>, String> {
    println!("执行函数查询，会话ID: {}", request.session_id);
    println!("keyword: {}", request.keyword);

    let mut connections = ACTIVE_CONNECTIONS.lock().await;

    if let Some(client) = connections.get_mut(&request.session_id) {
        println!("找到会话，开始执行执行函数查询");
        match search_stored_functions(client, &request.keyword).await {
            Ok(result) => {
                println!("执行函数查询成功");
                Ok(result)
            }
            Err(err) => {
                let error_msg = format!("执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!(
            "会话不存在或已过期，请重新连接，会话ID: {}",
            request.session_id
        );
        println!("{}", error_msg);
        Err(error_msg)
    }
}

#[tauri::command]
pub async fn get_all_tables(request: TableQueryRequest) -> Result<Vec<TableInfo>, String> {
    println!("执行表查询，会话ID: {}", request.session_id);
    println!("keyword: {}", request.keyword);

    let mut connections = ACTIVE_CONNECTIONS.lock().await;

    if let Some(client) = connections.get_mut(&request.session_id) {
        println!("找到会话，开始执行表查询");
        match search_tables(client, &request.keyword).await {
            Ok(result) => {
                println!("执行表查询成功");
                Ok(result)
            }
            Err(err) => {
                let error_msg = format!("执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!(
            "会话不存在或已过期，请重新连接，会话ID: {}",
            request.session_id
        );
        println!("{}", error_msg);
        Err(error_msg)
    }
}

#[tauri::command]
pub async fn get_columns_for_table(request: ColumnQueryRequest) -> Result<Vec<ColumnInfo>, String> {
    println!("执行列查询，会话ID: {}", request.session_id);
    println!("table_name: {}", request.table_name);

    if let Some(schema) = &request.schema_name {
        println!("schema_name: {}", schema);
    }

    let mut connections = ACTIVE_CONNECTIONS.lock().await;

    if let Some(client) = connections.get_mut(&request.session_id) {
        println!("找到会话，开始执行列查询");
        match search_table_columns(client, &request.table_name, request.schema_name.as_deref())
            .await
        {
            Ok(result) => {
                println!("执行列查询成功");
                Ok(result)
            }
            Err(err) => {
                let error_msg = format!("执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!(
            "会话不存在或已过期，请重新连接，会话ID: {}",
            request.session_id
        );
        println!("{}", error_msg);
        Err(error_msg)
    }
}

// 执行单一查询（传统方式，作为备选）
#[tauri::command]
pub async fn execute_single_query(request: QueryRequest) -> Result<QueryResult, String> {
    println!("执行单一查询请求，会话ID: {}", request.session_id);
    println!("SQL: {}", request.sql);

    let mut connections = ACTIVE_CONNECTIONS.lock().await;

    if let Some(client) = connections.get_mut(&request.session_id) {
        match db_execute_query(client, &request.sql).await {
            Ok(result) => {
                println!("单一查询执行成功，结果集数量: {}", result.result_sets.len());
                Ok(result)
            }
            Err(err) => {
                let error_msg = format!("单一查询执行错误: {}", err);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    } else {
        let error_msg = format!(
            "会话不存在或已过期，请重新连接，会话ID: {}",
            request.session_id
        );
        println!("{}", error_msg);
        Err(error_msg)
    }
}
