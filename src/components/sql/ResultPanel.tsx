"use client"

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  TableIcon,
  DownloadIcon,
  InfoIcon,
  CheckCircleIcon,
  DatabaseIcon,
  XIcon,
  SearchIcon,
  ClockIcon,
  SettingsIcon,
  ZapIcon,
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

const calculateTextWidth = (text: string, config: ColumnWidthConfig): number => {
  if (!text || typeof text !== 'string') return 0;
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef\u3000-\u303f]/.test(char)) {
      width += config.chineseCharWidth;
    } else if (/[A-Z]/.test(char)) {
      width += config.baseCharWidth * 1.1;
    } else if (/\d/.test(char)) {
      width += config.baseCharWidth * 0.9;
    } else {
      width += config.baseCharWidth;
    }
  }
  return Math.ceil(width);
};

const calculateColumnWidth = (
  columnName: string,
  columnData: any[],
  config: ColumnWidthConfig = DEFAULT_CONFIG
): number => {
  const headerTextWidth = calculateTextWidth(columnName, config);
  const agGridUISpace = 70;
  const headerTotalWidth = headerTextWidth + agGridUISpace;

  if (!columnData || columnData.length === 0) {
    return Math.max(config.minWidth, Math.min(headerTotalWidth, config.maxWidth));
  }

  const sampleData = columnData.length > config.sampleSize
    ? [
      ...columnData.slice(0, Math.floor(config.sampleSize * 0.7)),
      ...columnData.slice(-Math.floor(config.sampleSize * 0.3))
    ]
    : columnData;

  let maxContentWidth = 0;
  for (const value of sampleData) {
    if (value === null || value === undefined) {
      const nullWidth = calculateTextWidth('NULL', config);
      maxContentWidth = Math.max(maxContentWidth, nullWidth);
      continue;
    }
    const textValue = String(value);
    const contentWidth = calculateTextWidth(textValue, config);
    maxContentWidth = Math.max(maxContentWidth, contentWidth);
  }

  const contentTotalWidth = maxContentWidth + config.padding;
  const finalWidth = Math.max(headerTotalWidth, contentTotalWidth);
  return Math.max(config.minWidth, Math.min(finalWidth, config.maxWidth));
};

const dateFormatter = (params: any) => {
  if (!params.value) return '';
  try {
    const date = new Date(params.value);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
    }
  } catch (e) { /* Return original value on error */ }
  return params.value;
};

const formatRowCount = (count: number): string => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count ? count.toString() : '0';
};

const NullCellRenderer = (params: any) => {
  if (params.value === null || params.value === undefined) {
    return (
      <span style={{ fontStyle: 'italic', color: '#999', backgroundColor: '#FFFFE0', }}>
        NULL
      </span>
    );
  }
  return params.value;
};

const DateCellRenderer = (params: any) => {
  if (params.value === null || params.value === undefined) {
    return <NullCellRenderer {...params} />;
  }
  return dateFormatter(params);
};

const CustomInnerHeader = React.memo((props: any) => {
  const { displayName, columnType } = props;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-medium truncate">{displayName}</span>
      <span className="text-xs text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded shrink-0">
        {columnType}
      </span>
    </div>
  );
});
CustomInnerHeader.displayName = 'CustomInnerHeader';


