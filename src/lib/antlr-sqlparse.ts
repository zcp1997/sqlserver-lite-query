// 基于ANTLR4的SQL智能提示模块 - 全面拥抱Visitor模式
// 使用Visitor模式精确分析SQL语法树和光标上下文
import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { RuleNode } from 'antlr4ts/tree/RuleNode';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';

// 导入ANTLR生成的解析器、词法分析器和节点类型
import { TSqlLexer } from '@/lib/antlr/TSqlLexer';
import {
  Insert_statementContext,
  Join_partContext,
  Table_source_itemContext,
  TSqlParser,
  Tsql_fileContext,
  Update_statementContext,
  Execute_statementContext,
  Full_column_nameContext,
  Query_specificationContext, // 修正：这是包含SELECT/FROM/WHERE的核心节点
} from '@/lib/antlr/TSqlParser';
import { TSqlParserVisitor } from '@/lib/antlr/TSqlParserVisitor';

// API 调用
import { search_column_details, search_table_names } from '@/lib/api';
import { getProcedureSuggestions } from '@/lib/sqlcache-manager';

// --- 1. 核心数据结构定义 ---

export interface ParsedTable {
  name: string;
  schema?: string;
  alias?: string;
  fullName: string;
}

// 根据您的要求，简化为三种核心建议类型
export type CursorContext =
  | { type: 'TABLE_SUGGESTION'; reason: 'FROM' | 'JOIN' | 'UPDATE' }
  | { type: 'COLUMN_SUGGESTION'; forTables: ParsedTable[]; reason: 'SELECT' | 'WHERE' | 'DOT' | 'SET' | 'INSERT' }
  | { type: 'PROCEDURE_SUGGESTION'; reason: 'EXEC' }
  | { type: 'UNKNOWN'; reason: null };

// Monaco 枚举值的常量替代
const COMPLETION_ITEM_KIND = {
  Field: 5,
  Function: 3,
  Module: 9,
  Keyword: 14,
  Text: 1,
} as const;

// 建议项创建函数类型
export type CreateCompletionItemFunction = (
  label: string,
  kind: any,
  insertText: string,
  range: any,
  detail?: string,
  documentation?: string,
  isSnippet?: boolean,
  priority?: 'high' | 'medium' | 'low'
) => any;

// --- 2. ANTLR 解析器创建与配置 ---

/**
 * 创建ANTLR词法、语法分析器，并生成分析树
 * @param sql SQL文本
 * @returns 解析器和分析树，或在失败时返回null
 */
function createSqlParser(sql: string): { parser: TSqlParser; tree: Tsql_fileContext; hasErrors: boolean } | null {
  try {
    // 预处理SQL - 处理常见的不完整语句
    let processedSql = sql.toUpperCase();

    // 特殊处理：如果是 "SELECT FROM" 这种情况，临时添加一个 * 来让语法通过
    if (processedSql.match(/SELECT\s+FROM/i)) {
      processedSql = processedSql.replace(/SELECT\s+FROM/i, 'SELECT * FROM');
      console.log('🔧 临时修复SQL语法:', processedSql);
    }

    // 处理其他常见的不完整情况
    if (processedSql.match(/SELECT\s*$/i)) {
      processedSql += ' *';
    }

    const inputStream = CharStreams.fromString(processedSql);
    const lexer = new TSqlLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer as any);
    const parser = new TSqlParser(tokenStream);

    parser.removeErrorListeners(); // 移除默认的控制台错误输出

    // 增强错误处理 - 记录但不阻止解析
    let hasParseErrors = false;
    parser.addErrorListener({
      syntaxError: (recognizer, offendingSymbol, line, charPositionInLine, msg, e) => {
        hasParseErrors = true;
        console.warn(`ANTLR语法错误: 行${line}:${charPositionInLine} - ${msg}`);
      },
    });

    const tree = parser.tsql_file();

    // 即使有语法错误，也尝试返回部分解析的树
    if (hasParseErrors) {
      console.warn('⚠️ SQL解析存在错误，但将继续使用部分解析结果');
    }

    return { parser, tree, hasErrors: hasParseErrors };
  } catch (error) {
    console.error('创建SQL解析器失败:', error);
    return null;
  }
}

// --- 3. 简单的文本分析函数 ---

