import { useState, useEffect } from 'react'
import { SqlScript } from '@/types/database'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog"
import { Button } from '@/components/ui/button'

interface SqlScriptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateTabContent: (content: string) => void;
}

export default function SqlScriptsDialog({
  open,
  onOpenChange,
  updateTabContent
}: SqlScriptsDialogProps) {
  const [scriptGroups, setScriptGroups] = useState<Record<string, SqlScript[]>>({})

  // 加载SQL脚本
  useEffect(() => {
    const raw = localStorage.getItem('sqlserver-scripts')
    if (!raw) return

    try {
      const list: SqlScript[] = JSON.parse(raw)
      const grouped: Record<string, SqlScript[]> = {}
      for (const script of list) {
        if (!grouped[script.groupName]) grouped[script.groupName] = []
        grouped[script.groupName].push(script)
      }
      setScriptGroups(grouped)
    } catch (err) {
      console.error('解析 sqlserver-scripts 失败', err)
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>选择 SQL 脚本</DialogTitle>
          <DialogDescription>从本地保存的脚本中选择</DialogDescription>
        </DialogHeader>

        {Object.keys(scriptGroups).length === 0 ? (
          <p className="text-muted-foreground">暂无脚本，请先添加。</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(scriptGroups).map(([groupName, scripts]) => (
              <div key={groupName}>
                <h4 className="font-semibold text-sm mb-1">{groupName}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  {scripts.map(script => (
                    <Button
                      key={script.id}
                      variant="outline"
                      className="justify-start"
                      onClick={() => {
                        updateTabContent(script.content);
                        onOpenChange(false);
                      }}
                    >
                      {script.name}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

