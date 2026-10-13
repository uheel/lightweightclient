# rd.igoodlife.com 站点分析

> 分析日期：2026-10-12，平台版本 V3.7.1，账号 goodlife（平台超管，SDB_SA=true）

## 技术栈

- React + Umi（`window.g_umi`）+ Ant Design Pro 布局（`layout: mix`、`splitMenus`）+ antd + MobX
- 单页应用，路由形如 `/care/device/radar`
- 有 SignalR 实时通道（见 系统管理 › 诊断工具）

## 前端架构

- 打包方式：Umi（webpack chunk 名为 `webpackChunksmart_medical`），页面按需加载，chunk 文件名形如 `p__Basic__BuildingPage.<hash>.async.js`、`modules__gait__GaitTrajectoryPage.<hash>.async.js`
- 主要依赖包：`vendors.react`、`vendors.antd`（**antd v5**，开启了 CSS 变量模式）、`vendors.antd-pro`（ProLayout / ProTable / ProCard）、`vendors.mobx`、`vendors.intl`、**`vendors.sdb`**（公司自研组件库，约 1.4MB）
- 状态管理用 MobX：页面状态放在 store 类里（比如轨迹回放 store 有 `points / isPlaying / playIndex / sliderRange` 等字段）
- 国际化：界面文字写成 `L("中文原文")`，以中文作为 key；当前语言存在 `localStorage.umi_locale`，请求头 `locale` 跟着变。**脚本按文字找按钮时要同时匹配中英文**（例如 `/Query|查 ?询/`）
- 路由：浏览器 history 模式，切换页面不刷新，所以脚本要监听路由变化（patch `history.pushState` 或者轮询 `location.pathname`）
- 接口有两个前缀：业务接口 `/api/*`，系统级接口 `/sapi/*`（文件、OSS、代码表、行政区划、任务调度、国际化、语音等）

### 通用 CRUD 页面（`vendors.sdb` 里的 SDBPage）

大部分管理页面是用同一个组件按配置生成的：`<SDBPage api="/api/building" columns=... dialog=... persistenceKey="SDBBuilding">`。传入的 `api` 可以是一个字符串，也可以是 `{pages, get, create, update, delete, default}` 这样的对象。

| 操作 | 请求 |
|---|---|
| 列表 | `GET {api}/pages?current=1&pageSize=10&filter[字段]=值&sort...` |
| 详情 | `GET {api}?id=xxx` |
| 新增 | `POST {api}`，JSON 请求体 |
| 修改 | `PUT {api}`，JSON 请求体（包含 `id`） |
| 删除 / 批量删除 | `DELETE {api}?id=a,b,c`（多个 id 用逗号分隔） |

- 筛选参数统一写成 `filter[key]=value`；数组用逗号连接；日期格式是 `YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss`
- 列表每页条数存在 `localStorage['FS_GRID_PAGE_SIZE:*']`，各页面的查询条件存在 `localStorage[persistenceKey]`
- **自带的导出组件**：`GET <exportApi>?filter[...]&filter[maxCount]=N&filter[selectedKeys]=id1,id2`，以 blob 方式下载
- **自带的导入组件**：上传 `.xls/.xlsx`（multipart，字段名 `file`），手动带上 `Authorization` 和 `OrgId` 请求头；返回 `data`（成功条数）或逐行错误 `[{rowIndex, errorMessages[]}]`
- **自带的批量 CSV**（目前只有楼栋页用）：用 textarea 粘贴 `名称,编号,描述` 这样的文本，POST 到 `/api/building/batch-csv`
- 系统中已有导入/导出的地方很少：主要是 `/sapi/*`（代码表、行政区划、任务调度、语音、国际化）、设备类型属性 `/api/device-type-property/import|export`，以及告警、各类设备数据的 `export-csv`。**大部分业务页面（设备、房间、床位、用户等）都没有批量导入/导出**

## 样式 / 视觉规范

