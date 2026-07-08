import type { MigrationBuilder } from 'node-pg-migrate';

// 说明：这是一个无操作（no-op）迁移，用于解决编号冲突问题。
// 实名认证表的实际迁移已在 1704067200012_verification.ts 中完成。
// 因编号冲突无法删除原文件，故此迁移仅作为占位符存在，不执行任何 SQL。
export const up = (pgm: MigrationBuilder) => {
  pgm.noop();
};

export const down = (pgm: MigrationBuilder) => {
  pgm.noop();
};
