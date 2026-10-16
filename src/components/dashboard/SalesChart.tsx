import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface Point {
  month: string;
  sales: number;
  orders: number;
  customers: number;
}

export function SalesChart({ data }: { data: Point[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -10, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="4 4" vertical={false} className="stroke-ink-200 dark:stroke-ink-800" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12 }}
            stroke="currentColor"
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={{ fontSize: 12 }} stroke="currentColor" tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: 'none',
              background: 'rgba(20,24,38,0.95)',
              color: '#fff',
              fontSize: 12,
            }}
            labelStyle={{ color: '#fff' }}
            cursor={{ stroke: '#5A41E5', strokeWidth: 1, strokeDasharray: '4 4' }}
          />
          <Line type="monotone" dataKey="sales" stroke="#5A41E5" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="orders" stroke="#22c55e" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="customers" stroke="#7c4dff" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
