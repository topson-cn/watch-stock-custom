import type { BuildCandidate, StrategyWatchResult, StrategyWatchTask } from "../types";

export const DEFAULT_STRATEGY_WATCH_TASKS: StrategyWatchTask[] = [
  {
    id: "ai-hardware-chain",
    name: "AI硬件链",
    priority: 1,
    mode: "trade",
    description: "PCB、覆铜板、高速材料、先进封装、连接器和AI服务器一体观察。",
    keywords: [
      "沪电",
      "深南",
      "生益",
      "胜宏",
      "景旺",
      "崇达",
      "兴森",
      "方正科技",
      "世运",
      "华正",
      "金安国纪",
      "宏和",
      "德福",
      "长电",
      "通富",
      "华天",
      "工业富联",
      "中际",
      "天孚",
      "新易盛",
      "光迅",
      "中兴",
      "沃尔核材",
      "兆龙",
      "立讯",
    ],
    sectors: ["人工智能", "半导体", "芯片", "通信"],
    rules: ["回踩承接", "放量突破60日线", "MACD零轴金叉"],
    riskNote: "高开猛冲只提醒不追；长电科技反弹只复盘，不因卖飞追回。",
    notify: true,
  },
  {
    id: "robotics-automation",
    name: "机器人/工业自动化",
    priority: 2,
    mode: "trade",
    description: "机器人、伺服、电机、减速器和工业自动化方向。",
    keywords: [
      "机器人",
      "埃斯顿",
      "汇川",
      "鸣志",
      "拓斯达",
      "中大力德",
      "秦川",
      "柯力",
      "雷赛",
      "卧龙",
      "双环",
      "巨轮",
    ],
    sectors: ["机器人", "新能源"],
    rules: ["板块放量", "前排辨识度", "强势回踩"],
    riskNote: "后排多、一日游多，只通知成交额和图形都过关的主板候选。",
    notify: true,
  },
  {
    id: "power-grid-storage",
    name: "电力设备/电网/储能",
    priority: 3,
    mode: "trend",
    description: "电网设备、变压器、储能和电力设备的趋势确认。",
    keywords: [
      "特变",
      "平高",
      "许继",
      "中国西电",
      "思源",
      "国电南瑞",
      "东方电缆",
      "金盘",
      "阳光",
      "科士达",
      "科陆",
    ],
    sectors: ["电网设备", "电力", "新能源", "电池"],
    rules: ["MACD零轴金叉", "60日线上方承接"],
    riskNote: "偏趋势确认，不适合看到急拉就追。",
    notify: true,
  },
  {
    id: "defense-low-altitude",
    name: "军工/低空经济",
    priority: 4,
    mode: "trade",
    description: "军工、航空航天、北斗和低空经济的事件驱动方向。",
    keywords: [
      "中航",
      "航天",
      "北斗",
      "洪都",
      "成飞",
      "中直",
      "宗申",
      "万丰",
      "光启",
      "海特",
      "航发",
    ],
    sectors: ["航空航天", "军工", "国防"],
    rules: ["板块集体放量", "前排持续", "主板图形流畅"],
    riskNote: "消息刺激多，冲高回落多；没有板块效应就降级观察。",
    notify: true,
  },
  {
    id: "resources-hedge",
    name: "有色/稀土/黄金",
    priority: 5,
    mode: "trend",
    description: "资源线作为弱市独立方向和放量突破观察。",
    keywords: [
      "紫金",
      "山东黄金",
      "中金黄金",
      "赤峰黄金",
      "洛阳钼业",
      "北方稀土",
      "包钢",
      "厦门钨业",
      "盛和",
      "中国铝业",
      "江西铜业",
    ],
    sectors: ["有色金属", "稀土", "稀有金属"],
    rules: ["异常放量突破60日线", "板块逆势走强"],
    riskNote: "资源线波动受宏观影响大，优先看突破后的承接。",
    notify: true,
  },
  {
    id: "brokerage-sentiment",
    name: "券商/金融情绪",
    priority: 6,
    mode: "sentiment",
    description: "只作为指数和短线情绪温度计，不作为普通题材追涨。",
    keywords: [
      "证券",
      "中信建投",
      "东方证券",
      "华泰证券",
      "国泰君安",
      "招商证券",
      "广发证券",
      "中国银河",
    ],
    sectors: ["证券", "金融"],
    rules: ["指数情绪确认", "放量但不追高"],
    riskNote: "金融异动优先理解为市场环境变化，默认不提示追涨建仓。",
    notify: false,
  },
];

function matchTask(candidate: BuildCandidate, task: StrategyWatchTask): string[] {
  const matched: string[] = [];
  for (const keyword of task.keywords) {
    if (candidate.name.includes(keyword)) matched.push(keyword);
  }
  if (task.sectors.includes(candidate.sectorName)) matched.push(candidate.sectorName);
  return [...new Set(matched)];
}

function buildAction(task: StrategyWatchTask, candidate: BuildCandidate): string {
  if (task.mode === "sentiment") return "情绪观察";
  if (candidate.tier === "优先") return "优先盯盘";
  if (candidate.tier === "可试") return "小仓试探观察";
  return "观察等确认";
}

export function buildStrategyWatchResults(
  candidates: BuildCandidate[],
  tasks = DEFAULT_STRATEGY_WATCH_TASKS,
): StrategyWatchResult[] {
  return tasks
    .map((task) => {
      const hits = candidates
        .map((candidate) => {
          const matched = matchTask(candidate, task);
          if (!matched.length) return null;
          return {
            taskId: task.id,
            taskName: task.name,
            mode: task.mode,
            action: buildAction(task, candidate),
            matched,
            candidate,
          };
        })
        .filter((hit): hit is StrategyWatchResult["hits"][number] => hit !== null)
        .sort((a, b) => b.candidate.score - a.candidate.score)
        .slice(0, 5);

      return { task, hits };
    })
    .sort((a, b) => a.task.priority - b.task.priority);
}

export function summarizeStrategyWatch(results: StrategyWatchResult[]): string {
  const active = results.filter((result) => result.hits.length > 0);
  if (!active.length) return "当前推荐方向暂无模式内候选";
  return active
    .slice(0, 3)
    .map((result) => {
      const top = result.hits[0];
      return top ? `${result.task.name}:${top.candidate.name}` : result.task.name;
    })
    .join("；");
}
