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
| `POST /api/device/v3` | 新增设备（雷达设备页"新增"）：`{deviceName（≤32）, sn（≤64，全平台唯一）, deviceType, sortOrder, description（≤200）, properties:{buildingId, floorId, roomId}}`，安装位置可不填。修改是 `PUT /api/device/v3`（多 `id`）。雷达类型 = `/api/device-type/types` 里 `groupCode` 为 `RADAR` 的 |
| `POST /api/device/v4/unknown-devices/create` `{sn}` | 从未入库设备一键创建，返回 `data.created`（false 表示已存在） |
| `GET /api/room/options?floorId=` | 某楼层的房间 `[{label, value}]`（楼栋 `/api/building/options`，楼层 `/api/floor/options?buildingId=`） |
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
- `installHeight`：安装高度，单位是**米**（例如 3 = 3 m；房间里其他坐标、尺寸都是厘米）
- `workingType`（界面显示名称）：3 = 人员跟踪，7 = 跌倒监测，11 = 呼吸睡眠，15 = 床位监护（代码里的枚举名是 CriticalCare，不要按英文意译成"重症监护"）
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
   - 轨迹帧（msgType 5）每个目标是 `[人数, x, y, z, 姿态, 目标序号, 区域名, 区域序号]`。**区域名 / 区域序号是这个人最近一次进入的区域，不是当前所在位置**，进入下一个区域前一直不变；序号 255 表示还没进过任何区域（2026-10-15 实测藕塘 03房07床：从门进房后在房间中间来回走动，一直报"门|1"）。区域在平台的房间户型里配置后下发到设备：`/api/room-view/room-info` 里的 `ranges` 是空的，完整配置在 `/api/room-view/v3/detail?roomId=` 每个雷达的 `qingLanConfig.ranges`（`{type, index, text, x, y, width, height}`，单位 cm，门是 10 cm 宽的细条）。侧装朝右（installType 1，installDirection 2）时，实时目标 (x, y) 对应区域坐标 (radar.x − y, radar.y − x)，用在床的点核对过（2026-10-15）。客户端暂不显示当前位置（用户决定先不做）。事件时间线里的进出房间事件（1 / 2）也带着经过的门
4. **历史轨迹点 `trajectory-points` / 热力图 `heatmap-points` 的坐标系因设备类型而异**（2026-10-14 实测）。平台自带的轨迹回放和热力图都是直接画原始坐标，**对 FallSense 一类设备是错的**，人会被画到房间外面
   - **AIO Care Terminal（类型 6）**：原始坐标就是房间坐标（cm），直接画即可
   - **FallSense Terminal（类型 13）**：原始坐标是相对雷达的（cm），而且 **y 轴方向和实时数据相反**。先把 y 取反，再用上面的 `toRoom`（单位 cm，不带旋转）换算
     - 验证：藕塘社区 / 藕塘护理院 / 3楼 / 02房（侧装、方向朝右）。4 个目标的历史坐标换算后，与平台实时页面 `userPositions` 显示的位置逐点一致
   - 其他类型（11 / 12 / 15 / 16 等）未验证。时间回溯脚本对每台设备分别试"直接画"和"换算"两种方式，取落在房间内的点更多的那种：02房两台换算后 100% 在房间内，直接画只有 0.1%；坐起测试则是直接画时 94% 在房间内

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
- 状态枚举：青岚（msgType 4，原始记录 `sleepStatus` 同）睡眠状态实测为 **1 浅睡 / 2 深睡 / 3 清醒**（2026-10-15：白天在床醒着的长者几乎全是 3，夜里 3 对应报告的清醒 / 离床段；早先按 0 离床 / 3 眼动 / 4 清醒解析是错的，导致醒着在床也显示"在床睡觉"）；人体存在 0 无人 / 1 有人 / 2 信号弱；生命状态 3 表示生命体征弱；呼吸状态 0 正常 / 1 过低 / 2 过高 / 3 暂停

