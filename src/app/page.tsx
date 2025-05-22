"use client"

import { useState, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { QueryResult, DatabaseObjectType, StoredProcedureInfo, SqlScript } from '@/types/database'
import SessionSelector from '@/components/session/SessionSelector'
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
  ChevronDownIcon,
  TrashIcon,
  BookOpenIcon
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { useSession } from '@/components/session/SessionContext'
import EditorTabs, { EditorTab } from '@/components/sql/EditorTabs'
import { debounce } from 'lodash';

export default function SqlWorkbenchPage() {
  const { activeSession } = useSession()
  const { addQueryToHistory } = useQueryHistory()

  // 标签页状态
  const [sqlTabs, setSqlTabs] = useState<EditorTab[]>([])
  const [activeSqlTabId, setActiveSqlTabId] = useState<string>('')

  const [sqlQuery, setSqlQuery] = useState<string>('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 数据库对象管理
  const [dbObjectDialogOpen, setDbObjectDialogOpen] = useState(false)
  const [dbObjectType, setDbObjectType] = useState<DatabaseObjectType>(DatabaseObjectType.StoredProcedure)
  const [dbObjectSearchTerm, setDbObjectSearchTerm] = useState('')
  const [dbObjects, setDbObjects] = useState<{ name: string, definition: string }[]>([])
  const [selectedObject, setSelectedObject] = useState<{ name: string, definition: string } | null>(null)

  // SQL object 查询状态
  const [isDbObjectsSearching, setDbObjectsIsSearching] = useState(false);

  // SQL scripts
  const [scriptDialogOpen, setScriptDialogOpen] = useState(false)
  const [scriptGroups, setScriptGroups] = useState<Record<string, SqlScript[]>>({})

  // tab切换处理函数
  const handleTabChange = useCallback((tabId: string) => {
    // 保存当前tab的内容
    if (activeSqlTabId && sqlQuery !== undefined) {
      setSqlTabs(prev => prev.map(tab =>
        tab.id === activeSqlTabId
          ? { ...tab, content: sqlQuery, isDirty: tab.content !== sqlQuery }
          : tab
      ));
    }

    // 切换到新tab并加载其内容
    setActiveSqlTabId(tabId);
    const targetTab = sqlTabs.find(tab => tab.id === tabId);
    if (targetTab) {
      setSqlQuery(targetTab.content);
      // 切换tab时清空结果和错误
      setQueryResult(null);
      setError(null);
    }
  }, [activeSqlTabId, sqlQuery, sqlTabs]);

  // 修复：正确的内容更新函数
  const updateTabContent = useCallback((content: string) => {
    setSqlQuery(content);
    // 同步更新对应tab的内容
    setSqlTabs(prev => prev.map(tab =>
      tab.id === activeSqlTabId
        ? { ...tab, content, isDirty: tab.content !== content }
        : tab
    ));
  }, [activeSqlTabId]);

  // 执行查询函数
  const executeCurrentQuery = async (queryToExecute?: string) => {
    // 获取当前活动tab的内容
    const currentTab = sqlTabs.find(tab => tab.id === activeSqlTabId);
    const queryText = queryToExecute || currentTab?.content || sqlQuery;

    if (!queryText || !queryText.trim()) {
      console.log('Query is empty or undefined');
      return;
    }

    if (!activeSession) {
      console.log('no active session');
      return;
    }

    setIsExecuting(true)
    setError(null)
    setQueryResult(null)

    const startTime = Date.now()

    try {
      const isQuery = isQueryStatement(queryText)

      const result = isQuery
        ? await executeQuery(activeSession.id, queryText)
        : await executeNonQuery(activeSession.id, queryText)

      const duration = Date.now() - startTime

      if (result.error) {
        setError(result.error)

        if (activeSession) {
          addQueryToHistory(
            activeSession,
            queryText,
            duration,
            false,
            result.error
          )
        }
      } else {
        setQueryResult(result)

        if (activeSession) {
          addQueryToHistory(
            activeSession,
            queryText,
            duration,
            true
          )
        }
      }
    } catch (err) {
      setError(`查询执行失败: ${err}`)

      if (activeSession) {
        addQueryToHistory(
          activeSession,
          queryText,
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
    if (isExecuting) {
      setIsExecuting(false)
      setError('查询已手动停止')
    }
  }

  // 加载数据库对象
  const loadDatabaseObjects = async (type: DatabaseObjectType, searchTerm: string = '') => {
    if (!activeSession) return

    setDbObjectType(type);
    setDbObjectSearchTerm(searchTerm);
    setDbObjectDialogOpen(true);

    // 初始加载
    debouncedSearch(searchTerm);
  }

  // 在 SqlWorkbenchPage 组件内部添加
  const debouncedSearch = useCallback(
    debounce(async (term: string) => {
      if (!activeSession) return;

      setDbObjectsIsSearching(true);
      try {
        if (dbObjectType === DatabaseObjectType.StoredProcedure) {
          const procedures: StoredProcedureInfo[] = await search_stored_procedures(
            activeSession.id,
            term
          );

          const formattedObjects = procedures.map(proc => ({
            name: proc.full_name || proc.name,
            definition: proc.definition || `-- 存储过程: ${proc.name}\n-- 架构: ${proc.schema_name}\n-- 完整名称: ${proc.full_name}\n\n${proc.definition}`
          }));

          setDbObjects(formattedObjects);
        }
        else {
          setDbObjects([]);
        }
        // 可以添加其他类型的处理
      } catch (err) {
        setError(`搜索${dbObjectType}失败: ${err}`);
      } finally {
        setDbObjectsIsSearching(false);
      }
    }, 500), // 500ms 的防抖延迟
    [activeSession, dbObjectType]
  );

  useEffect(() => {
    if (dbObjectDialogOpen) {
      debouncedSearch(dbObjectSearchTerm);
    }
  }, [dbObjectSearchTerm, dbObjectDialogOpen, debouncedSearch]);

  // 打开数据库对象
  const openDatabaseObject = (obj: { name: string, definition: string }) => {
    setSelectedObject(obj)
    // 将定义插入到当前活动tab
    setSqlQuery(obj.definition)
    updateTabContent(obj.definition)
    setDbObjectDialogOpen(false)
    // 清空选中的对象，这样下次打开对话框时不会显示上次的内容
    setTimeout(() => setSelectedObject(null), 100); // 使用setTimeout确保对话框关闭后再清空
  }

  // 重新加载索引
  const reloadIndexes = async () => {
    if (!activeSession) return

    try {
      setError('重新加载索引功能尚未实现')
    } catch (err) {
      setError(`重新加载索引失败: ${err}`)
    }
  }

  // 修复：初始化默认标签页，确保session准备好后再创建
  useEffect(() => {
    if (sqlTabs.length === 0 && activeSession?.id) {
      const newTabId = uuidv4()
      const newTab: EditorTab = {
        id: newTabId,
        title: `SQLQuery1`,
        content: '',
        sessionId: activeSession.id,
        isDirty: false
      }
      setSqlTabs([newTab])
      setActiveSqlTabId(newTabId)
      setSqlQuery('')
    }
  }, [activeSession?.id, sqlTabs.length])

  // 添加新标签页
  const addNewTab = useCallback(() => {
    if (!activeSession) return

    // 保存当前tab内容
    if (activeSqlTabId && sqlQuery !== undefined) {
      setSqlTabs(prev => prev.map(tab =>
        tab.id === activeSqlTabId
          ? { ...tab, content: sqlQuery, isDirty: tab.content !== sqlQuery }
          : tab
      ));
    }

    const tabCount = sqlTabs.length + 1
    const newTabId = uuidv4()
    const newTab: EditorTab = {
      id: newTabId,
      title: `SQLQuery${tabCount}`,
      content: '',
      sessionId: activeSession.id,
      isDirty: false
    }

    setSqlTabs(prev => [...prev, newTab])
    setActiveSqlTabId(newTabId)
    setSqlQuery('')
    setQueryResult(null)
    setError(null)
  }, [activeSession, activeSqlTabId, sqlQuery, sqlTabs.length])

  // 修复：关闭标签页逻辑
  const closeTab = useCallback((tabId: string) => {
    if (sqlTabs.length <= 1) {
      // 不允许关闭最后一个tab
      return;
    }

    // 如果关闭的是当前活动标签页，需要切换到其他标签页
    if (tabId === activeSqlTabId) {
      const tabIndex = sqlTabs.findIndex(t => t.id === tabId)
      let newActiveTabId = '';

      if (tabIndex > 0) {
        newActiveTabId = sqlTabs[tabIndex - 1].id
      } else if (sqlTabs.length > 1) {
        newActiveTabId = sqlTabs[1].id
      }

      if (newActiveTabId) {
        const newActiveTab = sqlTabs.find(t => t.id === newActiveTabId);
        if (newActiveTab) {
          setActiveSqlTabId(newActiveTabId);
          setSqlQuery(newActiveTab.content);
        }
      }
    }

    setSqlTabs(prev => prev.filter(t => t.id !== tabId))
  }, [sqlTabs, activeSqlTabId])

  useEffect(() => {
    const raw = localStorage.getItem('sqlserver-scripts')
    if (!raw) return

    try {
      const list: SqlScript[] = JSON.parse(raw)
      const grouped: Record<string, SqlScript[]> = {}
      for (const script of list) {
        if (!grouped[script.groupName]) grouped[script.groupName] = []
        grouped[script.groupName].push(script)
      }
      setScriptGroups(grouped)
    } catch (err) {
      console.error('解析 sqlserver-scripts 失败', err)
    }
  }, [])

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
              <Button
                variant="outline"
                onClick={() => {
                  // 关闭对话框（Dialog 组件会自动处理关闭）
                }}
              >
                取消
              </Button>
              <Button
                className="bg-red-500 hover:bg-red-600 text-white"
                onClick={() => {
                  setSqlQuery('');
                  setQueryResult(null);
                  setError(null);
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

      {/* 主要工作区域 */}
      <ResizablePanelGroup
        direction="vertical"
        className="flex-1 overflow-hidden"
      >
        {/* SQL编辑器面板 */}
        <ResizablePanel defaultSize={40} minSize={20}>
          <div className="flex flex-col h-full max-h-full overflow-hidden">
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

                {/* SQL脚本按钮 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScriptDialogOpen(true)}
                  disabled={!activeSession?.id}
                >
                  <BookOpenIcon className="h-4 w-4 mr-1" />
                  打开SQL脚本
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
                  onClick={() => executeCurrentQuery()}
                  disabled={isExecuting || !activeSession || !sqlQuery.trim()}
                  size="sm"
                >
                  <PlayIcon className="h-4 w-4 mr-1" />
                  {isExecuting ? '执行中...' : '执行(Ctrl+Enter)'}
                </Button>

              </div>
            </div>

            {activeSession && activeSession.id && <div className="flex-1 p-1 overflow-hidden">
              <SqlEditor
                value={sqlQuery}
                onChange={updateTabContent}
                executeQuery={executeCurrentQuery}
                readOnly={isExecuting}
              />
            </div>}
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

      {/* 数据库对象对话框 */}
      <Dialog
        open={dbObjectDialogOpen}
        onOpenChange={(open) => {
          setDbObjectDialogOpen(open);
          if (!open) {
            // 当对话框关闭时，清空选中的对象
            setTimeout(() => setSelectedObject(null), 100);
          }
        }}
      >
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
            {isDbObjectsSearching && (
              <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
            )}
          </div>

          {/* 添加水平布局容器，包裹左侧列表和右侧详情 */}
          <div className="flex flex-1 overflow-hidden border rounded-md">
            {/* 左侧列表 */}
            <div className="w-1/3 border-r overflow-auto">
              <ul className="divide-y">
                {dbObjects.map(obj => (
                  <li
                    key={obj.name}
                    className={`p-2 hover:bg-muted cursor-pointer ${selectedObject?.name === obj.name ? 'bg-muted' : ''}`}
                    onClick={() => setSelectedObject(obj)}
                  >
                    <div
                      className="truncate text-sm"
                      title={obj.name}
                      style={{ wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal', lineHeight: '1.2' }}
                    >
                      {obj.name}
                    </div>
                  </li>
                ))}
                {dbObjects.length === 0 && !isDbObjectsSearching && (
                  <li className="p-2 text-muted-foreground text-center">
                    未找到匹配的对象
                  </li>
                )}
              </ul>
            </div>

            {/* 右侧详情 */}
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

      <Dialog open={scriptDialogOpen} onOpenChange={setScriptDialogOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>选择 SQL 脚本</DialogTitle>
            <DialogDescription>从本地保存的脚本中选择</DialogDescription>
          </DialogHeader>

          {Object.keys(scriptGroups).length === 0 ? (
            <p className="text-muted-foreground">暂无脚本，请先添加。</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(scriptGroups).map(([groupName, scripts]) => (
                <div key={groupName}>
                  <h4 className="font-semibold text-sm mb-1">{groupName}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    {scripts.map(script => (
                      <Button
                        key={script.id}
                        variant="outline"
                        className="justify-start"
                        onClick={() => {
                          setSqlQuery(script.content)
                          updateTabContent(script.content)
                          setScriptDialogOpen(false)
                        }}
                      >
                        {script.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div >
  )
}