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
| `POST /api/device/v3`（蓝牙外设） | "智能设备管理 › 蓝牙外设"的"新增"也是这个接口：`{deviceName（≤64）, deviceType, sn（表单叫"外设 ID"，≤32，全平台唯一）, sortOrder, description}`，没有 properties。列表 `GET /api/device/v3/bluetooth-slave-pages`（带 `radarDeviceName` 所属雷达、`realName` 绑定用户），环境传感器（OneNet）列表是 `/api/device/v3/onenet-pages`。**外设和雷达的绑定不在外设这边**：是雷达的 `slave_config` 属性 `[{slave_ID: 外设 ID, slave_type: "类型编号"}]`（最多 19 个），网页端在 AIO 的存储属性里选设备写进去。类型（2026-10-21 字典）：蓝牙外设 = `groupCode` SLAVE 的 1001 拉绳按钮、1002 语音、1003 门磁、1004 烟感、1005 体温贴；网页端新增表单的枚举还列了 1006 心电贴、1008 戒指、1009 鞋垫、8000 蓝牙扫描，但字典里 1008 是戒指（RING）、1009 是步态分析（GAIT）。OneNet 的 1101～1105、1201 是环境传感器（雷达属性 `heiman_slave_ids`） |
| `POST /api/device/v4/unknown-devices/create` `{sn}` | 从未入库设备一键创建，返回 `data.created`（false 表示已存在） |
| `GET /api/room/options?floorId=` | 某楼层的房间 `[{label, value}]`（楼栋 `/api/building/options`，楼层 `/api/floor/options?buildingId=`） |
| `/api/device-config/*` | 读写设备配置：`basic`、`network`、`audio`、`call`、`switch`、`working-time`、`scene`、`restart`、`status` 等（带 `/read` 的是读取） |
| `/api/device-property/read`、`write`、`raw-values` | 读写设备属性 |
| `/api/device/v4/organization-transfer` | 设备转移到其他机构 |
| `DELETE /api/device/v3?id=` | 删除设备（雷达设备页右键"删除"，通用 CRUD 的 genDelete），返回 `data: 1` |

#### 删除设备会连带清掉什么（2026-10-20 在李虎机构用临时房间 + 两台假 SN 雷达实测，测完已删除）

两台都绑了房间、床位、长者"测试老人"，并放进房间布置。一台只发平台的删除请求，一台走客户端的删除对话框：

| 记录 | 平台删除后 |
|---|---|
| 设备记录、雷达列表 | 没了；`GET /api/device/v3?id=` 返回 `succeeded` 但没有 `data` |
| 房间绑定 | 清掉（`/api/room/radars` 里没了） |
| 床位绑定 | 清掉（床位可以直接再绑别的设备） |
| 长者关联 | 清掉（`device-members` 为空，长者的 `deviceCount` 减 1） |
| **房间布置里的雷达位置** | **不动**：槽位还写着已删设备的 sn / deviceId |

所以删除前不用另外解绑床位和长者，删完要自己处理布置里的槽位。客户端删除对话框默认清掉槽位上的设备、留下安装方式和区域，也可以选连槽位一起删（`devices/deleteRadar.ts`）。

删除用的是本机构账号 `leehu`（`isAdmin: true, isSa: false`），`DELETE /api/device/v3` 正常，不需要超管。

**长者一侧的设备关联接口只有超管能用**（和机构有没有开 V3 无关）：
- 李虎机构 `GET /api/settings/org` 里 `enableV3: true`（平台判断 V3 的函数：有 `enableV3` 用它，没有时看 `enableV2RoomTypeDesign || enableV2PropertySettings`）
- `leehu` 调 `/api/device-position/v3/member-devices`、`v3/member-device-candidates`、`v3/bind-member-device` 都是 403（空响应体）；同为 v3 的 `v3/device-member-candidates`、`/api/device/v3`、`/api/room/v3/*` 都正常
- 平台长者页的"关联设备"列写着 `accessible: isSa`，本来就只给超管看；后端对这几个接口按超管拦
- 机构账号能用的是房间页（v3 房间视图）那套：`bindDeviceMember` → `POST /api/device/bind {deviceId, memberId}`，`unbindDeviceMember` → `POST /api/device/unbind {deviceId, memberId}`，`getDeviceMembers` → `GET /api/device-position/v2/device-members?deviceId=`（批量 `v2/batch-device-members?deviceIds=`）。路径里的 v2 是接口版本，V3 机构的平台前端现在也在用
- 2026-10-19 那次长者关联实测用的应该是超管账号，所以当时没碰到 403

机构账号的长者设备关联（2026-10-21 用 `leehu` 在李虎机构建两位临时长者 + 一台没人关联的雷达实测，测完已解除并删除）：

| 接口 | 说明 |
|---|---|
| `GET /api/member/devices?memberId=` | 长者关联的设备 `[{deviceId, sn, deviceName, deviceType, isOnline, lastActivityTime}]`，机构账号能用。**含别的机构的设备**（谢珍有 4 台，李虎机构的设备列表里一台都没有），所以不能用本机构设备列表 + 归属反推 |
| `GET /api/device-position/v2/batch-device-members?deviceIds=a,b` | `data` 是 `{deviceId: [{memberId, realName, age, gender, phoneNumber?}]}`，没人的设备不在结果里。50 台约 90 ms |
| `GET /api/device-position/v2/device-members?deviceId=` | 一台设备的归属，同上的数组 |
| `POST /api/device/bind {deviceId, memberId}` | 关联。**不拦已归属别人的设备，直接替换**：A 关联后再关联给 B，设备只剩 B（不需要再解绑 A）；原来有几位时是不是也全换掉没测过；返回 `data: 1`。没有追加的写法，见下面"入住、调床、退住"那节 |
| `POST /api/device/unbind {deviceId, memberId}` | 取消关联，返回删掉的条数；不是这位长者的设备返回 0（不报错）。同一人重复 bind 过一次时返回 2 |
| `GET /api/device-position/v3/device-member-candidates?deviceId=&keyword=` | 设备一侧的候选长者 `[{memberId, realName, phoneNumber?, orgName}]`，机构账号能用（客户端没用） |

客户端（`apps/ops/src/api/member.ts`）：超管仍走 v3 那四个接口；机构账号用 `member/devices` 取长者的设备，候选是本机构全部设备（`/api/device/v4/management-pages`，各类型）+ `batch-device-members` 的归属。因为 `device/bind` 会静默替换，客户端选设备时按候选里的归属先问"转过来"；没确认的关联在提交前再查一次 `device-members`，候选过时（别人刚关联过）就报错不提交。

另外：`POST /api/member` 不带手机号也能建档（只给 `realName`）。

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
- **Ultra 系列（13 UltraFall，15 按同一套处理但未核对）不发 `Device.heartbeat`**（2026-10-21 李虎机构 …D339 实测）。设备上报都是 command `post`（topic `sdb/slim/{sn}/post/d2s`，direction 1），`rawData` 形如 `{"seq":38,"params":[[10,1792551141,84.98,-2.95,4.05]]}`，每项第一位是类型、第二位是设备时间（秒）：
  - `[0, ts, 型号, ?, ?]` 注册（例如 `"FHK004-51B",1,"5"`）；`[1, ts, rssi]` 信号，约 2 分钟一条；`[3, ts]` 心跳，每分钟一条
  - `[10, ts, angle_x, angle_y, angle_z]` **安装角度**，含义和 AIO 的 `install` 相同（侧装读到 0.4 / 65.9 / 24.1，三轴 sin² 之和 = 1）。默认**只在姿态有大变化时上报**，装好不动就一直不报，所以"最近一次角度"可能是几天前的。倒扣时 z 为负（−87°）
  - 几种项会合在一条里报，例如 `[[10, …],[3, …]]`、`[[10, …],[1, …, -40]]`，按项逐个解析
  - **设备属性 `QL_radar_install`（雷达安装姿态上报开关，0 / 1）写 1 后持续上报角度约 70 秒，然后设备自己改回 0**（2026-10-21 …D339 实测：11:04:11 下发 1，11:04:13～11:05:22 共 76 个采样，约每秒一个、两个一条消息，期间没有下发 0；11:06:37 读设备返回 0，平台记录随之变 0。10-16 那次也是约 70 秒）。所以它不是常开开关，现场调角度时要再点。运维端角度页对 Ultra 系列做成"持续上报 70 秒"按钮 + 倒计时
  - 每个采样用自己的设备时间 `ts`（平台每分钟用 `set-property {time}` 给设备对时，设备时间比入库时间早约 2 秒）
  - 平台 `filter[command]` 是子串匹配，`post` 会把 `post-hex`（雷达原始帧，约 30 秒一条）也带出来
  - **`filter[rawData]` 可以按内容子串筛选**：`filter[rawData]=[10,` 只取角度，查半年 0.2 秒。客户端见 `api/device.ts` 的 `getHeartbeats / getDeviceReport`
- 告警类型分组 `alertTypeGroup`：1 = 场景（烟感、水浸、门磁…），2 = 事件（跌倒、呼吸心率、离床…），3 = 离线，4 = 紧急求助，5 = 安装姿态（"设备安装水平告警"）

- **`alert/pages` 不能按设备筛**（2026-10-17 李虎机构实测）：`filter[sn]`、`deviceSn`、`sns`、`deviceSns`、`keyword`、`search` 都被忽略，返回整个机构的告警。要按设备看只能按时间段取回后本地按 `sn` 筛。记录里有 `sn, deviceName, alertTypeName, alertTypeColor, createdAt`，没有雷达目标编号
- 告警记录和姿态时间线不一定对得上：坐起测试 10-14 00:31～00:39 有疑似坐地 / 跌倒告警，同时段 `posture-timeline` 一个分段都没有（按 userId 1～3 查也没有）

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
| `GET /api/room/member-panoramic?pageSize&pageIndex` | 实时监护页的长者列表：`memberId, realName, age, gender, bedName, focusLevel, devices[{deviceId, deviceName, sn, deviceType, isOnline, lastActivityTime, rangeName, qlWorkingType, sortOrder}]`。一位长者可以有几台设备，例如"我的房间"机构的长者：卧室 AIO（`rangeName` 卧室，`qlWorkingType` 15）+ 卫生间 UltraFall（卫生间，7）（2026-10-20） |
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
- 其他推送：`Alert`、`AlertClose`、`AlertCount`、`Record`、`Person`、`DeviceConfigChange`（场景读写完成，见"场景模板与设备场景"）、`DeviceResponse`
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
  - `QL_radar_para_TH`：呼吸心率参数 `[呼吸过高, 心率过高, 呼吸过低, 心率过低, 持续测量开关, 弱检测时间(分钟 1～15), 弱检测灵敏度(1～99)]`，单位次/分钟。老固件只有前 4 位（例如 `[24,90,8,50]`）。过低不能大于过高
  - `QL_radar_para_sit`：坐地参数 `[开关位, 坐地告警判定时间(×10 秒)]`。开关位 bit0 = 坐地告警、bit1 = 姿态检测；坐地告警开时姿态检测必须开，所以只会是 0 / 2 / 3（例如 `[2,10]` = 只开姿态检测，100 秒）
  - `QL_radar_para_fall`：疑似跌倒判定时间，单位 10 秒，1～240；0 表示用默认值 6（60 秒）
