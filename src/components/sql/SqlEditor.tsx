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

export default function SqlEditor({
  value,
  onChange,
  executeQuery,
  readOnly = false
}: SqlEditorProps) {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<any>(null)
  const { theme } = useTheme()
  
  // 处理编辑器挂载
  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance
    
    // 设置快捷键
    editor.addCommand(
      // 使用Ctrl+Enter或Cmd+Enter执行查询
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter,
      () => {
        executeQuery && executeQuery()
      }
    )
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
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  )
} 