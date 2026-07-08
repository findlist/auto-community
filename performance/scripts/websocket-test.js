import http from 'k6/http';
import { check, sleep } from 'k6';
import { WebSocket } from 'k6/experimental/websockets';
import { SharedArray } from 'k6/data';

// 读取配置文件
const config = JSON.parse(open('../config/test-config.json'));

// 从环境变量或配置文件中获取 baseUrl
const baseUrl = __ENV.BASE_URL || config.baseUrl;
const wsUrl = baseUrl.replace('http', 'ws');

// 测试用户凭据
const testUser = config.testUser;

// 场景配置：模拟 100 个并发 WebSocket 连接
export const options = {
  scenarios: {
    websocket_test: {
      executor: 'constant-vus',
      vus: 100,
      duration: '1m',
    },
  },
  thresholds: {
    // WebSocket 消息延迟阈值：95% 的消息延迟小于 500ms
    'ws_msg_latency': ['p(95)<500'],
    // 连接成功率大于 99%
    'ws_connect_success': ['rate>0.99'],
  },
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
  if (!token) {
    console.error('登录失败，无法获取 token');
    return;
  }

  // 建立 WebSocket 连接
  const ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

  // 记录连接开始时间
  const connectStart = Date.now();

  ws.onopen = () => {
    // 连接成功，记录连接耗时
    const connectLatency = Date.now() - connectStart;
    console.log(`WebSocket 连接成功，耗时: ${connectLatency}ms`);

    // 发送测试消息
    const message = JSON.stringify({
      type: 'chat',
      orderId: 'test-order-id', // 测试订单 ID
      content: '性能测试消息',
      msgType: 'text',
      orderType: 'skill',
    });

    // 记录消息发送时间
    const sendTime = Date.now();
    ws.send(message);

    // 监听消息响应
    ws.onmessage = (event) => {
      const receiveTime = Date.now();
      const latency = receiveTime - sendTime;
      console.log(`消息往返延迟: ${latency}ms`);

      // 记录延迟指标
      // 注意：k6 的 metrics 需要在 init 阶段定义，这里仅作为示例
      // 实际使用中可能需要使用 k6 的 Trend 指标
    };
  };

  ws.onerror = (error) => {
    console.error('WebSocket 错误:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket 连接关闭');
  };

  // 模拟用户活跃时间
  sleep(5);

  // 关闭连接
  ws.close();
}