- **通话**：`talk_type_sel`、`talk_local_number`、`talk_auth_pass`、`talk_sip_server`、`talk_master_number`、`talk_call_number_bak`、`talk_key1~3_number`、`talk_local_maxtime`、`talk_call_timeout`、`talk_spk_vol`、`talk_mic_vol`、`call_record_EN`、`call_record_url`
- **离线语音识别**：`offlsr_enable`、`offlsr_keywords`（`[[唤醒词(\uXXXX 去掉反斜杠), 阈值1, 阈值2], …]`）、`offlsr_response_file`、`offlsr_response_volume`、`offlsr_cooldown`
- **舒适音 / 录音**：`noise_spk_vol`、`noise_on_time_span`、`noise_volume_time_span`、`mic_record_time_span`

### slim 设备（deviceType 12）的属性

- `set-property` 见过的键：`time`（平台约每分钟下发一次对时）、`QL_radar_config`、`QL_radar_area`、`onoff`、`rs_range_min/max`、`rs_area`、`rs_vital_th`、`rs_respiratory_th`、`rs_sleep_en`、`rs_sleep_slot`、`rs_sleep_time`、`rs_report_nobody`、`rs_report_freq`
- `get-property` 读过的分组：`QL_radar_install / QL_auto_boundary / QL_reporting_mode / QL_health_config / QL_falldown_config`、`ble_*`、`net_rssi / ip / … / wifi_ssid / wifi_pwd`，以及 `mqtt_broke_address / port / user_name / user_password / keepalive`（说明设备连哪个 broker、用什么账号都可以远程读写）

### 数组属性每一位的含义（2026-10-16 从平台网页端"存储属性"的专用组件和属性字典 description 整理）

平台网页端有一张"属性名 → 专用编辑组件"的注册表（common 包里 `matcher: C("属性名")`），运维端的结构化编辑器按它实现，见 `client/apps/ops/src/devices/propertyEditors.tsx`。

| 属性 | 设备类型 | 每一位 |
|---|---|---|
| `QL_radar_config` | 6 / 13 | 见上面"雷达算法"一节；四个角按第 3/4/2/1 象限排列（X-Y-, X+Y-, X-Y+, X+Y+），分米，-126～126 |
| `QL_radar_area` | 6 / 13 | `[[区域编号 0～15, 区域类型, 四个角 8 个坐标], …]`，最多 16 个，坐标顺序同上。类型 2 普通床、3 干扰区、4 门、5 监护床（只能一个）、6 感应区、7 家具。平台网页端只给可视化编辑器（房间户型） |
| `QL_health_config` | 13 / 15 | `[呼吸过高, 心率过高, 呼吸过低, 心率过低, 弱检测时间(分钟 1～15), 弱检测灵敏度(1～99)]`，阈值 1～255 次/分钟 |
| `QL_falldown_config` | 13 / 15 | `[疑似跌倒判定时间(×10 秒 1～240), 坐地告警, 姿态检测, 床上坐起, 坐地告警判定时间(×10 秒)]`，开关 0 / 1；坐地告警或床上坐起开时姿态检测必须开。平台里有违反这条的旧记录：李虎机构 ultra-跌倒（01511020BA72CD1D）存的是 `[1,1,0,0,1]` |
| `QL_reporting_mode` | 13 | 多选 `[1 实时 / 2 跌倒 / 3 呼吸心率]`，空数组表示不上报；见过 `[1,1]` 这种重复值 |
| `onoff`、`working_times`（`timeRangeFormat: "H,m"`） | 12 / 13 | 扁平数组，每段 4 个数：`[时,分,时,分, …]`，例如 `[0,0,23,59]`，最多 5 段 |
| `working_times` 等（`"HH:mm-HH:mm"`） | 6 | 字符串数组 `["08:00-20:00"]`，`[]` 表示全天 |
| `offlsr_keywords` | 6 | `[[唤醒词, 灵敏度, 阈值], …]` 只列启用的词。唤醒词固定 10 个：呼叫护工、呼叫护士、呼叫儿子、呼叫女儿、救命、别打我、救救我、有人抽烟、打死你、操你妈；灵敏度越小越容易触发，阈值越大越难唤醒（0～1） |
| `slave_config` | 6 | `[{slave_ID: 外设 SN, slave_type: 设备类型编号(字符串)}]`，最多 19 个 |
| `tz_offset` | 6 | 相对 UTC 的分钟数（中国 480），不会自动切换夏令时 |
| `rs_area` | 12 | `[X 左, X 右, Y 起, Y 止]` 厘米，X -400～400、Y 0～800。平台有的记录存成 JSON 字符串 `"[-50,50,70,500]"` |
| `rs_sleep_slot` / `rs_sleep_time` | 12 | 睡眠报告分析时段 `[时,分,秒, 时,分,秒]`（例如 18:00～次日 12:00）/ 报告生成时间 `[时,分,秒]` |
| `rs_report_freq` | 12 | `[离线时, 在线时]` 上报间隔，秒，0～255（平台网页端就标为"离线 / 在线"） |

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

## 管理主机与 SIP 通话（2026-10-22 读平台前端 `common` 模块 + 只读查询邻聚万家、李虎机构的数据和通信日志）

管理主机是 deviceType 3 的硬件（SN 形如 `MNG1CB8BA…`），自己注册到 SIP 服务器，和雷达双向通话。平台当前的 SIP 服务商是"申瓯"，地址 `sip.igoodlife.com:5060`（`GET /api/sip-provider/current`）。

### 一台雷达怎么接到管理主机（邻聚万家 `MNG1CB8BA433CC4` 的日志顺序）

1. 雷达云对讲需要有自己的 SIP 号：`talk_local_number` / `talk_auth_pass` / `talk_sip_server`（`GET /api/device-sip/available` 取一个空闲账号）
2. 雷达"通话配置"里选所属管理主机（`/api/device-config/call` 的 `masterId`），平台下发 `IOT.setproperty {talk_master_number: 主机的 SIP 号}`，再下发 `{talk_type_sel: 1}`（0 局域网 / 1 云对讲）
3. 管理主机勾选覆盖哪些房间（`POST /api/master/room-keys {deviceId, sn, roomKeys:[roomId…], issued}`），平台把这些房间里的雷达作为通讯录下发给主机（`update.devices`，见下）。**覆盖了房间也不一定进通讯录**：局域网模式的 AIO 要平台上存着它的 IP（属性 `net_ip`）才会进，没有就悄悄排除；云对讲的按 SIP 号进，不要 IP。2026-10-23 展厅演示 f14雷达（`…a173`，当天删掉重加，平台上没有 `net_ip`）：12:02 云对讲时随通讯录下发了（`callNum 10027, callType 1`），12:06 在平台通话配置里改成局域网后，下一次下发就没有它了；同机构局域网的 703客厅存着 `net_ip` 就在。另外它心跳里的 IP 是 192.168.5.4，和主机 172.16.1.200 不在一个网段，本来也只能用云对讲。通讯录变了平台会自动重发 `update.devices`（改通话配置、改覆盖房间都会触发）
   - **云对讲的雷达也要有 IP，主机才呼得出去**（同一台 f14雷达继续实测）：12:11:31 下发的通讯录里它只有 `callNum: 10060, callType: 1`、没有 `ip`，主机上点它没反应、没有任何通话记录；12:15:11 在设备属性里读网络信息后"仅保存"，平台存下 `net_ip: 192.168.5.4`，12:17:45 重发的通讯录里多了 `ip`，12:18:02 主机呼雷达就接通了。主机和雷达不在一个网段，所以这次实际是经 SIP 服务器拨的，IP 只是主机界面上"能不能点"的门槛（主机端的限制或 bug）。雷达删掉重加、或者平台从没读过它的网络信息时就会缺 `net_ip`
   - 主机呼雷达的通话记录：`callerIdentifier` 是主机 SIP 号，`rawCalleeNumber` 记的是主机自己的 `10072@sip.igoodlife.com`，`callType` 记成 3，被叫要看 `calleeDeviceName / calleeIdentifier`
4. 雷达场景的动作里加 `{type:"method", name:"Service_call_master"}`（不带参数），场景触发时雷达拨 `talk_master_number`。平台网页端限制：一个场景最多一个呼叫管理主机，且和"播放本地音频"二选一。邻聚万家的离床、跌倒、疑似跌倒、蓝牙按钮场景都是 告警 + 呼叫主机。李虎机构的距离test（…6711）也有，`talk_master_number` = 10056
5. 手动呼叫：`POST /api/device/call {sn, account}` → `IOT.callservice Service_call_master {call_ID: account}`（号码或手机）；挂断 `Service_call_handup`

### 紧急号码和场景的关系（2026-10-22 平台前端 + 8 台雷达最近一次呼出前后的通信日志）

- 雷达**只在场景触发时拨号**：抽查的每一次雷达呼出，同一秒都有 `Device.postevent {Event_auto_trig:{id:场景}}`，触发的场景都带"呼叫管理主机"动作。蓝牙语音 / 按钮这类外设事件（`Event_slave_data … event:"bt"`）也是先触发场景（如"语音求助"、"蓝牙按钮"），再由场景拨号。没看到不经过场景的呼出
- 场景里能打电话的动作有两种（平台前端 `CallMaster` / `CallAnyNumber`）：
  - `Service_call_master`（"呼叫管理主机"）：不带参数，**拨紧急号码 `talk_master_number`**，号码是什么就拨什么，不一定是主机
  - `Service_call_number`（"呼叫指定号码"）：动作里自带 `number`（手机号或 SIP 号，最长 14 位），不用紧急号码
- 紧急号码的输入框可选三种类型：管理主机（主机的 SIP 号）/ 手机号 / SIP 号。"呼叫备用号码"开启后，紧急号码不通时依次拨备用号码 1～3（平台表单说明，没实测）
- 手机号前缀按 SIP 服务器，不分本地外地：40 个机构全部 118 次雷达拨手机，经 `sip.igoodlife.com` 的 105 次全是 `0` + 手机号（152 / 153 / 155 / 189 号段都有接通），经 `rtcdev.ucpaas.com` 的全是 `0086` + 手机号，没出现过直接拨 11 位的。平台不做转换（设备照存的号码拨；网页端的号码输入框按 11 位手机号认，带 0 的会被当成 SIP 号），运维端在客户端里转换：用户只输入、只看到 11 位，存到设备时加前缀（`apps/ops/src/devices/dialNumber.ts`）
- 没有管理主机也能用：紧急号码填手机号，云对讲下经 SIP 服务商转到电话网。通话记录里雷达拨手机 4700 次，号码前加 0，例如 `015530230672@sip.igoodlife.com:5060`。局域网模式没有服务器，只能拨到 IP 上的设备
- 平台的"模拟设备触发场景"（`IOT.callservice Service_simulation_scene {scene_id}`）会让设备真的执行场景动作，包括拨号：2026-10-22 23:23:18 在李虎 AIO雷达（…627d）上模拟"床上坐起"，23:23:19 就有一条呼出 `015232099519@sip.igoodlife.com:5060`；另一个按钮"模拟平台触发场景"只在平台侧走告警流程，不呼叫、不播音频（按钮说明）
- 通话记录的 `createdAt − startAt` 约等于振铃时长：上面那次未接，记录在 32 秒后生成，和 `talk_call_timeout` = 30 秒对得上；未接的通话也可能有 `audioFile`
- 被叫是主机的 SIP 号时平台不一定认出来：东堃健康雷达拨 `60000181559272@rtcdev.ucpaas.com:25060`，记录里 `calleeDeviceType` 是 0

