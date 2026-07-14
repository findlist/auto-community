import type { MigrationBuilder } from 'node-pg-migrate';

// 站点配置表增加 value_type 字段：实现配置项类型元数据驱动
// 设计原因：原前端用 FLOAT_CONFIG_PATTERN 正则按 key 关键词识别浮点类配置，
// 新增浮点配置需手动更新前端正则，违反开闭原则。
// 改为后端元数据驱动后，管理员在后台选择配置类型即可，前端根据 value_type 判断滑块步长，
// 新增配置类型无需改代码，符合开闭原则。
//
// 注意：原文件名 1704067200018_site_settings_value_type.ts 与 1704067200018_family_binding_unbind.ts
// 版本号冲突，导致 node-pg-migrate 只能执行其中一个。改为 1704067200031 解决冲突。
export const up = (pgm: MigrationBuilder) => {
  pgm.addColumn('site_settings', {
    value_type: {
      type: 'varchar(16)',
      notNull: true,
      default: 'string',
      comment: '配置值类型：string（字符串）| int（整数）| float（浮点），驱动前端滑块步长',
    },
  });

  // 回填 0017 迁移插入的预设配置项类型：4 个均为整数类配置
  // 设计原因：0017 插入时无 value_type 字段，新增字段后默认 'string'，需修正为 'int'
  // homepage_hero_image 是 URL 字符串，保持默认 'string' 无需回填
  pgm.sql(
    `UPDATE site_settings SET value_type = 'int' WHERE key IN ('skill_publish_reward', 'daily_earn_limit', 'order_auto_expire_hours', 'emergency_response_timeout')`
  );
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropColumn('site_settings', 'value_type');
};
