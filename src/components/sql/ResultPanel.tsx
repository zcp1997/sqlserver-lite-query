"use client"

import React, { useMemo, useState, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, ColDef, GridReadyEvent, GridApi } from 'ag-grid-community'
import { AG_GRID_LOCALE_CN } from '@ag-grid-community/locale'
import { QueryResult, ResultSet } from '@/types/database'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  TableIcon,
  DownloadIcon,
  InfoIcon,
  CheckCircleIcon,
  DatabaseIcon
} from 'lucide-react'

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
  const [activeTab, setActiveTab] = useState<string>('')
  const [gridApis, setGridApis] = useState<Record<string, GridApi>>({})

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
            <span
              title={value}
              style={{ cursor: 'help' }}
            >
              {value.substring(0, 100)}...
            </span>
          )
        }

        return value?.toString() || ''
      }
    }))
  }, [])

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
    }
  }, [gridApis])

  // 自适应列宽
  const autoSizeColumns = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId]
    if (gridApi) {
      gridApi.sizeColumnsToFit()
    }
  }, [gridApis])

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
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="h-full flex flex-col overflow-hidden"
      >
        <div className="flex-shrink-0 border-b px-3">
          <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabsData.length}, 1fr)` }}>
            {tabsData.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-2">
                <TableIcon className="h-4 w-4" />
                <span>{tab.title}</span>
                {tab.affectedRows !== undefined ? (
                  <Badge variant="secondary" className="ml-1">
                    {tab.affectedRows} 行
                  </Badge>
                ) : tab.affectedRows !== undefined && (!tab.resultSet.rows || tab.resultSet.rows.length === 0) ? (
                  // 只有在没有数据行时才显示操作完成卡片
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
                  <Badge variant="outline" className="ml-1">
                    {tab.rowCount} 行
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
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
                <div className="flex items-center justify-between">
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
                    {tab.resultSet.columns && tab.resultSet.columns.length > 0 && (
                      <div className="flex items-center gap-2">
                        <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          <strong>{tab.resultSet.columns.length}</strong> 列
                        </span>
                      </div>
                    )}
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
                    />
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