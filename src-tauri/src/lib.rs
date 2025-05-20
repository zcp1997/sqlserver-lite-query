mod database;
mod commands;

use std::panic;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use chrono::Local;

// 初始化日志文件
fn setup_logging() -> PathBuf {
    // 使用临时目录作为日志存储位置
    let mut log_dir = std::env::temp_dir();
    log_dir.push("sqlserver-viewer-lite");
    log_dir.push("logs");
    
    // 尝试创建日志目录
    if let Err(e) = fs::create_dir_all(&log_dir) {
        eprintln!("无法创建日志目录: {}", e);
    }
    
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let log_path = log_dir.join(format!("app_log_{}.txt", timestamp));
    
    println!("日志文件路径: {:?}", log_path);
    
    // 记录初始日志
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(&log_path)
    {
        let start_msg = format!("=== 应用启动于 {} ===\n", Local::now());
        if let Err(e) = file.write_all(start_msg.as_bytes()) {
            eprintln!("无法写入日志: {}", e);
        }
    } else {
        eprintln!("无法创建日志文件");
    }
    
    log_path
}

// 记录错误到日志文件
fn log_error(log_path: &PathBuf, error: &str) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
    let error_msg = format!("[{}] ERROR: {}\n", timestamp, error);
    
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open(log_path)
    {
        if let Err(e) = file.write_all(error_msg.as_bytes()) {
            eprintln!("无法写入日志: {}", e);
        }
    } else {
        eprintln!("无法打开日志文件");
    }
}

pub fn run() {
    // 初始化日志
    let log_path = setup_logging();
    
    // 设置全局panic钩子
    let old_hook = panic::take_hook();
    panic::set_hook(Box::new(move |panic_info| {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string();
        let backtrace = std::backtrace::Backtrace::capture();
        let panic_msg = format!(
            "[{}] PANIC: {}\nBacktrace:\n{:?}\n",
            timestamp,
            panic_info,
            backtrace
        );
        
        // 记录到日志文件
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .write(true)
            .append(true)
            .open(&log_path)
        {
            if let Err(e) = file.write_all(panic_msg.as_bytes()) {
                eprintln!("无法写入日志: {}", e);
            }
        } else {
            eprintln!("无法打开日志文件");
        }
        
        // 调用原始panic处理
        old_hook(panic_info);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            println!("{}, {argv:?}, {cwd}", app.package_info().name);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::connection::test_connection,
            commands::connection::execute_query,
            commands::connection::execute_non_query
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
