# 星图 xingtu — 浏览器端星空 / 天象仪

一个类似 Stellarium Web 的浏览器端星图：244.9 万颗恒星、立体投影（Stellarium 默认投影）、亚角秒级位置精度、西方星座与三垣二十八宿、太阳月亮八大行星、银河全景背景，全部在浏览器本地渲染。

技术栈：Vite + TypeScript（strict）+ Three.js（自定义 ShaderMaterial 星点）+ astronomy-engine（天文计算）+ Vitest。包管理使用 pnpm，代码风格 ESLint + Prettier。

## 快速开始

```bash
pnpm install        # 安装依赖
pnpm stars:download # 下载原始星表数据到 data/raw/（约 210 MB，见下）
pnpm stars:build    # 预处理：生成 public/data/ 星表瓦片（约 68 MB）
pnpm dev            # 启动开发服务器，打开 http://localhost:5173
```

浏览器打开后即可看到当前时刻上海的星空（默认观测地：上海 31.23N, 121.47E）。

首次体验建议：如果现在是白天，把时间调快到当晚 21:00（时间面板），或直接点"回到当前时刻"后用滚轮缩小到 120° 视场、朝北看北斗。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm stars:download` | 下载原始数据到 `data/raw/`（约 210 MB，断点续传，已有文件跳过） |
| `pnpm stars:build` | 运行预处理脚本 `scripts/build-stars.ts`，输出到 `public/data/` |
| `pnpm dev` | Vite 开发服务器 |
| `pnpm build` | 类型检查 + 生产构建（`dist/`） |
| `pnpm test` | Vitest 单元测试（astro/ 纯计算层） |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |

## 功能

- **天球视角**：相机位于球心，鼠标拖拽转视角，滚轮缩放（FOV 0.04°–300°，以光标为锚点）。
- **立体投影**（stereographic，Stellarium 默认）：宽视场不变形，最大 300° 视场。
- **星点渲染**：244.9 万颗恒星（Tycho-2 主表 + 补充表，V≤~12，远暗于肉眼极限 6 等）。亮度/大小按视星等映射（亮星更大更亮带柔光晕），颜色按 B−V 色指数映射到色温（Ballesteros 2012 + 黑体近似，GPU 查找表）。
- **按视野加载**：亮星档（V<10，35 万颗）整天球常驻；更暗的两档（V 10–11、11+，共 208 万颗）按 HEALPix（nside=8，768 天区）切片，窄视场时只加载视野内天区，LRU 逐出。
- **位置精度**：顶点着色器内按观测时刻推算自行 + 一阶周年/周日光行差（~20.5″ + 0.3″），坐标变换全部用矩阵在 GPU 完成，CPU 不做逐星计算。误差亚角秒级。
- **观测者设置**：经纬度 + 时间。预设地点分"北半球"（上海默认、北京、乌鲁木齐、三亚、东京、新加坡、伦敦、纽约、雷克雅未克）与"南半球"（悉尼、墨尔本、珀斯、奥克兰、基督城、开普敦、约翰内斯堡、布宜诺斯艾利斯、圣地亚哥、利马、拉巴斯、基多、苏瓦、帕皮提、阿塔卡马）两组。时间可暂停 / 实时 / 最高 1 天每秒加速，可跳回当前时刻。
- **地平坐标**：地平圈、地面遮挡（地平线以下被地面盘遮挡）、八方位标记（北 N / 东北 NE / …）。
- **太阳系**：太阳、月亮（含相位明暗界线近似）、七大行星的视位置（topocentric、含光行差与视差）与标签。
- **亮星名称标签**：默认显示 V<2，随缩放逐步放宽到 V<6.2；中文星名优先（天狼星、参宿四、织女一…），无中文名时显示 IAU 名或 Bayer 名。
- **网格**：赤道网格 / 地平网格可开关。
- **星座连线**：西方 88 星座 + 中国传统星官（三垣二十八宿，约 306 官，依《仪象考成》体系）可分别开关。
- **银河背景**：本地银河全景（ESO/S. Brunier，CC BY 4.0），银心对齐、随天光自动变暗；离线可用。（另保留 CDS HiPS 瓦片渲染模块，可扩展为在线巡天。）
- **大气**：大气消光（airmass 近似）+ 月光天光 + 暮光背景色，由"大气浓度"滑块（0–100%）统一控制；默认 35%，天光不会完全覆盖星星。
- **点选信息卡**：点击天体显示名称（中文/IAU/Bayer）、Tycho-2 编号与 HIP 号、视星等、色指数与光谱型、赤经赤纬、当前地平坐标、自行。
- **URL 分享**：观测地、时刻、视场、视线方向实时写入 URL hash，"复制分享链接"一键分享；打开链接即恢复该视角。

## 架构

```
src/
  astro/   纯计算层（不依赖 Three.js，可单测）
    coords.ts        赤道/地平坐标、单位球向量、矩阵运算
    sky.ts           SkyFrame：由 (时刻, 观测者) 推导的渲染所需全部状态
                     （EQJ→HOR 旋转、光行差 β、恒星时、日月高度）
    aberration.ts    周年 + 周日光行差速度（β = v/c, ICRS）
    solarSystem.ts   太阳/月亮/行星 topocentric 视位置
    healpix.ts       HEALPix RING 切片数学（与 astropy-healpix 对照测试）
    color.ts         B−V → RGB（Ballesteros 2012）
    places.ts        观测地预设
  data/    数据加载层
    starCatalog.ts   亮星档 + HEALPix 瓦片流式加载（LRU）
    tyc.ts           TYC 编号打包/解包
  render/  Three.js 渲染层
    projection.ts    SkyCamera：立体投影 + 拖拽缩放 + 屏幕投影/反投影
    shaders.ts       共享 GLSL（自行/光行差/旋转/立体投影全在顶点着色器）
    starfield.ts     星点 ShaderMaterial（共享于所有 bin/瓦片）
    lines.ts         赤道/地平网格
    constellations.ts星座连线（西方 + 中国星官）
    solarSystem.ts   日月行星（月相）
    horizon.ts       地平圈 + 地面遮挡盘
    panorama.ts      银河全景背景
    hips.ts          CDS HiPS 瓦片渲染（在线可选）
    labels.ts        DOM 标签层（星名/天体名/方位）
    renderer.ts      WebGL 上下文、渲染循环、指针输入
  core/    engine.ts 应用状态 + 主循环
  ui/      panel.ts 控制面板 / infoCard.ts 信息卡 / urlState.ts URL 分享