### 局域网和云对讲的区别（2026-10-22 统计 64 个有主机的机构共 24960 条通话记录 + 雷达心跳 / 通信日志）

- **云对讲**（`talk_type_sel = 1`）：雷达和主机都注册到 SIP 服务器（雷达心跳 `sip_reg: "register"`），被叫写成 `号码@sip.igoodlife.com:5060` 这类服务器地址，由服务器转接，不要求在同一网段
- **局域网**（`talk_type_sel = 0`）：**不注册任何 SIP 服务器**（心跳 `sip_reg` 为空），雷达直接向 `紧急号码@主机IP` 发起点对点呼叫，例如 `123456@10.84.18.131`。号码基本不起作用（多数是默认值 123456），关键是主机 IP 对不对、网络能不能通
- 局域网能用：泰康之家·鹭园 1997 次呼主机，1008 次接通，雷达 192.168.111.60 → 主机 10.84.18.131，跨网段但路由可达
- 局域网打不通的主要原因是**雷达拨的 IP 不是主机**：
  - 很多机构的雷达拨 `192.168.2.250`（象屿慈爱 710 次、寿福康、录屏演示、近邻驿站、启明学校…），这些机构的主机都不在这个地址，应该是出厂默认值
  - 东堃健康的雷达拨 172.16.20.146，平台记录的主机 IP 是 192.168.5.170（主机换过 IP 或换过主机）
- **AIO（6 型）**：平台不把主机 IP 下发给雷达。6 型属性字典里没有主机 IP 这一项，抽查的 AIO 通信日志里也没有这类下发；网页端通话表单里的隐藏字段 `talk_master_IP` 初始值是 `"123456"`，是遗留字段。雷达怎么得知主机 IP 没查到（推测是主机拿到通讯录后在局域网里通知雷达，所以要主机在线、覆盖了房间并下发过通讯录）
- **Ultra Plus（15 型，跌倒通话监测终端）会收到主机 IP**（2026-10-23 查展厅演示 ULTRA PLUS BATHROOM `0251A0F262E8EA55`）：协议和 AIO 不同，是 slim 那套 `set-property` / `get-property`，键是 `voip_mode`（0 局域网 / 1 云对讲）、`master_number`、`master_ip`、`local_number`、`sip_passwd`、`sip_server`、`call_backup`、`backup_number1～3`、`call_timeout`、`voip_max_time`、`call_record_url`。属性字典名是 `talk_master_number`、`sip_account`、`sip_password`、`sip_server`、`call_backup`、`talk_key1～3_number`、`call_timeout`、`voip_max_time`、`master_ip`（"管理机IP地址"），**没有 `talk_type_sel`**。平台网页端用同一个通话配置表单（`talk_*` + `masterId`）保存，后端按型号转成这套键，并把所选主机的 `ipAddress` 填进 `master_ip`：09:33:49 保存后下发了 `master_ip: "172.16.1.200"`（固德来护理主机）、`master_number: "10072"`（同一台主机的 SIP 号）。一个月的日志里只有这一次 `master_ip` 下发，说明只在保存通话配置时才下发，主机换了 IP 不会自动补发，要重新保存一次
- 15 型局域网呼主机时，通话记录的被叫只有 IP（`172.16.1.200`），没有 `号码@`
- 网页端在局域网模式、主机没有 IP 时会提示"局域网呼叫未能生效：当前设备还未和管理主机关联，请确认设备已安装到房间，且在管理主机的管理房间配置中关联了此设备所在房间"

### 管理主机的 MQTT 协议（和雷达不同）

topic `sdb/master/<SN>/iot`（下行）/ `…/ak`（上行），消息体 `{command, data, tag, time, status, error}`，`tag` 对应请求和应答。

| command | 方向 | 内容 |
|---|---|---|
| `heartbeat` | 上 | `{version}` |
| `sip.register` | 上 | `status` 1 已注册 / 0 未注册，主机约每 15 秒报一次 |
| `update.devices` / `get.devices` | 下（get 由主机发起） | 通讯录：`[{deviceId, roomName, deviceName, sn, realName, age, gender, deviceType, showRespiratoryRate, area, ip, callNum, sipAccount, callType}]`，`callNum` = 雷达 SIP 号 |
| `update.status` | 下 | 平台持续推这些雷达的实时状态 `[{deviceId, heartRate, respirationRate, physicalActivityIndex, humanTargetNumber, humanTargetPosition, status}]` |
| `get.property` | 下 | 读 `callNum / ip / gateway / mask` |
| `get.uploadurl` | 主机发起 | 平台回通话录音上传地址 `http://rd.igoodlife.com/api/call-record/upload` |

### 接口

| 接口 | 用途 |
|---|---|
| `POST /api/device/v3 {deviceType: 3, deviceName（≤64）, sn（≤64）}` | 新增主机（V3 机构，平台管理主机页的"新增"只有这两项；非 V3 走 `/api/master`）。2026-10-23 在李虎机构用测试 SN 建了再 `DELETE /api/device/v3?id=` 删掉，都正常 |
| `GET /api/device/v3/master-pages`、`/api/master`（CRUD） | 主机列表：`sn, deviceName, isOnline, firmwareVersion, ipAddress, sipEnable, sipServer, sipUserName, isSipRegister, sipRegisterAt, sipIssueStatus(2 = 已下发), deviceCount` |
| `GET /api/master/available-list` | 机构里的主机（不一定带 `sipUserName`） |
| `GET /api/master/info?deviceId=雷达` | **只返回覆盖房间里已有这台雷达所在房间的主机**（李虎 距离test 返回空，邻聚万家 卧室返回它的主机）。平台网页端"所属管理主机"下拉只用它，所以主机没覆盖这个房间时根本选不到 |
| `GET/PUT /api/device-config/call` | 雷达通话配置。GET 返回平台记录 `{deviceId, masterId?, call:{…}}`，常常只有 `talk_sip_server`、没有 `masterId`；PUT `{masterId, call:{talk_type_sel, talk_master_number, talk_local_number, talk_auth_pass, talk_sip_server, …}, sn, deviceId, saveOnly}`，平台和记录比、只把变了的项 `IOT.setproperty` 下发，返回 seq，没变化返回 0。网页端选了主机时紧急号码填主机的 SIP 号 |
| `GET /api/device-sip/available` | 一个空闲的 SIP 账号 `{sipAccount, sipPassword}`（网页端"随机选择 SIP"），保存通话配置时才绑给雷达 |
| `GET/POST /api/master/room-keys`、`GET /api/device/v4/master/issue-devices-preview?deviceId=` | 主机覆盖的房间、将下发的通讯录 |
| `GET /api/device/v4/master-sip/preview`、`POST …/enable`、`…/switch`、`…/disable {deviceId}`、`GET /api/master/sip-account-status?id=` | 给主机分配 / 换 / 停用 SIP 账号。流程（平台网页端，运维端 `devices/master/MasterSip.tsx` 照做）：`preview?deviceId=`（更换用 `switch-preview?deviceId=&excludeSipAccount=现在的账号`）返回 `{deviceId, sipAccountId, providerName, sipServer, sipAccount, sipPassword}`，只是挑一个空闲账号，不占用；"刷新"再预览一次并把正在显示的账号作为 `excludeSipAccount`；"测试"是 `POST /api/device-sip/{sipAccountId}/test` → `{success, message, elapsedMilliseconds}`；确定后 `POST enable / switch {deviceId, sipAccount}` 绑定并下发，主机执行完回实时推送 `DeviceResponse {command: "sipaccount", code, data:{deviceId, success}}`（deviceId 可能带横线） |
| `POST /api/device-sip/{id}/test`、`GET /api/master/read-property?sn=`、`POST /api/master/reboot?sn=`、`GET /api/master/relation-device-pages` | 测试账号、读主机属性、重启 |
| `GET /api/call-record/pages` | 通话记录（含录音文件 `audioFile`），按请求头的机构返回，`deviceId` 参数不起作用。`callType` 1 主机→雷达(IP)、2 主机→SIP、3 雷达→主机、4 雷达→SIP、5 雷达→手机，**但不可靠**：主机呼雷达也记成 3（主叫是主机），方向要看 `callerSn` / `callerDeviceType` |
| `/api/room/room-tree?deviceId=主机`、`/api/master/room-keys` | **按请求头的机构取数据**：在平台或上级机构下查别的机构的主机，房间树是空的，要用主机所属机构的 orgid 请求 |

## 场景模板与设备场景（2026-10-15 整理）

### 接口

| 接口 | 说明 |
|---|---|
| `GET /api/scene-template/pages?filter[includePlatfrom]=true` | 场景模板列表（含平台模板）：`id, templateName, deviceType, sceneGroupName, isDisabled`。`includePlatfrom`（平台原拼写）**必须放在 filter 里**；写成普通参数 `includePlatfrom=true` 时，子机构账号和切到子机构的管理员都只能查到本机构自建的模板（2026-10-16 用子账号 leehu 核对）
| `GET /api/scene-template/config?templateId=` | 单个模板的场景定义 `data.sceneConfig` |
| `GET /api/scene-template/configs?templateId=a,b` | 批量取模板场景定义（平台"从模板导入"用的就是这个） |
| `GET /api/device-scene/scene?deviceId=` | 设备当前场景（平台库里的，不是设备上读回的） |
| `POST /api/device-scene/read` `{sn}` | 下发读取指令（`IOT.gettact`），返回 seq；结果从 SignalR **`DeviceConfigChange`** 回来：`{sn, command:"read", data:{scenes:[平台格式 camelCase]}}`（2026-10-18 实测走这个，同时还有一条 `AntNotification`"读取设备【…】场景完成"）；网页端也认 `DeviceResponse` `command:"get-tact"`（`data` 直接是列表）。写场景完成是 `DeviceConfigChange` `command:"write"`。网页端只按 sn 认应答，读回后按 `sceneName` 和平台记录合并（同名用设备内容、保留平台 id；只在设备上的追加） |
| `POST /api/device-scene/scene` | 保存并下发设备场景，见下方"保存场景" |
| `GET /api/device-config/scene-status?deviceId=` | 最近一次下发：`sceneIssueStatus, sceneIssueAt, sceneIssueError` |
| `POST /api/device/test-{类型}-scene-alert` `{sn, sceneId}` | 测试场景上报 |
| `PUT /api/device-scene/device/{deviceId}/disable` `{disable}` | 路径里是**设备 id**（传场景 id 报"设备不存在"），作用于整台设备，不是单个场景 |

