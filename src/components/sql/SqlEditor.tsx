"use client"

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react'
import Editor, { OnMount, Monaco as MonacoReact, loader } from '@monaco-editor/react'
import { useTheme } from 'next-themes'
import { useSession } from '@/components/session/SessionContext'
import { format } from 'sql-formatter'
import { v4 as uuidv4 } from 'uuid'
import {
  parseTablesAndAliases,
  analyzeSqlContext,
  generateDynamicSuggestions,
  CreateCompletionItemFunction
} from '@/lib/sqlparse'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SaveIcon } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { SqlScript } from '@/types/database'

// 本地存储键
const SCRIPTS_STORAGE_KEY = 'sqlserver-scripts'
const GROUPS_STORAGE_KEY = 'sqlserver-script-groups'

// Monaco 枚举值的常量替代（避免 SSR 问题）
const COMPLETION_ITEM_KIND = {
  Field: 5,
  Function: 3,
  Module: 9,
  Keyword: 14,
  Text: 1,
  Variable: 12
} as const

const COMPLETION_ITEM_INSERT_TEXT_RULE = {
  InsertAsSnippet: 4
} as const

// 动态加载 monaco-editor
let monacoModule: any = null
const loadMonaco = async () => {
  if (typeof window !== 'undefined' && !monacoModule) {
    try {
      monacoModule = await import('monaco-editor')
      loader.config({ monaco: monacoModule })
    } catch (error) {
      console.error('Failed to load monaco-editor:', error)
    }
  }
  return monacoModule
}

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  onSelectionChange?: (selectedText: string) => void
  fontSize?: number // 新增：字体大小
}

// 暴露给父组件的方法
export interface SqlEditorRef {
  formatSQL: () => void
}

// SQL关键词
const baseSqlKeywordsArray = [
  'SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING',
  'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'ON',
  'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP',
  'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'LIKE', 'BETWEEN',
  'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'DISTINCT', 'AS',
  'USING', 'TOP', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION', 'UNION ALL',
  'INSERT INTO', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE',
  'NULL', 'IS NULL', 'IS NOT NULL', 'ASC', 'DESC', 'VIEW', 'INDEX', 'PROCEDURE',
  'FUNCTION', 'TRIGGER', 'DATABASE', 'SCHEMA', 'CONSTRAINT', 'PRIMARY KEY',
  'FOREIGN KEY', 'REFERENCES', 'DEFAULT', 'NOT NULL', 'UNIQUE', 'CHECK',
  'SSF', 'ST100'
]

