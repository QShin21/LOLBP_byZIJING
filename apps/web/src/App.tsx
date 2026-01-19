import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Shield,
  Sword,
  RotateCcw,
  CheckCircle2,
  Ban,
  HelpCircle,
  XCircle,
  Check,
  Eye,
  UserCog,
  Play,
  Pause,
  PlayCircle,
  LogOut,
  Skull,
  Wifi,
  WifiOff,
  Search,
} from 'lucide-react';

// ✅ 从 data/heroes.ts 导入（该文件由脚本生成，包含 nameCn / titleCn）
import { RAW_HEROES as RAW_HEROES_DATA, Hero as DataHero } from './data/heroes';
import { pinyin, match } from 'pinyin-pro';
// ==========================================
// MODULE: Types & Constants
// ==========================================

type Side = 'BLUE' | 'RED';
type ActionType =
  | 'BAN'
  | 'PICK'
  | 'SWAP'
  | 'FINISH_SWAP'
  | 'START_GAME'
  | 'RESET_GAME'
  | 'TOGGLE_READY'
  | 'PAUSE_GAME'
  | 'RESUME_GAME'
  | 'SET_SIDES'
  | 'REPORT_RESULT';

type Role = 'TOP' | 'JG' | 'MID' | 'BOT' | 'SUP' | 'SPECIAL';
type DraftPhase = 'DRAFT' | 'SWAP' | 'FINISHED';
type DraftStatus = 'NOT_STARTED' | 'RUNNING' | 'FINISHED';
type SeriesMode = 'BO1' | 'BO2' | 'BO3' | 'BO5';
type DraftMode = 'STANDARD' | 'FEARLESS';
type TeamId = 'TEAM_A' | 'TEAM_B';
type UserRole = 'REFEREE' | 'SPECTATOR' | TeamId;

const SPECIAL_ID_NONE = 'special_none';
const SPECIAL_ID_RANDOM = 'special_random';

// ✅ App 内使用的 Hero 类型：包含脚本生成的中英文信息，并把 roles 收窄到 Role[]
type Hero = Omit<DataHero, 'roles'> & { roles: Role[] };

interface DraftStep {
  index: number;
  side: Side;
  type: 'BAN' | 'PICK';
  label: string;
}
interface DraftAction {
  seq: number;
  stepIndex: number;
  type: ActionType;
  side?: Side;
  heroId?: string;
  swapData?: { fromIndex: number; toIndex: number };
  actorRole?: string;
}

interface GameResultSnapshot {
  gameIdx: number;
  winner: TeamId;
  blueSideTeam: TeamId;
  redSideTeam: TeamId;
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
}

interface DraftState {
  lastActionSeq: number;
  matchTitle: string;
  seriesMode: SeriesMode;
  draftMode: DraftMode;
  teamA: { name: string; wins: number };
  teamB: { name: string; wins: number };
  currentGameIdx: number;
  sides: { [key in TeamId]: Side | null };
  nextSideSelector: TeamId | 'REFEREE' | null;
  seriesHistory: GameResultSnapshot[];

  status: DraftStatus;
  phase: DraftPhase;
  stepIndex: number;
  draftStepIndex: number;
  blueBans: string[];
  redBans: string[];
  bluePicks: string[];
  redPicks: string[];
  history: DraftAction[];
  stepEndsAt: number;
  blueReady: boolean;
  redReady: boolean;
  paused: boolean;
  pauseReason?: string;
  pausedAt?: number;
}

// ==========================================
// MODULE: Helpers & Data
// ==========================================

// PURE LOCAL MODE
// Images must be located in: apps/web/public/heroes/{id}.png
const LOCAL_IMG_BASE = '/heroes';

const getHeroImageUrl = (hero: Hero | undefined | null) => {
  if (!hero || hero.id.startsWith('special_')) return null;
  return `${LOCAL_IMG_BASE}/${hero.id}.png`;
};

// ✅ 将 data/heroes.ts 的 RAW_HEROES 转为 App 使用的 Hero[]
const RAW_HEROES: Hero[] = (RAW_HEROES_DATA as DataHero[]).map((h) => ({
  ...h,
  roles: h.roles as Role[],
}));

// ✅ 保留特殊项：NO BAN / RANDOM
const HEROES: Hero[] = [
  { id: SPECIAL_ID_NONE, name: 'NO BAN', nameCn: '不禁用', titleCn: '', roles: ['SPECIAL'] },
  { id: SPECIAL_ID_RANDOM, name: 'RANDOM', nameCn: '随机', titleCn: '', roles: ['SPECIAL'] },
  ...RAW_HEROES,
];

const DRAFT_SEQUENCE: Omit<DraftStep, 'index'>[] = [
  { side: 'BLUE', type: 'BAN', label: 'B-BAN 1' },
  { side: 'RED', type: 'BAN', label: 'R-BAN 1' },
  { side: 'BLUE', type: 'BAN', label: 'B-BAN 2' },
  { side: 'RED', type: 'BAN', label: 'R-BAN 2' },
  { side: 'BLUE', type: 'BAN', label: 'B-BAN 3' },
  { side: 'RED', type: 'BAN', label: 'R-BAN 3' },
  { side: 'BLUE', type: 'PICK', label: 'B-PICK 1' },
  { side: 'RED', type: 'PICK', label: 'R-PICK 1' },
  { side: 'RED', type: 'PICK', label: 'R-PICK 2' },
  { side: 'BLUE', type: 'PICK', label: 'B-PICK 2' },
  { side: 'BLUE', type: 'PICK', label: 'B-PICK 3' },
  { side: 'RED', type: 'PICK', label: 'R-PICK 3' },
  { side: 'RED', type: 'BAN', label: 'R-BAN 4' },
  { side: 'BLUE', type: 'BAN', label: 'B-BAN 4' },
  { side: 'RED', type: 'BAN', label: 'R-BAN 5' },
  { side: 'BLUE', type: 'BAN', label: 'B-BAN 5' },
  { side: 'RED', type: 'PICK', label: 'R-PICK 4' },
  { side: 'BLUE', type: 'PICK', label: 'B-PICK 4' },
  { side: 'BLUE', type: 'PICK', label: 'B-PICK 5' },
  { side: 'RED', type: 'PICK', label: 'R-PICK 5' },
];

const getCurrentStep = (state: DraftState): DraftStep | null => {
  if (state.draftStepIndex >= DRAFT_SEQUENCE.length) return null;
  return { ...DRAFT_SEQUENCE[state.draftStepIndex], index: state.draftStepIndex };
};

const getHero = (id: string | null) => HEROES.find((h) => h.id === id);

// ✅ 显示：优先称号 titleCn
const getHeroDisplayName = (h: Hero | null | undefined) => {
  if (!h) return '';
  return h.titleCn || h.nameCn || h.name;
};

// ✅ 搜索支持：英文名 / 中文名 / 中文称号
// --- fuzzy search helpers ---
const _norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·'’"“”、,，.。!！?？:：;；()（）\[\]{}<>《》\-_/\\|&]/g, '');

const _hasHan = (s: string) => /[\u4e00-\u9fff]/.test(s);

