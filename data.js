/* 游戏中心 · 全站游戏数据（简体中文） */
window.GAMES = [
  // ===== 动作射击 =====
  {
    id: 'black-tide', name: '黑潮', en: 'Black Tide', cat: 'action', cover: 'covers/black-tide.webp', accent: '#4a6fa5',
    tagline: '深海之下，别让黑暗吞没你',
    desc: '第一人称深海探索射击。潜入被诅咒的海域，在氧气耗尽前对抗深海的威胁。优化版画质更强、运行更流畅。',
    controls: 'WASD 移动 · 鼠标 瞄准/射击 · Shift 冲刺', build: 'single', path: 'games/action/black-tide',
    tags: ['第一人称', '深海', '射击'], alt: [{n:'标准版', p:'games/action/black-tide-standard'}]
  },
  {
    id: 'sublevel-07', name: '地下层 07', en: 'Sublevel 07', cat: 'action', cover: 'covers/sublevel-07.webp', accent: '#c1443d',
    tagline: '收容失效，三层封锁，杀出去',
    desc: '快节奏第一人称清场射击。冷却剂分站发生收容突破，用你的 VK-9 卡宾枪撑过三波敌人。',
    controls: 'WASD 移动 · 鼠标 射击 · 右键 瞄准 · R 装弹 · Shift 冲刺 · 空格 跳跃', build: 'single', path: 'games/action/sublevel-07',
    tags: ['FPS', '波次生存']
  },
  {
    id: 'emberhold', name: '烬堡', en: 'Emberhold', cat: 'action', cover: 'covers/emberhold.webp', accent: '#b4653a',
    tagline: '一座正在燃烧的监狱，一桶余烬',
    desc: '第一关「无名囚室」。扮演一名囚徒在炼狱般的堡垒中求生，揭开封锁背后的秘密。',
    controls: 'WASD 移动 · Shift 冲刺 · 鼠标 视角', build: 'single', path: 'games/action/emberhold',
    tags: ['第一人称', '剧情', '逃生']
  },
  {
    id: 'siege', name: '围城：僵尸防线', en: 'Siege', cat: 'action', cover: 'covers/siege.webp', accent: '#8d9b4a',
    tagline: '整座小镇都是可以被打碎的',
    desc: '回合制僵尸生存，地面和建筑全部由可破坏体素构成。用炸药轰开墙体，让倒塌的房屋压垮街道上的尸潮。',
    controls: '鼠标 瞄准/射击 · 详见游戏内说明', build: 'vite', path: 'games/action/siege/',
    tags: ['僵尸', '体素破坏', '塔防']
  },
  {
    id: 'harrowfield', name: '哈罗农场：僵尸之夜', en: 'Harrowfield', cat: 'action', cover: 'covers/harrowfield.webp', accent: '#6b7c5a',
    tagline: '一个农舍，一夜僵尸，一分一秒都算数',
    desc: '守住被木板封死的农舍，一轮一轮抵挡亡者。定格动画质感、手工编织的人偶、八音盒摇篮曲——恐怖来自氛围而非血腥。',
    controls: 'WASD 移动 · 鼠标 瞄准/射击 · 详见游戏内说明', build: 'vite', path: 'games/action/harrowfield/',
    tags: ['僵尸', '防守', '氛围恐怖']
  },

  // ===== 竞速驾驶 =====
  {
    id: 'mothlight', name: '蛾光：夜行', en: 'Mothlight', cat: 'racing', cover: 'covers/mothlight.webp', accent: '#7a5ba8',
    tagline: '一座忘记了是谁点亮它的城市',
    desc: '雨夜霓虹赛车。穿过被遗忘的街区、追上光门、刷新最佳圈速。雨指数 0.93，路面湿滑。',
    controls: 'W / S 油门/刹车倒车 · A / D 转向 · Shift 加速 · 鼠标 视角', build: 'single', path: 'games/racing/mothlight',
    tags: ['赛车', '赛博朋克', '雨夜']
  },
  {
    id: 'desk-racer', name: '桌面跑车', en: 'Desk Racer', cat: 'racing', cover: 'covers/desk-racer.webp', accent: '#c08a3e',
    tagline: '书房就是你的赛道',
    desc: '桌面微缩计时赛。驾驶迷你卡丁车在书桌赛道上漂移过弯，追逐每一个断点的最佳成绩。',
    controls: 'WASD 驾驶 · Shift 漂移 · 详见游戏内说明', build: 'vite', path: 'games/racing/desk-racer/',
    tags: ['卡丁车', '计时赛', '微缩']
  },
  {
    id: 'turbo-kart', name: '涡轮卡丁车', en: 'Turbo Kart Rally', cat: 'racing', cover: 'covers/turbo-kart.webp', accent: '#d9623b',
    tagline: '一键开赛，七名对手',
    desc: '街机风格卡丁车竞速。长按漂移积攒迷你涡轮、掌握火箭起步、吃道具保持领先。全部模型贴图音乐由代码生成。',
    controls: '方向键 / WASD 驾驶 · 漂移键 蓄力 · 详见游戏内说明', build: 'static', path: 'games/racing/turbo-kart/',
    tags: ['卡丁车', '竞速', '道具']
  },
  {
    id: 'snowplow3d', name: '3D 铲雪大作战', en: 'Snow Plow', cat: 'racing', cover: 'covers/snowplow3d.webp', accent: '#6fa8bd',
    tagline: '铲雪、堆球、然后对撞 BOSS',
    desc: '在一个球形世界里铲雪的休闲游戏，后期还要和 BOSS 正面硬刚。音乐由程序化音频实时合成。',
    controls: 'WASD 移动 · 详见游戏内说明', build: 'vite', path: 'games/racing/snowplow3d/',
    tags: ['休闲', '模拟', 'BOSS战']
  },
  {
    id: 'courier-field', name: '快递原野', en: 'Courier Field', cat: 'racing', cover: 'covers/courier-field.webp', accent: '#5aa89a',
    tagline: '运河、木桥与高峰期的混乱',
    desc: '柔和色调的 3D 等距玩具城市快递游戏。按顺序送达包裹，穿过运河岛屿和木桥，躲开通勤高峰的危险。',
    controls: '方向键 / WASD 移动 · 详见游戏内说明', build: 'vite', path: 'games/racing/courier-field/',
    tags: ['配送', '等距视角', '城市']
  },
  {
    id: 'tennis3d', name: '氩光网球', en: 'Argon Tennis', cat: 'racing', cover: 'covers/tennis3d.webp', accent: '#8fb84a',
    tagline: '挥拍快到冒烟的街机网球',
    desc: '3D 街机网球。夸张的挥拍动作、表情丰富的 Mii 角色，支持摄像头和手机体感控制，配乐由 AI 生成。',
    controls: '鼠标 / 体感 挥拍 · 详见游戏内说明', build: 'vite', path: 'games/racing/tennis3d/', camera: true,
    tags: ['体育', '网球', '体感']
  },

  // ===== 生存冒险 =====
  {
    id: 'wyrdholm', name: '维德霍姆：北欧生存岛', en: 'Wyrdholm', cat: 'survival', cover: 'covers/wyrdholm.webp', accent: '#6f8f5a',
    tagline: '一座岛，从一无所有开始生活',
    desc: '北欧氛围的生存岛。阳光草地通往幽暗冷杉林，湖泊与沙滩环绕，昼夜、雾、雨与风暴交替。砍树建屋、生火取暖、对抗森林里的苔藓巨魔。',
    controls: 'WASD 移动 · 鼠标 视角 · 详见游戏内说明', build: 'vite', path: 'games/survival/wyrdholm/',
    tags: ['生存', '建造', '开放世界']
  },
  {
    id: 'dino-island', name: '恐龙岛', en: 'Dino Island', cat: 'survival', cover: 'covers/dino-island.webp', accent: '#4f8a5c',
    tagline: '雨林深处，有东西在盯着你',
    desc: '清晨走进潮湿雨林，树影合拢，一头霸王龙破林而出向你冲来。被追逐后可以切换到七头霸王龙，用第一或第三人称重新体验。',
    controls: 'WASD 移动 · Shift 冲刺 · 鼠标 视角', build: 'vite', path: 'games/survival/dino-island/',
    tags: ['恐龙', '追逐', '生存恐怖']
  },
  {
    id: 'calamity-cove', name: '灾厄海湾', en: 'Calamity Cove', cat: 'survival', cover: 'covers/calamity-cove.webp', accent: '#c98a4b',
    tagline: '抬头看天，十五秒内选好避难所',
    desc: '海岛渔村每轮遭遇不同灾害。你是十个方块村民之一，必须在警报响起前读懂天空、找到正确的避难方式。每栋建筑都会真实碎裂坍塌。',
    controls: 'WASD 移动 · 详见游戏内说明', build: 'vite', path: 'games/survival/calamity-cove/',
    tags: ['灾难', '生存', '物理破坏']
  },
  {
    id: 'pelican-campus', name: '鹈鹕校园任务', en: 'Pelican Campus Quest', cat: 'survival', cover: 'covers/pelican-campus.webp', accent: '#4a7fbf',
    tagline: '骑上自行车，翻遍整座校园',
    desc: '山地景观中的开放世界 3D 自行车游戏。完成 16 个 TPU 收集、体育馆突围、自由漫游和剧情自动驾驶模式。',
    controls: 'WASD 骑行 · 详见游戏内说明', build: 'vite', path: 'games/survival/pelican-campus/',
    tags: ['开放世界', '自行车', '校园']
  },
  {
    id: 'jimao-3a', name: '几猫 3A 大作', en: 'Jimao 3A', cat: 'survival', cover: 'covers/jimao-3a.webp', accent: '#b5654a',
    tagline: '正在载入几猫港区',
    desc: '一份体量惊人的单文件 3D 作品，加载几猫港区展开冒险。完整细节请在游戏内体验。',
    controls: 'WASD 移动 · 鼠标 视角 · 详见游戏内说明', build: 'single', path: 'games/survival/jimao-3a',
    tags: ['3D', '冒险', '单文件']
  },
  {
    id: 'tidebell', name: '潮钟', en: 'Tidebell', cat: 'survival', cover: 'covers/tidebell.webp', accent: '#3f7f96',
    tagline: '大海记得它的歌',
    desc: '水下探索。船体已到极限，唤醒更多钟声才能潜得更深。「歌者」已经归来——尽情探索，没有时间限制。',
    controls: 'WASD 游泳 · 鼠标 视角 · 空格/C 上浮/下潜 · Shift 加速 · E 唤醒钟', build: 'single', path: 'games/survival/tidebell',
    tags: ['水下', '探索', '氛围']
  },

  // ===== 益智解谜 =====
  {
    id: 'chess3d', name: '3D 巫师国际象棋', en: 'Wizard Chess 3D', cat: 'puzzle', cover: 'covers/chess3d.webp', accent: '#7a6ba8',
    tagline: '哥特教堂里的石头棋子，会真的碎掉',
    desc: '交互式 3D 哥特教堂巫师象棋。雕塑般的石制棋子、电影化的近身吃子、碎裂物理效果，以及单人 AI 对手。',
    controls: '鼠标 选子/落子 · 详见游戏内说明', build: 'vite', path: 'games/puzzle/chess3d/',
    tags: ['棋类', '策略', '物理']
  },
  {
    id: 'clockwork', name: '发条圣殿', en: 'Clockwork Sanctum', cat: 'puzzle', cover: 'covers/clockwork.webp', accent: '#c69a4b',
    tagline: '反弹阳光，击碎石像鬼，躲开潜行的刺客',
    desc: '阳光下的等距视角发条解谜追逐。反弹金色光束击碎石像鬼，智取跟踪你的暗影盗贼，并召唤法师的星界援手。',
    controls: '鼠标 瞄准/操作 · 详见游戏内说明', build: 'vite', path: 'games/puzzle/clockwork/',
    tags: ['解谜', '等距视角', '潜行']
  },
  {
    id: 'brickfall', name: '砖落：拆除大师', en: 'Brickfall', cat: 'puzzle', cover: 'covers/brickfall.webp', accent: '#b5653d',
    tagline: '一栋楼，一块砖，一次完美塌方',
    desc: '把拆除做成一场简短的物理谜题。每块砖都是真实刚体，材质决定硬度，承重表、断裂前的吱响与粉尘让好计划显得聪明、坏计划显得滑稽。',
    controls: '鼠标 放置炸药/拆除 · 详见游戏内说明', build: 'vite', path: 'games/puzzle/brickfall/',
    tags: ['拆除', '物理', '解谜']
  },
  {
    id: 'duskline', name: '暮线', en: 'Duskline', cat: 'puzzle', cover: 'covers/duskline.webp', accent: '#c98a5a',
    tagline: '清扫车正在逼近，别被它抓住',
    desc: '黄昏班次的高架跑酷。切换车道、跳跃、滑铲躲开清扫车，用磁铁和护盾撑得更久，刷新最高分。',
    controls: '← → / A D 变道 · ↑ 跳跃 · ↓ 滑铲 · 触屏可滑动', build: 'single', path: 'games/puzzle/duskline',
    tags: ['跑酷', '街机', '反应']
  },

  // ===== 团队竞技 =====
  {
    id: 'inkwave', name: '墨浪：多彩 4v4', en: 'INKWAVE', cat: 'multiplayer', cover: 'covers/inkwave.webp', accent: '#4aa8c9',
    tagline: '地面就是分数，把舞台涂成你的颜色',
    desc: '团队涂地射击。四对四在三分钟内涂满舞台，覆盖面积多的一方获胜。在自己的墨里游得更快、能补充弹药、还能爬上涂满的墙。七种武器各有炸弹与大招。',
    controls: 'WASD 移动 · 鼠标 射击 · 详见游戏内说明', build: 'static', path: 'games/multiplayer/inkwave/',
    tags: ['射击', '涂地', '4v4']
  },
  {
    id: 'qingyun', name: '青云宗 · 御剑采灵', en: 'Qingyun Sword Flight', cat: 'multiplayer', cover: 'covers/qingyun.webp', accent: '#5a9fa8',
    tagline: '御剑乘风，采集天地灵气',
    desc: '国产仙侠题材的御剑飞行作品，踩剑穿梭于云海山峦之间采集灵气。',
    controls: 'WASD 飞行 · 鼠标 视角 · 详见游戏内说明', build: 'single', path: 'games/multiplayer/qingyun',
    tags: ['仙侠', '御剑', '飞行']
  },
  {
    id: 'sparrow', name: '麻雀模拟器', en: 'Sparrow Sim', cat: 'multiplayer', cover: 'covers/sparrow.webp', accent: '#a8904a',
    tagline: '从阁楼逃出，去街坊里调皮捣蛋',
    desc: '化身一只好奇的家麻雀，从艺术家洒满阳光的阁楼工作室逃出，探索 vibrant 的欧洲童话街区。掠过屋顶、运河与露天咖啡座，完成 12 个恶作剧与暖心小事。',
    controls: 'WASD 飞行 · 鼠标 视角 · 详见游戏内说明', build: 'vite', path: 'games/multiplayer/sparrow/',
    tags: ['模拟', '飞行', '探索']
  },

  // ===== 艺术漫游 =====
  {
    id: 'coloured-pencil', name: '彩铅小镇', en: 'Coloured Pencil', cat: 'art', cover: 'covers/coloured-pencil.webp', accent: '#c98a9a',
    tagline: '一切都是手绘的彩色铅笔笔画',
    desc: '用彩色铅笔在速写本上绘制 three.js 世界。每个表面的笔触都跟着形体走、随视角保持不动，光是暖黄、阴影是蓝紫第二支笔。在明亮的海港小镇里漫步。',
    controls: 'WASD 移动 · Shift 冲刺 · 空格 跳跃 · 滚轮 缩放视野 · H 隐藏提示', build: 'vite', path: 'games/art/coloured-pencil/',
    tags: ['艺术', '漫步', '手绘渲染']
  },
  {
    id: 'oil-paint', name: '油画漫游', en: 'Oil Paint', cat: 'art', cover: 'covers/oil-paint.webp', accent: '#a8763e',
    tagline: '每一笔都是钉在世界上的厚涂颜料',
    desc: '把 three.js 场景画成一层层厚重的油画。同一位旅人走过两条路：极光下的雪岭小屋，和秋日的林地。颜色是颜料而非光，笔触随距离简化。',
    controls: 'WASD 移动 · Shift 冲刺 · 空格 跳跃 · 滚轮 缩放 · V 切换第一人称 · H 隐藏提示', build: 'vite', path: 'games/art/oil-paint/',
    tags: ['艺术', '漫步', '油画渲染']
  },
  {
    id: 'painted-valley', name: '彩绘山谷', en: 'Painted Valley', cat: 'art', cover: 'covers/painted-valley.webp', accent: '#7ba85a',
    tagline: '走进一幅手绘动画电影背景',
    desc: '夏日山谷漫步，画面是手绘动画电影背景的质感：平涂的干净色彩、堆积的白云、每一面都上过色的远山、红瓦村庄。戴草帽披蓝斗篷的旅人穿行其间。',
    controls: 'WASD 移动 · Shift 冲刺 · Alt 慢走 · 空格 跳跃 · T 切换时段 · 1-4 直达时段 · P 开关笔触', build: 'vite', path: 'games/art/painted-valley/',
    tags: ['艺术', '漫步', '动画风格']
  },
  {
    id: 'patchwork-quilt', name: '拼布被', en: 'Patchwork Quilt', cat: 'art', cover: 'covers/patchwork-quilt.webp', accent: '#b57a8a',
    tagline: '整个世界是一床手工缝制的被子',
    desc: '把 three.js 世界做成布料，像被手工裁剪、填充、缝合并摆在桌上拍摄。每一块拼布都是鼓起的枕头，有真实的缝线和针脚。操控一个布娃娃在里面走动。',
    controls: 'WASD 移动 · Shift 冲刺 · 空格 跳跃 · 滚轮 缩放 · P 切换定格频率', build: 'vite', path: 'games/art/patchwork-quilt/',
    tags: ['艺术', '漫步', '布艺']
  },
  {
    id: 'watercolour', name: '水彩漫步', en: 'Watercolour', cat: 'art', cover: 'covers/watercolour.webp', accent: '#6a9fc0',
    tagline: '你走到哪里，水彩就晕染到哪里',
    desc: '世界从纸上的铅笔稿开始，随着你的脚步被水彩晕染。颜色从脚下扩散、爬上树根到树梢、顺流而下并留在你走过的每一处。小红帽女孩带你穿过林间溪流与花树草甸。',
    controls: 'WASD 移动 · Shift 冲刺 · 空格 跳跃 · 滚轮 缩放 · H 隐藏提示', build: 'vite', path: 'games/art/watercolour/',
    tags: ['艺术', '漫步', '水彩渲染']
  },

  // ===== 展示体验 =====
  {
    id: 'koerner-hall', name: '科纳音乐厅 · 古钢琴声学', en: 'Koerner Hall', cat: 'showcase', cover: 'covers/koerner-hall.webp', accent: '#8a6a9a',
    tagline: '坐到任何一个座位，听 1780 年的琴',
    desc: '交互式 3D 声学模拟。以 CAD 重建的 1780 年 Stein-Schule 南德古钢琴、五段同步的公有领域古钢琴录音，以及全场 1135 个座位各不相同的混响效果。',
    controls: '点击座位切换听音位置 · 佩戴耳机效果最佳', build: 'vite', path: 'games/showcase/koerner-hall/',
    tags: ['音乐', '声学', '3D展示']
  },
  {
    id: 'event-landing', name: '像素与系统 · 活动主页', en: 'Event Landing Page', cat: 'showcase', cover: 'covers/event-landing.webp', accent: '#c98a4b',
    tagline: '一场关于像素、字体与系统的虚构大会',
    desc: '为期三天的虚构会议网站，主题围绕像素、字体、界面与系统。一个排版与视觉设计的展示项目。',
    controls: '滚动浏览 · 点击交互', build: 'vite', path: 'games/showcase/event-landing/',
    tags: ['设计', '展示', '网页']
  }
];

window.CATEGORIES = [
  { id: 'all',      name: '全部游戏', icon: '✦' },
  { id: 'action',   name: '动作射击', icon: '◎' },
  { id: 'racing',   name: '竞速驾驶', icon: '➤' },
  { id: 'survival', name: '生存冒险', icon: '❖' },
  { id: 'puzzle',   name: '益智解谜', icon: '⬡' },
  { id: 'multiplayer', name: '团队竞技', icon: '⚔' },
  { id: 'art',      name: '艺术漫游', icon: '✎' },
  { id: 'showcase', name: '展示体验', icon: '◇' }
];
