use anyhow::{anyhow, Result};
use regex::Regex;
use sqlparser::ast::Statement;
use sqlparser::dialect::MsSqlDialect;
use sqlparser::parser::Parser;

#[derive(Debug, Clone, PartialEq)]
pub enum SqlStatementType {
    Query,    // SELECT, WITH, VALUES等返回结果集的语句
    NonQuery, // INSERT, UPDATE, DELETE, CREATE, DROP等不返回结果集的语句
    Unknown,  // 无法确定类型的语句
}

#[derive(Debug, Clone)]
pub struct ParsedSqlStatement {
    pub sql: String,
    pub statement_type: SqlStatementType,
}

pub struct SqlParser {
    dialect: MsSqlDialect,
}

impl SqlParser {
    pub fn new() -> Self {
        Self {
            dialect: MsSqlDialect {},
        }
    }

    /// 解析SQL字符串，返回分割后的语句列表
    pub fn parse_sql(&self, sql: &str) -> Result<Vec<ParsedSqlStatement>> {
        // 首先分割SQL语句
        let statements = self.split_sql_statements(sql)?;

        // 对每个语句进行分类
        let mut parsed_statements = Vec::new();

        for stmt in statements {
            let trimmed = stmt.trim();
            if trimmed.is_empty() {
                continue;
            }

            let statement_type = self.classify_statement(trimmed);
            parsed_statements.push(ParsedSqlStatement {
                sql: trimmed.to_string(),
                statement_type,
            });
        }

        Ok(parsed_statements)
    }

    /// 智能分割SQL语句 - 改进版
    fn split_sql_statements(&self, sql: &str) -> Result<Vec<String>> {
        let mut statements = Vec::new();

        // 第一步：按照明确的分隔符分割（分号和GO）
        let pre_split = self.split_by_delimiters(sql);

        // 第二步：对每个片段进行智能分割
        for fragment in pre_split {
            let sub_statements = self.smart_split_fragment(&fragment);
            statements.extend(sub_statements);
        }

        Ok(statements)
    }

