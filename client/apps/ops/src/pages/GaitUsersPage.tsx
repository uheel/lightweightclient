import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Empty, Input, Spin } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ProfileOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { hasPermission, perfTimer, session } from "@radar/core";
import { getGaitMembers, getSegmentMembers, type GaitMember, type SegmentMember } from "../api/gait";
import { deleteMember, getAllBeds, getCodes, type Bed } from "../api/member";
import { Assessment } from "../gait/Assessment";
import "../gait/gait.css";
import { MemberFormDialog, type MemberDicts } from "../members/dialogs";
import { moduleAllowed } from "../workspace/modules";
import { ModuleName } from "../workspace/ModuleName";
import { useRefreshOn, type Topic } from "../workspace/dataChange";
import type { RecordFocus } from "./GaitRecordsPage";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const GENDER: Record<number, string> = { 1: "男", 2: "女" };
const REFRESH_ON: Topic[] = ["member", "gait"];

/**
 * 步态的用户管理：和长者档案是同一批人（增删改都走 /api/member），这里改了长者档案也会变。
 * 列表和每人的采集次数各取一次，搜索、统计在本地算；表单复用长者档案的，床位打开表单时才取。
 */
export default function GaitUsersPage({ onOpenRecords }: { onOpenRecords: (f: Omit<RecordFocus, "seq">) => void }) {
  const { message, modal } = App.useApp();
  const s = session.get();
  const can = (a: "add" | "update" | "delete") => !!s && hasPermission(s, `GAIT_MEMBER_USER:${a}`);
  const [members, setMembers] = useState<GaitMember[]>([]);
  const [stats, setStats] = useState<Map<string, SegmentMember>>(new Map());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string>();
  const [form, setForm] = useState<{ memberId?: string }>();
  const [beds, setBeds] = useState<Bed[]>([]);
  const [dicts, setDicts] = useState<MemberDicts>({ idTypes: [], memberTypes: [], relations: [] });
  const formData = useRef(false);
  const seq = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const my = ++seq.current;
      if (!quiet) setLoading(true);
      const pt = perfTimer("步态用户");
      try {
        const [m, st] = await Promise.all([getGaitMembers(), getSegmentMembers().catch(() => [] as SegmentMember[])]);
        if (my !== seq.current) return;
        setMembers(m);
        setStats(new Map(st.map((x) => [x.memberId, x])));
        pt.info("members", m.length);
        pt.endAfterPaint();
      } catch (e) {
        message.error(`加载失败：${errText(e)}`);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [message],
  );
  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    load();
  }, [load]);
  useRefreshOn(REFRESH_ON, refresh);

  function openForm(memberId?: string) {
    setForm({ memberId });
    if (formData.current) return;
    formData.current = true;
    getAllBeds().then(setBeds, () => {});
    Promise.all([getCodes("ID_TYPE"), getCodes("HEALTH_STATUS"), getCodes("FAMILY_RELATIONS")]).then(
      ([idTypes, memberTypes, relations]) => setDicts({ idTypes, memberTypes, relations }),
      () => {},
    );
  }

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return !k ? members : members.filter((m) => [m.realName, m.phoneNumber, m.orgName].some((v) => v?.toLowerCase().includes(k)));
  }, [members, q]);
  const collected = useMemo(() => members.filter((m) => stats.get(m.id)?.segmentCount).length, [members, stats]);
  const sel = members.find((m) => m.id === selId);
  const st = sel && stats.get(sel.id);

  function askDelete(m: GaitMember) {
    modal.confirm({
      title: `把"${m.realName}"从本机构删除？`,
      content: "步态用户和长者档案是同一批人，长者档案里也会一起删除，平台上不能恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteMember(m.id, m.realName);
          message.success("已删除");
          setSelId(undefined);
          setMembers((l) => l.filter((x) => x.id !== m.id));
        } catch (e) {
          message.error(`删除失败：${errText(e)}`);
        }
      },
    });
  }

  return (
    <div className="workbench">
      <section className="dev-list">
        <div className="dev-list-head">
          <div className="dev-list-title">
            <h1>
              <ModuleName k="gaitUsers" />
            </h1>
            <span className="muted">
              {members.length} 人 · {collected} 人有采集
            </span>
            <span style={{ flex: 1 }} />
            <Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => load()} title="刷新" />
            {can("add") && <Button type="text" icon={<PlusOutlined />} onClick={() => openForm()} title="新建用户" />}
          </div>
          <Input allowClear prefix={<SearchOutlined style={{ color: "#8A8FA8" }} />} placeholder="姓名 / 手机号" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="dev-rows" role="listbox" aria-label="步态用户">
          {loading && !members.length ? (
            <Spin style={{ margin: 40 }} />
          ) : !shown.length ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={members.length ? "没有符合条件的用户" : "还没有用户"} />
          ) : (
            shown.map((m) => {
              const n = stats.get(m.id)?.segmentCount ?? 0;
              return (
                <div key={m.id} role="option" aria-selected={m.id === selId} className={`dev-row${m.id === selId ? " on" : ""}`} onClick={() => setSelId(m.id)}>
                  <span className="dev-row-main">
                    <b>{m.realName}</b>
                    <small>{[m.gender ? GENDER[m.gender] : undefined, m.age ? `${m.age} 岁` : undefined, m.phoneNumber].filter(Boolean).join(" · ")}</small>
                  </span>
                  <span className={`dev-row-last${n ? "" : " off"}`}>{n ? `${n} 条` : "没有采集"}</span>
                </div>
              );
            })
          )}
        </div>
        <div className="dev-list-foot muted">
          显示 {shown.length} / {members.length}
        </div>
      </section>

      <section className="dev-detail">
        {sel ? (
          <div className="detail gait-detail" key={sel.id}>
            <div className="detail-head">
              <div className="detail-title">
                <h1>{sel.realName}</h1>
                <span style={{ flex: 1 }} />
                {moduleAllowed(s, "gaitRecords") && (
                  <Button icon={<ProfileOutlined />} onClick={() => onOpenRecords({ memberId: sel.id })}>
                    采集记录
                  </Button>
                )}
                {can("update") && (
                  <Button icon={<EditOutlined />} onClick={() => openForm(sel.id)}>
                    修改
                  </Button>
                )}
                {can("delete") && <Button danger icon={<DeleteOutlined />} onClick={() => askDelete(sel)} title="删除用户" />}
              </div>
            </div>
            <div className="ops-card" style={{ margin: "12px 0" }}>
              <dl className="gait-info">
                <Info k="性别" v={sel.gender ? GENDER[sel.gender] : undefined} />
                <Info k="年龄" v={sel.age ? `${sel.age} 岁` : undefined} />
                <Info k="身高" v={sel.height ? `${sel.height} cm` : undefined} />
                <Info k="体重" v={sel.weight ? `${sel.weight} kg` : undefined} />
                <Info k="手机号" v={sel.phoneNumber} />
                <Info k="绑定传感器" v={sel.deviceCount ? `${sel.deviceCount} 台` : undefined} />
                <Info k="采集次数" v={st?.segmentCount ? `${st.segmentCount} 次` : undefined} />
                <Info k="最近采集" v={st?.lastCreatedAt} />
              </dl>
              {!sel.height && <div className="gait-note">没有身高，报告里的步幅身高比算不出来。</div>}
            </div>
            <Assessment memberId={sel.id} memberName={sel.realName} />
          </div>
        ) : (
          <Empty style={{ marginTop: 120 }} description="选择左侧的用户" />
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
    </div>
  );
}

function Info({ k, v }: { k: string; v: string | undefined }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v ?? <span className="muted">-</span>}</dd>
    </div>
  );
}
