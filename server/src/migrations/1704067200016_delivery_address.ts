import type { MigrationBuilder } from 'node-pg-migrate';

// 配送地址簿表迁移：用户管理自己的配送地址，下单时快捷选择
export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('delivery_addresses', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
      comment: '地址所属用户',
    },
    recipient: {
      type: 'varchar(32)',
      notNull: true,
      comment: '收件人姓名',
    },
    phone: {
      type: 'varchar(20)',
      notNull: true,
      comment: '收件人电话',
    },
    address: {
      type: 'text',
      notNull: true,
      comment: '详细地址',
    },
    is_default: {
      type: 'boolean',
      notNull: true,
      default: false,
      comment: '是否为默认地址',
    },
    created_at: {
      type: 'timestamp',
      default: pgm.func('NOW()'),
      notNull: true,
    },
    updated_at: {
      type: 'timestamp',
      default: pgm.func('NOW()'),
      notNull: true,
    },
  });

  // 按用户查询地址索引
  pgm.createIndex('delivery_addresses', 'user_id');
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('delivery_addresses');
};
