"use client"

import React, { useMemo, useState, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, ColDef, GridReadyEvent, GridApi, themeQuartz, colorSchemeDark, colorSchemeLightWarm } from 'ag-grid-community'
import { AG_GRID_LOCALE_CN } from '@ag-grid-community/locale'
import { QueryResult, ResultSet } from '@/types/database'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import {
  TableIcon,
  DownloadIcon,
  InfoIcon,
  CheckCircleIcon,
  DatabaseIcon,
  CopyIcon,
  XIcon,
  SearchIcon,
  ClockIcon
} from 'lucide-react'
import { useTheme } from "next-themes"

ModuleRegistry.registerModules([AllCommunityModule]);

interface ResultPanelProps {
  result: QueryResult
  isLoading?: boolean
}

interface GridTabData {
  id: string
  title: string
  resultSet: ResultSet
  rowCount: number
  affectedRows?: number
}

const ResultPanel: React.FC<ResultPanelProps> = ({ result, isLoading = false }) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('')
  const [gridApis, setGridApis] = useState<Record<string, GridApi>>({})
  const [quickFilterText, setQuickFilterText] = useState('');
  const [columnSearchText, setColumnSearchText] = useState('');
  const [highlightedColumn, setHighlightedColumn] = useState<string | null>(null);

  const { resolvedTheme } = useTheme()

  // 根据 resolvedTheme 动态生成 theme
  const myTheme = useMemo(() => {
    const baseTheme = resolvedTheme === "dark"
      ? themeQuartz.withPart(colorSchemeDark)
      : themeQuartz.withPart(colorSchemeLightWarm);

    // 使用 withParams 添加字体配置
    return baseTheme.withParams({
      fontFamily: 'sans-serif, Maple Mono, monospace',
      // 可选：为表头设置不同字体
      headerFontFamily: 'sans-serif, Maple Mono, monospace',
      // 可选：为单元格设置字体
      cellFontFamily: 'sans-serif, Maple Mono, monospace',
    });
  }, [resolvedTheme]);

  // 处理结果集数据，生成标签页数据
  const tabsData = useMemo<GridTabData[]>(() => {
    if (!result?.result_sets || result.result_sets.length === 0) {
      return []
    }

    return result.result_sets.map((resultSet, index) => {
      const id = `result-${index}`
      const rowCount = resultSet.rows?.length || 0
      const affectedRows = resultSet.affected_rows

      let title = `结果 ${index + 1}`

      return {
        id,
        title,
        resultSet,
        rowCount,
        affectedRows
      }
    })
  }, [result])

  // 设置默认活动标签页
  React.useEffect(() => {
    if (tabsData.length > 0 && !activeTab) {
      setActiveTab(tabsData[0].id)
    }
  }, [tabsData, activeTab])

  // 查找并高亮列
  const findAndHighlightColumn = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId];
    if (!gridApi || !columnSearchText) return false;

    const allColumns = gridApi.getColumns();
    if (!allColumns) {
      return false;
    }
    const foundColumn = allColumns.find(col =>
      col.getColDef().headerName?.toLowerCase().includes(columnSearchText.toLowerCase())
    );

    if (foundColumn) {
      // 设置高亮列
      setHighlightedColumn(foundColumn.getColId());

      // 确保列可见
      gridApi.ensureColumnVisible(foundColumn);

      // 计算列的位置并滚动
      setTimeout(() => {
        // 使用setTimeout确保DOM已更新
        const headerCell = document.querySelector(`.ag-header-cell[col-id="${foundColumn.getColId()}"]`);
        if (headerCell) {
          headerCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }, 100);

      toast.info('列已找到', { description: `已找到并高亮显示列: ${foundColumn.getColDef().headerName}` })

      // 5秒后取消高亮
      setTimeout(() => {
        setHighlightedColumn(null);
      }, 5000);

      return true;
    } else {
      toast.error('未找到列', { description: `没有找到包含 "${columnSearchText}" 的列` })
    }
    return false;
  }, [gridApis, columnSearchText, toast]);

  // 生成表格列定义
  const generateColumnDefs = useCallback((resultSet: ResultSet): ColDef[] => {
    if (!resultSet.columns || resultSet.columns.length === 0) {
      return []
    }

    return resultSet.columns.map((column, index) => ({
      headerName: column,
      field: column,
      sortable: true,
      filter: true,
      resizable: true,
      minWidth: 120,
      flex: 1,
      cellStyle: (params) => {
        // 如果当前列是高亮列，应用高亮样式
        if (highlightedColumn === column) {
          return { backgroundColor: 'rgba(25, 118, 210, 0.2)' };
        }
        return null;
      },
      cellRenderer: (params: any) => {
        const value = params.value
        // 处理NULL值
        if (value === null || value === undefined) {
          return (
            <span style={{ color: '#999', fontStyle: 'italic' }}>
              NULL
            </span>
          )
        }

        // 处理日期类型
        if (resultSet.column_types && resultSet.column_types[index]) {
          const columnType = resultSet.column_types[index]
          if ((columnType === 'Datetime' || columnType === 'Datetimen') && value) {
            try {
              const date = new Date(value)
              if (!isNaN(date.getTime())) {
                return date.toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })
              }
            } catch (e) {
              // 日期解析失败，返回原始值
            }
          }
        }

        // 处理布尔值
        if (typeof value === 'boolean') {
          return value ? '是' : '否'
        }

        // 处理长文本
        if (typeof value === 'string' && value.length > 100) {
          return (
            <div className="flex items-center gap-2">
              <span
                title={value}
                style={{ cursor: 'help' }}
              >
                {value.substring(0, 100)}...
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(value)
                    .then(() => {
                      toast.success('文本已复制');
                    })
                    .catch(() => {
                    });
                }}
                title="复制完整内容"
              >
                <CopyIcon className="h-4 w-4" />
              </Button>
            </div>
          )
        }

        return value?.toString() || ''
      }
    }))
  }, [highlightedColumn, toast])

  // 处理网格准备就绪
  const onGridReady = useCallback((params: GridReadyEvent, tabId: string) => {
    setGridApis(prev => ({
      ...prev,
      [tabId]: params.api
    }))
  }, [])

  // 导出数据为CSV
  const exportToCsv = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId]
    if (gridApi) {
      gridApi.exportDataAsCsv({
        fileName: `query_result_${tabId}.csv`
      })
      toast.error('导出成功', { description: '数据已导出为CSV文件' })
    }
  }, [gridApis, toast])

  // 自适应列宽
  const autoSizeColumns = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId]
    if (gridApi) {
      gridApi.sizeColumnsToFit()
    }
  }, [gridApis, toast])

  const gridOptions = {
    // other grid options
    localeText: AG_GRID_LOCALE_CN,
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="ml-3">加载中...</span>
      </div>
    )
  }

  if (!result || !result.result_sets || result.result_sets.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <DatabaseIcon className="h-8 w-8 mr-3" />
        <span>没有查询结果</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden w-full max-w-full">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full flex flex-col overflow-hidden w-full max-w-full"
      >
        <div className="flex-shrink-0 border-b">
          <div className="overflow-x-auto overflow-y-hidden px-3 max-w-full">
            <TabsList className="flex space-x-1 w-max min-w-0">
              {tabsData.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ease-in-out data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:scale-105 hover:bg-muted whitespace-nowrap flex-shrink-0 max-w-[200px]" // 添加最大宽度限制
                >
                  <TableIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm truncate">{tab.title}</span> {/* 添加 truncate 类 */}
                  {tab.affectedRows !== undefined ? (
                    <Badge variant="secondary" className="ml-1 flex-shrink-0">
                      {tab.affectedRows} 行受影响
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-1 flex-shrink-0">
                      {tab.rowCount} 行
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>

        {tabsData.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            className="flex-1 overflow-hidden p-0"
          >
            <div className="h-full flex flex-col">
              {/* 工具栏 */}
              <div className="flex-shrink-0 p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <InfoIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {tab.affectedRows !== undefined ? (
                          <>影响了 <strong>{tab.affectedRows}</strong> 行</>
                        ) : (
                          <>返回 <strong>{tab.rowCount}</strong> 行数据</>
                        )}
                      </span>
                    </div>
                    {result.execution_time !== undefined && (
                      <div className="flex items-center gap-2">
                        <ClockIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          执行时间: <strong>{result.execution_time.toFixed(2)}</strong> 秒
                        </span>
                      </div>
                    )}
                    {tab.resultSet.columns && tab.resultSet.columns.length > 0 && (
                      <div className="flex items-center gap-2">
                        <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          <strong>{tab.resultSet.columns.length}</strong> 列
                        </span>
                      </div>
                    )}

                    {/* 全局搜索框 */}
                    <div className="flex items-center gap-2 ml-4">
                      <div className="relative">
                        <SearchIcon className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="搜索所有数据..."
                          className="pl-8 h-8 text-sm"
                          value={quickFilterText}
                          onChange={(e) => setQuickFilterText(e.target.value)}
                        />
                        {quickFilterText && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setQuickFilterText('')}
                            className="h-5 w-5 p-0 absolute right-2 top-1/2 transform -translate-y-1/2"
                          >
                            <XIcon className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* 列查找功能 */}
                    <div className="flex items-center gap-2 ml-2">
                      <div className="relative">
                        <SearchIcon className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="查找列..."
                          className="pl-8 h-8 text-sm"
                          value={columnSearchText}
                          onChange={(e) => setColumnSearchText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              findAndHighlightColumn(tab.id);
                            }
                          }}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => findAndHighlightColumn(tab.id)}
                        disabled={!columnSearchText}
                      >
                        查找
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => autoSizeColumns(tab.id)}
                      disabled={!gridApis[tab.id]}
                    >
                      自适应列宽
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportToCsv(tab.id)}
                      disabled={!gridApis[tab.id]}
                    >
                      <DownloadIcon className="h-4 w-4 mr-1" />
                      导出CSV
                    </Button>
                  </div>
                </div>
              </div>

              {/* 表格内容 */}
              <div className="flex-1 overflow-hidden">
                {tab.resultSet.rows && tab.resultSet.rows.length > 0 ? (
                  // 显示查询结果表格
                  <div className="ag-theme-alpine h-full w-full">
                    <AgGridReact
                      theme={myTheme}
                      gridOptions={gridOptions}
                      rowData={tab.resultSet.rows}
                      columnDefs={generateColumnDefs(tab.resultSet)}
                      defaultColDef={{
                        sortable: true,
                        filter: true,
                        resizable: true,
                        minWidth: 120,
                        cellStyle: { fontSize: '14px' }
                      }}
                      onGridReady={(params) => onGridReady(params, tab.id)}
                      enableCellTextSelection={true}
                      suppressMenuHide={true}
                      animateRows={true}
                      pagination={true}
                      paginationPageSize={100}
                      paginationPageSizeSelector={[50, 100, 200, 500]}
                      suppressPaginationPanel={false}
                      suppressScrollOnNewData={true}
                      ensureDomOrder={true}
                      suppressRowHoverHighlight={false}
                      rowHeight={35}
                      headerHeight={40}
                      quickFilterText={quickFilterText}
                      cacheQuickFilter={true}
                    />
                  </div>
                ) : tab.affectedRows !== undefined && tab.affectedRows > 0 ? (
                  // 显示成功操作卡片（没有返回数据但有受影响的行）
                  <div className="h-full flex items-center justify-center">
                    <Card className="w-96">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <CheckCircleIcon className="h-5 w-5 text-green-500" />
                          操作完成
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-center text-lg">
                          成功影响了 <strong className="text-primary">{tab.affectedRows}</strong> 行数据
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  // 空结果集
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <DatabaseIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>查询执行成功，但没有返回数据</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

export default ResultPanel
