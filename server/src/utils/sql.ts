/**
 * SQL 查询辅助工具
 *
 * 设计原因：JOIN 场景下 SELECT t.* 会返回表的所有列（含未消费的大字段与敏感字段），
 * 需要替换为精确列名并添加表别名前缀。此函数将已定义的列常量转换为带前缀的版本，
 * 避免手动维护两份列名定义，降低列名分裂风险。
 */

/**
 * 为逗号分隔的列名添加表别名前缀，供 JOIN 查询使用。
 *
 * @param columns 逗号分隔的列名字符串（支持多行模板字符串），如 'id, user_id, title'
 * @param alias 表别名，如 'go'
 * @returns 带前缀的列名字符串，如 'go.id, go.user_id, go.title'
 */
export function prefixColumns(columns: string, alias: string): string {
  return columns
    .split(',')
    .map((col) => col.trim())
    .filter((col) => col.length > 0)
    .map((col) => `${alias}.${col}`)
    .join(', ');
}