- 组件库：antd v5 默认主题，主色 **`#1677ff`**，圆角 **6px**，控件高度 32px，字号 14px，表头背景 `#fafafa`、字重 600、内边距 8px
- 语义色：成功 `#52c41a`、警告 `#faad14`、错误 `#ff4d4f`，CSS 变量写成 `--ant-color-*`（挂在 `.css-var-root` 上）
- **左侧菜单是深色定制风格**：背景 `#111441`，子菜单背景 `#282c52`，选中项背景 **`#556FF7`**、白字、圆角 6px，宽度 228px
- 顶栏：白色，高 56px（`.sdb-nav`），右侧依次是消息、搜索、语言、告警、机构切换（Platform）、用户头像
- 内容区：背景是从 `#fff` 到 `#f5f5f5` 的渐变；页面结构为 `PageContainer → .sdb-page（height: calc(100vh - 130px)，内部滚动）→ ProTable（查询表单卡片 + 表格卡片）`
- 弹窗：`.ant-modal.sdb-dialog.sdb-dialog--draggable`（可拖动），标题前带图标（新增用 `+`），表单是纵向布局的 antd Grid（md 列宽 10/8/6），底部按钮为"取消 / 确定"（`.sdb-dialog__footer`，间距 8px）
- 表格工具栏右侧：次要按钮 + 主按钮（"+ 新增"），再加刷新、密度、列设置三个图标
- 自定义 class 前缀：`sdb-*`（组件）、`g-*`（全局，比如右下角的版本号 `.g-version`）
- 注意：`html { font-size: 0.8px }`，页面用 rem 做缩放。**脚本插入的 UI 不能用 rem**，统一用 px
- 深色大屏风格的页面（步态轨迹回放、驾驶舱）是另一套视觉：深蓝背景，玻璃质感卡片

**油猴脚本 UI 的约定**：直接用上面这些 token，做出跟 antd 一样的按钮、弹窗、表格，插到 ProTable 工具栏里（`.ant-pro-table-list-toolbar-right`），让脚本加的功能看起来像平台自带的。

## 组织机构模型（多租户）

### 机构树
- `GET /sapi/org/tree` 返回整棵机构树，节点字段为 `{key, value, title, orgType, sortOrder, parentKey, children}`。2026-10-12 时共 **292 个机构，最深 6 层**
- 层级示例：`平台 / 康养平台 / 江西省 / 庐山民政局 / 庐山市福利中心`、`平台 / 福建省 / 厦门市 / 厦门市民政局`
- 单个机构详情：`GET /sapi/org?id=xxx`，返回 `organizationName, organizationType, parentId, effectiveTimeZoneId, latitude/longitude, resourceGroupId, isDisabled…`
- 其他机构相关接口：`/sapi/org/parent-tree`、`/sapi/org/permission-tree`、`/sapi/permission/granted-org-permissions`、`/api/building/sub-org-options`（各下级机构及其楼栋）

### orgType
- 现有 254 个 `1`、38 个 `2`
- 从前端代码看，当 `currentOrgType === 2` 时，会隐藏"所属组织"列和左侧机构树。推测 **2 = 末端机构（单一租户）**，**1 = 管理/分组节点**（平台、省、市、集团等）
- 但 type 1 的节点同样可以直接挂数据，比如庐山市福利中心是 type 1，下面有 349 台设备

### 切换机构的机制
顶栏 "Platform" 下拉框是一个机构树选择器。选中某个机构后：
1. `sessionStorage.SDB_ORG_ID / SDB_ORG_TYPE` 改成新机构
2. `localStorage['SDB_LAST_ORG_ID:<用户名>']` 和 `SDB_LAST_ORG_TYPE` 记下这次的选择，下次登录时恢复
3. `location.reload()` 整页刷新

**token 不变**，`SDB_RAW_ORG_ID` 保存的是登录时所在的机构。另外 `localStorage['SDB_LAST_PAGE:<用户名>']` 记录最后访问的页面。

### 数据隔离（实测）
后端只根据请求头 `orgid / orgtype` 判断数据属于哪个机构：

| 机构 | 设备 | 楼栋 | 告警 | 长者 |
|---|---|---|---|---|
| 平台（根） | 3576（**全局**） | 1 | 0 | 3526（**全局**） |
| 康养平台（有 26 个下级） | 0 | 0 | 0 | 0 |
| 庐山市福利中心 | 349 | 5 | 831 | 367 |
| 厦门市民政局 | 1312 | 7 | 821 | 549 |

