/**
 * Threads 每日出題草稿（2026-11-17）：
 *   - plan.ts：日期／星期／週次、一週的計畫（週三＋週四、週五＋週六同一局、3-5 只出第二局開紅的局、同一週不重複）；
 *   - draft.ts：貼文 ≤ 500 字、延續的日子不公布幾好幾壞和角色、完整公布附角色與牌譜連結、0 家寫 0；
 *   - generate.ts：存下來的草稿優先（題目、ChatGPT 填的第一則留言保留）、延續跟著前一天實際的那一局；
 *   - image.ts：SVG／PNG、長行斷開。
 * 用 commit 進 repo 的題庫 sim_bank.json（實戰的局，沒有名字）。
 */

import fs from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSimBank, readSimBankFile, type SimBank } from '../bots/simulation/bank';
import { readRecordPosts } from '../bots/simulation/recordsIndex';
import { midDecision } from '../bots/simulation/scenario';
import { THREADS_ARTICLES, THREADS_MAX_CHARS, THREADS_TOPIC_TAG, answerText, buildDraft, draftMarkdown, pickView, postText, type ThreadsDraft } from '../bots/threads/draft';
import { ThreadsGenerator } from '../bots/threads/generate';
import { buildPuzzleSvg, renderPuzzlePng, textWidth, wrapLine } from '../bots/threads/image';
import { addDays, buildCandidates, planWeek, themeOf, weekIndexOf, weekdayOf, type ThreadsPick } from '../bots/threads/plan';

const serverRoot = path.resolve(__dirname, '..', '..');
let bank: SimBank;
let titles: Map<string, string>;

beforeAll(() => {
  const file = readSimBankFile([path.join(serverRoot, 'sim_bank.json')]);
  if (!file) throw new Error('sim_bank.json missing');
  bank = buildSimBank(file, readRecordPosts([path.join(serverRoot, 'records_cache.json')]));
  const wiki = JSON.parse(fs.readFileSync(path.join(serverRoot, 'wiki_data.json'), 'utf8')) as { id: string; title: string }[];
  titles = new Map(wiki.map((a) => [a.id, a.title] as [string, string]));
});

const gameOf = (pick: ThreadsPick) => bank.games[bank.byId.get(pick.gameId) as number];

describe('dates', () => {
  it('weekday, week index and day arithmetic follow the Taipei calendar date', () => {
    expect(weekdayOf('2026-11-16')).toBe(1);
    expect(weekdayOf('2026-11-22')).toBe(0);
    expect(weekIndexOf('2026-11-16')).toBe(0);
    expect(weekIndexOf('2026-11-22')).toBe(0);
    expect(weekIndexOf('2026-11-23')).toBe(1);
    expect(weekIndexOf('2026-11-15')).toBe(-1);
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(() => weekdayOf('2026-02-30')).toThrow();
  });

  it('the seven themes follow the 2026-11-11 schedule', () => {
    expect(themeOf(1).kind).toBe('assassin');
    expect(themeOf(2).kind).toBe('percival');
    expect(themeOf(3)).toMatchObject({ kind: 'tail', round: 1 });
    expect(themeOf(4)).toMatchObject({ kind: 'tail', round: 3, continues: true });
    expect(themeOf(5)).toMatchObject({ kind: 'tail', round: 2 });
    expect(themeOf(6)).toMatchObject({ kind: 'tail', round: 4, continues: true });
    expect(themeOf(0)).toMatchObject({ kind: 'final', round: 5 });
  });
});

