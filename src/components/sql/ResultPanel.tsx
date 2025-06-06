"use client"

import React, { useState, useEffect, useRef, useCallback } from 'react'
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
  XIcon,
  SearchIcon,
  ClockIcon
} from 'lucide-react'
import { useTheme } from "next-themes"

ModuleRegistry.registerModules([AllCommunityModule]);

interface ResultPanelProps {
  result: QueryResult
  isLoading?: boolean
  onClose?: () => void
}

// 列宽计算配置
interface ColumnWidthConfig {
  minWidth: number;
  maxWidth: number;
  baseCharWidth: number;
  chineseCharWidth: number;
  padding: number;
  sampleSize: number;
}

const DEFAULT_CONFIG: ColumnWidthConfig = {
  minWidth: 80,
  maxWidth: 350,
  baseCharWidth: 9,     // 稍微增加英文字符宽度，更准确
  chineseCharWidth: 18, // 增加中文字符宽度，考虑字体渲染
  padding: 32,          // 增加padding，包含排序图标等UI元素的空间
  sampleSize: 100
};

// 计算文本显示宽度（支持中英文混合）
const calculateTextWidth = (text: string, config: ColumnWidthConfig): number => {
  if (!text || typeof text !== 'string') return 0;
  
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    // 更精确的中文字符判断，包括中文标点符号
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef\u3000-\u303f]/.test(char)) {
      width += config.chineseCharWidth;
    } else if (/[A-Z]/.test(char)) {
      // 大写字母通常比小写字母宽一些
      width += config.baseCharWidth * 1.1;
    } else if (/\d/.test(char)) {
      // 数字字符通常比字母稍窄
      width += config.baseCharWidth * 0.9;
    } else {
      width += config.baseCharWidth;
    }
  }
  return Math.ceil(width); // 向上取整，确保不会截断
};

// 计算单列最适宜宽度
const calculateColumnWidth = (
  columnName: string, 
  columnData: any[], 
  config: ColumnWidthConfig = DEFAULT_CONFIG
): number => {
  // 1. 计算列头宽度
  const headerTextWidth = calculateTextWidth(columnName, config);
  
  // 2. 为AG Grid的UI元素预留额外空间
  // - 排序图标: ~20px
  // - 筛选按钮: ~20px  
  // - 列调整手柄: ~10px
  // - 内边距: ~20px
  const agGridUISpace = 70; // AG Grid UI元素总占用空间
  const headerTotalWidth = headerTextWidth + agGridUISpace;
  
  // 3. 如果没有数据，基于列头宽度返回
  if (!columnData || columnData.length === 0) {
    return Math.max(config.minWidth, Math.min(headerTotalWidth, config.maxWidth));
  }
  
  // 4. 采样数据以提高性能
  const sampleData = columnData.length > config.sampleSize 
    ? [
        ...columnData.slice(0, Math.floor(config.sampleSize * 0.7)),
        ...columnData.slice(-Math.floor(config.sampleSize * 0.3))
      ]
    : columnData;
  
  // 5. 计算内容的最大宽度
  let maxContentWidth = 0;
  for (const value of sampleData) {
    if (value === null || value === undefined) {
      // NULL 值显示为 "NULL"，也需要计算宽度
      const nullWidth = calculateTextWidth('NULL', config);
      maxContentWidth = Math.max(maxContentWidth, nullWidth);
      continue;
    }
    
    const textValue = String(value);
    const contentWidth = calculateTextWidth(textValue, config);
    maxContentWidth = Math.max(maxContentWidth, contentWidth);
  }
  
  // 6. 内容宽度也需要加上基本的单元格padding
  const contentTotalWidth = maxContentWidth + config.padding;
  
  // 7. 取列头和内容宽度的最大值
  const finalWidth = Math.max(headerTotalWidth, contentTotalWidth);
  
  // 8. 限制在最小和最大宽度范围内
  return Math.max(config.minWidth, Math.min(finalWidth, config.maxWidth));
};

// 简化的单元格渲染器
const nullCellRenderer = (params: any) => {
  if (params.value === null || params.value === undefined) {
    return <span style={{ color: '#999', fontStyle: 'italic' }}>NULL</span>;
  }
  return params.value;
};

