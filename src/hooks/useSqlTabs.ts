import { useState, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { EditorTab } from '@/components/sql/workbench/EditorTabs'
import { QuerySession as Session } from '@/types/database'

export function useSqlTabs(activeSession: Session | null) {
  // 标签页状态
  const [sqlTabs, setSqlTabs] = useState<EditorTab[]>([])
  const [activeSqlTabId, setActiveSqlTabId] = useState<string>('')
  const [sqlQuery, setSqlQuery] = useState<string>('')

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
  }, [activeSqlTabId, sqlQuery, sqlTabs]);

  // 内容更新函数
  const updateTabContent = useCallback((content: string) => {
    setSqlQuery(content);
    // 同步更新对应tab的内容
    setSqlTabs(prev => prev.map(tab =>
      tab.id === activeSqlTabId
        ? { ...tab, content, isDirty: tab.content !== content }
        : tab
    ));
  }, [activeSqlTabId]);

  // 初始化默认标签页
  useEffect(() => {
    if (sqlTabs.length === 0 && activeSession?.id) {
      const newTabId = uuidv4()
      const newTab: EditorTab = {
        id: newTabId,
        title: 'SQLQuery1',
        content: '',
        sessionId: activeSession.id,
        isDirty: false
      }
      setSqlTabs([newTab])
      setActiveSqlTabId(newTabId)
      setSqlQuery('')
    }
  }, [activeSession?.id, sqlTabs.length]);

  // 添加新标签页
  const addNewTab = useCallback(() => {
    if (!activeSession) return

    // 保存当前tab内容
    if (activeSqlTabId && sqlQuery !== undefined) {
      setSqlTabs(prev => prev.map(tab =>
        tab.id === activeSqlTabId
          ? { ...tab, content: sqlQuery, isDirty: tab.content !== sqlQuery }
          : tab
      ));
    }

    const tabCount = sqlTabs.length + 1
    const newTabId = uuidv4()
    const newTab: EditorTab = {
      id: newTabId,
      title: `SQLQuery${tabCount}`,
      content: '',
      sessionId: activeSession.id,
      isDirty: false
    }

    setSqlTabs(prev => [...prev, newTab])
    setActiveSqlTabId(newTabId)
    setSqlQuery('')
  }, [activeSession, activeSqlTabId, sqlQuery, sqlTabs.length]);

  // 关闭标签页逻辑
  const closeTab = useCallback((tabId: string) => {
    if (sqlTabs.length <= 1) {
      // 不允许关闭最后一个tab
      return;
    }

    // 如果关闭的是当前活动标签页，需要切换到其他标签页
    if (tabId === activeSqlTabId) {
      const tabIndex = sqlTabs.findIndex(t => t.id === tabId)
      let newActiveTabId = '';

      if (tabIndex > 0) {
        newActiveTabId = sqlTabs[tabIndex - 1].id
      } else if (sqlTabs.length > 1) {
        newActiveTabId = sqlTabs[1].id
      }

      if (newActiveTabId) {
        const newActiveTab = sqlTabs.find(t => t.id === newActiveTabId);
        if (newActiveTab) {
          setActiveSqlTabId(newActiveTabId);
          setSqlQuery(newActiveTab.content);
        }
      }
    }

    setSqlTabs(prev => prev.filter(t => t.id !== tabId))
  }, [sqlTabs, activeSqlTabId]);

  return {
    sqlTabs,
    activeSqlTabId,
    sqlQuery,
    setSqlQuery,
    handleTabChange,
    updateTabContent,
    addNewTab,
    closeTab
  };
}
