import { useEffect, useRef, useState } from "react";
import { Input, type InputRef } from "antd";
import { EditOutlined, LoadingOutlined } from "@ant-design/icons";

/**
 * 原地改名：双击文字或点铅笔进入编辑，回车 / 失焦保存，Esc 取消。
 * 保存失败时留在编辑状态，错误由 onSave 自己提示。
 */
export default function EditableText({
  value,
  onSave,
  className,
  maxLength = 32,
  editing: editingProp,
  onEditingChange,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  className?: string;
  maxLength?: number;
  /** 外部控制进入编辑（例如右键菜单里的"重命名"） */
  editing?: boolean;
  onEditingChange?: (v: boolean) => void;
}) {
  const [editingSelf, setEditingSelf] = useState(false);
  const editing = editingProp ?? editingSelf;
  const setEditing = (v: boolean) => (onEditingChange ? onEditingChange(v) : setEditingSelf(v));
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const ref = useRef<InputRef>(null);

  useEffect(() => {
    if (editing) {
      setText(value);
      requestAnimationFrame(() => ref.current?.focus({ cursor: "all" }));
    }
  }, [editing, value]);

  async function commit() {
    const v = text.trim();
    if (!v || v === value) return setEditing(false);
    setSaving(true);
    try {
      await onSave(v);
      setEditing(false);
    } catch {
      requestAnimationFrame(() => ref.current?.focus());
    } finally {
      setSaving(false);
    }
  }

  if (editing)
    return (
      <Input
        ref={ref}
        size="small"
        className={`editable-input ${className ?? ""}`}
        value={text}
        maxLength={maxLength}
        disabled={saving}
        suffix={saving ? <LoadingOutlined /> : <span />}
        onChange={(e) => setText(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => !saving && commit()}
      />
    );
  return (
    <span
      className={`editable ${className ?? ""}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="双击改名"
    >
      <span className="editable-text">{value}</span>
      <EditOutlined
        className="editable-pen"
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      />
    </span>
  );
}
