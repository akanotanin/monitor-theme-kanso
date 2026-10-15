/**
 * 「地区识别」：从节点的名字 / 分组 / 国家码里认出一台机器属于哪个地区（城名 / 国名 / 两字码）。
 *
 * 数据与判据是从上一代实现里原样留下的那一半（海岸线、落点绘制那些不进这里）：
 *   · `CITY_HINTS` 城市线索 —— 名字里出现这些词就按这座城市算；
 *   · `COUNTRY_LL` / `COUNTRY_NAME` / `COUNTRY_CITY_FALLBACK` —— 国家落点、国家英文名、
 *     城市国家（HK/SG/MO）的兜底城名；
 *   · `cityHint` / `regionOf` 两个纯函数。
 *
 * 谁在用它：`search.ts` 的 `searchText` 把「城市英文名 / 国家名 / 城市中文写法」摊进每台机器
 * 的可搜文本（访客打「東京」「japan」「TYO」都搜得到），以及搜索框里那族同义词。本主题不上
 * 地球，`Region.base`（落点）留在这里是因为它本来就是这张表的一部分，没有别处消费。
 *
 * 单测：src/lib/search.test.ts 逐条钉着「中文 ↔ 英文 ↔ 代码」两个方向都要通。
 */


import type { Node } from "./api.ts"

/**
 * ISO 3166-1 alpha-2 → 该国的落点（经度, 纬度）。节点没有自己的经纬度（monitor 的 `/api/nodes` 只给 `country`，不给经纬度），坐标都落在这里。
 *
 * ★ 头 12 行是原站那张表的原样（前 6 行两两一组保持原顺序，值一字未动）；后面那些是
 * 2026-10 有意扩的：原表之外的国家在地区识别里认不出来 —— 第三方站点的大机群（几十台、多国）会撞上这个。
 * 坐标取主要机房城市/首都，城市级近似足够。表外的国家仍不硬塞一个坐标。
 */
export const COUNTRY_LL: Record<string, [number, number]> = {
  HK: [114.2, 22.3], JP: [139.7, 35.7], DE: [8.7, 50.1], NL: [4.9, 52.4],
  US: [-98.6, 39.8], TW: [121.0, 23.7], AU: [134.5, -25.7], SG: [103.82, 1.35],
  KR: [127.8, 36.3], GB: [-2.5, 54.5], FR: [2.2, 46.2], CN: [104.2, 35.8],
  // —— 欧洲
  IE: [-6.26, 53.35], SE: [18.07, 59.33], CH: [8.54, 47.38], FI: [24.94, 60.17],
  NO: [10.75, 59.91], DK: [12.57, 55.68], BE: [4.35, 50.85], AT: [16.37, 48.21],
  CZ: [14.44, 50.08], PL: [21.01, 52.23], UA: [30.52, 50.45], RO: [26.1, 44.43],
  BG: [23.32, 42.7], HU: [19.04, 47.5], SK: [17.11, 48.15], SI: [14.51, 46.06],
  HR: [15.98, 45.81], RS: [20.45, 44.79], GR: [23.73, 37.98], PT: [-9.14, 38.72],
  IT: [9.19, 45.46], ES: [-3.7, 40.42], EE: [24.75, 59.44], LV: [24.11, 56.95],
  LT: [25.28, 54.69], IS: [-21.94, 64.15], LU: [6.13, 49.61], MD: [28.86, 47.01],
  CY: [33.37, 35.19], MT: [14.51, 35.9], BY: [27.57, 53.9], RU: [37.62, 55.76],
  TR: [28.98, 41.01],
  // —— 北美与拉美
  CA: [-79.38, 43.65], MX: [-99.13, 19.43], BR: [-46.63, -23.55], AR: [-58.38, -34.6],
  CL: [-70.67, -33.45], CO: [-74.07, 4.71], PE: [-77.04, -12.05], EC: [-78.47, -0.18],
  PA: [-79.52, 8.98], PR: [-66.11, 18.47],
  // —— 亚洲（中东并入）
  IN: [72.88, 19.08], PK: [67.0, 24.86], BD: [90.41, 23.81], LK: [79.86, 6.93],
  NP: [85.32, 27.72], MY: [101.69, 3.14], TH: [100.5, 13.76], VN: [105.83, 21.03],
  ID: [106.85, -6.21], PH: [120.98, 14.6], KH: [104.92, 11.56], MO: [113.54, 22.2],
  AE: [55.27, 25.2], SA: [46.72, 24.71], QA: [51.53, 25.29], KW: [47.98, 29.38],
  BH: [50.59, 26.23], OM: [58.41, 23.59], IL: [34.78, 32.09], JO: [35.91, 31.95],
  GE: [44.83, 41.72], AM: [44.51, 40.18], AZ: [49.87, 40.41], KZ: [76.89, 43.24],
  UZ: [69.24, 41.31], MN: [106.92, 47.89],
  // —— 非洲与大洋洲
  ZA: [28.05, -26.2], EG: [31.24, 30.04], MA: [-7.59, 33.57], NG: [3.38, 6.52],
  KE: [36.82, -1.29], NZ: [174.76, -36.85],
}


