// 持仓管理：录入、修改、删除
import * as vscode from "vscode";
import { config } from "../config";
import { getStockList } from "../services/stockService";
import { sendMsg } from "../utils/msg";
import { calculateClosedPositionMetrics } from "../utils/position";
import type { ClosedPosition, Position } from "../types";

async function inputNumber(
  prompt: string,
  placeHolder: string,
  allowZero: boolean,
): Promise<number | null> {
  for (;;) {
    const input = await vscode.window.showInputBox({
      prompt,
      placeHolder,
      validateInput: (value) => {
        const n = Number(value);
        if (!value || value.trim().length === 0) return "请输入数字";
        if (!Number.isFinite(n)) return "请输入有效数字";
        if (allowZero ? n < 0 : n <= 0) {
          return allowZero ? "请输入大于等于 0 的数字" : "请输入大于 0 的数字";
        }
        return null;
      },
    });
    if (!input) return null;
    const value = Number(input);
    if (Number.isFinite(value)) return value;
  }
}

async function upsertPosition(): Promise<void> {
  const stocks = config.getStocks();
  if (!stocks.length) {
    sendMsg("请先添加股票，再录入持仓", { type: "warning" });
    return;
  }

  const stockInfos = await getStockList(stocks);
  const options = stocks.map((code) => {
    const info = stockInfos.find((s) => s.code === code);
    return {
      label: info ? `${info.name}(${info.code})` : code,
      description: "选择后录入或修改持仓",
      code,
    };
  });

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: "选择要录入持仓的股票",
  });
  if (!selected) return;

  const shares = await inputNumber("请输入持仓数量", "例如: 1000", false);
  if (shares === null) return;

  const costPrice = await inputNumber("请输入持仓成本价", "例如: 25.30", true);
  if (costPrice === null) return;

  const positions = config.getPositions();
  const next: Position = {
    stockCode: selected.code,
    shares,
    costPrice,
  };
  const index = positions.findIndex((p) => p.stockCode === selected.code);
  if (index >= 0) {
    positions[index] = next;
  } else {
    positions.push(next);
  }
  await config.savePositions(positions);
  await config.promoteStock(selected.code);
  sendMsg(`已保存持仓: ${selected.label}`);
}

async function deletePosition(): Promise<void> {
  const positions = config.getPositions();
  if (!positions.length) {
    sendMsg("当前没有录入任何持仓", { type: "warning" });
    return;
  }

  const stockInfos = await getStockList(positions.map((p) => p.stockCode));
  const options = positions.map((position) => {
    const info = stockInfos.find((s) => s.code === position.stockCode);
    return {
      label: info
        ? `${info.name}(${info.code})`
        : position.stockCode,
      description: `${position.shares} 股，成本 ${position.costPrice}`,
      stockCode: position.stockCode,
    };
  });

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: "选择要删除的持仓",
  });
  if (!selected) return;

  await config.savePositions(
    positions.filter((p) => p.stockCode !== selected.stockCode),
  );
  sendMsg(`已删除持仓: ${selected.label}`);
}

async function closePosition(): Promise<void> {
  const positions = config.getPositions();
  if (!positions.length) {
    sendMsg("当前没有录入任何持仓", { type: "warning" });
    return;
  }

  const stockInfos = await getStockList(positions.map((p) => p.stockCode));
  const options = positions.map((position) => {
    const info = stockInfos.find((s) => s.code === position.stockCode);
    return {
      label: info ? `${info.name}(${info.code})` : position.stockCode,
      description: `${position.shares} 股，成本 ${position.costPrice}`,
      stockCode: position.stockCode,
      name: info?.name || position.stockCode,
    };
  });

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: "选择要清除并归档的持仓",
  });
  if (!selected) return;

  const position = positions.find((p) => p.stockCode === selected.stockCode);
  if (!position) return;

  const sellPrice = await inputNumber("请输入卖出价/清除价", "例如: 90.12", true);
  if (sellPrice === null) return;

  const metrics = calculateClosedPositionMetrics({
    shares: position.shares,
    costPrice: position.costPrice,
    sellPrice,
  });
  const closedPosition: ClosedPosition = {
    id: `${position.stockCode}_${Date.now()}`,
    stockCode: position.stockCode,
    name: selected.name,
    shares: position.shares,
    costPrice: position.costPrice,
    sellPrice,
    closedAt: new Date().toISOString(),
    ...metrics,
  };

  await config.saveClosedPositions([
    closedPosition,
    ...config.getClosedPositions(),
  ]);
  await config.savePositions(
    positions.filter((p) => p.stockCode !== selected.stockCode),
  );
  sendMsg(`已清除持仓并归档: ${selected.label}`);
}

export async function managePositions(): Promise<void> {
  const positions = config.getPositions();
  const options = [
    {
      label: "$(edit) 新增/修改持仓",
      description: "选择自选股票后录入数量和成本价",
      action: "upsert",
    },
  ];

  if (positions.length) {
    options.push(
      {
        label: "$(archive) 清除持仓",
        description: "输入卖出价，归档到已清除列表",
        action: "close",
      },
      {
        label: "$(trash) 删除持仓",
        description: "仅删除录入错误，不进入历史",
        action: "delete",
      },
    );
  }

  const selected = await vscode.window.showQuickPick(options, {
    placeHolder: "选择持仓操作",
  });
  if (!selected) return;

  if (selected.action === "upsert") {
    await upsertPosition();
  } else if (selected.action === "close") {
    await closePosition();
  } else if (selected.action === "delete") {
    await deletePosition();
  }
}

export async function removePositionsByStock(stockCode: string): Promise<void> {
  const positions = config
    .getPositions()
    .filter((p) => p.stockCode !== stockCode.toLowerCase());
  await config.savePositions(positions);
}

export async function clearAllPositions(): Promise<void> {
  await config.savePositions([]);
}
