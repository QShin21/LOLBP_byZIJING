import * as fs from 'fs';
import * as path from 'path';
import { DraftState, DraftAction } from './game';

// 数据存储目录
const DATA_DIR = path.join(__dirname, '..', 'data');
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
const ACTIONS_DIR = path.join(DATA_DIR, 'actions');
const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

// 确保目录存在
if (!fs.existsSync(ROOMS_DIR)) fs.mkdirSync(ROOMS_DIR, { recursive: true });
if (!fs.existsSync(ACTIONS_DIR)) fs.mkdirSync(ACTIONS_DIR, { recursive: true });

const safeRoomId = (roomId: string): string => {
  const normalized = roomId.trim();
  if (!ROOM_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid room id: ${roomId}`);
  }
  return normalized;
};

const roomStatePath = (roomId: string) => path.join(ROOMS_DIR, `${safeRoomId(roomId)}.json`);
const roomActionsPath = (roomId: string) => path.join(ACTIONS_DIR, `${safeRoomId(roomId)}.json`);

// 从 JSON 文件恢复房间状态
export const getRoomState = (roomId: string): DraftState | null => {
  try {
    const filePath = roomStatePath(roomId);
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as DraftState;
  } catch (e) {
    console.error(`Failed to read state for room ${roomId}`, e);
    return null;
  }
};

// 保存房间状态到 JSON
export const saveRoomState = (roomId: string, state: DraftState) => {
  const filePath = roomStatePath(roomId);
  // 使用同步写入确保数据一致性，对于 Demo 级并发完全足够
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
};

// 保存 Action 并更新 State (模拟事务)
export const saveActionAndUpdateState = (roomId: string, action: DraftAction, newState: DraftState) => {
  // 1. 追加/保存 Action
  const actionFile = roomActionsPath(roomId);
  let actions: DraftAction[] = [];

  if (fs.existsSync(actionFile)) {
    try {
      actions = JSON.parse(fs.readFileSync(actionFile, 'utf-8'));
    } catch (e) {
      console.error('Error reading actions file', e);
    }
  }

  actions.push(action);
  fs.writeFileSync(actionFile, JSON.stringify(actions, null, 2));

  // 2. 更新最新的 Room State
  saveRoomState(roomId, newState);
};

export const replaceRoomActionsAndState = (roomId: string, actions: DraftAction[], newState: DraftState) => {
  fs.writeFileSync(roomActionsPath(roomId), JSON.stringify(actions, null, 2));
  saveRoomState(roomId, newState);
};

// 获取历史 Actions
export const getRoomActions = (roomId: string, afterSeq: number = 0): DraftAction[] => {
  try {
    const actionFile = roomActionsPath(roomId);
    if (!fs.existsSync(actionFile)) return [];
    const actions: DraftAction[] = JSON.parse(fs.readFileSync(actionFile, 'utf-8'));
    return actions.filter(a => a.seq > afterSeq);
  } catch (e) {
    return [];
  }
};
