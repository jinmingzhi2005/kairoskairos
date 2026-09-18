# GitHub 发布素材

直接复制粘贴用。仓库设置入口：仓库首页右侧 **About** 齿轮图标。

---

## 一、仓库描述（About → Description）

英文（推荐，国际可见）：

```
A minimal desktop calendar and reminder widget for Windows. Two independent reminder channels per to-do, Chinese public holidays with make-up workdays, lunar calendar & solar terms, and ICS/Outlook sync. All data stays local.
```

中文：

```
常驻桌面的极简日历与待办提醒。每条待办两个独立提醒开关，支持中国法定节假日与调休、农历节气、以及 ICS / Outlook 日历同步。数据全在本地。
```

> GitHub 的 Description 上限 350 字符，上面两段都在 200 以内。**建议填英文**，中文放在 README 里就够了 —— 搜索和推荐是按 Description 和 Topics 走的。

## 二、Topics 标签（About → Topics）

复制下面这一串，逐个粘贴（GitHub 会按逗号或回车分隔）：

```
electron
electron-app
calendar
reminder
todo
desktop-app
desktop-widget
windows
react
typescript
ics
icalendar
outlook
holiday
lunar-calendar
solar-terms
productivity
```

全部是 GitHub 上真实存在、有人检索的标签。前 5 个最关键，GitHub 在仓库卡片上会优先展示靠前的几个。

## 三、仓库其他设置

| 位置 | 建议填写 |
| --- | --- |
| Website | 留空，或填你的博客（没有就别填） |
| Social preview | 上传 `docs/screenshots/calendar.png`（仓库设置 → Social preview，分享到社交平台时的预览图） |
| Releases | 见下方第四节 |
| License | 已放 `LICENSE`，GitHub 会自动识别为 MIT |

---

## 四、Release Notes（v1.2.0）

创建 Release 时填。Tag 填 `v1.2.0`，标题填 `Kairos v1.2.0`。

### 中文版

````markdown
## Kairos v1.2.0

### 新增：农历与 24 节气

日历格子下方现在会显示农历日期（初一、廿七），传统节日与节气会自动替换显示，并按类型配色：

- 法定假期与农历传统节日 → 红
- 24 节气 → 绿
- 一般公历节日 → 紫
- 平常农历日 → 灰

农历**不自己算**，直接用运行时内置的 ICU 中文历法（零依赖、零数据表，不用维护 1900–2100 的农历表）。节气必须自算，用太阳视黄经到达 15° 整数倍判定，与公开天文年历逐条核对过。

设置里可关闭。

### 新增：深色模式跟随系统

跟随系统切换，也可在设置里强制浅色 / 深色。主进程设 `nativeTheme.themeSource`，渲染层只用一条 `prefers-color-scheme` 媒体查询 —— 不需要额外的 IPC 往返。主题在窗口创建**之前**就定好，避免启动瞬间闪一下浅色。

### 修复

- 日期格被内容撑高，把待办区挤没了（`aspect-ratio` 管不住 flex 的 `min-height: auto`）

### 工程

- `test:unit` 从 30 项扩到 40 项：新增农历日期、闰月、除夕判定、节气日期抽样、全年节气数量校验
- 冒烟测试支持在深色下截图，便于人工核对深浅两套配色
- 开发目录更名为 Kairos，与产品名统一

### 安装

下载下面的 `Kairos-1.2.0-setup.exe`，双击安装。

安装包未做代码签名，SmartScreen 会提示「未知发布者」，点「更多信息 → 仍要运行」即可。

**从 1.0 / 1.1 升级**：直接覆盖安装，待办、布局和设置都会保留（数据存在 `%APPDATA%\Kairos\`，卸载也不会删）。早期名为 DeskBox 的版本，用户数据会自动迁移过来。
````

### 英文版

````markdown
## Kairos v1.2.0

### New: Lunar calendar & 24 solar terms

Each date cell now shows the lunar date (初一, 廿七, …), with traditional festivals and solar terms substituted automatically and color-coded:

- Public holidays and lunar festivals → red
- 24 solar terms → green
- Regular Gregorian festivals → purple
- Ordinary lunar dates → grey

The lunar calendar is **not** hand-computed — it comes from the runtime's built-in ICU Chinese calendar (zero dependencies, zero data tables, no 1900–2100 table to maintain). Solar terms, which ICU doesn't provide, *are* computed: the moment the sun's apparent ecliptic longitude crosses a multiple of 15°, cross-checked against published astronomical almanacs.

Can be turned off in settings.

### New: Dark mode follows the system

Follows your system theme, or force light/dark in settings. The main process sets `nativeTheme.themeSource` and the renderer needs nothing more than a single `prefers-color-scheme` media query — no extra IPC round-trips. The theme is applied *before* the window is created, so there's no light-theme flash on startup.

### Fixed

- Date cells grew taller than intended and squeezed the to-do list out of view (`aspect-ratio` does not constrain a flex item's `min-height: auto`)

### Engineering

- `test:unit` expanded from 30 to 40 assertions: lunar dates, leap months, New Year's Eve detection, solar term date sampling, and full-year solar term counts
- The smoke test can now capture screenshots in dark mode, making it easy to review both color schemes
- Development directory renamed to Kairos to match the product name

### Install

Download `Kairos-1.2.0-setup.exe` below and run it.

The installer is not code-signed, so SmartScreen will warn about an unknown publisher — click *More info → Run anyway*.

**Upgrading from 1.0 / 1.1**: just install over it. To-dos, layout and settings are preserved (they live in `%APPDATA%\Kairos\`, which uninstall does not touch). Data from earlier builds named DeskBox is migrated automatically.
````

---

## 五、发布检查清单

推仓库之前过一遍：

- [ ] `README.md` 和 `README.en.md` 都在仓库根目录，两边的语言切换链接能互相跳转
- [ ] `docs/screenshots/` 里的图片已提交（README 引用了它们，缺图会显示破图）
- [ ] README 里的 `git clone <this-repo>` 换成真实仓库地址
- [ ] About 的 Description 和 Topics 已填（见第一、二节）
- [ ] Social preview 已上传（见第三节）
- [ ] 确认 `node_modules/`、`out/`、`release/` 没有被提交
- [ ] 打了 tag 并创建 Release，附上 `Kairos-1.2.0-setup.exe`

推送：

```bash
cd Kairos
git remote add origin https://github.com/<你的用户名>/kairos.git
git push -u origin main
git tag v1.2.0
git push origin v1.2.0
```
