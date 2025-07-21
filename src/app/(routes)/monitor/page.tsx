"use client"

import React, { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Play, 
  Pause, 
  Activity, 
  Clock,
  Database,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  BarChart3,
  Loader2,
  Info
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { testConnection } from "@/lib/api"
import { ConnectionConfig } from "@/types/database"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ConnectionStatus {
  id: string
  config: ConnectionConfig
  status: 'online' | 'offline' | 'checking' | 'error'
  responseTime?: number
  lastChecked: string
  errorMessage?: string
  uptime: number // 在线时长百分比
  checkCount: number
  successCount: number
}

const CHECK_INTERVAL = 30000 // 30秒检测一次
const STORAGE_KEY = 'sqlserver-connections'

export default function ConnectionMonitor() {
  const [connections, setConnections] = useState<ConnectionStatus[]>([])
  const [isAutoRefresh, setIsAutoRefresh] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true) // 新增：初始加载状态
  const [errorDialog, setErrorDialog] = useState<{
    open: boolean
    connectionName: string
    errorMessage: string
    serverInfo: string
  }>({
    open: false,
    connectionName: '',
    errorMessage: '',
    serverInfo: ''
  })
  const { toast } = useToast()

  // 加载连接配置
  const loadConnections = useCallback(() => {
    try {
      const savedConnections = localStorage.getItem(STORAGE_KEY)
      if (savedConnections) {
        const configs: ConnectionConfig[] = JSON.parse(savedConnections)
        
        setConnections(prevConnections => {
          return configs.map(config => {
            // 保留现有状态数据，如果是新连接则初始化
            const existing = prevConnections.find(conn => conn.id === config.id)
            return existing ? { ...existing, config } : {
              id: config.id || '',
              config,
              status: 'offline' as const,
              lastChecked: '',
              uptime: 0,
              checkCount: 0,
              successCount: 0
            }
          })
        })
      }
    } catch (err) {
      console.error("加载连接配置失败:", err)
      toast.error("加载连接配置失败")
    }
  }, [toast])

  // 检测单个连接
  const checkConnection = useCallback(async (connectionStatus: ConnectionStatus): Promise<ConnectionStatus> => {
    const startTime = Date.now()
    
    try {
      const result = await testConnection(connectionStatus.config)
      const responseTime = Date.now() - startTime
      
      const newSuccessCount = connectionStatus.successCount + (result.success ? 1 : 0)
      const newCheckCount = connectionStatus.checkCount + 1
      const uptime = Math.round((newSuccessCount / newCheckCount) * 100)

      return {
        ...connectionStatus,
        status: result.success ? 'online' : 'error',
        responseTime: result.success ? responseTime : undefined,
        lastChecked: new Date().toISOString(),
        errorMessage: result.success ? undefined : result.message,
        uptime,
        checkCount: newCheckCount,
        successCount: newSuccessCount
      }
    } catch (error) {
      const newCheckCount = connectionStatus.checkCount + 1
      const uptime = Math.round((connectionStatus.successCount / newCheckCount) * 100)

      return {
        ...connectionStatus,
        status: 'error',
        responseTime: undefined,
        lastChecked: new Date().toISOString(),
        errorMessage: String(error),
        uptime,
        checkCount: newCheckCount,
        successCount: connectionStatus.successCount
      }
    }
  }, [])

  // 检测所有连接
  const checkAllConnections = useCallback(async () => {
    setConnections(currentConnections => {
      if (currentConnections.length === 0) return currentConnections
      
      setIsChecking(true)
      
      // 设置状态为检测中
      const checkingConnections = currentConnections.map(conn => ({ ...conn, status: 'checking' as const }))
      
      // 异步执行检测
      Promise.all(checkingConnections.map(conn => checkConnection(conn)))
        .then(results => {
          setConnections(results)
          
          // 统计结果
          const onlineCount = results.filter(r => r.status === 'online').length
          const totalCount = results.length
          
          if (onlineCount === totalCount) {
            toast.success(`连接检测完成`, {
              description: `${onlineCount}/${totalCount} 个连接正常`,
              duration: 2000
            })
          } else {
            toast.warning(`连接检测完成`, {
              description: `${onlineCount}/${totalCount} 个连接正常，${totalCount - onlineCount} 个连接异常`,
              duration: 3000
            })
          }
        })
        .catch(error => {
          toast.error("连接检测失败", {
            description: String(error),
            duration: 3000
          })
        })
        .finally(() => {
          setIsChecking(false)
          setIsInitialLoading(false) // 检测完成后，取消初始加载状态
        })
      
      return checkingConnections
    })
  }, [checkConnection, toast])

  // 手动刷新
  const handleManualRefresh = useCallback(() => {
    setIsInitialLoading(true) // 手动刷新时也显示加载状态
    loadConnections()
    setTimeout(() => {
      checkAllConnections()
    }, 100)
  }, [loadConnections, checkAllConnections])

  // 自动刷新功能
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    
    if (isAutoRefresh) {
      interval = setInterval(() => {
        checkAllConnections()
      }, CHECK_INTERVAL)
    }
    
    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [isAutoRefresh, checkAllConnections])

  // 初始化
  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  // 初始检测 - 使用ref来避免依赖connections数组
  const hasInitialChecked = React.useRef(false)
  
  useEffect(() => {
    if (!hasInitialChecked.current && connections.length > 0) {
      // 延迟1秒后进行初始检测，确保组件已完全加载
      const timer = setTimeout(() => {
        hasInitialChecked.current = true
        checkAllConnections()
      }, 1000)
      
      return () => clearTimeout(timer)
    }
  }, [connections.length, checkAllConnections])

  // 获取状态图标和颜色
  const getStatusInfo = (status: ConnectionStatus['status']) => {
    switch (status) {
      case 'online':
        return { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-100', text: '在线' }
      case 'offline':
        return { icon: WifiOff, color: 'text-gray-500', bg: 'bg-gray-100', text: '未检测' }
      case 'checking':
        return { icon: RefreshCw, color: 'text-blue-500', bg: 'bg-blue-100', text: '检测中' }
      case 'error':
        return { icon: XCircle, color: 'text-red-500', bg: 'bg-red-100', text: '异常' }
      default:
        return { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-100', text: '未知' }
    }
  }

  // 获取响应时间颜色
  const getResponseTimeColor = (responseTime?: number) => {
    if (!responseTime) return 'text-gray-500'
    if (responseTime < 500) return 'text-green-600'
    if (responseTime < 1000) return 'text-yellow-600'
    if (responseTime < 2000) return 'text-orange-600'
    return 'text-red-600'
  }

  // 获取可用性颜色
  const getUptimeColor = (uptime: number) => {
    if (uptime >= 95) return 'text-green-600'
    if (uptime >= 80) return 'text-yellow-600'
    if (uptime >= 60) return 'text-orange-600'
    return 'text-red-600'
  }

  const onlineCount = connections.filter(conn => conn.status === 'online').length
  const totalCount = connections.length
  
  // 计算实际的统计数据（排除初始加载状态）
  const getDisplayStats = () => {
    if (isInitialLoading) {
      return { onlineCount: 0, totalCount, offlineCount: 0, uptime: 0 }
    }
    const offlineCount = connections.filter(conn => conn.status === 'error' || conn.status === 'offline').length
    const uptime = totalCount > 0 ? Math.round((onlineCount / totalCount) * 100) : 0
    return { onlineCount, totalCount, offlineCount, uptime }
  }
  
  const displayStats = getDisplayStats()

  // 显示错误详情
  const showErrorDetails = useCallback((connection: ConnectionStatus) => {
    setErrorDialog({
      open: true,
      connectionName: connection.config.name,
      errorMessage: connection.errorMessage || '',
      serverInfo: `${connection.config.server}:${connection.config.port || 1433} / ${connection.config.database}`
    })
  }, [])

  // 关闭错误详情对话框
  const closeErrorDialog = useCallback(() => {
    setErrorDialog(prev => ({ ...prev, open: false }))
  }, [])

  // 判断错误信息是否需要截断
  const shouldTruncateError = (errorMessage: string) => {
    return errorMessage.length > 50
  }

  return (
    <div className="container mx-auto py-6 max-w-7xl space-y-6">
      {/* 标题和控制区域 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Activity className="h-8 w-8" />
            连接可用性监控
          </h1>
          <p className="text-muted-foreground mt-2">
            实时监控所有已配置的SQL Server连接状态和性能
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">自动刷新</span>
            <Switch
              checked={isAutoRefresh}
              onCheckedChange={setIsAutoRefresh}
            />
            <span className="text-xs text-muted-foreground">
              {isAutoRefresh ? '30秒' : '关闭'}
            </span>
          </div>
          <Button 
            onClick={handleManualRefresh} 
            disabled={isChecking || isInitialLoading}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${(isChecking || isInitialLoading) ? 'animate-spin' : ''}`} />
            {isInitialLoading ? '正在检测' : '手动检测'}
          </Button>
        </div>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">总连接数</p>
                <p className="text-2xl font-bold">{displayStats.totalCount}</p>
              </div>
              <Database className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">在线连接</p>
                {isInitialLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    <span className="text-lg text-muted-foreground">检测中...</span>
                  </div>
                ) : (
                  <p className="text-2xl font-bold text-green-600">{displayStats.onlineCount}</p>
                )}
              </div>
              <Wifi className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">异常连接</p>
                {isInitialLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    <span className="text-lg text-muted-foreground">检测中...</span>
                  </div>
                ) : (
                  <p className="text-2xl font-bold text-red-600">{displayStats.offlineCount}</p>
                )}
              </div>
              <WifiOff className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">整体可用性</p>
                {isInitialLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    <span className="text-lg text-muted-foreground">检测中...</span>
                  </div>
                ) : (
                  <p className={`text-2xl font-bold ${getUptimeColor(displayStats.uptime)}`}>
                    {displayStats.uptime}%
                  </p>
                )}
              </div>
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 连接状态表格 */}
      <Card>
        <CardHeader>
          <CardTitle>连接状态详情</CardTitle>
        </CardHeader>
        <CardContent className="relative">
          {/* 初始加载遮罩层 */}
          {isInitialLoading && connections.length > 0 && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="text-center">
                  <p className="text-lg font-medium">正在检测连接状态</p>
                  <p className="text-sm text-muted-foreground">请稍候，正在测试所有数据库连接...</p>
                </div>
              </div>
            </div>
          )}
          
          {connections.length === 0 ? (
            <div className="text-center py-8">
              <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">暂无连接配置</p>
              <p className="text-sm text-muted-foreground mt-2">
                请先在连接管理中添加数据库连接
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>连接名称</TableHead>
                  <TableHead>服务器</TableHead>
                  <TableHead>数据库</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>响应时间</TableHead>
                  <TableHead>可用性</TableHead>
                  <TableHead>最后检测</TableHead>
                  <TableHead>错误信息</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((conn) => {
                  const statusInfo = getStatusInfo(conn.status)
                  const StatusIcon = statusInfo.icon
                  
                  return (
                    <TableRow key={conn.id}>
                      <TableCell className="font-medium">
                        {conn.config.name}
                      </TableCell>
                      <TableCell>
                        {conn.config.server}:{conn.config.port || 1433}
                      </TableCell>
                      <TableCell>{conn.config.database}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${statusInfo.bg} ${statusInfo.color} border-current`}>
                          <StatusIcon className={`h-3 w-3 mr-1 ${conn.status === 'checking' ? 'animate-spin' : ''}`} />
                          {statusInfo.text}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {conn.responseTime ? (
                          <span className={`font-mono ${getResponseTimeColor(conn.responseTime)}`}>
                            {conn.responseTime}ms
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {conn.checkCount > 0 ? (
                          <span className={`font-mono ${getUptimeColor(conn.uptime)}`}>
                            {conn.uptime}%
                            <span className="text-xs text-muted-foreground ml-1">
                              ({conn.successCount}/{conn.checkCount})
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {conn.lastChecked ? (
                          <span className="text-sm text-muted-foreground">
                            {new Date(conn.lastChecked).toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">未检测</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {conn.errorMessage ? (
                          <div className="flex items-center gap-2 max-w-xs">
                            {shouldTruncateError(conn.errorMessage) ? (
                              <>
                                <span className="text-xs text-red-600 truncate flex-1" title={conn.errorMessage}>
                                  {conn.errorMessage.substring(0, 30)}...
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 flex-shrink-0"
                                  onClick={() => showErrorDetails(conn)}
                                >
                                  <Info className="h-3 w-3" />
                                </Button>
                              </>
                            ) : (
                              <span className="text-xs text-red-600">
                                {conn.errorMessage}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 说明信息 */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <Clock className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="space-y-2">
              <h4 className="font-medium">监控说明</h4>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>• 初始检测：页面加载后会自动检测所有连接的可用性</p>
                <p>• 自动刷新：每30秒检测一次所有连接的可用性</p>
                <p>• 响应时间：连接建立的耗时，绿色(&lt;500ms) {'>'} 黄色(&lt;1s) {'>'} 橙色(&lt;2s) {'>'} 红色(≥2s)</p>
                <p>• 可用性：成功连接次数占总检测次数的百分比</p>
                <p>• 手动检测：立即重新检测所有连接状态，不受自动刷新影响</p>
                <p>• 错误信息：长错误信息会被截断，点击详情按钮查看完整信息</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 错误详情对话框 */}
      <Dialog open={errorDialog.open} onOpenChange={closeErrorDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              连接错误详情
            </DialogTitle>
            <DialogDescription>
              {errorDialog.connectionName} ({errorDialog.serverInfo})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-2 text-muted-foreground">错误信息：</h4>
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <pre className="text-sm text-red-700 whitespace-pre-wrap break-words font-mono">
                  {errorDialog.errorMessage}
                </pre>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={closeErrorDialog}>
                关闭
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
} 