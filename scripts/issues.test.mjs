import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, itemPath, serialize, parse, load, indexes, build, create } from './issues.mjs';
const BOM = String.fromCharCode(0xfeff);

function fixture(n = 1, overrides = {}) {
  return { id: `DEV-${String(n).padStart(4, '0')}`, title: '保存結果の照合', kind: 'bug', status: 'open', recorded_on: '2026-11-19', closed_on: null, resolution: null, duplicate_of: null, depends_on: [], ...overrides };
}
// hold を渡すと「保留」の節を加える。
function body(meta, { action = '保存契約に従う。', result = '異常終了後の再開を確認した。', hold } = {}) {
  const held = hold === undefined ? '' : `\n## 保留\n\n${hold}\n`;
  return `# ${meta.id} ${meta.title}\n\n## 課題\n\n異常終了後の再開を確認する。\n\n## 完了条件\n\n確定した世代から再開する。\n\n## 判断・対応内容\n\n${action}\n\n## 確認結果\n\n${result}\n${held}`;
}
const text = (meta, options) => serialize(meta, body(meta, options));
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-issues-'));
  t.after(() => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('harness-issues-'));
    fs.rmSync(root, { recursive: true });
  });
  return root;
}
function put(root, meta, options) {
  const p = path.join(root, itemPath(meta.id));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text(meta, options));
  return p;
}
const closedAs = (resolution, overrides = {}) => ({ status: 'closed', closed_on: '2026-11-19', resolution, ...overrides });

test('IDの100件境界と4桁を超える番号を安定したパスへ対応させる', () => {
  for (const [id, bucket] of [['DEV-0001', '0001-0100'], ['DEV-0100', '0001-0100'], ['DEV-0101', '0101-0200'], ['DEV-10000', '9901-10000'], ['DEV-10001', '10001-10100']]) {
    assert.equal(itemPath(id), `${bucket}/${id}.md`);
  }
  for (const id of ['DEV-0000', 'DEV-1', 'DEV-00001', '../DEV-0001', 'DEV-9007199254740992']) assert.throws(() => itemPath(id));
});

test('LFとCRLFで同じ課題を読み込み、メタデータ不足・未知キーを受け付けない', () => {
  const source = text(fixture());
  assert.deepEqual(parse(source, 'test'), parse(source.replaceAll('\n', '\r\n'), 'test'));
  assert.throws(() => parse('# DEV-0001 メタデータなし', 'test'), /メタデータ/);
  assert.throws(() => parse(source.replace('---\n', '---\nunknown: null\n'), 'test'), /フィールド/);
  assert.throws(() => parse(source.replace('status: "open"', 'status: "open"\nstatus: "closed"'), 'test'), /フィールド/);
  assert.throws(() => parse(source.replace('duplicate_of: null\n', ''), 'test'), /必須フィールド/);
});

test('一覧と検査に使わない項目は front matter で受け付けない', () => {
  const source = text(fixture());
  for (const line of ['fixed_in: null', 'affected_versions: []', 'external_urls: []', 'hold_reason: null']) {
    assert.throws(() => parse(source.replace('---\n', `---\n${line}\n`), 'test'), /不正・重複フィールド/);
  }
});

test('種類・状態・日付・完了・重複先の組み合わせを検証する', () => {
  for (const overrides of [{ status: 'done' }, { recorded_on: '2026-02-30' }, { closed_on: '2026-11-19' }, { status: 'closed', closed_on: '2026-11-18', resolution: 'resolved' }, { duplicate_of: 'DEV-0002' }]) {
    assert.throws(() => parse(text(fixture(1, overrides)), 'test'));
  }
});

test('保留の節は、保留中の課題だけが内容つきで持つ', () => {
  const held = fixture(1, { status: 'deferred' });
  assert.throws(() => parse(text(held), 'test'), /保留/);
  assert.throws(() => parse(text(held, { hold: '' }), 'test'), /保留/);
  assert.equal(parse(text(held, { hold: '理由：実機待ち。影響：対応OSの保証。解消条件：実機の確保。' }), 'test').status, 'deferred');
  assert.throws(() => parse(text(fixture(), { hold: '理由：実機待ち。' }), 'test'), /保留/);
});

