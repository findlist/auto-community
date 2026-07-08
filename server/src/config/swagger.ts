import swaggerJsdoc from 'swagger-jsdoc';

/**
 * Swagger OpenAPI 配置
 *
 * 通过扫描路由文件中 @openapi JSDoc 注释自动生成接口文档，
 * 避免文档与代码脱节。访问 /api-docs 查看 UI。
 */
const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: '邻里圈 API 文档',
      version: '1.0.0',
      description: '邻里圈社区服务平台后端接口文档，涵盖认证、用户、技能、美食、时间银行、应急、消息等模块',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3000}/api`,
        description: '本地开发环境',
      },
    ],
    tags: [
      { name: '认证', description: '用户注册、登录、登出与令牌刷新' },
      { name: '用户', description: '用户资料与积分/时间历史' },
      { name: '技能', description: '技能帖子发布与订单交易' },
      { name: '美食', description: '美食分享、订单与拼单' },
      { name: '时间银行', description: '时间服务、转账与家庭绑定' },
      { name: '应急', description: '紧急求助与应急资源' },
      { name: '消息', description: '订单聊天与未读统计' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  // 扫描路由文件中的 @openapi 注释
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);
