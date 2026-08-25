import { useState, useEffect, useCallback } from 'react';
import { CustomAgent } from '../types';
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'customAgents';

// 生产管理系统提示词
const PRODUCTION_SYSTEM_PROMPT = `你是"生产管理客户端"内置的 AI 助手，专注于生产制造领域的管理与决策支持。

你的核心能力包括：
1. **发货计划管理** — 协助制定发货排期、跟踪订单交付状态、优化物流路线
2. **排产计划编排** — 根据订单优先级和产能约束编排生产排期、识别瓶颈工序、优化生产节奏
3. **物料需求分析** — BOM 展开计算物料需求、库存预警、采购建议
4. **生产数据分析** — 产能利用率分析、交付达成率统计、异常预警

回答要求：
- 使用简体中文
- 数据用表格呈现，结论先行
- 涉及排期时给出具体日期建议
- 主动识别风险点并给出缓解措施
- 如需操作本地文件（如导出 Excel），直接使用工具完成`;

// 默认的 Agent
const DEFAULT_AGENT: CustomAgent = {
  id: 'default',
  name: '生产管理助手',
  description: '专注于发货计划、排产编排、物料管理的 AI 助手',
  systemPrompt: PRODUCTION_SYSTEM_PROMPT,
  icon: 'Bot',
  color: '#2563eb',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// 预置的专业 Agent 列表
const BUILT_IN_AGENTS: CustomAgent[] = [
  {
    id: 'shipping-planner',
    name: '发货计划专家',
    description: '发货排期、交付跟踪、物流优化',
    systemPrompt: `你是发货计划专家。职责：
1. 根据订单交期和产能编排发货优先级
2. 跟踪在途物流状态，预警延迟风险
3. 优化发货批次，降低物流成本
4. 生成发货通知单和装柜清单

输出格式：用表格列出发货计划，包含订单号、产品、数量、计划发货日期、物流方式。
遇到交付冲突时，按客户重要性和交期紧急度排序。`,
    icon: 'Truck',
    color: '#0ea5e9',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'production-scheduler',
    name: '排产计划专家',
    description: '生产排期、产能平衡、瓶颈分析',
    systemPrompt: `你是排产计划专家。职责：
1. 根据销售订单和预测编排生产排期
2. 平衡各工序产能，识别瓶颈
3. 优化生产批次和切换顺序，减少换型时间
4. 跟踪生产进度，预警延期风险

排产原则：
- 紧急订单优先排产
- 同类产品集中生产减少换型
- 预留 10% 产能缓冲应对插单
- 关键设备不排连续三班以上

输出格式：甘特表或排产表，含工序、设备、起止时间、负责人。`,
    icon: 'Calendar',
    color: '#f59e0b',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'material-manager',
    name: '物料管理专家',
    description: 'BOM 展开、库存预警、采购建议',
    systemPrompt: `你是物料管理专家。职责：
1. 根据生产计划 BOM 展开计算物料需求
2. 对比库存，生成缺料清单
3. 设置安全库存，触发采购预警
4. 优化采购批次，平衡库存成本和缺料风险

物料分类策略：
- A 类物料（高价值）：精确控制，小批量多频次采购
- B 类物料：定期检查，合理备库
- C 类物料（低价值）：批量采购，减少管理成本

输出格式：物料需求表，含物料编码、名称、需求数量、库存、缺口、建议采购量、预计到货日期。`,
    icon: 'Package',
    color: '#10b981',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export function useAgents() {
  const [agents, setAgents] = useState<CustomAgent[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const savedAgents = parsed.map((a: any) => ({
          ...a,
          createdAt: new Date(a.createdAt),
          updatedAt: new Date(a.updatedAt),
        }));
        // 默认 Agent + 预置 Agent + 用户自定义 Agent
        return [DEFAULT_AGENT, ...BUILT_IN_AGENTS, ...savedAgents];
      }
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
    return [DEFAULT_AGENT, ...BUILT_IN_AGENTS];
  });

  // 保存到 localStorage（排除默认和预置 agent）
  const saveAgents = useCallback((newAgents: CustomAgent[]) => {
    const builtInIds = new Set([DEFAULT_AGENT.id, ...BUILT_IN_AGENTS.map(a => a.id)]);
    const toSave = newAgents.filter(a => !builtInIds.has(a.id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, []);

  const addAgent = useCallback((agent: Omit<CustomAgent, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newAgent: CustomAgent = {
      ...agent,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setAgents(prev => {
      const updated = [...prev, newAgent];
      saveAgents(updated);
      return updated;
    });
    return newAgent;
  }, [saveAgents]);

  const updateAgent = useCallback((id: string, updates: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>) => {
    setAgents(prev => {
      const updated = prev.map(a => 
        a.id === id ? { ...a, ...updates, updatedAt: new Date() } : a
      );
      saveAgents(updated);
      return updated;
    });
  }, [saveAgents]);

  const deleteAgent = useCallback((id: string) => {
    // 不能删除默认和预置 agent
    const protectedIds = new Set([DEFAULT_AGENT.id, ...BUILT_IN_AGENTS.map(a => a.id)]);
    if (protectedIds.has(id)) return;
    setAgents(prev => {
      const updated = prev.filter(a => a.id !== id);
      saveAgents(updated);
      return updated;
    });
  }, [saveAgents]);

  const getAgent = useCallback((id: string) => {
    return agents.find(a => a.id === id);
  }, [agents]);

  return {
    agents,
    addAgent,
    updateAgent,
    deleteAgent,
    getAgent,
    defaultAgent: DEFAULT_AGENT,
  };
}
