-- 时间银行服务新增 images 字段：支持服务配图上传
-- 设计原因：原 time_services 表无图片字段，C端发布服务时无法附带配图；
-- 与 kitchen_posts.images 保持一致使用 TEXT[] 数组类型，便于复用 ImageUpload 组件与图片校验逻辑
ALTER TABLE time_services ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';
