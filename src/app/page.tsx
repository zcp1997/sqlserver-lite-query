"use client"

import { useState, useRef, useEffect } from "react"
import SessionSelector from "@/components/session/SessionSelector"
import WorkspaceSelector from "@/components/sql/WorkspaceSelector"
import EditorTabs from "@/components/sql/workbench/EditorTabs"
import { Button } from "@/components/ui/button"
import { Trash2, Database, FolderOpen } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useSession } from "@/components/session/SessionContext"
import { useSqlTabs } from "@/hooks/useSqlTabs"
import { useSqlExecution } from "@/hooks/useSqlExecution"
import { DatabaseObjectType, ConnectionConfig } from "@/types/database"
import ToolbarActions from "@/components/sql/workbench/ToolbarActions"
import DatabaseObjectsDialog from "@/components/sql/workbench/DatabaseObjectsDialog"
import SqlScriptsDialog from "@/components/sql/workbench/SqlScriptsDialog"
import QueryWorkspace, { type QueryWorkspaceRef } from "@/components/sql/workbench/QueryWorkspace"
import type { Workspace } from "@/types/workspace"
import { ThemeSwitcher } from "@/components/ui/theme-switcher"
import { ModeToggle } from "@/components/dashboard/mode-toggle"
import ConnectionDialog from "@/components/connection/ConnectionDialog"
import { v4 as uuidv4 } from 'uuid'
import { useToast } from "@/hooks/use-toast"

const CONNECTIONS_STORAGE_KEY = 'sqlserver-connections'
const FONT_SIZE_STORAGE_KEY = 'sqlserver-font-size'

