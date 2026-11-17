/**
 * Threads 每日出題（2026-11-17）— 一天的草稿：貼文、第一則留言的空位、昨天貼文底下的答案，純函式。
 *
 * 串文格式（2026-11-11）：
 *   ① 新貼文＝今天的題目＋圖；
 *   ② 今天貼文的第一則留言＝跟這題有關的數據冷知識／觀念＋文章網址（ChatGPT 寫稿，Issue #37；這裡只留空位與建議的文章）；
 *   ③ 串在昨天那篇底下＝昨天的答案＋理由＋「下一題 →」。
 *   週四、週六引用前一天的貼文（同一局）。不用私訊對答案、不當天公布。
 * 週四、週六延續同一局時，前一天的答案只講真人派了什麼、之後公開的事（任務結果）和純邏輯的理由，
 * 不講幾好幾壞和角色（同一局還在打）；完整答案在隔天（週五、週日）一起公布。
 *
 * 發文由 Edward 自己來（沒有 Threads API、不自動發）。
 */

import type { Role } from '@avalon/shared';
import { STATS_SITE_URL } from '../stats/statsReplies';
import { ROLE_ZH } from '../simulation/commands';
import { logicModel } from '../simulation/logic';
import { recordUrl } from '../simulation/recordsIndex';
import { eventLines, identityLine, questLine, resultText, roleCode, seatLabel, pct } from '../simulation/replies';
import { TEAM_SIZES, eventIndexOfProposal, isRed, publicEvents, viewAt, type PublicEvent, type SimGame, type SimView } from '../simulation/scenario';
import { maskOf, seatList, seatsOfMask, teamDigits } from '../simulation/seats';
import { exerciseIdOfPick, themeOf, weekdayOf, type ThreadsKind, type ThreadsPick } from './plan';

/** Threads 一則貼文的字數上限。 */
export const THREADS_MAX_CHARS = 500;

/** 每個主題建議的百科文章（第一則留言附網址；ChatGPT 可以換）。id 對 wiki_data.json。 */
export const THREADS_ARTICLES: Readonly<Record<string, readonly string[]>> = {
  assassin: ['wiki-12', 'wiki-56', 'wiki-175'],
  percival: ['wiki-176', 'wiki-165'],
  'tail-1': ['wiki-205', 'wiki-206', 'wiki-57'],
  'tail-2': ['wiki-205', 'wiki-206'],
  'tail-3': ['wiki-206', 'wiki-24', 'wiki-18'],
  'tail-4': ['wiki-206', 'wiki-207'],
  final: ['wiki-207', 'wiki-206'],
  lake: ['wiki-147'],
};

/** 百科文章的分享網址（有 Open Graph 預覽，Threads 會顯示卡片）。 */
export function wikiShareUrl(id: string): string {
  return `${STATS_SITE_URL}/w/${encodeURIComponent(id)}/`;
}

function articleKey(pick: ThreadsPick): string {
  if (pick.kind === 'tail') return `tail-${pick.round}`;
  return pick.kind;
}

// ─── 視角 ─────────────────────────────────────────────────────────────────

export interface PickView {
  game: SimGame;
  pick: ThreadsPick;
  exerciseId: string;
  view: SimView;
  /** 決定當下看得到的事件。 */
  shown: PublicEvent[];
}

export function pickView(game: SimGame, pick: ThreadsPick): PickView {
  const events = publicEvents(game);
  const cursor = pick.proposal === null ? events.length : eventIndexOfProposal(events, pick.proposal);
  const view = viewAt(game, pick.seat, cursor, events);
  return { game, pick, exerciseId: exerciseIdOfPick(pick, game), view, shown: view.events };
}

function decisionWords(game: SimGame, pick: ThreadsPick): string {
  if (pick.proposal === null) return '三藍：輪到你刺殺。誰是梅林？';
  const p = game.proposals[pick.proposal];
  const size = TEAM_SIZES[p.round - 1];
  const forced = p.attempt === 5 ? '，強制出發' : '';
  return `輪到你派 ${size} 人（第 ${p.round} 局第 ${p.attempt} 次${forced}）。你會派誰？`;
}

function answerHint(kind: ThreadsKind): string {
  return kind === 'assassin' ? '留言寫一個座位（0 家寫 0），明天公布答案。' : '留言寫座位（例：469，0 家寫 0），明天公布答案。';
}

