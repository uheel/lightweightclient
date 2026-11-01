import { api } from "@radar/core";

/**
 * 步态分析（平台菜单 步态分析）：步态传感器、用户、采集记录、报告、健康评估。
 * 列表一次取完，筛选、搜索、统计都在客户端算。见 docs/site-analysis.md"步态分析"。
 */

export interface GaitSensor {
  id: string;
  sn: string;
  deviceName: string;
  /** 平台叫 Mac，苹果手机绑的是 UUID，不能当 MAC 用 */
  identifier?: string;
  orgId?: string;
  orgName?: string;
  isOnline?: boolean;
  lastActivityTime?: string;
  battery?: number;
  rssi?: number;
  datasetCount?: number;
  memberId?: string;
  realName?: string;
  sortOrder?: number;
  description?: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

export interface SensorForm {
  id?: string;
  deviceName: string;
  sn: string;
  sortOrder?: number;
  description?: string;
}

export async function getGaitSensors() {
  return (await api.getAll<GaitSensor>("/api/device-gait-sensor/pages", { pageSize: 500, max: 5000 })).data ?? [];
}

export async function createGaitSensor(f: SensorForm) {
  await api.post("/api/device-gait-sensor", f);
}

/** 修改要带上详情里的其他字段（identifier 等），平台的 PUT 不保证合并 */
export async function updateGaitSensor(f: SensorForm & { id: string }) {
  const cur = (await api.get<Record<string, unknown>>("/api/device-gait-sensor", { params: { id: f.id } })).data ?? {};
  await api.put("/api/device-gait-sensor", { ...cur, ...f });
}

export async function deleteGaitSensor(id: string) {
  await api.del("/api/device-gait-sensor", { params: { id } });
}

export async function bindGaitSensor(deviceId: string, memberId: string) {
  await api.post("/api/device-gait-sensor/bind", { deviceId, memberId });
}

export async function unbindGaitSensor(deviceId: string, memberId?: string) {
  await api.post("/api/device-gait-sensor/unbind", { deviceId, memberId });
}

export interface BindOption {
  memberId: string;
  realName: string;
  gender?: number;
  age?: number;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  bedName?: string;
}

/** 可绑定的用户：传感器所在机构的（超管在平台机构下能看到别的机构的传感器） */
export async function getBindOptions(orgId?: string) {
  return (await api.get<BindOption[]>("/api/member/checked-in-options", { params: { orgId } })).data ?? [];
}

/** 设备真实的最后活动时间，比列表里的新几分钟（网页端鼠标放到心跳图标上时取） */
export async function getActivityTime(sn: string) {
  return (await api.get<string>("/api/device/activity-time", { params: { sn } })).data || undefined;
}

export interface SensorStatusRow {
  role?: string;
  uptime?: string | number;
  battery?: number;
  voltage?: number;
  status?: string | number;
  phoneRssi?: number;
  masterRssi?: number;
  slaveRssi?: number;
  version?: string;
  slaveMac?: string;
  createdAt?: string;
}

/** 最近的设备状态。记录可能很多，只取最新一页 */
export async function getSensorStatus(deviceId: string) {
  const r = await api.get<SensorStatusRow[]>("/api/gait-sensor-data/pages", { params: { deviceId, current: 1, pageSize: 200 } });
  return { rows: r.data ?? [], total: r.total ?? 0 };
}

export interface SensorFallRow {
  createdAt?: string;
  deviceTime?: string;
  /** 0 未知，1 跌倒，2 疑似跌倒 */
  type?: number;
}

export async function getSensorFalls(deviceId: string) {
  return (await api.getAll<SensorFallRow>("/api/gait-data/fall-data/pages", { params: { deviceId }, pageSize: 200, max: 2000 })).data ?? [];
}

// ---------- 用户 ----------

export interface GaitMember {
  id: string;
  realName: string;
  gender?: number;
  age?: number;
  height?: number;
  weight?: number;
  phoneNumber?: string;
  orgName?: string;
  deviceCount?: number;
  checkType?: number;
  createdAt?: string;
}

export async function getGaitMembers() {
  return (await api.getAll<GaitMember>("/api/v3/gait-analysis/members", { pageSize: 500, max: 20_000 })).data ?? [];
}

// ---------- 采集记录 ----------

export interface GaitSegment {
  id: string;
  title?: string;
  deviceId?: string;
  deviceName?: string;
  sn?: string;
  memberId?: string;
  memberName?: string;
  /** 秒 */
  duration?: number;
  /** 1 低，2 中，3 高；还没评估的记录没有 */
  fallRiskType?: number;
  fallRiskTypeDsp?: string;
  fallRiskScore?: number;
  fallRiskModelName?: string;
  fallRiskModelCode?: string;
  createdAt?: string;
}

export async function getGaitSegments() {
  return (await api.getAll<GaitSegment>("/api/metric-segment/pages", { pageSize: 500, max: 50_000 })).data ?? [];
}

export interface SegmentMember {
  memberId: string;
  realName?: string;
  gender?: number;
  age?: number;
  segmentCount?: number;
  lastCreatedAt?: string;
}

/** 有采集记录的用户：列表里只有名字，这里补性别、年龄 */
export async function getSegmentMembers() {
  return (await api.get<SegmentMember[]>("/api/metric-segment/members")).data ?? [];
}

export async function deleteSegment(id: string) {
  await api.del("/api/metric-segment", { params: { id } });
}

/** 按用户现在的资料和模型重新计算报告 */
export async function regenerateSegment(memberId: string | undefined, segmentId: string) {
  await api.post("/api/gait-metric/update/segment", { memberId, segmentId });
}

export async function getGaitReport(segmentId: string) {
  return (await api.get<GaitReport>("/api/v3/gait-metric/report", { params: { segmentId } })).data;
}

export type Range = { min: number; max: number };
export type ByFoot = { left?: number; right?: number; average?: number };

/** /api/v3/gait-metric/report。评分、风险、AI 建议由平台算，偏高偏低和对称性在客户端算（见 gait/reportModel.ts） */
export interface GaitReport {
  id: string;
  title?: string;
  realName?: string;
  gender?: number;
  age?: number;
  height?: number;
  weight?: number;
  createdAt?: string;
  /** pending 生成中，empty 没结论，failed 失败 */
  aiAnalysisStatus?: string;
  aiAnalysisDeadlineAt?: string;
  fallRiskScore?: number;
  fallRiskType?: number;
  fallRiskTypeDsp?: string;
  gaitAnalysisResponse?: { analysis?: string[]; score?: number };
  /** km/h */
  stepSpeed?: number;
  stepCount?: number;
  stepHeight?: number;
  strideFrequency?: number;
  strideLength?: number;
  strideTime?: number;
  stepSymmetry?: number;
  supportPhaseRatio?: number;
  swingPhaseRatio?: number;
  doubleFootSupportTime?: number;
  double_support_ratio?: number;
  stepCountByFoot?: ByFoot;
  stepHeightByFoot?: ByFoot;
  strideLengthByFoot?: ByFoot;
  strideTimeByFoot?: ByFoot;
  supportPhaseRatioByFoot?: ByFoot;
  swingPhaseRatioByFoot?: ByFoot;
  impactForceNByFoot?: ByFoot;
  propulsiveForceNByFoot?: ByFoot;
  stepAngleByFoot?: ByFoot;
  rotationByFoot?: ByFoot;
  swingByFoot?: ByFoot;
  referenceStandard?: {
    minHeight?: number;
    maxHeight?: number;
    /** km/h */
    stepSpeed?: Range;
    strideFrequencyStepsPerMinute?: Range;
    stepSymmetryPercent?: Range;
    stepHeightCm?: Range;
    strideLengthCm?: Range;
    strideTimeSeconds?: Range;
    supportPhasePercent?: Range;
    swingPhasePercent?: Range;
    doubleSupportPercent?: Range;
    impactForceN?: Range;
    propulsiveForceN?: Range;
    stepAngleDegrees?: Range;
    rotationDegrees?: Range;
    swingCm?: Range;
  };
}

// ---------- 健康评估 ----------

export interface ScaleBrief {
  id: string;
  scaleName: string;
  category?: string;
  description?: string;
  questionCount?: number;
  assessmentCount?: number;
}

export interface AssessPanel {
  member?: { id: string; realName?: string; age?: number; gender?: number; currentRiskType?: number; currentRiskLevelName?: string };
  scales?: ScaleBrief[];
}

export async function getAssessPanel(memberId: string) {
  return (await api.get<AssessPanel>("/api/gait-assessment-scale/web/member-panel", { params: { memberId } })).data ?? {};
}

export interface ScaleQuestion {
  title: string;
  options?: { label?: string; text?: string; score?: number }[];
}

export async function getScale(id: string) {
  return (await api.get<{ id: string; scaleName: string; description?: string; questions?: ScaleQuestion[] }>("/api/gait-assessment-scale", { params: { id } })).data;
}

export interface AssessRecord {
  id?: string;
  scaleName?: string;
  realName?: string;
  age?: number;
  gender?: number;
  totalScore?: number;
  riskType?: number;
  riskLevelName?: string;
  assessmentTime?: string;
  healthAdvice?: string;
  answers?: { questionTitle?: string; questionIndex?: number; optionLabel?: string; optionText?: string; optionIndex?: number; score?: number }[];
}

export async function getAssessRecords(memberId: string, scaleId: string) {
  return (await api.getAll<AssessRecord>("/api/gait-assessment-record/web/member-pages", { params: { memberId, scaleId }, pageSize: 100, max: 2000 })).data ?? [];
}

export async function getAssessRecord(id: string) {
  return (await api.get<AssessRecord>("/api/gait-assessment-record", { params: { id } })).data;
}

export async function submitAssess(memberId: string, scaleId: string, answers: number[]) {
  const body = { memberId, scaleId, answers: answers.map((optionIndex, questionIndex) => ({ questionIndex, optionIndex })) };
  return (await api.post<AssessRecord>("/api/gait-assessment-record/web/submit", body)).data;
}