/**
 * 当ANTLR解析失败时，使用简单的文本分析来判断上下文
 * 这是一个后备方案，专门处理常见的不完整SQL情况
 */
function analyzeTextContext(text: string, cursorOffset: number): CursorContext {
  const textBeforeCursor = text.substring(0, cursorOffset).toUpperCase().trim();
  const textAfterCursor = text.substring(cursorOffset).toUpperCase().trim();
  const fullTextUpper = text.toUpperCase();

  console.log('📝 文本分析:', { textBeforeCursor, textAfterCursor, cursorOffset });

  // 特殊处理：SELECT FROM 这种情况
  // 如果光标在SELECT之后，FROM之前的空格中
  const selectMatch = textBeforeCursor.match(/SELECT\s*$/);
  if (selectMatch) {
    // 光标紧跟在SELECT后面
    if (textAfterCursor.startsWith('FROM')) {
      return { type: 'COLUMN_SUGGESTION', forTables: [], reason: 'SELECT' };
    }
  }

  // 检查是否是点号场景（例如：A02.）
  const dotMatch = textBeforeCursor.match(/(\w+)\.$/);
  if (dotMatch) {
    const tableOrAlias = dotMatch[1];
    console.log('🔍 检测到点号场景，表/别名:', tableOrAlias);

    // 从整个文本中提取所有表信息，找到匹配的表
    const allTables = extractTablesFromText(text);
    const matchedTables = allTables.filter(t =>
      t.alias === tableOrAlias ||
      t.name === tableOrAlias ||
      t.name.toUpperCase() === tableOrAlias.toUpperCase()
    );

    console.log('🔍 点号场景匹配的表:', matchedTables);

    if (matchedTables.length > 0) {
      return {
        type: 'COLUMN_SUGGESTION',
        forTables: matchedTables,
        reason: 'DOT'
      };
    } else {
      // 如果没有找到匹配的表，创建一个临时的表对象
      return {
        type: 'COLUMN_SUGGESTION',
        forTables: [{ name: tableOrAlias, fullName: tableOrAlias }],
        reason: 'DOT'
      };
    }
  }

  // 检查是否在SELECT和FROM之间的任何位置
  const selectIndex = textBeforeCursor.lastIndexOf('SELECT');
  const fromIndexBefore = textBeforeCursor.lastIndexOf('FROM');
  const fromIndexAfter = fullTextUpper.indexOf('FROM', cursorOffset);

  if (selectIndex >= 0) {
    // 如果SELECT后面没有FROM，或者FROM在光标之后
    if (fromIndexBefore < selectIndex) {
      // 光标在SELECT之后，但在FROM之前（或没有FROM）
      return { type: 'COLUMN_SUGGESTION', forTables: [], reason: 'SELECT' };
    }
  }

  // 检查是否在FROM之后
  if (fromIndexBefore >= 0 && fromIndexBefore > selectIndex) {
    const afterFromText = textBeforeCursor.substring(fromIndexBefore + 4).trim();

    // 如果FROM后面没有完整的表名，或者光标就在FROM后面
    // 改进：检查是否已经有完整的表名（包含中文字符）
    const hasCompleteTableName = afterFromText && (
      /\[[^\]]+\]\.\[[^\]]+\]/.test(afterFromText) || // [schema].[table]
      /\[[^\]]+\]/.test(afterFromText) || // [table] 
      /[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/.test(afterFromText) // schema.table
    );

    if (!afterFromText || afterFromText === '' || !hasCompleteTableName) {
      return { type: 'TABLE_SUGGESTION', reason: 'FROM' };
    }
  }

  // 检查是否是EXEC语句
  if (textBeforeCursor.match(/(?:EXEC|EXECUTE)\s*$/i)) {
    return { type: 'PROCEDURE_SUGGESTION', reason: 'EXEC' };
  }

  // 检查UPDATE语句
  if (textBeforeCursor.includes('UPDATE') && !textBeforeCursor.includes('SET')) {
    return { type: 'TABLE_SUGGESTION', reason: 'UPDATE' };
  }

  // 检查INSERT语句
  if (textBeforeCursor.includes('INSERT') && textBeforeCursor.includes('INTO')) {
    return { type: 'COLUMN_SUGGESTION', forTables: [], reason: 'INSERT' };
  }

  return { type: 'UNKNOWN', reason: null };
}

