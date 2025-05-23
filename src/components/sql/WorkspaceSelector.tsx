// components/workspace/WorkspaceSelector.tsx
"use client"

import { useState } from 'react'
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
    PlusIcon,
    SaveIcon,
    FolderIcon,
    TrashIcon
} from 'lucide-react'
import { useSession } from '@/components/session/SessionContext'
import { WorkspaceService } from '@/lib/workspace'
import { Workspace, WorkspaceManager } from '@/types/workspace'

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
    const { activeSession } = useSession()
    const [workspaceManager, setWorkspaceManager] = useState<WorkspaceManager>(() =>
        WorkspaceService.getWorkspaces()
    )
    const [newWorkspaceDialogOpen, setNewWorkspaceDialogOpen] = useState(false)
    const [workspaceName, setWorkspaceName] = useState('')
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

    // 获取当前选中的工作区
    const selectedWorkspace = currentWorkspace

    // 处理工作区切换
    const handleWorkspaceChange = (workspaceId: string) => {
        const workspace = workspaceManager.workspaces.find(ws => ws.id === workspaceId)
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
            <div className="flex items-center space-x-1">
                <FolderIcon className="h-4 w-4 text-gray-500" />
                <Select
                    value={selectedWorkspace?.id || ""}
                    onValueChange={handleWorkspaceChange}
                    disabled={!activeSession}
                >
                    <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="选择工作区" />
                    </SelectTrigger>
                    <SelectContent>
                        {workspaceManager.workspaces.map((workspace) => (
                            <SelectItem key={workspace.id} value={workspace.id}>
                                <div className="flex items-center justify-between w-full">
                                    <span>{formatWorkspaceName(workspace)}</span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-4 w-4 p-0 ml-2 hover:bg-red-100"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setConfirmDeleteId(workspace.id)
                                        }}
                                    >
                                        <TrashIcon className="h-3 w-3 text-red-500" />
                                    </Button>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* 新建工作区按钮 */}
            <Dialog open={newWorkspaceDialogOpen} onOpenChange={setNewWorkspaceDialogOpen}>
                <DialogTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!activeSession}
                        title="新建工作区"
                    >
                        <PlusIcon className="h-4 w-4" />
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
                disabled={!selectedWorkspace}
                title="保存当前工作区"
            >
                <SaveIcon className="h-4 w-4" />
            </Button>

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