export default function SqlWorkbenchPage() {
  // 使用 Session context
  const { activeSession } = useSession()

  // 连接对话框状态
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const [showInitialSetup, setShowInitialSetup] = useState(false)

  // SQL Tabs 状态管理
  const {
    sqlTabs,
    activeSqlTabId,
    sqlQuery,
    setSqlQuery,
    handleTabChange,
    updateTabContent,
    addNewTab,
    closeTab,
    currentWorkspace,
    loadWorkspace,
    saveCurrentWorkspace,
    setSqlTabs,
    setActiveSqlTabId,
    handleTabRename,
    moveTab,
  } = useSqlTabs(activeSession)

  // 使用SQL执行逻辑
  const { isExecuting, queryResult, error, executeCurrentQuery, stopExecution } = useSqlExecution()

  // 数据库对象对话框状态
  const [dbObjectDialogOpen, setDbObjectDialogOpen] = useState(false)
  const [dbObjectType, setDbObjectType] = useState<DatabaseObjectType>(DatabaseObjectType.StoredProcedure)

  // SQL脚本对话框状态
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false)

  // 新增：存储选中文本的状态
  const [selectedText, setSelectedText] = useState<string>("")

  // 新增：字体大小状态管理
  const [fontSize, setFontSize] = useState<number>(14)

  // 新增：QueryWorkspace的引用
  const queryWorkspaceRef = useRef<QueryWorkspaceRef>(null)

  const { toast } = useToast()

  // 初始化检测
  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const connections = localStorage.getItem(CONNECTIONS_STORAGE_KEY)
      if (!connections || JSON.parse(connections).length === 0) {
        setShowInitialSetup(true)
        setConnectionDialogOpen(true)
      }

      // 加载保存的字体大小
      const savedFontSize = localStorage.getItem(FONT_SIZE_STORAGE_KEY)
      if (savedFontSize) {
        const size = parseInt(savedFontSize, 10)
        if (size >= 10 && size <= 20) {
          setFontSize(size)
        }
      }
    } catch (error) {
      console.error('检查连接配置失败:', error)
      setShowInitialSetup(true)
      setConnectionDialogOpen(true)
    }
  }, [])

  // 保存连接配置
  const handleSaveConnection = (connection: ConnectionConfig) => {
    try {
      // 生成唯一ID
      const connectionWithId = {
        ...connection,
        id: connection.id || uuidv4()
      }

      // 获取现有连接
      const existingConnections = localStorage.getItem(CONNECTIONS_STORAGE_KEY)
      const connections: ConnectionConfig[] = existingConnections ? JSON.parse(existingConnections) : []

      // 添加或更新连接
      const existingIndex = connections.findIndex(c => c.id === connectionWithId.id)
      if (existingIndex >= 0) {
        connections[existingIndex] = connectionWithId
      } else {
        connections.push(connectionWithId)
      }

      // 保存到localStorage
      localStorage.setItem(CONNECTIONS_STORAGE_KEY, JSON.stringify(connections))

      // 关闭对话框
      setConnectionDialogOpen(false)
      setShowInitialSetup(false)

      toast.success('连接配置已保存', {
        description: connectionWithId.name,
      })
      location.href = "/"
    } catch (error) {
      console.error('保存连接配置失败:', error)
    }
  }

  // 新增：处理选中文本变化
  const handleSelectionChange = (selectedText: string) => {
    setSelectedText(selectedText)
  }

  // 处理工作区切换
  const handleWorkspaceChange = (workspace: Workspace) => {
    console.log("Main page: handleWorkspaceChange called with workspace:", workspace.id, workspace.workspaceName)
    loadWorkspace(workspace)
  }

  // 新增：处理格式化SQL
  const handleFormatSQL = () => {
    queryWorkspaceRef.current?.formatSQL()
  }

  // 新增：处理字体大小变化
  const handleFontSizeChange = (newSize: number) => {
    setFontSize(newSize)
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, newSize.toString())
  }

  // 修改：处理执行SQL查询，支持选中文本参数
  const handleExecuteQuery = () => {
    if (!activeSession) {
      return
    }

    let textToExecute = sqlQuery

    if (selectedText && selectedText.trim() && selectedText.trim() !== "") {
      textToExecute = selectedText.trim()
    }

    if (!textToExecute) {
      return
    }

    executeCurrentQuery(activeSession, textToExecute)
  }

  // 处理打开数据库对象对话框
  const handleOpenDbObjectDialog = (type: DatabaseObjectType = DatabaseObjectType.StoredProcedure) => {
    setDbObjectType(type)
    setDbObjectDialogOpen(true)
  }

  // 处理清空所有数据
  const handleClearAll = () => {
    setSqlQuery("")
    setSqlTabs([])
    setActiveSqlTabId("")
    localStorage.clear()
    indexedDB.deleteDatabase('SqlCacheDB')
    toast.info('所有配置已清空')
    location.href = "/"
  }

  // 如果是初始设置，显示设置向导
  if (showInitialSetup) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-md mx-auto p-6">
          <Database className="h-16 w-16 mx-auto text-primary" />
          <h2 className="text-2xl font-bold">欢迎使用 SQL Server 轻量编辑器</h2>
          <p className="text-muted-foreground">
            首次使用需要配置数据库连接，请点击下方按钮开始设置。
          </p>
          <Button onClick={() => setConnectionDialogOpen(true)}>
            <Database className="h-4 w-4 mr-2" />
            配置数据库连接
          </Button>
        </div>

        <ConnectionDialog
          open={connectionDialogOpen}
          onOpenChange={(open) => {
            if (!open && showInitialSetup) {
              // 如果是初始设置阶段关闭对话框，重新检查连接
              const connections = localStorage.getItem(CONNECTIONS_STORAGE_KEY)
              if (!connections || JSON.parse(connections).length === 0) {
                // 仍然没有连接，重新打开对话框
                setTimeout(() => setConnectionDialogOpen(true), 100)
              }
            } else {
              setConnectionDialogOpen(open)
            }
          }}
          connection={null}
          onSave={handleSaveConnection}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      <div className="p-3 border-b flex flex-shrink-0 items-center justify-between bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* 左侧：工作区和会话选择器 */}
        <div className="flex items-center space-x-4">
          {/* 工作区选择器区域 */}
          <div className="flex items-center space-x-3 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
            <div className="flex items-center space-x-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">工作区</span>
            </div>
            <WorkspaceSelector
              currentWorkspace={currentWorkspace}
              onWorkspaceChange={handleWorkspaceChange}
              onSaveWorkspace={saveCurrentWorkspace}
            />
          </div>

          {/* 数据库管理选择器 */}
          <div className="flex items-center space-x-3 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
            <div className="flex items-center space-x-2">
              <Database className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">数据库管理</span>
            </div>
            <SessionSelector />
          </div>

          {/* 清空数据按钮 */}
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-sm border-destructive/20 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                清空所有数据
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>确认清空所有数据</DialogTitle>
                <DialogDescription>此操作将清空所有配置和数据，且无法撤销。你确定要继续吗？</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline">取消</Button>
                <Button variant="destructive" onClick={handleClearAll}>
                  确认清空
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* 右侧：主题切换区域 */}
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <ModeToggle />
        </div>
      </div>

      {/* 编辑器标签页 */}
      <EditorTabs
        tabs={sqlTabs}
        activeTabId={activeSqlTabId}
        onTabChange={handleTabChange}
        onTabClose={closeTab}
        onTabAdd={addNewTab}
        isExecuting={isExecuting}
        onTabRename={handleTabRename}
        onTabSort={moveTab}
      />

      {/* 工具栏按钮 - 传递选中文本 */}
      <ToolbarActions
        activeSession={activeSession}
        onOpenDbObjectDialog={handleOpenDbObjectDialog}
        onOpenScriptDialog={() => setScriptDialogOpen(true)}
        isExecuting={isExecuting}
        onExecuteQuery={handleExecuteQuery}
        onStopExecution={stopExecution}
        sqlQuery={sqlQuery}
        selectedText={selectedText}
        onFormatSQL={handleFormatSQL}
        fontSize={fontSize}
        onFontSizeChange={handleFontSizeChange}
      />

      {/* 主要查询工作区 - 传递选中文本变化回调 */}
      <QueryWorkspace
        ref={queryWorkspaceRef}
        sqlQuery={sqlQuery}
        updateTabContent={updateTabContent}
        activeSession={activeSession}
        isExecuting={isExecuting}
        queryResult={queryResult}
        error={error}
        onSelectionChange={handleSelectionChange}
        fontSize={fontSize}
      />

      {/* 数据库对象对话框 */}
      <DatabaseObjectsDialog
        open={dbObjectDialogOpen}
        onOpenChange={setDbObjectDialogOpen}
        activeSession={activeSession}
        updateTabContent={updateTabContent}
        dbObjectType={dbObjectType}
      />

      {/* SQL脚本对话框 */}
      <SqlScriptsDialog
        open={scriptDialogOpen}
        onOpenChange={setScriptDialogOpen}
        updateTabContent={updateTabContent}
      />

      {/* 连接配置对话框 */}
      <ConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
        connection={null}
        onSave={handleSaveConnection}
      />
    </div>
  )
}