// 日期格式化器
const dateFormatter = (params: any) => {
  if (!params.value) return '';
  try {
    const date = new Date(params.value);
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
  return params.value;
};

// 格式化行数显示
const formatRowCount = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`
  }
  return count.toString()
};

const ResultPanel: React.FC<ResultPanelProps> = ({ result, isLoading = false, onClose }) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('');
  const [gridApis, setGridApis] = useState<Record<string, GridApi>>({});
  const [quickFilterText, setQuickFilterText] = useState('');
  const { resolvedTheme } = useTheme();
  const quickFilterTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const theme = resolvedTheme === "dark"
    ? themeQuartz.withPart(colorSchemeDark)
    : themeQuartz.withPart(colorSchemeLightWarm);

  const tabsData = result?.result_sets?.map((resultSet, index) => ({
    id: `result-${index}`,
    title: `结果 ${index + 1}`,
    resultSet,
    rowCount: resultSet.rows?.length || 0,
    affectedRows: resultSet.affected_rows
  })) || [];

  useEffect(() => {
    if (tabsData.length > 0 && !activeTab) {
      setActiveTab(tabsData[0].id);
    }
  }, [tabsData.length]);

  // 生成带有自动宽度的列定义
  const generateColumnDefs = useCallback((resultSet: ResultSet): ColDef[] => {
    if (!resultSet.columns || resultSet.columns.length === 0) return [];

    // 计算每列的最适宜宽度
    const columnWidths: Record<string, number> = {};
    
    for (let i = 0; i < resultSet.columns.length; i++) {
      const columnName = resultSet.columns[i];
      const columnData = resultSet.rows?.map(row => row[columnName]) || [];
      const calculatedWidth = calculateColumnWidth(columnName, columnData, DEFAULT_CONFIG);
      columnWidths[columnName] = calculatedWidth;
    }

    return resultSet.columns.map((columnName, index) => {
      const columnType = resultSet.column_types?.[index];
      const isDateColumn = columnType === 'Datetime' || columnType === 'Datetimen';
      const calculatedWidth = columnWidths[columnName];
      
      return {
        headerName: columnName,
        field: columnName,
        sortable: true,
        filter: true,
        resizable: true,
        width: calculatedWidth, // 使用计算出的宽度
        minWidth: DEFAULT_CONFIG.minWidth,
        //maxWidth: DEFAULT_CONFIG.maxWidth,
        valueFormatter: isDateColumn ? dateFormatter : undefined,
        cellRenderer: nullCellRenderer,
        suppressSizeToFit: false,
      };
    });
  }, []);

  const onGridReady = (params: GridReadyEvent, tabId: string) => {
    setGridApis(prev => ({ ...prev, [tabId]: params.api }));
  };

  const exportToCsv = (tabId: string) => {
    const gridApi = gridApis[tabId];
    if (gridApi) {
      gridApi.exportDataAsCsv({ fileName: `query_result_${tabId}.csv` });
      toast.success('导出成功', { description: '数据已导出为CSV文件' });
    }
  };

  const handleQuickFilterChange = (value: string) => {
    if (quickFilterTimeoutRef.current) {
      clearTimeout(quickFilterTimeoutRef.current);
    }
    quickFilterTimeoutRef.current = setTimeout(() => {
      setQuickFilterText(value);
    }, 300);
  };

  const autoSizeColumns = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId];
    if (gridApi) {
      setTimeout(() => gridApi.autoSizeAllColumns(), 0);
    }
  }, [gridApis]);

  // 重新计算列宽（手动触发）
  const recalculateColumnWidths = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId];
    if (gridApi) {
      const tab = tabsData.find(t => t.id === tabId);
      if (tab) {
        const newColumnDefs = generateColumnDefs(tab.resultSet);
        gridApi.setGridOption('columnDefs', newColumnDefs);
        toast.success('列宽已重新计算');
      }
    }
  }, [gridApis, tabsData, generateColumnDefs, toast]);

  if (isLoading) {
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
              {tabsData.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 ease-in-out data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-muted whitespace-nowrap flex-shrink-0 min-w-0"
                  title={`${tab.title} - ${tab.affectedRows !== undefined ? `${tab.affectedRows} 行受影响` : `${tab.rowCount} 行数据`}`}
                >
                  <TableIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm truncate min-w-0">{tab.title}</span>
                  {tab.affectedRows !== undefined ? (
                    <Badge variant="secondary" className="ml-1 flex-shrink-0 text-xs px-1.5 py-0.5">
                      {formatRowCount(tab.affectedRows)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-1 flex-shrink-0 text-xs px-1.5 py-0.5">
                      {formatRowCount(tab.rowCount)}
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
              <div className="flex-shrink-0 p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <InfoIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {tab.affectedRows !== undefined ? (
                          <>影响了 <strong>{tab.affectedRows.toLocaleString()}</strong> 行</>
                        ) : (
                          <>返回 <strong>{tab.rowCount.toLocaleString()}</strong> 行数据</>
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
                    <div className="flex items-center gap-2 ml-4">
                      <div className="relative">
                        <SearchIcon className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="搜索所有数据..."
                          className="pl-8 h-8 text-sm"
                          onChange={(e) => handleQuickFilterChange(e.target.value)}
                          aria-label="搜索所有数据"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => recalculateColumnWidths(tab.id)} 
                      disabled={!gridApis[tab.id]}
                      title="基于内容重新计算最适宜的列宽"
                    >
                      智能调整列宽
                    </Button>
                    {/* <Button variant="outline" size="sm" onClick={() => autoSizeColumns(tab.id)} disabled={!gridApis[tab.id]}>
                      自适应列宽
                    </Button> */}
                    <Button variant="outline" size="sm" onClick={() => exportToCsv(tab.id)} disabled={!gridApis[tab.id]}>
                      <DownloadIcon className="h-4 w-4 mr-1" />
                      导出CSV
                    </Button>
                    {onClose && (
                      <Button variant="outline" size="sm" onClick={onClose}>
                        <XIcon className="h-4 w-4 mr-1" />
                        关闭
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                {tab.resultSet.rows && tab.resultSet.rows.length > 0 ? (
                  <div className="ag-theme-quartz h-full w-full">
                    <AgGridReact
                      theme={theme}
                      localeText={AG_GRID_LOCALE_CN}
                      rowData={tab.resultSet.rows}
                      columnDefs={generateColumnDefs(tab.resultSet)}
                      defaultColDef={{
                        sortable: true,
                        filter: true,
                        resizable: true,
                        minWidth: DEFAULT_CONFIG.minWidth,
                      }}
                      onGridReady={(params) => onGridReady(params, tab.id)}
                      animateRows={false}
                      rowBuffer={10}
                      debounceVerticalScrollbar={true}
                      suppressColumnVirtualisation={false}
                      suppressRowVirtualisation={false}
                      pagination={true}
                      paginationPageSize={100}
                      paginationPageSizeSelector={[50, 100, 200, 500]}
                      enableCellTextSelection={true}
                      ensureDomOrder={true}
                      rowHeight={35}
                      headerHeight={40}
                      quickFilterText={quickFilterText}
                      suppressScrollOnNewData={true}
                      suppressMovableColumns={false}
                      suppressMenuHide={true}
                    />
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
};

ResultPanel.displayName = 'ResultPanel'
export default ResultPanel