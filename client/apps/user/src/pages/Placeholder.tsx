import { Empty, Typography } from "antd";

export default function Placeholder({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="page">
      <Typography.Title level={3} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      <div className="card" style={{ padding: 48 }}>
        <Empty description={desc} />
      </div>
    </div>
  );
}
