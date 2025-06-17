import {
  CharStreams,
  CommonTokenStream,
  Token,
  DefaultErrorStrategy,
  InputMismatchException,
  Parser,
} from 'antlr4ts';
import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';

// ANTLR generated files
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
  Query_specificationContext,
} from '@/lib/antlr/TSqlParser';
import { TSqlParserVisitor } from '@/lib/antlr/TSqlParserVisitor';

// API calls
import { search_column_details, search_table_names } from '@/lib/api';
import { getProcedureSuggestions } from '@/lib/sqlcache-manager';

// --- 1. 核心数据结构定义 ---

export interface ParsedTable {
  name: string;
  schema?: string;
  alias?: string;
  fullName: string;
  startPosition: number;
  endPosition: number;
}

export interface CursorPosition {
  line: number;
  column: number;
  tokenIndex: number;
  charIndex: number;
}

export type CursorContext =
  | { type: 'TABLE_SUGGESTION'; reason: 'FROM' | 'JOIN' | 'UPDATE' | 'INSERT_INTO'; precedingKeyword?: string }
  | { type: 'COLUMN_SUGGESTION'; forTables: ParsedTable[]; reason: 'SELECT' | 'WHERE' | 'DOT' | 'SET' | 'INSERT' | 'GROUP_BY' | 'ORDER_BY'; precedingKeyword?: string }
  | { type: 'PROCEDURE_SUGGESTION'; reason: 'EXEC'; precedingKeyword?: string }
  | { type: 'KEYWORD_SUGGESTION'; reason: 'GENERAL' | 'AFTER_SELECT' | 'AFTER_FROM' | 'STATEMENT_START' }
  | { type: 'UNKNOWN'; reason: null };

// 特殊光标标记 Token
const CURSOR_TOKEN = '__CURSOR_MARKER__';
const CURSOR_TOKEN_TYPE = 999; // 使用一个不会与现有token冲突的类型

// Monaco constants
const COMPLETION_ITEM_KIND = {
  Field: 5,
  Function: 3,
  Module: 9,
  Keyword: 14,
  Text: 1,
} as const;

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

// --- 2. 词法分析与标记处理 ---

/**
 * 增强的词法分析函数 - 直接使用ANTLR的Lexer
 */
function performLexicalAnalysis(text: string): Token[] {
  const inputStream = CharStreams.fromString(text);
  const lexer = new TSqlLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  tokenStream.fill();
  return tokenStream.getTokens();
}

/**
 * 获取光标位置前的有效标记
 */
function getPrecedingTokens(tokens: Token[], cursorOffset: number, count: number = 5): Token[] {
  const result: Token[] = [];
  let currentOffset = 0;

  // 找出光标前的token
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    currentOffset = token.stopIndex + 1;

    // 跳过隐藏通道的token(注释、空白等)
    if (token.channel !== 0) continue;

    if (currentOffset <= cursorOffset) {
      result.push(token);
      // 只保留最后count个token
      if (result.length > count) {
        result.shift();
      }
    } else {
      break;
    }
  }

  return result;
}

/**
 * 获取光标位置后的有效标记
 */
function getFollowingTokens(tokens: Token[], cursorOffset: number, count: number = 3): Token[] {
  const result: Token[] = [];
  let currentOffset = 0;

  // 找出光标后的token
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // 跳过隐藏通道的token(注释、空白等)
    if (token.channel !== 0) continue;

    if (token.startIndex >= cursorOffset) {
      result.push(token);
      if (result.length >= count) break;
    }
  }

  return result;
}

/**
 * 检查一个标记是否匹配指定的关键字(不区分大小写)
 */
function isKeyword(token: Token, keyword: string): boolean {
  return (token && token.text && token.text.toUpperCase() === keyword.toUpperCase()) || false;
}

/**
 * 检查是否是标识符(包括中文字符)
 * 在SQL Server中，标识符可以包含Unicode字符
 */
function isIdentifier(token: Token): boolean {
  if (!token || !token.text) return false;

  // 检查是否是带方括号的标识符
  if (/^\[.*\]$/.test(token.text)) return true;

  // 检查是否是普通标识符(包含字母、数字、下划线、中文等Unicode字符)
  return token.type === TSqlLexer.ID ||
    token.type === TSqlLexer.SQUARE_BRACKET_ID ||
    /^[\p{L}\p{Nd}_\u4e00-\u9fa5]+$/u.test(token.text);
}

/**
 * 从方括号标识符中提取实际名称
 */
function cleanIdentifier(identifier: string): string {
  if (!identifier) return '';
  return identifier.replace(/^\[|\]$/g, '');
}

/**
 * 从一系列标记中提取表引用(表名、架构和别名)
 */