const SqlEditor = forwardRef<SqlEditorRef, SqlEditorProps>(({
  value,
  onChange,
  readOnly = false,
  onSelectionChange,
  fontSize = 14 // 新增：字体大小，默认14
}, ref) => {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<MonacoReact | null>(null)
  const completionProviderRef = useRef<any | null>(null)
  const { resolvedTheme } = useTheme()
  const { activeSession } = useSession()
  const { toast } = useToast()

  // 保存到脚本的状态管理
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false)
  const [saveDialogScript, setSaveDialogScript] = useState<Partial<SqlScript>>({
    name: '',
    groupName: '默认分组',
    content: '',
    description: ''
  })
  const [groups, setGroups] = useState<string[]>(['默认分组'])

  // 加载脚本分组
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    try {
      const savedGroups = localStorage.getItem(GROUPS_STORAGE_KEY)
      if (savedGroups) {
        const parsedGroups = JSON.parse(savedGroups) as string[]
        if (Array.isArray(parsedGroups) && parsedGroups.length > 0) {
          setGroups(parsedGroups)
        }
      }
    } catch (err) {
      console.error('加载分组数据失败:', err)
    }
  }, [])

  // 获取选中文本或全部文本
  const getTextToSave = useCallback(() => {
    if (!editorRef.current) return ''
    
    const selection = editorRef.current.getSelection()
    if (selection && !selection.isEmpty()) {
      // 有选中文本，返回选中的内容
      return editorRef.current.getModel()?.getValueInRange(selection) || ''
    } else {
      // 没有选中文本，返回全部内容
      return editorRef.current.getValue() || ''
    }
  }, [])

  // 保存脚本到本地存储
  const saveScriptToStorage = useCallback(() => {
    if (!saveDialogScript.name?.trim()) {
      toast.error('脚本名称不能为空')
      return
    }
    
    if (!saveDialogScript.content?.trim()) {
      toast.error('脚本内容不能为空')
      return
    }

    try {
      // 加载现有脚本
      const savedScripts = localStorage.getItem(SCRIPTS_STORAGE_KEY)
      const existingScripts: SqlScript[] = savedScripts ? JSON.parse(savedScripts) : []
      
      // 创建新脚本
      const now = new Date().toISOString()
      const newScript: SqlScript = {
        id: uuidv4(),
        name: saveDialogScript.name!,
        groupName: saveDialogScript.groupName || '默认分组',
        content: saveDialogScript.content!,
        description: saveDialogScript.description || '',
        createdAt: now,
        updatedAt: now
      }
      
      // 保存到本地存储
      const updatedScripts = [...existingScripts, newScript]
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify(updatedScripts))
      
      toast.success(`已保存脚本: ${newScript.name}`)
      
      // 关闭对话框并重置状态
      setIsSaveDialogOpen(false)
      setSaveDialogScript({
        name: '',
        groupName: '默认分组',
        content: '',
        description: ''
      })
    } catch (err) {
      console.error('保存脚本失败:', err)
      toast.error('保存脚本失败')
    }
  }, [saveDialogScript, toast])

  // 打开保存对话框
  const openSaveDialog = useCallback(() => {
    const textToSave = getTextToSave()
    if (!textToSave.trim()) {
      toast.error('没有可保存的SQL内容')
      return
    }

    // 生成默认脚本名称
    const firstLine = textToSave.split('\n')[0].trim()
    const defaultName = firstLine.length > 30 
      ? firstLine.substring(0, 30) + '...' 
      : firstLine || '新建脚本'

    setSaveDialogScript({
      name: defaultName,
      groupName: '默认分组',
      content: textToSave,
      description: ''
    })
    setIsSaveDialogOpen(true)
  }, [getTextToSave, toast])

  // Helper to create completion items consistently
  const createCompletionItem: CreateCompletionItemFunction = (
    label: string,
    kind: any,
    insertText: string,
    range: any,
    detail?: string,
    documentation?: string,
    isSnippet: boolean = false,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): any => {
    // 设置排序优先级：数字越小越靠前
    const sortText = priority === 'high' ? '1' : priority === 'medium' ? '2' : '3'
    
    const item: any = {
      label,
      kind,
      insertText,
      range,
      detail,
      documentation,
      sortText,
    }
    if (isSnippet) {
      item.insertTextRules = COMPLETION_ITEM_INSERT_TEXT_RULE.InsertAsSnippet
    }
    return item
  }

  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance

    // 立即设置主题，避免初始渲染时的主题闪烁
    const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'vs'
    monacoInstance.editor.setTheme(monacoTheme)

    // 监听选择变化事件 - 使用防抖优化性能
    let selectionChangeTimer: NodeJS.Timeout | null = null
    editor.onDidChangeCursorSelection((e) => {
      // 清除之前的定时器
      if (selectionChangeTimer) {
        clearTimeout(selectionChangeTimer)
      }
      
      // 设置新的防抖定时器
      selectionChangeTimer = setTimeout(() => {
        const selection = editor.getSelection()
        if (selection && !selection.isEmpty()) {
          const selectedText = editor.getModel()?.getValueInRange(selection) || ''
          onSelectionChange?.(selectedText)
        } else {
          onSelectionChange?.('')
        }
        selectionChangeTimer = null
      }, 150) // 150ms 防抖延迟，平衡响应性和性能
    })

    // 注册右键菜单
    editor.addAction({
      id: 'save-to-scripts',
      label: '保存到脚本',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: function() {
        openSaveDialog()
      }
    })

    // 注册初始的 completion provider
    registerCompletionProvider(monacoInstance)
  }

  // 提取 completion provider 注册逻辑到独立函数
  const registerCompletionProvider = (monacoInstance: MonacoReact) => {
    // Dispose previous provider if one exists
    if (completionProviderRef.current) {
      completionProviderRef.current.dispose()
    }

    completionProviderRef.current = monacoInstance.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', '(', ','],
      provideCompletionItems: async (model, position) => {
        try {
          // 性能保护：超时控制
          const startTime = Date.now()
          const maxTime = 3000 // 3秒超时
          
          const checkTimeout = () => {
            if (Date.now() - startTime > maxTime) {
              throw new Error('Completion provider timeout')
            }
          }
          
          // 获取当前最新的 activeSession
          const currentSessionId = activeSession?.id || ""
          
          console.log('Completion provider using session ID:', currentSessionId)
          
          checkTimeout()
          
          const word = model.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          }

          const textBeforeCursor = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          }).toUpperCase()

          // 获取整个文档的文本用于解析表名
          const fullText = model.getValue().toUpperCase()

          console.log('SQL Editor Completion Context:', {
            sessionId: currentSessionId,
            textBeforeCursor: textBeforeCursor.slice(-50),
            fullText: fullText.slice(0, 100),
            wordAtCursor: word.word,
            position: { line: position.lineNumber, column: position.column }
          })

          checkTimeout()

          // 使用 sqlparse 库进行分析
          const tablesAndAliases = parseTablesAndAliases(fullText)
          const sqlContext = analyzeSqlContext(textBeforeCursor)
          
          console.log('解析结果:', { tablesAndAliases, sqlContext })

          checkTimeout()

          // 生成动态建议
          const dynamicSuggestions = await generateDynamicSuggestions(
            currentSessionId,
            textBeforeCursor,
            fullText,
            sqlContext,
            tablesAndAliases,
            createCompletionItem,
            range
          )

          checkTimeout()

          // 生成静态关键字建议
          const staticSuggestions = baseSqlKeywordsArray.map(keyword => {
            let currentKind: any = COMPLETION_ITEM_KIND.Keyword
            let currentInsertText = keyword + ' '
            let currentDetail = `SQL Keyword`
            let isSnippet = false

            if (['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'].includes(keyword)) {
              currentKind = COMPLETION_ITEM_KIND.Function
              currentInsertText = `${keyword}($1)$0`
              currentDetail = `Aggregate Function`
              isSnippet = true
            } else if (keyword === 'CASE') {
              currentInsertText = `CASE\n\tWHEN \${1:condition} THEN \${2:result}\n\tELSE \${3:else_result}\nEND$0`
              currentDetail = 'Conditional expression'
              isSnippet = true
            } else if (keyword === 'INSERT INTO') {
              currentInsertText = `INSERT INTO \${1:table_name} (\${2:column1, column2}) VALUES (\${3:value1, value2});$0`
              currentDetail = 'Insert data snippet'
              isSnippet = true
            } else if (keyword === 'UPDATE') {
              currentInsertText = `UPDATE \${1:table_name} SET \${2:column1} = \${3:value1} WHERE \${4:condition};$0`
              currentDetail = 'Update data snippet'
              isSnippet = true
            } else if (keyword === 'SSF') {
              currentInsertText = `SELECT * FROM `
              currentDetail = 'Select all snippet'
              isSnippet = true
            } else if (keyword === 'ST100') {
              currentInsertText = `SELECT TOP 100 * FROM \${1:table_name}`
              currentDetail = 'Select top 100 snippet'
              isSnippet = true
            }

            if (isSnippet && currentInsertText.endsWith(' ')) {
              currentInsertText = currentInsertText.slice(0, -1)
            }

            return createCompletionItem(
              keyword,
              currentKind,
              currentInsertText,
              range,
              currentDetail,
              undefined,
              isSnippet,
              'low'
            )
          })

          return {
            suggestions: [...staticSuggestions, ...dynamicSuggestions]
          }
          
        } catch (error) {
          console.error('Completion provider error:', error)
          // 发生错误时返回基本的SQL关键字建议，避免界面完全无响应
          const basicSuggestions = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'INSERT', 'UPDATE', 'DELETE'].map(keyword => 
            createCompletionItem(
              keyword,
              COMPLETION_ITEM_KIND.Keyword,
              keyword + ' ',
              {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: position.column,
                endColumn: position.column,
              },
              'SQL Keyword',
              undefined,
              false,
              'medium'
            )
          )
          
          return {
            suggestions: basicSuggestions
          }
        }
      }
    })
  }

  // 当 activeSession 变化时重新注册 completion provider
  useEffect(() => {
    if (monacoRef.current && activeSession) {
      console.log('ActiveSession changed, re-registering completion provider with session:', activeSession.id)
      registerCompletionProvider(monacoRef.current)
    }
  }, [activeSession?.id])

  useEffect(() => {
    if (monacoRef.current) {
      // 当resolvedTheme为undefined时，使用默认浅色主题
      const monacoTheme = resolvedTheme === 'dark' ? 'vs-dark' : 'vs'
      monacoRef.current.editor.setTheme(monacoTheme)
    }
  }, [resolvedTheme])

  // Cleanup completion provider on unmount
  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose()
        completionProviderRef.current = null
      }
    }
  }, [])

  // 格式化SQL函数
  const handleFormatSQL = useCallback(() => {
    if (editorRef.current) {
      console.log('Formatting SQL...')

      // 获取当前SQL文本
      const currentValue = editorRef.current.getValue()

      if (!currentValue.trim()) {
        return // 空内容不处理
      }

      try {
        // 使用sql-formatter格式化整个SQL文本
        const formattedValue = format(currentValue, {
          language: 'transactsql', // 使用SQL Server的T-SQL方言
          indentStyle: 'standard',
          keywordCase: 'upper',
          identifierCase: 'preserve', // 保持标识符原样，支持中文
          functionCase: 'upper',
          linesBetweenQueries: 2,
          denseOperators: false,
          newlineBeforeSemicolon: false
        })

        // 更新编辑器内容
        editorRef.current.setValue(formattedValue)
        onChange(formattedValue)
      } catch (error) {
        console.error('SQL formatting error:', error)
      }
    }
  }, [onChange,])

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    formatSQL: handleFormatSQL
  }), [handleFormatSQL])

  return (
    <>
      <div className="h-full w-full overflow-hidden border rounded-md">
        <style jsx global>{`
          /* 自定义Monaco Editor建议窗口样式 */
          .monaco-editor .suggest-widget {
            width: 450px !important;
            min-width: 400px !important;
          }
          
          .monaco-editor .suggest-widget .monaco-list .monaco-list-row {
            height: auto !important;
            min-height: 22px !important;
          }
          
          .monaco-editor .suggest-widget .monaco-list .monaco-list-row .contents {
            padding: 4px 8px !important;
          }
          
          .monaco-editor .suggest-widget .monaco-list .monaco-list-row .label {
            max-width: none !important;
            white-space: nowrap !important;
          }
          
          .monaco-editor .suggest-widget .monaco-list .monaco-list-row .details {
            max-width: none !important;
            white-space: nowrap !important;
            overflow: visible !important;
          }
          
          .monaco-editor .suggest-widget .docs {
            width: 300px !important;
            min-width: 250px !important;
          }
          
          /* 确保建议窗口不被截断 */
          .monaco-editor .suggest-widget.docs-side {
            width: 750px !important;
          }
        `}</style>
        <Editor
          height="100%"
          language="sql"
          value={value}
          onChange={(val) => onChange(val || '')}
          onMount={handleEditorDidMount}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs'}
          options={{
            minimap: { enabled: false },
            guides: {
              indentation: false
            },
            scrollBeyondLastLine: false,
            wrappingIndent: 'indent',
            automaticLayout: true,
            tabSize: 2,
            readOnly,
            fontSize: fontSize,
            fontFamily: 'var(--font-inter)',
            fontLigatures: true,
            // 增加这些配置改善中文显示
            wordWrap: 'on',
            wordWrapColumn: 120,
            renderWhitespace: 'selection',
            unicodeHighlight: {
              ambiguousCharacters: false, // 避免中文字符被高亮为可疑字符
              invisibleCharacters: false
            },
            fixedOverflowWidgets: true,
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
            tabCompletion: 'on',
            quickSuggestions: {
              other: true,
              comments: false,
              strings: true
            },
            suggestSelection: 'first',
            // 建议窗口相关配置
            suggest: {
              showIcons: true,
              showSnippets: true,
              showWords: true,
              showColors: true,
              showFiles: true,
              showReferences: true,
              showFolders: true,
              showTypeParameters: true,
              showIssues: true,
              showUsers: true,
              showValues: true,
              showMethods: true,
              showFunctions: true,
              showConstructors: true,
              showFields: true,
              showVariables: true,
              showClasses: true,
              showStructs: true,
              showInterfaces: true,
              showModules: true,
              showProperties: true,
              showEvents: true,
              showOperators: true,
              showUnits: true,
              showKeywords: true,
              showStatusBar: true,
              // 扩展建议窗口配置
              insertMode: 'insert',
              filterGraceful: true,
              snippetsPreventQuickSuggestions: false,
              localityBonus: true,
              shareSuggestSelections: false,
              selectionMode: 'always'
            },
            // 提示框宽度相关
            hover: {
              enabled: true,
              delay: 300,
              sticky: true
            }
          }}
        />
      </div>

      {/* 保存到脚本对话框 */}
      <Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>保存SQL脚本</DialogTitle>
            {/* <DialogDescription>
              将当前SQL内容保存为脚本以便后续重用
            </DialogDescription> */}
          </DialogHeader>
          
          <div className="grid gap-4 py-4 flex-1 overflow-auto">
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="script-name" className="text-right">
                脚本名称
              </label>
              <Input
                id="script-name"
                value={saveDialogScript.name || ''}
                onChange={(e) => setSaveDialogScript({...saveDialogScript, name: e.target.value})}
                className="col-span-3"
                placeholder="请输入脚本名称"
              />
            </div>
            
            <div className="grid grid-cols-4 items-center gap-4">
              <label htmlFor="script-group" className="text-right">
                脚本分组
              </label>
              <Select
                value={saveDialogScript.groupName || '默认分组'}
                onValueChange={(value) => setSaveDialogScript({...saveDialogScript, groupName: value})}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="选择分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map(group => (
                    <SelectItem key={group} value={group}>
                      {group}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-4 items-start gap-4">
              <label htmlFor="script-description" className="text-right pt-2">
                脚本描述
              </label>
              <Textarea
                id="script-description"
                value={saveDialogScript.description || ''}
                onChange={(e) => setSaveDialogScript({...saveDialogScript, description: e.target.value})}
                className="col-span-3"
                rows={2}
                placeholder="请输入脚本描述（可选）"
              />
            </div>
            
            <div className="grid grid-cols-4 items-start gap-4">
              <label htmlFor="script-content" className="text-right pt-2">
                SQL内容
              </label>
              <Textarea
                id="script-content"
                value={saveDialogScript.content || ''}
                onChange={(e) => setSaveDialogScript({...saveDialogScript, content: e.target.value})}
                className="col-span-3 font-mono text-sm"
                rows={8}
                placeholder="SQL脚本内容"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={saveScriptToStorage}>
              <SaveIcon className="h-4 w-4 mr-2" />
              保存脚本
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})

export default SqlEditor