// --- 4. 核心的 SqlVisitor 类 ---

export class SqlVisitor extends AbstractParseTreeVisitor<void> implements TSqlParserVisitor<void> {
  public tables: ParsedTable[] = [];
  public cursorContext: CursorContext = { type: 'UNKNOWN', reason: null };
  private visitedTables = new Set<string>();
  private hasErrors = false;

  constructor(private readonly cursorOffset: number, private readonly originalText: string) {
    super();
  }

  // 辅助函数：判断光标是否严格位于节点内部
  private isCursorWithin(node: RuleNode | undefined): boolean {
    if (!node) return false;
    const start = node.sourceInterval.a;
    const stop = node.sourceInterval.b;
    return this.cursorOffset >= start && this.cursorOffset <= stop + 1;
  }

  // 辅助函数：判断光标是否在某个 Token 之后
  private isCursorAfter(token: TerminalNode | undefined): boolean {
    if (!token) return false;
    return this.cursorOffset > token.symbol.stopIndex;
  }

  // --- Visitor 方法重写 ---

  // 总入口
  visitTsql_file = (ctx: Tsql_fileContext) => this.visitChildren(ctx);

  /**
   * 【已修正】访问表节点
   * 使用 ANTLR 生成的精确方法提取信息
   */
  visitTable_source_item(ctx: Table_source_itemContext): void {
    try {
      const tableNameNode = ctx.full_table_name();

      if (tableNameNode) {
        const fullTableNameText = tableNameNode.text;
        if (!this.visitedTables.has(fullTableNameText)) {
          const alias = ctx.as_table_alias()?.table_alias().text;

          // 修正: id_() 返回的是一个数组，最后一个元素是表名，倒数第二个是schema
          const idParts = tableNameNode.id_();
          const numParts = idParts.length;

          const name = numParts > 0 ? idParts[numParts - 1].text : '';
          const schema = numParts > 1 ? idParts[numParts - 2].text : undefined;

          console.log('🔍 ANTLR解析表名:', {
            fullTableNameText,
            idParts: idParts.map(id => id.text),
            name,
            schema,
            alias
          });

          if (name) {
            this.tables.push({
              name,
              schema,
              alias,
              fullName: fullTableNameText
            });
            this.visitedTables.add(fullTableNameText);
          }
        }
      }
    } catch (error) {
      console.warn('访问表节点时出错:', error);
      this.hasErrors = true;
    }

    // 必须继续访问子节点，否则会中断整棵树的遍历
    this.visitChildren(ctx);
  }

  /**
   * 【已修正】访问 `SELECT ... FROM ... WHERE ...` 结构的核心
   * 增加错误处理和更精确的边界判断
   */
  visitQuery_specification(ctx: Query_specificationContext): void {
    try {
      const selectToken = ctx.SELECT();
      const fromToken = ctx.FROM();
      const whereToken = ctx.WHERE();

      // 场景1: 光标在 SELECT 之后, FROM 之前 (或没有FROM) -> 列建议
      if (selectToken && this.isCursorAfter(selectToken)) {
        if (!fromToken || this.cursorOffset <= fromToken.symbol.startIndex) {
          this.cursorContext = { type: 'COLUMN_SUGGESTION', forTables: this.tables, reason: 'SELECT' };
        }
      }

      // 场景2: 光标在 FROM 之后, WHERE 之前 (或没有WHERE) -> 表建议
      if (fromToken && this.isCursorAfter(fromToken)) {
        if (!whereToken || this.cursorOffset <= whereToken.symbol.startIndex) {
          // 检查FROM后面是否已经有表名
          const textAfterFrom = this.originalText.substring(fromToken.symbol.stopIndex + 1, this.cursorOffset);
          if (!textAfterFrom.trim() || textAfterFrom.trim().split(/\s+/).length < 2) {
            this.cursorContext = { type: 'TABLE_SUGGESTION', reason: 'FROM' };
          }
        }
      }

      // 场景3: 光标在 WHERE 之后 -> 列建议
      if (whereToken && this.isCursorAfter(whereToken)) {
        this.cursorContext = { type: 'COLUMN_SUGGESTION', forTables: this.tables, reason: 'WHERE' };
      }
    } catch (error) {
      console.warn('访问查询规格节点时出错:', error);
      this.hasErrors = true;
    }

    // 继续访问子节点，让更精确的上下文（如JOIN, 点号）有机会覆盖上面的判断
    this.visitChildren(ctx);
  }