    /// 按照分号和GO分割
    fn split_by_delimiters(&self, sql: &str) -> Vec<String> {
        let mut fragments = Vec::new();
        let mut current_fragment = String::new();
        let mut in_string = false;
        let mut string_delimiter = ' ';
        let mut in_single_comment = false;
        let mut in_multi_comment = false;

        let chars: Vec<char> = sql.chars().collect();
        let mut i = 0;

        while i < chars.len() {
            let ch = chars[i];

            // 处理多行注释
            if !in_string && !in_single_comment && i + 1 < chars.len() {
                if ch == '/' && chars[i + 1] == '*' {
                    in_multi_comment = true;
                    current_fragment.push(ch);
                    current_fragment.push(chars[i + 1]);
                    i += 2;
                    continue;
                } else if ch == '*' && chars[i + 1] == '/' && in_multi_comment {
                    in_multi_comment = false;
                    current_fragment.push(ch);
                    current_fragment.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
            }

            // 处理单行注释
            if !in_string
                && !in_multi_comment
                && ch == '-'
                && i + 1 < chars.len()
                && chars[i + 1] == '-'
            {
                in_single_comment = true;
            }

            // 处理换行符
            if ch == '\n' {
                in_single_comment = false;
            }

            // 处理字符串
            if !in_single_comment && !in_multi_comment {
                if ch == '\'' || ch == '"' || ch == '[' {
                    if !in_string {
                        in_string = true;
                        string_delimiter = if ch == '[' { ']' } else { ch };
                    } else if (ch == string_delimiter) || (ch == ']' && string_delimiter == ']') {
                        // 检查是否是转义的引号
                        if ch != ']' && i + 1 < chars.len() && chars[i + 1] == ch {
                            current_fragment.push(ch);
                            current_fragment.push(chars[i + 1]);
                            i += 2;
                            continue;
                        } else {
                            in_string = false;
                        }
                    }
                }
            }

            current_fragment.push(ch);

            // 检查分隔符
            if !in_string && !in_single_comment && !in_multi_comment {
                // 检查分号
                if ch == ';' {
                    let trimmed = current_fragment.trim().to_string();
                    if !trimmed.is_empty() {
                        fragments.push(trimmed);
                    }
                    current_fragment.clear();
                    i += 1;
                    continue;
                }

                // 检查GO命令
                if self.is_go_command(&current_fragment) {
                    let without_go = self.remove_go_command(&current_fragment);
                    if !without_go.trim().is_empty() {
                        fragments.push(without_go);
                    }
                    current_fragment.clear();
                }
            }

            i += 1;
        }

        // 处理最后的片段
        let trimmed = current_fragment.trim().to_string();
        if !trimmed.is_empty() {
            fragments.push(trimmed);
        }

        fragments
    }

    /// 智能分割没有明确分隔符的SQL片段
    fn smart_split_fragment(&self, fragment: &str) -> Vec<String> {
        let mut statements = Vec::new();

        // 关键字列表，按优先级排序
        let statement_keywords = [
            "WITH",
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
            "MERGE",
            "CREATE",
            "ALTER",
            "DROP",
            "TRUNCATE",
            "DECLARE",
            "SET",
            "EXEC",
            "EXECUTE",
            "BEGIN",
            "IF",
            "WHILE",
            "GRANT",
            "REVOKE",
            "BACKUP",
            "RESTORE",
            "USE",
            "PRINT",
            "RAISERROR",
            "THROW",
        ];

        // 查找所有可能的语句开始位置
        let mut positions = Vec::new();
        let fragment_upper = fragment.to_uppercase();

        for keyword in &statement_keywords {
            let mut search_from = 0;
            while let Some(pos) = fragment_upper[search_from..].find(keyword) {
                let absolute_pos = search_from + pos;

                // 检查是否是独立的关键字
                if self.is_keyword_at_position(&fragment_upper, keyword, absolute_pos) {
                    // 检查是否在字符串或注释中
                    if !self.is_in_string_or_comment(fragment, absolute_pos) {
                        positions.push((absolute_pos, keyword.to_string()));
                    }
                }

                search_from = absolute_pos + keyword.len();
            }
        }

        // 按位置排序
        positions.sort_by_key(|&(pos, _)| pos);

        // 根据位置分割语句
        if positions.is_empty() {
            // 没有找到关键字，整个片段作为一个语句
            let trimmed = fragment.trim();
            if !trimmed.is_empty() {
                statements.push(trimmed.to_string());
            }
        } else {
            for i in 0..positions.len() {
                let start = positions[i].0;
                let end = if i + 1 < positions.len() {
                    positions[i + 1].0
                } else {
                    fragment.len()
                };

                let stmt = fragment[start..end].trim();
                if !stmt.is_empty() {
                    statements.push(stmt.to_string());
                }
            }
        }

        statements
    }

    /// 检查指定位置是否是独立的关键字
    fn is_keyword_at_position(&self, text: &str, keyword: &str, pos: usize) -> bool {
        // 检查前面是否是单词边界
        if pos > 0 {
            let prev_char = text.chars().nth(pos - 1).unwrap();
            if prev_char.is_alphanumeric() || prev_char == '_' {
                return false;
            }
        }

        // 检查后面是否是单词边界
        let end_pos = pos + keyword.len();
        if end_pos < text.len() {
            let next_char = text.chars().nth(end_pos).unwrap();
            if next_char.is_alphanumeric() || next_char == '_' {
                return false;
            }
        }

        true
    }

    /// 检查位置是否在字符串或注释中
    fn is_in_string_or_comment(&self, text: &str, position: usize) -> bool {
        let mut in_string = false;
        let mut string_delimiter = ' ';
        let mut in_single_comment = false;
        let mut in_multi_comment = false;

        let chars: Vec<char> = text.chars().collect();

        for i in 0..position.min(chars.len()) {
            let ch = chars[i];

            // 处理多行注释
            if !in_string && !in_single_comment && i + 1 < chars.len() {
                if ch == '/' && chars[i + 1] == '*' {
                    in_multi_comment = true;
                } else if ch == '*' && chars[i + 1] == '/' && in_multi_comment {
                    in_multi_comment = false;
                }
            }

            // 处理单行注释
            if !in_string && !in_multi_comment && i + 1 < chars.len() {
                if ch == '-' && chars[i + 1] == '-' {
                    in_single_comment = true;
                }
            }

            // 处理换行符
            if ch == '\n' {
                in_single_comment = false;
            }

            // 处理字符串
            if !in_single_comment && !in_multi_comment {
                if ch == '\'' || ch == '"' || ch == '[' {
                    if !in_string {
                        in_string = true;
                        string_delimiter = if ch == '[' { ']' } else { ch };
                    } else if (ch == string_delimiter) || (ch == ']' && string_delimiter == ']') {
                        // 检查是否是转义的引号
                        if ch != ']' && i + 1 < chars.len() && chars[i + 1] == ch {
                            continue;
                        } else {
                            in_string = false;
                        }
                    }
                }
            }
        }

        in_string || in_single_comment || in_multi_comment
    }

    /// 检查是否是GO命令
    fn is_go_command(&self, text: &str) -> bool {
        let trimmed = text.trim();
        let upper = trimmed.to_uppercase();

        // 检查是否以GO结尾
        if let Some(last_line) = upper.lines().last() {
            let last_word = last_line.trim();
            if last_word == "GO" {
                return true;
            }
        }

        // 使用正则表达式检查
        let go_regex = Regex::new(r"(?i)\bGO\s*$").unwrap();
        go_regex.is_match(trimmed)
    }

    /// 移除GO命令
    fn remove_go_command(&self, text: &str) -> String {
        let go_regex = Regex::new(r"(?i)\bGO\s*$").unwrap();
        go_regex.replace(text, "").to_string()
    }

    /// 分类SQL语句
    fn classify_statement(&self, sql: &str) -> SqlStatementType {
        // 首先尝试使用sqlparser解析
        if let Ok(parsed_type) = self.classify_with_parser(sql) {
            return parsed_type;
        }

        // 如果解析失败，使用正则表达式方法
        self.classify_with_regex(sql)
    }

    /// 使用sqlparser分类
    fn classify_with_parser(&self, sql: &str) -> Result<SqlStatementType> {
        match Parser::parse_sql(&self.dialect, sql) {
            Ok(statements) => {
                if statements.is_empty() {
                    return Err(anyhow!("No statements parsed"));
                }

                // 分析第一个语句
                let stmt_type = match &statements[0] {
                    Statement::Query(_) => SqlStatementType::Query,
                    Statement::Insert { .. }
                    | Statement::Update { .. }
                    | Statement::Delete { .. }
                    | Statement::CreateTable { .. }
                    | Statement::CreateView { .. }
                    | Statement::CreateIndex { .. }
                    | Statement::CreateFunction { .. }
                    | Statement::CreateProcedure { .. }
                    | Statement::AlterTable { .. }
                    | Statement::AlterIndex { .. }
                    | Statement::Drop { .. }
                    | Statement::Truncate { .. }
                    | Statement::SetVariable { .. }
                    | Statement::Declare { .. }
                    | Statement::Execute { .. }
                    | Statement::Merge { .. } => SqlStatementType::NonQuery,
                    _ => SqlStatementType::Unknown,
                };

                Ok(stmt_type)
            }
            Err(_) => Err(anyhow!("Failed to parse with sqlparser")),
        }
    }

    /// 使用正则表达式分类
    fn classify_with_regex(&self, sql: &str) -> SqlStatementType {
        let sql_upper = sql.trim().to_uppercase();

        // 移除注释后的SQL
        let clean_sql = self.remove_comments(&sql_upper);

        // 查询语句模式
        let query_patterns = vec![
            r"^\s*SELECT\s+",
            r"^\s*WITH\s+.*\s+SELECT\s+",
            r"^\s*\(\s*SELECT\s+",
            r"^\s*VALUES\s*\(",
            r"^\s*TABLE\s+",
            r"^\s*EXEC(?:UTE)?\s+\w+.*OUTPUT",
        ];

        for pattern in query_patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(&clean_sql) {
                    return SqlStatementType::Query;
                }
            }
        }