function extractTableReference(tokens: Token[], startIndex: number): ParsedTable | null {
  let i = startIndex;
  let schema: string | undefined;
  let name: string | undefined;
  let alias: string | undefined;

  // 跳过空白和注释
  while (i < tokens.length && tokens[i].channel !== 0) i++;

  // 没有找到有效token
  if (i >= tokens.length) return null;

  // 检查是否有schema部分 (schema.table格式)
  if (i + 2 < tokens.length && isIdentifier(tokens[i]) && tokens[i + 1].text === '.') {
    schema = cleanIdentifier(tokens[i].text || '');
    i += 2; // 跳过schema和点号
  }

  // 提取表名
  if (i < tokens.length && isIdentifier(tokens[i])) {
    name = cleanIdentifier(tokens[i].text || '');

    // 记录起始位置
    const startPosition = tokens[startIndex].startIndex || 0;
    const endPosition = tokens[i].stopIndex || 0;

    // 检查是否有别名
    i++; // 移动到下一个token

    // 跳过可能的空白
    while (i < tokens.length && tokens[i].channel !== 0) i++;

    // 检查AS关键字
    if (i < tokens.length && tokens[i].text?.toUpperCase() === 'AS') {
      i++; // 跳过AS

      // 跳过可能的空白
      while (i < tokens.length && tokens[i].channel !== 0) i++;

      // 获取别名
      if (i < tokens.length && isIdentifier(tokens[i])) {
        alias = cleanIdentifier(tokens[i].text || '');
      }
    }
    // 没有AS关键字但直接跟着一个标识符，也可能是别名
    else if (i < tokens.length && isIdentifier(tokens[i])) {
      alias = cleanIdentifier(tokens[i].text || '');
    }

    // 构建表全名
    const fullName = schema ? `[${schema}].[${name}]` : `[${name}]`;

    return {
      name,
      schema,
      alias,
      fullName,
      startPosition,
      endPosition
    };
  }

  return null;
}

/**
 * 从SQL文本中提取当前可见的所有表
 */
function extractVisibleTables(tokens: Token[], cursorOffset: number): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const tableMap = new Map<string, boolean>(); // 用于去重

  // 查找FROM和JOIN子句
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // 如果token超过光标位置，则不再继续
    if (token.startIndex > cursorOffset) break;

    if (token.channel === 0) { // 只处理主通道的token
      const text = token.text?.toUpperCase();

      // 查找表引入关键字
      if (text === 'FROM' || text === 'JOIN' ||
        text === 'UPDATE' || (text === 'INTO' && i > 0 && tokens[i - 1].text?.toUpperCase() === 'INSERT')) {

        // 提取表引用
        const tableRef = extractTableReference(tokens, i + 1);
        if (tableRef && !tableMap.has(tableRef.fullName)) {
          tables.push(tableRef);
          tableMap.set(tableRef.fullName, true);
        }
      }
    }
  }

  return tables;
}

/**
 * 基于词法分析推断光标上下文
 */
function inferContextFromTokens(tokens: Token[], cursorOffset: number): CursorContext {
  // 获取光标位置前的最近几个token
  const precedingTokens = getPrecedingTokens(tokens, cursorOffset, 5);
  const followingTokens = getFollowingTokens(tokens, cursorOffset, 2);

  // 如果没有前置token，说明在文档开始位置
  if (precedingTokens.length === 0) {
    return { type: 'KEYWORD_SUGGESTION', reason: 'STATEMENT_START' };
  }

  // 获取最后一个token
  const lastToken = precedingTokens[precedingTokens.length - 1];
  const lastTokenText = lastToken.text?.toUpperCase();

  // 检查是否在点号后面(需要列建议)
  if (lastTokenText === '.') {
    // 找到点号前面的标识符(表名或别名)
    if (precedingTokens.length >= 2) {
      const tableToken = precedingTokens[precedingTokens.length - 2];
      if (isIdentifier(tableToken)) {
        const tableOrAlias = cleanIdentifier(tableToken.text || '');

        // 查找匹配的表
        const visibleTables = extractVisibleTables(tokens, cursorOffset);
        const matchedTables = visibleTables.filter(t =>
          t.alias === tableOrAlias ||
          t.name === tableOrAlias ||
          t.name.toLowerCase() === tableOrAlias.toLowerCase()
        );

        return {
          type: 'COLUMN_SUGGESTION',
          forTables: matchedTables.length > 0 ? matchedTables : [{
            name: tableOrAlias,
            fullName: tableOrAlias,
            startPosition: tableToken.startIndex || 0,
            endPosition: tableToken.stopIndex || 0
          }],
          reason: 'DOT',
          precedingKeyword: '.'
        };
      }
    }
  }

  // 检查各种关键字
  switch (lastTokenText) {
    case 'SELECT':
      return {
        type: 'COLUMN_SUGGESTION',
        forTables: extractVisibleTables(tokens, cursorOffset),
        reason: 'SELECT',
        precedingKeyword: 'SELECT'
      };

    case 'FROM':
      return {
        type: 'TABLE_SUGGESTION',
        reason: 'FROM',
        precedingKeyword: 'FROM'
      };

    case 'WHERE':
    case 'AND':
    case 'OR':
    case 'ON':
      return {
        type: 'COLUMN_SUGGESTION',
        forTables: extractVisibleTables(tokens, cursorOffset),
        reason: 'WHERE',
        precedingKeyword: lastTokenText
      };

    case 'JOIN':
    case 'INNER':
    case 'LEFT':
    case 'RIGHT':
    case 'FULL':
    case 'CROSS':
      return {
        type: 'TABLE_SUGGESTION',
        reason: 'JOIN',
        precedingKeyword: lastTokenText
      };

    case 'UPDATE':
      return {
        type: 'TABLE_SUGGESTION',
        reason: 'UPDATE',
        precedingKeyword: 'UPDATE'
      };

    case 'INTO':
      // 检查前面是否有INSERT
      if (precedingTokens.length >= 2 && precedingTokens[precedingTokens.length - 2].text?.toUpperCase() === 'INSERT') {
        return {
          type: 'TABLE_SUGGESTION',
          reason: 'INSERT_INTO',
          precedingKeyword: 'INTO'
        };
      }
      break;

    case 'SET':
      return {
        type: 'COLUMN_SUGGESTION',
        forTables: extractVisibleTables(tokens, cursorOffset),
        reason: 'SET',
        precedingKeyword: 'SET'
      };

    case 'ORDER':
    case 'GROUP':
      // 检查下一个token是否为BY
      if (followingTokens.length > 0 && followingTokens[0].text?.toUpperCase() === 'BY') {
        return {
          type: 'COLUMN_SUGGESTION',
          forTables: extractVisibleTables(tokens, cursorOffset),
          reason: lastTokenText === 'ORDER' ? 'ORDER_BY' : 'GROUP_BY',
          precedingKeyword: `${lastTokenText} BY`
        };
      }
      break;

    case 'BY':
      // 检查前面是否有ORDER或GROUP
      if (precedingTokens.length >= 2) {
        const prevKeyword = precedingTokens[precedingTokens.length - 2].text?.toUpperCase();
        if (prevKeyword === 'ORDER' || prevKeyword === 'GROUP') {
          return {
            type: 'COLUMN_SUGGESTION',
            forTables: extractVisibleTables(tokens, cursorOffset),
            reason: prevKeyword === 'ORDER' ? 'ORDER_BY' : 'GROUP_BY',
            precedingKeyword: `${prevKeyword} BY`
          };
        }
      }
      break;

    case 'EXEC':
    case 'EXECUTE':
      return {
        type: 'PROCEDURE_SUGGESTION',
        reason: 'EXEC',
        precedingKeyword: lastTokenText
      };
  }

  // 检查特殊情况 - INSERT后面的列名列表
  if (precedingTokens.length >= 3) {
    const thirdLast = precedingTokens[precedingTokens.length - 3].text?.toUpperCase();
    const secondLast = precedingTokens[precedingTokens.length - 2].text?.toUpperCase();

    if (thirdLast === 'INSERT' && secondLast === 'INTO' && isIdentifier(lastToken)) {
      // 提取表名
      const tableName = cleanIdentifier(lastToken.text || '');
      return {
        type: 'COLUMN_SUGGESTION',
        forTables: [{
          name: tableName,
          fullName: tableName,
          startPosition: lastToken.startIndex || 0,
          endPosition: lastToken.stopIndex || 0
        }],
        reason: 'INSERT',
        precedingKeyword: 'INSERT'
      };
    }
  }

  // 默认提供关键字建议
  return { type: 'KEYWORD_SUGGESTION', reason: 'GENERAL' };
}

