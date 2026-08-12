// Map of category-icon keys to lucide-react components.
// Kept in one place so Menu, Products, and the category manager pick from the same set.

import {
  Cake,
  Coffee,
  Cookie,
  CupSoda,
  Donut,
  GlassWater,
  IceCream,
  Leaf,
  Pizza,
  Sandwich,
  Soup,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

export const CATEGORY_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: 'coffee', label: 'Coffee', Icon: Coffee },
  { key: 'cup-soda', label: 'Cup', Icon: CupSoda },
  { key: 'leaf', label: 'Tea', Icon: Leaf },
  { key: 'cookie', label: 'Cookie', Icon: Cookie },
  { key: 'donut', label: 'Donut', Icon: Donut },
  { key: 'cake', label: 'Cake', Icon: Cake },
  { key: 'water', label: 'Water', Icon: GlassWater },
  { key: 'ice-cream', label: 'Ice', Icon: IceCream },
  { key: 'pizza', label: 'Pizza', Icon: Pizza },
  { key: 'sandwich', label: 'Sandwich', Icon: Sandwich },
  { key: 'soup', label: 'Soup', Icon: Soup },
  { key: 'utensils', label: 'Meal', Icon: Utensils },
];

export const categoryIconMap: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICONS.map((c) => [c.key, c.Icon]),
);

export function getCategoryIcon(key: string | null | undefined): LucideIcon {
  return (key && categoryIconMap[key]) || Coffee;
}
