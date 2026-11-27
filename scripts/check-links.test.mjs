import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { slug, createSlugger, headingText, checkLinks } from './check-links.mjs';
const BOM = String.fromCharCode(0xfeff);

// 一時ディレクトリにファイルを書き、そのディレクトリを root として返す。
function repo(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-links-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(root, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return root;
}
const targets = result => result.map(r => `${r.reason}: ${r.target}`);

test('slugは日本語と英数字を保ち記号を除く', () => {
  assert.equal(slug('設計全体レビューの手順と終了条件'), '設計全体レビューの手順と終了条件');
  assert.equal(slug('DEC-043: 方針（案）'), 'dec-043-方針案');
  assert.equal(slug('A & B'), 'a--b');
  assert.equal(slug('全角　空白'), '全角空白');
});

test('重複見出しに番号を付ける', () => {
  const s = createSlugger();
  assert.deepEqual(['概要', '概要', '概要'].map(x => s.slug(x)), ['概要', '概要-1', '概要-2']);
  const t = createSlugger();
  assert.deepEqual(['a', 'a-1', 'a'].map(x => t.slug(x)), ['a', 'a-1', 'a-2']);
});

test('headingTextは記法を表示テキストに落とす', () => {
  assert.equal(headingText('[要件](a.md)の`ID`規則 ##'), '要件のID規則');
  assert.equal(headingText('**強調**と\\*記号'), '強調と*記号');
  assert.equal(headingText('<span>x</span> y'), 'x y');
});

test('存在するファイルとディレクトリへのリンクは問題なし', t => {
  const root = repo(t, { 'a.md': '[a](b.md) [d](sub/) [e](sub)\n', 'b.md': '# b\n', 'sub/x.md': '' });
  assert.deepEqual(checkLinks(root), []);
});

test('存在しないファイルを報告する', t => {
  const root = repo(t, { 'a.md': '# a\n\n[x](nope.md)\n' });
  assert.deepEqual(checkLinks(root), [{ file: 'a.md', line: 3, reason: 'ファイルが存在しません', target: 'nope.md' }]);
});

test('大文字小文字が異なるリンク先をエラーにする', t => {
  const root = repo(t, { 'a.md': '[r](Readme.md) [s](Sub/x.md)\n', 'README.md': '', 'sub/x.md': '' });
  assert.deepEqual(targets(checkLinks(root)), ['ファイルが存在しません: Readme.md', 'ファイルが存在しません: Sub/x.md']);
});

test('別ファイルと同一ファイルのアンカーを判定する', t => {
  const root = repo(t, {
    'a.md': '[1](b.md#手順) [2](b.md#無い) [3](b.md#setext見出し) [4](b.md#概要-1)\n',
    'b.md': '# 手順\n\nSetext見出し\n---\n\n## 概要\n\n## 概要\n',
  });
  assert.deepEqual(targets(checkLinks(root)), ['見出しが存在しません: b.md#無い']);
});

test('アンカーだけのリンクを同一ファイルで判定する', t => {
  const root = repo(t, { 'a.md': '# 概要\n\n[1](#概要) [2](b.md?x=1#概要) [3](#無い)\n', 'b.md': '# 概要\n' });
  assert.deepEqual(targets(checkLinks(root)), ['見出しが存在しません: #無い']);
});

test('HTMLアンカーを見出しとして認める', t => {
  const root = repo(t, { 'a.md': '<a id="dec-001"></a>\n<div id="box"></div>\n<a name="old"></a>\n\n[1](#dec-001) [2](#box) [3](#old)\n' });
  assert.deepEqual(checkLinks(root), []);
});

test('インデントコードと閉じないフェンスを除外する', t => {
  const root = repo(t, {
    'a.md': [
      '`[x](nope1.md)`', '', '<!-- [x](nope2.md) -->', '', '```', '[x](nope3.md)', '```', '',
      '~~~md', '[x](nope4.md)', '~~~', '', '    [x](nope5.md)', '', '[ok](nope6.md)', '', '```', '[x](nope7.md)',
    ].join('\n'),
  });
  assert.deepEqual(targets(checkLinks(root)), ['ファイルが存在しません: nope6.md']);
});

test('参照定義・山括弧・パーセントエンコードを扱う', t => {
  const root = repo(t, {
    'a.md': '[r]\n\n[r]: b.md#手順\n[bad]: nope.md\n\n[a](<b c.md>) [p](%E6%89%8B.md)\n',
    'b.md': '# 手順\n', 'b c.md': '', '手.md': '',
  });
  assert.deepEqual(targets(checkLinks(root)), ['ファイルが存在しません: nope.md']);
});

test('外部URLとmailtoは検査しない', t => {
  const root = repo(t, { 'a.md': '[1](https://x.invalid/) [2](mailto:a@b) [3](//x) ![i](http://x.invalid/i.png)\n' });
  assert.deepEqual(checkLinks(root), []);
});

test('リポジトリ外を指すリンクを報告する', t => {
  const root = repo(t, { 'a.md': '[o](../outside.md)\n' });
  assert.deepEqual(targets(checkLinks(root)), ['リポジトリ外を指しています: ../outside.md']);
});

test('CRLFでもLFと同じ結果になる', t => {
  const text = '# 概要\n\n```\n[x](n1.md)\n```\n\n[y](#概要) [z](n2.md)\n';
  const lf = checkLinks(repo(t, { 'a.md': text }));
  const crlf = checkLinks(repo(t, { 'a.md': text.replaceAll('\n', '\r\n') }));
  assert.deepEqual(crlf, lf);
  assert.deepEqual(lf, [{ file: 'a.md', line: 7, reason: 'ファイルが存在しません', target: 'n2.md' }]);
});

test('除外パスを走査しない', t => {
  const root = repo(t, { 'node_modules/x.md': '[x](n.md)', 'vendor/y.md': '[y](n.md)', 'docs/z.md': '[z](n.md)' });
  assert.deepEqual(checkLinks(root, { exclude: ['vendor'] }).map(r => r.file), ['docs/z.md']);
});

test('インラインコードを含む見出しのIDにコードの中身を残す', t => {
  const root = repo(t, { 'a.md': '## `foo` の設定\n\n[a](#foo-の設定)\n' });
  assert.deepEqual(checkLinks(root), []);
});

test('インラインコード中のコメント開始記号で走査を止めない', t => {
  const root = repo(t, { 'a.md': '`<!--` を使う\n\n# 後の見出し\n\n[b](nope.md) [c](#後の見出し)\n' });
  assert.deepEqual(targets(checkLinks(root)), ['ファイルが存在しません: nope.md']);
});

test('脚注の定義をリンクとして扱わない', t => {
  const root = repo(t, { 'a.md': '本文[^1]\n\n[^1]: 補足の説明 です\n' });
  assert.deepEqual(checkLinks(root), []);
});

test('Gitで無視されたファイルと入れ子のnode_modulesを走査しない', t => {
  const root = repo(t, {
    '.gitignore': 'ignored/\n', 'ignored/x.md': '[x](n.md)', 'tools/node_modules/y.md': '[y](n.md)',
    'untracked.md': '[u](n.md)',
  });
  execFileSync('git', ['init', '-q', root]);
  assert.deepEqual(checkLinks(root).map(r => r.file), ['untracked.md']);
  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  assert.deepEqual(checkLinks(root, { exclude: ['ignored'] }).map(r => r.file), ['untracked.md']);
});

test('BOM付きファイルの先頭の見出しを認識する', t => {
  const root = repo(t, { 'a.md': BOM + '# 概要\n\n[a](#概要)\n' });
  assert.deepEqual(checkLinks(root), []);
});

test('濁点を分けた形（NFD）で保存されたファイル名へのリンクを認める', t => {
  const dir = 'データ'.normalize('NFD');
  const root = repo(t, { 'a.md': '[a](データ/ガイド.md#手順) [b](データ/無い.md)\n', [`${dir}/${'ガイド'.normalize('NFD')}.md`]: '# 手順\n' });
  assert.deepEqual(targets(checkLinks(root)), ['ファイルが存在しません: データ/無い.md']);
});

test('画像と空の宛先を判定する', t => {
  const root = repo(t, { 'a.md': '![i](img/none.png) [e]()\n' });
  assert.deepEqual(targets(checkLinks(root)), ['ファイルが存在しません: img/none.png', '宛先が空です: ']);
});
