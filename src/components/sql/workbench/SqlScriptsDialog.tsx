import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
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

  // Load SQL scripts from localStorage
  useEffect(() => {
    const raw = localStorage.getItem('sqlserver-scripts');
    if (!raw) return;

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
    }
  }, []);

  // Handle script selection
  const handleSelectScript = (script: SqlScript) => {
    setSelectedScript(script);
  };

  // Handle confirmation
  const handleConfirm = () => {
    if (selectedScript) {
      updateTabContent(selectedScript.content);
      onOpenChange(false);
      setSelectedScript(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>选择 SQL 脚本</DialogTitle>
          <DialogDescription>从保存的脚本中选择SQL</DialogDescription>
        </DialogHeader>

        {Object.keys(scriptGroups).length === 0 ? (
          <p className="text-muted-foreground">No scripts available. Please add some first.</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(scriptGroups).map(([groupName, scripts]) => (
              <div key={groupName}>
                <h4 className="font-semibold text-sm mb-1">{groupName}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {scripts.map((script) => (
                    <Dialog key={script.id}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="justify-start text-left"
                          onClick={() => handleSelectScript(script)}
                        >
                          {script.name}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>确认选择</DialogTitle>
                          <DialogDescription>
                            选择后会覆盖当前页签的的SQL.是否继续?
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setSelectedScript(null)}
                          >
                            取消
                          </Button>
                          <Button onClick={handleConfirm}>确认</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}