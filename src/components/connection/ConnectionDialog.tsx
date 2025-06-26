import { useState, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ConnectionConfig } from '@/types/database'
import { testConnection } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import { Database, Server, Timer, Shield, Zap } from 'lucide-react'

const formSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, { message: '连接名称不能为空' }),
  server: z.string().min(1, { message: '服务器地址不能为空' }),
  port: z.coerce.number().int().positive().optional(),
  database: z.string().min(1, { message: '数据库名称不能为空' }),
  username: z.string().min(1, { message: '用户名不能为空' }),
  password: z.string().min(1, { message: '密码不能为空' }),
  trustServerCertificate: z.boolean().optional(),
  connectionTimeout: z.coerce.number().int().positive().optional(),
  encrypt: z.boolean().optional(),
})

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection: ConnectionConfig | null
  onSave: (connection: ConnectionConfig) => void
}

export default function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  onSave,
}: ConnectionDialogProps) {
  const [isTesting, setIsTesting] = useState(false)
  const { toast } = useToast()

  const form = useForm<ConnectionConfig>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '我的SQL Server',
      server: 'localhost',
      port: 1433,
      database: '',
      username: 'sa',
      password: '',
      trustServerCertificate: true,
      connectionTimeout: 30,
      encrypt: false,
    }
  })

  // Reset form data when connection or open changes
  useEffect(() => {
    if (open) {
      if (connection) {
        // 编辑现有连接时，使用连接数据
        form.reset(connection)
      } else {
        // 新建连接时，使用默认值
        form.reset({
          name: '我的SQL Server',
          server: 'localhost',
          port: 1433,
          database: '',
          username: 'sa',
          password: '',
          trustServerCertificate: true,
          connectionTimeout: 30,
          encrypt: false,
        })
      }
    }
  }, [open, connection, form])

  const onSubmit = async (data: ConnectionConfig) => {
    onSave(data)
  }

  const handleTestConnection = async () => {
    try {
      setIsTesting(true)

      const isValid = await form.trigger()
      if (!isValid) return

      const data = form.getValues()
      const result = await testConnection(data)

      if (result.success) {
        toast.success('连接测试成功', {
          description: result.message
        })
      } else {
        toast.error('连接测试失败', {
          description: result.message
        })
      }
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto bg-gradient-to-br from-slate-50 to-gray-50 border-0 shadow-2xl">
        <DialogHeader className="space-y-3 pb-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-semibold text-gray-900">
                {connection ? '编辑数据库连接' : '新建数据库连接'}
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-600 mt-1">
                配置 SQL Server 数据库连接信息，确保连接参数正确
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Form {...form}>
          <div onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 py-6">
            {/* 基本信息 */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Server className="h-4 w-4 text-gray-500" />
                <h3 className="text-sm font-medium text-gray-900">基本信息</h3>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel className="text-sm font-medium text-gray-700">连接名称</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="我的SQL Server"
                          className="bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 transition-colors"
                          {...field}
                        />
                      </FormControl>
                      <div className="min-h-[20px]">
                        <FormMessage className="text-xs" />
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="server"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel className="text-sm font-medium text-gray-700">服务器地址</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="localhost 或 192.168.1.100"
                          className="bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 transition-colors"
                          {...field}
                        />
                      </FormControl>
                      <div className="min-h-[20px]">
                        <FormMessage className="text-xs" />
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel className="text-sm font-medium text-gray-700">端口号</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="1433"
                          className="bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 transition-colors"
                          {...field}
                        />
                      </FormControl>
                      <div className="min-h-[20px]">
                        <FormMessage className="text-xs" />
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="database"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel className="text-sm font-medium text-gray-700">数据库名称</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="master"
                          className="bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 transition-colors"
                          {...field}
                        />
                      </FormControl>
                      <div className="min-h-[20px]">
                        <FormMessage className="text-xs" />
                      </div>
                    </FormItem>


                  )}
                />

                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel className="text-sm font-medium text-gray-700">用户名</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="sa"
                          className="bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 transition-colors"
                          {...field}
                        />
                      </FormControl>
                      <div className="min-h-[20px]">
                        <FormMessage className="text-xs" />
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel className="text-sm font-medium text-gray-700">密码</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="请输入密码"
                          className="bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 transition-colors"
                          {...field}
                        />
                      </FormControl>
                      <div className="min-h-[20px]">
                        <FormMessage className="text-xs" />
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* 高级设置 */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-4 w-4 text-gray-500" />
                <h3 className="text-sm font-medium text-gray-900">高级设置</h3>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>

              <div className="space-y-6">
                {/* 第一行：连接超时设置 */}
                <FormField
                  control={form.control}
                  name="connectionTimeout"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-y-0 space-x-2">
                      <FormLabel className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <Timer className="h-3 w-3" />
                        连接超时 (秒)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="30"
                          className="w-24 bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500 transition-colors"
                          {...field}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* 第二行：两个并排的开关设置 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="trustServerCertificate"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200">
                        <div className="space-y-1">
                          <FormLabel className="text-sm font-medium text-gray-700 flex items-center gap-2">
                            <Shield className="h-3 w-3" />
                            信任服务器证书
                          </FormLabel>
                          <p className="text-xs text-gray-500">忽略SSL证书验证错误</p>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="data-[state=checked]:bg-blue-600"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="encrypt"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200">
                        <div className="space-y-1">
                          <FormLabel className="text-sm font-medium text-gray-700 flex items-center gap-2">
                            <Zap className="h-3 w-3" />
                            使用加密连接
                          </FormLabel>
                          <p className="text-xs text-gray-500">启用SSL/TLS加密传输</p>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="data-[state=checked]:bg-blue-600"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>



            <DialogFooter className="gap-3 pt-6 border-t border-gray-200">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-6 py-2 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
              >
                {isTesting ? (
                  <>
                    <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full mr-2"></div>
                    测试中...
                  </>
                ) : (
                  <>
                    <Zap className="h-4 w-4 mr-2" />
                    测试连接
                  </>
                )}
              </Button>
              <Button
                type="submit"
                onClick={form.handleSubmit(onSubmit)}
                className="px-8 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors shadow-lg"
              >
                <Database className="h-4 w-4 mr-2" />
                保存连接
              </Button>
            </DialogFooter>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}