## 长者健康数据（2026-10-14，已用一条真实样本脱敏核对）

| 接口 | 说明 |
|---|---|
| `GET /api/member/info?memberId=` | `realName, gender, age, phoneNumber, checkedInAt` |
| `GET /api/cockpit/v2/elder/dashboard?reportLimit&rankingLimit&attentionLimit` | 健康驾驶舱：`summary`、`attentionItems`、`rankings`，以及 **`sleepReports`（机构内各长者"昨夜"的睡眠报告，带评分和趋势）**。`reportLimit=1000` 可用 |
| `GET /api/health/portrait-report?memberId&date` | 健康画像。`sleepReport` 里有某一天的睡眠分期（**没有评分**），可以按天查历史；另有 BMI、身高体重、运动统计 |
| `GET /api/member/data/radar-vital-minute-pages?filter[memberId]=` | 每分钟心率呼吸：`minuteAt, heartRateAverage/Min/Max, respiratoryRateAverage/Min/Max, qualityStatus`（memberId 必须写成 `filter[memberId]`） |
| `GET /api/member-report/date?reportType=1&memberId&date=YYYY-MM` | 当月哪几天有报告。reportType：1 睡眠，2 安全守护，3 空间活力，4 跌倒监测，5 健康画像 |
| `GET /api/sleep-analysis/report?memberId&queryAt` | 实测返回 404，不使用 |
| `GET /api/alert/pages?filter[memberId]=` | **memberId 筛选不生效**，按长者筛选告警只能取最近的告警后在本地过滤 `members[]` |

**睡眠报告字段**：`sleepScore, bedTime, fallAsleepTime, wakeUpTime, getUpTime`（"YYYY-MM-DD HH:mm:ss"），`totalSleepMinutes, totalNightSleepMinutes, deepSleepMinutes, lightSleepMinutes, remSleepMinutes, awakeMinutes, outOfBedMinutes, timeInBed`（分钟），`sleepEfficiency`（%），`leaveBedCount, awakeCount, avgHeartRate, avgBreathingRate, ahi`，`sleepDetails[{status, startTime, endTime}]`（毫秒），`heartRateTrend / breathingTrend`（从入睡开始每 10 分钟一个点，≤0 表示没有数据）
- **睡眠分段状态**：1 深睡，2 浅睡，3 清醒，4 离床，5 眼动，6 入睡潜伏期（平台健康模块的枚举 sH，common 模块 27905；与 16 份真实报告核对一致）。网页端另有一个 1 清醒 / 2 快速眼动 / 3 浅睡 / 4 深睡 / 7 离床 的枚举，那是设备实时睡眠状态用的，**不是**报告分段的编码（早前误以为网页端显示有误，已更正）。汇总里的清醒 / 离床只算入睡后的部分
- 每分钟心率呼吸：`radar-vital-minute-pages` 支持 `filter[minuteAt]=开始,结束`（"YYYY-MM-DD HH:mm:ss"），一晚约 600 条，可以一次取完
- 网页端的评分分级：≥80 良好，≥70 一般，其余为需关注
- **睡眠报告的"离床"与雷达位置经常不一致**（2026-10-14 核对藕塘社区两例）：
  - 3楼05床，报告离床 05:28–07:36；雷达原始位置显示 05:28 下床活动，**约 05:53 回到床上一直在床**（在床期间心率呼吸正常记录）
  - 3楼16床，报告离床 20:01–23:13；雷达显示大部分时间有目标在床，且同时跟踪 3～4 个目标（可能同屋有人）
  - 结论：平台内部睡眠报告与位置数据矛盾，原因待平台确认。客户端在夜间时间线上加了"雷达位置"一行对照显示
- **姿态时间线 `posture-timeline` 不传 userId 时只返回目标 1**（不是截断）。雷达给每个跟踪目标编号，人离开后再回来常变成新编号（上例回床后是目标 2），同屋有人时也会同时有多个目标，所以要按 userId=1..N 逐个查后合并

