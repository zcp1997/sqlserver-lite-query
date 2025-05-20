"use client"
import { useEffect, useRef } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { useTheme } from 'next-themes'

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  executeQuery?: () => void
  readOnly?: boolean
}

// 模拟数据库表结构
const tableSchemas = {
  'info_公司机构': [
    { name: '_id', type: 'nvarchar(32)', description: '主键ID' },
    { name: '编号', type: 'nvarchar(32)', description: '公司机构编号' },
    { name: '公司机构名称', type: 'nvarchar(500)', description: '公司机构名称' },
    { name: '新编码', type: 'nvarchar(256)', description: '新编码' },
    { name: '_guid', type: 'uniqueidentifier', description: '全局唯一标识符' },
    { name: '公司机构类型', type: 'int', description: '机构类型' },
    { name: '经营模式', type: 'int', description: '经营模式' },
    { name: '是否切换', type: 'int', description: '切换状态' },
    { name: '账号', type: 'nvarchar(100)', description: '登录账号' },
    { name: '开户行', type: 'nvarchar(100)', description: '开户银行' },
    { name: '税号', type: 'nvarchar(100)', description: '税号' },
    { name: '经理级', type: 'nvarchar(100)', description: '经理级别' },
    { name: '电话', type: 'nvarchar(50)', description: '联系电话' },
    { name: '联例', type: 'nvarchar(50)', description: '联系人' },
    { name: '时间人数', type: 'bigint', description: '时间人数' },
    { name: '营业时间', type: 'decimal(12, 4)', description: '营业时间' },
    { name: '开业日期', type: 'datetime', description: '开业日期' }
  ],
  'user_info': [
    { name: 'id', type: 'int', description: '用户ID' },
    { name: 'username', type: 'nvarchar(50)', description: '用户名' },
    { name: 'email', type: 'nvarchar(100)', description: '邮箱' },
    { name: 'create_time', type: 'datetime', description: '创建时间' }
  ]
}

// SQL关键词
const sqlKeywords = [
  'SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING',
  'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'ON',
  'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP',
  'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'LIKE', 'BETWEEN',
  'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'DISTINCT', 'AS'
]

export default function SqlEditor({
  value,
  onChange,
  executeQuery,
  readOnly = false
}: SqlEditorProps) {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<any>(null)
  const { theme } = useTheme()

  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance

    // 设置快捷键
    editor.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter,
      () => {
        executeQuery && executeQuery()
      }
    )

    // 注册 SQL 补全提示
    monacoInstance.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.'],
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const suggestions = [
          {
            label: 'SELECT',
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            insertText: 'SELECT',
            range,
          },
          {
            label: 'FROM',
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            insertText: 'FROM',
            range,
          },
          {
            label: 'WHERE',
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            insertText: 'WHERE',
            range,
          },
          {
            label: 'ORDER BY',
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            insertText: 'ORDER BY',
            range,
          },
          {
            label: 'GROUP BY',
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            insertText: 'GROUP BY',
            range,
          },
          {
            label: 'INNER JOIN',
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            insertText: 'INNER JOIN',
            range,
          },
          {
            label: 'LEFT JOIN',
            kind: monacoInstance.languages.CompletionItemKind.Keyword,
            insertText: 'LEFT JOIN',
            range,
          },
          {
            label: 'info_公司机构',
            kind: monacoInstance.languages.CompletionItemKind.Struct,
            insertText: 'info_公司机构',
            range,
            detail: '表',
            documentation: '公司机构表',
          },
          {
            label: '编号',
            kind: monacoInstance.languages.CompletionItemKind.Field,
            insertText: '编号',
            range,
            detail: 'nvarchar(32)',
            documentation: '公司机构编号字段',
          },
          {
            label: '公司机构类型',
            kind: monacoInstance.languages.CompletionItemKind.Field,
            insertText: '公司机构类型',
            range,
            detail: 'int',
            documentation: '公司机构类型字段',
          },
        ]

        return {
          suggestions
        }
      }
    })
  }

  // 根据主题切换编辑器主题
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs'
      monacoRef.current.editor.setTheme(monacoTheme)
    }
  }, [theme])

  return (
    <div className="h-full w-full overflow-hidden border rounded-md">
      <Editor
        height="100%"
        language="sql"
        value={value}
        onChange={(value) => onChange(value || '')}
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          wrappingIndent: 'indent',
          automaticLayout: true,
          tabSize: 2,
          fontSize: 14,
          readOnly,
          fontFamily: 'Monaco, "Courier New", monospace',
          fixedOverflowWidgets: true,
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
          tabCompletion: 'on',
        }}
      />
    </div>
  )
}