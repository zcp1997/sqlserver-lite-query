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
import { AlertCircle, CheckCircle } from 'lucide-react'

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
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const form = useForm<ConnectionConfig>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      server: '',
      port: 1433,
      database: '',
      username: '',
      password: '',
      trustServerCertificate: true,
      connectionTimeout: 30,
      encrypt: false,
    }
  })

  // Reset form data when connection or open changes
  useEffect(() => {
    if (open) {
      form.reset(connection || {
        name: '',
        server: '',
        port: 1433,
        database: '',
        username: '',
        password: '',
        trustServerCertificate: true,
        connectionTimeout: 30,
        encrypt: false,
      })
      // Clear previous test results when opening the dialog
      setTestResult(null)
    }
  }, [open, connection, form])

  const onSubmit = async (data: ConnectionConfig) => {
    onSave(data)
  }

  const handleTestConnection = async () => {
    try {
      setIsTesting(true)
      setTestResult(null)

      const isValid = await form.trigger()
      if (!isValid) return

      const data = form.getValues()
      const result = await testConnection(data)

      setTestResult({
        success: result.success,
        message: result.message
      })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{connection ? '编辑连接' : '新建连接'}</DialogTitle>
          <DialogDescription>
            配置SQL Server数据库连接信息
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>连接名称</FormLabel>
                    <FormControl>
                      <Input placeholder="我的SQL Server" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="server"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>服务器地址</FormLabel>
                    <FormControl>
                      <Input placeholder="localhost" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>端口</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    {/* <FormDescription className="text-xs">默认为1433</FormDescription> */}
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="database"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>数据库</FormLabel>
                    <FormControl>
                      <Input placeholder="master" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>用户名</FormLabel>
                    <FormControl>
                      <Input placeholder="sa" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>密码</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="connectionTimeout"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel>连接超时(秒)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <div className="space-y-3 pt-1">
                <FormField
                  control={form.control}
                  name="trustServerCertificate"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between space-x-2 space-y-0">
                      <div>
                        <FormLabel>信任服务器证书</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="encrypt"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between space-x-2 space-y-0">
                      <div>
                        <FormLabel>使用加密连接</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {testResult && (
              <div className={`p-4 rounded-md flex items-start space-x-2 ${testResult.success
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                {testResult.success ? (
                  <CheckCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={isTesting}
              >
                {isTesting ? '测试中...' : '测试连接'}
              </Button>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}