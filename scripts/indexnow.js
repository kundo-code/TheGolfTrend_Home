#!/usr/bin/env node
/**
 * IndexNow — 바뀐 페이지 주소를 Bing 등 검색엔진에 바로 알린다(https://www.indexnow.org).
 *
 * 쓰는 때: build-seo-pages 워크플로에서 "정적 페이지를 커밋·푸시한 직후"에 실행한다(바뀐 게 없으면 아무것도 하지 않음).
 * 키:      저장소 맨 위에 "<키>.txt" 파일(파일 안의 내용도 같은 키 한 줄)이 있으면 그 키를 쓴다. 없으면 건너뛴다(오류 아님).
 *          키 만드는 법: docs/seo-static-pages.md 의 "IndexNow" 항목.
 * 무엇을:  base~head 사이에 바뀐 golf/**\/index.html 중 "내용이 진짜 바뀐" 것만. "등록 정보 기준일 YYYY-MM-DD"만 바뀐 페이지는 제외한다.
 *
 * 실행:  node scripts/indexnow.js [--dry-run] [--base <커밋>] [--head <커밋>]   (기본 base=HEAD~1, head=HEAD)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'thegolftrend.co.kr';
const ORIGIN = 'https://' + HOST;

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const dry = process.argv.includes('--dry-run');
const base = arg('--base', 'HEAD~1');
const head = arg('--head', 'HEAD');

const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } };
// 날짜 표시만 바뀐 경우를 "변경 없음"으로 보기 위해 기준일을 지운 뒤 비교한다
const norm = t => String(t == null ? '' : t).replace(/기준일\s*\d{4}-\d{2}-\d{2}/g, '기준일 -');

function findKey() {
  for (const f of fs.readdirSync(ROOT)) {
    if (!/^[A-Za-z0-9-]{8,128}\.txt$/.test(f)) continue;
    const key = f.slice(0, -4);
    if (fs.readFileSync(path.join(ROOT, f), 'utf8').trim() === key) return key;
  }
  return '';
}

const toUrl = f => ORIGIN + '/' + f.replace(/index\.html$/, '');

(async () => {
  const key = findKey();
  if (!key) { console.log('IndexNow: 키 파일(<키>.txt)이 없어 건너뜁니다.'); return; }
  const out = git('diff', '--name-status', base, head, '--', 'golf');
  if (out == null) { console.log(`IndexNow: ${base}..${head} 비교에 실패해 건너뜁니다.`); return; }
  const urls = [];
  out.split('\n').filter(Boolean).forEach(l => {
    const [st, f] = l.split('\t');
    if (!f || !/^golf\/.*index\.html$/.test(f)) return;
    if (st[0] === 'M') {
      if (norm(git('show', `${base}:${f}`)) === norm(git('show', `${head}:${f}`))) return; // 날짜만 바뀜
    }
    urls.push(toUrl(f)); // 추가(A)·내용 변경(M)·삭제(D) 모두 알린다
  });
  if (!urls.length) { console.log('IndexNow: 내용이 바뀐 페이지가 없어 알리지 않습니다.'); return; }
  const body = { host: HOST, key, keyLocation: `${ORIGIN}/${key}.txt`, urlList: urls.slice(0, 10000) };
  console.log(`IndexNow: 바뀐 페이지 ${urls.length}개`);
  urls.forEach(u => console.log('  ' + u));
  if (dry) { console.log('(--dry-run: 전송하지 않음)'); return; }
  const res = await fetch('https://api.indexnow.org/IndexNow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  console.log(`IndexNow 응답: ${res.status} ${res.statusText}`);
  // 200·202는 접수 성공. 그 외는 로그만 남기고 워크플로는 실패시키지 않는다(알림 실패가 페이지 갱신을 막으면 안 됨)
})().catch(e => { console.error('IndexNow 오류(무시):', e.message); });