平台场景对象（camelCase）：`{id, sceneName, isDisabled, conditionType:"conditions"|"timeout", conditionName, relation, maskTime, conditions:[{property, aggregation, range, operator, target, countOperator, countTarget}]（COUNT 时 range = 最近几条记录、operator/target = 条数、countOperator/countTarget = 取值，见下方"区域编号"）, actions:[{type, name, alertTypeId, audioFileName…}], interExpression, exitExpression, timeout}`，下发给设备时转成 `scene_config`（snake_case）。

### 保存场景（2026-10-15 在坐起测试 …627d 上实测）

- 请求：`POST /api/device-scene/scene`，`{sn, scenes:[完整列表], saveOnly:false, clear:true}`，返回 `data` = 下发的 seq
- **整体覆盖**：列表里没有的场景会被删掉（不是标记停用）。所以"禁用"某个场景 = 不带它重新保存；"启用" = 加进列表
- 已有场景原样带回（带 `id`）；从模板来的新场景去掉场景、条件、动作上的 `id`，平台会分配新 id。平台自己的编辑页只加载 `isDisabled !== true` 的场景、保存时全部置 `isDisabled:false`
- 平台转成 `IOT.settact` 下发，`range` 秒数转成 `start:0, end:range-1`；设备应答 `code 201`，随后 `scene-status` 的 `sceneIssueStatus` 为 2（成功）
- 实测把模板"离床告警"的 `{{area}}` 换成 `"0"`（监护床 index）后正常下发和应答
- **平台记录跟设备 id 走，不跟 sn**：删掉设备再用同一个 sn 添加，新设备 id 下 `GET /api/device-scene/scene` 是空的，但设备上的场景还在（2026-10-18 距离test …6711 实测：平台记录为空，读设备读回"跌倒告警"）。所以按平台记录整体覆盖保存前，要先读一次设备，否则会把只在设备上的场景删掉

### 模板按设备类型分开

63 个模板：6（AIO）35 个、13（Ultra Fall）13 个、15（Ultra Plus）5 个、12（SleepSense）1 个、2 有 9 个。**同名场景在不同类型上属性名不同**：跌倒在 6 上是 `QL_fall_state`、区域是 `QL_event_area_ID`；在 13/15 上是 `QL_target_posture`、`QL_event_area`、`QL_target_event`。场景名在各类型间基本一致。

### 持续时间与久坐提醒（2026-10-21 坐起测试 …627d，6 型，固件 V1.2.30.B）

- 平台场景编辑页（`conditionType` 为 conditions / expression 时）有"持续时间开关"，存在场景的 `duration` 上，单位**分钟**（1～999，提示"当触发场景满足一定持续时间才生效"）。`conditionType: "timeout"` 的"超时时间"是另一个字段 `timeout`，单位**秒**，配合进入 / 退出表达式（例如延迟离床报警）
- **6 型固件不认 `duration`**：场景带 `duration` 时整条 `IOT.settact` 设备都不应答，读回设备还是旧列表（同一列表去掉 `duration` 立即应答 201）。连试两次都这样
- 6 型的条件字典 `SCENE_QL_RADAR` 里有 `sys_duration`"持续时间"（过度睡眠模板 `sys_duration >= 570`，按分钟就是 9.5 小时）。条件写成 `{property:"sys_duration", aggregation:"REAL", operator:">=", target:"2"}` 设备应答、读回有这一条；**不带 `aggregation`（模板里就没带）设备不应答**。实际是不是"持续满足 N 分钟才触发"还要有人在区域里坐着实测
- 13 型的条件字典 `SCENE_CONDITION_ULTRA_FALL` 里没有 `sys_duration`，只能用 `duration`，还没在 13 型真机上验证；15 型（`SCENE_CONDITION_ULTRA`）有 `rs_inbed_duration / rs_outbed_duration`（分钟），没有久坐模板
- 久坐提醒模板：6 型 = 最近 3 条 `QL_event_area_ID` 都是 `{{area}}` + 最近 5 条 `QL_fall_state` 至少 1 条 = 3（坐），动作是**播放语音**（`Service_play_audiofile`，不产生告警）；13 型 = 最近 5 条 `QL_target_posture` 至少 1 条 = 3 + 最近 5 条 `QL_event_area` 都是 `{{area}}`，动作是告警 `Event_auto_trig`（告警类型 `8e661285…` = "久坐告警"）。两个模板都没有时间条件
- **6 型的区域、姿态记录是怎么来的**（坐起测试 10-08～10-21 的通信日志和 `human-position` 时间线核对）：设备 `Device.postevent` 的 `event_QL_rawdata` 里 `0x81` 帧（24 字节，`AA AA 序号 81 01 01 …`），有人时约 1 秒一帧，没人时约 32 秒一帧（第 6 字节 `0x58`，后面全 0）。第 19 字节 = 姿态（`QL_fall_state`，取值同上面的姿态枚举，3 坐、4 静止、1 行走），第 20 字节 = 人员事件（0 无、1 进入房间、2 离开房间、3 进入区域、4 离开区域），第 21 字节 = 事件区域 ID。和平台 `event-timeline` / `posture-timeline` 逐条对得上，离床告警在"离开区域 0"那一帧后 1 秒触发
  - **区域 ID 每帧都带，但只在有事件的那一帧变**：进入房间那帧变成经过的门的 ID，进入区域变成该区域 ID，离开区域那帧还是该 ID、下一帧变 255（不在任何区域），之后一直保持到下一个事件。人在房间里走来走去、没进出区域时，区域 ID 一直是门（10-15、10-12 两段各 2 分钟都是这样）；雷达半路捡到人、没有进入事件时一直是 255（10-16 14:06）。没人的帧区域、姿态都是 0
  - **姿态每帧都报**，"坐"持续很短：两周里 16 段"坐"，最长 34 秒，多数 2～10 秒，之后多是"静止"（4）。还没有人在这台设备前连续坐过几分钟的数据，长时间坐着会不会一直报 3 不知道
  - 所以久坐模板里"近 3 条区域 ID 都是 X"≈ 坐下时触发过"进入区域 X"、之后还没离开（区域要画成能触发进出事件的感应区）；"近 5 条至少 1 条姿态 = 3"≈ 最近 5 秒左右报过坐。后者是三个条件里最可能撑不住 N 分钟的
- **真人久坐实测（2026-10-21 15:37～16:06，距离测试 …6711，6 型，区域 2 = 感应区）**，测试场景都用告警动作（久坐告警），设备每次触发上报 `Event_auto_trig {id: 场景 id}`：
  - 多目标时 `0x81` 帧第 4 字节 = 目标数、第 5 字节 = 目标编号，每个目标每秒各一帧；第 7、8 字节是有符号的 x、y（分米）。**区域、姿态记录按目标分开算**：房间里另有一人（一直"静止"、区域 255）时，"近 3 条区域 = 2 + 近 5 条至少 1 条姿态 = 3"照样触发
  - **长时间坐着会一直报 3**：连续坐了 11 分钟，除了挪动身体的十几秒是"静止"，其余全是 3
  - **`sys_duration` 在这台固件上不当"持续 N 分钟"用**：同样两个条件加 `sys_duration ≥ 2`（REAL），两人在房间时 4 分钟、只剩一人时 3 分 40 秒都没触发；不加的那条每 63 秒触发一次（触发间隔 1 分钟）
  - **超时类型（`conditionType: "timeout"`）可以**：`timeout: 120`（秒），进入表达式 `COUNT_2D(QL_event_area_ID_data,"==",2,">=",3,0,3) and COUNT_2D(QL_fall_state_data,"==",3,">=",1,0,5)`，退出表达式 `COUNT_2D(QL_event_type_data,"==",4,">=",1,0,3) and COUNT_2D(QL_event_area_ID_data,"==",2,">=",1,0,3)`（离开区域 2）。坐下后 123 秒触发，**之后一直坐着不再重复**
  - **加长记录数也可以**：近 120 条区域都是 2 + 近 120 条至少 60 条姿态 = 3，约 117 条记录（≈ 秒）后触发，之后按触发间隔每分钟重复
  - 运维端告警配置的久坐提醒（6 型）就按超时类型生成：模板的 COUNT 条件逐条换成 `COUNT_2D(属性_data, 取值比较, 取值, 条数比较, 条数, 0, 最近几条)` 作进入表达式，退出 = 离开该区域，`timeout` = 分钟 × 60（`scenes/plan.ts` toTimeout）。13 型不收超时类型，见"场景表达式"
  - **平台的姿态 / 事件时间线多人时丢数据**：一条 `Device.postevent` 里有几个目标的帧时，`posture-timeline`、`event-timeline` 只记第一帧（两人在房间的 15:37～15:50，坐着的目标 2 一段姿态、"进入区域 · 椅子"都没有；目标 3 的进出门也没有），而且记在帧的目标编号下。`trajectory-points` 的 `userId` 是平台自己的跟踪编号，和帧里的目标编号不一定一样（16:03～16:07 帧里只有 1 号目标，轨迹点一直是 userId 2，这段两个时间线都是空的）。运维端时间回溯在出现 userId ≥ 2 的时段改从原始帧解姿态和事件，按时间 + 位置（轨迹 x = 帧 x × 10，y = −帧 y × 10，厘米）对到轨迹目标（`devices/replay/data.ts`）
  - **离床告警的"离开多久后告警"也用超时类型**（2026-10-23）：平台 6 型"延迟离床报警"模板就是这个写法（进入 = 最近 5 条人员事件至少 1 条 = 4 + 区域 ID = 1，退出 = 人员事件 3 + 区域 ID = 1，`timeout: 30`，区域写死成 1，告警类型 `7cedc558…` 和离床告警的 `bcd0b61d…` 不同）。运维端告警配置在离床告警上加了可选的"离开 N 分钟后"：不填 = 离床告警模板原样（一离开就告警）；填了 = 模板两条 COUNT 条件换成 COUNT_2D 作进入表达式，退出 = 回到监护床（人员事件 3 + 监护床 ID），`timeout` = 分钟 × 60，告警类型仍用离床告警的（`scenes/plan.ts` toTimeout 的 leave 模式）。设备自己计时，不受每人记录条数限制。AIO雷达2（…ef81，6 型，固件 V1.3.46.B）下发 2 分钟设备应答，读回设备就是这条超时场景；清空后再下发读回又是条件列表。**还没真人走一遍验证触发和回床取消**。13 型不收超时类型，告警配置里 13 型这个输入框禁用。批量场景同样支持：启用离床告警时可填离开分钟数，6 型等生成同样的超时场景，13 型照模板一离开就告警并在预览里注明；不勾"覆盖"时，设备上已有离床告警的分钟数和填的不同就算覆盖。平台的"延迟离床报警 / 离床延迟报警"模板在列表里标成"建议用离床告警 + 离开分钟数"
  - 有人从旁边走过时雷达会把两个目标的轨迹接错：坐着的人被记一次"离开区域 2 / 离开房间 / 进入区域 2"（16:01:47～53），计时从头开始