/** 事件行太長時的縮短版：前面幾局只留任務結果和湖，當下這一局的派票全留。 */
function compactLines(pv: PickView): string[] {
  const round = pv.pick.proposal === null ? 6 : pv.game.proposals[pv.pick.proposal].round;
  const lines: string[] = [];
  for (const e of pv.shown) {
    if (e.kind === 'proposal') {
      if (e.round < round) continue;
      if (!lines.includes(`第 ${e.round} 局：`)) lines.push(`第 ${e.round} 局：`);
      lines.push(eventLines([e], pv.pick.seat, pv.game, { startRound: e.round })[0]);
    } else if (e.kind === 'quest') lines.push(`第 ${e.round} 局 ${questLine(e)}`);
    else lines.push(eventLines([e], pv.pick.seat, pv.game, { startRound: e.round })[0]);
  }
  return lines;
}

function continuesLine(from: { exerciseId: string; seat: number }, seat: number): string {
  return from.seat === seat
    ? `接昨天那一局（${from.exerciseId}），同一家又輪到尾派：`
    : `接昨天那一局（${from.exerciseId}），這次換 ${seatLabel(seat)}的視角：`;
}

/** ① 今天的貼文（≤ 500 字；放不下就縮短前面的局，再放不下就只寫「完整局面看圖」）。 */
export function postText(pv: PickView, opts: { weekday: number; continuesFrom?: { exerciseId: string; seat: number } }): string {
  const theme = themeOf(opts.weekday);
  const role = pv.game.seatRoles[pv.pick.seat - 1];
  const head = [
    `【阿瓦隆每日一題｜${theme.label}】`,
    ...(opts.continuesFrom ? [continuesLine(opts.continuesFrom, pv.pick.seat)] : []),
    identityLine(pv.pick.seat, role, pv.view.sight),
  ];
  const tail = [decisionWords(pv.game, pv.pick), answerHint(pv.pick.kind), `題號 ${pv.exerciseId}｜實戰牌譜，記號看圖或〈牌譜記錄格式與常用術語〉`];
  const noPrior = !pv.shown.some((e) => e.kind === 'proposal');
  const variants: string[][] = noPrior
    ? [['第 1 局第一個隊長，前面沒有派票']]
    : [eventLines(pv.shown, pv.pick.seat, pv.game), compactLines(pv), ['（完整局面看圖）']];
  for (const body of variants) {
    const text = [...head, ...body, ...tail].join('\n');
    if ([...text].length <= THREADS_MAX_CHARS) return text;
  }
  return [...head, ...tail].join('\n');
}

// ─── 純邏輯的理由 ─────────────────────────────────────────────────────────

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number): void => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let s = start; s <= n; s++) {
      cur.push(s);
      rec(s + 1);
      cur.pop();
    }
  };
  rec(1);
  return out;
}

export interface LogicReason {
  /** 這個視角（純邏輯，只用看得到的資訊）還可能的紅方組合數。 */
  worlds: number;
  /** 真人派的隊在幾種裡全好。 */
  teamClean: number;
  /** 全好機會最大的隊（同分的都列）與種數。 */
  best: { teams: number[][]; clean: number };
}

export function logicReason(pv: PickView): LogicReason | null {
  if (pv.pick.proposal === null) return null;
  const p = pv.game.proposals[pv.pick.proposal];
  const worlds = logicModel.worlds(pv.view).map((w) => w.redMask);
  if (worlds.length === 0) return null;
  const clean = (team: readonly number[]): number => {
    const m = maskOf(team);
    return worlds.filter((w) => (w & m) === 0).length;
  };
  let best = { teams: [] as number[][], clean: -1 };
  for (const team of combinations(10, TEAM_SIZES[p.round - 1])) {
    const c = clean(team);
    if (c > best.clean) best = { teams: [team], clean: c };
    else if (c === best.clean) best.teams.push(team);
  }
  return { worlds: worlds.length, teamClean: clean(p.teamSeats), best };
}

function logicLine(pv: PickView): string | null {
  const r = logicReason(pv);
  if (!r) return null;
  const share = (n: number): string => pct(n / r.worlds);
  const bestTeams = r.best.teams.slice(0, 2).map(teamDigits).join('、') + (r.best.teams.length > 2 ? ` 等 ${r.best.teams.length} 隊` : '');
  return `理由（純邏輯，只用 ${seatLabel(pv.pick.seat)}當下看得到的資訊）：紅方還有 ${r.worlds} 種可能；真人這隊在 ${r.teamClean} 種裡全好（${share(r.teamClean)}）；全好機會最大的是 ${bestTeams}（${share(r.best.clean)}）。`;
}

// ─── ③ 昨天的答案 ─────────────────────────────────────────────────────────

function teamGoodBad(game: SimGame, team: readonly number[]): string {
  const reds = team.filter((s) => isRed(game.seatRoles[s - 1])).length;
  return `${team.length - reds} 好 ${reds} 壞`;
}

