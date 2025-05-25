"use client"

import { useState } from 'react'
import SessionSelector from '@/components/session/SessionSelector'
import WorkspaceSelector from '@/components/sql/WorkspaceSelector'
import EditorTabs from '@/components/sql/workbench/EditorTabs'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger
} from "@/components/ui/dialog"
import { useSession } from '@/components/session/SessionContext'
import { useSqlTabs } from '@/hooks/useSqlTabs'
import { useSqlExecution } from '@/hooks/useSqlExecution'
import { DatabaseObjectType } from '@/types/database'
import ToolbarActions from '@/components/sql/workbench/ToolbarActions'
import DatabaseObjectsDialog from '@/components/sql/workbench/DatabaseObjectsDialog'
import SqlScriptsDialog from '@/components/sql/workbench/SqlScriptsDialog'
import QueryWorkspace from '@/components/sql/workbench/QueryWorkspace'
import { Workspace } from '@/types/workspace'

export default function SqlWorkbenchPage() {
  const { activeSession } = useSession()

  // 使用封装的标签页逻辑
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
    setActiveSqlTabId
  } = useSqlTabs(activeSession)

  // 使用SQL执行逻辑
  const {
    isExecuting,
    queryResult,
    error,
    executeCurrentQuery,
    stopExecution
  } = useSqlExecution();

  // 数据库对象对话框状态
  const [dbObjectDialogOpen, setDbObjectDialogOpen] = useState(false)
  const [dbObjectType, setDbObjectType] = useState<DatabaseObjectType>(DatabaseObjectType.StoredProcedure)

  // SQL脚本对话框状态
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false)

  // 新增：存储选中文本的状态
  const [selectedText, setSelectedText] = useState<string>('')

  // 新增：处理选中文本变化
  const handleSelectionChange = (selectedText: string) => {
    setSelectedText(selectedText)
  }

  // 处理工作区切换
  const handleWorkspaceChange = (workspace: Workspace) => {
    loadWorkspace(workspace)
  }

  // 修改：处理执行SQL查询，支持选中文本参数
  const handleExecuteQuery = () => {
    if (!activeSession) {
      console.log('No active session available');
      return;
    }

    let textToExecute = sqlQuery;

    if (selectedText && selectedText.trim() && selectedText.trim() !== '') {
      console.log(`textToExecute changed to ${selectedText.trim()}`);
      textToExecute = selectedText.trim();
    }

    if (!textToExecute) {
      console.log('No query text to execute');
      return;
    }

    console.log('Main page executing query:', {
      sqlQuery: sqlQuery,
      selectedText: selectedText
    });

    executeCurrentQuery(activeSession, textToExecute);
  };

  // 处理打开数据库对象对话框
  const handleOpenDbObjectDialog = (type: DatabaseObjectType = DatabaseObjectType.StoredProcedure) => {
    setDbObjectType(type);
    setDbObjectDialogOpen(true);
  };

  // 处理清空所有数据
  const handleClearAll = () => {
    setSqlQuery('');
    setSqlTabs([]);
    setActiveSqlTabId('');
    localStorage.clear();
    alert('所有配置已清空');
    location.href = '/';
  };

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      <div className="p-2 border-b flex flex-shrink-0 items-center justify-between">
        {/* 左侧：工作区和会话选择器 */}
        <div className="flex items-center space-x-6">
          {/* 工作区选择器区域 */}
          <div className="flex items-center space-x-3">
            <span className="text-sm font-medium text-muted-foreground min-w-[48px]">
              工作区
            </span>
            <WorkspaceSelector
                currentWorkspace={currentWorkspace}
                onWorkspaceChange={handleWorkspaceChange}
                onSaveWorkspace={saveCurrentWorkspace}
              />
          </div>

          {/* 分隔线 */}
          <div className="h-6 w-px bg-border" />

          {/* 数据库会话选择器 */}
          <div className="flex items-center space-x-3">
            <span className="text-sm font-medium text-muted-foreground min-w-[72px]">
              数据库会话
            </span>
            <SessionSelector />
            {/* 清空数据按钮 - 放在工作区选择器的最右边 */}

          {/* 分隔线 */}
          <div className="h-6 w-px bg-border" />

            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-sm"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  清空数据
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>确认清空所有数据</DialogTitle>
                  <DialogDescription>
                    此操作将清空所有配置和数据，且无法撤销。你确定要继续吗？
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline">取消</Button>
                  <Button
                    variant="destructive"
                    onClick={handleClearAll}
                  >
                    确认清空
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
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
      />

      {/* 工具栏按钮 - 传递选中文本 */}
      <ToolbarActions
        activeSession={activeSession}
        onOpenDbObjectDialog={handleOpenDbObjectDialog}
        onOpenScriptDialog={() => setScriptDialogOpen(true)}
        isExecuting={isExecuting}
        onExecuteQuery={handleExecuteQuery} // 注意：不再传递参数
        onStopExecution={stopExecution}
        sqlQuery={sqlQuery}
        selectedText={selectedText} // 新增：传递选中文本
      />

      {/* 主要查询工作区 - 传递选中文本变化回调 */}
      <QueryWorkspace
        sqlQuery={sqlQuery}
        updateTabContent={updateTabContent}
        activeSession={activeSession}
        isExecuting={isExecuting}
        queryResult={queryResult}
        error={error}
        onSelectionChange={handleSelectionChange} // 新增
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
    </div >
  )
}