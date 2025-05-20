"use client"

export async function invoke(command: string, args?: any): Promise<any> {
  // 检查是否在客户端环境
  if (typeof window !== "undefined") {
    try {
      // 检查是否在 Tauri 环境中
      // @ts-ignore - window.__TAURI__ 可能不存在
      if (window.__TAURI__) {
        // 动态导入 Tauri API
        const { invoke } = await import("@tauri-apps/api/core")
        return await invoke(command, args)
      } else {
        // 在非 Tauri 环境中使用模拟数据
        console.log(`[Browser] Mock invoke: ${command}`, args)
        return mockTauriResponse(command, args)
      }
    } catch (error) {
      console.error(`Error invoking Tauri command ${command}:`, error)
      // 在出错时返回模拟数据，而不是抛出错误
      return mockTauriResponse(command, args)
    }
  } else {
    // 服务器端模拟数据
    console.log(`[Server] Mock invoke: ${command}`, args)
    return mockTauriResponse(command, args)
  }
}

// 模拟 Tauri 响应的函数
function mockTauriResponse(command: string, args?: any): any {
  // 模拟一些基本的命令响应
  if (command === "get_all_task_groups") {
    return ["默认分组", "药品配送"]
  }

  if (command === "get_task_group") {
    const groupName = args?.groupName

    if (groupName === "默认分组") {
      return {
        source_connection: {
          type: "SqlServer",
          host: "192.168.1.122",
          port: 1433,
          database: "Biz_WMS国药器械",
          username: "sa",
          password: "jksoft",
          enabled: false,
        },
        docking_connection: {
          type: "SqlServer",
          host: "192.168.1.122",
          port: 1433,
          database: "Biz_wms医疗器械",
          username: "sa",
          password: "jksoft",
          enabled: false,
        },
        custom_params: {
          token: "54321",
        },
        tasks: [
          {
            name: "入库单返回",
            caption: "入库单返回",
            type: "interval",
            interval_seconds: 10,
            schedule: null,
            fail_retry_count: 3,
            retry_count: null,
            log_retention_days: 30,
            custom_params: {
              WMS货主编号: "01010001",
            },
          },
          {
            name: "出库单返回",
            caption: "出库单返回",
            type: "interval",
            interval_seconds: 10,
            schedule: null,
            fail_retry_count: null,
            retry_count: 3,
            log_retention_days: 60,
            custom_params: null,
          },
          {
            name: "序列号对账",
            caption: "序列号对账",
            type: "scheduled",
            interval_seconds: null,
            schedule: ["0 3 * * *", "45 12 * * *", "30 23 * * *"],
            fail_retry_count: null,
            retry_count: 3,
            log_retention_days: 60,
            custom_params: null,
          },
        ],
      }
    } else if (groupName === "药品配送") {
      return {
        source_connection: {
          type: "SqlServer",
          host: "192.168.1.123",
          port: 1433,
          database: "Biz_WMS药品",
          username: "sa",
          password: "jksoft",
          enabled: true,
        },
        docking_connection: {
          type: "SqlServer",
          host: "192.168.1.123",
          port: 1433,
          database: "Biz_wms药品配送",
          username: "sa",
          password: "jksoft",
          enabled: true,
        },
        custom_params: {
          token: "12345",
          apiUrl: "https://api.example.com/v1",
        },
        tasks: [
          {
            name: "药品入库",
            caption: "药品入库单同步",
            type: "interval",
            interval_seconds: 30,
            schedule: null,
            fail_retry_count: 5,
            retry_count: null,
            log_retention_days: 90,
            custom_params: {
              药品编码前缀: "MED",
            },
          },
        ],
      }
    }

    return {
      source_connection: {
        type: "SqlServer",
        host: "",
        port: 1433,
        database: "",
        username: "",
        password: "",
        enabled: false,
      },
      docking_connection: {
        type: "SqlServer",
        host: "",
        port: 1433,
        database: "",
        username: "",
        password: "",
        enabled: false,
      },
      custom_params: null,
      tasks: [],
    }
  }

  // 对于其他命令，返回成功
  return { success: true }
}