/**
 * 获取光标所在的单词(支持中文字符)
 */
function getWordAtCursor(text: string, offset: number): string {
  // 向左扫描，找到单词开始
  let start = offset;
  while (start > 0 && /[\p{L}\p{Nd}_\.\u4e00-\u9fa5]/u.test(text[start - 1])) {
    start--;
  }

  // 向右扫描，找到单词结束
  let end = offset;
  while (end < text.length && /[\p{L}\p{Nd}_\.\u4e00-\u9fa5]/u.test(text[end])) {
    end++;
  }

  return text.substring(start, end);
}

// --- 3. 增强的分词器 - 光标位置标记 ---

/**
 * 自定义词法分析器，在光标位置插入特殊标记token
 */
class CursorAwareLexer extends TSqlLexer {
  private cursorOffset: number;
  private cursorTokenInserted = false;
  private originalTokens: Token[] = [];

  constructor(input: any, cursorOffset: number) {
    super(input);
    this.cursorOffset = cursorOffset;
  }

  nextToken(): Token {
    const token = super.nextToken();

    if (!this.cursorTokenInserted && token.startIndex >= this.cursorOffset) {
      this.cursorTokenInserted = true;

      const cursorToken = this.createCursorToken();

      this.originalTokens.push(token);
      return cursorToken;
    }

    if (this.originalTokens.length > 0) {
      return this.originalTokens.shift()!;
    }

    return token;
  }

  private createCursorToken(): Token {
    return {
      type: CURSOR_TOKEN_TYPE,
      channel: 0,
      startIndex: this.cursorOffset,
      stopIndex: this.cursorOffset,
      tokenIndex: -1,
      line: 1,
      charPositionInLine: this.cursorOffset,
      text: CURSOR_TOKEN,
      tokenSource: this,
      inputStream: this.inputStream
    } as Token;
  }
}

// --- 4. 增强的语法分析器 - 容错处理 ---

/**
 * 超级容错错误处理策略
 * 允许更多情况下的恢复，适用于不完整的SQL
 */
class SuperTolerantErrorStrategy extends DefaultErrorStrategy {
  // 创建一个表示不需要的token的异常
  protected createUnwantedTokenException(recognizer: Parser): InputMismatchException {
    // 使用简单的构造函数
    return new InputMismatchException(recognizer, recognizer.context.start.type, recognizer.context);
  }

  // 创建一个表示缺失token的异常
  protected createMissingTokenException(recognizer: Parser): InputMismatchException {
    // 使用简单的构造函数
    return new InputMismatchException(recognizer);
  }

  // 重写错误报告方法
  protected reportUnwantedToken(recognizer: Parser): void {
    // 尝试通过简单的删除token恢复
    this.beginErrorCondition(recognizer);
    this.reportError(recognizer, this.createUnwantedTokenException(recognizer));
    recognizer.consume(); // 直接消费掉错误token并继续
  }

