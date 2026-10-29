const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/home/claude/kahyo/assets/learn/';
const U = 'http://localhost:8787/';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const shots = {};
  const box = async (sel) => { const e = await p.$(sel); if (!e) return null; const r = await e.boundingBox(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const shoot = async (name, marks, clip) => {
    const vw = clip ? clip.width : 1440, vh = clip ? clip.height : 900, ox = clip ? clip.x : 0, oy = clip ? clip.y : 0;
    const m = [];
    for (const [sel, label] of marks) { const r = await box(sel); if (!r) { console.log('missing', name, sel); continue; } m.push({ label, x: +(((r.x - ox) / vw) * 100).toFixed(2), y: +(((r.y - oy) / vh) * 100).toFixed(2), w: +((r.w / vw) * 100).toFixed(2), h: +((r.h / vh) * 100).toFixed(2) }); }
    await p.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 82, clip });
    shots[name] = { marks: m, ratio: +(vw / vh).toFixed(4) };
  };
  await p.goto(U); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('kahyo.theme', 'light'); }); await p.reload(); await p.waitForTimeout(800);
  await p.click('#h-sample'); await p.waitForFunction(() => /#\/j\//.test(location.hash)); await p.waitForTimeout(4000);
  await p.click('#fit').catch(() => {}); await p.waitForTimeout(600);
  // home after a Journey exists
  await p.goto(U + '#/'); await p.waitForTimeout(1200);
  await shoot('home', [['#h-new', 'New Journey'], ['#h-sample', 'Sample story'], ['#h-import', 'Import'], ['#h-learn', 'Learn'], ['.jcard', 'A saved Journey']]);
  await p.goBack(); await p.waitForTimeout(2500); await p.click('#fit').catch(() => {}); await p.waitForTimeout(600);
  await shoot('write', [['#mic', 'Speak'], ['#transcript', 'Type or fix'], ['#place', 'Place it'], ['#add', 'Add to Journey'], ['#char-toggle', 'Characters'], ['#health', 'Story pill'], ['#graph', 'Story map'], ['#rail', 'Stages'], ['[data-tab=notes]', 'Notes'], ['[data-tab=draft]', 'Draft'], ['.mode-switch, [data-mode=write]', 'Write / Inspect'], ['#settings-btn', 'AI config']]);
  // notes close-up
  const right = await box('.col.right') || await box('[data-tab=notes]');
  const rc = await p.evaluate(() => { const e = document.querySelector('[data-tab=notes]').closest('section') || document.querySelector('#alerts').parentElement; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 760) }; });
  await shoot('notes', [['.alert.terminate', 'Side path at its limit'], ['.alert.terminate .actions', 'Your choice'], ['.alert.repeat', 'Repeat'], ['.alert.jump', 'Jump']], rc);
  // legend
  await p.click('.legend-wrap summary'); await p.waitForTimeout(300);
  const mc = await p.evaluate(() => { const e = document.querySelector('#graph').closest('.card') || document.querySelector('#graph').parentElement; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: Math.min(900 - r.y, r.height + 200) }; });
  await shoot('map', [['#health', 'Story pill'], ['#fit', 'Fit'], ['#rail', 'Stages'], ['#legend', 'How to read it']], mc);
  await p.click('.legend-wrap summary'); await p.waitForTimeout(200);
  // inspect footstep
  await p.click('[data-mode=inspect]'); await p.waitForTimeout(500);
  await p.evaluate(() => { const a = [...document.querySelectorAll('[data-goto]')].find((x) => x.dataset.goto === 'FS#004'); a && a.click(); });
  await p.waitForTimeout(400);
  await p.click('[data-tab=footstep]').catch(() => {}); await p.waitForTimeout(300);
  await shoot('inspect', [['[data-tab=footstep]', 'Footstep'], ['[data-tab=storyline]', 'Storyline'], ['.gauge', 'Direction dial'], ['[data-intensity]', 'Intensity'], ['#detail', 'Its packet']]);
  await p.click('[data-tab=storyline]'); await p.waitForTimeout(300);
  await shoot('storyline', [['#health-why', 'Why the pill says this'], ['#tf', 'Terminancy factor'], ['#planned', 'Planned length'], ['#stats', 'Story numbers']]);
  await p.click('[data-mode=write]'); await p.waitForTimeout(300);
  await p.click('#settings-btn'); await p.waitForTimeout(400);
  await shoot('aiconfig', [['#provider', 'AI provider'], ['#api-key', 'Your key'], ['#model', 'Model'], ['#settings-save', 'Save']]);
  await p.keyboard.press('Escape');
  fs.writeFileSync(OUT + 'marks.json', JSON.stringify(shots, null, 1));
  // phone
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await q.goto(U); await q.evaluate(() => { localStorage.setItem('kahyo.theme', 'light'); }); await q.reload(); await q.waitForTimeout(800);
  await q.click('#h-sample'); await q.waitForFunction(() => /#\/j\//.test(location.hash)); await q.waitForTimeout(4000);
  await q.screenshot({ path: OUT + 'phone.jpg', type: 'jpeg', quality: 80 });
  console.log(JSON.stringify(shots).slice(0, 1500)); await b.close();
})();
