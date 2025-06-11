"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { debounce } from "lodash"
import type { QuerySession as Session, TableInfo, QueryResult } from "@/types/database"
import { search_table_names, executeQuery } from "@/lib/api"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Search,
  Table2,
  Key,
  Info,
  Database,
  Calendar,
  User,
  Hash,
  Type,
  CheckCircle2,
  XCircle,
  Settings,
  Shield,
  Loader2,
  FileText,
  Layers3,
  Eye,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"

interface TableMetadata {
  table_info?: {
    name: string
    owner: string
    type: string
    created_datetime: string
  }
  columns?: Array<{
    column_name: string
    type: string
    length: number | string
    nullable: string
    computed: string
    prec?: string
    scale?: string
    collation?: string
  }>
  identity?: Array<{
    identity: string
    seed: string
    increment: string
    not_for_replication: number
  }>
  indexes?: Array<{
    index_name: string
    index_description: string
    index_keys: string
  }>
  constraints?: Array<{
    constraint_type: string
    constraint_name: string
    constraint_keys: string
    delete_action?: string
    update_action?: string
    status_enabled?: string
    status_for_replication?: string
  }>
  reference_views?: Array<{
    table_is_referenced_by_views: string
  }>
}

interface TableMetadataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeSession: Session | null
}

