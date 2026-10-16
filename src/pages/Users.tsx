import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Database,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  UserCog,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import {
  getBackendClient,
  type AdminAuditLog,
  type AdminSystemStats,
  type AdminUser,
} from '@/lib/api';
import { cn, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import {
  CAPABILITY_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  capabilitiesForRole,
  defaultCapabilitiesForRole,
  setCapabilityOverrides,
  roleLabel,
  type Capability,
} from '@/lib/roles';
import { useAuth } from '@/stores/auth';
import { db } from '@/lib/db';
import { uuid } from '@/lib/format';
import type { RolePermission, UserRole } from '@/types';

type AdminTab = 'users' | 'roles' | 'audit' | 'system';
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type AssignableUserRole = Exclude<UserRole, 'manager'>;

const ROLE_OPTIONS: AssignableUserRole[] = ['admin', 'warehouse', 'cashier', 'customer'];
const CAPABILITY_ORDER: Capability[] = [
  'manageUsers',
  'manageStoreSettings',
  'manageInventory',
  'managePromos',
  'useCashier',
  'manageCustomers',
  'manageShifts',
  'viewSalesReports',
  'viewCustomerPortal',
  'managePurchasing',
];

const ADMIN_TABS: Array<{ id: AdminTab; label: string; icon: LucideIcon }> = [
  { id: 'users', label: 'User', icon: Users },
  { id: 'roles', label: 'Role & Permission', icon: ShieldCheck },
  { id: 'audit', label: 'Audit Log', icon: ClipboardList },
  { id: 'system', label: 'System Health', icon: Database },
];

const ACTION_LABELS: Record<string, string> = {
  'user.create': 'Tambah user',
  'user.update': 'Update user',
  'user.delete': 'Hapus user',
};

interface UserForm {
  id?: string;
  email: string;
  full_name: string;
  role: UserRole;
  password: string;
}

const emptyForm: UserForm = {
  email: '',
  full_name: '',
  role: 'cashier',
  password: '',
};

export function UsersPage() {
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? '';
  const rolePerms: RolePermission[] =
    useLiveQuery(
      () => db.role_permissions.where('store_id').equals(storeId).toArray(),
      [storeId],
    ) ?? [];
  const [savingPerm, setSavingPerm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [systemStats, setSystemStats] = useState<AdminSystemStats | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingSystem, setLoadingSystem] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm);

  useEffect(() => {
    void loadAdminData();
  }, []);

  /**
   * Menyalakan/mematikan capability untuk sebuah role di toko ini.
   * Hanya bisa MENGURANGI dari default kode: server tetap memakai
   * TABLE_ROLE_ACCESS sebagai batas atas, jadi menyalakan capability yang
   * memang bukan milik role tersebut tidak memberi akses apa pun.
   */
  async function togglePermission(role: string, capability: string) {
    if (!storeId) return;
    const key = `${role}|${capability}`;
    setSavingPerm(key);
    try {
      const api = getBackendClient();
      const existing = rolePerms.find((r) => r.role === role && r.capability === capability);
      const nextEnabled = existing ? !existing.enabled : false;
      const row = {
        id: existing?.id ?? uuid(),
        store_id: storeId,
        role,
        capability,
        enabled: nextEnabled,
        updated_at: new Date().toISOString(),
      };
      const { error } = await api.from('role_permissions').upsert(row);
      if (error) throw error;
      await db.role_permissions.put(row);
      setCapabilityOverrides(await db.role_permissions.where('store_id').equals(storeId).toArray());
      toast.success(`${capability} ${nextEnabled ? 'diaktifkan' : 'dimatikan'} untuk ${role}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan hak akses.');
    } finally {
      setSavingPerm(null);
    }
  }

  async function loadAdminData() {
    await Promise.all([loadUsers(), loadSystem()]);
  }

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await getBackendClient().admin.listUsers();
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setUsers(data ?? []);
  }

  async function loadSystem() {
    setLoadingSystem(true);
    const api = getBackendClient().admin;
    const [statsResult, auditResult] = await Promise.all([
      api.systemStats(),
      api.listAuditLogs(100),
    ]);
    setLoadingSystem(false);

    if (statsResult.error) toast.error(statsResult.error.message);
    else setSystemStats(statsResult.data ?? null);

    if (auditResult.error) toast.error(auditResult.error.message);
    else setAuditLogs(auditResult.data ?? []);
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      [user.email, user.full_name ?? '', roleLabel(user.role)]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [q, users]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(ROLE_OPTIONS.map((role) => [role, 0]));
    if (systemStats) return { ...counts, ...systemStats.users.roles };
    for (const user of users) counts[user.role] = (counts[user.role] ?? 0) + 1;
    return counts;
  }, [systemStats, users]);

  const systemAlerts = useMemo(() => {
    const stats = systemStats;
    if (!stats) return [];
    return [
      stats.products.empty > 0 ? `${formatNumber(stats.products.empty)} stok habis` : '',
      stats.products.low_stock > 0 ? `${formatNumber(stats.products.low_stock)} stok menipis` : '',
      stats.orders.unpaid_count > 0 ? `${formatNumber(stats.orders.unpaid_count)} order belum lunas` : '',
      stats.shifts.open > 0 ? `${formatNumber(stats.shifts.open)} shift terbuka` : '',
    ].filter(Boolean);
  }, [systemStats]);

  function startCreate(role: UserRole = 'cashier') {
    setForm({ ...emptyForm, role });
    setOpen(true);
  }

  function startEdit(user: AdminUser) {
    setForm({
      id: user.id,
      email: user.email,
      full_name: user.full_name ?? '',
      role: user.role === 'manager' ? 'admin' : user.role,
      password: '',
    });
    setOpen(true);
  }

  async function saveUser() {
    if (!form.email.trim()) {
      toast.error('Email wajib diisi.');
      return;
    }
    if (!form.id && form.password.length < 6) {
      toast.error('Password minimal 6 karakter.');
      return;
    }

    setBusy(true);
    const api = getBackendClient().admin;
    const payload = {
      email: form.email.trim(),
      full_name: form.full_name.trim(),
      role: form.role,
      ...(form.password ? { password: form.password } : {}),
    };
    const { error } = form.id
      ? await api.updateUser(form.id, payload)
      : await api.createUser({ ...payload, password: form.password });
    setBusy(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(form.id ? 'User diperbarui.' : 'User ditambahkan.');
    setOpen(false);
    await loadAdminData();
  }

  async function removeUser(user: AdminUser) {
    if (!confirm(`Hapus user ${user.email}?`)) return;
    setBusy(true);
    const { error } = await getBackendClient().admin.deleteUser(user.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('User dihapus.');
    await loadAdminData();
  }

  const criticalStock = (systemStats?.products.empty ?? 0) + (systemStats?.products.low_stock ?? 0);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-brand-600 p-5 text-white shadow-card md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase opacity-80">
              <ShieldCheck size={14} />
              Sistem Admin
            </div>
            <h1 className="mt-2 text-2xl font-bold md:text-3xl">Admin Control Center</h1>
            <p className="mt-1 max-w-2xl text-sm opacity-85">
              Kontrol user, role, permission, audit aktivitas, dan status operasional toko dari satu halaman.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={loadAdminData}
              disabled={loading || loadingSystem}
              className="bg-white/15 !text-white hover:bg-white/25"
            >
              {loading || loadingSystem ? <Spinner /> : <RefreshCcw size={14} />} Refresh
            </Button>
            <Button onClick={() => startCreate()} variant="onBrand">
              <Plus size={16} /> Tambah User
            </Button>
          </div>
        </div>
        {systemAlerts.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {systemAlerts.map((alert) => (
              <span key={alert} className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                <AlertTriangle size={13} className="mr-1 inline" />
                {alert}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SystemMetric
          icon={Users}
          label="Total User"
          value={loading ? '...' : formatNumber(systemStats?.users.total ?? users.length)}
          meta={`${formatNumber(roleCounts.admin ?? 0)} admin`}
          tone="info"
        />
        <SystemMetric
          icon={Boxes}
          label="Produk Aktif"
          value={loadingSystem ? '...' : formatNumber(systemStats?.products.active ?? 0)}
          meta={`${formatNumber(criticalStock)} perlu dicek`}
          tone={criticalStock > 0 ? 'warning' : 'success'}
        />
        <SystemMetric
          icon={ShoppingCart}
          label="Order Hari Ini"
          value={loadingSystem ? '...' : formatNumber(systemStats?.orders.today_count ?? 0)}
          meta={formatMoney(systemStats?.orders.today_sales ?? 0)}
          tone="success"
        />
        <SystemMetric
          icon={Activity}
          label="Shift Terbuka"
          value={loadingSystem ? '...' : formatNumber(systemStats?.shifts.open ?? 0)}
          meta="Kasir aktif"
          tone={(systemStats?.shifts.open ?? 0) > 0 ? 'info' : 'neutral'}
        />
        <SystemMetric
          icon={ClipboardList}
          label="Audit Log"
          value={loadingSystem ? '...' : formatNumber(auditLogs.length)}
          meta={systemStats?.audit.latest_at ? formatDateTime(systemStats.audit.latest_at) : 'Belum ada log'}
          tone="neutral"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-ink-100 bg-white p-1 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex min-w-max gap-1">
          {ADMIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition',
                  active
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800',
                )}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'users' && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Manajemen User</h2>
              <p className="text-sm text-ink-500">Tambah admin, admin gudang, kasir, dan pembeli.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-full bg-ink-100 px-3 py-1.5 text-sm dark:bg-ink-800">
                <Search size={14} className="text-ink-500" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-44 bg-transparent placeholder:text-ink-400 focus:outline-none sm:w-56"
                  placeholder="Cari user / role"
                />
              </div>
              <Button variant="secondary" onClick={loadUsers} disabled={loading}>
                {loading ? <Spinner /> : <RefreshCcw size={14} />} Refresh
              </Button>
            </div>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ROLE_OPTIONS.map((role) => (
              <div key={role} className="rounded-2xl border border-ink-100 p-4 dark:border-ink-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold">{ROLE_LABELS[role]}</div>
                    <p className="mt-1 text-xs leading-5 text-ink-500">{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                  <div className="text-2xl font-bold text-brand-600">{roleCounts[role] ?? 0}</div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => startCreate(role)}
                >
                  <Plus size={13} /> Tambah {ROLE_LABELS[role]}
                </Button>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="grid min-h-40 place-items-center text-brand-600">
              <Spinner className="h-8 w-8" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-500">
                  <tr>
                    <th className="py-2">User</th>
                    <th className="py-2">Role</th>
                    <th className="hidden py-2 lg:table-cell">Akses</th>
                    <th className="hidden py-2 sm:table-cell">Dibuat</th>
                    <th className="py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const caps = capabilitiesForRole(user.role);
                    return (
                      <tr key={user.id} className="border-t border-ink-100 dark:border-ink-800">
                        <td className="max-w-[185px] py-3 pr-4 sm:max-w-none">
                          <div className="truncate font-semibold">{user.full_name || user.email}</div>
                          <div className="truncate text-xs text-ink-500">{user.email}</div>
                          {/* Lima kolom ini 462px di wadah 328px pada layar HP,
                              jadi tombol aksinya tidak terlihat. Akses dan
                              Dibuat disembunyikan, ringkasnya ikut di sini. */}
                          <div className="mt-1 flex flex-wrap items-center gap-1 lg:hidden">
                            {caps.slice(0, 2).map((capability) => (
                              <Badge key={capability} tone="neutral">
                                {CAPABILITY_LABELS[capability]}
                              </Badge>
                            ))}
                            {caps.length > 2 && <Badge tone="info">+{caps.length - 2}</Badge>}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <RoleBadge role={user.role} />
                        </td>
                        <td className="hidden py-3 pr-4 lg:table-cell">
                          <div className="flex max-w-sm flex-wrap gap-1">
                            {caps.slice(0, 3).map((capability) => (
                              <Badge key={capability} tone="neutral">
                                {CAPABILITY_LABELS[capability]}
                              </Badge>
                            ))}
                            {caps.length > 3 && <Badge tone="info">+{caps.length - 3}</Badge>}
                          </div>
                        </td>
                        <td className="hidden py-3 pr-4 text-ink-500 sm:table-cell">{formatDateTime(user.created_at)}</td>
                        <td className="py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => startEdit(user)}
                              className="rounded-full p-1.5 hover:bg-ink-100 dark:hover:bg-ink-800"
                              title="Edit user"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => removeUser(user)}
                              className={cn(
                                'rounded-full p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10',
                                user.id === profile?.id && 'cursor-not-allowed opacity-40',
                              )}
                              disabled={user.id === profile?.id || busy}
                              title="Hapus user"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="py-10 text-center text-sm text-ink-500">Tidak ada user.</div>
              )}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'roles' && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Role & Permission Matrix</h2>
              <p className="max-w-xl text-sm text-ink-500">
                Klik centang untuk mematikan akses sebuah role di toko ini. Pengaturan hanya bisa{' '}
                <strong>mengurangi</strong> akses bawaan — server tetap menolak apa pun di luar hak
                dasar role tersebut, jadi salah setel tidak bisa menaikkan wewenang.
              </p>
            </div>
            <Badge tone="info">
              <LockKeyhole size={13} className="mr-1" />
              Admin only
            </Badge>
          </div>

          <div className="grid gap-4 lg:grid-cols-[0.8fr_1.4fr]">
            <div className="space-y-3">
              {ROLE_OPTIONS.map((role) => (
                <div key={role} className="rounded-2xl border border-ink-100 p-4 dark:border-ink-800">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <RoleBadge role={role} />
                    <span className="text-xs font-semibold text-ink-500">
                      {formatNumber(roleCounts[role] ?? 0)} user
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-ink-600 dark:text-ink-300">{ROLE_DESCRIPTIONS[role]}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {capabilitiesForRole(role).map((capability) => (
                      <Badge key={capability} tone="neutral">
                        {CAPABILITY_LABELS[capability]}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-ink-100 dark:border-ink-800">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-ink-900 text-left text-xs text-white">
                  <tr>
                    <th className="px-3 py-3">Role</th>
                    {CAPABILITY_ORDER.map((capability) => (
                      <th key={capability} className="px-3 py-3 text-center">
                        {CAPABILITY_LABELS[capability]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROLE_OPTIONS.map((role) => {
                    const caps = capabilitiesForRole(role);
                    return (
                      <tr key={role} className="border-t border-ink-100 dark:border-ink-800">
                        <td className="px-3 py-3 font-semibold">{ROLE_LABELS[role]}</td>
                        {CAPABILITY_ORDER.map((capability) => {
                          const inDefault = defaultCapabilitiesForRole(role).includes(capability);
                          const allowed = caps.includes(capability);
                          const key = `${role}|${capability}`;
                          return (
                            <td key={capability} className="px-3 py-3 text-center">
                              <button
                                type="button"
                                disabled={!inDefault || savingPerm === key}
                                onClick={() => togglePermission(role, capability)}
                                title={
                                  !inDefault
                                    ? 'Tidak tersedia untuk role ini'
                                    : allowed
                                      ? 'Klik untuk mematikan'
                                      : 'Klik untuk mengaktifkan'
                                }
                                className={
                                  inDefault
                                    ? 'rounded-full p-1 transition hover:bg-ink-100 dark:hover:bg-ink-800'
                                    : 'cursor-not-allowed rounded-full p-1 opacity-40'
                                }
                              >
                                {allowed ? (
                                  <CheckCircle2 size={18} className="mx-auto text-emerald-600" />
                                ) : (
                                  <XCircle
                                    size={18}
                                    className={
                                      inDefault
                                        ? 'mx-auto text-rose-500'
                                        : 'mx-auto text-ink-300 dark:text-ink-700'
                                    }
                                  />
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'audit' && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Audit Log Admin</h2>
              <p className="text-sm text-ink-500">Riwayat perubahan user dan akses yang dilakukan admin.</p>
            </div>
            <Button variant="secondary" onClick={loadSystem} disabled={loadingSystem}>
              {loadingSystem ? <Spinner /> : <RefreshCcw size={14} />} Refresh Log
            </Button>
          </div>

          {loadingSystem ? (
            <div className="grid min-h-40 place-items-center text-brand-600">
              <Spinner className="h-8 w-8" />
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink-200 py-12 text-center dark:border-ink-800">
              <ClipboardList className="mx-auto mb-3 text-ink-300" size={36} />
              <div className="font-semibold">Belum ada audit log</div>
              <p className="mt-1 text-sm text-ink-500">Log akan muncul setelah admin menambah, mengubah, atau menghapus user.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-500">
                  <tr>
                    <th className="py-2">Waktu</th>
                    <th className="py-2">Aktor</th>
                    <th className="py-2">Aksi</th>
                    <th className="py-2">Target</th>
                    <th className="py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="py-3 pr-4 text-ink-500">{formatDateTime(log.created_at)}</td>
                      <td className="py-3 pr-4">
                        <div className="font-semibold">{log.actor_name || log.actor_email || 'Admin lama'}</div>
                        <div className="text-xs text-ink-500">{log.actor_email || 'Aktor sudah dihapus'}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge tone={actionTone(log.action)}>{actionLabel(log.action)}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-semibold capitalize">{log.target_type}</div>
                        <div className="text-xs text-ink-500">{shortId(log.target_id)}</div>
                      </td>
                      <td className="max-w-md py-3 text-ink-600 dark:text-ink-300">
                        {metadataSummary(log.metadata)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'system' && (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="p-5">
            <div className="mb-4">
              <h2 className="text-lg font-bold">System Health</h2>
              <p className="text-sm text-ink-500">Status ringkas dari layanan inti admin dan operasional toko.</p>
            </div>
            <div className="space-y-3">
              <HealthLine
                icon={Database}
                title="Database Postgres"
                description="Endpoint admin berhasil membaca data tenant toko."
                ok={Boolean(systemStats)}
              />
              <HealthLine
                icon={ShieldCheck}
                title="RBAC Admin"
                description="Akses halaman, query, dan endpoint admin dikunci untuk role admin."
                ok
              />
              <HealthLine
                icon={ClipboardList}
                title="Audit Trail"
                description={auditLogs.length > 0 ? 'Aktivitas admin sudah tercatat.' : 'Siap mencatat aktivitas admin berikutnya.'}
                ok
              />
              <HealthLine
                icon={AlertTriangle}
                title="Inventory Watch"
                description={`${formatNumber(systemStats?.products.low_stock ?? 0)} menipis, ${formatNumber(systemStats?.products.empty ?? 0)} habis.`}
                ok={(systemStats?.products.empty ?? 0) === 0}
                warning={(systemStats?.products.low_stock ?? 0) > 0 || (systemStats?.products.empty ?? 0) > 0}
              />
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Operasional Hari Ini</h2>
                <p className="text-sm text-ink-500">Angka cepat untuk admin sebelum cek laporan detail.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={loadSystem} disabled={loadingSystem}>
                {loadingSystem ? <Spinner /> : <RefreshCcw size={13} />}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <MiniStat label="Omzet dibayar" value={formatMoney(systemStats?.orders.today_sales ?? 0)} />
              <MiniStat label="Order hari ini" value={formatNumber(systemStats?.orders.today_count ?? 0)} />
              <MiniStat label="Order belum lunas" value={formatNumber(systemStats?.orders.unpaid_count ?? 0)} />
              <MiniStat label="Produk perlu dicek" value={formatNumber(criticalStock)} />
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? 'Edit User' : 'Tambah User'}
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Nama"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="Nama lengkap"
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="nama@domain.com"
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-200">
                Role
              </label>
              <select
                className="input"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label={form.id ? 'Password baru' : 'Password'}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={form.id ? 'Kosongkan jika tidak diubah' : 'Minimal 6 karakter'}
              hint={form.id ? 'Isi hanya saat ingin reset password user ini.' : undefined}
            />
          </div>
          <div className="rounded-xl bg-ink-50 p-3 text-xs text-ink-500 dark:bg-ink-900">
            <KeyRound size={13} className="mr-1 inline" />
            Password disimpan sebagai hash scrypt di server. Admin tidak bisa melihat password lama.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button onClick={saveUser} disabled={busy}>
              {busy ? <Spinner /> : <UserCog size={14} />} Simpan User
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SystemMetric({
  icon: Icon,
  label,
  value,
  meta,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  meta: string;
  tone: BadgeTone;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase text-ink-500">{label}</div>
          <div className="mt-2 text-2xl font-bold">{value}</div>
          <div className="mt-1 text-xs text-ink-500">{meta}</div>
        </div>
        <div className={cn('rounded-2xl p-2', metricToneClass[tone])}>
          <Icon size={18} />
        </div>
      </div>
    </Card>
  );
}

function HealthLine({
  icon: Icon,
  title,
  description,
  ok,
  warning = false,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  ok: boolean;
  warning?: boolean;
}) {
  const tone: BadgeTone = warning ? 'warning' : ok ? 'success' : 'danger';
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-ink-100 p-4 dark:border-ink-800">
      <div className={cn('rounded-2xl p-2', metricToneClass[tone])}>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{title}</div>
          <Badge tone={tone}>{warning ? 'Perlu cek' : ok ? 'Siap' : 'Error'}</Badge>
        </div>
        <p className="mt-1 text-sm leading-6 text-ink-500">{description}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 p-4 dark:border-ink-800">
      <div className="text-xs font-semibold uppercase text-ink-500">{label}</div>
      <div className="mt-2 text-xl font-bold">{value}</div>
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const tone =
    role === 'admin' || role === 'manager'
      ? 'danger'
      : role === 'warehouse'
        ? 'info'
        : role === 'cashier'
          ? 'success'
          : 'neutral';
  return <Badge tone={tone}>{roleLabel(role)}</Badge>;
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll('.', ' / ');
}

function actionTone(action: string): BadgeTone {
  if (action.endsWith('.create')) return 'success';
  if (action.endsWith('.delete')) return 'danger';
  if (action.endsWith('.update')) return 'info';
  return 'neutral';
}

function metadataSummary(metadata: Record<string, unknown>): string {
  const changes = metadata.changes;
  if (isRecord(changes)) {
    const parts = Object.entries(changes).map(([key, value]) => {
      if (key === 'password_reset') return 'Password direset';
      if (isRecord(value) && ('from' in value || 'to' in value)) {
        return `${fieldLabel(key)}: ${formatMetadataValue(value.from)} -> ${formatMetadataValue(value.to)}`;
      }
      return `${fieldLabel(key)} diperbarui`;
    });
    if (parts.length) return parts.join(', ');
  }

  const fullName = typeof metadata.full_name === 'string' ? metadata.full_name : '';
  const email = typeof metadata.email === 'string' ? metadata.email : '';
  const role = typeof metadata.role === 'string' ? roleLabel(metadata.role) : '';
  return [fullName, email, role].filter(Boolean).join(' - ') || 'Detail tidak tersedia';
}

function fieldLabel(key: string): string {
  if (key === 'full_name') return 'Nama';
  if (key === 'email') return 'Email';
  if (key === 'role') return 'Role';
  return key.replaceAll('_', ' ');
}

function formatMetadataValue(value: unknown): string {
  if (value == null || value === '') return 'kosong';
  if (typeof value === 'boolean') return value ? 'ya' : 'tidak';
  if (typeof value === 'string' && value in ROLE_LABELS) return roleLabel(value);
  return String(value);
}

function shortId(value: string | null): string {
  if (!value) return '-';
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const metricToneClass: Record<BadgeTone, string> = {
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  danger: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  info: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  neutral: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-200',
};
