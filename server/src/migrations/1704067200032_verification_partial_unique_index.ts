import type { MigrationBuilder } from 'node-pg-migrate';

// 实名认证唯一索引改为部分唯一索引：仅约束 pending/approved 状态
// 设计原因：原 idx_verification_requests_id_card_hash 为全量唯一索引，但业务逻辑允许
// rejected 用户用同一身份证重新提交（admin.service.reviewVerificationRequest 拒绝时
// 仅 UPDATE status='rejected' 不删除记录）。原全量唯一索引导致被拒用户重提交时
// INSERT 触发唯一约束冲突，抛出 QueryFailedError 最终返回 500，而非友好的 409。
// 改为部分唯一索引后，仅 pending/approved 状态的记录参与唯一约束，
// rejected 记录不占用唯一槽位，被拒用户可重新提交。
// 兜底：user.service.submitVerification 事务内捕获 PostgreSQL 23505 错误码转 ConflictError，
// 防止并发提交（SELECT 检查通过但 INSERT 同时执行）的 TOCTOU 边界情况。
export const up = (pgm: MigrationBuilder) => {
  // 先 DROP 旧的全量唯一索引（IF EXISTS 保证幂等，未应用过该索引的环境不会报错）
  pgm.sql('DROP INDEX IF EXISTS idx_verification_requests_id_card_hash');
  // 重建为部分唯一索引：仅 pending/approved 状态参与唯一约束
  // 设计原因：rejected 记录需要保留（用于历史追溯 + 防止恶意反复提交占位），
  // 但不应阻止用户在拒绝后用同一身份证重新提交认证
  pgm.sql(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_requests_id_card_hash
       ON verification_requests (id_card_hash)
       WHERE status IN ('pending', 'approved')`
  );
};

export const down = (pgm: MigrationBuilder) => {
  // 回滚：恢复为全量唯一索引（注意：若已有 rejected 用户重新提交产生多条记录，回滚会失败）
  pgm.sql('DROP INDEX IF EXISTS idx_verification_requests_id_card_hash');
  pgm.sql(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_requests_id_card_hash ON verification_requests (id_card_hash)'
  );
};