// Levenshtein distance
const _lev = (a: string, b: string) => {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; // dp[i-1][j-1]
    dp[0] = i;        // dp[i][0]
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,      // deletion
        dp[j - 1] + 1,  // insertion
        prev + cost     // substitution
      );
      prev = tmp;
    }
  }
  return dp[n];
};

// fuzzy substring: allow small typos (edit distance) against any substring
const _fuzzySubstr = (hayRaw: string, needleRaw: string, maxDist: number) => {
  const hay = _norm(hayRaw);
  const needle = _norm(needleRaw);
  if (!needle) return true;
  if (hay.includes(needle)) return true;

  const n = needle.length;
  if (!n) return true;

  // try windows with len n-1, n, n+1 (tolerate missing/extra char)
  const lens = [Math.max(1, n - 1), n, n + 1];

  for (const L of lens) {
    if (hay.length < L) continue;
    for (let i = 0; i <= hay.length - L; i++) {
      const sub = hay.slice(i, i + L);
      if (_lev(needle, sub) <= maxDist) return true;
    }
  }
  return false;
};

// threshold by query length
const _distLimit = (q: string) => {
  const len = _norm(q).length;
  if (len <= 3) return 1;
  if (len <= 6) return 2;
  return 3;
};

// cache computed fields per hero id (avoid recalculating pinyin all the time)
const _SEARCH_CACHE = new Map<string, { cn: string; en: string; py: string; ini: string }>();
const _getSearchMeta = (h: Hero) => {
  const cached = _SEARCH_CACHE.get(h.id);
  if (cached) return cached;

  const cnRaw = `${h.titleCn || ''}${h.nameCn || ''}`;
  const enRaw = `${h.id} ${h.name || ''} ${h.nameCn || ''} ${h.titleCn || ''}`;

  const pyRaw = pinyin(cnRaw, { toneType: 'none' }); // e.g. "an yi jian mo"
  const iniRaw = pinyin(cnRaw, { pattern: 'initial', toneType: 'none' }); // e.g. "a y j m" :contentReference[oaicite:2]{index=2}

  const meta = {
    cn: _norm(cnRaw),
    en: _norm(enRaw),
    py: _norm(pyRaw),
    ini: _norm(iniRaw),
  };
  _SEARCH_CACHE.set(h.id, meta);
  return meta;
};

// ✅ Enhanced: 中文/拼音/首字母 + 容错模糊
const matchesSearch = (h: Hero, term: string) => {
  const raw = (term || '').trim();
  if (!raw) return true;

  const q = _norm(raw);
  if (!q) return true;

  const { cn, en, py, ini } = _getSearchMeta(h);
  const limit = _distLimit(q);

// 1) 直接中文输入：支持“称号/中文名”的模糊 + 同音(拼音)匹配
  if (_hasHan(raw)) {
    const qCn = _norm(raw);
    if (!qCn) return true;

    // ✅ 1) 中文只做“包含”，不做编辑距离（大幅减少误匹配）
    if (cn.includes(qCn)) return true;

    // ✅ 2) 同音：中文 -> 拼音，但启用条件更严格
    // - 至少 2 个汉字
    const hanCount = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
    if (hanCount < 2) return false;

    const qpy = _norm(pinyin(raw, { toneType: 'none' })); // 朗姆 -> langmu
    if (!qpy || qpy.length < 4) return false;

    // 只做包含/前缀（不做拼音编辑距离）
    if (py.includes(qpy) || py.startsWith(qpy)) return true;

    // ✅ 3) 首字母：仅对 2~4 个汉字启用，并且只做 startsWith
    if (hanCount <= 4) {
      const qini = _norm(pinyin(raw, { pattern: 'initial', toneType: 'none' })); // 朗姆 -> lm
      if (qini && qini.length >= 2 && ini.startsWith(qini)) return true;
    }
    return false;
  }



  // 2) 英文/拼音输入：
  // 2.1 英文 alias / id / 英文名
  if (en.includes(q)) return true;
  if (_fuzzySubstr(en, q, Math.min(2, limit))) return true;

  // 2.2 拼音全拼/首字母（含容错）
  if (py.includes(q) || ini.includes(q)) return true;

  // pinyin-pro 自带匹配：支持 "zwp" / "zhongwp" / "zhongwenpin" 这种混合规则 :contentReference[oaicite:3]{index=3}
  const cnText = (h.titleCn || h.nameCn || '');
  try {
    const hit = match(cnText, q);
    if (hit && hit.length) return true;
  } catch {}

  // 容错：对拼音串做 fuzzy substring（打错 1~2 个字母、漏字也能搜到）
  if (_fuzzySubstr(py, q, limit)) return true;

  // 首字母一般很短，容错给 1 就够（避免误匹配太多）
  if (_fuzzySubstr(ini, q, 1)) return true;

  return false;
};


// ==========================================
// UI COMPONENTS
// ==========================================

