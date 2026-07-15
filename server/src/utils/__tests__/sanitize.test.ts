/**
 * utils/sanitize 单元测试
 *
 * 测试目标：
 * - sanitizeXss：字符串剥离 <script> 等危险节点、非字符串原样返回（避免误伤数字/布尔等类型）
 * - sanitizeObject：批量清洗指定字段、不修改入参、字段不存在或 undefined 时跳过、非字符串字段保留
 * - validateImageUrl：/uploads/ 前缀放行、路径遍历拦截、HTTPS+白名单校验、协议/域名/格式不合法抛错
 * - validateImageUrls：非数组/空数组直接通过、含非字符串抛错、含无效 URL 抛错、全部合法通过
 *
 * 测试策略：mock env 模块动态修改 IMAGES_WHITELIST_DOMAINS，验证白名单分支逻辑；
 *           xss 库真实运行（不 mock），验证 sanitizeXss 实际剥离 <script> 节点的行为。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 可变 mock env：测试中动态修改 IMAGES_WHITELIST_DOMAINS，验证白名单分支逻辑
// 所有被 vi.mock 引用的变量必须用 vi.hoisted 提升，避免 TDZ 错误
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    IMAGES_WHITELIST_DOMAINS: 'trae-api-cn.mchost.guru',
  },
}));

vi.mock('../../config/env', () => ({ env: mockEnv }));

import {
  sanitizeXss,
  sanitizeObject,
  validateImageUrl,
  validateImageUrls,
} from '../sanitize';
import { BadRequestError } from '../errors';

beforeEach(() => {
  // 每个测试前重置白名单为默认值，避免上个用例残留
  mockEnv.IMAGES_WHITELIST_DOMAINS = 'trae-api-cn.mchost.guru';
});

// ==================== sanitizeXss 测试 ====================

describe('utils/sanitize sanitizeXss - 字符串输入', () => {
  it('剥离 <script> 标签（转义为 HTML 实体，不再以可执行标签形式存在）', () => {
    // xss 库默认行为：将不在白名单的标签转义为 HTML 实体（如 &lt;script&gt;），而非删除
    // 设计原因：保留文本内容（如 alert 字符串），仅让标签失去可执行性
    const input = '<script>alert("xss")</script>';
    const result = sanitizeXss(input) as string;
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
    // alert 作为普通文本内容被保留（不是危险节点，无需剥离）
    expect(result).toContain('alert');
  });

  it('剥离事件处理器（onerror 属性被移除）', () => {
    // xss 库默认行为：移除所有事件处理器属性（onerror/onclick/onload 等）
    const input = '<img src="x" onerror="alert(1)">';
    const result = sanitizeXss(input) as string;
    expect(result).not.toContain('onerror');
    // onerror 中的 alert(1) 字符串内容随属性一起被移除
    expect(result).not.toContain('alert(1)');
  });

  it('保留普通文本', () => {
    const input = '这是一段普通文本';
    expect(sanitizeXss(input)).toBe('这是一段普通文本');
  });

  it('保留安全 HTML 标签（如 <p>）', () => {
    // xss 库默认白名单允许 <p>、<b>、<i> 等基础标签
    const input = '<p>段落文本</p>';
    const result = sanitizeXss(input) as string;
    expect(result).toContain('<p>');
    expect(result).toContain('段落文本');
  });
});

describe('utils/sanitize sanitizeXss - 非字符串输入原样返回', () => {
  it('数字原样返回', () => {
    expect(sanitizeXss(42)).toBe(42);
  });

  it('布尔值原样返回', () => {
    expect(sanitizeXss(true)).toBe(true);
  });

  it('null 原样返回', () => {
    expect(sanitizeXss(null)).toBeNull();
  });

  it('undefined 原样返回', () => {
    expect(sanitizeXss(undefined)).toBeUndefined();
  });

  it('对象原样返回（不深度清洗）', () => {
    const obj = { a: 1 };
    expect(sanitizeXss(obj)).toBe(obj);
  });

  it('数组原样返回', () => {
    const arr = [1, 2, 3];
    expect(sanitizeXss(arr)).toBe(arr);
  });
});

// ==================== sanitizeObject 测试 ====================

describe('utils/sanitize sanitizeObject - 批量清洗', () => {
  it('清洗对象中指定字段（字符串字段被清洗，非字符串字段保留）', () => {
    const data = {
      title: '<script>alert(1)</script>正常标题',
      content: '<p>段落</p>',
      price: 100,
      tags: ['tag1', 'tag2'],
    };
    const result = sanitizeObject(data, ['title', 'content']);
    // 字符串字段被清洗
    expect(result.title).not.toContain('<script>');
    expect(result.title).toContain('正常标题');
    // 非字符串字段原样保留
    expect(result.price).toBe(100);
    expect(result.tags).toEqual(['tag1', 'tag2']);
  });

  it('不修改入参对象（返回新对象）', () => {
    const data = { title: '<script>alert(1)</script>' };
    const result = sanitizeObject(data, ['title']);
    // 入参对象不被修改
    expect(data.title).toBe('<script>alert(1)</script>');
    // 返回新对象被清洗
    expect(result.title).not.toContain('<script>');
    expect(result).not.toBe(data);
  });

  it('字段不存在时跳过（不报错）', () => {
    const data = { title: '正常' };
    // fields 包含 data 中不存在的字段，应跳过不报错
    const result = sanitizeObject(data, ['title', 'nonexistent']);
    expect(result.title).toBe('正常');
  });

  it('字段值为 undefined 时跳过（保留 undefined）', () => {
    const data = { title: undefined, content: '正常' };
    const result = sanitizeObject(data, ['title', 'content']);
    expect(result.title).toBeUndefined();
    expect(result.content).toBe('正常');
  });

  it('保留未在 fields 列表中的字段（不清洗）', () => {
    const data = {
      title: '<script> alert(1) </script>',
      description: '<script>不应被清洗</script>',
    };
    // 只清洗 title，description 不在 fields 中应原样保留
    const result = sanitizeObject(data, ['title']);
    expect(result.title).not.toContain('<script>');
    expect(result.description).toBe('<script>不应被清洗</script>');
  });

  it('空 fields 列表时返回原对象的浅拷贝', () => {
    const data = { title: '<script>alert(1)</script>' };
    const result = sanitizeObject(data, []);
    // 不清洗任何字段，但仍返回新对象
    expect(result).toEqual(data);
    expect(result).not.toBe(data);
  });
});

// ==================== validateImageUrl 测试 ====================

describe('utils/sanitize validateImageUrl - /uploads/ 相对路径', () => {
  it('/uploads/ 前缀直接通过', () => {
    expect(() => validateImageUrl('/uploads/photo.jpg')).not.toThrow();
  });

  it('/uploads/ 前缀 + 子目录通过', () => {
    expect(() => validateImageUrl('/uploads/2026/07/photo.jpg')).not.toThrow();
  });

  it('/uploads/ 前缀含路径遍历（..）抛 BadRequestError', () => {
    expect(() => validateImageUrl('/uploads/../etc/passwd')).toThrow(BadRequestError);
    expect(() => validateImageUrl('/uploads/../etc/passwd')).toThrow('图片 URL 包含非法路径');
  });

  it('路径遍历变体：反斜杠（\\）抛 BadRequestError（防止 Windows 路径分隔符绕过）', () => {
    // 设计原因：仅依赖 url.includes('..') 会被 ..\ 绕过，Windows 路径分隔符不同
    expect(() => validateImageUrl('/uploads/..\\etc\\passwd')).toThrow(BadRequestError);
    expect(() => validateImageUrl('/uploads/..\\etc\\passwd')).toThrow('图片 URL 包含非法路径');
  });

  it('路径遍历变体：URL 编码 %2e（.. 的编码）抛 BadRequestError', () => {
    // 设计原因：%2e%2e 经 URL 解码后为 ..，可绕过字面 .. 检查
    expect(() => validateImageUrl('/uploads/%2e%2e/etc/passwd')).toThrow(BadRequestError);
    expect(() => validateImageUrl('/uploads/%2e%2e/etc/passwd')).toThrow('图片 URL 包含非法路径');
  });

  it('路径遍历变体：URL 编码 %5c（\\ 的编码）抛 BadRequestError', () => {
    // 设计原因：%5c 经 URL 解码后为 \，可绕过字面 \\ 检查
    expect(() => validateImageUrl('/uploads/%5cetc%5cpasswd')).toThrow(BadRequestError);
    expect(() => validateImageUrl('/uploads/%5cetc%5cpasswd')).toThrow('图片 URL 包含非法路径');
  });

  it('路径遍历变体：大写 URL 编码 %2E 抛 BadRequestError（大小写不敏感）', () => {
    // 设计原因：攻击者可能使用大写 %2E%2E 绕过 lowercase 后的小写 %2e 检查
    // 实现已先 toLowerCase 再 includes('%2e')，故大写变体也被拦截
    expect(() => validateImageUrl('/uploads/%2E%2E/etc/passwd')).toThrow(BadRequestError);
  });

  it('合法 /uploads/ 路径不含路径遍历变体时应通过', () => {
    // 边界场景：路径中包含合法字符（如连字符、下划线），不应被误判为路径遍历
    expect(() => validateImageUrl('/uploads/2026-07_photo.jpg')).not.toThrow();
    expect(() => validateImageUrl('/uploads/user_avatar.png')).not.toThrow();
  });
});

describe('utils/sanitize validateImageUrl - HTTPS 外链', () => {
  it('白名单域名 + HTTPS 通过', () => {
    expect(() => validateImageUrl('https://trae-api-cn.mchost.guru/image.png')).not.toThrow();
  });

  it('非白名单域名抛 BadRequestError', () => {
    expect(() => validateImageUrl('https://evil.com/image.png')).toThrow(BadRequestError);
    expect(() => validateImageUrl('https://evil.com/image.png')).toThrow('域名不在白名单内');
  });

  it('http 协议（非 https）抛 BadRequestError', () => {
    expect(() => validateImageUrl('http://trae-api-cn.mchost.guru/image.png')).toThrow(BadRequestError);
    expect(() => validateImageUrl('http://trae-api-cn.mchost.guru/image.png')).toThrow('必须使用 HTTPS 协议');
  });

  it('无效 URL 格式抛 BadRequestError', () => {
    expect(() => validateImageUrl('not-a-url')).toThrow(BadRequestError);
    expect(() => validateImageUrl('not-a-url')).toThrow('URL 格式不正确');
  });

  it('多域名白名单（逗号分隔）任一匹配即通过', () => {
    mockEnv.IMAGES_WHITELIST_DOMAINS = 'cdn.example.com, trae-api-cn.mchost.guru';
    expect(() => validateImageUrl('https://cdn.example.com/a.png')).not.toThrow();
    expect(() => validateImageUrl('https://trae-api-cn.mchost.guru/a.png')).not.toThrow();
  });

  it('白名单含空白项时被过滤（防御配置空格）', () => {
    // 实际场景：env 配置 "cdn.example.com, , trae-api-cn.mchost.guru" 中间多了一个空项
    mockEnv.IMAGES_WHITELIST_DOMAINS = 'cdn.example.com, , trae-api-cn.mchost.guru';
    expect(() => validateImageUrl('https://cdn.example.com/a.png')).not.toThrow();
    // 空白项不应被当作合法 hostname，但也不应导致校验异常
    expect(() => validateImageUrl('https://evil.com/a.png')).toThrow(BadRequestError);
  });

  it('空字符串 URL 抛 BadRequestError（无法解析为 URL）', () => {
    expect(() => validateImageUrl('')).toThrow(BadRequestError);
  });
});

// ==================== validateImageUrls 测试 ====================

describe('utils/sanitize validateImageUrls - 批量校验', () => {
  it('非数组直接通过', () => {
    expect(() => validateImageUrls(undefined)).not.toThrow();
    expect(() => validateImageUrls(null as unknown as string[])).not.toThrow();
    expect(() => validateImageUrls('not-array' as unknown as string[])).not.toThrow();
  });

  it('空数组直接通过', () => {
    expect(() => validateImageUrls([])).not.toThrow();
  });

  it('undefined 直接通过（可选参数）', () => {
    expect(() => validateImageUrls()).not.toThrow();
  });

  it('数组中所有 URL 合法通过', () => {
    const urls = [
      '/uploads/photo1.jpg',
      '/uploads/photo2.jpg',
      'https://trae-api-cn.mchost.guru/image.png',
    ];
    expect(() => validateImageUrls(urls)).not.toThrow();
  });

  it('数组中含非字符串抛 BadRequestError', () => {
    const urls = ['/uploads/photo.jpg', 123, 'https://trae-api-cn.mchost.guru/a.png'] as unknown as string[];
    expect(() => validateImageUrls(urls)).toThrow(BadRequestError);
    expect(() => validateImageUrls(urls)).toThrow('图片 URL 必须为字符串');
  });

  it('数组中含无效 URL 抛 BadRequestError', () => {
    const urls = ['/uploads/photo.jpg', 'https://evil.com/a.png'];
    expect(() => validateImageUrls(urls)).toThrow(BadRequestError);
    expect(() => validateImageUrls(urls)).toThrow('域名不在白名单内');
  });

  it('数组中含路径遍历 URL 抛 BadRequestError', () => {
    const urls = ['/uploads/ok.jpg', '/uploads/../etc/passwd'];
    expect(() => validateImageUrls(urls)).toThrow(BadRequestError);
    expect(() => validateImageUrls(urls)).toThrow('图片 URL 包含非法路径');
  });

  it('单元素数组全部合法通过', () => {
    expect(() => validateImageUrls(['/uploads/only.jpg'])).not.toThrow();
  });
});
