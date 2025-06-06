# sqlserver-lite-query

一款轻量级的 SQL Server 查询工具。

## 🚀 关于项目

`sqlserver-lite-query` 是一个使用 Tauri v2 构建的桌面应用程序，旨在提供一个轻量级且高效的界面来查询和操作 SQL Server 数据库。前端采用 Next.js、Tailwind CSS、Shadcn 和 AG Grid Community 构建现代化用户界面，并集成了 Monaco Editor 提供强大的 SQL 编辑体验。后端则利用 Tokio 和 Tiberius 库与 SQL Server 进行异步通信。

## ✨ 主要特性

* **跨平台**: 基于 Tauri 构建，可运行于 Windows、macOS 和 Linux。
* **现代化界面**: 使用 Next.js, Tailwind CSS 和 Shadcn 构建，美观易用。
* **强大的 SQL 编辑器**: 集成 Monaco Editor，提供语法高亮、智能提示等功能。
* **高效数据展示**: 使用 AG Grid Community 进行表格数据显示和操作。
* **异步数据库操作**: 后端使用 Tokio 和 Tiberius，确保数据库操作的性能和响应速度。
* **轻量级**: 专注于核心查询功能，保持应用的轻巧。

## 🛠️ 技术栈

* **核心框架**:
    * [Tauri](https://tauri.app/): 用于构建跨平台桌面应用的框架。

* **前端**:
    * [Next.js](https://nextjs.org/): React 框架，用于构建用户界面。
    * [Tailwind CSS](https://tailwindcss.com/): 工具类优先的 CSS 框架。
    * [Shadcn](https://ui.shadcn.com/): 可重用的 UI 组件。
    * [AG Grid Community](https://www.ag-grid.com/community-edition/): 功能强大的数据表格组件。
    * [Monaco Editor](https://microsoft.github.io/monaco-editor/): 强大的代码编辑器，用于 SQL 编辑。

* **后端**:
    * [Tiberius](https://github.com/prisma/tiberius): 用于 SQL Server 的纯 Rust TDS 实现库。
    * [Tokio](https://tokio.rs/): Rust 的异步运行时。

## ⚙️ 安装与运行

例如：

1.  **克隆仓库**:
    ```bash
    git clone [https://github.com/zcp1997/sqlserver-lite-query.git](https://github.com/zcp1997/sqlserver-lite-query.git)
    cd sqlserver-lite-query
    ```
2.  **安装依赖**:
    * 前端:
        ```bash
        pnpm install
        # 或者 yarn install
        ```
    * Rust (Tauri): 确保你已经安装了 Rust 和 Tauri 的开发环境。查阅 [Tauri 官方文档](https://tauri.app/v1/guides/getting-started/prerequisites)。
3.  **运行开发环境**:
    ```bash
    pnpm tauri dev
    # 或者 yarn tauri dev
    ```
4.  **构建应用**:
    ```bash
    pnpm tauri build
    # 或者 yarn tauri build
    ```

## 📖 使用说明

1.  启动应用程序。
2.  配置 SQL Server 数据库连接信息（服务器地址、端口、用户名、密码、数据库名等）。
3.  连接到数据库。
4.  在 SQL 编辑器中输入并执行 SQL 查询。
5.  在数据表格中查看查询结果。

## 智能代码补全优化

### 存储过程自动补全

系统现在支持高性能的存储过程自动补全功能：

#### 特性：
- **预加载机制**：在数据库连接建立后自动预加载所有存储过程信息
- **同步过滤**：输入 `EXEC` 关键字后，立即从预加载的缓存中过滤显示相关建议
- **智能匹配**：支持按存储过程名称和schema名称进行模糊匹配
- **缓存管理**：60分钟缓存TTL，支持手动刷新

#### 使用方法：
1. 在SQL编辑器中输入 `EXEC` 
2. 系统将立即显示匹配的存储过程建议
3. 选择所需的存储过程，会自动插入完整的执行模板，包括参数

#### 性能优化：
- 预加载在后台进行，不影响用户操作
- 使用同步过滤替代异步搜索，消除延迟
- 智能缓存策略，平衡性能和数据新鲜度