- **读回的语音动作没有 voiceId**：设备读回的"播放本地音频"只有 `audioFileName`（见过 `voiceFile.wav` 和 `voiceId.wav` 两种），`voiceId` 为 null。把读回的场景原样保存，平台拒收："播放音频动作缺少有效音频ID(VoiceId)，请使用 voices-v2 返回的 value"。语音列表 `GET /api/device-scene/voices-v2?deviceId=` → `[{label, value(voiceId), fileName(= voiceFile), type, mD5, size}]`；运维端合并读回场景后按文件名补回 `voiceId / voiceName / voiceFile`（`api/scene.ts` fillVoiceIds）
- **带播放语音动作的场景，平台先发 `IOT.callservice Service_get_audiofile`（语音文件 url + MD5）让设备下载，设备应答后才发 `IOT.settact`**。坐起测试对这条一直没应答（等了 3 分钟以上，平常 callservice 0.1 秒内回 201），场景就一直没下发，平台记录却已经是新列表

### 区域编号

- 6 型：条件里的区域值 = 区域配置里的 `index`（从 0 开始）。坐起测试（…627d）实测下发 `QL_radar_para_area: [[0,5,…],[1,4,…]]`，监护床是 0
- 模板里三种情况：用占位符 `{{area}}`（6 离床告警 / 马桶久坐 / 久坐提醒，13 久坐提醒），平台**不会自动替换**；直接写死编号（6 过度睡眠 / 入床提醒 / 淋浴过久 / 呼吸暂停 / 延迟离床报警，13 离床告警 / 离床延迟报警，15 离床告警 / 马桶久坐）；不涉及区域

**`{{area}}` 就是区域 ID**（2026-10-17 与用户确认，依据用户自己编写的《(自动化场景设置)设备场景配置模板条件说明》，不是厂家协议；已在 13 型真机上实测，见下）

- 离床告警填监护床的区域 ID，区域滞留 / 久坐填对应区域的 ID。区域 ID = 区域配置里的 `index`，从 0 开始，户型设计里能看到（文档里的例子：监护床 0，所以 `{{area}}` 替换成 0）
- **COUNT 条件的字段名容易看反**：`range` = 统计最近几条记录；`operator / target` = **有几条**；`countOperator / countTarget` = **每条的值**。例如 13 型离床模板 `{range:5, operator:">=", target:"1", countOperator:"==", countTarget:"{{area}}"}` 的意思是"最近 5 条事件区域 ID 里，至少 1 条等于监护床 ID"。`{{area}}` 在 `countTarget` 里，就是区域 ID 本身。运维端 `api/scene.ts` 一直按这个理解，没问题
- 文档里的离床告警 = 人员事件 `QL_target_event` 值为 4（离开区域）+ 事件区域 ID `QL_event_area` 值为监护床 ID，两条同时满足
- 场景条件里各属性的取值（文档和《场景告警条件配置说明.xlsx》）：人员姿态 1～11（同上面的姿态枚举）；人员事件 0 无、1 进入房间、2 离开房间、3 进入区域、4 离开区域、5 进入监护状态、6 退出监护状态；人员数量 1～8；事件区域 ID 0～99；心率事件 / 呼吸事件为过去 1 分钟的状态（心率 0 正常、1 过低、2 过高、3 未定义；呼吸 0 正常、1 过低、2 过高、3 暂停）；入睡状态 0 未定义、1 浅睡、2 深睡、3 清醒；蓝牙外设 1 = 触发；音量 1000～50000

**13 型设备核对（2026-10-17 用藕塘社区 7 天历史只读核对；藕塘只有 6 型和 13 型）**

- 设备上报的区域号就是配置里的 index：13房52床（…3720）10-16 凌晨，"区域 0（监护床）"的进出事件和"在床"姿态逐次对得上（01:10:38 起身 → 01:11:09 离开区域 0 → 01:11:12 经区域 1（门）离开房间 → 01:11:24 经门回来 → 01:11:27 姿态回到在床 → 01:11:28 进入区域 0）。轨迹帧里 255 表示还没进过区域
- **藕塘 38 台 13 型的离床告警配错了区域**（新 13 型设备实测已确认区域 ID 规则，见下）：条件是"最近 5 条人员事件至少 1 条 = 4、最近 5 条区域 ID 至少 1 条 = **1**、最近 5 条心率和呼吸至少 3 条 = 0"，而这些设备的监护床是 0、门是 1。也就是"离开区域"和"门"同时出现在最近几条记录里就告警，不是"离开监护床"。7 天 100 次离床告警里，46 次前面几条事件里有门，36 次前 3 分钟里只有监护床事件（"最近 5 条记录"可能跨得更久，历史数据定不了），18 次查不到事件
- 13 型原始数据是 `post-hex` 帧（`AAAA` 开头，帧类型 0x81 / 0x82 / 0x68 / 0x78 / 0xE8 / 0xF8），格式没有文档，没有解码
- **平台内置的 13 型"离床告警"模板把区域 ID 写死成 1**（`QL_event_area` 最近 5 条至少 1 条 == 1），没有用 `{{area}}`。监护床通常是 0、门是 1，所以照模板套用就会变成看门。藕塘的配置应该就是这么来的（藕塘在模板基础上另加了心率、呼吸为 0 两条）
- 下发场景时通信日志里的报文是 `"relation":"u0026"`、`"operator":"u003E="`（`&`、`>=` 的转义丢了反斜杠）。藕塘能正常告警的设备收到的也是这样，设备应答 `code 0`，暂不当作问题

**新 13 型设备实测（2026-10-17，李虎机构 ultra跌倒 …C50D，固件出厂状态）**

- 13 型走 `get-property / set-property / set-tact` 这套报文（不是 6 型的 `IOT.*`）
- 出厂配置：`QL_radar_config [0,28,-30,-20,30,-20,-30,20,30,20,7]`（顶装 2.8 m、跌倒监测）、`QL_radar_area []`、`QL_falldown_config [6,0,0,0,10]`、`QL_reporting_mode [1]`
- **老版下发 `POST /api/device-config/qinglan-install` 对 13 型无效**：平台发的是 `IOT.setproperty {QL_radar_para_config, QL_radar_para_area}`，设备不应答，读回还是出厂值。13 型只能用属性写入（`POST /api/device-property/write`），平台会转成 `set-property {QL_radar_config, QL_radar_area}`
- **`code 103` = 设备正忙，这次设置没被接受**（2026-10-17 重新实测，纠正之前"左右范围固定 ±3 m"的错误结论）：设备刚应用完一条设置的几秒内，再下发会回 103，读回还是旧值。隔约 15 秒重发就会成功（`code 0`）。实测侧装 ±1.5、±2、±2.5、±3 m，−3…+2 m（不对称），以及深度 3.5 m 都能设置，**左右范围可以调**。运维端收到 103 会在 10 秒后自动重发一次
- **改安装方式（顶装 ↔ 侧装）时第一次下发一定回 103**（2026-10-17 两个方向各测一次，前一次写入在 10 分钟前，不是"正忙"）。10 秒后原样重发就是 `code 0`，读回和下发的一致。第一次从出厂配置（顶装）改成侧装时那次 103 也是这个情况
- **离床场景实测通过（`{{area}}` = 监护床 ID 0）**：场景用平台 13 型离床模板，只把区域 ID 改成 0（最近 5 条人员事件至少 1 条 = 4，最近 5 条区域 ID 至少 1 条 = 0）。房间 4×4 m，侧装 1.6 m，监护床在雷达正下方（ID 0），门在左下角（ID 1）。测试人只在床和床边活动，从没走到门那里（离墙最远 2.5 m，门在 3.9 m）：
  - 设备逐条上报的 `rangeIndex` 只出现过 0 和 255（255 = 不在任何区域），从没出现 1
  - 离开区域 0 三次（00:53:55、00:54:07、00:55:13），告警两次（00:53:56、00:55:15），都在离开后 1～2 秒。中间那次没告警，是因为 `mask_time 1`（1 分钟内不重复告警）
  - 离开要走出床边一段距离才算：床宽 ±45 cm，人在 x = 80 时还算在区域 0 里，到 110～200 才报"离开区域"。和说明文档里"离开床区域 40 cm 后告警"一致
  - 设备在场景触发时上报 `post [[100, 时间戳, 场景 id]]`
- 13 型逐条位置记录 `GET /api/device/human-position/pages?filter[sn]=` 里带 `rangeIndex`、`eventType`、`posture`，坐标是相对雷达的 cm（x 横向、y 离墙的深度）。可以直接拿来看人在哪个区域
- 同一时段 `event-timeline` 对这台设备返回空。可能是因为房间设计里的设备没有 `rangeId`（坐起测试那台有），原因没查
- 测试期间设备两次上报 `post [[0, 时间戳, "FHK004-51B", 1, "5"]]`，而且 seq 从 0 重新开始，看起来是设备重启了（00:52:12、00:53:07）
- 测试房间"13型离床测试"、共用户型"通用"留在李虎机构，设备 …C50D 保持这套配置

### 场景表达式（2026-10-22 平台前端 + 坐起测试 …627d 实测，6 型）

场景有三种条件写法：`conditions`（条件列表，平台下发时转成 `conditions:[{property, start, end, aggregation…}]`）、`expression`（`normalExpression` 一条表达式）、`timeout`（`interExpression` / `exitExpression` + `timeout` 秒）。后两种是**设备自己求值的表达式**。

**语法**（平台场景编辑页的"函数传入参数详解"，函数表来自字典）：

| 字典 | 函数 | 签名 |
|---|---|---|
| `SCENE_THREE_PARAMS` | MAX 最大值、MIN 最小值、AVE 平均值、P2P 峰峰值、SD 标准差、REAL 实时值、SUM 求和值 | `F(arr, start=0, end=None)`，例 `AVE(XJW_human_exist_data,1,10)` |
| `SCENE_FIVE_PARAMS` | CONS 最大连续窗口、COUNT 统计值、MAX_2D / MIN_2D / AVE_2D / P2P_2D / SD_2D / REAL_2D / SUM_2D | `F(arr, op, value, start, end)`，例 `COUNT(XJW_human_exist_data,"=",12,1,10)` |
| `SCENE_SEVEN_PARAMS` | CONS_2D、COUNT_2D | `F(arr, op, value, count_op, count_value, start=0, end=None)`，例 `COUNT_2D(XJW_human_exist_data,"=",12,"!=",10,1,10)` |

- `arr` 数据源（属性名 + `_data`），`op / count_op` 比较符（`SCENE_CONDITION_OPERATOR`：`> == >= < <= !=`），`start` 起始索引（从 0），`end` 结束索引（不含），和 Python 切片一样。条件之间用 `and` / `or`
- **2D 函数作用在多个子列表上，任何一个子列表满足就为真**（平台原话）。人员类属性每个目标一个子列表，这就是 10-21 实测里"另一人在房间也不影响你的久坐判断"的原因
- 属性列表字典按型号：6 型 `SCENE_RADAR_EXP_QL`（李虎机构查回来是空的）、跌倒雷达 `SCENE_RADAR_EXP_FALL_DETECTION`、人体存在 `SCENE_RADAR_EXP_HUMAN_EXISTS`、呼吸率 `SCENE_RADAR_EXP_RESPIRATORY_RATE`

