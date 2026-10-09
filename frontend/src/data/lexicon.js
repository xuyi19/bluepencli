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

      { id: 'lex-ms-09', formal: '完善"一老一小"服务体系', plain: '老人和孩子的难处要有人专门管' },
      { id: 'lex-ms-10', formal: '推进健康中国建设', plain: '让群众看得上病、看得好病' },
      { id: 'lex-ms-11', formal: '坚持房子是用来住的、不是用来炒的定位', plain: '房子是住的不是炒的' },
      { id: 'lex-ms-12', formal: '加快补齐农村基础设施和公共服务短板', plain: '村里的路、水、网、学校、医院不能差城里太多' },
      { id: 'lex-ms-13', formal: '健全分层分类的社会救助体系', plain: '困难群众按困难程度有人拉一把' },
      { id: 'lex-ms-14', formal: '发展普惠托育服务', plain: '送孩子上托班不再难、不再贵' },
      { id: 'lex-ms-15', formal: '扎实推进老旧小区改造', plain: '老房子装电梯、修管网、添车位' },
      { id: 'lex-ms-16', formal: '推进全民参保计划', plain: '养老医疗要应保尽保，一个人不能漏' },
      { id: 'lex-ms-17', formal: '发展银发经济', plain: '把老年人的需求变成新的产业和岗位' },
      { id: 'lex-ms-18', formal: '健全灵活就业人员和新就业形态劳动者社保制度', plain: '送外卖、开网约车也得有社保' },
      { id: 'lex-ms-19', formal: '推动义务教育优质均衡发展和城乡一体化', plain: '家门口的学校都一样好' },
      { id: 'lex-ms-20', formal: '促进优质医疗资源扩容下沉和区域均衡布局', plain: '大医院的好大夫要往基层走' },
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

      { id: 'lex-kj-09', formal: '实现高水平科技自立自强', plain: '关键技术要自己说了算' },
      { id: 'lex-kj-10', formal: '加强基础研究和原始创新', plain: '甘坐冷板凳，干从 0 到 1 的事' },
      { id: 'lex-kj-11', formal: '统筹推进教育科技人才体制机制一体改革', plain: '出人才、出成果要一盘棋' },
      { id: 'lex-kj-12', formal: '完善科技人才评价和激励机制', plain: '让搞科研的人有尊严、有回报' },
      { id: 'lex-kj-13', formal: '支持科技型中小企业创新发展', plain: '小企业搞研发要有帮扶' },
      { id: 'lex-kj-14', formal: '前瞻布局未来产业', plain: '下一个风口要提前占位' },
      { id: 'lex-kj-15', formal: '促进数字经济与实体经济深度融合', plain: '网上的技术要落到工厂车间' },
      { id: 'lex-kj-16', formal: '强化国家战略科技力量', plain: '国家队的科研力量要顶得上大事' },
      { id: 'lex-kj-17', formal: '加快建设国家实验室体系', plain: '顶天立地的科研平台要抓紧建' },
      { id: 'lex-kj-18', formal: '完善科技金融支持机制', plain: '搞研发的钱要有地方来、来得顺' },
      { id: 'lex-kj-19', formal: '推动人工智能等新技术赋能千行百业', plain: '新技术要落到各行各业用起来' },
      { id: 'lex-kj-20', formal: '扩大国际科技交流合作', plain: '搞科研不能关起门来自己干' },
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

      { id: 'lex-dj-09', formal: '持续为基层减负赋能', plain: '别让基层干部陷在文山会海里' },
      { id: 'lex-dj-10', formal: '树牢造福人民的政绩观', plain: '干事为了老百姓，不是为了个人升迁' },
      { id: 'lex-dj-11', formal: '勇于自我革命', plain: '敢于直面并改正自己的问题' },
      { id: 'lex-dj-12', formal: '加强年轻干部实践锻炼', plain: '年轻干部要到吃劲岗位上练' },
      { id: 'lex-dj-13', formal: '健全全面从严治党体系', plain: '管党治党要有章法、成体系' },
      { id: 'lex-dj-14', formal: '推进政治监督具体化、精准化、常态化', plain: '监督要落到具体事上，不能空转' },
      { id: 'lex-dj-15', formal: '坚持严管和厚爱结合', plain: '对干部既要有要求，也要有温度' },
      { id: 'lex-dj-16', formal: '坚持不懈用党的创新理论凝心铸魂', plain: '思想上要先武装起来' },
      { id: 'lex-dj-17', formal: '增强党组织政治功能和组织功能', plain: '党组织要既把方向又能聚人心' },
      { id: 'lex-dj-18', formal: '锲而不舍落实中央八项规定精神', plain: '作风建设永远在路上，不能反弹' },
      { id: 'lex-dj-19', formal: '一体推进不敢腐、不能腐、不想腐', plain: '惩治、制度、教育三管齐下治腐败' },
      { id: 'lex-dj-20', formal: '健全培养选拔优秀年轻干部常态化工作机制', plain: '年轻干部要源源不断顶上来' },
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

      { id: 'lex-fz-09', formal: '因地制宜发展新质生产力', plain: '有啥条件干啥事，不一哄而上' },
      { id: 'lex-fz-10', formal: '建设全国统一大市场', plain: '不能搞地方保护、各搭各的小圈子' },
      { id: 'lex-fz-11', formal: '统筹发展和安全', plain: '发展要快，风险要防得住' },
      { id: 'lex-fz-12', formal: '提升产业链供应链韧性和安全水平', plain: '断供卡脖子要有备手' },
      { id: 'lex-fz-13', formal: '推进以县城为重要载体的新型城镇化建设', plain: '县城承接进城农民，公共服务跟上' },
      { id: 'lex-fz-14', formal: '培育壮大经营主体', plain: '让市场主体多起来、强起来' },
      { id: 'lex-fz-15', formal: '持续优化市场化法治化国际化营商环境', plain: '让企业愿意来、留得住、干得好' },
      { id: 'lex-fz-16', formal: '加快建设制造强国、质量强国', plain: '造东西的本事要过硬' },
      { id: 'lex-fz-17', formal: '促进民营经济发展壮大', plain: '让民营企业能放心干、大胆干' },
      { id: 'lex-fz-18', formal: '全面推进乡村振兴', plain: '农村要产业旺、人气足、环境好' },
      { id: 'lex-fz-19', formal: '深入实施区域重大战略和区域协调发展战略', plain: '东中西部一盘棋，不能各干各的' },
      { id: 'lex-fz-20', formal: '加快发展方式绿色转型', plain: '挣钱的路子要换成不欠生态账的' },
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

      { id: 'lex-st-09', formal: '全面落实河湖长制、林长制', plain: '每条河、每片林都有人负责' },
      { id: 'lex-st-10', formal: '统筹山水林田湖草沙一体化保护和系统治理', plain: '山、水、林、田是一个整体，不能头疼医头' },
      { id: 'lex-st-11', formal: '发展生态旅游等绿色富民产业', plain: '好山好水能变成老百姓的票子' },
      { id: 'lex-st-12', formal: '倡导绿色低碳的生产生活方式', plain: '少用一次性用品、多坐公交' },
      { id: 'lex-st-13', formal: '推动能耗双控向碳排放双控转变', plain: '管排碳比只管用电用煤更科学' },
      { id: 'lex-st-14', formal: '加强生物多样性保护', plain: '珍稀动植物不能在我们手里没了' },
      { id: 'lex-st-15', formal: '深入实施主体功能区战略', plain: '该开发的地方开发，该保护的地方保护' },
      { id: 'lex-st-16', formal: '积极稳妥推进碳达峰碳中和', plain: '先立后破，不能一脚油门踩到底' },
      { id: 'lex-st-17', formal: '加快规划建设新型能源体系', plain: '风电光伏用起来，能源底座要换新' },
      { id: 'lex-st-18', formal: '提升生态系统多样性、稳定性、持续性', plain: '山水的家底要守得住、用得久' },
      { id: 'lex-st-19', formal: '健全现代环境治理体系', plain: '治污不能光靠政府，企业公众都要上' },
      { id: 'lex-st-20', formal: '倡导简约适度、绿色低碳的生活方式', plain: '过日子少铺张，垃圾要分类' },
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

      { id: 'lex-ls-09', formal: '加快高标准农田建设', plain: '土地平整连片、旱涝保收' },
      { id: 'lex-ls-10', formal: '健全粮食产销区省际横向利益补偿机制', plain: '产粮大省吃了亏，要有制度性补偿' },
      { id: 'lex-ls-11', formal: '深入开展粮食节约行动', plain: '从餐桌到田间都别浪费' },
      { id: 'lex-ls-12', formal: '培育壮大新型农业经营主体', plain: '种粮大户、合作社、家庭农场唱主角' },
      { id: 'lex-ls-13', formal: '强化农业科技和装备支撑', plain: '良种、农机顶大用' },
      { id: 'lex-ls-14', formal: '保障农资供应和价格稳定', plain: '种子化肥不能断供、不能乱涨价' },
      { id: 'lex-ls-15', formal: '统筹做好粮食和重要农产品保供稳价', plain: '米袋子、菜篮子要稳得住' },
      { id: 'lex-ls-16', formal: '全面加强耕地保护和用途管控', plain: '良田粮用，不能想占就占' },
      { id: 'lex-ls-17', formal: '深入实施优质粮食工程', plain: '不但要够吃，还要吃得好' },
      { id: 'lex-ls-18', formal: '促进小农户和现代农业发展有机衔接', plain: '小农户种地也要搭上现代化的车' },
      { id: 'lex-ls-19', formal: '全面落实粮食安全党政同责', plain: '粮食出了问题，党政一起担责' },
      { id: 'lex-ls-20', formal: '树立节约减损就是增产的理念', plain: '省下的粮食等于多打的粮食' },
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

      { id: 'lex-fz2-09', formal: '健全重大行政决策程序制度', plain: '政府大事不能拍脑袋' },
      { id: 'lex-fz2-10', formal: '全面推行行政执法公示、全过程记录、重大执法决定法制审核制度', plain: '执法要亮明身份、全程留痕' },
      { id: 'lex-fz2-11', formal: '持续优化政务服务', plain: '群众和企业办事少跑腿、材料少交' },
      { id: 'lex-fz2-12', formal: '健全现代公共法律服务体系', plain: '找律师、办公证、要法律援助有地方' },
      { id: 'lex-fz2-13', formal: '坚持严格执法、公正司法、全民守法', plain: '执行、审判、守法三个环节都要硬' },
      { id: 'lex-fz2-14', formal: '完善人民调解、行政调解、司法调解联动工作机制', plain: '调解要成体系，别各管一段' },
      { id: 'lex-fz2-15', formal: '依法保护民营企业产权和企业家权益', plain: '民企的合法财产不能随便动' },
      { id: 'lex-fz2-16', formal: '全面推进国家各方面工作法治化', plain: '干什么事都要于法有据' },
      { id: 'lex-fz2-17', formal: '深化司法体制综合配套改革', plain: '判案要公道，执行要落地' },
      { id: 'lex-fz2-18', formal: '加强知识产权法治保障', plain: '创新的成果法律要护得住' },
      { id: 'lex-fz2-19', formal: '实施公民法治素养提升行动', plain: '守法用法要成为全民习惯' },
      { id: 'lex-fz2-20', formal: '健全社会公平正义法治保障制度', plain: '让老百姓在每起案子里都感受到公道' },
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

      { id: 'lex-zl-09', formal: '坚持关口前移、源头治理', plain: '有苗头就处理，别等闹大' },
      { id: 'lex-zl-10', formal: '加强社区工作者队伍建设', plain: '社区要有专业的人干专业的事' },
      { id: 'lex-zl-11', formal: '完善社会治安整体防控体系', plain: '打、防、管、控一起抓' },
      { id: 'lex-zl-12', formal: '健全应急预案和应急救援力量体系', plain: '灾害来了拉得出、顶得上' },
      { id: 'lex-zl-13', formal: '推进信访工作法治化', plain: '反映问题要依法，办理信访也要依法' },
      { id: 'lex-zl-14', formal: '健全社会组织参与治理的机制', plain: '让专业组织有渠道帮上忙' },
      { id: 'lex-zl-15', formal: '依法保障妇女儿童合法权益', plain: '妇女儿童的事不是小事' },
      { id: 'lex-zl-16', formal: '健全网格化管理、精细化服务、信息化支撑的基层治理平台', plain: '一格一网把事管到位' },
      { id: 'lex-zl-17', formal: '健全社会心理服务体系和危机干预机制', plain: '心里的疙瘩也要有人疏导' },
      { id: 'lex-zl-18', formal: '建设人人有责、人人尽责、人人享有的社会治理共同体', plain: '治理的事大家干，成果大家享' },
      { id: 'lex-zl-19', formal: '强化食品药品安全监管', plain: '入口的东西必须有保障' },
      { id: 'lex-zl-20', formal: '完善志愿服务体系和工作制度', plain: '做好事要有组织、有保障' },
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

      { id: 'lex-jy-09', formal: '支持多渠道灵活就业', plain: '自由职业、兼职也是正经就业路' },
      { id: 'lex-jy-10', formal: '健全终身职业技能培训制度', plain: '干到老、学到老，技能一直有人教' },
      { id: 'lex-jy-11', formal: '完善新就业形态劳动者权益保障', plain: '外卖骑手、网约车司机要有保障' },
      { id: 'lex-jy-12', formal: '消除影响平等就业的不合理限制和就业歧视', plain: '招人不能看性别、年龄、出身' },
      { id: 'lex-jy-13', formal: '健全就业失业统计监测体系', plain: '就业形势要看得清、报得准' },
      { id: 'lex-jy-14', formal: '打造高质量充分就业社区（村）', plain: '就业服务落到家门口' },
      { id: 'lex-jy-15', formal: '做好高校毕业生等青年就业工作', plain: '大学生就业是重中之重' },
      { id: 'lex-jy-16', formal: '强化就业优先政策，健全就业促进机制', plain: '经济社会政策要把就业摆在优先位置' },
      { id: 'lex-jy-17', formal: '支持和规范发展新就业形态', plain: '新岗位既要扶起来也要管起来' },
      { id: 'lex-jy-18', formal: '保障农民工工资支付，根治欠薪问题', plain: '干活给钱，一分不能欠' },
      { id: 'lex-jy-19', formal: '推动解决结构性就业矛盾', plain: '有人没活干、有活没人干的错位要对上' },
      { id: 'lex-jy-20', formal: '做好退役军人和困难群体就业帮扶', plain: '最难找工作的群体要有人拉一把' },
    ],
  },
]

/** 全部条目打平（收藏与搜索用） */
export const LEXICON_ITEMS = LEXICON_THEMES.flatMap((t) =>
  t.items.map((it) => ({ ...it, theme: t.name, themeKey: t.key })))

export const LEXICON_COUNT = LEXICON_ITEMS.length