  visitJoin_part(ctx: Join_partContext): void {
    try {
      if (this.isCursorWithin(ctx)) {
        // 检查是否有JOIN关键字
        const contextText = ctx.text?.toUpperCase();
        if (contextText && contextText.includes('JOIN')) {
          this.cursorContext = { type: 'TABLE_SUGGESTION', reason: 'JOIN' };
        }
      }
    } catch (error) {
      console.warn('访问JOIN节点时出错:', error);
      this.hasErrors = true;
    }
    this.visitChildren(ctx);
  }

  // 处理点表示法
  visitFull_column_name(ctx: Full_column_nameContext): void {
    try {
      if (this.isCursorWithin(ctx)) {
        const text = ctx.text;
        if (text && text.includes('.')) {
          // 基本的点表示法处理
          const parts = text.split('.');
          if (parts.length >= 2) {
            const tableOrAlias = parts[0];
            const matchedTables = this.tables.filter(t => t.alias === tableOrAlias || t.name === tableOrAlias);
            this.cursorContext = {
              type: 'COLUMN_SUGGESTION',
              forTables: matchedTables.length > 0 ? matchedTables : [{ name: tableOrAlias, fullName: tableOrAlias }],
              reason: 'DOT'
            };
          }
        }
      }
    } catch (error) {
      console.warn('访问列名节点时出错:', error);
      this.hasErrors = true;
    }
    this.visitChildren(ctx);
  }

  // 处理 UPDATE 语句
  visitUpdate_statement(ctx: Update_statementContext): void {
    try {
      if (this.isCursorWithin(ctx)) {
        const text = ctx.text?.toUpperCase();
        if (text && text.includes('SET')) {
          // 如果包含SET，说明在SET子句中
          this.cursorContext = { type: 'COLUMN_SUGGESTION', forTables: this.tables, reason: 'SET' };
        } else {
          // 在UPDATE关键字后但SET之前
          this.cursorContext = { type: 'TABLE_SUGGESTION', reason: 'UPDATE' };
        }
      }
    } catch (error) {
      console.warn('访问UPDATE节点时出错:', error);
      this.hasErrors = true;
    }
    this.visitChildren(ctx);
  }

  // 处理 INSERT 语句
  visitInsert_statement(ctx: Insert_statementContext): void {
    try {
      if (this.isCursorWithin(ctx)) {
        const text = ctx.text?.toUpperCase();
        if (text && text.includes('INTO')) {
          this.cursorContext = { type: 'COLUMN_SUGGESTION', forTables: this.tables, reason: 'INSERT' };
        }
      }
    } catch (error) {
      console.warn('访问INSERT节点时出错:', error);
      this.hasErrors = true;
    }
    this.visitChildren(ctx);
  }

  // 处理 EXEC 语句
  visitExecute_statement(ctx: Execute_statementContext): void {
    try {
      if (this.isCursorWithin(ctx)) {
        this.cursorContext = { type: 'PROCEDURE_SUGGESTION', reason: 'EXEC' };
      }
    } catch (error) {
      console.warn('访问EXEC节点时出错:', error);
      this.hasErrors = true;
    }
    this.visitChildren(ctx);
  }

  // 优雅处理不完整的输入
  visitErrorNode(node: ErrorNode): void {
    this.hasErrors = true;

    try {
      const parentCtx = node.parent;
      if (!parentCtx) return;

      // 处理常见的错误情况，如逗号后的表建议
      if (node.text === ',') {
        if (this.cursorOffset >= node.symbol.startIndex) {
          this.cursorContext = { type: 'TABLE_SUGGESTION', reason: 'FROM' };
        }
      }

      // 特殊处理 SELECT FROM 这种情况
      if (node.text === 'FROM') {
        const textBeforeCursor = this.originalText.substring(0, this.cursorOffset).toUpperCase();
        if (textBeforeCursor.includes('SELECT') && this.cursorOffset > node.symbol.startIndex) {
          this.cursorContext = { type: 'TABLE_SUGGESTION', reason: 'FROM' };
        }
      }
    } catch (error) {
      console.warn('处理错误节点时出错:', error);
    }
  }

