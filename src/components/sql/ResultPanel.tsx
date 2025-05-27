"use client"

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
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
import { debounce } from 'lodash'

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

// 简化的单元格渲染器工厂函数
const createCellRenderer = (toast: any) => {
  return (params: any) => {
    const value = params.value;
    const columnType = params.colDef?.columnType;
    
    if (value === null || value === undefined) {
      return (
        <span style={{ color: '#999', fontStyle: 'italic' }}>
          NULL
        </span>
      );
    }

    if (columnType === 'Datetime' || columnType === 'Datetimen') {
      try {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        }
      } catch (e) {
        // 日期解析失败，返回原始值
      }
    }

    if (typeof value === 'boolean') {
      return value ? '是' : '否';
    }

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
      );
    }

    return value?.toString() || '';
  };
};

const ResultPanel: React.FC<ResultPanelProps> = React.memo(({ result, isLoading = false }) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('');
  const [gridApis, setGridApis] = useState<Record<string, GridApi>>({});
  const [quickFilterText, setQuickFilterText] = useState('');
  const [columnSearchText, setColumnSearchText] = useState('');
  const [highlightedColumn, setHighlightedColumn] = useState<string | null>(null);
  const [gridReady, setGridReady] = useState<Record<string, boolean>>({});
  const gridRefs = useRef<Record<string, React.RefObject<AgGridReact<any> | null>>>({});

  const { resolvedTheme } = useTheme();

  // 防抖处理快速过滤
  const debouncedSetQuickFilter = useCallback(
    debounce((value: string) => {
      setQuickFilterText(value);
    }, 200),
    []
  );

  // 根据 resolvedTheme 动态生成 theme
  const myTheme = useMemo(() => {
    const baseTheme = resolvedTheme === "dark"
      ? themeQuartz.withPart(colorSchemeDark)
      : themeQuartz.withPart(colorSchemeLightWarm);

    return baseTheme.withParams({
      fontFamily: 'sans-serif, Maple Mono, monospace',
      headerFontFamily: 'sans-serif, Maple Mono, monospace',
      cellFontFamily: 'sans-serif, Maple Mono, monospace',
    });
  }, [resolvedTheme]);

  // 预处理列定义
  const cellRenderer = useMemo(() => createCellRenderer(toast), [toast]);

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
  }, [result]);

  // 为每个标签页创建grid引用
  useEffect(() => {
    tabsData.forEach(tab => {
      if (!gridRefs.current[tab.id]) {
        gridRefs.current[tab.id] = React.createRef<AgGridReact<any> | null>();
      }
    });
  }, [tabsData]);

  // 设置默认活动标签页
  useEffect(() => {
    if (tabsData.length > 0 && !activeTab) {
      setActiveTab(tabsData[0].id)
    }
  }, [tabsData, activeTab]);

  // 高亮列的处理
  useEffect(() => {
    if (highlightedColumn && activeTab && gridApis[activeTab]) {
      gridApis[activeTab].redrawRows();
      
      // 5秒后自动取消高亮
      const timeoutId = setTimeout(() => {
        setHighlightedColumn(null);
        gridApis[activeTab]?.redrawRows();
      }, 5000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [highlightedColumn, activeTab, gridApis]);

  // 查找并高亮列 - 优化防抖
  const findAndHighlightColumn = useCallback(
    debounce((tabId: string) => {
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
        setHighlightedColumn(foundColumn.getColId());
        gridApi.ensureColumnVisible(foundColumn);

        setTimeout(() => {
          const headerCell = document.querySelector(`.ag-header-cell[col-id="${foundColumn.getColId()}"]`);
          if (headerCell) {
            headerCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        }, 100);

        toast.info('列已找到', { description: `已找到并高亮显示列: ${foundColumn.getColDef().headerName}` })
        return true;
      } else {
        toast.error('未找到列', { description: `没有找到包含 "${columnSearchText}" 的列` })
      }
      return false;
    }, 200),
    [gridApis, columnSearchText, toast]
  );

  // 优化列定义生成 - 不再依赖highlightedColumn
  const generateColumnDefs = useCallback((resultSet: ResultSet): ColDef[] => {
    if (!resultSet.columns || resultSet.columns.length === 0) {
      return []
    }

    return resultSet.columns.map((column, index) => {
      // 预处理列类型信息
      const columnType = resultSet.column_types ? resultSet.column_types[index] : undefined;
      
      return {
        headerName: column,
        field: column,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 120,
        flex: 1,
        columnType,
        columnIndex: index,
        // 通过getter函数计算样式，避免在列定义中硬编码
        cellStyle: (params) => {
          if (highlightedColumn === column) {
            return { backgroundColor: 'rgba(25, 118, 210, 0.2)' };
          }
          return null;
        },
        cellRenderer
      };
    });
  }, [cellRenderer, highlightedColumn]);

  // 处理网格准备就绪
  const onGridReady = useCallback((params: GridReadyEvent, tabId: string) => {
    setGridApis(prev => ({
      ...prev,
      [tabId]: params.api
    }));
    
    setGridReady(prev => ({
      ...prev,
      [tabId]: true
    }));
  }, []);

  // 导出数据为CSV - 保持不变
  const exportToCsv = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId]
    if (gridApi) {
      gridApi.exportDataAsCsv({
        fileName: `query_result_${tabId}.csv`
      });
      toast.success('导出成功', { description: '数据已导出为CSV文件' });
    }
  }, [gridApis, toast]);

  // 自适应列宽 - 优化防抖
  const autoSizeColumns = useCallback(
    debounce((tabId: string) => {
      const gridApi = gridApis[tabId];
      if (gridApi) {
        gridApi.autoSizeAllColumns();
      }
    }, 100),
    [gridApis]
  );

  // AG Grid本地化配置 - 保持不变
  const gridOptions = useMemo(() => ({
    localeText: AG_GRID_LOCALE_CN,
    // 优化拖拽性能的设置
    suppressMovableColumns: false,
    suppressColumnMoveAnimation: true,
    enableCellTextSelection: true,
    suppressMenuHide: true,
    animateRows: false, // 关闭行动画以提高性能
    suppressScrollOnNewData: true,
    rowBuffer: 20, // 增加缓冲行数以提高滚动性能
  }), []);

  // 预处理行数据，优化渲染性能
  const getProcessedRowData = useCallback((resultSet: ResultSet) => {
    if (!resultSet.rows) return [];
    
    // 直接返回原始数据，因为我们已经优化了单元格渲染器
    // 如果需要预处理数据，可以在这里进行
    return resultSet.rows;
  }, []);

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
                  className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ease-in-out data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:scale-105 hover:bg-muted whitespace-nowrap flex-shrink-0 max-w-[200px]"
                >
                  <TableIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm truncate">{tab.title}</span>
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

                    {/* 全局搜索框 - 使用防抖 */}
                    <div className="flex items-center gap-2 ml-4">
                      <div className="relative">
                        <SearchIcon className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="搜索所有数据..."
                          className="pl-8 h-8 text-sm"
                          defaultValue={quickFilterText}
                          onChange={(e) => debouncedSetQuickFilter(e.target.value)}
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
                  <div className="relative h-full w-full">
                    {/* 加载遮罩 */}
                    {!gridReady[tab.id] && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                        <div className="flex items-center gap-2">
                          <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                          <span className="text-sm text-muted-foreground">正在渲染表格...</span>
                        </div>
                      </div>
                    )}
                    <div className="ag-theme-alpine h-full w-full">
                      <AgGridReact
                        ref={gridRefs.current[tab.id]}
                        theme={myTheme}
                        gridOptions={gridOptions}
                        rowData={getProcessedRowData(tab.resultSet)}
                        columnDefs={generateColumnDefs(tab.resultSet)}
                        defaultColDef={{
                          sortable: true,
                          filter: true,
                          resizable: true,
                          minWidth: 120,
                          cellStyle: { fontSize: '14px' }
                        }}
                        onGridReady={(params) => onGridReady(params, tab.id)}
                        enableCellTextSelection={gridOptions.enableCellTextSelection}
                        pagination={true}
                        paginationPageSize={100}
                        paginationPageSizeSelector={[50, 100, 200, 500]}
                        suppressPaginationPanel={false}
                        ensureDomOrder={true}
                        suppressRowHoverHighlight={false}
                        rowHeight={35}
                        headerHeight={40}
                        quickFilterText={quickFilterText}
                        cacheQuickFilter={true}
                        // 拖拽优化
                        suppressColumnMoveAnimation={true}
                        // 渲染优化
                        rowBuffer={gridOptions.rowBuffer}
                      />
                    </div>
                  </div>
                ) : tab.affectedRows !== undefined && tab.affectedRows > 0 ? (
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
}, (prevProps, nextProps) => {
  // 优化比较函数，更精确地判断何时需要重新渲染
  const prevResultSets = prevProps.result?.result_sets;
  const nextResultSets = nextProps.result?.result_sets;
  
  // 如果加载状态变化，需要重新渲染
  if (prevProps.isLoading !== nextProps.isLoading) {
    return false;
  }
  
  // 如果结果集为空，比较简单属性
  if (!prevResultSets || !nextResultSets) {
    return prevResultSets === nextResultSets;
  }
  
  // 如果结果集长度不同，需要重新渲染
  if (prevResultSets.length !== nextResultSets.length) {
    return false;
  }
  
  // 比较执行时间
  if (prevProps.result?.execution_time !== nextProps.result?.execution_time) {
    return false;
  }
  
  // 对于相同结构的结果集，可以认为是相同的（数据通常不会变）
  return true;
});

ResultPanel.displayName = 'ResultPanel'

export default ResultPanel