  protected reportMissingToken(recognizer: Parser): void {
    // 允许缺少token而不报错
    this.beginErrorCondition(recognizer);
    this.reportError(recognizer, this.createMissingTokenException(recognizer));
    // 不做任何恢复尝试，直接继续
  }
}


/**
 * 检查SQL是否明显不完整
 */
function isObviouslyIncomplete(sql: string): boolean {
  // 简单检查: SQL以关键字结尾
  const commonKeywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'AND', 'OR', 'GROUP', 'ORDER', 'HAVING'];
  const trimmed = sql.trim().toUpperCase();

  for (const keyword of commonKeywords) {
    if (trimmed.endsWith(keyword)) return true;
  }

  // 检查括号不匹配
  const openParens = (sql.match(/\(/g) || []).length;
  const closeParens = (sql.match(/\)/g) || []).length;

  return openParens !== closeParens;
}

/**
 * 尝试完成不完整的SQL以便更好地解析
 */
function completePartialSql(sql: string, cursorOffset: number): string {
  // 提取光标之前的部分
  const beforeCursor = sql.substring(0, cursorOffset);
  const afterCursor = sql.substring(cursorOffset);

  // 检查SQL类型并添加适当的结束
  if (/SELECT\b.*?\bFROM\b/i.test(beforeCursor) && !afterCursor.includes('WHERE')) {
    return sql + " WHERE 1=1";
  }

  // 匹配不平衡的括号
  const openParens = (beforeCursor.match(/\(/g) || []).length;
  const closeParens = (beforeCursor.match(/\)/g) || []).length;

  if (openParens > closeParens) {
    // 添加缺少的右括号
    return sql + ")".repeat(openParens - closeParens);
  }

  return sql;
}

interface ParseResult {
  parser: TSqlParser;
  tree: Tsql_fileContext;
  tokens: CommonTokenStream;
  errorMessages: string[];
  cursorTokenIndex?: number;
  partialParse?: boolean;
}

/**
 * 创建一个具备强大容错能力的 SQL 解析器，并支持光标位置标记。
 */
function createEnhancedSqlParser(sql: string, cursorOffset: number): ParseResult | null {
  try {
    console.log('🔧 开始解析SQL (增强容错版)，光标位置:', cursorOffset);

    // 检查SQL是否明显不完整，如果是则尝试完成它
    let processedSql = sql;
    let isPartialSql = false;

    if (isObviouslyIncomplete(sql)) {
      isPartialSql = true;
      processedSql = completePartialSql(sql, cursorOffset);
      console.log('⚠️ 检测到不完整SQL，添加了虚拟结束:', processedSql);
    }

    // 分词 & 光标位置标记
    const inputStream = CharStreams.fromString(processedSql);
    const lexer = new CursorAwareLexer(inputStream, cursorOffset);
    const tokenStream = new CommonTokenStream(lexer as any);

    // 预加载所有tokens
    tokenStream.fill();

    // 语法分析 + 容错处理
    const parser = new TSqlParser(tokenStream);

    // 移除默认的控制台错误打印器
    parser.removeErrorListeners();

    const errorMessages: string[] = [];

    // 添加自定义错误监听器
    parser.addErrorListener({
      syntaxError: (recognizer, offendingSymbol, line, charPositionInLine, msg, e) => {
        const errorMsg = `语法错误: 行${line}:${charPositionInLine} - ${msg}`;
        errorMessages.push(errorMsg);
        console.warn('⚠️', errorMsg);
      },
    });

    // 设置超级容错策略
    parser.errorHandler = new SuperTolerantErrorStrategy();

    // 执行解析，生成语法树
    const tree = parser.tsql_file();

    // 定位光标
    const tokens = tokenStream.getTokens();
    const cursorTokenIndex = tokens.findIndex(token => token.type === CURSOR_TOKEN_TYPE);

    console.log('✅ 解析完成:', {
      errorCount: errorMessages.length,
      cursorTokenIndex,
      totalTokens: tokens.length,
      isPartialSql
    });

    return {
      parser,
      tree,
      tokens: tokenStream,
      errorMessages,
      cursorTokenIndex,
      partialParse: isPartialSql || errorMessages.length > 0
    };
  } catch (error) {
    console.error('❌ 创建SQL解析器失败:', error);
    // 不返回null，而是返回尽可能多的信息
    try {
      const inputStream = CharStreams.fromString(sql);
      const lexer = new TSqlLexer(inputStream);
      const tokenStream = new CommonTokenStream(lexer);
      tokenStream.fill();

      return {
        tokens: tokenStream,
        errorMessages: [error instanceof Error ? error.message : String(error)],
        partialParse: true
      } as ParseResult;
    } catch (e) {
      return null;
    }
  }
}

// --- 5. 增强的访问者 - 精确的上下文识别 ---

export class EnhancedSqlVisitor extends AbstractParseTreeVisitor<void> implements TSqlParserVisitor<void> {
  public tables: ParsedTable[] = [];
  public cursorContext: CursorContext = { type: 'UNKNOWN', reason: null };
  public cursorPosition: CursorPosition | null = null;

  private visitedTables = new Set<string>();
  private cursorTokenIndex: number;
  private tokens: CommonTokenStream;

  constructor(
    private readonly cursorOffset: number,
    private readonly originalText: string,
    cursorTokenIndex: number,
    tokens: CommonTokenStream
  ) {
    super();
    this.cursorTokenIndex = cursorTokenIndex;
    this.tokens = tokens;
  }

  // --- 辅助方法 ---

