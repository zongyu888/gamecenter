// 从 data.js 生成 README.md 与各分类目录的索引 README
const fs = require('fs');
const path = require('path');
const ROOT = require("path").resolve(__dirname, "..");

global.window = {};
delete require.cache[require.resolve(path.join(ROOT, 'data.js'))];
require(path.join(ROOT, 'data.js'));
const GAMES = window.GAMES;

const CATS = {
  action:      { name: '动作射击', en: 'Action',      desc: '第一人称射击、僵尸防线、深海探索、地下突围' },
  racing:      { name: '竞速',     en: 'Racing',      desc: '赛车、卡丁车、铲雪车、网球对决' },
  survival:    { name: '生存',     en: 'Survival',    desc: '荒岛求生、恐龙岛、灾厄海湾、校园潜行' },
  puzzle:      { name: '解谜',     en: 'Puzzle',      desc: '3D 国际象棋、发条机械、拆砖、光影解谜' },
  multiplayer: { name: '多人对战', en: 'Multiplayer', desc: '4v4 涂地对战、御剑飞行、麻雀模拟' },
  art:         { name: '艺术漫游', en: 'Art',         desc: '水彩、油画、彩铅、拼布 —— 走进去的画' },
  showcase:    { name: '场景展示', en: 'Showcase',    desc: '音乐厅声学模拟、创意活动主页' },
};
const ORDER = ['action', 'racing', 'survival', 'puzzle', 'multiplayer', 'art', 'showcase'];

const BUILD_LABEL = { vite: '构建版', single: '单文件', static: '静态站' };

function byCat(cat) { return GAMES.filter(g => g.cat === cat); }
function linkPath(g) { return g.path.replace(/\/$/, '') + (g.build === 'single' ? (g.path.endsWith('.html') ? '' : '.html') : '/'); }
function dirPath(g) { return g.path.replace(/\/$/, '') + '/'; }

// ============ 根 README ============
const total = GAMES.length;
let md = [];
md.push('# 游戏档案馆 · Game Archive');
md.push('');
md.push(`**${total} 个浏览器 3D 游戏的中文合集**，按 7 个类别整理，开箱即跑，无需安装编译工具。`);
md.push('');
md.push('所有游戏都在浏览器里直接运行（WebGL / Three.js / Canvas），支持键盘鼠标，部分支持手柄。');
md.push('');
md.push('| | |');
md.push('|---|---|');
md.push('| 🎮 在线体验 | **https://game.stargrow.store/** |');
md.push('| 📦 仓库地址 | https://github.com/zongyu888/gamecenter |');
md.push('| ⬇️ 一键下载 | [下载 ZIP](https://github.com/zongyu888/gamecenter/archive/refs/heads/main.zip) |');
md.push('| 📄 开源协议 | MIT（整合代码） / 各游戏归原作者，见 [COPYRIGHT.md](COPYRIGHT.md) |');
md.push('');
md.push('---');
md.push('');
md.push('## 分类速览');
md.push('');
md.push('| 类别 | 数量 | 说明 | 目录 |');
md.push('|:---|:---:|:---|:---|');
for (const c of ORDER) {
  const n = byCat(c).length;
  md.push(`| **${CATS[c].name}** ${CATS[c].en} | ${n} | ${CATS[c].desc} | [\`games/${c}/\`](games/${c}/) |`);
}
md.push(`| **合计** | **${total}** | | |`);
md.push('');
md.push('---');
md.push('');

// 每个分类的详细清单
for (const c of ORDER) {
  const list = byCat(c);
  md.push(`## ${CATS[c].name} · ${CATS[c].en}`);
  md.push('');
  md.push(`> ${CATS[c].desc} —— 共 ${list.length} 款，源码目录 [\`games/${c}/\`](games/${c}/)`);
  md.push('');
  md.push('| 游戏 | 原名 | 一句话 | 操作 | 类型 |');
  md.push('|:---|:---|:---|:---|:---|');
  for (const g of list) {
    md.push(`| **[${g.name}](${linkPath(g)})** | ${g.en} | ${g.tagline} | ${g.controls} | ${BUILD_LABEL[g.build] || g.build} |`);
  }
  md.push('');
  if (list.some(g => Array.isArray(g.alt) && g.alt.length)) {
    const withAlt = list.filter(g => Array.isArray(g.alt) && g.alt.length);
    md.push('**多版本游戏：**');
    for (const g of withAlt) {
      md.push(`- ${g.name}：主版本 [\`${linkPath(g)}\`](${linkPath(g)})` + g.alt.map(a => `，${a.n} [\`${a.p.replace(/\/$/, '')}.html\`](${a.p.replace(/\/$/, '')}.html)`).join(''));
    }
    md.push('');
  }
}

