"use client"

import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { SqlScript } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  PlusIcon,
  FolderIcon,
  FileIcon,
  Trash2Icon,
  PencilIcon,
  PlayIcon,
  SaveIcon,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { executeQuery } from '@/lib/api'
import SqlEditor from '@/components/sql/SqlEditor'
import { useSession } from '@/components/sql/SessionContext'
// 本地存储键
const SCRIPTS_STORAGE_KEY = 'sqlserver-scripts'
const GROUPS_STORAGE_KEY = 'sqlserver-script-groups'

export default function ScriptsPage() {
  // 脚本和分组状态
  const [scripts, setScripts] = useState<SqlScript[]>([])
  const [groups, setGroups] = useState<string[]>(['默认分组'])
  const [selectedGroup, setSelectedGroup] = useState<string>('默认分组')
  
  // 编辑状态
  const [isAddingScript, setIsAddingScript] = useState(false)
  const [isEditingScript, setIsEditingScript] = useState(false)
  const [isAddingGroup, setIsAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  
  // 当前编辑的脚本
  const [currentScript, setCurrentScript] = useState<SqlScript>({
    id: '',
    name: '',
    groupName: '默认分组',
    content: '',
    description: '',
    createdAt: '',
    updatedAt: ''
  })
  
  // 执行脚本
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState<string | null>(null)
  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false)
  
  const { toast } = useToast()
  const { activeSession } = useSession()
  
  // 加载脚本和分组
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    try {
      // 加载分组
      const savedGroups = localStorage.getItem(GROUPS_STORAGE_KEY)
      if (savedGroups) {
        const parsedGroups = JSON.parse(savedGroups) as string[]
        if (Array.isArray(parsedGroups) && parsedGroups.length > 0) {
          setGroups(parsedGroups)
        }
      }
      
      // 加载脚本
      const savedScripts = localStorage.getItem(SCRIPTS_STORAGE_KEY)
      if (savedScripts) {
        const parsedScripts = JSON.parse(savedScripts) as SqlScript[]
        if (Array.isArray(parsedScripts)) {
          setScripts(parsedScripts)
        }
      }
    } catch (err) {
      console.error('加载脚本数据失败:', err)
      toast.error('加载脚本数据失败')
    }
  }, [toast])
  
  // 保存脚本
  const saveScripts = (scriptsList: SqlScript[]) => {
    if (typeof window === 'undefined') return
    
    try {
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify(scriptsList))
    } catch (err) {
      console.error('保存脚本失败:', err)
      toast.error('保存脚本失败')
    }
  }
  
  // 保存分组
  const saveGroups = (groupsList: string[]) => {
    if (typeof window === 'undefined') return
    
    try {
      localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groupsList))
    } catch (err) {
      console.error('保存分组失败:', err)
      toast.error('保存分组失败')
    }
  }
  
  // 添加新分组
  const addGroup = () => {
    if (!newGroupName.trim()) {
      toast.error('分组名称不能为空')
      return
    }
    
    if (groups.includes(newGroupName.trim())) {
      toast.error('分组名称已存在')
      return
    }
    
    const updatedGroups = [...groups, newGroupName.trim()]
    setGroups(updatedGroups)
    saveGroups(updatedGroups)
    setNewGroupName('')
    setIsAddingGroup(false)
    toast.success(`已添加分组: ${newGroupName}`)
  }
  
  // 添加或更新脚本
  const saveScript = () => {
    if (!currentScript.name.trim()) {
      toast.error('脚本名称不能为空')
      return
    }
    
    if (!currentScript.content.trim()) {
      toast.error('脚本内容不能为空')
      return
    }
    
    const now = new Date().toISOString()
    let updatedScripts: SqlScript[]
    
    if (isEditingScript) {
      // 更新现有脚本
      updatedScripts = scripts.map(script => 
        script.id === currentScript.id 
          ? { ...currentScript, updatedAt: now } 
          : script
      )
      toast.success(`已更新脚本: ${currentScript.name}`)
    } else {
      // 添加新脚本
      const newScript: SqlScript = {
        ...currentScript,
        id: uuidv4(),
        groupName: currentScript.groupName || selectedGroup,
        createdAt: now,
        updatedAt: now
      }
      updatedScripts = [...scripts, newScript]
      toast.success(`已添加脚本: ${newScript.name}`)
    }
    
    setScripts(updatedScripts)
    saveScripts(updatedScripts)
    resetScriptForm()
  }
  
  // 删除脚本
  const deleteScript = (id: string) => {
    const scriptToDelete = scripts.find(s => s.id === id)
    if (!scriptToDelete) return
    
    const updatedScripts = scripts.filter(s => s.id !== id)
    setScripts(updatedScripts)
    saveScripts(updatedScripts)
    toast.success(`已删除脚本: ${scriptToDelete.name}`)
  }
  
  // 编辑脚本
  const editScript = (script: SqlScript) => {
    setCurrentScript(script)
    setIsEditingScript(true)
    setIsAddingScript(true)
  }
  
  // 执行脚本
  const executeScript = async (script: SqlScript) => {
    if (!activeSession?.id) {
      toast.error('没有活动的数据库会话')
      return
    }
    
    setIsExecuting(true)
    setExecutionResult(null)
    
    try {
      const result = await executeQuery(activeSession.id, script.content)
      
      if (result.error) {
        setExecutionResult(`执行失败: ${result.error}`)
      } else {
        const totalRows = result.result_sets.reduce((sum, rs) => sum + rs.rows.length, 0)
        setExecutionResult(`执行成功，返回 ${result.result_sets.length} 个结果集，共 ${totalRows} 行数据`)
      }
    } catch (err) {
      setExecutionResult(`执行出错: ${err}`)
    } finally {
      setIsExecuting(false)
      setIsResultDialogOpen(true)
    }
  }
  
  // 重置脚本表单
  const resetScriptForm = () => {
    setCurrentScript({
      id: '',
      name: '',
      groupName: selectedGroup,
      content: '',
      description: '',
      createdAt: '',
      updatedAt: ''
    })
    setIsAddingScript(false)
    setIsEditingScript(false)
  }
  
  // 按分组筛选脚本
  const filteredScripts = scripts.filter(script => script.groupName === selectedGroup)
  
  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">SQL脚本管理</h1>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={() => setIsAddingGroup(true)}
          >
            <FolderIcon className="h-4 w-4 mr-2" />
            添加分组
          </Button>
          <Button onClick={() => setIsAddingScript(true)}>
            <PlusIcon className="h-4 w-4 mr-2" />
            添加脚本
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-12 gap-6">
        {/* 左侧分组列表 */}
        <div className="col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>分组</CardTitle>
              <CardDescription>选择脚本分组</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {groups.map(group => (
                  <li 
                    key={group}
                    className={`px-3 py-2 rounded-md cursor-pointer flex items-center ${
                      selectedGroup === group ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                    onClick={() => setSelectedGroup(group)}
                  >
                    <FolderIcon className="h-4 w-4 mr-2" />
                    {group}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        
        {/* 右侧脚本列表 */}
        <div className="col-span-9">
          <Card>
            <CardHeader>
              <CardTitle>{selectedGroup}</CardTitle>
              <CardDescription>
                {filteredScripts.length} 个脚本
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredScripts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  此分组中没有脚本
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredScripts.map(script => (
                    <Card key={script.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg flex items-center">
                          <FileIcon className="h-4 w-4 mr-2" />
                          {script.name}
                        </CardTitle>
                        {script.description && (
                          <CardDescription className="line-clamp-2">
                            {script.description}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="pb-2">
                        <div className="bg-muted rounded-md p-2 h-24 overflow-hidden text-xs">
                          <pre className="whitespace-pre-wrap line-clamp-6">
                            {script.content}
                          </pre>
                        </div>
                      </CardContent>
                      <CardFooter className="flex justify-between pt-0">
                        <div className="text-xs text-muted-foreground">
                          更新于 {new Date(script.updatedAt).toLocaleString()}
                        </div>
                        <div className="flex gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => editScript(script)}
                            title="编辑"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => executeScript(script)}
                            disabled={!activeSession?.id || isExecuting}
                            title="执行"
                          >
                            <PlayIcon className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => deleteScript(script.id)}
                            title="删除"
                          >
                            <Trash2Icon className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* 添加/编辑脚本对话框 */}
      <Dialog open={isAddingScript} onOpenChange={(open) => {
        if (!open) resetScriptForm()
        setIsAddingScript(open)
      }}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {isEditingScript ? '编辑脚本' : '添加脚本'}
            </DialogTitle>
            <DialogDescription>
              {isEditingScript 
                ? '修改现有SQL脚本' 
                : '创建新的SQL脚本并保存到指定分组'
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4 flex-1 overflow-hidden">
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="name" className="text-right">
                名称
              </label>
              <Input
                id="name"
                value={currentScript.name}
                onChange={(e) => setCurrentScript({...currentScript, name: e.target.value})}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="group" className="text-right">
                分组
              </label>
              <Select
                value={currentScript.groupName || selectedGroup}
                onValueChange={(value) => setCurrentScript({...currentScript, groupName: value})}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="选择分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map(group => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-start gap-4">
              <label htmlFor="description" className="text-right pt-2">
                描述
              </label>
              <Textarea
                id="description"
                value={currentScript.description || ''}
                onChange={(e) => setCurrentScript({...currentScript, description: e.target.value})}
                className="col-span-3"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-4 items-start gap-4 flex-1 overflow-hidden">
              <label htmlFor="content" className="text-right pt-2">
                SQL内容
              </label>
              <div className="col-span-3 h-full min-h-[300px] border rounded-md overflow-hidden">
                <SqlEditor
                  value={currentScript.content}
                  onChange={(value) => setCurrentScript({...currentScript, content: value})}
                />
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={resetScriptForm}>
              取消
            </Button>
            <Button onClick={saveScript}>
              <SaveIcon className="h-4 w-4 mr-2" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 添加分组对话框 */}
      <Dialog open={isAddingGroup} onOpenChange={setIsAddingGroup}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>添加分组</DialogTitle>
            <DialogDescription>
              创建新的脚本分组
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="groupName" className="text-right">
                分组名称
              </label>
              <Input
                id="groupName"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingGroup(false)}>
              取消
            </Button>
            <Button onClick={addGroup}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* 执行结果对话框 */}
      <Dialog open={isResultDialogOpen} onOpenChange={setIsResultDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>执行结果</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-muted p-4 rounded-md">
              <pre className="whitespace-pre-wrap text-sm">
                {executionResult || '无结果'}
              </pre>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsResultDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
} 