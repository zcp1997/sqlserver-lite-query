import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import SqlEditor, { SqlEditorRef } from '@/components/sql/SqlEditor'
import ResultPanel from '@/components/sql/ResultPanel'
import { AlertCircleIcon } from 'lucide-react'
import { QueryResult, QuerySession as Session } from '@/types/database'

interface QueryWorkspaceProps {
  sqlQuery: string;
  updateTabContent: (content: string) => void;
  activeSession: Session | null;
  isExecuting: boolean;
  queryResult: QueryResult | null;
  error: string | null;
  onSelectionChange?: (selectedText: string) => void;
  fontSize?: number; // 新增：字体大小
}

// 暴露给父组件的方法
export interface QueryWorkspaceRef {
  formatSQL: () => void
}

const QueryWorkspace = forwardRef<QueryWorkspaceRef, QueryWorkspaceProps>(({
  sqlQuery,
  updateTabContent,
  activeSession,
  isExecuting,
  queryResult,
  error,
  onSelectionChange,
  fontSize = 14 // 新增：字体大小，默认14
}, ref) => {
  const sqlEditorRef = useRef<SqlEditorRef>(null)
  
  // 控制结果面板的显示/隐藏
  const [showResultPanel, setShowResultPanel] = useState(false)

  // 当有查询结果或错误时显示结果面板
  useEffect(() => {
    if (queryResult || error) {
      setShowResultPanel(true)
    }
  }, [queryResult, error])

  // 暴露格式化方法给父组件
  useImperativeHandle(ref, () => ({
    formatSQL: () => {
      sqlEditorRef.current?.formatSQL()
    }
  }), [])

  // 关闭结果面板
  const handleCloseResultPanel = () => {
    setShowResultPanel(false)
  }

  return (
    <ResizablePanelGroup
      direction="vertical"
      className="flex-1 overflow-hidden"
    >
      {/* SQL编辑器面板 */}
      <ResizablePanel 
        defaultSize={showResultPanel ? 50 : 100} 
        minSize={showResultPanel ? 30 : 100}
      >
        <div className="flex flex-col h-full max-h-full overflow-hidden">
          {activeSession && activeSession.id && (
            <div className="flex-1 p-1 overflow-hidden">
              <SqlEditor
                ref={sqlEditorRef}
                value={sqlQuery}
                onChange={updateTabContent}
                readOnly={isExecuting}
                onSelectionChange={onSelectionChange}
                fontSize={fontSize}
              />
            </div>
          )}
        </div>
      </ResizablePanel>

      {/* 只有当showResultPanel为true时才显示分隔条和结果面板 */}
      {showResultPanel && (
        <>
          {/* 可调整大小的分隔条 */}
          <ResizableHandle />

          {/* 结果面板 */}
          <ResizablePanel defaultSize={50} minSize={20}>
            {error ? (
              <div className="h-full flex flex-col p-4">
                <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 max-w-2xl">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-6 h-6 bg-destructive/10 rounded-full flex items-center justify-center">
                      <AlertCircleIcon className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-destructive mb-2">查询执行失败</h3>
                      <div className="bg-background rounded-md border p-3">
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
                          {error}
                        </pre>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">请检查SQL语法或联系管理员获取帮助</p>
                    </div>
                  </div>
                </div>
              </div>
            ) : queryResult ? (
              <ResultPanel 
                result={queryResult} 
                isLoading={isExecuting} 
                onClose={handleCloseResultPanel}
              />
            ) : isExecuting ? (
              <div className="h-full flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                <span className="ml-3">执行中...</span>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                执行查询以查看结果
              </div>
            )}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  )
})

QueryWorkspace.displayName = 'QueryWorkspace'

export default QueryWorkspace
