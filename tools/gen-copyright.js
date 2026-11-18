// 扫描各游戏目录，生成 COPYRIGHT.md
const fs = require('fs');
const path = require('path');
const ROOT = require("path").resolve(__dirname, "..");

global.window = {};
delete require.cache[require.resolve(path.join(ROOT, 'data.js'))];
require(path.join(ROOT, 'data.js'));
const GAMES = window.GAMES;

const CATS = {
  action: '动作射击', racing: '竞速', survival: '生存', puzzle: '解谜',
  multiplayer: '多人对战', art: '艺术漫游', showcase: '场景展示',
};
const ORDER = ['action', 'racing', 'survival', 'puzzle', 'multiplayer', 'art', 'showcase'];

function findLic(dir) {
  // 在游戏根目录找许可/致谢文件
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { return []; }
  return files.filter(f => /^(LICEN[CS]E|COPYING|CREDITS|LICENCE-NOTES|THIRD-PARTY)/i.test(f));
}

function licenseType(dir, files) {
  const lic = files.find(f => /^LICEN[CS]E/i.test(f) && !/NOTES/i.test(f));
  if (!lic) return null;
  try {
    const t = fs.readFileSync(path.join(dir, lic), 'utf8').slice(0, 2000);
    if (/MIT License/i.test(t)) return 'MIT';
    if (/Apache License/i.test(t)) return 'Apache-2.0';
    if (/Creative Commons|CC BY/i.test(t)) return 'CC';
    if (/GNU GENERAL PUBLIC/i.test(t)) return 'GPL';
    if (/BSD/i.test(t)) return 'BSD';
    const first = t.split('\n').find(l => l.trim());
    return first ? first.trim().slice(0, 40) : '见原文件';
  } catch (e) { return '见原文件'; }
}

const rows = [];
let withLic = 0, withoutLic = 0;
for (const c of ORDER) {
  for (const g of GAMES.filter(x => x.cat === c)) {
    const dir = path.join(ROOT, g.path.replace(/\/$/, ''));
    const isDir = fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    const files = isDir ? findLic(dir) : [];
    const type = isDir ? licenseType(dir, files) : null;
    if (type) withLic++; else withoutLic++;
    rows.push({ g, cat: c, files, type, isDir });
  }
}

let md = [];
md.push('# 版权与来源说明');
md.push('');
md.push('本仓库是把多个浏览器 3D 游戏**整合、分类、中文化**后的合集。');
md.push('整合部分（门户、分类体系、中文文案、缓存与性能优化、字体本地化）由本仓库以 MIT 开源；');
md.push('**games/ 下每个游戏的代码、美术、模型、音频版权归各自原作者**，各自遵循其原许可。');
md.push('');
md.push('## 一、自带许可文件的游戏');
md.push('');
md.push('这些游戏目录内保留了原作者提供的 `LICENSE` / `CREDITS.md` 等文件，请以目录内原文件为准。');
md.push('');
md.push('| 游戏 | 类别 | 许可 | 目录内许可文件 |');
md.push('|:---|:---|:---|:---|');
for (const r of rows.filter(x => x.type)) {
  md.push(`| ${r.g.name} (${r.g.en}) | ${CATS[r.cat]} | ${r.type} | ${r.files.map(f => '`' + f + '`').join(' ')} |`);
}
md.push('');
md.push('## 二、未附带许可文件的游戏');
md.push('');
md.push('以下游戏在收集时目录内没有许可文件，本仓库**仅作学习与展示用途收录，不主张任何权利**。');
md.push('如果你是这些游戏的作者，希望补充署名、变更许可或要求移除，请开 issue，会第一时间处理。');
md.push('');
md.push('| 游戏 | 类别 | 形态 | 目录 |');
md.push('|:---|:---|:---|:---|');
for (const r of rows.filter(x => !x.type)) {
  const form = r.g.build === 'single' ? '单文件 HTML' : (r.isDir ? '目录' : '文件');
  md.push(`| ${r.g.name} (${r.g.en}) | ${CATS[r.cat]} | ${form} | \`${r.g.path}\` |`);
}
md.push('');
md.push('## 三、第三方资源');
md.push('');
md.push('多个游戏目录内含 `CREDITS.md`、`hdri/CREDITS.md`、`textures/CREDITS.md`、`THIRD-PARTY-NOTICES.md`，');
md.push('记录了所用贴图、HDRI 环境光、音频、字体、物理引擎（如 Rapier）的出处与许可，**请一并遵守**。');
md.push('');
md.push('字体：`games/_fonts/` 下的 WOFF2 由各游戏原本外链的 Google Fonts 下载而来，');
md.push('遵循 SIL Open Font License 1.1，按内容哈希命名去重，全站共享。');
md.push('');
md.push('## 四、免责');
md.push('');
md.push('本项目不对任何游戏的内容、稳定性、适用性作担保，仅供学习、研究与个人娱乐使用。');
md.push('因使用本仓库内容产生的任何问题，由使用者自行承担。');
md.push('');

fs.writeFileSync(path.join(ROOT, 'COPYRIGHT.md'), md.join('\n'));
console.log(`COPYRIGHT.md 生成完成：${withLic} 个带原许可，${withoutLic} 个未附许可`);