scripts/
  download-stars.ts  原始数据下载（可重复执行）
  build-stars.ts     预处理脚本（解析 Tycho-2 → 分档二进制 + 星名 + 星座线）
tests/    astro 层 Vitest 单元测试
data/raw/    原始数据（git-ignored）
public/data/ 生成产物（git-ignored）
```

### 星点数据管线

- 原始数据：Tycho-2 主星表（2,539,913 行，CDS VizieR I/259 的 20 个 gz 分卷）。
- 解析为定长字段；用官方公式（ESA SP-1200 §1.3）把 Tycho 的 VT/BT 转换为 Johnson V 与 B−V；太阳等异常亮目标（V<−2）过滤（防御性，Tycho-2 实际不含）。
- 输出二进制（小端 Float32Array，每星 7 个 float：`x,y,z,mag,bv,pmRA,pmDec`，28 字节）+ 平行 Uint32Array（打包 TYC 编码）：
  - `bright-0/1/2.bin` — V<6.5 / 6.5–8.5 / 8.5–10.0 全天档
  - `slice-3/<pixel>.bin` — V 10–11，HEALPix nside=8 RING 切片（FOV<30° 加载）
  - `slice-4/<pixel>.bin` — V≥11（FOV<8° 加载）
- `names.json`（约 284 KB）：IAU 官方星名 + HYG Bayer/Flamsteed（V<5.5）+ 3000+ 中国星名，含 J2000 xyz 与星等。
- `constellations.json`：西方 88 + 306 个星官连线（J2000 xyz 直接嵌入）。
- `index.json`：档位清单、星数、字节大小、星等直方图（脚本运行时打印统计）。
- 星点方向以**单位球 J2000 xyz** 存储（避免大坐标的 float32 精度问题），岁差/章动/自行/光行差/地平旋转全部在顶点着色器用矩阵完成。

## 数据来源与许可证

| 数据 | 来源 | 许可证 |
| --- | --- | --- |
| 恒星星表（2,448,950 星） | Tycho-2，Hog et al. 2000, A&A 355, L27；CDS VizieR [I/259](https://cdsarc.cds.unistra.fr/viz-bin/cat/I/259) | ESA Hipparcos/Tycho 任务数据，科学与教育用途可自由使用，请引用上述论文 |
| 星名（英文/IAU） | [IAU Catalog of Star Names](https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt)（WGSN） | IAU，注明出处即可自由使用 |
| Bayer/Flamsteed 星名 | [HYG database v41](https://github.com/astronexus/HYG-Database) | CC BY-SA 4.0 |
| 中国星名（3240 星）与星官连线（三垣二十八宿） | [Stellarium](https://stellarium.org) `skycultures/chinese`（v26.3，依《仪象考成》/《仪象考成续编》） | CC BY-SA 4.0 |
| 西方星座连线（88） | Stellarium `skycultures/modern`（v26.3） | CC BY-SA 4.0 |
| 银河全景图 | "ESO - Milky Way"，ESO/S. Brunier（GigaGalaxy Zoom），via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:ESO_-_Milky_Way.jpg) | CC BY 4.0 |
| 天文计算 | [astronomy-engine](https://github.com/cosinekitty/astronomy) | MIT |
| 渲染 | [three.js](https://threejs.org) | MIT |
| 本项目代码 | — | MIT（见 LICENSE） |

页脚同样注明以上来源。原始数据不进入 git（`.gitignore` 中 `data/raw/`），生成的 `public/data/` 亦不进入 git，均通过上述脚本重建。`public/assets/milkyway.jpg`（银河全景，2.3 MB）随仓库分发以支持离线运行，遵循 CC BY 4.0。

## 精度与测试

`pnpm test` 覆盖 astro 层（Vitest，纯计算不依赖渲染）：

- **矩阵管线 vs astronomy-engine 参考实现**：无光行差路径一致到 0.001″ 以内。
- **天狼星快照**（Stellarium 对照锚点）：2025-06-01T14:00Z，上海（31.23N, 121.47E），含自行 + 光行差的完整管线给出 alt = −34.1597°, az = 90.2349°。与 Stellarium 同设置（同一地点/时刻、关闭大气折射）比对，误差应在 0.1° 以内（我们的值比"纯 J2000 直接旋转"参考多出自行 ~45″ 与光行差 ~20″，均属预期内的视位置修正）。
- **几何不变量**：天顶方向、恒星上中天高度 = 90°−|φ−δ|、北极星高度 ≈ 纬度。
- **HEALPix**：与 astropy-healpix 1.0.3 的参照样本逐点一致；768 天区全覆盖、中心自映射。
- **光行差量级**：周年 ~20.4″，|β| ≈ 10⁻⁴。

自行积分历元说明：Tycho-2 公布的平均位置已由星表自行归算到 J2000.0（VizieR I/259 ReadMe 注 3），因此自行从 2000.0 起推，而非观测平均历元 1991.25。

## 已知限制 / 下一阶段建议

见项目交付说明（任务完成后列出）。