- **上级机构不会汇总下级机构的数据**，各机构之间完全隔离。只有"平台"根机构在设备、长者这类资源上能看到全局数据，楼栋、告警等业务数据仍然只显示平台自己的
- 所以要看某个机构的告警、楼栋、房间、床位，就必须用那个机构的身份去请求

### 对油猴脚本的影响
- **不用切换机构也能跨机构查询**：超管 token 加上目标机构的 `orgid / orgtype` 请求头，就能直接读那个机构的数据（已验证）。脚本可以遍历机构树，汇总各机构的告警、楼栋等数据，页面本身不用刷新
- **写操作（批量新增、导入）一定要明确目标机构**：新增的数据会落到请求头 `orgid` 所指的机构里。脚本里要明确展示并确认目标机构，默认用当前机构 `sessionStorage.SDB_ORG_ID`，避免写错地方
- 平台根机构下，设备列表返回的是全局数据，每条带 `orgId / orgName` 字段，可以直接按机构分组统计

## 认证与请求头

所有 `/api/*` 请求都通过 **fetch** 发出，必须带以下请求头（不用 Cookie 认证）：

| Header | 来源 |
|---|---|
| `authorization` | `'Bearer ' + sessionStorage.SDB_TOKEN`（JWT） |
| `orgid` | `sessionStorage.SDB_ORG_ID` |
| `orgtype` | `sessionStorage.SDB_ORG_TYPE`（平台 = `1`） |
| `locale` | `zh-CN` / `en-US` |

- token 存在 **sessionStorage**，按标签页隔离：新开标签页需要重新登录，油猴脚本只能在已登录的标签页里调用接口。
- sessionStorage 里还有：`SDB_USERID`、`SDB_USER_NAME`、`SDB_NICK_NAME`、`SDB_REAL_NAME`、`SDB_ORG_NAME`、`SDB_RAW_ORG_ID`、`SDB_MENUS`、`SDB_MENU_CONFIG`、`SDB_SA`、`SDB_AD`。
- 响应格式：`{ succeeded: true, data: ..., total?: number }`
- 分页参数：`?pageSize=10&current=1`，筛选条件写成 `filter[xxx]=...`。`pageSize=5000` 也能用（全部 3576 台设备约 0.5 秒返回）。

## 菜单 / 路由（顶部菜单 → 侧边栏）

- **康养平台 `/care`**
  - 设备管理 `/care/device`：雷达设备 `radar`、管理主机 `master`、智能手表 `watch`、戒指 `ring`、护工手表 `monitor-watch`、智能设备 `slave`、设备类型 `device-type`、**设备升级 `upgrade`**、SIP 账号 `sip`、场景模板 `scene-template`、雷达音频 `audio`、语音识别授权 `speech-recognition-auth`、**设备管理（全类型）`manage`**
  - 告警管理 `/care/alert`：告警列表 `list`、事件类型 `type`、处理类型 `process-type`
  - 日志管理 `/care/log`：**设备通信日志 `device`**、厦心接口 `xmheart`、国贸推送 `guomao-push`、TTS 呼叫 `shenou-tts`、戒指睡眠 `ring-sleep-upload`、设备交换 `device-bed-swap`
  - 另有：首页、数字驾驶舱、实时监测、市局指挥中心、基础管理（楼栋/楼层/房间/床位/用户…）、健康数据、安全防护、收费管理、记录查询
- **护工派单 `/caregiver`**、**运营管理 `/app`**（App 内容配置）、**步态分析 `/gait`**、**AI 管理 `/ai`**
- **系统管理 `/system`**：用户、角色、组织 `org`、菜单、任务调度 `scheduler`、**诊断工具 `diagnostics`**（设备命令链路诊断，仅 SA）、灰度发布 `release-gray`、系统设置等

## 运维相关接口

### 设备

