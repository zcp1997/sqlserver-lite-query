// hooks/useSqlTabs.ts
import { useState, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { EditorTab } from '@/components/sql/workbench/EditorTabs'
import { QuerySession as Session } from '@/types/database'
import { WorkspaceService } from '@/lib/workspace'
import { Workspace } from '@/types/workspace'

interface UseSqlTabsReturn {
  sqlTabs: EditorTab[]
  activeSqlTabId: string
  sqlQuery: string
  setSqlQuery: (query: string) => void
  handleTabChange: (tabId: string) => void
  updateTabContent: (content: string) => void
  addNewTab: () => void
  closeTab: (tabId: string) => void
  currentWorkspace: Workspace | null
  // 新增方法用于支持工作区切换
  loadWorkspace: (workspace: Workspace) => void
  saveCurrentWorkspace: () => void
  setSqlTabs: (tabs: EditorTab[]) => void
  setActiveSqlTabId: (tabId: string) => void
  handleTabRename: (tabId: string, newTitle: string) => void
  moveTab: (newTabs: EditorTab[]) => void
}

export function useSqlTabs(activeSession: Session | null): UseSqlTabsReturn {
  // 标签页状态
  const [sqlTabs, setSqlTabs] = useState<EditorTab[]>([])
  const [activeSqlTabId, setActiveSqlTabId] = useState<string>('')
  const [sqlQuery, setSqlQuery] = useState<string>('')
  const [tabCounter, setTabCounter] = useState(1)
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null)
  const [isExternalLoading, setIsExternalLoading] = useState(false) // 新增：标记是否正在外部加载

  // tab切换处理函数
  const handleTabChange = useCallback((tabId: string) => {
    // 保存当前tab的内容
    if (activeSqlTabId && sqlQuery !== undefined) {
      setSqlTabs(prev => prev.map(tab =>
        tab.id === activeSqlTabId
          ? { ...tab, content: sqlQuery, isDirty: tab.content !== sqlQuery }
          : tab
      ));
    }

    // 切换到新tab并加载其内容
    setActiveSqlTabId(tabId);

    // 使用回调的方式获取最新的tabs状态
    setSqlTabs(currentTabs => {
      const targetTab = currentTabs.find(tab => tab.id === tabId);
      if (targetTab) {
        // 延迟设置内容，确保activeTabId已更新
        setTimeout(() => {
          setSqlQuery(targetTab.content);
        }, 0);
      }
      return currentTabs;
    });

    // 更新工作区的活动标签页
    if (currentWorkspace) {
      const manager = WorkspaceService.getWorkspaces()
      WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
        activeTabId: tabId,
        tabs: sqlTabs.map(tab =>
          tab.id === activeSqlTabId
            ? { ...tab, content: sqlQuery, isDirty: tab.content !== sqlQuery }
            : tab
        )
      })
    }
  }, [activeSqlTabId, sqlQuery, currentWorkspace]);

  // 内容更新函数
  const updateTabContent = useCallback((content: string) => {
    setSqlQuery(content);
    // 同步更新对应tab的内容
    setSqlTabs(prev => prev.map(tab =>
      tab.id === activeSqlTabId
        ? { ...tab, content, isDirty: tab.content !== content }
        : tab
    ));

    // 更新工作区
    if (currentWorkspace) {
      const manager = WorkspaceService.getWorkspaces()
      const updatedTabs = sqlTabs.map(tab =>
        tab.id === activeSqlTabId
          ? { ...tab, content, isDirty: tab.content !== content }
          : tab
      )
      WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
        tabs: updatedTabs
      })
    }
  }, [activeSqlTabId, sqlTabs, currentWorkspace]);

  // 添加新标签页
  const addNewTab = useCallback(() => {
    if (!activeSession || !currentWorkspace) return

    // 保存当前tab内容
    if (activeSqlTabId && sqlQuery !== undefined) {
      setSqlTabs(prev => prev.map(tab =>
        tab.id === activeSqlTabId
          ? { ...tab, content: sqlQuery, isDirty: tab.content !== sqlQuery }
          : tab
      ));
    }

    const newTabId = uuidv4()
    const newTab: EditorTab = {
      id: newTabId,
      title: `SQLQuery${tabCounter}`,
      content: '',
      sessionId: activeSession.id,
      isDirty: false
    }

    const updatedTabs = [...sqlTabs, newTab]
    setSqlTabs(updatedTabs)
    setActiveSqlTabId(newTabId)
    setSqlQuery('')
    setTabCounter(prev => prev + 1)

    // 更新工作区
    const manager = WorkspaceService.getWorkspaces()
    WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
      tabs: updatedTabs,
      activeTabId: newTabId,
      tabCounter: tabCounter + 1
    })
  }, [activeSession, activeSqlTabId, sqlQuery, tabCounter, sqlTabs, currentWorkspace]);

  // 关闭标签页逻辑
  const closeTab = useCallback((tabId: string) => {
    if (sqlTabs.length <= 1 || !currentWorkspace) {
      return;
    }

    let newActiveTabId = activeSqlTabId;
    let newSqlQuery = sqlQuery;

    // 如果关闭的是当前活动标签页，需要切换到其他标签页
    if (tabId === activeSqlTabId) {
      const tabIndex = sqlTabs.findIndex(t => t.id === tabId)

      if (tabIndex > 0) {
        newActiveTabId = sqlTabs[tabIndex - 1].id
        newSqlQuery = sqlTabs[tabIndex - 1].content
      } else if (sqlTabs.length > 1) {
        newActiveTabId = sqlTabs[1].id
        newSqlQuery = sqlTabs[1].content
      }

      setActiveSqlTabId(newActiveTabId);
      setSqlQuery(newSqlQuery);
    }

    const updatedTabs = sqlTabs.filter(t => t.id !== tabId)
    setSqlTabs(updatedTabs)

    // 更新工作区
    const manager = WorkspaceService.getWorkspaces()
    WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
      tabs: updatedTabs,
      activeTabId: newActiveTabId
    })
  }, [sqlTabs, activeSqlTabId, sqlQuery, currentWorkspace]);

  // 保存当前工作区状态的辅助函数
  const saveCurrentWorkspaceState = useCallback(() => {
    if (currentWorkspace && activeSqlTabId && sqlTabs.length > 0) {
      const manager = WorkspaceService.getWorkspaces()
      const currentTabs = sqlTabs.map(tab =>
        tab.id === activeSqlTabId
          ? { ...tab, content: sqlQuery, isDirty: tab.content !== sqlQuery }
          : tab
      )
      WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
        tabs: currentTabs,
        activeTabId: activeSqlTabId,
        tabCounter: tabCounter
      })
    }
  }, [currentWorkspace, activeSqlTabId, sqlTabs, sqlQuery, tabCounter])

  // 加载工作区 - 修复版本
  const loadWorkspace = useCallback((workspace: Workspace) => {
    console.log('Loading workspace:', workspace.id, 'with tabs:', workspace.tabs?.length || 0)

    // 更新工作区管理器中的活动状态
    const manager = WorkspaceService.getWorkspaces()
    const updatedManager = {
      ...manager,
      activeWorkspaceId: workspace.id,
      lastUsedWorkspaceId: workspace.id
    }
    WorkspaceService.saveWorkspaces(updatedManager)

    // 设置当前工作区
    setCurrentWorkspace(workspace)

    if (workspace.tabs && workspace.tabs.length > 0) {
      // 确保所有标签页都有正确的sessionId
      const validTabs = workspace.tabs.map(tab => ({
        ...tab,
        sessionId: workspace.connectionId // 使用工作区的 connectionId
      }))

      // 确保activeTabId存在于tabs中
      const activeTabExists = validTabs.some(tab => tab.id === workspace.activeTabId)
      const finalActiveTabId = activeTabExists ? workspace.activeTabId : validTabs[0].id

      // 获取活动标签页的内容
      const activeTab = validTabs.find(tab => tab.id === finalActiveTabId)

      // 设置正确的计数器，应该基于现有标签页的最大编号
      const maxTabNumber = validTabs.reduce((max, tab) => {
        const match = tab.title.match(/SQLQuery(\d+)/)
        const num = match ? parseInt(match[1]) : 0
        return Math.max(max, num)
      }, 0)

      setSqlTabs(validTabs)
      setActiveSqlTabId(finalActiveTabId)
      setTabCounter(Math.max(maxTabNumber + 1, workspace.tabCounter || 1))
      setSqlQuery(activeTab?.content || '')

      console.log('Loaded tabs:', validTabs.length, 'active:', finalActiveTabId, 'content:', activeTab?.content)
    } else {
      // 如果工作区没有标签页，创建默认标签页
      console.log('Creating default tab for workspace')

      const defaultTabId = uuidv4()
      const defaultTab: EditorTab = {
        id: defaultTabId,
        title: 'SQLQuery0',
        content: '',
        sessionId: workspace.connectionId, // 使用工作区的 connectionId
        isDirty: false
      }

      setSqlTabs([defaultTab])
      setActiveSqlTabId(defaultTabId)
      setSqlQuery('')
      setTabCounter(1)

      // 更新工作区以包含默认标签页
      const manager = WorkspaceService.getWorkspaces()
      WorkspaceService.updateWorkspace(manager, workspace.id, {
        tabs: [defaultTab],
        activeTabId: defaultTabId,
        tabCounter: 1
      })
    }
  }, []) // 移除 activeSession 依赖，因为我们现在使用工作区的 connectionId

  // 添加useEffect确保状态同步
  useEffect(() => {
    if (sqlTabs.length > 0 && activeSqlTabId) {
      const activeTab = sqlTabs.find(tab => tab.id === activeSqlTabId)
      if (activeTab && activeTab.content !== sqlQuery) {
        setSqlQuery(activeTab.content)
      }
    }
  }, [sqlTabs, activeSqlTabId])

  // 保存当前工作区 - 新增方法
  const saveCurrentWorkspace = useCallback(() => {
    if (!currentWorkspace) return

    // 先保存当前编辑中的内容
    const currentTabs = sqlTabs.map(tab =>
      tab.id === activeSqlTabId
        ? { ...tab, content: sqlQuery, isDirty: tab.content !== sqlQuery }
        : tab
    )

    const manager = WorkspaceService.getWorkspaces()
    WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
      tabs: currentTabs,
      activeTabId: activeSqlTabId,
      tabCounter: tabCounter
    })

    console.log('Saved workspace with tabs:', currentTabs.length)
  }, [currentWorkspace, sqlTabs, activeSqlTabId, sqlQuery, tabCounter])

  // 初始化工作区和标签页 - 只在会话变化时触发
  useEffect(() => {
    if (!activeSession?.id) return

    // 如果正在外部加载，跳过内部逻辑
    if (isExternalLoading) {
      console.log('External loading in progress, skipping useEffect')
      return
    }

    // 检查当前工作区是否属于当前会话
    if (currentWorkspace && currentWorkspace.connectionId === (activeSession.connectionId || activeSession.id)) {
      // 如果当前工作区属于当前会话，不需要重新加载
      console.log('Current workspace belongs to active session, skipping reload')
      return
    }

    console.log('Need to find workspace for session:', activeSession.id, 'current workspace:', currentWorkspace?.id)

    const manager = WorkspaceService.getWorkspaces()
    console.log('Manager state:', {
      activeWorkspaceId: manager.activeWorkspaceId,
      lastUsedWorkspaceId: manager.lastUsedWorkspaceId,
      workspaceCount: manager.workspaces.length
    })

    // 优先使用管理器中的活动工作区（如果它属于当前会话）
    let workspace: Workspace | null = null

    // 首先检查管理器中的活动工作区
    if (manager.activeWorkspaceId) {
      const activeWorkspace = manager.workspaces.find(ws => ws.id === manager.activeWorkspaceId)
      console.log('Active workspace from manager:', activeWorkspace?.id, activeWorkspace?.workspaceName, 'connectionId:', activeWorkspace?.connectionId)
      if (activeWorkspace && activeWorkspace.connectionId === (activeSession.connectionId || activeSession.id)) {
        workspace = activeWorkspace
        console.log('Using active workspace from manager:', workspace.id, workspace.workspaceName)
      }
    }

    // 如果没有找到匹配的活动工作区，则尝试其他方法
    if (!workspace) {
      // 其余逻辑保持不变...
    }

    // 加载工作区
    if (workspace) {
      console.log('Loading workspace from useEffect:', workspace.id, workspace.workspaceName)
      loadWorkspace(workspace)
    }
  }, [activeSession?.id, activeSession, loadWorkspace, currentWorkspace, isExternalLoading])

  // 新增：tab重命名
  const handleTabRename = useCallback((tabId: string, newTitle: string) => {
    setSqlTabs(prevTabs => {
      const updatedTabs = prevTabs.map(tab =>
        tab.id === tabId ? { ...tab, title: newTitle } : tab
      )
      // 同步到workspace
      if (currentWorkspace) {
        const manager = WorkspaceService.getWorkspaces()
        WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
          tabs: updatedTabs
        })
      }
      return updatedTabs
    })
  }, [currentWorkspace])

  // 拖拽排序tab
  const moveTab = useCallback((newTabs: EditorTab[]) => {
    setSqlTabs(newTabs)
    if (currentWorkspace) {
      const manager = WorkspaceService.getWorkspaces()
      WorkspaceService.updateWorkspace(manager, currentWorkspace.id, {
        tabs: newTabs
      })
    }
  }, [currentWorkspace])

  return {
    sqlTabs,
    activeSqlTabId,
    sqlQuery,
    setSqlQuery,
    handleTabChange,
    updateTabContent,
    addNewTab,
    closeTab,
    currentWorkspace,
    // 新增的方法
    loadWorkspace: (workspace: Workspace) => {
      console.log('External loadWorkspace called with workspace:', workspace.id, workspace.workspaceName)
      // 设置外部加载标志
      setIsExternalLoading(true)
      // 先保存当前工作区状态
      saveCurrentWorkspaceState()
      // 然后加载新工作区
      loadWorkspace(workspace)
      // 延迟重置外部加载标志，确保 useEffect 不会立即触发
      setTimeout(() => {
        console.log('Resetting isExternalLoading flag')
        setIsExternalLoading(false)
      }, 100) // 减少延迟时间到100ms
    },
    saveCurrentWorkspace,
    setSqlTabs,
    setActiveSqlTabId,
    handleTabRename,
    moveTab
  };
}