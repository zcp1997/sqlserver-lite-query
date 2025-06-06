"use client"

import { Button } from "@/components/ui/button"
import {
  PlayIcon,
  StopCircleIcon,
  DatabaseIcon,
  BookOpenIcon,
  ChevronDownIcon,
  Settings,
  Zap,
  Eye,
  FileTextIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DatabaseObjectType, type QuerySession as Session } from "@/types/database"

interface ToolbarActionsProps {
  activeSession: Session | null
  onOpenDbObjectDialog: (type?: DatabaseObjectType) => void
  onOpenScriptDialog: () => void
  isExecuting?: boolean
  onExecuteQuery?: () => void
  onStopExecution?: () => void
  sqlQuery?: string
  selectedText?: string
  onFormatSQL?: () => void
  fontSize?: number
  onFontSizeChange?: (size: number) => void
}

export default function ToolbarActions({
  activeSession,
  onOpenDbObjectDialog,
  onOpenScriptDialog,
  isExecuting = false,
  onExecuteQuery,
  onStopExecution,
  sqlQuery = "",
  selectedText = "",
  onFormatSQL,
  fontSize = 14,
  onFontSizeChange,
}: ToolbarActionsProps) {
  // 判断是否有可执行的内容
  const hasExecutableContent = selectedText.trim() || sqlQuery.trim()

  // 字体大小调节函数
  const handleFontSizeDecrease = () => {
    const newSize = Math.max(10, fontSize - 1)
    onFontSizeChange?.(newSize)
  }

  const handleFontSizeIncrease = () => {
    const newSize = Math.min(20, fontSize + 1)
    onFontSizeChange?.(newSize)
  }

  return (
    <div className="flex justify-between items-center p-2 border-b flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* SQL管理下拉菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <DatabaseIcon className="h-4 w-4 mr-1" />
              数据库对象查询
              <ChevronDownIcon className="h-4 w-4 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>数据库对象</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onOpenDbObjectDialog(DatabaseObjectType.StoredProcedure)}>
                <Settings className="mr-2 h-4 w-4" />
                存储过程查询
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenDbObjectDialog(DatabaseObjectType.Function)}>
                <Zap className="mr-2 h-4 w-4" />
                函数查询
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenDbObjectDialog(DatabaseObjectType.View)}>
                <Eye className="mr-2 h-4 w-4" />
                视图查询
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* SQL脚本按钮 */}
        <Button variant="outline" size="sm" onClick={onOpenScriptDialog} disabled={!activeSession?.id || isExecuting}>
          <BookOpenIcon className="h-4 w-4 mr-1" />
          打开SQL脚本
        </Button>

        {/* 格式化SQL按钮 */}
        <Button
          variant="outline"
          size="sm"
          onClick={onFormatSQL}
          disabled={!activeSession?.id || isExecuting}
          title="格式化SQL代码"
        >
          <FileTextIcon className="h-4 w-4 mr-1" />
          格式化SQL
        </Button>

        {/* 字体大小调节器 - 优化版本 */}
        <div className="flex items-center bg-muted/50 rounded-md border">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 rounded-r-none border-r hover:bg-muted"
            onClick={handleFontSizeDecrease}
            disabled={fontSize <= 10}
            title="减小字体"
          >
            <MinusIcon className="h-3 w-3" />
          </Button>
          <div className="px-3 py-1 bg-background border-x min-w-[3rem] text-center">
            <span className="text-sm font-medium tabular-nums">{fontSize}px</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 rounded-l-none border-l hover:bg-muted"
            onClick={handleFontSizeIncrease}
            disabled={fontSize >= 20}
            title="增大字体"
          >
            <PlusIcon className="h-3 w-3" />
          </Button>
        </div>

        {/* 停止执行按钮 - 添加左边框分隔 */}
        <div className="border-l pl-2 ml-2">
          <Button variant="outline" size="sm" onClick={onStopExecution} disabled={!isExecuting}>
            <StopCircleIcon className="h-4 w-4 mr-1" />
            停止执行
          </Button>

          {/* 执行按钮 */}
          <Button
            onClick={() => onExecuteQuery?.()}
            disabled={isExecuting || !activeSession || !hasExecutableContent}
            size="sm"
            className="ml-2"
          >
            <PlayIcon className="h-4 w-4 mr-1" />
            {isExecuting ? "执行中..." : "执行"}
          </Button>
        </div>
      </div>
    </div>
  )
}
