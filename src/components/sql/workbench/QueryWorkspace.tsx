import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import SqlEditor from '@/components/sql/SqlEditor'
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
  onSelectionChange?: (selectedText: string) => void; // 新增
}

export default function QueryWorkspace({
  sqlQuery,
  updateTabContent,
  activeSession,
  isExecuting,
  queryResult,
  error,
  onSelectionChange
}: QueryWorkspaceProps) {
  return (
    <ResizablePanelGroup
      direction="vertical"
      className="flex-1 overflow-hidden"
    >
      {/* SQL编辑器面板 */}
      <ResizablePanel defaultSize={40} minSize={20}>
        <div className="flex flex-col h-full max-h-full overflow-hidden">
          {activeSession && activeSession.id && (
            <div className="flex-1 p-1 overflow-hidden">
              <SqlEditor
                value={sqlQuery}
                onChange={updateTabContent}
                readOnly={isExecuting}
                onSelectionChange={onSelectionChange}
              />
            </div>
          )}
        </div>
      </ResizablePanel>

      {/* 可调整大小的分隔条 */}
      <ResizableHandle />

      {/* 结果面板 */}
      <ResizablePanel defaultSize={60} minSize={20}>
        {error ? (
          <div className="h-full flex items-center justify-center text-destructive px-4">
            <AlertCircleIcon className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
            <pre className="text-sm whitespace-pre-wrap">{error}</pre>
          </div>
        ) : queryResult ? (
          <ResultPanel result={queryResult} isLoading={isExecuting} />
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
    </ResizablePanelGroup>
  )
}
