import { useState, useCallback, useEffect, useRef } from "react";
import {
  Loader2,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  Lock,
  X,
  Save,
  Settings,
  Award,
  Clock,
} from "lucide-react";
import { getSettings, setSetting, deleteSetting, type SystemSetting, type SettingValueType } from "@/api/admin";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";
import Empty from "@/components/Empty";

// 受保护配置键：与后端 PROTECTED_SETTING_KEYS 对齐，禁止删除，避免误删核心功能配置
const PROTECTED_KEYS = ["homepage_hero_image"];

// 配置键命名规范：与后端 SETTING_KEY_PATTERN 对齐，仅允许小写字母、数字、下划线，以字母开头
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const VALUE_MAX_LENGTH = 2000;

// 配置分组定义：按 key 关键词归类，便于管理员快速定位
// 设计原因：配置键无统一前缀约定（如 skill_publish_reward、order_timeout），按业务语义关键词分组最贴合管理场景
interface ConfigGroup {
  key: string;
  title: string;
  icon: typeof Settings;
  items: SystemSetting[];
}

// 分组规则项：每条规则定义一个业务域的关键词正则、标题与图标
// 设计原因：将分组规则抽为模块级常量数组，新增业务域只需追加规则项，无需修改 groupSettings 函数逻辑，符合开闭原则
interface ConfigGroupRule {
  key: string;
  title: string;
  icon: typeof Settings;
  pattern: RegExp;
}

// 配置分组规则表：按业务域语义关键词匹配
// 新增业务域（如通知、安全）只需在此数组追加一项，无需改动 groupSettings 函数
const CONFIG_GROUP_RULES: ConfigGroupRule[] = [
  // 积分规则关键词：奖励/积分/收益/评分/点数
  { key: 'credit', title: '积分规则', icon: Award, pattern: /reward|credit|earn|score|point/ },
  // 超时与限额关键词：超时/过期/时长/限额
  { key: 'timeout', title: '超时与限额', icon: Clock, pattern: /timeout|expire|duration|limit/ },
];

// 通用配置兜底分组：未命中任何业务域规则的配置项归入此处
const DEFAULT_GROUP: ConfigGroupRule = {
  key: 'other',
  title: '通用配置',
  icon: Settings,
  pattern: /(?:)/, // 永不匹配的正则，仅用于复用 ConfigGroupRule 类型
};

// 浮点类配置识别已迁移至后端 value_type 元数据驱动，前端按 valueType 字段判断滑块步长
// 设计原因：原 FLOAT_CONFIG_PATTERN 关键词正则违反开闭原则，新增浮点配置需改正则；
// 改用 value_type 元数据后，新增配置只需在后端标记 value_type='float'，前端零改动

function groupSettings(settings: SystemSetting[]): ConfigGroup[] {
  // 按规则顺序初始化各分组桶（含兜底分组），用 Map 索引避免 find 返回 undefined 的类型风险
  const bucketByKey = new Map<string, ConfigGroup>();
  for (const rule of CONFIG_GROUP_RULES) {
    bucketByKey.set(rule.key, { ...rule, items: [] });
  }
  const fallbackKey = DEFAULT_GROUP.key;
  bucketByKey.set(fallbackKey, { ...DEFAULT_GROUP, items: [] });
  // 逐条配置按规则顺序匹配，命中即入桶；未命中归入兜底桶
  for (const s of settings) {
    const k = s.key.toLowerCase();
    const matchedRule = CONFIG_GROUP_RULES.find(rule => rule.pattern.test(k));
    const targetKey = matchedRule ? matchedRule.key : fallbackKey;
    bucketByKey.get(targetKey)!.items.push(s);
  }
  // 过滤空分组，避免渲染空 section
  return Array.from(bucketByKey.values()).filter(g => g.items.length > 0);
}

// 编辑弹窗状态：editing 为已存在配置，null 表示新增
interface EditTarget {
  setting: SystemSetting | null;
}