| 接口 | 说明 |
|---|---|
| `GET /api/device/org-statistics` | `{deviceCount, onlineCount, offlineCount, alertCount}`（雷达） |
| `GET /api/device/v3/radar-pages` | 雷达列表。字段：`id, sn, orgId, orgName, roomId, roomName, deviceName, deviceType, communicationType, isOnline, isDisabled, firmwareVersion, rssi, lastActivityTime, memberCount, realName, memberId, createdAt/By, updatedAt/By` |
| `GET /api/device/v4/management-pages` | 全类型设备列表（精简字段：`id, deviceName, sn, deviceType, orgId, orgName, communicationType, isDisabled, isOnline, peripheralCount, firmwareVersion, sortOrder`） |
| `GET /api/device/v4/management-statistics` | `{onlineCount, offlineCount, totalCount}` |
| `GET /api/device/v4/management-catalog` | 设备分组：Radar / Gait / Ring / Watch / Other / Accessories |
| `GET /api/device/v4/unknown-devices`（`/count`） | 未入库设备：`sn, deviceType, deviceTypeName, protocol, topic, payloadPreview` |
| `GET /api/device-type/types` | 设备类型字典：`deviceType` 编号 → 名称、`groupCode` |
| `GET /api/device-upgrade/pages` | 升级包：`deviceType, version, fileName, fileMd5, fileSize, upgradeName, upgradeType, createdAt/By` |
| `POST /api/device/sync-online-status` | 同步在线状态 |
| `/api/device-config/*` | 读写设备配置：`basic`、`network`、`audio`、`call`、`switch`、`working-time`、`scene`、`restart`、`status` 等（带 `/read` 的是读取） |
| `/api/device-property/read`、`write`、`raw-values` | 读写设备属性 |
| `/api/device/v4/organization-transfer` | 设备转移到其他机构 |

### 告警 / 日志

| 接口 | 说明 |
|---|---|
| `GET /api/alert/pages?filter[alertTypeGroup]=N` | 告警列表（页签对应：场景 / 事件 / 紧急求助 / 离线 / 视频人员 / 视频事件 / 安装姿态） |
| `GET /api/alert/un-process-count` | 未处理告警数（顶栏角标） |
| `POST /api/alert/batch-process`、`/api/alert/process` | 处理告警 |
| `GET /api/device-log/pages?filter[all]=true` | 设备通信日志（MQTT）。Topic 形如 `sdb/radar/<SN>/ak`，消息体 `{cmd, DID, seq, params, protocol_ver}`，默认只显示当天 |

### 房间详情 / 平面图 / 雷达坐标（`/care/monitoring/room-view?roomId=xxx`）

**页面结构**
- URL 带上 `?roomId=` 就能直接打开某个房间。但从某些入口进入时，URL 里不带 `roomId`，所以脚本获取当前房间时要优先读 React fiber：从房间卡片标题旁的图标往上找 `memoizedProps.roomId`，实测可靠。页面代码在 chunk `p__RoomView__RoomViewPage`，按需加载的依赖有 `vendors.graphics`（Konva）、`vendors.charts`、`heatmap.min.js`、`d3.min.js`
- 平面图用 **Konva** 画（`window.Konva` 全局可用），画布在 `.konvajs-content` 里。下方工具栏有：显示区域、放大、缩小、自适应、全屏、100%
- 房间卡片标题右侧有 3 个图标按钮（`.sdb-button.sdb-button__icon`）：**轨迹回放**、**热力图**、**事件记录**；右侧面板顶部还有：告警记录、通话记录、历史数据

**房间详情接口：`GET /api/room-view/v3/detail?roomId=`**
- 房间基本信息：`roomId, roomName, roomTypeId, floorId/floorName, buildingId/buildingName`
- `background`：房间外框，`{width, height, fill, stroke…}`，单位 **1px = 1cm**（例如 400×400 就是 4m×4m）
- `background` 本身也可以是图片：`type 4` 且带 `src` 时，就是**户型底图**（例如 SWASTIK ENTERPRISES 机构的"home"房间，1290×950），要按房间宽高拉伸绘制
- `elements[]`：平面图上的元素，`{type, x, y, width, height, src, rotation, scaleX/scaleY…}`。type 枚举（common 模块里的 `Ak`）：
  - 1 = Group（组合，子元素在 `children` 里）
  - 2 = Rect（`fill`、`stroke`、`strokeWidth`、`cornerRadius`）
  - 3 = Device（雷达，带 `sn, deviceId, deviceType, qingLanConfig`）。**带 qingLanConfig 时，图标中心位于 `(radar.x + container.x, radar.y + container.y)`，图标以中心对齐（Konva offset = 宽高的一半），不使用元素自身的 x/y**
  - 4 = Image（家具、床等，`src`）
  - 5 = Text（`text`、`fontSize`，颜色在 `fill` 里）
  - 6 = Line（顶点坐标在 `points` 里）
  - 7 = BedSlot（床位）
