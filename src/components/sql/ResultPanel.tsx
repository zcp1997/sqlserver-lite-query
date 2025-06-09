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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
  ChevronDownIcon,
  ColumnsIcon,
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
  maxWidth: 500,
  baseCharWidth: 9,
  chineseCharWidth: 18,
  padding: 32,
  sampleSize: 100
};

// 性能监控工具
const performanceMonitor = {
  measureRenderTime: (label: string) => {
    const startMark = `${label}-start`;
    const endMark = `${label}-end`;
    performance.mark(startMark);

    return () => {
      performance.mark(endMark);
      performance.measure(label, startMark, endMark);

      const measure = performance.getEntriesByName(label)[0];
      if (measure) {
        console.log(`${label}: ${measure.duration.toFixed(2)}ms`);
        if (measure.duration > 1000) {
          console.warn(`${label} is slow (${measure.duration.toFixed(2)}ms), consider optimization`);
        }
      }
    };
  }
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
  columnType: string = '',
  config: ColumnWidthConfig = DEFAULT_CONFIG
): number => {
  // 计算列名宽度
  const columnNameWidth = calculateTextWidth(columnName, config);

  // 计算类型标签宽度（包括背景、padding、rounded等样式空间）
  const columnTypeWidth = columnType ? calculateTextWidth(columnType, config) + 24 : 0; // 24px for padding + background

  // 计算标签间的间距（gap-2 = 8px）
  const gapWidth = columnType ? 8 : 0;

  // AG-Grid UI 元素空间（排序图标、过滤器图标等）
  const agGridUISpace = 50;

  // 总的列头宽度
  const headerTotalWidth = columnNameWidth + columnTypeWidth + gapWidth + agGridUISpace;

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

// 轻量级 Cell Renderer（支持选中状态）
const LightweightCellRenderer = React.memo((params: any) => {
  if (params.value == null) {
    return <span className="ag-cell-null">NULL</span>;
  }
  return <span className="ag-cell-value">{params.value}</span>;
}, (prevProps, nextProps) => {
  return prevProps.value === nextProps.value;
});
LightweightCellRenderer.displayName = 'LightweightCellRenderer';

// 优化的日期 Cell Renderer
const OptimizedDateCellRenderer = React.memo((params: any) => {
  if (params.value == null) {
    return <span className="ag-cell-null">NULL</span>;
  }

  // 缓存日期格式化结果
  const formatted = useMemo(() => {
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
    } catch (e) { /* ignore */ }
    return params.value;
  }, [params.value]);

  return <span className="ag-cell-date">{formatted}</span>;
}, (prevProps, nextProps) => {
  return prevProps.value === nextProps.value;
});
OptimizedDateCellRenderer.displayName = 'OptimizedDateCellRenderer';

const formatRowCount = (count: number): string => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count ? count.toString() : '0';
};