md.push('---');
md.push('');
md.push('## 本地运行');
md.push('');
md.push('克隆后在本机起一个静态服务器即可（必须用 HTTP，不能用 `file://` 直接双击，否则 ES 模块和跨域会失败）：');
md.push('');
md.push('```bash');
md.push('git clone https://github.com/zongyu888/gamecenter.git');
md.push('cd gamecenter');
md.push('node server.js        # 然后打开 http://localhost:8899');
md.push('```');
md.push('');
md.push('Windows 用户也可以直接双击 `启动游戏中心.bat`。');
md.push('');
md.push('> 需要 Node.js 14+。没有 Node 也可以用 `python -m http.server 8899` 或 `npx serve`。');
md.push('');
md.push('---');
md.push('');
md.push('## 项目结构');
md.push('');
md.push('```');
md.push('gamecenter/');
md.push('├── index.html            # 门户主页（卡片 / 分类 / 搜索 / 全屏播放）');
md.push('├── data.js               # 全部游戏数据（名称、分类、简介、操作、路径）');
md.push('├── sw.js                 # Service Worker：本地缓存，缓存过的游戏断网可玩');
md.push('├── server.js             # 零依赖本地静态服务器');
md.push('├── 启动游戏中心.bat       # Windows 一键启动');
md.push('├── _headers              # Cloudflare Pages 缓存头配置');
md.push('├── _redirects            # Cloudflare Pages 路由（大文件走 R2）');
md.push('├── covers/               # 31 张封面（WebP）');
md.push('└── games/');
md.push('    ├── action/           # 动作射击');
md.push('    ├── racing/           # 竞速');
md.push('    ├── survival/         # 生存');
md.push('    ├── puzzle/           # 解谜');
md.push('    ├── multiplayer/      # 多人对战');
md.push('    ├── art/              # 艺术漫游');
md.push('    ├── showcase/         # 场景展示');
md.push('    └── _fonts/           # 共享自托管字体（避免外链阻塞）');
md.push('```');
md.push('');
md.push('每个游戏目录都是自包含的：`index.html` + `assets/`，直接部署这一层就能单独访问。');
md.push('单文件游戏是一个 HTML 里内联了全部代码和资源，拷走就能玩。');
md.push('');
md.push('---');
md.push('');
md.push('## 技术说明');
md.push('');
md.push('- **零后端**：纯静态站点，任何静态托管（GitHub Pages / Cloudflare Pages / Nginx）都能跑。');
md.push('- **懒加载**：封面用 `IntersectionObserver` 延迟载入；游戏 iframe **点了才创建**，关闭即销毁释放 WebGL 上下文 —— 不玩的不占带宽和显存。');
md.push('- **本地缓存**（`sw.js`）：首次只预缓存门户外壳 + 31 张封面（<1MB）；游戏资源**只缓存玩家实际打开过的**，单个超 40MB 的文件不落地，防止撑爆磁盘。缓存过的游戏断网也能玩。');
md.push('- **边缘缓存**（`_headers`）：带 hash 的构建产物一年 immutable，封面浏览器 7 天 / 边缘 30 天，入口文件短缓存保证更新生效。');
md.push('- **字体自托管**：所有外链 Google Fonts 已下载到 `games/_fonts/` 并内联 `@font-face`，避免国内访问被墙导致页面卡在渲染阻塞。');
md.push('- **大文件分流**：Cloudflare Pages 单文件上限 25MB，哈罗农场的 36MB 模型通过 `_redirects` 301 到对象存储（R2）。');
md.push('- **预热**：点开游戏详情弹窗时，Service Worker 会提前拉取该游戏入口 HTML 与主脚本（含 `modulepreload`），点「开始游戏」时秒开。');
md.push('');
md.push('---');
md.push('');
md.push('## 版权与致谢');
md.push('');
md.push('本仓库是**整合与中文化**的产物：门户、分类体系、中文文案、性能优化、字体本地化由本项目完成；');
md.push('**各个游戏的美术、代码、音乐版权归各自原作者**，详见 [COPYRIGHT.md](COPYRIGHT.md)。');
md.push('');
md.push('如果你是某个游戏的作者并希望调整署名或移除内容，请开 issue，会立即处理。');
md.push('');
md.push('## 开源协议');
md.push('');
md.push('本项目的整合代码（门户、脚本、配置、文档）以 [MIT](LICENSE) 协议开源。');
md.push('各游戏本体遵循其各自的原许可，见 [COPYRIGHT.md](COPYRIGHT.md)。');
md.push('');

fs.writeFileSync(path.join(ROOT, 'README.md'), md.join('\n'));
console.log('README.md 生成完成，' + md.length + ' 行');

// ============ 每个分类目录的 README ============
for (const c of ORDER) {
  const list = byCat(c);
  let m = [];
  m.push(`# ${CATS[c].name} · ${CATS[c].en}`);
  m.push('');
  m.push(`> ${CATS[c].desc}`);
  m.push('');
  m.push(`共 **${list.length}** 款游戏。返回 [仓库首页](../../README.md)。`);
  m.push('');
  m.push('| 游戏 | 原名 | 一句话 | 操作 | 目录 |');
  m.push('|:---|:---|:---|:---|:---|');
  for (const g of list) {
    const sub = g.build === 'single' ? `./${g.id}.html` : `./${g.id}/`;
    m.push(`| **${g.name}** | ${g.en} | ${g.tagline} | ${g.controls} | [\`${g.id}\`](${sub}) |`);
  }
  m.push('');
  m.push('## 简介');
  m.push('');
  for (const g of list) {
    m.push(`### ${g.name} · ${g.en}`);
    m.push('');
    m.push(g.desc);
    m.push('');
    m.push(`- **操作**：${g.controls}`);
    m.push(`- **标签**：${(g.tags || []).join(' · ')}`);
    m.push(`- **入口**：[\`${linkPath(g)}\`](../../${linkPath(g)})`);
    if (Array.isArray(g.alt) && g.alt.length) {
      m.push(`- **其他版本**：` + g.alt.map(a => `${a.n} [\`${a.p.replace(/\/$/, '')}.html\`](../../${a.p.replace(/\/$/, '')}.html)`).join('，'));
    }
    m.push('');
  }
  fs.writeFileSync(path.join(ROOT, 'games', c, 'README.md'), m.join('\n'));
  console.log(`games/${c}/README.md 生成完成 (${list.length} 款)`);
}
