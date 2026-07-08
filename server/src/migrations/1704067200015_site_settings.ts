import type { MigrationBuilder } from 'node-pg-migrate';

// 站点配置表迁移 - 用于管理员配置首页展示图片等全站级设置
export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('site_settings', {
    key: {
      type: 'varchar(64)',
      primaryKey: true,
      comment: '配置键名，如 homepage_hero_image',
    },
    value: {
      type: 'text',
      notNull: false,
      comment: '配置值，如图片 URL',
    },
    updated_by: {
      type: 'uuid',
      notNull: false,
      comment: '最后更新该配置的管理员 ID',
    },
    updated_at: {
      type: 'timestamp',
      default: pgm.func('NOW()'),
      notNull: true,
    },
  });

  // 插入首页 Hero 图默认配置，便于开箱即用
  pgm.sql(`INSERT INTO site_settings (key, value) VALUES ('homepage_hero_image', NULL)`);
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('site_settings');
};
