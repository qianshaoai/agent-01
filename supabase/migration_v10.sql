-- Migration v10: contact QR code configuration
-- system_settings 表已存在（key-value 结构），无需 DDL 变更
-- 本次新增两个配置 key：
--   contact_qr_url  : 联系我们二维码图片 URL（存储在 uploads/contact-qr.{ext}）
--   contact_qr_text : 二维码下方说明文案（可选）
-- 初始值由后台上传接口写入，默认为空（前台显示占位图标）

-- 若需预置默认文案，可执行：
-- INSERT INTO system_settings (key, value) VALUES ('contact_qr_text', '扫码添加微信，获取专属服务')
-- ON CONFLICT (key) DO NOTHING;
