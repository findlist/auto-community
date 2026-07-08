import type { MigrationBuilder } from 'node-pg-migrate';

// 家庭绑定新增 unbound 状态：支持已确认的绑定关系解绑
// 设计原因：原 CHECK 约束仅允许 pending/confirmed/rejected 三态，
// 已确认的绑定无法解除；新增 unbound 状态以保留解绑历史记录，避免直接删除导致关系链断裂
export const up = (pgm: MigrationBuilder) => {
  pgm.sql(`ALTER TABLE family_bindings DROP CONSTRAINT IF EXISTS family_bindings_status_check`);
  pgm.sql(
    `ALTER TABLE family_bindings ADD CONSTRAINT family_bindings_status_check ` +
      `CHECK (status IN ('pending', 'confirmed', 'rejected', 'unbound'))`
  );
};

export const down = (pgm: MigrationBuilder) => {
  // 回滚：恢复原三态约束（已存在 unbound 记录时回滚会失败，需先清理数据）
  pgm.sql(`ALTER TABLE family_bindings DROP CONSTRAINT IF EXISTS family_bindings_status_check`);
  pgm.sql(
    `ALTER TABLE family_bindings ADD CONSTRAINT family_bindings_status_check ` +
      `CHECK (status IN ('pending', 'confirmed', 'rejected'))`
  );
};
