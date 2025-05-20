mod database;
mod commands;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            println!("{}, {argv:?}, {cwd}", app.package_info().name);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::connection::test_connection,
            commands::connection::execute_query,
            commands::connection::execute_non_query,
            commands::connection::execute_procedure_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
