// components/sql/EditorTabs.tsx
import { X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
}

export default function EditorTabs({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onTabAdd
}: EditorTabsProps) {
  return (
    <div className="flex items-center border-b overflow-x-auto">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`flex items-center px-3 py-2 border-r cursor-pointer ${
            activeTabId === tab.id ? 'bg-background' : 'bg-muted/30 hover:bg-muted/50'
          }`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="mr-2 max-w-[150px] truncate">
            {tab.title} {tab.isDirty && '*'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 rounded-full"
            onClick={(e) => {
              e.stopPropagation()
              onTabClose(tab.id)
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onTabAdd}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
