import type { ReactNode } from "react";
import {
  AlertOutlined,
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  BookOutlined,
  CalendarOutlined,
  CameraOutlined,
  CloudOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  FolderOutlined,
  FundProjectionScreenOutlined,
  GlobalOutlined,
  HddOutlined,
  HeartOutlined,
  HomeOutlined,
  IdcardOutlined,
  LineChartOutlined,
  LinkOutlined,
  MedicineBoxOutlined,
  MenuOutlined,
  MessageOutlined,
  MobileOutlined,
  NotificationOutlined,
  PhoneOutlined,
  PieChartOutlined,
  SafetyOutlined,
  ScheduleOutlined,
  SettingOutlined,
  ShopOutlined,
  SolutionOutlined,
  TagsOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  VideoCameraOutlined,
  WifiOutlined,
} from "@ant-design/icons";
import { MODULES } from "./modules";
import { isLink, useNames, type ItemKey } from "./names";

/** 客户端内置的图标库（统一的线性风格），菜单设置里给模块换图标时从这里选；名字存进本机设置，别改 */
export const BUILTIN_ICONS: Record<string, ReactNode> = {
  monitor: <FundProjectionScreenOutlined />,
  device: <HddOutlined />,
  home: <HomeOutlined />,
  team: <TeamOutlined />,
  solution: <SolutionOutlined />,
  user: <UserOutlined />,
  idcard: <IdcardOutlined />,
  alert: <AlertOutlined />,
  bell: <BellOutlined />,
  tags: <TagsOutlined />,
  deploy: <DeploymentUnitOutlined />,
  medicine: <MedicineBoxOutlined />,
  heart: <HeartOutlined />,
  safety: <SafetyOutlined />,
  dashboard: <DashboardOutlined />,
  bar: <BarChartOutlined />,
  line: <LineChartOutlined />,
  pie: <PieChartOutlined />,
  database: <DatabaseOutlined />,
  file: <FileTextOutlined />,
  folder: <FolderOutlined />,
  book: <BookOutlined />,
  audit: <AuditOutlined />,
  calendar: <CalendarOutlined />,
  schedule: <ScheduleOutlined />,
  phone: <PhoneOutlined />,
  mobile: <MobileOutlined />,
  message: <MessageOutlined />,
  service: <CustomerServiceOutlined />,
  notification: <NotificationOutlined />,
  camera: <CameraOutlined />,
  video: <VideoCameraOutlined />,
  environment: <EnvironmentOutlined />,
  wifi: <WifiOutlined />,
  cloud: <CloudOutlined />,
  api: <ApiOutlined />,
  global: <GlobalOutlined />,
  link: <LinkOutlined />,
  shop: <ShopOutlined />,
  tool: <ToolOutlined />,
  setting: <SettingOutlined />,
  menu: <MenuOutlined />,
  apps: <AppstoreOutlined />,
};

/** 链接模块默认的图标和颜色 */
const LINK_STYLE = { icon: <GlobalOutlined />, tint: "#EAF4FF", color: "#1F6FD1" };

/** 模块方块上图标的底色 / 图标色：内置模块用各自的，链接模块统一 */
export function itemStyle(k: ItemKey) {
  return isLink(k) ? LINK_STYLE : MODULES[k];
}

/** 模块现在的图标：上传的图片 > 选的内置图标 > 默认图标 */
export function ItemIcon({ k }: { k: ItemKey }) {
  const c = useNames().icon(k);
  if (c && "image" in c) return <img className="item-icon-img" src={c.image} alt="" draggable={false} />;
  if (c && BUILTIN_ICONS[c.builtin]) return <>{BUILTIN_ICONS[c.builtin]}</>;
  return <>{itemStyle(k).icon}</>;
}

/** 上传的图片缩成 64×64 的 PNG（保持比例、居中），存在本机设置里不占太多地方 */
export function shrinkImage(file: File, size = 64): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = size;
      const ctx = cv.getContext("2d")!;
      const r = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
      const w = (img.naturalWidth || size) * r;
      const h = (img.naturalHeight || size) * r;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读不出来"));
    };
    img.src = url;
  });
}