  /**
   * 检查光标是否紧跟在指定token之后
   */
  private isCursorAfterToken(token: Token): boolean {
    if (this.cursorTokenIndex === -1) return false;

    const tokenIndex = this.getTokenIndex(token);
    return this.cursorTokenIndex === tokenIndex + 1;
  }

  /**
   * 获取token在token流中的索引
   */
  private getTokenIndex(token: Token): number {
    const allTokens = this.tokens.getTokens();
    return allTokens.findIndex(t => t === token);
  }

  /**
   * 获取光标前面的token
   */
  private getPrecedingToken(): Token | null {
    if (this.cursorTokenIndex <= 0) return null;

    const allTokens = this.tokens.getTokens();
    for (let i = this.cursorTokenIndex - 1; i >= 0; i--) {
      const token = allTokens[i];
      if (token.channel === 0) { // 只考虑主channel的token
        return token;
      }
    }
    return null;
  }

  /**
   * 获取光标后面的token
   */
  private getFollowingToken(): Token | null {
    if (this.cursorTokenIndex === -1) return null;

    const allTokens = this.tokens.getTokens();
    for (let i = this.cursorTokenIndex + 1; i < allTokens.length; i++) {
      const token = allTokens[i];
      if (token.channel === 0) { // 只考虑主channel的token
        return token;
      }
    }
    return null;
  }

  // --- 精确的访问者方法 ---

  visitTsql_file = (ctx: Tsql_fileContext) => {
    this.visitChildren(ctx);

    // 如果到最后还没有确定上下文，进行最后的判断
    if (this.cursorContext.type === 'UNKNOWN') {
      this.inferContextFromTokenSequence();
    }
  };

  /**
   * 基于token序列推断上下文 - 这是ANTLR访问者的备用方法
   */
  private inferContextFromTokenSequence(): void {
    const allTokens = this.tokens.getTokens();
    // 使用之前实现的词法分析函数
    this.cursorContext = inferContextFromTokens(allTokens, this.cursorOffset);
  }

  /**
   * 访问表节点 - 精确的表信息提取
   */
  visitTable_source_item(ctx: Table_source_itemContext): void {
    try {
      const tableNameNode = ctx.full_table_name();
      if (!tableNameNode) {
        this.visitChildren(ctx);
        return;
      }

      const fullTableNameText = tableNameNode.text;
      if (this.visitedTables.has(fullTableNameText)) {
        this.visitChildren(ctx);
        return;
      }

      // 获取表的位置信息
      const startPos = tableNameNode.start?.startIndex ?? 0;
      const endPos = tableNameNode.stop?.stopIndex ?? 0;

      // 提取表名和schema
      const idParts = tableNameNode.id_();
      const numParts = idParts.length;

      const name = numParts > 0 ? cleanIdentifier(idParts[numParts - 1].text) : '';
      const schema = numParts > 1 ? cleanIdentifier(idParts[numParts - 2].text) : undefined;

      // 提取别名
      const alias = ctx.as_table_alias()?.table_alias()?.text;
      const cleanAlias = alias ? cleanIdentifier(alias) : undefined;

      if (name) {
        const parsedTable: ParsedTable = {
          name,
          schema,
          alias: cleanAlias,
          fullName: fullTableNameText,
          startPosition: startPos,
          endPosition: endPos
        };

        this.tables.push(parsedTable);
        this.visitedTables.add(fullTableNameText);

        console.log('🗃️ 解析表信息:', parsedTable);
      }
    } catch (error) {
      console.warn('⚠️ 访问表节点时出错:', error);
    }

    this.visitChildren(ctx);
  }

  /**
   * 访问查询规格节点 - 精确的SELECT/FROM/WHERE上下文
   */
  visitQuery_specification(ctx: Query_specificationContext): void {
    console.log(`[Visitor] 开始解析 SELECT 查询块: "${ctx.text}"`);
    try {
      const selectToken = ctx.SELECT()?.symbol;
      const fromToken = ctx.FROM()?.symbol;
      const whereToken = ctx.WHERE()?.symbol;

      // 如果光标在特定关键字之后，设置相应的上下文
      if (selectToken && this.isCursorAfterToken(selectToken)) {
        this.cursorContext = {
          type: 'COLUMN_SUGGESTION',
          forTables: this.tables,
          reason: 'SELECT',
          precedingKeyword: 'SELECT'
        };
      } else if (fromToken && this.isCursorAfterToken(fromToken)) {
        this.cursorContext = {
          type: 'TABLE_SUGGESTION',
          reason: 'FROM',
          precedingKeyword: 'FROM'
        };
      } else if (whereToken && this.isCursorAfterToken(whereToken)) {
        this.cursorContext = {
          type: 'COLUMN_SUGGESTION',
          forTables: this.tables,
          reason: 'WHERE',
          precedingKeyword: 'WHERE'
        };
      }
    } catch (error) {
      console.warn('⚠️ 访问查询规格节点时出错:', error);
    }

    this.visitChildren(ctx);
  }

  // 其他访问者方法...
  visitJoin_part(ctx: Join_partContext): void {
    console.log(`[Visitor] 开始解析 JOIN 子句: "${ctx.text}"`);

    try {
      // 获取JOIN关键字token
      const joinToken = ctx.join_on()?.INNER()?.symbol ||
        ctx.join_on()?.LEFT()?.symbol ||
        ctx.join_on()?.RIGHT()?.symbol ||
        ctx.join_on()?.FULL()?.symbol ||
        ctx.join_on()?.JOIN()?.symbol;

      if (joinToken && this.isCursorAfterToken(joinToken)) {
        this.cursorContext = {
          type: 'TABLE_SUGGESTION',
          reason: 'JOIN',
          precedingKeyword: joinToken.text?.toUpperCase() || 'JOIN'
        };
      }
    } catch (error) {
      console.warn('⚠️ 访问JOIN子句时出错:', error);
    }

    this.visitChildren(ctx);
  }

