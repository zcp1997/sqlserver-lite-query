import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// Define the SqlScript type for clarity (adjust based on your actual type)
interface SqlScript {
  id: string;
  name: string;
  groupName: string;
  content: string;
}

interface SqlScriptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updateTabContent: (content: string) => void;
}

export default function SqlScriptsDialog({
  open,
  onOpenChange,
  updateTabContent,
}: SqlScriptsDialogProps) {
  const [scriptGroups, setScriptGroups] = useState<Record<string, SqlScript[]>>({});
  const [selectedScript, setSelectedScript] = useState<SqlScript | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Load SQL scripts from localStorage - 修复bug2：当对话框打开时重新加载脚本
  useEffect(() => {
    if (!open) return;
    
    const raw = localStorage.getItem('sqlserver-scripts');
    if (!raw) {
      setScriptGroups({});
      return;
    }

    try {
      const list: SqlScript[] = JSON.parse(raw);
      const grouped: Record<string, SqlScript[]> = {};
      for (const script of list) {
        if (!grouped[script.groupName]) grouped[script.groupName] = [];
        grouped[script.groupName].push(script);
      }
      setScriptGroups(grouped);
    } catch (err) {
      console.error('Failed to parse sqlserver-scripts', err);
      setScriptGroups({});
    }
  }, [open]); // 修复bug2：添加open到依赖数组

  // Handle script selection - 修复bug1：显示确认对话框而不是嵌套Dialog
  const handleSelectScript = (script: SqlScript) => {
    setSelectedScript(script);
    setShowConfirmDialog(true);
  };

  // Handle confirmation
  const handleConfirm = () => {
    if (selectedScript) {
      updateTabContent(selectedScript.content);
      onOpenChange(false);
      setSelectedScript(null);
      setShowConfirmDialog(false);
    }
  };

  // Handle cancel - 修复bug1：正确处理取消操作
  const handleCancel = () => {
    setSelectedScript(null);
    setShowConfirmDialog(false);
  };

  // 当主对话框关闭时，重置所有状态
  const handleMainDialogChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedScript(null);
      setShowConfirmDialog(false);
    }
    onOpenChange(isOpen);
  };

  return (
    <>
      {/* 主对话框 - 脚本选择 */}
      <Dialog open={open && !showConfirmDialog} onOpenChange={handleMainDialogChange}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>选择 SQL 脚本</DialogTitle>
            <DialogDescription>从保存的脚本中选择SQL</DialogDescription>
          </DialogHeader>

          {Object.keys(scriptGroups).length === 0 ? (
            <p className="text-muted-foreground">暂无可用脚本，请先添加一些脚本。</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(scriptGroups).map(([groupName, scripts]) => (
                <div key={groupName}>
                  <h4 className="font-semibold text-sm mb-1">{groupName}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {scripts.map((script) => (
                      <Button
                        key={script.id}
                        variant="outline"
                        size="sm"
                        className="justify-start text-left h-auto py-2 px-3"
                        onClick={() => handleSelectScript(script)}
                      >
                        <div className="truncate">
                          {script.name}
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 确认对话框 - 修复bug1：独立的确认对话框 */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>确认选择</DialogTitle>
            <DialogDescription>
              选择后会覆盖当前页签的SQL内容，是否继续？
            </DialogDescription>
          </DialogHeader>
          
          {selectedScript && (
            <div className="py-4">
              <p className="text-sm text-muted-foreground mb-2">即将加载的脚本：</p>
              <p className="text-sm font-medium">{selectedScript.name}</p>
              <div className="mt-2 p-2 bg-muted rounded text-xs max-h-32 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{selectedScript.content}</pre>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              取消
            </Button>
            <Button onClick={handleConfirm}>
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}