function realDecisionLine(pv: PickView, withTruth: boolean): string {
  const p = pv.game.proposals[pv.pick.proposal as number];
  const role: Role = pv.game.seatRoles[p.leaderSeat - 1];
  const who = withTruth ? `${seatLabel(p.leaderSeat)}・${ROLE_ZH[role]}` : seatLabel(p.leaderSeat);
  let line = `當時真人（${who}）派 ${teamDigits(p.teamSeats)}`;
  if (withTruth) line += `：${teamGoodBad(pv.game, p.teamSeats)}`;
  if (p.wentOnMission) {
    const q = pv.game.quests.find((x) => x.round === p.round);
    line += q ? ` → ${questLine({ kind: 'quest', round: q.round, teamSeats: q.teamSeats, successCount: q.successCount, failCount: q.failCount, failed: q.failed })}` : ' → 出發';
  } else line += ' → 沒有出發';
  return line;
}

function revealTail(game: SimGame, recordId: string | undefined): string[] {
  const reds = seatsOfMask(maskOf(game.seatRoles.map((r, i) => (isRed(r) ? i + 1 : 0)).filter(Boolean)));
  return [
    `角色：${roleCode(game)}（紅 ${seatList(reds)}）｜結果：${resultText(game)}`,
    recordId ? `完整牌譜：${recordUrl(recordId)}` : '（網站上還沒有這一局的牌譜頁）',
  ];
}

export interface AnswerInput {
  /** 昨天的題目。 */
  yesterday: PickView;
  /** 昨天延續的那一題（週四延續週三）：完整公布時一起公布。 */
  earlier?: PickView;
  /** 今天延續昨天同一局：不公布幾好幾壞和角色。 */
  todayContinues: boolean;
  recordId?: string;
  /** 昨天的主題（星期）。 */
  yesterdayWeekday: number;
}

/** ③ 串在昨天貼文底下的答案。 */
export function answerText(input: AnswerInput): string {
  const y = input.yesterday;
  const theme = themeOf(input.yesterdayWeekday);
  const lines = [`【昨天的答案｜${theme.label}｜${y.exerciseId}】`];
  if (y.pick.kind === 'assassin') {
    const merlin = y.game.seatRoles.indexOf('merlin') + 1;
    const target = y.game.assassinTargetSeat;
    lines.push(`梅林是 ${seatLabel(merlin)}。${target ? `當時真人刺 ${seatLabel(target)}（${target === merlin ? '刺中' : '沒刺中'}）。` : ''}`);
    lines.push(...revealTail(y.game, input.recordId));
  } else if (input.todayContinues) {
    lines.push(realDecisionLine(y, false));
    const why = logicLine(y);
    if (why) lines.push(why);
    lines.push('幾好幾壞和角色明天公布：今天同一局接著打。');
  } else {
    if (input.earlier) {
      const e = input.earlier;
      lines.push(`前一題 ${e.exerciseId}：${realDecisionLine(e, true)}`);
    }
    lines.push(realDecisionLine(y, true));
    const why = logicLine(y);
    if (why) lines.push(why);
    lines.push(...revealTail(y.game, input.recordId));
  }
  lines.push('下一題 →（今天的貼文）');
  let text = lines.join('\n');
  // 超過字數：先拿掉理由。
  if ([...text].length > THREADS_MAX_CHARS) text = lines.filter((l) => !l.startsWith('理由')).join('\n');
  return text;
}

// ─── 一天的草稿 ───────────────────────────────────────────────────────────

export interface FirstCommentSlot {
  /** ChatGPT 填（Issue #37）：一則跟今天題目有關的數據冷知識或觀念，結尾附一篇文章網址。沒填是 null。 */
  text: string | null;
  /** 給 ChatGPT 的提示。 */
  brief: string;
  /** 建議的文章（id、標題、分享網址），第一篇最相關。 */
  articles: { id: string; title: string; url: string }[];
  /** 這題的關鍵字（挑冷知識用）。 */
  tags: string[];
}

export interface ThreadsDraft {
  date: string;
  weekday: number;
  theme: string;
  exerciseId: string;
  /** 存下來給隔天的答案用（題庫代號不會變）。 */
  pick: ThreadsPick;
  recordId?: string;
  post: { text: string; chars: number; image?: string };
  /** 週四、週六：引用昨天的貼文（同一局）。 */
  quoteYesterday: boolean;
  firstComment: FirstCommentSlot;
  replyToYesterday: { date: string; exerciseId: string; text: string; chars: number } | null;
}

