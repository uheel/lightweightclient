import { api } from "@radar/core";

/** 运维端专用：设备相关接口 */

export interface Device {
  id: string;
  deviceName: string;
  sn: string;
  deviceType?: number;
  deviceTypeCode?: number;
  deviceTypeName?: string;
  orgId: string;
  orgName: string;
  communicationType?: number;
  isDisabled: boolean;
  isOnline: boolean;
  peripheralCount?: number;
  firmwareVersion?: string;
}

export interface DeviceQuery {
  current: number;
  pageSize: number;
  deviceName?: string;
  sn?: string;
  isOnline?: boolean;
}

export async function getDevicePages(q: DeviceQuery) {
  const { current, pageSize, ...filter } = q;
  const res = await api.get<Device[]>("/api/device/v4/management-pages", { params: { current, pageSize }, filter });
  return { list: res.data ?? [], total: res.total ?? 0 };
}

export interface DeviceStatistics {
  totalCount: number;
  onlineCount: number;
  offlineCount: number;
}

export async function getDeviceStatistics() {
  return (await api.get<DeviceStatistics>("/api/device/v4/management-statistics")).data;
}

export interface DeviceType {
  deviceType?: number;
  deviceTypeCode?: number;
  deviceTypeName?: string;
  name?: string;
  groupCode?: string;
}

/** 设备类型字典：编号 → 名称 */
export async function getDeviceTypeMap() {
  const list = (await api.get<DeviceType[]>("/api/device-type/types")).data ?? [];
  const map = new Map<number, string>();
  for (const t of list) {
    const code = t.deviceTypeCode ?? t.deviceType;
    const name = t.deviceTypeName ?? t.name;
    if (code !== undefined && name) map.set(code, name);
  }
  return map;
}