**在设备上直接求值**：`POST /api/device-config/verify-expression {deviceId, expression}`（返回 seq）→ 平台下发 `IOT.callservice {service_name:"Service_expression_verify", service_params:"表达式"}` → 设备先回 `code 201`，算完再发 `Device.postevent {Event_service_result:{service_name:"Service_expression_verify", service_result:"结果的文本"}}`（约 0.5 秒）。平台网页端监听 SignalR `VerifyExpression` / `VerifyExpressionResult`，但这几次实测浏览器没收到推送，结果要从通信日志按 seq 取。不保存场景、不影响设备上的场景，适合摸语法

- **设备是用 Python 求值的**：`1 == 1` → `"True"`，`QL_fall_state_data` → `"[[], [], [], [], [], [], [], []]"`，`len(...)`、切片 `[:12]` 都能用。求值出错（如 `globals()`、`locals()`、不存在的名字）**没有任何回报**，只有 201
- 函数自己报的错以文本返回：`COUNT_2D` 时 8 个子列表全空 → `"Sub_var List Empty Error"`；`COUNT` 传了空列表 → `"Var List Null Error"`
- 已知变量（房间里没人时取的）：
  - 每个目标一个子列表、共 8 个：`QL_fall_state_data`（姿态）、`QL_event_type_data`（人员事件）、`QL_event_area_ID_data`（事件区域 ID）；没人时子列表全空
  - 一维、300 条：`QL_human_quantity_data`、`QL_heart_event_data`、`QL_respiratory_event_data`、`QL_respiratory_rate_data`、`QL_sleep_event_data`；没人时全是 0
  - `sys_duration`、`sys_hour`、`sys_minute` **不是表达式变量**（条件列表里的这几个属性是另外处理的，sys_duration 实测也不起作用）
- 还没摸清（要有人在雷达前测）：子列表最新的一条在 0 号还是末尾、每个目标存多少条、多久追加一条、目标离开后子列表是否清空；条件列表里"近 N 条"下发成 `start 0, end N−1`，和"end 不含"对照是 N 条还是 N−1 条；`expression` 类型多久求值一次、`mask_time` 怎么作用；时间段条件（`sys_time_split`）在表达式里怎么写；15 型支不支持 `Service_expression_verify`
- **13 型不支持现场求值**（2026-10-22 ultra跌倒雷达 …C50D）：平台照样下发 `IOT.callservice Service_expression_verify`，设备不回 201 也不回结果（13 型只认 get-property / set-property / set-tact 这一套）
- **13 型也不收超时 / 表达式场景**（同一台，2026-10-22 真人实测）：列表里有一条 `conditionType: "timeout"` 的场景，`set-tact` 就回 **`code 100`**（正常是 `code 0`），整条不生效。13 型名字（`QL_event_area_data`）、6 型名字（`QL_event_area_ID_data`）都一样，**平台自带的 13 型"离床延迟报警"模板原样下发也是 code 100**。平台不认 code 100，只是 30 秒后显示"没应答"。13 型只能用条件列表
- **13 型用加长记录数做时长**：13 型每秒一条人员记录（`human-position/pages` 里带 `posture`、`rangeIndex`），区域条件"最近 N 条全是区域 2"在进入区域后约 N 秒触发：N = 120 / 300 / 400 分别 119 / 296 / 396 秒（离开区域 13 秒再回来后重新计时；改场景重新下发时历史记录不清）。所以每个目标至少存 400 条；**上限 600 条**（用户告知，平台前端没有这个限制，是设备侧的），所以 13 型用这个办法最长 10 分钟，告警配置里 13 型久坐时长最多填 10。长时间坐着一直报 3（坐），偶尔几秒 4 / 1。触发间隔 1 分钟时一直满足条件每 71～73 秒触发一次
- 运维端告警配置的 13 型久坐提醒按这个生成：区域条件改成最近 分钟 × 60 条全是选的区域，坐姿条件照模板，触发间隔 = 同样的分钟数（`scenes/plan.ts` toLongWindow）。2026-10-22 用告警配置页开 3 分钟、区域 2 端到端实测：设备 `code 0`；房间里两个人，区域 2 里的人从 20:46:22 连续在区域里，20:49:20 第一次触发（≈ 178 秒）；之后 1、2 分钟时都没重复，20:52:51 第二次（间隔 211 秒：触发间隔 3 分钟到了以后，又等到姿态从"静止"变回"坐"）。坐着时姿态在 3 / 4 之间来回切，"静止"持续时坐姿条件不满足，提醒会顺延

### 户型区域字典（`ranges[]`）

- `type`：2 普通床，3 干扰区，4 门，5 监护床（只能有一个），6 感应区（自定义），7 家具。前端枚举里家具写成 6，但"区域type检测"户型实际保存为 7，以数据为准
- **6 感应区就是平台的"自定义区"**：类型都是 6，名字（`text`）随便起，比如沙发区、马桶区、淋浴区。名字是自由文本，不能拿来认区域；要知道它是马桶还是淋浴，看 `spaceType`（下一条）。显示时先用 `text`，没有再用类型名
- `spaceType`（空间区域类型，干扰区和门没有）、`spaceTypeOut`（门的"出区域类型"）：字典 `GET /sapi/code/options?codeType=ROOM_SPACE_TYPE`，51 床、52 沙发、53 过道、54 会客、55 餐厅、56 马桶、57 淋浴、58 洗漱、59 更衣、60 阅读
- 雷达元素的 `rangeType` / `rangeName`（安装区域编号 / 别名，没填别名时是区域名）：字典 `GET /sapi/code/options?codeType=RADAR_INSTALL_AREA`，**1 卧室、2 客厅、3 厨房、7 卫生间、8 室外、9 其他**（2026-10-20 取字典核对；8 室外的说明是"只在门的出区域类型使用，不能在雷达安装区域中使用"）。之前这里记成 3 卫生间、4 厨房、5 其他，是错的。v3 房间设计里选中雷达时出现"雷达安装区域"下拉和别名输入框，写的是元素上这两个字段；户型设计写的是 `qingLanConfig.extra.installArea / installAreaAlias`，建房拷过来的元素可能只有 extra（李虎"13型离床测试"）
- 下发给设备的 `QL_radar_para_area` 只带 `[index, type, 坐标]`，`spaceType` 不下发，只在平台侧使用

## 房间户型与雷达区域下发（2026-10-16 读平台前端代码 + 在李虎机构实测）

客户端的简化方案见 [room-radar-simplification.md](room-radar-simplification.md)；户型、房间、设备、场景各份记录的关系和一致性问题见 [room-device-model.md](room-device-model.md)。

### 两套界面：老版和 v3

- 由机构设置 `GET /api/settings/org` 决定：`enableV3`，没有这个字段时看 `enableV2RoomTypeDesign || enableV2PropertySettings`。李虎机构三个都是 `true`，即 **v3**
- 老版：户型列表页每行"房间户型平面图设计"新开 `/room-type-design?id=&source=1`；房间新增弹窗里用下拉选户型，勾"根据房间类型自动创建床位"
- v3：户型、房间都在弹窗里设计（`/room-design` 一套组件），新建房间时用带缩略图的卡片选户型，房间设计里还能绑雷达、建床位、办理入住
- 页面代码：`p__Basic__RoomTypePage`（户型列表）、`p__Basic__RoomTypeDesignPage`（老版设计页）、`p__Basic__RoomPage`（房间，两版都在里面）；雷达区域编辑器在 `common` 模块 18275（store）和 43676（画布）

### 数据分层：一个雷达的区域配置会存在 5 个地方

| 层 | 存在哪 | 说明 |
|---|---|---|
| 1 户型 | `/api/room/v3/room-type-design?roomTypeId=`（老接口 `/api/room-type-range?id=&source=1`） | `{roomStyle, elements[], roomLong, roomWidth, previewImageUrl}`。雷达元素（type 3）是**空槽位**：有 `qingLanConfig`、`deviceType`，没有 `sn / deviceId` |
| 2 房间 | `/api/room/v3/design?roomId=`（老接口 `/api/room-type-range?id=&source=2`） | 建房时从户型**整份拷贝**（元素 id 不变），槽位上再写入绑定设备的 `sn / deviceId / deviceName`。房间详情 `room-view/v3/detail` 读的就是这一层 |
| 3 设备自定义（老版） | `/api/device-config/qinglan-config?deviceId=&isApp=true` 的 `source = 3` | 老版设备配置里的"自定义区域"，覆盖户型的公共区域；`GET /api/device-config/qinglan-install/clean?deviceId=` 删掉后回到户型配置 |
| 4 平台属性记录 | `/api/device-property/property-schema-values?sn=` | `QL_radar_config`、`QL_radar_area`（下发给设备的数组），以及**只存平台**的 `QL_radar_design`（整份 qingLanConfig JSON）、`QL_radar_working_type` |
| 5 设备本身 | `POST /api/device-property/read` 读回 | 真正生效的值 |

- `qinglan-config` 不带 `isApp=true` 时返回"请求参数格式不正确"。返回 `{source, sourceName, sourceId, rangeId, roomTypeId, roomTypeName, background, elements, config}`，source：1 户型、2 房间、3 设备（Radar）
- 李虎机构 36 台雷达里只有 4 台能取到配置（都是 source 2），其他设备没绑进房间设计

### 户型和房间的关系（2026-10-16 建临时户型 + 临时房间实测，测完已删除）

- **每个房间都必须有户型**。新建：`POST /api/room/v3/apply-room-type-on-create {roomName, floorId, buildingId, roomTypeId, roomLong, roomWidth, autoCreateBeds}`，返回房间完整设计（就是户型的拷贝）。老版新建是 `POST /api/room`
- **户型改了不会同步到已建房间**：把户型雷达高度 2 → 2.5 m 保存后，房间（新旧两个接口）都还是 2 m，只有 `GET /api/room/v3/current-room-type-design?roomId=` 返回户型的最新值。要同步只能在 v3 房间设计里点"从户型更新"，提示"已更新户型数据，点击保存生效"，一次一个房间
- 老版房间编辑时户型下拉禁用，提示"房间户型不可编辑，如需更改请删除房间重新创建并绑定设备"。v3 房间设计里有"切换户型"（`/api/room/v3/room-type-list` 选，`room-type-range?source=1` 取设计），保存接口 `POST /api/room/v3/design` 只带 `{roomId, roomStyle, elements}`
- **`roomTypeId` 只是个标签**（2026-10-17 用临时户型 + 临时房间实测，测完已删除）：
  - 不带 `roomTypeId` 建房，v3 和老接口都报错（"字段【RoomTypeId】不能为空" / "房间户型标识不能为空"）
  - 建房时传的长宽被忽略，房间尺寸取户型的尺寸
  - v3"切换户型"（把另一个户型的设计保存进房间）**不会**改房间的 `roomTypeId`
  - `PUT /api/room`（整条房间记录带新的 `roomTypeId`）可以直接改户型，接口不拦，房间设计不变
  - 保存房间设计时，房间的长宽按 `roomStyle` 的宽高（cm ÷ 100）一起更新
  - 有房间在用的户型删不掉："删除房间户型失败, 请先删除相关房间!"
  - 设计从没保存过的房间，`room-view/v3/detail` 里没有 `background`