- `devices[]`：房间里的设备，`{sn, deviceId, deviceType, isOnline, lastActivityTime, qlWorkingType, members[], rangeId}`
- 其他相关接口：`/api/room-view/room-info?deviceId=`、`/api/device/options?roomId=`

**雷达安装配置 `qingLanConfig`**
- `container {x, y, width, height}`：雷达探测区域在房间坐标系里的位置和大小（例如 600×400，偏移 22,-98）
- `radar {x, y}`：雷达在 container 里的位置
- `installType`：0 = 顶装（Top），1 = 侧装（Side）
- `installDirection`：1 = 上，2 = 右，3 = 下，4 = 左
- `installHeight`、`workingType`：3 = 人员追踪，7 = 跌倒，11 = 睡眠，15 = 重症监护
- `ranges[]`：雷达坐标系里划的区域，`{type, text, x, y, width, height, fill}`。type：4 = 门，5 = 监护床，6 = 自定义，7 = 家具…
- `supervision`

**坐标换算（来自 RoomViewPage 模块 1922）**
1. 雷达中心：`center = (radar.x + container.x, radar.y + container.y)`，单位 cm，代码里先除以 100 换成 m
2. 实时目标点 `(x, y)`（单位 m）按下面的函数换到房间坐标，最后乘 100 换回 px：

```js
function toRoom(cx, cy, x, y, installType, dir, rotationDeg) {
  let X = cx, Y = cy;
  if (installType === 0 /*Top*/) {
    if (dir === 1) { X = cx + x; Y = cy - y; }
    else if (dir === 3) { X = cx - x; Y = cy + y; }
    else if (dir === 2) { X = cx + y; Y = cy + x; }
    else if (dir === 4) { X = cx - y; Y = cy - x; }
  } else /*Side*/ {
    if (dir === 1) { X = cx - x; Y = cy + y; }
    else if (dir === 3) { X = cx + x; Y = cy - y; }
    else if (dir === 2) { X = cx - y; Y = cy - x; }
    else if (dir === 4) { X = cx + y; Y = cy + x; }
  }
  if (rotationDeg) {
    const r = rotationDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), vx = X - cx, vy = Y - cy;
    X = cx + vx * c - vy * s; Y = cy + vx * s + vy * c;
  }
  return { x: X, y: Y };
}
```

3. 实时推送的每个目标包含 `{x, y, userIndex, areaName, posture}`，这些字段在 RoomView store 的 `userPositions` 里
4. **历史轨迹点 `trajectory-points` 的 x/y 看起来是 container 内的坐标（cm）**，加上 `container.x / y` 偏移就是房间坐标。（推测，实现时要对照现有的轨迹回放结果验证）

### 姿态 / 事件枚举

| posture | 含义 | | eventType | 含义 |
|---|---|---|---|---|
| 1 | 行走 | | 1 | 进入房间 |
| 2 | 疑似跌倒 | | 2 | 离开房间 |
| 3 | 坐 | | 3 | 进入区域 |
| 4 | 静止 | | 4 | 离开区域 |
| 5 | 跌倒确认 | | 5 | 进入监护区 |
| 6 | 在床 | | 6 | 退出监护区 |
| 7 | 疑似坐地 | | | |
| 8 | 确认坐地告警 | | | |
| 9 | 床上坐起 | | | |
| 10 | 疑似床上坐起告警 | | | |
| 11 | 确认床上坐起告警 | | | |

（另外有一组实时姿态枚举里 0 也表示静止）

### 平台现有的"轨迹回放"弹窗（房间详情 › 轨迹回放图标）
- 能做的：选**一天**的日期，在 24 小时时间轴上用滑块选时间段（时间轴会显示哪些时段有数据），按设备 / 人员筛选，播放速度 1x / 2x / 5x / 10x，可以缩放和拖动画布
- 接口：`GET /api/human-exists/trajectory-points?roomId&startAt&endAt[&deviceSns][&userId]`
- **缺的**：轨迹点只有 `{x, y, timestamp, sn, userId}`，**没有姿态**，所以回放只能看到位置，看不到坐、跌倒、在床等状态；也不能跨天选时间段

