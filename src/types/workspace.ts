// types/workspace.ts
import { EditorTab } from '@/components/sql/workbench/EditorTabs'

export interface Workspace {
  id: string
  server: string
  database: string
  connectionId: string
  connectionName: string
  tabs: EditorTab[]
  activeTabId: string
  lastUsed: number // 时间戳
  tabCounter: number // 用于生成新标签页名称
}

export interface WorkspaceManager {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  lastUsedWorkspaceId: string | null
}