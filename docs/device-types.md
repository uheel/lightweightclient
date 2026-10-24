# 设备型号对照

`deviceType` 编号和名字的对照。名字来自平台设备类型字典 `GET /api/device-type/types`（2026-10-24 读取）。字典只存英文名，带 `Accept-Language: zh-CN` 等请求头也一样，平台网页端显示的也是这些英文名。"常用叫法"是文档和代码里的叫法。客户端显示型号时直接用字典的 `deviceTypeName`（`getRadarTypes`）。

## 雷达（`groupCode` RADAR）

| deviceType | 字典名 `deviceTypeName` | 简称 `shortName` | 常用叫法 | 区域属性 | 能通话 | 场景模板数 |
|---|---|---|---|---|---|---|
| 6 | AIO Care Terminal | AIO radar | AIO、6 型 | `QL_radar_area` | 是 | 35 |
| 13 | FallSense Terminal | Ultra Fall Detection | UltraFall、Ultra 跌倒、跌倒终端、13 型 | `QL_radar_area` | 否 | 13 |
| 15 | FallSense Calling Terminal | Ulrta Plus（平台原文拼错） | Ultra Plus、15 型 | `QL_radar_area` | 是 | 5 |
| 16 | SRM Respiration and Sleep Monitoring Terminal | SRM Respiration and Sleep Monitoring | SRM 呼吸睡眠 | `QL_radar_area` | 是 | — |
| 12 | SleepSense Terminal | SleepSense Terminal | Ultra 呼吸睡眠、SleepSense | 无 | 否 | 1 |
| 11 | Ultra-Person Detection Terminal | U-Number Detection | Ultra 人数检测 | `radar_area` | 否 | — |
| 14 | AIO Care Terminal | — | 移动爱家款（中国移动 4G），和 6 同名但不是同一种设备，见下 | 无 | 有 SIP 号码，没有 `talk_type_sel` | 0 |
| 1 | FallSense Terminal | — | 老款跌倒终端（和 13 同名） | 无 | 是 | — |
| 2 | Resp & HR AI Terminal | — | 老款呼吸心率终端 | 无 | 是 | 9 |
| 5 | Human body presence monitoring AI terminal | — | 老款人体存在检测终端 | 无 | 是 | — |

- **区域属性**：属性字典 `/api/device-type-property/list?deviceTypeCode=` 里画区域用的属性。客户端只给 6 / 13 / 15 配区域（`rooms/check.ts`），16 字典里也有 `QL_radar_area`，没有真机，没核对。
- **能通话**：属性字典里有没有呼叫方式 `talk_type_sel`，客户端按这个决定显示不显示通话页（`api/device.ts`）。13 型没有，所以告警不能拨紧急号码。
- **场景模板数**：2026-10 统计的平台场景模板数（见 site-analysis"场景模板"），"—"是没有模板。
- 同名的两组：1 和 13 都叫 FallSense Terminal，6 和 14 都叫 AIO Care Terminal，只看名字分不出来，要看 `deviceType`。
- **14 和 6 不是同一种设备**（2026-10-24 核对）：
  - 全平台 14 台，都在"移动爱家"机构，SN 是 15 位 IMEI 样式（`869772080000031`），通信方式都是 2，固件 V1.4.46.B（6 型是 V1.2.x / V1.3.x）
  - 走 slim 协议，topic 带运营商前缀：`sdb/slim/CMCC-592423-{sn}/post/d2s`，约每分钟报一条类型 1（信号强度）；6 型是 `sdb/radar/{sn}/…`
  - 属性 22 个，只有通话相关的几个（音量、紧急 / 快捷号码）和 `QL_radar_design` 跟 6 型同名；其余是 6 型没有的：作息关怀（晚睡 / 晚起 / 离床过久超时和呼叫开关、作息时间段）、跌倒呼叫开关、疑似跌倒判定时长、SIP 服务器 / 号码 / 密码、所属区域 `area`
  - 没有 `QL_radar_area`（不能画区域），没有场景模板，没有升级包
  - 也就是说告警靠设备自己的作息 / 跌倒开关，不走场景。客户端没做 14 型的专门支持
- 13 / 15 是 slim 协议（topic `sdb/slim/{sn}/…`，代码里 `isSlim`），不发心跳；6 是 `sdb/radar/{sn}/…`。

### 各型号已知的差异（详见 site-analysis.md）

- **6 AIO**：收超时类型 / 表达式场景，告警可以设"离开多久"；固件不认场景的 `duration` 字段。
- **13 UltraFall**：不收超时类型场景（set-tact 回 code 100），离床告警只能一离开就告警；久坐用加长记录数实现，最多 10 分钟（每人 600 条记录）；不能拨紧急号码；安装设置只能用属性写入，`qinglan-install` 无效；平台不更新它的场景下发状态。
- **15 Ultra Plus**：属性和场景按 13 型那套处理，大多没有真机核对。

## 其他设备

| deviceType | 字典名 | 分组 |
|---|---|---|
| 3 | AI Care Central Station（管理主机） | SLAVE |
| 1001 | Pull Cord Alarm Button（拉绳按钮） | SLAVE |
| 1002 | Bluetooth speech recognition（蓝牙语音） | SLAVE |
| 1003 | Bluetooth door magnetic（蓝牙门磁） | SLAVE |
| 1004 | Bluetooth smoke sensor（蓝牙烟感） | SLAVE |
| 1005 | Smart Temperature Patch（体温贴） | SLAVE |
| 1101 | Panic button-NB | SLAVE |
| 1102 | Smoke Alarm-NB | SLAVE |
| 1103 | Door Magnetic Sensor-NB | SLAVE |
| 1104 | Combustible gas detection-NB | SLAVE |
| 1105 | Water Immersion Sensor-NB | SLAVE |
| 1201 | Emergency Button-CAT1 | SLAVE |
| 200 | BSJ-Alarm Disk | SLAVE |
| 201 | BSJ-Keychain | SLAVE |
| 100 | Smart Watch | WATCH |
| 101 | BSJ Knot Watch | WATCH |
| 102 | Smart Caregiver Watch | WATCH |
| 110 | GT3-S | WATCH |
| 111 | GT3 | WATCH |
| 112 | MF1 | WATCH |
| 113 | MF3 | WATCH |
| 115 | MF12-VP21 | WATCH |
| 116 | S6E-1 | WATCH |
| 117 | Monitoring watch（B29） | WATCH |
| 1008 | Smart Health Ring（戒指） | RING |
| 1009 | AI Gait Analysis System（步态分析） | GAIT |
| 21 | Intelligent health all-in-one machine（健康一体机） | OTHER |
| 8000 | Bluetooth scanning（蓝牙扫描） | OTHER |