describe('planWeek', () => {
  it('is reproducible, fills every day and links Wed→Thu and Fri→Sat in the same game', () => {
    const candidates = buildCandidates(bank);
    for (let week = 0; week < 12; week++) {
      const plan = planWeek(bank, week, candidates);
      expect(planWeek(bank, week, candidates)).toEqual(plan);
      expect(plan.every((p) => p !== null)).toBe(true);
      const [mon, tue, wed, thu, fri, sat, sun] = plan as ThreadsPick[];
      expect(mon.kind).toBe('assassin');
      expect(gameOf(mon).seatRoles[mon.seat - 1]).toBe('assassin');
      expect(tue.kind).toBe('percival');
      expect(gameOf(tue).seatRoles[tue.seat - 1]).toBe('percival');
      expect(gameOf(tue).proposals[tue.proposal as number].round).toBeGreaterThanOrEqual(2);
      expect(wed).toMatchObject({ kind: 'tail', round: 1 });
      expect(thu).toMatchObject({ kind: 'tail', round: 3, continues: true, gameId: wed.gameId });
      // 3-5 只出第二局開紅的局。
      expect(gameOf(thu).quests.find((q) => q.round === 2)?.failed).toBe(true);
      expect(midDecision(gameOf(thu), 3)).toBe(thu.proposal);
      expect(fri).toMatchObject({ kind: 'tail', round: 2 });
      expect(sat).toMatchObject({ kind: 'tail', round: 4, continues: true, gameId: fri.gameId });
      expect(sun.kind).toBe('final');
      expect(gameOf(sun).proposals[sun.proposal as number].round).toBe(5);
      // 同一週不出同一局兩次（週四、週六延續的除外）。
      const ids = [mon, tue, wed, fri, sun].map((p) => p.gameId);
      expect(new Set(ids).size).toBe(ids.length);
      // 每一題的隊長就是視角的座位。
      for (const p of [tue, wed, thu, fri, sat, sun]) expect(gameOf(p).proposals[p.proposal as number].leaderSeat).toBe(p.seat);
    }
  });

  it('prefers blue viewpoints and games with a records page, and moves on week to week', () => {
    const candidates = buildCandidates(bank);
    const seen = new Set<string>();
    for (let week = 0; week < 8; week++) {
      const plan = planWeek(bank, week, candidates) as ThreadsPick[];
      for (const p of plan.slice(1)) {
        expect(['loyal', 'percival', 'merlin']).toContain(gameOf(p).seatRoles[p.seat - 1]);
      }
      if (bank.records.size > 0) for (const p of plan) expect(bank.records.has(bank.byId.get(p.gameId) as number)).toBe(true);
      seen.add(plan[0].gameId);
    }
    expect(seen.size).toBe(8);
  });
});

describe('draft texts', () => {
  const week = (w: number) => planWeek(bank, w) as ThreadsPick[];

  it('every post and reply fits Threads (500 characters) and writes the tenth seat as 0家', () => {
    const gen = new ThreadsGenerator({ bank, titles, readSaved: () => null });
    for (let i = 0; i < 56; i++) {
      const date = addDays('2026-11-16', i);
      const d = gen.draftFor(date) as ThreadsDraft;
      expect(d.post.chars).toBeLessThanOrEqual(THREADS_MAX_CHARS);
      expect(d.post.text.split('\n').at(-1)).toBe(THREADS_TOPIC_TAG);
      expect([...d.post.text].length).toBe(d.post.chars);
      expect(d.replyToYesterday?.chars ?? 0).toBeLessThanOrEqual(THREADS_MAX_CHARS);
      for (const t of [d.post.text, d.replyToYesterday?.text ?? '']) {
        expect(t).not.toMatch(/10\s*[家號]/);
      }
      expect(d.post.text).toContain(d.exerciseId);
      expect(d.post.text).toContain(themeOf(weekdayOf(date)).label);
    }
  });

  it('the day after a continued puzzle reveals nothing; the day after that reveals both answers', () => {
    const [, , wed, thu] = week(0);
    const wedPv = pickView(gameOf(wed), wed);
    const thuPv = pickView(gameOf(thu), thu);
    const partial = answerText({ yesterday: wedPv, todayContinues: true, yesterdayWeekday: 3 });
    expect(partial).not.toMatch(/好 \d 壞/);
    expect(partial).not.toContain('角色：');
    expect(partial).toContain('明天公布');
    const full = answerText({ yesterday: thuPv, earlier: wedPv, todayContinues: false, recordId: 'abc123', yesterdayWeekday: 4 });
    expect(full).toContain(`前一題 ${wedPv.exerciseId}`);
    expect(full.match(/\d 好 \d 壞/g)?.length).toBe(2);
    expect(full).toContain('角色：');
    expect(full).toContain('#records=abc123');
    expect(full).toContain('下一題 →');
  });

  it('the assassin answer names Merlin and what the real assassin did', () => {
    const [mon] = week(0);
    const pv = pickView(gameOf(mon), mon);
    const text = answerText({ yesterday: pv, todayContinues: false, yesterdayWeekday: 1 });
    const merlin = gameOf(mon).seatRoles.indexOf('merlin') + 1;
    expect(text).toContain(`梅林是 ${merlin === 10 ? 0 : merlin}家`);
    expect(text).toContain('當時真人刺');
  });

  it('a continued post says which seat takes over and quotes yesterday', () => {
    const [, , wed, thu] = week(0);
    const d = buildDraft({
      date: '2026-11-19',
      today: pickView(gameOf(thu), thu),
      yesterday: { date: '2026-11-18', pv: pickView(gameOf(wed), wed) },
      titles,
    });
    expect(d.quoteYesterday).toBe(true);
    expect(d.post.text).toContain('接昨天那一局');
    expect(d.replyToYesterday?.text).toContain('明天公布');
  });

  it('long records shrink: earlier rounds keep only missions and lakes', () => {
    // 找一題完整牌譜寫不下的第 5 局題目。
    const candidates = buildCandidates(bank);
    const long = candidates.final.map((c) => c.picks[0]).find((p) => {
      const pv = pickView(gameOf(p), p);
      return pv.shown.filter((e) => e.kind === 'proposal').length > 22;
    });
    expect(long).toBeDefined();
    const pv = pickView(gameOf(long as ThreadsPick), long as ThreadsPick);
    const text = postText(pv, { weekday: 0 });
    expect([...text].length).toBeLessThanOrEqual(THREADS_MAX_CHARS);
    expect(text).toMatch(/第 1 局 任務/);
  });

  it('suggested articles exist in wiki_data.json and link the share pages', () => {
    for (const ids of Object.values(THREADS_ARTICLES)) for (const id of ids) expect(titles.has(id), id).toBe(true);
    const [mon] = week(0);
    const d = buildDraft({ date: '2026-11-16', today: pickView(gameOf(mon), mon), yesterday: null, titles });
    expect(d.firstComment.text).toBeNull();
    expect(d.firstComment.articles[0].url).toBe('https://avalon-game-platform.web.app/w/wiki-12/');
    expect(d.replyToYesterday).toBeNull();
    const md = draftMarkdown(d);
    expect(md).toContain('## ① 新貼文');
    expect(md).toContain('## ② 今天貼文的第一則留言（ChatGPT 填）');
  });
});

