import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { PlusOutlined, ReloadOutlined, SearchOutlined, TeamOutlined, UploadOutlined } from "@ant-design/icons";
import { perfTimer } from "@radar/core";
import { deleteMember, getAllBeds, getCodes, getMembers, type Bed, type MemberRow } from "../api/member";
import ImportView from "../members/ImportView";
import MemberDetail, { memberState, STATE_TEXT, type MemberState } from "../members/MemberDetail";
import { BedDialog, CheckOutDialog, MemberFormDialog, SwapDialog, type MemberDicts } from "../members/dialogs";
import { useGuide } from "../guide/GuideContext";
import { GuideEmpty } from "../guide/GuideEmpty";
import { ModuleName } from "../workspace/ModuleName";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const byName = (a: string, b: string) => a.localeCompare(b, "zh-CN", { numeric: true });
const GENDER: Record<number, string> = { 1: "男", 2: "女" };

type Filter = "all" | MemberState;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "in", label: "已入住" },
  { key: "registered", label: "未入住" },
  { key: "out", label: "已退住" },
];

/**
 * 长者：左边列表，右边资料、入住（办入住 / 调床 / 对调 / 退住）、关联设备、亲友；批量导入是这一页的一个视图。
 * 进页面一次取回长者和全部床位，筛选、搜索、入住状态都在本地算。入住位置以床位一侧为准（平台长者列表里的床位调床后不更新）。
 */