- 户型自带床位槽位（`isBedSlot` 元素）时，`autoCreateBeds` 按槽位建床；实测户型没有床位槽位时不建床
- 户型其他操作：`PUT /api/room-type/disable`；导出 `POST /api/room-type/export {roomTypeIds}` 返回一串文本（复制到剪贴板），导入 `POST /api/room-type/import {base64Data}`；引用平台内置模板 `GET /api/room-type/platfrom-pages`（平台原拼写）+ `POST /api/room-type/copy {roomTypeIds}`
- 房间尺寸：`PUT /api/room/v3/size {roomId, roomWidth, roomLong}`（米）。宽 = 平面图水平方向，长 = 垂直方向
- 改设备位置（雷达设备页"编辑"）：`GET /api/device/v3?id=&propertyNames=roomId` 取整条记录，`PUT /api/device/v3 {id, deviceName, sn, deviceType, sortOrder, description, properties:{roomId, buildingId, floorId}}`，`roomId: null` 解绑。2026-10-18 在 …0901d0 上实测：只改 `device.roomId`，房间布置（v3 design）和床位绑定都不动。`GET /api/device/v3` 不带 `propertyNames` 时 `properties` 是空的
- 设备绑定（v3）：`GET /api/room/v3/uninstalled-radars?keywords=`、`GET /api/device-position/bindable-room-devices?roomId&keywords&deviceType`、`PUT /api/device-position/bind-room-device {roomId, deviceId}` / `unbind-room-device`；床位设备 `bind-bed-device {bedId, deviceId}` / `unbind-bed-device {bedId}`；设备绑长者 `POST /api/device/bind {deviceId, memberId}` / `unbind`
- 能配区域的设备类型：AIO（6）、UltraFall（13）、UltraPlus（15）

### qingLanConfig 的规则（前端 store `common` 18275）

坐标单位 cm，`container / bound / ranges / radar / supervision` 都在雷达"容器"坐标系里（`container.x/y` 是容器在房间里的偏移）。

- `container`：雷达最大探测范围，尺寸**由安装方式 + 朝向 + 工作模式决定，不能拖**

  | | 朝上/下 | 朝左/右 |
  |---|---|---|
  | 顶装（所有模式） | 宽 600 × 高 400 | 400 × 600 |
  | 侧装 · 人员跟踪 | 800 × 600 | 600 × 800 |
  | 侧装 · 呼吸睡眠 | 120 × 200 | 200 × 120 |
  | 侧装 · 其他 | 600 × 400 | 400 × 600 |

- `radar`：顶装在容器正中；侧装在朝向那一边的中点（朝下 = 容器上边中点，以此类推）。**后端换算时按这个规则自己算雷达位置**，不用传进来的 `radar.x/y`（传了不一致的值，换算结果对不上）
- `bound`：实际监测边界，在容器内用户可缩小（`boundDistance` 上下左右到雷达的距离）。侧装时雷达那一边不能动
- `supervision`：监护区左上角，正方形，**顶装 300 cm、侧装 200 cm**，默认居中（侧装贴雷达那一边）。监护床必须在里面
- `installHeight` 米：顶装默认 2；侧装限制 1.5～3.5。`workingType`（3 人员跟踪 / 7 跌倒监测 / 11 呼吸睡眠 / 15 床位监护，默认 15）。切到**呼吸睡眠**会强制侧装、1.5 m，并把区域清成一张占满容器的监护床
- `ranges[].index`：0～15，新区域取最小的空闲编号（删掉中间的区域后编号会留空）。**但下发时 `qinglan-compute` 按列表位置重新编成 0…n-1，不用这个 index**（2026-10-18 4*6 实测：画布 0/1/3 → 设备 0/1/2），场景条件里的区域号要按设备编号填，见 [room-device-model.md](room-device-model.md)
- `extra.installArea / installAreaAlias`：安装区域（字典 `RADAR_INSTALL_AREA`）；`fallTime`：跌倒时间
- 可以"复制到剪贴板"：`qinglan:ranges:` + base64(encodeURIComponent(JSON))

### 校验（前端 `validate()` 和后端 `POST /api/device-config/qinglan-validate` 不一样）

| 规则 | 前端 | 后端 |
|---|---|---|
| 除干扰区外，区域不能超出 `bound` | ✓ | ✓ |
| 监护床最多 1 个，且必须在监护区内 | ✓ | ✓ |
| 床位监护模式下，普通床不能压监护区 | ✓ | ✓ |
| 至少一个门（呼吸睡眠模式除外） | ✓ | ✓ |
| 区域之间不能重叠（门/床/家具/感应区都算，**干扰区除外**） | ✗ | ✓ |
| 最多 16 个、index 不重复、安装高度范围 | 编辑器里限制 | **不查**（17 个区域、重复 index、高度 5 m 都返回成功） |

后端报错是英文，例如 `region 【门】 and region 【床2】 overlap`、`contains at least one "gate" area`。

### 换算成设备数组（`POST /api/device-config/qinglan-compute`）

- 输入 qingLanConfig，返回 `{bound: QL_radar_config, areas: QL_radar_area}`，**不做校验**（越界的区域照样算出来）
- 可以在客户端本地复现（运维端 `rooms/qinglan.ts` 的 `toDeviceArrays`）。2026-10-17 核对：李虎、藕塘全部 56 份房间布置逐台和平台一致；另有 80 组随机配置（含小数坐标、存的雷达位置和装法对不上）也全部一致。规则如下：
  1. 以雷达为原点：`dx = X − radar.x`，`dy = Y − radar.y`（容器坐标，cm）。**两处用的雷达位置不一样**：区域按装法规则算雷达位置（顶装在容器正中，侧装在朝向那边的中点，容器尺寸也按规则查表），不看存的 `radar.x/y`；监测边界用存的 `radar.x/y`。数据正常时两者相同；尺寸和装法对不上的旧数据（例如李虎"南京"：顶装朝左却存成 600×400）两者不同，设备上的区域和边界会错开
     - 区域坐标先截成整厘米（`209.6` 按 `209` 算；藕塘 13房有一个门的 y 存成 `210.0104`）
  2. 转到雷达坐标系 (x, y)：顶装 上 `(dx, −dy)`、下 `(−dx, dy)`、右 `(dy, dx)`、左 `(−dy, −dx)`；侧装 上 `(−dx, dy)`、下 `(dx, −dy)`、右 `(−dy, −dx)`、左 `(dy, dx)`。就是前面 `toRoom` 的逆运算
  3. 矩形两角换算后取 x、y 的最小 / 最大，按 X-Y-, X+Y-, X-Y+, X+Y+ 排 4 个角
  4. 除以 10 变分米：**区域向零截断**；**边界用银行家舍入**（.5 取偶，.NET 默认的 Math.Round）；**侧装时边界的近端 y 固定为 0**
  5. `QL_radar_config = [installType, round(installHeight×10), 8 个角, workingType]`；`QL_radar_area` 每项 `[区域编号, type, 8 个角]`，**区域编号 = 在 ranges 里的位置（0…n-1），不是存的 index**。10-17 核对的 56 份布置都没有空号，所以当时没发现；运维端 `toDeviceArrays` 还在用存的 index，有空号时和平台不一致（2026-10-18）
- 坐起测试（…627d）房间配置算出来和设备上的属性记录完全一致

### 下发

- **v3**：房间设计里改完区域只改画布，要点"保存"才写平台（`POST /api/room/v3/design`）。下发是区域信息面板里另外一个"下发区域"按钮：`POST /api/device-property/write`，一次写 4 个属性 `QL_radar_config`（compute 的 bound）、`QL_radar_working_type`、`QL_radar_design`（整份 qingLanConfig）、`QL_radar_area`，`saveOnly:false`；结果看 SignalR `DeviceResponse`（set-property）。"读取区域"读回这 4 个属性，用 `QL_radar_design` 还原画布，只有 `QL_radar_area` 时只同步区域类型
- **老版**：设备配置里"下发到设备" = `POST /api/device-config/qinglan-install {deviceId}`（后端自己找当前生效的配置并下发），"读取" = `GET /api/device-config/qinglan-install/read?deviceId=`
- **保存房间设计不会下发**（2026-10-17 在坐起测试 …627d 上实测，测完已恢复原配置）：
  - 原样保存：没有任何下行报文
  - 改了内容再保存（高度 3 → 2.5 m）：没有下行，设备上还是 3 m。但平台**悄悄把属性记录 `QL_radar_config` 的值改成了 2.5 m**（`updatedAt` 更新），`deliveryStatus` 仍是 2（成功）、`deliveryAt` 仍是上一次真正下发的时间。网页端看"存储属性"会以为设备已经是 2.5 m
  - 之后"从设备读取"会把记录改回设备的真实值，这时房间设计（2.5）和记录、设备（3）对不上，没有任何页面提示
- v3"下发区域"（属性写入 4 个属性）：设备只收到一条 `IOT.setproperty {QL_radar_para_config, QL_radar_para_area}`，另外两个是平台属性，只存不发。设备约 0.7 秒回 `code 201`
- 老版 `POST /api/device-config/qinglan-install {deviceId}`：后端用**房间设计（source 2）当前的配置**算好后下发，报文同上（多一个 `time` 字段），返回 `data` = seq。不需要客户端自己算
- 读设备属性偶尔没有应答：同一次实测里有一条 `readproperty` 只有下行、没有上行记录。之前也见过只有上行应答、通信日志里找不到对应下行的情况。所以判断"已同步"不能只依赖一次读取
- 坐起测试 09-29 的通信日志里，18:54:35 户型保存后，18:55 有两次 2 m 的下发，18:57 又有两次 3 m 的下发，每次都间隔约 3 秒成对出现。结合上面的实测，应该是有人手动点了下发
- 设备收到的报文键是 `QL_radar_para_config / QL_radar_para_area`（见上面"雷达属性"一节）

## 楼栋、楼层、房间、床位的增删改（2026-10-19 读平台前端代码 + 在李虎机构用临时楼栋实测，测完已删除）

都是 SDBPage 的通用接口（见"通用 CRUD 页面"），下面只记和通用规则不一样、或者容易出事的地方。

| 资源 | 列表 | 新增 | 修改 | 删除 |
|---|---|---|---|---|
| 楼栋 | `GET /api/building/pages` | `POST /api/building {buildingName（≤32，必填）, buildingNum（≤32）, description}`，返回 id | `PUT /api/building`（整条记录） | `DELETE /api/building?id=&name=楼栋名` |
| 楼层 | `GET /api/floor/pages` | `POST /api/floor {buildingId, floorName（≤32）, floorNumber（-5～99）}` | `PUT /api/floor` | `DELETE /api/floor?id=&name=楼层名` |
| 房间 | `GET /api/room/pages` | `POST /api/room/v3/apply-room-type-on-create`（见"户型和房间的关系"） | `PUT /api/room {id, floorId, roomName, roomTypeId, roomLong, roomWidth, sortOrder}`；尺寸用 `PUT /api/room/v3/size` | `DELETE /api/room?id=&name=房间名` |
| 床位 | `GET /api/bed/pages` | `POST /api/bed {roomId, bedName（≤32）, bedNumber?}`；批量 `POST /api/bed/batch-create {roomId, startBedNumber, endBedNumber}` | `PUT /api/bed {id, roomId, bedName, bedNumber}` | `DELETE /api/bed?id=&name=` |

