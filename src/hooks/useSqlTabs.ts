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
}

export function useSqlTabs(activeSession: Session | null): UseSqlTabsReturn {
  // 标签页状态
  const [sqlTabs, setSqlTabs] = useState<EditorTab[]>([])
  const [activeSqlTabId, setActiveSqlTabId] = useState<string>('')
  const [sqlQuery, setSqlQuery] = useState<string>('')
  const [tabCounter, setTabCounter] = useState(1)
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null)

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
    const targetTab = sqlTabs.find(tab => tab.id === tabId);
    if (targetTab) {
      setSqlQuery(targetTab.content);
    }

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
  }, [activeSqlTabId, sqlQuery, sqlTabs, currentWorkspace]);

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
    
    setCurrentWorkspace(workspace)
    
    if (workspace.tabs && workspace.tabs.length > 0) {
      // 确保所有标签页都有正确的sessionId
      const validTabs = workspace.tabs.map(tab => ({
        ...tab,
        sessionId: activeSession?.id || tab.sessionId
      }))
      
      // 确保activeTabId存在于tabs中
      const activeTabExists = validTabs.some(tab => tab.id === workspace.activeTabId)
      const finalActiveTabId = activeTabExists ? workspace.activeTabId : validTabs[0].id
      
      // 获取活动标签页的内容
      const activeTab = validTabs.find(tab => tab.id === finalActiveTabId)
      
      // 批量更新状态
      setSqlTabs(validTabs)
      setActiveSqlTabId(finalActiveTabId)
      
      // 设置正确的计数器，应该基于现有标签页的最大编号
      const maxTabNumber = validTabs.reduce((max, tab) => {
        const match = tab.title.match(/SQLQuery(\d+)/)
        const num = match ? parseInt(match[1]) : 0
        return Math.max(max, num)
      }, 0)
      setTabCounter(Math.max(maxTabNumber + 1, workspace.tabCounter || 1))
      
      // 设置当前查询内容 - 确保在设置了tabs之后再设置内容
      if (activeTab) {
        console.log('Setting active tab content:', activeTab.content)
        setSqlQuery(activeTab.content || '')
      } else {
        setSqlQuery('')
      }
      
      console.log('Loaded tabs:', validTabs.length, 'active:', finalActiveTabId, 'content:', activeTab?.content)
    } else {
      // 如果工作区没有标签页，创建默认标签页
      console.log('Creating default tab for workspace')
      
      const defaultTabId = uuidv4()
      const defaultTab: EditorTab = {
        id: defaultTabId,
        title: 'SQLQuery0',
        content: '',
        sessionId: activeSession?.id || '',
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

    // 更新工作区管理器中的活动状态
    const manager = WorkspaceService.getWorkspaces()
    const updatedManager = {
      ...manager,
      activeWorkspaceId: workspace.id,
      lastUsedWorkspaceId: workspace.id
    }
    WorkspaceService.saveWorkspaces(updatedManager)
  }, [activeSession?.id])

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

  // 初始化工作区和标签页
  useEffect(() => {
    if (!activeSession?.id) return

    const manager = WorkspaceService.getWorkspaces()
    
    // 查找当前会话对应的工作区
    let workspace = WorkspaceService.findWorkspace(
      manager,
      activeSession.server,
      activeSession.database
    )

    // 如果没有找到工作区，检查是否有最近使用的工作区
    if (!workspace) {
      const lastUsedWorkspace = WorkspaceService.getLastUsedWorkspace(manager)
      
      if (lastUsedWorkspace && 
          lastUsedWorkspace.server === activeSession.server && 
          lastUsedWorkspace.database === activeSession.database) {
        workspace = lastUsedWorkspace
      }
    }

    // 如果仍然没有工作区，创建新的
    if (!workspace) {
      workspace = WorkspaceService.createWorkspace(
        activeSession.server,
        activeSession.database,
        activeSession.connectionId || activeSession.id,
        activeSession.connectionName
      )
      
      const updatedManager = WorkspaceService.addOrUpdateWorkspace(manager, workspace)
      WorkspaceService.saveWorkspaces(updatedManager)
    } else {
      // 更新工作区的最后使用时间
      WorkspaceService.updateWorkspace(manager, workspace.id, {
        connectionId: activeSession.connectionId || activeSession.id,
        lastUsed: Date.now()
      })
    }

    // 加载工作区
    loadWorkspace(workspace)
  }, [activeSession?.id, activeSession, loadWorkspace])

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
      // 先保存当前工作区状态
      saveCurrentWorkspaceState()
      // 然后加载新工作区
      loadWorkspace(workspace)
    },
    saveCurrentWorkspace,
    setSqlTabs,
    setActiveSqlTabId
  };
}