export default function MembersPage() {
  const { message, modal } = App.useApp();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [dicts, setDicts] = useState<MemberDicts>({ idTypes: [], memberTypes: [], relations: [] });
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string>();
  const [form, setForm] = useState<{ memberId?: string }>();
  const [bedDlg, setBedDlg] = useState<{ kind: "check-in" | "adjust"; member: MemberRow; current?: Bed }>();
  const [swapFor, setSwapFor] = useState<MemberRow>();
  const [outFor, setOutFor] = useState<MemberRow>();
  const seq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      if (!quiet) setLoading(true);
      const pt = perfTimer("长者");
      try {
        const [m, b] = await Promise.all([getMembers(), getAllBeds()]);
        if (my !== seq.current) return;
        setMembers(m);
        setBeds(b);
        pt.info("members", m.length);
        pt.info("beds", b.length);
        pt.endAfterPaint();
      } catch (e) {
        message.error(`加载失败：${errText(e)}`);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    load();
    Promise.all([getCodes("ID_TYPE"), getCodes("HEALTH_STATUS"), getCodes("FAMILY_RELATIONS")]).then(
      ([idTypes, memberTypes, relations]) => setDicts({ idTypes, memberTypes, relations: relations.sort((a, b) => Number(a.value) - Number(b.value)) }),
      () => {},
    );
  }, [load]);

  const bedOfMember = useMemo(() => new Map(beds.filter((b) => b.memberId).map((b) => [b.memberId!, b])), [beds]);
  const bedOf = useCallback((id: string) => bedOfMember.get(id), [bedOfMember]);
  const states = useMemo(() => new Map(members.map((m) => [m.id, memberState(m, bedOfMember.get(m.id))])), [members, bedOfMember]);
  const lost = useMemo(() => members.filter((m) => states.get(m.id) === "lost").length, [members, states]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: members.length, in: 0, registered: 0, out: 0, lost: 0 };
    for (const s of states.values()) c[s]++;
    return c;
  }, [members, states]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return members
      .filter((m) => filter === "all" || states.get(m.id) === filter)
      .filter((m) => {
        if (!kw) return true;
        const b = bedOfMember.get(m.id);
        return [m.realName, m.phoneNumber, b?.roomName, b?.bedName, b?.building].some((v) => v?.toLowerCase().includes(kw));
      })
      .sort((a, b) => byName(a.realName, b.realName));
  }, [members, filter, q, states, bedOfMember]);

  const sel = selId ? members.find((m) => m.id === selId) : undefined;
  const checkedIn = useMemo(() => members.filter((m) => bedOfMember.has(m.id)), [members, bedOfMember]);

  function pick(id: string) {
    setSelId(id);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = shown.findIndex((m) => m.id === selId);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) pick(next.id);
  }

  const guide = useGuide();
  /** 写操作之后：静默重取长者和床位，快速开始清单跟着重新检查 */
  const refresh = () => {
    load(true);
    guide?.refresh(true);
  };

  function askDelete(m: MemberRow) {
    modal.confirm({
      title: `把"${m.realName}"从本机构删除？`,
      content: "长者从本机构的列表里移除，平台上不能恢复。他的亲友记录不会一起删，需要的话另外删。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteMember(m.id, m.realName);
          message.success("已删除");
          setSelId(undefined);
          setMembers((list) => list.filter((x) => x.id !== m.id));
        } catch (e) {
          message.error(`删除失败：${errText(e)}`);
        }
      },
    });
  }

  if (importing)
    return (
      <ImportView
        onBack={(changed) => {
          setImporting(false);
          if (changed) refresh();
        }}
      />
    );

  return (
    <div className="workbench">
      <section className="dev-list" onKeyDown={onKeyDown}>
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1><ModuleName k="members" /></h1>
            <span className="muted">
              {members.length} 位 · {counts.in} 位入住
            </span>
            <Button type="text" icon={<ReloadOutlined />} onClick={() => load()} title="刷新" style={{ marginLeft: "auto" }} />
          </div>
          <div className="mem-actions">
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setForm({})}>
              新建
            </Button>
            <Button size="small" icon={<UploadOutlined />} onClick={() => setImporting(true)}>
              批量导入
            </Button>
          </div>
          <Input allowClear prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />} placeholder="姓名 / 手机号 / 房间 / 床位" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            {FILTERS.map((f) => (
              <button key={f.key} className={f.key === filter ? "on" : ""} onClick={() => setFilter(f.key)}>
                {f.label} <b>{counts[f.key]}</b>
              </button>
            ))}
          </div>
          {lost > 0 && (
            <button className={`mem-lost${filter === "lost" ? " on" : ""}`} onClick={() => setFilter(filter === "lost" ? "all" : "lost")}>
              {lost} 位平台记着已入住、但床上没有他，点这里查看
            </button>
          )}
        </div>
        <div className="dev-rows" ref={listRef} tabIndex={0} role="listbox" aria-label="长者">
          {loading && !members.length ? (
            <Spin style={{ margin: 40 }} />
          ) : shown.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有符合条件的长者" />
          ) : (
            shown.map((m) => {
              const b = bedOfMember.get(m.id);
              const s = states.get(m.id)!;
              return (
                <div key={m.id} data-id={m.id} role="option" aria-selected={m.id === selId} className={`dev-row${m.id === selId ? " on" : ""}`} onClick={() => pick(m.id)}>
                  <span className="dev-row-main">
                    <b>{m.realName}</b>
                    <small>{[m.gender ? GENDER[m.gender] : undefined, m.age ? `${m.age} 岁` : undefined, m.phoneNumber].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className={`dev-row-last${s === "in" ? "" : " off"}${s === "lost" ? " err-text" : ""}`}>{b ? `${b.roomName} › ${b.bedName}` : STATE_TEXT[s]}</span>
                </div>
              );
            })
          )}
        </div>
        <div className="dev-list-foot muted">
          显示 {shown.length} / {members.length} · ↑↓ 切换
        </div>
      </section>
      <section className="dev-detail">
        {!loading && !members.length ? (
          <GuideEmpty
            icon={<TeamOutlined />}
            title="录入第一位长者"
            desc="长者入住床位后，雷达的告警和体征才能对应到具体的人。可以逐个新建（顺便选床入住），人多时用 Excel 批量导入。"
            need="spaces"
            needText="楼宇里还没有床位，建议先建楼宇"
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setForm({})}>
              新建长者
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => setImporting(true)}>
              批量导入
            </Button>
          </GuideEmpty>
        ) : sel ? (
          <MemberDetail
            key={sel.id}
            member={sel}
            bed={bedOfMember.get(sel.id)}
            dicts={dicts}
            onEdit={() => setForm({ memberId: sel.id })}
            onCheckIn={() => setBedDlg({ kind: "check-in", member: sel })}
            onAdjust={() => setBedDlg({ kind: "adjust", member: sel, current: bedOfMember.get(sel.id) })}
            onSwap={() => setSwapFor(sel)}
            onCheckOut={() => setOutFor(sel)}
            onDelete={() => askDelete(sel)}
            onChanged={refresh}
          />
        ) : (
          <Empty style={{ marginTop: 120 }} description="选择左侧的长者" />
        )}
      </section>

      <MemberFormDialog
        open={!!form}
        memberId={form?.memberId}
        beds={beds}
        dicts={dicts}
        onClose={() => setForm(undefined)}
        onSaved={(id) => {
          setForm(undefined);
          setSelId(id);
          refresh();
        }}
      />
      <BedDialog
        target={bedDlg}
        beds={beds}
        onClose={() => setBedDlg(undefined)}
        onDone={() => {
          setBedDlg(undefined);
          refresh();
        }}
      />
      <SwapDialog
        member={swapFor}
        others={checkedIn}
        bedOf={bedOf}
        onClose={() => setSwapFor(undefined)}
        onDone={() => {
          setSwapFor(undefined);
          refresh();
        }}
      />
      <CheckOutDialog
        member={outFor}
        bed={outFor && bedOf(outFor.id)}
        onClose={() => setOutFor(undefined)}
        onDone={() => {
          setOutFor(undefined);
          refresh();
        }}
      />
    </div>
  );
}
