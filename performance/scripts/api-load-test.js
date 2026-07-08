import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// 读取配置文件
const config = JSON.parse(open('../config/test-config.json'));

// 从环境变量或配置文件中获取 baseUrl
const baseUrl = __ENV.BASE_URL || config.baseUrl;

// 测试用户凭据
const testUser = config.testUser;

// 定义场景：使用配置文件中的 scenarios，或默认使用 smoke 场景
const scenarios = config.scenarios.smoke ? {
  smoke: {
    executor: 'constant-vus',
    vus: config.scenarios.smoke.vus,
    duration: config.scenarios.smoke.duration,
  },
} : {};

// 如果配置了 load 场景，则添加
if (config.scenarios.load) {
  scenarios.load = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: config.scenarios.load.stages,
    gracefulRampDown: '30s',
  };
}

// 如果配置了 stress 场景，则添加
if (config.scenarios.stress) {
  scenarios.stress = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: config.scenarios.stress.stages,
    gracefulRampDown: '30s',
  };
}

// 阈值配置
const thresholds = config.thresholds;

export const options = {
  scenarios,
  thresholds,
};

// 登录获取 token
function login() {
  const loginPayload = JSON.stringify({
    phone: testUser.phone,
    password: testUser.password,
  });

  const loginHeaders = { 'Content-Type': 'application/json' };
  const loginRes = http.post(`${baseUrl}/api/auth/login`, loginPayload, {
    headers: loginHeaders,
  });

  check(loginRes, {
    '登录成功': (r) => r.status === 200,
    '响应包含 token': (r) => JSON.parse(r.body).token !== undefined,
  });

  return loginRes.json('token');
}

export default function () {
  // 每个虚拟用户首先登录获取 token
  const token = login();
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // 用户登录场景（单独测试登录接口性能）
  group('用户登录', function () {
    const res = http.post(`${baseUrl}/api/auth/login`, JSON.stringify({
      phone: testUser.phone,
      password: testUser.password,
    }), { headers: { 'Content-Type': 'application/json' } });

    check(res, {
      '登录接口状态 200': (r) => r.status === 200,
    });
  });

  // 技能列表（分页查询）
  group('技能列表', function () {
    const res = http.get(`${baseUrl}/api/skills?page=1&limit=10`, {
      headers: authHeaders,
    });

    check(res, {
      '技能列表状态 200': (r) => r.status === 200,
      '响应包含数据': (r) => JSON.parse(r.body).data !== undefined,
    });
  });

  // 技能详情（假设 ID 为 1）
  group('技能详情', function () {
    const res = http.get(`${baseUrl}/api/skills/1`, {
      headers: authHeaders,
    });

    check(res, {
      '技能详情状态 200': (r) => r.status === 200,
      '响应包含技能名称': (r) => JSON.parse(r.body).name !== undefined,
    });
  });

  // 厨房列表
  group('厨房列表', function () {
    const res = http.get(`${baseUrl}/api/kitchen`, {
      headers: authHeaders,
    });

    check(res, {
      '厨房列表状态 200': (r) => r.status === 200,
    });
  });

  // 时间银行服务列表
  group('时间银行服务列表', function () {
    const res = http.get(`${baseUrl}/api/time-bank/services`, {
      headers: authHeaders,
    });

    check(res, {
      '时间银行服务列表状态 200': (r) => r.status === 200,
    });
  });

  // 应急请求列表
  group('应急请求列表', function () {
    const res = http.get(`${baseUrl}/api/emergency`, {
      headers: authHeaders,
    });

    check(res, {
      '应急请求列表状态 200': (r) => r.status === 200,
    });
  });

  // 管理员仪表盘（需要管理员权限，这里假设 token 有管理员权限）
  group('管理员仪表盘', function () {
    const res = http.get(`${baseUrl}/api/admin/dashboard`, {
      headers: authHeaders,
    });

    check(res, {
      '管理员仪表盘状态 200': (r) => r.status === 200,
    });
  });

  // 模拟用户思考时间
  sleep(1);
}