### 轨迹 / 历史数据

| 接口 | 参数 | 说明 |
|---|---|---|
| `GET /api/human-exists/trajectory-points` | `roomId, startAt, endAt, deviceSns(逗号分隔), userId` | **雷达房间内的人员轨迹点** `{x, y, timestamp(ms), sn, userId}`。**可以跨天查询**（7 天约 1200 个点，耗时 170ms） |
| `GET /api/device/human-position/posture-timeline` | `sn, [userId], startAt, endAt` | **姿态时间段**：`{postures[], segments:[{posture, userId, startAt, endAt, sampleCount}]}`。**单次查询不能超过 24 小时**，跨天要按天拆开查 |
| `GET /api/device/human-position/event-timeline` | 同上 | **进出房间 / 区域事件**：`{eventTypes[], events:[{eventType, userId, occurredAt, rangeIndex, rangeName}]}`。同样不能超过 24 小时 |
| `GET /api/device/human-position/pages` | 分页 + `filter[sn]` | 原始位置记录：`{deviceTime, createdAt, numberOfPersons, x, y, z, userId, heatValue}`（例如"坐起测试"这台一天有 3369 条） |
| `GET /api/history-data/track-members` / `track-dates` / `track-points` | `memberId, date, deviceId` | 手表 GPS 轨迹（安全防护 › 历史轨迹，地图用腾讯地图） |
| `GET /api/gait-data/trajectory-segments`、`trajectory-step-frames` | | 步态传感器轨迹（步态轨迹回放页，深色主题 + canvas） |
| 设备通信日志里的 `QL_radar_track` 事件 | | 雷达上报的原始轨迹帧（`event_QL_rawdata` 是字节数组） |

### 心跳 / 安装角度

- 雷达约每分钟上报一次 `Device.heartbeat`，`params` 里有：`install: [angle_x, angle_y, angle_z]`（各加速度计轴与水平面的夹角）、`rssi`、`firmware_ver`、`sip_reg`、`IP`、`timestamp`（秒）
- 通信日志里每次心跳有**两条**记录，只有设备上报的那条带 `install`
- 查询：`GET /api/device-log/pages?filter[sn]=&filter[command]=Device.heartbeat&filter[createdAt]=开始,结束`，时间格式为 `YYYY-MM-DD HH:mm:ss`。返回 `{createdAt, sn, deviceType, rawData(JSON 字符串), command, direction, topic}`，按时间倒序
  - **用 createdAt 筛选时必须同时带 sn**，否则报"sn 不能为空"；不带 sn 时要加 `filter[all]=true`，但数据量很大，查询会很慢
  - 一台设备约 2 万条 / 7 天，查询耗时 0.25 秒
  - "坐起测试"这台查不到 9 月 20 日的数据，数据最早从哪天开始还没确认
- 设备属性（`/api/device-type-property/list?deviceTypeCode=6`，共 57 个）里**没有安装角度**，不能主动读取，只能等心跳
- 告警类型分组 `alertTypeGroup`：1 = 场景（烟感、水浸、门磁…），2 = 事件（跌倒、呼吸心率、离床…），3 = 离线，4 = 紧急求助，5 = 安装姿态（"设备安装水平告警"）

注意：平台机构下 `alert/pages` 返回为空，这是机构之间数据隔离的结果（见"组织机构模型"一节）。查告警要带具体机构的 `orgid`。

## 数据概况（2026-10-12）

- 全类型设备 3576 台，在线 533；其中雷达 2718 台，在线 407
- 设备最多的机构：厦门市民政局 1312、庐山市福利中心 349、App 182、珠海海泉湾 129、厦门大学附属心血管病医院 99
- 未入库设备 15 台；升级包 383 个

## 角色与权限（2026-10-14 实测）