test('解決で完了する課題は、確認結果を必須とする', () => {
  const closed = fixture(1, closedAs('resolved'));
  for (const result of ['未実施。', '未確認。', '']) {
    assert.throws(() => parse(text(closed, { result }), 'test'), /完了根拠/);
  }
  assert.equal(parse(text(closed), 'test').status, 'closed');
});

test('重複・対応しないで完了する課題は、確認結果ではなく理由の記録を必須とする', () => {
  const dropped = fixture(1, closedAs('not_planned'));
  assert.equal(parse(text(dropped, { action: '受入ケースと重複するため取り下げる。', result: '未実施。' }), 'test').status, 'closed');
  assert.throws(() => parse(text(dropped, { action: '未着手。', result: '未実施。' }), 'test'), /判断・対応内容/);
  const resolved = fixture(1, closedAs('resolved'));
  assert.throws(() => parse(text(resolved, { action: '未着手。' }), 'test'), /判断・対応内容/);
});

test('数百件あっても未完了と同年の完了一覧を件数で分割しない', () => {
  const active = Array.from({ length: 301 }, (_, n) => fixture(n + 1));
  const closed = active.map(i => ({ ...i, ...closedAs('resolved') }));
  for (const [list, page] of [[active, 'index.md'], [closed, 'closed-2026.md']]) {
    const result = indexes(list);
    assert.equal((result.get(page).match(/\| \[DEV-/g) ?? []).length, 301);
  }
});

test('未完了一覧は登録日を示し、完了一覧は重複先へリンクする', () => {
  const result = indexes([
    fixture(1, { recorded_on: '2026-10-01' }),
    fixture(2, closedAs('duplicate', { duplicate_of: 'DEV-0001' })),
    fixture(3, closedAs('resolved')),
  ]);
  assert.match(result.get('index.md'), /\| ID \| 課題 \| 種類 \| 状態 \| 先行（未完了） \| 登録日 \|/);
  assert.match(result.get('index.md'), /\| 不具合 \| 未着手 \|  \| 2026-10-01 \|/);
  const closed = result.get('closed-2026.md');
  assert.match(closed, /\| ID \| 課題 \| 種類 \| 完了理由 \| 完了日 \|\n/);
  assert.match(closed, /\| 重複（\[DEV-0001\]\(0001-0100\/DEV-0001\.md\)） \| 2026-11-19 \|/);
  assert.match(closed, /\| 解決 \| 2026-11-19 \|/);
  assert.match(closed, /\[未完了一覧へ戻る\]\(index\.md\)/);
});

test('完了年ごとの一覧へは未完了一覧から新しい年の順にリンクし、入口だけのページを作らない', () => {
  const result = indexes([
    fixture(1),
    fixture(2, closedAs('resolved')),
    fixture(3, closedAs('resolved')),
    fixture(4, closedAs('resolved', { closed_on: '2027-01-05' })),
  ]);
  assert.deepEqual([...result.keys()], ['index.md', 'closed-2027.md', 'closed-2026.md']);
  assert.match(result.get('index.md'), /\n完了3件。\[2027年\]\(closed-2027\.md\)（1件）・\[2026年\]\(closed-2026\.md\)（2件）\n/);
  assert.deepEqual([...indexes([fixture(1)]).keys()], ['index.md']);
  assert.match(indexes([fixture(1)]).get('index.md'), /\n完了0件。\n/);
});

test('完了一覧は完了日の新しい順に並べ、同じ日は桁数が違っても番号の順にする', () => {
  const closed = indexes([
    fixture(9999, closedAs('resolved')),
    fixture(10000, closedAs('resolved')),
    fixture(2, closedAs('resolved', { closed_on: '2026-12-01' })),
  ]).get('closed-2026.md');
  assert.deepEqual(closed.match(/\[DEV-\d+\]/g), ['[DEV-0002]', '[DEV-9999]', '[DEV-10000]']);
});

test('新規課題は登録日を持ち、不具合には再現手順と版の記入を促す', t => {
  const root = temp(t);
  const bug = fs.readFileSync(path.join(root, create(root, 'bug', 'x')), 'utf8');
  assert.ok(bug.includes(`recorded_on: "${new Date().getFullYear()}-`));
  assert.ok(bug.includes('再現手順') && bug.includes('影響する版'));
  const decision = fs.readFileSync(path.join(root, create(root, 'decision', 'y')), 'utf8');
  assert.ok(!decision.includes('再現手順') && !decision.includes('影響する版'));
});

test('JSONではない値は、ファイル名と行を示して拒否する', () => {
  assert.throws(() => parse(text(fixture()).replace('status: "open"', 'status: open'), 'a.md'), /a\.md: status: open/);
});

test('100件単位のディレクトリ以外に置いた課題を見落とさない', t => {
  const root = temp(t); const p = put(root, fixture());
  fs.mkdirSync(path.join(root, 'misc'));
  fs.copyFileSync(p, path.join(root, 'misc', 'DEV-0002.md'));
  assert.throws(() => load(root), /misc/);
});

test('完了と再開で個別ファイルを移動せず、古い生成ページだけを除く', t => {
  const root = temp(t); const meta = fixture(); const p = put(root, meta);
  build(root); assert.equal(build(root, true), 1);
  put(root, { ...meta, ...closedAs('resolved') });
  assert.throws(() => build(root, true), /索引が未更新/);
  build(root); assert.ok(fs.existsSync(path.join(root, 'closed-2026.md')));
  assert.ok(!fs.readFileSync(path.join(root, 'index.md'), 'utf8').includes('[DEV-0001]'));
  put(root, meta);
  assert.throws(() => build(root, true), /索引が未更新: .*closed-2026\.md/);
  build(root);
  assert.ok(fs.existsSync(p)); assert.ok(!fs.existsSync(path.join(root, 'closed-2026.md')));
  assert.equal(build(root, true), 1);
});

test('手書きファイルが生成先にあると変更前に中止する', t => {
  const root = temp(t); put(root, fixture(1, closedAs('resolved')));
  fs.writeFileSync(path.join(root, 'index.md'), '手書きの内容');
  assert.throws(() => build(root), /手書き/);
  assert.equal(fs.readFileSync(path.join(root, 'index.md'), 'utf8'), '手書きの内容');
  assert.ok(!fs.existsSync(path.join(root, 'closed-2026.md')));
});

test('不存在の重複先・誤った配置を拒否する', t => {
  const root = temp(t); put(root, fixture(1));
  put(root, fixture(2, closedAs('duplicate', { duplicate_of: 'DEV-0003' })));
  assert.throws(() => load(root), /重複先が存在/);
  const p = put(root, fixture(2));
  fs.renameSync(p, path.join(path.dirname(p), 'DEV-0003.md'));
  assert.throws(() => load(root), /保存先/);
});

test('新規課題は最大番号の次を採番し、100件境界で新しいディレクトリを使う', t => {
  const root = temp(t); const p = put(root, fixture(100)); const before = fs.readFileSync(p, 'utf8');
  assert.equal(create(root, 'bug', '再開の不具合'), '0101-0200/DEV-0101.md');
  assert.equal(fs.readFileSync(p, 'utf8'), before);
  assert.equal(build(root, true), 2);
});

test('課題0件でbuildとcheckが成功する', t => {
  const root = temp(t);
  assert.equal(build(root), 0);
  assert.equal(build(root, true), 0);
  assert.ok(fs.readFileSync(path.join(root, 'index.md'), 'utf8').includes('該当する課題はありません。'));
  assert.deepEqual(fs.readdirSync(root), ['index.md']);
});

test('接頭辞を変えても採番・パス・検査が成り立つ', t => {
  const root = temp(t); const original = config.prefix;
  config.prefix = 'TASK'; t.after(() => { config.prefix = original; });
  assert.equal(create(root, 'bug', 'x'), '0001-0100/TASK-0001.md');
  assert.equal(build(root, true), 1);
  assert.ok(fs.readFileSync(path.join(root, 'index.md'), 'utf8').includes('[TASK-0001]'));
});

test('configで変えられるのは接頭辞と表示だけで、必須節は固定する', t => {
  assert.equal(Object.hasOwn(config, 'sections'), false);
  const root = temp(t); const original = { ...config.kinds }; const title = config.indexTitle;
  config.kinds.bug = 'バグ'; config.indexTitle = '課題';
  t.after(() => { Object.assign(config.kinds, original); config.indexTitle = title; });
  create(root, 'bug', 'x');
  assert.equal(build(root, true), 1);
  const index = fs.readFileSync(path.join(root, 'index.md'), 'utf8');
  assert.ok(index.includes('# 課題：未完了') && index.includes('| バグ |'));
});

test('BOM付きの課題ファイルを読み込む', () => {
  const source = text(fixture());
  assert.deepEqual(parse(BOM + source, 'test'), parse(source, 'test'));
});

test('生成一覧から README と管理ルールへ、課題フォルダーの位置に応じた相対リンクを張る', () => {
  const result = indexes([]);
  assert.match(result.get('index.md'), /\[管理ルール\]\(\.\.\/issue-management\.md\)/);
  assert.match(result.get('index.md'), /\[README\]\(\.\.\/\.\.\/\.\.\/README\.md\)/);
});

test('作業を種類として登録でき、ひな形は要件と成果物の記入を促す', t => {
  const root = temp(t);
  const task = fs.readFileSync(path.join(root, create(root, 'task', '保存処理を実装する')), 'utf8');
  assert.ok(task.includes('kind: "task"') && task.includes('depends_on: []'));
  assert.ok(task.includes('対応する要件') && task.includes('成果物'));
  assert.ok(fs.readFileSync(path.join(root, 'index.md'), 'utf8').includes('| 作業 |'));
  const bug = fs.readFileSync(path.join(root, create(root, 'bug', 'x')), 'utf8');
  assert.ok(!bug.includes('対応する要件'));
});

test('先行課題は、重複のない自分以外の課題IDの配列で指定する', () => {
  assert.deepEqual(parse(text(fixture(2, { depends_on: ['DEV-0001'] })), 'test').depends_on, ['DEV-0001']);
  for (const depends_on of [null, 'DEV-0001', ['DEV-1'], ['DEV-0002'], ['DEV-0001', 'DEV-0001']]) {
    assert.throws(() => parse(text(fixture(2, { depends_on })), 'test'), /先行課題が不正/);
  }
});

test('存在しない先行課題と、先行関係の循環を拒否する', t => {
  const root = temp(t);
  put(root, fixture(1, { depends_on: ['DEV-0009'] }));
  assert.throws(() => load(root), /先行課題が存在しません: DEV-0001/);
  put(root, fixture(1, { depends_on: ['DEV-0003'] }));
  put(root, fixture(2, { depends_on: ['DEV-0001'] }));
  put(root, fixture(3, { depends_on: ['DEV-0002'] }));
  assert.throws(() => load(root), /先行関係が循環/);
  put(root, fixture(1));
  assert.equal(load(root).length, 3);
});

test('未完了一覧は、未完了の先行課題だけをリンクで示す', () => {
  const index = indexes([
    fixture(1, closedAs('resolved')),
    fixture(2),
    fixture(3, { depends_on: ['DEV-0001', 'DEV-0002'], recorded_on: '2026-10-01' }),
    fixture(4, { depends_on: ['DEV-0001'], recorded_on: '2026-10-02' }),
  ]).get('index.md');
  assert.match(index, /\| 未着手 \| \[DEV-0002\]\(0001-0100\/DEV-0002\.md\) \| 2026-10-01 \|/);
  assert.match(index, /\| 未着手 \|  \| 2026-10-02 \|/);
});