const Lobby = ({ onCreate, onJoin }: { onCreate: (config: any) => void; onJoin: (id: string) => void }) => {
  const [activeTab, setActiveTab] = useState<'CREATE' | 'JOIN'>('CREATE');
  const [config, setConfig] = useState({ matchTitle: '', teamA: 'T1', teamB: 'GEN', seriesMode: 'BO3', draftMode: 'STANDARD' });
  const [joinId, setJoinId] = useState('');

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_30%_30%,rgba(234,179,8,0.15),transparent_55%),radial-gradient(circle_at_70%_60%,rgba(59,130,246,0.12),transparent_55%),radial-gradient(circle_at_40%_80%,rgba(239,68,68,0.10),transparent_55%)]" />
      <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('https://lol.qq.com/act/a20220120lpl/img/bg.jpg')] bg-cover bg-center" />

      <div className="max-w-xl w-full bg-slate-900/75 backdrop-blur-2xl border border-slate-700/70 rounded-3xl p-8 shadow-2xl z-10">
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-yellow-500/25 to-slate-800/30 border border-slate-700/60 flex items-center justify-center shadow-lg">
            <Sword size={32} className="text-yellow-400" />
          </div>
          <h1 className="mt-5 text-4xl font-black text-white italic tracking-tight">BP SIMULATOR</h1>
          <p className="text-slate-400 mt-1">Tournament Edition</p>
        </div>

        <div className="flex gap-2 mb-6 bg-slate-800/70 p-1 rounded-xl border border-slate-700/60">
          <button
            onClick={() => setActiveTab('CREATE')}
            className={`flex-1 py-2.5 rounded-lg font-bold transition-all ${
              activeTab === 'CREATE'
                ? 'bg-slate-700 text-white shadow-md shadow-black/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            Create Room
          </button>
          <button
            onClick={() => setActiveTab('JOIN')}
            className={`flex-1 py-2.5 rounded-lg font-bold transition-all ${
              activeTab === 'JOIN'
                ? 'bg-slate-700 text-white shadow-md shadow-black/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            Join Room
          </button>
        </div>

        {activeTab === 'CREATE' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Match Title (Optional)</label>
              <input
                type="text"
                className="w-full bg-slate-950/80 border border-slate-700/70 rounded-xl p-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500/30"
                placeholder="e.g. Worlds Finals 2025"
                value={config.matchTitle}
                onChange={(e) => setConfig({ ...config, matchTitle: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Team A Name</label>
                <input
                  type="text"
                  className="w-full bg-slate-950/80 border border-slate-700/70 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/20 focus:border-yellow-500/30"
                  value={config.teamA}
                  onChange={(e) => setConfig({ ...config, teamA: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Team B Name</label>
                <input
                  type="text"
                  className="w-full bg-slate-950/80 border border-slate-700/70 rounded-xl p-3 text-white focus:outline-none focus:ring-2 focus:ring-yellow-500/20 focus:border-yellow-500/30"
                  value={config.teamB}
                  onChange={(e) => setConfig({ ...config, teamB: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Series Format</label>
              <div className="flex gap-2">
                {['BO1', 'BO2', 'BO3', 'BO5'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setConfig({ ...config, seriesMode: m })}
                    className={`flex-1 py-2.5 rounded-xl border font-bold transition-all ${
                      config.seriesMode === m
                        ? 'bg-yellow-600/90 border-yellow-600 text-white shadow-md shadow-yellow-900/20'
                        : 'bg-slate-950/70 border-slate-700/70 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Draft Mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfig({ ...config, draftMode: 'STANDARD' })}
                  className={`flex-1 py-2.5 rounded-xl border font-bold transition-all ${
                    config.draftMode === 'STANDARD'
                      ? 'bg-blue-600/90 border-blue-600 text-white shadow-md shadow-blue-900/20'
                      : 'bg-slate-950/70 border-slate-700/70 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                  }`}
                >
                  Standard
                </button>
                <button
                  onClick={() => setConfig({ ...config, draftMode: 'FEARLESS' })}
                  className={`flex-1 py-2.5 rounded-xl border font-bold transition-all flex items-center justify-center gap-2 ${
                    config.draftMode === 'FEARLESS'
                      ? 'bg-red-600/90 border-red-600 text-white shadow-md shadow-red-900/20'
                      : 'bg-slate-950/70 border-slate-700/70 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                  }`}
                >
                  <Skull size={16} /> Fearless
                </button>
              </div>
              <div className="text-[11px] text-slate-500 mt-2">
                {config.draftMode === 'STANDARD'
                  ? 'Heroes reset each game.'
                  : 'Global Fearless: Heroes picked in previous games are banned for BOTH teams.'}
              </div>
            </div>

            <button
              onClick={() => onCreate(config)}
              className="w-full bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-white py-3.5 rounded-2xl font-black text-lg mt-4 shadow-xl shadow-yellow-900/15 transition-transform hover:scale-[1.01] active:scale-[0.99]"
            >
              CREATE LOBBY
            </button>

            <div className="pt-2 text-[11px] text-slate-500 text-center">
              Tip: Share the room link to invite spectators.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Enter Room ID"
              className="w-full bg-slate-950/80 border border-slate-700/70 rounded-2xl p-4 text-white text-center font-mono text-xl uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-yellow-500/20 focus:border-yellow-500/30"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button
              disabled={!joinId}
              onClick={() => onJoin(joinId)}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white py-3.5 rounded-2xl font-bold text-lg disabled:opacity-50 transition-all"
            >
              CONNECT
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const RoleSelectionModal = ({ state, onSelect }: { state: DraftState; onSelect: (role: UserRole) => void }) => {
  if (!state || !state.teamA || !state.teamB) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900/85 backdrop-blur-2xl border border-slate-700/70 p-8 rounded-3xl max-w-2xl w-full shadow-2xl">
        <div className="text-center mb-7">
          <h1 className="text-3xl font-black text-white italic tracking-tight mb-2">SELECT YOUR ROLE</h1>
          <p className="text-slate-400 text-sm">{state.matchTitle || 'Standard Match'} • {state.seriesMode}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => onSelect('TEAM_A')}
            className="group h-32 bg-slate-800/70 hover:bg-slate-700/70 border border-slate-600/70 hover:border-white/30 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all hover:scale-[1.01]"
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Shield className="w-7 h-7 text-blue-300" />
            </div>
            <span className="text-xl font-bold text-white">{state.teamA?.name || 'Team A'}</span>
            <span className="text-[10px] text-slate-500 font-bold tracking-widest">TEAM A</span>
          </button>

          <button
            onClick={() => onSelect('TEAM_B')}
            className="group h-32 bg-slate-800/70 hover:bg-slate-700/70 border border-slate-600/70 hover:border-white/30 rounded-2xl flex flex-col items-center justify-center gap-2 transition-all hover:scale-[1.01]"
          >
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <Sword className="w-7 h-7 text-red-300" />
            </div>
            <span className="text-xl font-bold text-white">{state.teamB?.name || 'Team B'}</span>
            <span className="text-[10px] text-slate-500 font-bold tracking-widest">TEAM B</span>
          </button>

          <button
            onClick={() => onSelect('REFEREE')}
            className="h-20 bg-yellow-950/20 hover:bg-yellow-900/25 border border-yellow-700/60 hover:border-yellow-500/70 rounded-2xl flex items-center justify-center gap-2 text-yellow-400 font-black transition-all"
          >
            <UserCog /> REFEREE
          </button>

          <button
            onClick={() => onSelect('SPECTATOR')}
            className="h-20 bg-slate-900/40 hover:bg-slate-800/50 border border-slate-700/70 hover:border-slate-500/70 rounded-2xl flex items-center justify-center gap-2 text-slate-300 font-black transition-all"
          >
            <Eye /> SPECTATOR
          </button>
        </div>
      </div>
    </div>
  );
};

const HeroCard = ({ hero, status, onClick, isHovered, isFearlessBanned }: any) => {
  const isSpecial = hero.id === SPECIAL_ID_NONE || hero.id === SPECIAL_ID_RANDOM;

  const imageUrl = useMemo(() => getHeroImageUrl(hero), [hero]);

  const primary = hero?.titleCn || hero?.nameCn || hero?.name; // ✅ 优先称号
  const secondary = hero?.titleCn ? (hero?.nameCn || hero?.name) : (hero?.name ? `(${hero.name})` : '');

  const clickable = !isFearlessBanned && status === 'AVAILABLE';

  const base ='relative flex flex-col items-center justify-end p-2 rounded-2xl border transition-all select-none aspect-square';

  const glass = 'bg-slate-900/60 backdrop-blur-md';
  const ring = isHovered ? 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-slate-900 shadow-[0_0_0_2px_rgba(250,204,21,0.35),0_0_28px_rgba(250,204,21,0.45)]' : '';
  const disabled = 'opacity-35 grayscale cursor-not-allowed border-slate-800/60 bg-slate-950/40';
  const available = isHovered
    ? 'border-yellow-400/60 shadow-2xl shadow-black/35 scale-[1.04]'
    : 'border-slate-700/60 hover:border-slate-500/70 hover:bg-slate-800/40';
  const special = 'border-dashed border-slate-700/60 bg-slate-900/40';

  let visual = `${glass} ${ring}`;
  if (isFearlessBanned) visual = `${disabled}`;
  else if (status === 'AVAILABLE') visual = `${available} ${isSpecial ? special : ''}`;
  else visual = `${disabled}`;

  return (
    <div
      className={`${base} ${visual} ${clickable ? 'cursor-pointer' : ''}`}
      onClick={clickable ? onClick : undefined}
      title={`${primary || ''}${hero?.nameCn ? ` · ${hero.nameCn}` : ''}${hero?.name ? ` (${hero.name})` : ''}`}
    >
      {isSpecial ? (
        <div className="w-full h-full flex flex-col items-center justify-center py-5">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center shadow-inner">
            {hero.id === SPECIAL_ID_NONE ? (
              <XCircle className="w-7 h-7 text-slate-400" />
            ) : (
              <HelpCircle className="w-7 h-7 text-yellow-400" />
            )}
          </div>
          <div className="mt-3 text-xs font-black text-slate-300">{hero.id === SPECIAL_ID_NONE ? 'NO BAN' : 'RANDOM'}</div>
          <div className="text-[10px] text-slate-500">{hero.id === SPECIAL_ID_NONE ? '不禁用' : '随机英雄'}</div>
        </div>
      ) : (
        <>
          <div className="absolute inset-0 rounded-2xl overflow-hidden">
            {imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt={primary}
                  className={`w-full h-full object-cover transition-transform duration-500 ${isHovered ? 'scale-110' : 'scale-100'} ${isFearlessBanned ? 'grayscale opacity-30' : ''}`}
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent"></div>
              </>
            ) : (
              <div className="w-full h-full bg-slate-900/60"></div>
            )}
          </div>

          <div className="relative z-10 w-full">
            <div className="text-[11px] font-black text-white leading-tight truncate drop-shadow-sm">{primary}</div>
            <div className="text-[10px] text-slate-300/80 truncate">{secondary}</div>
          </div>

          {isFearlessBanned && (
            <div className="absolute top-2 right-2 text-red-400 z-10 bg-black/45 rounded-full p-1 border border-red-900/40">
              <Skull size={12} />
            </div>
          )}
          {!isFearlessBanned && status === 'BANNED' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 rounded-2xl">
              <Ban className="text-red-500 w-8 h-8 opacity-90" />
            </div>
          )}
          {!isFearlessBanned && status === 'PICKED' && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-900/35 z-10 rounded-2xl">
              <CheckCircle2 className="text-blue-300 w-8 h-8 opacity-90" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

const TeamPanel = ({
  side,
  bans,
  picks,
  active,
  phase,
  swapSelection,
  onSwapClick,
  status,
  isReady,
  onToggleReady,
  paused,
  teamName,
  teamWins,
  canControl,
}: any) => {
  const POSITION_LABELS = ['TOP', 'JG', 'MID', 'BOT', 'SUP'];
  const isBlue = side === 'BLUE';

  const textColor = isBlue ? 'text-blue-300' : 'text-red-300';
  const borderColor = isBlue ? 'border-blue-900/50' : 'border-red-900/50';
  const bgTint = isBlue ? 'from-blue-950/35' : 'from-red-950/35';

  const banSlots = Array(5).fill(null);
  const pickSlots = Array(5).fill(null);

  const canInteract = canControl && status === 'RUNNING' && !paused;
  const canToggleReady = canControl && status === 'NOT_STARTED';

  const safeWins = Math.max(0, teamWins || 0);
  const safePicks = picks || Array(5).fill(null);
  const safeBans = bans || Array(5).fill(null);

  return (
    <div
      className={[
        'flex flex-col w-80 h-full',
        'bg-slate-950/40',
        'border-r border-l',
        isBlue ? `border-r-0 border-l ${borderColor}` : `border-l-0 border-r ${borderColor}`,
        'px-4 py-5',
        'relative',
        active ? 'ring-1 ring-inset ' + (isBlue ? 'ring-blue-500/60' : 'ring-red-500/60') : '',
      ].join(' ')}
    >
      <div className={`absolute inset-0 bg-gradient-to-b ${bgTint} to-transparent pointer-events-none`} />

      <div className="relative mb-6 flex flex-col items-center">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-3xl font-black italic uppercase tracking-tight ${textColor}`}>{teamName}</span>
          <div className="flex gap-1">
            {[...Array(safeWins)].map((_, i) => (
              <div key={i} className="w-2 h-2 bg-yellow-500 rounded-full shadow" />
            ))}
          </div>
        </div>
        <div className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${isBlue ? 'border-blue-800/60 text-blue-200 bg-blue-900/20' : 'border-red-800/60 text-red-200 bg-red-900/20'}`}>
          {side} SIDE
        </div>

        {status === 'NOT_STARTED' && (
          <div className="mt-4">
            {onToggleReady && canToggleReady ? (
              <button
                onClick={onToggleReady}
                className={`flex items-center gap-2 px-6 py-2 rounded-2xl font-black transition-all border ${
                  isReady
                    ? 'bg-green-600/90 text-white border-green-500/40 shadow-lg shadow-green-900/15'
                    : 'bg-slate-800/70 text-slate-200 border-slate-700/60 hover:bg-slate-700/70'
                }`}
              >
                {isReady ? 'READY' : 'CLICK TO READY'}
              </button>
            ) : (
              <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black border ${isReady ? 'border-green-500/50 text-green-300 bg-green-950/15' : 'border-slate-700/60 text-slate-400 bg-slate-900/30'}`}>
                {isReady ? 'READY' : 'WAITING'}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative flex-1 space-y-2 mb-4">
        {pickSlots.map((_, i) => {
          const heroId = safePicks[i];
          const hero = heroId ? getHero(heroId) : null;
          const imageUrl = hero ? getHeroImageUrl(hero) : null;
          const isSwapSelected = phase === 'SWAP' && swapSelection?.side === side && swapSelection?.index === i;
          const isSwapMode = phase === 'SWAP';
          const allowClick = isSwapMode && hero && canInteract;

          return (//左右英雄框
            <div
              key={i}
              onClick={() => (allowClick ? onSwapClick(side, i) : undefined)}
              className={[
                'h-[108px] w-full rounded-2xl border overflow-hidden relative',//左右两侧已选英雄框高
                'bg-slate-900/55 backdrop-blur',
                isSwapSelected ? 'border-green-400/80 ring-2 ring-green-400/30' : 'border-slate-700/50',
                allowClick ? 'cursor-pointer hover:bg-slate-800/60 hover:border-slate-500/60' : '',
              ].join(' ')}
            >
              {imageUrl && (
                <div className="absolute inset-0 opacity-55">
                  <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/55 to-transparent"></div>
                </div>
              )}

              <div className="absolute right-3 top-2 text-[15px] font-black text-slate-400 tracking-widest z-10 bg-black/25 border border-slate-700/40 px-2 py-0.5 rounded-full">
                {POSITION_LABELS[i]}
              </div>

              {hero ? (
                <div className="relative z-10 flex items-center w-full h-full px-3">
                  <div className="w-16 h-16 rounded-2xl border border-white/10 mr-3 overflow-hidden shadow-md bg-slate-800/40">
                    {imageUrl ? <img src={imageUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-700" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-black text-slate-100 leading-tight truncate">{getHeroDisplayName(hero)}</div>
                    <div className="text-[10px] text-slate-300/75 truncate">{hero.nameCn ? hero.nameCn : hero.name}</div>
                  </div>
                </div>
              ) : (
                <div className="relative z-10 h-full flex items-center px-3 text-slate-600 text-sm italic">Picking...</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="relative mt-auto hidden">
        <div className="text-[10px] font-black tracking-widest text-slate-500 mb-2 text-center">BANS</div>
        <div className="flex flex-wrap gap-2 justify-center">
          {banSlots.map((_, i) => {
            const heroId = safeBans[i];
            const hero = heroId ? getHero(heroId) : null;
            const imageUrl = hero ? getHeroImageUrl(hero) : null;
            const isNoBan = heroId === SPECIAL_ID_NONE;

            return (
              <div
                key={i}
                className="w-14 h-14 rounded-2xl bg-slate-900/55 border border-slate-700/60 flex items-center justify-center relative overflow-hidden"
              >
                {hero && !isNoBan ? (
                  <>
                    {imageUrl ? <img src={imageUrl} className="w-full h-full object-cover opacity-60 grayscale" /> : <div className="w-full h-full bg-slate-800/50" />}
                    <div className="absolute inset-0 bg-black/20" />
                    <Ban className="absolute w-6 h-6 text-red-500 z-10 drop-shadow" />
                  </>
                ) : isNoBan ? (
                  <XCircle className="w-6 h-6 text-slate-500" />
                ) : (
                  <span className="text-slate-700 text-[10px] font-black">{i + 1}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const GameHistoryCard = ({ game, state }: { game: GameResultSnapshot; state: DraftState }) => {
  const blueTeamName = game.blueSideTeam === 'TEAM_A' ? state.teamA?.name : state.teamB?.name;
  const redTeamName = game.redSideTeam === 'TEAM_A' ? state.teamA?.name : state.teamB?.name;
  const winnerName = game.winner === 'TEAM_A' ? state.teamA?.name : state.teamB?.name;

  const renderMini = (id: string, kind: 'BAN' | 'PICK') => {//结束战报界面
    const hero = getHero(id);
    const img = hero ? getHeroImageUrl(hero) : null;
    const title = hero ? getHeroDisplayName(hero) : '';
    return (
      <div
        className={`relative ${kind === 'BAN' ? 'w-12 h-12' : 'w-16 h-16'} rounded-lg bg-slate-800/70 border border-slate-700/60 overflow-hidden`}
        title={title}
      >
        {img && <img src={img} className={`${kind === 'BAN' ? 'grayscale opacity-70' : ''} w-full h-full object-cover`} />}
        {kind === 'BAN' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Ban className="w-3.5 h-3.5 text-red-500 drop-shadow" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-slate-900/65 backdrop-blur border border-slate-700/60 rounded-2xl p-4 mb-3 shadow-lg shadow-black/20">
      <div className="flex justify-between items-center mb-3">
        <span className="text-yellow-400 font-black tracking-widest text-sm">GAME {game.gameIdx}</span>
        <div className="flex items-center gap-2 text-xm font-mono">
          <span className="text-slate-300 font-black tracking-wider">WINNER:</span>
          <span className={`font-black text-base ${game.winner === game.blueSideTeam ? 'text-blue-300' : 'text-red-300'}`}>{winnerName}</span>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-2">
        <div className="w-28 text-right text-blue-300 font-black text-xs">{blueTeamName}</div>
        <div className="flex gap-1">{game.blueBans.map((h, i) => <React.Fragment key={i}>{renderMini(h, 'BAN')}</React.Fragment>)}</div>
        <div className="flex gap-1 ml-auto">{game.bluePicks.map((h, i) => <React.Fragment key={i}>{renderMini(h, 'PICK')}</React.Fragment>)}</div>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-28 text-right text-red-300 font-black text-xs">{redTeamName}</div>
        <div className="flex gap-1">{game.redBans.map((h, i) => <React.Fragment key={i}>{renderMini(h, 'BAN')}</React.Fragment>)}</div>
        <div className="flex gap-1 ml-auto">{game.redPicks.map((h, i) => <React.Fragment key={i}>{renderMini(h, 'PICK')}</React.Fragment>)}</div>
      </div>
    </div>
  );
};

// ==========================================
// MAIN APP
// ==========================================

export default function App() {
  const [roomId, setRoomId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('room'));
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [state, setState] = useState<DraftState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const [hoveredHeroId, setHoveredHeroId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [swapSelection, setSwapSelection] = useState<{ side: Side; index: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'error' | 'info' } | null>(null);

  const [lastSeenSeq, setLastSeenSeq] = useState<number>(0);
  const [missedActions, setMissedActions] = useState<DraftAction[]>([]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // WS Connection
  useEffect(() => {
    if (!roomId) return;
    const ws = new WebSocket(`ws://localhost:8080?room=${roomId}`);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'STATE_SYNC') {
          const ns = msg.payload as DraftState;
          if (lastSeenSeq > 0 && ns.lastActionSeq > lastSeenSeq + 1) {
            const res = await fetch(`http://localhost:8080/rooms/${roomId}/actions?afterSeq=${lastSeenSeq}`);
            const data = await res.json();
            if (data.actions?.length) setMissedActions((prev) => [...prev, ...data.actions]);
          }
          setLastSeenSeq(ns.lastActionSeq);
          setState(ns);
        } else if (msg.type === 'ACTION_REJECTED') {
          setToast({ msg: msg.payload.reason, type: 'error' });
        }
      } catch (e) {
        console.error(e);
      }
    };

    return () => ws.close();
  }, [roomId, lastSeenSeq]);

  const send = (type: string, payload: any = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type, payload: { ...payload, actorRole: userRole } }));
  };

  // Helpers
  const currentStep = useMemo(() => (state ? getCurrentStep(state) : null), [state]);
  const usedHeroes = useMemo(() => (state ? new Set([...state.blueBans, ...state.redBans, ...state.bluePicks, ...state.redPicks]) : new Set()), [state]);

  const filteredHeroes = useMemo(
    () =>
      HEROES.filter(
        (h) =>
          (roleFilter === 'ALL' || h.roles.includes(roleFilter as Role) || h.roles.includes('SPECIAL')) &&
          matchesSearch(h, searchTerm)
      ),
    [searchTerm, roleFilter]
  );

  // Derived Info
  const myTeamId = userRole === 'TEAM_A' || userRole === 'TEAM_B' ? userRole : null;
  const mySide = state && myTeamId ? state.sides[myTeamId] : null;
  const isReferee = userRole === 'REFEREE';
  const isSpectator = userRole === 'SPECTATOR';

  const canInteract = useMemo(() => {
    if (!state || state.paused || state.status !== 'RUNNING') return false;
    if (isReferee) return true;
    if (state.phase === 'DRAFT' && currentStep && mySide) return currentStep.side === mySide;
    return false;
  }, [state, isReferee, currentStep, mySide]);

  // Timer
  useEffect(() => {
    if (!state || state.status !== 'RUNNING' || state.paused) {
      if (state?.paused && state.pausedAt) setTimeLeft(Math.max(0, Math.ceil((state.stepEndsAt - state.pausedAt) / 1000)));
      else setTimeLeft(0);
      return;
    }
    const i = setInterval(() => setTimeLeft(Math.max(0, Math.ceil((state.stepEndsAt - Date.now()) / 1000))), 200);
    return () => clearInterval(i);
  }, [state?.stepEndsAt, state?.status, state?.paused, state?.pausedAt]);

  // Actions
  const handleLock = () => {
  if (!hoveredHeroId || !canInteract) return;

  let heroIdToSend = hoveredHeroId;

  // ✅ 前端展开 RANDOM：只在 PICK 步骤生效
  if (hoveredHeroId === SPECIAL_ID_RANDOM && (currentStep?.type === 'PICK' || currentStep?.type === 'BAN')) {
    const pool = HEROES
      .filter((h) => !h.id.startsWith('special_'))               // 排除 special
      .filter((h) => !usedHeroes.has(h.id))                      // 排除已被 ban/pick
      .filter((h) => !fearlessBannedHeroes.has(h.id));           // 排除 fearless 禁用

    if (pool.length === 0) {
      setToast({ msg: '没有可随机的英雄（都已被占用/禁用）', type: 'error' });
      return;
    }

    heroIdToSend = pool[Math.floor(Math.random() * pool.length)].id;
  }

  send('ACTION_SUBMIT', { heroId: heroIdToSend });
  setHoveredHeroId(null);
};


  const handleSwap = (side: Side, index: number) => {
    if (isSpectator || state?.status !== 'RUNNING' || state?.paused) return;
    if (!isReferee && side !== mySide) return;

    if (!swapSelection) setSwapSelection({ side, index });
    else if (swapSelection.side === side && swapSelection.index !== index) {
      send('ACTION_SUBMIT', { type: 'SWAP', side, swapData: { fromIndex: swapSelection.index, toIndex: index } });
      setSwapSelection(null);
    } else setSwapSelection(null);
  };

  const handleCreate = async (cfg: any) => {
    const res = await fetch('http://localhost:8080/rooms', { method: 'POST', body: JSON.stringify(cfg) });
    const data = await res.json();
    window.history.pushState(null, '', `?room=${data.roomId}`);
    setRoomId(data.roomId);
  };

  const handleJoin = (id: string) => {
    window.history.pushState(null, '', `?room=${id}`);
    setRoomId(id);
  };

  const handleExitRoom = () => {
    const newUrl = window.location.pathname;
    window.history.pushState(null, '', newUrl);
    setRoomId(null);
    setState(null);
    setIsConnected(false);
    if (wsRef.current) wsRef.current.close();
  };

  const handleSideSelection = (selectedSide: Side) => {
    send('ACTION_SUBMIT', { type: 'SET_SIDES', sideForA: selectedSide });
  };

  const handleReportResult = (winner: TeamId) => send('ACTION_SUBMIT', { type: 'REPORT_RESULT', winner });

  if (!roomId) return <Lobby onCreate={handleCreate} onJoin={handleJoin} />;

  if (!state || !state.teamA || !state.teamB || !state.sides) {
    return (
      <div className="h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-500 gap-4">
        <div className="animate-spin text-yellow-500">
          <RotateCcw />
        </div>
      </div>
    );
  }

  const bothSidesSet = state.sides.TEAM_A && state.sides.TEAM_B;

  const getTeamData = (teamId: string | null) => {
    if (teamId === 'TEAM_A') return state.teamA;
    if (teamId === 'TEAM_B') return state.teamB;
    return null;
  };

  const teamOnBlueId = state.sides.TEAM_A === 'BLUE' ? 'TEAM_A' : state.sides.TEAM_B === 'BLUE' ? 'TEAM_B' : null;
  const teamOnRedId = state.sides.TEAM_A === 'RED' ? 'TEAM_A' : state.sides.TEAM_B === 'RED' ? 'TEAM_B' : null;

  const blueData = getTeamData(teamOnBlueId);
  const redData = getTeamData(teamOnRedId);

  const isBlueUser = userRole === 'REFEREE' || (teamOnBlueId && userRole === teamOnBlueId);
  const isRedUser = userRole === 'REFEREE' || (teamOnRedId && userRole === teamOnRedId);

  // FEARLESS LOGIC
  const fearlessBannedHeroes = new Set<string>();
  if (state && state.draftMode === 'FEARLESS' && state.seriesHistory) {
    state.seriesHistory.forEach((game) => {
      game.bluePicks.forEach((id) => fearlessBannedHeroes.add(id));
      game.redPicks.forEach((id) => fearlessBannedHeroes.add(id));
    });
  }

  return (
    <div className="h-screen bg-slate-950 text-slate-200 font-sans flex flex-col selection:bg-yellow-500/30 relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_20%,rgba(234,179,8,0.10),transparent_55%),radial-gradient(circle_at_80%_10%,rgba(59,130,246,0.10),transparent_55%),radial-gradient(circle_at_70%_85%,rgba(239,68,68,0.08),transparent_55%)] pointer-events-none" />

      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 bg-red-600 px-6 py-3 rounded-full shadow-xl z-50 animate-bounce font-black">
          {toast.msg}
        </div>
      )}
      {!userRole && <RoleSelectionModal state={state} onSelect={setUserRole} />}

      {/* Header */}
      <header className="h-20 bg-slate-900/70 backdrop-blur-2xl border-b border-slate-800/70 flex items-center justify-between px-6 md:px-8 shadow-lg z-10 relative">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-yellow-500/20 to-slate-800/20 border border-slate-700/60 flex items-center justify-center shadow-md">
              <Sword className="text-yellow-400" size={18} />
            </div>
            <div className="min-w-0">
              <div className="font-black text-lg text-yellow-400 truncate">{state.matchTitle || 'DRAFT'}</div>
              <div className="text-[10px] text-slate-500 -mt-0.5">
                {state.seriesMode} • {state.draftMode}
              </div>
            </div>
          </div>

          {state.draftMode === 'FEARLESS' && (
            <div className="hidden sm:flex text-[10px] bg-red-900/30 text-red-300 px-2 py-1 rounded-full border border-red-800/60 uppercase tracking-widest items-center gap-1 font-black">
              <Skull size={12} /> Fearless
            </div>
          )}

          <div className="hidden md:flex bg-slate-800/60 px-6 py-2.5 rounded-full border border-slate-700/60 text-base font-mono shadow-lg">
            <span className={state.teamA.wins > state.teamB.wins ? 'text-yellow-300' : 'text-white'}>{state.teamA.name} {state.teamA.wins || 0}</span>
            <span className="mx-2 text-slate-500">-</span>
            <span className={state.teamB.wins > state.teamA.wins ? 'text-yellow-300' : 'text-white'}>{state.teamB.wins} {state.teamB.name}</span>
          </div>
        </div>

        {/* Center status */}
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">
          <div
            className={[
              'text-[10px] font-black px-3 py-1 rounded-full mb-1 tracking-widest border',
              state.paused
                ? 'bg-red-600/90 text-white border-red-500/40'
                : state.status === 'RUNNING'
                  ? 'bg-green-900/35 text-green-300 border-green-700/50'
                  : 'bg-slate-800/60 text-slate-300 border-slate-700/60',
            ].join(' ')}
          >
            {state.paused ? 'PAUSED' : `GAME ${state.currentGameIdx} • ${state.status}`}
          </div>

          {state.status === 'RUNNING' && !state.paused && (
            state.phase === 'DRAFT' ? (
              currentStep && (
                <div className="text-xl font-black text-white flex gap-2 items-baseline">
                  <span className={currentStep.side === 'BLUE' ? 'text-blue-300' : 'text-red-300'}>
                    {currentStep.side} {currentStep.type}
                  </span>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-100">{timeLeft}s</span>
                </div>
              )
            ) : state.phase === 'SWAP' ? (
              <div className="text-xl font-black flex gap-2 text-yellow-400 animate-pulse">
                <span>SWAP PHASE</span>
                <span className="text-slate-600">|</span>
                <span>{timeLeft}s</span>
              </div>
            ) : null
          )}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          <div
            className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-black ${
              isConnected ? 'bg-green-950/20 border-green-800/50 text-green-300' : 'bg-slate-900/40 border-slate-700/60 text-slate-400'
            }`}
            title={isConnected ? 'Connected' : 'Disconnected'}
          >
            {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {isConnected ? 'ONLINE' : 'OFFLINE'}
          </div>

          {isReferee && (
            <div className="flex bg-slate-800/60 rounded-2xl p-1 border border-slate-700/60">
              {state.status === 'RUNNING' && !state.paused && (
                <button onClick={() => send('ACTION_SUBMIT', { type: 'PAUSE_GAME', reason: 'Admin' })} className="p-2 hover:text-yellow-400 transition-colors">
                  <Pause size={16} />
                </button>
              )}
              {state.paused && (
                <button onClick={() => send('ACTION_SUBMIT', { type: 'RESUME_GAME' })} className="p-2 hover:text-green-400 transition-colors">
                  <PlayCircle size={16} />
                </button>
              )}
              {state.status === 'NOT_STARTED' && bothSidesSet && (
                <button
                  onClick={() => send('ACTION_SUBMIT', { type: 'START_GAME' })}
                  disabled={!state.blueReady || !state.redReady}
                  className="p-2 hover:text-green-400 disabled:opacity-30 transition-colors"
                >
                  <Play size={16} />
                </button>
              )}
              <button onClick={() => send('ACTION_SUBMIT', { type: 'RESET_GAME' })} className="p-2 hover:text-white transition-colors">
                <RotateCcw size={16} />
              </button>
            </div>
          )}

          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/60 border border-slate-700/60 text-xs font-black text-slate-300">
            {userRole === 'TEAM_A' ? state.teamA.name : userRole === 'TEAM_B' ? state.teamB.name : userRole}
          </div>

          <button
            onClick={handleExitRoom}
            className="flex items-center gap-1 text-xs bg-slate-800/60 hover:bg-slate-700/70 border border-slate-700/60 text-slate-200 px-3 py-1.5 rounded-full font-black transition-all"
            title="Exit Room"
          >
            <LogOut size={14} /> Exit
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative z-0">
        <TeamPanel
          side="BLUE"
          bans={state.blueBans}
          picks={state.bluePicks}
          active={state.status === 'RUNNING' && currentStep?.side === 'BLUE'}
          teamName={blueData ? blueData.name : 'TBD'}
          teamWins={blueData ? blueData.wins : 0}
          status={state.status}
          isReady={state.blueReady}
          canControl={isBlueUser}
          onToggleReady={canInteract || (bothSidesSet && isBlueUser) ? () => send('TOGGLE_READY', { side: 'BLUE' }) : undefined}
          swapSelection={swapSelection}
          onSwapClick={handleSwap}
          phase={state.phase}
          paused={state.paused}
        />

        <div className="flex-1 flex flex-col bg-slate-950/20 relative">
          {state.status === 'NOT_STARTED' && !bothSidesSet && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm">
              <div className="bg-slate-900/70 border border-slate-700/60 rounded-3xl p-8 shadow-2xl max-w-3xl w-full mx-6">
                <div className="text-center">
                  <h2 className="text-4xl font-black text-white italic mb-4">SIDE SELECTION</h2>
                  <div className="text-slate-400 mb-8 text-lg">
                    {state.nextSideSelector === 'REFEREE' ? 'Referee is setting initial sides' : `${getTeamData(state.nextSideSelector)?.name} is choosing side`}
                  </div>
                </div>

                {(isReferee || userRole === state.nextSideSelector) && (
                  <div className="flex flex-col items-center gap-6">
                    <div className="text-xl font-black text-blue-300">这一局的蓝色方是：</div>
                    <div className="flex flex-col md:flex-row gap-5 md:gap-10 w-full justify-center">
                      <button onClick={() => handleSideSelection('BLUE')} className="group flex-1">
                        <div className="w-full h-36 bg-slate-900/60 border-2 border-slate-700/60 hover:border-blue-500/70 hover:bg-blue-900/15 rounded-3xl flex flex-col items-center justify-center gap-2 transition-all hover:scale-[1.01] shadow-xl">
                          <span className="text-3xl font-black text-white uppercase">{state.teamA.name}</span>
                          <span className="text-[10px] text-slate-500 font-black tracking-widest">TEAM A</span>
                        </div>
                      </button>
                      <button onClick={() => handleSideSelection('RED')} className="group flex-1">
                        <div className="w-full h-36 bg-slate-900/60 border-2 border-slate-700/60 hover:border-blue-500/70 hover:bg-blue-900/15 rounded-3xl flex flex-col items-center justify-center gap-2 transition-all hover:scale-[1.01] shadow-xl">
                          <span className="text-3xl font-black text-white uppercase">{state.teamB.name}</span>
                          <span className="text-[10px] text-slate-500 font-black tracking-widest">TEAM B</span>
                        </div>
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-500 text-center">
                      Tip: Click the team who will be BLUE side.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {state.status === 'RUNNING' && state.phase === 'DRAFT' && (
            <>
              <div className="flex-1 flex items-start justify-center p-6 overflow-hidden">
                <div className="w-full max-w-6xl">
                  {/* ===== White Panel (like reference) ===== */}
                  <div className="bg-slate-100 border border-slate-300 rounded-lg shadow-xl overflow-hidden">
                    {/* Top tabs + search */}
                    <div className="flex items-stretch bg-white border-b border-slate-300">
                      <div className="flex">
                        {[
                          ['ALL', '全部'],
                          ['TOP', '上单'],
                          ['JG', '打野'],
                          ['MID', '中单'],
                          ['BOT', '下路'],
                          ['SUP', '辅助'],
                        ].map(([val, label]) => {
                          const active = roleFilter === val;
                          return (
                            <button
                              key={val}
                              onClick={() => setRoleFilter(val)}
                              className={`relative px-6 py-3 font-bold border-r border-slate-200 ${
                                active ? 'bg-white text-slate-900' : 'bg-slate-50 text-slate-500 hover:bg-white'
                              }`}
                            >
                              {label}
                              {active && (
                                <span className="absolute left-5 -bottom-2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-white" />
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div className="ml-auto flex items-center gap-3 px-4">
                        <input
                          type="text"
                          placeholder="搜索..."
                          className="w-80 max-w-[40vw] bg-white border border-slate-300 rounded px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:outline-none"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="text-slate-500" />
                      </div>
                    </div>

                    {/* Hero pool area (smaller frame, scroll inside) */}
                    <div className="bg-slate-200/60 p-4">
                      <div className="bg-white border border-slate-300 rounded-md p-5 h-[520px] overflow-y-auto">
                        <div className="grid grid-cols-10 gap-4">
                          {filteredHeroes.map((h) => {
                            const used = usedHeroes.has(h.id);
                            const isFearlessBanned = fearlessBannedHeroes.has(h.id);
                            const status = h.id.startsWith('special')
                              ? (currentStep?.type === 'BAN'
                                  ? (h.id === SPECIAL_ID_NONE || h.id === SPECIAL_ID_RANDOM ? 'AVAILABLE' : 'DISABLED')
                                  : currentStep?.type === 'PICK'
                                    ? (h.id === SPECIAL_ID_RANDOM ? 'AVAILABLE' : 'DISABLED')
                                    : 'DISABLED')
                              : used
                                ? 'DISABLED'
                                : 'AVAILABLE';

                            return (
                              <HeroCard
                                key={h.id}
                                hero={h}
                                status={status}
                                isHovered={hoveredHeroId === h.id}
                                onClick={() => { if (canInteract) setHoveredHeroId(h.id); }}
                                isFearlessBanned={isFearlessBanned}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ===== Bottom bar: big bans + big confirm button (like reference) ===== */}
                  <div className="mt-5 flex items-center justify-between gap-6">
                    {/* Blue bans */}
                    <div className="flex gap-3">
                      {(state.blueBans || Array(5).fill(null)).slice(0,5).map((heroId, i) => {
                        const hero = heroId ? getHero(heroId) : null;
                        const img = hero ? getHeroImageUrl(hero) : null;
                        const isNoBan = heroId === SPECIAL_ID_NONE;

                        return (
                          <div key={i} className="w-16 h-16 bg-slate-300 rounded border border-slate-400 overflow-hidden relative flex items-center justify-center">
                            {isNoBan ? (
                              <XCircle className="w-9 h-9 text-slate-600" />
                            ) : img ? (
                              <>
                                <img src={img} className="w-full h-full object-cover grayscale opacity-80" />
                                <Ban className="absolute w-7 h-7 text-red-600 drop-shadow" />
                              </>
                            ) : (
                              <div className="w-full h-full bg-slate-300" />
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Confirm button */}
                    <div className="flex flex-col items-center gap-2">
                      {getHero(hoveredHeroId) && (
                        <div className="text-slate-200 font-black">
                          {getHeroDisplayName(getHero(hoveredHeroId) || null)}
                        </div>
                      )}
                      <button
                        onClick={handleLock}
                        disabled={!hoveredHeroId || !canInteract}
                        className="w-[360px] h-20 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-slate-900 text-3xl font-black shadow-2xl
                                  [clip-path:polygon(6%_0,94%_0,100%_100%,0_100%)]"
                      >
                        确定
                      </button>
                    </div>

                    {/* Red bans */}
                    <div className="flex gap-3">
                      {(state.redBans || Array(5).fill(null)).slice(0,5).reverse().map((heroId, i) => {
                        const hero = heroId ? getHero(heroId) : null;
                        const img = hero ? getHeroImageUrl(hero) : null;
                        const isNoBan = heroId === SPECIAL_ID_NONE;

                        return (
                          <div key={i} className="w-16 h-16 bg-slate-300 rounded border border-slate-400 overflow-hidden relative flex items-center justify-center">
                            {isNoBan ? (
                              <XCircle className="w-9 h-9 text-slate-600" />
                            ) : img ? (
                              <>
                                <img src={img} className="w-full h-full object-cover grayscale opacity-80" />
                                <Ban className="absolute w-7 h-7 text-red-600 drop-shadow" />
                              </>
                            ) : (
                              <div className="w-full h-full bg-slate-300" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

            </>
          )}

          {state.phase === 'SWAP' && state.status === 'RUNNING' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-sm">
              <div className="bg-slate-900/70 border border-slate-700/60 rounded-3xl p-10 shadow-2xl text-center">
                <h2 className="text-4xl font-black text-white italic mb-4">SWAP PHASE</h2>
                <p className="text-slate-400 mb-8">Click picks to swap positions, then confirm.</p>
                {canInteract && (
                  <div className="w-full flex justify-center">
                    <button
                      onClick={() => send('ACTION_SUBMIT', { type: 'FINISH_SWAP' })}
                      className="bg-green-600 text-white px-10 py-4 rounded-2xl font-black flex items-center gap-2 shadow-xl"
                    >
                      <Check /> CONFIRM SWAPS
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {state.status === 'FINISHED' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-start bg-slate-950/85 backdrop-blur-sm overflow-y-auto pt-10 pb-12 px-6">
              <div className="w-full max-w-5xl">
                <div className="bg-slate-900/70 border border-slate-700/60 rounded-3xl p-8 shadow-2xl">
                  <h2 className="text-4xl font-black text-yellow-400 italic mb-6 text-center">GAME COMPLETED</h2>

                  {isReferee && !state.seriesHistory?.some((g) => g.gameIdx === state.currentGameIdx) ? (
                    <div className="text-center mb-10">
                      <p className="text-slate-400 mb-4">Select the winner of Game {state.currentGameIdx}</p>
                      <div className="flex flex-col md:flex-row gap-4 justify-center">
                        <button
                          onClick={() => handleReportResult('TEAM_A')}
                          className="w-full md:w-64 h-28 bg-slate-800/60 hover:bg-slate-700/70 border border-slate-600/70 hover:border-yellow-500/60 rounded-3xl flex flex-col items-center justify-center gap-1 transition-all hover:scale-[1.01]"
                        >
                          <span className="text-2xl font-black text-white">{state.teamA.name}</span>
                          <span className="text-xs text-green-300 font-black">WINNER</span>
                        </button>

                        <button
                          onClick={() => handleReportResult('TEAM_B')}
                          className="w-full md:w-64 h-28 bg-slate-800/60 hover:bg-slate-700/70 border border-slate-600/70 hover:border-yellow-500/60 rounded-3xl flex flex-col items-center justify-center gap-1 transition-all hover:scale-[1.01]"
                        >
                          <span className="text-2xl font-black text-white">{state.teamB.name}</span>
                          <span className="text-xs text-green-300 font-black">WINNER</span>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {state.seriesHistory && state.seriesHistory.length > 0 && (
                    <div className="w-full">
                      <h3 className="text-white text-xl font-black mb-4 text-center border-b border-slate-700/60 pb-3">
                        SERIES HISTORY
                      </h3>
                      {state.seriesHistory.map((game) => (
                        <GameHistoryCard key={game.gameIdx} game={game} state={state} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <TeamPanel
          side="RED"
          bans={state.redBans}
          picks={state.redPicks}
          active={state.status === 'RUNNING' && currentStep?.side === 'RED'}
          teamName={redData ? redData.name : 'TBD'}
          teamWins={redData ? redData.wins : 0}
          status={state.status}
          isReady={state.redReady}
          canControl={isRedUser}
          onToggleReady={canInteract || (bothSidesSet && isRedUser) ? () => send('TOGGLE_READY', { side: 'RED' }) : undefined}
          swapSelection={swapSelection}
          onSwapClick={handleSwap}
          phase={state.phase}
          paused={state.paused}
        />
      </main>
    </div>
  );
}

/**
 * Optional: Hide scrollbar utilities (Tailwind doesn't ship by default).
 * If you already have these utilities, remove this comment.
 *
 * .no-scrollbar::-webkit-scrollbar { display: none; }
 * .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
 */