### 角色
- `GET /sapi/role/pages`：角色列表，字段 `roleCode, roleName, orgId, userCount, isBuiltIn, isPublic, isEditable`
- `GET /sapi/permission/granted-roles?userId=`：某个账号的角色，返回 `{source, destination}`，`destination` 是已分配的角色
- `GET /sapi/permission/granted-role-resources?roleId=`：某个角色分配到的资源 key 列表
- **角色名没有统一规范**：292 个机构里，统一的只有系统自动建的"{机构名}管理员"（`roleCode=ADMIN`，另有平台的 `SA`）。其余角色名由各机构随意起，例如"护工""护理员""护士长""操作员""救助站一楼""演示"，而且一共只有约 40 个机构建了自定义角色

### 权限
- `GET /sapi/permission/resource-tree`：全部资源（菜单和操作），每个节点有 `resKey`（例如 `MONITORING`、`ALERT_RADAR`、`SYSTEM_USER:add`）、`title`、`type`（1 = 菜单，2 = 操作）
- `GET /sapi/permission/resources`（登录后调用）返回当前账号在当前机构的权限：**`md5("{orgId}:{userId}:{resKey}")` 列表**（已用真实数据验证）。超管（`isSa`）拥有全部权限。切换机构后要重新获取
- 护理类角色的共同点：有实时监测（`MONITORING_*`）和告警记录（`ALERT_RADAR`），没有用户、角色管理权限
- 管理者：登录返回 `isAdmin=true`（机构管理员），或有 `SYSTEM_USER` / `SYSTEM_ROLE` 权限
- **家属**：平台上找不到家属类账号，网页端也没有管理家属账号的地方（只有"运营管理"下的 App 和小程序配置）。推测家属走手机 App / 小程序的另一套账号体系（版本信息里有 `mobileApiVersion`）

## 护理值守用到的接口（2026-10-14）

| 接口 | 说明 |
|---|---|
| `GET /api/room/member-panoramic?pageSize&pageIndex` | 实时监护页的长者列表：`memberId, realName, age, gender, bedName, focusLevel, devices[{deviceId, sn, isOnline, rangeName, qlWorkingType}]` |
| `GET /api/statistics/member-and-alert` | `{memberCount, alertCount}` |
| `GET /api/alert/member-alerts` | 按长者分组的告警（返回对象，key 为 memberId） |
| `GET /api/cockpit/elder/attention?limit=` | 今日需关注：`{total, items[{memberId, realName, buildingName, floorName, roomName, bedName, attentionConclusion, attentionReasons[]}]}`，原因代码有 pendingFall / effectiveFall / nightFallRisk / lowSleepScore / shortSleep / frequentLeaveBed / highAhi |
| `GET /api/alert/pages?filter[alertTypeGroup]=&filter[alertStatus]=1` | 未处理告警（`alertStatus` 1 = 未处理，2 = 已处理），两个筛选都实测可用 |
| `GET /api/alert?id=` | 告警详情 |
| `GET /api/alert-process-type/options` | 处理类型 `[{label, value}]`，由各机构自定义（李虎：有效告警 / 家属/护士走动 / 误报 / 其他） |
| `PUT /api/alert/process` | 处理告警：`{id, alertProcessTypeId, processingResults}`；批量处理是 `PUT /api/alert/batch-process {ids, ...}` |

### 实时推送（SignalR /hub/message）
- 订阅设备：`send("AddToGroupAsync", "sn1,sn1:radar,sn2,…")`（每台设备两个频道，用逗号拼成一个参数），取消订阅用 `RemoveFromGroupAsync`
- `DeviceData` 的格式是 `{sn, msgType, payload, timestamp, dataType}`：msgType 1 呼吸心率，2 人体存在，3 跌倒，4 青岚呼吸心率（含睡眠状态），5 青岚轨迹（含姿态），6 超宽带呼吸睡眠，7 超宽带存在，11 在线状态。解析见 `client/packages/core/src/liveData.ts`
- 其他推送：`Alert`、`AlertClose`、`AlertCount`、`Record`、`Person`、`DeviceConfigChange`、`DeviceResponse`
- 状态枚举：睡眠状态 0 离床 / 1 浅睡 / 2 深睡 / 3 眼动 / 4 清醒；人体存在 0 无人 / 1 有人 / 2 信号弱；生命状态 3 表示生命体征弱；呼吸状态 0 正常 / 1 过低 / 2 过高 / 3 暂停
