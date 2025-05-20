"use client"

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  DownloadIcon, 
  CopyIcon, 
  SearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MaximizeIcon,
  MinimizeIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from 'lucide-react'
import { QueryResult, ResultSet } from '@/types/database'
import { useToast } from "@/hooks/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface ResultPanelProps {
  result: QueryResult
  isLoading?: boolean
}

export default function ResultPanel({ result, isLoading = false }: ResultPanelProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 100
  // 恢复拉伸表格选项
  const [isFullWidth, setIsFullWidth] = useState(false)
  // 当前活动的结果集索引
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  // 列高亮
  const [highlightedColumn, setHighlightedColumn] = useState<string | null>(null)
  // 选中的单元格
  const [selectedCells, setSelectedCells] = useState<{rowIndex: number, colIndex: number}[]>([])
  // 字体大小
  const [fontSize, setFontSize] = useState(14) // 默认字体大小

  const { toast } = useToast()
  const tableRef = useRef<HTMLTableElement>(null)

  // 确保result.resultSets存在且不为空
  if (!result.result_sets || result.result_sets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-muted-foreground">
        无有效结果集数据
      </div>
    )
  }

  // 获取当前活动的结果集
  const activeResultSet = result.result_sets[activeResultIndex] || result.result_sets[0]
  
  // 确保activeResultSet.rows存在
  if (!activeResultSet.rows) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-muted-foreground">
        结果集中没有行数据
      </div>
    )
  }
  
  // 过滤行
  const filteredRows = activeResultSet.rows.filter((row) => {
    if (!searchTerm.trim()) return true
    
    // 在所有列中搜索
    return Object.values(row).some((value) => {
      if (value === null) return false
      return String(value).toLowerCase().includes(searchTerm.toLowerCase())
    })
  })
  
  // 分页
  const totalPages = Math.ceil(filteredRows.length / pageSize)
  const paginatedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  
  // 确保activeResultSet.columns存在
  const columns = activeResultSet.columns || []
  
  // 复制单元格内容并显示提示
  const copyToClipboard = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success('内容已复制')
      console.log('内容已复制:', content)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }
  
  // 复制当前行
  const copyRow = async (row: Record<string, any>) => {
    try {
      const values = Object.values(row).map(v => v === null ? '' : String(v))
      await navigator.clipboard.writeText(values.join('\t'))
      toast.success('行内容已复制')
    } catch (err) {
      console.error('复制行失败:', err)
    }
  }
  
  // 导出CSV
  const exportToCSV = () => {
    try {
      const headers = columns.join(',');
      const csvRows = activeResultSet.rows.map(row => {
        return columns.map(col => {
          const val = row[col];
          if (val === null) return '';
          // 字符串值需要用引号包裹，并处理引号转义
          if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`
          return val;
        }).join(',')
      });
      
      const csvContent = [headers, ...csvRows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `query_result_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
      link.click();
      
      URL.revokeObjectURL(url);
      toast.success('CSV文件已导出');
    } catch (err) {
      console.error('导出CSV失败:', err);
      toast.error('导出CSV失败');
    }
  }
  
  // 翻页
  const goToPage = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
  }
  
  // 格式化单元格值显示
  const formatCellValue = (value: any): string => {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  
  // 计算每列的最佳宽度
  const calculateColumnWidths = () => {
    // 默认最小宽度
    const minWidth = 120;
    // 默认最大宽度，增大最大宽度以便更好地显示长文本
    const maxWidth = 500;
    
    // 如果没有列，返回空数组
    if (!columns.length) return [];
    
    // 计算每列的内容宽度
    return columns.map((column) => {
      // 计算标题宽度 (每个字符约12px)
      let width = column.length * 12;
      
      // 检查前15行数据中的值长度
      const rowsToCheck = Math.min(15, activeResultSet.rows.length);
      for (let i = 0; i < rowsToCheck; i++) {
        const val = formatCellValue(activeResultSet.rows[i][column]);
        // 估计字符宽度 (根据内容类型进行调整)
        // 中文字符和数字宽度不同，这里增加一些权重
        let valueWidth = 0;
        for (let j = 0; j < val.length; j++) {
          const char = val.charAt(j);
          // 中文字符和全角标点占用更多空间
          if (/[\u4e00-\u9fa5\uff00-\uffef]/.test(char)) {
            valueWidth += 14;
          } else {
            valueWidth += 8;
          }
        }
        width = Math.max(width, valueWidth);
      }
      
      // 确保在范围内并添加额外的内边距，为复制图标留出空间
      return Math.max(minWidth, Math.min(maxWidth, width + 30));
    });
  };
  
  const columnWidths = calculateColumnWidths();
  
  // 定位到指定列
  const scrollToColumn = (columnName: string) => {
    const colIndex = columns.findIndex(col => col.toLowerCase() === columnName.toLowerCase());
    if (colIndex === -1) {
      toast.error(`未找到列: ${columnName}`);
      return;
    }
    
    setHighlightedColumn(columnName);
    
    // 滚动到该列
    if (tableRef.current) {
      const table = tableRef.current;
      const headerCell = table.querySelector(`th[data-column="${columnName}"]`);
      if (headerCell) {
        headerCell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  };
  
  // 处理单元格点击，支持多选
  const handleCellClick = (rowIndex: number, colIndex: number, event: React.MouseEvent) => {
    // 如果按住Ctrl键，添加到选择
    if (event.ctrlKey || event.metaKey) {
      setSelectedCells(prev => [...prev, { rowIndex, colIndex }]);
    } else {
      // 否则只选择当前单元格
      setSelectedCells([{ rowIndex, colIndex }]);
    }
    
    // 复制单元格内容
    const column = columns[colIndex];
    const value = paginatedRows[rowIndex][column];
    copyToClipboard(String(value ?? ''));
  };
  
  // 处理键盘导航
  const handleKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (selectedCells.length === 0) return;
    
    // 获取当前选中的单元格
    const current = selectedCells[selectedCells.length - 1];
    let newRow = current.rowIndex;
    let newCol = current.colIndex;
    
    switch (event.key) {
      case 'ArrowUp':
        newRow = Math.max(0, current.rowIndex - 1);
        break;
      case 'ArrowDown':
        newRow = Math.min(paginatedRows.length - 1, current.rowIndex + 1);
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, current.colIndex - 1);
        break;
      case 'ArrowRight':
        newCol = Math.min(columns.length - 1, current.colIndex + 1);
        break;
      default:
        return; // 其他键不处理
    }
    
    // 如果位置改变，更新选中单元格
    if (newRow !== current.rowIndex || newCol !== current.colIndex) {
      event.preventDefault();
      setSelectedCells([{ rowIndex: newRow, colIndex: newCol }]);
    }
  };
  
  // 调整字体大小
  const changeFontSize = (delta: number) => {
    setFontSize(prev => Math.max(10, Math.min(20, prev + delta)));
  };
  
  return (
    <div className="flex flex-col h-full w-full max-h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between p-2 border-b">
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索结果..."
              className="pl-8 h-8 w-[200px]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          {/* 列定位 */}
          <div className="relative">
            <Input
              placeholder="定位列..."
              className="h-8 w-[150px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  scrollToColumn(e.currentTarget.value);
                }
              }}
            />
          </div>
          
          <span className="text-sm text-muted-foreground">
            {activeResultSet.rows.length} 行 {activeResultSet.columns.length} 列
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 字体大小调整 */}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => changeFontSize(-1)}
              title="减小字体"
            >
              <ArrowDownIcon className="h-4 w-4" />
            </Button>
            <span className="text-xs w-5 text-center">{fontSize}</span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => changeFontSize(1)}
              title="增大字体"
            >
              <ArrowUpIcon className="h-4 w-4" />
            </Button>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullWidth(!isFullWidth)}
            title={isFullWidth ? "自动调整列宽" : "拉伸填充表格"}
          >
            {isFullWidth ? (
              <MinimizeIcon className="h-4 w-4 mr-1" />
            ) : (
              <MaximizeIcon className="h-4 w-4 mr-1" />
            )}
            {isFullWidth ? "自动列宽" : "拉伸表格"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            disabled={!activeResultSet.rows || activeResultSet.rows.length === 0 || isLoading}
          >
            <DownloadIcon className="h-4 w-4 mr-1" />
            导出CSV
          </Button>
        </div>
      </div>
      
      {/* 多结果集选项卡 */}
      {result.result_sets.length > 1 && (
        <div className="border-b px-2">
          <Tabs 
            value={String(activeResultIndex)} 
            onValueChange={(value) => setActiveResultIndex(parseInt(value, 10))}
          >
            <TabsList>
              {result.result_sets.map((_, index) => (
                <TabsTrigger key={index} value={String(index)}>
                  结果 {index + 1}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      
      {/* 表格容器 */}
      <div className="flex-1 relative overflow-hidden">
        {/* 表格结构 - 使用单一表格来确保对齐，修复滚动条问题 */}
        <div className="absolute inset-0 overflow-auto">
          {/* 通过额外的容器确保滚动条不会干扰布局 */}
          <div className={isFullWidth ? "w-full" : "min-w-full inline-block"}>
            <table 
              ref={tableRef}
              className={isFullWidth ? "w-full table-fixed border-collapse" : "w-auto border-collapse"}
              onKeyDown={handleKeyDown}
              tabIndex={0} // 使表格可以接收键盘焦点
              style={{ fontSize: `${fontSize}px` }}
            >
              {/* 表头 */}
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b">
                  {columns.map((column, index) => (
                    <th 
                      key={column} 
                      data-column={column}
                      className={`h-10 px-4 text-left align-middle font-medium whitespace-nowrap ${
                        highlightedColumn === column ? 'bg-primary/20' : 'text-muted-foreground'
                      }`}
                      style={isFullWidth ? {} : { width: `${columnWidths[index]}px` }}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              
              {/* 表格主体 */}
              <tbody>
                {paginatedRows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    onDoubleClick={() => copyRow(row)}
                    className="border-b hover:bg-muted/50"
                  >
                    {columns.map((column, colIndex) => {
                      const isSelected = selectedCells.some(
                        cell => cell.rowIndex === rowIndex && cell.colIndex === colIndex
                      );
                      
                      return (
                        <td
                          key={`${rowIndex}-${column}`}
                          onClick={(e) => handleCellClick(rowIndex, colIndex, e)}
                          className={`px-4 py-2 align-middle hover:bg-primary/5 cursor-pointer group relative ${
                            isSelected ? 'bg-primary/20' : ''
                          } ${highlightedColumn === column ? 'bg-primary/10' : ''}`}
                          style={isFullWidth ? {} : { 
                            width: `${columnWidths[colIndex]}px`,
                            maxWidth: `${columnWidths[colIndex]}px`,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                          title="点击复制完整内容"
                        >
                          <span>{formatCellValue(row[column])}</span>
                          <span className="absolute opacity-0 group-hover:opacity-100 right-2 transition-opacity">
                            <CopyIcon className="h-3 w-3 text-muted-foreground" />
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {filteredRows.length === 0 && (
            <div className="flex items-center justify-center h-full p-8 text-muted-foreground">
              {searchTerm ? '没有匹配的结果' : '没有数据'}
            </div>
          )}
        </div>
      </div>
      
      {/* 分页控制 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between p-2 border-t">
          <div className="text-sm text-muted-foreground">
            第 {page} 页，共 {totalPages} 页
          </div>
          
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => goToPage(1)}
              disabled={page === 1}
              title="第一页"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              <ChevronLeftIcon className="h-4 w-4 -ml-2" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              title="上一页"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            
            <Input
              className="h-8 w-12 text-center"
              value={page}
              onChange={(e) => {
                const value = parseInt(e.target.value)
                if (!isNaN(value) && value >= 1 && value <= totalPages) {
                  goToPage(value)
                }
              }}
            />
            
            <Button
              variant="outline"
              size="icon"
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              title="下一页"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => goToPage(totalPages)}
              disabled={page === totalPages}
              title="最后一页"
            >
              <ChevronRightIcon className="h-4 w-4" />
              <ChevronRightIcon className="h-4 w-4 -ml-2" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}