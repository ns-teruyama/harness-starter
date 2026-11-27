// Markdown の相対リンクと見出しアンカーを検証する。Node.js の標準機能だけを使う。
// 使い方: node scripts/check-links.mjs [root] [--exclude <path>]...
// root はリポジトリのルート（既定はカレントディレクトリ）。root の外を指すリンクは問題として報告する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const BOM = String.fromCharCode(0xfeff);
const stripBom = s => (s.startsWith(BOM) ? s.slice(1) : s);

// GitHub（github-slugger 2.0.0）と同じ規則で見出しから ID を作る。
export function slug(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

// 同じ文書内で重複した ID に -1、-2 を付ける。
export function createSlugger() {
  const occurrences = Object.create(null);
  return {
    slug(text) {
      let result = slug(text);
      const original = result;
      while (Object.hasOwn(occurrences, result)) {
        occurrences[original]++;
        result = `${original}-${occurrences[original]}`;
      }
      occurrences[result] = 0;
      return result;
    },
  };
}

// エスケープした記号を、記法の除去から守るための一時的な置き換え文字（私用領域）。
const ESCAPE = String.fromCharCode(0xe000);

// 見出しの生の文字列から、表示されるテキストを取り出す。
export function headingText(raw) {
  const escaped = [];
  let text = raw.replace(/\\([!-/:-@[-`{-~])/g, (_, c) => { escaped.push(c); return ESCAPE; });
  text = text.replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+[ \t]*$/, '');
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, '$1');
  text = text.replace(/(`+)(.+?)\1/g, (_, __, code) => code.trim());
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, '');
  text = text.replace(/\*+|~~/g, '');
  text = text.replace(/(?<![\p{L}\p{N}])(_{1,2})(?=\S)(.+?)(?<=\S)\1(?![\p{L}\p{N}])/gu, '$2');
  let i = 0;
  text = text.replace(new RegExp(ESCAPE, 'g'), () => escaped[i++]);
  return text.trim();
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/;
const INLINE_LINK = /!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*(<[^>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
// 脚注の定義（[^1]: ...）は参照定義ではないので除く。
const REFERENCE = /^ {0,3}\[(?!\^)[^\]]+\]:\s*(<[^>\n]*>|\S+)/;
const HTML_ID = /<[A-Za-z][^>]*?\s(?:id|name)\s*=\s*["']([^"']+)["']/g;

// 長さを保ったまま空白に置き換え、列位置を崩さずに対象外の範囲を消す。
const blank = s => s.replace(/[^\n]/g, ' ');

// 1行のインラインコードと HTML コメントを、先に現れた順に処理する。
// text: 両方を空白にしたもの（リンク抽出用）、source: コメントだけを消したもの（見出し用）。
function stripInline(line) {
  let text = '';
  let source = '';
  let i = 0;
  while (i < line.length) {
    const tick = /`+/.exec(line.slice(i));
    const tickAt = tick ? i + tick.index : -1;
    const commentAt = line.indexOf('<!--', i);
    if (tickAt < 0 && commentAt < 0) break;
    if (commentAt >= 0 && (tickAt < 0 || commentAt < tickAt)) {
      const end = line.indexOf('-->', commentAt + 4);
      text += line.slice(i, commentAt);
      source += line.slice(i, commentAt);
      if (end < 0) return { text, source, openComment: true };
      text += blank(line.slice(commentAt, end + 3));
      i = end + 3;
      continue;
    }
    const close = line.indexOf(tick[0], tickAt + tick[0].length);
    // 同じ長さの区切りで閉じないバッククォートは、ただの文字として扱う。
    const isClosed = close >= 0 && line[close + tick[0].length] !== '`';
    const end = isClosed ? close + tick[0].length : tickAt + tick[0].length;
    text += line.slice(i, tickAt) + (isClosed ? blank(line.slice(tickAt, end)) : line.slice(tickAt, end));
    source += line.slice(i, end);
    i = end;
  }
  return { text: text + line.slice(i), source: source + line.slice(i), openComment: false };
}

// 1文書から、検査するリンクと、リンク先として使える ID を取り出す。
export function scanMarkdown(text) {
  const lines = stripBom(text).replace(/\r\n?/g, '\n').split('\n');
  const links = [];
  const anchors = new Set();
  const slugger = createSlugger();
  let fence = null;
  let inComment = false;
  let previous = '';      // 直前の行（インラインコードを消したもの）
  let previousSource = ''; // 直前の行（コメントだけを消したもの）
  let inList = false;
  let inIndentedCode = false;
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (fence) {
      // 閉じるフェンスは、開始と同じ記号で、開始以上の長さを持つ行。
      if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(raw)) fence = null;
      return;
    }
    let text = raw;
    if (inComment) {
      const end = text.indexOf('-->');
      if (end < 0) return;
      text = blank(text.slice(0, end + 3)) + text.slice(end + 3);
      inComment = false;
    }
    const open = FENCE.exec(text);
    if (open) { fence = open[1]; previous = ''; return; }
    const isBlank = text.trim() === '';
    if (/^(?: {4}|\t)/.test(text) && !isBlank && !inList && (previous.trim() === '' || inIndentedCode)) {
      inIndentedCode = true;
      return;
    }
    inIndentedCode = false;
    const inline = stripInline(text);
    if (inline.openComment) inComment = true;
    text = inline.text;

    // 見出しの ID は、コードの中身を残した文字列から作る。
    const atx = ATX.exec(inline.source);
    if (atx) anchors.add(slugger.slug(headingText(atx[2] ?? '')));
    else if (SETEXT.test(text) && previous.trim() && !ATX.test(previous) && !LIST_ITEM.test(previous)
      && !(text.trim().startsWith('-') && previous.trim().startsWith('|'))) {
      anchors.add(slugger.slug(headingText(previousSource.trim())));
    }
    for (const m of text.matchAll(HTML_ID)) anchors.add(m[1]);
    const ref = REFERENCE.exec(text);
    if (ref) links.push({ line, target: ref[1] });
    else for (const m of text.matchAll(INLINE_LINK)) links.push({ line, target: m[1] });

    if (!isBlank) inList = LIST_ITEM.test(text) || (inList && /^\s/.test(text));
    previous = text;
    previousSource = inline.source;
  });
  return { links, anchors };
}

// どの階層にあっても走査しないディレクトリ名。
const SKIP_DIRS = new Set(['node_modules', '.git']);
const toPosix = p => p.replaceAll('\\', '/');

// Git の作業ツリーなら、追跡中と未追跡（無視設定に当たらないもの）の Markdown を返す。
// Git を使えない場合は null を返し、ファイルシステムの走査に任せる。
function gitMarkdownFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [...new Set(out.split('\0').filter(Boolean))]
      .filter(f => f.toLowerCase().endsWith('.md') && fs.existsSync(path.join(root, f)));
  } catch {
    return null;
  }
}

