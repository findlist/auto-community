import type { MigrationBuilder } from 'node-pg-migrate';

// 系统配置表增强：新增 description 字段并插入业务预设配置项
// 设计原因：原 site_settings 仅存 key/value，缺少配置项含义说明，
// 管理员无法直观理解各配置用途；新增预设项便于开箱即用展示
export const up = (pgm: MigrationBuilder) => {
  pgm.addColumn('site_settings', {
    description: {
      type: 'varchar(255)',
      notNull: false,
      comment: '配置项描述，便于管理员理解用途',
    },
  });

  // 预设业务配置项：仅作为展示与默认值，业务逻辑读取由后续迭代接入
  // ON CONFLICT DO NOTHING 避免重复执行迁移时报主键冲突
  const presets = [
    { key: 'skill_publish_reward', value: '10', desc: '技能发布奖励积分' },
    { key: 'daily_earn_limit', value: '200', desc: '每日积分获取上限' },
    { key: 'order_auto_expire_hours', value: '24', desc: '订单自动过期小时数' },
    { key: 'emergency_response_timeout', value: '30', desc: '紧急响应超时分钟数' },
  ];
  for (const p of presets) {
    pgm.sql(
      `INSERT INTO site_settings (key, value, description) VALUES ('${p.key}', '${p.value}', '${p.desc}') ON CONFLICT (key) DO NOTHING`
    );
  }
};

export const down = (pgm: MigrationBuilder) => {
  // 回滚：先删除本轮新增的预设配置项（保留 homepage_hero_image），再移除 description 字段
  pgm.sql(
    `DELETE FROM site_settings WHERE key IN ('skill_publish_reward', 'daily_earn_limit', 'order_auto_expire_hours', 'emergency_response_timeout')`
  );
  pgm.dropColumn('site_settings', 'description');
};