## 睡眠报告按来源查询（2026-10-14）

- **睡眠报告有多个来源**（枚举 gX）：1 AIO（睡眠-AIO），2 戒指，3 Ultra，4 手表，5 UltraFall，6 Ultra Plus。网页端"报告记录"里的"睡眠-AIO / 睡眠-戒指 …"几列就是它
- **长者用哪个来源取决于设备类型**：deviceType 6 AIO → 1，12 Ultra 呼吸睡眠 → 3，13 UltraFall → 5，15 Ultra Plus → 6
- `GET /api/health/sleep-report?memberId&date&source&windowMinutes=1`（雷达类来源带 windowMinutes=1）：完整报告，字段有 `sleepScore, sleepScoreText, sleepDescription, sleepSummary{各阶段分钟}, metrics{sleepEfficiency, timeInBed, leaveBedCount, awakeCount, avgHeartRate, avgBreathingRate, ahi…}, bedTime/fallAsleepTime/wakeUpTime/getUpTime, sleepDetails[], heartRate[{timestamp,value}], breathingRate[], apnea[]`（心率呼吸约每分钟一个点，共 720 个）
- **健康驾驶舱 `/api/cockpit/v2/elder/dashboard` 的 sleepReports 只有 AIO 来源**：藕塘社区 40 位长者里 38 位用 UltraFall，驾驶舱只列出 1 位；按来源逐个查询能拿到 31 位
- **报告是第一次被请求时才生成的**：首次请求可能要几秒到几十秒，之后约 100ms。批量查询时不要设短超时
- **判断"在床"用心率呼吸，不用姿态**（2026-10-14 与用户确认）：设备只有人平躺时才报姿态"在床"，翻身、坐起会报成"坐""静止"，但人还在床上。实测 3楼05床 10-14 05:15–06:05：下床走开的 05:29–05:53 每分钟心率呼吸全无，05:54 回床立刻恢复；仅起身那几分钟（坐床边）仍有读数。客户端"雷达位置"一行据此判断：有心率呼吸 = 在床，无心率呼吸但有跟踪目标 = 在房间，都没有 = 未检测到人
- **睡眠报告的时间范围**（2026-10-15 用 9 份报告核对）：`startAt` / `endAt` 是**睡眠时段（入睡 → 醒来）**，不是统计窗口。真正固定的是**监测范围晚上 20:00 到早上 08:00**：睡眠分段都落在这个范围内，起床时间最晚 08:00。到 08:00 人还在睡时，醒来和起床都记为 08:00（例如迪立莱 10-14 的 AIO 报告；设备记录显示 08:04 前仍在睡，08:14–08:16 在床醒着，08:17 后离开）。机构的 `/api/settings/sleep-report-config` 返回为空，应该是平台默认值。客户端以"最后一个睡眠分段的结束时间"作为报告覆盖的终点，之后用设备数据延长时间线
- **平台每分钟心率呼吸汇总不是平均**（2026-10-15 用迪立莱 10-14 夜 538 分钟核对）：\`radar-vital-minute-pages\` 每分钟 \`heartRateSampleCount\` 恒为 1。它不是这一分钟约 30 条原始记录的平均，而是定时抓取的 1 条读数，抓取秒数在整分钟里漂移（\`firstDeviceTime\` = \`lastDeviceTime\`）。抓取时刻正好没有记录时，整分钟就丢掉了。例如 04:13 原始记录只在 :01–:11 和 :48–:58 有数据，汇总里没有这一分钟。和我们按分钟求的平均相比，538 分钟里有 345 分钟相差超过 1，最大差 8.6 次/分
- **设备原始心率呼吸** \`/api/device/ql-respiratory-rate/pages\`：约每 2 秒一条，字段 \`deviceTime, heartRate, respirationRate, sleepStatus, deviceType, type, createdAt\`，按 \`filter[sn]\` 和 \`filter[deviceTime]=开始,结束\` 查询。AIO（6）和 UltraFall（13）都在这里，Ultra 和 UltraPlus 未核对。单页可取 20000 条，每条约 0.15 KB（未压缩）。一晚 12 小时约 16000 条：单页 0.5 秒，按 2000 条一页逐页取 0.8 秒，并行取 0.4 秒。客户端整晚取原始记录，自己按分钟算平均、最低、最高和有效读数条数（getDeviceVitals）；已结束的夜晚缓存在本机
- **连接复用**：本机到平台的新连接经常在 TLS 握手时卡 1、3、7、15 秒（30 次里有 13 次），复用连接就没有这个问题。plugin-http 的 fetch 每个请求新建一个 reqwest Client，不复用连接，所以客户端改用自己的 Rust 命令 \`api_request\`（共用一个 Client，见 \`client/packages/core/rust/api_http.rs\`）；vite 代理也加了 keep-alive

## 设备下行指令（MQTT，2026-10-15 从通信日志整理）

数据来源：测试机构"李虎"下 9 台设备的 `/api/device-log/pages?filter[direction]=2` 全部记录。日志**最早只到 2026-09-17**，平台大约只保留一个月。`filter[command]` 是**模糊匹配**（例如传 `IOT` 能匹配到所有 `IOT.*`）。

### 链路与报文格式

- **雷达（deviceType 6 / 13，topic 前缀 `sdb/radar/<SN>/`）**
  - 平台 → 设备：`sdb/radar/<SN>/iot`（日志 `direction=2`）
  - 设备 → 平台：`sdb/radar/<SN>/ak`（日志 `direction=1`）
  - 下行报文：`{cmd, DID: SN, seq, params}`；设备应答：`{cmd, DID, seq（与请求相同）, protocol_ver:"V1.0", code, params?}`
  - `code`：`200` 表示成功（读取类指令会带 `params`）；`201` 出现在 `callservice` / `settact` 的应答里，推测表示"已接收、异步执行"
  - 设备主动上报的 `Device.heartbeat` / `Device.register` / `Device.postevent`，平台都会在 `/iot` 回一条 `{cmd, DID, seq, protocol_ver, time（秒）, code:200}` 作为确认。一台在线设备每天约 1400 条这类确认，占了下行记录的 99%
- **slim 设备（deviceType 12，topic 为 `sdb/slim/<SN>/<指令>/s2d`）**：指令名放在 topic 里，报文只有 `{seq, params}`。目前见到 `set-property`、`get-property`、`get-tact` 三种，回包推测走 `.../d2s`（未核实）

### 雷达指令一览

| cmd | params | 用途 |
|---|---|---|
| `IOT.readproperty` | 属性名数组 `["talk_spk_vol", …]` | 读属性，应答的 `params` 是 `{属性名: 值}` |
| `IOT.setproperty` | `{属性名: 值, …}`，可以一次写多个 | 写属性（平台"设备配置"里的各项设置最终都走这条） |
| `IOT.gettact` | 无 | 读场景联动，应答 `params.scene_config[]` |
| `IOT.settact` | `{scene_config: [...]}` | 整体覆盖场景联动规则 |
| `IOT.callservice` | `{service_name, service_params}` | 调用设备服务，见下表 |
| `IOT.SYS` | 同 `callservice` | 见过一次 `Service_simulation_scene`，可能是旧版指令名 |

**callservice 服务**

| service_name | service_params | 说明 |
|---|---|---|
| `Service_sys_reset` | `"NULL"` | 重启设备 |
| `Service_get_OTA` | `{APP_ota_server:{url, MD5, size}, image_ota_server, exp_ota_server}` | 固件升级，url 指向 `fs.igoodlife.com` 上的升级包 |
| `Service_call_master` | `{call_ID}` | 让设备拨打指定号码 |
| `Service_call_handup` | `{}` | 挂断通话 |
| `Service_simulation_scene` | `{scene_id}` | 模拟触发某个场景（测试联动规则用） |
| `Service_start_remote` | `{name, token, remote_addr, timeout}` | 开启远程调试通道（token 属于敏感信息） |

**场景规则（`scene_config` 的元素）**：`{id, name, type:"conditions", relation:"&", mask_time, conditions:[{property, start, end, aggregation:"REAL", operator:"==", target, event}], actions:[{type:"trigger", name:"Event_auto_trig", alert_type_id}], expression:[]}`。`conditions.property` 见过：`QL_fall_state`、`QL_event_type`、`bt`（蓝牙按钮）、`Event_sr_data`（语音识别）。

### 雷达属性（readproperty / setproperty 的键）

平台的属性字典是 `/api/device-type-property/list?deviceTypeCode=6`，字段为 `propertyName, title, propertyGroupStringCode, dataType, isPlatformOnly…`。**部分字典名和报文里的键不一致**，以报文为准：

| 报文里的键 | 字典名 |
|---|---|
| `net_local_IP` / `net_local_mask` / `net_local_gateway` / `net_local_DNS` / `net_DHCP_EN` | `net_ip` / `net_mask` / `net_gateway` / `net_dns` / `net_dhcp` |
| `ccid` | `iccid` |
| `talk_local_number` / `talk_auth_pass` / `talk_sip_server` | `sip_account` / `sip_password` / `sip_server` |
| `device_on_time_span` | `working_times`（工作时间段） |
| `QL_radar_para_config` / `QL_radar_para_area` | `QL_radar_config` / `QL_radar_area` |

报文里实际出现过的键，按用途分组：

- **基础**：`device_onoff`（设备开关）、`device_on_time_span`（工作时段，如 `["00:00-23:59"]`，`[]` 表示全天）、`led_enable`、`radar_databuff_num`、`tz_offset`、`cpuid`、`logfile_post_server`、`snoring_record_url`、`QL_radar_para_ver`（只读）
- **网络 / 蓝牙（只读）**：`net_local_*`、`net_DHCP_EN`、`ccid`、`ble_ver`、`ble_mac`、`ble_name`
- **外设**：`slave_config`，例如 `[{slave_ID:"FHKS_…", slave_type:"1001"}]`
- **雷达算法**
  - `QL_radar_para_config`：`[安装方式, 安装高度, x1,y1, x2,y2, x3,y3, x4,y4, 工作模式]`。2026-10-15 和房间配置 `qingLanConfig` 逐项核对过：
    - 安装方式与 `installType` 相同：**0 = 顶装，1 = 侧装**
    - 安装高度 = `installHeight`（米）× 10，即单位是 **0.1 m（分米）**：坐起测试 3 m → `30`，距离测试 1.5 m → `15`
    - 四个角是探测区域 `container` 的四个角，坐标**以雷达为原点，单位分米**：顶装 600×400、雷达居中时为 `-30,-20 … 30,20`；侧装、雷达在上边中点时为 `-30,0 … 30,40`
    - 最后一位 = `workingType`（3 人员跟踪 / 7 跌倒监测 / 11 呼吸睡眠 / 15 床位监护），距离测试从 `7` 改成 `15`，和平台上工作模式的切换一致
  - `QL_radar_para_area`：`[[序号, 区域类型, 四个角的 8 个坐标], …]`。区域类型与 `ranges[].type` 相同（4 = 门，5 = 监护床…）；坐标同样以雷达为原点、单位分米，取整（例如床 x = -75…75 cm 下发为 `-7…7`）
  - `QL_radar_para_TH`：呼吸心率参数，例如 `[24,90,8,50]`，新固件多 3 位
  - `QL_radar_para_sit`：坐地参数 `[2,10]`
  - `QL_radar_para_fall`：疑似跌倒判定时间
- **通话**：`talk_type_sel`、`talk_local_number`、`talk_auth_pass`、`talk_sip_server`、`talk_master_number`、`talk_call_number_bak`、`talk_key1~3_number`、`talk_local_maxtime`、`talk_call_timeout`、`talk_spk_vol`、`talk_mic_vol`、`call_record_EN`、`call_record_url`
- **离线语音识别**：`offlsr_enable`、`offlsr_keywords`（`[[唤醒词(\uXXXX 去掉反斜杠), 阈值1, 阈值2], …]`）、`offlsr_response_file`、`offlsr_response_volume`、`offlsr_cooldown`
- **舒适音 / 录音**：`noise_spk_vol`、`noise_on_time_span`、`noise_volume_time_span`、`mic_record_time_span`

### slim 设备（deviceType 12）的属性

- `set-property` 见过的键：`time`（平台约每分钟下发一次对时）、`QL_radar_config`、`QL_radar_area`、`onoff`、`rs_range_min/max`、`rs_area`、`rs_vital_th`、`rs_respiratory_th`、`rs_sleep_en`、`rs_sleep_slot`、`rs_sleep_time`、`rs_report_nobody`、`rs_report_freq`
- `get-property` 读过的分组：`QL_radar_install / QL_auto_boundary / QL_reporting_mode / QL_health_config / QL_falldown_config`、`ble_*`、`net_rssi / ip / … / wifi_ssid / wifi_pwd`，以及 `mqtt_broke_address / port / user_name / user_password / keepalive`（说明设备连哪个 broker、用什么账号都可以远程读写）

### 设备属性读写接口（2026-10-16 在语音测试 …ef81 上实测）

平台"设备配置 › 存储属性"和运维端"设备属性"页用的都是这一套：

| 接口 | 说明 |
|---|---|
| `GET /api/device-property/property-schema-values?sn=` | `{deviceTypeCode, deviceTypeId, groups[], properties[], values{属性名: {value, deliveryStatus, deliveryAt, deliveryError, deliveryByUserName, updatedAt, updatedBy}}}`。已去掉隐藏属性。**标题、分组名是英文**（换语言请求头也一样），中文要从 `/api/device-type-property/list?deviceTypeCode=` 和 `/api/device-type-property/property-groups?deviceTypeCode=` 取 |
| `POST /api/device-property/read` `{sn, propertyNames}` | 下发 `IOT.readproperty`，`data` = seq。属性名用字典名，平台转成报文键（别名）下发 |
| `POST /api/device-property/write` `{sn, properties:[{propertyName, value}], saveOnly}` | 先存平台记录，`saveOnly:false` 时再下发 `IOT.setproperty`，`data` = seq；只保存、或全是平台属性时返回 `-1` |
| SignalR 推送 `DeviceResponse` | 设备应答：`{sn, command:"get-property"|"set-property", seq, code, message, data}`，`code` 0/200/201 为成功。按 sn + command + seq 匹配，网页端等 30 秒算超时 |

- 设备应答很快：读取约 0.1 秒、写入约 0.6 秒。应答可能比接口返回 seq 还早，要先缓存
- **读取结果也会被平台存成平台记录**（`deliveryAt`、`deliveryByUserName` 变成读取的时间和人），所以"平台记录"并不只是最近一次下发的值
- 设备不支持的属性不回值：AIO V1.3.46 读 `tz_offset`、`snoring_record_url` 时应答里没有这两项
- 属性定义里：`dataType` 1 String、2 Short、3 Int、4 Long、5 Float、6 Double、7 Bool、8 Array、9 Json；`displayType` 0 自定义、1 文本、2 输入框、3 多行、4 数字、5 开关、6 时间、7 下拉、8 音频、9 时间段；`accessMode` 1 读写、2 只读、3 只写；`deliveryStatus` 1 下发中、2 成功、3 失败。`fieldProps` 里有 `openValue/closeValue`、`min/max`、`options`、`visibleExpression`（例如 `talk_type_sel===1`）
- 写入实测：`talk_spk_vol` 50 → 51 → 50，报文 `IOT.setproperty {talk_spk_vol: 51}`，设备应答 `code 200`

### 注意

- 日志 rawData 里有**明文**的 SIP 密码（`talk_auth_pass`）、远程调试 token，以及 slim 设备的 Wi‑Fi 和 MQTT 密码。展示或导出日志时必须打码
- 只要能往 `/iot` topic 发消息，就能改设备配置、重启设备、推 OTA、开远程调试。所以 broker 一侧的 ACL 是关键安全边界，不能让第三方客户端拿到写权限

## 场景模板与设备场景（2026-10-15 整理）

### 接口

| 接口 | 说明 |
|---|---|
| `GET /api/scene-template/pages?includePlatfrom=true` | 场景模板列表：`id, templateName, deviceType, sceneGroupName, isDisabled`。**按机构存**：平台建的 63 个模板在账号所属机构（`rawOrgId`，"平台"）下，请求头 orgid 切到子机构（如李虎）后查不到，`includePlatfrom`（平台原拼写）也不管用，要用所属机构再查一次 |
| `GET /api/scene-template/config?templateId=` | 单个模板的场景定义 `data.sceneConfig` |
| `GET /api/scene-template/configs?templateId=a,b` | 批量取模板场景定义（平台"从模板导入"用的就是这个） |
| `GET /api/device-scene/scene?deviceId=` | 设备当前场景（平台库里的，不是设备上读回的） |
| `POST /api/device-scene/read` `{sn}` | 下发读取指令，结果从推送回来 |
| `POST /api/device-scene/scene` | 保存并下发设备场景，见下方"保存场景" |
| `GET /api/device-config/scene-status?deviceId=` | 最近一次下发：`sceneIssueStatus, sceneIssueAt, sceneIssueError` |
| `POST /api/device/test-{类型}-scene-alert` `{sn, sceneId}` | 测试场景上报 |
| `PUT /api/device-scene/device/{deviceId}/disable` `{disable}` | 路径里是**设备 id**（传场景 id 报"设备不存在"），作用于整台设备，不是单个场景 |

平台场景对象（camelCase）：`{id, sceneName, isDisabled, conditionType:"conditions"|"timeout", conditionName, relation, maskTime, conditions:[{property, aggregation, range(秒), operator, target, countOperator, countTarget}], actions:[{type, name, alertTypeId, audioFileName…}], interExpression, exitExpression, timeout}`，下发给设备时转成 `scene_config`（snake_case）。

### 保存场景（2026-10-15 在坐起测试 …627d 上实测）

- 请求：`POST /api/device-scene/scene`，`{sn, scenes:[完整列表], saveOnly:false, clear:true}`，返回 `data` = 下发的 seq
- **整体覆盖**：列表里没有的场景会被删掉（不是标记停用）。所以"禁用"某个场景 = 不带它重新保存；"启用" = 加进列表
- 已有场景原样带回（带 `id`）；从模板来的新场景去掉场景、条件、动作上的 `id`，平台会分配新 id。平台自己的编辑页只加载 `isDisabled !== true` 的场景、保存时全部置 `isDisabled:false`
- 平台转成 `IOT.settact` 下发，`range` 秒数转成 `start:0, end:range-1`；设备应答 `code 201`，随后 `scene-status` 的 `sceneIssueStatus` 为 2（成功）
- 实测把模板"离床告警"的 `{{area}}` 换成 `"0"`（监护床 index）后正常下发和应答

### 模板按设备类型分开

63 个模板：6（AIO）35 个、13（Ultra Fall）13 个、15（Ultra Plus）5 个、12（SleepSense）1 个、2 有 9 个。**同名场景在不同类型上属性名不同**：跌倒在 6 上是 `QL_fall_state`、区域是 `QL_event_area_ID`；在 13/15 上是 `QL_target_posture`、`QL_event_area`、`QL_target_event`。场景名在各类型间基本一致。

### 区域编号

- 条件里的区域值 = 户型里区域的 `index`（从 0 开始）。坐起测试（…627d）实测下发 `QL_radar_para_area: [[0,5,…],[1,4,…]]`，监护床是 0
- 模板里三种情况：用占位符 `{{area}}`（6 离床告警 / 马桶久坐 / 久坐提醒，13 久坐提醒），平台**不会自动替换**；直接写死编号（6 过度睡眠 / 入床提醒 / 淋浴过久 / 呼吸暂停 / 延迟离床报警，13 离床告警 / 离床延迟报警，15 离床告警 / 马桶久坐）；不涉及区域
- 已见可疑配置：藕塘社区 13 型设备监护床 index 是 0、门是 1，离床告警却写 `QL_event_area == 1`（13 型编号规则是否同样从 0 开始未核实）

### 户型区域字典（`ranges[]`）

- `type`：2 普通床，3 干扰区，4 门，5 监护床（只能有一个），6 感应区（自定义），7 家具。前端枚举里家具写成 6，但"区域type检测"户型实际保存为 7，以数据为准
- `spaceType`（空间区域类型，干扰区和门没有）、`spaceTypeOut`（门的"出区域类型"）：字典 `GET /sapi/code/options?codeType=ROOM_SPACE_TYPE`，51 床、52 沙发、53 过道、54 会客、55 餐厅、56 马桶、57 淋浴、58 洗漱、59 更衣、60 阅读
- 雷达元素的 `rangeType`（安装区域）：字典 `RADAR_INSTALL_AREA`，1 卧室、2 客厅、3 卫生间、4 厨房、5 其他
- 下发给设备的 `QL_radar_para_area` 只带 `[index, type, 坐标]`，`spaceType` 不下发，只在平台侧使用

## 长者建档与入住（2026-10-15 在李虎机构实测）

| 接口 | 说明 |
|---|---|
| `POST /api/member` | 建档，返回长者 id。必填 `realName`、`phoneNumber`；其他：`gender`（1 男 2 女）、`age`、`birthDate`、`idType`（字典 `ID_TYPE`：1 身份证，2 护照，3 港澳通行证，4 台湾通行证，5 其他）、`idNumber`、`memberType`（老人分类，字典 `HEALTH_STATUS`：1 健康，2 慢性病，3 重病，4 残疾，5 空巢老人，6 重点看护）、`height`、`weight`、`address` 等 |
| `GET /api/member?id=` | 详情，手机号不打码 |
| `GET /api/member/pages?filter[phoneNumber]=` | 列表，可按手机号筛选，返回的手机号**打码**（`100****0001`）；`checkType` 1 已登记 / 2 已入住，带楼栋、楼层、房间、床位 |
| `GET /api/member/search?keyword=` | **只返回已登记未入住的长者**（入住办理用），不能拿来判断是否已有档案 |
| `GET /api/member/checked-in-search?keyword=` | 只返回已入住的 |
| `PUT /api/member/check-in` | `{memberId, bedId, date:"YYYY-MM-DD"}` 办理入住 |
| `PUT /api/member/check-out` | `{memberId, checkOutReason, description}` 退住 |
| `GET /api/bed/options-with-floor?buildingId&floorId` | 某楼层的床位 `{bedId, bedName, roomName, memberId?, realName?}`，**必须带楼栋和楼层**；楼栋 `/api/building/options`，楼层 `/api/floor/options?buildingId=` |

- **平台按手机号识别长者**：`POST /api/member` 时手机号已存在（实测那位长者最后由别的机构编辑过），平台不新建、不改资料，直接返回已有长者的 id，而且这位长者随后出现在当前机构的列表里
- 床位名常带房间号前缀（如"101房间-1床"）
