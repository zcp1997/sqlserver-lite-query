"use client"
import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CheckCircle2, XCircle, Database, Copy, Eye } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface QueryLogItem {
  id: string
  session_id: string
  connectionName: string
  database: string
  sql: string
  executedAt: string
  duration: number
  success: boolean
}

const PAGE_SIZE = 15

export default function SqlQueryLog() {
  const [logs, setLogs] = useState<QueryLogItem[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [selectedSql, setSelectedSql] = useState<string>("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const raw = localStorage.getItem("sqlserver-query-history")
    if (raw) {
      try {
        const parsed: QueryLogItem[] = JSON.parse(raw)
        setLogs(parsed.sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()))
      } catch (err) {
        console.error("Failed to parse logs from localStorage:", err)
      }
    }
  }, [])

  const pageCount = Math.ceil(logs.length / PAGE_SIZE)
  const paginatedLogs = logs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const handleViewSql = (sql: string) => {
    setSelectedSql(sql)
    setIsDialogOpen(true)
  }

  const handleCopySql = async (sql: string) => {
    try {
      await navigator.clipboard.writeText(sql)
      toast.success("复制成功", { description: "SQL 语句已复制到剪贴板", duration: 1500 })
    } catch (err) {
      toast.error("复制失败", { description: "无法复制到剪贴板", duration: 1500 })
    }
  }

  return (
    <Card className="m-4 shadow-xl rounded-2xl">
      <CardContent className="p-6">
        <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
          <Database className="w-5 h-5" /> SQL执行日志列表
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">状态</TableHead>
              <TableHead>连接</TableHead>
              <TableHead>数据库</TableHead>
              <TableHead>SQL</TableHead>
              <TableHead>耗时 (ms)</TableHead>
              <TableHead>执行时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedLogs.map((log) => (
              <TableRow key={log.id}>
                <TableCell>
                  {log.success ? (
                    <CheckCircle2 className="text-green-500 w-5 h-5" />
                  ) : (
                    <XCircle className="text-red-500 w-5 h-5" />
                  )}
                </TableCell>
                <TableCell>{log.connectionName}</TableCell>
                <TableCell>{log.database}</TableCell>
                <TableCell className="max-w-[300px]">
                  <div className="flex items-center justify-between group">
                    <span className="truncate text-sm text-muted-foreground pr-2">{log.sql}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewSql(log.sql)}
                        className="h-6 w-6 p-0 hover:bg-muted"
                        title="查看完整 SQL"
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopySql(log.sql)}
                        className="h-6 w-6 p-0 hover:bg-muted"
                        title="复制 SQL"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{log.duration}</TableCell>
                <TableCell>{new Date(log.executedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* SQL 查看对话框 */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <span>SQL 语句详情</span>
                <Button variant="outline" size="sm" onClick={() => handleCopySql(selectedSql)} className="ml-2">
                  <Copy className="h-4 w-4 mr-2" />
                  复制
                </Button>
              </DialogTitle>
            </DialogHeader>
            <div className="mt-4">
              <pre className="bg-muted p-4 rounded-lg overflow-auto max-h-[60vh] text-sm whitespace-pre-wrap break-words">
                {selectedSql}
              </pre>
            </div>
          </DialogContent>
        </Dialog>

        {/* Pagination */}
        <Pagination className="mt-6 justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                aria-disabled={currentPage === 1}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-2 text-sm">
                第 {currentPage} 页 / 共 {pageCount} 页
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, pageCount))}
                aria-disabled={currentPage === pageCount}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </CardContent>
    </Card>
  )
}
