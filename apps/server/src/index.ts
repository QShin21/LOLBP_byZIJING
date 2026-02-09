import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';
import {
  DraftState,
  INITIAL_STATE,
  applyAction,
  validateMove,
  replay,
  SPECIAL_ID_RANDOM
} from './game';
import { getRoomState, saveRoomState, saveActionAndUpdateState, getRoomActions, getRoomChat, appendRoomChatMessage, removeLastAction, ChatMessage } from './db';

const PORT = 8080;

interface Room {
  id: string;
  state: DraftState;
  clients: Set<WebSocket>;
  roleSessions: Map<'REFEREE' | 'TEAM_A' | 'TEAM_B', WebSocket>;
  lastActivity: number;
  chat: ChatMessage[];
}

const appendAndBroadcastChatMessage = (room: Room, roomId: string, message: ChatMessage) => {
  room.chat.push(message);
  if (room.chat.length > 200) room.chat = room.chat.slice(-200);

  try {
    appendRoomChatMessage(roomId, message, 200);
  } catch {}

  const out = JSON.stringify({ type: 'CHAT_MESSAGE', payload: message, timestamp: Date.now() });
  room.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(out);
  });
};

const rooms = new Map<string, Room>();

const getOrCreateRoom = (roomId: string, initialConfig?: any): Room => {
  let room = rooms.get(roomId);

  if (!room) {
    const persistedState = getRoomState(roomId);

    if (persistedState) {
      console.log(`Restored room from Disk: ${roomId}`);
      const safeState: DraftState = {
        ...INITIAL_STATE,
        ...persistedState,
        teamA: persistedState.teamA || { name: 'Team A', wins: 0 },
        teamB: persistedState.teamB || { name: 'Team B', wins: 0 },
        sides: persistedState.sides || { TEAM_A: null, TEAM_B: null },
        seriesHistory: Array.isArray(persistedState.seriesHistory) ? persistedState.seriesHistory : [],
        timeLimit: persistedState.timeLimit !== undefined ? persistedState.timeLimit : 30,
        separateSideAndBpOrder: persistedState.separateSideAndBpOrder !== undefined ? persistedState.separateSideAndBpOrder : false,
        bpFirstTeam: persistedState.bpFirstTeam !== undefined ? persistedState.bpFirstTeam : null,
        matchTitle: persistedState.matchTitle || '',
        seriesMode: persistedState.seriesMode || 'BO1',
        draftMode: persistedState.draftMode || 'STANDARD',
        status: persistedState.status || 'NOT_STARTED',
        phase: persistedState.phase || 'DRAFT',
        blueBans: persistedState.blueBans || [],
        redBans: persistedState.redBans || [],
        bluePicks: persistedState.bluePicks || [],
        redPicks: persistedState.redPicks || [],
        history: persistedState.history || []
      };

      if (safeState.status === 'NOT_STARTED') {
        safeState.draftStepIndex = 0;
        safeState.stepIndex = 0;
        safeState.blueBans = [];
        safeState.redBans = [];
        safeState.bluePicks = [];
        safeState.redPicks = [];
        safeState.stepEndsAt = 0;
      }
      if (!safeState.sides) safeState.sides = { TEAM_A: null, TEAM_B: null };
      if (safeState.sides.TEAM_A === undefined) safeState.sides.TEAM_A = null;
      if (safeState.sides.TEAM_B === undefined) safeState.sides.TEAM_B = null;

      room = {
        id: roomId,
        state: safeState,
        clients: new Set(),
        roleSessions: new Map(),
        lastActivity: Date.now(),
        chat: getRoomChat(roomId)
      };
      saveRoomState(roomId, safeState);
    } else {
      console.log(`Creating new room: ${roomId}`);
      const initialState: DraftState = {
        ...INITIAL_STATE,
        status: 'NOT_STARTED',
        blueReady: false,
        redReady: false,
        paused: false,
        stepEndsAt: 0,
        lastActionSeq: 0,
        matchTitle: initialConfig?.matchTitle || 'Exhibition Match',
        seriesMode: initialConfig?.seriesMode || 'BO1',
        draftMode: initialConfig?.draftMode || 'STANDARD',
        timeLimit: initialConfig?.timeLimit !== undefined ? initialConfig.timeLimit : 30,
        separateSideAndBpOrder: initialConfig?.separateSideAndBpOrder !== undefined ? initialConfig.separateSideAndBpOrder : false,
        bpFirstTeam: null,
        teamA: { name: initialConfig?.teamA || 'Team A', wins: 0 },
        teamB: { name: initialConfig?.teamB || 'Team B', wins: 0 },
        sides: { TEAM_A: null, TEAM_B: null },
      };
      room = {
        id: roomId,
        state: initialState,
        clients: new Set(),
        roleSessions: new Map(),
        lastActivity: Date.now(),
        chat: []
      };
      saveRoomState(roomId, initialState);
    }
    rooms.set(roomId, room);
  }
  return room;
};

