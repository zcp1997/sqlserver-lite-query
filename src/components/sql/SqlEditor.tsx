"use client"

import { useEffect, useRef } from 'react'
import Editor, { OnMount, Monaco as MonacoReact } from '@monaco-editor/react' // Added Monaco type
import { useTheme } from 'next-themes'
import { invoke } from '@tauri-apps/api/core'; // Make sure this is correctly imported
import * as monaco from 'monaco-editor';
import { search_table_names } from '@/lib/api'

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  executeQuery?: () => void
  readOnly?: boolean
  activeSessionId: string 
}

// SQL关键词 (Using your existing list, but we'll map it inside for consistency)
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
  'FOREIGN KEY', 'REFERENCES', 'DEFAULT', 'NOT NULL', 'UNIQUE', 'CHECK'
];


export default function SqlEditor({
  value,
  onChange,
  executeQuery,
  readOnly = false,
  activeSessionId
}: SqlEditorProps) {
  const editorRef = useRef<any>(null) // Consider more specific types if available from @monaco-editor/react
  const monacoRef = useRef<MonacoReact | null>(null) // Use Monaco type
  const completionProviderRef = useRef<monaco.IDisposable | null>(null); // To manage the provider
  const { theme } = useTheme()

  // Helper to create completion items consistently
  const createCompletionItem = (
    monacoInstance: MonacoReact, // Use MonacoReact alias or monaco if preferred
    label: string,
    kind: monaco.languages.CompletionItemKind, // Use monaco.languages.CompletionItemKind
    insertText: string, // Changed to string
    range: monaco.IRange,
    detail?: string,
    documentation?: string,
    isSnippet: boolean = false // Added a flag to indicate if it's a snippet
  ): monaco.languages.CompletionItem => { // Return type uses monaco.languages.CompletionItem
    const item: monaco.languages.CompletionItem = {
      label,
      kind,
      insertText, // Directly use the string
      range,
      detail,
      documentation,
    };
    if (isSnippet) {
      // The monacoInstance here is the one from @monaco-editor/react,
      // ensure it has .languages.CompletionItemInsertTextRule or use imported monaco
      item.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet; // [cite: 237]
    }
    return item;
  };


  const handleEditorDidMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance

    editor.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter,
      () => {
        executeQuery && executeQuery()
      }
    )

    // Dispose previous provider if one exists (e.g., on hot reload)
    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
    }

    completionProviderRef.current = monacoInstance.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', '('], // Added '(' for insert statements
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
            const tables = await search_table_names(activeSessionId, "")
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
            console.error("Tauri Error fetching tables:", error);
          }
        }

        // --- 2. Dynamic Column Suggestions ---
        // a) After "table_name." or "alias."
        const dotMatch = textBeforeCursor.match(/(\b[A-Z0-9_]+\b)\.\s*$/i);
        if (dotMatch) {
          const tableNameOrAlias = dotMatch[1];
          try {
            const columns: { name: string; data_type: string }[] = await invoke('get_columns_for_table', { tableName: tableNameOrAlias });
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
            console.error(`Tauri Error fetching columns for ${tableNameOrAlias}:`, error);
          }
        }

        // b) After SELECT (basic) or after a comma in SELECT list
        const afterSelectRegex = /SELECT\s+(?:[\w.]+\s*,\s*)*$/i;
        const isAfterSelect = lastSignificantToken === 'SELECT' || (secondLastSignificantToken === 'SELECT' && word.word === "") || textBeforeCursor.endsWith(',');

        if (isAfterSelect && textBeforeCursor.includes("FROM")) { // Only suggest columns if FROM is present
          // Naive: find the first table after FROM. A real parser is needed for complex queries.
          const fromTableMatch = textBeforeCursor.match(/FROM\s+([A-Z0-9_.]+)\b/i);
          if (fromTableMatch) {
            const tableName = fromTableMatch[1].split('.').pop() || fromTableMatch[1]; // Handle schema.table
            try {
              const columns: { name: string; data_type: string }[] = await invoke('get_columns_for_table', { tableName });
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
              console.error(`Tauri Error fetching columns for SELECT (${tableName}):`, error);
            }
          }
        }
        // Always suggest '*' after SELECT or a comma in SELECT
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
          const tableName = tableNameWithSchema.split('.').pop() || tableNameWithSchema; // Get actual table name
          const textAfterSet = textBeforeCursor.substring(textBeforeCursor.indexOf("SET") + 3).trim();

          // Suggest column if at the beginning of a new assignment or after a comma
          if (word.word === "" || textAfterSet.endsWith(',')) {
            try {
              const columns: { name: string; data_type: string }[] = await invoke('get_columns_for_table', { tableName });
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
              console.error(`Tauri Error fetching columns for UPDATE SET (${tableName}):`, error);
            }
          }
        }

        // d) After "INSERT INTO table_name ("
        const insertColumnsMatch = textBeforeCursor.match(/INSERT\s+INTO\s+(\b[A-Z0-9_.]+)\b\s*\(\s*([^)]*)$/i);
        if (insertColumnsMatch) {
          const tableNameWithSchema = insertColumnsMatch[1];
          const tableName = tableNameWithSchema.split('.').pop() || tableNameWithSchema;
          const existingColsText = insertColumnsMatch[2];
          if (!existingColsText.includes(')')) { // Only suggest if parenthesis is not closed
            try {
              const columns: { name: string; data_type: string }[] = await invoke('get_columns_for_table', { tableName });
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
              console.error(`Tauri Error fetching columns for INSERT context (${tableName}):`, error);
            }
          }
        }


        // --- 3. Static Keyword and Snippet Suggestions ---
        const staticSuggestions = baseSqlKeywordsArray.map(keyword => {
          let currentKind = monaco.languages.CompletionItemKind.Keyword; // Use monaco.languages
          let currentInsertText = keyword + ' ';
          let currentDetail = `SQL Keyword`;
          let isSnippet = false;

          if (['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'].includes(keyword)) {
            currentKind = monaco.languages.CompletionItemKind.Function; // Use monaco.languages
            currentInsertText = `${keyword}($1)$0`; // Snippet string
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
          }// Add more snippets as needed

          // Remove trailing space for snippets if it was added by default
          if (isSnippet && currentInsertText.endsWith(' ')) {
            currentInsertText = currentInsertText.slice(0, -1);
          }

          return createCompletionItem(
            monacoInstance, // Pass the instance from onMount
            keyword,
            currentKind,
            currentInsertText,
            range,
            currentDetail,
            undefined, // documentation
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
    if (monacoRef.current) { // Check if monacoRef.current is not null
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
        onChange={(val) => onChange(val || '')} // Ensure val is not undefined
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
          fontFamily: 'Maple Mono, Monaco, "Courier New", monospace', // Your custom font
          fixedOverflowWidgets: true, // Good for suggestion popups
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
          tabCompletion: 'on',
          // consider adding these for better suggestion experience
          quickSuggestions: { // Show suggestions not just on trigger characters
            other: true,
            comments: false,
            strings: true
          },
          suggestSelection: 'first', // 'first', 'recentlyUsed', 'recentlyUsedByPrefix'
        }}
      />
    </div>
  )
}