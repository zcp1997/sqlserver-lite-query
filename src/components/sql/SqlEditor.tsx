"use client"

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import Editor, { OnMount, Monaco as MonacoReact, loader } from '@monaco-editor/react'
import { useTheme } from 'next-themes'
import { useSession } from '@/components/session/SessionContext'
import { format } from 'sql-formatter'
import {
  parseTablesAndAliases,
  analyzeSqlContext,
  generateDynamicSuggestions,
  CreateCompletionItemFunction
} from '@/lib/sqlparse'

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
  onSelectionChange
}, ref) => {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<MonacoReact | null>(null)
  const completionProviderRef = useRef<any | null>(null)
  const { theme } = useTheme()
  const { activeSession } = useSession()

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

    // 监听选择变化事件
    editor.onDidChangeCursorSelection((e) => {
      const selection = editor.getSelection()
      if (selection && !selection.isEmpty()) {
        const selectedText = editor.getModel()?.getValueInRange(selection) || ''
        onSelectionChange?.(selectedText)
      } else {
        onSelectionChange?.('')
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
      const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs'
      monacoRef.current.editor.setTheme(monacoTheme)
    }
  }, [theme])

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

      try {
        // 分割多条SQL语句（保留原始分号）
        const statements = currentValue.split(';')

        // 对非空语句进行格式化
        const formattedStatements = statements.map((stmt: string, index: number) => {
          const trimmed = stmt.trim()
          if (!trimmed) return ''

          // 格式化单条语句
          const formatted = format(trimmed, {
            language: 'tsql',
            indentStyle: 'standard',
            keywordCase: 'upper',
            linesBetweenQueries: 2,
            // 添加此配置以支持中文标识符
            identifierCase: 'preserve'
          })

          // 如果不是最后一个非空语句，添加分号
          return formatted + (index < statements.length - 1 && trimmed ? ';' : '')
        })

        // 用双换行符连接语句
        const formattedValue = formattedStatements.join('\n\n').trim()

        // 更新编辑器内容
        editorRef.current.setValue(formattedValue)
        onChange(formattedValue)
      } catch (error) {
        console.error('SQL formatting error:', error)
      }
    }
  }, [onChange])

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    formatSQL: handleFormatSQL
  }), [handleFormatSQL])

  return (
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
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wrappingIndent: 'indent',
          automaticLayout: true,
          tabSize: 2,
          readOnly,
          fontSize: 14,
          fontFamily: [
            '"JetBrainsMono"',
            '"Source Code Pro"',      // 更好的中文兼容性
            '"Microsoft YaHei Mono"', // Windows 中文等宽
            '"PingFang SC"',          // macOS 中文
            '"Noto Sans Mono CJK SC"',// Linux 中文等宽
            '"Consolas"',             // Windows fallback
            '"Monaco"',               // macOS fallback
            'Courier New'               // 系统 fallback
          ].join(', '),
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
  )
})

export default SqlEditor