        // 非查询语句模式
        let non_query_patterns = vec![
            r"^\s*INSERT\s+",
            r"^\s*UPDATE\s+",
            r"^\s*DELETE\s+",
            r"^\s*MERGE\s+",
            r"^\s*CREATE\s+",
            r"^\s*ALTER\s+",
            r"^\s*DROP\s+",
            r"^\s*TRUNCATE\s+",
            r"^\s*DECLARE\s+",
            r"^\s*SET\s+",
            r"^\s*BEGIN\s+",
            r"^\s*COMMIT\s*",
            r"^\s*ROLLBACK\s*",
            r"^\s*EXEC(?:UTE)?\s+(?!.*OUTPUT)",
            r"^\s*GRANT\s+",
            r"^\s*REVOKE\s+",
            r"^\s*DENY\s+",
            r"^\s*BACKUP\s+",
            r"^\s*RESTORE\s+",
            r"^\s*USE\s+",
            r"^\s*IF\s+",
            r"^\s*WHILE\s+",
            r"^\s*PRINT\s+",
            r"^\s*RAISERROR\s*",
            r"^\s*THROW\s*",
        ];

        for pattern in non_query_patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(&clean_sql) {
                    return SqlStatementType::NonQuery;
                }
            }
        }

        SqlStatementType::Unknown
    }

    /// 移除SQL中的注释
    fn remove_comments(&self, sql: &str) -> String {
        // 移除单行注释
        let single_comment_re = Regex::new(r"--[^\n]*").unwrap();
        let without_single = single_comment_re.replace_all(sql, "");

        // 移除多行注释
        let multi_comment_re = Regex::new(r"/\*[\s\S]*?\*/").unwrap();
        let without_multi = multi_comment_re.replace_all(&without_single, "");

        without_multi.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_newline_separated_statements() {
        let parser = SqlParser::new();

        let sql =
            "SELECT TOP 100 * FROM info_货主\r\nupdate info_货品 set 规格='1' where _id in (1,2)";

        let result = parser.parse_sql(sql).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[0].sql, "SELECT TOP 100 * FROM info_货主");
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery);
        assert_eq!(
            result[1].sql,
            "update info_货品 set 规格='1' where _id in (1,2)"
        );
    }

    #[test]
    fn test_parse_multiple_statements() {
        let parser = SqlParser::new();

        let sql = r#"
            -- 创建表
            CREATE TABLE Users (
                ID INT PRIMARY KEY,
                Name NVARCHAR(100)
            )
            GO
            
            -- 插入数据
            INSERT INTO Users (ID, Name) VALUES (1, 'John');
            INSERT INTO Users (ID, Name) VALUES (2, 'Jane')
            
            -- 查询数据
            SELECT * FROM Users WHERE ID > 0
            GO
            
            -- CTE查询
            WITH UserCTE AS (
                SELECT ID, Name FROM Users
            )
            SELECT * FROM UserCTE;
            
            -- 更新数据
            UPDATE Users SET Name = 'John Doe' WHERE ID = 1
        "#;

        let result = parser.parse_sql(sql).unwrap();

        assert_eq!(result.len(), 6);
        assert_eq!(result[0].statement_type, SqlStatementType::NonQuery); // CREATE TABLE
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery); // INSERT
        assert_eq!(result[2].statement_type, SqlStatementType::NonQuery); // INSERT
        assert_eq!(result[3].statement_type, SqlStatementType::Query); // SELECT
        assert_eq!(result[4].statement_type, SqlStatementType::Query); // WITH...SELECT
        assert_eq!(result[5].statement_type, SqlStatementType::NonQuery); // UPDATE
    }

    #[test]
    fn test_complex_strings() {
        let parser = SqlParser::new();

        let sql = r#"
            INSERT INTO Messages (Text) VALUES ('Hello; GO; SELECT * FROM Users');
            SELECT * FROM Messages WHERE Text LIKE '%GO%'
        "#;

        let result = parser.parse_sql(sql).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::NonQuery);
        assert_eq!(result[1].statement_type, SqlStatementType::Query);
    }

    #[test]
    fn test_no_delimiter_statements() {
        let parser = SqlParser::new();

        // 测试没有分号的多条语句
        let sql = r#"
            SELECT * FROM table1
            UPDATE table2 SET col = 'value'
            DELETE FROM table3 WHERE id = 1
            INSERT INTO table4 VALUES (1, 2, 3)
        "#;

        let result = parser.parse_sql(sql).unwrap();

        assert_eq!(result.len(), 4);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery);
        assert_eq!(result[2].statement_type, SqlStatementType::NonQuery);
        assert_eq!(result[3].statement_type, SqlStatementType::NonQuery);
    }

    #[test]
    fn test_subquery_handling() {
        let parser = SqlParser::new();

        let sql = r#"
            SELECT * FROM (
                SELECT id FROM users WHERE active = 1
            ) AS active_users
            UPDATE settings SET value = (SELECT COUNT(*) FROM users)
        "#;

        let result = parser.parse_sql(sql).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery);
    }

    #[test]
    fn test_string_with_keywords() {
        let parser = SqlParser::new();

        let sql = r#"
            INSERT INTO logs (message) VALUES ('User tried to SELECT data')
            SELECT 'UPDATE command executed' AS message
        "#;

        let result = parser.parse_sql(sql).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::NonQuery);
        assert_eq!(result[1].statement_type, SqlStatementType::Query);
    }

    #[test]
    fn test_chinese_identifiers() {
        let parser = SqlParser::new();

        let sql = r#"
            SELECT * FROM 用户表
            UPDATE 产品表 SET 价格 = 100 WHERE 产品ID = 1
            INSERT INTO 订单表 (订单号, 金额) VALUES ('ORD001', 1000)
        "#;

        let result = parser.parse_sql(sql).unwrap();

        assert_eq!(result.len(), 3);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery);
        assert_eq!(result[2].statement_type, SqlStatementType::NonQuery);
    }

    #[test]
    fn test_cte_statements() {
        let parser = SqlParser::new();

        let sql = r#"
            WITH cte1 AS (SELECT * FROM table1),
                 cte2 AS (SELECT * FROM table2)
            SELECT * FROM cte1 JOIN cte2 ON cte1.id = cte2.id
            
            WITH RECURSIVE tree AS (
                SELECT id, parent_id, name FROM categories WHERE parent_id IS NULL
                UNION ALL
                SELECT c.id, c.parent_id, c.name FROM categories c
                JOIN tree t ON c.parent_id = t.id
            )
            SELECT * FROM tree
        "#;

        let result = parser.parse_sql(sql).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::Query);
    }
}
