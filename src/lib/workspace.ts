// lib/workspace.ts
import { Workspace, WorkspaceManager } from '@/types/workspace'
import { EditorTab } from '@/components/sql/workbench/EditorTabs'
import { v4 as uuidv4 } from 'uuid'

const WORKSPACE_STORAGE_KEY = 'sql_workspaces'

export class WorkspaceService {
  // 获取所有工作区
  static getWorkspaces(): WorkspaceManager {
    if (typeof window === 'undefined') {
      return {
        workspaces: [],
        activeWorkspaceId: null,
        lastUsedWorkspaceId: null
      }
    }

    try {
      const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error)
    }

    return {
      workspaces: [],
      activeWorkspaceId: null,
      lastUsedWorkspaceId: null
    }
  }

  // 保存工作区
  static saveWorkspaces(manager: WorkspaceManager): void {
    if (typeof window === 'undefined') return

    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(manager))
    } catch (error) {
      console.error('Failed to save workspaces:', error)
    }
  }

  // 创建新工作区
  static createWorkspace(
    server: string,
    database: string,
    connectionId: string,
    connectionName: string
  ): Workspace {
    const workspaceId = uuidv4()
    const defaultTabId = uuidv4()
    
    const defaultTab: EditorTab = {
      id: defaultTabId,
      title: 'SQLQuery0',
      content: '',
      sessionId: connectionId,
      isDirty: false
    }

    return {
      id: workspaceId,
      server,
      database,
      connectionId,
      connectionName,
      tabs: [defaultTab],
      activeTabId: defaultTabId,
      lastUsed: Date.now(),
      tabCounter: 1
    }
  }

  // 根据 server 和 database 查找工作区
  static findWorkspace(
    manager: WorkspaceManager,
    server: string,
    database: string
  ): Workspace | null {
    return manager.workspaces.find(
      ws => ws.server === server && ws.database === database
    ) || null
  }

  // 更新工作区
  static updateWorkspace(
    manager: WorkspaceManager,
    workspaceId: string,
    updates: Partial<Workspace>
  ): WorkspaceManager {
    const updatedWorkspaces = manager.workspaces.map(ws =>
      ws.id === workspaceId
        ? { ...ws, ...updates, lastUsed: Date.now() }
        : ws
    )

    const newManager = {
      ...manager,
      workspaces: updatedWorkspaces,
      lastUsedWorkspaceId: workspaceId
    }

    this.saveWorkspaces(newManager)
    return newManager
  }

  // 添加或更新工作区
  static addOrUpdateWorkspace(
    manager: WorkspaceManager,
    workspace: Workspace
  ): WorkspaceManager {
    const existingIndex = manager.workspaces.findIndex(ws => ws.id === workspace.id)
    
    let updatedWorkspaces: Workspace[]
    if (existingIndex >= 0) {
      updatedWorkspaces = [...manager.workspaces]
      updatedWorkspaces[existingIndex] = { ...workspace, lastUsed: Date.now() }
    } else {
      updatedWorkspaces = [...manager.workspaces, { ...workspace, lastUsed: Date.now() }]
    }

    const newManager = {
      ...manager,
      workspaces: updatedWorkspaces,
      activeWorkspaceId: workspace.id,
      lastUsedWorkspaceId: workspace.id
    }

    this.saveWorkspaces(newManager)
    return newManager
  }

  // 获取最近使用的工作区
  static getLastUsedWorkspace(manager: WorkspaceManager): Workspace | null {
    if (!manager.lastUsedWorkspaceId) {
      // 如果没有记录最后使用的，找最近使用的
      const sorted = [...manager.workspaces].sort((a, b) => b.lastUsed - a.lastUsed)
      return sorted[0] || null
    }

    return manager.workspaces.find(ws => ws.id === manager.lastUsedWorkspaceId) || null
  }

  // 删除工作区
  static removeWorkspace(
    manager: WorkspaceManager,
    workspaceId: string
  ): WorkspaceManager {
    const updatedWorkspaces = manager.workspaces.filter(ws => ws.id !== workspaceId)
    
    const newManager = {
      ...manager,
      workspaces: updatedWorkspaces,
      activeWorkspaceId: manager.activeWorkspaceId === workspaceId ? null : manager.activeWorkspaceId,
      lastUsedWorkspaceId: manager.lastUsedWorkspaceId === workspaceId ? null : manager.lastUsedWorkspaceId
    }

    this.saveWorkspaces(newManager)
    return newManager
  }
}