/**
 * 国家英文名：认不出城市时，地区名（右侧列表与地区名）写的就是它。
 *
 * ★ 这是「地区识别」的第三层，2026-10-11 加的：城市线索 → 城市国家兜底
 * （见 `COUNTRY_CITY_FALLBACK`）→ 国家名。在此之前第三层直接写两字国家码，
 * 于是第三方站点的地区列表里「US」（码）、「Japan」（旧兜底名）、「Phoenix」（城名）
 * 三种口径并排出现 —— 站长拿反馈截图来问「这个地区识别是按国别还是地区？」。
 * 现在每一行都是「能认到的最准的地名」：城市优先，认不出城市就写国家名。
 *
 * 与 `COUNTRY_LL` 同一张清单（凡能上地球的国家都有名字，单测盯着这条全覆盖）；
 * 写法取英文常用短名，与城市名（CITY_HINTS 的第三项）同一套语言。
 */
export const COUNTRY_NAME: Record<string, string> = {
  HK: "Hong Kong", JP: "Japan", DE: "Germany", NL: "Netherlands",
  US: "United States", TW: "Taiwan", AU: "Australia", SG: "Singapore",
  KR: "Korea", GB: "United Kingdom", FR: "France", CN: "China",
  // —— 欧洲
  IE: "Ireland", SE: "Sweden", CH: "Switzerland", FI: "Finland",
  NO: "Norway", DK: "Denmark", BE: "Belgium", AT: "Austria",
  CZ: "Czech Republic", PL: "Poland", UA: "Ukraine", RO: "Romania",
  BG: "Bulgaria", HU: "Hungary", SK: "Slovakia", SI: "Slovenia",
  HR: "Croatia", RS: "Serbia", GR: "Greece", PT: "Portugal",
  IT: "Italy", ES: "Spain", EE: "Estonia", LV: "Latvia",
  LT: "Lithuania", IS: "Iceland", LU: "Luxembourg", MD: "Moldova",
  CY: "Cyprus", MT: "Malta", BY: "Belarus", RU: "Russia",
  TR: "Turkey",
  // —— 北美与拉美
  CA: "Canada", MX: "Mexico", BR: "Brazil", AR: "Argentina",
  CL: "Chile", CO: "Colombia", PE: "Peru", EC: "Ecuador",
  PA: "Panama", PR: "Puerto Rico",
  // —— 亚洲（中东并入）
  IN: "India", PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka",
  NP: "Nepal", MY: "Malaysia", TH: "Thailand", VN: "Vietnam",
  ID: "Indonesia", PH: "Philippines", KH: "Cambodia", MO: "Macau",
  AE: "United Arab Emirates", SA: "Saudi Arabia", QA: "Qatar", KW: "Kuwait",
  BH: "Bahrain", OM: "Oman", IL: "Israel", JO: "Jordan",
  GE: "Georgia", AM: "Armenia", AZ: "Azerbaijan", KZ: "Kazakhstan",
  UZ: "Uzbekistan", MN: "Mongolia",
  // —— 非洲与大洋洲
  ZA: "South Africa", EG: "Egypt", MA: "Morocco", NG: "Nigeria",
  KE: "Kenya", NZ: "New Zealand",
}


