# 星图 xingtu — 网页版星空 / 天象仪

浏览器端的交互式星空展示（类似 Stellarium Web）：拖拽转视角、滚轮缩放（0.1°–120° 视场），
基于 Tycho-2 星表（约 235 万颗星）与真实天文计算。

![功能](https://img.shields.io/badge/功能-星图%20%C2%B7%20月相%20%C2%B7%20中国星官-blue)

## 特性

- **星点渲染**：自定义 ShaderMaterial + 立体投影（Stellarium 默认投影，宽视场不变形）。
  自行 → 岁差章动 → 周年光行差 → 地平旋转全链路在 GPU 顶点着色器完成（亚角秒级），
  CPU 每帧只更新少量 uniform。
- **235 万颗星**：按星等分 5 档，亮档全天整体加载，暗档按 HEALPix（NESTED，nside=8）
  天区切片、视野内按需加载（LRU 缓存）。
- **颜色**按色指数 B−V 映射色温；亮度按视星等（含大气消光）。
- **太阳系**：太阳（光晕）、月亮（含月相明暗界线）、八大行星（真实角径）。
- **大气**：Kasten-Young 气团消光、月光天光、晨昏蒙影，由「大气浓度」滑块统一控制。
- **星座连线**：西方 88 星座 + 中国传统星官（三垣二十八宿），可分别开关。
- **星名标签**：亮星中文名（默认 mag<2，放大显示更多）+ 太阳系天体 + 方位标记。
- **点选信息卡**：星等、色指数、赤经赤纬、地平坐标、Tycho-2 编号。
- **URL 分享**：视角 / 视场 / 时间 / 地点全部编码进 hash，可收藏与分享。
- **观测设置**：南北半球预设地点（上海默认）、时间加速（实时–1 天/秒）与暂停。

## 快速开始

```bash
pnpm install          # 安装依赖
pnpm stars:download   # 下载原始数据（Tycho-2 等，约 170 MB → data/raw/，不入库）
pnpm stars:build      # 预处理：生成星表二进制切片 + 星名 + 星座连线 → public/data/stars/
pnpm dev              # 启动开发服务器 → http://localhost:5173
```

首次使用必须依次执行 `stars:download` 和 `stars:build`，否则页面无星（控制台有提示）。

## 在线版（GitHub Pages）

推送 main 分支会自动触发 [GitHub Actions](.github/workflows/deploy.yml)：CI 上下载星表、
预处理切片、构建并发布到 GitHub Pages，数据不进入任何 git 分支。

- 线上地址：<https://strengthening.github.io/xingtu-glm/>
- 首次部署前需要在仓库 **Settings → Pages → Build and deployment** 把 Source 设为
  **GitHub Actions**（一次即可），然后到 Actions 页手动 re-run 或再推一次。
- 也可以在 Actions 页用 "Run workflow" 手动部署；星表原始文件按缓存键
  `stars-raw-v1` 缓存，改预处理逻辑时更新该键强制重下。

其他命令：`pnpm test`（Vitest 单元测试）、`pnpm lint`、`pnpm build`（生产构建）、
`pnpm preview`（预览构建产物）。

## 数据预处理说明

`scripts/build-stars.ts`：

- 解析 Tycho-2 主表（20 卷固定列宽）与补编 1/2；补编位置历元 1991.25 按自行归算到 J2000；
- V = VT − 0.090·(BT−VT)，B−V = 0.850·(BT−VT)（ESA SP-1200 官方近似）；
- 过滤 V > 12.5；防御性跳过异常亮行（星表本身不含太阳）；
- 输出二进制（每星 7 × float32：xyz / V / BV / pmRA / pmDE，附 TYC 压缩 uint32 编号），
  文件大小与星数统计写入 `public/data/stars/meta.json`；
- 交叉 HIP 编号，把 Stellarium 星名与星座连线转成运行时 JSON。

## 架构

```
src/
  astro/    纯计算（不依赖 Three.js，可单测）：坐标链、光行差、HEALPix、
            太阳系位置、大气模型、预设地点、B−V 颜色
  data 层   并入 render/starfield.ts（加载与解析）
  render/   Three.js 渲染：着色器、投影、星点分档、线条、太阳系、标签
  ui/       控制面板、信息卡、URL 状态
  core/     引擎：状态、帧循环、交互与拾取
scripts/    数据下载与预处理（Node + tsx）
tests/      Vitest：坐标链交叉验证 + 天狼星中天锚定 + HEALPix 性质
```

坐标精度策略：星点坐标存 J2000 单位球 xyz（float32 精度问题由统一单位球规避），
框架旋转（岁差、章动、恒星时、地理纬度）全部合成为每帧一次的 mat3，在 shader 内完成，
绝不在 CPU 上逐星重算。

## 单元测试

`pnpm test`：

- 天狼星地平坐标链与 astronomy-engine 交叉验证（EQJ→EQD、EQD→地平，误差 < 0.001°）；
- 天狼星上海上中天锚定：高度 ≈ 42.0°（= 90° − |φ−δ|）、方位 180°，与 Stellarium
  同一天文事实一致（< 0.1°）；
- HEALPix NESTED 与参考实现逐点一致 + 等积均匀性；
- 光行差量级（≈ 20.5″）与单位往返。

## 数据来源与许可证

| 数据 | 来源 | 许可证 |
| --- | --- | --- |
| 代码 | 本项目 | MIT（见 [LICENSE](LICENSE)） |
| Tycho-2 星表（含补编） | ESA/ESO，经 CDS（I/259，Høg et al. 2000） | 公有领域数据，注明出处即可使用 |
| 西方星座连线与星名 | Stellarium `skycultures/modern` + `common_star_names.fab` | Stellarium 数据文件（GPL-2.1+ / CC BY-SA 4.0） |
| 中国星官（三垣二十八宿）与中文星名 | Stellarium `skycultures/chinese` | 同上（CC BY-SA 4.0） |
| 银河全景贴图 | Stellarium `textures/milkyway.png` | Stellarium 项目运行资源（GPL-2.1+ 随程序分发） |
| 天文计算 | astronomy-engine（Don Cross） | MIT |
| 渲染 | Three.js | MIT |

原始数据不进入 git（`data/raw/` 已忽略）；生成的切片不入库（`public/data/` 已忽略）。
银河贴图作为运行资源随仓库分发（`public/assets/`），页脚已注明来源与许可证。

## 下一阶段建议

1. **HiPS 巡天图层**：把银河全景升级为真正的 HiPS 渐进瓦片（对接 CDS Alasky 的
   DSS2 / Mellinger 巡天），保留本地全景作离线回退 —— 渲染层已按可替换数据源组织。
2. **深空天体（DSO）**：Messier / NGC 目录（位置、大小、类型），信息卡联动。
3. **更暗星表**：UCAC4 / Gaia DR3 子集替换 t4 档，视场 < 1° 时下探到 15 等。
4. **行星表面细节**：木星条纹、土星环、金星相位（当前行星为纯色圆盘）。
5. **流星雨与日月食**：已知流星群辐射点的活动模拟；日月食的判定与特殊渲染。
6. **触摸手势与移动端布局**：双指缩放、面板抽屉化。
7. **观察列表与搜索**：按星名 / 星座跳转视角。