const broadcastToRoom = (room: Room) => {
  // ✅ 修复：附带服务器当前时间戳，用于客户端校准
  const message = JSON.stringify({
    type: 'STATE_SYNC',
    payload: room.state,
    timestamp: Date.now()
  });

  room.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
};

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = parse(req.url || '', true);

  if (req.method === 'POST' && url.pathname === '/rooms') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const config = JSON.parse(body || '{}');
        const roomId = Math.random().toString(36).substring(2, 8);
        getOrCreateRoom(roomId, config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ roomId }));
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid JSON');
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname?.match(/^\/rooms\/[a-zA-Z0-9]+\/actions$/)) {
    const roomId = url.pathname.split('/')[2];
    const afterSeq = parseInt(url.query.afterSeq as string || '0', 10);
    const missingActions = getRoomActions(roomId, afterSeq);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ actions: missingActions }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(parse(req.url || '').query || '');
  const roomId = urlParams.get('room') || 'default';
  const room = getOrCreateRoom(roomId);
  let claimedRole: 'REFEREE' | 'TEAM_A' | 'TEAM_B' | null = null;

  room.clients.add(ws);

  // ✅ 修复：连接时也发送带时间戳的同步包
  ws.send(JSON.stringify({
    type: 'STATE_SYNC',
    payload: room.state,
    timestamp: Date.now()
  }));

  // Chat history sync
  ws.send(JSON.stringify({
    type: 'CHAT_SYNC',
    payload: { messages: room.chat },
    timestamp: Date.now()
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      room.lastActivity = Date.now();

      // keepalive
      if (data.type === 'PING') {
        try {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        } catch {}
        return;
      }

      if (data.type === 'ROLE_CLAIM') {
        const role = (data.payload?.actorRole || '').toString();
        const allowed = role === 'REFEREE' || role === 'TEAM_A' || role === 'TEAM_B';
        if (!allowed) return;

        const typedRole = role as 'REFEREE' | 'TEAM_A' | 'TEAM_B';
        const existingClient = room.roleSessions.get(typedRole);

        if (existingClient && existingClient !== ws && existingClient.readyState === WebSocket.OPEN) {
          existingClient.send(JSON.stringify({
            type: 'FORCED_LOGOUT',
            payload: { reason: `该身份已在其他设备登录：${typedRole}` },
            timestamp: Date.now()
          }));
          existingClient.close(4001, 'Logged in on another device');
        }

        room.roleSessions.set(typedRole, ws);
        claimedRole = typedRole;

        const joinRecord: ChatMessage = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ts: Date.now(),
          role: 'SYSTEM',
          text: `${typedRole} 进入了房间`
        };
        appendAndBroadcastChatMessage(room, roomId, joinRecord);
        return;
      }

      // Chat relay (裁判 / TEAM_A / TEAM_B)
      if (data.type === 'CHAT_SEND') {
        const text = (data.payload?.text || '').toString().trim();
        const role = (data.payload?.actorRole || '').toString();

        const allowed = role === 'REFEREE' || role === 'TEAM_A' || role === 'TEAM_B';
        if (!allowed) return;
        if (!text) return;
        if (text.length > 300) {
          ws.send(JSON.stringify({ type: 'CHAT_REJECTED', payload: { reason: 'Message too long (max 300 chars)' } }));
          return;
        }

        const chatMsg: ChatMessage = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          ts: Date.now(),
          role,
          text
        };

        appendAndBroadcastChatMessage(room, roomId, chatMsg);

        return;
      }

      if (data.type === 'ACTION_SUBMIT' || data.type === 'TOGGLE_READY') {
        const payload = data.type === 'TOGGLE_READY'
          ? { ...data.payload, type: 'TOGGLE_READY' }
          : data.payload;

        const error = validateMove(room.state, payload);
        if (error) {
          ws.send(JSON.stringify({ type: 'ACTION_REJECTED', payload: { reason: error } }));
          return;
        }

        const now = Date.now();
        const newState = applyAction(room.state, payload, now);

        const newAction = newState.history[newState.history.length - 1];
        if (newAction) saveActionAndUpdateState(roomId, newAction, newState);
        else saveRoomState(roomId, newState);

        room.state = newState;
        broadcastToRoom(room);
      }

      if (data.type === 'ACTION_UNDO') {
        if (room.state.history.length > 0) {
          removeLastAction(roomId);
          const newHistory = room.state.history.slice(0, -1);
          const newState = replay(newHistory, Date.now(), room.state);
          saveRoomState(roomId, newState);
          room.state = newState;
          broadcastToRoom(room);
        }
      }

      if (data.type === 'ACTION_RESET') {
        const newState = applyAction(room.state, { type: 'RESET_GAME', actorRole: 'REFEREE' }, Date.now());
        saveRoomState(roomId, newState);
        room.state = newState;
        broadcastToRoom(room);
      }

    } catch (e) {
      console.error('Error processing message', e);
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    if (claimedRole && room.roleSessions.get(claimedRole) === ws) {
      room.roleSessions.delete(claimedRole);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    if (room.state.paused) return;
    if (room.state.status !== 'RUNNING') return;

    // 只有当 stepEndsAt > 0 时才检查超时 (0 代表无上限)
    if (room.state.stepEndsAt > 0 && now > room.state.stepEndsAt) {
      console.log(`[Room ${room.id}] Timeout triggered. Auto-picking...`);

      let newState = room.state;
      if (room.state.phase === 'DRAFT') {
        newState = applyAction(room.state, { heroId: SPECIAL_ID_RANDOM, actorRole: 'REFEREE' }, now);
      } else if (room.state.phase === 'SWAP') {
        newState = applyAction(room.state, { type: 'FINISH_SWAP', actorRole: 'REFEREE' }, now);
      }

      if (newState !== room.state) {
        const newAction = newState.history[newState.history.length - 1];
        if (newAction) saveActionAndUpdateState(room.id, newAction, newState);
        room.state = newState;
        broadcastToRoom(room);
      }
    }
  });
}, 500);

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
