import { describe, it, expect, vi } from 'vitest';

// 设计原因：swagger.ts 在模块加载时立即调用 swaggerJsdoc(options) 生成文档对象，
// 通过 vi.hoisted 提前创建捕获引用，在 vi.mock 工厂内捕获 options 参数便于测试断言；
// 用对象包装 capturedOptions 避免 const 赋值报错（esbuild 将 vi.hoisted 内声明强制 const 化）
const { mockSwaggerJsdoc, captured } = vi.hoisted(() => ({
  captured: { options: null as unknown },
  mockSwaggerJsdoc: vi.fn((opts: unknown) => {
    captured.options = opts;
    return { openapi: '3.0.0', paths: {} };
  }),
}));

vi.mock('swagger-jsdoc', () => ({
  default: mockSwaggerJsdoc,
  __esModule: true,
}));

// 导入被测模块：触发 swaggerJsdoc 调用，捕获 options
import { swaggerSpec } from '../swagger';

describe('swagger 配置模块', () => {
  describe('swaggerSpec 导出', () => {
    it('应通过 swaggerJsdoc 生成并导出文档对象', () => {
      // 设计原因：swagger.ts 模块加载即执行 swaggerJsdoc(options)，验证调用与导出
      expect(mockSwaggerJsdoc).toHaveBeenCalledTimes(1);
      expect(swaggerSpec).toBeDefined();
      expect(swaggerSpec).toEqual({ openapi: '3.0.0', paths: {} });
    });

    it('应仅调用一次 swaggerJsdoc（模块单例缓存）', () => {
      // 设计原因：swaggerSpec 是模块级常量，多次 import 应返回同一实例，不应重复生成
      // 此处验证 mockSwaggerJsdoc 调用次数仍为 1，确保无重复初始化
      expect(mockSwaggerJsdoc).toHaveBeenCalledTimes(1);
    });
  });

  describe('swaggerOptions 配置', () => {
    it('应配置 openapi 3.0.0 版本', () => {
      // 设计原因：OpenAPI 3.0.0 是当前主流规范，确保下游 Swagger UI 兼容
      const opts = captured.options as { definition: { openapi: string } };
      expect(opts.definition.openapi).toBe('3.0.0');
    });

    it('应配置 API 文档标题、版本与描述', () => {
      // 设计原因：文档元信息用于 Swagger UI 标题展示，需正确反映业务领域
      const opts = captured.options as {
        definition: { info: { title: string; version: string; description: string } };
      };
      expect(opts.definition.info.title).toBe('邻里圈 API 文档');
      expect(opts.definition.info.version).toBe('1.0.0');
      expect(opts.definition.info.description).toContain('邻里圈社区服务平台');
    });

    it('应配置本地开发服务器地址，端口来自 process.env.PORT 默认 3000', () => {
      // 设计原因：servers 数组用于 Swagger UI 顶部切换环境，本地开发默认端口 3000
      const opts = captured.options as {
        definition: { servers: Array<{ url: string; description: string }> };
      };
      expect(opts.definition.servers).toHaveLength(1);
      expect(opts.definition.servers[0].url).toBe('http://localhost:3000/api');
      expect(opts.definition.servers[0].description).toBe('本地开发环境');
    });

    it('应配置 7 个业务模块标签用于接口分组展示', () => {
      // 设计原因：tags 用于 Swagger UI 按模块折叠接口，需覆盖所有业务域便于检索
      const opts = captured.options as {
        definition: { tags: Array<{ name: string; description: string }> };
      };
      const tagNames = opts.definition.tags.map((t) => t.name);
      expect(opts.definition.tags).toHaveLength(7);
      // 校验所有核心业务模块均注册了标签
      ['认证', '用户', '技能', '美食', '时间银行', '应急', '消息'].forEach((name) => {
        expect(tagNames).toContain(name);
      });
    });

    it('应配置 JWT bearerAuth 安全方案', () => {
      // 设计原因：所有受保护接口需 bearerAuth 方案，此处验证 components 注册
      const opts = captured.options as {
        definition: {
          components: {
            securitySchemes: { bearerAuth: { type: string; scheme: string; bearerFormat: string } };
          };
        };
      };
      const bearerAuth = opts.definition.components.securitySchemes.bearerAuth;
      expect(bearerAuth.type).toBe('http');
      expect(bearerAuth.scheme).toBe('bearer');
      expect(bearerAuth.bearerFormat).toBe('JWT');
    });

    it('应配置 apis 扫描路径为 ./src/routes/*.ts', () => {
      // 设计原因：swagger-jsdoc 通过扫描路由文件中 @openapi JSDoc 注释生成接口文档，
      // apis 路径需覆盖所有路由文件，避免文档遗漏
      const opts = captured.options as { apis: string[] };
      expect(opts.apis).toEqual(['./src/routes/*.ts']);
    });
  });

  describe('完整配置对象结构', () => {
    it('应包含 definition 与 apis 两个顶层字段', () => {
      // 设计原因：swagger-jsdoc 的 Options 类型要求 definition 与 apis，
      // 验证配置结构完整避免运行期解析错误
      const opts = captured.options as { definition: unknown; apis: unknown };
      expect(opts).toHaveProperty('definition');
      expect(opts).toHaveProperty('apis');
    });

    it('definition 应包含 openapi/info/servers/tags/components 五个字段', () => {
      // 设计原因：definition 是 OpenAPI 文档的核心，验证字段完整性
      const opts = captured.options as { definition: Record<string, unknown> };
      const definitionKeys = Object.keys(opts.definition);
      ['openapi', 'info', 'servers', 'tags', 'components'].forEach((key) => {
        expect(definitionKeys).toContain(key);
      });
    });
  });
});