  // 【必需】实现抽象基类的 defaultResult 方法
  protected defaultResult(): void {
    return;
  }
}

// --- 5. 建议项获取的辅助函数 ---

async function getTableSuggestions(
  sessionId: string,
  createCompletionItem: CreateCompletionItemFunction,
  range: any
): Promise<any[]> {
  const tables = await search_table_names(sessionId, "");
  return tables.map(table => {
    const label = table.schema ? `[${table.schema}].[${table.name}]` : `[${table.name}]`;
    return createCompletionItem(
      table.name, COMPLETION_ITEM_KIND.Module, `${label} `, range,
      table.schema || 'Table', `Table: ${label}`, false, 'high'
    );
  });
}

async function getColumnSuggestions(
  sessionId: string,
  tables: ParsedTable[],
  createCompletionItem: CreateCompletionItemFunction,
  range: any,
  reason: CursorContext['reason']
): Promise<any[]> {
  const suggestions: any[] = [];
  if (reason === 'SELECT') {
    suggestions.push(createCompletionItem('*', COMPLETION_ITEM_KIND.Field, '* ', range, 'Select all columns'));
  }

  for (const table of tables) {
    try {
      console.log('🔍 调用 search_column_details 参数:', {
        sessionId,
        tableName: table.name,
        schema: table.schema,
        fullTable: table
      });

      const columns = await search_column_details(sessionId, table.name, table.schema);
      columns.forEach(col => {
        if (col && col.name) {
          suggestions.push(createCompletionItem(
            col.name, COMPLETION_ITEM_KIND.Field, col.name, range,
            table.fullName, `Column: ${col.name}\nTable: ${table.fullName}\nType: ${col.data_type || 'unknown'}`, false, 'high'
          ));
        }
      });
    } catch (error) {
      console.error(`获取表 ${table.name} 的列失败:`, error);
    }
  }
  return suggestions;
}

async function getProcedureSuggestionsFromCache(
  sessionId: string,
  keyword: string,
  createCompletionItem: CreateCompletionItemFunction,
  range: any
): Promise<any[]> {
  // 使用缓存管理器获取存储过程建议
  const procedures = await getProcedureSuggestions(sessionId, keyword);
  return procedures.map((proc: any) => {
    const insertText = proc.execute_template || proc.name;
    let documentation = `存储过程: ${proc.full_name || proc.name}\n`;

    // 添加参数文档
    if (proc.parameters && Array.isArray(proc.parameters) && proc.parameters.length > 0) {
      documentation += `\n参数:\n`;
      proc.parameters.forEach((param: any) => {
        const outputLabel = param.is_output ? ' (OUTPUT)' : '';
        const defaultLabel = param.has_default ? ' (可选)' : ' (必需)';
        documentation += `  ${param.name}: ${param.data_type}${outputLabel}${defaultLabel}\n`;
      });
    }

    return createCompletionItem(
      proc.name, COMPLETION_ITEM_KIND.Function, insertText, range,
      proc.schema_name || 'Procedure', documentation, true, 'high'
    );
  });
}

// --- 6. 最终导出的主函数 ---

/**
 * 生成动态SQL智能提示 - 使用重构后的Visitor模式
 * 逻辑: 创建树 -> 运行 Visitor -> 根据 Visitor 的结果调用 API
 */
