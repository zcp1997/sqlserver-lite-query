"use client"

import { useState } from 'react'
import { QueryResult, DatabaseObjectType } from '@/types/database'
import SessionSelector from '@/components/sql/SessionSelector'
import SqlEditor from '@/components/sql/SqlEditor'
import ResultPanel from '@/components/sql/ResultPanel'
import { executeQuery, executeNonQuery, isQueryStatement, search_stored_procedures } from '@/lib/api'
import { useQueryHistory } from '@/hooks/useQueryHistory'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@/components/ui/resizable'
import { Button } from '@/components/ui/button'
import {
  PlayIcon,
  AlertCircleIcon,
  StopCircleIcon,
  DatabaseIcon,
  SearchIcon,
  RefreshCcwIcon,
  ActivityIcon,
  ChevronDownIcon
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { useSession } from '@/components/sql/SessionContext'

export default function SqlWorkbenchPage() {
  const { activeSession } = useSession()
  const { addQueryToHistory } = useQueryHistory()

  const [sqlQuery, setSqlQuery] = useState<string>('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('result')

  // 数据库对象管理
  const [dbObjectDialogOpen, setDbObjectDialogOpen] = useState(false)
  const [dbObjectType, setDbObjectType] = useState<DatabaseObjectType>(DatabaseObjectType.StoredProcedure)
  const [dbObjectSearchTerm, setDbObjectSearchTerm] = useState('')
  const [dbObjects, setDbObjects] = useState<{ name: string, definition: string }[]>([])
  const [selectedObject, setSelectedObject] = useState<{ name: string, definition: string } | null>(null)

  // SQL跟踪器
  const [tracerOpen, setTracerOpen] = useState(false)

  // 执行SQL查询
  const executeCurrentQuery = async () => {
    if (!sqlQuery.trim() || !activeSession) return

    setIsExecuting(true)
    setError(null)
    setQueryResult(null)

    const startTime = Date.now()

    try {
      const isQuery = isQueryStatement(sqlQuery)

      const result = isQuery
        ? await executeQuery(activeSession.id, sqlQuery)
        : await executeNonQuery(activeSession.id, sqlQuery)

      //const result1 = await search_stored_procedures(activeSessionId, "入库验收")

      const duration = Date.now() - startTime

      if (result.error) {
        setError(result.error)

        // 添加到历史记录
        if (activeSession) {
          addQueryToHistory(
            activeSession,
            sqlQuery,
            duration,
            false,
            result.error
          )
        }
      } else {
        setQueryResult(result)
        setActiveTab('result')

        // 添加到历史记录
        if (activeSession) {
          addQueryToHistory(
            activeSession,
            sqlQuery,
            duration,
            true
          )
        }
      }
    } catch (err) {
      setError(`查询执行失败: ${err}`)

      // 添加到历史记录
      if (activeSession) {
        addQueryToHistory(
          activeSession,
          sqlQuery,
          Date.now() - startTime,
          false,
          String(err)
        )
      }
    } finally {
      setIsExecuting(false)
    }
  }

  // 停止执行
  const stopExecution = () => {
    // 实际上我们可能需要调用后端API来取消查询
    // 这里先简单实现为标记状态
    if (isExecuting) {
      setIsExecuting(false)
      setError('查询已手动停止')
    }
  }

  // 加载数据库对象
  const loadDatabaseObjects = async (type: DatabaseObjectType, searchTerm: string = '') => {
    if (!activeSession) return

    setDbObjectType(type)
    setDbObjectSearchTerm(searchTerm)

    try {
      // 这里应该调用后端API获取数据库对象
      // 临时模拟数据
      setDbObjects([
        { name: `${type}_示例1`, definition: `-- ${type} 定义示例1\nCREATE ${type} example1 AS\nSELECT * FROM users;` },
        { name: `${type}_示例2`, definition: `-- ${type} 定义示例2\nCREATE ${type} example2 AS\nSELECT * FROM products;` }
      ])

      setDbObjectDialogOpen(true)
    } catch (err) {
      setError(`加载${type}失败: ${err}`)
    }
  }

  // 打开数据库对象
  const openDatabaseObject = (obj: { name: string, definition: string }) => {
    setSelectedObject(obj)
    // 可以选择将定义插入到编辑器
    setSqlQuery(obj.definition)
    setDbObjectDialogOpen(false)
  }

  // 重新加载索引
  const reloadIndexes = async () => {
    if (!activeSession) return

    try {
      // 这里应该调用后端API重新加载索引
      // 临时实现
      setError('重新加载索引功能尚未实现')
    } catch (err) {
      setError(`重新加载索引失败: ${err}`)
    }
  }

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      <div className="p-2 border-b flex-shrink-0">
        <SessionSelector />
      </div>

      {/* 主要工作区域 */}
      <ResizablePanelGroup
        direction="vertical"
        className="flex-1 overflow-hidden"
      >
        {/* SQL编辑器面板 */}
        <ResizablePanel defaultSize={50} minSize={20}>
          <div className="flex flex-col h-full max-h-full overflow-hidden">
            <div className="flex justify-between items-center p-2 border-b flex-shrink-0">
              {/* <div className="text-sm font-medium">
                {activeSession ? (
                  <span>
                    {activeSession.connectionName} - {activeSession.database}
                  </span>
                ) : (
                  <span className="text-muted-foreground">无活动会话</span>
                )}
              </div> */}

              <div className="flex items-center gap-2">
                {/* SQL管理下拉菜单 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <DatabaseIcon className="h-4 w-4 mr-1" />
                      SQL管理
                      <ChevronDownIcon className="h-4 w-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56">
                    <DropdownMenuLabel>数据库对象</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => loadDatabaseObjects(DatabaseObjectType.StoredProcedure)}>
                        存储过程管理
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => loadDatabaseObjects(DatabaseObjectType.Function)}>
                        函数管理
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => loadDatabaseObjects(DatabaseObjectType.View)}>
                        视图管理
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={reloadIndexes}>
                        <RefreshCcwIcon className="h-4 w-4 mr-2" />
                        重新加载索引
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* 跟踪器按钮 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTracerOpen(true)}
                  disabled={!activeSession?.id}
                >
                  <ActivityIcon className="h-4 w-4 mr-1" />
                  打开跟踪器
                </Button>

                {/* 停止执行按钮 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={stopExecution}
                  disabled={!isExecuting}
                >
                  <StopCircleIcon className="h-4 w-4 mr-1" />
                  停止执行
                </Button>

                {/* 执行按钮 */}
                <Button
                  onClick={executeCurrentQuery}
                  disabled={isExecuting || !activeSession || !sqlQuery.trim()}
                  size="sm"
                >
                  <PlayIcon className="h-4 w-4 mr-1" />
                  {isExecuting ? '执行中...' : '执行'}
                </Button>
              </div>
            </div>

            <div className="flex-1 p-1 overflow-hidden">
              <SqlEditor
                value={sqlQuery}
                onChange={setSqlQuery}
                executeQuery={executeCurrentQuery}
                readOnly={isExecuting}
              />
            </div>
          </div>
        </ResizablePanel>

        {/* 可调整大小的分隔条 */}
        <ResizableHandle />

        {/* 结果面板 */}
        <ResizablePanel defaultSize={50} minSize={20}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col max-h-full overflow-hidden">
            <div className="border-b px-3 flex-shrink-0">
              <TabsList>
                <TabsTrigger value="result">结果</TabsTrigger>
                <TabsTrigger value="messages">消息</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="result" className="flex-1 p-0 overflow-hidden">
              {queryResult && (
                <ResultPanel result={queryResult} isLoading={isExecuting} />
              )}

              {!queryResult && !error && !isExecuting && (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  执行查询以查看结果
                </div>
              )}

              {isExecuting && !queryResult && (
                <div className="h-full flex items-center justify-center">
                  <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
                  <span className="ml-3">执行中...</span>
                </div>
              )}
            </TabsContent>

            <TabsContent value="messages" className="flex-1 p-4 overflow-auto">
              {error ? (
                <div className="flex items-start text-destructive">
                  <AlertCircleIcon className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                  <pre className="text-sm whitespace-pre-wrap">{error}</pre>
                </div>
              ) : queryResult && queryResult.result_sets && queryResult.result_sets.length > 0 && queryResult.result_sets[0]?.affected_rows !== undefined ? (
                <div className="text-sm">
                  影响了 {queryResult.result_sets[0].affected_rows} 行
                </div>
              ) : queryResult && queryResult.result_sets && queryResult.result_sets.length > 0 ? (
                <div className="text-sm">
                  查询成功返回 {queryResult.result_sets.reduce((sum, rs) => sum + (rs.rows ? rs.rows.length : 0), 0)} 行
                </div>
              ) : (
                <div className="text-muted-foreground">
                  执行查询以查看消息
                </div>
              )}
            </TabsContent>
          </Tabs>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* 数据库对象对话框 */}
      <Dialog open={dbObjectDialogOpen} onOpenChange={setDbObjectDialogOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {dbObjectType === DatabaseObjectType.StoredProcedure && '存储过程管理'}
              {dbObjectType === DatabaseObjectType.Function && '函数管理'}
              {dbObjectType === DatabaseObjectType.View && '视图管理'}
              {dbObjectType === DatabaseObjectType.Index && '索引管理'}
            </DialogTitle>
            <DialogDescription>
              搜索并管理数据库对象
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 my-2">
            <SearchIcon className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索对象名称..."
              value={dbObjectSearchTerm}
              onChange={(e) => setDbObjectSearchTerm(e.target.value)}
              className="flex-1"
            />
          </div>

          <div className="flex flex-1 overflow-hidden border rounded-md">
            <div className="w-1/3 border-r overflow-auto">
              <ul className="divide-y">
                {dbObjects
                  .filter(obj => obj.name.toLowerCase().includes(dbObjectSearchTerm.toLowerCase()))
                  .map(obj => (
                    <li
                      key={obj.name}
                      className={`p-2 hover:bg-muted cursor-pointer ${selectedObject?.name === obj.name ? 'bg-muted' : ''}`}
                      onClick={() => setSelectedObject(obj)}
                    >
                      {obj.name}
                    </li>
                  ))
                }
              </ul>
            </div>

            <div className="flex-1 overflow-auto p-2 bg-muted/30">
              {selectedObject ? (
                <>
                  <div className="font-medium mb-2">{selectedObject.name}</div>
                  <pre className="text-sm whitespace-pre-wrap bg-background p-4 rounded-md overflow-auto max-h-[400px]">
                    {selectedObject.definition}
                  </pre>
                  <div className="mt-4 flex justify-end">
                    <Button onClick={() => openDatabaseObject(selectedObject)}>
                      在编辑器中打开
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  选择一个对象查看详情
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* SQL跟踪器对话框 */}
      <Dialog open={tracerOpen} onOpenChange={setTracerOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>SQL跟踪器</DialogTitle>
            <DialogDescription>
              监控当前会话的SQL活动
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto p-4 bg-muted/30 min-h-[300px]">
            <div className="text-center text-muted-foreground">
              SQL跟踪器功能尚未实现
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
} 