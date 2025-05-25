"use client"

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogTrigger
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Plus,
    Save,
    Trash2
} from 'lucide-react'
import { useSession } from '@/components/session/SessionContext'
import { WorkspaceService } from '@/lib/workspace'
import { Workspace, WorkspaceManager } from '@/types/workspace'
import { useToast } from '@/hooks/use-toast'

interface WorkspaceSelectorProps {
    currentWorkspace: Workspace | null
    onWorkspaceChange: (workspace: Workspace) => void
    onSaveWorkspace: () => void
}

export default function WorkspaceSelector({
    currentWorkspace,
    onWorkspaceChange,
    onSaveWorkspace
}: WorkspaceSelectorProps) {
    const { activeSession, isInitializing } = useSession()
    const [workspaceManager, setWorkspaceManager] = useState<WorkspaceManager>(() =>
        WorkspaceService.getWorkspaces()
    )
    const [newWorkspaceDialogOpen, setNewWorkspaceDialogOpen] = useState(false)
    const [workspaceName, setWorkspaceName] = useState('')
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
    const { toast } = useToast()

    // ✅ 添加 useEffect 来监听 activeSession 变化，重新加载工作区数据
    useEffect(() => {
        if (!isInitializing && activeSession) {
            // 当会话初始化完成且有活动会话时，重新加载工作区数据
            const latestManager = WorkspaceService.getWorkspaces()
            setWorkspaceManager(latestManager)
            
            // 如果当前没有选中的工作区，尝试找到对应当前会话的工作区
            if (!currentWorkspace) {
                const matchingWorkspace = WorkspaceService.findWorkspace(
                    latestManager,
                    activeSession.server,
                    activeSession.database
                )
                if (matchingWorkspace) {
                    onWorkspaceChange(matchingWorkspace)
                }
            }
        }
    }, [activeSession, isInitializing, currentWorkspace, onWorkspaceChange])

    // 获取当前选中的工作区
    const selectedWorkspace = currentWorkspace

    // 处理工作区切换
    const handleWorkspaceChange = (workspaceId: string) => {
        // 重新获取最新的工作区数据
        const latestManager = WorkspaceService.getWorkspaces()
        setWorkspaceManager(latestManager)

        const workspace = latestManager.workspaces.find(ws => ws.id === workspaceId)
        if (workspace) {
            onWorkspaceChange(workspace)
        }
    }

    // 处理创建新工作区
    const handleCreateWorkspace = () => {
        if (!activeSession || !workspaceName.trim()) return

        const newWorkspace = WorkspaceService.createWorkspace(
            activeSession.server,
            activeSession.database,
            activeSession.id,
            workspaceName.trim()
        )

        const updatedManager = WorkspaceService.addOrUpdateWorkspace(workspaceManager, newWorkspace)
        setWorkspaceManager(updatedManager)
        onWorkspaceChange(newWorkspace)

        setNewWorkspaceDialogOpen(false)
        setWorkspaceName('')
    }

    // 处理保存当前工作区
    const handleSaveCurrentWorkspace = () => {
        onSaveWorkspace()
        // ✅ 保存后重新加载工作区数据，确保状态同步
        const latestManager = WorkspaceService.getWorkspaces()
        setWorkspaceManager(latestManager)
        
        toast.success('工作区保存成功')
    }

    // 处理删除工作区
    const handleDeleteWorkspace = (workspaceId: string) => {
        const updatedManager = WorkspaceService.removeWorkspace(workspaceManager, workspaceId)
        setWorkspaceManager(updatedManager)

        // 如果删除的是当前工作区，切换到其他工作区或清空
        if (workspaceId === selectedWorkspace?.id) {
            const lastUsed = WorkspaceService.getLastUsedWorkspace(updatedManager)
            if (lastUsed) {
                onWorkspaceChange(lastUsed)
            }
        }

        setConfirmDeleteId(null)
    }

    // 格式化工作区显示名称
    const formatWorkspaceName = (workspace: Workspace) => {
        return `${workspace.connectionName} - ${workspace.database}`
    }

    return (
        <div className="flex items-center space-x-2">
            {/* 工作区选择器 */}
            <Select
                value={selectedWorkspace?.id || ""}
                onValueChange={handleWorkspaceChange}
                disabled={!activeSession || isInitializing}
            >
                <SelectTrigger className="w-[280px]">
                    <SelectValue placeholder={isInitializing ? "加载中..." : "选择工作区"} />
                </SelectTrigger>
                <SelectContent>
                    {workspaceManager.workspaces.map((workspace) => (
                        <SelectItem key={workspace.id} value={workspace.id}>
                            {formatWorkspaceName(workspace)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {/* 操作按钮组 */}
            <div className="flex items-center space-x-1">
                {/* 新建工作区按钮 */}
                <Dialog open={newWorkspaceDialogOpen} onOpenChange={setNewWorkspaceDialogOpen}>
                    <DialogTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={!activeSession || isInitializing}
                            title="新建工作区"
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>新建工作区</DialogTitle>
                            <DialogDescription>
                                为当前连接 ({activeSession?.server} - {activeSession?.database}) 创建新的工作区
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="workspace-name" className="text-right">
                                    工作区名称
                                </Label>
                                <Input
                                    id="workspace-name"
                                    value={workspaceName}
                                    onChange={(e) => setWorkspaceName(e.target.value)}
                                    className="col-span-3"
                                    placeholder="输入工作区名称"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && workspaceName.trim()) {
                                            handleCreateWorkspace()
                                        }
                                    }}
                                />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setNewWorkspaceDialogOpen(false)}>
                                取消
                            </Button>
                            <Button
                                onClick={handleCreateWorkspace}
                                disabled={!workspaceName.trim()}
                            >
                                创建
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* 保存当前工作区按钮 */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveCurrentWorkspace}
                    disabled={!selectedWorkspace || isInitializing}
                    title="保存当前工作区"
                >
                    <Save className="h-4 w-4" />
                </Button>

                {/* 删除按钮 */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectedWorkspace && setConfirmDeleteId(selectedWorkspace.id)}
                    disabled={!selectedWorkspace || isInitializing}
                    title="删除当前工作区"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>

            {/* 删除确认对话框 */}
            <Dialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>确认删除工作区</DialogTitle>
                        <DialogDescription>
                            确定要删除工作区 "{confirmDeleteId ? formatWorkspaceName(
                                workspaceManager.workspaces.find(ws => ws.id === confirmDeleteId)!
                            ) : ''}" 吗？此操作无法撤销。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>
                            取消
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => confirmDeleteId && handleDeleteWorkspace(confirmDeleteId)}
                        >
                            删除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