export async function generateDynamicSuggestions(
  sessionId: string,
  fullText: string,
  cursorOffset: number, // 直接传递光标位置
  createCompletionItem: CreateCompletionItemFunction,
  range: any
): Promise<any[]> {
  try {
    console.log('🔍 开始生成动态SQL建议...', { cursorOffset, text: fullText });

    // 性能保护
    if (fullText.length > 50000) {
      console.warn('SQL文本过长，已截断');
      fullText = fullText.substring(0, 50000);
    }

    // 首先尝试文本分析 - 对于常见的不完整SQL，这通常更可靠
    const textContext = analyzeTextContext(fullText, cursorOffset);
    console.log('📝 文本分析结果:', textContext);

    // 如果文本分析能给出明确结果，优先使用
    if (textContext.type !== 'UNKNOWN') {
      console.log('✅ 使用文本分析结果');

      // 根据文本分析结果调用API
      switch (textContext.type) {
        case 'TABLE_SUGGESTION':
          return await getTableSuggestions(sessionId, createCompletionItem, range);

        case 'COLUMN_SUGGESTION':
          let tables = textContext.forTables;
          if ((tables === undefined || tables.length === 0) && textContext.reason === 'SELECT') {
            tables = extractTablesFromText(fullText);
          }

          return await getColumnSuggestions(sessionId, tables, createCompletionItem, range, textContext.reason);

        case 'PROCEDURE_SUGGESTION':
          const textBeforeCursor = fullText.substring(0, cursorOffset);
          const execMatch = textBeforeCursor.match(/(?:EXEC|EXECUTE)\s+(\w*)$/i);
          const keyword = execMatch ? execMatch[1] : '';
          return await getProcedureSuggestionsFromCache(sessionId, keyword, createCompletionItem, range);
      }
    }

    // 如果文本分析无法确定，再尝试ANTLR解析
    console.log('🔄 文本分析无结果，尝试ANTLR解析...');

    // 1. 创建解析器和分析树
    const result = createSqlParser(fullText);
    let cursorContext: CursorContext;
    let tables: ParsedTable[] = [];

    if (!result || result.hasErrors) {
      console.warn('⚠️ ANTLR解析失败或有错误，使用文本分析结果');
      cursorContext = textContext;
    } else {
      // 2. 运行 Visitor 进行分析
      const visitor = new SqlVisitor(cursorOffset, fullText);

      try {
        // 先收集表信息
        const tableVisitor = new SqlVisitor(Infinity, fullText); // Infinity offset ensures it scans the whole tree
        tableVisitor.visit(result.tree);
        visitor.tables = tableVisitor.tables; // 将收集到的表信息赋给主visitor

        // 现在进行上下文分析
        visitor.visit(result.tree);

        cursorContext = visitor.cursorContext;
        tables = visitor.tables;

        // 如果Visitor分析失败或返回UNKNOWN，使用文本分析作为后备
        if (cursorContext.type === 'UNKNOWN') {
          console.warn('⚠️ Visitor分析不完整，使用文本分析补充');
          cursorContext = textContext;
        }

      } catch (visitorError) {
        console.warn('⚠️ Visitor执行失败，使用文本分析后备方案:', visitorError);
        cursorContext = textContext;
      }
    }

    console.log('📊 最终分析结果:', {
      context: cursorContext,
      tables: tables.map(t => ({
        name: t.name,
        schema: t.schema,
        fullName: t.fullName
      }))
    });

    // 3. 根据精确的上下文调用相应的API
    switch (cursorContext.type) {
      case 'TABLE_SUGGESTION':
        console.log(`🗃️ 检测到表建议需求: ${cursorContext.reason}`);
        return await getTableSuggestions(sessionId, createCompletionItem, range);

      case 'COLUMN_SUGGESTION':
        console.log(`📊 检测到列建议需求: ${cursorContext.reason}`);
        // 如果是点表示法，但没匹配到表，forTables会是空的，此时不提供建议
        if (cursorContext.reason === 'DOT' && cursorContext.forTables.length === 0) {
          return [];
        }
        let targetTables = cursorContext.forTables && cursorContext.forTables.length > 0
          ? cursorContext.forTables
          : tables.length > 0 ? tables : extractTablesFromText(fullText);
        return await getColumnSuggestions(sessionId, targetTables, createCompletionItem, range, cursorContext.reason);

      case 'PROCEDURE_SUGGESTION':
        console.log(`🔧 检测到存储过程建议需求: ${cursorContext.reason}`);
        const textBeforeCursor = fullText.substring(0, cursorOffset);
        const execMatch = textBeforeCursor.match(/(?:EXEC|EXECUTE)\s+(\w*)$/i);
        const keyword = execMatch ? execMatch[1] : '';
        return await getProcedureSuggestionsFromCache(sessionId, keyword, createCompletionItem, range);

      default:
        console.log('❓ 未知或不需建议的上下文');
        return [];
    }
  } catch (error) {
    console.error('❌ 生成动态建议时发生严重错误:', error);
    return [];
  }
}

