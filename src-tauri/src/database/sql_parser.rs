use sqlparser::ast::{Statement};
use sqlparser::dialect::MsSqlDialect;
use sqlparser::parser::Parser;
use anyhow::{Result, anyhow};

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
        let mut results = Vec::new();
        
        // 首先尝试智能分割SQL语句
        let raw_statements = self.smart_split_sql_statements(sql);
        
        if raw_statements.is_empty() {
            return Err(anyhow!("没有找到有效的SQL语句"));
        }
        
        // 对每个分割出的语句进行解析和分类
        for raw_sql in raw_statements {
            let trimmed = raw_sql.trim();
            if trimmed.is_empty() {
                continue;
            }
            
            // 尝试使用sqlparser解析单个语句
            let statement_type = match Parser::parse_sql(&self.dialect, trimmed) {
                Ok(statements) if !statements.is_empty() => {
                    // 如果解析成功，使用精确的分类
                    self.classify_statement(&statements[0])
                }
                Ok(_) => {
                    // 解析成功但没有语句，使用关键字分类
                    self.classify_by_keyword(trimmed)
                }
                Err(_) => {
                    // 解析失败，使用关键字分类
                    self.classify_by_keyword(trimmed)
                }
            };
            
            results.push(ParsedSqlStatement {
                sql: trimmed.to_string(),
                statement_type,
            });
        }

        if results.is_empty() {
            return Err(anyhow!("没有找到有效的SQL语句"));
        }

        Ok(results)
    }

    /// 分类SQL语句类型
    fn classify_statement(&self, statement: &Statement) -> SqlStatementType {
        match statement {
            // 查询语句 - 返回结果集
            Statement::Query(_) => SqlStatementType::Query,
            
            // 非查询语句 - 不返回结果集或只返回影响行数
            Statement::Insert { .. } => SqlStatementType::NonQuery,
            Statement::Update { .. } => SqlStatementType::NonQuery,
            Statement::Delete { .. } => SqlStatementType::NonQuery,
            Statement::CreateTable { .. } => SqlStatementType::NonQuery,
            Statement::CreateView { .. } => SqlStatementType::NonQuery,
            Statement::CreateIndex { .. } => SqlStatementType::NonQuery,
            Statement::CreateSchema { .. } => SqlStatementType::NonQuery,
            Statement::CreateDatabase { .. } => SqlStatementType::NonQuery,
            Statement::CreateFunction { .. } => SqlStatementType::NonQuery,
            Statement::CreateProcedure { .. } => SqlStatementType::NonQuery,
            Statement::CreateSequence { .. } => SqlStatementType::NonQuery,
            Statement::CreateType { .. } => SqlStatementType::NonQuery,
            Statement::CreateRole { .. } => SqlStatementType::NonQuery,
            Statement::AlterTable { .. } => SqlStatementType::NonQuery,
            Statement::AlterIndex { .. } => SqlStatementType::NonQuery,
            Statement::AlterView { .. } => SqlStatementType::NonQuery,
            Statement::AlterRole { .. } => SqlStatementType::NonQuery,
            Statement::Drop { .. } => SqlStatementType::NonQuery,
            Statement::SetVariable { .. } => SqlStatementType::NonQuery,
            Statement::SetTimeZone { .. } => SqlStatementType::NonQuery,
            Statement::SetNames { .. } => SqlStatementType::NonQuery,
            Statement::SetNamesDefault { .. } => SqlStatementType::NonQuery,
            Statement::ShowVariable { .. } => SqlStatementType::Query,
            Statement::ShowVariables { .. } => SqlStatementType::Query,
            Statement::ShowCreate { .. } => SqlStatementType::Query,
            Statement::ShowColumns { .. } => SqlStatementType::Query,
            Statement::ShowTables { .. } => SqlStatementType::Query,
            Statement::ShowCollation { .. } => SqlStatementType::Query,
            Statement::Use { .. } => SqlStatementType::NonQuery,
            Statement::StartTransaction { .. } => SqlStatementType::NonQuery,
            Statement::SetTransaction { .. } => SqlStatementType::NonQuery,
            Statement::Commit { .. } => SqlStatementType::NonQuery,
            Statement::Rollback { .. } => SqlStatementType::NonQuery,
            Statement::Assert { .. } => SqlStatementType::NonQuery,
            Statement::Grant { .. } => SqlStatementType::NonQuery,
            Statement::Revoke { .. } => SqlStatementType::NonQuery,
            Statement::Deallocate { .. } => SqlStatementType::NonQuery,
            Statement::Execute { .. } => {
                // EXECUTE语句可能返回结果集，也可能不返回，默认当作查询处理
                SqlStatementType::Query
            }
            Statement::Prepare { .. } => SqlStatementType::NonQuery,
            Statement::Kill { .. } => SqlStatementType::NonQuery,
            Statement::ExplainTable { .. } => SqlStatementType::Query,
            Statement::Explain { .. } => SqlStatementType::Query,
            Statement::Analyze { .. } => SqlStatementType::NonQuery,
            Statement::Truncate { .. } => SqlStatementType::NonQuery,
            Statement::Msck { .. } => SqlStatementType::NonQuery,
            Statement::Call { .. } => SqlStatementType::Query, // 存储过程调用可能返回结果
            Statement::Copy { .. } => SqlStatementType::NonQuery,
            Statement::CopyIntoSnowflake { .. } => SqlStatementType::NonQuery,
            Statement::Close { .. } => SqlStatementType::NonQuery,
            Statement::Declare { .. } => SqlStatementType::NonQuery,
            Statement::Fetch { .. } => SqlStatementType::Query,
            Statement::Flush { .. } => SqlStatementType::NonQuery,
            Statement::Discard { .. } => SqlStatementType::NonQuery,
            Statement::SetRole { .. } => SqlStatementType::NonQuery,
            Statement::Merge { .. } => SqlStatementType::NonQuery,
            Statement::Cache { .. } => SqlStatementType::NonQuery,
            Statement::UNCache { .. } => SqlStatementType::NonQuery,
            Statement::CreateSecret { .. } => SqlStatementType::NonQuery,
            Statement::CreateStage { .. } => SqlStatementType::NonQuery,
            Statement::DropFunction { .. } => SqlStatementType::NonQuery,
            Statement::DropProcedure { .. } => SqlStatementType::NonQuery,
            Statement::DropSecret { .. } => SqlStatementType::NonQuery,
            Statement::Install { .. } => SqlStatementType::NonQuery,
            Statement::Load { .. } => SqlStatementType::NonQuery,
            
            // 其他未明确分类的语句，默认为未知
            _ => SqlStatementType::Unknown,
        }
    }

    /// 后备解析方法 - 当sqlparser失败时使用
    fn fallback_parse(&self, sql: &str) -> Result<Vec<ParsedSqlStatement>> {
        let mut results = Vec::new();
        
        // 简单的SQL分割 - 按分号分割，但要考虑字符串中的分号
        let statements = self.split_sql_statements(sql);
        
        for statement in statements {
            let trimmed = statement.trim();
            if trimmed.is_empty() {
                continue;
            }
            
            let statement_type = self.classify_by_keyword(trimmed);
            results.push(ParsedSqlStatement {
                sql: trimmed.to_string(),
                statement_type,
            });
        }
        
        Ok(results)
    }

    /// 智能分割SQL语句 - 处理分号分隔和换行分隔的情况
    fn smart_split_sql_statements(&self, sql: &str) -> Vec<String> {
        // 首先尝试按分号分割
        let semicolon_split = self.split_sql_statements(sql);
        
        // 如果分号分割得到多个语句，直接返回
        if semicolon_split.len() > 1 {
            return semicolon_split;
        }
        
        // 如果只有一个语句，检查是否包含多个SQL关键字，可能是换行分隔的
        let single_statement = semicolon_split.get(0).unwrap_or(&sql.to_string()).clone();
        
        // 尝试按换行符和SQL关键字分割
        self.split_by_sql_keywords(&single_statement)
    }
    
    /// 按SQL关键字分割语句（处理换行分隔的情况）
    fn split_by_sql_keywords(&self, sql: &str) -> Vec<String> {
        let mut statements = Vec::new();
        let mut current_statement = String::new();
        let mut in_string = false;
        let mut string_delimiter = '\0';
        
        // SQL关键字列表（用于识别新语句的开始）
        let sql_keywords = [
            "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP",
            "TRUNCATE", "WITH", "EXEC", "EXECUTE", "CALL", "SHOW", "DESCRIBE",
            "EXPLAIN", "USE", "SET", "DECLARE", "BEGIN", "COMMIT", "ROLLBACK",
            "GRANT", "REVOKE", "MERGE"
        ];
        
        let lines: Vec<&str> = sql.lines().collect();
        
        for (line_index, line) in lines.iter().enumerate() {
            let trimmed_line = line.trim();
            
            // 跳过空行和注释行
            if trimmed_line.is_empty() || trimmed_line.starts_with("--") {
                if !current_statement.is_empty() {
                    current_statement.push('\n');
                }
                continue;
            }
            
            // 检查字符串状态
            let mut line_chars = trimmed_line.chars().peekable();
            let mut temp_in_string = in_string;
            let mut temp_delimiter = string_delimiter;
            
            while let Some(ch) = line_chars.next() {
                match ch {
                    '\'' | '"' => {
                        if !temp_in_string {
                            temp_in_string = true;
                            temp_delimiter = ch;
                        } else if ch == temp_delimiter {
                            if line_chars.peek() == Some(&ch) {
                                line_chars.next(); // 跳过转义的引号
                            } else {
                                temp_in_string = false;
                            }
                        }
                    }
                    _ => {}
                }
            }
            
            // 如果不在字符串中，检查是否是新的SQL语句开始
            if !in_string {
                let line_upper = trimmed_line.to_uppercase();
                let is_new_statement = sql_keywords.iter().any(|&keyword| {
                    line_upper.starts_with(keyword) && 
                    (line_upper.len() == keyword.len() || 
                     line_upper.chars().nth(keyword.len()).map_or(false, |c| c.is_whitespace()))
                });
                
                if is_new_statement && !current_statement.trim().is_empty() {
                    // 找到新语句的开始，保存当前语句
                    statements.push(current_statement.trim().to_string());
                    current_statement.clear();
                }
            }
            
            // 添加当前行到当前语句
            if !current_statement.is_empty() {
                current_statement.push('\n');
            }
            current_statement.push_str(line);
            
            // 更新字符串状态
            in_string = temp_in_string;
            string_delimiter = temp_delimiter;
        }
        
        // 添加最后一个语句
        if !current_statement.trim().is_empty() {
            statements.push(current_statement.trim().to_string());
        }
        
        // 如果没有分割出多个语句，返回原始语句
        if statements.is_empty() {
            statements.push(sql.trim().to_string());
        }
        
        statements
    }

    /// 简单的SQL语句分割
    fn split_sql_statements(&self, sql: &str) -> Vec<String> {
        let mut statements = Vec::new();
        let mut current_statement = String::new();
        let mut in_string = false;
        let mut string_delimiter = '\0';
        let mut chars = sql.chars().peekable();
        
        while let Some(ch) = chars.next() {
            match ch {
                '\'' | '"' => {
                    if !in_string {
                        in_string = true;
                        string_delimiter = ch;
                    } else if ch == string_delimiter {
                        // 检查是否是转义的引号
                        if chars.peek() == Some(&ch) {
                            current_statement.push(ch);
                            chars.next(); // 跳过下一个引号
                        } else {
                            in_string = false;
                        }
                    }
                    current_statement.push(ch);
                }
                ';' => {
                    if !in_string {
                        let trimmed = current_statement.trim();
                        if !trimmed.is_empty() {
                            statements.push(trimmed.to_string());
                        }
                        current_statement.clear();
                    } else {
                        current_statement.push(ch);
                    }
                }
                _ => {
                    current_statement.push(ch);
                }
            }
        }
        
        // 添加最后一个语句（如果没有以分号结尾）
        let trimmed = current_statement.trim();
        if !trimmed.is_empty() {
            statements.push(trimmed.to_string());
        }
        
        statements
    }

    /// 基于关键字的简单分类
    fn classify_by_keyword(&self, sql: &str) -> SqlStatementType {
        let sql_upper = sql.trim().to_uppercase();
        
        // 查询语句关键字
        if sql_upper.starts_with("SELECT") ||
           sql_upper.starts_with("WITH") ||
           sql_upper.starts_with("SHOW") ||
           sql_upper.starts_with("DESCRIBE") ||
           sql_upper.starts_with("DESC") ||
           sql_upper.starts_with("EXPLAIN") ||
           sql_upper.starts_with("FETCH") {
            return SqlStatementType::Query;
        }
        
        // 非查询语句关键字
        if sql_upper.starts_with("INSERT") ||
           sql_upper.starts_with("UPDATE") ||
           sql_upper.starts_with("DELETE") ||
           sql_upper.starts_with("CREATE") ||
           sql_upper.starts_with("ALTER") ||
           sql_upper.starts_with("DROP") ||
           sql_upper.starts_with("TRUNCATE") ||
           sql_upper.starts_with("SET") ||
           sql_upper.starts_with("USE") ||
           sql_upper.starts_with("GRANT") ||
           sql_upper.starts_with("REVOKE") ||
           sql_upper.starts_with("COMMIT") ||
           sql_upper.starts_with("ROLLBACK") ||
           sql_upper.starts_with("BEGIN") ||
           sql_upper.starts_with("START") ||
           sql_upper.starts_with("DECLARE") ||
           sql_upper.starts_with("MERGE") {
            return SqlStatementType::NonQuery;
        }
        
        // EXECUTE和CALL可能返回结果集
        if sql_upper.starts_with("EXECUTE") ||
           sql_upper.starts_with("EXEC") ||
           sql_upper.starts_with("CALL") {
            return SqlStatementType::Query;
        }
        
        SqlStatementType::Unknown
    }
}

