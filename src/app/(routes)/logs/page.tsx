'use client'

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"
import { CheckCircle2, XCircle, Database } from "lucide-react"

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
                <TableCell className="max-w-[300px] truncate text-sm text-muted-foreground">{log.sql}</TableCell>
                <TableCell>{log.duration}</TableCell>
                <TableCell>{new Date(log.executedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

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
              <span className="px-2 text-sm">第 {currentPage} 页 / 共 {pageCount} 页</span>
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