  visitFull_column_name(ctx: Full_column_nameContext): void {
    // 列名上下文的精确处理
    this.visitChildren(ctx);
  }

  visitUpdate_statement(ctx: Update_statementContext): void {
    console.log(`[Visitor] 开始解析 UPDATE 语句: "${ctx.text}"`);

    try {
      // 检查UPDATE关键字
      const updateToken = ctx.UPDATE()?.symbol;

      if (updateToken && this.isCursorAfterToken(updateToken)) {
        this.cursorContext = {
          type: 'TABLE_SUGGESTION',
          reason: 'UPDATE',
          precedingKeyword: 'UPDATE'
        };
      }

      // 检查SET关键字
      const setToken = ctx.SET()?.symbol;

      if (setToken && this.isCursorAfterToken(setToken)) {
        this.cursorContext = {
          type: 'COLUMN_SUGGESTION',
          forTables: this.tables,
          reason: 'SET',
          precedingKeyword: 'SET'
        };
      }
    } catch (error) {
      console.warn('⚠️ 访问UPDATE语句时出错:', error);
    }

    this.visitChildren(ctx);
  }

  visitInsert_statement(ctx: Insert_statementContext): void {
    console.log(`[Visitor] 开始解析 INSERT 语句: "${ctx.text}"`);

    try {
      // 检查INTO关键字
      const intoToken = ctx.INTO()?.symbol;

      if (intoToken && this.isCursorAfterToken(intoToken)) {
        this.cursorContext = {
          type: 'TABLE_SUGGESTION',
          reason: 'INSERT_INTO',
          precedingKeyword: 'INTO'
        };
      }

      // 检查列名列表
      const columnListContext = ctx.insert_column_name_list();

      if (columnListContext && this.cursorOffset >= columnListContext.start?.startIndex! &&
        this.cursorOffset <= columnListContext.stop?.stopIndex!) {

        // 提取表名
        const tableName = ctx.ddl_object()?.full_table_name()?.text;
        if (tableName) {
          const cleanName = cleanIdentifier(tableName);
          this.cursorContext = {
            type: 'COLUMN_SUGGESTION',
            forTables: [{
              name: cleanName,
              fullName: tableName,
              startPosition: ctx.ddl_object()?.full_table_name()?.start?.startIndex || 0,
              endPosition: ctx.ddl_object()?.full_table_name()?.stop?.stopIndex || 0
            }],
            reason: 'INSERT',
            precedingKeyword: 'INSERT'
          };
        }
      }
    } catch (error) {
      console.warn('⚠️ 访问INSERT语句时出错:', error);
    }

    this.visitChildren(ctx);
  }

  visitExecute_statement(ctx: Execute_statementContext): void {
    console.log(`[Visitor] 开始解析 EXECUTE 语句: "${ctx.text}"`);

    try {
      // 检查EXEC/EXECUTE关键字
      const execToken = ctx.EXECUTE()?.symbol;

      if (execToken && this.isCursorAfterToken(execToken)) {
        this.cursorContext = {
          type: 'PROCEDURE_SUGGESTION',
          reason: 'EXEC',
          precedingKeyword: execToken.text?.toUpperCase() || 'EXEC'
        };
      }
    } catch (error) {
      console.warn('⚠️ 访问EXECUTE语句时出错:', error);
    }

    this.visitChildren(ctx);
  }

  visitErrorNode(node: ErrorNode): void {
    console.warn('⚠️ 遇到错误节点:', node.text);
  }

  protected defaultResult(): void {
    return;
  }
}

// --- 6. 语义分析器 ---

class SemanticAnalyzer {
  constructor(
    private sessionId: string,
    private tables: ParsedTable[],
    private cursorContext: CursorContext
  ) { }

  /**
   * 基于上下文和数据库元数据生成建议
   */
  async generateSuggestions(
    createCompletionItem: CreateCompletionItemFunction,
    range: any
  ): Promise<any[]> {
    switch (this.cursorContext.type) {
      case 'TABLE_SUGGESTION':
        return this.getTableSuggestions(createCompletionItem, range);

      case 'COLUMN_SUGGESTION':
        return this.getColumnSuggestions(createCompletionItem, range);

      case 'PROCEDURE_SUGGESTION':
        return this.getProcedureSuggestions(createCompletionItem, range);

      case 'KEYWORD_SUGGESTION':
        return this.getKeywordSuggestions(createCompletionItem, range);

      default:
        return this.getBasicSuggestions(createCompletionItem, range);
    }
  }

  /**
   * 获取表建议
   */
  private async getTableSuggestions(
    createCompletionItem: CreateCompletionItemFunction,
    range: any
  ): Promise<any[]> {
    try {
      console.log('🔍 请求表名建议...');
      const tables = await search_table_names(this.sessionId, "");

      console.log(`✅ 获取到 ${tables.length} 个表建议`);

      return tables.map(table => {
        const label = table.schema ? `[${table.schema}].[${table.name}]` : `[${table.name}]`;
        return createCompletionItem(
          table.name,
          COMPLETION_ITEM_KIND.Module,
          label,
          range,
          table.schema || 'Table',
          `Table: ${label}`,
          false,
          'high'
        );
      });
    } catch (error) {
      console.error('❌ 获取表建议失败:', error);
      return [];
    }
  }