function walkMarkdownFiles(root) {
  const out = [];
  const walk = rel => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(child); }
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(child);
    }
  };
  walk('');
  return out;
}

function markdownFiles(root, exclude) {
  const files = gitMarkdownFiles(root) ?? walkMarkdownFiles(root);
  return files
    .filter(f => !f.split('/').some(part => SKIP_DIRS.has(part)))
    .filter(f => !exclude.some(x => f === x || f.startsWith(`${x}/`)))
    .sort();
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

// root からの相対パスを、大文字小文字まで一致する実在の名前で解決する。
// 見つからなければ null を返す。名前は Unicode の正規化（NFC）をそろえて比べる。
// macOS では、日本語の濁点を分けた形（NFD）でファイル名が保存されることがあるため。
function resolveExactly(root, rel, cache) {
  let dir = root;
  const actual = [];
  for (const part of rel.split('/').filter(Boolean)) {
    if (!cache.has(dir)) {
      let names = null;
      try { names = new Map(fs.readdirSync(dir).map(n => [n.normalize('NFC'), n])); } catch { names = null; }
      cache.set(dir, names);
    }
    const name = cache.get(dir)?.get(part.normalize('NFC'));
    if (name === undefined) return null;
    actual.push(name);
    dir = path.join(dir, name);
  }
  return actual.join('/');
}

// root 配下の Markdown を全件検査し、壊れたリンクを返す。
export function checkLinks(root, options = {}) {
  root = path.resolve(root);
  const exclude = [...(options.exclude ?? []).map(x => toPosix(x).replace(/^\.\/|\/+$/g, ''))];
  const files = markdownFiles(root, exclude);
  const scans = new Map(files.map(f => [f, scanMarkdown(fs.readFileSync(path.join(root, f), 'utf8'))]));
  const cache = new Map();
  const anchorsOf = rel => {
    if (!scans.has(rel)) scans.set(rel, scanMarkdown(fs.readFileSync(path.join(root, rel), 'utf8')));
    return scans.get(rel).anchors;
  };
  const problems = [];
  let count = 0;
  for (const file of files) {
    for (const { line, target } of scans.get(file).links) {
      count++;
      const report = reason => problems.push({ file, line, reason, target });
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
      const bare = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
      if (!bare.trim()) { report('宛先が空です'); continue; }
      const hash = bare.indexOf('#');
      const anchor = hash < 0 ? null : decode(bare.slice(hash + 1));
      const linkPath = decode((hash < 0 ? bare : bare.slice(0, hash)).replace(/\?.*$/, ''));
      let rel = file;
      if (linkPath) {
        const base = linkPath.startsWith('/') ? '' : path.posix.dirname(file);
        rel = path.posix.normalize(path.posix.join(base, linkPath)).replace(/\/+$/, '');
        if (rel === '..' || rel.startsWith('../')) { report('リポジトリ外を指しています'); continue; }
        if (rel === '.') rel = '';
        if (rel) {
          const actual = resolveExactly(root, rel, cache);
          if (actual === null) { report('ファイルが存在しません'); continue; }
          rel = actual;
        }
      }
      if (anchor && rel.toLowerCase().endsWith('.md') && !anchorsOf(rel).has(anchor)) report('見出しが存在しません');
    }
  }
  checkLinks.lastStats = { files: files.length, links: count };
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const exclude = [];
  let root = '.';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exclude') exclude.push(args[++i]);
    else root = args[i];
  }
  try {
    const problems = checkLinks(root, { exclude });
    for (const p of problems) console.error(`${p.file}:${p.line}: ${p.reason}: ${p.target}`);
    const { files, links } = checkLinks.lastStats;
    if (problems.length) {
      console.error(`リンク検証: ${files}ファイル、${links}件、問題${problems.length}件`);
      process.exitCode = 1;
    } else console.log(`リンク検証: ${files}ファイル、${links}件、問題なし`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
