import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'url';
import { 
  DraftState, 
  INITIAL_STATE, 
  applyAction, 
  validateMove,
  replay, 
  SPECIAL_ID_RANDOM, 
  STEP_DURATION_MS 
} from './game';
import { getRoomState, saveRoomState, saveActionAndUpdateState, getRoomActions } from './db';

const PORT = 8080;

interface Room {
  id: string;
  state: DraftState;
  clients: Set<WebSocket>;
  lastActivity: number;
}

const rooms = new Map<string, Room>();

const getOrCreateRoom = (roomId: string, initialConfig?: any): Room => {
  let room = rooms.get(roomId);
  
  if (!room) {
    const persistedState = getRoomState(roomId);
    
    if (persistedState) {
      console.log(`Restored room from Disk: ${roomId}`);
      
      // FIX: 深度防御性合并。防止旧数据缺少字段导致前端白屏。
      const safeState: DraftState = {
        ...INITIAL_STATE, 
        ...persistedState,
        
        teamA: persistedState.teamA || { name: 'Team A', wins: 0 },
        teamB: persistedState.teamB || { name: 'Team B', wins: 0 },
        sides: persistedState.sides || { TEAM_A: null, TEAM_B: null },
        seriesHistory: Array.isArray(persistedState.seriesHistory) ? persistedState.seriesHistory : [],
        
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

      // -----------------------------------------------------------
      // FIX: 关键修复 - 状态清洗 (State Sanitization)
      // 如果状态是 NOT_STARTED，强制重置 BP 进度，防止脏数据导致 Step 溢出
      // -----------------------------------------------------------
      if (safeState.status === 'NOT_STARTED') {
        safeState.draftStepIndex = 0;
        safeState.stepIndex = 0; // 重置动作步数
        safeState.blueBans = [];
        safeState.redBans = [];
        safeState.bluePicks = [];
        safeState.redPicks = [];
        safeState.stepEndsAt = 0;
        // 注意：不要重置 sides，因为选边可能在 NOT_STARTED 阶段已完成
      }

      // 确保 sides 对象结构完整
      if (!safeState.sides) safeState.sides = { TEAM_A: null, TEAM_B: null };
      if (safeState.sides.TEAM_A === undefined) safeState.sides.TEAM_A = null;
      if (safeState.sides.TEAM_B === undefined) safeState.sides.TEAM_B = null;

      room = {
        id: roomId,
        state: safeState,
        clients: new Set(),
        lastActivity: Date.now()
      };
      
      // 将清洗后的干净状态写回磁盘
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
        teamA: { name: initialConfig?.teamA || 'Team A', wins: 0 },
        teamB: { name: initialConfig?.teamB || 'Team B', wins: 0 },
        sides: { TEAM_A: null, TEAM_B: null },
      };
      
      room = {
        id: roomId,
        state: initialState,
        clients: new Set(),
        lastActivity: Date.now()
      };
      saveRoomState(roomId, initialState);
    }
    rooms.set(roomId, room);
  }
  return room;
};

const broadcastToRoom = (room: Room) => {
  const message = JSON.stringify({
    type: 'STATE_SYNC',
    payload: room.state
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

  // API: Create new room
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

  // API: Get missing actions
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
  
  room.clients.add(ws);
  
  ws.send(JSON.stringify({ type: 'STATE_SYNC', payload: room.state }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      room.lastActivity = Date.now();
      
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
           const newHistory = room.state.history.slice(0, -1);
           const newState = replay(newHistory, Date.now());
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
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    if (room.state.paused) return;
    if (room.state.status !== 'RUNNING') return; 
    
    if (now > room.state.stepEndsAt && room.state.stepEndsAt > 0) {
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