/**
 * 从文本中提取表信息的简单函数
 * 用于当ANTLR解析失败时的后备方案
 */
function extractTablesFromText(text: string): ParsedTable[] {
  const tables: ParsedTable[] = [];

  // 1. 首先提取FROM子句中的表
  // 使用更精确的正则表达式来匹配包含中文字符的表名
  const fromPattern = /FROM\s+(?:\[([^\]]+)\]\.\[([^\]]+)\]|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*)\.\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*))(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;

  let match;
  while ((match = fromPattern.exec(text)) !== null) {
    let schema: string | undefined;
    let name: string;
    let alias: string | undefined;
    let fullName: string;

    if (match[1] && match[2]) {
      // 匹配 [schema].[table] 格式
      schema = match[1];
      name = match[2];
      fullName = `[${schema}].[${name}]`;
      alias = match[8];
    } else if (match[3]) {
      // 匹配 [table] 格式
      name = match[3];
      fullName = `[${name}]`;
      alias = match[8];
    } else if (match[4] && match[5]) {
      // 匹配 schema.[table] 格式
      schema = match[4];
      name = match[5];
      fullName = `${schema}.[${name}]`;
      alias = match[8];
    } else if (match[6] && match[7]) {
      // 匹配 schema.table 格式
      const schemaPart = match[6].replace(/\.$/, ''); // 移除末尾的点
      schema = schemaPart;
      name = match[7];
      fullName = `${schema}.${name}`;
      alias = match[8];
    } else if (match[7]) {
      // 匹配单独的 table 格式
      name = match[7];
      fullName = name;
      alias = match[8];
    } else {
      continue; // 跳过无法解析的匹配
    }

    console.log('📝 从文本提取表:', { schema, name, alias, fullName, match: match[0] });

    tables.push({
      name,
      schema,
      alias,
      fullName
    });
  }

  // 2. 然后提取JOIN子句中的表
  // 使用更简单的正则表达式匹配JOIN子句
  // 匹配形如: LEFT JOIN table_name alias 或 LEFT JOIN [schema].[table] alias
  const joinPattern = /(?:LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|FULL\s+OUTER\s+JOIN|FULL\s+JOIN|OUTER\s+JOIN|JOIN)\s+([^\s]+(?:\s+[^\s]+)*?)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s+ON/gi;

  let joinMatch;
  while ((joinMatch = joinPattern.exec(text)) !== null) {
    const tableExpr = joinMatch[1].trim();
    const alias = joinMatch[2];

    let schema: string | undefined;
    let name: string;
    let fullName: string;

    // 解析表表达式
    if (tableExpr.match(/^\[([^\]]+)\]\.\[([^\]]+)\]$/)) {
      // [schema].[table] 格式
      const parts = tableExpr.match(/^\[([^\]]+)\]\.\[([^\]]+)\]$/);
      schema = parts![1];
      name = parts![2];
      fullName = tableExpr;
    } else if (tableExpr.match(/^\[([^\]]+)\]$/)) {
      // [table] 格式
      const parts = tableExpr.match(/^\[([^\]]+)\]$/);
      name = parts![1];
      fullName = tableExpr;
    } else if (tableExpr.includes('.')) {
      // schema.table 格式
      const parts = tableExpr.split('.');
      schema = parts[0];
      name = parts[1];
      fullName = tableExpr;
    } else {
      // 单独的表名（可能包含中文）
      name = tableExpr;
      fullName = tableExpr;
    }

    console.log('📝 从JOIN提取表:', { schema, name, alias, fullName, tableExpr, match: joinMatch[0] });

    tables.push({
      name,
      schema,
      alias,
      fullName
    });
  }

  // 3. 如果上面的正则没有匹配到，尝试更简单的回退方案
  if (tables.length === 0) {
    // 简单匹配，直接提取方括号内的内容
    const simplePattern = /(?:FROM|JOIN)\s+(?:\[[^\]]+\]\.)?\[([^\]]+)\]/gi;
    let simpleMatch;
    while ((simpleMatch = simplePattern.exec(text)) !== null) {
      const name = simpleMatch[1];
      console.log('📝 简单模式提取表:', name);
      tables.push({
        name,
        fullName: `[${name}]`
      });
    }
  }

  return tables;
}