function tagsOf(pv: PickView): string[] {
  const tags: string[] = [];
  const kind = pv.pick.kind;
  if (kind === 'assassin') tags.push('刺殺', '找梅林');
  if (kind === 'percival') tags.push('派西維爾', '拇指');
  if (kind === 'tail') tags.push('尾家', `${pv.pick.round}-5`, '強制出發');
  if (kind === 'final') tags.push('第五局', '決勝局');
  if (pv.shown.some((e) => e.kind === 'lake')) tags.push('湖中女神');
  if (pv.shown.some((e) => e.kind === 'quest' && e.failCount > 0)) tags.push('任務失敗的解讀');
  const role = pv.game.seatRoles[pv.pick.seat - 1];
  if (kind !== 'assassin') tags.push(ROLE_ZH[role]);
  return tags;
}

export function firstCommentSlot(pv: PickView, titles: ReadonlyMap<string, string>): FirstCommentSlot {
  const ids = [...(THREADS_ARTICLES[articleKey(pv.pick)] ?? [])];
  if (pv.shown.some((e) => e.kind === 'lake')) ids.push(...THREADS_ARTICLES.lake);
  const articles = [...new Set(ids)].filter((id) => titles.has(id)).map((id) => ({ id, title: titles.get(id) as string, url: wikiShareUrl(id) }));
  return {
    text: null,
    brief: '一則跟今天題目有關的數據冷知識或觀念（≤ 300 字，白話、不劇透今天的答案），結尾附一篇文章網址（從 articles 挑，或換更適合的百科文章）。',
    articles,
    tags: tagsOf(pv),
  };
}

export interface DraftInput {
  date: string;
  today: PickView;
  todayRecordId?: string;
  /** 昨天的題目（沒有就 null：例如第一天）。 */
  yesterday: { date: string; pv: PickView; earlier?: PickView; recordId?: string } | null;
  /** 百科文章 id → 標題。 */
  titles: ReadonlyMap<string, string>;
  image?: string;
}

export function buildDraft(input: DraftInput): ThreadsDraft {
  const weekday = weekdayOf(input.date);
  const theme = themeOf(weekday);
  const continues = !!input.today.pick.continues && !!input.yesterday && input.yesterday.pv.pick.gameId === input.today.pick.gameId;
  const from = continues && input.yesterday ? { exerciseId: input.yesterday.pv.exerciseId, seat: input.yesterday.pv.pick.seat } : undefined;
  const text = postText(input.today, { weekday, ...(from ? { continuesFrom: from } : {}) });
  const reply = input.yesterday
    ? answerText({
      yesterday: input.yesterday.pv,
      earlier: input.yesterday.earlier,
      todayContinues: continues,
      recordId: input.yesterday.recordId,
      yesterdayWeekday: weekdayOf(input.yesterday.date),
    })
    : null;
  return {
    date: input.date,
    weekday,
    theme: theme.label,
    exerciseId: input.today.exerciseId,
    pick: input.today.pick,
    ...(input.todayRecordId ? { recordId: input.todayRecordId } : {}),
    post: { text, chars: [...text].length, ...(input.image ? { image: input.image } : {}) },
    quoteYesterday: continues,
    firstComment: firstCommentSlot(input.today, input.titles),
    replyToYesterday: input.yesterday && reply
      ? { date: input.yesterday.date, exerciseId: input.yesterday.pv.exerciseId, text: reply, chars: [...reply].length }
      : null,
  };
}

/** 給 Edward 複製貼上的 Markdown。 */
export function draftMarkdown(d: ThreadsDraft): string {
  const out = [`# Threads 草稿 ${d.date}（${d.theme}）`, '', `題號 ${d.exerciseId}${d.recordId ? `｜牌譜 ${recordUrl(d.recordId)}` : ''}`, ''];
  out.push(`## ① 新貼文${d.quoteYesterday ? '（引用昨天的貼文）' : ''}（${d.post.chars} 字）`, '', '```', d.post.text, '```', '');
  if (d.post.image) out.push(`圖：${d.post.image}`, '');
  out.push('## ② 今天貼文的第一則留言（ChatGPT 填）', '');
  out.push(d.firstComment.text ? ['```', d.firstComment.text, '```'].join('\n') : '（還沒填）');
  out.push('', `建議文章：${d.firstComment.articles.map((a) => `${a.title} ${a.url}`).join('；') || '（無）'}`, `關鍵字：${d.firstComment.tags.join('、')}`, '');
  if (d.replyToYesterday) {
    out.push(`## ③ 串在昨天（${d.replyToYesterday.date}）的貼文底下（${d.replyToYesterday.chars} 字）`, '', '```', d.replyToYesterday.text, '```', '');
  }
  return out.join('\n');
}
