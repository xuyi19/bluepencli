// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// M2 规范词库 / 素材本（2026-10-08）
//
// 阅卷现实：采分点看**关键词**。同样的意思，"把老百姓的基本生活保住"和
// "兜牢民生底线"，一个在阅卷人眼里是外行话，一个是得分词。
// 本库按「大白话 ⇄ 规范表述」对照编排 —— 背一组规范词，顶刷十篇时评。
//
// 主题口径与文章库（builtin-articles.json 的 topics）严格对齐，共 9 大主题；
// 学完一组词可直接跳「文章库」看它在真实时评里怎么用。
//
// 字段：
//   formal —— 规范表述（可直接写进答卷的"得分词"）
//   plain  —— 大白话对照（帮你确认自己原来会不会表达这个意思）
//
// 改内容前：这条库是给考生背的，**宁缺毋滥** —— 每条都必须是阅卷真实认的
// 政策话语，不要造生造词；表述随政策演进的（如"新质生产力"）保持最新口径。

export const LEXICON_THEMES = [
  {
    key: 'minsheng',
    name: '民生保障',
    items: [
      { id: 'lex-ms-01', formal: '兜牢民生底线', plain: '老百姓的基本生活要保住' },
      { id: 'lex-ms-02', formal: '织密扎牢社会保障网', plain: '养老、医保要覆盖到每个人' },
      { id: 'lex-ms-03', formal: '推进基本公共服务均等化', plain: '城乡的教育医疗水平要拉平' },
      { id: 'lex-ms-04', formal: '解决群众急难愁盼问题', plain: '把群众最愁的事抓紧办好' },
      { id: 'lex-ms-05', formal: '增强人民群众获得感、幸福感、安全感', plain: '让老百姓的日子有奔头、有保障' },
      { id: 'lex-ms-06', formal: '健全基本公共服务体系', plain: '上学、看病、养老这些服务要成体系' },
      { id: 'lex-ms-07', formal: '坚持尽力而为、量力而行', plain: '民生实事要办，但不能乱开空头支票' },
      { id: 'lex-ms-08', formal: '兜住兜准兜牢民生底线', plain: '该保的人一个不能漏，钱要花在刀刃上' },
    ],
  },
  {
    key: 'keji',
    name: '科技创新',
    items: [
      { id: 'lex-kj-01', formal: '强化企业科技创新主体地位', plain: '让企业当创新的主角，不是配角' },
      { id: 'lex-kj-02', formal: '打好关键核心技术攻坚战', plain: '卡脖子的技术必须自己搞出来' },
      { id: 'lex-kj-03', formal: '促进产学研深度融合', plain: '高校、科研院所和企业要拧成一股绳' },
      { id: 'lex-kj-04', formal: '深化科技评价改革', plain: '不能光数论文论英雄' },
      { id: 'lex-kj-05', formal: '提高全社会研发投入强度', plain: '舍得在研发上花钱' },
      { id: 'lex-kj-06', formal: '加快科技成果转化应用', plain: '实验室的成果要变成生产线上的产品' },
      { id: 'lex-kj-07', formal: '营造良好创新生态', plain: '让创新者有平台、有回报、失败也被宽容' },
      { id: 'lex-kj-08', formal: '培育壮大新质生产力', plain: '用新技术、新模式催生新产业' },
    ],
  },
  {
    key: 'dangjian',
    name: '党的建设',
    items: [
      { id: 'lex-dj-01', formal: '坚持党建引领基层治理', plain: '基层的事要靠党组织带头' },
      { id: 'lex-dj-02', formal: '驰而不息正风肃纪反腐', plain: '作风问题和腐败不能松劲' },
      { id: 'lex-dj-03', formal: '夯实基层党组织建设', plain: '村里、社区里的党组织要建强' },
      { id: 'lex-dj-04', formal: '树立正确选人用人导向', plain: '用谁不用谁，要看实干' },
      { id: 'lex-dj-05', formal: '落实全面从严治党主体责任', plain: '管党治党的责任要扛在肩上' },
      { id: 'lex-dj-06', formal: '密切党群干群关系', plain: '干部要跟群众坐一条板凳' },
      { id: 'lex-dj-07', formal: '健全干部担当作为激励和保护机制', plain: '让实干的人不吃亏、敢干事' },
      { id: 'lex-dj-08', formal: '力戒形式主义、官僚主义', plain: '别让报表、留痕把实干压垮' },
    ],
  },
  {
    key: 'fazhan',
    name: '高质量发展',
    items: [
      { id: 'lex-fz-01', formal: '完整、准确、全面贯彻新发展理念', plain: '不能只盯着 GDP 蛮干' },
      { id: 'lex-fz-02', formal: '建设现代化产业体系', plain: '产业结构要升级换代' },
      { id: 'lex-fz-03', formal: '促进城乡区域协调发展', plain: '城市农村、东中西部一起往前走' },
      { id: 'lex-fz-04', formal: '深化供给侧结构性改革', plain: '生产出来的东西要对得上需求' },
      { id: 'lex-fz-05', formal: '激发各类经营主体活力', plain: '国企、民企、外企都要有干劲' },
      { id: 'lex-fz-06', formal: '着力扩大国内需求', plain: '让老百姓愿意消费、消费得起' },
      { id: 'lex-fz-07', formal: '推动经济发展质量变革、效率变革、动力变革', plain: '发展要讲质效，不能靠拼资源' },
      { id: 'lex-fz-08', formal: '构建高水平社会主义市场经济体制', plain: '市场能办的交给市场，政府管该管的' },
    ],
  },
  {
    key: 'shengtai',
    name: '生态文明',
    items: [
      { id: 'lex-st-01', formal: '践行绿水青山就是金山银山理念', plain: '保护环境本身也能变成财富' },
      { id: 'lex-st-02', formal: '坚持生态优先、绿色发展', plain: '先算生态账，再算开发账' },
      { id: 'lex-st-03', formal: '深入打好污染防治攻坚战', plain: '治水、治气、治土不能松' },
      { id: 'lex-st-04', formal: '推动绿色低碳转型', plain: '少排污染、少烧煤、多用清洁能源' },
      { id: 'lex-st-05', formal: '严守生态保护红线', plain: '有些地方一寸也不能开发' },
      { id: 'lex-st-06', formal: '健全生态保护补偿机制', plain: '谁保护环境，谁就该得实惠' },
      { id: 'lex-st-07', formal: '促进人与自然和谐共生', plain: '发展不能跟自然对着干' },
      { id: 'lex-st-08', formal: '协同推进降碳、减污、扩绿、增长', plain: '减碳、治污、添绿、发展四件事一起干' },
    ],
  },
  {
    key: 'liangshi',
    name: '粮食安全',
    items: [
      { id: 'lex-ls-01', formal: '扛稳粮食安全政治责任', plain: '种粮保供是硬任务，不是可做可不做' },
      { id: 'lex-ls-02', formal: '坚决守住耕地保护红线', plain: '耕地不能乱占乱用' },
      { id: 'lex-ls-03', formal: '落实藏粮于地、藏粮于技战略', plain: '地力要好，技术要新' },
      { id: 'lex-ls-04', formal: '健全种粮农民收益保障机制', plain: '种粮得让农民有钱赚' },
      { id: 'lex-ls-05', formal: '增强粮食储备与应急保障能力', plain: '手里有粮，心里不慌' },
      { id: 'lex-ls-06', formal: '打好种业振兴行动攻坚战', plain: '种子不能被人卡脖子' },
      { id: 'lex-ls-07', formal: '坚决遏制耕地"非农化"、有效防止"非粮化"', plain: '好地必须用来种粮' },
      { id: 'lex-ls-08', formal: '树立大食物观', plain: '肉蛋菜果水产都要稳产保供' },
    ],
  },
  {
    key: 'fazhi',
    name: '法治建设',
    items: [
      { id: 'lex-fz2-01', formal: '坚持依法行政，建设法治政府', plain: '政府办事要有法可依' },
      { id: 'lex-fz2-02', formal: '严格规范公正文明执法', plain: '执法不能粗暴任性' },
      { id: 'lex-fz2-03', formal: '打造法治化营商环境', plain: '让企业有法律上的安全感' },
      { id: 'lex-fz2-04', formal: '健全矛盾纠纷多元预防调处化解机制', plain: '有矛盾不能都推去打官司' },
      { id: 'lex-fz2-05', formal: '深化基层普法宣传', plain: '让群众知法、懂法、会用法' },
      { id: 'lex-fz2-06', formal: '把权力关进制度的笼子', plain: '政府权力要受监督' },
      { id: 'lex-fz2-07', formal: '完善行政执法监督体系', plain: '谁执法，谁就要被监督' },
      { id: 'lex-fz2-08', formal: '引导群众依法表达诉求', plain: '有事走法律途径，不靠闹' },
    ],
  },
  {
    key: 'zhili',
    name: '社会治理',
    items: [
      { id: 'lex-zl-01', formal: '构建共建共治共享的社会治理格局', plain: '大家的事，大家商量着办' },
      { id: 'lex-zl-02', formal: '坚持和发展新时代"枫桥经验"', plain: '矛盾不上交，就地解决' },
      { id: 'lex-zl-03', formal: '健全自治、法治、德治相结合的城乡基层治理体系', plain: '村规民约、法律、道德一起上' },
      { id: 'lex-zl-04', formal: '提升网格化服务管理精细化水平', plain: '划小格子，把管理做细' },
      { id: 'lex-zl-05', formal: '发挥社会组织协同治理作用', plain: '让专业组织帮着办事' },
      { id: 'lex-zl-06', formal: '畅通和规范群众诉求表达渠道', plain: '老百姓说话要有人听、有回音' },
      { id: 'lex-zl-07', formal: '推进社会治理数字化、智能化', plain: '用技术把治理做到精细' },
      { id: 'lex-zl-08', formal: '推动资源、服务、管理向基层下沉', plain: '基层要有权、有钱、有人办事' },
    ],
  },
  {
    key: 'jiuye',
    name: '就业优先',
    items: [
      { id: 'lex-jy-01', formal: '落实就业优先战略', plain: '就业是最大的民生' },
      { id: 'lex-jy-02', formal: '促进高质量充分就业', plain: '不光有活干，还要干得像样' },
      { id: 'lex-jy-03', formal: '健全就业公共服务体系', plain: '找工作有地方帮忙、有信息可查' },
      { id: 'lex-jy-04', formal: '大规模开展职业技能培训', plain: '让劳动者有一技之长' },
      { id: 'lex-jy-05', formal: '抓好重点群体就业', plain: '毕业生、农民工、退役军人要先帮' },
      { id: 'lex-jy-06', formal: '以创业带动就业', plain: '一个人创业能带动一群人就业' },
      { id: 'lex-jy-07', formal: '构建和谐劳动关系', plain: '欠薪、克扣这些事不能有' },
      { id: 'lex-jy-08', formal: '拓宽市场化社会化就业渠道', plain: '多开几条就业的路子' },
    ],
  },
]

/** 全部条目打平（收藏与搜索用） */
export const LEXICON_ITEMS = LEXICON_THEMES.flatMap((t) =>
  t.items.map((it) => ({ ...it, theme: t.name, themeKey: t.key })))

export const LEXICON_COUNT = LEXICON_ITEMS.length
