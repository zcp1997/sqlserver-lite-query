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
  onClose?: () => void
}

interface GridTabData {
  id: string
  title: string
  resultSet: ResultSet
  rowCount: number
  affectedRows?: number
}

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
      } catch (e) { /* Return original value on error */ }
    }

    if (typeof value === 'boolean') {
      return value ? '是' : '否';
    }

    if (typeof value === 'string' && value.length > 100) {
      return (
        <div className="flex items-center gap-2">
          <span title={value} style={{ cursor: 'help' }}>
            {value.substring(0, 100)}...
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(value)
                .then(() => { toast.success('文本已复制'); })
                .catch(() => { toast.error('复制失败'); });
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

const ResultPanel: React.FC<ResultPanelProps> = React.memo(({ result, isLoading = false, onClose }) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('');
  const [gridApis, setGridApis] = useState<Record<string, GridApi>>({});
  const [quickFilterText, setQuickFilterText] = useState('');
  const [columnSearchText, setColumnSearchText] = useState('');
  const [highlightedColumn, setHighlightedColumn] = useState<string | null>(null);
  const [gridReady, setGridReady] = useState<Record<string, boolean>>({});
  const gridRefs = useRef<Record<string, React.RefObject<AgGridReact<any> | null>>>({});
  const { resolvedTheme } = useTheme();

  const debouncedSetQuickFilter = useCallback(debounce((value: string) => setQuickFilterText(value), 200), []);

  const myTheme = useMemo(() => {
    const baseTheme = resolvedTheme === "dark"
      ? themeQuartz.withPart(colorSchemeDark)
      : themeQuartz.withPart(colorSchemeLightWarm);
    return baseTheme.withParams({
      fontFamily: 'JetBrainsMono, sans-serif, monospace',
      headerFontFamily: 'JetBrainsMono, sans-serif, monospace',
      cellFontFamily: 'JetBrainsMono, sans-serif, monospace',
    });
  }, [resolvedTheme]);

  const cellRenderer = useMemo(() => createCellRenderer(toast), [toast]);

  const tabsData = useMemo<GridTabData[]>(() => {
    if (!result?.result_sets || result.result_sets.length === 0) return [];
    return result.result_sets.map((resultSet, index) => ({
      id: `result-${index}`,
      title: `结果 ${index + 1}`,
      resultSet,
      rowCount: resultSet.rows?.length || 0,
      affectedRows: resultSet.affected_rows
    }));
  }, [result]);

  useEffect(() => {
    tabsData.forEach(tab => {
      if (!gridRefs.current[tab.id]) {
        gridRefs.current[tab.id] = React.createRef<AgGridReact<any> | null>();
      }
    });
  }, [tabsData]);

  useEffect(() => {
    if (tabsData.length > 0 && (!activeTab || !tabsData.find(tab => tab.id === activeTab))) {
      setActiveTab(tabsData[0].id);
    } else if (tabsData.length === 0 && activeTab) {
      setActiveTab('');
    }
  }, [tabsData, activeTab]);

  // Corrected useEffect for highlighting
  useEffect(() => {
    const api = activeTab && gridApis[activeTab] ? gridApis[activeTab] : null;
    if (!api) {
      return; // No API, nothing to do
    }

    // Always redraw when highlightedColumn changes and API is available.
    // The cellStyle function will determine if the highlight should be applied or removed.
    api.redrawRows();

    let timeoutId: NodeJS.Timeout | null = null;
    if (highlightedColumn) {
      // If a column is highlighted, set a timeout to clear the highlight
      timeoutId = setTimeout(() => {
        setHighlightedColumn(null); // This will trigger this effect again, and api.redrawRows() will remove the highlight.
      }, 5000);
    }

    return () => {
      // Cleanup: clear timeout if component unmounts or dependencies change
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [highlightedColumn, activeTab, gridApis]); // Effect runs when these change

  const findAndHighlightColumn = useCallback(
    debounce((tabId: string) => {
      const gridApi = gridApis[tabId];
      if (!gridApi || !columnSearchText) {
        if (!columnSearchText && highlightedColumn) setHighlightedColumn(null); // Clear if search text is empty
        return false;
      }

      const allColumns = gridApi.getColumns();
      if (!allColumns) return false;

      const foundColumn = allColumns.find(col =>
        col.getColDef().headerName?.toLowerCase().includes(columnSearchText.toLowerCase())
      );

      if (foundColumn && foundColumn.getColId()) {
        const colIdToHighlight = foundColumn.getColId();
        setHighlightedColumn(colIdToHighlight);
        gridApi.ensureColumnVisible(colIdToHighlight);
        setTimeout(() => {
          const headerCell = document.querySelector(`.ag-header-cell[col-id="${colIdToHighlight}"]`);
          if (headerCell) {
            headerCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }
        }, 100);
        toast.info('列已找到', { description: `已找到并高亮显示列: ${foundColumn.getColDef().headerName}` });
        return true;
      } else {
        setHighlightedColumn(null); // Clear highlight if not found
        toast.error('未找到列', { description: `没有找到包含 "${columnSearchText}" 的列` });
      }
      return false;
    }, 200),
    [gridApis, columnSearchText, toast, highlightedColumn] // Added highlightedColumn to dependencies
  );

  const generateColumnDefs = useCallback((resultSet: ResultSet): ColDef[] => {
    if (!resultSet.columns || resultSet.columns.length === 0) return [];
    return resultSet.columns.map((columnName, index) => {
      const columnType = resultSet.column_types ? resultSet.column_types[index] : undefined;
      return {
        headerName: columnName,
        field: columnName,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 120,
        flex: 1,
        columnType,
        cellStyle: (params) => {
          // highlightedColumn is from component scope, accessed via closure
          if (highlightedColumn && (highlightedColumn === params.colDef.field || highlightedColumn === params.column.getColId())) {
            return { backgroundColor: 'rgba(25, 118, 210, 0.2)' };
          }
          return null;
        },
        cellRenderer
      };
    });
  }, [cellRenderer, highlightedColumn]); // Re-added highlightedColumn: if cellStyle directly references it,
  // ColDef should regenerate if highlightedColumn changes to ensure
  // AG Grid gets the "new" cellStyle function instance with the correct closure.
  // While closure might pick it up, this is safer for AG Grid's change detection.
  // The alternative is `api.refreshCells()` with specific columns, but `redrawRows()` is simpler.
  // Let's test previous optimization: remove `highlightedColumn` here, ensure useEffect `redrawRows` is enough.
  // Sticking to the optimization: remove `highlightedColumn` from deps here. The useEffect should handle it.
  // const generateColumnDefs = useCallback((resultSet: ResultSet): ColDef[] => { ... }, [cellRenderer]);

  // Reverting to the more performant version of generateColumnDefs as per prior optimization
  const memoizedGenerateColumnDefs = useCallback((resultSet: ResultSet): ColDef[] => {
    if (!resultSet.columns || resultSet.columns.length === 0) return [];
    return resultSet.columns.map((columnName, index) => {
      const columnType = resultSet.column_types ? resultSet.column_types[index] : undefined;
      return {
        headerName: columnName,
        field: columnName,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 120,
        flex: 1,
        columnType,
        cellStyle: (params) => {
          if (highlightedColumn && (highlightedColumn === params.colDef.field || highlightedColumn === params.column.getColId())) {
            return { backgroundColor: 'rgba(25, 118, 210, 0.2)' };
          }
          return null;
        },
        cellRenderer
      };
    });
  }, [cellRenderer, highlightedColumn]); // Keeping highlightedColumn dependency for safety on cellStyle definition change.
  // While redrawRows should make closures work, explicit dependency ensures ColDef is new if style logic depends on highlightedColumn.
  // For maximum safety that AG Grid processes the change:
  // If generateColumnDefs depends on highlightedColumn, then AgGridReact gets new columnDefs, triggering update.
  // If it does NOT depend, useEffect must call api.redrawRows() which makes AG Grid call cellStyle.
  // Let's try with the dependency for max safety. Performance impact should be minimal as it's one state string.

  const onGridReady = useCallback((params: GridReadyEvent, tabId: string) => {
    setGridApis(prev => ({ ...prev, [tabId]: params.api }));
    setGridReady(prev => ({ ...prev, [tabId]: true }));
  }, []);

  const exportToCsv = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId];
    if (gridApi) {
      gridApi.exportDataAsCsv({ fileName: `query_result_${tabId}.csv` });
      toast.success('导出成功', { description: '数据已导出为CSV文件' });
    }
  }, [gridApis, toast]);

  const autoSizeColumns = useCallback(debounce((tabId: string) => {
    const gridApi = gridApis[tabId];
    if (gridApi) gridApi.autoSizeAllColumns(); // Uses autoSizeAllColumns as per original user code
  }, 100), [gridApis]);

  const gridOptions = useMemo(() => ({
    localeText: AG_GRID_LOCALE_CN,
    suppressMovableColumns: false,
    suppressColumnMoveAnimation: true,
    enableCellTextSelection: true,
    suppressMenuHide: true,
    animateRows: false,
    suppressScrollOnNewData: true,
    rowBuffer: 10,
  }), []);

  const getProcessedRowData = useCallback((resultSet: ResultSet) => resultSet.rows || [], []);

  if (isLoading) { /* ... loading JSX ... */
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="ml-3">加载中...</span>
      </div>
    )
  }
  if (!result || (!result.result_sets && !result.error) || (result.result_sets && result.result_sets.length === 0 && !result.error)) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <DatabaseIcon className="h-8 w-8 mr-3" />
        <span>没有查询结果</span>
      </div>
    )
  }
  if (result.error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive p-4">
        <XIcon className="h-8 w-8 mr-3" />
        <div className="flex flex-col">
          <span>查询出错:</span>
          <span className="text-sm">{result.error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden w-full max-w-full">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col overflow-hidden w-full max-w-full">
        <div className="flex-shrink-0 border-b">
          <div className="overflow-x-auto overflow-y-hidden px-3 max-w-full">
            <TabsList className="flex space-x-1 w-max min-w-0">
              {tabsData.map((tab) => ( /* ... TabsTrigger JSX ... */
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
          <TabsContent key={tab.id} value={tab.id} className="flex-1 overflow-hidden p-0 data-[state=inactive]:hidden">
            <div className="h-full flex flex-col">
              {/* Toolbar */}
              <div className="flex-shrink-0 p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 flex-wrap"> {/* ... Toolbar info JSX ... */}
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
                    <div className="flex items-center gap-2 ml-4">
                      <div className="relative">
                        <SearchIcon className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="搜索所有数据..."
                          className="pl-8 h-8 text-sm"
                          defaultValue={quickFilterText}
                          onChange={(e) => debouncedSetQuickFilter(e.target.value)}
                          aria-label="搜索所有数据"
                        />
                        {quickFilterText && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              debouncedSetQuickFilter('');
                              const inputElement = document.querySelector('input[placeholder="搜索所有数据..."]') as HTMLInputElement;
                              if (inputElement) inputElement.value = '';
                            }}
                            className="h-5 w-5 p-0 absolute right-2 top-1/2 transform -translate-y-1/2"
                            title="清除搜索"
                          > <XIcon className="h-3 w-3" /> </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <div className="relative">
                        <SearchIcon className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="查找列..."
                          className="pl-8 h-8 text-sm"
                          value={columnSearchText}
                          onChange={(e) => setColumnSearchText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') findAndHighlightColumn(tab.id); }}
                          aria-label="查找列"
                        />
                      </div>
                      <Button variant="outline" size="sm" className="h-8" onClick={() => findAndHighlightColumn(tab.id)} disabled={!columnSearchText}>查找</Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2"> {/* ... Toolbar buttons JSX ... */}
                    <Button variant="outline" size="sm" onClick={() => autoSizeColumns(tab.id)} disabled={!gridApis[tab.id] || !gridReady[tab.id]}>自适应列宽</Button>
                    <Button variant="outline" size="sm" onClick={() => exportToCsv(tab.id)} disabled={!gridApis[tab.id] || !gridReady[tab.id]}> <DownloadIcon className="h-4 w-4 mr-1" /> 导出CSV </Button>
                    {onClose && (
                      <Button variant="outline" size="sm" onClick={onClose}> <XIcon className="h-4 w-4 mr-1" /> 关闭 </Button>
                    )}
                  </div>
                </div>
              </div>
              {/* Grid content */}
              <div className="flex-1 overflow-hidden">
                {tab.resultSet.rows && tab.resultSet.rows.length > 0 ? (
                  <div className="relative h-full w-full">
                    {!gridReady[tab.id] && ( /* ... Loading overlay JSX ... */
                      <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                        <div className="flex items-center gap-2">
                          <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
                          <span className="text-sm text-muted-foreground">正在渲染表格...</span>
                        </div>
                      </div>
                    )}
                    {/* Corrected AG Grid theme application */}
                    <div className="ag-theme-quartz h-full w-full">
                      <AgGridReact
                        ref={gridRefs.current[tab.id]}
                        theme={myTheme}
                        gridOptions={gridOptions}
                        rowData={getProcessedRowData(tab.resultSet)}
                        columnDefs={memoizedGenerateColumnDefs(tab.resultSet)} // Use the memoized version
                        defaultColDef={{ sortable: true, filter: true, resizable: true, minWidth: 120, cellStyle: { fontSize: '14px' } }}
                        onGridReady={(params) => onGridReady(params, tab.id)}
                        enableCellTextSelection={gridOptions.enableCellTextSelection}
                        pagination={true} paginationPageSize={100} paginationPageSizeSelector={[50, 100, 200, 500]}
                        suppressPaginationPanel={false} ensureDomOrder={true} suppressRowHoverHighlight={false}
                        rowHeight={35} headerHeight={40} quickFilterText={quickFilterText} cacheQuickFilter={true}
                        suppressColumnMoveAnimation={gridOptions.suppressColumnMoveAnimation}
                        rowBuffer={gridOptions.rowBuffer}
                        suppressColumnVirtualisation={true}
                      />
                    </div>
                  </div>
                ) : tab.affectedRows !== undefined && tab.affectedRows > 0 ? ( /* ... Affected rows card JSX ... */
                  <div className="h-full flex items-center justify-center">
                    <Card className="w-96">
                      <CardHeader> <CardTitle className="flex items-center gap-2"> <CheckCircleIcon className="h-5 w-5 text-green-500" /> 操作完成 </CardTitle> </CardHeader>
                      <CardContent> <p className="text-center text-lg"> 成功影响了 <strong className="text-primary">{tab.affectedRows}</strong> 行数据 </p> </CardContent>
                    </Card>
                  </div>
                ) : ( /* ... No data message JSX ... */
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center"> <DatabaseIcon className="h-12 w-12 mx-auto mb-4 opacity-50" /> <p>查询执行成功，但没有返回数据</p> </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}, (prevProps, nextProps) => { /* ... Original React.memo comparison function ... */
  const prevResultSets = prevProps.result?.result_sets;
  const nextResultSets = nextProps.result?.result_sets;
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  if (prevProps.result === nextProps.result) return true;
  if (!prevProps.result || !nextProps.result) return false;
  if (prevProps.result.execution_time !== nextProps.result.execution_time) return false;
  const prevSets = prevProps.result.result_sets;
  const nextSets = nextProps.result.result_sets;
  if ((!prevSets && nextSets) || (prevSets && !nextSets)) return false;
  if (prevSets && nextSets) {
    if (prevSets.length !== nextSets.length) return false;
    // Optional: Deeper check for actual content changes if needed,
    // for (let i = 0; i < prevSets.length; i++) {
    //   if ((prevSets[i].rows?.length || 0) !== (nextSets[i].rows?.length || 0)) return false;
    //   if (prevSets[i].affected_rows !== nextSets[i].affected_rows) return false;
    // }
  } else if (!prevSets && !nextSets) { /* Both are null/undefined, so equal in this regard */ }
  else { return false; /* Should not be reached if logic is sound */ }
  return true;
});

ResultPanel.displayName = 'ResultPanel'
export default ResultPanel