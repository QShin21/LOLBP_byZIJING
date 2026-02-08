import * as fs from 'fs';
import * as path from 'path';
import { DraftState, DraftAction } from './game';

// 数据存储目录
const DATA_DIR = path.join(__dirname, '..', 'data');
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
const ACTIONS_DIR = path.join(DATA_DIR, 'actions');
const CHATS_DIR = path.join(DATA_DIR, 'chats');

// 确保目录存在
if (!fs.existsSync(ROOMS_DIR)) fs.mkdirSync(ROOMS_DIR, { recursive: true });
if (!fs.existsSync(ACTIONS_DIR)) fs.mkdirSync(ACTIONS_DIR, { recursive: true });
if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });

export interface ChatMessage {
  id: string;
  ts: number; // ms
  role: string; // REFEREE / TEAM_A / TEAM_B / ...
  text: string;
}

// 从 JSON 文件恢复房间状态
export const getRoomState = (roomId: string): DraftState | null => {
  const filePath = path.join(ROOMS_DIR, `${roomId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as DraftState;
  } catch (e) {
    console.error(`Failed to read state for room ${roomId}`, e);
    return null;
  }
};

// 保存房间状态到 JSON
export const saveRoomState = (roomId: string, state: DraftState) => {
  const filePath = path.join(ROOMS_DIR, `${roomId}.json`);
  // 使用同步写入确保数据一致性，对于 Demo 级并发完全足够
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
};

// 保存 Action 并更新 State (模拟事务)
export const saveActionAndUpdateState = (roomId: string, action: DraftAction, newState: DraftState) => {
  // 1. 追加/保存 Action
  const actionFile = path.join(ACTIONS_DIR, `${roomId}.json`);
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

// 获取历史 Actions
export const getRoomActions = (roomId: string, afterSeq: number = 0): DraftAction[] => {
  const actionFile = path.join(ACTIONS_DIR, `${roomId}.json`);
  if (!fs.existsSync(actionFile)) return [];
  try {
    const actions: DraftAction[] = JSON.parse(fs.readFileSync(actionFile, 'utf-8'));
    return actions.filter((a) => a.seq > afterSeq);
  } catch (e) {
    return [];
  }
};

// =====================
// Chat persistence
// =====================

export const getRoomChat = (roomId: string): ChatMessage[] => {
  const chatFile = path.join(CHATS_DIR, `${roomId}.json`);
  if (!fs.existsSync(chatFile)) return [];
  try {
    const raw = fs.readFileSync(chatFile, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as ChatMessage[]).filter((m) => m && typeof m.id === 'string') : [];
  } catch (e) {
    return [];
  }
};

export const saveRoomChat = (roomId: string, messages: ChatMessage[]) => {
  const chatFile = path.join(CHATS_DIR, `${roomId}.json`);
  fs.writeFileSync(chatFile, JSON.stringify(messages, null, 2));
};

export const appendRoomChatMessage = (roomId: string, message: ChatMessage, maxMessages: number = 200) => {
  const messages = getRoomChat(roomId);
  messages.push(message);
  const trimmed = messages.slice(-maxMessages);
  saveRoomChat(roomId, trimmed);
  return trimmed;
};
