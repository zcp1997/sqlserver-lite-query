import { useState } from 'react'
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConnectionConfig } from '@/types/database'
import { useConnections } from '@/hooks/useConnections'
import { 
  DatabaseIcon, 
  MoreVerticalIcon, 
  EditIcon, 
  TrashIcon, 
  PlayIcon, 
  PlusIcon, 
  SearchIcon
} from 'lucide-react'
import ConnectionDialog from './ConnectionDialog'

interface ConnectionListProps {
  onConnect: (connection: ConnectionConfig) => void
}

export default function ConnectionList({ onConnect }: ConnectionListProps) {
  const { 
    connections, 
    addConnection, 
    updateConnection, 
    deleteConnection 
  } = useConnections()
  
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState<ConnectionConfig | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  
  // 处理连接添加/更新
  const handleSaveConnection = (connection: ConnectionConfig) => {
    console.log('handleSaveConnection connection', connection)

    if (connection.id) {
      updateConnection(connection)
    } else {
      addConnection(connection)
    }
    setIsDialogOpen(false)
    setEditingConnection(null)
  }
  
  // 处理打开编辑对话框
  const handleEdit = (connection: ConnectionConfig) => {
    setEditingConnection(connection)
    setIsDialogOpen(true)
  }
  
  // 处理删除连接
  const handleDelete = (id: string) => {
    if (confirm('确定要删除此连接吗？')) {
      deleteConnection(id)
    }
  }
  
  // 处理添加新连接
  const handleAddNew = () => {
    setEditingConnection(null)
    setIsDialogOpen(true)
  }
  
  // 筛选连接
  const filteredConnections = connections.filter(conn => 
    conn.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conn.server.toLowerCase().includes(searchQuery.toLowerCase()) ||
    conn.database.toLowerCase().includes(searchQuery.toLowerCase())
  )
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center text-xl">
          <DatabaseIcon className="mr-2 h-5 w-5" />
          数据库连接
        </CardTitle>
        <CardDescription>
          管理您的SQL Server连接
        </CardDescription>
        
        <div className="flex items-center gap-2 pt-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索连接..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button onClick={handleAddNew}>
            <PlusIcon className="mr-1 h-4 w-4" />
            添加
          </Button>
        </div>
      </CardHeader>
      
      <CardContent>
        {filteredConnections.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>服务器</TableHead>
                <TableHead>数据库</TableHead>
                <TableHead className="w-[100px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredConnections.map((connection) => (
                <TableRow key={connection.id}>
                  <TableCell>{connection.name}</TableCell>
                  <TableCell>{connection.server}</TableCell>
                  <TableCell>{connection.database}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => {
                          console.log('Connect button clicked', connection)
                          onConnect(connection)
                        }}
                        title="连接"
                      >
                        <PlayIcon className="h-4 w-4" />
                      </Button>
                      
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVerticalIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(connection)}>
                            <EditIcon className="mr-2 h-4 w-4" />
                            编辑
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => connection.id && handleDelete(connection.id)}
                            className="text-destructive"
                          >
                            <TrashIcon className="mr-2 h-4 w-4" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <DatabaseIcon className="mb-2 h-10 w-10 text-muted-foreground" />
            <p className="mb-2 text-lg font-medium">没有数据库连接</p>
            <p className="mb-4 text-sm text-muted-foreground">
              {searchQuery ? '没有找到匹配的连接' : '请添加您的第一个数据库连接'}
            </p>
            {!searchQuery && (
              <Button onClick={handleAddNew}>
                <PlusIcon className="mr-1 h-4 w-4" />
                添加连接
              </Button>
            )}
          </div>
        )}
      </CardContent>
      
      <ConnectionDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        connection={editingConnection}
        onSave={handleSaveConnection}
      />
    </Card>
  )
} 