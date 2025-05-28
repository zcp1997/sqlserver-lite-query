import { X, Plus, MoreHorizontal, Edit, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useRef, useLayoutEffect } from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

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
  isExecuting?: boolean
  onTabRename?: (tabId: string, newTitle: string) => void
  onTabSort?: (newTabs: EditorTab[]) => void
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
  const [renamingTab, setRenamingTab] = useState<{ id: string; title: string } | null>(null)
  const [newTitle, setNewTitle] = useState('')

  const handleTabClick = (tabId: string) => {
    if (isExecuting) return
    onTabChange(tabId)
  }

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    if (isExecuting) return
    onTabClose(tabId)
  }

  const handleAddTab = () => {
    if (isExecuting) return
    onTabAdd()
  }

  const startRenaming = (tab: EditorTab) => {
    setRenamingTab({ id: tab.id, title: tab.title })
    setNewTitle(tab.title)
  }

  const handleRename = () => {
    if (renamingTab && newTitle.trim() && newTitle.trim() !== renamingTab.title && onTabRename) {
      onTabRename(renamingTab.id, newTitle.trim())
    }
    setRenamingTab(null)
    setNewTitle('')
  }

  const cancelRename = () => {
    setRenamingTab(null)
    setNewTitle('')
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
  function SortableTab({ tab, children }: { 
    tab: EditorTab, 
    children: (listeners: Record<string, Function>) => React.ReactNode 
  }) {
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
      >
        {children(listeners || {})}
      </div>
    )
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="flex items-center border-b overflow-x-auto">
            {tabs.map((tab) => (
              <SortableTab key={tab.id} tab={tab}>
                {(listeners: Record<string, Function>) => (
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
                    {/* 拖拽手柄区域 */}
                    <div 
                      className="mr-1 cursor-move opacity-60 hover:opacity-100 flex items-center"
                      {...listeners}
                    >
                      <div className="w-1 h-4 flex flex-col justify-center gap-[1px]">
                        <div className="w-full h-[2px] bg-current rounded-full"></div>
                        <div className="w-full h-[2px] bg-current rounded-full"></div>
                        <div className="w-full h-[2px] bg-current rounded-full"></div>
                      </div>
                    </div>
                    
                    <span
                      className="mr-2 max-w-[120px] truncate select-none"
                      title={tab.title}
                    >
                      {tab.title} {tab.isDirty && '*'}
                    </span>
                    
                    {/* Tab 菜单 */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 rounded-full mr-1 opacity-60 hover:opacity-100"
                          disabled={isExecuting}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!isExecuting) {
                              startRenaming(tab)
                            }
                          }}
                          disabled={isExecuting}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          重命名
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!isExecuting) {
                              handleTabClose(e as any, tab.id)
                            }
                          }}
                          disabled={isExecuting}
                          className="text-red-600"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          关闭标签页
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    
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
                )}
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

      {/* 重命名对话框 */}
      <Dialog open={!!renamingTab} onOpenChange={(open) => !open && cancelRename()}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>重命名标签页</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="请输入新的标签页名称"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename()
                } else if (e.key === 'Escape') {
                  cancelRename()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelRename}>
              取消
            </Button>
            <Button onClick={handleRename} disabled={!newTitle.trim()}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}