export default function TableMetadataDialog({ open, onOpenChange, activeSession }: TableMetadataDialogProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTable, setSelectedTable] = useState<TableInfo | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false)
  const [tableMetadata, setTableMetadata] = useState<TableMetadata | null>(null)

  // 创建一个ref来跟踪当前的搜索请求，防止竞态条件
  const searchRequestRef = useRef<number>(0)

  // 修复防抖搜索函数
  const debouncedSearch = useCallback(
    debounce(async (term: string) => {
      if (!activeSession) {
        return
      }

      // 生成新的请求ID
      const requestId = ++searchRequestRef.current

      setIsSearching(true)
      try {
        const result = await search_table_names(activeSession.id, term)

        // 检查是否为最新的请求，防止竞态条件
        if (requestId === searchRequestRef.current) {
          setTables(result)
        } else {
          console.error(`防抖搜索被忽略: 不是最新请求, 当前请求ID=${requestId}, 最新请求ID=${searchRequestRef.current}`)
        }
      } catch (err) {
        console.error("搜索表失败:", err)
        // 只有在是最新请求时才更新状态
        if (requestId === searchRequestRef.current) {
          setTables([])
        }
      } finally {
        // 只有在是最新请求时才停止loading状态
        if (requestId === searchRequestRef.current) {
          setIsSearching(false)
        }
      }
    }, 500),
    [activeSession],
  )

  // 处理搜索词变化的防抖搜索
  useEffect(() => {
    if (open && activeSession) {
      debouncedSearch(searchTerm)
    }

    return () => {
      if (debouncedSearch?.cancel) {
        debouncedSearch.cancel()
      }
    }
  }, [searchTerm, open, activeSession])

  // 对话框打开/关闭时的初始化和清理逻辑
  useEffect(() => {
    if (open && activeSession) {
      // 重置状态
      setSearchTerm("")
      setTables([])
      setSelectedTable(null)
      setTableMetadata(null)
      searchRequestRef.current = 0

      // 初始加载所有表（空搜索词）
      setIsSearching(true)
      search_table_names(activeSession.id, "")
        .then((result) => {
          setTables(result)
        })
        .catch((err) => {
          console.error("搜索表失败:", err)
          setTables([])
        })
        .finally(() => setIsSearching(false))
    } else if (!open) {
      // 对话框关闭时清理状态和取消防抖
      setSearchTerm("")
      setTables([])
      setSelectedTable(null)
      setTableMetadata(null)
      setIsSearching(false)
      setIsLoadingMetadata(false)

      // 取消防抖搜索
      if (debouncedSearch?.cancel) {
        debouncedSearch.cancel()
      }

      // 重置搜索请求计数器
      searchRequestRef.current = 0
    }
  }, [open, activeSession])

  const fetchTableMetadata = async (table: TableInfo) => {
    if (!activeSession) return

    setIsLoadingMetadata(true)
    setTableMetadata(null)

    try {
      const tableName = table.schema ? `[${table.schema}].[${table.name}]` : `[${table.name}]`
      const sql = `EXEC sp_help '${tableName.replace(/'/g, "''")}'`
      const result: QueryResult = await executeQuery(activeSession.id, sql)

      if (result.result_sets && result.result_sets.length > 0) {
        const metadata: TableMetadata = {}

        if (result.result_sets[0]?.rows.length > 0) {
          const row = result.result_sets[0].rows[0]
          metadata.table_info = {
            name: row.Name,
            owner: row.Owner,
            type: row.Type,
            created_datetime: row.Created_datetime,
          }
        }

        // BUG FIX: Explicitly map rows to the correct type
        if (result.result_sets[1]?.rows.length > 0) {
          metadata.columns = result.result_sets[1].rows.map((row) => ({
            column_name: row.Column_name || "",
            type: row.Type || "",
            length: row.Length || 0,
            nullable: row.Nullable || "no",
            computed: row.Computed || "no",
            prec: row.Prec || "",
            scale: row.Scale || "",
            collation: row.Collation || "",
          }))
        }

        if (result.result_sets[2]?.rows.length > 0) {
          metadata.identity = result.result_sets[2].rows.map((row) => ({
            identity: row.Identity || "",
            seed: row.Seed || "0",
            increment: row.Increment || "0",
            not_for_replication: row["Not For Replication"] || 0,
          }))
        }

        if (result.result_sets[5]?.rows.length > 0) {
          metadata.indexes = result.result_sets[5].rows.map((row) => ({
            index_name: row.index_name || "",
            index_description: row.index_description || "",
            index_keys: row.index_keys || "",
          }))
        }

        if (result.result_sets[6]?.rows.length > 0) {
          metadata.constraints = result.result_sets[6].rows.map((row) => ({
            constraint_type: row.constraint_type || "",
            constraint_name: row.constraint_name || "",
            constraint_keys: row.constraint_keys || "",
          }))
        }

        if (result.result_sets[7]?.rows.length > 0) {
          metadata.reference_views = result.result_sets[7].rows.map((row) => ({
            table_is_referenced_by_views: row["Table is referenced by views"] || "",
          }))
        }

        setTableMetadata(metadata)
      }
    } catch (err) {
      console.error("获取表元数据失败:", err)
    } finally {
      setIsLoadingMetadata(false)
    }
  }

  const handleTableSelect = (table: TableInfo) => {
    setSelectedTable(table)
    fetchTableMetadata(table)
  }

  const processedMetadata = useMemo(() => {
    if (!tableMetadata) return null

    const pkColumns = new Set<string>()
    const uniqueColumns = new Set<string>()
    const defaultValues = new Map<string, string>()
    const identityColumn = tableMetadata.identity?.[0]?.identity

    tableMetadata.constraints?.forEach((c) => {
      const keys = c.constraint_keys.split(", ").map((k) => k.trim())
      if (c.constraint_type.includes("PRIMARY KEY")) {
        keys.forEach((key) => pkColumns.add(key))
      } else if (c.constraint_type.includes("UNIQUE")) {
        keys.forEach((key) => uniqueColumns.add(key))
      } else if (c.constraint_type.includes("DEFAULT on column")) {
        const colName = c.constraint_type.split("DEFAULT on column ")[1]
        if (colName) {
          defaultValues.set(colName.trim(), c.constraint_keys)
        }
      }
    })

    return { pkColumns, uniqueColumns, defaultValues, identityColumn }
  }, [tableMetadata])

  const getColumnIcon = (columnName: string) => {
    const isIdentity = processedMetadata?.identityColumn === columnName
    const isPK = processedMetadata?.pkColumns.has(columnName)

    if (isPK) {
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/20">
          <Key className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        </div>
      )
    }
    if (isIdentity) {
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/20">
          <Hash className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
        </div>
      )
    }
    if (processedMetadata?.uniqueColumns.has(columnName)) {
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/20">
          <Shield className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center w-6 h-6">
        <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
      </div>
    )
  }

  const getDataTypeColor = (type: string) => {
    const lowerType = type.toLowerCase()
    if (lowerType.includes("int") || lowerType.includes("bigint") || lowerType.includes("smallint")) {
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
    }
    if (lowerType.includes("varchar") || lowerType.includes("nvarchar") || lowerType.includes("char")) {
      return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300"
    }
    if (lowerType.includes("datetime") || lowerType.includes("date") || lowerType.includes("time")) {
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300"
    }
    if (lowerType.includes("decimal") || lowerType.includes("float") || lowerType.includes("money")) {
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300"
    }
    return "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300"
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1400px] h-[90vh] overflow-hidden flex flex-col font-inter">
        <DialogHeader className="pb-4 flex-shrink-0">
          <DialogTitle className="flex items-center gap-3 text-xl font-inter">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
              <Database className="h-5 w-5 text-primary" />
            </div>
            表元数据查看器
          </DialogTitle>
          <DialogDescription className="text-base font-inter">
            搜索和查看数据库表的详细元数据信息，包括列定义、索引和约束
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-4 flex-shrink-0">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索表名..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-10 h-11 text-base"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
          {/* 左侧表列表 */}
          <Card className="w-80 flex flex-col min-h-0">
            <CardHeader className="pb-3 flex-shrink-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2 font-inter">
                <Table2 className="h-4 w-4" />
                数据库表 ({tables.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 min-h-0">
              <ScrollArea className="h-full">
                <div className="space-y-1 p-3 pt-0">
                  {tables.map((table, index) => (
                    <div
                      key={`${table.schema || "dbo"}.${table.name}-${index}`}
                      className={`group relative p-3 rounded-lg cursor-pointer transition-all duration-200 ${
                        selectedTable?.name === table.name && selectedTable?.schema === table.schema
                          ? "bg-primary/10 border-2 border-primary/20 shadow-sm"
                          : "hover:bg-muted/50 border-2 border-transparent"
                      }`}
                      onClick={() => handleTableSelect(table)}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors ${
                            selectedTable?.name === table.name && selectedTable?.schema === table.schema
                              ? "bg-primary/20 text-primary"
                              : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                          }`}
                        >
                          <Table2 className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate font-inter">{table.name}</div>
                          {table.schema && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 font-inter">
                              <Layers3 className="h-3 w-3" />
                              {table.schema}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {!isSearching && tables.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <Table2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">未找到匹配的表</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* 右侧详情区域 */}
          <Card className="flex-1 flex flex-col min-h-0">
            <CardContent className="flex-1 p-6 overflow-hidden min-h-0">
              {selectedTable ? (
                isLoadingMetadata ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-base">正在加载表元数据...</p>
                    </div>
                  </div>
                ) : tableMetadata ? (
                  <div className="h-full flex flex-col space-y-6 min-h-0">

                    {/* 标签页内容 */}
                    <Tabs defaultValue="columns" className="flex-1 flex flex-col min-h-0">
                      <TabsList className="grid w-full grid-cols-4 h-12 flex-shrink-0">
                        <TabsTrigger value="columns" className="flex items-center gap-2 text-sm">
                          <Type className="h-4 w-4" />列 ({tableMetadata.columns?.length || 0})
                        </TabsTrigger>
                        <TabsTrigger value="indexes" className="flex items-center gap-2 text-sm">
                          <Settings className="h-4 w-4" />
                          索引 ({tableMetadata.indexes?.length || 0})
                        </TabsTrigger>
                        <TabsTrigger value="constraints" className="flex items-center gap-2 text-sm">
                          <Shield className="h-4 w-4" />
                          约束 ({tableMetadata.constraints?.length || 0})
                        </TabsTrigger>
                        <TabsTrigger value="reference_views" className="flex items-center gap-2 text-sm">
                          <Eye className="h-4 w-4" />
                          引用视图 ({tableMetadata.reference_views?.length || 0})
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="columns" className="flex-1 mt-4 overflow-hidden min-h-0">
                        <Card className="h-full flex flex-col min-h-0">
                          <CardContent className="p-0 flex-1 overflow-hidden min-h-0">
                            <ScrollArea className="h-full w-full">
                              <div className="min-w-full">
                                <table className="w-full text-sm">
                                  <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm border-b">
                                    <tr>
                                      <th className="px-4 py-3 text-left font-semibold w-12">#</th>
                                      <th className="px-4 py-3 text-center font-semibold w-16">图标</th>
                                      <th className="px-4 py-3 text-left font-semibold min-w-32">列名</th>
                                      <th className="px-4 py-3 text-left font-semibold min-w-24">数据类型</th>
                                      <th className="px-4 py-3 text-center font-semibold w-20">长度</th>
                                      <th className="px-4 py-3 text-center font-semibold w-16">可空</th>
                                      <th className="px-4 py-3 text-left font-semibold min-w-24">默认值</th>
                                      <th className="px-4 py-3 text-center font-semibold w-16">精度</th>
                                      <th className="px-4 py-3 text-center font-semibold w-20">小数位</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {tableMetadata.columns?.map((column, index) => (
                                      <tr
                                        key={column.column_name}
                                        className="border-b hover:bg-muted/30 transition-colors"
                                      >
                                        <td className="px-4 py-3 text-muted-foreground font-inter text-xs">
                                          {(index + 1).toString().padStart(2, "0")}
                                        </td>
                                        <td className="px-4 py-3 text-center">{getColumnIcon(column.column_name)}</td>
                                        <td className="px-4 py-3">
                                          <span className="font-medium text-primary font-inter">{column.column_name}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                          <Badge
                                            variant="secondary"
                                            className={`font-inter text-xs font-inter ${getDataTypeColor(column.type)}`}
                                          >
                                            {column.type}
                                          </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-center font-inter text-xs">{column.length}</td>
                                        <td className="px-4 py-3 text-center">
                                          {column.nullable === "yes" ? (
                                            <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                                          ) : (
                                            <XCircle className="h-4 w-4 text-red-500 mx-auto" />
                                          )}
                                        </td>
                                        <td className="px-4 py-3">
                                          <code className="text-xs bg-muted px-2 py-1 rounded">
                                            {processedMetadata?.defaultValues.get(column.column_name) || "-"}
                                          </code>
                                        </td>
                                        <td className="px-4 py-3 text-center font-inter text-xs">
                                          {column.prec?.trim() || "-"}
                                        </td>
                                        <td className="px-4 py-3 text-center font-inter text-xs">
                                          {column.scale?.trim() || "-"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </ScrollArea>
                          </CardContent>
                        </Card>
                      </TabsContent>

                      <TabsContent value="indexes" className="flex-1 mt-4 overflow-hidden min-h-0">
                        <Card className="h-full flex flex-col min-h-0">
                          <CardContent className="flex-1 overflow-hidden min-h-0">
                            {tableMetadata.indexes && tableMetadata.indexes.length > 0 ? (
                              <ScrollArea className="h-full w-full">
                                <div className="p-6 space-y-4">
                                  {tableMetadata.indexes.map((index, idx) => (
                                    <Card key={index.index_name} className="border-l-4 border-l-blue-500">
                                      <CardContent className="p-4">
                                        <div className="flex items-start gap-3">
                                          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/20 mt-0.5">
                                            <Settings className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                          </div>
                                          <div className="flex-1 space-y-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <h4 className="font-semibold text-primary font-inter">{index.index_name}</h4>
                                              {index.index_description.includes("primary key") && (
                                                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                                                  主键
                                                </Badge>
                                              )}
                                              {index.index_description.includes("unique") && (
                                                <Badge
                                                  variant="secondary"
                                                  className="bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300"
                                                >
                                                  唯一
                                                </Badge>
                                              )}
                                              {index.index_description.includes("clustered") && (
                                                <Badge variant="outline">聚集</Badge>
                                              )}
                                            </div>
                                            <Separator />
                                            <div className="space-y-2 text-sm">
                                              <div className="flex items-start gap-2">
                                                <span className="font-medium text-muted-foreground min-w-12">
                                                  描述：
                                                </span>
                                                <span className="text-muted-foreground">{index.index_description}</span>
                                              </div>
                                              <div className="flex items-start gap-2">
                                                <span className="font-medium text-muted-foreground min-w-12">列：</span>
                                                <code className="text-muted-foreground bg-muted px-2 py-1 rounded font-inter">
                                                  {index.index_keys}
                                                </code>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                                </div>
                              </ScrollArea>
                            ) : (
                              <div className="flex items-center justify-center h-full text-muted-foreground">
                                <div className="text-center">
                                  <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                  <p>该表没有索引信息</p>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>

                      <TabsContent value="constraints" className="flex-1 mt-4 overflow-hidden min-h-0">
                        <Card className="h-full flex flex-col min-h-0">
                          <CardContent className="flex-1 overflow-hidden min-h-0">
                            {tableMetadata.constraints && tableMetadata.constraints.length > 0 ? (
                              <ScrollArea className="h-full w-full">
                                <div className="p-6 space-y-4">
                                  {tableMetadata.constraints.map((constraint, idx) => (
                                    <Card key={constraint.constraint_name} className="border-l-4 border-l-purple-500">
                                      <CardContent className="p-4">
                                        <div className="flex items-start gap-3">
                                          <div className="flex items-center justify-center w-8 h-6 rounded-lg bg-purple-100 dark:bg-purple-900/20 mt-0.5">
                                            <Shield className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                          </div>
                                          <div className="flex-1 space-y-2">
                                            <h4 className="font-semibold text-primary font-inter">{constraint.constraint_name}</h4>
                                            <Separator />
                                            <div className="space-y-2 text-sm">
                                              <div className="flex items-start gap-2">
                                                <span className="font-medium text-muted-foreground min-w-12">
                                                  类型：
                                                </span>
                                                <Badge variant="outline">{constraint.constraint_type}</Badge>
                                              </div>
                                              <div className="flex items-start gap-2">
                                                <span className="font-medium text-muted-foreground min-w-12">键/值：</span>
                                                <code className="text-muted-foreground bg-muted px-2 py-1 rounded font-inter">
                                                {constraint.constraint_keys}
                                                </code>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                                </div>
                              </ScrollArea>
                            ) : (
                              <div className="flex items-center justify-center h-full text-muted-foreground">
                                <div className="text-center">
                                  <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                  <p>该表没有约束信息</p>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>

                      <TabsContent value="reference_views" className="flex-1 mt-4 overflow-hidden min-h-0">
                        <Card className="h-full flex flex-col min-h-0">
                          <CardContent className="flex-1 overflow-hidden min-h-0">
                            {tableMetadata.reference_views && tableMetadata.reference_views.length > 0 ? (
                              <ScrollArea className="h-full w-full">
                                <div className="p-6 space-y-4">
                                  {tableMetadata.reference_views.map((view, idx) => (
                                    <Card key={view.table_is_referenced_by_views} className="border-l-4 border-l-orange-500">
                                      <CardContent className="p-4">
                                        <div className="flex items-start gap-3">
                                          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/20 mt-0.5">
                                            <Eye className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                                          </div>
                                          <div className="flex-1 space-y-2">
                                            <h4 className="font-semibold text-primary font-inter">{view.table_is_referenced_by_views}</h4>
                                          </div>
                                        </div>
                                      </CardContent>
                                    </Card>
                                  ))}
                                </div>
                              </ScrollArea>
                            ) : (
                              <div className="flex items-center justify-center h-full text-muted-foreground">
                                <div className="text-center">
                                  <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                  <p>该表没有引用视图</p>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </TabsContent>
                    </Tabs>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <XCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>无法加载表元数据</p>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center space-y-4">
                    <div className="flex items-center justify-center w-20 h-20 rounded-full bg-muted/30 mx-auto">
                      <Table2 className="h-10 w-10 opacity-50" />
                    </div>
                    <div>
                      <h3 className="font-medium text-lg mb-2">选择一个表</h3>
                      <p className="text-sm">从左侧列表选择一个表来查看其详细元数据信息</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}