/**
 * 城市线索：节点名（hub 只有 name 与 group 两个字段可用）里出现这些词，就按这座城市算 —— 比按国家落点准得多。
 *
 * 顺序即优先级（第一条命中的赢），例如 `CHICAGO…NY` 那条要排在 `NYC` 之后。
 * 第三项是城市英文名，用作地区列表的显示名。
 *
 * ★ 2026-10 从 24 条扩到 ~100 条（常见 IDC 城市与机场码 + 中文写法）：第三方站点的
 * 大机群以前大半认不出城市、全堆在国家码下（「US 19」）。两条写法约定要守：
 *   ① 代码只用 **3 字码或全名**，两字码（`UT`/`LA` 这种）会被别的词误命中，不收；
 *   ② 写法照旧「`\b(CODE|CITY NAME)\b|中文`」——`search.ts` 的 `CITY_ALIASES` 直接从
 *      正则里抽三字码与中文，另写一份就会两套不同步。
 */
export const CITY_HINTS: { match: RegExp; ll: [number, number]; name: string }[] = [
  { match: /\b(SJC|SAN JOSE)\b|圣何塞/i, ll: [-121.8863, 37.3382], name: 'San Jose' },
  { match: /\b(LAX|LOS ANGELES)\b|洛杉矶/i, ll: [-118.2437, 34.0522], name: 'Los Angeles' },
  { match: /\b(NYC|NEW YORK)\b|纽约/i, ll: [-74.006, 40.7128], name: 'New York' },
  { match: /\b(ORD|CHICAGO)\b|芝加哥/i, ll: [-87.6298, 41.8781], name: 'Chicago' },
  { match: /\b(SEA|SEATTLE)\b|西雅图/i, ll: [-122.3321, 47.6062], name: 'Seattle' },
  { match: /\b(DAL|DFW|DALLAS)\b|达拉斯/i, ll: [-96.797, 32.7767], name: 'Dallas' },
  { match: /\b(HKG|HONG KONG|HK)\b|香港/i, ll: [114.1694, 22.3193], name: 'Hong Kong' },
  { match: /\b(TYO|TOKYO)\b|东京|東京/i, ll: [139.6917, 35.6895], name: 'Tokyo' },
  { match: /\b(OSA|OSAKA)\b|大阪/i, ll: [135.5023, 34.6937], name: 'Osaka' },
  { match: /\b(SEL|SEOUL)\b|首尔|首爾|서울/i, ll: [126.978, 37.5665], name: 'Seoul' },
  { match: /\b(SIN|SINGAPORE|SG)\b|新加坡/i, ll: [103.8198, 1.3521], name: 'Singapore' },
  { match: /\b(TPE|TAIPEI)\b|台北|臺北/i, ll: [121.5654, 25.033], name: 'Taipei' },
  { match: /\b(AMS|AMSTERDAM)\b|阿姆斯特丹/i, ll: [4.9041, 52.3676], name: 'Amsterdam' },
  { match: /\b(FRA|FRANKFURT)\b|法兰克福|法蘭克福/i, ll: [8.6821, 50.1109], name: 'Frankfurt am Main' },
  { match: /\b(LON|LONDON)\b|伦敦|倫敦/i, ll: [-0.1276, 51.5072], name: 'London' },
  { match: /\b(PAR|PARIS)\b|巴黎/i, ll: [2.3522, 48.8566], name: 'Paris' },
  { match: /\b(SYD|SYDNEY)\b|悉尼|雪梨/i, ll: [151.2093, -33.8688], name: 'Sydney' },
  { match: /\b(SHA|SHANGHAI)\b|上海/i, ll: [121.4737, 31.2304], name: 'Shanghai' },
  { match: /\b(PEK|BEIJING)\b|北京/i, ll: [116.4074, 39.9042], name: 'Beijing' },
  { match: /\b(CAN|GUANGZHOU)\b|广州|廣州/i, ll: [113.2644, 23.1291], name: 'Guangzhou' },
  { match: /\b(TXG|TAICHUNG)\b|台中|臺中/i, ll: [120.6736, 24.1477], name: 'Taichung' },
  // ★ 2026-10-08 扩展块（常见 IDC 城市/机场码；写法约定见上面的注释）。
  // —— 美国
  { match: /\b(ASHBURN|IAD)\b|阿什本/i, ll: [-77.4874, 39.0438], name: 'Ashburn' },
  { match: /\b(PHOENIX|PHX)\b|凤凰城|鳳凰城/i, ll: [-112.074, 33.4484], name: 'Phoenix' },
  { match: /\b(SALT LAKE|SLC)\b|盐湖城|鹽湖城/i, ll: [-111.891, 40.7608], name: 'Salt Lake City' },
  { match: /\b(MIAMI|MIA)\b|迈阿密|邁阿密/i, ll: [-80.1918, 25.7617], name: 'Miami' },
  { match: /\b(ATLANTA|ATL)\b|亚特兰大|亞特蘭大/i, ll: [-84.388, 33.749], name: 'Atlanta' },
  { match: /\b(LAS VEGAS|LAS)\b|拉斯维加斯|拉斯維加斯/i, ll: [-115.1398, 36.1699], name: 'Las Vegas' },
  { match: /\b(PORTLAND|PDX|HILLSBORO)\b|波特兰|波特蘭/i, ll: [-122.6765, 45.5231], name: 'Portland' },
  { match: /\b(DENVER|DEN)\b|丹佛/i, ll: [-104.9903, 39.7392], name: 'Denver' },
  { match: /\b(FREMONT)\b|弗里蒙特/i, ll: [-121.9886, 37.5485], name: 'Fremont' },
  { match: /\b(SAN FRANCISCO|SFO)\b|旧金山|舊金山|三藩市/i, ll: [-122.4194, 37.7749], name: 'San Francisco' },
  { match: /\bSANTA CLARA\b|圣克拉拉|聖克拉拉/i, ll: [-121.9552, 37.3541], name: 'Santa Clara' },
  // —— 加拿大与拉美
  { match: /\b(TORONTO|YYZ)\b|多伦多|多倫多/i, ll: [-79.3832, 43.6532], name: 'Toronto' },
  { match: /\b(MONTREAL|YUL)\b|蒙特利尔|蒙特利爾/i, ll: [-73.5674, 45.5019], name: 'Montreal' },
  { match: /\b(VANCOUVER|YVR)\b|温哥华|溫哥華/i, ll: [-123.1207, 49.2827], name: 'Vancouver' },
  { match: /\b(SAO PAULO|SÃO PAULO|GRU)\b|圣保罗|聖保羅/i, ll: [-46.6333, -23.5505], name: 'Sao Paulo' },
  { match: /\b(BUENOS AIRES|EZE)\b|布宜诺斯艾利斯|布宜諾斯艾利斯/i, ll: [-58.3816, -34.6037], name: 'Buenos Aires' },
  { match: /\b(SANTIAGO|SCL)\b/i, ll: [-70.6693, -33.4489], name: 'Santiago' },
  { match: /\b(BOGOTA|BOGOTÁ|BOG)\b|波哥大/i, ll: [-74.0721, 4.711], name: 'Bogota' },
  { match: /\b(LIMA|LIM)\b|利马|利馬/i, ll: [-77.0428, -12.0464], name: 'Lima' },
  { match: /\b(MEXICO CITY|CDMX|MEX)\b|墨西哥城/i, ll: [-99.1332, 19.4326], name: 'Mexico City' },
  // —— 亚太
  { match: /\b(MACAU|MACAO|MFM)\b|澳门|澳門/i, ll: [113.5439, 22.1987], name: 'Macau' },
  { match: /\b(BANGKOK|BKK)\b|曼谷/i, ll: [100.5018, 13.7563], name: 'Bangkok' },
  { match: /\b(KUALA LUMPUR|KUL)\b|吉隆坡/i, ll: [101.6869, 3.139], name: 'Kuala Lumpur' },
  { match: /\b(JAKARTA|CGK)\b|雅加达|雅加達/i, ll: [106.8456, -6.2088], name: 'Jakarta' },
  { match: /\b(MANILA|MNL)\b|马尼拉|馬尼拉/i, ll: [120.9842, 14.5995], name: 'Manila' },
  { match: /\b(MUMBAI|BOMBAY|BOM)\b|孟买|孟買/i, ll: [72.8777, 19.076], name: 'Mumbai' },
  // ★ 顺序敏感：「马德里」含「德里」子串 —— Madrid 必须排在 Delhi 之前，否则整座
  //   马德里会被 Delhi 的 /…|德里/ 抢走、落到印度（2026-10-10 在 100 台演示站上看到
  //   「ES · Delhi ×2」才发现）。顺序改错时 search.test.ts 的「城市线索」一族断言会当场红。
  { match: /\b(MADRID|MAD)\b|马德里|馬德里/i, ll: [-3.7038, 40.4168], name: 'Madrid' },
  { match: /\b(NEW DELHI|DELHI|DEL)\b|新德里|德里/i, ll: [77.1025, 28.7041], name: 'Delhi' },
  { match: /\b(BANGALORE|BENGALURU|BLR)\b|班加罗尔|班加羅爾/i, ll: [77.5946, 12.9716], name: 'Bangalore' },
  { match: /\b(CHENNAI|MAA)\b/i, ll: [80.2707, 13.0827], name: 'Chennai' },
  { match: /\b(HANOI|HAN)\b|河内|河內/i, ll: [105.8342, 21.0278], name: 'Hanoi' },
  { match: /\b(HO CHI MINH|SAIGON|SGN)\b|胡志明/i, ll: [106.6297, 10.8231], name: 'Ho Chi Minh City' },
  { match: /\b(KARACHI|KHI)\b|卡拉奇/i, ll: [67.0011, 24.8607], name: 'Karachi' },
  { match: /\b(MELBOURNE|MEL)\b|墨尔本|墨爾本/i, ll: [144.9631, -37.8136], name: 'Melbourne' },
  { match: /\b(AUCKLAND|AKL)\b|奥克兰|奧克蘭/i, ll: [174.7633, -36.8485], name: 'Auckland' },
  // —— 中国大陆（英文/拼音与中文写法）
  { match: /\b(SHENZHEN|SZX)\b|深圳/i, ll: [114.0579, 22.5431], name: 'Shenzhen' },
  { match: /\b(HANGZHOU|HGH)\b|杭州/i, ll: [120.1551, 30.2741], name: 'Hangzhou' },
  { match: /\b(CHENGDU|CTU)\b|成都/i, ll: [104.0668, 30.5728], name: 'Chengdu' },
  { match: /\b(NANJING|NKG)\b|南京/i, ll: [118.7969, 32.0603], name: 'Nanjing' },
  { match: /\b(WUHAN|WUH)\b|武汉|武漢/i, ll: [114.3055, 30.5928], name: 'Wuhan' },
  { match: /\b(XIY|XI'AN|XIAN)\b|西安/i, ll: [108.9398, 34.3416], name: "Xi'an" },
  { match: /\b(CHONGQING|CKG)\b|重庆|重慶/i, ll: [106.5516, 29.563], name: 'Chongqing' },
  { match: /\b(QINGDAO|TAO)\b|青岛|青島/i, ll: [120.3826, 36.0671], name: 'Qingdao' },
  { match: /\b(TIANJIN|TSN)\b|天津/i, ll: [117.3616, 39.3434], name: 'Tianjin' },
  { match: /\b(CHANGSHA|CSX)\b|长沙|長沙/i, ll: [112.9388, 28.2282], name: 'Changsha' },
  { match: /\b(ZHENGZHOU|CGO)\b|郑州|鄭州/i, ll: [113.6254, 34.7466], name: 'Zhengzhou' },
  { match: /\b(XIAMEN|XMN)\b|厦门|廈門/i, ll: [118.0894, 24.4798], name: 'Xiamen' },
  // —— 欧洲
  { match: /\b(DUBLIN|DUB)\b|都柏林/i, ll: [-6.2603, 53.3498], name: 'Dublin' },
  { match: /\b(HELSINKI|HEL)\b|赫尔辛基|赫爾辛基/i, ll: [24.9384, 60.1699], name: 'Helsinki' },
  { match: /\b(STOCKHOLM|ARN)\b|斯德哥尔摩|斯德哥爾摩/i, ll: [18.0686, 59.3293], name: 'Stockholm' },
  { match: /\b(OSLO|OSL)\b|奥斯陆|奧斯陸/i, ll: [10.7522, 59.9139], name: 'Oslo' },
  { match: /\b(COPENHAGEN|CPH)\b|哥本哈根/i, ll: [12.5683, 55.6761], name: 'Copenhagen' },
  { match: /\b(ZURICH|ZÜRICH|ZRH)\b|苏黎世|蘇黎世/i, ll: [8.5417, 47.3769], name: 'Zurich' },
  { match: /\b(VIENNA|VIE)\b|维也纳|維也納/i, ll: [16.3738, 48.2082], name: 'Vienna' },
  { match: /\b(BRUSSELS|BRU)\b|布鲁塞尔|布魯塞爾/i, ll: [4.3517, 50.8503], name: 'Brussels' },
  // （Madrid 挪去了 Delhi 前面：顺序敏感，见「马德里」那行上的注释。）
  { match: /\b(LISBON|LIS)\b|里斯本/i, ll: [-9.1393, 38.7223], name: 'Lisbon' },
  { match: /\b(MILAN|MILANO|MXP)\b|米兰|米蘭/i, ll: [9.19, 45.4642], name: 'Milan' },
  { match: /\b(ATHENS|ATH)\b|雅典/i, ll: [23.7275, 37.9838], name: 'Athens' },
  { match: /\b(WARSAW|WAW)\b|华沙|華沙/i, ll: [21.0122, 52.2297], name: 'Warsaw' },
  { match: /\b(PRAGUE|PRG)\b|布拉格/i, ll: [14.4378, 50.0755], name: 'Prague' },
  { match: /\b(BUDAPEST|BUD)\b|布达佩斯|布達佩斯/i, ll: [19.0402, 47.4979], name: 'Budapest' },
  { match: /\b(BUCHAREST|OTP)\b|布加勒斯特/i, ll: [26.1025, 44.4268], name: 'Bucharest' },
  { match: /\b(SOFIA|SOF)\b|索菲亚|索菲亞/i, ll: [23.3219, 42.6977], name: 'Sofia' },
  { match: /\b(KYIV|KIEV|KBP)\b|基辅|基輔/i, ll: [30.5234, 50.4501], name: 'Kyiv' },
  { match: /\b(RIGA|RIX)\b|里加/i, ll: [24.1052, 56.9496], name: 'Riga' },
  { match: /\b(TALLINN|TLL)\b|塔林/i, ll: [24.7536, 59.437], name: 'Tallinn' },
  { match: /\b(VILNIUS|VNO)\b|维尔纽斯|維爾紐斯/i, ll: [25.2797, 54.6872], name: 'Vilnius' },
  { match: /\b(MOSCOW|MOW|SVO)\b|莫斯科/i, ll: [37.6173, 55.7558], name: 'Moscow' },
  { match: /SAINT[ -]?PETERSBURG|ST\.?[ -]?PETERSBURG|圣彼得堡|聖彼得堡/i, ll: [30.3351, 59.9343], name: 'Saint Petersburg' },
  { match: /\b(ISTANBUL|IST)\b|伊斯坦布尔|伊斯坦堡/i, ll: [28.9784, 41.0082], name: 'Istanbul' },
  { match: /\b(LUXEMBOURG|LUX)\b|卢森堡/i, ll: [6.13, 49.6116], name: 'Luxembourg' },
  // —— 中东、非洲
  { match: /\b(DUBAI|DXB)\b|迪拜/i, ll: [55.2708, 25.2048], name: 'Dubai' },
  { match: /\b(TEL AVIV|TLV)\b|特拉维夫/i, ll: [34.7818, 32.0853], name: 'Tel Aviv' },
  { match: /\b(JOHANNESBURG|JNB)\b|约翰内斯堡|約翰內斯堡/i, ll: [28.0473, -26.2041], name: 'Johannesburg' },
  { match: /\b(BUF|BUFFALO)\b/i, ll: [-78.8784, 42.8864], name: 'Buffalo' },
  { match: /\b(HACIENDA[ _.-]*HEIGHTS)\b/i, ll: [-117.9687, 33.9931], name: 'Hacienda Heights' },
  { match: /\b(NYC|NEW[ _.-]*YORK)\b|CHICAGO[^A-Z0-9]*VPS[^A-Z0-9]*NY/i, ll: [-74.006, 40.7128], name: 'New York' },
]


/**
 * 城市国家的兜底城名：认不出城市时，这几个**本身就是一座城市的地方**照样给城名
 * （它们的国家名与城名同一，给了才不会裂行 —— 上游 `fallbackCity` 对 HK/SG
 * 无条件兜城名，这个坑 2026-10-07 被站长截图报回来过）。
 *
 * ★ 别把它当装饰：少了它，一个 HK 会裂成「HK」与「HK · Hong Kong」两行 —— 名字里写着
 * 香港的那几台落城市级、没写的那几台落国家级，同一面旗并排出现两次（站长截图里就是它）。
 *
 * ★ 2026-10-11 收窄：JP/KR/TW 移出去、改走 `COUNTRY_NAME`（国家级）。它们不是城市国家
 * —— 旧兜底把「Japan」「Korea」这类**国名**放进了城市名的位置（`JP · Japan`），
 * 第三方站点的地区列表因此「有的是国家有的是城市」。现在它们与 US/DE 一样按国家名
 * 显示，只是不再裸写国家码。MO 补进来（澳门与香港同类：一座城市就是一个地区）。
 */
export const COUNTRY_CITY_FALLBACK: Record<string, string> = {
  HK: "Hong Kong",
  SG: "Singapore",
  MO: "Macau",
}

/** 节点名/分组里认出的城市线索。 */
export function cityHint(node: Pick<Node, "name" | "group">): { ll: [number, number]; name: string } | null {
  const text = [node.name, node.group].filter(Boolean).join(" ")
  for (const hint of CITY_HINTS) if (hint.match.test(text)) return { ll: hint.ll, name: hint.name }
  return null
}

export type Region = {
  /** 地区键（`CC` 或 `CC · 城市名`）：筛选与选中态用它。 */
  key: string
  /** ISO 3166-1 alpha-2；空串 = 认不出国家。 */
  code: string
  /** 城市英文名（线索没命中时按 `COUNTRY_CITY_FALLBACK` 兜城市国家；空串 = 国家级）。 */
  city: string
  /** 地区列表里显示的文字：有城名用城名，否则用**国家名**（认不出城市时的第三层，见 COUNTRY_NAME）。 */
  label: string
  /** 这一地区的落点（经度, 纬度）。 */
  base: [number, number]
}

/**
 * 一台机器算一个地区。
 *
 * ★ 与上游有意的两处不同（都是为了跟本站已有口径一致）：
 *   ① 上游把 HK/TW 一并写成 CN（`displayRegionCountry`），这里**照实写 HK/TW** ——
 *      hub 给的就是 ISO 码，卡片上那面旗子也是按它取的，别处不该是另一套说法。
 *   ② 上游给认不出国家的节点一个 [80,30] 的兜底落点（在图上是一枚假针），
 *      这里直接 `null` —— 认不出就不猜；下面的列表照旧有它。
 *
 * ★ 地区名有**三层**（2026-10-11 起）：① 名字/分组里的城市线索 → 城市名；
 *   ② 城市国家（HK/SG/MO）认不出城市也兜城名（见 `COUNTRY_CITY_FALLBACK`）；
 *   ③ 其余认不出城市的 → **国家名**（`COUNTRY_NAME`，如 US → United States）。
 *   第三层以前直接写两字国家码，于是地区名里「US」（码）、「Japan」（旧兜底名）、
 *   「Phoenix」（城名）并排出现 —— 站长拿反馈截图来问「按国别还是地区？」。
 *   兜底那层移植时漏过一次：HK 于是裂成「HK」与「HK · Hong Kong」两行，同一面旗并排
 *   出现两次（站长截图里那条就是它）；上游因为无条件兜底，一个 HK 永远只有一行。
 */
export function regionOf(node: Node): Region | null {
  const code = (node.country || "").trim().toUpperCase()
  if (!code) return null
  const hint = cityHint(node)
  const base = hint?.ll ?? COUNTRY_LL[code]
  if (!base) return null
  const city = hint?.name ?? COUNTRY_CITY_FALLBACK[code] ?? ""
  // 第三层：认不出城市写国家名（不再裸写两字码）；表外才退回码本身。
  const label = city || COUNTRY_NAME[code] || code
  return { key: city ? `${code} · ${city}` : code, code, city, label, base: [base[0], base[1]] }
}