impl Default for SqlParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_select() {
        let parser = SqlParser::new();
        let sql = "SELECT * FROM users";
        let result = parser.parse_sql(sql).unwrap();
        
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
    }

    #[test]
    fn test_parse_multiple_statements() {
        let parser = SqlParser::new();
        let sql = "SELECT * FROM users; INSERT INTO logs VALUES (1, 'test'); UPDATE users SET name = 'John' WHERE id = 1;";
        let result = parser.parse_sql(sql).unwrap();
        
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery);
        assert_eq!(result[2].statement_type, SqlStatementType::NonQuery);
    }

    #[test]
    fn test_parse_with_strings() {
        let parser = SqlParser::new();
        let sql = "INSERT INTO test VALUES ('hello; world'); SELECT * FROM test;";
        let result = parser.parse_sql(sql).unwrap();
        
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::NonQuery);
        assert_eq!(result[1].statement_type, SqlStatementType::Query);
    }

    #[test]
    fn test_parse_newline_separated() {
        let parser = SqlParser::new();
        let sql = "SELECT TOP 100 * FROM info_货主\nSELECT TOP 100 * FROM enum_剂型";
        let result = parser.parse_sql(sql).unwrap();
        
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::Query);
        assert!(result[0].sql.contains("info_货主"));
        assert!(result[1].sql.contains("enum_剂型"));
    }

    #[test]
    fn test_parse_mixed_statements_newline() {
        let parser = SqlParser::new();
        let sql = r#"SELECT * FROM users
INSERT INTO logs VALUES (1, 'test')
UPDATE users SET name = 'John' WHERE id = 1"#;
        let result = parser.parse_sql(sql).unwrap();
        
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery);
        assert_eq!(result[2].statement_type, SqlStatementType::NonQuery);
    }

    #[test]
    fn test_parse_with_comments() {
        let parser = SqlParser::new();
        let sql = r#"-- 查询用户
SELECT * FROM users
-- 插入日志
INSERT INTO logs VALUES (1, 'test')"#;
        let result = parser.parse_sql(sql).unwrap();
        
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery);
    }

    #[test]
    fn test_parse_multiline_statement() {
        let parser = SqlParser::new();
        let sql = r#"SELECT 
    u.id,
    u.name,
    u.email
FROM users u
WHERE u.active = 1
INSERT INTO audit_log (action, table_name) VALUES ('SELECT', 'users')"#;
        let result = parser.parse_sql(sql).unwrap();
        
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].statement_type, SqlStatementType::Query);
        assert_eq!(result[1].statement_type, SqlStatementType::NonQuery);
    }
} 