export default function SystemConfig() {
  const [list, setList] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SystemSetting | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 挂载标志：useEffect cleanup 时置为 false，loadSettings await 后检查避免卸载后 setState 泄漏
  // 设计原因：loadSettings 同时被 handleSave/handleDelete 成功后调用，任一异步路径中组件卸载均会泄漏
  const mountedRef = useRef(true);

  // 加载配置列表
  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSettings();
      // 卸载后不再 setState，避免 React 警告与内存泄漏
      if (!mountedRef.current) return;
      setList(res.data);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof ApiError ? err.message : "加载配置失败");
    } finally {
      // 仅挂载中才更新 loading，避免卸载后 finally 触发 setState
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 重置挂载标志：组件重新挂载时恢复为 true
    mountedRef.current = true;
    loadSettings();
    // cleanup：组件卸载时置为 false，使进行中的 loadSettings 失效
    return () => { mountedRef.current = false; };
  }, [loadSettings]);

  // 提交新增/编辑配置
  const handleSave = async (key: string, value: string, description: string, valueType: SettingValueType) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 编辑时 description 传空字符串会清空原值，传 undefined 保留原值；这里允许清空故传空串
      // valueType 透传后端，新增/编辑均显式传入，确保类型元数据持久化
      await setSetting(key, value, description, valueType);
      toast.success(editTarget?.setting ? "配置已更新" : "配置已新增");
      setEditTarget(null);
      loadSettings();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 提交删除配置
  const handleDelete = async () => {
    if (!deleteTarget || submitting) return;
    setSubmitting(true);
    try {
      await deleteSetting(deleteTarget.key);
      toast.success("配置已删除");
      setDeleteTarget(null);
      loadSettings();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "删除失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 判断配置是否受保护（禁止删除）
  const isProtected = (key: string) => PROTECTED_KEYS.includes(key);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-neutral-800">系统配置</h2>
          <p className="text-xs text-neutral-500 mt-1">管理站点全局参数（积分规则、超时时长等）</p>
        </div>
        <button
          onClick={() => setEditTarget({ setting: null })}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新增配置
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={loadSettings} className="ml-auto text-sm underline py-1 px-2 rounded hover:bg-red-50 transition-colors">重试</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        </div>
      ) : list.length === 0 ? (
        <Empty title="暂无配置项" description="配置项会在这里显示" icon={<Settings className="w-16 h-16" />} />
      ) : (
        <div className="space-y-6">
          {groupSettings(list).map(group => {
            const GroupIcon = group.icon;
            return (
              <section key={group.key}>
                <div className="flex items-center gap-2 mb-3">
                  <GroupIcon className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold text-neutral-700">{group.title}</h3>
                  <span className="text-xs text-neutral-400">({group.items.length})</span>
                </div>
                <SettingList
                  items={group.items}
                  onEdit={(item) => setEditTarget({ setting: item })}
                  onDelete={(item) => setDeleteTarget(item)}
                  isProtected={isProtected}
                />
              </section>
            );
          })}
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {editTarget && (
        <EditModal
          target={editTarget}
          submitting={submitting}
          onClose={() => setEditTarget(null)}
          onSave={handleSave}
        />
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-backdrop">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm animate-modal-enter">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-neutral-800">确认删除配置</h3>
              <button onClick={() => setDeleteTarget(null)} className="text-neutral-400 hover:text-neutral-600 p-1 rounded hover:bg-neutral-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-600 mb-1">配置键：</p>
            <p className="font-mono text-sm text-neutral-900 mb-4 break-all">{deleteTarget.key}</p>
            <p className="text-sm text-red-600 mb-4">删除后不可恢复，相关功能可能受影响。</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="px-4 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== 配置列表子组件（桌面表格 + 移动卡片） =====================

interface SettingListProps {
  items: SystemSetting[];
  onEdit: (item: SystemSetting) => void;
  onDelete: (item: SystemSetting) => void;
  isProtected: (key: string) => boolean;
}

function SettingList({ items, onEdit, onDelete, isProtected }: SettingListProps) {
  return (
    <>
      {/* 桌面端表格 */}
      <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-neutral-100">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3 text-left">配置键</th>
              <th className="px-4 py-3 text-left">配置值</th>
              <th className="px-4 py-3 text-left">说明</th>
              <th className="px-4 py-3 text-left">更新时间</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((item) => {
              const protectedKey = isProtected(item.key);
              return (
                <tr key={item.key} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                    <div className="flex items-center gap-1">
                      {protectedKey && <Lock className="w-3 h-3 text-amber-500" />}
                      {item.key}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 max-w-xs truncate" title={item.value ?? ""}>
                    {item.value || <span className="text-neutral-400">（空）</span>}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 max-w-xs truncate" title={item.description ?? ""}>
                    {item.description || <span className="text-neutral-400">-</span>}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 text-xs">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onEdit(item)}
                        className="text-emerald-600 text-xs px-3 py-2 rounded-lg hover:bg-emerald-50 transition-colors inline-flex items-center gap-0.5"
                      >
                        <Pencil className="w-3 h-3" />
                        编辑
                      </button>
                      {!protectedKey && (
                        <button
                          onClick={() => onDelete(item)}
                          className="text-red-600 text-xs px-3 py-2 rounded-lg hover:bg-red-50 transition-colors inline-flex items-center gap-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 移动端卡片布局 */}
      <div className="md:hidden space-y-3">
        {items.map((item) => {
          const protectedKey = isProtected(item.key);
          return (
            <div key={item.key} className="bg-white rounded-xl border border-neutral-100 p-4">
              <div className="flex justify-between items-start mb-2">
                <div className="font-mono text-xs text-neutral-700 flex items-center gap-1">
                  {protectedKey && <Lock className="w-3 h-3 text-amber-500" />}
                  {item.key}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onEdit(item)}
                    className="text-emerald-600 text-xs px-3 py-2 rounded-lg hover:bg-emerald-50 transition-colors inline-flex items-center gap-0.5"
                  >
                    <Pencil className="w-3 h-3" />
                    编辑
                  </button>
                  {!protectedKey && (
                    <button
                      onClick={() => onDelete(item)}
                      className="text-red-600 text-xs px-3 py-2 rounded-lg hover:bg-red-50 transition-colors inline-flex items-center gap-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                      删除
                    </button>
                  )}
                </div>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-neutral-500 flex-shrink-0">配置值</span>
                  <span className="text-neutral-700 text-right break-all">{item.value || "（空）"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-neutral-500 flex-shrink-0">说明</span>
                  <span className="text-neutral-700 text-right">{item.description || "-"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-neutral-500 flex-shrink-0">更新时间</span>
                  <span className="text-neutral-500 text-xs">
                    {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "-"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ===================== 新增/编辑弹窗子组件 =====================

interface EditModalProps {
  target: EditTarget;
  submitting: boolean;
  onClose: () => void;
  onSave: (key: string, value: string, description: string, valueType: SettingValueType) => void;
}

function EditModal({ target, submitting, onClose, onSave }: EditModalProps) {
  const isEdit = !!target.setting;
  const [key, setKey] = useState(target.setting?.key ?? "");
  const [value, setValue] = useState(target.setting?.value ?? "");
  const [description, setDescription] = useState(target.setting?.description ?? "");
  // 配置值类型：编辑时预选原值类型，新增时缺省 string
  // 设计原因：valueType 驱动滑块步长精度，由后端元数据决定，替代原 key 关键词正则识别
  const [valueType, setValueType] = useState<SettingValueType>(target.setting?.valueType ?? 'string');
  const [formError, setFormError] = useState<string | null>(null);

  // 数值类配置识别：value 可解析为数字时启用滑块控件，提升积分规则等数值配置的编辑体验
  const isNumericValue = value.trim() !== "" && !isNaN(Number(value));
  const numericValue = isNumericValue ? Number(value) : 0;
  // 浮点类配置识别：改用后端 valueType 元数据判断，不再依赖 key 关键词正则
  const isFloatConfig = valueType === 'float';
  // 滑块最大值动态扩展：浮点类配置上限取 10（汇率/系数通常小于 10），整数类取 100 与当前值 2 倍的较大者
  const sliderMax = isFloatConfig
    ? Math.max(10, Math.ceil(numericValue * 2))
    : Math.max(100, Math.ceil(numericValue * 2));
  // 步长精度：float 类型 0.01（汇率/系数精度），int 类型 1；string 类型沿用原值兜底（含小数取 0.1 否则 1）
  const sliderStep = isFloatConfig ? 0.01 : valueType === 'int' ? 1 : (numericValue % 1 === 0 ? 1 : 0.1);

  // 字段级校验：key 格式、value 必填与长度
  const validate = (): string | null => {
    if (!isEdit && !KEY_PATTERN.test(key)) {
      return "配置键只能包含小写字母、数字、下划线，且以字母开头（1-64 字符）";
    }
    if (!value.trim()) return "配置值不能为空";
    if (value.length > VALUE_MAX_LENGTH) return `配置值长度不能超过 ${VALUE_MAX_LENGTH}`;
    return null;
  };

  const error = validate();

  const handleSubmit = () => {
    if (error || submitting) return;
    setFormError(null);
    onSave(key, value, description, valueType);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-backdrop">
      {/* w-full max-w-md：替代 w-[90%] 固定百分比，配合外层 p-4 实现稳定的 viewport 适配 */}
      <div className="bg-white rounded-xl w-full max-w-md p-5 shadow-lg animate-modal-enter">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-neutral-800">{isEdit ? "编辑配置" : "新增配置"}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 p-1 rounded hover:bg-neutral-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">配置键</label>
            <input
              type="text"
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder="如 daily_earn_limit"
              disabled={isEdit}
              className={`w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                isEdit ? "text-neutral-400 cursor-not-allowed" : ""
              }`}
            />
            {isEdit && (
              <p className="text-xs text-neutral-400 mt-1">配置键创建后不可修改</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              配置值 <span className="text-xs text-neutral-400">（{value.length}/{VALUE_MAX_LENGTH}）</span>
            </label>
            {isNumericValue ? (
              <div className="space-y-3">
                {/* 数值类配置：数字输入 + 滑块双向绑定，积分规则等数值配置可视化调节 */}
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    className="flex-1 px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-neutral-500 whitespace-nowrap">{numericValue}</span>
                </div>
                <input
                  type="range"
                  value={numericValue}
                  min={0}
                  max={sliderMax}
                  step={sliderStep}
                  onChange={e => setValue(e.target.value)}
                  className="w-full accent-emerald-500"
                />
                <p className="text-xs text-neutral-400">
                  滑块范围：0 - {sliderMax}（步长 {sliderStep}，数字输入可超出范围）
                </p>
              </div>
            ) : (
              <textarea
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="配置值，统一以字符串存储"
                rows={3}
                className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none font-mono"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              值类型 <span className="text-xs text-neutral-400">（决定滑块步长精度）</span>
            </label>
            {/* 分段选择器：string/int/float 三选一，选中态用 emerald 高亮 */}
            <div className="flex gap-2">
              {(['string', 'int', 'float'] as const).map(vt => (
                <button
                  key={vt}
                  type="button"
                  onClick={() => setValueType(vt)}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                    valueType === vt
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : 'bg-neutral-50 text-neutral-600 border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  {vt === 'string' ? '字符串' : vt === 'int' ? '整数' : '浮点'}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              {valueType === 'float' ? '浮点类配置（如汇率/系数），滑块步长 0.01' :
               valueType === 'int' ? '整数类配置（如积分/超时），滑块步长 1' :
               '字符串配置，数值时可调节滑块'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">配置说明（选填）</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="简要描述配置用途"
              className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* 字段级错误提示：AlertCircle 红色背景，符合项目错误提示规范 */}
        {(formError || error) && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{formError || error}</p>
          </div>
        )}

        <div className="flex gap-2 justify-end mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!!error || submitting}
            className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {submitting ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