describe('ThreadsGenerator', () => {
  it('keeps a saved pick and ChatGPT’s first comment, and continues the saved game', () => {
    const fresh = new ThreadsGenerator({ bank, titles, readSaved: () => null });
    const planned = fresh.pickFor('2026-11-18') as ThreadsPick;
    // 找一局不同、也有 1-5 和 3-5 的局，假裝週三實際貼的是它。
    const other = buildCandidates(bank).wedThu.map((c) => c.picks[0]).find((p) => p.gameId !== planned.gameId) as ThreadsPick;
    const saved: Record<string, ThreadsDraft> = {};
    const wedDraft = fresh.draftFor('2026-11-18') as ThreadsDraft;
    saved['2026-11-18'] = { ...wedDraft, pick: other, firstComment: { ...wedDraft.firstComment, text: '冷知識' } };
    const gen = new ThreadsGenerator({ bank, titles, readSaved: (d) => saved[d] ?? null });
    expect(gen.pickFor('2026-11-18')).toEqual(other);
    expect(gen.draftFor('2026-11-18')?.firstComment.text).toBe('冷知識');
    const thu = gen.pickFor('2026-11-19') as ThreadsPick;
    expect(thu).toMatchObject({ gameId: other.gameId, round: 3, continues: true });
    const friday = gen.draftFor('2026-11-20') as ThreadsDraft;
    expect(friday.replyToYesterday?.text).toContain(`前一題 ${other.gameId}-1-5`);
  });
});

describe('image', () => {
  it('builds an SVG with the exercise id and renders a PNG', () => {
    const [mon, , wed] = planWeek(bank, 0) as ThreadsPick[];
    const pv = pickView(gameOf(wed), wed);
    const svg = buildPuzzleSvg(pv, 3);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(pv.exerciseId);
    expect(svg).toContain('週三・1-5 尾派');
    const png = renderPuzzlePng(pickView(gameOf(mon), mon), 1);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('wraps long lines at a comma or bracket', () => {
    expect(wrapLine('短', 30, 500)).toEqual(['短']);
    const parts = wrapLine('湖：0家 湖 8家，說好人（o）（你看到的：紅）', 26, 300);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(textWidth(p, 26)).toBeLessThanOrEqual(300);
  });
});
