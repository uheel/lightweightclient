import type { ReactNode } from "react";
import { AlertOutlined, DashboardOutlined, DeploymentUnitOutlined, FundProjectionScreenOutlined, HddOutlined, HomeOutlined, MedicineBoxOutlined, MenuOutlined, SolutionOutlined, NotificationOutlined, SettingOutlined, TagsOutlined, TeamOutlined } from "@ant-design/icons";
import type { NavKey } from "../guide/steps";

/** 工作台上的模块。"monitor" 不开标签，而是打开全屏的监控模式 */
export type ModuleKey = NavKey | "monitor";

export interface ModuleDef {
  key: ModuleKey;
  /** 方块和标签上的名字 */
  label: string;
  icon: ReactNode;
  desc: string;
  /** 图标底色 / 图标色 */
  tint: string;
  color: string;
}

export const MODULES: Record<ModuleKey, ModuleDef> = {
  monitor: { key: "monitor", label: "实时监控", icon: <FundProjectionScreenOutlined />, desc: "全屏值守：房间状态与告警", tint: "#EEF1FF", color: "#3B4FD8" },
  alerts: { key: "alerts", label: "告警记录", icon: <AlertOutlined />, desc: "查询与处理告警", tint: "#FDECEC", color: "#C93A3A" },
  processTypes: { key: "processTypes", label: "处理类型", icon: <TagsOutlined />, desc: "处理告警时可选的类型", tint: "#FDECEC", color: "#C93A3A" },
  devices: { key: "devices", label: "设备管理", icon: <HddOutlined />, desc: "添加、配置、安装校准", tint: "#EEF1FF", color: "#3B4FD8" },
  spaces: { key: "spaces", label: "楼宇管理", icon: <HomeOutlined />, desc: "楼栋、楼层、房间与床位", tint: "#E8F6EE", color: "#17794A" },
  scenes: { key: "scenes", label: "批量告警", icon: <DeploymentUnitOutlined />, desc: "按场景批量配置设备", tint: "#F3ECFD", color: "#7B4BD6" },
  members: { key: "members", label: "长者档案", icon: <TeamOutlined />, desc: "长者信息、入住与床位", tint: "#FFF4E0", color: "#9A5B00" },
  caregivers: { key: "caregivers", label: "护理班组", icon: <SolutionOutlined />, desc: "护理员、护理组与负责的设备", tint: "#FFF4E0", color: "#9A5B00" },
  rooms: { key: "rooms", label: "房间诊断", icon: <MedicineBoxOutlined />, desc: "逐间检查布置与设备", tint: "#E6F3F7", color: "#1E83A3" },
  settings: { key: "settings", label: "系统设置", icon: <SettingOutlined />, desc: "告警弹窗、推送到护工手表", tint: "#F1F2F7", color: "#5B6078" },
  menus: { key: "menus", label: "菜单设置", icon: <MenuOutlined />, desc: "工作台类别和模块的名字、顺序、隐藏", tint: "#F1F2F7", color: "#5B6078" },
  dataWall: { key: "dataWall", label: "数据魔墙", icon: <DashboardOutlined />, desc: "开发中", tint: "#E7F6F3", color: "#0F8A72" },
  realtime: { key: "realtime", label: "实时推送", icon: <NotificationOutlined />, desc: "平台推送消息（调试用）", tint: "#F1F2F7", color: "#5B6078" },
};

export type GroupKey = "duty" | "dashboard" | "deploy" | "debug" | "alarm" | "system";

/** 工作台的分组（类别）和顺序；key 用来存自定义名字，别改 */
export const GROUPS: { key: GroupKey; title: string; keys: ModuleKey[] }[] = [
  { key: "duty", title: "日常值守", keys: ["monitor"] },
  { key: "deploy", title: "基础管理", keys: ["devices", "spaces", "members", "caregivers"] },
  { key: "alarm", title: "告警管理", keys: ["scenes", "alerts", "processTypes"] },
  { key: "dashboard", title: "数据看板", keys: ["dataWall"] },
  { key: "debug", title: "排查与诊断", keys: ["rooms", "realtime"] },
  { key: "system", title: "系统管理", keys: ["settings", "menus"] },
];
