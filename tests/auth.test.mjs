import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authArgs, canonicalSource, filterYouTubeCookies, normalizeAuth} from '../lib/auth.mjs';
import {downloadError} from '../lib/errors.mjs';

test('cookies do navegador entram nos argumentos de links do YouTube',()=>{
  const settings={authentication:{method:'browser',browser:'brave',profile:'Profile 1'}};
  assert.deepEqual(authArgs('https://youtu.be/abcDEFghI12',settings,'/tmp'),['--cookies-from-browser','brave:Profile 1']);
  assert.deepEqual(authArgs('https://youtube.com.evil.example/video',settings,'/tmp'),[]);
  assert.deepEqual(authArgs('https://example.com/video',settings,'/tmp'),[]);
});
test('validação de opções não permite navegadores e métodos desconhecidos',()=>{
  assert.throws(()=>normalizeAuth({method:'browser',browser:'unknown'}));
  assert.throws(()=>normalizeAuth({method:'password'}));
  assert.throws(()=>normalizeAuth({method:'browser',profile:'Default\n--unsafe'}));
});
test('links curtos, Shorts e watch têm a mesma identidade',()=>{
  const expected='https://www.youtube.com/watch?v=abcDEFghI12';
  assert.equal(canonicalSource('https://youtu.be/abcDEFghI12?si=test'),expected);
  assert.equal(canonicalSource('https://www.youtube.com/shorts/abcDEFghI12'),expected);
  assert.equal(canonicalSource(expected+'&t=120'),expected);
});
test('importação guarda apenas cookies válidos do YouTube',()=>{
  const value='# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tSID\tdummy-test-value\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2000000000\tHSID\tdummy-http-only\n.google.com\tTRUE\t/\tTRUE\t2000000000\tSID\tshould-not-be-stored\n';
  const result=filterYouTubeCookies(value);
  assert.equal(result.count,2);assert.match(result.text,/#HttpOnly_/);
  assert.doesNotMatch(result.text,/google.com|should-not-be-stored/);
  assert.throws(()=>filterYouTubeCookies('invalid'));
});
test('erros de verificação, cookies e limite têm orientação específica',()=>{
  assert.equal(downloadError("Sign in to confirm you're not a bot").status,'auth_required');
  assert.equal(downloadError('Could not copy Chrome cookie database').code,'COOKIE_ACCESS');
  assert.equal(downloadError('Failed to decrypt with DPAPI').pauseQueue,true);
  assert.equal(downloadError('HTTP Error 429: Too Many Requests').status,'blocked');
  assert.equal(downloadError('Requested format is not available').code,'FORMAT_UNAVAILABLE');
});