- **删除是级联的**：删楼栋会删掉它的全部楼层、房间、床位、入住/退住记录，并解绑所有设备；删楼层删它的房间（及以下）；删房间、删床位都会删入住记录、解绑设备。实测删楼栋后楼层、房间、床位都没了
- **删除时的名字校验**：网页端要手输名字，名字作为 `name` 参数发给后端。楼栋、楼层、房间后端会核对，名字不对返回 `data: 0` 不删（房间不带 `name` 报"字段【name】不能为空"）；**床位不核对，名字随便填也会删掉**。客户端删除前要自己确认
- 返回 `data` 是影响条数：`1` 成功，`0` 没删（名字不对或记录不存在），`succeeded` 都是 true
- 唯一性：楼栋名在机构内唯一（409001"楼栋名称…已存在"）；楼层号、楼层名在楼栋内都唯一（重名时报错信息写的也是"物理楼层【n】已存在"，不准）；房间名在楼层内唯一（别的楼层可以重名）；**床位号在楼层内唯一**（"当前楼层床位号【1】已存在"），床位名不查重
- `PUT /api/room/v3/size` 会同时改房间布置里的外框（`roomStyle` 的宽高），房间里的家具、区域不动
- 不填 `floorNumber` 时存成 0；不填 `bedNumber` 时为空，可以重复不填
- 批量建床 `batch-create` 的床位名就是床位号（"2""3"），没有房间前缀；客户端要带前缀的话逐个 `POST /api/bed`
- `GET /api/bed/pages` 直接带 `roomId` 参数不筛选（返回全机构的床），要按房间分组就一次取全部在本地分
- 平台列表里的统计数不可信：楼栋的 `bedCount` 和实际床位数对不上（实测 1 vs 5），要在本地按房间、床位数
- 床位的 `bedStatus`：1 空闲，2 已入住（带 `realName`）；`deviceCount` 绑了几台设备；`rangeId` 关联平面图里的床位槽位
- 建户型：`POST /api/room-type {roomTypeName, roomLong, roomWidth}` 返回 id，不需要设计就能用来建房；户型下拉 `GET /api/room-type/options`。运维端在机构没有"通用"户型时自动建一个
- 楼栋批量 CSV：`POST /api/building/batch-csv {csvContent: "名称,编号,描述\n…"}`，同名的更新，返回 `{createItems, updateItems}`
- 房间 Excel 导入：`/api/room/import?buildingId=`（模板 `/api/room/download`，"楼栋房间床位导入模板"）

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

### 入住、调床、退住、设备关联、亲友（2026-10-19 读平台 `common` 模块 + 在李虎机构用临时楼栋和测试长者实测，测完已删除）

| 接口 | 说明 |
|---|---|
| `PUT /api/member` | 改资料，整条记录带回（`GET /api/member?id=` 只返回有值的字段） |
| `DELETE /api/member?id=&name=姓名` | 把长者从本机构移除（返回 1）。**不核对名字**；长者记录本身还在（按 id 还能取到） |
| `PUT /api/member/bed-adjust {memberId, bedId, description}` | 调床 |
| `PUT /api/member/bed-swap {memberId, swapMemberId, description}` | 两位已入住的长者对调床位 |
| `PUT /api/member/check-out {memberId, checkOutReason, description}` | 退住；原因 1 回家、2 转院、3 死亡、4 其他。退住后 `checkType` = 3，可以再办入住 |
| `GET /api/device-position/v3/member-devices?memberId=` | 关联在长者身上的设备 `[{deviceId, sn, deviceName, deviceType}]`。**这一行起的四个 v3 接口只有超管能用**，机构账号用 `/api/member/devices` 和 `/api/device/bind`、`unbind`（见上面"删除设备会连带清掉什么"之后那段） |
| `GET /api/device-position/v3/member-device-candidates?memberId=&keywords=` | 可关联的设备，带 `owners[{memberId, memberName}]`（已归属谁） |
| `PUT /api/device-position/v3/bind-member-device {memberId, deviceId, confirmTransfer}` | 关联设备。一台设备只归属一位长者：已归属别人时报"设备当前归属 X，请确认后再转移关联"，`confirmTransfer: true` 才转过来 |
| `PUT /api/device-position/v3/unbind-member-device {memberId, deviceId}` | 取消关联 |
| `GET /api/device-position/bindable-devices?bedId=&keywords=&deviceType=` | 床位可绑的设备（全机构的，不限房间） |
| `PUT /api/device-position/bind-bed-device {bedId, deviceId}` / `unbind-bed-device {bedId}` | 床位绑设备；一台设备只能绑一张床（"设备已绑定其他床位"） |
| `GET /api/room/radars?roomId=` | 房间里的设备，带 `bedId / bedName`（床位绑定只能从这里或设备记录看到） |
| `GET /api/member/relatives/pages?filter[memberId]=` | 亲友列表 `{memberId, realName, phoneNumber, relationshipType, isAdmin}`（不带 filter 报"请传入用户id"） |
| `POST /api/member/relatives {memberId, realName, phoneNumber, relationshipType, userName?, password?, idNumber?, address?}` | 加亲友，关系字典 `FAMILY_RELATIONS`（1 儿子、2 女儿、15 妻子、16 丈夫、17 朋友、99 养老助理…）。修改时带 `relatedMemberId` |
| `DELETE /api/member/relatives?memberId=&relatedMemberId=` | 解除亲友关系 |

容易出事的地方：

- **长者列表里的床位不可信**：`/api/member/pages` 的楼栋、房间、床位是**办入住时的那张床**，调床、对调之后不更新（实测调了两次还显示第一张床）。以床位一侧为准：`/api/bed/options-with-floor` 的 `memberId`、`/api/bed/pages` 的 `realName / bedStatus`、长者详情的 `bedId` 都是对的
- **调床到有人的床不拦**：A 调到 B 的床返回成功，B 被挤掉——B 还是"已入住"，但床位上已经没有 B，之后和 B 对调报"被对调的用户没有可用的床位"。客户端调床只能选空床，换到有人的床要用对调
- **删除还没退住的长者会在床上留下"幽灵"**：长者从机构里没了，床位仍显示"已入住"和他的名字。客户端要求先退住再删
- **床位解绑设备会连房间绑定一起清掉**：`unbind-bed-device` 之后设备的 `roomId / floorId / buildingId / bedId` 全是空的，即使设备原来就绑在这个房间。绑床位时会把设备的房间改成床位所在的房间（房间布置不动）。客户端解绑床位后要再 `bind-room-device` 把设备放回房间
- 床位绑设备不等于关联长者：床上住着的长者的 `member-devices` 仍为空，两种关联互不影响
- **办入住会自动关联设备，先看床位**（2026-10-21 用临时三人间实测，测完已删除：1 床、2 床各绑一台雷达，另一台只绑房间当卫生间雷达，3 床没绑设备）：
  - 入住的床绑了设备 → **只关联这张床的设备**。1 床的人只拿到床 1 雷达，2 床的人只拿到床 2 雷达，卫生间雷达谁都没关联
  - 入住的床没绑设备 → 关联房间里**没绑床位的设备**。3 床的人拿到卫生间雷达，拿不到 1、2 床的雷达
  - 所以套房（床位雷达 + 卫生间雷达，住一人）里卫生间雷达不会自动关联给他；多张床都绑了雷达时，公共区域的雷达没人关联
  - 之前（10-19）记的"同一房间住两个人，设备同时关联两个人"是床上都没绑设备的情况：两人都拿到房间里没绑床的设备（`v2/device-members` 返回两位）。手动 `bind-member-device` 才有"一台设备只归属一位"的限制，转过来后只剩一位
- **调床、对调只在新旧两张床都绑了设备时才改关联**（2026-10-21 用两间临时房实测，测完已删除。房 1：1、2 床各绑雷达，3 床没绑，另有一台只绑房间；房 2：4 床绑雷达，5 床没绑，另有一台只绑房间）：
  - 有设备的床 → 有设备的床（同房间 1→2 床、跨房间对调 2 床↔4 床）：旧床的设备换成新床的设备
  - 没设备的床 → 没设备的床（3 床→另一间的 5 床）：不变，还挂着旧房间只绑房间的那台，拿不到新房间那台
  - 没设备的床 → 有设备的床（5→1 床）：不变，拿不到 1 床的雷达
  - 有设备的床 → 没设备的床（2→3 床）、一边有一边没有的对调：不变，还挂着旧床的雷达
- **退住只去掉"当前床位的设备 + 当前房间只绑房间的设备"**：调床留下的旧关联（别的床、别的房间的设备）退住后还在，设备的数据和告警继续算在已退住的人头上。10-19 记的"手动转过来的关联也一起去掉"是那台设备正好在他当前房间
- **关联只有入住能"追加"**：`POST /api/device/bind` 是替换（原来的一位被换掉，只剩新的一位；主表 `memberId`、`device/members`、`v2/device-members`、长者的 `member/devices` 都跟着换；原来有多位时没测），`memberIds` 数组之类的写法报"字段【MemberId】不能为空"；入住是追加（手动关联给 B 的设备，A 入住后变成 A、B 两位）。`POST /api/device/unbind` 只去掉指定的那位，其他人保留。平台前端给雷达类设备的"查看关联用户"标了 `allowMultiple: true`，但后端照样替换
- **运维端按床位整理关联**（`apps/ops/src/members/deviceSync.ts`，2026-10-21 用三间临时房走了入住、调床、对调、退住，测完已删除）：床位上的设备只关联床上的人；只绑房间的设备在房间只住一人时关联他，住两人以上不关联（公共区域分不出是谁，和平台多张床都绑了雷达时一样）。入住、调床、对调、退住、床位绑 / 解绑设备、设备换房间之后，把涉及的房间（新旧床位所在的房间 + 这几位长者现在关联的设备所在的房间）整理一遍，多的 `unbind`、少的 `bind`；不在房间里的设备不动。长者页手动关联的候选里不再列装在房间里的雷达
- 平台前端另有 `GET /api/device/members?deviceId=&includeMainTableMember=true`（设备的关联用户，带设备主表上的那位），实测和 `v2/device-members` 一致
- 删除长者后，他和亲友的关系还在（亲友列表里仍能取到），亲友那条记录也还在
- **亲友也是长者记录**：加亲友会在本机构建一条"已登记"的长者（按手机号识别，和建档一样），所以长者列表里混着亲友。解除关系后那条记录还留着，要另外删
- 入住时长者已入住会报"已入住不能重复办理"
