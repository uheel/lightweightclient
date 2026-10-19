import { useMemo, useRef, useState } from "react";
import { Alert, App, Button, Progress, Segmented, Space, Steps, Table, Tag, Upload } from "antd";
import type { TableColumnsType } from "antd";
import { ArrowLeftOutlined, DownloadOutlined, InboxOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { session } from "@radar/core";
import { checkIn, createMember, findMemberByPhone, getAllBeds, getCodes, getMember } from "../api/member";
import { applyExisting, bedPath, COLUMNS, headerTitle, parseRows, templateSheets, type Dicts, type ImportRow } from "./importPlan";
import { readTable, saveBlob, writeXlsx } from "./xlsx";
import { pool } from "../scenes/plan";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Result = { status: "waiting" | "running" | "ok" | "warn" | "fail"; text: string };
type View = "all" | "problem" | "ok";

const GENDER: Record<number, string> = { 1: "男", 2: "女" };

/** 读字典和床位（模板和预览都要用） */
async function loadDicts(): Promise<Dicts> {
  const [idTypes, memberTypes, beds] = await Promise.all([getCodes("ID_TYPE"), getCodes("HEALTH_STATUS"), getAllBeds()]);
  const byValue = (a: { value: string }, b: { value: string }) => Number(a.value) - Number(b.value);
  return { idTypes: idTypes.sort(byValue), memberTypes: memberTypes.sort(byValue), beds };
}

/** 批量导入长者：下载模板 → 选文件 → 预览校验 → 建档并入住。onBack 回到长者列表（导入过就刷新） */
export default function ImportView({ onBack }: { onBack: (changed: boolean) => void }) {
  const { message, modal } = App.useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string>();
  const [view, setView] = useState<View>("all");
  const [results, setResults] = useState<Record<number, Result>>({});
  const [running, setRunning] = useState(false);
  const seq = useRef(0);

  async function downloadTemplate() {
    setBusy("正在读取床位和选项…");
    try {
      const dicts = await loadDicts();
      saveBlob(writeXlsx(templateSheets(dicts)), `长者导入模板-${session.get()?.orgName ?? ""}.xlsx`);
    } catch (e) {
      message.error(`生成模板失败：${errText(e)}`);
    } finally {
      setBusy(undefined);
    }
  }

  async function openFile(file: File) {
    const my = ++seq.current;
    setFileName(file.name);
    setRows([]);
    setResults({});
    setParseError(undefined);
    setView("all");
    setStep(1);
    try {
      setBusy("读取文件…");
      const [table, dicts] = await Promise.all([readTable(file), loadDicts()]);
      const { rows, error } = parseRows(table, dicts);
      if (my !== seq.current) return;
      if (error) {
        setParseError(error);
        return;
      }
      // 按手机号查当前机构是否已有档案
      let done = 0;
      const valid = rows.filter((r) => r.data);
      await pool(valid, 6, async (r) => {
        try {
          applyExisting(r, await findMemberByPhone(r.data!.phoneNumber));
        } catch (e) {
          r.warnings.push(`查询已有档案失败：${errText(e)}`);
        }
        done++;
        if (my === seq.current) setBusy(`按手机号核对已有档案 ${done} / ${valid.length}…`);
      });
      if (my === seq.current) setRows(rows);
    } catch (e) {
      if (my === seq.current) setParseError(`读取失败：${errText(e)}`);
    } finally {
      if (my === seq.current) setBusy(undefined);
    }
  }

  const ready = rows.filter((r) => r.data);
  const toCreate = ready.filter((r) => !r.existing);
  const toCheckIn = ready.filter((r) => r.bed);
  const actionable = ready.filter((r) => !r.existing || r.bed);
  const problems = rows.filter((r) => r.errors.length || r.warnings.length);

  const shown = useMemo(
    () => (view === "problem" ? rows.filter((r) => r.errors.length || r.warnings.length) : view === "ok" ? rows.filter((r) => r.data) : rows),
    [rows, view],
  );

  function confirmImport() {
    modal.confirm({
      title: `导入 ${actionable.length} 位长者？`,
      content: (
        <div>
          新建档案 {toCreate.length} 位，办理入住 {toCheckIn.length} 位。
          {rows.length - ready.length > 0 && <div>有错误的 {rows.length - ready.length} 行不导入。</div>}
          <div className="muted small">建档后如需删除，请在平台的长者管理里操作。</div>
        </div>
      ),
      okText: "导入",
      onOk: runImport,
    });
  }

  async function runImport() {
    setRunning(true);
    setStep(2);
    const set = (line: number, r: Result) => setResults((m) => ({ ...m, [line]: r }));
    setResults(Object.fromEntries(actionable.map((r) => [r.line, { status: "waiting", text: "排队中" } as Result])));
    await pool(actionable, 3, async (r) => {
      set(r.line, { status: "running", text: "处理中" });
      let memberId = r.existing?.memberId;
      const notes: string[] = [];
      try {
        if (!memberId) {
          memberId = await createMember(r.data!);
          // 手机号属于别的机构里的长者时，平台返回的是那位长者
          const got = await getMember(memberId);
          if (got && got.realName !== r.data!.realName) {
            set(r.line, { status: "warn", text: `手机号已属于另一位长者"${got.realName}"，未新建，也未办理入住` });
            return;
          }
          notes.push("已建档");
        } else notes.push("已有档案");
        if (r.bed) {
          await checkIn(memberId, r.bed.bedId, r.checkInDate!);
          notes.push(`已入住 ${r.bed.roomName} ${r.bed.bedName}`);
        }
        set(r.line, { status: "ok", text: notes.join("，") });
      } catch (e) {
        set(r.line, { status: "fail", text: `${notes.length ? notes.join("，") + "；" : ""}${r.bed && notes.length ? "入住失败" : "失败"}：${errText(e)}` });
      }
    });
    setRunning(false);
  }

  const counts = useMemo(() => {
    const v = Object.values(results);
    return {
      total: v.length,
      done: v.filter((x) => x.status !== "waiting" && x.status !== "running").length,
      ok: v.filter((x) => x.status === "ok").length,
      warn: v.filter((x) => x.status === "warn").length,
      fail: v.filter((x) => x.status === "fail").length,
    };
  }, [results]);

  function downloadResult() {
    const head = [...COLUMNS.map(headerTitle), "导入结果"];
    const body = rows.map((r) => [
      ...COLUMNS.map((c) => r.raw[c.key]),
      results[r.line]?.text ?? (r.errors.length ? `未导入：${r.errors.join("；")}` : r.existing && !r.bed ? "已有档案，无需处理" : "未导入"),
    ]);
    saveBlob(
      writeXlsx([{ name: "导入结果", header: true, textColumns: true, rows: [head, ...body], widths: [...COLUMNS.map((c) => c.width ?? 12), 40] }]),
      `长者导入结果-${dayjs().format("YYYYMMDD-HHmm")}.xlsx`,
    );
  }

  const cols: TableColumnsType<ImportRow> = [
    { title: "行", dataIndex: "line", width: 52, fixed: "left", render: (v) => <span className="muted">{v}</span> },
    {
      title: "长者",
      width: 170,
      fixed: "left",
      render: (_, r) => (
        <span className="mem-cell">
          <b>{r.raw.realName || <span className="err-text">（无姓名）</span>}</b>
          <small>
            {[r.data?.gender ? GENDER[r.data.gender] : r.raw.gender, r.data?.age ? `${r.data.age} 岁` : r.raw.age, r.data?.phoneNumber ?? r.raw.phoneNumber]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </span>
      ),
    },
    {
      title: "证件",
      width: 190,
      render: (_, r) => (r.raw.idNumber ? <span className="mono">{r.data?.idNumber ?? r.raw.idNumber}</span> : <span className="muted">—</span>),
    },
    {
      title: "入住床位",
      width: 260,
      render: (_, r) =>
        r.bed ? (
          <span className="mem-cell">
            <span>{bedPath(r.bed)}</span>
            <small>入住日期 {r.checkInDate}</small>
          </span>
        ) : r.raw.bed ? (
          <span className="muted">{[r.raw.building, r.raw.floor, r.raw.room, r.raw.bed].filter(Boolean).join(" / ")}</span>
        ) : (
          <span className="muted">只建档</span>
        ),
    },
    {
      title: "检查",
      width: 340,
      render: (_, r) => (
        <div className="mem-msgs">
          {r.errors.map((e) => (
            <span key={e} className="err-text">
              {e}
            </span>
          ))}
          {r.warnings.map((w) => (
            <span key={w} className="warn-text">
              {w}
            </span>
          ))}
          {!r.errors.length && !r.warnings.length && <span className="muted">—</span>}
        </div>
      ),
    },
    {
      title: step === 2 ? "结果" : "将要",
      width: 220,
      render: (_, r) => {
        const s = results[r.line];
        if (s) {
          const color = { waiting: "default", running: "processing", ok: "success", warn: "warning", fail: "error" }[s.status];
          return (
            <span className="mem-result">
              <Tag color={color}>{{ waiting: "排队", running: "处理中", ok: "成功", warn: "未处理", fail: "失败" }[s.status]}</Tag>
              {s.status !== "waiting" && s.status !== "running" && <small>{s.text}</small>}
            </span>
          );
        }
        if (!r.data) return <Tag color="error">不导入</Tag>;
        if (r.existing && !r.bed) return <span className="muted">已有档案，无需处理</span>;
        return (
          <Space size={4}>
            {!r.existing && <Tag color="green">建档</Tag>}
            {r.bed && <Tag color="blue">入住</Tag>}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="page scene-page">
      <div className="page-head">
        <Button icon={<ArrowLeftOutlined />} disabled={running} onClick={() => onBack(Object.keys(results).length > 0)}>
          长者列表
        </Button>
        <h1>批量导入长者</h1>
        <Steps size="small" current={step} style={{ maxWidth: 560 }} items={[{ title: "准备表格" }, { title: "预览检查" }, { title: "导入" }]} />
      </div>

      {step === 0 && (
        <div className="ops-card mem-start">
          <div className="mem-steps">
            <div>
              <h2>1. 下载模板</h2>
              <p className="muted">
                模板里有填写说明和本机构当前的空床位清单。手机号、证件号码列已设为文本，避免 Excel 改成科学计数。
              </p>
              <Button icon={<DownloadOutlined />} loading={busy !== undefined} onClick={downloadTemplate}>
                下载模板
              </Button>
            </div>
            <div>
              <h2>2. 选择填好的文件</h2>
              <p className="muted">支持 .xlsx 和 .csv。导入前会逐行检查并预览，确认后才写入平台。</p>
              <Upload.Dragger
                accept=".xlsx,.csv"
                showUploadList={false}
                beforeUpload={(f) => {
                  openFile(f);
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或把文件拖到这里</p>
              </Upload.Dragger>
            </div>
          </div>
          <Alert
            type="info"
            showIcon
            message="平台按手机号识别长者"
            description="手机号已在本机构登记过的长者不会重复建档，也不会修改已有资料，只在需要时办理入住。手机号属于其他机构的长者时，平台不会新建档案，这一行会标为未处理。"
          />
        </div>
      )}

      {step > 0 && (
        <div className="ops-card">
          <div className="toolbar">
            <Button icon={<ArrowLeftOutlined />} disabled={running} onClick={() => setStep(0)}>
              换文件
            </Button>
            <span className="muted">{fileName}</span>
            {busy ? (
              <span className="muted">{busy}</span>
            ) : step === 1 && rows.length > 0 ? (
              <Space size={16} className="small">
                <span>
                  共 {rows.length} 行，可导入 <b>{ready.length}</b>（建档 {toCreate.length}，入住 {toCheckIn.length}）
                </span>
                {rows.length - ready.length > 0 && <span className="err-text">有错误 {rows.length - ready.length} 行</span>}
              </Space>
            ) : step === 2 ? (
              <span className="mem-progress">
                {running ? `导入中 ${counts.done} / ${counts.total}` : `完成：成功 ${counts.ok}，未处理 ${counts.warn}，失败 ${counts.fail}`}
                <Progress percent={Math.round((counts.done / Math.max(1, counts.total)) * 100)} size="small" showInfo={false} status={counts.fail ? "exception" : undefined} />
              </span>
            ) : null}
            <span className="grow" />
            {rows.length > 0 && (
              <Segmented<View>
                size="small"
                value={view}
                onChange={setView}
                options={[
                  { value: "all", label: `全部 ${rows.length}` },
                  { value: "problem", label: `有问题 ${problems.length}` },
                  { value: "ok", label: `可导入 ${ready.length}` },
                ]}
              />
            )}
            {step === 2 && !running && (
              <Button icon={<DownloadOutlined />} onClick={downloadResult}>
                下载结果
              </Button>
            )}
            {step === 1 && (
              <Button type="primary" icon={<UploadOutlined />} disabled={!!busy || !actionable.length} onClick={confirmImport}>
                导入 {actionable.length} 位
              </Button>
            )}
          </div>
          {parseError ? (
            <Alert type="error" showIcon message={parseError} />
          ) : (
            <Table<ImportRow>
              rowKey="line"
              size="small"
              loading={!!busy}
              columns={cols}
              dataSource={shown}
              pagination={false}
              rowClassName={(r) => (r.errors.length ? "mem-row-err" : "")}
              scroll={{ x: 1230, y: "calc(100vh - 300px)" }}
            />
          )}
        </div>
      )}
    </div>
  );
}
