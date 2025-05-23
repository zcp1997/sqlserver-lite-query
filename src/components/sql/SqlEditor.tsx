"use client"

import { useEffect, useRef } from 'react'
import Editor, { OnMount, Monaco as MonacoReact, loader } from '@monaco-editor/react'
import { useTheme } from 'next-themes'
import * as monaco from 'monaco-editor';
import { search_column_details, search_table_names } from '@/lib/api'
import { useSession } from '@/components/session/SessionContext'

loader.config({ monaco });

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  executeQuery?: (queryText?: string) => void
  readOnly?: boolean
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
];

export default function SqlEditor({
  value,
  onChange,
  executeQuery,
  readOnly = false
}: SqlEditorProps) {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<MonacoReact | null>(null)
  const completionProviderRef = useRef<monaco.IDisposable | null>(null)
  const { theme } = useTheme()
  const { activeSession } = useSession()

  // Helper to create completion items consistently
  const createCompletionItem = (
    monacoInstance: MonacoReact,
    label: string,
    kind: monaco.languages.CompletionItemKind,
    insertText: string,
    range: monaco.IRange,
    detail?: string,
    documentation?: string,
    isSnippet: boolean = false
  ): monaco.languages.CompletionItem => {
    const item: monaco.languages.CompletionItem = {
      label,
      kind,
      insertText,
      range,
      detail,
      documentation,
    };
    if (isSnippet) {
      item.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
    }
    return item;
  };

  // 修复：创建一个执行函数，获取当前编辑器内容并传递给父组件
  const executeCurrentQuery = () => {
    if (!executeQuery || !editorRef.current) {
      console.log('executeQuery not available or editor not ready');
      return;
    }

    // 直接从编辑器获取当前内容
    const currentValue = editorRef.current.getValue();
    console.log('Execute query called! Current editor value:', currentValue);

    if (!currentValue.trim()) {
      console.log('Query is empty, not executing');
      return;
    }

    // 如果状态还没更新，先更新状态
    if (currentValue !== value) {
      onChange(currentValue);
    }

    executeQuery(currentValue);
  };

  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance

    // Dispose previous provider if one exists
    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
    }

    completionProviderRef.current = monacoInstance.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', '('],
      provideCompletionItems: async (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const textBeforeCursor = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        }).toUpperCase();

        const lastSignificantToken = (textBeforeCursor.match(/([A-Z_]+)\s*$/) || [])[1] || '';
        const secondLastSignificantToken = (textBeforeCursor.match(/([A-Z_]+)\s+([A-Z_]+)\s*$/) || [])[1] || '';

        let dynamicSuggestions: monaco.languages.CompletionItem[] = [];

        // --- 1. Dynamic Table Suggestions ---
        const tableKeywords = ['FROM', 'JOIN', 'UPDATE'];
        if (tableKeywords.includes(lastSignificantToken) ||
          (tableKeywords.includes(secondLastSignificantToken) && word.word === "")) {
          try {
            const tables = await search_table_names(activeSession?.id || "", "")
            tables.forEach(table => {
              const label = table.schema ? `[${table.schema}].[${table.name}]` : `[${table.name}]`;
              dynamicSuggestions.push(createCompletionItem(
                monacoInstance,
                label,
                monacoInstance.languages.CompletionItemKind.Module,
                label + ' ',
                range,
                `Table: ${label}`,
                table.schema ? `Schema: ${table.schema}` : 'Table'
              ));
            });
          } catch (error) {
            console.error("Error fetching tables:", error);
          }
        }

        // --- 2. Dynamic Column Suggestions ---
        // a) After "table_name." or "alias."
        const dotMatch = textBeforeCursor.match(/(\b[A-Z0-9_]+\b)\.\s*$/i);
        if (dotMatch) {
          const tableNameOrAlias = dotMatch[1];
          try {
            const columns = await search_column_details(activeSession?.id || "", tableNameOrAlias)
            columns.forEach(col => {
              dynamicSuggestions.push(createCompletionItem(
                monacoInstance,
                col.name,
                monacoInstance.languages.CompletionItemKind.Field,
                col.name,
                range,
                `Column (${tableNameOrAlias})`,
                `Type: ${col.data_type}`
              ));
            });
          } catch (error) {
            console.error(`Error fetching columns for ${tableNameOrAlias}:`, error);
          }
        }

        // b) After SELECT (basic) or after a comma in SELECT list
        const afterSelectRegex = /SELECT\s+(?:[\w.]+\s*,\s*)*$/i;
        const isAfterSelect = lastSignificantToken === 'SELECT' || (secondLastSignificantToken === 'SELECT' && word.word === "") || textBeforeCursor.endsWith(',');

        if (isAfterSelect && textBeforeCursor.includes("FROM")) {
          const fromTableMatch = textBeforeCursor.match(/FROM\s+([A-Z0-9_.]+)\b/i);
          if (fromTableMatch) {
            const tableName = fromTableMatch[1].split('.').pop() || fromTableMatch[1];
            try {
              const columns = await search_column_details(activeSession?.id || "", tableName)
              columns.forEach(col => {
                dynamicSuggestions.push(createCompletionItem(
                  monacoInstance,
                  col.name,
                  monacoInstance.languages.CompletionItemKind.Field,
                  col.name,
                  range,
                  `Column (${tableName})`,
                  `Type: ${col.data_type}`
                ));
              });
            } catch (error) {
              console.error(`Error fetching columns for SELECT (${tableName}):`, error);
            }
          }
        }

        if (isAfterSelect) {
          dynamicSuggestions.push(createCompletionItem(
            monacoInstance,
            '*',
            monacoInstance.languages.CompletionItemKind.Field,
            '* ',
            range,
            'Select all columns'
          ));
        }

        // c) After "UPDATE table_name SET " or "UPDATE table_name SET column = value, "
        const updateSetMatch = textBeforeCursor.match(/UPDATE\s+(\b[A-Z0-9_.]+)\b\s+SET\s+(?:[\w.]+\s*=\s*[^,]+(?:,\s*)?)*(\w*)$/i);
        if (updateSetMatch) {
          const tableNameWithSchema = updateSetMatch[1];
          const tableName = tableNameWithSchema.split('.').pop() || tableNameWithSchema;
          const textAfterSet = textBeforeCursor.substring(textBeforeCursor.indexOf("SET") + 3).trim();

          if (word.word === "" || textAfterSet.endsWith(',')) {
            try {
              const columns = await search_column_details(activeSession?.id || "", tableName)
              columns.forEach(col => {
                dynamicSuggestions.push(createCompletionItem(
                  monacoInstance,
                  col.name,
                  monacoInstance.languages.CompletionItemKind.Field,
                  col.name + ' = ',
                  range,
                  `Column (${tableName})`,
                  `Type: ${col.data_type}`
                ));
              });
            } catch (error) {
              console.error(`Error fetching columns for UPDATE SET (${tableName}):`, error);
            }
          }
        }

        // d) After "INSERT INTO table_name ("
        const insertColumnsMatch = textBeforeCursor.match(/INSERT\s+INTO\s+(\b[A-Z0-9_.]+)\b\s*\(\s*([^)]*)$/i);
        if (insertColumnsMatch) {
          const tableNameWithSchema = insertColumnsMatch[1];
          const tableName = tableNameWithSchema.split('.').pop() || tableNameWithSchema;
          const existingColsText = insertColumnsMatch[2];
          if (!existingColsText.includes(')')) {
            try {
              const columns = await search_column_details(activeSession?.id || "", tableName)
              columns.forEach(col => {
                dynamicSuggestions.push(createCompletionItem(
                  monacoInstance,
                  col.name,
                  monacoInstance.languages.CompletionItemKind.Field,
                  col.name,
                  range,
                  `Column for ${tableName}`,
                  `Type: ${col.data_type}`
                ));
              });
            } catch (error) {
              console.error(`Error fetching columns for INSERT context (${tableName}):`, error);
            }
          }
        }

        // --- 3. Static Keyword and Snippet Suggestions ---
        const staticSuggestions = baseSqlKeywordsArray.map(keyword => {
          let currentKind = monaco.languages.CompletionItemKind.Keyword;
          let currentInsertText = keyword + ' ';
          let currentDetail = `SQL Keyword`;
          let isSnippet = false;

          if (['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'].includes(keyword)) {
            currentKind = monaco.languages.CompletionItemKind.Function;
            currentInsertText = `${keyword}($1)$0`;
            currentDetail = `Aggregate Function`;
            isSnippet = true;
          } else if (keyword === 'CASE') {
            currentInsertText = `CASE\n\tWHEN \${1:condition} THEN \${2:result}\n\tELSE \${3:else_result}\nEND$0`;
            currentDetail = 'Conditional expression';
            isSnippet = true;
          } else if (keyword === 'INSERT INTO') {
            currentInsertText = `INSERT INTO \${1:table_name} (\${2:column1, column2}) VALUES (\${3:value1, value2});$0`;
            currentDetail = 'Insert data snippet';
            isSnippet = true;
          } else if (keyword === 'UPDATE') {
            currentInsertText = `UPDATE \${1:table_name} SET \${2:column1} = \${3:value1} WHERE \${4:condition};$0`;
            currentDetail = 'Update data snippet';
            isSnippet = true;
          } else if (keyword === 'SSF') {
            currentInsertText = `SELECT * FROM \${1:table_name}`;
            currentDetail = 'Select all snippet';
            isSnippet = true;
          } else if (keyword === 'ST100') {
            currentInsertText = `SELECT TOP 100 * FROM \${1:table_name}`;
            currentDetail = 'Select top 100 snippet';
            isSnippet = true;
          }

          if (isSnippet && currentInsertText.endsWith(' ')) {
            currentInsertText = currentInsertText.slice(0, -1);
          }

          return createCompletionItem(
            monacoInstance,
            keyword,
            currentKind,
            currentInsertText,
            range,
            currentDetail,
            undefined,
            isSnippet
          );
        });

        // Suggest "SET" after "UPDATE table_name "
        const updateTableMatch = textBeforeCursor.match(/UPDATE\s+(\b[A-Z0-9_.]+)\b\s*$/i);
        if (updateTableMatch) {
          dynamicSuggestions.push(createCompletionItem(
            monacoInstance,
            'SET',
            monacoInstance.languages.CompletionItemKind.Keyword,
            'SET ',
            range,
            'SQL SET keyword'
          ));
        }

        // Suggest "(" or "VALUES" after "INSERT INTO table_name "
        const insertTableMatch = textBeforeCursor.match(/INSERT\s+INTO\s+(\b[A-Z0-9_.]+)\b\s*$/i);
        if (insertTableMatch) {
          dynamicSuggestions.push(createCompletionItem(
            monacoInstance,
            '(',
            monacoInstance.languages.CompletionItemKind.Text,
            '(',
            range,
            'Specify columns'
          ));
          dynamicSuggestions.push(createCompletionItem(
            monacoInstance,
            'VALUES',
            monacoInstance.languages.CompletionItemKind.Keyword,
            'VALUES ',
            range,
            'Specify values'
          ));
        }

        return {
          suggestions: [...staticSuggestions, ...dynamicSuggestions]
        };
      }
    });
  }

  useEffect(() => {
    if (monacoRef.current) {
      const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs';
      monacoRef.current.editor.setTheme(monacoTheme);
    }
  }, [theme]);

  // Cleanup completion provider on unmount
  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
    };
  }, []);

  return (
    <div className="h-full w-full overflow-hidden border rounded-md">
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
            '"Maple Mono"',           // 主字体（英文）
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
        }}
      />
    </div>
  )
}