  /**
   * 获取列建议
   */
  private async getColumnSuggestions(
    createCompletionItem: CreateCompletionItemFunction,
    range: any
  ): Promise<any[]> {
    const suggestions: any[] = [];

    // 如果是SELECT上下文，添加*选项
    if (this.cursorContext.type === 'COLUMN_SUGGESTION' &&
      (this.cursorContext.reason === 'SELECT' || this.cursorContext.reason === 'DOT')) {
      suggestions.push(
        createCompletionItem(
          '*',
          COMPLETION_ITEM_KIND.Field,
          '*',
          range,
          'Select all columns',
          'Select all columns from the table(s)',
          false,
          'high'
        )
      );
    }

    const targetTables = this.cursorContext.type === 'COLUMN_SUGGESTION'
      ? this.cursorContext.forTables
      : this.tables;

    if (!targetTables || targetTables.length === 0) {
      console.warn('⚠️ 没有找到表来获取列信息');
      return suggestions;
    }

    // 为每个表获取列信息
    for (const table of targetTables) {
      try {
        console.log(`🔍 获取表 ${table.fullName} 的列信息...`);
        const columns = await search_column_details(this.sessionId, table.name, table.schema);

        columns.forEach(col => {
          if (col && col.name) {
            // 对于中文列名，确保它们能被正确处理
            const insertText = col.name.includes(' ') || /[\u4e00-\u9fa5]/.test(col.name)
              ? `[${col.name}]`
              : col.name;

            suggestions.push(
              createCompletionItem(
                col.name,
                COMPLETION_ITEM_KIND.Field,
                insertText,
                range,
                `${table.fullName || table.name}.${col.name}`,
                `Column: ${col.name}\nTable: ${table.fullName || table.name}\nType: ${col.data_type || 'unknown'}`,
                false,
                'high'
              )
            );
          }
        });
      } catch (error) {
        console.error(`❌ 获取表 ${table.name} 的列失败:`, error);
      }
    }

    return suggestions;
  }

  /**
   * 获取存储过程建议
   */
  private async getProcedureSuggestions(
    createCompletionItem: CreateCompletionItemFunction,
    range: any
  ): Promise<any[]> {
    try {
      console.log('🔍 请求存储过程建议...');
      const keyword = this.extractProcedureKeyword();
      const procedures = await getProcedureSuggestions(this.sessionId, keyword);

      console.log(`✅ 获取到 ${procedures.length} 个存储过程建议`);

      return procedures.map((proc: any) => {
        const insertText = proc.execute_template || proc.name;
        let documentation = `存储过程: ${proc.full_name || proc.name}\n`;

        if (proc.parameters && Array.isArray(proc.parameters) && proc.parameters.length > 0) {
          documentation += '\n参数:\n';
          proc.parameters.forEach((param: any) => {
            const outputLabel = param.is_output ? ' (OUTPUT)' : '';
            const defaultLabel = param.has_default ? ' (可选)' : ' (必需)';
            documentation += `  ${param.name}: ${param.data_type}${outputLabel}${defaultLabel}\n`;
          });
        }

        return createCompletionItem(
          proc.name,
          COMPLETION_ITEM_KIND.Function,
          insertText,
          range,
          proc.schema_name || 'Procedure',
          documentation,
          true,
          'high'
        );
      });
    } catch (error) {
      console.error('❌ 获取存储过程建议失败:', error);
      return [];
    }
  }

  /**
   * 提取存储过程关键字
   */
  private extractProcedureKeyword(): string {
    // 从上下文中提取存储过程关键字
    if (this.cursorContext.type === 'PROCEDURE_SUGGESTION' && this.cursorContext.precedingKeyword) {
      // 这里可以进一步解析已输入的部分存储过程名
      return '';
    }
    return '';
  }

