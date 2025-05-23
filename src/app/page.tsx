"use client"

import { useState } from 'react'
import SessionSelector from '@/components/session/SessionSelector'
import EditorTabs from '@/components/sql/workbench/EditorTabs'
import { Button } from '@/components/ui/button'
import { TrashIcon } from 'lucide-react'
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
    closeTab
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

  // 处理执行SQL查询
  const handleExecuteQuery = () => {
    if (activeSession && sqlQuery) {
      executeCurrentQuery(activeSession, sqlQuery);
    }
  };

  // 处理打开数据库对象对话框
  const handleOpenDbObjectDialog = (type: DatabaseObjectType = DatabaseObjectType.StoredProcedure) => {
    setDbObjectType(type);
    setDbObjectDialogOpen(true);
  };

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      <div className="p-2 border-b flex flex-shrink-0 items-center space-x-4">
        <SessionSelector />

        {/* 清空按钮 */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white"
              variant="outline"
              size="sm"
            >
              <TrashIcon className="h-4 w-4 mr-1" />
              清空所有配置和数据
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>确认清空所有配置和数据</DialogTitle>
              <DialogDescription>
                此操作将清空所有配置和数据，且无法撤销。你确定要继续吗？
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">取消</Button>
              <Button
                className="bg-red-500 hover:bg-red-600 text-white"
                onClick={() => {
                  setSqlQuery('');
                  localStorage.clear();
                  alert('所有配置已清空');
                  location.href = '/';
                }}
              >
                确认清空
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 编辑器标签页 */}
      <EditorTabs
        tabs={sqlTabs}
        activeTabId={activeSqlTabId}
        onTabChange={handleTabChange}
        onTabClose={closeTab}
        onTabAdd={addNewTab}
      />

      {/* 工具栏按钮 */}
      <ToolbarActions
        activeSession={activeSession}
        onOpenDbObjectDialog={handleOpenDbObjectDialog}
        onOpenScriptDialog={() => setScriptDialogOpen(true)}
        isExecuting={isExecuting}
        onExecuteQuery={handleExecuteQuery}
        onStopExecution={stopExecution}
        sqlQuery={sqlQuery}
      />

      {/* 主要查询工作区 */}
      <QueryWorkspace
        sqlQuery={sqlQuery}
        updateTabContent={updateTabContent}
        activeSession={activeSession}
        isExecuting={isExecuting}
        queryResult={queryResult}
        error={error}
        onExecuteQuery={handleExecuteQuery}
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
    </div>
  )
}