// --- 主组件 ---

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

  // --- 优化点 2: 使用 useMemo 缓存 tabsData 和 columnDefs ---
  const tabsData = useMemo(() => {
    if (!result?.result_sets) return [];

    const generateColumnDefs = (resultSet: ResultSet): ColDef[] => {
      if (!resultSet.columns || resultSet.columns.length === 0) return [];

      return resultSet.columns.map((columnName, index) => {
        const columnType = resultSet.column_types?.[index] || '';
        const columnData = resultSet.rows?.map(row => row[columnName]) || [];
        const isDateColumn = columnType === 'Datetime' || columnType === 'Datetimen';

        let calculatedWidth = calculateColumnWidth(columnName, columnData, DEFAULT_CONFIG);
        const typeTagWidth = calculateTextWidth(columnType, DEFAULT_CONFIG) + 20;
        // 确保列宽足以容纳列头文本和类型标签
        calculatedWidth = Math.max(calculatedWidth, calculateTextWidth(columnName, DEFAULT_CONFIG) + typeTagWidth + 70);

        return {
          headerName: columnName,
          field: columnName,
          width: calculatedWidth,
          minWidth: Math.max(DEFAULT_CONFIG.minWidth, 140),
          headerComponentParams: {
            innerHeaderComponent: CustomInnerHeader,
            innerHeaderComponentParams: {
              displayName: columnName,
              columnType: columnType
            }
          },
          cellRenderer: isDateColumn ? DateCellRenderer : NullCellRenderer,
        };
      });
    };

    return result.result_sets.map((resultSet, index) => ({
      id: `result-${index}`,
      title: `结果 ${index + 1}`,
      resultSet,
      rowCount: resultSet.rows?.length || 0,
      affectedRows: resultSet.affected_rows,
      columnDefs: generateColumnDefs(resultSet), // 在这里一次性计算并缓存
    }));
  }, [result]); // 依赖项是 result，只有 result 变化时才重新计算

  useEffect(() => {
    if (tabsData.length > 0 && !activeTab) {
      setActiveTab(tabsData[0].id);
    }
  }, [tabsData, activeTab]);

  const onGridReady = useCallback((params: GridReadyEvent, tabId: string) => {
    setGridApis(prev => ({ ...prev, [tabId]: params.api }));
  }, []);

  const exportToCsv = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId];
    if (gridApi) {
      const now = new Date();
      const timestamp = now.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(/[\s:]/g, '-');
      gridApi.exportDataAsCsv({ fileName: `query_result_${timestamp}.csv` });
      toast.success("导出成功", {
        description: "数据已导出为CSV文件。"
      });
    }
  }, [gridApis, toast]);

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
      // 使用 setTimeout 确保在 DOM 更新后执行
      setTimeout(() => gridApi.autoSizeAllColumns(), 0);
    }
  }, [gridApis]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="ml-3">加载中...</span>
      </div>
    )
  }

  if (!tabsData || tabsData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <DatabaseIcon className="h-8 w-8 mr-3" />
        <span>没有查询结果</span>
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
                        返回 <strong>{tab.rowCount.toLocaleString()}</strong> 行数据
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={!gridApis[tab.id]}>
                          <SettingsIcon className="h-4 w-4 mr-1" />
                          操作
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem
                          onClick={() => autoSizeColumns(tab.id)}
                          disabled={!gridApis[tab.id]}
                        >
                          <ZapIcon className="h-4 w-4 mr-2" />
                          自适应列宽
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => exportToCsv(tab.id)}
                          disabled={!gridApis[tab.id]}
                        >
                          <DownloadIcon className="h-4 w-4 mr-2" />
                          导出CSV
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                {tab.resultSet.error ? (
                  <div className="h-full flex items-center justify-center text-destructive p-4">
                    <XIcon className="h-8 w-8 mr-3" />
                    <div className="flex flex-col">
                      <span>查询出错:</span>
                      <span className="text-sm">{tab.resultSet.error}</span>
                    </div>
                  </div>
                ) : tab.resultSet.columns && tab.resultSet.columns.length > 0 ? (
                  <div className="ag-theme-quartz h-full w-full">
                    <AgGridReact
                      theme={theme}
                      localeText={AG_GRID_LOCALE_CN}
                      rowData={tab.resultSet.rows || []}
                      columnDefs={tab.columnDefs} // <-- 使用缓存的列定义
                      defaultColDef={{
                        sortable: true,
                        filter: true,
                        resizable: true,
                        minWidth: DEFAULT_CONFIG.minWidth,
                      }}
                      onGridReady={(params) => onGridReady(params, tab.id)}
                      animateRows={false}
                      pagination={true}
                      paginationPageSize={100}
                      paginationPageSizeSelector={[50, 100, 200, 500]}
                      enableCellTextSelection={true}
                      ensureDomOrder={true}
                      rowHeight={35}
                      headerHeight={40}
                      quickFilterText={quickFilterText}
                      suppressScrollOnNewData={true}
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
                    </Card>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <DatabaseIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>查询完成</p>
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

// --- 优化点 3: 包装整个组件 ---
ResultPanel.displayName = 'ResultPanel'
export default React.memo(ResultPanel);