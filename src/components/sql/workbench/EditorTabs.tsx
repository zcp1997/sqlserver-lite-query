import { X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useRef, useLayoutEffect } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export interface EditorTab {
  id: string
  title: string
  content: string
  sessionId?: string
  isDirty?: boolean
}

interface EditorTabsProps {
  tabs: EditorTab[]
  activeTabId: string
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
  onTabAdd: () => void
  isExecuting?: boolean // 新增：是否正在执行查询
  onTabRename?: (tabId: string, newTitle: string) => void // 新增
  onTabSort?: (newTabs: EditorTab[]) => void // 新增
}

export default function EditorTabs({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onTabAdd,
  isExecuting = false,
  onTabRename,
  onTabSort
}: EditorTabsProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const inputWidthRef = useRef<HTMLInputElement>(null)
  const spanMeasureRef = useRef<HTMLSpanElement>(null)
  const [inputWidth, setInputWidth] = useState<number>(80)

  // 动态测量input宽度
  useLayoutEffect(() => {
    if (editingTabId && spanMeasureRef.current) {
      const width = spanMeasureRef.current.offsetWidth + 16 // 预留padding
      setInputWidth(Math.min(Math.max(width, 80), 200))
    }
  }, [editingTitle, editingTabId])

  const handleTabClick = (tabId: string) => {
    if (isExecuting) return // 执行中时禁止切换
    onTabChange(tabId)
  }

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    if (isExecuting) return // 执行中时禁止关闭
    onTabClose(tabId)
  }

  const handleAddTab = () => {
    if (isExecuting) return // 执行中时禁止添加
    onTabAdd()
  }

  // dnd-kit 相关
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleDragEnd = (event: any) => {
    const { active, over } = event
    if (active?.id && over?.id && active.id !== over.id) {
      const oldIndex = tabs.findIndex(tab => tab.id === active.id)
      const newIndex = tabs.findIndex(tab => tab.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1) {
        const newTabs = arrayMove(tabs, oldIndex, newIndex)
        onTabSort && onTabSort(newTabs)
      }
    }
  }

  // 单个tab的Sortable包装
  function SortableTab({ tab, children }: { tab: EditorTab, children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id })
    return (
      <div
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.5 : 1,
          zIndex: isDragging ? 99 : undefined
        }}
        {...attributes}
        {...listeners}
      >
        {children}
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tabs.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex items-center border-b overflow-x-auto">
          {tabs.map((tab) => (
            <SortableTab key={tab.id} tab={tab}>
              <div
                className={`flex items-center px-3 py-2 border-r transition-colors
                  ${activeTabId === tab.id
                    ? 'bg-primary border-b-2 border-b-primary text-primary-foreground font-medium'
                    : 'bg-muted/30 hover:bg-muted/50'
                  }
                  ${isExecuting 
                    ? 'cursor-not-allowed opacity-60' 
                    : 'cursor-pointer'
                  }`}
                onClick={() => handleTabClick(tab.id)}
              >
                {editingTabId === tab.id ? (
                  <>
                    <input
                      className="mr-2 truncate bg-transparent border border-primary rounded px-1 text-sm focus:outline-none"
                      style={{ width: inputWidth, minWidth: 80, maxWidth: 200 }}
                      value={editingTitle}
                      autoFocus
                      ref={inputWidthRef}
                      onChange={e => setEditingTitle(e.target.value)}
                      onBlur={() => {
                        if (editingTitle.trim() && editingTitle !== tab.title && onTabRename) {
                          onTabRename(tab.id, editingTitle.trim())
                        }
                        setEditingTabId(null)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (editingTitle.trim() && editingTitle !== tab.title && onTabRename) {
                            onTabRename(tab.id, editingTitle.trim())
                          }
                          setEditingTabId(null)
                        } else if (e.key === 'Escape') {
                          setEditingTabId(null)
                        }
                      }}
                    />
                    {/* 隐藏span用于测量宽度，样式需与input一致 */}
                    <span
                      ref={spanMeasureRef}
                      className="invisible absolute whitespace-pre text-sm px-1"
                      style={{
                        fontFamily: 'inherit',
                        fontWeight: 'inherit',
                        letterSpacing: 'inherit',
                        padding: 0,
                        margin: 0,
                        border: 0,
                        whiteSpace: 'pre',
                      }}
                    >
                      {editingTitle || ' '}
                    </span>
                  </>
                ) : (
                  <span
                    className="mr-2 max-w-[120px] truncate select-none"
                    title={tab.title}
                    onDoubleClick={e => {
                      e.stopPropagation()
                      if (!isExecuting) {
                        setEditingTabId(tab.id)
                        setEditingTitle(tab.title)
                      }
                    }}
                  >
                    {tab.title} {tab.isDirty && '*'}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0 rounded-full"
                  disabled={isExecuting}
                  onClick={(e) => handleTabClose(e, tab.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </SortableTab>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={isExecuting}
            onClick={handleAddTab}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </SortableContext>
    </DndContext>
  )
}