// 生成简洁的 Tab 标题提示（优化显示宽度）
const generateTabTitle = (tab: any): string => {
  // 根据内容动态调整标题长度
  const maxTitleLength = 22;
  let baseTitle = tab.title;
  
  // 如果标题过长，进行智能截断
  if (baseTitle.length > maxTitleLength) {
    // 优先保留前面的关键信息
    baseTitle = `${baseTitle.substring(0, maxTitleLength - 3)}...`;
  }
  
  if (tab.affectedRows !== undefined) {
    const formattedCount = formatRowCount(tab.affectedRows);
    return `${baseTitle} | ${formattedCount} 行受影响`;
  } else {
    const formattedCount = formatRowCount(tab.rowCount);
    return `${baseTitle} | ${formattedCount} 行数据`;
  }
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

// 主组件
const ResultPanel: React.FC<ResultPanelProps> = ({ result, isLoading = false, onClose }) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<string>('');
  const [gridApis, setGridApis] = useState<Record<string, GridApi>>({});
  const [quickFilterText, setQuickFilterText] = useState('');
  const [columnSearchOpen, setColumnSearchOpen] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [optimizedTabs, setOptimizedTabs] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<{ rowIndex: number, colId: string, colIndex: number, value: any } | null>(null);
  const { resolvedTheme } = useTheme();
  const quickFilterTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const theme = resolvedTheme === "dark"
    ? themeQuartz.withPart(colorSchemeDark)
    : themeQuartz.withPart(colorSchemeLightWarm);

  // 异步列宽计算器（带缓存）
  const calculateColumnWidthAsync = useMemo(() => {
    const widthCache = new Map<string, number>();

    return async (
      columnName: string,
      columnData: any[],
      columnType: string = '',
      config: ColumnWidthConfig = DEFAULT_CONFIG
    ): Promise<number> => {
      const cacheKey = `${columnName}-${columnType}-${columnData.length}-${JSON.stringify(config)}`;
      if (widthCache.has(cacheKey)) {
        return widthCache.get(cacheKey)!;
      }

      return new Promise((resolve) => {
        const calculate = () => {
          const width = calculateColumnWidth(columnName, columnData, columnType, config);
          widthCache.set(cacheKey, width);
          resolve(width);
        };

        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(calculate);
        } else {
          setTimeout(calculate, 0);
        }
      });
    };
  }, []);

  // 生成基础列定义（快速渲染）
  const generateBasicColumnDefs = useCallback((resultSet: ResultSet): ColDef[] => {
    if (!resultSet.columns || resultSet.columns.length === 0) return [];

    return resultSet.columns.map((columnName, index) => {
      const columnType = resultSet.column_types?.[index] || '';
      const isDateColumn = columnType === 'Datetime' || columnType === 'Datetimen';

      return {
        headerName: columnName,
        field: columnName,
        width: 150, // 固定初始宽度
        minWidth: Math.max(DEFAULT_CONFIG.minWidth, 140),
        headerComponentParams: {
          innerHeaderComponent: CustomInnerHeader,
          innerHeaderComponentParams: {
            displayName: columnName,
            columnType: columnType
          }
        },
        cellRenderer: isDateColumn ? OptimizedDateCellRenderer : LightweightCellRenderer,
        suppressKeyboardEvent: () => false,
        suppressMovable: false,
        // 用 context 存储自定义索引
        context: { columnIndex: index },
      };
    });
  }, []);

  // 延迟加载的 tabsData
  const tabsData = useMemo(() => {
    const endMeasure = performanceMonitor.measureRenderTime('tabs-data-generation');

    if (!result?.result_sets) {
      endMeasure();
      return [];
    }

    const tabs = result.result_sets.map((resultSet, index) => ({
      id: `result-${index}`,
      title: `结果 ${index + 1}`,
      resultSet,
      rowCount: resultSet.rows?.length || 0,
      affectedRows: resultSet.affected_rows,
      columnDefs: generateBasicColumnDefs(resultSet),
      needsOptimization: true,
    }));

    endMeasure();
    return tabs;
  }, [result, generateBasicColumnDefs]);

  // 异步优化列定义
  const optimizeColumnDefinitions = useCallback(async (tabId: string) => {
    const tabData = tabsData.find(tab => tab.id === tabId);
    if (!tabData?.needsOptimization || optimizedTabs.has(tabId)) return;
    const endMeasure = performanceMonitor.measureRenderTime(`column-optimization-${tabId}`);
    const gridApi = gridApis[tabId];
    if (!gridApi || gridApi.isDestroyed?.()) return;
    const columns = tabData.resultSet.columns || [];
    const batchSize = 10;
    for (let i = 0; i < columns.length; i += batchSize) {
      const batch = columns.slice(i, i + batchSize);
      await new Promise(resolve => requestAnimationFrame(resolve));
      const optimizedColumns = await Promise.all(
        batch.map(async (columnName, batchIndex) => {
          const globalIndex = i + batchIndex;
          const columnData = tabData.resultSet.rows?.map(row => row[columnName]) || [];
          const columnType = tabData.resultSet.column_types?.[i + batchIndex] || '';
          const width = await calculateColumnWidthAsync(columnName, columnData, columnType);
          return { columnName, width, index: globalIndex };
        })
      );
      try {
        if (gridApi.isDestroyed?.()) return;
        const columnState = gridApi.getColumnState();
        const updatedColumns = columnState.map(col => {
          const optimized = optimizedColumns.find(opt => opt.columnName === col.colId);
          return optimized ? { ...col, width: optimized.width } : col;
        });
        gridApi.applyColumnState({ state: updatedColumns });
      } catch (error) {
        if (gridApi.isDestroyed?.()) return;
        gridApi.autoSizeAllColumns();
      }
    }
    setOptimizedTabs(prev => new Set([...prev, tabId]));
    endMeasure();
  }, [tabsData, gridApis, optimizedTabs, calculateColumnWidthAsync]);

  useEffect(() => {
    if (tabsData.length > 0 && !activeTab) {
      setActiveTab(tabsData[0].id);
    }
  }, [tabsData, activeTab]);

  useEffect(() => {
    setSelectedColumn('');
    setColumnSearchOpen(false);
    
    // 🔥 简单解决方案：每次切换tab时，清除该tab的优化状态，强制重新计算
    if (activeTab) {
      setOptimizedTabs(prev => {
        const newSet = new Set(prev);
        newSet.delete(activeTab);
        return newSet;
      });
    }
  }, [activeTab]);

  // 在网格就绪后异步优化
  useEffect(() => {
    if (activeTab && gridApis[activeTab]) {
      // 延迟一点时间再优化，让网格先渲染
      const timer = setTimeout(() => {
        optimizeColumnDefinitions(activeTab);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [activeTab, gridApis, optimizeColumnDefinitions]);

  const onGridReady = useCallback((params: GridReadyEvent, tabId: string) => {
    const endMeasure = performanceMonitor.measureRenderTime(`grid-ready-${tabId}`);
    setGridApis(prev => ({ ...prev, [tabId]: params.api }));
    endMeasure();
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

  const handleQuickFilterChange = useCallback((value: string) => {
    if (quickFilterTimeoutRef.current) {
      clearTimeout(quickFilterTimeoutRef.current);
    }
    quickFilterTimeoutRef.current = setTimeout(() => {
      setQuickFilterText(value);
    }, 300);
  }, []);

  const autoSizeColumns = useCallback((tabId: string) => {
    const gridApi = gridApis[tabId];
    if (gridApi && !gridApi.isDestroyed?.()) {
      setTimeout(() => gridApi.autoSizeAllColumns(), 0);
    }
  }, [gridApis]);

  const scrollToColumn = useCallback((columnName: string) => {
    const gridApi = gridApis[activeTab];
    if (gridApi && !gridApi.isDestroyed?.() && columnName) {
      try {
        gridApi.ensureColumnVisible(columnName);
        gridApi.setFocusedCell(0, columnName);
        setSelectedColumn(columnName);
        setColumnSearchOpen(false);
        toast.success("列跳转成功", {
          description: `已定位到列 "${columnName}"`,
        });
      } catch (error) {
        toast.error("跳转失败", {
          description: "未找到指定列",
        });
      }
    }
  }, [gridApis, activeTab, toast]);

  // 创建选中覆盖层
  const createSelectionOverlay = useCallback((rowIndex: number, colId: string) => {
    const existingOverlay = document.querySelector('.ag-cell-selection-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
    const gridApi = gridApis[activeTab];
    if (!gridApi || gridApi.isDestroyed?.()) return;
    const cellElement = document.querySelector(`[row-index="${rowIndex}"][col-id="${colId}"]`);
    if (!cellElement) return;

    // 创建覆盖层
    const overlay = document.createElement('div');
    overlay.className = 'ag-cell-selection-overlay';

    // 获取单元格的位置和大小
    const cellRect = cellElement.getBoundingClientRect();
    const gridContainer = document.querySelector('.ag-theme-quartz') as HTMLElement;
    const gridRect = gridContainer?.getBoundingClientRect();

    if (!gridRect || !gridContainer) return;

    // 设置覆盖层样式和位置
    overlay.style.cssText = `
      position: absolute;
      top: ${cellRect.top - gridRect.top}px;
      left: ${cellRect.left - gridRect.left}px;
      width: ${cellRect.width}px;
      height: ${cellRect.height}px;
      background-color: rgba(59, 130, 246, 0.2);
      border: 2px solid #3b82f6;
      box-sizing: border-box;
      pointer-events: none;
      z-index: 10;
    `;

    // 将覆盖层添加到网格容器中
    gridContainer.style.position = 'relative';
    gridContainer.appendChild(overlay);
  }, [gridApis, activeTab]);

  // 单元格点击处理函数
  const onCellClicked = useCallback((event: any) => {
    const { rowIndex, colDef, value } = event;
    // 通过 context 获取列索引
    const colIndex = colDef.context?.columnIndex ?? -1;
    setSelectedCell({
      rowIndex,
      colId: colDef.field,
      colIndex,
      value
    });
    createSelectionOverlay(rowIndex, colDef.field);
  }, [createSelectionOverlay]);

  // 复制单元格内容到剪贴板
  const copySelectedCell = useCallback(async () => {
    if (!selectedCell) {
      toast.error("复制失败", { description: "请先选择一个单元格" });
      return;
    }

    try {
      const textToCopy = selectedCell.value === null || selectedCell.value === undefined
        ? 'NULL'
        : String(selectedCell.value);

      await navigator.clipboard.writeText(textToCopy);
      toast.success("复制成功", {
        description: `已复制单元格内容: ${textToCopy.length > 50 ? textToCopy.substring(0, 50) + '...' : textToCopy}`
      });
    } catch (error) {
      toast.error("复制失败", { description: "无法访问剪贴板" });
    }
  }, [selectedCell, toast]);

  // 键盘事件监听
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 检查是否按下了 Ctrl+C (Windows/Linux) 或 Cmd+C (Mac)
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        // 检查焦点是否在表格区域内
        const activeElement = document.activeElement;
        const agGridContainer = activeElement?.closest('.ag-theme-quartz');

        if (agGridContainer && selectedCell) {
          event.preventDefault();
          copySelectedCell();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [copySelectedCell, selectedCell]);

  // 清除选中覆盖层
  const clearSelectionOverlay = useCallback(() => {
    const existingOverlay = document.querySelector('.ag-cell-selection-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }
  }, []);

  // 当切换标签时清空选中的单元格和覆盖层
  useEffect(() => {
    setSelectedCell(null);
    clearSelectionOverlay();
  }, [activeTab, clearSelectionOverlay]);

  // 监听滚动事件，滚动时更新覆盖层位置或清除
  useEffect(() => {
    const handleScroll = () => {
      if (selectedCell) {
        // 重新创建覆盖层以更新位置
        setTimeout(() => {
          createSelectionOverlay(selectedCell.rowIndex, selectedCell.colId);
        }, 0);
      }
    };

    const gridContainer = document.querySelector('.ag-theme-quartz');
    if (gridContainer) {
      gridContainer.addEventListener('scroll', handleScroll);
      return () => {
        gridContainer.removeEventListener('scroll', handleScroll);
      };
    }
  }, [selectedCell, createSelectionOverlay]);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      // 更新选中单元格覆盖层位置
      if (selectedCell) {
        setTimeout(() => {
          createSelectionOverlay(selectedCell.rowIndex, selectedCell.colId);
        }, 100);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [selectedCell, createSelectionOverlay]);

  const activeTabColumns = useMemo(() => {
    const activeTabData = tabsData.find(tab => tab.id === activeTab);
    if (!activeTabData?.resultSet.columns) return [];

    return activeTabData.resultSet.columns.map((columnName, index) => ({
      name: columnName,
      type: activeTabData.resultSet.column_types?.[index] || '未知类型'
    }));
  }, [tabsData, activeTab]);

  // 优化：AG-Grid 默认配置
  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: DEFAULT_CONFIG.minWidth,
    suppressKeyboardEvent: () => false,
    suppressMovable: false,
  }), []);

  // 优化：AG-Grid 配置
  const gridOptions = useMemo(() => ({
    animateRows: false,
    suppressScrollOnNewData: true,
    suppressColumnVirtualisation: false,
    suppressRowVirtualisation: false,
    rowBuffer: 10,
    viewportRowModelPageSize: 100,
    viewportRowModelBufferSize: 100,
    pagination: true,
    paginationPageSize: 100,
    paginationPageSizeSelector: [20, 50, 100, 200],
    rowHeight: 35,
    headerHeight: 40,
    ensureDomOrder: true,
    suppressMovableColumns: false,
    onCellClicked: onCellClicked,
  }), [onCellClicked]);

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
                  className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 ease-in-out data-[state=active]:bg-primary data-[state=active]:text-primary-foreground hover:bg-muted whitespace-nowrap flex-shrink-0 min-w-[140px] max-w-[200px]"
                  title={generateTabTitle(tab)}
                >
                  <TableIcon className="h-4 w-4 flex-shrink-0" />
                  <span className="text-sm truncate min-w-0 max-w-[100px]">{tab.title}</span>
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
                      {/* {optimizedTabs.has(tab.id) && (
                          <Badge variant="outline" className="text-xs">
                            已优化
                          </Badge>
                        )} */}
                      {selectedCell && (
                        <Badge variant="secondary" className="text-xs">
                          已选中单元格(第{selectedCell.rowIndex + 1}行,第{selectedCell.colIndex >= 0 ? selectedCell.colIndex + 1 : '?'}列)
                        </Badge>
                      )}
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
                      <Popover open={columnSearchOpen} onOpenChange={setColumnSearchOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 min-w-[140px] justify-between text-sm"
                            disabled={activeTabColumns.length === 0}
                            aria-label="跳转到指定列"
                            title={selectedColumn ? `当前选中: ${selectedColumn}，点击重新选择列` : "点击选择要跳转的列"}
                          >
                            <div className="flex items-center gap-1">
                              <ColumnsIcon className="h-4 w-4" />
                              <span className="truncate">
                                {selectedColumn || "跳转到列"}
                              </span>
                            </div>
                            <ChevronDownIcon className="h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-0" align="start">
                          <Command
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setColumnSearchOpen(false);
                              }
                            }}
                          >
                            <CommandInput
                              placeholder="输入列名快速定位..."
                              className="h-9"
                            />
                            <CommandList className="max-h-[200px]">
                              <CommandEmpty>未找到匹配的列名</CommandEmpty>
                              <CommandGroup heading="选择列名快速跳转到表格位置">
                                {activeTabColumns.map((column) => (
                                  <CommandItem
                                    key={column.name}
                                    value={column.name}
                                    onSelect={() => scrollToColumn(column.name)}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <ColumnsIcon className="h-4 w-4" />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium truncate">{column.name}</div>
                                      <div className="text-xs text-muted-foreground">{column.type}</div>
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
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
                  <div
                    className="ag-theme-quartz h-full w-full"
                    style={{
                      contain: 'layout style paint',
                      willChange: 'transform'
                    }}
                  >
                    <AgGridReact
                      theme={theme}
                      localeText={AG_GRID_LOCALE_CN}
                      rowData={tab.resultSet.rows || []}
                      columnDefs={tab.columnDefs}
                      defaultColDef={defaultColDef}
                      onGridReady={(params) => onGridReady(params, tab.id)}
                      quickFilterText={quickFilterText}
                      {...gridOptions}
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
                        <p className="text-sm text-muted-foreground">
                          影响了 {tab.affectedRows} 行数据
                        </p>
                      </CardContent>
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

ResultPanel.displayName = 'ResultPanel'
export default React.memo(ResultPanel);