  /**
   * 获取关键字建议
   */
  private getKeywordSuggestions(
    createCompletionItem: CreateCompletionItemFunction,
    range: any
  ): any[] {
    const basicKeywords = [
      'SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING',
      'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN',
      'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL',
      'INSERT INTO', 'UPDATE', 'DELETE FROM', 'SET', 'VALUES',
      'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'CREATE INDEX', 'DROP INDEX',
      'EXEC', 'EXECUTE', 'DECLARE', 'BEGIN', 'END', 'IF', 'ELSE', 'WHILE',
      'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT', 'TOP', 'DISTINCT', 'ALL',
      'WITH', 'OVER', 'PARTITION BY', 'AS'
    ];

    // 根据不同的上下文提供更有针对性的关键字
    let keywords = basicKeywords;

    if (this.cursorContext.type === 'KEYWORD_SUGGESTION') {
      switch (this.cursorContext.reason) {
        case 'STATEMENT_START':
          // 语句开始位置的关键字
          keywords = ['SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'CREATE', 'ALTER', 'DROP', 'EXEC', 'EXECUTE', 'DECLARE', 'BEGIN', 'WITH'];
          break;

        case 'AFTER_SELECT':
          // SELECT之后的关键字
          keywords = ['DISTINCT', 'TOP', 'ALL', '*'];
          break;

        case 'AFTER_FROM':
          // FROM之后可能的关键字
          keywords = ['WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN'];
          break;
      }
    }

    return keywords.map(keyword =>
      createCompletionItem(
        keyword,
        COMPLETION_ITEM_KIND.Keyword,
        keyword + ' ',
        range,
        'SQL Keyword',
        `SQL关键字: ${keyword}`,
        false,
        'medium'
      )
    );
  }

  /**
   * 获取基本建议（最后的保护措施）
   */
  private getBasicSuggestions(
    createCompletionItem: CreateCompletionItemFunction,
    range: any
  ): any[] {
    // 当其他所有方法都失败时的最后保护措施
    return this.getKeywordSuggestions(createCompletionItem, range);
  }
}

// --- 7. 主函数 ---

/**
 * 生成动态SQL智能提示 - 重构版本
 * 遵循: 分词 → 词法分析 → 语法分析(可选) → 上下文识别 → 语义分析 → 生成补全候选项
 */
export async function generateDynamicSuggestions(
  sessionId: string,
  fullText: string,
  cursorOffset: number,
  createCompletionItem: CreateCompletionItemFunction,
  range: any
): Promise<any[]> {
  try {
    console.log('🚀 开始生成动态SQL建议 (重构版本)...', { cursorOffset, textLength: fullText.length });

    // 性能保护
    if (fullText.length > 50000) {
      console.warn('⚠️ SQL文本过长，已截断');
      fullText = fullText.substring(0, 50000);
    }

    // 1. 词法分析(轻量级)
    const tokens = performLexicalAnalysis(fullText);

    // 2. 基于词法分析的上下文推断(总是执行)
    const lexicalContext = inferContextFromTokens(tokens, cursorOffset);
    const tablesFromTokens = extractVisibleTables(tokens, cursorOffset);

    console.log('📊 词法分析结果:', {
      context: lexicalContext,
      tablesCount: tablesFromTokens.length,
      tables: tablesFromTokens.map(t => ({ name: t.name, schema: t.schema, alias: t.alias }))
    });

    // 3. 尝试进行语法分析(可能失败)
    let parseResult = null;
    let visitorContext: CursorContext | null = null;
    let visitorTables: ParsedTable[] = [];

    try {
      parseResult = createEnhancedSqlParser(fullText, cursorOffset);
      if (parseResult && parseResult.tree) {
        const visitor = new EnhancedSqlVisitor(
          cursorOffset,
          fullText,
          parseResult.cursorTokenIndex || -1,
          parseResult.tokens
        );

        visitor.visit(parseResult.tree);
        visitorContext = visitor.cursorContext;
        visitorTables = visitor.tables;

        console.log('📊 语法分析结果:', {
          context: visitorContext,
          tablesCount: visitorTables.length,
          tables: visitorTables.map(t => ({ name: t.name, schema: t.schema, alias: t.alias }))
        });
      }
    } catch (error) {
      console.warn("⚠️ 语法分析失败，将使用词法分析结果", error);
    }

    // 4. 使用更可靠的上下文(语法分析或词法分析)
    let finalContext: CursorContext = (visitorContext?.type !== 'UNKNOWN' ? visitorContext : null) || lexicalContext || { type: 'KEYWORD_SUGGESTION', reason: 'GENERAL' };

    // 合并两种方式获取的表
    const mergedTables = [...tablesFromTokens];

    // 如果通过语法分析发现了表，添加到合并表中(去重)
    if (visitorTables && visitorTables.length > 0) {
      const existingTableNames = new Set(mergedTables.map(t => t.fullName));

      for (const table of visitorTables) {
        if (!existingTableNames.has(table.fullName)) {
          mergedTables.push(table);
          existingTableNames.add(table.fullName);
        }
      }
    }

    // 如果上下文是列建议，确保使用合并后的表列表
    if (finalContext.type === 'COLUMN_SUGGESTION') {
      const columnContext = finalContext as { type: 'COLUMN_SUGGESTION'; forTables: ParsedTable[]; reason: 'SELECT' | 'WHERE' | 'DOT' | 'SET' | 'INSERT' | 'GROUP_BY' | 'ORDER_BY'; precedingKeyword?: string };
      finalContext = {
        ...columnContext,
        forTables: columnContext.forTables && columnContext.forTables.length > 0
          ? columnContext.forTables
          : mergedTables
      };
    }

    console.log('📊 最终上下文:', {
      contextType: finalContext.type,
      reason: finalContext.reason,
      tablesCount: finalContext.type === 'COLUMN_SUGGESTION'
        ? (finalContext as any).forTables?.length || 0
        : mergedTables.length
    });

    // 5. 生成建议
    const semanticAnalyzer = new SemanticAnalyzer(
      sessionId,
      mergedTables,
      finalContext
    );

    const suggestions = await semanticAnalyzer.generateSuggestions(createCompletionItem, range);

    console.log('✅ 生成建议完成:', {
      suggestionsCount: suggestions.length,
      contextType: finalContext.type
    });

    return suggestions;

  } catch (error) {
    // 最后的保护措施 - 总是尝试返回基本关键字
    console.error('❌ 生成动态建议时发生严重错误:', error);

    try {
      // 创建基本关键字建议
      return [
        'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'CREATE', 'ALTER', 'DROP', 'EXEC'
      ].map(keyword =>
        createCompletionItem(
          keyword,
          COMPLETION_ITEM_KIND.Keyword,
          keyword + ' ',
          range,
          'SQL Keyword',
          `SQL关键字: ${keyword}`,
          false,
          'medium'
        )
      );
    } catch (e) {
      return [];
    }
  }
}

