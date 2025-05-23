import { Button } from '@/components/ui/button'
import {
  PlayIcon,
  StopCircleIcon,
  DatabaseIcon,
  BookOpenIcon,
  ChevronDownIcon, 
  Settings, 
  Zap, 
  Eye
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DatabaseObjectType, QuerySession as Session } from '@/types/database'

interface ToolbarActionsProps {
  activeSession: Session | null;
  onOpenDbObjectDialog: (type?: DatabaseObjectType) => void;
  onOpenScriptDialog: () => void;
  isExecuting?: boolean;
  onExecuteQuery?: () => void;
  onStopExecution?: () => void;
  sqlQuery?: string;
}

export default function ToolbarActions({
  activeSession,
  onOpenDbObjectDialog,
  onOpenScriptDialog,
  isExecuting = false,
  onExecuteQuery,
  onStopExecution,
  sqlQuery = ''
}: ToolbarActionsProps) {

  return (
    <div className="flex justify-between items-center p-2 border-b flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* SQL管理下拉菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <DatabaseIcon className="h-4 w-4 mr-1" />
              数据库对象管理
              <ChevronDownIcon className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>数据库对象</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onOpenDbObjectDialog(DatabaseObjectType.StoredProcedure)}>
                <Settings className="mr-2 h-4 w-4" />
                存储过程管理
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenDbObjectDialog(DatabaseObjectType.Function)}>
                <Zap className="mr-2 h-4 w-4" />
                函数管理
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenDbObjectDialog(DatabaseObjectType.View)}>
                <Eye className="mr-2 h-4 w-4" />
                视图管理
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* SQL脚本按钮 */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenScriptDialog}
          disabled={!activeSession?.id}
        >
          <BookOpenIcon className="h-4 w-4 mr-1" />
          打开SQL脚本
        </Button>

        {/* 停止执行按钮 */}
        <Button
          variant="outline"
          size="sm"
          onClick={onStopExecution}
          disabled={!isExecuting}
        >
          <StopCircleIcon className="h-4 w-4 mr-1" />
          停止执行
        </Button>

        {/* 执行按钮 */}
        <Button
          onClick={onExecuteQuery}
          disabled={isExecuting || !activeSession || !sqlQuery.trim()}
          size="sm"
        >
          <PlayIcon className="h-4 w-4 mr-1" />
          {isExecuting ? '执行中...' : '执行'}
        </Button>
      </div>
    </div>
  )
}
