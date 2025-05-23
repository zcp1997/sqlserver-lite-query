import { useState, useEffect, useCallback } from 'react'
import { debounce } from 'lodash'
import { DatabaseObjectType, DatabaseObjectInfo, QuerySession as Session } from '@/types/database'
import { search_dbobject_info } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SearchIcon } from 'lucide-react'

interface DatabaseObjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSession: Session | null;
  updateTabContent: (content: string) => void;
  dbObjectType: DatabaseObjectType;
}

export default function DatabaseObjectsDialog({
  open,
  onOpenChange,
  activeSession,
  updateTabContent,
  dbObjectType
}: DatabaseObjectsDialogProps) {
  // 数据库对象管理
  const [dbObjectSearchTerm, setDbObjectSearchTerm] = useState('')
  const [dbObjects, setDbObjects] = useState<{ name: string, definition: string }[]>([])
  const [selectedObject, setSelectedObject] = useState<{ name: string, definition: string } | null>(null)
  const [isDbObjectsSearching, setDbObjectsIsSearching] = useState(false)
  // 添加初始加载状态
  const [isInitialLoad, setIsInitialLoad] = useState(false)

  // 防抖搜索
  const debouncedSearch = useCallback(
    debounce(async (term: string) => {
      if (!activeSession) return;

      setDbObjectsIsSearching(true);
      try {
        const procedures: DatabaseObjectInfo[] = await search_dbobject_info(
          activeSession.id,
          term,
          dbObjectType
        );
        const formattedObjects = procedures.map(proc => ({
          name: proc.full_name || proc.name,
          definition: proc.definition || `-- 名称: ${proc.name}\n-- 架构: ${proc.schema_name}\n-- 完整名称: ${proc.full_name}\n\n${proc.definition}`
        }));
        setDbObjects(formattedObjects);
      } catch (err) {
        console.error(`搜索${dbObjectType}失败:`, err);
      } finally {
        setDbObjectsIsSearching(false);
        setIsInitialLoad(false); // 完成初始加载
      }
    }, 500),
    [activeSession, dbObjectType]
  );

  // 初始搜索立即执行
  useEffect(() => {
    if (open) {
      setDbObjectSearchTerm(''); // 重置搜索条件
      setDbObjects([]); // 清空之前的搜索结果
      // 初始搜索立即执行，不使用 debounce
      if (activeSession) {
        setDbObjectsIsSearching(true);
        search_dbobject_info(activeSession.id, '', dbObjectType)
          .then(procedures => {
            const formattedObjects = procedures.map(proc => ({
              name: proc.full_name || proc.name,
              definition: proc.definition || `-- 名称: ${proc.name}\n-- 架构: ${proc.schema_name}\n-- 完整名称: ${proc.full_name}\n\n${proc.definition}`
            }));
            setDbObjects(formattedObjects);
          })
          .catch(err => console.error(`搜索${dbObjectType}失败:`, err))
          .finally(() => setDbObjectsIsSearching(false));
      }
    }
  }, [open, dbObjectType, activeSession]);

  // 搜索词变化时执行搜索
  useEffect(() => {
    if (open) {
      debouncedSearch(dbObjectSearchTerm);
    }
  }, [dbObjectSearchTerm, open, debouncedSearch]);

  // 打开数据库对象
  const openDatabaseObject = (obj: { name: string, definition: string }) => {
    updateTabContent(obj.definition);
    onOpenChange(false);
    // 清空选中的对象
    setTimeout(() => setSelectedObject(null), 100);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) {
          setTimeout(() => setSelectedObject(null), 100);
        }
      }}
    >
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {dbObjectType === DatabaseObjectType.StoredProcedure && '存储过程管理'}
            {dbObjectType === DatabaseObjectType.Function && '函数管理'}
            {dbObjectType === DatabaseObjectType.View && '视图管理'}
          </DialogTitle>
          <DialogDescription>
            搜索并管理数据库对象
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 my-2">
          <SearchIcon className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索对象名称..."
            value={dbObjectSearchTerm}
            onChange={(e) => setDbObjectSearchTerm(e.target.value)}
            className="flex-1"
          />
          {isDbObjectsSearching && (
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
          )}
        </div>

        {/* 添加水平布局容器，包裹左侧列表和右侧详情 */}
        <div className="flex flex-1 overflow-hidden border rounded-md">
          {/* 左侧列表 */}
          <div className="w-1/3 border-r overflow-auto">
            <ul className="divide-y">
              {dbObjects.map(obj => (
                <li
                  key={obj.name}
                  className={`p-2 hover:bg-muted cursor-pointer ${selectedObject?.name === obj.name ? 'bg-muted' : ''}`}
                  onClick={() => setSelectedObject(obj)}
                >
                  <div
                    className="truncate text-sm"
                    title={obj.name}
                    style={{ wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal', lineHeight: '1.2' }}
                  >
                    {obj.name}
                  </div>
                </li>
              ))}
              {/* 搜索状态和空状态提示 */}
              {(isDbObjectsSearching || isInitialLoad) && (
                <li className="p-2 text-muted-foreground text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                    正在搜索...
                  </div>
                </li>
              )}
              {dbObjects.length === 0 && !isDbObjectsSearching && !isInitialLoad && (
                <li className="p-2 text-muted-foreground text-center">
                  未找到匹配的对象
                </li>
              )}
            </ul>
          </div>

          {/* 右侧详情 */}
          <div className="flex-1 overflow-auto p-2 bg-muted/30">
            {selectedObject ? (
              <>
                <div className="font-medium mb-2">{selectedObject.name}</div>
                <pre className="text-sm whitespace-pre-wrap bg-background p-4 rounded-md overflow-auto max-h-[400px]">
                  {selectedObject.definition}
                </pre>
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => openDatabaseObject(selectedObject)}>
                    在编辑器中打开
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                选择一个对象查看详情
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
