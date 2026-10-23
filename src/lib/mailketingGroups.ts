// API Mailketing v2 tidak punya grup list. Grup dibaca dari awalan nama, misalnya "GNNK - Gear".
export type MailketingList = { id: number; name: string };
export type MailketingGroup = { name: string | null; lists: (MailketingList & { label: string })[] };

const PEMISAH = /^(.+?)(?:\s+[-–—|/]\s+|\s*:\s+)(.+)$/;

export function groupMailketingLists(lists: MailketingList[]): MailketingGroup[] {
  const groups = new Map<string, MailketingGroup>();
  const lainnya: MailketingGroup = { name: null, lists: [] };
  for (const list of lists) {
    const match = list.name.match(PEMISAH);
    if (!match) { lainnya.lists.push({ ...list, label: list.name }); continue; }
    const key = match[1].trim().toLocaleLowerCase('id');
    if (!groups.has(key)) groups.set(key, { name: match[1].trim(), lists: [] });
    groups.get(key)!.lists.push({ ...list, label: match[2].trim() });
  }
  const sorted = [...groups.values()].sort((a, b) => a.name!.localeCompare(b.name!, 'id', { sensitivity: 'base', numeric: true }));
  return lainnya.lists.length ? [...sorted, lainnya] : sorted;
}
