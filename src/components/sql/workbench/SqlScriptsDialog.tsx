import { useState, useEffect } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FolderOpen, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// Define the SqlScript type for clarity (adjust based on your actual type)
interface SqlScript {
  id: string;
  name: string;
  groupName: string;
  content: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
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
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const { toast } = useToast();

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

  // 新增：处理本地文件选择
  const handleSelectLocalFile = async () => {
    try {
      setIsLoadingFile(true);
      
      const filePath = await openFileDialog({
        title: '选择SQL或TXT文件',
        multiple: false,
        filters: [
          {
            name: 'SQL和文本文件',
            extensions: ['sql', 'txt']
          }
        ]
      });

      if (filePath) {
        // 读取文件内容
        const content = await readTextFile(filePath);
        
        if (content.trim()) {
          // 直接使用文件内容，显示确认对话框
          const fileName = filePath.split(/[/\\]/).pop() || '未知文件';
          setSelectedScript({
            id: `local-${Date.now()}`,
            name: fileName,
            groupName: '本地文件',
            content: content,
            description: `从本地文件导入: ${filePath}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          setShowConfirmDialog(true);
        } else {
          toast.error('选择的文件没有内容');
        }
      }
    } catch (error: any) {
      console.error('读取文件失败:', error);
      toast.error(error.message || '无法读取选择的文件');
    } finally {
      setIsLoadingFile(false);
    }
  };

  return (
    <>
      {/* 主对话框 - 脚本选择 */}
      <Dialog open={open && !showConfirmDialog} onOpenChange={handleMainDialogChange}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>选择 SQL 脚本</DialogTitle>
            <DialogDescription>从保存的脚本或本地文件中选择SQL</DialogDescription>
          </DialogHeader>

          {/* 新增：本地文件选择按钮 */}
          <div className="flex gap-2 pb-4 border-b">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectLocalFile}
              disabled={isLoadingFile}
              className="flex items-center gap-2"
            >
              <FolderOpen className="h-4 w-4" />
              {isLoadingFile ? '读取中...' : '选择本地文件'}
            </Button>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <FileText className="h-3 w-3" />
              支持 .sql 和 .txt 文件
            </div>
          </div>

          {Object.keys(scriptGroups).length === 0 ? (
            <p className="text-muted-foreground">暂无可用脚本，请先添加一些脚本或选择本地文件。</p>
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
        <DialogContent className="sm:max-w-[600px] max-h-[70vh]">
          <DialogHeader>
            <DialogTitle>确认选择</DialogTitle>
            <DialogDescription>
              选择后会覆盖当前页签的SQL内容，是否继续？
            </DialogDescription>
          </DialogHeader>
          
          {selectedScript && (
            <div className="py-4 min-h-0 flex-1 overflow-hidden">
              <p className="text-sm text-muted-foreground mb-2">即将加载的脚本：</p>
              <p className="text-sm font-medium mb-2 truncate" title={selectedScript.name}>
                {selectedScript.name}
              </p>
              {selectedScript.description && (
                <p className="text-xs text-muted-foreground mb-2 truncate" title={selectedScript.description}>
                  {selectedScript.description}
                </p>
              )}
              <div className="p-3 bg-muted rounded text-xs overflow-auto max-h-48 w-full">
                <pre className="whitespace-pre-wrap break-words overflow-wrap-anywhere font-mono text-xs leading-relaxed">
                  {selectedScript.content}
                </pre>
              </div>
            </div>
          )}
          
          <DialogFooter className="flex-shrink-0">
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